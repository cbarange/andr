// ============================================================================
//  MONTÉE « ASSEMBLAGE PAR ÉLÉMENTS » — utilitaire PARTAGÉ (bâtiments + cabane).
//  Un assemblage low-poly (arbre de meshes sous un `root`) n'apparaît pas d'un bloc :
//  ses pièces SORTENT DE TERRE du bas vers le haut au fil d'un avancement 0->1, chacune
//  avec un petit « pop » d'échelle. Purement visuel. Voir render/buildings.ts (chantiers)
//  et render/cabin.ts (réparation/amélioration).
// ============================================================================

import type { AbstractMesh, TransformNode, Vector3 } from "@babylonjs/core";

// Part de la progression sur laquelle UNE pièce passe de 0 à sa taille pleine.
const REVEAL_WINDOW = 0.32;

/** Une pièce de l'assemblage : son mesh, le seuil de progression où elle commence à pousser
 *  (normalisé par la hauteur), et sa taille FINALE (préservée car certaines pièces ont une
 *  échelle non uniforme baked). */
export interface RevealEl {
  mesh: AbstractMesh;
  threshold: number;
  base: Vector3;
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
// « overshoot » léger en fin de pop -> la pièce se cale en place (easeOutBack adouci).
export const easePop = (t: number): number => {
  const c = 1.7;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

/** Prépare la montée d'un assemblage : trie ses meshes par HAUTEUR (centre, en repère monde)
 *  -> seuil de révélation du bas vers le haut. Ignore les pièces initialement masquées
 *  (ex. variantes/états cachés). Renvoie la liste à passer à `applyReveal`. */
export function prepareReveal(root: TransformNode): RevealEl[] {
  root.computeWorldMatrix(true);
  const rootY = root.getAbsolutePosition().y;
  const els: RevealEl[] = [];
  let maxH = 0.001;
  for (const m of root.getChildMeshes(false)) {
    if (!m.isEnabled()) continue;
    m.computeWorldMatrix(true);
    const h = Math.max(0, m.getAbsolutePosition().y - rootY);
    if (h > maxH) maxH = h;
    els.push({ mesh: m, threshold: h, base: m.scaling.clone() });
  }
  for (const e of els) e.threshold = e.threshold / maxH; // normalisé [0,1]
  return els;
}

/** Applique l'avancement `p` (0->1) : chaque pièce pousse sur une fenêtre APRÈS son seuil
 *  (les pièces basses démarrent tôt, les hautes tard), avec un petit « pop » d'échelle.
 *  À `p` au-delà de `seuil + fenêtre`, la pièce est à sa taille pleine. */
export function applyReveal(els: RevealEl[], p: number): void {
  for (const e of els) {
    const start = e.threshold * (1 - REVEAL_WINDOW);
    const local = clamp01((p - start) / REVEAL_WINDOW);
    if (local <= 0) {
      e.mesh.setEnabled(false);
      continue;
    }
    e.mesh.setEnabled(true);
    const s = local >= 1 ? 1 : easePop(local);
    e.mesh.scaling.set(e.base.x * s, e.base.y * s, e.base.z * s);
  }
}
