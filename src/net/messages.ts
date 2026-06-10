// ============================================================================
//  MESSAGES RÉSEAU — §7. Deux familles, plus une synchro d'état autoritaire.
//  Tout est sérialisable (JSON) : c'est ce qui transite sur les DataChannels.
// ============================================================================

import type { PlayerAction } from "../sim/actions";
import type { GameState } from "../sim/state";

/** Position/rotation de l'avatar d'un joueur. Fréquent, diffusé par chaque pair. */
export type PlayerTransformMsg = {
  x: number;
  y: number;
  z: number;
  ry: number;
};

/** Action de simulation envoyée À L'HÔTE (qui seul l'applique à l'état autoritaire). */
export type GameActionMsg = PlayerAction;

/**
 * Snapshot de l'état AUTORITAIRE rediffusé par l'hôte. On transmet l'**état COMPLET**
 * (`GameState` est conçu pour être sérialisable, cf. `state.ts`) via un sérialiseur unique :
 *  - plus aucun champ oublié au fil des jalons (c'est ainsi que `cabinTier` avait été manqué) ;
 *  - les échéances (`*At`) + le `rng` sont inclus -> un client promu hôte reprend la timeline
 *    sans rafale d'événements/revenus (pas de « burst » post-migration).
 * `host` = revendication d'autorité de l'émetteur (anti split-brain : cf. `net/host.ts`).
 */
export type StateSyncMsg = {
  state: GameState;
  host: { id: string; forced: boolean };
};
