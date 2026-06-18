// ============================================================================
//  LE VAISSEAU AU CAMP (M11/RF1b) — l'engin d'évasion « ramené à la base » (fidèle ADR :
//  l'onglet « An Old Starship » se gère depuis le village). Une fois l'épave TROUVÉE
//  (`ship_found`), il apparaît à une ancre du camp et passe par 3 ÉTATS visuels distincts,
//  fidèles à la progression d'ADR (récupérer → réparer → améliorer) :
//    • hull = 0 (RÉCUPÉRÉ)  -> ÉPAVE échouée, à moitié enterrée, morte (`shipCrashed.ts`).
//    • hull > 0 (RÉPARÉ)    -> vaisseau DRESSÉ à la verticale sur son pas de tir, prêt à décoller
//                              (`shipRepaired.ts`).
//    • AMÉLIORÉ             -> accents qui s'ajoutent au vaisseau dressé : boosters (moteur amélioré)
//                              et boucliers (coque bien renforcée) (`shipUpgrades.ts`).
//  Purement visuel : la règle (réparer/décoller) vit dans la sim ; ici on REFLÈTE `state.ship`.
// ============================================================================

import { Scene, TransformNode } from "@babylonjs/core";
import { makeKit, type Kit } from "./lowpoly";
import { terrainHeight, SHIP } from "../../data/world";
import { buildCrashedShip } from "./shipCrashed";
import { buildRepairedShip } from "./shipRepaired";
import { buildUpgradeAccents } from "./shipUpgrades";

export class ShipAtCamp {
  private readonly K: Kit;
  private readonly root: TransformNode;
  private readonly crashed: TransformNode; // état RÉCUPÉRÉ (épave échouée)
  private readonly repaired: TransformNode; // état RÉPARÉ (dressé, prêt au décollage)
  private readonly boosters: TransformNode; // amélioration MOTEUR
  private readonly shields: TransformNode; // amélioration COQUE/BOUCLIERS
  private prevVisible = false;
  private prevRepaired: boolean | null = null;
  private prevBoosters = false;
  private prevShields = false;
  private repairedShown = false;

  constructor(scene: Scene, readonly x: number, readonly z: number) {
    this.K = makeKit(scene);
    this.root = this.K.node(null, [x, terrainHeight(x, z), z]);
    this.root.rotation.y = Math.atan2(-x, -z); // proue tournée vers le cœur du camp (modèles face +Z)
    // Les 3 états coexistent dans le sous-arbre ; `sync` n'en active qu'un (+ accents).
    this.crashed = this.K.node(this.root);
    buildCrashedShip(this.K, this.crashed);
    this.repaired = this.K.node(this.root);
    buildRepairedShip(this.K, this.repaired);
    const acc = buildUpgradeAccents(this.K, this.repaired); // accents attachés au vaisseau DRESSÉ
    this.boosters = acc.boosters;
    this.shields = acc.shields;
    // État initial : épave seule (les autres masqués jusqu'à réparation/amélioration).
    this.repaired.setEnabled(false);
    this.boosters.setEnabled(false);
    this.shields.setEnabled(false);
    this.root.setEnabled(false);
  }

  /** Position-monde de l'ancre (pour le focus « examiner le vaisseau » et le décollage). */
  worldPos(): { x: number; z: number } {
    return { x: this.x, z: this.z };
  }

  /**
   * Reflète `state.ship` (3 états) : ÉPAVE échouée (hull=0) → vaisseau DRESSÉ (hull>0) → accents
   * d'AMÉLIORATION (boosters si moteur amélioré ; boucliers si coque ≥ moitié du max). `visible=false`
   * masque tout (vol en cours — la cinématique `liftoff` prend le relais ; ou vaisseau pas encore trouvé).
   */
  sync(visible: boolean, hull: number, engine: number): void {
    if (visible !== this.prevVisible) { this.root.setEnabled(visible); this.prevVisible = visible; }
    if (!visible) return;
    const repaired = hull > 0;
    this.repairedShown = repaired;
    if (repaired !== this.prevRepaired) {
      this.crashed.setEnabled(!repaired);
      this.repaired.setEnabled(repaired);
      this.prevRepaired = repaired;
    }
    const wantBoosters = repaired && engine >= 1; // moteur amélioré
    if (wantBoosters !== this.prevBoosters) { this.boosters.setEnabled(wantBoosters); this.prevBoosters = wantBoosters; }
    const wantShields = repaired && hull >= Math.ceil(SHIP.hullMax / 2); // coque bien renforcée
    if (wantShields !== this.prevShields) { this.shields.setEnabled(wantShields); this.prevShields = wantShields; }
  }

  /** Le vaisseau DRESSÉ lévite légèrement (sous tension) ; l'épave reste plantée dans la terre. */
  update(_dtSec: number): void {
    if (!this.prevVisible) return;
    const bob = this.repairedShown ? Math.sin(performance.now() * 0.0015) * 0.06 : 0;
    this.root.position.y = terrainHeight(this.x, this.z) + bob;
  }
}
