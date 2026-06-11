// ============================================================================
//  SITES / REPÈRES (M7, Phase 5) — les SILHOUETTES low-poly des points d'intérêt
//  (grotte, ruines, mines, marais, épave & cuirassé alien) posées aux positions
//  déterministes de `map.sites`. Elles matérialisent le gradient « centre sûr →
//  bords dangereux » : on les aperçoit de loin et on marche jusqu'à elles.
//  v1 = silhouette repérable ; l'ENTRÉE explorable (setpiece) est M9.
//
//  LOD (perf P5) : chaque site est une ENTITÉ pilotée par EntityManager (P1) —
//  `full` = modèle détaillé (porté du labo) ; `minimal` = silhouette simplifiée
//  (bloc sombre, lisible au loin) ; `culled` = masqué au-delà (le brouillard cache).
//  On gère la bascule À LA MAIN (et pas via Mesh.addLODLevel) car nos sites sont
//  des INSTANCES : c'est la voie robuste recommandée (docs/perf-rendu.md §7).
//  Géométrie portée de lab/model-lab.html (catégorie « Sites »).
// ============================================================================

import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  VertexBuffer,
  TransformNode,
  type InstancedMesh,
} from "@babylonjs/core";
import { P } from "./lowpoly";
import { makeVCKit, type VCKit } from "./scatter";
import { terrainHeight } from "../../data/world";
import type { WorldMap } from "../sim/worldgen";
import type { EntityManager, Entity } from "./entities";

// Paliers LOD des sites (unités-monde). Les sites sont des REPÈRES : visibles bien plus
// loin que les villageois -> silhouette jusqu'à ~la limite du brouillard, détail de près.
const SITE_FULL = 80; // ≤ : modèle détaillé
const SITE_MINIMAL = 380; // ≤ : silhouette ; au-delà : masqué (brouillard)

export const SITE_TYPES = [
  "cave", "house", "town", "city", "ironmine", "coalmine", "sulphurmine",
  "borehole", "battlefield", "swamp", "cache", "ship", "executioner", "outpost",
] as const;

// Teinte de la silhouette par type (bloc sombre lu de loin ; accordée à la matière du site).
const SIL_TINT: Record<string, number[]> = {
  cave: P.stoneDark, house: P.ruinStone, town: P.ruinStone, city: P.ruinStone,
  ironmine: P.stoneDark, coalmine: P.stoneDark, sulphurmine: P.stoneDark,
  borehole: P.stoneDark, battlefield: P.scorch, swamp: P.mud, cache: P.ruinStone,
  ship: P.alienHull, executioner: P.armorDk, outpost: P.hide,
};

/** Yaw déterministe d'un site (reproductible chez tous les pairs : ne dépend que de la graine). */
function yawFor(cx: number, cz: number, seed: number): number {
  let h = (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ Math.imul(seed, 83492791)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return (h / 0xffffffff) * Math.PI * 2;
}

/** Peint toutes les faces d'un mesh d'une couleur unie (silhouette). */
function paintFlat(mesh: Mesh, col: number[]): void {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!pos) return;
  const n = pos.length / 3;
  const cols = new Array<number>(n * 4);
  for (let i = 0; i < n; i++) {
    cols[i * 4] = col[0];
    cols[i * 4 + 1] = col[1];
    cols[i * 4 + 2] = col[2];
    cols[i * 4 + 3] = 1;
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, cols, false);
}

/** Arbre mort (tronc nu + branches) — inliné pour le marais (porté du labo, case 'dead'). */
function deadTree(K: VCKit, parent: TransformNode, pos: number[], scale: number, ry: number): void {
  const t = K.node(parent, pos);
  t.scaling.setAll(scale);
  t.rotation.y = ry;
  K.cyl(t, P.woodDark, { h: 2.6, dt: 0.14, db: 0.46 }, [0, 1.3, 0]);
  K.cyl(t, P.woodDark, { h: 1.2, dt: 0.06, db: 0.14 }, [0.35, 2.2, 0.1], { rot: [0, 0, -0.9] });
  K.cyl(t, P.woodDark, { h: 1.0, dt: 0.05, db: 0.12 }, [-0.3, 2.5, -0.1], { rot: [0.2, 0, 0.8] });
  K.cyl(t, P.woodDark, { h: 0.7, dt: 0.04, db: 0.09 }, [0.1, 2.9, 0.2], { rot: [-0.7, 0, 0.2] });
}

/** Une entrée de mine (adit à cadre de bois + tas de minerai `tint` + wagonnet). */
function mine(K: VCKit, root: TransformNode, tint: number[]): void {
  K.ico(root, P.stoneDark, { d: 2.4 }, [0, 0.9, -0.4], { scale: [1.3, 0.9, 1] });
  K.box(root, P.woodDark, [0.2, 1.4, 0.2], [-0.7, 0.7, 0.6]);
  K.box(root, P.woodDark, [0.2, 1.4, 0.2], [0.7, 0.7, 0.6]);
  K.box(root, P.woodDark, [1.8, 0.25, 0.25], [0, 1.45, 0.6]); // linteau
  K.box(root, P.dark, [1.2, 1.3, 0.4], [0, 0.65, 0.55]); // ouverture sombre
  K.ico(root, tint, { d: 0.7 }, [1.1, 0.3, 1.0]); // tas de minerai
  K.ico(root, tint, { d: 0.5 }, [-1.0, 0.25, 1.0]);
  K.box(root, P.metalDark, [0.5, 0.3, 0.7], [0.2, 0.25, 1.45]); // wagonnet
  K.tor(root, P.metalDark, { d: 0.32, thick: 0.05 }, [0.05, 0.18, 1.7], { rot: [0, 0, Math.PI / 2] });
  K.tor(root, P.metalDark, { d: 0.32, thick: 0.05 }, [0.35, 0.18, 1.7], { rot: [0, 0, Math.PI / 2] });
}

