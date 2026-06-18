// ============================================================================
//  LE VAISSEAU RÉPARÉ SUR PYLÔNE (M11/RF — 2e étage : « prêt à décoller »).
//  Le même engin d'évasion « wanderer » que `shipCamp.ts`, mais INTACT, ALIMENTÉ et
//  DRESSÉ À LA VERTICALE sur une aire de lancement (nez vers le ciel). Purement visuel.
//  Langage repris de `build()` de shipCamp (coque teal facettée, veines cyan, nervures
//  d'alliage, tuyère, verrière) — RÉORIENTÉ vertical : base (queue/moteurs) en y≈0,
//  nez en y≈6.5. On laisse volontairement le mid-hull (y≈3-4) et le bas (y≈0-2.5)
//  dégagés à l'extérieur : les accents d'upgrade (anneau de bouclier au milieu,
//  boosters à la base) sont attachés séparément par d'autres modules.
// ============================================================================

import { TransformNode } from "@babylonjs/core";
import type { Kit } from "./lowpoly";
import { P } from "./lowpoly";

export function buildRepairedShip(K: Kit, root: TransformNode): void {
  // Teintes « wanderer » (mêmes valeurs que shipCamp, déclinées sur P).
  const hull = [0.22, 0.34, 0.4], hullDk = [0.14, 0.22, 0.26], alloy = P.alienAlloy,
    cyan = P.alienGlow, cyanHot = P.alienHot, violet = [0.62, 0.42, 0.92], magenta = P.alienBoss;

  // ── AIRE DE LANCEMENT — disque d'alliage bas au sol + plateau métal + couronne lumineuse.
  K.cyl(root, P.metalDark, { h: 0.18, d: 4.4, t: 12 }, [0, 0.09, 0]);            // dalle de base
  K.cyl(root, alloy, { h: 0.22, d: 3.4, t: 12 }, [0, 0.26, 0]);                  // plateau d'alliage
  K.tor(root, cyan, { d: 3.0, thick: 0.06, t: 16 }, [0, 0.4, 0], { emi: 1.2, unlit: true }); // couronne lumineuse au sol
  // Câbles / clamps au sol vers le bas de coque (raccords cyan).
  for (const a of [0.6, Math.PI - 0.6]) {
    const cx = Math.cos(a), cz = Math.sin(a);
    K.box(root, P.metalDark, [0.16, 0.5, 0.16], [cx * 1.2, 0.45, cz * 1.2]);     // bloc clamp
    K.cyl(root, cyan, { h: 0.06, d: 0.2, t: 6 }, [cx * 1.2, 0.72, cz * 1.2], { emi: 1.3, unlit: true });
  }

  // ── PORTIQUE / GANTRY — 4 bras d'alliage inclinés appuyés contre le bas de coque.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const cx = Math.cos(a), cz = Math.sin(a);
    const g = K.node(root, [cx * 1.55, 1.0, cz * 1.55]);
    g.rotation.set(cz * 0.42, -a, -cx * 0.42); // bras penché vers la coque
    K.cyl(g, P.metal, { h: 2.0, d: 0.12, t: 5 }, [0, 0, 0]);                     // jambe de portique
    K.box(g, alloy, [0.2, 0.16, 0.2], [0, 1.0, 0]);                              // bras d'appui (haut)
    K.box(g, P.metalDark, [0.4, 0.12, 0.4], [0, -1.0, 0]);                       // socle au sol
  }

  // ── DRIVE / TUYÈRE à la BASE (y≈0) — carter + cerclage + halo violet→cœur cyan, orienté vers le bas.
  K.cyl(root, alloy, { h: 0.55, dt: 0.96, db: 0.86, t: 6 }, [0, 0.7, 0]);        // carter moteur
  K.tor(root, alloy, { d: 0.96, thick: 0.08, t: 12 }, [0, 0.48, 0]);            // cerclage de tuyère
  K.cyl(root, violet, { h: 0.2, dt: 0.74, db: 0.3, t: 8 }, [0, 0.34, 0], { emi: 1.5, unlit: true }); // halo violet (s'évase vers le bas)
  K.cyl(root, cyanHot, { h: 0.12, d: 0.42, t: 8 }, [0, 0.22, 0], { emi: 2.0, unlit: true }); // cœur cyan brûlant
  K.cone(root, magenta, { h: 0.3, d: 0.5, t: 8 }, [0, 0.18, 0], { rot: [Math.PI, 0, 0] }); // jet/plume sous la tuyère
  // 2 nacelles de poussée latérales (petites tuyères secondaires) à la base.
  for (const a of [Math.PI / 4 + Math.PI, -Math.PI / 4 + Math.PI]) {
    const cx = Math.cos(a), cz = Math.sin(a);
    K.cyl(root, alloy, { h: 0.7, dt: 0.34, db: 0.26, t: 6 }, [cx * 0.62, 0.85, cz * 0.62]); // nacelle
    K.cyl(root, cyan, { h: 0.08, d: 0.3, t: 6 }, [cx * 0.62, 0.46, cz * 0.62], { emi: 1.7, unlit: true });
  }

  // ── FUSELAGE VERTICAL — fuseau hexagonal effilé : large à la base, nez pointu au sommet.
  // Axe = Y (orientation par défaut de K.cyl) → AUCUNE rotation. Base y≈1, sommet y≈5.2, nez jusqu'à 6.5.
  K.cyl(root, hull, { h: 4.2, db: 1.2, dt: 0.6, t: 6 }, [0, 3.1, 0]);            // coque principale effilée
  K.cyl(root, hullDk, { h: 3.8, db: 0.84, dt: 0.42, t: 6 }, [0, 3.0, -0.06]);    // quille / âme interne (léger offset -z)
  K.cone(root, hull, { h: 1.4, d: 0.6, t: 6 }, [0, 5.9, 0]);                     // cône de nez facetté
  K.cone(root, alloy, { h: 0.4, d: 0.14, t: 6 }, [0, 6.5, 0]);                   // pointe / sonde de proue (sommet ≈6.7)

  // ── NERVURES / ANNEAUX D'ALLIAGE le long du corps (coutures de plaques montantes).
  // (On évite la zone mid y≈3-4 réservée à l'anneau de bouclier : anneaux en bas et en haut.)
  for (const y of [1.4, 2.1, 4.7, 5.3]) {
    const t = (y - 1) / 4.2; // taux de conicité approx pour ceindre la coque
    const d = 1.18 - t * 0.62;
    K.cyl(root, alloy, { h: 0.1, db: d, dt: d - 0.04, t: 6 }, [0, y, 0]);
  }

  // ── VEINES ÉMISSIVES qui MONTENT le long de la coque (cyan) — 3 arêtes sur les facettes.
  for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
    const cx = Math.cos(a), cz = Math.sin(a);
    K.box(root, cyan, [0.06, 4.0, 0.06], [cx * 0.62, 3.2, cz * 0.62], { emi: 1.2, unlit: true });
  }
  // Petits nodules cyan échelonnés sur une arête dorsale.
  for (let i = 0; i < 5; i++) K.sph(root, cyan, { d: 0.12 }, [0, 1.6 + i * 0.85, 0.6 - i * 0.06], { emi: 1.5, unlit: true });

  // ── VERRIÈRE / COCKPIT — bulle de verre cyan + encadrement d'alliage, à mi-hauteur basse (y≈4.4).
  K.box(root, alloy, [0.6, 0.7, 0.34], [0, 4.4, 0.62]);                          // socle de cabine
  K.sph(root, cyanHot, { d: 0.7, seg: 8 }, [0, 4.5, 0.72], { scale: [0.72, 1.25, 0.6], emi: 1.6, unlit: true }); // canopée vitrée
  K.box(root, alloy, [0.05, 0.92, 0.3], [0, 4.5, 0.74]);                         // arête centrale de verrière
  for (const sx of [1, -1]) K.box(root, alloy, [0.05, 0.78, 0.26], [sx * 0.26, 4.46, 0.76]); // montants latéraux

  // ── DÉRIVE / ANTENNE DORSALE près du sommet (aileron + tige + nodule cyan).
  K.box(root, hull, [0.1, 0.9, 0.6], [0, 5.1, -0.5]);                            // petite dérive dorsale
  K.box(root, cyan, [0.05, 0.8, 0.05], [0, 5.1, -0.18], { emi: 1.1, unlit: true }); // bord lumineux
  K.cyl(root, alloy, { h: 0.6, d: 0.05, t: 5 }, [0.16, 5.7, -0.1], { rot: [0.12, 0, -0.1] }); // antenne
  K.ico(root, cyan, { d: 0.12 }, [0.21, 6.0, -0.14], { emi: 1.6, unlit: true }); // feu d'antenne

  // ── AILERONS / PIEDS — 4 ailerons à la base, évasés vers l'extérieur en jambes d'atterrissage.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const cx = Math.cos(a), cz = Math.sin(a);
    const f = K.node(root, [cx * 0.72, 1.0, cz * 0.72]);
    f.rotation.set(0, -a, 0);
    K.box(f, hull, [0.14, 1.5, 0.85], [0, -0.1, 0.35], { rot: [0.5, 0, 0] });    // aileron incliné (s'évase)
    K.box(f, hullDk, [0.08, 1.4, 0.18], [0, -0.1, 0.7], { rot: [0.5, 0, 0] });   // bord d'attaque de l'aileron
    K.box(f, cyan, [0.05, 1.2, 0.05], [0, -0.05, 0.42], { rot: [0.5, 0, 0], emi: 1.1, unlit: true }); // veine d'aileron
    // Patin / sabot au pied de l'aileron (la coque repose dessus).
    K.box(f, alloy, [0.34, 0.1, 0.4], [0, -0.9, 0.95]);                          // sabot
    K.ico(f, cyan, { d: 0.1 }, [0, -0.84, 1.05], { emi: 1.4, unlit: true });     // feu de pied
  }
}
