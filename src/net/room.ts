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
import type { PlayerTransformMsg, GameActionMsg, StateSyncMsg, EnemiesMsg } from "./messages";
import { resolveSync, shouldTakeOver } from "./host";

const APP_ID = "darkroom3d-poc-v1";

// Serveurs ICE pour WebRTC. STUN publics (gratuits) : améliorent la traversée de NAT. Pour les
// réseaux très restrictifs (NAT symétrique, pare-feu d'entreprise), un STUN ne suffit pas -> il
// faut un serveur TURN (relais média, à héberger via coturn ou un service payant) : décommenter et
// renseigner urls/username/credential. Trystero passe `rtcConfig` tel quel à RTCPeerConnection.
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    // { urls: "turn:VOTRE_TURN:3478", username: "USER", credential: "SECRET" },
  ],
};

// Heartbeat d'hôte : un hôte diffuse l'état toutes les ~500 ms. Au-delà de ce silence, on considère
// qu'il a disparu (onglet en arrière-plan, réseau coupé sans `onPeerLeave`) et le plus petit pair
// vivant reprend l'autorité (failover). 6 s = ~12 snapshots manqués -> clairement mort, pas un hoquet.
const HOST_TIMEOUT_MS = 6000;

export interface RoomCallbacks {
  onPeerJoin?: (id: string) => void;
  onPeerLeave?: (id: string) => void;
  onTransform?: (id: string, t: PlayerTransformMsg) => void;
  onEnemies?: (m: EnemiesMsg) => void; // positions d'ennemis partagés (flux rapide de l'hôte, M8.6)
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
  // Époque (terme d'autorité, façon Raft-lite). `hostEpoch` = terme sous lequel JE diffuse si je suis
  // hôte ; `seenEpoch` = plus haute époque observée. `lastHostSyncMs` = horloge monotone du dernier
  // état reçu de l'hôte annoncé (heartbeat -> détection de silence). Cf. net/host.ts.
  private hostEpoch = 0;
  private seenEpoch = 0;
  private lastHostSyncMs = 0;
  private cb: RoomCallbacks = {};
  private senders?: {
    xform: (data: PlayerTransformMsg) => void;
    enemies: (data: EnemiesMsg) => void;
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

  /** Époque (terme d'autorité) sous laquelle on diffuse — incluse dans le `host` du snapshot. */
  get epoch(): number {
    return this.hostEpoch;
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
    this.hostEpoch = 0;
    this.seenEpoch = 0;
    this.lastHostSyncMs = 0;

    const room = joinRoom({ appId: APP_ID, rtcConfig: RTC_CONFIG }, code);
    this.room = room;
    this.peers.clear();
    this.hostId = this.selfId; // seul jusqu'à preuve du contraire -> hôte

    // API Trystero v0.25 : makeAction renvoie { send, onMessage } (et non un tuple).
    const xform = room.makeAction("xform");
    const enemies = room.makeAction("enemy"); // flux rapide de positions d'ennemis (hôte -> tous, M8.6)
    const act = room.makeAction("gameAct");
    const sync = room.makeAction("sync");
    this.senders = {
      xform: (d) => void xform.send(d),
      enemies: (d) => void enemies.send(d as unknown as Parameters<typeof enemies.send>[0]),
      act: (d, target) => void act.send(d, target ? { target } : undefined),
      // L'état complet est JSON-sérialisable (invariant testé) ; on caste pour le typage Trystero.
      sync: (d) => void sync.send(d as unknown as Parameters<typeof sync.send>[0]),
    };

    xform.onMessage = (data, ctx) => this.cb.onTransform?.(ctx.peerId, data as PlayerTransformMsg);
    enemies.onMessage = (data) => this.cb.onEnemies?.(data as unknown as EnemiesMsg);
    act.onMessage = (data, ctx) => this.cb.onGameAction?.(data as GameActionMsg, ctx.peerId);
    sync.onMessage = (data, ctx) => {
      const msg = data as unknown as StateSyncMsg;
      const senderEpoch = msg.host?.epoch ?? 0;
      // Décision d'autorité (pure, testée) : époque (terme) d'abord, puis hôte-fixé / split-brain.
      const decision = resolveSync(this.selfId, this.forcedHost, this.hostEpoch, ctx.peerId, msg.host?.forced ?? false, senderEpoch);
      if (decision === "ignore") return; // je reste l'autorité (ou l'émetteur est périmé) -> j'ignore
      if (decision === "yield") { this.forcedHost = false; this.cb.onSplitBrain?.(); } // je cède
      // defer / yield : l'émetteur fait foi -> on s'aligne sur lui et on adopte son état + son terme.
      this.seenEpoch = Math.max(this.seenEpoch, senderEpoch);
      this.hostEpoch = Math.max(this.hostEpoch, senderEpoch); // si promu plus tard, on rediffuse au bon terme
      this.announcedHost = ctx.peerId;
      this.lastHostSyncMs = performance.now(); // heartbeat : on vient d'avoir des nouvelles de l'hôte
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

  /**
   * Heartbeat d'hôte : si l'hôte annoncé s'est tu trop longtemps (`HOST_TIMEOUT_MS`), le plus petit
   * pair vivant reprend l'autorité (failover). À appeler chaque frame côté CLIENT connecté ; `nowMs`
   * = horloge monotone (`performance.now()`). Renvoie `true` si CE pair vient de prendre la main
   * (l'appelant doit alors diffuser son état). Décision pure : `shouldTakeOver` (testée).
   */
  checkLiveness(nowMs: number): boolean {
    if (!this.room || this.isHost) return false; // hors-ligne ou déjà hôte : rien à surveiller
    const since = nowMs - this.lastHostSyncMs;
    if (!shouldTakeOver(this.selfId, [...this.peers], this.announcedHost, since, HOST_TIMEOUT_MS)) return false;
    // Reprise : nouveau terme (> tout ce qu'on a vu) -> on supplante l'hôte silencieux. L'ancien hôte,
    // s'il revient, diffusera sous une époque PLUS BASSE et sera ignoré (resolveSync).
    this.hostEpoch = this.seenEpoch + 1;
    this.seenEpoch = this.hostEpoch;
    this.announcedHost = null;
    this.hostId = this.selfId;
    this.lastHostSyncMs = nowMs; // évite un re-déclenchement immédiat
    this.cb.onHostChange?.(true, this.hostId);
    this.updateStatus();
    return true;
  }

  private updateStatus(): void {
    const n = this.peers.size;
    const role = this.isHost ? "hôte" : "client";
    this.cb.onStatus?.(`connecté · ${n} pair(s) · ${role}`, true);
  }

  broadcastTransform(t: PlayerTransformMsg): void {
    this.senders?.xform(t);
  }

  /** Diffuse les positions d'ennemis partagés (hôte -> tous) — flux rapide d'interpolation (M8.6). */
  broadcastEnemies(m: EnemiesMsg): void {
    this.senders?.enemies(m);
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
      this.hostEpoch = 0;
      this.seenEpoch = 0;
      this.lastHostSyncMs = 0;
    }
  }
}
