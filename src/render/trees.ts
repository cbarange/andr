// ============================================================================
//  ARBRES (M7) — registre PARTAGÉ d'essences low-poly instançables. Chaque essence
//  = pièces peintes en vertex colors, fusionnées en UN mesh de base flat-shaded
//  (un seul matériau blanc partagé) -> `createInstance` = peu de draw calls.
//  Utilisé par DEUX consommateurs : la forêt du CAMP (render/forest.ts) et le décor
//  SAUVAGE dispersé dans les chunks (render/terrain.ts via sim/worldgen.scatterCell).
//  Géométrie portée du labo (lab/model-lab.html : treeBuild) — cf. docs/modeles-3d.md §2.4.
// ============================================================================

import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  VertexBuffer,
  type InstancedMesh,
} from "@babylonjs/core";
import { P } from "./lowpoly";
import { config } from "../../data/world";

const MAX_CHOPS = config.gather.chopsPerTree;

/** Nombre de coups (= « taille ») INITIAL d'un arbre, tiré DÉTERMINISTEMENT dans [1, max] à
 *  partir d'une graine (index de slot pour le camp, hash de position pour le monde). Les arbres
 *  apparaissent ainsi à des tailles VARIÉES — parfois 1 seul coup avant de tomber — sans toucher
 *  au RNG du scatter. Déterministe -> stable au rechargement et identique entre pairs. */
export function initialChops(seed: number): number {
  const h = Math.sin(seed * 91.17 + 47.13) * 43758.5453;
  return 1 + Math.floor((h - Math.floor(h)) * MAX_CHOPS);
}

/** Échelle d'un arbre selon ses coups restants — MÊME courbe à l'apparition et à la coupe :
 *  `max` coups = pleine taille ; moins de coups = plus petit (l'arbre rétrécit en se faisant couper). */
export function chopScale(chopsLeft: number): number {
  return 0.55 + 0.45 * (chopsLeft / MAX_CHOPS);
}

