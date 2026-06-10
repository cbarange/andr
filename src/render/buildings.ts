// ============================================================================
//  LE VILLAGE (M2) — représentation 3D des bâtiments construits. Purement visuel :
//  on lit la map `buildings` de la SIM et on instancie les structures manquantes.
//
//  Placement DÉTERMINISTE par (type, n-ième exemplaire) -> indépendant de l'ordre de
//  construction, donc identique chez tous les pairs (cohérence P2P, cosmétique).
//
//  Les modèles low-poly viennent du labo (lab/model-lab.html) via le kit partagé
//  (render/lowpoly.ts). Voir docs/modeles-3d.md.
// ============================================================================

import { Scene, Mesh, MeshBuilder, TransformNode, PhysicsAggregate, PhysicsShapeType } from "@babylonjs/core";
import { craftables, terrainHeight, campLayout, type CampAnchor } from "../../data/world";
import { makeKit, P, type Kit } from "./lowpoly";

// Emplacement réservé : chaque type occupe une plage de créneaux stable (repli `ringSlot`).
const SLOT_OFFSET: Record<string, number> = {};
{
  let acc = 0;
  for (const c of craftables) {
    SLOT_OFFSET[c.id] = acc;
    acc += c.maximum;
  }
}

// REPLI uniquement : si un type dépasse le nombre d'ancres dessinées (ne devrait pas, borné
// par `maximum`). Anneaux concentriques autour du feu (centre). r >= 6 -> hors de la zone du feu.
function ringSlot(k: number): { x: number; z: number } {
  const perRing = 8;
  const ring = Math.floor(k / perRing);
  const idx = k % perRing;
  const radius = 6 + ring * 3;
  const angle = (idx / perRing) * Math.PI * 2 + ring * 0.55;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

// Yaw pour qu'un bâtiment (façade = +z local) regarde une direction donnée. Le layout du
// camp veut « face au feu » par défaut ; le poste de traite/le fumoir/le pavillon ont leur
// propre orientation (cf. campLayout). Voir docs/plan-campement.md.
function faceYaw(x: number, z: number, face: CampAnchor["face"]): number {
  if (typeof face === "number") return face;
  if (face === "south") return 0; // façade vers la friche (+Z)
  return Math.atan2(-x, -z); // "fire" (défaut) : la façade pointe vers le feu central (0,0)
}

// Rayon d'EMPRISE par type (évitement des villageois) — un peu plus serré que la silhouette
// visible pour qu'ils puissent longer les murs. `trap` = 0 : franchissable (au ras du sol).
const OBSTACLE_RADIUS: Record<string, number> = {
  // cart : ajusté à la caisse + roues (~0.94) -> exclut la pile de rondins décorative
  // posée à côté (local x≈1.4) ; elle n'a donc plus de collision. (Était 1.7, trop large.)
  hut: 1.9, cart: 1.0, "trading post": 2.2, armoury: 1.9, tannery: 1.9,
  workshop: 1.9, smokehouse: 1.5, lodge: 2.3, steelworks: 2.4, trap: 0,
};
const COLLIDER_H = 3; // hauteur du collider statique d'un bâtiment (le joueur ne le traverse plus)

// ---------------------------------------------------------------------------
//  HUTTE habitable PARAMÉTRÉE (portée du labo) — 3 variantes légères. Chaque hutte du
//  village en choisit une de façon DÉTERMINISTE (hash de sa position) -> village varié et
//  cohérent entre pairs. `buildHut` construit sur `root` et RENVOIE la position de cheminée
//  (la fumée est gérée côté jeu par addSmoke, pas par le smokePuffs du labo).
// ---------------------------------------------------------------------------
interface HutVariant {
  shape: "round" | "square";
  roof: "cone" | "pyramid" | "hip";
  w: number;
  d?: number;
  wallH: number;
  roofH: number;
  tint: number[];
  thatch: number[];
  chimney: 1 | -1;
  window2: boolean;
  extra: "wood" | "barrel" | "bench";
  doorX?: number;
  frontWinX?: number;
}

const HUT_VARIANTS: HutVariant[] = [
  { shape: "square", roof: "pyramid", w: 2.8, wallH: 1.95, roofH: 1.6, tint: [0.42, 0.34, 0.25], thatch: [0.4, 0.33, 0.2], chimney: -1, window2: false, extra: "wood", doorX: 0.65, frontWinX: -0.82 },
  { shape: "round", roof: "cone", w: 2.9, wallH: 1.9, roofH: 1.7, tint: [0.39, 0.33, 0.27], thatch: [0.45, 0.37, 0.22], chimney: 1, window2: false, extra: "barrel" },
  { shape: "square", roof: "hip", w: 3.4, d: 2.4, wallH: 1.85, roofH: 1.4, tint: [0.45, 0.36, 0.24], thatch: [0.43, 0.35, 0.21], chimney: 1, window2: false, extra: "bench", doorX: 0.95, frontWinX: -0.95 },
];

/** Variante DÉTERMINISTE pour une hutte à (x,z) — stable, identique chez tous les pairs. */
function hutVariantFor(x: number, z: number): HutVariant {
  const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return HUT_VARIANTS[Math.floor((h - Math.floor(h)) * HUT_VARIANTS.length) % HUT_VARIANTS.length];
}

function buildHut(K: Kit, root: TransformNode, v: HutVariant): number[] {
  const w = v.w, d = v.d ?? v.w, H = v.wallH;
  const FND = 0.32, topY = FND + H;
  const wall = v.tint, wood = P.woodDark, woodL = P.woodLight, stone = P.stone, thatch = v.thatch;
  const round = v.shape === "round";
  const eave = 0.4, roofH = v.roofH, roofBaseY = topY + 0.14;
  if (round) {
    K.cyl(root, stone, { h: FND, d: w + 0.24, t: 12 }, [0, FND / 2, 0]);
    K.cyl(root, wall, { h: H, d: w, t: 12 }, [0, FND + H / 2, 0]);
    K.cyl(root, woodL, { h: 0.18, d: w + 0.1, t: 12 }, [0, topY + 0.05, 0]);
    K.cyl(root, wood, { h: 0.1, d: w + 0.12, t: 12 }, [0, FND + H * 0.5, 0]);
    K.cone(root, thatch, { h: roofH, d: (w / 2 + eave) * 2, t: 12 }, [0, roofBaseY + roofH / 2, 0]);
  } else {
    K.box(root, stone, [w + 0.24, FND, d + 0.24], [0, FND / 2, 0]);
    K.box(root, wall, [w, H, d], [0, FND + H / 2, 0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box(root, wood, [0.16, H, 0.16], [sx * (w / 2), FND + H / 2, sz * (d / 2)]);
    K.box(root, woodL, [w + 0.14, 0.16, d + 0.14], [0, topY + 0.06, 0]);
    K.box(root, wood, [w + 0.02, 0.1, 0.06], [0, FND + H * 0.52, d / 2 + 0.01]);
    if (v.roof === "hip") {
      K.hipRoof(root, thatch, { w: w + eave * 2, dp: d + eave * 2, h: roofH, ridge: w * 0.5 }, [0, roofBaseY, 0]);
      const dk = [thatch[0] * 0.78, thatch[1] * 0.78, thatch[2] * 0.78];
      K.cyl(root, dk, { h: w * 0.5 + 0.3, d: 0.22, t: 6 }, [0, roofBaseY + roofH + 0.02, 0], { rot: [0, 0, Math.PI / 2] });
    } else {
      const rf = K.cone(root, thatch, { h: roofH, d: (w / 2 + eave) * 2.828, t: 4 }, [0, roofBaseY + roofH / 2, 0]);
      rf.rotation.y = Math.PI / 4;
    }
  }
  if (v.roof !== "hip") {
    K.cyl(root, wood, { h: 0.5, d: 0.1, t: 6 }, [0, roofBaseY + roofH + 0.16, 0]);
    K.sph(root, woodL, { d: 0.2, seg: 6 }, [0, roofBaseY + roofH + 0.44, 0]);
  }
  const dz = d / 2, LY = 1.74, dx = v.doorX ?? 0;
  K.box(root, [0.05, 0.04, 0.03], [0.88, 1.46, 0.18], [dx, 1.01, dz + 0.05]);
  K.box(root, wood, [0.8, 1.44, 0.1], [dx, 1.02, dz + 0.13]);
  K.box(root, woodL, [0.12, 1.58, 0.14], [dx - 0.47, 1.09, dz + 0.11]);
  K.box(root, woodL, [0.12, 1.58, 0.14], [dx + 0.47, 1.09, dz + 0.11]);
  K.box(root, woodL, [1.1, 0.14, 0.14], [dx, LY + 0.07, dz + 0.11]);
  K.box(root, P.metalDark, [0.11, 0.06, 0.05], [dx + 0.27, 1.0, dz + 0.19]);
  K.box(root, stone, [1.12, 0.16, 0.42], [dx, 0.08, dz + 0.36]);
  const mkWindow = (wx: number, wz: number, ry: number): void => {
    const n = K.node(root, [wx, FND + 1.02, wz]);
    n.rotation.y = ry;
    K.box(n, [0.05, 0.04, 0.03], [0.62, 0.62, 0.18], [0, 0, -0.05]);
    K.box(n, P.emberHot, [0.5, 0.5, 0.04], [0, 0, 0.05], { emi: 0.9, unlit: true });
    K.box(n, woodL, [0.66, 0.09, 0.1], [0, -0.33, 0.06]);
    K.box(n, wood, [0.58, 0.06, 0.07], [0, 0, 0.08]);
    K.box(n, wood, [0.06, 0.58, 0.07], [0, 0, 0.08]);
    K.box(n, woodL, [0.72, 0.09, 0.09], [0, 0.35, 0.06]);
  };
  const fwx = v.frontWinX != null ? v.frontWinX : dx ? -Math.sign(dx) * 0.92 : 0.92;
  if (round) [-0.72, 0.72].forEach((th) => mkWindow(Math.sin(th) * (w / 2), Math.cos(th) * (w / 2), th));
  else mkWindow(fwx, dz, 0);
  if (v.window2) mkWindow(-v.chimney * (w / 2), 0, -v.chimney * (Math.PI / 2));
  const cx = v.chimney * (round ? w / 2 - 0.06 : w / 2 + 0.18), cz = round ? -d * 0.1 : -d * 0.22;
  const chH = topY + roofH * 0.74;
  K.box(root, P.stoneDark, [0.5, chH, 0.5], [cx, chH / 2, cz]);
  K.box(root, stone, [0.6, 0.14, 0.6], [cx, chH - 0.05, cz]);
  K.box(root, P.stoneDark, [0.4, 0.12, 0.4], [cx, chH + 0.08, cz]);
  if (v.extra === "wood") {
    const n = K.node(root, [fwx, 0, d / 2 + 0.5]);
    for (let i = 0; i < 3; i++) K.cyl(n, P.trunk, { h: 1.1, d: 0.22, t: 7 }, [0, 0.13, -0.34 + i * 0.34], { rot: [0, 0, Math.PI / 2] });
    for (let i = 0; i < 2; i++) K.cyl(n, P.trunk, { h: 1.1, d: 0.22, t: 7 }, [0, 0.35, -0.17 + i * 0.34], { rot: [0, 0, Math.PI / 2] });
  } else if (v.extra === "barrel") {
    const n = K.node(root, [-v.chimney * (w / 2 - 0.15), 0, w / 2 + 0.42]);
    K.cyl(n, P.wood, { h: 0.7, dt: 0.46, db: 0.5, t: 12 }, [0, 0.35, 0]);
    K.tor(n, P.metalDark, { d: 0.54, thick: 0.04, t: 14 }, [0, 0.21, 0]);
    K.tor(n, P.metalDark, { d: 0.5, thick: 0.04, t: 14 }, [0, 0.56, 0]);
    K.cyl(n, P.woodLight, { h: 0.06, d: 0.44, t: 12 }, [0, 0.7, 0]);
  } else if (v.extra === "bench") {
    const n = K.node(root, [fwx, 0, d / 2 + 0.32]);
    K.box(n, P.wood, [1.15, 0.1, 0.4], [0, 0.42, 0]);
    for (const sx of [-0.45, 0.45]) { K.box(n, wood, [0.1, 0.42, 0.1], [sx, 0.21, -0.12]); K.box(n, wood, [0.1, 0.42, 0.1], [sx, 0.21, 0.12]); }
  }
  return [cx, chH + 0.22, cz];
}

// --- LOGE DE CHASSE : cabane en rondins, toit pignon-en-façade, trophée, props chasse. ---
function buildLodge(K: Kit, root: TransformNode): number[] {
  const logA = [0.26, 0.19, 0.13], logB = P.wood, plank = [0.28, 0.2, 0.14];
  const FND = 0.3, wallW = 2.8, wallD = 2.4, wallH = 1.9, topY = FND + wallH;
  K.box(root, P.stone, [wallW + 0.3, FND, wallD + 0.3], [0, FND / 2, 0]);
  K.box(root, P.woodDark, [wallW - 0.12, wallH, wallD - 0.12], [0, FND + wallH / 2, 0]);
  const logD = 0.38, courses = Math.round(wallH / logD);
  for (let i = 0; i < courses; i++) {
    const y = FND + logD / 2 + i * logD;
    const tA = i % 2 ? logA : logB, tB = i % 2 ? logB : logA;
    K.cyl(root, tA, { h: wallW + 0.34, d: logD, t: 7 }, [0, y, wallD / 2], { rot: [0, 0, Math.PI / 2] });
    K.cyl(root, tA, { h: wallW + 0.34, d: logD, t: 7 }, [0, y, -wallD / 2], { rot: [0, 0, Math.PI / 2] });
    K.cyl(root, tB, { h: wallD + 0.34, d: logD, t: 7 }, [wallW / 2, y + logD / 2, 0], { rot: [Math.PI / 2, 0, 0] });
    K.cyl(root, tB, { h: wallD + 0.34, d: logD, t: 7 }, [-wallW / 2, y + logD / 2, 0], { rot: [Math.PI / 2, 0, 0] });
  }
  const roofH = 1.3, roofBaseY = topY - 0.02;
  K.gableRoof(root, plank, { w: wallD, dp: wallW + 0.7, h: roofH }, [0, roofBaseY, 0], { rot: [0, Math.PI / 2, 0] });
  K.cyl(root, P.woodDark, { h: wallD + 0.12, d: 0.16, t: 6 }, [0, roofBaseY + roofH, 0], { rot: [Math.PI / 2, 0, 0] });
  for (const sx of [-1, 1]) K.cyl(root, P.woodDark, { h: wallD, d: 0.1, t: 6 }, [sx * (wallW / 2 + 0.05), roofBaseY + 0.04, 0], { rot: [Math.PI / 2, 0, 0] });
  const dz = wallD / 2;
  K.box(root, [0.05, 0.04, 0.03], [0.94, 1.5, 0.18], [0, 1.02, dz + 0.05]);
  K.box(root, P.woodDark, [0.84, 1.44, 0.1], [0, 1.03, dz + 0.13]);
  for (let i = 0; i < 3; i++) K.box(root, logA, [0.24, 1.36, 0.04], [-0.27 + i * 0.27, 1.03, dz + 0.19]);
  K.box(root, P.woodLight, [0.12, 1.6, 0.13], [-0.5, 1.1, dz + 0.11]);
  K.box(root, P.woodLight, [0.12, 1.6, 0.13], [0.5, 1.1, dz + 0.11]);
  K.box(root, P.woodLight, [1.14, 0.14, 0.13], [0, 1.78, dz + 0.11]);
  K.box(root, P.metalDark, [0.1, 0.18, 0.06], [0.3, 1.03, dz + 0.2]);
  K.box(root, P.stone, [1.16, 0.16, 0.44], [0, 0.08, dz + 0.34]);
  const tro = K.node(root, [0, 2.55, dz + 0.06]);
  K.box(tro, P.bone, [0.36, 0.3, 0.18], [0, 0, 0]);
  K.cone(tro, P.bone, { h: 0.18, d: 0.2, t: 6 }, [0, -0.21, 0.0], { rot: [Math.PI, 0, 0] });
  for (const sgn of [-1, 1]) {
    const a = K.node(tro, [0.15 * sgn, 0.14, 0]); a.rotation.z = -0.6 * sgn;
    K.cyl(a, P.bone, { h: 0.5, d: 0.05, t: 5 }, [0, 0.24, 0]);
    K.cyl(a, P.bone, { h: 0.26, d: 0.04, t: 5 }, [0.12 * sgn, 0.46, 0], { rot: [0, 0, -0.95 * sgn] });
    K.cyl(a, P.bone, { h: 0.22, d: 0.04, t: 5 }, [0.18 * sgn, 0.3, 0], { rot: [0, 0, -1.3 * sgn] });
  }
  const win = K.node(root, [wallW / 2, 1.12, 0.45]); win.rotation.y = Math.PI / 2;
  K.box(win, [0.05, 0.04, 0.03], [0.6, 0.6, 0.18], [0, 0, -0.05]);
  K.box(win, P.emberHot, [0.48, 0.48, 0.04], [0, 0, 0.05], { emi: 0.9, unlit: true });
  K.box(win, P.woodDark, [0.06, 0.5, 0.06], [0, 0, 0.08]); K.box(win, P.woodDark, [0.5, 0.06, 0.06], [0, 0, 0.08]);
  K.box(win, P.woodLight, [0.66, 0.09, 0.1], [0, -0.32, 0.06]);
  for (const s of [-1, 1]) K.box(win, logB, [0.3, 0.62, 0.05], [s * 0.46, 0, 0.06], { rot: [0, s * 0.5, 0] });
  const cx = -0.5, cz = -(wallD / 2 + 0.25), chH = topY + roofH * 0.82;
  K.box(root, P.stoneDark, [0.5, chH, 0.5], [cx, chH / 2, cz]);
  K.box(root, P.stone, [0.6, 0.14, 0.6], [cx, chH - 0.05, cz]);
  K.box(root, P.stoneDark, [0.4, 0.12, 0.4], [cx, chH + 0.08, cz]);
  // équipement façade (en saillie devant les rondins)
  const fzz = dz + 0.3;
  K.cyl(root, P.woodDark, { h: 0.14, d: 0.04, t: 5 }, [-0.92, 1.55, dz + 0.18], { rot: [Math.PI / 2, 0, 0] });
  const bow = K.node(root, [-0.92, 1.18, fzz]);
  K.tor(bow, P.woodLight, { d: 0.8, thick: 0.045, t: 14 }, [0, 0, 0], { rot: [Math.PI / 2, 0, 0] });
  K.box(bow, P.bone, [0.025, 0.78, 0.025], [0, 0, 0]);
  for (let i = 0; i < 3; i++) { K.cyl(root, logB, { h: 0.72, d: 0.025, t: 4 }, [-0.58 + i * 0.05, 1.12, fzz], { rot: [0, 0, 0.04 * (i - 1)] }); K.cone(root, P.metal, { h: 0.08, d: 0.04, t: 4 }, [-0.58 + i * 0.05, 1.49, fzz]); }
  K.cyl(root, P.woodDark, { h: 0.14, d: 0.04, t: 5 }, [0.8, 1.5, dz + 0.18], { rot: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 2; i++) K.tor(root, P.hide, { d: 0.24, thick: 0.028, t: 12 }, [0.8 + i * 0.16, 1.28 - i * 0.05, fzz], { rot: [Math.PI / 2, 0, 0] });
  const horn = K.node(root, [1.08, 1.0, fzz]); horn.rotation.z = -0.5;
  K.cyl(horn, P.bone, { h: 0.44, dt: 0.05, db: 0.15, t: 6 }, [0, 0, 0]);
  K.cyl(horn, P.hide, { h: 0.12, d: 0.02, t: 4 }, [-0.02, 0.26, 0]);
  for (let i = 0; i < 2; i++) { const sp = K.node(root, [1.1 + 0.15 * i, 0, dz + 0.55]); sp.rotation.x = -0.2; K.cyl(sp, logB, { h: 2.1, d: 0.05, t: 6 }, [0, 1.05, 0]); K.cone(sp, P.metal, { h: 0.24, d: 0.09, t: 5 }, [0, 2.2, 0]); }
  // côté gauche : cadres à peaux + tas de fourrures
  for (let f = 0; f < 2; f++) {
    const fr = K.node(root, [-(wallW / 2 + 0.95), 0, 0.5 - f * 1.25]); fr.rotation.y = 0.22;
    for (const sx of [-1, 1]) K.cyl(fr, logB, { h: 1.7, d: 0.06, t: 6 }, [sx * 0.55, 0.85, 0]);
    K.cyl(fr, logB, { h: 1.24, d: 0.06, t: 6 }, [0, 1.6, 0], { rot: [0, 0, Math.PI / 2] });
    K.cyl(fr, logB, { h: 1.24, d: 0.06, t: 6 }, [0, 0.18, 0], { rot: [0, 0, Math.PI / 2] });
    K.box(fr, f === 0 ? P.fur : P.hide, [0.92, 1.25, 0.04], [0, 0.9, 0]);
    for (let i = 0; i < 4; i++) { const yy = 0.5 + i * 0.3; K.cyl(fr, P.bone, { h: 0.14, d: 0.02, t: 4 }, [-0.46, yy, 0.03], { rot: [0, 0, Math.PI / 2] }); K.cyl(fr, P.bone, { h: 0.14, d: 0.02, t: 4 }, [0.46, yy, 0.03], { rot: [0, 0, Math.PI / 2] }); }
  }
  const pile = K.node(root, [-(wallW / 2 + 0.62), 0, 1.4]);
  const ft = [P.fur, P.hide, [0.46, 0.34, 0.24]];
  const folds = [[0, 0.16, 0, 0.82], [0.06, 0.34, 0.04, 0.72], [-0.04, 0.5, -0.02, 0.6]];
  folds.forEach((fo, i) => { const m = K.ico(pile, ft[i], { d: fo[3], sub: 1 }, [fo[0], fo[1], fo[2]]); m.scaling.set(1.18, 0.4, 0.96); });
  const drape = K.node(pile, [0.05, 0.62, 0.04]);
  const body = K.ico(drape, P.fur, { d: 0.62, sub: 1 }, [0, 0, 0]); body.scaling.set(1.12, 0.26, 0.84);
  K.ico(drape, P.fur, { d: 0.2, seg: 5 }, [0, 0.03, 0.4]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box(drape, P.hide, [0.08, 0.05, 0.18], [sx * 0.26, -0.04, sz * 0.24]);
  K.cyl(drape, P.hide, { h: 0.26, d: 0.05, t: 5 }, [0, 0.0, -0.42], { rot: [Math.PI / 2, 0, 0] });
  // côté droit : séchoir + gibier + billot + hache (tête plantée, manche en l'air)
  const drN = K.node(root, [wallW / 2 + 0.95, 0, -0.55]);
  for (const sz of [-1, 1]) K.cyl(drN, logB, { h: 1.9, d: 0.07, t: 6 }, [0, 0.95, sz * 0.7]);
  K.cyl(drN, logB, { h: 1.7, d: 0.06, t: 6 }, [0, 1.85, 0], { rot: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 4; i++) K.box(drN, P.meat, [0.16, 0.34, 0.08], [0, 1.62, -0.5 + i * 0.34]);
  const game = K.node(drN, [0, 1.5, 0.6]);
  K.cyl(game, P.fur, { h: 0.5, dt: 0.14, db: 0.22, t: 6 }, [0, -0.05, 0]);
  K.sph(game, P.fur, { d: 0.24, seg: 6 }, [0, -0.32, 0]);
  for (const s of [-1, 1]) K.cyl(game, P.hide, { h: 0.18, d: 0.02 }, [s * 0.04, 0.26, 0]);
  const blk = K.node(root, [wallW / 2 + 0.8, 0, 0.95]);
  K.cyl(blk, P.trunk, { h: 0.55, dt: 0.5, db: 0.56, t: 9 }, [0, 0.27, 0]);
  K.cyl(blk, P.woodLight, { h: 0.06, d: 0.48, t: 9 }, [0, 0.55, 0]);
  const axe = K.node(blk, [0.08, 0.55, 0]); axe.rotation.z = 0.32;
  K.box(axe, P.metalDark, [0.14, 0.16, 0.14], [0, 0.02, 0]);
  K.box(axe, P.metal, [0.08, 0.26, 0.06], [0.13, 0.0, 0]);
  K.cyl(axe, P.woodLight, { h: 0.62, d: 0.045, t: 6 }, [-0.02, 0.36, 0]);
  return [cx, chH + 0.22, cz];
}

// --- FUMOIR : cabanon en planches verticales, toit pignon + évent fumant, claies viande/poisson. ---
function buildSmokehouse(K: Kit, root: TransformNode): number[] {
  const W = 1.7, D = 1.5, H = 2.2, FND = 0.28, topY = FND + H;
  const plankC = [0.32, 0.24, 0.16], plankD = [0.24, 0.17, 0.12], roofC = [0.26, 0.2, 0.14], dark = [0.05, 0.04, 0.03];
  K.box(root, P.stone, [W + 0.22, FND, D + 0.22], [0, FND / 2, 0]);
  K.box(root, plankD, [W - 0.06, H, D - 0.06], [0, FND + H / 2, 0]);
  const pw = 0.26, nx = Math.round(W / pw), nz = Math.round(D / pw);
  for (let i = 0; i < nx; i++) { const x = -W / 2 + pw / 2 + i * pw; K.box(root, i % 2 ? plankC : plankD, [pw * 0.9, H, 0.05], [x, FND + H / 2, D / 2]); K.box(root, i % 2 ? plankD : plankC, [pw * 0.9, H, 0.05], [x, FND + H / 2, -D / 2]); }
  for (let i = 0; i < nz; i++) { const z = -D / 2 + pw / 2 + i * pw; K.box(root, i % 2 ? plankC : plankD, [0.05, H, pw * 0.9], [W / 2, FND + H / 2, z]); K.box(root, i % 2 ? plankD : plankC, [0.05, H, pw * 0.9], [-W / 2, FND + H / 2, z]); }
  K.box(root, P.woodDark, [W + 0.12, 0.12, D + 0.12], [0, topY, 0]);
  const roofH = 1.0, roofBaseY = topY + 0.06;
  K.gableRoof(root, roofC, { w: D, dp: W + 0.5, h: roofH }, [0, roofBaseY, 0], { rot: [0, Math.PI / 2, 0] });
  K.cyl(root, P.woodDark, { h: D + 0.1, d: 0.12, t: 6 }, [0, roofBaseY + roofH, 0], { rot: [Math.PI / 2, 0, 0] });
  K.box(root, roofC, [0.5, 0.26, 0.42], [0, roofBaseY + roofH + 0.05, 0]);
  K.box(root, dark, [0.4, 0.12, 0.32], [0, roofBaseY + roofH + 0.02, 0]);
  K.box(root, roofC, [0.58, 0.08, 0.5], [0, roofBaseY + roofH + 0.2, 0]);
  const fz = D / 2;
  K.box(root, dark, [0.82, 1.5, 0.16], [0, FND + 0.82, fz + 0.02]);
  K.box(root, P.woodLight, [0.1, 1.6, 0.1], [-0.46, FND + 0.85, fz + 0.06]);
  K.box(root, P.woodLight, [0.1, 1.6, 0.1], [0.46, FND + 0.85, fz + 0.06]);
  K.box(root, P.woodLight, [1.02, 0.12, 0.1], [0, FND + 1.6, fz + 0.06]);
  const door = K.node(root, [0.46, FND + 0.78, fz + 0.07]); door.rotation.y = 1.15;
  for (let i = 0; i < 3; i++) K.box(door, plankC, [0.24, 1.42, 0.05], [-0.12 - i * 0.24, 0, 0]);
  K.box(door, P.metalDark, [0.06, 0.1, 0.04], [-0.62, 0.0, 0.04]);
  for (const py of [FND + 1.42, FND + 0.92]) K.cyl(root, P.woodLight, { h: 0.78, d: 0.04, t: 5 }, [0, py, fz + 0.04], { rot: [0, 0, Math.PI / 2] });
  for (const mx of [-0.22, 0.0, 0.22]) K.box(root, P.meat, [0.13, 0.3, 0.07], [mx, FND + 1.22, fz + 0.04]);
  for (const fx of [-0.18, 0.2]) { const fn = K.node(root, [fx, FND + 0.7, fz + 0.04]); K.cyl(fn, [0.55, 0.56, 0.6], { h: 0.34, dt: 0.05, db: 0.16, t: 6 }, [0, 0, 0], { rot: [Math.PI, 0, 0] }); K.cone(fn, [0.5, 0.5, 0.55], { h: 0.12, d: 0.18, t: 5 }, [0, 0.2, 0], { rot: [Math.PI, 0, 0] }); }
  K.box(root, P.stoneDark, [0.7, 0.36, 0.34], [0, 0.18, fz + 0.18]);
  K.box(root, P.ember, [0.42, 0.16, 0.12], [0, 0.16, fz + 0.36], { emi: 1.0, unlit: true });
  for (let i = 0; i < 3; i++) K.box(root, P.stoneDark, [0.16, 0.14, 0.16], [-0.28 + i * 0.28, 0.4, fz + 0.12]);
  const wood = K.node(root, [-(W / 2 + 0.32), 0, -0.1]);
  for (let i = 0; i < 3; i++) K.cyl(wood, P.trunk, { h: 0.9, d: 0.18, t: 7 }, [0, 0.12, -0.28 + i * 0.28], { rot: [0, 0, Math.PI / 2] });
  for (let i = 0; i < 2; i++) K.cyl(wood, P.trunk, { h: 0.9, d: 0.18, t: 7 }, [0, 0.31, -0.14 + i * 0.28], { rot: [0, 0, Math.PI / 2] });
  return [0, roofBaseY + roofH + 0.28, 0];
}

// --- ACIÉRIE : forge à l'air libre, fourneau + cheminée, soufflet, enclume, trempe, charbon/minerai. ---
function buildSteelworks(K: Kit, root: TransformNode): number[] {
  const stone = P.stone, sd = P.stoneDark;
  K.box(root, sd, [3.2, 0.25, 2.4], [0, 0.125, 0]);
  K.box(root, sd, [1.5, 1.0, 1.3], [0, 0.5, -0.55]);
  K.cyl(root, stone, { h: 1.7, dt: 0.62, db: 1.0, t: 8 }, [0, 1.85, -0.55]);
  K.cyl(root, sd, { h: 1.0, dt: 0.5, db: 0.6, t: 8 }, [0, 3.1, -0.55]);
  K.cyl(root, P.ember, { h: 0.12, d: 0.42, t: 8 }, [0, 3.62, -0.55], { emi: 1.2, unlit: true });
  K.box(root, sd, [0.7, 0.6, 0.16], [0, 0.55, 0.1]);
  K.box(root, P.ember, [0.46, 0.42, 0.14], [0, 0.52, 0.16], { emi: 1.2, unlit: true });
  K.box(root, P.emberHot, [0.66, 0.06, 0.5], [0, 0.28, 0.45], { emi: 1.0, unlit: true });
  K.box(root, P.woodDark, [0.34, 0.54, 0.42], [-1.05, 0.27, -0.55]);
  const bel = K.node(root, [-1.05, 0.72, -0.55]);
  K.box(bel, P.woodDark, [0.8, 0.06, 0.5], [0, 0.16, 0]);
  K.box(bel, P.woodDark, [0.8, 0.06, 0.5], [0, -0.16, 0]);
  K.box(bel, P.hide, [0.68, 0.28, 0.42], [0, 0, 0]);
  K.cyl(bel, P.metalDark, { h: 0.62, d: 0.1, t: 6 }, [0.5, 0, 0], { rot: [0, 0, Math.PI / 2] });
  K.cyl(bel, P.woodLight, { h: 0.5, d: 0.05 }, [-0.42, 0.34, 0], { rot: [0, 0, 0.4] });
  const blk = K.node(root, [1.15, 0, 0.55]);
  K.cyl(blk, P.trunk, { h: 0.55, dt: 0.5, db: 0.56, t: 9 }, [0, 0.27, 0]);
  K.box(blk, P.metalDark, [0.46, 0.16, 0.24], [0, 0.63, 0]);
  K.box(blk, P.metal, [0.6, 0.1, 0.28], [0, 0.74, 0]);
  K.cone(blk, P.metal, { h: 0.3, d: 0.2, t: 6 }, [0.42, 0.74, 0], { rot: [0, 0, Math.PI / 2] });
  K.cyl(blk, P.woodLight, { h: 0.42, d: 0.04, t: 5 }, [-0.05, 0.86, 0.14], { rot: [0.4, 0, 0] });
  K.box(blk, P.metalDark, [0.16, 0.1, 0.1], [-0.05, 1.0, 0.2]);
  K.cyl(blk, P.metalDark, { h: 0.5, d: 0.03, t: 5 }, [0.25, 0.5, 0.3], { rot: [0.5, 0, 0.2] });
  const q = K.node(root, [1.55, 0, -0.45]);
  K.cyl(q, P.wood, { h: 0.5, dt: 0.46, db: 0.5, t: 10 }, [0, 0.25, 0]);
  K.tor(q, P.metalDark, { d: 0.52, thick: 0.04, t: 12 }, [0, 0.38, 0]);
  K.cyl(q, P.water, { h: 0.04, d: 0.42, t: 10 }, [0, 0.49, 0], { emi: 0.12 });
  const coal = K.node(root, [-1.05, 0, 0.7]);
  K.ico(coal, P.coal, { d: 0.62 }, [0, 0.22, 0]); K.ico(coal, P.coal, { d: 0.5 }, [0.32, 0.18, 0.06]); K.ico(coal, P.coal, { d: 0.42 }, [-0.24, 0.16, 0.2]);
  const ore = K.node(root, [-1.5, 0, 0.0]);
  K.ico(ore, P.rust, { d: 0.52 }, [0, 0.2, 0]); K.ico(ore, P.rust, { d: 0.4 }, [0.28, 0.16, 0.06]);
  for (let i = 0; i < 3; i++) K.box(root, P.metal, [0.5, 0.1, 0.16], [0.45, 0.31 + i * 0.11, 1.0], { rot: [0, 0.2, 0] });
  return [0, 3.7, -0.55];
}

// --- POSTE DE TRAITE : plancher, auvent, comptoir, étagère de stock, marchandises, balance, fanion. ---
function buildTradingPost(K: Kit, root: TransformNode): null {
  const wood = P.wood, wd = P.woodDark, wl = P.woodLight, toile = [0.5, 0.42, 0.3], toileDk = [0.44, 0.37, 0.27];
  const baseY = 0.16, HB = 2.0, HF = 1.5, yB = baseY + HB, yF = baseY + HF;
  K.box(root, wd, [3.0, 0.16, 2.0], [0, 0.08, 0]);
  for (let i = 0; i < 7; i++) K.box(root, i % 2 ? wood : wd, [0.4, 0.04, 1.96], [-1.28 + i * 0.43, 0.17, 0]);
  for (const x of [-1.35, 1.35]) { K.cyl(root, wd, { h: HB, d: 0.1 }, [x, baseY + HB / 2, -0.85]); K.cyl(root, wd, { h: HF, d: 0.1 }, [x, baseY + HF / 2, 0.85]); }
  K.box(root, toile, [2.85, 0.08, 2.0], [0, (yB + yF) / 2 + 0.03, 0], { rot: [0.285, 0, 0] });
  K.box(root, toileDk, [2.85, 0.22, 0.05], [0, yF - 0.06, 0.99]);
  K.box(root, wood, [2.5, 0.78, 0.5], [0, baseY + 0.39, 0.5]);
  K.box(root, wl, [2.64, 0.12, 0.6], [0, baseY + 0.84, 0.5]);
  const top = baseY + 0.9;
  for (const x of [-1.05, 1.05]) K.cyl(root, wd, { h: 1.5, d: 0.07 }, [x, baseY + 0.75, -0.9]);
  for (const sy of [0.58, 1.08]) K.box(root, wl, [2.2, 0.06, 0.4], [0, baseY + sy, -0.9]);
  K.box(root, wood, [0.5, 0.32, 0.34], [-0.7, baseY + 0.77, -0.9]);
  K.box(root, P.fur, [0.5, 0.26, 0.34], [0.1, baseY + 0.74, -0.9]);
  for (let i = 0; i < 3; i++) K.cyl(root, [0.5, 0.42, 0.34], { h: 0.28, d: 0.16, t: 8 }, [0.6 + i * 0.2, baseY + 0.73, -0.9]);
  K.box(root, P.hide, [0.42, 0.26, 0.32], [-0.7, baseY + 1.27, -0.9]);
  K.cyl(root, P.banner, { h: 0.36, d: 0.2, t: 8 }, [0.1, baseY + 1.27, -0.9], { rot: [Math.PI / 2, 0, 0] });
  K.box(root, P.fur, [0.5, 0.12, 0.4], [-0.85, top + 0.06, 0.5]); K.box(root, P.hide, [0.46, 0.1, 0.38], [-0.85, top + 0.17, 0.5]);
  K.box(root, wood, [0.4, 0.34, 0.4], [-0.12, top + 0.17, 0.5]); K.box(root, wl, [0.42, 0.05, 0.42], [-0.12, top + 0.36, 0.5]);
  K.cyl(root, [0.3, 0.24, 0.18], { h: 0.4, dt: 0.32, db: 0.28, t: 10 }, [0.5, top + 0.2, 0.5]); K.tor(root, P.metalDark, { d: 0.34, thick: 0.03, t: 12 }, [0.5, top + 0.2, 0.5]);
  const bsk = K.node(root, [1.05, top, 0.5]); K.cyl(bsk, [0.45, 0.36, 0.24], { h: 0.22, dt: 0.36, db: 0.26, t: 10 }, [0, 0.11, 0]); for (let i = 0; i < 5; i++) { const a = i / 5 * 6.283; K.sph(bsk, [0.62, 0.42, 0.3], { d: 0.15, seg: 5 }, [Math.cos(a) * 0.1, 0.24, Math.sin(a) * 0.1]); }
  K.cyl(root, P.metalDark, { h: 0.28, d: 0.025 }, [-0.5, yF - 0.18, 0.92]);
  K.cyl(root, wd, { h: 0.5, d: 0.04 }, [-0.5, yF - 0.32, 0.92], { rot: [0, 0, Math.PI / 2] });
  for (const s of [-1, 1]) { K.cyl(root, P.metalDark, { h: 0.1, d: 0.015 }, [-0.5 + s * 0.22, yF - 0.38, 0.92]); K.cyl(root, P.metal, { h: 0.04, dt: 0.18, db: 0.05, t: 10 }, [-0.5 + s * 0.22, yF - 0.44, 0.92]); }
  for (let i = 0; i < 2; i++) K.cone(root, P.dryBrush, { h: 0.32, d: 0.16, t: 6 }, [0.35 + i * 0.28, yF - 0.22, 0.92], { rot: [Math.PI, 0, 0] });
  const lant = K.node(root, [1.0, yF - 0.26, 0.92]); K.box(lant, P.metalDark, [0.13, 0.18, 0.13], [0, 0, 0]); K.box(lant, P.emberHot, [0.08, 0.12, 0.08], [0, 0, 0], { emi: 1.0, unlit: true });
  K.cyl(root, wl, { h: 0.5, d: 0.04 }, [1.35, yF + 0.28, 0.85]); K.box(root, P.banner, [0.05, 0.36, 0.42], [1.35, yF + 0.34, 1.06]);
  const st = K.node(root, [0.0, baseY, -0.05]); K.cyl(st, wood, { h: 0.06, d: 0.42, t: 10 }, [0, 0.46, 0]); for (let i = 0; i < 3; i++) { const a = i / 3 * 6.283 + 0.4; K.cyl(st, wd, { h: 0.46, d: 0.05 }, [Math.cos(a) * 0.14, 0.23, Math.sin(a) * 0.14]); }
  return null;
}

// --- ATELIER : appentis, établi + étau, mur d'outils, chevalet, meule, pile de planches. ---
function buildWorkshop(K: Kit, root: TransformNode): null {
  const wood = P.wood, wd = P.woodDark, wl = P.woodLight, roofC = P.roof, FND = 0.14;
  K.box(root, wd, [3.0, FND, 2.2], [0, FND / 2, 0]);
  K.box(root, wd, [2.9, 2.0, 0.14], [0, FND + 1.0, -1.0]);
  const pw = 0.29, nb = Math.round(2.9 / pw);
  for (let i = 0; i < nb; i++) K.box(root, i % 2 ? wood : wd, [pw * 0.9, 2.0, 0.05], [-1.45 + pw / 2 + i * pw, FND + 1.0, -0.92]);
  for (const sx of [-1, 1]) K.box(root, wd, [0.12, 1.5, 1.4], [sx * 1.45, FND + 0.75, -0.35]);
  for (const sx of [-1, 1]) K.cyl(root, wd, { h: 1.6, d: 0.12, t: 7 }, [sx * 1.4, FND + 0.8, 1.0]);
  K.box(root, roofC, [3.1, 0.12, 2.45], [0, FND + 1.86, -0.02], { rot: [0.183, 0, 0] });
  for (let i = 0; i < 5; i++) K.box(root, wd, [0.05, 0.1, 2.4], [-1.3 + i * 0.65, FND + 1.9, -0.02], { rot: [0.183, 0, 0] });
  const bz = -0.45, by = FND + 0.82;
  K.box(root, wood, [1.7, 0.12, 0.6], [-0.2, by, bz]);
  for (const lx of [-0.9, 0.5]) for (const lz of [-0.65, -0.25]) K.cyl(root, wd, { h: by - FND, d: 0.09 }, [lx, FND + (by - FND) / 2, lz]);
  K.box(root, P.metalDark, [0.2, 0.18, 0.24], [-0.92, by + 0.13, bz + 0.26]);
  K.box(root, P.metal, [0.06, 0.18, 0.24], [-0.8, by + 0.13, bz + 0.26]);
  K.cyl(root, P.metalDark, { h: 0.32, d: 0.04 }, [-0.74, by + 0.11, bz + 0.26], { rot: [0, 0, Math.PI / 2] });
  K.box(root, wl, [0.5, 0.08, 0.3], [0.15, by + 0.1, bz + 0.06], { rot: [0, 0.2, 0] });
  const tw = -0.88;
  K.box(root, wd, [1.9, 0.72, 0.04], [-0.1, FND + 1.45, tw]);
  K.box(root, P.metal, [0.55, 0.16, 0.02], [-0.72, FND + 1.52, tw + 0.04]); K.box(root, wl, [0.55, 0.05, 0.03], [-0.72, FND + 1.6, tw + 0.05]);
  K.cyl(root, wl, { h: 0.3, d: 0.04 }, [0.05, FND + 1.4, tw + 0.05]); K.box(root, P.metalDark, [0.15, 0.08, 0.07], [0.05, FND + 1.56, tw + 0.06]);
  K.box(root, P.metalDark, [0.04, 0.34, 0.03], [0.52, FND + 1.46, tw + 0.05]); K.box(root, P.metalDark, [0.22, 0.04, 0.03], [0.62, FND + 1.31, tw + 0.05]);
  for (let i = 0; i < 3; i++) { K.cyl(root, wl, { h: 0.16, d: 0.03, t: 5 }, [0.85 + i * 0.13, FND + 1.42, tw + 0.05]); K.cyl(root, P.metal, { h: 0.12, d: 0.025, t: 5 }, [0.85 + i * 0.13, FND + 1.29, tw + 0.05]); }
  const ch = K.node(root, [0.9, 0, 0.5]);
  for (const sz of [-0.2, 0.2]) for (const sx of [-1, 1]) K.cyl(ch, wd, { h: 0.74, d: 0.07 }, [sx * 0.26, 0.34, sz], { rot: [0, 0, sx * 0.5] });
  K.cyl(ch, wd, { h: 0.86, d: 0.07 }, [0, 0.64, 0], { rot: [Math.PI / 2, 0, 0] });
  K.box(ch, wl, [0.42, 0.06, 1.0], [0, 0.7, 0], { rot: [0, 0.12, 0] });
  const gr = K.node(root, [1.3, 0, -0.45]);
  for (const sx of [-1, 1]) K.cyl(gr, wd, { h: 0.72, d: 0.07 }, [sx * 0.18, 0.36, 0], { rot: [0, 0, sx * 0.18] });
  K.cyl(gr, wd, { h: 0.5, d: 0.05 }, [0, 0.72, 0], { rot: [0, 0, Math.PI / 2] });
  K.cyl(gr, P.stone, { h: 0.1, d: 0.5, t: 12 }, [0, 0.72, 0], { rot: [0, 0, Math.PI / 2] });
  K.cyl(gr, P.metalDark, { h: 0.14, d: 0.04 }, [0.2, 0.8, 0]); K.cyl(gr, wl, { h: 0.14, d: 0.03 }, [0.2, 0.86, 0.07], { rot: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 4; i++) K.box(root, i % 2 ? wl : wood, [0.42, 0.07, 1.3], [-1.15, FND + 0.05 + i * 0.08, 0.5], { rot: [0, 0.08, 0] });
  const bar = K.node(root, [-1.32, 0, -0.35]); K.cyl(bar, wood, { h: 0.5, dt: 0.34, db: 0.3, t: 9 }, [0, 0.25, 0]); K.tor(bar, P.metalDark, { d: 0.36, thick: 0.03, t: 10 }, [0, 0.4, 0]);
  for (let i = 0; i < 3; i++) K.box(bar, wl, [0.05, 0.45, 0.05], [-0.06 + i * 0.06, 0.6, 0], { rot: [0.12, 0, 0.1 * (i - 1)] });
  return null;
}

// --- ARMURERIE : bâtisse fortifiée, contreforts, porte bardée, mousquets, poudre, fonte des balles. ---
function buildArmoury(K: Kit, root: TransformNode): null {
  const tim = [0.27, 0.22, 0.17], wd = P.woodDark, wl = P.woodLight, stone = P.stone, sd = P.stoneDark;
  const W = 2.6, D = 2.0, H = 1.7, FND = 0.28, topY = FND + H, dz = D / 2;
  K.box(root, sd, [W + 0.3, FND, D + 0.3], [0, FND / 2, 0]);
  K.box(root, tim, [W, H, D], [0, FND + H / 2, 0]);
  for (let i = 0; i < 4; i++) { const y = FND + 0.28 + i * 0.42; K.cyl(root, i % 2 ? wd : tim, { h: W + 0.08, d: 0.22, t: 6 }, [0, y, dz], { rot: [0, 0, Math.PI / 2] }); K.cyl(root, i % 2 ? wd : tim, { h: W + 0.08, d: 0.22, t: 6 }, [0, y, -dz], { rot: [0, 0, Math.PI / 2] }); }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box(root, stone, [0.34, topY + 0.1, 0.34], [sx * (W / 2), (topY + 0.1) / 2, sz * (D / 2)]);
  K.box(root, P.roof2, [W + 0.5, 0.34, D + 0.5], [0, topY + 0.17, 0]);
  for (let i = 0; i < 4; i++) K.box(root, wd, [0.12, 0.1, D + 0.54], [-0.95 + i * 0.63, topY + 0.36, 0]);
  K.box(root, [0.05, 0.04, 0.03], [0.84, 1.4, 0.16], [0, FND + 0.7, dz + 0.03]);
  K.box(root, wd, [0.76, 1.34, 0.1], [0, FND + 0.69, dz + 0.1]);
  for (const by of [FND + 0.35, FND + 1.0]) K.box(root, P.metalDark, [0.8, 0.1, 0.05], [0, by, dz + 0.16]);
  for (const bx of [-0.28, 0.28]) K.box(root, P.metalDark, [0.1, 0.52, 0.05], [bx, FND + 0.69, dz + 0.16]);
  K.cyl(root, P.metal, { h: 0.1, d: 0.1, t: 8 }, [0.22, FND + 0.69, dz + 0.21], { rot: [Math.PI / 2, 0, 0] });
  K.box(root, wl, [0.94, 0.14, 0.12], [0, FND + 1.4, dz + 0.1]);
  K.box(root, stone, [1.0, 0.16, 0.4], [0, 0.08, dz + 0.28]);
  const win = K.node(root, [0.86, FND + 1.0, dz + 0.04]);
  K.box(win, [0.04, 0.03, 0.02], [0.42, 0.42, 0.1], [0, 0, 0]);
  for (let i = 0; i < 3; i++) K.cyl(win, P.metalDark, { h: 0.44, d: 0.03, t: 5 }, [-0.14 + i * 0.14, 0, 0.06]);
  K.box(win, wd, [0.52, 0.09, 0.1], [0, 0.25, 0.04]); K.box(win, wd, [0.52, 0.09, 0.1], [0, -0.25, 0.04]);
  const rk = K.node(root, [W / 2 - 0.02, 0, -0.15]);
  K.box(rk, wd, [0.1, 1.1, 1.3], [0.06, FND + 0.55, 0]);
  K.box(rk, wd, [0.18, 0.08, 1.3], [0.16, FND + 1.0, 0]);
  for (let i = 0; i < 4; i++) { const z = -0.45 + i * 0.3; K.cyl(rk, P.metalDark, { h: 1.2, d: 0.04, t: 5 }, [0.22, FND + 0.62, z], { rot: [0.12, 0, 0] }); K.box(rk, wd, [0.1, 0.28, 0.1], [0.22, FND + 0.13, z + 0.07], { rot: [0.12, 0, 0] }); }
  for (const [x, z] of [[-1.55, 0.5], [-1.55, -0.1], [-1.18, 0.2]] as const) { const b = K.node(root, [x, 0, z]); K.cyl(b, [0.26, 0.2, 0.15], { h: 0.6, dt: 0.42, db: 0.36, t: 9 }, [0, 0.3, 0]); K.tor(b, P.metalDark, { d: 0.44, thick: 0.04, t: 12 }, [0, 0.18, 0]); K.tor(b, P.metalDark, { d: 0.44, thick: 0.04, t: 12 }, [0, 0.46, 0]); K.cyl(b, P.dark, { h: 0.04, d: 0.34, t: 9 }, [0, 0.6, 0]); K.box(b, P.bone, [0.16, 0.16, 0.02], [0, 0.32, 0.21]); }
  const cast = K.node(root, [1.75, 0, 0.6]);
  K.box(cast, sd, [0.6, 0.5, 0.5], [0, 0.25, 0]);
  K.box(cast, P.ember, [0.34, 0.16, 0.3], [0, 0.2, 0.06], { emi: 1.0, unlit: true });
  K.cyl(cast, P.metalDark, { h: 0.2, dt: 0.26, db: 0.18, t: 10 }, [0, 0.6, 0]);
  K.cyl(cast, P.emberHot, { h: 0.04, d: 0.2, t: 10 }, [0, 0.7, 0], { emi: 1.1, unlit: true });
  K.cyl(cast, P.metalDark, { h: 0.42, d: 0.03, t: 5 }, [0.32, 0.6, 0], { rot: [0, 0, 1.0] });
  for (let i = 0; i < 3; i++) K.box(cast, P.metalDark, [0.3, 0.07, 0.1], [0.42, 0.05 + i * 0.08, -0.32], { rot: [0, 0.2, 0] });
  const pail = K.node(cast, [-0.52, 0, -0.28]); K.cyl(pail, P.metalDark, { h: 0.22, dt: 0.18, db: 0.14, t: 9 }, [0, 0.11, 0]); for (let i = 0; i < 5; i++) { const a = i / 5 * 6.283; K.sph(pail, P.metal, { d: 0.06, seg: 4 }, [Math.cos(a) * 0.05, 0.23, Math.sin(a) * 0.05]); }
  K.box(root, P.wood, [0.5, 0.3, 0.4], [-0.6, 0.15, dz + 0.5]); K.box(root, wd, [0.52, 0.05, 0.42], [-0.6, 0.32, dz + 0.5]);
  K.box(root, P.wood, [0.4, 0.26, 0.34], [-0.55, 0.45, dz + 0.5], { rot: [0, 0.3, 0] });
  return null;
}

export class Village {
  private readonly K: Kit;
  private readonly spawned: Record<string, number> = {};
  // Positions (x,z) des bâtiments construits, par type et dans l'ordre de création.
  private readonly buildingPositions: Record<string, Array<{ x: number; z: number }>> = {};
  // Racines des bâtiments construits (pour les masquer pendant l'édition du spawn).
  private readonly roots: TransformNode[] = [];
  private hidden = false; // village masqué (éditeur) : sync respecte cet état pour tout nouveau root
  // Feedback : fumée des bâtiments en activité (par id) + proies dans les pièges « pleins ».
  private readonly smoke: Array<{ id: string; node: TransformNode; puffs: Mesh[] }> = [];
  // Pièges : chaque entrée porte les DEUX états (armé / refermé sur une prise).
  private readonly traps: Array<{ armed: TransformNode; sprung: TransformNode }> = [];
  private activeIds = new Set<string>();
  private time = 0;

  constructor(private readonly scene: Scene) {
    this.K = makeKit(scene);
  }

  /** Positions (x,z) des pièges construits — pour la détection d'interaction. */
  getTrapPositions(): Array<{ x: number; z: number }> {
    return this.buildingPositions["trap"] ?? [];
  }

  /** Positions (x,z) des bâtiments d'un type donné (ex. pour y faire travailler les villageois). */
  getBuildingPositions(id: string): Array<{ x: number; z: number }> {
    return this.buildingPositions[id] ?? [];
  }

  /** Emprises (cercle x,z,r) des bâtiments construits — pour l'évitement des villageois.
   *  Les pièges sont franchissables (au ras du sol) -> exclus. Voir villagers.ts. */
  getObstacles(): Array<{ x: number; z: number; r: number }> {
    const out: Array<{ x: number; z: number; r: number }> = [];
    for (const id of Object.keys(this.buildingPositions)) {
      const r = OBSTACLE_RADIUS[id] ?? 1.8;
      if (r <= 0) continue;
      for (const p of this.buildingPositions[id]) out.push({ x: p.x, z: p.z, r });
    }
    return out;
  }

  /** Bâtiments dont le métier a produit ce cycle -> fumée (cheminée). */
  setActivity(active: Set<string>): void {
    this.activeIds = active;
    for (const s of this.smoke) s.node.setEnabled(active.has(s.id));
  }

  /** Bascule chaque piège entre ARMÉ et REFERMÉ-SUR-PRISE selon qu'il est relevable. */
  setTrapsReady(readyIndices: Set<number>): void {
    this.traps.forEach((t, i) => {
      const ready = readyIndices.has(i);
      t.armed.setEnabled(!ready);
      t.sprung.setEnabled(ready);
    });
  }

  /** Anime la fumée des bâtiments actifs (visuel uniquement). */
  update(dtSec: number): void {
    this.time += dtSec;
    for (const s of this.smoke) {
      if (!this.activeIds.has(s.id)) continue;
      s.puffs.forEach((p, i) => {
        const t = (this.time * 0.5 + i * 0.34) % 1; // 0 -> 1 (montée)
        p.position.y = t * 1.4;
        p.scaling.setAll(0.35 + 0.6 * (1 - t)); // se dissipe en montant
      });
    }
  }

  /** Cheminée fumante (masquée tant que le métier ne produit pas). */
  private addSmoke(id: string, root: TransformNode, pos: number[]): void {
    const node = this.K.node(root, pos);
    node.setEnabled(false);
    const puffs: Mesh[] = [];
    for (let i = 0; i < 3; i++)
      puffs.push(this.K.sph(node, [0.5, 0.5, 0.52], { d: 0.35, seg: 5 }, [0, i * 0.45, 0], { alpha: 0.5, unlit: true, emi: 0.6, smooth: true }));
    this.smoke.push({ id, node, puffs });
  }

  /** Crée les meshes manquants pour refléter la map `buildings` de la sim. Chaque exemplaire
   *  se pose à son ANCRE FIXE (campLayout) et regarde le feu (sauf `face` explicite). */
  sync(buildings: Record<string, number>): void {
    for (const c of craftables) {
      const target = buildings[c.id] ?? 0;
      let have = this.spawned[c.id] ?? 0;
      const anchors = campLayout.buildings[c.id];
      while (have < target) {
        const anchor = anchors?.[have];
        const x = anchor?.x ?? ringSlot(SLOT_OFFSET[c.id] + have).x;
        const z = anchor?.z ?? ringSlot(SLOT_OFFSET[c.id] + have).z;
        const root = this.makeBuilding(c.id, x, z);
        root.rotation.y = anchor ? faceYaw(x, z, anchor.face) : (have * 1.3) % (Math.PI * 2);
        if (this.hidden) root.setEnabled(false); // respecte l'état masqué (édition en cours)
        (this.buildingPositions[c.id] ??= []).push({ x, z });
        this.roots.push(root);
        this.addCollider(c.id, x, z); // le joueur ne traverse plus le bâtiment (pièges exclus)
        have++;
      }
      this.spawned[c.id] = have;
    }
  }

  /** Affiche/masque TOUS les bâtiments construits (utilisé par l'éditeur de spawn). */
  setVisible(v: boolean): void {
    this.hidden = !v;
    for (const r of this.roots) r.setEnabled(v);
  }

  /** ÉDITEUR : instancie un modèle ISOLÉ d'un type (hors sync), pour l'outil de layout.
   *  On restaure les listes fumée/pièges : un ghost ne doit ni fumer ni s'armer. */
  spawnModel(id: string, x: number, z: number, rotY: number): TransformNode {
    const s = this.smoke.length, t = this.traps.length;
    const root = this.makeBuilding(id, x, z);
    this.smoke.length = s;
    this.traps.length = t;
    root.rotation.y = rotY;
    return root;
  }

  /** Collider statique (cylindre invisible) d'un bâtiment -> le joueur le contourne, comme les
   *  arbres et les murs de la cabane. Les pièges (rayon 0, au ras du sol) restent franchissables. */
  private addCollider(id: string, x: number, z: number): void {
    const r = OBSTACLE_RADIUS[id] ?? 1.8;
    if (r <= 0) return;
    const col = MeshBuilder.CreateCylinder(`bcol-${id}`, { height: COLLIDER_H, diameter: r * 2, tessellation: 8 }, this.scene);
    col.position.set(x, terrainHeight(x, z) + COLLIDER_H / 2, z);
    col.isVisible = false;
    new PhysicsAggregate(col, PhysicsShapeType.CYLINDER, { mass: 0 }, this.scene);
  }

  // --------------------------------------------------------------------------
  //  Modèles (portés du labo). `root` est posé sur le terrain ; tout est local.
  // --------------------------------------------------------------------------
  private makeBuilding(id: string, x: number, z: number): TransformNode {
    const K = this.K;
    const root = K.node(null, [x, terrainHeight(x, z), z]);

    switch (id) {
      case "hut": {
        // Habitation paramétrée + variété déterministe (ronde / pyramidale / croupe).
        const smoke = buildHut(K, root, hutVariantFor(x, z));
        this.addSmoke(id, root, smoke);
        break;
      }
      case "cart": {
        K.box(root, P.wood, [0.92, 0.42, 1.5], [0, 0.6, 0]);
        K.box(root, P.woodDark, [0.07, 0.34, 1.5], [-0.45, 0.88, 0]);
        K.box(root, P.woodDark, [0.07, 0.34, 1.5], [0.45, 0.88, 0]);
        K.box(root, P.woodDark, [0.92, 0.34, 0.07], [0, 0.88, -0.72]);
        for (const wx of [-0.57, 0.57]) {
          K.cyl(root, P.woodDark, { h: 0.13, d: 0.74, t: 12 }, [wx, 0.37, -0.05], { rot: [0, 0, Math.PI / 2] });
          K.tor(root, P.metalDark, { d: 0.74, thick: 0.05, t: 16 }, [wx, 0.37, -0.05], { rot: [0, 0, Math.PI / 2] });
          K.cyl(root, P.woodLight, { h: 0.18, d: 0.13, t: 6 }, [wx, 0.37, -0.05], { rot: [0, 0, Math.PI / 2] });
        }
        K.cyl(root, P.metalDark, { h: 1.16, d: 0.06 }, [0, 0.37, -0.05], { rot: [0, 0, Math.PI / 2] });
        for (const bx of [-0.28, 0.28]) K.cyl(root, P.woodLight, { h: 1.25, d: 0.07 }, [bx, 0.6, 1.05], { rot: [1.22, 0, 0] });
        K.cyl(root, P.woodLight, { h: 0.62, d: 0.06 }, [0, 0.83, 1.62], { rot: [0, 0, Math.PI / 2] });
        for (let i = 0; i < 3; i++) K.cyl(root, P.trunk, { h: 0.8, d: 0.2, t: 8 }, [0, 0.86, -0.42 + i * 0.42], { rot: [0, 0, Math.PI / 2] });
        // Petite pile de bois à côté de la charrette (le bois « laissé à disposition »).
        for (const [ly, lz] of [[0.12, -0.3], [0.12, 0], [0.12, 0.3], [0.34, -0.15], [0.34, 0.15]] as const)
          K.cyl(root, P.trunk, { h: 0.9, d: 0.22, t: 7 }, [1.5, ly, lz], { rot: [Math.PI / 2, 0, 0] });
        break;
      }
      case "trap": {
        // Piège à assommoir (deadfall), deux états basculés par setTrapsReady.
        // Socle commun (toujours visible) : terre tassée + pierres de charnière.
        K.cyl(root, [0.17, 0.14, 0.1], { h: 0.05, d: 1.7, t: 14 }, [0, 0.025, 0]);
        K.ico(root, P.stone, { d: 0.28 }, [-0.5, 0.07, -0.62]);
        K.ico(root, P.stone, { d: 0.28 }, [0.5, 0.07, -0.62]);
        // État ARMÉ : dalle relevée par le montant, appât dessous.
        const armed = K.node(root, [0, 0, 0]);
        const slabA = K.node(armed, [0, 0.16, -0.62]);
        slabA.rotation.x = -0.5;
        K.box(slabA, P.wood, [1.2, 0.16, 1.3], [0, 0, 0.62]);
        K.box(slabA, P.woodDark, [1.24, 0.07, 0.1], [0, 0.1, 0.2]);
        K.box(slabA, P.woodDark, [1.24, 0.07, 0.1], [0, 0.1, 1.05]);
        K.cyl(armed, P.woodLight, { h: 0.7, d: 0.07 }, [0.5, 0.33, 0.52], { rot: [-0.28, 0, 0] }); // montant
        K.cyl(armed, P.woodLight, { h: 0.55, d: 0.05 }, [0.22, 0.12, 0.5], { rot: [0, 0, Math.PI / 2] });
        K.sph(armed, P.meat, { d: 0.2, seg: 7 }, [-0.05, 0.12, 0.5]); // appât
        // État PRISE : dalle RETOMBÉE, montant éjecté, créature prise dessous.
        const sprung = K.node(root, [0, 0, 0]);
        const slabS = K.node(sprung, [0, 0.14, -0.62]);
        slabS.rotation.x = -0.14;
        K.box(slabS, P.wood, [1.2, 0.16, 1.3], [0, 0, 0.62]);
        K.box(slabS, P.woodDark, [1.24, 0.07, 0.1], [0, 0.1, 0.2]);
        K.box(slabS, P.woodDark, [1.24, 0.07, 0.1], [0, 0.1, 1.05]);
        K.cyl(sprung, P.woodLight, { h: 0.7, d: 0.07 }, [0.8, 0.06, 0.4], { rot: [Math.PI / 2, 0.35, 0] }); // montant tombé
        K.ico(sprung, P.fur, { d: 0.4 }, [0, 0.18, 0.66]);
        K.sph(sprung, P.fur, { d: 0.26 }, [0, 0.16, 0.98]);
        K.cone(sprung, P.fur, { h: 0.16, d: 0.1, t: 6 }, [0.09, 0.3, 1.0]);
        K.cone(sprung, P.fur, { h: 0.16, d: 0.1, t: 6 }, [-0.09, 0.3, 1.0]);
        K.box(sprung, P.meat, [0.05, 0.05, 0.05], [0, 0.14, 1.12]); // museau
        sprung.setEnabled(false);
        this.traps.push({ armed, sprung });
        break;
      }
      case "lodge": {
        this.addSmoke(id, root, buildLodge(K, root));
        break;
      }
      case "tannery": {
        const PB = 1.9, PF = 1.46;
        for (const [px, pz, ph] of [[-1, -0.8, PB], [1, -0.8, PB], [-1, 0.8, PF], [1, 0.8, PF]] as const)
          K.cyl(root, P.wood, { h: ph, d: 0.12 }, [px, ph / 2, pz]);
        K.box(root, P.roof, [2.4, 0.12, 2.1], [0, 1.73, 0], { rot: [0.27, 0, 0] });
        K.cyl(root, P.woodLight, { h: 2.06, d: 0.07 }, [0, 1.5, -0.8], { rot: [0, 0, Math.PI / 2] });
        K.cyl(root, P.woodLight, { h: 2.06, d: 0.07 }, [0, 1.2, 0.8], { rot: [0, 0, Math.PI / 2] });
        K.box(root, P.fur, [0.62, 0.8, 0.04], [-0.5, 1.08, -0.8]);
        K.box(root, P.hide, [0.6, 0.9, 0.04], [0.46, 1.03, -0.8]);
        K.box(root, P.hide, [0.62, 0.7, 0.04], [-0.5, 0.83, 0.8]);
        K.box(root, [0.45, 0.34, 0.24], [0.6, 0.6, 0.04], [0.46, 0.88, 0.8]);
        K.cyl(root, P.stoneDark, { h: 0.5, dt: 0.7, db: 0.6, t: 10 }, [0.7, 0.25, 0.2]);
        K.cyl(root, [0.3, 0.26, 0.18], { h: 0.06, d: 0.62 }, [0.7, 0.5, 0.2]);
        break;
      }
      case "smokehouse": {
        this.addSmoke(id, root, buildSmokehouse(K, root));
        break;
      }
      case "steelworks": {
        this.addSmoke(id, root, buildSteelworks(K, root));
        break;
      }
      case "trading post": {
        buildTradingPost(K, root);
        break;
      }
      case "workshop": {
        buildWorkshop(K, root);
        break;
      }
      case "armoury": {
        buildArmoury(K, root);
        break;
      }
      default: {
        // Repli générique (au cas où un nouvel id n'a pas encore de modèle).
        K.box(root, [0.3, 0.3, 0.3], [1.5, 1.2, 1.4], [0, 0.6, 0]);
        break;
      }
    }

    return root;
  }
}
