// ============================================================================
//  CHEMINS DESSINÉS DU CAMP — rendu FIN & LISSE des sentiers tracés à la main
//  (campLayout.paths). Une DynamicTexture HAUTE RÉSOLUTION (terre damée + alpha)
//  est plaquée sur un plan drapé sur le terrain au-dessus de la clairière, et cuite
//  UNE FOIS depuis les polylignes (profil net + bord doux, cf. campGround.pathIntensity).
//  Indépendant du système de chemins ÉMERGENTS (render/trails.ts) : c'est la couche
//  « sentiers dessinés » que les trails renforcent. Purement cosmétique & LOCAL.
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
import { terrainHeight, campLayout } from "../../data/world";
import { pathIntensity, CAMP_PATH } from "./campGround";

const SIZE = 60; // côté couvert (unités-monde), centré sur le feu — englobe la clairière (R=25)
const TEX = 384; // résolution texture (~6.4 texels/u) -> tracé fin, lisse, sans crénelage
const MAX_ALPHA = 0.72; // opacité de la terre damée sur le sol (visible mais pas opaque)

export class CampPaths {
  private tex?: DynamicTexture;

  constructor(scene: Scene) {
    // Les chemins sont GÉNÉRÉS au runtime (campPathsFor) et s'étoffent avec les bâtiments : on crée
    // toujours le plan + la texture (vides au départ = invisibles), puis `rebake()` les redessine.
    // Plan drapé sur le terrain (suit le relief doux du camp) + léger offset anti-z-fight.
    const plane = MeshBuilder.CreateGround("camp-paths", { width: SIZE, height: SIZE, subdivisions: 48, updatable: true }, scene);
    const pos = plane.getVerticesData(VertexBuffer.PositionKind)!;
    for (let i = 0; i < pos.length; i += 3) pos[i + 1] = terrainHeight(pos[i], pos[i + 2]) + 0.05;
    plane.updateVerticesData(VertexBuffer.PositionKind, pos);
    plane.createNormals(true);
    plane.isPickable = false;

    const tex = new DynamicTexture("campPathsTex", { width: TEX, height: TEX }, scene, true);
    tex.hasAlpha = true;
    const mat = new StandardMaterial("campPathsMat", scene);
    mat.diffuseTexture = tex;
    mat.opacityTexture = tex;
    mat.diffuseColor = Color3.White(); // la couleur vient de la texture
    mat.specularColor = new Color3(0, 0, 0);
    mat.emissiveColor = new Color3(CAMP_PATH[0] * 0.3, CAMP_PATH[1] * 0.3, CAMP_PATH[2] * 0.3); // lisible au crépuscule
    mat.zOffset = -2; // rendu juste au-dessus du sol sans clignoter
    mat.backFaceCulling = false;
    plane.material = mat;
    plane.freezeWorldMatrix();

    this.tex = tex;
    this.bake();
  }

  /** Re-cuit la texture depuis l'état COURANT de campLayout.paths (à appeler quand le réseau
   *  change — un bâtiment de plus = un sentier de plus). Coût modéré, rare (à chaque construction). */
  rebake(): void {
    this.bake();
  }

  /** Cuit les polylignes (campLayout.paths) dans la texture. */
  private bake(): void {
    if (!this.tex) return;
    const img = new ImageData(TEX, TEX);
    const d = img.data;
    const r = CAMP_PATH[0] * 255, g = CAMP_PATH[1] * 255, b = CAMP_PATH[2] * 255;
    const paths = campLayout.paths;
    for (let gz = 0; gz < TEX; gz++) {
      const z = ((gz + 0.5) / TEX) * SIZE - SIZE / 2;
      for (let gx = 0; gx < TEX; gx++) {
        const x = ((gx + 0.5) / TEX) * SIZE - SIZE / 2;
        const v = pathIntensity(x, z, paths);
        const j = (gz * TEX + gx) * 4;
        d[j] = r; d[j + 1] = g; d[j + 2] = b;
        d[j + 3] = v > 0 ? Math.min(255, v * MAX_ALPHA * 255) : 0;
      }
    }
    this.tex.getContext().putImageData(img, 0, 0);
    this.tex.update();
  }
}
