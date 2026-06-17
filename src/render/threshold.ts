// ============================================================================
//  TRANSITION CINÉMATIQUE DE SEUIL (M11/RF5) — à chaque ENTRÉE/SORTIE d'un environnement clos
//  (GROTTE, MINE, CUIRASSÉ — JAMAIS la cabane), une mini-cinématique <1,5 s : la porte s'ouvre →
//  le personnage franchit le seuil (marche scriptée) → bref fondu au noir PILE au seuil (qui masque
//  le chargement de l'intérieur / l'émission ENTER_ROOM) → la caméra s'installe (FPV dedans).
//
//  100 % LOCAL — la machine d'état NE TOUCHE JAMAIS la sim (pilier « zéro désync »). La seule
//  interaction sim (ENTER_ROOM du cuirassé) est émise via le callback `onCommit`, au fondu au noir.
//
//  Découpage : `ThresholdCine` = machine d'état PURE (testable, sans Babylon/DOM) ; `AnimatedDoor`
//  (mesh de seuil par type) + `DipOverlay` (fondu au noir DOM) = briques visuelles pilotées par main.
// ============================================================================

import { Scene, TransformNode } from "@babylonjs/core";
import { makeKit, P, type Kit } from "./lowpoly";

export type ThresholdPhase = "idle" | "opening" | "walking" | "dip" | "settling";
export type ThresholdDir = "in" | "out";
export type ThresholdSite = "cave" | "mine" | "ship";

// Durées (s) — total ≈ 1,45 s ; fondu < 0,4 s (anti mal des transports, roadmap §2.5/§9).
const D_OPEN = 0.4, D_WALK = 0.5, D_DIP = 0.35, D_SETTLE = 0.3;
const D_TOTAL = D_OPEN + D_WALK + D_DIP + D_SETTLE;
const TIMEOUT = 3.0; // sécurité dure : au-delà, on force `idle` (jamais coincé)

/** Sortie d'une frame de cinématique (lue par main.ts pour piloter porte/joueur/overlay). */
export interface ThresholdFrame {
  phase: ThresholdPhase;
  doorOpen: number; // 0 fermé .. 1 ouvert
  walk: number; // 0 (dehors) .. 1 (dedans) — avancement de la marche scriptée (ease)
  dip: number; // 0 .. 1 .. 0 — opacité du fondu au noir
  commit: boolean; // VRAI le frame exact du fondu max (charger l'intérieur / émettre ENTER_ROOM)
}

