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
  "cave", "house", "town", "ironmine", "coalmine", "sulphurmine", "swamp", "ship", "executioner",
] as const;

// Teinte de la silhouette par type (bloc sombre lu de loin ; accordée à la matière du site).
const SIL_TINT: Record<string, number[]> = {
  cave: P.stoneDark, house: P.ruinStone, town: P.ruinStone,
  ironmine: P.stoneDark, coalmine: P.stoneDark, sulphurmine: P.stoneDark,
  swamp: P.mud, ship: P.alienHull, executioner: P.armorDk,
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
      const hull = K.node(root, [0, 1.0, 0]);
      hull.rotation.z = 0.34;
      hull.rotation.y = 0.5;
      K.sph(hull, P.alienHull, { d: 4.4, seg: 14 }, [0, 0, 0], { scale: [1, 0.3, 1] }); // corps lenticulaire
      K.tor(hull, P.alienAlloy, { d: 4.3, thick: 0.3, t: 24 }, [0, 0, 0]); // jante
      K.sph(hull, P.alienAlloy, { d: 1.9, seg: 10 }, [0.35, 0.42, -0.25], { scale: [1, 0.55, 1] }); // dôme
      K.tor(hull, P.alienHull, { d: 1.7, thick: 0.12, t: 16 }, [0.35, 0.3, -0.25]);
      K.tor(hull, P.alienAlloy, { d: 2.3, thick: 0.2, t: 18 }, [0, -0.32, 0]); // anneau ventral
      K.cyl(hull, P.alienGlow, { h: 0.12, d: 1.3, t: 16 }, [0, -0.42, 0]); // lueur
      K.box(hull, P.alienGlow, [0.08, 0.16, 1.7], [1.75, 0.06, 0.4]); // couture
      K.box(hull, P.scorch, [1.5, 0.45, 1.0], [-1.25, 0.06, 0.7]); // brèche
      for (let i = 0; i < 3; i++) K.box(hull, P.alienAlloy, [0.06, 0.42, 0.55], [-1.15 + i * 0.24, 0.04, 0.8]); // côtes
      K.sph(hull, P.alienAlloy, { d: 0.6, seg: 6 }, [-1.5, 0.05, -1.0], { scale: [1, 0.8, 1] });
      K.sph(hull, P.alienAlloy, { d: 0.45, seg: 6 }, [-1.85, -0.02, -0.5], { scale: [1, 0.8, 1] });
      K.cyl(hull, P.alienAlloy, { h: 0.5, d: 0.18, t: 6 }, [-1.7, 0.05, -1.4], { rot: [1.2, 0, 0.3] });
      K.cyl(root, [0.16, 0.15, 0.14], { h: 0.3, d: 4.8, t: 20 }, [0, 0.15, 0]); // cendre
      K.box(root, P.alienHull, [0.55, 0.08, 0.4], [2.7, 0.18, 0.5], { rot: [0.2, 0.5, 0.1] }); // débris
      K.box(root, P.alienHull, [0.42, 0.07, 0.32], [-2.5, 0.16, -1.3], { rot: [0.1, 1.0, 0.3] });
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
      for (let i = 0; i < 4; i++) K.box(hull, P.alienGlow, [0.12, 0.18, 0.5], [1.51, 0.7, -1.8 + i * 1.2]); // lueurs
      K.box(hull, P.dark, [1.1, 1.4, 1.6], [1.2, 0.5, 0.4]); // brèche
      K.box(hull, P.scorch, [1.4, 0.9, 0.1], [0, 0.9, 3.61]); // plaque fondue
      K.ico(hull, P.rust, { d: 0.9 }, [-1.5, 0.5, 1.2]);
      K.ico(hull, P.rust, { d: 0.7 }, [1.35, 1.0, -2.4]);
      K.cyl(root, [0.14, 0.13, 0.13], { h: 0.4, d: 8.5, t: 20 }, [0, 0.2, 0]); // terre soulevée
      break;
    }
    default:
      break;
  }
  return root;
}

interface PlacedSite {
  detailed: InstancedMesh;
  silhouette: InstancedMesh;
  entity: Entity;
}

/** Registre des sites : un mesh détaillé + une silhouette par type ; instances posées par carte. */
export class Sites {
  private readonly detailedBases = new Map<string, Mesh>();
  private readonly silBases = new Map<string, Mesh>();
  private readonly parent: TransformNode;
  private placed: PlacedSite[] = [];

  constructor(private readonly scene: Scene) {
    const mat = new StandardMaterial("siteMat", scene);
    mat.diffuseColor = Color3.White();
    mat.specularColor = new Color3(0, 0, 0);
    this.parent = new TransformNode("sites", scene);

    for (const t of SITE_TYPES) {
      const sink: Mesh[] = [];
      const K = makeVCKit(scene, sink);
      const root = buildSite(K, t);
      const base = Mesh.MergeMeshes(sink, true, true, undefined, false, false);
      root.dispose();
      if (!base) continue;
      base.name = "siteBase-" + t;
      base.material = mat;
      base.useVertexColors = true;
      base.convertToFlatShadedMesh();
      base.isVisible = false; // source d'instances
      this.detailedBases.set(t, base);
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
      const w = map.cellToWorldCenter(s.cx, s.cz);
      const y = terrainHeight(w.x, w.z);
      const ry = yawFor(s.cx, s.cz, map.seed);

      const detailed = dBase.createInstance("site-" + s.type);
      const silhouette = sBase.createInstance("sil-" + s.type);
      for (const inst of [detailed, silhouette]) {
        inst.position.set(w.x, y, w.z);
        inst.rotation.y = ry;
        inst.parent = this.parent;
        inst.setEnabled(false); // l'EntityManager allumera le bon palier
        inst.freezeWorldMatrix(); // statique (P4)
      }

      const entity: Entity = {
        x: w.x, z: w.z,
        fullDist: SITE_FULL,
        minimalDist: SITE_MINIMAL,
        band: "culled",
        onBand: (b) => {
          detailed.setEnabled(b === "full");
          silhouette.setEnabled(b === "minimal");
        },
      };
      entities.register(entity);
      this.placed.push({ detailed, silhouette, entity });
    }
  }

  /** Retire tous les sites posés (désenregistre les entités + dispose les instances). */
  clear(entities: EntityManager): void {
    for (const p of this.placed) {
      entities.unregister(p.entity);
      p.detailed.dispose();
      p.silhouette.dispose();
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