/** Construit le modèle DÉTAILLÉ d'un site (géométrie portée du labo, catégorie « Sites »). */
function buildSite(K: VCKit, type: string): TransformNode {
  const root = K.node(null);
  switch (type) {
    case "cave":
      K.ico(root, P.stone, { d: 3.2 }, [0, 1.2, -0.7], { scale: [1.3, 0.95, 1] });
      K.ico(root, P.stoneDark, { d: 2.2 }, [-1.5, 0.8, 0.3], { rot: [0, 1, 0.1] });
      K.ico(root, P.stone, { d: 2.0 }, [1.6, 0.7, 0.4], { rot: [0, 2, 0] });
      K.box(root, P.dark, [1.7, 1.5, 0.6], [0, 0.8, 0.9]); // bouche sombre
      K.cyl(root, P.dark, { h: 0.5, d: 1.7, t: 10 }, [0, 1.55, 0.9], { rot: [Math.PI / 2, 0, 0] }); // voûte
      K.ico(root, P.stoneDark, { d: 0.9 }, [-1.0, 0.4, 1.2]);
      K.ico(root, P.stoneDark, { d: 0.7 }, [1.1, 0.35, 1.2]);
      break;
    case "house":
      K.box(root, [0.18, 0.16, 0.14], [3.0, 0.2, 2.6], [0, 0.1, 0]); // fondation
      K.box(root, P.ruinStone, [3.0, 1.5, 0.25], [0, 0.85, -1.2]); // mur arrière
      K.box(root, P.ruinStone, [0.25, 1.0, 2.6], [-1.4, 0.6, 0]); // mur gauche
      K.box(root, P.ruinStone, [0.25, 0.5, 1.6], [1.4, 0.35, -0.4]); // mur droit effondré
      K.box(root, P.ruinStone, [0.25, 1.1, 0.25], [-1.0, 0.65, 1.2]); // montant de façade
      K.cyl(root, P.woodDark, { h: 2.5, d: 0.12 }, [0.3, 0.5, 0.2], { rot: [0, 0.4, 1.3] }); // poutres
      K.cyl(root, P.woodDark, { h: 2.0, d: 0.1 }, [-0.4, 0.3, -0.3], { rot: [0, -0.3, 1.5] });
      K.ico(root, P.ruinStone, { d: 0.6 }, [0.8, 0.25, 0.6]); // gravats
      K.ico(root, P.stoneDark, { d: 0.5 }, [-0.7, 0.2, 0.8]);
      K.box(root, P.woodDark, [0.5, 0.15, 0.5], [0.6, 0.12, -0.6]);
      break;
    case "town": {
      const frag = (x: number, z: number, ry: number, s: number): void => {
        const n = K.node(root, [x, 0, z]);
        n.rotation.y = ry;
        n.scaling.setAll(s);
        K.box(n, P.ruinStone, [2.0, 1.1, 0.22], [0, 0.6, -0.8]);
        K.box(n, P.ruinStone, [0.22, 0.8, 1.6], [-0.9, 0.45, 0]);
        K.box(n, P.ruinStone, [0.22, 0.4, 0.9], [0.9, 0.25, -0.3]);
        K.ico(n, P.stoneDark, { d: 0.5 }, [0.5, 0.2, 0.6]);
      };
      frag(-2.4, -1.6, 0.3, 1.0);
      frag(1.9, -2.1, -0.6, 0.85);
      frag(2.6, 1.6, 1.2, 0.9);
      frag(-1.6, 2.3, 2.4, 0.75);
      frag(0, 0.2, 0.8, 0.7);
      K.box(root, P.ruinStone, [0.3, 0.4, 3.0], [-3.4, 0.2, 0.6], { rot: [0, 0.2, 0] }); // muret
      break;
    }
    case "ironmine": mine(K, root, P.rust); break;
    case "coalmine": mine(K, root, P.coal); break;
    case "sulphurmine": mine(K, root, P.sulphurRock); break;
    case "swamp": {
      K.cyl(root, P.water, { h: 0.06, d: 6.0, t: 20 }, [0, 0.03, 0]); // eau
      K.cyl(root, P.mud, { h: 0.1, d: 2.0, t: 12 }, [-1.5, 0.05, 1.0]);
      K.cyl(root, P.mud, { h: 0.1, d: 1.6, t: 12 }, [1.8, 0.05, -1.2]);
      deadTree(K, root, [-1.5, 0.08, 1.0], 0.85, 0);
      deadTree(K, root, [1.8, 0.08, -1.2], 1.0, 1.2);
      deadTree(K, root, [0.5, 0.05, 2.2], 0.7, 0);
      const reeds = (x: number, z: number): void => {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          K.cyl(root, P.reed, { h: 0.9 + (i % 3) * 0.2, dt: 0.015, db: 0.03 },
            [x + Math.cos(a) * 0.18, 0.5, z + Math.sin(a) * 0.18], { rot: [Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08] });
        }
        K.cyl(root, P.reedHead, { h: 0.2, dt: 0.07, db: 0.07, t: 7 }, [x, 1.0, z]);
      };
      reeds(-2.4, -0.6); reeds(2.6, 1.0); reeds(0.2, -2.5); reeds(-0.8, 2.6);
      break;
    }
    case "ship": {
      // LE « Old Starship » (wanderer) ÉCHOUÉ — « Dard » : lame-intercepteur ALIEN plantée nez dans la
      // cendre, queue dressée. Fuseau facetté effilé, ailes en CROISSANT balayées vers l'avant + asymétrie,
      // anneau-mécanisme cyan, viseur-fente, DRIVE exotique cyan/violet à vannes, veines + épine à nodules.
      // Les pièces `emi`/`unlit` (anneau, veines, viseur, drive, nodules, brèche) partent dans le 2e mesh
      // ÉMISSIF (glowSink, cf. makeVCKit) -> elles LUISENT vraiment. Porté du labo (`ship-arrow`).
      const hull = [0.20, 0.33, 0.38], hullDk = [0.13, 0.21, 0.25], alloy = P.alienAlloy,
        cyan = [0.45, 0.95, 0.9], cyanHot = [0.72, 1.0, 0.97], violet = [0.62, 0.42, 0.92], magenta = [0.95, 0.46, 0.88],
        scorch = P.scorch, ash = [0.17, 0.16, 0.15];

      // crash : monticule + sillon + débris épars (seule asymétrie : l'épave éparpillée)
      K.cyl(root, ash, { h: 0.3, dt: 3.0, db: 4.0, t: 24 }, [0, 0.14, 0]);
      K.cyl(root, scorch, { h: 0.02, d: 4.6, t: 10 }, [0, 0.29, 2.7], { scale: [0.5, 1, 1.6] });
      K.box(root, hull, [0.6, 0.1, 0.4], [2.1, 0.2, -1.6], { rot: [0.2, 0.6, 0.1] });
      K.box(root, alloy, [0.5, 0.08, 0.35], [-2.3, 0.18, 0.9], { rot: [0.1, 1.0, 0.3] });

      const ship = K.node(root, [0, 1.0, -0.2]);
      ship.rotation.x = -0.5; // nez planté ; PAS de roulis -> bilatéralement symétrique
      ship.rotation.y = 0.2;

      // fuseau facetté effilé + nez + pointe + arête dorsale + veines (dorsale & ventrale) + coutures
      K.cyl(ship, hull, { h: 3.4, dt: 0.5, db: 0.95, t: 6 }, [0, 0, -0.25], { rot: [Math.PI / 2, 0, 0] });
      K.cone(ship, hull, { h: 1.5, d: 0.5, t: 6 }, [0, 0, 2.0], { rot: [Math.PI / 2, 0, 0] });
      K.cone(ship, alloy, { h: 0.45, d: 0.16, t: 6 }, [0, 0, 2.78], { rot: [Math.PI / 2, 0, 0] });
      K.box(ship, hullDk, [0.22, 0.28, 2.9], [0, 0.42, -0.15]);
      K.box(ship, cyan, [0.06, 0.06, 2.7], [0, 0.56, -0.15], { emi: 1.6, unlit: true });
      K.box(ship, cyan, [0.06, 0.06, 2.3], [0, -0.5, -0.2], { emi: 1.4, unlit: true });
      for (const sx of [1, -1]) K.box(ship, hullDk, [0.04, 0.32, 2.3], [sx * 0.34, 0.0, -0.2]);
      // anneau-mécanisme alien
      K.tor(ship, alloy, { d: 1.35, thick: 0.14, t: 18 }, [0, 0, 0.15], { rot: [Math.PI / 2, 0, 0] });
      K.tor(ship, cyan, { d: 1.08, thick: 0.07, t: 18 }, [0, 0, 0.15], { rot: [Math.PI / 2, 0, 0], emi: 1.7, unlit: true });
      // viseur-fente + 2 blisters magenta + capteurs + canards (symétriques)
      K.box(ship, cyanHot, [0.5, 0.1, 0.5], [0, 0.4, 1.25], { emi: 1.6, unlit: true, rot: [0.35, 0, 0] });
      for (const sx of [1, -1]) {
        K.sph(ship, magenta, { d: 0.26, seg: 6 }, [sx * 0.38, 0.28, 1.35], { emi: 1.4, unlit: true });
        K.cyl(ship, alloy, { h: 0.5, dt: 0.02, db: 0.06, t: 5 }, [sx * 0.22, 0.5, 1.7], { rot: [1.15, 0, 0] });
        K.box(ship, hull, [0.9, 0.08, 0.5], [sx * 0.62, 0.04, 1.15], { rot: [0, sx * 0.35, sx * -0.1] });
        K.box(ship, cyan, [0.7, 0.04, 0.06], [sx * 0.62, -0.01, 1.32], { rot: [0, sx * 0.35, sx * -0.1], emi: 1.3, unlit: true });
      }
      // ailes forward-swept ÉGALES + veine + winglet + pod sous voilure (symétriques)
      for (const sx of [1, -1]) {
        K.box(ship, hull, [2.4, 0.14, 1.3], [sx * 1.2, -0.05, 0.35], { rot: [0, sx * -0.5, sx * -0.12] });
        K.box(ship, cyan, [2.0, 0.05, 0.1], [sx * 1.2, -0.12, 0.72], { rot: [0, sx * -0.5, sx * -0.12], emi: 1.5, unlit: true });
        K.box(ship, hullDk, [0.26, 0.4, 0.66], [sx * 2.3, 0.05, 0.78], { rot: [0, sx * -0.5, 0] });
        K.sph(ship, alloy, { d: 0.42, seg: 8 }, [sx * 1.5, -0.2, 0.3], { scale: [1.5, 0.7, 1] });
        K.cyl(ship, cyan, { h: 0.08, d: 0.26, t: 10 }, [sx * 1.5, -0.2, -0.05], { rot: [Math.PI / 2, 0, 0], emi: 1.4, unlit: true });
      }
      // DRIVE exotique central : carénage + cerclage + cœur violet + noyau cyan + 4 vannes
      K.cyl(ship, alloy, { h: 0.5, dt: 1.25, db: 0.95, t: 8 }, [0, 0, -1.95], { rot: [Math.PI / 2, 0, 0] });
      K.tor(ship, alloy, { d: 1.12, thick: 0.08, t: 16 }, [0, 0, -2.12], { rot: [Math.PI / 2, 0, 0] });
      K.cyl(ship, violet, { h: 0.16, d: 1.0, t: 14 }, [0, 0, -2.2], { rot: [Math.PI / 2, 0, 0], emi: 1.6, unlit: true });
      K.cyl(ship, cyanHot, { h: 0.1, d: 0.52, t: 12 }, [0, 0, -2.26], { rot: [Math.PI / 2, 0, 0], emi: 2.0, unlit: true });
      for (const a of [0.785, 2.356, 3.927, 5.498]) K.box(ship, alloy, [0.12, 0.5, 0.4], [Math.cos(a) * 0.72, Math.sin(a) * 0.72, -2.0], { rot: [0, 0, a] });
      // épine à nodules (central) + ailerons de queue en V + double patin (symétriques)
      for (let i = 0; i < 3; i++) K.sph(ship, cyan, { d: 0.16 }, [0, 0.56, -0.8 - i * 0.5], { emi: 1.6, unlit: true });
      for (const sx of [1, -1]) K.box(ship, hull, [0.1, 0.62, 0.7], [sx * 0.45, 0.32, -1.7], { rot: [0.25, 0, sx * 0.5] });
      for (const sx of [1, -1]) K.cyl(ship, alloy, { h: 0.7, d: 0.1, t: 6 }, [sx * 0.6, -0.5, -0.6], { rot: [0, 0, sx * 0.6] });
      break;
    }
    case "executioner": {
      const hull = K.node(root, [0, 0.6, 0]);
      hull.rotation.z = -0.12;
      hull.rotation.y = 0.12;
      K.box(hull, P.armor, [3.0, 2.0, 7.0], [0, 0.4, 0]);
      K.box(hull, P.armorDk, [3.4, 0.8, 7.2], [0, 1.5, 0]); // pont
      K.box(hull, P.armorDk, [3.2, 1.3, 1.2], [0, 0.6, 2.7], { rot: [0.3, 0, 0] }); // étrave
      K.box(hull, P.armor, [2.2, 1.7, 1.4], [0, 0.4, 3.9]); // proue
      K.box(hull, P.armorDk, [1.7, 1.5, 2.2], [0, 2.3, -1.2]); // passerelle
      K.box(hull, P.alienAlloy, [1.2, 0.5, 1.0], [0, 3.1, -1.2]); // tourelle
      K.cyl(hull, P.armor, { h: 2.0, d: 0.42, t: 8 }, [0.6, 3.4, -1.6], { rot: [0.1, 0, 0.05] }); // canon
      for (let i = 0; i < 4; i++) K.box(hull, P.alienGlow, [0.12, 0.18, 0.5], [1.51, 0.7, -1.8 + i * 1.2], { emi: 1.3, unlit: true }); // lueurs (émissives)
      K.box(hull, P.dark, [1.1, 1.4, 1.6], [1.2, 0.5, 0.4]); // brèche
      K.box(hull, P.scorch, [1.4, 0.9, 0.1], [0, 0.9, 3.61]); // plaque fondue
      K.ico(hull, P.rust, { d: 0.9 }, [-1.5, 0.5, 1.2]);
      K.ico(hull, P.rust, { d: 0.7 }, [1.35, 1.0, -2.4]);
      K.cyl(root, [0.14, 0.13, 0.13], { h: 0.4, d: 8.5, t: 20 }, [0, 0.2, 0]); // terre soulevée
      break;
    }
    case "outpost": {
      // AVANT-POSTE (M9 R4) — porté du labo (« un lieu sûr dans les terres sauvages ») : appentis sur
      // 3 poteaux, FEU dehors devant, caisse + gourde sous l'abri, toile de cuir tendue à l'arrière,
      // barre à viande séchée, fanion-repère. (Recharge eau + voyage rapide = effet M6/M7.)
      // NB : la toile courbe du labo (CreateRibbon) est rendue ici par une NAPPE inclinée (box) +
      // ourlet/latte en fins cylindres — `sites.ts` fusionne en vertex-colors (pas de ribbon/tube).
      const SIDE = 0.85, BACK = -0.85, FRONT = 0.95, HB = 2.3, HF = 1.65;
      // 3 poteaux : 2 arrière hauts (côté toile) + 1 avant court (côté feu).
      K.cyl(root, P.woodDark, { h: HB, d: 0.13 }, [-SIDE, HB / 2, BACK]);
      K.cyl(root, P.woodDark, { h: HB, d: 0.13 }, [SIDE, HB / 2, BACK]);
      K.cyl(root, P.woodDark, { h: HF, d: 0.13 }, [0, HF / 2, FRONT]);
      K.cyl(root, P.woodDark, { h: 1.95, d: 0.08 }, [0, HB, BACK], { rot: [0, 0, Math.PI / 2] }); // faîtière
      K.box(root, P.roof, [2.0, 0.12, 2.1], [0, 1.98, 0], { rot: [0.358, 0, 0] }); // toit appentis
      // FEU dehors devant (émissif -> glowSink)
      const fire = K.node(root, [-1.2, 0, 1.3]);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; K.box(fire, P.stoneDark, [0.16, 0.15, 0.16], [Math.cos(a) * 0.32, 0.08, Math.sin(a) * 0.32], { rot: [0, a, 0] }); }
      for (let i = 0; i < 3; i++) K.cyl(fire, P.trunk, { h: 0.6, d: 0.08 }, [0, 0.13, 0], { rot: [0, i * 1.05, Math.PI / 2] });
      K.sph(fire, P.ember, { d: 0.24, seg: 6 }, [0, 0.16, 0], { emi: 1.7, unlit: true });
      K.cone(fire, P.fire, { h: 0.42, d: 0.24, t: 6 }, [0, 0.35, 0], { emi: 1.5, unlit: true });
      K.cone(fire, P.emberHot, { h: 0.3, d: 0.15, t: 6 }, [0.07, 0.32, -0.03], { emi: 1.7, unlit: true });
      // CAISSE + GOURDE sous l'abri
      K.box(root, P.wood, [0.7, 0.55, 0.6], [-0.32, 0.28, -0.1]);
      K.box(root, P.woodLight, [0.74, 0.07, 0.64], [-0.32, 0.59, -0.1]); // couvercle
      K.box(root, P.metalDark, [0.08, 0.2, 0.05], [-0.32, 0.4, 0.21]); // ferrure
      const g = K.node(root, [-0.32, 0.62, -0.1]);
      K.sph(g, [0.4, 0.47, 0.34], { d: 0.3, seg: 8 }, [0, 0.16, 0], { scale: [1, 1.15, 0.8] });
      K.cyl(g, [0.36, 0.43, 0.31], { h: 0.1, dt: 0.07, db: 0.13 }, [0, 0.33, 0]);
      K.cyl(g, P.woodDark, { h: 0.06, d: 0.08 }, [0, 0.4, 0]);
      K.tor(g, P.woodDark, { d: 0.27, thick: 0.022, t: 10 }, [0, 0.2, 0], { rot: [0.5, 0, 0] });
      // TOILE DE CUIR tendue à l'arrière (nappe inclinée ~du toit au sol) + ourlet bas + latte au faîte
      const hideDk = [P.hide[0] * 0.78, P.hide[1] * 0.78, P.hide[2] * 0.78];
      const tarp = K.node(root, [0, 1.16, -1.28]); tarp.rotation.x = 0.27;
      K.box(tarp, P.hide, [1.9, 2.36, 0.06], [0, 0, 0]);
      K.cyl(root, P.woodDark, { h: 1.9, d: 0.05, t: 6 }, [0, 2.28, -0.96], { rot: [0, 0, Math.PI / 2] }); // latte au faîte
      K.cyl(root, hideDk, { h: 1.94, d: 0.07, t: 6 }, [0, 0.04, -1.6], { rot: [0, 0, Math.PI / 2] }); // ourlet roulé
      // BARRE À VIANDE SÉCHÉE entre les 2 poteaux arrière (5 lanières, déterministe)
      const barY = 1.45, slope = 0.09;
      K.cyl(root, P.woodLight, { h: 1.85, d: 0.05 }, [0, barY, BACK + 0.07], { rot: [0, 0, Math.PI / 2 - slope] });
      for (let i = 0; i < 5; i++) { const x = -0.78 + (i / 4) * 1.56; K.box(root, [0.5, 0.2, 0.16], [0.07, 0.28, 0.05], [x, barY + x * Math.tan(slope) - 0.16, BACK + 0.07]); }
      // FANION-repère (point de voyage rapide)
      K.cyl(root, P.woodLight, { h: 0.5, d: 0.04 }, [SIDE, HB + 0.25, BACK]);
      K.box(root, P.banner, [0.38, 0.26, 0.03], [SIDE + 0.21, HB + 0.42, BACK]);
      break;
    }
    case "city": {
      // CITÉ EN RUINE — le plus gros donjon : tours brisées multi-étages, flèche penchée, gravats,
      // lueur d'alliage (l'alien a frappé ici). Plus imposant que `town`.
      const tower = (x: number, z: number, h: number, w: number, ry: number): void => {
        const n = K.node(root, [x, 0, z]); n.rotation.y = ry;
        K.box(n, P.ruinStone, [w, h, w], [0, h / 2, 0]);
        K.box(n, P.dark, [w * 0.42, h * 0.5, 0.3], [0, h * 0.45, w * 0.5 + 0.02]); // fenêtres sombres
        K.box(n, P.dark, [0.3, h * 0.5, w * 0.42], [w * 0.5 + 0.02, h * 0.45, 0]);
        K.box(n, P.stoneDark, [w * 0.6, 0.4, w * 0.6], [w * 0.18, h + 0.1, -w * 0.18], { rot: [0.12, 0.3, 0.12] }); // sommet effondré
      };
      tower(-2.8, -2.2, 4.5, 1.6, 0.2);
      tower(2.4, -2.6, 6.2, 1.4, -0.3);
      tower(2.9, 2.2, 3.6, 1.8, 0.5);
      tower(-2.2, 2.8, 5.0, 1.3, 1.1);
      tower(0.2, 0.0, 7.6, 1.2, 0.7); // tour centrale haute
      K.cyl(root, P.ruinStone, { h: 4.0, dt: 0.2, db: 0.7, t: 6 }, [-0.6, 2.0, -0.6], { rot: [0.1, 0.4, 0.18] }); // flèche penchée
      K.cone(root, P.stoneDark, { h: 1.0, d: 0.5, t: 6 }, [-0.95, 4.1, -0.86], { rot: [0.1, 0, 0.18] });
      K.cyl(root, P.woodDark, { h: 3.5, d: 0.16 }, [1.0, 0.4, 0.9], { rot: [0, 0.5, 1.35] }); // poutres
      K.cyl(root, P.woodDark, { h: 2.8, d: 0.12 }, [-1.3, 0.3, -0.5], { rot: [0, -0.3, 1.5] });
      for (const [gx, gz, gs] of [[1.5, -0.6, 0.8], [-1.9, 1.4, 0.6], [0.6, 2.5, 0.7], [-0.4, -2.9, 0.5]] as const)
        K.ico(root, P.ruinStone, { d: gs }, [gx, gs * 0.4, gz]);
      K.box(root, P.ruinStone, [0.35, 0.5, 4.6], [-4.3, 0.25, 0.5], { rot: [0, 0.15, 0] }); // muret long
      K.ico(root, P.alienAlloy, { d: 0.6 }, [1.7, 0.3, 1.9]); // impact alien (butin)
      K.sph(root, P.alienGlow, { d: 0.3, seg: 6 }, [1.7, 0.46, 1.9], { emi: 1.3, unlit: true });
      break;
    }
    case "borehole": {
      // FORAGE : margelle + puits sombre + lueur d'alliage au fond + derrick (4 montants convergents) + déblais.
      K.cyl(root, P.stoneDark, { h: 0.3, dt: 3.2, db: 3.6, t: 16 }, [0, 0.15, 0]); // margelle
      K.cyl(root, P.dark, { h: 0.4, d: 2.2, t: 16 }, [0, 0.34, 0]); // trou sombre
      K.sph(root, P.alienGlow, { d: 0.55, seg: 8 }, [0, 0.12, 0], { emi: 1.0, unlit: true }); // lueur au fond
      const top = 4.2, base = 0.85;
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const)
        K.cyl(root, P.metalDark, { h: top, d: 0.12, t: 5 }, [sx * base, top / 2, sz * base], { rot: [sz * 0.32, 0, -sx * 0.32] });
      K.box(root, P.metalDark, [0.5, 0.18, 0.5], [0, top, 0]); // sommet
      for (const y of [1.5, 2.7]) { // cerclages horizontaux
        const s = base * (1 - (y / top) * 0.45);
        K.box(root, P.metal, [s * 2, 0.06, 0.06], [0, y, s]);
        K.box(root, P.metal, [s * 2, 0.06, 0.06], [0, y, -s]);
        K.box(root, P.metal, [0.06, 0.06, s * 2], [s, y, 0]);
        K.box(root, P.metal, [0.06, 0.06, s * 2], [-s, y, 0]);
      }
      K.ico(root, P.rust, { d: 0.8 }, [2.0, 0.3, 0.7]); // déblais
      K.ico(root, P.stoneDark, { d: 0.6 }, [-1.9, 0.25, -1.0]);
      K.box(root, P.wood, [0.6, 0.5, 0.6], [-1.9, 0.4, 0.9]); // caisse
      break;
    }
    case "battlefield": {
      // CHAMP DE BATAILLE : sol brûlé, cratères, fusils plantés, ossements, chariot renversé, étendard.
      K.cyl(root, P.scorch, { h: 0.04, d: 5.0, t: 16 }, [0, 0.02, 0], { scale: [1, 1, 0.82] });
      for (const [cx2, cz2, cd] of [[1.4, 1.0, 1.8], [-1.8, -0.6, 1.4], [0.4, -2.0, 1.2]] as const)
        K.cyl(root, P.dark, { h: 0.1, d: cd, t: 12 }, [cx2, 0.05, cz2]); // cratères
      const rifle = (x: number, z: number, ry: number): void => {
        const n = K.node(root, [x, 0, z]); n.rotation.set(0, ry, 0.35);
        K.cyl(n, P.metalDark, { h: 1.3, d: 0.07, t: 5 }, [0, 0.65, 0]);
        K.box(n, P.woodDark, [0.1, 0.4, 0.16], [0, 0.2, 0]);
      };
      rifle(-0.8, 0.6, 0.4); rifle(1.2, -0.4, -0.7); rifle(2.2, 1.6, 1.1);
      for (const [bx, bz] of [[-1.2, 1.4], [0.8, -1.2], [-2.0, 0.8]] as const) {
        K.sph(root, P.bone, { d: 0.3, seg: 6 }, [bx, 0.15, bz]);
        K.cyl(root, P.bone, { h: 0.6, d: 0.06, t: 4 }, [bx + 0.3, 0.1, bz + 0.2], { rot: [0, 0, Math.PI / 2] });
      }
      const cart = K.node(root, [-1.7, 0, -1.8]); cart.rotation.z = 1.4;
      K.box(cart, P.wood, [1.2, 0.7, 0.9], [0, 0.5, 0]);
      K.tor(cart, P.woodDark, { d: 0.7, thick: 0.08 }, [0.5, 0.9, 0.5], { rot: [0, 0, Math.PI / 2] });
      K.tor(cart, P.woodDark, { d: 0.7, thick: 0.08 }, [0.5, 0.9, -0.5], { rot: [0, 0, Math.PI / 2] });
      K.cyl(root, P.woodDark, { h: 2.4, d: 0.08 }, [2.5, 1.2, -1.4], { rot: [0.1, 0, 0.08] }); // mât
      K.box(root, P.banner, [0.5, 0.8, 0.04], [2.8, 1.7, -1.4], { rot: [0, 0, 0.08] }); // étendard
      K.box(root, P.metalDark, [0.6, 0.4, 0.4], [0.6, 0.3, 1.9]); // caisse de munitions (butin)
      K.box(root, P.alienAlloy, [0.5, 0.1, 0.3], [0.6, 0.55, 1.9]);
      break;
    }
    case "cache": {
      // VILLAGE DÉTRUIT (cache de prestige) : maisons effondrées envahies + coffre à demi-enterré qui luit.
      const wreck = (x: number, z: number, ry: number, s: number): void => {
        const n = K.node(root, [x, 0, z]); n.rotation.y = ry; n.scaling.setAll(s);
        K.box(n, [0.18, 0.16, 0.14], [2.2, 0.16, 2.0], [0, 0.08, 0]); // fondation
        K.box(n, P.ruinStone, [2.2, 0.7, 0.22], [0, 0.45, -0.9]); // pan de mur
        K.box(n, P.ruinStone, [0.22, 0.5, 1.4], [-1.0, 0.35, 0]);
        K.cyl(n, P.woodDark, { h: 2.0, d: 0.1 }, [0.4, 0.3, 0.2], { rot: [0, 0.3, 1.45] }); // poutre tombée
        K.ico(n, P.stoneDark, { d: 0.5 }, [0.6, 0.2, 0.5]);
      };
      wreck(-2.0, -1.4, 0.4, 1.0);
      wreck(2.0, -1.0, -0.6, 0.85);
      wreck(1.4, 2.0, 1.2, 0.9);
      wreck(-1.8, 1.8, 2.2, 0.8);
      for (const [gx, gz] of [[0, 0], [1.2, -2.0], [-1.2, 1.2]] as const) K.cyl(root, P.bush, { h: 0.5, dt: 0.02, db: 0.2, t: 5 }, [gx, 0.25, gz]); // herbes folles
      const chest = K.node(root, [0.2, 0, 0.3]); chest.rotation.y = 0.5;
      K.box(chest, P.wood, [1.0, 0.5, 0.7], [0, 0.2, 0]);
      K.box(chest, P.woodDark, [1.04, 0.18, 0.74], [0, 0.42, 0]); // couvercle bombé
      K.box(chest, P.metalDark, [1.06, 0.08, 0.1], [0, 0.3, 0]); // ferrure
      K.sph(chest, P.emberHot, { d: 0.12, seg: 5 }, [0, 0.36, 0.38], { emi: 1.2, unlit: true }); // serrure qui luit
      break;
    }
    default:
      break;
  }
  return root;
}