function easeInOut(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

/**
 * Machine d'état PURE de la cinématique de seuil. Avance par `dt` ; aucune dépendance Babylon/DOM
 * -> testable au terminal (cf. spec RF5 : « atteint idle après total et après timeout »).
 */
export class ThresholdCine {
  private phase: ThresholdPhase = "idle";
  private elapsed = 0; // temps écoulé dans la cinématique courante
  private committed = false;
  dir: ThresholdDir = "in";
  site: ThresholdSite = "cave";

  start(dir: ThresholdDir, site: ThresholdSite): void {
    this.phase = "opening";
    this.elapsed = 0;
    this.committed = false;
    this.dir = dir;
    this.site = site;
  }

  get active(): boolean {
    return this.phase !== "idle";
  }

  /** Force la fin (skip après la 1ʳᵉ fois, ou timeout) : commit immédiat puis idle. */
  skip(): boolean {
    const wasCommitted = this.committed;
    this.phase = "idle";
    this.elapsed = 0;
    const fire = !wasCommitted;
    this.committed = true;
    return fire; // VRAI s'il faut encore exécuter le commit (chargement) au skip
  }

  /** Avance d'un pas de temps. Retourne l'état visuel + `commit` (une seule fois, au fondu max). */
  advance(dt: number): ThresholdFrame {
    if (this.phase === "idle") return { phase: "idle", doorOpen: 0, walk: this.dir === "in" ? 1 : 0, dip: 0, commit: false };
    this.elapsed += dt;
    if (this.elapsed >= TIMEOUT) {
      // Sécurité : on n'a jamais bloqué l'input. Commit si pas encore fait, puis idle.
      const fire = !this.committed;
      this.committed = true;
      this.phase = "idle";
      return { phase: "idle", doorOpen: 1, walk: this.dir === "in" ? 1 : 0, dip: 0, commit: fire };
    }
    const e = this.elapsed;
    let phase: ThresholdPhase, doorOpen = 0, walk = 0, dip = 0, commit = false;
    if (e < D_OPEN) {
      phase = "opening";
      doorOpen = e / D_OPEN;
      walk = 0;
    } else if (e < D_OPEN + D_WALK) {
      phase = "walking";
      doorOpen = 1;
      walk = easeInOut((e - D_OPEN) / D_WALK);
    } else if (e < D_OPEN + D_WALK + D_DIP) {
      phase = "dip";
      doorOpen = 1;
      walk = 1;
      const d = (e - D_OPEN - D_WALK) / D_DIP; // 0..1 dans le dip
      dip = 1 - Math.abs(d * 2 - 1); // 0 ->1 ->0 (creux au milieu)
      if (!this.committed && d >= 0.5) { commit = true; this.committed = true; } // fondu max
    } else if (e < D_TOTAL) {
      phase = "settling";
      doorOpen = 1;
      walk = 1;
    } else {
      this.phase = "idle";
      return { phase: "idle", doorOpen: 0, walk: this.dir === "in" ? 1 : 0, dip: 0, commit: !this.committed && (this.committed = true) };
    }
    // En SORTIE, la marche va de dedans (1) vers dehors (0) — on inverse l'avancement.
    if (this.dir === "out") walk = 1 - walk;
    this.phase = phase;
    return { phase, doorOpen, walk, dip, commit };
  }
}

// ----------------------------------------------------------------------------
//  Brique VISUELLE : fondu au noir plein écran (DOM) — masque le chargement au seuil.
// ----------------------------------------------------------------------------

export class DipOverlay {
  private readonly el: HTMLDivElement;
  constructor() {
    this.el = document.createElement("div");
    this.el.style.cssText =
      "position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:50;transition:opacity 60ms linear";
    document.body.appendChild(this.el);
  }
  set(alpha: number): void {
    this.el.style.opacity = String(Math.max(0, Math.min(1, alpha)));
  }
  dispose(): void {
    this.el.remove();
  }
}

// ----------------------------------------------------------------------------
//  Brique VISUELLE : porte de seuil ANIMÉE, par type de site (low-poly, makeKit).
// ----------------------------------------------------------------------------

export class AnimatedDoor {
  private readonly K: Kit;
  private root: TransformNode | null = null;
  private leaves: TransformNode[] = [];
  private site: ThresholdSite = "cave";

  constructor(scene: Scene) {
    this.K = makeKit(scene);
  }

  /** (Re)pose la porte à un seuil (position monde + cap yaw face au franchissement) du type donné. */
  place(site: ThresholdSite, x: number, y: number, z: number, yaw: number): void {
    this.dispose();
    this.site = site;
    const K = this.K;
    const root = K.node(null, [x, y, z]);
    root.rotation.y = yaw;
    this.root = root;
    this.leaves = [];
    if (site === "ship") {
      // CUIRASSÉ : iris/porte coulissante alien, 2 vantaux + halo cyan.
      const frame = K.node(root, [0, 0, 0]);
      K.tor(frame, P.alienAlloy, { d: 4.6, thick: 0.28, t: 12 }, [0, 2.0, 0], { rot: [Math.PI / 2, 0, 0] });
      for (const sgn of [-1, 1]) {
        const leaf = K.node(frame, [sgn * 0.0, 2.0, 0]);
        K.box(leaf, [0.16, 0.18, 0.22], [2.0, 3.4, 0.28], [sgn * 1.0, 0, 0]);
        K.box(leaf, P.alienGlow, [2.0, 0.1, 0.1], [sgn * 1.0, 0, 0.16], { emi: 1.4, unlit: true });
        this.leaves.push(leaf);
      }
    } else if (site === "mine") {
      // MINE : portillon de bois battant (2 vantaux sur charnières).
      for (const sgn of [-1, 1]) {
        const hinge = K.node(root, [sgn * 1.4, 0, 0]);
        const leaf = K.node(hinge, [0, 0, 0]);
        K.box(leaf, P.woodDark, [1.3, 2.6, 0.18], [sgn * 0.65, 1.4, 0]);
        K.box(leaf, P.woodLight, [1.3, 0.18, 0.12], [sgn * 0.65, 2.2, 0.1]);
        this.leaves.push(hinge);
      }
    } else {
      // GROTTE : herse de rondins / rideau écarté (2 battants de bois clair).
      for (const sgn of [-1, 1]) {
        const hinge = K.node(root, [sgn * 1.3, 0, 0]);
        for (let i = 0; i < 3; i++) K.cyl(hinge, [0.3, 0.26, 0.18], { h: 2.6, d: 0.2, t: 6 }, [sgn * (0.4 + i * 0.4), 1.3, 0]);
        this.leaves.push(hinge);
      }
    }
    root.setEnabled(false);
  }

  setEnabled(on: boolean): void {
    this.root?.setEnabled(on);
  }

  /** Anime l'ouverture (0 fermé .. 1 ouvert) selon le type (coulissant / battant). */
  setOpen(t: number): void {
    if (!this.root) return;
    for (let i = 0; i < this.leaves.length; i++) {
      const leaf = this.leaves[i], sgn = i === 0 ? -1 : 1;
      if (this.site === "ship") leaf.position.x = sgn * 2.0 * t; // coulisse latéralement
      else leaf.rotation.y = sgn * (Math.PI * 0.62) * t; // battant qui s'ouvre vers l'extérieur
    }
  }

  dispose(): void {
    this.root?.dispose();
    this.root = null;
    this.leaves = [];
  }
}
