// ============================================================================
//  DÉCOLLAGE (M11/E3b) — mise en scène CINÉMATIQUE du climax (purement visuel ;
//  la règle vit dans la sim, cf. sim/flight.ts). Quand un vol est actif, on bascule
//  en « espace » : ciel sombre étoilé, caméra cinématique sur le vaisseau qui s'élève,
//  champ de débris qui FOND vers lui (les joueurs les abattent via FLIGHT_FIRE), et
//  secousse à chaque impact sur la coque. Interpolé depuis l'état partagé (host).
// ============================================================================

import { ArcRotateCamera, Color4, Mesh, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { makeKit, P, type Kit } from "./lowpoly";
import { terrainHeight, config, FLIGHT } from "../../data/world";

const HZ = config.simTickHz;
const IMPACT_TICKS = Math.max(1, Math.round(FLIGHT.impactLeadSeconds * HZ));
const RISE = 60;        // hauteur d'ascension visuelle (u)
const AST_HEIGHT = 22;  // hauteur d'apparition des débris au-dessus du vaisseau
const AST_SPREAD = 7;   // étalement horizontal des débris (resserre en fondant vers le vaisseau)

/** Sous-ensemble de `SharedFlight` nécessaire au rendu (découplage sim/render). */
export interface FlightView {
  status: string;
  x: number;
  z: number;
  hull: number;
  hullMax: number;
  progress: number;
  asteroids: Array<{ id: number; impactAt: number }>;
}

export class Liftoff {
  private readonly K: Kit;
  private root: TransformNode | null = null;
  private ship: TransformNode | null = null;
  private flame: Mesh | null = null;
  private readonly rocks = new Map<number, TransformNode>();
  private active = false;
  private baseY = 0;
  private prevHull = 0;
  private shake = 0;
  private escapeT = 0; // temps écoulé depuis l'évasion (le vaisseau s'éloigne dans les étoiles)
  private saved: { clear: Color4; fogMode: number } | null = null;

  constructor(private readonly scene: Scene, private readonly camera: ArcRotateCamera) {
    this.K = makeKit(scene);
  }

  /** Le décollage prend-il la main (caméra/scène) ? main neutralise alors mouvement + caméra normale. */
  get isActive(): boolean {
    return this.active;
  }

  /** À appeler chaque frame avec l'état de vol (ou null hors décollage). `escaped` reste à l'écran
   *  (le vaisseau s'éloigne dans les étoiles) tant que l'écran de fin est ouvert ; `crashed`/null sortent. */
  update(dtSec: number, flight: FlightView | null, tick: number): void {
    const on = !!flight && (flight.status === "boarding" || flight.status === "ascending" || flight.status === "escaped");
    if (on && !this.active) this.enter(flight!);
    if (!on && this.active) this.exit();
    if (on && this.active) this.drive(dtSec, flight!, tick);
  }

  // --------------------------------------------------------------------------

  private enter(flight: FlightView): void {
    this.active = true;
    this.baseY = terrainHeight(flight.x, flight.z);
    this.prevHull = flight.hull;
    this.shake = 0;
    this.escapeT = 0;
    // Bascule « espace » : ciel sombre, plus de brouillard (on sauvegarde pour restaurer).
    this.saved = { clear: this.scene.clearColor.clone(), fogMode: this.scene.fogMode };
    this.scene.clearColor = new Color4(0.02, 0.03, 0.06, 1);
    this.scene.fogMode = Scene.FOGMODE_NONE;
    const root = new TransformNode("liftoff", this.scene);
    root.position.set(flight.x, this.baseY, flight.z);
    this.root = root;
    this.buildStars(root);
    this.ship = this.buildRocket(root);
    this.camera.lowerRadiusLimit = 1;
    this.camera.upperRadiusLimit = 400; // libère le zoom pour la cinématique
  }

  private exit(): void {
    this.active = false;
    if (this.root) { this.root.dispose(false); this.root = null; }
    this.ship = null; this.flame = null; this.rocks.clear();
    if (this.saved) { this.scene.clearColor = this.saved.clear; this.scene.fogMode = this.saved.fogMode; this.saved = null; }
  }

  private drive(dtSec: number, flight: FlightView, tick: number): void {
    const ship = this.ship!;
    // Évasion : le vaisseau accélère vers le haut et rapetisse (il file dans les étoiles).
    if (flight.status === "escaped") {
      this.escapeT += dtSec;
      const riseY = 1 + RISE + this.escapeT * this.escapeT * 14;
      ship.position.set(0, riseY, 0);
      ship.rotation.y += dtSec * 0.6;
      const shrink = Math.max(0.15, 1 - this.escapeT * 0.25);
      ship.scaling.setAll(shrink);
      if (this.flame) { const f = 1.1 + Math.sin(performance.now() * 0.04) * 0.3; this.flame.scaling.set(f, 1.4 + f, f); }
      const shipWorldY = this.baseY + Math.min(riseY, RISE + 30); // la caméra ne suit pas jusqu'à l'infini
      this.camera.setTarget(new Vector3(flight.x, shipWorldY + 6, flight.z));
      this.camera.setPosition(new Vector3(flight.x + 6, shipWorldY - 8, flight.z + 14));
      this.syncRocks(flight, tick, riseY); // (vide à l'évasion)
      return;
    }
    const riseY = 1 + flight.progress * RISE; // hauteur LOCALE (root est au sol du vaisseau)
    // Secousse à l'impact (la coque vient d'encaisser).
    if (flight.hull < this.prevHull) this.shake = 0.6;
    this.prevHull = flight.hull;
    this.shake = Math.max(0, this.shake - dtSec * 2);
    const sx = Math.sin(tick * 1.7) * this.shake;
    const sz = Math.cos(tick * 2.3) * this.shake;
    ship.position.set(sx, riseY, sz);
    ship.rotation.y += dtSec * 0.25;
    // Flamme du propulseur : flicker.
    if (this.flame) { const f = 0.7 + Math.sin(performance.now() * 0.03) * 0.3; this.flame.scaling.set(f, 0.8 + f, f); }
    // Débris : fondent vers le vaisseau à mesure que l'impact approche.
    this.syncRocks(flight, tick, riseY);
    // Caméra cinématique : en retrait/dessous, regard porté vers le haut sur le vaisseau qui monte.
    const shipWorldY = this.baseY + riseY;
    this.camera.setTarget(new Vector3(flight.x, shipWorldY + 3, flight.z));
    this.camera.setPosition(new Vector3(flight.x + 9, shipWorldY - 3.5, flight.z + 12));
  }

  private syncRocks(flight: FlightView, tick: number, riseY: number): void {
    const live = new Set(flight.asteroids.map((a) => a.id));
    for (const [id, node] of this.rocks) if (!live.has(id)) { node.dispose(false); this.rocks.delete(id); }
    for (const a of flight.asteroids) {
      let node = this.rocks.get(a.id);
      if (!node) { node = this.buildRock(a.id); this.rocks.set(a.id, node); }
      const f = Math.max(0, Math.min(1, (a.impactAt - tick) / IMPACT_TICKS)); // 1 = loin/haut, 0 = sur le vaisseau
      const ang = a.id * 2.39996; // angle d'or -> dispersion régulière
      node.position.set(Math.cos(ang) * AST_SPREAD * f, riseY + 2 + f * AST_HEIGHT, Math.sin(ang) * AST_SPREAD * f);
      node.rotation.x += 0.05; node.rotation.z += 0.04;
    }
  }

  private buildRocket(root: TransformNode): TransformNode {
    const K = this.K;
    const s = K.node(root, [0, 0, 0]);
    K.cyl(s, P.metal, { h: 2.2, d: 0.9, t: 12 }, [0, 0, 0]);                       // corps
    K.cone(s, P.metalDark, { h: 1.1, d: 0.92, t: 12 }, [0, 1.65, 0]);             // nez
    K.cyl(s, [0.3, 0.8, 0.95], { h: 0.22, d: 0.96, t: 12 }, [0, 0.5, 0], { emi: 0.9 }); // bandeau alien (glow)
    for (const angle of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {              // ailerons
      K.box(s, P.metalDark, [0.12, 0.85, 0.5], [Math.cos(angle) * 0.5, -0.8, Math.sin(angle) * 0.5], { rot: [0, -angle, 0] });
    }
    this.flame = K.cone(s, [1, 0.6, 0.2], { h: 1.5, d: 0.7, t: 10 }, [0, -1.6, 0], { emi: 1, unlit: true, rot: [Math.PI, 0, 0] });
    return s;
  }

  private buildRock(id: number): TransformNode {
    return this.K.ico(this.root, P.coalRock ?? [0.3, 0.3, 0.33], { d: 1.0 + (id % 3) * 0.45, sub: 1 }, [0, 0, 0]);
  }

  private buildStars(root: TransformNode): void {
    const K = this.K;
    // Dôme d'étoiles (émissives, non éclairées) autour de la scène — assez grand pour rester
    // tout autour de la caméra pendant l'ascension. Dispersion cosmétique (RNG local OK, hors sim).
    for (let i = 0; i < 120; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * Math.PI * 0.5; // hémisphère supérieur
      const r = 170;
      const x = Math.cos(a) * Math.cos(el) * r;
      const y = Math.sin(el) * r + 15;
      const z = Math.sin(a) * Math.cos(el) * r;
      K.ico(root, [0.85, 0.88, 1], { d: 0.5 + Math.random() * 0.8, sub: 0 }, [x, y, z], { emi: 1, unlit: true });
    }
  }
}
