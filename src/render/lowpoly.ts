// ============================================================================
//  KIT LOW-POLY PARTAGÉ — primitives flat-shaded + palette étendue.
//  Mirroir du kit du labo (lab/model-lab.html) : ce qui a été validé visuellement
//  au labo se construit ici à l'identique, et est réutilisé par stranger/villagers/
//  player/buildings. Purement visuel (couche « corps », cf. docs/architecture.md).
//  Voir docs/modeles-3d.md pour le catalogue et le guide.
// ============================================================================

import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  TransformNode,
  VertexData,
} from "@babylonjs/core";
import { PALETTE } from "./scene";

const c = (col: Color3): number[] => [col.r, col.g, col.b];

// Palette : canoniques (PALETTE du jeu) + teintes de modélisation validées au labo.
export const P: Record<string, number[]> = {
  trunk: c(PALETTE.trunk), foliage: c(PALETTE.foliage), fire: c(PALETTE.fire), player: c(PALETTE.player),
  skin: [0.78, 0.6, 0.46], skinDark: [0.58, 0.43, 0.32],
  cloak: [0.27, 0.34, 0.41], cloakDark: [0.19, 0.26, 0.32], cloakTrim: [0.4, 0.57, 0.52],
  wood: [0.3, 0.22, 0.15], woodLight: [0.45, 0.34, 0.22], woodDark: [0.2, 0.15, 0.12],
  roof: [0.24, 0.19, 0.16], roof2: [0.3, 0.25, 0.2],
  stone: [0.32, 0.35, 0.39], stoneDark: [0.21, 0.24, 0.27],
  metal: [0.52, 0.56, 0.6], metalDark: [0.28, 0.31, 0.35],
  leafPine: [0.15, 0.33, 0.27], leafOak: [0.23, 0.46, 0.34], leafBirch: [0.5, 0.62, 0.4],
  leafAutumn: [0.78, 0.45, 0.18], leafAutumn2: [0.66, 0.28, 0.14], leafCypress: [0.18, 0.36, 0.3],
  birch: [0.84, 0.85, 0.8], bush: [0.22, 0.4, 0.3], grass: [0.3, 0.46, 0.28],
  fur: [0.5, 0.42, 0.34], meat: [0.62, 0.3, 0.28], hide: [0.55, 0.45, 0.36],
  ember: [1.0, 0.4, 0.12], emberHot: [1.0, 0.72, 0.3], hatStraw: [0.6, 0.5, 0.28],
  tunicA: [0.5, 0.42, 0.34], tunicB: [0.36, 0.44, 0.5], tunicC: [0.56, 0.4, 0.3], tunicD: [0.38, 0.5, 0.42],
  // Nature / décor (M7, cf. lab) :
  bone: [0.82, 0.8, 0.72], reed: [0.52, 0.58, 0.38], reedHead: [0.42, 0.32, 0.22], mud: [0.16, 0.2, 0.2],
  dryBrush: [0.5, 0.42, 0.28], fern: [0.24, 0.42, 0.3],
  flowerWhite: [0.9, 0.9, 0.82], flowerYellow: [0.86, 0.74, 0.3], flowerViolet: [0.58, 0.5, 0.72], flowerPink: [0.82, 0.45, 0.5],
  // Sites / setpieces (M7→M9, réservés) :
  ruinStone: [0.3, 0.3, 0.32], rust: [0.46, 0.29, 0.18], coalRock: [0.12, 0.12, 0.14], coal: [0.12, 0.12, 0.14], sulphurRock: [0.72, 0.64, 0.22],
  water: [0.13, 0.19, 0.23], armor: [0.21, 0.23, 0.27], armorDk: [0.14, 0.15, 0.18], banner: [0.6, 0.22, 0.22], dark: [0.03, 0.03, 0.04],
  // Vaisseaux alien (épave/cuirassé — cf. lab « wanderer ») :
  alienHull: [0.27, 0.31, 0.36], alienAlloy: [0.42, 0.47, 0.52], alienGlow: [0.35, 0.85, 0.82], scorch: [0.1, 0.1, 0.11],
  // Ennemis aliens (M11/RF3b) : carapace sombre + lueur cyan (standard) ou magenta (boss/danger élevé).
  alienChitin: [0.16, 0.2, 0.19], alienBoss: [0.88, 0.32, 0.86], alienHot: [0.55, 1.0, 0.95],
};

