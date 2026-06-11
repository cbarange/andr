// ============================================================================
//  RUINES DU CAMP (Chantier C — D) — esthétique « monde dévasté » d'A Dark Room.
//  Deux sortes (toutes COSMÉTIQUES & LOCALES, aucune règle de jeu) :
//   - sur ~1/3 des emplacements de bâtiments MAJEURS pas encore bâtis : un petit tas
//     de gravats (tease « ici se dressera un bâtiment »), RETIRÉ dès qu'on commence à
//     construire / qu'on a bâti (le chantier puis le bâtiment le remplacent) ;
//   - quelques ruines PERMANENTES en périphérie (sans évolution).
//  Voir docs/refonte-monde-campement.md §D.
// ============================================================================

import { Scene, TransformNode } from "@babylonjs/core";
import { terrainHeight, campLayout } from "../../data/world";
import { makeKit, P, type Kit } from "./lowpoly";

// ~1/3 des bâtiments majeurs (1-exemplaire) démarrent en ruine — choisis pour être bien répartis
// (nord / est / sud-ouest) et hors de la place centrale.
const RUINED_SPOTS = ["tannery", "lodge", "armoury"];
// Ruines décoratives permanentes (jamais bâties), dans les poches périphériques entre huttes/pièges.
const PERMANENT: Array<{ x: number; z: number }> = [
  { x: 18, z: -8 }, { x: -4, z: 20 }, { x: 16, z: 16 }, { x: -18, z: -14 },
];

export class CampRuins {
  private readonly K: Kit;
  private readonly node: TransformNode;
  private readonly spot = new Map<string, TransformNode>(); // ruine par emplacement de bâtiment futur
  private hidden = false;

  constructor(scene: Scene) {
    this.K = makeKit(scene);
    this.node = new TransformNode("campRuins", scene);
    for (const p of PERMANENT) this.buildRubble(p.x, p.z, 1.0);
  }

  /** Gravats sur les emplacements de bâtiments majeurs PAS ENCORE bâtis (ni en construction).
   *  Lazy create + toggle (cheap, appelé chaque frame après village.sync). */
  sync(buildings: Record<string, number>, constructingId: string | null): void {
    for (const type of RUINED_SPOTS) {
      const anchor = campLayout.buildings[type]?.[0];
      if (!anchor) continue;
      const built = (buildings[type] ?? 0) > 0;
      const show = !built && constructingId !== type && !this.hidden;
      let r = this.spot.get(type);
      if (show && !r) { r = this.buildRubble(anchor.x, anchor.z, 0.85); this.spot.set(type, r); }
      r?.setEnabled(show);
    }
  }

  /** Masque TOUTES les ruines (éditeur de spawn) ; le prochain `sync` rétablit celles d'emplacement. */
  setVisible(v: boolean): void {
    this.hidden = !v;
    this.node.setEnabled(v);
  }

  /** Petit tas de gravats : pierres brisées + poutre carbonisée penchée. Variation déterministe. */
  private buildRubble(x: number, z: number, scale: number): TransformNode {
    const K = this.K;
    const root = K.node(this.node, [x, terrainHeight(x, z), z]);
    root.scaling.setAll(scale);
    // hash local [0,1) — déterministe par position (cosmétique : Math autorisé en couche rendu).
    const h = (n: number): number => { const s = Math.sin((x * 12.9898 + z * 78.233 + n * 37.7) * 43758.5453); return s - Math.floor(s); };
    K.box(root, P.stone, [0.9, 0.3, 0.6], [0, 0.15, 0], { rot: [0, h(1) * 6.283, 0] }); // semelle brisée
    K.ico(root, P.stoneDark, { d: 0.5 }, [0.5 - h(2) * 0.3, 0.2, -0.4 + h(3) * 0.3]); // blocs épars
    K.ico(root, P.stone, { d: 0.42 }, [-0.5 + h(4) * 0.3, 0.18, 0.4 - h(5) * 0.3]);
    K.box(root, P.stoneDark, [0.4, 0.22, 0.4], [0.12, 0.11, 0.52], { rot: [0, h(6) * 6.283, 0] });
    const beam = K.node(root, [-0.2, 0, -0.1]); // poutre carbonisée penchée
    beam.rotation.set(0.3 + h(7) * 0.4, h(8) * 6.283, 0.5);
    K.cyl(beam, P.scorch, { h: 1.4, d: 0.14, t: 6 }, [0, 0.6, 0]);
    K.box(root, P.woodDark, [0.5, 0.08, 0.1], [0.3, 0.05, -0.32], { rot: [0, h(9) * 6.283, 0.1] }); // planche éclatée
    return root;
  }
}
