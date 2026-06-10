// ============================================================================
//  DÉCOR (M7, Phase 4) — registre PARTAGÉ d'éléments de décor low-poly instançables
//  (rochers, herbes, fougère, champignons, fleurs, arbuste sec, ossements, rondin,
//  roseaux). Même principe que render/trees.ts : pièces peintes en vertex colors,
//  fusionnées en UN mesh de base flat-shaded par type (un matériau partagé) -> peu de
//  draw calls. Géométrie portée du labo (lab/model-lab.html, catégorie « Nature »).
//  Dispersé par render/terrain.ts via sim/worldgen.scatterCell. Purement cosmétique.
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

export interface VOpt {
  rot?: number[];
  scale?: number | number[];
  // Acceptés pour copier verbatim la géométrie du labo, mais IGNORÉS ici : le mesh est fusionné
  // en un seul matériau (couleur portée par les vertex colors) -> pas d'unlit/émissif par pièce.
  unlit?: boolean;
  emi?: number;
}
interface Dim {
  h?: number;
  d?: number;
  dt?: number;
  db?: number;
  t?: number;
  seg?: number;
  thick?: number;
}

/** Kit « vertex colors » : MÊME signature que le kit du labo, mais peint les faces et
 *  collecte les meshes pour fusion (au lieu d'un matériau par pièce). Partagé avec sites.ts. */
export function makeVCKit(scene: Scene, sink: Mesh[]) {
  const place = (m: Mesh, parent: TransformNode | null, pos?: number[], opt?: VOpt): Mesh => {
    if (parent) m.parent = parent;
    if (pos) m.position.set(pos[0] || 0, pos[1] || 0, pos[2] || 0);
    if (opt?.rot) m.rotation.set(opt.rot[0] || 0, opt.rot[1] || 0, opt.rot[2] || 0);
    if (opt?.scale != null) {
      const s = opt.scale;
      if (Array.isArray(s)) m.scaling.set(s[0], s[1], s[2]);
      else m.scaling.setAll(s);
    }
    sink.push(m);
    return m;
  };
  const ret = (m: Mesh, col: number[], parent: TransformNode | null, pos?: number[], opt?: VOpt): Mesh => {
    paint(m, col);
    return place(m, parent, pos, opt);
  };
  return {
    node(parent: TransformNode | null, pos?: number[]): TransformNode {
      const n = new TransformNode("n", scene);
      if (parent) n.parent = parent;
      if (pos) n.position.set(pos[0] || 0, pos[1] || 0, pos[2] || 0);
      return n;
    },
    box: (parent: TransformNode | null, col: number[], dims: number[], pos?: number[], opt?: VOpt): Mesh =>
      ret(MeshBuilder.CreateBox("b", { width: dims[0], height: dims[1], depth: dims[2] }, scene), col, parent, pos, opt),
    cyl: (parent: TransformNode | null, col: number[], d: Dim, pos?: number[], opt?: VOpt): Mesh =>
      ret(MeshBuilder.CreateCylinder("c", { height: d.h ?? 1, diameterTop: d.dt ?? d.d ?? 1, diameterBottom: d.db ?? d.d ?? 1, tessellation: d.t ?? 10 }, scene), col, parent, pos, opt),
    cone: (parent: TransformNode | null, col: number[], d: Dim, pos?: number[], opt?: VOpt): Mesh =>
      ret(MeshBuilder.CreateCylinder("cn", { height: d.h ?? 1, diameterTop: 0, diameterBottom: d.d ?? 1, tessellation: d.t ?? 8 }, scene), col, parent, pos, opt),
    sph: (parent: TransformNode | null, col: number[], d: Dim, pos?: number[], opt?: VOpt): Mesh =>
      ret(MeshBuilder.CreateSphere("s", { diameter: d.d ?? 1, segments: d.seg ?? 8 }, scene), col, parent, pos, opt),
    ico: (parent: TransformNode | null, col: number[], d: Dim, pos?: number[], opt?: VOpt): Mesh =>
      ret(MeshBuilder.CreateIcoSphere("i", { radius: (d.d ?? 1) / 2, subdivisions: 1 }, scene), col, parent, pos, opt),
    tor: (parent: TransformNode | null, col: number[], d: Dim, pos?: number[], opt?: VOpt): Mesh =>
      ret(MeshBuilder.CreateTorus("t", { diameter: d.d ?? 1, thickness: d.thick ?? 0.1, tessellation: d.t ?? 14 }, scene), col, parent, pos, opt),
  };
}
export type VCKit = ReturnType<typeof makeVCKit>;

export const DECOR_TYPES = [
  "rock", "grass", "fern", "mushroom", "flower", "drybush", "bones", "log", "reed",
] as const;
export type DecorType = (typeof DECOR_TYPES)[number];

