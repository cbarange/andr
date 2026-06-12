// ============================================================================
//  ACTIONS — §3.4 "actions, pas états".
//  Toute modification de l'état passe par une action NOMMÉE et SÉRIALISABLE.
//  C'est exactement ce qui circulera sur le réseau (gameAction, voir net/).
// ============================================================================

// NB : `type` (et non `interface`) -> les actions sont des objets JSON purs,
// directement transmissibles sur le réseau (contrainte DataPayload de Trystero).

/** Récolte de bois auprès d'un arbre. */
export type GatherWoodAction = {
  type: "GATHER_WOOD";
  playerId: string;
  amount: number;
};

/** Allumer le feu (uniquement s'il est mort). M1. */
export type LightFireAction = {
  type: "LIGHT_FIRE";
  playerId: string;
};

/** Attiser le feu : +1 cran, coûte du bois. M1. */
export type StokeFireAction = {
  type: "STOKE_FIRE";
  playerId: string;
};

/** Construire un bâtiment (par son id de Craftable). M2. */
export type BuildAction = {
  type: "BUILD";
  playerId: string;
  id: string;
};

/** Relever UN piège (par son index) : butin aléatoire (RNG à graine). */
export type HarvestTrapAction = {
  type: "HARVEST_TRAP";
  playerId: string;
  trap: number; // index du piège (0..nombre de pièges - 1)
};

/** Affecter un villageois libre à un métier. M3. */
export type AssignWorkerAction = {
  type: "ASSIGN_WORKER";
  playerId: string;
  job: string;
};

/** Retirer un villageois d'un métier (il redevient libre). M3. */
export type UnassignWorkerAction = {
  type: "UNASSIGN_WORKER";
  playerId: string;
  job: string;
};

/** Vider le sac du joueur dans l'entrepôt du village. */
export type DepositAction = {
  type: "DEPOSIT";
  playerId: string;
};

/** Réparer la cabane en ruine (consomme du bois du sac). Débloque l'entrepôt + la construction. */
export type RepairCabinAction = {
  type: "REPAIR_CABIN";
  playerId: string;
};

/** Améliorer la cabane (palier suivant : ×1 -> ×5 -> ×10). Coût puisé dans l'entrepôt. */
export type UpgradeCabinAction = {
  type: "UPGRADE_CABIN";
  playerId: string;
};

/** Résoudre un choix de l'événement en cours (par l'id du choix de la scène courante). M5. */
export type ResolveEventChoiceAction = {
  type: "RESOLVE_EVENT_CHOICE";
  playerId: string;
  choice: string; // id du choix dans la scène active
};

// ---- M9 : exploration des mines & grottes (cf. docs/mines-grottes-implementation.md) ----

/** Découvre un site (cosmétique / fog-of-war) ; mémorise son type. */
export type DiscoverSiteAction = {
  type: "DISCOVER_SITE";
  playerId: string;
  cx: number;
  cz: number;
  siteType: string;
};

/** Ramasse le butin d'un nœud : objet 3D -> SAC du joueur. PREMIER-SERVI global (cf. reducer). */
export type TakeLootAction = {
  type: "TAKE_LOOT";
  playerId: string;
  cx: number;
  cz: number;
  siteType: string; // pour dériver le butin (dungeon.ts)
  nodeId: string;
};

/** Dégage un éboulement (nœud `hazard`). */
export type ClearHazardAction = {
  type: "CLEAR_HAZARD";
  playerId: string;
  cx: number;
  cz: number;
  nodeId: string;
};

/** Sécurise le filon d'une mine ⇒ débloque le métier de mineur correspondant. */
export type SecureMineAction = {
  type: "SECURE_MINE";
  playerId: string;
  cx: number;
  cz: number;
  siteType: string;
};

/** Marque une grotte entièrement nettoyée ⇒ elle se convertit en avant-poste (rendu). */
export type ClearCaveAction = {
  type: "CLEAR_CAVE";
  playerId: string;
  cx: number;
  cz: number;
};

/**
 * Se RAVITAILLER à un avant-poste (grotte nettoyée) : remplit l'eau + les vivres du joueur.
 * USAGE UNIQUE fidèle ADR, partagé entre joueurs (premier-servi : l'hôte arbitre). Reste M7.
 */
export type UseOutpostAction = {
  type: "USE_OUTPOST";
  playerId: string;
  cx: number;
  cz: number;
};

