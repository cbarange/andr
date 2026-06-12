// ============================================================================
//  PERSONNAGES low-poly (portés du labo) — humanoïde générique + constructrice +
//  joueur. Réutilisés par stranger.ts, villagers.ts, player.ts. Purement visuel.
//  Tous les modèles sont bâtis PIEDS AU SOL (y=0), face en +Z, avec un « nez »
//  repère de direction. Voir docs/modeles-3d.md.
// ============================================================================

import { TransformNode } from "@babylonjs/core";
import { P, type Kit } from "./lowpoly";

export interface HumanoidSpec {
  tunic?: number[];
  legs?: number[];
  head?: number[];
  hair?: number[];
  hat?: "cap" | "hood" | "straw" | "beard" | "none";
  h?: number; // échelle globale
}

/** Articulations animables d'un humanoïde : pivots placés à la hanche / l'épaule / le cou,
 *  les membres pendent en dessous. Faire tourner ces nœuds = animer les membres (cf. animateWalk).
 *  Au repos (rotations nulles), la silhouette est IDENTIQUE au modèle d'origine. */
export interface Rig {
  hipL: TransformNode;
  hipR: TransformNode;
  armL: TransformNode;
  armR: TransformNode;
  head: TransformNode;
}

/** Humanoïde générique RIGGÉ : jambes/pieds sous un pivot-hanche, bras/mains sous un pivot-épaule,
 *  tête/nez/couvre-chef sous un pivot-cou. Renvoie la racine + le rig (membres articulés). */
export function buildHumanoid(K: Kit, parent: TransformNode | null, o: HumanoidSpec = {}): { root: TransformNode; rig: Rig } {
  const root = K.node(parent);
  const tunic = o.tunic || P.tunicA;
  const dark = tunic.map((v) => v * 0.78);
  const legc = o.legs || P.woodDark;
  // jambes + pieds — sous un PIVOT à la hanche (y=0.5) ; le membre pend dessous (oscille à la marche).
  const hipL = K.node(root, [-0.13, 0.5, 0]);
  K.cyl(hipL, legc, { h: 0.5, dt: 0.13, db: 0.16 }, [0, -0.25, 0]);
  K.box(hipL, P.woodDark, [0.2, 0.1, 0.3], [0, -0.45, 0.05]);
  const hipR = K.node(root, [0.13, 0.5, 0]);
  K.cyl(hipR, legc, { h: 0.5, dt: 0.13, db: 0.16 }, [0, -0.25, 0]);
  K.box(hipR, P.woodDark, [0.2, 0.1, 0.3], [0, -0.45, 0.05]);
  // torse + ceinture (sur la racine, non articulés)
  K.cyl(root, tunic, { h: 0.66, dt: 0.34, db: 0.46, t: 8 }, [0, 0.83, 0]);
  K.box(root, dark, [0.5, 0.12, 0.34], [0, 0.62, 0]);
  // bras + mains — sous un PIVOT à l'épaule (y=1.08) ; le bras garde sa légère inclinaison de repos.
  const armL = K.node(root, [-0.3, 1.08, 0]);
  K.cyl(armL, dark, { h: 0.52, dt: 0.1, db: 0.12 }, [0, -0.26, 0], { rot: [0, 0, 0.12] });
  K.sph(armL, P.skin, { d: 0.16 }, [-0.03, -0.52, 0.02]);
  const armR = K.node(root, [0.3, 1.08, 0]);
  K.cyl(armR, dark, { h: 0.52, dt: 0.1, db: 0.12 }, [0, -0.26, 0], { rot: [0, 0, -0.12] });
  K.sph(armR, P.skin, { d: 0.16 }, [0.03, -0.52, 0.02]);
  // cou + tête + nez (repère de direction) — sous un PIVOT au cou (y=1.2) : léger dodelinement.
  const head = K.node(root, [0, 1.2, 0]);
  K.cyl(head, P.skinDark, { h: 0.12, d: 0.16 }, [0, 0, 0]);
  K.sph(head, o.head || P.skin, { d: 0.36, seg: 8 }, [0, 0.2, 0]);
  K.box(head, P.skinDark, [0.08, 0.07, 0.12], [0, 0.18, 0.18]);
  // couvre-chef (sous la tête, suit le dodelinement)
  const hat = o.hat || "cap";
  if (hat === "cap") {
    K.sph(head, o.hair || [0.28, 0.2, 0.14], { d: 0.38, seg: 8 }, [0, 0.3, -0.02], { scale: [1, 0.6, 1] });
  } else if (hat === "hood") {
    K.cyl(head, P.cloak, { h: 0.07, d: 0.58, t: 10 }, [0, 0.35, 0]);
    K.tor(head, P.cloakTrim, { d: 0.5, thick: 0.05, t: 14 }, [0, 0.36, 0]);
    K.cone(head, P.cloak, { h: 0.64, d: 0.46, t: 8 }, [0, 0.7, 0]);
  } else if (hat === "straw") {
    K.cyl(head, P.hatStraw, { h: 0.05, d: 0.62 }, [0, 0.36, 0]);
    K.cyl(head, P.hatStraw, { h: 0.18, dt: 0.22, db: 0.3 }, [0, 0.44, 0]);
  } else if (hat === "beard") {
    K.sph(head, [0.26, 0.19, 0.14], { d: 0.38, seg: 8 }, [0, 0.3, -0.02], { scale: [1, 0.55, 1] });
    K.box(head, [0.62, 0.55, 0.45], [0.26, 0.16, 0.2], [0, 0.07, 0.14]);
  }
  if (o.h) root.scaling.setAll(o.h);
  return { root, rig: { hipL, hipR, armL, armR, head } };
}

