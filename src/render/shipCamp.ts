// ============================================================================
//  LE VAISSEAU AU CAMP (M11/RF1b) — l'engin d'évasion « ramené à la base » (fidèle ADR :
//  l'onglet « An Old Starship » se gère depuis le village). Une fois l'épave TROUVÉE
//  (`ship_found`), un vaisseau wanderer low-poly apparaît à une ancre du camp et
//  S'ASSEMBLE au fil de la coque réparée (pattern `reveal` de la cabane). Purement visuel :
//  la règle (réparer/décoller) vit dans la sim ; ici on REFLÈTE `state.ship`.
// ============================================================================

import { Scene, TransformNode } from "@babylonjs/core";
import { makeKit, P, type Kit } from "./lowpoly";
import { terrainHeight, SHIP } from "../../data/world";
import { prepareReveal, applyReveal, type RevealEl } from "./reveal";

export class ShipAtCamp {
  private readonly K: Kit;
  private readonly root: TransformNode;
  private parts: RevealEl[] = [];
  private prevP = -1;
  private prevVisible = false;

  constructor(scene: Scene, readonly x: number, readonly z: number) {
    this.K = makeKit(scene);
    this.root = this.K.node(null, [x, terrainHeight(x, z), z]);
    this.root.rotation.y = Math.atan2(-x, -z); // proue tournée vers le cœur du camp (modèles face +Z)
    this.build();
    this.parts = prepareReveal(this.root); // mesuré pendant qu'il est ENABLED (avant de masquer)
    this.root.setEnabled(false);
  }

  /** Position-monde de l'ancre (pour le focus « examiner le vaisseau » et le décollage). */
  worldPos(): { x: number; z: number } {
    return { x: this.x, z: this.z };
  }

  /**
   * Reflète l'état : visible une fois le vaisseau TROUVÉ (sauf pendant un décollage — la cinématique
   * `liftoff.ts` prend le relais), assemblé proportionnellement à la coque (25 % à la découverte → 100 %
   * à `hullMax`). `visible=false` le masque (vol en cours / pas encore trouvé).
   */
  sync(visible: boolean, hull: number): void {
    if (visible !== this.prevVisible) { this.root.setEnabled(visible); this.prevVisible = visible; }
    if (!visible) return;
    const p = 0.25 + 0.75 * Math.min(1, hull / Math.max(1, SHIP.hullMax));
    if (Math.abs(p - this.prevP) < 0.001) return;
    this.prevP = p;
    applyReveal(this.parts, p);
  }

  /** Léger flottement/respiration cosmétique (vie). */
  update(_dtSec: number): void {
    if (!this.prevVisible) return;
    this.root.position.y = terrainHeight(this.x, this.z) + Math.sin(performance.now() * 0.0015) * 0.04;
  }

  // --------------------------------------------------------------------------

  private build(): void {
    const K = this.K, root = this.root;
    const hull = [0.22, 0.34, 0.4], hullDk = [0.14, 0.22, 0.26], cyan = [0.45, 0.95, 0.9], alloy = P.alienAlloy;
    // Fuseau (le long de +Z) + nez + bandeau alien lumineux.
    K.cyl(root, hull, { h: 4.0, dt: 0.7, db: 1.1, t: 8 }, [0, 1.5, 0], { rot: [Math.PI / 2, 0, 0] });
    K.cone(root, hullDk, { h: 1.4, d: 0.72, t: 8 }, [0, 1.5, 2.6], { rot: [Math.PI / 2, 0, 0] });
    K.cone(root, alloy, { h: 0.4, d: 0.16, t: 6 }, [0, 1.5, 3.35], { rot: [Math.PI / 2, 0, 0] });
    K.cyl(root, cyan, { h: 0.18, d: 1.16, t: 8 }, [0, 1.5, 0.5], { rot: [Math.PI / 2, 0, 0], emi: 1.2, unlit: true });
    // Ailes forward-swept (symétriques) + veine lumineuse.
    for (const sx of [1, -1]) {
      K.box(root, hullDk, [1.7, 0.12, 1.1], [sx * 1.15, 1.2, -0.2], { rot: [0, sx * -0.32, 0] });
      K.box(root, cyan, [1.5, 0.05, 0.08], [sx * 1.1, 1.27, 0.0], { rot: [0, sx * -0.32, 0], emi: 1.0, unlit: true });
    }
    // Dérive dorsale.
    K.box(root, hull, [0.12, 1.0, 1.1], [0, 2.1, -1.5]);
    // Drive arrière (lueur).
    K.cyl(root, cyan, { h: 0.5, dt: 0.3, db: 0.75, t: 8 }, [0, 1.5, -2.4], { rot: [Math.PI / 2, 0, 0], emi: 1.4, unlit: true });
    // Trains d'atterrissage (4 béquilles).
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      K.cyl(root, hullDk, { h: 1.3, d: 0.14, t: 5 }, [sx * 0.7, 0.65, sz * 1.3], { rot: [sz * 0.18, 0, sx * 0.18] });
    }
  }
}