/** Fabrique un OBJET (torche…) : débite l'entrepôt, ajoute l'objet au SAC. M9/M10. */
export type CraftItemAction = {
  type: "CRAFT_ITEM";
  playerId: string;
  itemId: string;
};

/**
 * M6/M7/M8 : l'état SPATIAL ABSTRAIT du joueur a changé (dedans <-> dehors, tier de danger,
 * sur route). Émise par le client au CHANGEMENT seulement (la position est locale, hors sim) ;
 * l'hôte met à jour la survie/le danger de ce joueur. Réseau-safe (porte `playerId`).
 * `tier` : 0 = zone sûre, 1..3 = anneaux de distance, 4 = caverne. `onRoad` : cellule de route (R4).
 */
export type SetOutsideAction = {
  type: "SET_OUTSIDE";
  playerId: string;
  outside: boolean;
  tier?: number;
  onRoad?: boolean;
};

// ---- M8 : combat temps réel (rencontres non-spatiales par joueur, fidèle ADR) ----

/** Frappe l'ennemi de SA rencontre avec une arme (cooldown PAR arme ; poings toujours dispo). */
export type AttackAction = {
  type: "ATTACK";
  playerId: string;
  weapon: string;
};

/** Mange une viande séchée du SAC : +PV (cap), cooldown anti-spam. Utilisable en/hors combat. */
export type EatMeatAction = {
  type: "EAT_MEAT";
  playerId: string;
};

/** Fuit la rencontre en cours (la ferme, sans butin ni pénalité — fidèle ADR). */
export type FleeAction = {
  type: "FLEE";
  playerId: string;
};

/** Avance d'un pas fixe de simulation (§3.6). Émise par la boucle, pas par le joueur. */
export type TickAction = {
  type: "TICK";
};

/** DEBUG (hors réseau) : force le déclenchement immédiat d'un événement par son id. Pour l'e2e. */
export type DebugTriggerEventAction = {
  type: "DEBUG_TRIGGER_EVENT";
  id: string;
};

// ---- DEBUG : commandes de la console de développement (src/dev/). PURES & bornées.
//      Routées par `emit` -> en P2P, appliquées par l'hôte (cohérent + sauvegarde). ----

/** Ajoute (amount signé) une ressource au sac (`self`) ou à l'entrepôt (`storage`), borné à 0. */
export type DebugGrantAction = {
  type: "DEBUG_GRANT";
  playerId: string;
  target: "self" | "storage";
  resource: string;
  amount: number;
};

/** Fixe une quantité exacte (>= 0) d'une ressource (sac ou entrepôt). */
export type DebugSetAction = {
  type: "DEBUG_SET";
  playerId: string;
  target: "self" | "storage";
  resource: string;
  amount: number;
};

/** Vide entièrement le sac (`self`) ou l'entrepôt (`storage`). */
export type DebugClearAction = {
  type: "DEBUG_CLEAR";
  playerId: string;
  target: "self" | "storage";
};

/** Fixe le niveau du feu (0..4). */
export type DebugSetFireAction = { type: "DEBUG_SET_FIRE"; level: number };

/** Fixe l'étape de la constructrice (-1..maxLevel). */
export type DebugSetBuilderAction = { type: "DEBUG_SET_BUILDER"; stage: number };

/** Ajoute (n signé) à la population (borné à 0 ; ramène les ouvriers si réduction). */
export type DebugAddPopAction = { type: "DEBUG_ADD_POP"; n: number };

/** Construit gratuitement (+count, borné au maximum) un bâtiment par id. */
export type DebugBuildAction = { type: "DEBUG_BUILD"; id: string; count: number };

/** Débloque tout : cabane réparée + constructrice prête + 1 ex. de chaque bâtiment. */
export type DebugUnlockAllAction = { type: "DEBUG_UNLOCK_ALL" };

/** Change la graine du MONDE (régénération de la carte, gérée côté rendu). */
export type DebugSetSeedAction = { type: "DEBUG_SET_SEED"; seed: number };

/** Fixe le palier de la cabane (0/1/5/10) — réparée dérivée (>= 1). Console dev. */
export type DebugSetCabinTierAction = { type: "DEBUG_SET_CABIN_TIER"; tier: number };

/** Fixe les jauges de survie d'un joueur (eau/vivres/PV ; valeur omise = inchangée). Console dev / e2e. */
export type DebugSetSurvivalAction = {
  type: "DEBUG_SET_SURVIVAL";
  playerId: string;
  water?: number;
  food?: number;
  health?: number;
};

