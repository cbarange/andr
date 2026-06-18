// ============================================================================
//  L'ÉPAVE FRAÎCHEMENT TROUVÉE (RF1b — STADE 1) — le petit vaisseau « wanderer »
//  d'évasion VENANT DE S'ÉCRASER, à demi enseveli dans la terre du village. C'est
//  la PREMIÈRE forme du modèle : un débris MORT et brisé, AVANT toute réparation.
//  À opposer à `shipCamp.ts` (l'engin réparé/vivant, accents cyan éclatants) :
//  même LANGAGE visuel wanderer (fuseau hexagonal teal, nervures d'alliage, verrière,
//  ailes forward-swept, tuyère) mais ICI cassé, sombre, presque sans émissif, le nez
//  planté sous le sol. La racine est posée au niveau du terrain (y=0) ; la partie
//  enterrée descend en y négatif. Purement visuel.
// ============================================================================

import { TransformNode } from "@babylonjs/core";
import type { Kit } from "./lowpoly";
import { P } from "./lowpoly";

export function buildCrashedShip(K: Kit, root: TransformNode): void {
  // Palette d'épave : coque teal sombre et patinée, alliage exposé, presque aucun
  // émissif (le vaisseau est MORT). dirt = bourrelet de terre retournée à l'impact.
  const hull = P.alienHull, hullDk = [0.14, 0.22, 0.26], alloy = P.alienAlloy,
    scorch = P.scorch, dark = P.dark, dirt = [0.18, 0.14, 0.1], dirtDk = [0.12, 0.1, 0.07],
    ember = [1.0, 0.42, 0.14]; // une seule braise faible, à peine vivante

  // ════════════════════════════════════════════════════════════════════════
  //  TERRAIN D'IMPACT (au niveau du sol, racine) — cratère de terre + roussi.
  // ════════════════════════════════════════════════════════════════════════
  // Bourrelet de terre retournée poussé autour du point d'impact (nez planté en -Z).
  K.cyl(root, dirt, { h: 0.4, dt: 2.2, db: 3.0, t: 9 }, [0, -0.02, -1.6], { scale: [1.3, 1, 1.15], unlit: true });
  K.cyl(root, dirtDk, { h: 0.3, dt: 1.0, db: 2.0, t: 8 }, [0, 0.0, -2.2], { scale: [1.2, 1, 1] }); // monticule au nez
  // Grande tache de sol roussi sous la carcasse.
  K.cyl(root, scorch, { h: 0.02, d: 3.4, t: 12 }, [0, 0.03, -0.6], { scale: [1.25, 1, 1.7], unlit: true });
  // Traînée / sillon de dérapage DERRIÈRE l'épave (+Z, là où elle a labouré le sol).
  K.box(root, scorch, [1.0, 0.02, 3.2], [0, 0.04, 2.2], { unlit: true }); // trace noircie
  K.box(root, dirtDk, [1.3, 0.16, 0.5], [0, 0.06, 0.9], { unlit: true }); // bourrelet de terre du sillon
  for (let i = 0; i < 3; i++) // mottes de terre éjectées le long du sillon
    K.ico(root, dirt, { d: 0.3 + i * 0.05 }, [(i % 2 ? 0.7 : -0.6), 0.1, 1.4 + i * 0.9], { unlit: true });

  // ════════════════════════════════════════════════════════════════════════
  //  COQUE BASCULÉE (sous-nœud incliné) — nez piqué SOUS le sol, queue en l'air,
  //  + léger roulis pour qu'elle paraisse écrasée et non posée.
  // ════════════════════════════════════════════════════════════════════════
  // Repère modèle (comme shipCamp) : proue vers +Z. On l'incline pour planter le nez (-Z bas).
  // pitch ~ +30° (nez vers -Z descend), roll ~ -10° (couché sur le flanc).
  const ship = K.node(root, [0, 0.55, 0.2]);
  ship.rotation.set(0.52, 0, -0.16); // tangage ~30°, roulis ~9°

  // ── FUSELAGE — fuseau hexagonal effilé le long de +Z, cabossé et terni.
  K.cyl(ship, hull, { h: 4.0, dt: 0.7, db: 1.12, t: 6 }, [0, 0, 0], { rot: [Math.PI / 2, 0, 0] });
  K.cyl(ship, hullDk, { h: 3.6, dt: 0.42, db: 0.78, t: 6 }, [0, -0.32, -0.1], { rot: [Math.PI / 2, 0, 0] }); // ventre / quille
  K.cone(ship, hullDk, { h: 1.5, d: 0.74, t: 6 }, [0, 0.02, 2.65], { rot: [Math.PI / 2, 0, 0] }); // nez facetté (planté au sol)
  K.cone(ship, scorch, { h: 0.5, d: 0.5, t: 6 }, [0.06, 0.0, 3.2], { rot: [Math.PI / 2, 0.2, 0.1] }); // pointe de nez écrasée/noircie

  // Nervures de plaques le long du dos (anneaux d'alliage) — quelques-unes déformées.
  for (const z of [1.7, 0.7, -0.4, -1.4]) K.cyl(ship, alloy, { h: 0.08, dt: 1.0, db: 1.14, t: 6 }, [0, 0, z], { rot: [Math.PI / 2, 0, 0] });
  K.cyl(ship, alloy, { h: 0.16, d: 1.18, t: 6 }, [0, 0, 0.55], { rot: [Math.PI / 2, 0, 0.08] }); // ceinture maîtresse, tordue

  // ── BRÈCHES dans la coque (trous = boîtes sombres) + nervures d'alliage exposées.
  // Grande déchirure sur le flanc droit, près du milieu.
  K.box(ship, dark, [0.5, 0.6, 0.9], [0.5, 0.05, -0.2], { unlit: true });
  for (let i = 0; i < 3; i++) // côtes/ribbing d'alliage exposées dans la brèche
    K.cyl(ship, alloy, { h: 0.62, d: 0.05, t: 5 }, [0.46, 0.04, -0.55 + i * 0.35], { rot: [0, 0, 0.3] });
  // Seconde brèche, plus petite, sur le dessus de la queue.
  K.box(ship, dark, [0.55, 0.45, 0.5], [-0.1, 0.35, -1.55], { rot: [0.2, 0, 0], unlit: true });
  K.cyl(ship, alloy, { h: 0.4, d: 0.05, t: 5 }, [-0.05, 0.4, -1.6], { rot: [0, 0, 0] });
  K.cyl(ship, alloy, { h: 0.4, d: 0.05, t: 5 }, [0.18, 0.38, -1.5], { rot: [0.2, 0, 0] });
  // Plaque de blindage arrachée et pendante sur le flanc gauche.
  K.box(ship, hull, [0.04, 0.5, 0.7], [-0.62, 0.1, 0.4], { rot: [0, 0, -0.6] });
  // Trous d'impact ponctuels (petites boîtes sombres) sur la coque.
  for (const [px, pz] of [[0.4, 1.1], [-0.45, 0.0], [0.3, -0.9], [-0.2, 1.5]] as const)
    K.box(ship, dark, [0.18, 0.14, 0.18], [px, 0.32, pz], { unlit: true });
  // Stries de roussi le long de la coque (impacts / rentrée brutale).
  for (const [px, pz, rz] of [[0.5, 0.6, -0.2], [-0.5, -0.3, 0.2], [0.0, 1.0, 0]] as const)
    K.box(ship, scorch, [0.06, 0.04, 1.4], [px, 0.45, pz], { rot: [0, 0, rz], unlit: true });

  // ── COCKPIT / VERRIÈRE — encadrement d'alliage + bulle FÊLÉE et SOMBRE (non alimentée).
  K.box(ship, alloy, [0.66, 0.34, 1.05], [0, 0.36, 1.28], { rot: [-0.12, 0, 0] }); // socle de cabine
  K.sph(ship, dark, { d: 0.78, seg: 8 }, [0, 0.54, 1.42], { scale: [0.78, 0.62, 1.3], unlit: true }); // canopée noire (verre mort)
  K.box(ship, alloy, [0.05, 0.3, 1.0], [0, 0.55, 1.4], { rot: [-0.12, 0, 0] }); // arête centrale
  for (const sx of [1, -1]) K.box(ship, alloy, [0.05, 0.26, 0.85], [sx * 0.3, 0.46, 1.42], { rot: [-0.12, 0, 0] }); // montants
  // Fêlures de la verrière : fines arêtes d'alliage en étoile.
  K.box(ship, alloy, [0.02, 0.02, 0.55], [0.08, 0.58, 1.45], { rot: [0, 0.4, 0.3] });
  K.box(ship, alloy, [0.02, 0.02, 0.45], [-0.05, 0.56, 1.4], { rot: [0, -0.5, -0.2] });
  // UNE seule braise très faible qui clignote encore dans le cockpit (presque éteinte).
  K.ico(ship, ember, { d: 0.07 }, [0.05, 0.5, 1.5], { emi: 0.7, unlit: true });

  // ── ÉPINE DORSALE — nodules désormais ÉTEINTS (sphères sombres) du cockpit à la poupe.
  for (let i = 0; i < 4; i++) K.sph(ship, hullDk, { d: 0.12 }, [0, 0.4, 0.6 - i * 0.55]);

  // ── DÉRIVE dorsale brisée + un aileron de queue arraché.
  K.box(ship, hull, [0.12, 1.05, 1.15], [0, 0.62, -1.5], { rot: [0, 0, 0.18] }); // dérive penchée
  K.box(ship, dark, [0.13, 0.25, 0.4], [0.04, 1.0, -1.35], { unlit: true }); // sommet de dérive arraché (trou)
  K.box(ship, hullDk, [0.1, 0.7, 0.6], [0.4, 0.35, -1.6], { rot: [0, 0, 0.55] }); // aileron survivant
  // (l'aileron opposé manque — arraché)

  // ════════════════════════════════════════════════════════════════════════
  //  AILE GAUCHE SAINE / AILE DROITE BRISÉE (pliée vers le bas, presque détachée).
  // ════════════════════════════════════════════════════════════════════════
  // Aile gauche (sx = -1) : forward-swept comme à l'origine, ternie et sans veine vive.
  {
    const sx = -1;
    const w = K.node(ship, [sx * 1.05, 0.18, -0.15]); w.rotation.set(0, sx * -0.34, sx * -0.06);
    K.box(w, hull, [1.8, 0.12, 1.15], [sx * 0.6, 0, 0]); // plan d'aile
    K.box(w, hullDk, [1.85, 0.06, 0.18], [sx * 0.62, 0.02, 0.52]); // bord d'attaque
    K.box(w, scorch, [1.2, 0.05, 0.08], [sx * 0.6, 0.08, 0.05], { unlit: true }); // ancienne veine, noircie/morte
    K.cyl(w, alloy, { h: 0.9, d: 0.12, t: 5 }, [sx * 0.55, -0.12, 0.55], { rot: [Math.PI / 2, 0, 0] }); // pylône
    K.box(w, dark, [0.3, 0.06, 0.3], [sx * 1.2, 0, -0.2], { unlit: true }); // morceau de bout d'aile manquant
  }
  // Aile droite (sx = +1) : SNAPPÉE — pliée brutalement vers le bas, à demi détachée.
  {
    const sx = 1;
    const w = K.node(ship, [sx * 0.9, 0.05, -0.15]); w.rotation.set(0.2, sx * -0.1, -1.05); // affaissée/tordue
    K.box(w, hull, [1.6, 0.12, 1.0], [sx * 0.55, 0, 0]); // plan d'aile cassé (plus court)
    K.box(w, hullDk, [1.6, 0.06, 0.16], [sx * 0.56, 0.02, 0.46]); // bord d'attaque
    K.box(w, dark, [0.35, 0.14, 1.0], [sx * 0.05, 0, 0], { unlit: true }); // ligne de rupture sombre à la racine
    for (let i = 0; i < 3; i++) // nervures d'alliage déchiquetées à la cassure
      K.cyl(w, alloy, { h: 0.5, d: 0.05, t: 5 }, [sx * 0.18, 0, -0.4 + i * 0.4], { rot: [0, 0, 0.2] });
    K.cyl(w, alloy, { h: 0.7, d: 0.12, t: 5 }, [sx * 0.5, -0.1, 0.5], { rot: [Math.PI / 2, 0, 0] }); // pylône tordu
  }

  // ── DRIVE arrière (tuyère) — ÉTEINT et noirci, levé vers le ciel (queue haute).
  K.cyl(ship, alloy, { h: 0.55, dt: 0.86, db: 0.96, t: 6 }, [0, 0, -2.15], { rot: [Math.PI / 2, 0, 0] }); // carter
  K.tor(ship, alloy, { d: 0.96, thick: 0.08, t: 12 }, [0, 0, -2.4], { rot: [Math.PI / 2, 0, 0] }); // cerclage
  K.cyl(ship, dark, { h: 0.22, dt: 0.3, db: 0.74, t: 8 }, [0, 0, -2.55], { rot: [Math.PI / 2, 0, 0], unlit: true }); // gueule de tuyère noire/morte
  K.cyl(ship, scorch, { h: 0.06, d: 0.5, t: 8 }, [0, 0, -2.66], { rot: [Math.PI / 2, 0, 0], unlit: true }); // suie au cul de la tuyère
  for (const sx of [1, -1]) // nacelles latérales (une cabossée)
    K.cyl(ship, alloy, { h: 0.7, dt: 0.26, db: 0.34, t: 6 }, [sx * 0.66, -0.18, -1.95], { rot: [Math.PI / 2, 0, sx > 0 ? 0.25 : 0] });

  // ── MÂT-CAPTEUR cassé (tige pliée + dôme bas, sans lueur).
  K.cyl(ship, alloy, { h: 0.45, d: 0.05, t: 5 }, [0.22, 0.7, 0.5], { rot: [0.7, 0, -0.4] }); // antenne pliée
  K.ico(ship, alloy, { d: 0.26 }, [-0.2, 0.5, 0.2]); // dôme capteur éteint (plus de lueur cyan)

  // ── ÉCOUTILLE / sas entrouvert sur le flanc droit (indice « on peut entrer »).
  K.box(ship, hullDk, [0.04, 0.6, 0.9], [0.56, -0.18, 0.55]); // panneau de sas
  K.box(ship, dark, [0.05, 0.55, 0.55], [0.58, -0.18, 0.7], { rot: [0, 0.5, 0], unlit: true }); // ouverture sombre (sas béant)

  // ════════════════════════════════════════════════════════════════════════
  //  FRAGMENT D'AILE ARRACHÉE — gisant SÉPARÉMENT dans la terre, à côté.
  // ════════════════════════════════════════════════════════════════════════
  const frag = K.node(root, [2.4, 0.08, 0.6]);
  frag.rotation.set(0.05, -0.7, 0.12); // posé à plat, de travers, à peine enfoncé
  K.box(frag, hull, [1.5, 0.12, 0.95], [0, 0, 0]); // bout d'aile détaché
  K.box(frag, hullDk, [1.5, 0.06, 0.16], [0, 0.02, 0.42]); // bord d'attaque
  K.box(frag, dark, [0.3, 0.12, 0.95], [-0.75, 0, 0], { unlit: true }); // bord de rupture déchiqueté
  for (let i = 0; i < 3; i++) // nervures d'alliage tordues à l'arrachement
    K.cyl(frag, alloy, { h: 0.5, d: 0.05, t: 5 }, [-0.7, 0, -0.35 + i * 0.35], { rot: [0, 0, 0.4] });
  K.box(frag, scorch, [0.9, 0.04, 0.1], [0.1, 0.07, 0], { unlit: true }); // veine éteinte, noircie
  K.cyl(root, dirt, { h: 0.2, dt: 0.9, db: 1.5, t: 8 }, [2.4, 0.0, 0.6], { scale: [1.3, 1, 1], unlit: true }); // terre soulevée sous le fragment
}
