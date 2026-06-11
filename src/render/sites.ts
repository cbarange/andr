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
  ship: P.alienHull, executioner: P.alienHull, outpost: P.hide,
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
    case "house": {
      // VIEILLE MAISON EN RUINE — chaumière de pierre éventrée : murs ébréchés + porte, toiture
      // effondrée (poutres + chaume), CHEMINÉE + âtre froid, mobilier cassé, gravats, mousse/vigne.
      const stone = P.ruinStone, stoneDk = P.stoneDark, wood = P.woodDark, woodL = P.woodLight,
        thatch = [0.5, 0.42, 0.26], moss = [0.26, 0.36, 0.22], dark = P.dark;
      const W = 4.2, D = 3.6, bH = 2.2;
      K.box(root, stoneDk, [W + 0.5, 0.3, D + 0.5], [0, 0.15, 0]); // fondation
      K.box(root, [0.2, 0.18, 0.16], [W, 0.1, D], [0, 0.32, 0]); // dalle
      // mur arrière (bord supérieur dentelé) + fenêtre sombre à linteau
      K.box(root, stone, [W, bH, 0.3], [0, bH / 2 + 0.3, -D / 2]);
      K.box(root, stone, [W * 0.45, 0.55, 0.32], [W * 0.18, bH + 0.35, -D / 2]); // pignon résiduel
      K.box(root, dark, [0.9, 0.8, 0.34], [-W * 0.22, 1.35, -D / 2]); // fenêtre
      K.box(root, wood, [1.0, 0.12, 0.36], [-W * 0.22, 1.8, -D / 2]); // linteau fenêtre
      // murs latéraux : gauche partiel, droit éboulé bas
      K.box(root, stone, [0.3, 1.8, D * 0.72], [-W / 2, 1.2, -D * 0.08]);
      K.box(root, stone, [0.3, 0.7, D * 0.5], [W / 2, 0.65, -D * 0.2]);
      K.ico(root, stone, { d: 0.9 }, [W / 2, 0.4, D * 0.25]); // pan droit éboulé
      // façade : embrasure de porte (2 montants + linteau de guingois) + bout de mur
      for (const sx of [-1, 1]) K.box(root, stone, [0.32, 1.55, 0.32], [sx * 0.72, 1.1, D / 2]);
      K.box(root, wood, [1.7, 0.18, 0.22], [0, 1.65, D / 2], { rot: [0, 0, 0.07] }); // linteau de porte
      K.box(root, stone, [W * 0.3, 0.65, 0.3], [-W * 0.33, 0.62, D / 2]);
      // TOITURE EFFONDRÉE : pannes/chevrons tombés en travers + chaume épars
      K.cyl(root, wood, { h: D + 0.4, d: 0.18, t: 6 }, [-0.3, 1.35, 0.2], { rot: [0.5, 0.2, 0] });
      K.cyl(root, wood, { h: 2.6, d: 0.14, t: 6 }, [0.8, 0.9, -0.4], { rot: [0.9, -0.3, 0.1] });
      K.cyl(root, woodL, { h: 2.0, d: 0.1, t: 5 }, [-0.6, 0.7, 0.8], { rot: [1.1, 0.4, 0] });
      for (const [x, z, r] of [[0.4, 0.5, 0.3], [-0.9, -0.3, 1.0], [0.9, -0.8, -0.4]] as const)
        K.box(root, thatch, [0.9, 0.12, 0.7], [x, 0.44, z], { rot: [0.15, r, 0.1] });
      // CHEMINÉE (pignon droit) + ÂTRE froid (cendres)
      K.box(root, stoneDk, [0.7, 2.8, 0.7], [W / 2 - 0.1, 1.4, -D / 2 + 0.55]);
      K.box(root, stoneDk, [0.86, 0.3, 0.86], [W / 2 - 0.1, 2.85, -D / 2 + 0.55]); // couronnement
      K.box(root, dark, [0.5, 0.5, 0.4], [W / 2 - 0.25, 0.5, -D / 2 + 0.55]); // foyer
      K.ico(root, [0.12, 0.11, 0.1], { d: 0.4 }, [W / 2 - 0.25, 0.2, -D / 2 + 0.75]); // cendres
      // MOBILIER cassé : table renversée + tonneau défoncé + tabouret
      const tbl = K.node(root, [-0.6, 0, -0.1]); tbl.rotation.z = 1.35;
      K.box(tbl, woodL, [1.0, 0.1, 0.7], [0, 0.5, 0]);
      for (const [lx, lz] of [[-0.4, -0.28], [0.4, -0.28], [-0.4, 0.28], [0.4, 0.28]] as const) K.box(tbl, wood, [0.08, 0.5, 0.08], [lx, 0.25, lz]);
      K.cyl(root, wood, { h: 0.6, dt: 0.4, db: 0.46, t: 8 }, [1.1, 0.3, 0.6], { rot: [0.4, 0, 0.3] }); // tonneau couché
      K.box(root, woodL, [0.3, 0.4, 0.3], [0.2, 0.2, 1.0]); // tabouret
      // GRAVATS + MOUSSE + VIGNE grimpante
      for (let i = 0; i < 4; i++) { const a = i * 1.6; K.ico(root, i % 2 ? stone : stoneDk, { d: 0.5 + 0.2 * (i % 3) }, [Math.cos(a) * 1.7, 0.25, Math.sin(a) * 1.5]); }
      for (const [y, z] of [[1.6, -0.6], [0.8, 0.4]] as const) K.box(root, moss, [0.05, 0.5, 0.5], [-W / 2 + 0.16, y, z]); // mousse mur gauche
      for (let i = 0; i < 3; i++) K.cyl(root, moss, { h: 1.6, d: 0.05, t: 4 }, [-W * 0.28 + i * 0.3, 1.1, -D / 2 + 0.18], { rot: [0.1, 0, (i - 1) * 0.15] }); // vigne
      break;
    }
    case "town": {
      // GRAPPE DE RUINES — petit bourg abandonné : plusieurs maisons ruinées VARIÉES autour d'un PUITS
      // central, une ARCHE de ville, des rues (murets + pavés), un chariot renversé, un panneau penché.
      const stone = P.ruinStone, stoneDk = P.stoneDark, wood = P.woodDark, woodL = P.woodLight, dark = P.dark;
      K.cyl(root, [0.2, 0.19, 0.16], { h: 0.08, d: 13.5, t: 24 }, [0, 0.04, 0]); // terre battue / pavés usés
      // maison ruinée variée (kind 0 = toit effondré, 1 = étage cassé)
      const ruin = (x: number, z: number, ry: number, w: number, d: number, h: number, kind: number): void => {
        const n = K.node(root, [x, 0, z]); n.rotation.y = ry;
        K.box(n, stoneDk, [w + 0.3, 0.2, d + 0.3], [0, 0.1, 0]); // socle
        K.box(n, stone, [w, h, 0.28], [0, h / 2 + 0.1, -d / 2]); // mur arrière
        K.box(n, stone, [0.28, h * 0.7, d], [-w / 2, h * 0.35 + 0.1, 0]); // mur gauche partiel
        K.box(n, stone, [0.28, h * 0.4, d * 0.6], [w / 2, h * 0.2 + 0.1, -d * 0.2]); // droit éboulé
        K.box(n, dark, [w * 0.3, h * 0.4, 0.3], [w * 0.16, h * 0.42, -d / 2]); // fenêtre
        if (kind === 0) { K.cyl(n, wood, { h: d + 0.3, d: 0.16, t: 6 }, [0, h * 0.62, 0], { rot: [0.45, 0.2, 0] }); K.cyl(n, wood, { h: w, d: 0.12, t: 6 }, [0.2, h * 0.4, 0.3], { rot: [0, 0, Math.PI / 2] }); }
        else { K.box(n, woodL, [w * 0.82, 0.1, d * 0.7], [0, h * 0.6, -d * 0.1], { rot: [0.08, 0, 0.05] }); } // plancher d'étage cassé
        K.ico(n, stone, { d: 0.6 }, [w * 0.3, 0.3, d * 0.3]); // gravats
      };
      ruin(-3.6, -2.2, 0.3, 2.6, 2.2, 2.4, 0);
      ruin(2.7, -3.0, -0.5, 2.2, 2.0, 3.1, 1);
      ruin(3.9, 1.9, 0.9, 2.4, 2.6, 2.0, 0);
      ruin(-2.9, 3.3, 2.2, 2.0, 1.8, 2.7, 1);
      ruin(-4.6, 1.0, 1.4, 1.8, 1.6, 2.2, 0);
      ruin(0.6, -4.3, 0.1, 2.0, 1.8, 2.3, 1);
      // PUITS central (margelle + eau sombre + portique + seau)
      K.cyl(root, stoneDk, { h: 0.7, dt: 1.3, db: 1.5, t: 12 }, [0.5, 0.35, 0.5]);
      K.cyl(root, dark, { h: 0.2, d: 1.0, t: 12 }, [0.5, 0.7, 0.5]);
      for (const sx of [-1, 1]) K.cyl(root, wood, { h: 1.6, d: 0.12, t: 6 }, [0.5 + sx * 0.55, 1.1, 0.5]);
      K.cyl(root, wood, { h: 1.3, d: 0.1, t: 6 }, [0.5, 1.85, 0.5], { rot: [0, 0, Math.PI / 2] });
      K.box(root, woodL, [0.28, 0.3, 0.28], [0.5, 1.35, 0.5]); // seau pendu
      // ARCHE / PORTE DE VILLE (2 piliers + linteau + claveau tombant) à un bord
      for (const sx of [-1, 1]) K.box(root, stone, [0.6, 3.2, 0.6], [sx * 1.0 - 5.4, 1.6, -1.0]);
      K.box(root, stone, [2.0, 0.6, 0.7], [-5.4, 3.1, -1.0]);
      K.box(root, stone, [0.6, 0.9, 0.6], [-4.4, 3.5, -1.0], { rot: [0, 0, 0.3] }); // pierre tombant
      // RUES : murets bas + lignes de pavés/gravats
      K.box(root, stone, [0.3, 0.6, 5.0], [-1.6, 0.3, 0.5], { rot: [0, 0.2, 0] });
      K.box(root, stone, [4.0, 0.5, 0.3], [1.6, 0.25, -1.5], { rot: [0, 0.1, 0] });
      for (let i = 0; i < 9; i++) { const a = i * 0.7; K.ico(root, i % 2 ? stone : stoneDk, { d: 0.4 + 0.2 * (i % 3) }, [Math.cos(a) * 4.7, 0.2, Math.sin(a) * 4.7]); }
      // CHARIOT renversé + panneau de bois penché
      const cart = K.node(root, [3.1, 0, -1.1]); cart.rotation.z = 1.5;
      K.box(cart, wood, [1.2, 0.7, 0.9], [0, 0.5, 0]);
      for (const cz of [-0.5, 0.5]) K.tor(cart, woodL, { d: 0.7, thick: 0.08 }, [0.5, 0.9, cz], { rot: [0, 0, Math.PI / 2] });
      K.cyl(root, wood, { h: 1.8, d: 0.1, t: 6 }, [-3.2, 0.8, -3.6], { rot: [0.2, 0, 0.25] });
      K.box(root, woodL, [0.7, 0.4, 0.06], [-3.5, 1.5, -3.6], { rot: [0, 0, 0.25] }); // panneau
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
      // LE « CUIRASSÉ » / EXÉCUTEUR — setpiece de FIN (unique) : un COLOSSAL dreadnought ALIEN ravagé,
      // écrasé nez le premier (sillon + cratère), poupe relevée. Coque facettée teal + accents luisants
      // (cyan/violet/magenta), brèches sur intérieur lumineux + nervures, batteries (tourelles), tour de
      // commandement, drive à 3 nacelles, ailerons (dont un arraché au sol), la SENTINELLE « l'immortel »
      // (cœur magenta) qui le garde, et le BUTIN (alliage + cellules d'énergie). Dwarfe tous les sites.
      const hull = [0.20, 0.33, 0.38], hullDk = [0.13, 0.21, 0.25], alloy = P.alienAlloy,
        cyan = [0.45, 0.95, 0.9], cyanHot = [0.72, 1.0, 0.97], violet = [0.62, 0.42, 0.92], magenta = [0.95, 0.46, 0.88],
        scorch = P.scorch, ash = [0.17, 0.16, 0.15], dark = P.dark, HL = 26;

      // CRASH : bourrelet d'impact au nez + long sillon scorché (+Z) + débris épars + tesson d'aile arrachée.
      K.cyl(root, ash, { h: 0.4, dt: 9, db: 14, t: 20 }, [0, 0.2, 11]);
      K.cyl(root, scorch, { h: 0.03, d: 10, t: 16 }, [0, 0.42, 4], { scale: [1.4, 1, 4.0], unlit: true });
      for (const [x, z, s] of [[6, 18, 1.2], [-7, 15, 1.0], [9, 9, 0.9], [-5, 22, 0.8]] as const) K.ico(root, hull, { d: s }, [x, s * 0.4, z], { rot: [0.3, x, 0.1] });
      const wg = K.node(root, [10, 0, 16]); wg.rotation.set(0.2, 0.6, 0.5);
      K.box(wg, hull, [6, 0.5, 3], [0, 0, 0]); K.box(wg, cyan, [5, 0.06, 0.2], [0, 0.3, 0], { emi: 1.2, unlit: true });

      // COQUE PRINCIPALE — nez planté, poupe relevée, léger gîte.
      const ship = K.node(root, [0, 4.4, -1]); ship.rotation.set(-0.16, 0.05, 0.06);
      K.cyl(ship, hull, { h: HL, dt: 6, db: 10, t: 6 }, [0, 0, 0], { rot: [Math.PI / 2, 0, 0] }); // fuselage hexagonal effilé
      K.cone(ship, hull, { h: 7, d: 6, t: 6 }, [0, 0, HL / 2 + 2], { rot: [Math.PI / 2, 0, 0] }); // prow
      K.box(ship, hullDk, [7, 0.6, HL * 0.8], [0, 3.2, -1]); // pont
      K.box(ship, hullDk, [0.5, 1.4, HL * 0.9], [0, 2.4, 0]); // quille dorsale
      K.box(ship, cyan, [0.18, 0.18, HL * 0.85], [0, 3.6, -1], { emi: 1.5, unlit: true }); // veine dorsale
      for (const sx of [1, -1]) K.box(ship, cyan, [0.14, 0.14, HL * 0.8], [sx * 4.4, 0.2, -1], { emi: 1.3, unlit: true }); // veines de flanc
      for (let i = 0; i < 6; i++) K.box(ship, hullDk, [10.2, 0.1, 0.4], [0, 0, -HL / 2 + 2 + i * 4]); // coutures de plaques
      // BRÈCHES (trou sombre + lueur intérieure + nervures d'alliage)
      const breach = (z: number, side: number, col: number[]): void => {
        K.box(ship, dark, [3.5, 3.0, 3.0], [side * 2.2, 0.5, z]);
        K.ico(ship, col, { d: 1.2 }, [side * 2.0, 0.5, z], { emi: 1.4, unlit: true });
        for (let i = 0; i < 3; i++) K.cyl(ship, alloy, { h: 3.2, d: 0.18, t: 5 }, [side * 3.0, -1 + i * 1.0, z], { rot: [0, 0, 0.2] });
      };
      breach(2, 1, magenta); breach(-6, -1, cyan);
      // BATTERIES alien (tourelles à 2 canons), certaines affaissées
      const turret = (z: number, droop: number): void => {
        const t = K.node(ship, [0, 3.5, z]); t.rotation.x = droop;
        K.cyl(t, alloy, { h: 0.8, dt: 1.6, db: 2.0, t: 8 }, [0, 0, 0]);
        K.ico(t, hullDk, { d: 2.0 }, [0, 0.7, 0], { scale: [1, 0.7, 1] });
        for (const bx of [0.5, -0.5]) { K.cyl(t, alloy, { h: 3.0, d: 0.3, t: 6 }, [bx, 0.9, 1.2], { rot: [1.2, 0, 0] }); K.cyl(t, cyanHot, { h: 0.2, d: 0.34, t: 6 }, [bx, 0.9, 2.6], { rot: [1.2, 0, 0], emi: 1.6, unlit: true }); }
      };
      turret(6, 0.1); turret(0, -0.5); turret(-7, 0.3);
      // SUPERSTRUCTURE / tour de commandement (poupe) : bloc étagé + baies lumineuses + mâts + dôme capteur
      const tw = K.node(ship, [0, 3.5, -HL / 2 + 3]);
      K.box(tw, hull, [5, 4, 5], [0, 2, 0]);
      K.box(tw, hullDk, [4, 2.5, 4], [0, 5, -0.3]);
      for (let i = 0; i < 3; i++) K.box(tw, cyan, [4.2, 0.4, 0.1], [0, 1.2 + i * 1.1, 2.5], { emi: 1.4, unlit: true });
      K.box(tw, cyan, [0.1, 0.4, 4.2], [2.5, 5, -0.3], { emi: 1.2, unlit: true });
      K.cyl(tw, alloy, { h: 5, d: 0.2, t: 5 }, [1.5, 8, 0], { rot: [0.1, 0, 0.1] });
      K.cyl(tw, alloy, { h: 4, d: 0.16, t: 5 }, [-1.2, 7.5, -0.5], { rot: [0.2, 0, -0.15] });
      K.ico(tw, alloy, { d: 1.2 }, [0, 6.8, 0]); K.ico(tw, cyan, { d: 0.5 }, [0, 7.2, 0], { emi: 1.5, unlit: true });
      // DRIVE (poupe) : 3 grandes nacelles à cœur violet/cyan + cerclage
      for (const sx of [-1, 0, 1]) {
        const n = K.node(ship, [sx * 3.0, -0.5, -HL / 2 - 1]);
        K.cyl(n, alloy, { h: 4, dt: 2.4, db: 2.8, t: 8 }, [0, 0, 0], { rot: [Math.PI / 2, 0, 0] });
        K.cyl(n, violet, { h: 0.4, d: 2.2, t: 12 }, [0, 0, -1.8], { rot: [Math.PI / 2, 0, 0], emi: 1.5, unlit: true });
        K.cyl(n, cyanHot, { h: 0.2, d: 1.0, t: 10 }, [0, 0, -2.0], { rot: [Math.PI / 2, 0, 0], emi: 2.0, unlit: true });
      }
      K.tor(ship, alloy, { d: 9, thick: 0.5, t: 14 }, [0, 0, -HL / 2 - 0.5], { rot: [Math.PI / 2, 0, 0] });
      // ÉPINE dorsale à nodules + 2 ailerons (le 3ᵉ est le tesson au sol)
      for (let i = 0; i < 5; i++) K.ico(ship, cyan, { d: 0.4 }, [0, 4.0, -HL / 2 + 5 + i * 3], { emi: 1.4, unlit: true });
      for (const sx of [1, -1]) K.box(ship, hull, [5, 0.4, 6], [sx * 5.5, -0.5, -3], { rot: [0, 0, sx * -0.3] });

      // « L'IMMORTEL » — sentinelle gardienne dressée près d'une brèche (cœur magenta luisant).
      const sent = K.node(root, [6, 0, -2]); sent.rotation.y = -0.4;
      K.cyl(sent, hullDk, { h: 1.2, d: 1.4, t: 6 }, [0, 0.6, 0]);
      K.ico(sent, hull, { d: 2.2 }, [0, 2.4, 0], { scale: [1, 1.2, 0.9] });
      K.ico(sent, magenta, { d: 0.7 }, [0, 2.5, 0.6], { emi: 1.7, unlit: true });
      K.ico(sent, hullDk, { d: 1.0 }, [0, 3.8, 0]); K.ico(sent, cyan, { d: 0.3 }, [0, 3.9, 0.4], { emi: 1.5, unlit: true });
      for (const sx of [1, -1]) { K.cyl(sent, alloy, { h: 2.6, d: 0.4, t: 6 }, [sx * 1.3, 2.2, 0], { rot: [0, 0, sx * 0.3] }); K.cyl(sent, alloy, { h: 2.4, d: 0.5, t: 6 }, [sx * 0.6, 0.0, 0], { rot: [0, 0, sx * 0.08] }); }

      // BUTIN : masse d'alliage + cellules d'énergie au pied d'une brèche.
      K.ico(root, alloy, { d: 2.0 }, [-4, 0.6, 1]); K.ico(root, cyan, { d: 0.8 }, [-4, 1.2, 1], { emi: 1.6, unlit: true });
      for (let i = 0; i < 4; i++) K.box(root, cyanHot, [0.3, 0.3, 0.6], [-5 + i * 0.4, 0.4, 2], { emi: 1.7, unlit: true });
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
      // CITÉ MODERNE EN RUINE — le plus GROS site, imposant : skyline de gratte-ciels brisés (rangées de
      // fenêtres, certaines luisent), GRANDE HALLE à colonnade + rosace, boulevards, pont effondré, statue
      // renversée, et un GRAND IMPACT ALIEN (cratère scorché + masse d'alliage luisante). L'alien a frappé ici.
      const stone = P.ruinStone, stoneDk = P.stoneDark, steel = P.metalDark, dark = P.dark,
        scorch = P.scorch, aHull = P.alienHull, aAlloy = P.alienAlloy, aGlow = P.alienGlow;
      // gratte-ciel brisé multi-étages : bandes de fenêtres (4 faces), sommet dentelé, ferraille saillante.
      const tower = (x: number, z: number, h: number, w: number, ry: number, glow: boolean): void => {
        const n = K.node(root, [x, 0, z]); n.rotation.y = ry;
        K.box(n, stone, [w, h, w], [0, h / 2, 0]);
        const floors = Math.max(2, Math.round(h / 1.2));
        for (let f = 0; f < floors; f++) {
          const y = 0.8 + f * (h - 1.0) / floors;
          const lit = glow && f % 3 === 0;
          for (const [ox, oz, rw, rd] of [[0, w / 2 + 0.02, w * 0.72, 0.06], [0, -w / 2 - 0.02, w * 0.72, 0.06], [w / 2 + 0.02, 0, 0.06, w * 0.72], [-w / 2 - 0.02, 0, 0.06, w * 0.72]] as const)
            K.box(n, lit ? aGlow : dark, [rw, 0.42, rd], [ox, y, oz], lit ? { emi: 0.95, unlit: true } : undefined);
        }
        K.box(n, stoneDk, [w * 0.72, 0.5, w * 0.72], [w * 0.14, h + 0.15, -w * 0.14], { rot: [0.1, 0.3, 0.1] }); // sommet effondré
        K.cyl(n, steel, { h: 1.1, d: 0.08, t: 5 }, [w * 0.28, h + 0.5, w * 0.18], { rot: [0.25, 0, 0.12] }); // ferraille
      };
      tower(-4.5, -3.6, 6.0, 1.8, 0.2, false);
      tower(3.6, -4.0, 9.5, 1.6, -0.3, true);
      tower(4.6, 2.6, 5.0, 2.0, 0.5, false);
      tower(-3.6, 3.6, 7.6, 1.5, 1.1, true);
      tower(0.6, 0.2, 11.0, 1.6, 0.7, true); // gratte-ciel central, dominant
      tower(-6.1, 0.6, 4.2, 1.4, 0.3, false);
      tower(1.6, 4.6, 6.4, 1.3, -0.6, false);
      // GRANDE HALLE effondrée : stylobate + colonnade (certaines colonnes brisées) + architrave + rosace.
      const hall = K.node(root, [-1.0, 0, -5.2]); hall.rotation.y = 0.1;
      K.box(hall, stone, [5.2, 0.4, 0.4], [0, 0.2, 1.2]);
      for (let i = 0; i < 5; i++) { const cx2 = -2 + i * 1.0, ch = i % 2 ? 2.4 : 3.0; K.cyl(hall, stone, { h: ch, d: 0.5, t: 8 }, [cx2, ch / 2 + 0.2, 1.2]); if (i % 2) K.cyl(hall, stoneDk, { h: 0.4, d: 0.7, t: 8 }, [cx2, ch + 0.4, 1.2]); }
      K.box(hall, stone, [4.6, 1.2, 0.6], [0, 3.4, 1.2], { rot: [0, 0, 0.04] }); // architrave/fronton
      K.cyl(hall, dark, { h: 0.3, d: 1.5, t: 14 }, [0, 3.7, 1.0], { rot: [Math.PI / 2, 0, 0] }); // rosace sombre
      // BOULEVARDS : longs murets effondrés (avenues entre les tours).
      for (const [x, z, len, ry] of [[0, 2.6, 11, 0.0], [-2.2, -1, 9, Math.PI / 2], [3.2, 1, 8, 0.4]] as const)
        K.box(root, stone, [0.4, 0.7, len], [x, 0.35, z], { rot: [0, ry, 0] });
      // PONT / passerelle BRISÉ (travée sur 2 piles, bout tombant).
      for (const sx of [-1, 1]) K.box(root, stoneDk, [0.7, 3.0, 0.7], [sx * 1.5 + 5.6, 1.5, -1.0]);
      K.box(root, stone, [4.0, 0.5, 1.0], [5.6, 3.0, -1.0], { rot: [0, 0, 0.05] });
      K.box(root, stone, [1.3, 0.5, 1.0], [8.0, 2.6, -1.0], { rot: [0, 0, -0.45] });
      // STATUE renversée (piédestal + figure brisée au sol).
      K.box(root, stoneDk, [1.0, 1.0, 1.0], [-2.2, 0.5, 1.6]);
      K.cyl(root, stone, { h: 1.6, dt: 0.3, db: 0.5, t: 8 }, [-2.8, 0.4, 2.4], { rot: [1.4, 0.3, 0] });
      K.sph(root, stone, { d: 0.5, seg: 6 }, [-3.4, 0.3, 2.8]); // tête au sol
      // GRAND IMPACT ALIEN : cratère scorché + masse d'alliage luisante + tesson de coque + ferraille tordue.
      K.cyl(root, dark, { h: 0.22, dt: 2.0, db: 3.6, t: 16 }, [2.6, 0.11, 3.6]);
      K.cyl(root, scorch, { h: 0.03, d: 5.2, t: 16 }, [2.6, 0.24, 3.6], { unlit: true });
      K.ico(root, aAlloy, { d: 1.8 }, [2.6, 0.65, 3.6]);
      K.ico(root, aGlow, { d: 0.75 }, [2.6, 1.05, 3.6], { emi: 1.6, unlit: true });
      K.box(root, aHull, [1.3, 0.45, 0.85], [3.9, 0.32, 4.3], { rot: [0.3, 0.5, 0.1] });
      K.cyl(root, aGlow, { h: 0.06, d: 0.5, t: 10 }, [3.8, 0.55, 4.1], { emi: 1.4, unlit: true });
      // GRAVATS épars + poutrelles tordues.
      for (let i = 0; i < 10; i++) { const a = i * 0.63; K.ico(root, i % 2 ? stone : stoneDk, { d: 0.5 + 0.3 * (i % 3) }, [Math.cos(a) * 6.6, 0.25, Math.sin(a) * 6.6]); }
      K.cyl(root, steel, { h: 2.2, d: 0.08, t: 5 }, [-1.2, 0.6, 4.2], { rot: [0.4, 0.3, 0.5] });
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
      // CHAMP DE BATAILLE — reste d'un affrontement TECHNOLOGIQUE/ALIEN (ADR : rifles/lasers/grenades).
      // Terre brûlée + cratères fumants ; ÉPAVE DE CHAR (pièce maîtresse) ; tranchée de sacs de sable +
      // pieux ; soldats tombés (casque/os/armure) ; fusils à énergie + grenades + douilles ; 2 étendards
      // déchirés ; fragment d'épave ALIENNE luisant ; butin = caisse de munitions + cellules d'énergie.
      const scorch = P.scorch, ash = [0.16, 0.15, 0.14], dark = P.dark, bone = P.bone,
        metal = P.metal, metalDk = P.metalDark, armor = P.armor, armorDk = P.armorDk, rust = P.rust,
        wood = P.woodDark, banner = P.banner, aHull = P.alienHull, aAlloy = P.alienAlloy, aGlow = P.alienGlow,
        sand = [0.46, 0.43, 0.34], sandDk = [0.4, 0.38, 0.3], blood = [0.28, 0.13, 0.12];

      // SOL : terre brûlée bombée + plaques scorchées + flaques sombres (sang séché).
      K.cyl(root, ash, { h: 0.06, dt: 10.6, db: 11.4, t: 24 }, [0, 0.03, 0]);
      for (const [x, z, d] of [[-1.5, 1, 4.2], [2.6, -2, 3.0], [-3, -2.5, 2.4], [1, 3, 2.2]] as const)
        K.cyl(root, scorch, { h: 0.02, d, t: 12 }, [x, 0.07, z], { unlit: true });
      for (const [x, z, d] of [[0.3, -0.6, 0.9], [-1.6, 0.4, 0.7]] as const) K.cyl(root, blood, { h: 0.015, d, t: 8 }, [x, 0.075, z], { unlit: true });

      // CRATÈRES : cuvette sombre + bourrelet de terre ; certains FUMENT (braises émissives).
      const crater = (x: number, z: number, d: number, ember: boolean): void => {
        K.cyl(root, dark, { h: 0.14, dt: d * 0.55, db: d, t: 14 }, [x, 0.05, z]);
        K.tor(root, [0.2, 0.17, 0.13], { d, thick: 0.22, t: 14 }, [x, 0.1, z], { rot: [Math.PI / 2, 0, 0] });
        if (ember) { K.ico(root, P.ember, { d: 0.34 }, [x, 0.1, z], { emi: 1.5, unlit: true }); K.ico(root, P.emberHot, { d: 0.18 }, [x + 0.12, 0.14, z - 0.05], { emi: 1.8, unlit: true }); }
      };
      crater(-2, 1.5, 2.2, true); crater(2.7, -1.4, 1.7, false); crater(0.5, -3, 1.5, true); crater(3.4, 2, 1.3, false);

      // ÉPAVE DE CHAR (engin de guerre détruit) — pièce maîtresse, inclinée, tourelle déboîtée.
      const tank = K.node(root, [2.3, 0, 1.9]); tank.rotation.set(0.08, -0.6, 0.05);
      K.box(tank, armor, [2.6, 0.9, 1.7], [0, 0.55, 0]); // caisse
      K.box(tank, armorDk, [2.85, 0.34, 1.85], [0, 0.95, 0]); // pont
      K.box(tank, armorDk, [1.4, 0.5, 1.5], [1.5, 0.5, 0], { rot: [0, 0, 0.2] }); // glacis avant
      for (const sz of [-1, 1]) { // chenilles + barbotins
        K.box(tank, metalDk, [2.9, 0.46, 0.42], [0, 0.26, sz * 0.78]);
        for (let i = 0; i < 5; i++) K.cyl(tank, metal, { h: 0.44, d: 0.4, t: 8 }, [-1.1 + i * 0.55, 0.26, sz * 0.78], { rot: [Math.PI / 2, 0, 0] });
      }
      const tur = K.node(tank, [-0.35, 1.18, 0.1]); tur.rotation.set(0.05, 0.45, -0.22);
      K.box(tur, armor, [1.15, 0.6, 1.15], [0, 0.3, 0]);
      K.cyl(tur, metalDk, { h: 2.3, d: 0.22, t: 8 }, [1.35, 0.32, 0], { rot: [0, 0, Math.PI / 2 - 0.32] }); // canon tombant
      K.box(tank, scorch, [0.85, 0.7, 0.55], [0.7, 0.6, 0.55], { unlit: true }); // brèche fondue
      K.ico(tank, P.ember, { d: 0.42 }, [0.7, 0.72, 0.55], { emi: 1.4, unlit: true }); // feu résiduel
      K.ico(tank, rust, { d: 0.7 }, [-1.6, 0.3, 0.95]); // débris arrachés
      K.box(tank, armorDk, [0.7, 0.06, 0.5], [-1.7, 0.18, -0.4], { rot: [0.1, 0.5, 0] }); // plaque éjectée

      // TRANCHÉE / BARRICADE : sacs de sable empilés (2 lignes) + pieux inclinés (chevaux de frise).
      const sandbags = (x: number, z: number, ry: number, n: number): void => {
        const b = K.node(root, [x, 0, z]); b.rotation.y = ry;
        for (let i = 0; i < n; i++) for (let r = 0; r < 2; r++)
          K.sph(b, (i + r) % 2 ? sand : sandDk, { d: 0.5, seg: 6 }, [-n * 0.22 + i * 0.44 + r * 0.22, 0.18 + r * 0.3, 0], { scale: [1.15, 0.7, 0.95] });
      };
      sandbags(-3.2, 2.4, 0.3, 5); sandbags(-4.1, -0.6, 1.45, 4);
      for (const [x, z, ry] of [[-2.4, 3.4, 0.3], [-1.5, 3.6, -0.4], [-3.3, 3.5, 0.1]] as const)
        K.cyl(root, wood, { h: 1.5, d: 0.1, t: 5 }, [x, 0.45, z], { rot: [0.5, ry, 0] });

      // SOLDATS TOMBÉS : casque + cage thoracique (os) + plaque d'armure (3 dépouilles + os épars).
      const corpse = (x: number, z: number, ry: number): void => {
        const c = K.node(root, [x, 0, z]); c.rotation.y = ry;
        K.sph(c, metalDk, { d: 0.34, seg: 6 }, [0, 0.12, 0], { scale: [1, 0.62, 1] }); // casque
        K.box(c, bone, [0.4, 0.06, 0.26], [0.12, 0.07, 0.36]); // torse
        for (let i = 0; i < 3; i++) K.cyl(c, bone, { h: 0.32, d: 0.05, t: 4 }, [0.12, 0.09, 0.24 + i * 0.09], { rot: [0, 0, Math.PI / 2] }); // côtes
        K.box(c, armorDk, [0.3, 0.05, 0.3], [-0.12, 0.05, 0.5], { rot: [0.1, 0.3, 0] }); // plastron
      };
      corpse(-0.9, 1.0, 0.6); corpse(0.5, 0.2, -0.8); corpse(-1.9, -1.2, 1.2);
      for (const [x, z, ry] of [[0.2, 1.5, 0.4], [-0.5, -0.7, 1.2], [1.4, 0.9, -0.5]] as const) K.cyl(root, bone, { h: 0.5, d: 0.05, t: 4 }, [x, 0.06, z], { rot: [0, ry, Math.PI / 2] });

      // FUSILS À ÉNERGIE tombés : canon + crosse + ÉMETTEUR luisant (cellule). + grenades + douilles.
      const rifle = (x: number, z: number, ry: number): void => {
        const r = K.node(root, [x, 0.08, z]); r.rotation.set(0, ry, Math.PI / 2 - 0.06);
        K.cyl(r, metalDk, { h: 0.95, d: 0.07, t: 5 }, [0, 0, 0]);
        K.box(r, armorDk, [0.1, 0.3, 0.13], [0, -0.5, 0]); // crosse
        K.cyl(r, aGlow, { h: 0.12, d: 0.1, t: 6 }, [0, 0.52, 0], { emi: 1.6, unlit: true }); // émetteur
      };
      rifle(-0.4, 0.0, 0.4); rifle(1.0, 1.3, -0.7); rifle(0.0, -1.6, 1.0); rifle(-1.4, 0.5, 0.2);
      for (const [x, z] of [[-0.2, -0.3], [0.7, 0.5], [-1.0, 1.3]] as const) { K.sph(root, metalDk, { d: 0.18, seg: 6 }, [x, 0.1, z]); K.cyl(root, metal, { h: 0.07, d: 0.05, t: 5 }, [x, 0.2, z]); }
      for (let i = 0; i < 7; i++) { const a = i * 0.9; K.cyl(root, [0.72, 0.6, 0.26], { h: 0.1, d: 0.04, t: 5 }, [Math.cos(a) * 1.3, 0.05, Math.sin(a) * 1.3 - 0.4], { rot: [Math.PI / 2, 0, a] }); } // douilles

      // 2 ÉTENDARDS DÉCHIRÉS (les 2 camps), inclinés.
      const standard = (x: number, z: number, col: number[], lean: number): void => {
        const s = K.node(root, [x, 0, z]); s.rotation.z = lean;
        K.cyl(s, wood, { h: 2.8, d: 0.08, t: 6 }, [0, 1.4, 0]);
        K.box(s, col, [0.6, 0.9, 0.03], [0.34, 2.05, 0]);
        K.box(s, col, [0.22, 0.4, 0.03], [0.5, 1.45, 0]); // pan déchiré qui pend
      };
      standard(-3.6, 1.2, banner, 0.18); standard(3.1, -2.6, [0.3, 0.34, 0.5], -0.22);

      // FRAGMENT D'ÉPAVE ALIENNE (la guerre était techno/alien) — coque + veine luisante.
      K.box(root, aHull, [1.5, 0.5, 0.95], [-2.9, 0.32, -1.9], { rot: [0.28, 0.5, 0.1] });
      K.cyl(root, aGlow, { h: 0.06, d: 0.55, t: 10 }, [-2.7, 0.58, -1.65], { emi: 1.4, unlit: true });
      K.box(root, aAlloy, [0.5, 0.1, 0.4], [-2.3, 0.2, -2.5], { rot: [0, 0.3, 0.05] });

      // BUTIN : caisse de munitions ÉVENTRÉE + cellules d'énergie luisantes + lingot d'alliage.
      K.box(root, metalDk, [0.95, 0.55, 0.62], [0.9, 0.28, 2.5], { rot: [0, 0.3, 0] });
      K.box(root, armorDk, [1.0, 0.12, 0.68], [0.98, 0.62, 2.6], { rot: [0, 0.3, 0.5] }); // couvercle ouvert
      for (let i = 0; i < 3; i++) K.box(root, aGlow, [0.16, 0.16, 0.32], [0.62 + i * 0.24, 0.5, 2.4], { emi: 1.6, unlit: true }); // cellules
      K.ico(root, aAlloy, { d: 0.4 }, [1.3, 0.3, 2.8]);
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