/** Force une rencontre (ennemi/PV optionnels). Console dev / e2e — refusée du réseau (préfixe). */
export type DebugStartEncounterAction = {
  type: "DEBUG_START_ENCOUNTER";
  playerId: string;
  enemyId?: string;
  enemyHp?: number;
};

export type GameAction =
  | GatherWoodAction
  | LightFireAction
  | StokeFireAction
  | BuildAction
  | HarvestTrapAction
  | AssignWorkerAction
  | UnassignWorkerAction
  | DepositAction
  | RepairCabinAction
  | UpgradeCabinAction
  | ResolveEventChoiceAction
  | DiscoverSiteAction
  | TakeLootAction
  | ClearHazardAction
  | SecureMineAction
  | ClearCaveAction
  | UseOutpostAction
  | CraftItemAction
  | SetOutsideAction
  | AttackAction
  | EatMeatAction
  | FleeAction
  | TickAction
  | DebugTriggerEventAction
  | DebugGrantAction
  | DebugSetAction
  | DebugClearAction
  | DebugSetFireAction
  | DebugSetBuilderAction
  | DebugAddPopAction
  | DebugBuildAction
  | DebugUnlockAllAction
  | DebugSetSeedAction
  | DebugSetCabinTierAction
  | DebugSetSurvivalAction
  | DebugStartEncounterAction;

/** Actions émises par un joueur (vs TICK, émise par la boucle) — ce qui circule sur le réseau.
 *  (Les `DEBUG_*` y figurent pour passer par `emit` -> hôte-autoritaire ; console dev uniquement.) */
export type PlayerAction =
  | GatherWoodAction
  | LightFireAction
  | StokeFireAction
  | BuildAction
  | HarvestTrapAction
  | AssignWorkerAction
  | UnassignWorkerAction
  | DepositAction
  | RepairCabinAction
  | UpgradeCabinAction
  | ResolveEventChoiceAction
  | DiscoverSiteAction
  | TakeLootAction
  | ClearHazardAction
  | SecureMineAction
  | ClearCaveAction
  | UseOutpostAction
  | CraftItemAction
  | SetOutsideAction
  | AttackAction
  | EatMeatAction
  | FleeAction
  | DebugGrantAction
  | DebugSetAction
  | DebugClearAction
  | DebugSetFireAction
  | DebugSetBuilderAction
  | DebugAddPopAction
  | DebugBuildAction
  | DebugUnlockAllAction
  | DebugSetSeedAction
  | DebugSetCabinTierAction
  | DebugSetSurvivalAction
  | DebugStartEncounterAction;

/**
 * Une action REÇUE DU RÉSEAU est-elle acceptable par l'hôte ? (anti-triche / anti-usurpation)
 *  - on refuse les `DEBUG_*` venant d'un pair (la console dev ne doit pas piloter l'état partagé) ;
 *  - on refuse d'agir au nom d'un autre joueur (`playerId` doit être l'émetteur réseau `fromId`).
 * PUR et testable. Les actions locales de l'hôte ne passent pas par là (cf. `emit`).
 */
export function isNetworkSafeAction(action: PlayerAction, fromId: string): boolean {
  if (action.type.startsWith("DEBUG_")) return false;
  if ("playerId" in action && action.playerId !== fromId) return false;
  return true;
}

// ---- Fabriques (gardent les call-sites lisibles et le typage strict) ----

export function gatherWood(playerId: string, amount: number): GatherWoodAction {
  return { type: "GATHER_WOOD", playerId, amount };
}

export function lightFire(playerId: string): LightFireAction {
  return { type: "LIGHT_FIRE", playerId };
}

export function stokeFire(playerId: string): StokeFireAction {
  return { type: "STOKE_FIRE", playerId };
}

export function build(playerId: string, id: string): BuildAction {
  return { type: "BUILD", playerId, id };
}

export function harvestTrap(playerId: string, trap: number): HarvestTrapAction {
  return { type: "HARVEST_TRAP", playerId, trap };
}

export function assignWorker(playerId: string, job: string): AssignWorkerAction {
  return { type: "ASSIGN_WORKER", playerId, job };
}

export function unassignWorker(playerId: string, job: string): UnassignWorkerAction {
  return { type: "UNASSIGN_WORKER", playerId, job };
}

export function deposit(playerId: string): DepositAction {
  return { type: "DEPOSIT", playerId };
}