/** Construit un modèle de décor (géométrie portée du labo, catégorie Nature). */
function buildDecor(K: VCKit, type: string): TransformNode {
  const root = K.node(null);
  switch (type) {
    case "rock": // amas de blocs
      K.ico(root, P.stone, { d: 1.6 }, [0, 0.55, 0], { scale: [1, 0.85, 1.1], rot: [0.1, 0.6, 0] });
      K.ico(root, P.stoneDark, { d: 1.0 }, [0.9, 0.35, 0.3], { scale: [1.2, 0.8, 1], rot: [0, 1, 0.1] });
      K.ico(root, P.stone, { d: 0.8 }, [-0.7, 0.3, -0.4], { rot: [0.2, 2, 0] });
      K.ico(root, P.stoneDark, { d: 0.5 }, [-0.2, 0.2, 0.9]);
      K.ico(root, P.stone, { d: 0.4 }, [0.4, 0.18, -0.8]);
      break;
    case "grass": { // touffes
      const tuft = (x: number, z: number, n: number): void => {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          K.cone(root, i % 2 ? P.grass : P.bush, { h: 0.4 + (0.2 * ((i * 7) % 3)) / 3, d: 0.1, t: 4 },
            [x + Math.cos(a) * 0.12, 0.2, z + Math.sin(a) * 0.12], { rot: [Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3] });
        }
      };
      tuft(0, 0, 6); tuft(0.6, 0.4, 5); tuft(-0.5, 0.3, 4); tuft(0.2, -0.6, 5); tuft(-0.6, -0.4, 4);
      break;
    }
    case "fern": { // touffe de frondes
      const n = 9;
      for (let i = 0; i < n; i++) {
        const fr = K.node(root, [0, 0.05, 0]);
        fr.rotation.y = (i / n) * Math.PI * 2 + (i % 2) * 0.18;
        const tilt = 0.98 + (i % 3) * 0.12;
        const len = 0.78 - (i % 3) * 0.1;
        K.cone(fr, i % 2 ? P.fern : P.bush, { h: len, d: 0.3, t: 5 }, [0, len * 0.32, 0.22], { rot: [tilt, 0, 0], scale: [1, 1, 0.2] });
      }
      for (let i = 0; i < 3; i++) {
        const fr = K.node(root, [0, 0.05, 0]);
        fr.rotation.y = i * 2.1;
        K.cone(fr, P.fern, { h: 0.6, d: 0.22, t: 5 }, [0, 0.32, 0.08], { rot: [0.42, 0, 0], scale: [1, 1, 0.2] });
      }
      K.sph(root, P.fern, { d: 0.14, seg: 6 }, [0, 0.09, 0]);
      break;
    }
    case "mushroom": { // petit cluster
      const m = (x: number, z: number, s: number): void => {
        K.cyl(root, [0.8, 0.78, 0.72], { h: 0.22 * s, dt: 0.06 * s, db: 0.09 * s }, [x, 0.11 * s, z]);
        K.sph(root, P.meat, { d: 0.22 * s, seg: 6 }, [x, 0.24 * s, z], { scale: [1, 0.6, 1] });
      };
      m(0, 0, 1.2); m(0.25, 0.15, 0.9); m(-0.2, 0.18, 0.8); m(0.1, -0.22, 1.0);
      break;
    }
    case "flower": { // parterre de fleurs
      const cols = [P.flowerWhite, P.flowerYellow, P.flowerViolet, P.flowerPink];
      const spots = [[0, 0], [0.2, 0.12], [-0.16, 0.14], [0.1, -0.18], [-0.13, -0.12], [0.22, -0.06], [-0.24, 0.02], [0.04, 0.24]];
      spots.forEach(([x, z], i) => {
        const h = 0.28 + (i % 3) * 0.08;
        const col = cols[i % cols.length];
        K.cyl(root, P.grass, { h, d: 0.02 }, [x, h / 2, z]);
        K.cyl(root, col, { h: 0.025, d: 0.16, t: 6 }, [x, h, z]);
        K.sph(root, P.flowerYellow, { d: 0.06, seg: 5 }, [x, h + 0.01, z]);
      });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        K.cone(root, P.grass, { h: 0.2, d: 0.05, t: 4 }, [Math.cos(a) * 0.12, 0.1, Math.sin(a) * 0.12], { rot: [Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35] });
      }
      break;
    }
    case "drybush": { // broussaille morte
      K.cyl(root, P.woodDark, { h: 0.18, d: 0.12 }, [0, 0.09, 0]);
      const n = 11;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (i % 2) * 0.5;
        const len = 0.45 + (i % 3) * 0.18;
        const tilt = 0.55 + (i % 4) * 0.12;
        K.cyl(root, P.dryBrush, { h: len, dt: 0.008, db: 0.035 },
          [Math.sin(a) * 0.08, 0.18 + Math.cos(tilt) * len * 0.5, Math.cos(a) * 0.08],
          { rot: [Math.cos(a) * tilt, 0, -Math.sin(a) * tilt] });
      }
      break;
    }
    case "bones": { // crâne + côtes + os épars
      const skull = K.node(root, [-0.1, 0.13, 0.05]);
      skull.rotation.set(0.25, 0.5, 0);
      K.ico(skull, P.bone, { d: 0.32 }, [0, 0.04, 0]);
      K.box(skull, P.bone, [0.15, 0.13, 0.26], [0, -0.03, 0.2]);
      K.box(skull, P.mud, [0.05, 0.05, 0.05], [0.05, 0.02, 0.18]);
      K.box(skull, P.mud, [0.05, 0.05, 0.05], [-0.05, 0.02, 0.18]);
      K.cyl(skull, P.bone, { h: 0.34, dt: 0.02, db: 0.06, t: 5 }, [0.13, 0.16, -0.04], { rot: [0, 0, -0.7] });
      K.cyl(skull, P.bone, { h: 0.34, dt: 0.02, db: 0.06, t: 5 }, [-0.13, 0.16, -0.04], { rot: [0, 0, 0.7] });
      K.cyl(root, P.bone, { h: 0.72, d: 0.03 }, [0.5, 0.03, 0], { rot: [Math.PI / 2, 0, 0] });
      for (let i = 0; i < 4; i++) K.tor(root, P.bone, { d: 0.34, thick: 0.025, t: 8 }, [0.5, 0.0, -0.25 + i * 0.16], { rot: [Math.PI / 2, 0, 0] });
      K.cyl(root, P.bone, { h: 0.4, d: 0.045 }, [-0.5, 0.04, -0.3], { rot: [0, 0.5, Math.PI / 2] });
      K.sph(root, P.bone, { d: 0.08, seg: 5 }, [-0.69, 0.04, -0.41]);
      K.sph(root, P.bone, { d: 0.08, seg: 5 }, [-0.31, 0.04, -0.19]);
      break;
    }
    case "log": // tronc abattu + mousse
      K.cyl(root, P.trunk, { h: 2.4, d: 0.5, t: 8 }, [0, 0.28, 0], { rot: [0, 0, Math.PI / 2] });
      K.cyl(root, P.woodLight, { h: 0.06, d: 0.5, t: 8 }, [1.2, 0.28, 0], { rot: [0, 0, Math.PI / 2] });
      K.cyl(root, P.woodLight, { h: 0.06, d: 0.5, t: 8 }, [-1.2, 0.28, 0], { rot: [0, 0, Math.PI / 2] });
      K.ico(root, P.bush, { d: 0.5 }, [0.4, 0.45, 0.2]);
      break;
    case "reed": { // roseaux + vase
      K.cyl(root, P.mud, { h: 0.05, d: 1.05, t: 14 }, [0, 0.025, 0]);
      const spots = [[0, 0], [0.22, 0.1], [-0.2, 0.08], [0.12, -0.22], [-0.1, -0.16], [0.27, -0.05], [-0.27, 0.0], [0.05, 0.24], [-0.05, -0.26]];
      spots.forEach(([x, z], i) => {
        const h = 0.9 + (i % 4) * 0.22;
        const lean = ((i % 3) - 1) * 0.1;
        K.cyl(root, P.reed, { h, dt: 0.012, db: 0.03 }, [x, h / 2 + 0.04, z], { rot: [lean, 0, lean] });
        const tx = x + lean * h * 0.5, tz = z + lean * h * 0.5, ty = h + 0.04;
        if (i % 3 === 0) {
          K.cyl(root, P.reedHead, { h: 0.22, dt: 0.07, db: 0.07, t: 7 }, [tx, ty - 0.06, tz]);
          K.cyl(root, P.reed, { h: 0.12, d: 0.015 }, [tx, ty + 0.08, tz]);
        } else {
          K.cone(root, P.reed, { h: 0.34, d: 0.07, t: 4 }, [tx, ty, tz], { scale: [1, 1, 0.3] });
        }
      });
      break;
    }
    default:
      break;
  }
  return root;
}