/** Peint toutes les faces d'un mesh d'une couleur unie (vertex colors). */
function paint(mesh: Mesh, col: number[]): void {
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

// Toutes les essences (récoltables + décor). Les 6 premières sont aussi celles du camp.
export const TREE_TYPES = [
  "pine", "oak", "birch", "autumn", "cypress", "petit", "dead", "bush", "stump",
] as const;
export type TreeType = (typeof TREE_TYPES)[number];

/** Construit le mesh de base d'une essence (géométrie canonique, cf. lab treeBuild). */
function makeBase(scene: Scene, type: string, mat: StandardMaterial): Mesh {
  const parts: Mesh[] = [];
  const cyl = (col: number[], h: number, dt: number, db: number, t: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void => {
    const m = MeshBuilder.CreateCylinder("p", { height: h, diameterTop: dt, diameterBottom: db, tessellation: t }, scene);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    paint(m, col);
    parts.push(m);
  };
  const cone = (col: number[], h: number, d: number, t: number, x: number, y: number, z: number): void => cyl(col, h, 0, d, t, x, y, z);
  const ico = (col: number[], d: number, x: number, y: number, z: number): void => {
    const m = MeshBuilder.CreateIcoSphere("p", { radius: d / 2, subdivisions: 1 }, scene);
    m.position.set(x, y, z);
    paint(m, col);
    parts.push(m);
  };
  const box = (col: number[], w: number, hh: number, d: number, x: number, y: number, z: number, ry = 0): void => {
    const m = MeshBuilder.CreateBox("p", { width: w, height: hh, depth: d }, scene);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    paint(m, col);
    parts.push(m);
  };

  switch (type) {
    case "pine": // sapin / conifère : étages de cônes
      cyl(P.wood, 1.3, 0.22, 0.4, 6, 0, 0.65, 0);
      cone(P.leafPine, 1.5, 2.0, 8, 0, 1.5, 0);
      cone(P.leafPine, 1.3, 1.5, 8, 0, 2.35, 0);
      cone(P.leafPine, 1.1, 1.0, 8, 0, 3.1, 0);
      break;
    case "oak": // feuillu rond : houppier en grappe d'icosphères
      cyl(P.trunk, 1.9, 0.38, 0.62, 7, 0, 0.95, 0);
      ico(P.leafOak, 2.3, 0, 2.7, 0);
      ico(P.leafOak, 1.7, -0.85, 2.5, 0.4);
      ico(P.leafOak, 1.7, 0.8, 2.6, -0.4);
      ico(P.leafOak, 1.5, 0.1, 3.5, 0.2);
      break;
    case "birch": // bouleau : tronc clair élancé + marques d'écorce
      cyl(P.birch, 3.0, 0.16, 0.24, 7, 0, 1.5, 0);
      for (let i = 0; i < 4; i++) box(P.woodDark, 0.26, 0.05, 0.05, 0, 0.8 + i * 0.55, 0.12, i * 1.3);
      ico(P.leafBirch, 1.7, 0, 3.3, 0);
      ico(P.leafBirch, 1.3, 0.5, 3.6, 0.3);
      ico(P.leafBirch, 1.2, -0.5, 3.5, -0.3);
      break;
    case "autumn": // feuillage chaud bicolore
      cyl(P.trunk, 1.8, 0.34, 0.56, 7, 0, 0.9, 0);
      ico(P.leafAutumn, 2.2, 0, 2.6, 0);
      ico(P.leafAutumn2, 1.6, -0.8, 2.4, 0.3);
      ico(P.leafAutumn, 1.5, 0.8, 2.7, -0.3);
      ico(P.leafAutumn2, 1.3, 0.1, 3.4, 0.1);
      break;
    case "cypress": // cyprès / peuplier : cône étroit et haut
      cyl(P.wood, 0.9, 0.3, 0.42, 7, 0, 0.45, 0);
      cone(P.leafCypress, 4.2, 1.4, 8, 0, 2.9, 0);
      cone(P.leafCypress, 1.6, 1.0, 8, 0, 1.9, 0);
      break;
    case "dead": // arbre mort : tronc nu + branches inclinées
      cyl(P.woodDark, 2.6, 0.14, 0.46, 7, 0, 1.3, 0);
      cyl(P.woodDark, 1.2, 0.06, 0.14, 6, 0.35, 2.2, 0.1, 0, 0, -0.9);
      cyl(P.woodDark, 1.0, 0.05, 0.12, 6, -0.3, 2.5, -0.1, 0.2, 0, 0.8);
      cyl(P.woodDark, 0.7, 0.04, 0.09, 6, 0.1, 2.9, 0.2, -0.7, 0, 0.2);
      break;
    case "bush": // buisson bas
      cyl(P.woodDark, 0.3, 0.1, 0.14, 6, 0, 0.15, 0);
      ico(P.bush, 0.95, 0, 0.55, 0);
      ico(P.bush, 0.8, 0.4, 0.5, 0.2);
      ico(P.bush, 0.75, -0.4, 0.5, -0.15);
      break;
    case "stump": // souche + cernes + racine
      cyl(P.trunk, 0.5, 0.6, 0.72, 9, 0, 0.25, 0);
      cyl(P.woodLight, 0.08, 0.58, 0.58, 9, 0, 0.51, 0);
      cyl([0.34, 0.26, 0.18], 0.05, 0.3, 0.3, 8, 0, 0.55, 0);
      cyl(P.trunk, 0.3, 0.12, 0.18, 6, 0.55, 0.1, 0.2, 0, 0, 1.4);
      break;
    default: // "petit" : l'arbre d'origine du jeu, conservé en plus petit sujet
      cyl(P.trunk, 1.0, 0.2, 0.32, 6, 0, 0.5, 0);
      cone(P.foliage, 1.6, 1.2, 7, 0, 1.8, 0);
      break;
  }

  const base = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  if (!base) throw new Error("Échec de fusion de l'arbre : " + type);
  base.name = "treeBase-" + type;
  base.material = mat;
  base.useVertexColors = true;
  base.convertToFlatShadedMesh();
  base.isVisible = false; // seules les instances sont rendues
  return base;
}

/** Registre d'essences : construit chaque base une fois, instancie à la demande. */
export class Trees {
  private readonly bases = new Map<string, Mesh>();

  constructor(scene: Scene) {
    const mat = new StandardMaterial("treesMat", scene);
    mat.diffuseColor = Color3.White(); // couleur portée par les vertex colors
    mat.specularColor = new Color3(0, 0, 0);
    for (const t of TREE_TYPES) this.bases.set(t, makeBase(scene, t, mat));
  }

  has(type: string): boolean {
    return this.bases.has(type);
  }

  /** Instancie une essence (cosmétique). `petit` sert de repli si l'essence est inconnue. */
  createInstance(type: string, x: number, y: number, z: number, rotY = 0, scale = 1): InstancedMesh {
    const base = this.bases.get(type) ?? this.bases.get("petit")!;
    const inst = base.createInstance("tree");
    inst.position.set(x, y, z);
    inst.rotation.y = rotY;
    inst.scaling.setAll(scale);
    return inst;
  }
}