export function repairCabin(playerId: string): RepairCabinAction {
  return { type: "REPAIR_CABIN", playerId };
}

export function upgradeCabin(playerId: string): UpgradeCabinAction {
  return { type: "UPGRADE_CABIN", playerId };
}

export function resolveEventChoice(playerId: string, choice: string): ResolveEventChoiceAction {
  return { type: "RESOLVE_EVENT_CHOICE", playerId, choice };
}

// ---- M9 : exploration ----
export function discoverSite(playerId: string, cx: number, cz: number, siteType: string): DiscoverSiteAction {
  return { type: "DISCOVER_SITE", playerId, cx, cz, siteType };
}
export function takeLoot(playerId: string, cx: number, cz: number, siteType: string, nodeId: string): TakeLootAction {
  return { type: "TAKE_LOOT", playerId, cx, cz, siteType, nodeId };
}
export function clearHazard(playerId: string, cx: number, cz: number, nodeId: string): ClearHazardAction {
  return { type: "CLEAR_HAZARD", playerId, cx, cz, nodeId };
}
export function secureMine(playerId: string, cx: number, cz: number, siteType: string): SecureMineAction {
  return { type: "SECURE_MINE", playerId, cx, cz, siteType };
}
export function clearCave(playerId: string, cx: number, cz: number): ClearCaveAction {
  return { type: "CLEAR_CAVE", playerId, cx, cz };
}
export function useOutpost(playerId: string, cx: number, cz: number): UseOutpostAction {
  return { type: "USE_OUTPOST", playerId, cx, cz };
}
export function craftItem(playerId: string, itemId: string): CraftItemAction {
  return { type: "CRAFT_ITEM", playerId, itemId };
}
export function setOutside(playerId: string, outside: boolean, tier?: number, onRoad?: boolean): SetOutsideAction {
  return { type: "SET_OUTSIDE", playerId, outside, ...(tier !== undefined ? { tier } : {}), ...(onRoad !== undefined ? { onRoad } : {}) };
}
export function attack(playerId: string, weapon: string): AttackAction {
  return { type: "ATTACK", playerId, weapon };
}
export function eatMeat(playerId: string): EatMeatAction {
  return { type: "EAT_MEAT", playerId };
}
export function flee(playerId: string): FleeAction {
  return { type: "FLEE", playerId };
}

export function tick(): TickAction {
  return { type: "TICK" };
}

// ---- Fabriques DEBUG (console de développement) ----

export function debugGrant(playerId: string, target: "self" | "storage", resource: string, amount: number): DebugGrantAction {
  return { type: "DEBUG_GRANT", playerId, target, resource, amount };
}
export function debugSet(playerId: string, target: "self" | "storage", resource: string, amount: number): DebugSetAction {
  return { type: "DEBUG_SET", playerId, target, resource, amount };
}
export function debugClear(playerId: string, target: "self" | "storage"): DebugClearAction {
  return { type: "DEBUG_CLEAR", playerId, target };
}
export function debugSetFire(level: number): DebugSetFireAction {
  return { type: "DEBUG_SET_FIRE", level };
}
export function debugSetBuilder(stage: number): DebugSetBuilderAction {
  return { type: "DEBUG_SET_BUILDER", stage };
}
export function debugAddPop(n: number): DebugAddPopAction {
  return { type: "DEBUG_ADD_POP", n };
}
export function debugBuild(id: string, count: number): DebugBuildAction {
  return { type: "DEBUG_BUILD", id, count };
}
export function debugUnlockAll(): DebugUnlockAllAction {
  return { type: "DEBUG_UNLOCK_ALL" };
}
export function debugSetSeed(seed: number): DebugSetSeedAction {
  return { type: "DEBUG_SET_SEED", seed };
}
export function debugSetCabinTier(tier: number): DebugSetCabinTierAction {
  return { type: "DEBUG_SET_CABIN_TIER", tier };
}
export function debugSetSurvival(
  playerId: string,
  vals: { water?: number; food?: number; health?: number },
): DebugSetSurvivalAction {
  return { type: "DEBUG_SET_SURVIVAL", playerId, ...vals };
}
export function debugStartEncounter(playerId: string, enemyId?: string, enemyHp?: number): DebugStartEncounterAction {
  return { type: "DEBUG_START_ENCOUNTER", playerId, ...(enemyId ? { enemyId } : {}), ...(enemyHp !== undefined ? { enemyHp } : {}) };
}
