// ============================================================================
//  FAUX OCÉAN (Chantier C — B) — un seul grand plan d'eau plat au niveau SEA_LEVEL,
//  couvrant tout le monde. Il est CACHÉ partout sauf là où une bordure « océan » fait
//  plonger le terrain sous SEA_LEVEL (cf. data/world.ts borderField) -> côte naturelle.
//  La zone jouable a un plancher au-dessus de l'eau -> aucune flaque parasite.
//  Purement visuel & local. Voir docs/refonte-monde-campement.md §B.
// ============================================================================

import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3 } from "@babylonjs/core";
import { P } from "./lowpoly";

/** Crée le plan d'eau du faux océan (statique). `extent` = demi-côté du plan (u). */
export function createOcean(scene: Scene, seaLevel: number, extent: number): Mesh {
  const m = MeshBuilder.CreateGround("ocean", { width: extent * 2, height: extent * 2, subdivisions: 1 }, scene);
  m.position.y = seaLevel;
  const c = P.water;
  const mat = new StandardMaterial("oceanMat", scene);
  mat.diffuseColor = new Color3(c[0], c[1], c[2]);
  mat.specularColor = new Color3(0.16, 0.22, 0.28); // léger reflet froid
  mat.specularPower = 64;
  mat.emissiveColor = new Color3(c[0] * 0.25, c[1] * 0.3, c[2] * 0.38); // visible au crépuscule
  m.material = mat;
  mat.freeze();
  m.isPickable = false;
  m.doNotSyncBoundingInfo = true;
  m.freezeWorldMatrix();
  return m;
}