/** Registre de décor : construit chaque base une fois, instancie à la demande. */
export class Decor {
  private readonly bases = new Map<string, Mesh>();

  constructor(scene: Scene) {
    const mat = new StandardMaterial("decorMat", scene);
    mat.diffuseColor = Color3.White();
    mat.specularColor = new Color3(0, 0, 0);
    for (const t of DECOR_TYPES) {
      const sink: Mesh[] = [];
      const K = makeVCKit(scene, sink);
      const root = buildDecor(K, t);
      const base = Mesh.MergeMeshes(sink, true, true, undefined, false, false);
      root.dispose(); // dispose les TransformNodes restants (meshes déjà fusionnés)
      if (!base) continue;
      base.name = "decorBase-" + t;
      base.material = mat;
      base.useVertexColors = true;
      base.convertToFlatShadedMesh();
      base.isVisible = false;
      this.bases.set(t, base);
    }
  }

  has(type: string): boolean {
    return this.bases.has(type);
  }

  /** Instancie un décor ; renvoie null si le type est inconnu (l'appelant ignore). */
  createInstance(type: string, x: number, y: number, z: number, rotY = 0, scale = 1): InstancedMesh | null {
    const base = this.bases.get(type);
    if (!base) return null;
    const inst = base.createInstance("d");
    inst.position.set(x, y, z);
    inst.rotation.y = rotY;
    inst.scaling.setAll(scale);
    return inst;
  }
}
