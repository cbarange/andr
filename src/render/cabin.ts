// ============================================================================
//  LA CABANE — « la pièce » d'A Dark Room, spatialisée, en 4 ÉTATS (paliers).
//  ruine (0) -> réparée ×1 (1) -> améliorée ×5 (5) -> entrepôt ×10 (10).
//  EMPRISE AU SOL INCHANGÉE entre paliers : on MONTE le toit et on enrichit le
//  décor, on n'élargit pas. Modèle porté du labo (lab/model-lab.html -> buildCabin).
//
//  Stockage : 1 PETIT COFFRE par ressource découverte, posé sur des ÉTAGÈRES, avec
//  un panneau de quantité (DynamicTexture). Révélation progressive (signature ADR).
//  + coffre de DÉPÔT à l'entrée, grand TABLEAU d'organisation (DynamicTexture),
//  coin OUTILS/plans de la constructrice. Le tout (les « fittings ») est partagé
//  par tous les paliers réparés ; seuls la coque (murs/toit) et le décor changent.
// ============================================================================

import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode,
  DynamicTexture,
  PhysicsAggregate,
  PhysicsShapeType,
  type AbstractMesh,
} from "@babylonjs/core";
import { terrainHeight, RESOURCE_LABELS, campLayout, storageCap } from "../../data/world";
import { makeKit, P, type Kit } from "./lowpoly";

const CX = campLayout.cabin.x;
const CZ = campLayout.cabin.z;
const GY = terrainHeight(CX, CZ);
// Orientation de la cabane (rad ; 0 = façade vers +Z). Pilotée par l'éditeur de spawn (F2).
const RY = campLayout.cabin.face ?? 0;
const COSR = Math.cos(RY);
const SINR = Math.sin(RY);
// (lx,lz) LOCAL de la cabane -> point MONDE (rotation RY autour du centre, puis translation).
// Garantit que les ancres (coffre, tableau, constructrice) suivent la cabane quand on l'oriente.
function vAt(lx: number, lz: number): Vector3 {
  return new Vector3(CX + lx * COSR + lz * SINR, GY, CZ - lx * SINR + lz * COSR);
}

// Dimensions du modèle (labo). Repère local : origine au centre, base de fondation à y=0,
// façade/entrée en +Z (regarde le feu au sud). Identique à `buildCabin` du labo.
const W = 4.6, D = 4.0, FND = 0.26, POST_H = 2.3;
const BASE_Y = FND + 0.1; // dessus du plancher
const TOP_Y = BASE_Y + POST_H; // niveau des sablières (haut des murs)
const FLOOR_TOP = BASE_Y + 0.055; // y local de la SURFACE du plancher (dessus des planches)
// La cabane est LÉGÈREMENT ENFONCÉE dans le sol : ainsi le plancher (collider) n'est qu'à un
// petit ressaut au-dessus du terrain (FLOOR_TOP - SINK ≈ 0.2), FRANCHISSABLE par la capsule du
// joueur (rayon 0.34) à l'entrée — sinon un rebord de ~0.4 bloquerait le passage de la porte.
const SINK = 0.22;
const ROOT_Y = GY - SINK; // y monde de l'origine du modèle (base de fondation)

const TIERS = [0, 1, 5, 10] as const;

export class Cabin {
  readonly center = new Vector3(CX, GY, CZ); // pivot d'orientation (invariant)
  readonly chestPosition = vAt(1.65, 1.4); // coffre de dépôt (avant-droit) — suit l'orientation
  readonly boardPosition = vAt(-1.4, -0.4); // devant le tableau (mur gauche)
  readonly builderHome = vAt(-1.45, 0.9); // coin outils/plans de la constructrice
  readonly footprintRadius = 3.2; // évitement des villageois (emprise ~4.6×4.0 + apron)

  private tier = 0;
  private hidden = false;
  private readonly scene: Scene;
  private readonly K: Kit;

  // Coques par palier (construites paresseusement, une seule activée à la fois).
  private readonly shells = new Map<number, TransformNode>();
  // Aménagements intérieurs partagés (coffres + tableau + dépôt + outils) — pilotés par la sim.
  private readonly fittings: TransformNode;
  private colliders: Mesh[] = []; // colliders du palier courant (reconstruits à chaque changement)
  private collidersTier = -1; // palier pour lequel les colliders ont été bâtis

  // Tableau d'organisation (DynamicTexture).
  private board?: DynamicTexture;
  private boardSig = "";