interface PlacedSite {
  key: string; // "cx,cz" — pour l'override d'état (grotte nettoyée -> avant-poste)
  detailed: InstancedMesh;
  glow: InstancedMesh | null; // accents émissifs (null si le type n'en a pas)
  silhouette: InstancedMesh;
  // Modèle ALTERNATIF affiché quand le site est « nettoyé » (grottes -> avant-poste). null sinon.
  altDetailed: InstancedMesh | null;
  altGlow: InstancedMesh | null;
  altSil: InstancedMesh | null;
  cleared: boolean;
  suppressed: boolean; // intérieur 3D actif (proche) -> on masque le modèle décoratif (évite le doublon)
  entity: Entity;
}

/** Registre des sites : un mesh détaillé + une silhouette par type ; instances posées par carte. */
export class Sites {
  private readonly detailedBases = new Map<string, Mesh>();
  private readonly glowBases = new Map<string, Mesh>(); // accents émissifs (vaisseau, cuirassé) — palier `full` seul
  private readonly silBases = new Map<string, Mesh>();
  private readonly parent: TransformNode;
  private placed: PlacedSite[] = [];

  constructor(private readonly scene: Scene) {
    const mat = new StandardMaterial("siteMat", scene);
    mat.diffuseColor = Color3.White();
    mat.specularColor = new Color3(0, 0, 0);

    // Matériau des accents émissifs : NON éclairé + emissive blanc -> la couleur (portée par les
    // vertex colors, déjà boostée par `emi` dans le kit) ressort telle quelle et « luit » (bloom).
    const glowMat = new StandardMaterial("siteGlowMat", scene);
    glowMat.diffuseColor = Color3.Black();
    glowMat.specularColor = new Color3(0, 0, 0);
    glowMat.emissiveColor = Color3.White();
    glowMat.disableLighting = true;

    this.parent = new TransformNode("sites", scene);

    for (const t of SITE_TYPES) {
      const sink: Mesh[] = [];
      const glowSink: Mesh[] = [];
      const K = makeVCKit(scene, sink, glowSink);
      const root = buildSite(K, t);
      const base = Mesh.MergeMeshes(sink, true, true, undefined, false, false);
      const glow = glowSink.length ? Mesh.MergeMeshes(glowSink, true, true, undefined, false, false) : null;
      root.dispose();
      if (!base) continue;
      base.name = "siteBase-" + t;
      base.material = mat;
      base.useVertexColors = true;
      base.convertToFlatShadedMesh();
      base.isVisible = false; // source d'instances
      this.detailedBases.set(t, base);
      if (glow) {
        glow.name = "siteGlow-" + t;
        glow.material = glowMat;
        glow.useVertexColors = true;
        glow.convertToFlatShadedMesh();
        glow.isVisible = false;
        this.glowBases.set(t, glow);
      }
      this.silBases.set(t, this.makeSilhouette(base, t, mat));
    }
  }

