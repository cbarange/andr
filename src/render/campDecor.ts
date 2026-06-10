// ============================================================================
//  DÉCOR AU SOL DU CAMPEMENT (Phase 2) — disperse herbes, fleurs, fougères, champignons
//  et cailloux dans les POCHES VIVABLES du camp, en ÉVITANT : la place nue (le foyer), les
//  SENTIERS (sol damé), les EMPRISES des bâtiments et les ARBRES. Densité faible au centre
//  (place usée par les passages), plus fournie vers la lisière. DÉTERMINISTE (graine dédiée)
//  -> décor stable d'un rechargement à l'autre et identique entre pairs. Purement cosmétique
//  & local (comme la forêt / les villageois). Réutilise le registre Decor. Voir docs/plan-campement.md.
// ============================================================================

import { Scene, TransformNode } from "@babylonjs/core";
import { Decor } from "./scatter";
import { campLayout, trees as treeSlots, terrainHeight } from "../../data/world";
import { CAMP_R, campClearing, campPath } from "./campGround";
import { createRng, nextFloat, type RngState } from "../sim/rng";

const SEED = 0xca37; // graine dédiée du décor du camp (déterministe, stable)
const CANDIDATES = 1400; // points testés (dispersion régulière)
const FOYER_R = 4.2; // pas de décor sur le foyer / la place nue
const PATH_AVOID = 0.22; // au-delà de cette intensité de sentier -> sol nu (sentiers nets)
const TREE_AVOID = 1.6; // distance mini à un arbre du camp

// Mélange du camp : herbe + fleurs dominantes, fougères/champignons en accent, cailloux épars.
const TYPES: Array<{ kind: string; w: number; min: number; max: number }> = [
  { kind: "grass", w: 0.42, min: 0.55, max: 1.0 },
  { kind: "flower", w: 0.2, min: 0.6, max: 1.0 },
  { kind: "fern", w: 0.12, min: 0.7, max: 1.0 },
  { kind: "rock", w: 0.14, min: 0.45, max: 0.85 },
  { kind: "mushroom", w: 0.07, min: 0.7, max: 1.0 },
  { kind: "drybush", w: 0.05, min: 0.6, max: 0.95 },
];

interface Obstacle { x: number; z: number; r: number }

export class CampDecor {
  private readonly node: TransformNode;

  constructor(scene: Scene, decor: Decor) {
    this.node = new TransformNode("campDecor", scene);
    const rng = createRng(SEED);
    const obstacles = this.buildObstacles();

    for (let i = 0; i < CANDIDATES; i++) {
      const x = (nextFloat(rng) * 2 - 1) * CAMP_R;
      const z = (nextFloat(rng) * 2 - 1) * CAMP_R;
      const r = Math.hypot(x, z);
      // garde l'ordre des tirages RNG constant : on consomme toujours type/échelle/rotation,
      // même si le point est rejeté -> dispersion stable et indépendante des seuils.
      const typePick = this.pickType(rng);
      const scale = typePick.min + nextFloat(rng) * (typePick.max - typePick.min);
      const rotY = nextFloat(rng) * Math.PI * 2;
      const keep = nextFloat(rng);

      if (r < FOYER_R || r > CAMP_R) continue; // foyer nu / hors camp (le scatter sauvage gère dehors)
      if (campClearing(r, x, z) < 0.12) continue; // hors de la clairière
      if (campPath(r, x, z) > PATH_AVOID) continue; // sur un sentier
      // densité : faible près du centre (place usée), plus fournie vers la lisière
      const radial = Math.min(1, Math.max(0, (r - 5) / 9));
      if (keep > 0.16 + 0.5 * radial) continue;
      // évite les emprises des bâtiments + les arbres du camp
      let blocked = false;
      for (const o of obstacles) if ((x - o.x) ** 2 + (z - o.z) ** 2 < o.r * o.r) { blocked = true; break; }
      if (blocked) continue;
      for (const t of treeSlots) if ((x - t.x) ** 2 + (z - t.z) ** 2 < TREE_AVOID * TREE_AVOID) { blocked = true; break; }
      if (blocked) continue;

      const inst = decor.createInstance(typePick.kind, x, terrainHeight(x, z), z, rotY, scale);
      if (inst) inst.parent = this.node;
    }
  }

  /** Affiche/masque le décor du sol (l'éditeur de spawn le cache pour une vue épurée). */
  setVisible(v: boolean): void {
    this.node.setEnabled(v);
  }

  private pickType(rng: RngState): { kind: string; min: number; max: number } {
    let roll = nextFloat(rng);
    for (const t of TYPES) { roll -= t.w; if (roll < 0) return t; }
    return TYPES[0];
  }

  /** Emprises (cercles) à laisser nues : cabane + chaque bâtiment du layout. */
  private buildObstacles(): Obstacle[] {
    const out: Obstacle[] = [{ x: campLayout.cabin.x, z: campLayout.cabin.z, r: 4.4 }];
    const FOOT: Record<string, number> = {
      hut: 2.6, cart: 2.2, "trading post": 2.8, armoury: 2.4, tannery: 2.4,
      workshop: 2.4, smokehouse: 2.2, lodge: 3.0, steelworks: 3.0, trap: 1.3,
    };
    for (const id of Object.keys(campLayout.buildings)) {
      const r = FOOT[id] ?? 2.4;
      for (const a of campLayout.buildings[id]) out.push({ x: a.x, z: a.z, r });
    }
    return out;
  }
}
