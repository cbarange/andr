// ============================================================================
//  DÉCOLLAGE (M11/E3b → RF8b) — mise en scène du climax « extraction » (purement visuel ;
//  la règle vit dans la sim, cf. sim/flight.ts). Quand un vol est actif, on bascule en « espace » :
//  ciel sombre étoilé + CAMÉRA DE POURSUITE derrière le vaisseau. RF8 : le vaisseau n'est plus passif —
//  on le PILOTE dans le plan transversal (X = g/d, Y = h/b) pour ESQUIVER les astéroïdes qui foncent
//  vers nous (+Z -> 0) ; secousse + flash à chaque coque encaissée. Le vaisseau s'incline (roll/pitch)
//  dans le sens du pilotage. Interpolé depuis l'état partagé (host) : shipX/shipY + voies x/y des débris.
// ============================================================================

import { ArcRotateCamera, Color3, Color4, Mesh, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { makeKit, P, type Kit } from "./lowpoly";
import { terrainHeight, config, FLIGHT } from "../../data/world";

const HZ = config.simTickHz;
const IMPACT_TICKS = Math.max(1, Math.round(FLIGHT.impactLeadSeconds * HZ));
// Le vaisseau MONTE (+Y, vrai décollage) ; la caméra est EN DESSOUS et regarde VERS LE HAUT -> le sol
// sort du cadre, on ne voit que le vaisseau, les débris qui pleuvent et les étoiles. Le pilotage se fait
// dans le plan transversal : sim shipX -> monde X (gauche/droite à l'écran), sim shipY -> monde Z (haut/bas).
const CRUISE_Y = 30;     // altitude locale du vaisseau (root est au sol du pas de tir)
const FALL = 78;         // hauteur d'apparition des débris AU-DESSUS du vaisseau (ils tombent vers lui)
const CAM_BELOW = 11;    // la caméra est sous le vaisseau...
const CAM_BACK = 15;     // ...et un peu en retrait (−Z) pour le cadrer de trois-quarts
const FOLLOW = 0.4;      // suivi partiel -> le vaisseau dérive vers les bords (le pilotage se sent)
const LOOK_UP = 5;       // regard porté un peu au-dessus du vaisseau -> contre-plongée (sol hors-champ, vaisseau ~centré)
const BANK_K = 0.05;     // roll par u/s de vitesse latérale (inclinaison dans le virage)
const PITCH_K = 0.04;    // pitch par u/s de vitesse en profondeur (nez relevé/piqué)

/** Sous-ensemble de `SharedFlight` nécessaire au rendu (découplage sim/render). */
export interface FlightView {
  status: string;
  x: number;
  z: number;
  hull: number;
  hullMax: number;
  progress: number;
  shipX: number;
  shipY: number;
  asteroids: Array<{ id: number; x: number; y: number; impactAt: number }>;
}

export class Liftoff {
  private readonly K: Kit;
  private root: TransformNode | null = null;
  private ship: TransformNode | null = null; // node piloté (translation + bank/pitch)
  private flame: Mesh | null = null;
  private readonly rocks = new Map<number, TransformNode>();
  private active = false;
  private baseY = 0;
  private prevHull = 0;
  private shake = 0;
  private flash = 0;            // flash rouge bref à l'impact
  private flashMat: StandardMaterial | null = null;
  private bandBase = new Color3(0, 0, 0); // émissif de repos du bandeau (le flash s'y ajoute)
  private dispX = 0;            // position latérale LISSÉE (interpolée depuis shipX)
  private dispY = 0;            // position verticale lissée (depuis shipY)
  private velX = 0;             // vitesses lissées -> inclinaison
  private velY = 0;
  private escapeT = 0;
  private saved: { clear: Color4; fogMode: number } | null = null;

  constructor(private readonly scene: Scene, private readonly camera: ArcRotateCamera) {
    this.K = makeKit(scene);
  }

  /** Le décollage prend-il la main (caméra/scène) ? main neutralise alors mouvement + caméra normale. */
  get isActive(): boolean {
    return this.active;
  }

  /** À appeler chaque frame avec l'état de vol (ou null hors décollage). `escaped` reste à l'écran
   *  (le vaisseau file dans les étoiles) tant que l'écran de fin est ouvert ; `crashed`/null sortent. */
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
    this.shake = 0; this.flash = 0; this.escapeT = 0;
    this.dispX = flight.shipX; this.dispY = flight.shipY; this.velX = 0; this.velY = 0;
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
    this.ship = null; this.flame = null; this.flashMat = null; this.rocks.clear();
    if (this.saved) { this.scene.clearColor = this.saved.clear; this.scene.fogMode = this.saved.fogMode; this.saved = null; }
  }

  private drive(dtSec: number, flight: FlightView, tick: number): void {
    const ship = this.ship!;
    const rootP = this.root!.position;

    // ÉVASION : le vaisseau monte EN TROMBE (+Y) et rapetisse ; la caméra le laisse filer dans les étoiles.
    if (flight.status === "escaped") {
      this.escapeT += dtSec;
      const yf = CRUISE_Y + this.escapeT * this.escapeT * 26;
      ship.position.set(this.dispX, yf, this.dispY);
      ship.rotation.set(0, ship.rotation.y + dtSec * 0.7, 0);
      const shrink = Math.max(0.12, 1 - this.escapeT * 0.2);
      ship.scaling.setAll(shrink);
      if (this.flame) { const f = 1.3 + Math.sin(this.escapeT * 30) * 0.3; this.flame.scaling.set(f, 1.5 + f, f); }
      const camY = rootP.y + Math.min(yf, CRUISE_Y + 24); // la caméra ne suit pas jusqu'à l'infini
      this.camera.setTarget(new Vector3(rootP.x + this.dispX, camY + LOOK_UP, rootP.z + this.dispY));
      this.camera.setPosition(new Vector3(rootP.x + this.dispX * FOLLOW, camY - CAM_BELOW, rootP.z + this.dispY * FOLLOW - CAM_BACK));
      this.syncRocks(flight, tick);
      return;
    }

    // --- ascending (ou boarding : le vaisseau attend, centré) ---
    // Lissage de la position pilotée (le snapshot host arrive à 2 Hz ; on interpole pour la fluidité).
    const k = Math.min(1, dtSec * 12);
    const nx = this.dispX + (flight.shipX - this.dispX) * k;
    const ny = this.dispY + (flight.shipY - this.dispY) * k;
    this.velX = dtSec > 0 ? (nx - this.dispX) / dtSec : 0;
    this.velY = dtSec > 0 ? (ny - this.dispY) / dtSec : 0;
    this.dispX = nx; this.dispY = ny;

    // Secousse + flash à l'impact (la coque vient d'encaisser).
    if (flight.hull < this.prevHull) { this.shake = 0.6; this.flash = 1; }
    this.prevHull = flight.hull;
    this.shake = Math.max(0, this.shake - dtSec * 2);
    this.flash = Math.max(0, this.flash - dtSec * 2.5);
    if (this.flashMat) this.flashMat.emissiveColor = new Color3(this.bandBase.r + 0.9 * this.flash, this.bandBase.g + 0.12 * this.flash, this.bandBase.b + 0.12 * this.flash);
    const sx = Math.sin(tick * 1.7) * this.shake;
    const sz = Math.cos(tick * 2.3) * this.shake;

    // Position (plan transversal X/Z) + INCLINAISON : roll dans le sens du virage latéral (X),
    // pitch selon le déplacement en profondeur (Z). Nez vers +Y (déjà construit ainsi).
    ship.position.set(this.dispX + sx, CRUISE_Y, this.dispY + sz);
    const bank = Math.max(-0.7, Math.min(0.7, -this.velX * BANK_K));
    const pitch = Math.max(-0.5, Math.min(0.5, this.velY * PITCH_K));
    ship.rotation.set(pitch, 0, bank);
    if (this.flame) { const f = 0.7 + Math.sin(tick * 0.6) * 0.3; this.flame.scaling.set(f, 0.8 + f, f); }

    this.syncRocks(flight, tick);

    // Caméra : EN DESSOUS et en léger retrait, regard porté BIEN AU-DESSUS du vaisseau (contre-plongée)
    // -> le sol sort du cadre, on voit le vaisseau, la pluie de débris et les étoiles. Suivi partiel.
    const fx = rootP.x + this.dispX * FOLLOW;
    const fz = rootP.z + this.dispY * FOLLOW;
    this.camera.setTarget(new Vector3(fx, rootP.y + CRUISE_Y + LOOK_UP, fz + 2));
    this.camera.setPosition(new Vector3(fx, rootP.y + CRUISE_Y - CAM_BELOW, fz - CAM_BACK));
  }

  private syncRocks(flight: FlightView, tick: number): void {
    const live = new Set(flight.asteroids.map((a) => a.id));
    for (const [id, node] of this.rocks) if (!live.has(id)) { node.dispose(false); this.rocks.delete(id); }
    for (const a of flight.asteroids) {
      let node = this.rocks.get(a.id);
      if (!node) { node = this.buildRock(a.id); this.rocks.set(a.id, node); }
      const f = Math.max(0, Math.min(1, (a.impactAt - tick) / IMPACT_TICKS)); // 1 = loin au-dessus, 0 = sur le plan du vaisseau
      // Les débris PLEUVENT depuis la VOIE (a.x, a.y) tout en haut et tombent vers le plan du vaisseau
      // (où il doit s'être écarté). a.x -> monde X, a.y -> monde Z.
      node.position.set(a.x, CRUISE_Y + f * FALL, a.y);
      const grow = 1 - f * 0.5; // grossissent en approchant
      node.scaling.setAll(grow);
      node.rotation.x += 0.06; node.rotation.z += 0.05;
    }
  }

  private buildRocket(root: TransformNode): TransformNode {
    const K = this.K;
    const s = K.node(root, [0, 0, 0]);
    K.cyl(s, P.metal, { h: 2.2, d: 0.9, t: 12 }, [0, 0, 0]);                       // corps
    K.cone(s, P.metalDark, { h: 1.1, d: 0.92, t: 12 }, [0, 1.65, 0]);             // nez
    const band = K.cyl(s, [0.3, 0.8, 0.95], { h: 0.22, d: 0.96, t: 12 }, [0, 0.5, 0], { emi: 0.9 }); // bandeau alien (glow)
    const bandMat = (band.material as StandardMaterial).clone("flashBand")!; // matériau DÉDIÉ (le kit met en cache) -> flash isolé
    band.material = bandMat;
    this.flashMat = bandMat; // réutilisé pour le flash rouge d'impact
    this.bandBase = bandMat.emissiveColor.clone();
    for (const angle of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {              // ailerons
      K.box(s, P.metalDark, [0.12, 0.85, 0.5], [Math.cos(angle) * 0.5, -0.8, Math.sin(angle) * 0.5], { rot: [0, -angle, 0] });
    }
    this.flame = K.cone(s, [1, 0.6, 0.2], { h: 1.5, d: 0.7, t: 10 }, [0, -1.6, 0], { emi: 1, unlit: true, rot: [Math.PI, 0, 0] });
    return s; // nez vers +Y (sens de la montée) ; bank (roll Z) / pitch (X) ajoutés chaque frame
  }

  private buildRock(id: number): TransformNode {
    return this.K.ico(this.root!, P.coalRock ?? [0.3, 0.3, 0.33], { d: 1.0 + (id % 3) * 0.45, sub: 1 }, [0, 0, 0]);
  }

  private buildStars(root: TransformNode): void {
    const K = this.K;
    // Dôme d'étoiles (émissives, non éclairées) autour de la scène — assez grand pour entourer la caméra
    // pendant tout le gantelet. Dispersion cosmétique (RNG local OK, hors sim).
    for (let i = 0; i < 140; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = (Math.random() - 0.25) * Math.PI * 0.7; // surtout au-dessus, un peu en dessous
      const r = 170;
      const x = Math.cos(a) * Math.cos(el) * r;
      const y = Math.sin(el) * r + 20;
      const z = Math.sin(a) * Math.cos(el) * r;
      K.ico(root, [0.85, 0.88, 1], { d: 0.5 + Math.random() * 0.8, sub: 0 }, [x, y, z], { emi: 1, unlit: true });
    }
  }
}