// Amplitudes du cycle de marche (radians). Tunables.
const WALK_LEG_AMP = 0.55;
const WALK_ARM_AMP = 0.45;
const WALK_HEAD_AMP = 0.12;

/** Cycle de marche PROCÉDURAL : jambes & bras oscillent en opposition (sinus), la tête dodeline
 *  un peu. `phase` avance avec la distance parcourue ; `intensity` ∈ [0,1] fond l'anim (0 = pose
 *  neutre, à l'arrêt). Cosmétique & local -> aucune contrainte de déterminisme. */
export function animateWalk(rig: Rig, phase: number, intensity: number): void {
  const s = Math.sin(phase);
  rig.hipL.rotation.x = s * WALK_LEG_AMP * intensity;
  rig.hipR.rotation.x = -s * WALK_LEG_AMP * intensity;
  rig.armL.rotation.x = -s * WALK_ARM_AMP * intensity; // bras opposé à la jambe du même côté
  rig.armR.rotation.x = s * WALK_ARM_AMP * intensity;
  rig.head.rotation.y = Math.sin(phase * 0.5) * WALK_HEAD_AMP * intensity;
}

/** La constructrice : silhouette encapuchonnée distincte, marteau en main. Renvoie la racine,
 *  les pivots de PIEDS (un pas à la marche) et le pivot d'ÉPAULE droite `armR` (le bras + le
 *  marteau y sont groupés -> elle peut « frapper » sur un chantier, cf. stranger.ts). */
