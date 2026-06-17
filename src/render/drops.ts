// ============================================================================
//  BUTIN AU SOL (M8.6) — à la mort d'un ennemi PARTAGÉ, son butin tombe en une pile
//  3D ramassable (premier-servi : `TAKE_DROP`). Ce module matérialise CHAQUE pile de
//  `state.drops` à sa position monde, expose les cibles pour le verbe « ramasser » et
//  retire les piles ramassées/expirées. Purement visuel : la règle (qui prend quoi) vit
//  dans le reducer (hôte-autoritaire). Léger : une poignée de piles éphémères à la fois.
// ============================================================================

import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { terrainHeight } from "../../data/world";
import { makeKit, P, type Kit } from "./lowpoly";

/** Vue d'une pile au sol pour le rendu (sous-ensemble de l'état `drops`). */
export interface DropView {
  x: number;
  z: number;
  loot: Record<string, number>;
}

/** Cible « ramasser » exposée au focus de main.ts. */
export interface DropTarget {
  dropId: string;
  x: number;
  y: number;
  z: number;
}

interface Pile {
  root: TransformNode;
  x: number;
  z: number;
}

export class GroundDrops {
  private readonly K: Kit;
  private readonly piles = new Map<string, Pile>();

  constructor(private readonly scene: Scene) {
    this.K = makeKit(scene);
  }

  /** Cibles ramassables (coords monde) — pour le focus « ramasser » (TAKE_DROP). */
  targets(): DropTarget[] {
    const out: DropTarget[] = [];
    for (const [dropId, p] of this.piles) out.push({ dropId, x: p.root.position.x, y: p.root.position.y + 0.4, z: p.root.position.z });
    return out;
  }

  /** Reflète l'état sim : bâtit les piles nouvellement tombées, retire celles prises/expirées. */
  sync(drops: Record<string, DropView>): void {
    for (const id of [...this.piles.keys()]) {
      if (!drops[id]) this.dispose(id);
    }
    for (const id of Object.keys(drops)) {
      if (this.piles.has(id)) continue;
      const d = drops[id];
      const gy = terrainHeight(d.x, d.z);
      const root = this.makePile(d.x, gy, d.z);
      this.piles.set(id, { root, x: d.x, z: d.z });
    }
  }

  /** À appeler chaque frame : léger flottement/rotation pour attirer l'œil (cosmétique). */
  update(dtSec: number): void {
    void dtSec;
    const t = performance.now() * 0.002;
    for (const [, p] of this.piles) {
      p.root.rotation.y = t;
      p.root.position.y = terrainHeight(p.x, p.z) + 0.1 + Math.sin(t * 2) * 0.05;
    }
  }

  /** Retire toutes les piles (changement de partie / nettoyage). */
  clearAll(): void {
    for (const id of [...this.piles.keys()]) this.dispose(id);
  }

  // --------------------------------------------------------------------------

  /** Petit tas de butin : sac de cuir éventré + quelques biens qui dépassent + lueur discrète. */
  private makePile(x: number, gy: number, z: number): TransformNode {
    const K = this.K;
    const n = K.node(null, [x, gy, z]);
    K.box(n, P.hide, [0.7, 0.42, 0.55], [0, 0.21, 0], { rot: [0, x * 0.5, 0.05] }); // sac de cuir
    K.box(n, P.fur, [0.4, 0.3, 0.35], [0.28, 0.18, 0.2], { rot: [0, 0.7, 0.2] }); // ballot de fourrure
    K.cyl(n, P.metal, { h: 0.32, d: 0.16, t: 6 }, [-0.22, 0.3, 0.18], { rot: [0.5, 0, 0.3] }); // ferraille
    K.ico(n, P.sulphurRock, { d: 0.22, sub: 1 }, [0.05, 0.42, -0.12], { emi: 0.5 }); // éclat (repère lumineux)
    return n;
  }

  private dispose(id: string): void {
    const p = this.piles.get(id);
    if (!p) return;
    this.piles.delete(id);
    p.root.dispose(false);
  }
}