  /** Silhouette = bloc sombre aux dimensions du modèle, reposant au sol (lisible de loin). */
  private makeSilhouette(detailed: Mesh, type: string, mat: StandardMaterial): Mesh {
    detailed.computeWorldMatrix(true);
    detailed.refreshBoundingInfo();
    const bb = detailed.getBoundingInfo().boundingBox;
    const min = bb.minimum;
    const max = bb.maximum;
    const w = Math.max(0.6, (max.x - min.x) * 0.78);
    const d = Math.max(0.6, (max.z - min.z) * 0.78);
    const h = Math.max(0.8, max.y - Math.min(0, min.y));
    const box = MeshBuilder.CreateBox("siteSil-" + type, { width: w, height: h, depth: d }, this.scene);
    // Remonte la géométrie pour qu'elle repose au sol (y ∈ [0, h]), comme le modèle détaillé.
    const pos = box.getVerticesData(VertexBuffer.PositionKind)!;
    for (let i = 1; i < pos.length; i += 3) pos[i] += h / 2;
    box.updateVerticesData(VertexBuffer.PositionKind, pos);
    box.convertToFlatShadedMesh();
    paintFlat(box, SIL_TINT[type] ?? P.stoneDark);
    box.material = mat;
    box.useVertexColors = true;
    box.isVisible = false;
    return box;
  }