  // Étagères : un coffre + un panneau de quantité par ressource découverte (slot 2D fixe).
  private readonly shelfOrder = ["wood", "fur", "meat", "bait", "cured meat", "leather", "scales", "teeth", "cloth", "charm", "iron", "coal", "sulphur", "steel", "bullets"];
  private readonly shelves = new Map<string, { tex: DynamicTexture; lastQty: number; lastFull: boolean }>();
  private shelfCount = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    this.K = makeKit(scene);
    this.fittings = this.buildFittings();
    this.fittings.setEnabled(false);
    this.setTier(0); // état de départ : la ruine, visible d'emblée
  }

  get isRepaired(): boolean {
    return this.tier >= 1;
  }

  /** Palier courant (0/1/5/10). */
  get cabinTier(): number {
    return this.tier;
  }

  /** Compat : ancien booléen -> palier 1 (réparée ×1) / 0 (ruine). */
  setRepaired(value: boolean): void {
    this.setTier(value ? 1 : 0);
  }

  /** Fixe le palier affiché. Construit la coque à la volée, bascule l'affichage, active les fittings. */
  setTier(tier: number): void {
    const t = TIERS.includes(tier as (typeof TIERS)[number]) ? tier : tier >= 10 ? 10 : tier >= 5 ? 5 : tier >= 1 ? 1 : 0;
    if (t === this.tier && this.shells.has(t)) return; // déjà à jour (setTier est appelé chaque frame)
    this.tier = t;
    for (const [k, node] of this.shells) node.setEnabled(!this.hidden && k === t);
    if (!this.shells.has(t)) {
      const node = this.buildShell(t);
      node.setEnabled(!this.hidden);
      this.shells.set(t, node);
    } else {
      this.shells.get(t)!.setEnabled(!this.hidden);
    }
    this.fittings.setEnabled(!this.hidden && t >= 1);
    if (t !== this.collidersTier) { this.rebuildColliders(t); this.collidersTier = t; }
  }

  /** Masque/affiche la cabane (éditeur de spawn). À l'affichage, respecte le palier courant. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const [k, node] of this.shells) node.setEnabled(!hidden && k === this.tier);
    this.fittings.setEnabled(!hidden && this.tier >= 1);
  }

  /** Meshes de la COQUE courante (murs/toit) — occulteurs pour la collision caméra (spring-arm). */
  occluders(): AbstractMesh[] {
    return this.shells.get(this.tier)?.getChildMeshes(false) ?? [];
  }

  // ---- Stockage (coffres) : révélation progressive + quantités ----

  setStorage(stored: Record<string, number>): void {
    if (this.tier < 1) return;
    const ids = [...this.shelfOrder, ...Object.keys(stored).filter((id) => !this.shelfOrder.includes(id))];
    for (const id of ids) {
      const qty = Math.floor(stored[id] ?? 0);
      if (qty <= 0 && !this.shelves.has(id)) continue; // pas encore découverte -> invisible
      if (!this.shelves.has(id)) this.createChest(id);
      const shelf = this.shelves.get(id)!;
      // « plein » = au plafond de l'entrepôt pour le palier courant (cf. storageCap) : le compteur
      //  vire au rouge pour signaler que tout surplus (dépôt, revenu…) y est désormais perdu.
      const full = qty >= storageCap(this.tier, id);
      if (shelf.lastQty !== qty || shelf.lastFull !== full) {
        this.drawCounter(shelf.tex, RESOURCE_LABELS[id] ?? id, qty, full);
        shelf.lastQty = qty;
        shelf.lastFull = full;
      }
    }
  }

  setOrganisation(population: number, maxPop: number, rows: Array<{ name: string; count: number }>): void {
    if (!this.board) return;
    const sig = `${population}/${maxPop}|${rows.map((r) => `${r.name}:${r.count}`).join(",")}`;
    if (sig === this.boardSig) return;
    this.boardSig = sig;
    this.drawBoard(population, maxPop, rows);
  }

  // ========================================================================
  //  COQUE par palier (structure + toit + décor). Aménagements à part (fittings).
  // ========================================================================

  private buildShell(tier: number): TransformNode {
    if (tier === 0) return this.buildRuin();
    const K = this.K;
    const ev = tier >= 5; // améliorée
    const ev2 = tier >= 10; // entrepôt
    const root = K.node(null);
    root.position.copyFromFloats(CX, ROOT_Y, CZ);
    root.rotation.y = RY; // orientation de la cabane (éditeur de spawn)
    const wood = P.woodDark, woodL = P.woodLight;

    // fondation pierre + assise + plancher
    K.box(root, P.stoneDark, [W + 0.4, FND, D + 0.4], [0, FND / 2, 0]);
    K.box(root, P.stone, [W + 0.4, 0.1, D + 0.4], [0, FND + 0.05, 0]);
    for (let i = 0; i < Math.round(W / 0.7); i++) K.box(root, i % 2 ? P.wood : wood, [0.6, 0.05, D], [-W / 2 + 0.35 + i * 0.7, BASE_Y + 0.03, 0]);
    if (ev2) K.box(root, [0.4, 0.33, 0.24], [W - 1.6, 0.04, D - 1.6], [0.1, BASE_Y + 0.06, 0.25]); // tapis tressé

    // ossature : poteaux d'angle + poteau milieu arrière + sablières (+ chapeaux à l'évolution)
    for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) K.box(root, wood, [0.16, POST_H, 0.16], [x, BASE_Y + POST_H / 2, z]);
    K.box(root, wood, [0.16, POST_H, 0.16], [0, BASE_Y + POST_H / 2, -D / 2]);
    for (const z of [-D / 2, D / 2]) K.box(root, woodL, [W + 0.22, 0.14, 0.16], [0, TOP_Y, z]);
    for (const x of [-W / 2, W / 2]) K.box(root, woodL, [0.16, 0.14, D], [x, TOP_Y, 0]);
    if (ev) for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) K.box(root, woodL, [0.24, 0.1, 0.24], [x, TOP_Y + 0.07, z]);

    // MURS — réparée : arrière plein + gauche partiel ; évolution : plus fermé (gauche plein, droite
    // partielle arrière, pans avant pleine hauteur) tout en gardant 2 entrées (centrale + côté avant droit).
    this.logWall(root, 0, -D / 2, 0, W + 0.1, POST_H - 0.2);
    const fs = (W - 2.2) / 2;
    if (ev) {
      this.logWall(root, -W / 2, 0, Math.PI / 2, D, POST_H - 0.4);
      this.logWall(root, W / 2, -D * 0.26, Math.PI / 2, D * 0.48, POST_H - 0.4);
      this.logWall(root, -(1.1 + fs / 2), D / 2, 0, fs, POST_H - 0.4);
      this.logWall(root, 1.1 + fs / 2, D / 2, 0, fs, POST_H - 0.4);
    } else {
      this.logWall(root, -W / 2, -D * 0.18, Math.PI / 2, D * 0.5, POST_H - 0.4);
      this.logWall(root, -(1.1 + fs / 2), D / 2, 0, fs, 1.25);
      this.logWall(root, 1.1 + fs / 2, D / 2, 0, fs, 1.25);
    }

    // ENSEIGNE suspendue à la sablière avant (nom du village) ; cadre sculpté à l'évolution.
    const signY = BASE_Y + 1.6, sTop = signY + 0.2, sblY = TOP_Y - 0.08;
    K.box(root, woodL, [1.5, 0.4, 0.08], [0, signY, D / 2 + 0.04]);
    K.box(root, [0.85, 0.86, 0.78], [1.3, 0.26, 0.03], [0, signY, D / 2 + 0.085], { emi: 0.25, unlit: true });
    for (const sx of [-0.55, 0.55]) K.cyl(root, P.woodDark, { h: sblY - sTop, d: 0.04, t: 5 }, [sx, (sTop + sblY) / 2, D / 2 + 0.02]);
    if (ev) for (const sx of [-0.62, 0.62]) K.box(root, P.woodDark, [0.05, 0.5, 0.1], [sx, signY, D / 2 + 0.06]);

    // TOIT — réparée : peau tendue (sablières) ; évolution : deux pentes en dur (planches/bardeaux),
    // qui MONTE en hauteur sans agrandir l'emprise. ev2 -> bardeaux + faîtière couverte + épi + pignons fermés.
    if (ev) this.gableRoof(root, TOP_Y, 0.95, ev2, ev2);
    else this.hideRoof(root, -D / 2, 0, TOP_Y, TOP_Y - 0.04);

    // RANGEMENT VERTICAL / VRAC (capacité ×5 / ×10) — sans s'étaler au sol.
    if (ev) {
      this.loft(root, -1.45, 2.44, ev2);
      this.woodpile(root, -1.65, -1.5, 0.85, ev2 ? 6 : 4);
      // la cabane « vit » : établi de plans + lanterne d'entrée + bottes suspendues
      K.box(root, P.wood, [0.92, 0.08, 0.5], [-1.55, BASE_Y + 0.78, D / 2 - 0.95]);
      for (const lx of [-1.92, -1.18]) K.cyl(root, wood, { h: 0.74, d: 0.07, t: 6 }, [lx, BASE_Y + 0.39, D / 2 - 0.95]);
      K.cyl(root, woodL, { h: 0.34, d: 0.05, t: 6 }, [-1.5, BASE_Y + 0.86, D / 2 - 0.95], { rot: [0, 0, 1.4] });
      this.lantern(root, 0.85, 2.07, 1.95);
      this.hang(root, -1.55, TOP_Y, 1.92);
      this.hang(root, 1.5, TOP_Y, 1.92);
    }
    if (ev2) {
      this.lantern(root, -0.85, 2.07, 1.95);
      this.lantern(root, -2.2, 2.07, 0.7);
      K.box(root, P.fur, [0.85, 1.0, 0.05], [-W / 2 + 0.14, BASE_Y + 1.05, 1.15], { rot: [0, Math.PI / 2, 0] }); // peau déco
      const cg = K.node(root, [0.4, TOP_Y - 0.22, -D / 2 + 0.16]); // guirlande de charmes (mur arrière)
      for (let i = 0; i < 6; i++) {
        K.cyl(cg, P.hide, { h: 0.12, d: 0.012, t: 4 }, [-0.6 + i * 0.24, -0.06, 0]);
        K.cone(cg, P.bone, { h: 0.13, d: 0.05, t: 5 }, [-0.6 + i * 0.24, -0.19, 0], { rot: [Math.PI, 0, 0] });
      }
    }
    return root;
  }

  private buildRuin(): TransformNode {
    const K = this.K;
    const root = K.node(null);
    root.position.copyFromFloats(CX, ROOT_Y, CZ);
    root.rotation.y = RY; // orientation de la cabane (éditeur de spawn)
    const logA = [0.26, 0.19, 0.13], logB = P.wood, wood = P.woodDark;
    K.box(root, P.stoneDark, [W, FND, D], [0, FND / 2, 0]);
    K.box(root, [0.16, 0.14, 0.11], [W - 0.3, 0.1, D - 0.3], [0, FND + 0.05, 0]);
    this.logWall(root, -0.3, -D / 2, 0, W * 0.6, 1.35);
    this.logWall(root, -W / 2, -D * 0.15, Math.PI / 2, D * 0.55, 1.1);
    K.cyl(root, logA, { h: 1.9, d: 0.3, t: 7 }, [-0.7, FND + 0.16, -D / 2 + 0.6], { rot: [0, 0.2, Math.PI / 2] });
    K.cyl(root, logB, { h: 1.4, d: 0.3, t: 7 }, [-W / 2 + 0.6, FND + 0.16, -0.2], { rot: [0.1, 0, Math.PI / 2] });
    const pp = K.node(root, [-W / 2 + 0.3, 0, D / 2 - 0.4]); pp.rotation.z = 0.32;
    K.box(pp, wood, [0.16, 1.8, 0.16], [0, 0.9, 0]);
    K.box(root, wood, [0.15, 1.5, 0.15], [-0.75, FND + 0.75, D / 2 - 0.1]);
    const lp = K.node(root, [0.75, 0, D / 2 - 0.1]); lp.rotation.z = -0.22; K.box(lp, wood, [0.15, 1.3, 0.15], [0, 0.65, 0]);
    const lt = K.node(root, [0, FND + 1.4, D / 2 - 0.1]); lt.rotation.z = 0.16; K.box(lt, wood, [1.7, 0.16, 0.16], [0, 0, 0]);
    const beam = K.node(root, [0.2, 0, -0.3]); beam.rotation.set(0.05, 0.3, 0.32); K.box(beam, wood, [0.18, 0.18, 3.4], [0, 0.95, 0]);
    K.box(root, [0.4, 0.33, 0.2], [1.9, 0.13, 1.2], [0.5, FND + 0.6, -0.5], { rot: [0.4, 0.2, 0] });
    K.box(root, [0.3, 0.22, 0.12], [0.9, 0.46, 0.56], [1.4, FND + 0.23, 0.9], { rot: [0, 0.4, 0.45] });
    K.box(root, [0.3, 0.24, 0.15], [0.44, 0.3, 0.38], [0.7, FND + 0.15, 1.2], { rot: [0, 0.6, 0.2] });
    K.box(root, [0.3, 0.24, 0.15], [0.44, 0.16, 0.38], [1.05, FND + 0.08, 1.4], { rot: [0, 0.2, 0.05] });
    for (let i = 0; i < 3; i++) { const a = i * 1.9 + 0.4; K.box(root, logA, [0.2, 0.1, 1.5], [Math.cos(a) * 1.5, FND + 0.07, Math.sin(a) * 1.2], { rot: [0, a, 0.05] }); }
    return root;
  }

  // ---- briques de coque (portées du labo) ----

  private logWall(parent: TransformNode, x: number, z: number, ry: number, len: number, h: number): void {
    const K = this.K;
    const n = K.node(parent, [x, 0, z]); n.rotation.y = ry;
    const logD = 0.34, courses = Math.max(1, Math.round(h / logD));
    for (let i = 0; i < courses; i++) K.cyl(n, i % 2 ? [0.26, 0.19, 0.13] : P.wood, { h: len, d: logD, t: 7 }, [0, BASE_Y + logD / 2 + i * logD, 0], { rot: [0, 0, Math.PI / 2] });
  }

  private gableRoof(parent: TransformNode, eaveY: number, rise: number, shingled: boolean, fillEnds: boolean): void {
    const K = this.K;
    const ovX = 0.2, ovZ = 0.2, halfD = D / 2 + ovZ, L = Math.sqrt(halfD * halfD + rise * rise), th = Math.atan2(rise, halfD), ridgeY = eaveY + rise;
    const plank = P.roof2, shA = P.roof, shB = [0.29, 0.24, 0.2], beam = P.woodDark;
    for (const dir of [1, -1]) {
      const pan = K.node(parent, [0, eaveY + rise / 2, dir * halfD / 2]); pan.rotation.x = dir * th;
      K.box(pan, plank, [W + 2 * ovX, 0.08, L + 0.04], [0, 0, 0]);
      if (shingled) { const rows = Math.max(4, Math.round(L / 0.34)); for (let r = 0; r < rows; r++) { const lz = -L / 2 + 0.18 + r * (L - 0.24) / (rows - 1); K.box(pan, r % 2 ? shA : shB, [W + 2 * ovX - 0.04, 0.05, L / rows + 0.08], [0, 0.06, lz]); } }
      else { for (let r = 0; r < 3; r++) K.box(pan, beam, [W + 2 * ovX, 0.025, 0.04], [0, 0.06, -L / 2 + 0.3 + r * (L - 0.6) / 2]); }
      for (const sx of [-(W / 2 + ovX - 0.12), 0, W / 2 + ovX - 0.12]) K.box(pan, beam, [0.08, 0.05, L], [sx, -0.04, 0]);
    }
    K.cyl(parent, beam, { h: W + 2 * ovX, d: 0.16, t: 6 }, [0, ridgeY + 0.04, 0], { rot: [0, 0, Math.PI / 2] });
    if (shingled) K.box(parent, shA, [W + 2 * ovX, 0.1, 0.36], [0, ridgeY + 0.09, 0]);
    for (const dz of [halfD, -halfD]) K.cyl(parent, beam, { h: W + 2 * ovX, d: 0.1, t: 6 }, [0, eaveY, dz], { rot: [0, 0, Math.PI / 2] });
    const ends = fillEnds ? [-1, 1] : [-1];
    for (const sx of ends) { const nP = 8; for (let i = 0; i < nP; i++) { const z = -D / 2 + (i + 0.5) * D / nP, ph = rise * (1 - Math.abs(z) / (D / 2)); if (ph < 0.06) continue; K.box(parent, P.wood, [0.09, ph, D / nP + 0.03], [sx * (W / 2 - 0.01), eaveY + ph / 2, z]); } }
    if (shingled) { K.cone(parent, beam, { h: 0.45, d: 0.18, t: 6 }, [-(W / 2 + ovX - 0.06), ridgeY + 0.34, 0]); K.sph(parent, P.bone, { d: 0.13 }, [-(W / 2 + ovX - 0.06), ridgeY + 0.6, 0]); }
  }

  private hideRoof(parent: TransformNode, zB: number, zF: number, yB: number, yF: number): void {
    const K = this.K, NX = 6;
    const zs = [zB, (zB + zF) / 2, zF], ys = [yB, (yB + yF) / 2 - 0.14, yF];
    const rows: Vector3[][] = [];
    for (let r = 0; r < 3; r++) { const row: Vector3[] = []; for (let i = 0; i <= NX; i++) { const t = i / NX, x = -W / 2 + t * W, sag = Math.sin(t * Math.PI) * 0.09; row.push(new Vector3(x, ys[r] - sag, zs[r])); } rows.push(row); }
    const m = MeshBuilder.CreateRibbon("cabHide", { pathArray: rows }, this.scene);
    const mat = new StandardMaterial("cabHideMat", this.scene);
    mat.diffuseColor = new Color3(P.hide[0], P.hide[1], P.hide[2]); mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false; mat.twoSidedLighting = true;
    m.material = mat; m.parent = parent; m.convertToFlatShadedMesh();
    K.cyl(parent, P.woodDark, { h: W + 0.2, d: 0.1, t: 6 }, [0, yB + 0.02, zB], { rot: [0, 0, Math.PI / 2] });
    const hd = [P.hide[0] * 0.78, P.hide[1] * 0.78, P.hide[2] * 0.78];
    K.cyl(parent, hd, { h: W + 0.1, d: 0.07, t: 6 }, [0, yF - 0.03, zF], { rot: [0, 0, Math.PI / 2] });
    for (const sx of [-1, 1]) K.cyl(parent, hd, { h: 0.16, d: 0.03, t: 5 }, [sx * (W / 2 - 0.06), yF, zF]);
  }

  private lantern(parent: TransformNode, x: number, y: number, z: number): void {
    const K = this.K;
    const n = K.node(parent, [x, y, z]);
    K.cyl(n, P.metalDark, { h: 0.4, d: 0.015, t: 5 }, [0, 0.32, 0]);
    K.box(n, P.woodDark, [0.18, 0.05, 0.18], [0, 0.1, 0]); K.box(n, P.woodDark, [0.16, 0.04, 0.16], [0, -0.16, 0]);
    for (const cx of [-0.07, 0.07]) for (const cz of [-0.07, 0.07]) K.cyl(n, P.woodDark, { h: 0.24, d: 0.014, t: 4 }, [cx, -0.03, cz]);
    K.box(n, [1.0, 0.82, 0.45], [0.12, 0.2, 0.12], [0, -0.03, 0], { emi: 1.0, unlit: true });
  }

  private hang(parent: TransformNode, x: number, y: number, z: number): void {
    const K = this.K;
    const n = K.node(parent, [x, y, z]); K.cyl(n, P.hide, { h: 0.28, d: 0.02 }, [0, -0.14, 0]);
    const t = Math.abs(Math.round(x * 7)) % 3;
    if (t === 0) { for (let i = 0; i < 3; i++) K.cone(n, P.dryBrush, { h: 0.34, d: 0.15, t: 6 }, [-0.07 + i * 0.07, -0.48, 0], { rot: [Math.PI, 0, 0] }); }
    else if (t === 1) { K.box(n, P.fur, [0.42, 0.55, 0.05], [0, -0.55, 0]); }
    else { K.tor(n, P.hide, { d: 0.3, thick: 0.045, t: 10 }, [0, -0.42, 0], { rot: [Math.PI / 2, 0, 0] }); }
  }

  private loft(parent: TransformNode, zBack: number, y: number, ladder: boolean): void {
    const K = this.K, lw = 2.6, zFront = zBack + 0.4;
    K.box(parent, P.woodLight, [lw, 0.07, 0.82], [-0.1, y, zBack]);
    K.cyl(parent, P.woodDark, { h: lw, d: 0.08, t: 6 }, [-0.1, y - 0.06, zFront], { rot: [0, 0, Math.PI / 2] });
    for (const sx of [-1.15, 1.05]) K.cyl(parent, P.woodDark, { h: y - BASE_Y, d: 0.08, t: 6 }, [sx, BASE_Y + (y - BASE_Y) / 2, zFront]);
    K.box(parent, [0.34, 0.27, 0.18], [0.5, 0.42, 0.5], [-1.0, y + 0.25, zBack]);
    K.box(parent, [0.3, 0.24, 0.16], [0.46, 0.36, 0.46], [-0.4, y + 0.21, zBack + 0.05], { rot: [0, 0.2, 0] });
    K.cyl(parent, P.dryBrush, { h: 0.42, dt: 0.26, db: 0.34, t: 8 }, [0.55, y + 0.24, zBack - 0.04]);
    K.box(parent, P.hide, [0.5, 0.08, 0.4], [0.18, y + 0.05, zBack + 0.22]);
    if (ladder) {
      const lad = K.node(parent, [1.05, BASE_Y, zFront + 0.5]); lad.rotation.x = -0.2;
      for (const rx of [-0.13, 0.13]) K.cyl(lad, P.woodDark, { h: y - BASE_Y + 0.1, d: 0.05, t: 6 }, [rx, (y - BASE_Y + 0.1) / 2, 0]);
      for (let i = 0; i < 4; i++) K.cyl(lad, P.woodLight, { h: 0.28, d: 0.03, t: 6 }, [0, 0.4 + i * 0.45, 0], { rot: [0, 0, Math.PI / 2] });
    }
  }

  private woodpile(parent: TransformNode, x: number, z: number, w: number, rows: number): void {
    const K = this.K;
    const n = K.node(parent, [x, BASE_Y + 0.04, z]); const cols = Math.max(2, Math.round(w / 0.18));
    for (let r = 0; r < rows; r++) for (let cc = 0; cc < cols; cc++) K.cyl(n, (r + cc) % 2 ? P.wood : [0.34, 0.25, 0.16], { h: 0.7, d: 0.16, t: 7 }, [-w / 2 + 0.09 + cc * 0.18, 0.09 + r * 0.18, 0], { rot: [Math.PI / 2, 0, 0] });
  }

  // ========================================================================
  //  AMÉNAGEMENTS partagés (fittings) : étagères+coffres, tableau, dépôt, outils.
  // ========================================================================

  private buildFittings(): TransformNode {
    const K = this.K;
    const root = K.node(null);
    root.position.copyFromFloats(CX, ROOT_Y, CZ);
    root.rotation.y = RY; // orientation de la cabane (éditeur de spawn)
    const wd = P.woodDark, woodL = P.woodLight;

    // Cadre des ÉTAGÈRES (les coffres y apparaissent au fur et à mesure : createChest).
    const len = 3.2, sy0 = 0.5, dy = 0.62, shelves = 3, sx0 = 0.45, sz = -D / 2 + 0.55;
    const top = sy0 + (shelves - 1) * dy + 0.45;
    const shelfNode = K.node(root, [sx0, 0, sz]);
    for (const mx of [-len / 2, 0, len / 2]) K.box(shelfNode, wd, [0.09, top, 0.1], [mx, top / 2, -0.24]);
    for (let s = 0; s < shelves; s++) K.box(shelfNode, woodL, [len + 0.12, 0.05, 0.48], [0, sy0 + s * dy, 0]);

    // COFFRE DE DÉPÔT (avant-droit, dans le pan ; serrure côté intérieur -Z).
    const dx = 1.65, dz = D / 2 - 0.6;
    K.box(root, [0.4, 0.3, 0.16], [1.15, 0.62, 0.74], [dx, 0.41, dz]);
    K.box(root, [0.3, 0.22, 0.12], [1.2, 0.18, 0.78], [dx, 0.8, dz]);
    K.box(root, P.metalDark, [0.12, 0.42, 0.05], [dx, 0.5, dz - 0.38]);
    K.tor(root, P.metalDark, { d: 0.14, thick: 0.03, t: 8 }, [dx, 0.46, dz - 0.42], { rot: [Math.PI / 2, 0, 0] });

    // OUTILS / PLANS de la constructrice (petit mur gauche en entrant, face -Z).
    this.toolsBoard(root, -1.7, D / 2 - 0.22, Math.PI);

    // TABLEAU d'organisation (mur gauche, monté en hauteur) : cadre + ardoise DynamicTexture.
    this.buildBoard(root, -W / 2 + 0.12, -0.4, POST_H - 1.0, 1.2, 0.82);

    return root;
  }

  private toolsBoard(parent: TransformNode, x: number, z: number, ry: number): void {
    const K = this.K;
    const n = K.node(parent, [x, 0, z]); n.rotation.y = ry; const wd = P.woodDark, woodL = P.woodLight, md = P.metalDark;
    K.box(n, wd, [0.95, 0.7, 0.05], [0, 1.35, 0]);
    K.box(n, P.metal, [0.5, 0.13, 0.02], [-0.18, 1.45, 0.04]); K.box(n, woodL, [0.5, 0.04, 0.03], [-0.18, 1.52, 0.05]);
    K.cyl(n, woodL, { h: 0.26, d: 0.04 }, [0.2, 1.32, 0.04], { rot: [0, 0, 0.4] }); K.box(n, md, [0.12, 0.07, 0.06], [0.12, 1.39, 0.04]);
    K.box(n, md, [0.04, 0.28, 0.02], [0.32, 1.36, 0.05]); K.box(n, md, [0.18, 0.04, 0.02], [0.4, 1.24, 0.05]);
    K.cyl(n, woodL, { h: 0.3, d: 0.06, t: 6 }, [0.0, 1.18, 0.05], { rot: [0, 0, 1.4] });
  }

  private buildBoard(parent: TransformNode, x: number, z: number, h: number, bw: number, y0: number): void {
    const K = this.K;
    const base = y0;
    const n = K.node(parent, [x, base + h / 2, z]); // face +X (vers l'intérieur)
    K.box(n, P.woodDark, [0.1, h, bw], [0, 0, 0]); // cadre épais
    const tex = new DynamicTexture("villageBoard", { width: 512, height: 512 }, this.scene, false);
    tex.hasAlpha = true;
    const boardMat = new StandardMaterial("boardMat", this.scene);
    boardMat.diffuseColor = new Color3(0.1, 0.12, 0.11);
    boardMat.specularColor = new Color3(0, 0, 0);
    boardMat.emissiveTexture = tex;
    boardMat.opacityTexture = tex;
    boardMat.disableLighting = true;
    boardMat.backFaceCulling = false;
    const plane = MeshBuilder.CreatePlane("villageBoardPlane", { width: bw - 0.2, height: h - 0.16 }, this.scene);
    plane.material = boardMat;
    plane.parent = n;
    plane.position.set(0.06, 0, 0);
    plane.rotation.y = -Math.PI / 2; // face +X
    this.board = tex;
    this.drawBoard(0, 0, []);
  }

  private drawBoard(population: number, maxPop: number, rows: Array<{ name: string; count: number }>): void {
    const tex = this.board!;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 512, 512);
    tex.drawText("ORGANISATION", null, 70, "bold 44px monospace", "#f0a050", "transparent", true);
    tex.drawText(`village  ${population}/${maxPop}`, null, 130, "30px monospace", "#cfe0d6", "transparent", true);
    let y = 210;
    for (const r of rows) { tex.drawText(`${r.name} : ${r.count}`, null, y, "30px monospace", "#cfe0d6", "transparent", true); y += 52; }
    tex.update();
  }

  /** Crée le petit coffre + son panneau-compteur pour une ressource, à son slot 2D fixe. */
  private createChest(id: string): void {
    const K = this.K;
    const i = this.shelfCount++;
    const len = 3.2, sy0 = 0.5, dy = 0.62, perShelf = 5, sx0 = 0.45, sz = -D / 2 + 0.55;
    const s = Math.floor(i / perShelf), col = i % perShelf;
    const sy = sy0 + s * dy;
    const cx = sx0 + (-len / 2 + 0.4 + col * (len - 0.8) / (perShelf - 1));
    const y = sy + 0.025;
    const n = K.node(this.fittings, [cx, y, sz]);
    const wdc = [0.34, 0.26, 0.16], md = P.metalDark;
    K.box(n, wdc, [0.46, 0.3, 0.4], [0, 0.15, 0]);
    K.box(n, [0.28, 0.21, 0.13], [0.48, 0.09, 0.42], [0, 0.34, 0]);
    K.box(n, md, [0.05, 0.32, 0.05], [0, 0.18, 0.19]); // fermoir : reculé pour passer DERRIÈRE la plaque

    // Panneau-compteur (DynamicTexture, face +Z vers le joueur). Plaque PLEINE (sans alpha) :
    // fond sombre + texte clair émissif -> lisible dans la pénombre de la cabane (cf. drawCounter).
    const tex = new DynamicTexture(`sign-${id}`, { width: 512, height: 256 }, this.scene, false);
    tex.hasAlpha = false;
    const signMat = new StandardMaterial(`signMat-${id}`, this.scene);
    signMat.diffuseColor = new Color3(0, 0, 0); // non éclairé : seule l'émissive (la texture) compte
    signMat.specularColor = new Color3(0, 0, 0);
    signMat.emissiveTexture = tex;
    signMat.disableLighting = true;
    signMat.backFaceCulling = false;
    const sign = MeshBuilder.CreatePlane(`signPlane-${id}`, { width: 0.44, height: 0.22 }, this.scene);
    sign.material = signMat;
    sign.parent = n;
    sign.position.set(0, 0.18, 0.245); // devant le fermoir (z 0.215) -> plus aucune barre sur le texte
    sign.rotation.y = Math.PI; // face +Z (vers l'entrée)

    this.shelves.set(id, { tex, lastQty: -1, lastFull: false });
  }

  private drawCounter(tex: DynamicTexture, label: string, qty: number, full = false): void {
    const { width: W, height: H } = tex.getSize();
    const ctx = tex.getContext();
    // Plaque sombre chaude (étiquette clouée) + liseré : détache le texte du bois sombre.
    ctx.fillStyle = "#241a12";
    ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = Math.round(H * 0.055);
    ctx.strokeStyle = "#5a4126";
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, W - ctx.lineWidth, H - ctx.lineWidth);
    // Texte CLAIR (émissif -> luit dans la pénombre). Quantité en rouge/orange VIF quand l'étagère
    // est au plafond (tout surplus déposé/produit y est perdu) ; ambre chaud sinon.
    tex.drawText(label, null, H * 0.40, "bold 64px monospace", "#e9dcc0", "transparent", true);
    tex.drawText(String(qty), null, H * 0.88, "bold 104px monospace", full ? "#ff6a3d" : "#ffd9a0", "transparent", true);
  }

  // ---- collisions : les colliders ÉPOUSENT les murs RÉELS du palier courant ----
  //  (sinon, comme les murs changent selon le palier, on obtient un « mur invisible » là où
  //   le mur visuel manque, ou un mur fantôme traversable). On les RECONSTRUIT à chaque palier.

  private rebuildColliders(tier: number): void {
    for (const c of this.colliders) { c.physicsBody?.dispose(); c.dispose(); }
    this.colliders = [];
    if (tier < 1) return; // ruine : décombres traversables, pas de colliders

    const fs = (W - 2.2) / 2;
    // Collider boîte aligné sur la cabane (offset LOCAL (lx,lz) tourné de RY, hauteur `h`, dessus à `topLocalY`).
    const box = (name: string, w: number, d: number, h: number, lx: number, lz: number, topLocalY: number): void => {
      const col = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
      col.isVisible = false;
      col.position.set(CX + lx * COSR + lz * SINR, ROOT_Y + topLocalY - h / 2, CZ - lx * SINR + lz * COSR);
      col.rotation.y = RY;
      new PhysicsAggregate(col, PhysicsShapeType.BOX, { mass: 0 }, this.scene);
      this.colliders.push(col);
    };
    // SOL PLEIN : un vrai plancher sur toute l'emprise -> le joueur marche DESSUS (ne traverse plus).
    // Dessus à FLOOR_TOP ; la cabane étant enfoncée de SINK, ce n'est qu'un petit ressaut franchissable.
    box("cabColFloor", W, D, 0.5, 0, 0, FLOOR_TOP);
    // MUR ARRIÈRE plein (tous paliers) + façade : 2 pans encadrant l'entrée centrale (toujours OUVERTE).
    box("cabColBack", W + 0.1, 0.34, POST_H, 0, -D / 2, BASE_Y + POST_H);
    box("cabColFrontL", fs, 0.34, POST_H, -(1.1 + fs / 2), D / 2, BASE_Y + POST_H);
    box("cabColFrontR", fs, 0.34, POST_H, 1.1 + fs / 2, D / 2, BASE_Y + POST_H);
    if (tier >= 5) {
      // ÉVOLUTION : mur gauche PLEIN + mur droit partiel ARRIÈRE -> entrée latérale AVANT-DROITE ouverte.
      box("cabColLeft", 0.34, D, POST_H, -W / 2, 0, BASE_Y + POST_H);
      box("cabColRightBack", 0.34, D * 0.48, POST_H, W / 2, -D * 0.26, BASE_Y + POST_H);
    } else {
      // RÉPARÉE ×1 : mur gauche PARTIEL (arrière) seulement -> le côté gauche-AVANT (près des outils)
      //  reste OUVERT comme à l'écran (le collider épouse exactement le mur partiel, plus de mur invisible).
      box("cabColLeft", 0.34, D * 0.5, POST_H, -W / 2, -D * 0.18, BASE_Y + POST_H);
    }
    // Côtés laissés OUVERTS : entrée centrale (façade) + côté droit (réparée) / avant-droit (évolution).
  }
}