export interface Opt {
  rot?: number[];
  scale?: number | number[];
  emi?: number;
  alpha?: number;
  unlit?: boolean;
  smooth?: boolean;
}

export interface Dim {
  h?: number;
  d?: number;
  dt?: number;
  db?: number;
  t?: number;
  seg?: number;
  thick?: number;
  sub?: number;
  w?: number; // toiture custom : largeur du faîtage (X)
  dp?: number; // toiture custom : profondeur des pans (Z)
  ridge?: number; // toiture en croupe : longueur du faîtage (< w)
}

// Toiture custom (VertexData) : 2 pans trapézoïdaux + 2 bouts. `kind:"gable"` -> faîtage sur
// toute la longueur (pignons triangulaires verticaux) ; `kind:"hip"` -> faîtage court (croupes
// inclinées). Éclairage two-sided pour rester visible quel que soit le sens des faces.
function prismRoofMesh(scene: Scene, kind: "gable" | "hip", col: number[], W: number, D: number, H: number, ridgeLen?: number): Mesh {
  const hw = W / 2, hd = D / 2;
  const rl = kind === "hip" ? Math.min(ridgeLen ?? W * 0.5, W * 0.92) / 2 : hw;
  const pos: number[] = [], idx: number[] = [];
  const tri = (a: number[], b: number[], cc: number[]) => {
    const i = pos.length / 3;
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], cc[0], cc[1], cc[2]);
    idx.push(i, i + 1, i + 2);
  };
  const quad = (a: number[], b: number[], cc: number[], dd: number[]) => { tri(a, b, cc); tri(a, cc, dd); };
  const A = [-hw, 0, -hd], B = [hw, 0, -hd], C = [hw, 0, hd], Dd = [-hw, 0, hd];
  const R0 = [-rl, H, 0], R1 = [rl, H, 0];
  quad(A, R0, R1, B); // pan -Z
  quad(C, R1, R0, Dd); // pan +Z
  tri(A, Dd, R0); // bout -X
  tri(B, R1, C); // bout +X
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, idx, normals);
  vd.normals = normals;
  const m = new Mesh("roof", scene);
  vd.applyToMesh(m);
  const mat = new StandardMaterial("roofMat", scene);
  mat.diffuseColor = new Color3(col[0], col[1], col[2]);
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;
  m.material = mat;
  m.convertToFlatShadedMesh();
  return m;
}

