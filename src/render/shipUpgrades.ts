// ============================================================================
//  ACCENTS D'UPGRADE DU VAISSEAU (3e palier) — deux groupes cosmétiques toggleables
//  qui se greffent sur le PETIT vaisseau d'évasion alien dressé VERTICAL sur sa rampe
//  (nez en haut). Le joueur améliore moteurs/boucliers -> le vaisseau change un peu.
//  Repère du vaisseau : base/queue à y≈0, nez à y≈6.5, centré x=0/z=0, rayon coque ~1.5-2u.
//  Langage visuel « wanderer » : alliage + émissif cyan/violet (cf. shipCamp.ts).
//  Purement visuel : le caller fait setEnabled() sur chaque groupe selon le palier d'upgrade.
// ============================================================================

import { TransformNode } from "@babylonjs/core";
import type { Kit } from "./lowpoly";
import { P } from "./lowpoly";

// Returns two toggleable groups attached to `root`; caller setEnabled()s them per upgrade level.
export function buildUpgradeAccents(K: Kit, root: TransformNode): { boosters: TransformNode; shields: TransformNode } {
  const boosters = K.node(root);
  const shields = K.node(root);

  // ── BOOSTERS (upgrade MOTEUR) — 4 nacelles de poussée groupées autour de la QUEUE.
  //    Disposées radialement autour de la coque (rayon ~1.8), y entre ~0.4 et ~2.2.
  //    Chaque nacelle : carter d'alliage + cerclage + tuyère orientée vers le BAS
  //    (halo violet `alienBoss` -> cœur cyan-chaud `alienHot`). Lit comme « plus de poussée ».
  const NAC = 4;
  for (let i = 0; i < NAC; i++) {
    const a = (i / NAC) * Math.PI * 2 + Math.PI / 4; // décalé pour ne pas chevaucher les trains
    const bx = Math.cos(a) * 1.8, bz = Math.sin(a) * 1.8;
    const n = K.node(boosters, [bx, 1.3, bz]);
    n.rotation.set(0, -a, 0.12); // légèrement pincée vers la coque
    K.cyl(n, P.alienAlloy, { h: 1.5, dt: 0.34, db: 0.46, t: 6 }, [0, 0, 0]); // carter de nacelle
    K.tor(n, P.alienAlloy, { d: 0.5, thick: 0.06, t: 10 }, [0, -0.7, 0]); // cerclage de tuyère
    K.cone(n, P.alienBoss, { h: 0.34, d: 0.42, t: 8 }, [0, -0.9, 0], { rot: [Math.PI, 0, 0] }); // halo violet (tuyère vers le bas)
    K.cyl(n, P.alienHot, { h: 0.1, d: 0.24, t: 8 }, [0, -1.04, 0], { emi: 2.0, unlit: true }); // cœur cyan-chaud
    K.cyl(n, P.alienBoss, { h: 0.18, dt: 0.24, db: 0.42, t: 8 }, [0, -0.86, 0], { emi: 1.6, unlit: true }); // lueur de tuyère
  }

  // ── SHIELDS (upgrade COQUE/BOUCLIER) — émetteur de bouclier autour de la MI-coque (y≈3.5).
  //    Anneau d'alliage en 3 segments (arcs de tore) + petits nœuds émetteurs cyan,
  //    + un mince halo annulaire émissif (PAS de sphère opaque qui masque le vaisseau).
  const RING_Y = 3.5, RING_R = 2.2, SEG = 3;
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const sx = Math.cos(a) * RING_R, sz = Math.sin(a) * RING_R;
    const s = K.node(shields, [sx, RING_Y, sz]);
    s.rotation.set(0, -a, 0);
    K.box(s, P.alienAlloy, [0.14, 0.5, 0.95], [0, 0, 0]); // segment d'anneau (émetteur d'alliage)
    K.box(s, P.alienGlow, [0.06, 0.3, 0.7], [-0.06, 0, 0], { emi: 1.4, unlit: true }); // face lumineuse cyan
    K.ico(s, P.alienHot, { d: 0.22 }, [-0.1, 0.3, 0], { emi: 1.8, unlit: true }); // nœud émetteur
    K.ico(s, P.alienBoss, { d: 0.12 }, [-0.1, -0.28, 0], { emi: 1.6, unlit: true }); // capteur violet
  }
  // Halos annulaires : minces tores émissifs = indice translucide de dôme (subtil, non opaque).
  K.tor(shields, P.alienGlow, { d: RING_R * 2 + 0.4, thick: 0.04, t: 24 }, [0, RING_Y, 0], { rot: [Math.PI / 2, 0, 0], emi: 1.3, unlit: true }); // anneau équatorial
  K.tor(shields, P.alienGlow, { d: RING_R * 2 - 0.6, thick: 0.03, t: 20 }, [0, RING_Y + 1.3, 0], { rot: [Math.PI / 2, 0, 0], emi: 1.1, unlit: true }); // anneau supérieur (rétréci -> calotte)
  K.tor(shields, P.alienBoss, { d: RING_R * 2 - 0.2, thick: 0.03, t: 22 }, [0, RING_Y - 0.7, 0], { rot: [Math.PI / 2, 0, 0], emi: 1.0, unlit: true }); // anneau inférieur violet

  return { boosters, shields };
}