export function buildConstructrice(K: Kit, parent: TransformNode | null): { root: TransformNode; hipL: TransformNode; hipR: TransformNode; armR: TransformNode } {
  const root = K.node(parent);
  const robe = P.cloak, robeDk = P.cloakDark;
  // pieds sous un pivot (sous la robe) : ils avancent/reculent légèrement à la marche.
  const hipL = K.node(root, [-0.14, 0.45, 0]);
  K.box(hipL, P.woodDark, [0.2, 0.14, 0.3], [0, -0.38, 0.06]);
  const hipR = K.node(root, [0.14, 0.45, 0]);
  K.box(hipR, P.woodDark, [0.2, 0.14, 0.3], [0, -0.38, 0.06]);
  K.cyl(root, robe, { h: 0.95, dt: 0.46, db: 0.82, t: 10 }, [0, 0.6, 0]);
  K.tor(root, P.cloakTrim, { d: 0.82, thick: 0.06, t: 18 }, [0, 0.12, 0]);
  K.cyl(root, robe, { h: 0.5, dt: 0.5, db: 0.46, t: 10 }, [0, 1.18, 0]);
  K.tor(root, robeDk, { d: 0.5, thick: 0.06, t: 14 }, [0, 0.92, 0]);
  K.box(root, P.cloakTrim, [0.12, 0.1, 0.05], [0, 0.92, 0.23]);
  K.cyl(root, robeDk, { h: 0.16, dt: 0.5, db: 0.64, t: 10 }, [0, 1.42, 0]);
  K.cyl(root, P.skinDark, { h: 0.12, d: 0.16 }, [0, 1.5, 0]);
  K.sph(root, P.skin, { d: 0.36, seg: 8 }, [0, 1.63, 0.03]);
  K.box(root, P.skinDark, [0.07, 0.06, 0.06], [0, 1.62, 0.21]);
  K.sph(root, robeDk, { d: 0.44, seg: 8 }, [0, 1.7, -0.13], { scale: [1.08, 1.06, 1.0] });
  K.tor(root, robe, { d: 0.5, thick: 0.1, t: 14 }, [0, 1.52, 0]);
  K.box(root, P.wood, [0.3, 0.26, 0.18], [-0.34, 0.78, 0.16], { rot: [0, 0.3, 0] });
  K.box(root, P.cloakTrim, [0.32, 0.06, 0.2], [-0.34, 0.92, 0.16], { rot: [0, 0.3, 0] });
  K.box(root, robeDk, [0.07, 0.95, 0.05], [0.04, 1.05, 0.2], { rot: [0, 0, 0.32] });
  K.cyl(root, robe, { h: 0.62, dt: 0.1, db: 0.14 }, [-0.28, 1.06, 0.04], { rot: [0, 0, 0.06] }); // bras gauche
  K.sph(root, P.skin, { d: 0.14 }, [-0.3, 0.76, 0.06]); // main gauche
  // Bras droit + marteau groupés sous un PIVOT d'épaule (en [0.3, 1.1, 0.1]) -> ils tournent
  // ensemble pour « frapper ». Au repos (rotation 0) le marteau reste planté comme avant.
  const armR = K.node(root, [0.3, 1.1, 0.1]);
  K.cyl(armR, P.woodLight, { h: 0.72, d: 0.06 }, [0.01, -0.68, 0.12]); // manche du marteau
  K.box(armR, P.metalDark, [0.28, 0.16, 0.16], [0.01, -0.28, 0.12]); // tête
  K.box(armR, P.metal, [0.12, 0.18, 0.18], [0.11, -0.28, 0.12]); // face de frappe
  K.cyl(armR, robe, { h: 0.58, dt: 0.1, db: 0.14 }, [0.0, -0.04, 0.0], { rot: [-0.12, 0, -0.1] }); // bras droit
  K.sph(armR, P.skin, { d: 0.14 }, [0.01, -0.17, 0.1]); // main droite
  return { root, hipL, hipR, armR };
}

