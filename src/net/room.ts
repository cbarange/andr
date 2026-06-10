// ============================================================================
//  RÉSEAU P2P — §7. WebRTC DataChannels via Trystero (stratégie Nostr par défaut :
//  signaling via relais publics, RIEN à héberger).
//
//  Modèle HÔTE-AUTORITAIRE :
//   - l'hôte = le pair dont l'id est le plus petit (calcul identique chez tous) ;
//   - playerTransform : diffusé par tous, affiché en avatar distant interpolé ;
//   - gameAction : envoyée à l'hôte, qui l'applique et rediffuse l'état (stateSync).
//  NB : la physique reste locale à chaque joueur ; seule la SIM (le bois) est
//  rendue cohérente par l'autorité de l'hôte (§7).
// ============================================================================

import { joinRoom, selfId, type Room } from "trystero";
import type { PlayerTransformMsg, GameActionMsg, StateSyncMsg } from "./messages";
import { resolveHostOnSync } from "./host";

const APP_ID = "darkroom3d-poc-v1";

export interface RoomCallbacks {
  onPeerJoin?: (id: string) => void;
  onPeerLeave?: (id: string) => void;
  onTransform?: (id: string, t: PlayerTransformMsg) => void;
  onGameAction?: (action: GameActionMsg, fromId: string) => void;
  onStateSync?: (s: StateSyncMsg) => void;
  onHostChange?: (isHost: boolean, hostId: string) => void;
  onStatus?: (text: string, online: boolean) => void;
  onSplitBrain?: () => void; // deux hôtes « ouverts » détectés : on a cédé l'autorité (avertir)
}

export class NetRoom {
  readonly selfId = selfId;
  private room?: Room;
  private peers = new Set<string>();
  private hostId = selfId;
  // Si vrai, CE pair a « ouvert » la partie -> il est l'hôte autoritaire tant qu'il est connecté
  // (les autres adoptent SON état). Sinon, on défère à l'hôte qui diffuse l'état (cf. sync).
  private forcedHost = false;
  private announcedHost: string | null = null; // dernier hôte connu via une diffusion d'état
  private cb: RoomCallbacks = {};
  private senders?: {
    xform: (data: PlayerTransformMsg) => void;
    act: (data: GameActionMsg, target?: string) => void;
    sync: (data: StateSyncMsg) => void;
  };

  get connected(): boolean {
    return !!this.room;
  }

  get isHost(): boolean {
    return this.hostId === this.selfId;
  }

  /** A-t-on « ouvert » la partie (hôte autoritaire fixé) ? Sert à revendiquer l'autorité dans le snapshot. */
  get isForcedHost(): boolean {
    return this.forcedHost;
  }

  getHostId(): string {
    return this.hostId;
  }

  get peerCount(): number {
    return this.peers.size;
  }

  /**
   * Latence aller-retour (ms) vers l'hôte si l'on est client, vers un pair si l'on est hôte.
   * `null` si hors-ligne ou sans cible. Utilise le `ping` natif de Trystero (overlay debug).
   */
  async measurePing(): Promise<number | null> {
    if (!this.room) return null;
    const target = this.isHost ? [...this.peers][0] : this.hostId;
    if (!target || target === this.selfId) return null;
    try {
      return Math.round(await this.room.ping(target));
    } catch {
      return null;
    }
  }

