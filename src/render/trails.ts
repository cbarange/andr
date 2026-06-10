// ============================================================================
//  CHEMINS ÉMERGENTS — les villageois usent le sol là où ils passent souvent. Une
//  grille d'ACCUMULATION (les pas la noircissent, elle DÉCROÎT lentement) est rendue
//  dans une DynamicTexture, plaquée sur un plan DRAPÉ sur le terrain au-dessus de la
//  clairière. Purement cosmétique & LOCAL (comme les villageois) — aucun état de jeu,
//  zéro réseau. Une « texture très légère » qui renforce les sentiers dessinés du sol.
//  Voir docs/plan-campement.md.
// ============================================================================

import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Color3,
  VertexBuffer,
} from "@babylonjs/core";
import { terrainHeight } from "../../data/world";

const SIZE = 58; // côté couvert (unités-monde), centré sur le feu — englobe la clairière
const GRID = 116; // résolution de la grille/texture (~0.5 u/texel)
const DECAY = 0.997; // décroissance par tick d'upload (~10 Hz) -> fonte lente (~min)
const ADD = 0.014; // dépôt d'un pas au centre du tampon (faible -> les chemins se creusent peu à peu)
const STAMP_R = 2; // rayon du tampon (texels) -> trace ~2 u de large
const MAX_ALPHA = 0.55; // opacité max d'une trace bien tassée (légère, pas opaque)
const TRAIL = [0.17, 0.135, 0.1]; // terre damée (même teinte que les sentiers dessinés)
const UPLOAD_DT = 0.1; // période d'upload de la texture (s)

export class Trails {
  private readonly grid = new Float32Array(GRID * GRID);
  private readonly tex: DynamicTexture;
  private readonly img: ImageData;
  private acc = 0;
  private dirty = false;

  constructor(scene: Scene) {
    // Plan drapé sur le terrain (suit le relief doux du camp) + léger offset anti-z-fight.
    const mesh = MeshBuilder.CreateGround("camp-trails", { width: SIZE, height: SIZE, subdivisions: 40, updatable: true }, scene);
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    for (let i = 0; i < pos.length; i += 3) pos[i + 1] = terrainHeight(pos[i], pos[i + 2]) + 0.04;
    mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
    mesh.createNormals(true);
    mesh.isPickable = false;

    const tex = new DynamicTexture("trailsTex", { width: GRID, height: GRID }, scene, false);
    tex.hasAlpha = true;
    const mat = new StandardMaterial("trailsMat", scene);
    mat.diffuseTexture = tex;
    mat.opacityTexture = tex;
    mat.diffuseColor = Color3.White(); // la couleur vient de la texture
    mat.specularColor = new Color3(0, 0, 0);
    mat.emissiveColor = new Color3(TRAIL[0] * 0.25, TRAIL[1] * 0.25, TRAIL[2] * 0.25); // lisible au crépuscule
    mat.zOffset = -2; // rendu juste au-dessus du sol sans clignoter
    mat.backFaceCulling = false;
    mesh.material = mat;

    this.tex = tex;
    this.img = new ImageData(GRID, GRID); // RGBA, initialisé transparent (zéros)
  }

  /** Dépose un pas de villageois à la position monde (x,z). Accumulation plafonnée à 1. */
  stamp(x: number, z: number): void {
    const gx = Math.round(((x + SIZE / 2) / SIZE) * GRID);
    const gz = Math.round(((z + SIZE / 2) / SIZE) * GRID);
    if (gx < 0 || gx >= GRID || gz < 0 || gz >= GRID) return; // hors de la zone du camp
    for (let dz = -STAMP_R; dz <= STAMP_R; dz++) {
      const zz = gz + dz;
      if (zz < 0 || zz >= GRID) continue;
      for (let dx = -STAMP_R; dx <= STAMP_R; dx++) {
        const xx = gx + dx;
        if (xx < 0 || xx >= GRID) continue;
        const fall = 1 - Math.hypot(dx, dz) / (STAMP_R + 1); // tampon adouci
        if (fall <= 0) continue;
        const i = zz * GRID + xx;
        this.grid[i] = Math.min(1, this.grid[i] + ADD * fall);
      }
    }
    this.dirty = true;
  }

  /** Décroissance + upload de la texture (amorti à ~10 Hz). À appeler chaque frame. */
  update(dtSec: number): void {
    this.acc += dtSec;
    if (this.acc < UPLOAD_DT) return;
    this.acc = 0;
    const d = this.img.data;
    const r = TRAIL[0] * 255, g = TRAIL[1] * 255, b = TRAIL[2] * 255;
    let any = false;
    for (let i = 0; i < this.grid.length; i++) {
      let v = this.grid[i];
      if (v > 0.0015) { v *= DECAY; this.grid[i] = v; any = true; } else if (v !== 0) { this.grid[i] = 0; }
      const j = i * 4;
      d[j] = r; d[j + 1] = g; d[j + 2] = b;
      d[j + 3] = Math.min(255, v * MAX_ALPHA * 255);
    }
    if (!any && !this.dirty) return; // rien à montrer -> on évite l'upload
    this.dirty = false;
    const ctx = this.tex.getContext();
    ctx.putImageData(this.img, 0, 0);
    this.tex.update();
  }
}