/** Le joueur : tunique chaude, écharpe, sac à dos (le « sac »), hachette, + torche (M9, masquée). */
export function buildPlayer(K: Kit, parent: TransformNode | null): { root: TransformNode; rig: Rig; torch: TransformNode; flame: TransformNode } {
  const { root, rig } = buildHumanoid(K, parent, { tunic: P.player, hat: "cap", hair: [0.32, 0.24, 0.16] });
  K.tor(root, P.cloakTrim, { d: 0.42, thick: 0.09, t: 14 }, [0, 1.18, 0]); // écharpe
  K.box(root, P.cloakTrim, [0.12, 0.4, 0.06], [0.1, 0.98, 0.18], { rot: [0, 0, 0.2] });
  K.box(root, P.wood, [0.42, 0.5, 0.26], [0, 0.92, -0.28]); // sac à dos
  K.box(root, P.woodLight, [0.44, 0.12, 0.27], [0, 1.12, -0.28]);
  K.box(root, P.cloakDark, [0.07, 0.7, 0.05], [-0.16, 0.95, -0.05], { rot: [0.1, 0, 0.1] });
  K.box(root, P.cloakDark, [0.07, 0.7, 0.05], [0.16, 0.95, -0.05], { rot: [0.1, 0, -0.1] });
  K.cyl(root, P.woodLight, { h: 0.4, d: 0.05 }, [-0.32, 0.6, 0.12], { rot: [0.4, 0, 0] }); // hachette
  K.box(root, P.metal, [0.04, 0.18, 0.16], [-0.33, 0.74, 0.22], { rot: [0.4, 0, 0] });
  // TORCHE (M9) — tenue dans la main droite : sous le pivot d'ÉPAULE `armR` -> suit le bras
  // (oscille à la marche = « attachée naturellement »). Masquée par défaut (apparaît si dans le sac).
  const torch = K.node(rig.armR, [0.06, -0.52, 0.16]); // à la main droite (sous l'épaule)
  K.cyl(torch, P.woodDark, { h: 0.5, d: 0.05, t: 6 }, [0, 0.22, 0]); // manche, monte de la main
  K.box(torch, P.wood, [0.09, 0.06, 0.09], [0, 0.48, 0]); // liure (étoffe imbibée)
  const flame = K.node(torch, [0, 0.58, 0]);
  K.ico(flame, P.ember, { d: 0.2, sub: 1 }, [0, 0, 0], { emi: 1.9, unlit: true });
  K.ico(flame, P.emberHot, { d: 0.11, sub: 1 }, [0, 0.05, 0], { emi: 2.0, unlit: true });
  torch.setEnabled(false);
  return { root, rig, torch, flame };
}

// ============================================================================
//  CRÉATURES (M8) — silhouettes low-poly des ennemis de rencontre. Bâties pieds
//  au sol (y=0), face en +Z, comme les humanoïdes. Purement visuel & local.
// ============================================================================

/** Quadrupède (bête grondante, mangeur d'hommes, terreur sauvage) : corps + 4 pattes + tête + queue.
 *  `jaw` = pivot de la gueule (s'ouvre sur la fente d'attaque). `s` = échelle (taille par ennemi). */
export function buildBeast(K: Kit, parent: TransformNode | null, s = 1): { root: TransformNode; jaw: TransformNode } {
  const root = K.node(parent);
  const fur = P.fur.map((v) => v * 0.7); // pelage sombre (menaçant)
  const furDk = fur.map((v) => v * 0.7);
  K.box(root, fur, [0.55, 0.5, 1.1], [0, 0.62, -0.1]); // corps
  K.box(root, furDk, [0.5, 0.34, 0.42], [0, 0.78, -0.62]); // arrière-train
  for (const sx of [-1, 1]) {
    K.cyl(root, furDk, { h: 0.45, dt: 0.1, db: 0.13, t: 6 }, [sx * 0.2, 0.22, 0.32]); // pattes avant
    K.cyl(root, furDk, { h: 0.45, dt: 0.11, db: 0.14, t: 6 }, [sx * 0.2, 0.22, -0.55]); // pattes arrière
  }
  K.box(root, fur, [0.38, 0.34, 0.4], [0, 0.85, 0.5]); // tête
  K.box(root, furDk, [0.2, 0.16, 0.22], [0, 0.76, 0.74]); // museau (haut)
  const jaw = K.node(root, [0, 0.7, 0.62]);
  K.box(jaw, furDk, [0.18, 0.07, 0.22], [0, -0.03, 0.1]); // mâchoire inférieure
  K.box(jaw, P.bone, [0.14, 0.04, 0.05], [0, 0.02, 0.2]); // crocs
  for (const sx of [-1, 1]) {
    K.box(root, furDk, [0.08, 0.12, 0.06], [sx * 0.13, 1.06, 0.45], { rot: [0.2, 0, sx * 0.25] }); // oreilles
    K.ico(root, P.ember, { d: 0.07, sub: 1 }, [sx * 0.1, 0.9, 0.69], { emi: 1.4, unlit: true }); // yeux braise
  }
  K.cyl(root, furDk, { h: 0.5, dt: 0.03, db: 0.08, t: 6 }, [0, 0.85, -0.95], { rot: [1.2, 0, 0] }); // queue
  root.scaling.setAll(s);
  return { root, jaw };
}