/** Crée un kit lié à une scène. Les matériaux sont mis en cache par couleur (perf). */
export function makeKit(scene: Scene) {
  let uid = 0;
  const cache = new Map<string, StandardMaterial>();

  const mat = (col: number[], opt?: Opt): StandardMaterial => {
    const key = `${col[0].toFixed(3)},${col[1].toFixed(3)},${col[2].toFixed(3)}|${opt?.emi ?? 0}|${opt?.alpha ?? 1}|${opt?.unlit ? 1 : 0}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const m = new StandardMaterial("lp" + uid++, scene);
    m.diffuseColor = new Color3(col[0], col[1], col[2]);
    m.specularColor = new Color3(0, 0, 0);
    if (opt?.emi) m.emissiveColor = new Color3(col[0] * opt.emi, col[1] * opt.emi, col[2] * opt.emi);
    if (opt?.alpha != null) m.alpha = opt.alpha;
    if (opt?.unlit) m.disableLighting = true;
    cache.set(key, m);
    return m;
  };

  const place = (m: Mesh, parent: TransformNode | null, pos?: number[], opt?: Opt): Mesh => {
    if (parent) m.parent = parent;
    if (pos) m.position.set(pos[0] || 0, pos[1] || 0, pos[2] || 0);
    if (opt?.rot) m.rotation.set(opt.rot[0] || 0, opt.rot[1] || 0, opt.rot[2] || 0);
    if (opt?.scale != null) {
      const s = opt.scale;
      if (Array.isArray(s)) m.scaling.set(s[0], s[1], s[2]);
      else m.scaling.setAll(s);
    }
    if (!opt?.smooth) m.convertToFlatShadedMesh();
    return m;
  };

  return {
    mat,
    box(parent: TransformNode | null, col: number[], dims: number[], pos?: number[], opt?: Opt): Mesh {
      const m = MeshBuilder.CreateBox("b", { width: dims[0], height: dims[1], depth: dims[2] }, scene);
      m.material = mat(col, opt);
      return place(m, parent, pos, opt);
    },
    cyl(parent: TransformNode | null, col: number[], d: Dim, pos?: number[], opt?: Opt): Mesh {
      const m = MeshBuilder.CreateCylinder("c", { height: d.h ?? 1, diameterTop: d.dt ?? d.d ?? 1, diameterBottom: d.db ?? d.d ?? 1, tessellation: d.t ?? 10 }, scene);
      m.material = mat(col, opt);
      return place(m, parent, pos, opt);
    },
    cone(parent: TransformNode | null, col: number[], d: Dim, pos?: number[], opt?: Opt): Mesh {
      const m = MeshBuilder.CreateCylinder("cn", { height: d.h ?? 1, diameterTop: 0, diameterBottom: d.d ?? 1, tessellation: d.t ?? 8 }, scene);
      m.material = mat(col, opt);
      return place(m, parent, pos, opt);
    },
    sph(parent: TransformNode | null, col: number[], d: Dim, pos?: number[], opt?: Opt): Mesh {
      const m = MeshBuilder.CreateSphere("s", { diameter: d.d ?? 1, segments: d.seg ?? 8 }, scene);
      m.material = mat(col, opt);
      return place(m, parent, pos, opt);
    },
    ico(parent: TransformNode | null, col: number[], d: Dim, pos?: number[], opt?: Opt): Mesh {
      const m = MeshBuilder.CreateIcoSphere("i", { radius: (d.d ?? 1) / 2, subdivisions: d.sub ?? 1 }, scene);
      m.material = mat(col, opt);
      return place(m, parent, pos, opt);
    },
    tor(parent: TransformNode | null, col: number[], d: Dim, pos?: number[], opt?: Opt): Mesh {
      const m = MeshBuilder.CreateTorus("t", { diameter: d.d ?? 1, thickness: d.thick ?? 0.1, tessellation: d.t ?? 14 }, scene);
      m.material = mat(col, opt);
      return place(m, parent, pos, opt);
    },
    // Toit à deux pentes (pignons triangulaires aux bouts). `d.w` = longueur du faîtage (X),
    // `d.dp` = profondeur des pans (Z), `d.h` = hauteur. Matériau two-sided géré en interne.
    gableRoof(parent: TransformNode | null, col: number[], d: Dim, pos?: number[], opt?: Opt): Mesh {
      const m = prismRoofMesh(scene, "gable", col, d.w ?? 1, d.dp ?? 1, d.h ?? 1);
      return place(m, parent, pos, { ...opt, smooth: true }); // déjà flat-shaded
    },
    // Toit en croupe (faîtage court `d.ridge`, croupes inclinées aux bouts).
    hipRoof(parent: TransformNode | null, col: number[], d: Dim, pos?: number[], opt?: Opt): Mesh {
      const m = prismRoofMesh(scene, "hip", col, d.w ?? 1, d.dp ?? 1, d.h ?? 1, d.ridge);
      return place(m, parent, pos, { ...opt, smooth: true });
    },
    node(parent: TransformNode | null, pos?: number[]): TransformNode {
      const n = new TransformNode("n", scene);
      if (parent) n.parent = parent;
      if (pos) n.position.set(pos[0] || 0, pos[1] || 0, pos[2] || 0);
      return n;
    },
  };
}

export type Kit = ReturnType<typeof makeKit>;