  /**
   * Rejoint un salon. `asHost = true` -> on « ouvre » sa partie : on reste l'hôte autoritaire
   * (les autres adoptent notre état). `asHost = false` -> on rejoint : on défère à l'hôte qui
   * diffuse l'état (et on reste hôte de soi-même tant qu'on est seul).
   */
  join(code: string, cb: RoomCallbacks, asHost = false): void {
    this.leave();
    this.cb = cb;
    this.forcedHost = asHost;
    this.announcedHost = null;

    const room = joinRoom({ appId: APP_ID }, code);
    this.room = room;
    this.peers.clear();
    this.hostId = this.selfId; // seul jusqu'à preuve du contraire -> hôte

    // API Trystero v0.25 : makeAction renvoie { send, onMessage } (et non un tuple).
    const xform = room.makeAction("xform");
    const act = room.makeAction("gameAct");
    const sync = room.makeAction("sync");
    this.senders = {
      xform: (d) => void xform.send(d),
      act: (d, target) => void act.send(d, target ? { target } : undefined),
      // L'état complet est JSON-sérialisable (invariant testé) ; on caste pour le typage Trystero.
      sync: (d) => void sync.send(d as unknown as Parameters<typeof sync.send>[0]),
    };

    xform.onMessage = (data, ctx) => this.cb.onTransform?.(ctx.peerId, data as PlayerTransformMsg);
    act.onMessage = (data, ctx) => this.cb.onGameAction?.(data as GameActionMsg, ctx.peerId);
    sync.onMessage = (data, ctx) => {
      const msg = data as unknown as StateSyncMsg;
      // Décision d'autorité (pure, testée) : s'aligner, ignorer, ou céder (split-brain).
      const decision = resolveHostOnSync(this.selfId, this.forcedHost, ctx.peerId, msg.host?.forced ?? false);
      if (decision === "ignore") return; // je reste l'autorité -> j'ignore cet état
      if (decision === "yield") { this.forcedHost = false; this.cb.onSplitBrain?.(); } // je cède
      // defer / yield : l'émetteur fait foi -> on s'aligne sur lui et on adopte son état.
      this.announcedHost = ctx.peerId;
      if (this.hostId !== ctx.peerId) {
        this.hostId = ctx.peerId;
        this.cb.onHostChange?.(this.isHost, this.hostId);
        this.updateStatus();
      }
      this.cb.onStateSync?.(msg);
    };

    room.onPeerJoin = (id) => {
      this.peers.add(id);
      this.recomputeHost();
      this.cb.onPeerJoin?.(id);
      this.updateStatus();
    };
    room.onPeerLeave = (id) => {
      this.peers.delete(id);
      if (this.announcedHost === id) this.announcedHost = null; // l'hôte est parti -> ré-élection
      this.recomputeHost();
      this.cb.onPeerLeave?.(id);
      this.updateStatus();
    };

    // Notifie l'état initial (seul dans le salon -> hôte).
    this.cb.onHostChange?.(this.isHost, this.hostId);
    this.updateStatus();
  }

  private recomputeHost(): void {
    let newHost: string;
    if (this.forcedHost) {
      newHost = this.selfId; // « j'ai ouvert ma partie » -> je reste l'autorité
    } else if (this.announcedHost && this.peers.has(this.announcedHost)) {
      newHost = this.announcedHost; // on connaît l'hôte qui diffuse -> on le garde
    } else {
      // Bootstrap / ré-élection : le plus petit id (calcul identique chez tous).
      newHost = [this.selfId, ...this.peers].sort()[0];
    }
    if (newHost !== this.hostId) {
      this.hostId = newHost;
      this.cb.onHostChange?.(this.isHost, this.hostId);
    }
  }

  private updateStatus(): void {
    const n = this.peers.size;
    const role = this.isHost ? "hôte" : "client";
    this.cb.onStatus?.(`connecté · ${n} pair(s) · ${role}`, true);
  }

  broadcastTransform(t: PlayerTransformMsg): void {
    this.senders?.xform(t);
  }

  sendGameActionToHost(a: GameActionMsg): void {
    this.senders?.act(a, this.hostId);
  }

  broadcastStateSync(s: StateSyncMsg): void {
    this.senders?.sync(s);
  }

  leave(): void {
    if (this.room) {
      this.room.leave();
      this.room = undefined;
      this.senders = undefined;
      this.peers.clear();
      this.hostId = this.selfId;
      this.forcedHost = false;
      this.announcedHost = null;
    }
  }
}