/** Reptile (lézards des cavernes / grand lézard) : corps allongé bas + pattes écartées + queue.
 *  `jaw` = pivot de la gueule. `s` = échelle. */
export function buildLizard(K: Kit, parent: TransformNode | null, s = 1): { root: TransformNode; jaw: TransformNode } {
  const root = K.node(parent);
  const sc = [0.3, 0.42, 0.3]; // écailles vertes sombres
  const scDk = sc.map((v) => v * 0.65);
  K.box(root, sc, [0.42, 0.26, 1.0], [0, 0.26, -0.05]); // corps bas et long
  K.box(root, scDk, [0.3, 0.16, 0.5], [0, 0.28, -0.72]); // base de queue
  K.cyl(root, scDk, { h: 0.7, dt: 0.02, db: 0.1, t: 6 }, [0, 0.26, -1.2], { rot: [Math.PI / 2, 0, 0] }); // queue
  for (const sx of [-1, 1]) for (const z of [0.28, -0.34]) {
    K.cyl(root, scDk, { h: 0.24, dt: 0.07, db: 0.1, t: 6 }, [sx * 0.3, 0.12, z], { rot: [0, 0, sx * 0.5] }); // pattes écartées
  }
  K.box(root, sc, [0.3, 0.2, 0.36], [0, 0.32, 0.55]); // tête plate
  const jaw = K.node(root, [0, 0.26, 0.6]);
  K.box(jaw, scDk, [0.26, 0.06, 0.3], [0, -0.02, 0.1]);
  for (const sx of [-1, 1]) K.ico(root, P.emberHot, { d: 0.06, sub: 1 }, [sx * 0.12, 0.4, 0.66], { emi: 1.3, unlit: true }); // yeux
  K.cone(root, scDk, { h: 0.14, d: 0.1, t: 5 }, [0, 0.48, 0.1], { rot: [0.3, 0, 0] }); // crête
  root.scaling.setAll(s);
  return { root, jaw };
}

/** Oiseau étrange (T1) : corps ovoïde dressé + ailes + bec — silhouette inquiétante. */
export function buildBird(K: Kit, parent: TransformNode | null, s = 1): { root: TransformNode; jaw: TransformNode } {
  const root = K.node(parent);
  const plume = [0.24, 0.22, 0.28];
  const plumeDk = plume.map((v) => v * 0.7);
  for (const sx of [-1, 1]) K.cyl(root, P.bone, { h: 0.5, d: 0.05, t: 5 }, [sx * 0.12, 0.25, 0]); // pattes fines
  K.sph(root, plume, { d: 0.62, seg: 8 }, [0, 0.78, 0], { scale: [0.8, 1.15, 0.9] }); // corps dressé
  for (const sx of [-1, 1]) K.box(root, plumeDk, [0.07, 0.5, 0.34], [sx * 0.3, 0.82, -0.05], { rot: [0, 0, sx * 0.35] }); // ailes
  K.sph(root, plumeDk, { d: 0.3, seg: 8 }, [0, 1.22, 0.1]); // tête
  const jaw = K.node(root, [0, 1.2, 0.22]);
  K.cone(jaw, P.hatStraw, { h: 0.3, d: 0.12, t: 6 }, [0, 0, 0.1], { rot: [Math.PI / 2, 0, 0] }); // bec
  for (const sx of [-1, 1]) K.ico(root, P.ember, { d: 0.06, sub: 1 }, [sx * 0.09, 1.28, 0.2], { emi: 1.5, unlit: true });
  root.scaling.setAll(s);
  return { root, jaw };
}

// Variantes de villageois (cosmétique stable par index).
export const VILLAGER_SPECS: HumanoidSpec[] = [
  { tunic: P.tunicA, hat: "cap", h: 1.0, hair: [0.3, 0.2, 0.13] },
  { tunic: P.tunicB, hat: "hood", h: 1.05 },
  { tunic: P.tunicC, hat: "straw", h: 0.98 },
  { tunic: P.tunicD, hat: "beard", h: 0.92 },
  { tunic: [0.46, 0.46, 0.5], hat: "cap", h: 0.8, hair: [0.5, 0.45, 0.4] },
];