  /** Pose une silhouette par site de la carte + l'enregistre comme ENTITÉ LOD. Idempotent. */
  placeAll(map: WorldMap, entities: EntityManager): void {
    this.clear(entities);
    for (const s of map.sites) {
      const dBase = this.detailedBases.get(s.type);
      const sBase = this.silBases.get(s.type);
      if (!dBase || !sBase) continue;
      const gBase = this.glowBases.get(s.type) ?? null;
      const w = map.cellToWorldCenter(s.cx, s.cz);
      const y = terrainHeight(w.x, w.z);
      const ry = yawFor(s.cx, s.cz, map.seed);

      const detailed = dBase.createInstance("site-" + s.type);
      const glow = gBase ? gBase.createInstance("glow-" + s.type) : null;
      const silhouette = sBase.createInstance("sil-" + s.type);
      // Modèle alternatif « avant-poste » pour les GROTTES (affiché une fois nettoyées, cf. setCleared).
      let altDetailed: InstancedMesh | null = null, altGlow: InstancedMesh | null = null, altSil: InstancedMesh | null = null;
      if (s.type === "cave") {
        const oD = this.detailedBases.get("outpost"), oS = this.silBases.get("outpost"), oG = this.glowBases.get("outpost") ?? null;
        if (oD && oS) {
          altDetailed = oD.createInstance("outpost-det");
          altSil = oS.createInstance("outpost-sil");
          altGlow = oG ? oG.createInstance("outpost-glow") : null;
        }
      }
      const all = [detailed, glow, silhouette, altDetailed, altGlow, altSil].filter((m): m is InstancedMesh => !!m);
      for (const inst of all) {
        inst.position.set(w.x, y, w.z);
        inst.rotation.y = ry;
        inst.parent = this.parent;
        inst.setEnabled(false); // l'EntityManager allumera le bon palier
        inst.freezeWorldMatrix(); // statique (P4)
      }

      let ps: PlacedSite;
      const entity: Entity = {
        x: w.x, z: w.z,
        fullDist: SITE_FULL,
        minimalDist: SITE_MINIMAL,
        band: "culled",
        onBand: () => this.applyBand(ps), // l'affichage dépend du palier ET de l'état « nettoyé »
      };
      ps = { key: s.cx + "," + s.cz, detailed, glow, silhouette, altDetailed, altGlow, altSil, cleared: false, suppressed: false, entity };
      entities.register(entity);
      this.placed.push(ps);
    }
  }

  /** Affiche le bon palier (full/minimal) ET le bon modèle (normal vs avant-poste si nettoyé). */
  private applyBand(ps: PlacedSite): void {
    const b = ps.entity.band;
    const alt = ps.cleared && !!ps.altDetailed; // grotte nettoyée -> on montre l'avant-poste
    const sup = ps.suppressed; // intérieur 3D actif -> on masque le modèle décoratif détaillé
    ps.detailed.setEnabled(b === "full" && !alt && !sup);
    ps.glow?.setEnabled(b === "full" && !alt && !sup);
    ps.silhouette.setEnabled(b === "minimal" && !alt);
    ps.altDetailed?.setEnabled(b === "full" && alt && !sup);
    ps.altGlow?.setEnabled(b === "full" && alt && !sup);
    ps.altSil?.setEnabled(b === "minimal" && alt);
  }

  /** Reflète l'état sim : les sites dont la clé est dans `clearedKeys` montrent leur avant-poste. */
  setCleared(clearedKeys: Set<string>): void {
    for (const ps of this.placed) {
      const c = clearedKeys.has(ps.key);
      if (c !== ps.cleared) { ps.cleared = c; this.applyBand(ps); }
    }
  }

  /** Masque le modèle décoratif des sites dont l'intérieur 3D est ACTIF (proche) — évite le doublon. */
  setSuppressed(keys: Set<string>): void {
    for (const ps of this.placed) {
      const s = keys.has(ps.key);
      if (s !== ps.suppressed) { ps.suppressed = s; this.applyBand(ps); }
    }
  }

  /** Retire tous les sites posés (désenregistre les entités + dispose les instances). */
  clear(entities: EntityManager): void {
    for (const p of this.placed) {
      entities.unregister(p.entity);
      p.detailed.dispose();
      p.glow?.dispose();
      p.silhouette.dispose();
      p.altDetailed?.dispose();
      p.altGlow?.dispose();
      p.altSil?.dispose();
    }
    this.placed = [];
  }

  /** Stats HUD/e2e : sites posés, types connus, et combien sont au détail / en silhouette. */
  get stats(): { placed: number; types: number; full: number; minimal: number } {
    let full = 0;
    let minimal = 0;
    for (const p of this.placed) {
      if (p.entity.band === "full") full++;
      else if (p.entity.band === "minimal") minimal++;
    }
    return { placed: this.placed.length, types: this.detailedBases.size, full, minimal };
  }
}
