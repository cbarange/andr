// ============================================================================
//  REDUCER — applique une action à l'état. PUR et DÉTERMINISTE (§3.1, §3.3).
//  - ne mute jamais l'état d'entrée (renvoie un nouvel état) ;
//  - même (état, action) -> même résultat sur toutes les machines ;
//  - aucune dépendance Babylon/DOM, aucun Math.random() (utiliser state.rng).
//
//  M1 : le feu (déclin/allumage/attisage), la température (converge vers le feu)
//  et l'étrangère (apparaît puis progresse) sont des machines à états pilotées par
//  des ÉCHÉANCES EN TICS, donc parfaitement reproductibles.
// ============================================================================

import {
  GameState, Fire, Temp, BUILDER_ABSENT, stockOf, freeWorkers, sumWorkers, carriedTotal, carriedOf, carryCapacity, plannedCount, siteKey,
  PlayerSurvival, baseSurvival, Encounter, maxWaterOf, maxHealthOf,
} from "./state";
import { GameAction } from "./actions";
import { cloneRng, nextFloat, nextInt, RngState } from "./rng";
import { lootForNode, lootNodeIds } from "./dungeon";
import { drawRoad } from "./roads";
import { stepFightTriggers, pickEnemy, rollEnemyLoot, ownsWeapon, hasAmmo, attackDamage, playerHit, enemyHit } from "./combat";
import {
  config, craftables, craftableById, craftableCost, buildSecondsFor, trapDrops, jobs, jobById,
  craftableItemById, events, eventById, type EventEffect, storageCap, nextCabinTier, cabinUpgradeCost,
  weaponById, enemyById, tradeGoodById, mineGuardians,
} from "../../data/world";

// Conversions secondes -> tics (une seule fois, à partir des données).
const HZ = config.simTickHz;
const FIRE_COOL_TICKS = config.fire.coolSeconds * HZ;
const STOKE_COOLDOWN_TICKS = config.fire.stokeCooldownSeconds * HZ;
const TEMP_ADJUST_TICKS = config.fire.tempAdjustSeconds * HZ;
const BUILDER_ADVANCE_TICKS = config.fire.builder.advanceSeconds * HZ;
const BUILDER_APPEAR_FIRE = config.fire.builder.appearFireLevel;
const BUILDER_MAX = config.fire.builder.maxLevel;
const TEND_THRESHOLD = config.fire.builder.tendThreshold;
const TEND_TARGET = config.fire.builder.tendTarget;
const TEND_ROARING_CHANCE = config.fire.builder.tendRoaringChance;
const TEND_WOOD_COST = config.fire.builder.tendWoodCost;
const TEND_COOLDOWN_TICKS = config.fire.builder.tendCooldownSeconds * HZ;
const TEND_WALK_TICKS = config.fire.builder.tendWalkSeconds * HZ;
const TRAPS_COOLDOWN_MIN_S = config.trapsCooldownMinSeconds;
const TRAPS_COOLDOWN_MAX_S = config.trapsCooldownMaxSeconds;
const HUT_ROOM = config.population.hutRoom;
const POP_MIN_S = config.population.growMinSeconds;
const POP_MAX_S = config.population.growMaxSeconds;
const INCOME_TICKS = config.population.incomeSeconds * HZ;
const EV_MIN_S = config.events.minSeconds;
const EV_MAX_S = config.events.maxSeconds;
const EV_EMPTY_SCALE = config.events.emptyRescheduleScale;
// --- M6/M7 : survie (échéances en tics, dérivées des secondes des données) ---
const WATER_DRAIN_TICKS = config.survival.waterDrainSeconds * HZ;
const FOOD_DRAIN_TICKS = config.survival.foodDrainSeconds * HZ;
const HEALTH_DRAIN_TICKS = config.survival.healthDrainSeconds * HZ;
const RECHARGE_TICKS = config.survival.rechargeSeconds * HZ;
const RESPAWN_COOLDOWN_TICKS = config.survival.respawnCooldownSeconds * HZ;
const MAX_FOOD = config.survival.maxFood;
const DEATH_STORAGE_PENALTY = config.survival.deathStoragePenalty;
// --- M8/M8.5 : combat (déclenchement PAR PAS, fidèle ADR) ---
const FIGHT_DELAY_STEPS = config.combat.fightDelaySteps;
const MAX_STEPS_PER_ACTION = config.combat.maxStepsPerAction;
const EAT_COOLDOWN_TICKS = config.combat.eatCooldownSeconds * HZ;
const EAT_MEAT_HEAL = config.combat.eatMeatHeal;
const MEDS_COOLDOWN_TICKS = config.combat.medsCooldownSeconds * HZ;
const MEDS_HEAL = config.combat.medsHeal;

/** Durée d'un chantier en TICS (>= 1) — la constructrice bâtit ce bâtiment en autant de tics. */
function buildTicks(id: string): number {
  return Math.max(1, Math.round(buildSecondsFor(id) * HZ));
}

// ---- M5 : application d'un effet d'événement (déclaratif) à un BROUILLON d'état. ----
// Tout est PUR/déterministe : on mute le brouillon (déjà cloné par l'appelant) et le RNG.
type EffectDraft = {
  resources: Record<string, number>;
  buildings: Record<string, number>;
  population: number;
  workers: Record<string, number>;
  pendingEffects: GameState["pendingEffects"];
  tick: number;
  cabinTier: number; // pour borner les stocks au plafond de l'entrepôt (cf. storageCap)
  perks: Record<string, true>; // M10 : perks du village (grantPerk)
};

/** Ajoute un delta de stocks en bornant chaque ressource à [0, plafond de l'entrepôt]. */
function addStores(res: Record<string, number>, delta: Record<string, number>, cabinTier: number): void {
  for (const k of Object.keys(delta)) {
    res[k] = Math.max(0, Math.min(storageCap(cabinTier, k), (res[k] ?? 0) + delta[k]));
  }
}

/** Après une mort, ramène les ouvriers spécialisés sous la population (déterministe). */
function trimWorkersToPopulation(d: EffectDraft): void {
  const specialized = () => sumWorkers(d.workers) - (d.workers["gatherer"] ?? 0);
  while (specialized() > d.population) {
    // Retire un ouvrier du métier le plus pourvu (ordre des `jobs` -> tie-break déterministe).
    let pick: string | null = null;
    for (const j of jobs) {
      if (j.id === "gatherer") continue;
      const n = d.workers[j.id] ?? 0;
      if (n > 0 && (pick === null || n > (d.workers[pick] ?? 0))) pick = j.id;
    }
    if (pick === null) break;
    d.workers[pick] = (d.workers[pick] ?? 0) - 1;
  }
}

/** Applique un EventEffect déclaratif (mute `d` ET `rng`). Ordre fixe -> reproductible. */
function applyEffect(d: EffectDraft, eff: EventEffect, rng: RngState): void {
  if (eff.stores) addStores(d.resources, eff.stores, d.cabinTier);
  if (eff.convert) {
    const c = eff.convert;
    const have = d.resources[c.from] ?? 0;
    const floor = c.min ?? 1;
    let removed = Math.max(floor, Math.floor(have * c.pct));
    removed = Math.min(removed, have);
    const gained = Math.max(floor, Math.floor(removed / c.ratio));
    d.resources[c.from] = Math.max(0, have - removed);
    d.resources[c.to] = Math.min(storageCap(d.cabinTier, c.to), (d.resources[c.to] ?? 0) + gained);
  }
  if (eff.killVillagers) {
    const { min, max } = eff.killVillagers;
    const k = Math.min(d.population, min + nextInt(rng, Math.max(1, max - min + 1)));
    d.population -= k;
    trimWorkersToPopulation(d);
  }
  if (eff.destroyBuildings) {
    const { id, min, max } = eff.destroyBuildings;
    const have = d.buildings[id] ?? 0;
    if (have > 0) {
      const k = Math.min(have, min + nextInt(rng, Math.max(1, max - min + 1)));
      d.buildings[id] = have - k;
    }
  }
  if (eff.delayedStores) {
    const ds = eff.delayedStores;
    if (nextFloat(rng) < ds.chance) {
      d.pendingEffects = [
        ...d.pendingEffects,
        { at: d.tick + Math.max(1, Math.floor(ds.delaySeconds * HZ)), stores: { ...ds.stores }, note: ds.note },
      ];
    }
  }
  if (eff.grantPerk) d.perks[eff.grantPerk] = true; // M10 : perk du village (idempotent)
}

/** Tire une scène dans une map de poids cumulés : le plus petit seuil tel que r < seuil (façon ADR). */
function pickWeighted(map: Record<number, string>, r: number): string {
  const keys = Object.keys(map).map(Number).sort((a, b) => a - b);
  for (const k of keys) if (r < k) return map[k];
  return map[keys[keys.length - 1]];
}

/** Intervalle entre deux événements, en secondes (tiré via le RNG à graine). */
function eventIntervalSeconds(rng: RngState): number {
  return EV_MIN_S + nextFloat(rng) * (EV_MAX_S - EV_MIN_S);
}

export function reduce(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "GATHER_WOOD": {
      // Va dans le SAC du joueur (plafonné), pas dans l'entrepôt.
      const pid = action.playerId;
      const room = carryCapacity(state) - carriedTotal(state, pid);
      if (room <= 0) return state; // sac plein
      const bag = { ...(state.carried[pid] ?? {}) };
      bag.wood = (bag.wood ?? 0) + Math.min(action.amount, room);
      return {
        ...state,
        carried: { ...state.carried, [pid]: bag },
        rng: cloneRng(state.rng),
      };
    }

    case "LIGHT_FIRE": {
      if (state.fire !== Fire.Dead) return state; // déjà allumé -> no-op
      return {
        ...state,
        fire: config.fire.lightLevel,
        fireCoolAt: state.tick + FIRE_COOL_TICKS,
        rng: cloneRng(state.rng),
      };
    }

    case "STOKE_FIRE": {
      // Le feu est nourri depuis le SAC porté (on y jette le bois qu'on tient).
      const pid = action.playerId;
      const cost = config.fire.stokeCost;
      const have = state.carried[pid]?.wood ?? 0;
      const canStoke =
        state.fire > Fire.Dead && // doit être allumé
        state.fire < Fire.Roaring && // déjà au maximum -> ne pas gâcher de bois
        have >= cost &&
        state.tick >= state.stokeReadyAt; // cooldown
      if (!canStoke) return state;
      const bag = { ...(state.carried[pid] ?? {}) };
      bag.wood = have - cost;
      return {
        ...state,
        carried: { ...state.carried, [pid]: bag },
        fire: Math.min(state.fire + 1, Fire.Roaring),
        fireCoolAt: state.tick + FIRE_COOL_TICKS,
        stokeReadyAt: state.tick + STOKE_COOLDOWN_TICKS,
        rng: cloneRng(state.rng),
      };
    }

    case "BUILD": {
      const craftable = craftableById[action.id];
      if (!craftable) return state;
      // La cabane doit être réparée (elle abrite l'atelier de la constructrice).
      if (!state.cabinRepaired) return state;
      // On COMPTE les exemplaires achevés + ceux déjà en chantier (déjà payés) : on n'enfile
      // pas plus que le maximum, et le coût escaladant suit le rang du PROCHAIN exemplaire.
      const count = plannedCount(state, action.id);
      if (count >= craftable.maximum) return state; // maximum atteint
      const cost = craftableCost(craftable, count);
      // Ressources suffisantes ?
      for (const r of Object.keys(cost)) {
        if (stockOf(state, r) < cost[r]) return state;
      }
      // Le coût est débité IMMÉDIATEMENT (les matériaux partent sur le chantier) ; le bâtiment
      // n'est compté dans `buildings` qu'à l'ACHÈVEMENT (cf. TICK). On enfile un chantier : s'il
      // est seul, il démarre tout de suite (doneAt = échéance) ; sinon il attend son tour (doneAt 0).
      const resources = { ...state.resources };
      for (const r of Object.keys(cost)) {
        resources[r] = (resources[r] ?? 0) - cost[r];
      }
      const startsNow = state.constructing.length === 0;
      const item = { id: action.id, doneAt: startsNow ? state.tick + buildTicks(action.id) : 0 };
      return {
        ...state,
        resources,
        constructing: [...state.constructing, item],
        rng: cloneRng(state.rng),
      };
    }

    case "HARVEST_TRAP": {
      const pid = action.playerId;
      const traps = state.buildings["trap"] ?? 0;
      const idx = action.trap;
      if (idx < 0 || idx >= traps) return state; // piège inexistant
      if (state.tick < (state.trapReadyAt[idx] ?? 0)) return state; // ce piège est vide (en rechargement)
      const room = carryCapacity(state) - carriedTotal(state, pid);
      if (room <= 0) return state; // sac plein
      // UN seul piège : 1 prise de base, + 1 par appât consommé (ADR). Plafonné par le sac.
      const baitAvail = Math.floor(state.resources["bait"] ?? 0);
      const baitUsed = Math.min(baitAvail, config.baitPerExtraCatch);
      const rolls = Math.min(1 + baitUsed, room);
      const baitConsumed = Math.max(0, rolls - 1); // appâts réellement servis

      // Le butin va dans le SAC (le joueur le rapporte), via le RNG à graine.
      const rng = cloneRng(state.rng);
      const bag = { ...(state.carried[pid] ?? {}) };
      for (let i = 0; i < rolls; i++) {
        const r = nextFloat(rng);
        const drop = trapDrops.find((d) => r < d.rollUnder) ?? trapDrops[trapDrops.length - 1];
        bag[drop.id] = (bag[drop.id] ?? 0) + 1;
      }
      // CE piège tire SON propre délai de rechargement dans [min, max] (RNG à graine).
      const cooldownS = TRAPS_COOLDOWN_MIN_S + nextFloat(rng) * (TRAPS_COOLDOWN_MAX_S - TRAPS_COOLDOWN_MIN_S);
      const cooldownTicks = Math.max(1, Math.floor(cooldownS * HZ));
      const resources =
        baitConsumed > 0
          ? { ...state.resources, bait: (state.resources["bait"] ?? 0) - baitConsumed }
          : state.resources;
      return {
        ...state,
        carried: { ...state.carried, [pid]: bag },
        resources,
        rng, // état du RNG avancé (prises + délai de rechargement)
        trapReadyAt: { ...state.trapReadyAt, [idx]: state.tick + cooldownTicks }, // CE piège se vide
      };
    }

    case "DEPOSIT": {
      // Vide le sac du joueur dans l'entrepôt (nécessite la cabane réparée).
      if (!state.cabinRepaired) return state;
      const pid = action.playerId;
      const bag = state.carried[pid];
      if (!bag || Object.keys(bag).length === 0) return state;
      // Dépôt borné au PLAFOND de l'entrepôt (par ressource, selon la rareté + le palier).
      // Surplus perdu (clamp sec, fidèle à ADR) — le plus simple et lisible.
      const resources = { ...state.resources };
      for (const k of Object.keys(bag)) resources[k] = Math.max(0, Math.min(storageCap(state.cabinTier, k), (resources[k] ?? 0) + bag[k]));
      return {
        ...state,
        resources,
        carried: { ...state.carried, [pid]: {} },
        rng: cloneRng(state.rng),
      };
    }

    case "REPAIR_CABIN": {
      if (state.cabinRepaired) return state;
      if (state.builder < BUILDER_MAX) return state; // la constructrice doit être prête
      const pid = action.playerId;
      const have = state.carried[pid]?.wood ?? 0;
      if (have < config.cabinRepairCost) return state;
      const bag = { ...(state.carried[pid] ?? {}) };
      bag.wood = have - config.cabinRepairCost;
      return {
        ...state,
        carried: { ...state.carried, [pid]: bag },
        cabinRepaired: true,
        cabinTier: 1, // ruine -> réparée (×1)
        rng: cloneRng(state.rng),
      };
    }

    case "UPGRADE_CABIN": {
      // Améliore au palier suivant (×1 -> ×5 -> ×10). Coût puisé dans l'ENTREPÔT (pas le sac).
      if (!state.cabinRepaired) return state;
      const next = nextCabinTier(state.cabinTier);
      if (next === null) return state; // déjà au maximum
      const cost = cabinUpgradeCost[next] ?? {};
      for (const r of Object.keys(cost)) if (stockOf(state, r) < cost[r]) return state;
      const resources = { ...state.resources };
      for (const r of Object.keys(cost)) resources[r] = (resources[r] ?? 0) - cost[r];
      return { ...state, resources, cabinTier: next, rng: cloneRng(state.rng) };
    }

    case "ASSIGN_WORKER": {
      const job = jobById[action.job];
      if (!job) return state;
      // Le BÛCHERON est l'occupation par défaut (le « reste »), pas un poste qu'on assigne.
      if (job.id === "gatherer") return state;
      // Prérequis : le bâtiment du métier doit exister.
      if (job.building && (state.buildings[job.building] ?? 0) === 0) return state;
      // M9 — prérequis SITE : un métier de mineur n'est assignable qu'une fois une mine du bon
      // type SÉCURISÉE (cf. SECURE_MINE). Verrouillé tant qu'aucun filon correspondant n'est pris.
      if (job.siteType) {
        const unlocked = Object.values(state.sites ?? {}).some((s) => s.secured && s.type === job.siteType);
        if (!unlocked) return state;
      }
      if (freeWorkers(state) <= 0) return state; // aucun bûcheron disponible à reconvertir
      return {
        ...state,
        workers: { ...state.workers, [action.job]: (state.workers[action.job] ?? 0) + 1 },
        rng: cloneRng(state.rng),
      };
    }

    case "UNASSIGN_WORKER": {
      const n = state.workers[action.job] ?? 0;
      if (n <= 0) return state;
      return {
        ...state,
        workers: { ...state.workers, [action.job]: n - 1 },
        rng: cloneRng(state.rng),
      };
    }

    // ---- M9 : exploration des mines & grottes (disposition/butin dérivés de la graine ; ICI on ne
    //      stocke que ce qui CHANGE — découverte / butin pris / mine sécurisée / grotte nettoyée). ----

    case "DISCOVER_SITE": {
      const key = siteKey(action.cx, action.cz);
      const prog = (state.sites ?? {})[key] ?? {};
      if (prog.discovered && prog.type) return state; // déjà connu -> no-op
      return {
        ...state,
        sites: { ...state.sites, [key]: { ...prog, type: prog.type ?? action.siteType, discovered: true } },
        rng: cloneRng(state.rng),
      };
    }

    case "TAKE_LOOT": {
      // Butin COMMUN à toute la carte : premier-servi. Si ce nœud est déjà pris -> no-op (l'hôte
      // arbitre l'ordre). Sinon, le contenu (dérivé de la graine) va dans le SAC, borné par la capacité.
      const pid = action.playerId;
      const key = siteKey(action.cx, action.cz);
      const prog = (state.sites ?? {})[key] ?? {};
      if (prog.taken?.[action.nodeId]) return state; // déjà ramassé par quelqu'un
      const loot = lootForNode(action.siteType, action.cx, action.cz, state.worldSeed, action.nodeId);
      if (Object.keys(loot).length === 0) return state; // rien à ramasser ici
      let room = carryCapacity(state) - carriedTotal(state, pid);
      if (room <= 0) return state; // sac plein -> on n'« épuise » pas le cache (on pourra revenir)
      const bag = { ...(state.carried[pid] ?? {}) };
      for (const r of Object.keys(loot)) {
        if (room <= 0) break;
        const add = Math.min(loot[r], room);
        bag[r] = (bag[r] ?? 0) + add;
        room -= add;
      }
      const taken = { ...(prog.taken ?? {}), [action.nodeId]: true };
      // Grotte ENTIÈREMENT vidée -> nettoyée (devient un avant-poste, cf. rendu R4). Usage unique.
      let cleared = prog.cleared ?? false;
      if (!cleared && action.siteType === "cave") {
        const ids = lootNodeIds(action.siteType, action.cx, action.cz, state.worldSeed);
        cleared = ids.length > 0 && ids.every((id) => taken[id]);
      }
      const lootSites = {
        ...state.sites,
        [key]: { ...prog, type: prog.type ?? action.siteType, discovered: true, taken, cleared },
      };
      // Grotte NOUVELLEMENT nettoyée (devient avant-poste) -> trace une route vers le réseau (fusion).
      const lootRoads = cleared && !prog.cleared ? drawRoad(state.roads, lootSites, action.cx, action.cz) : state.roads;
      return {
        ...state,
        carried: { ...state.carried, [pid]: bag },
        sites: lootSites,
        roads: lootRoads,
        rng: cloneRng(state.rng),
      };
    }

    case "CLEAR_HAZARD": {
      // Dégage un éboulement (v1 : sans coût ; le coût d'outil viendra en v3). Idempotent.
      const key = siteKey(action.cx, action.cz);
      const prog = (state.sites ?? {})[key] ?? {};
      if (prog.hazards?.[action.nodeId]) return state;
      return {
        ...state,
        sites: { ...state.sites, [key]: { ...prog, hazards: { ...(prog.hazards ?? {}), [action.nodeId]: true } } },
        rng: cloneRng(state.rng),
      };
    }

    case "SECURE_MINE": {
      // Sécuriser le filon SUFFIT à débloquer le métier (cf. garde ASSIGN_WORKER). Idempotent.
      // M8.5/F3.1 : il faut d'abord avoir VAINCU tous les gardiens scriptés (fidèle setpieces.js).
      const key = siteKey(action.cx, action.cz);
      const prog = (state.sites ?? {})[key] ?? {};
      if (prog.secured) return state;
      const guardians = mineGuardians[action.siteType];
      if (guardians && (prog.guardians ?? 0) < guardians.length) return state; // gardiens restants
      // Mine sécurisée : une route est tracée (fidèle ADR) MAIS la mine ne devient PAS un avant-poste.
      const mineSites = { ...state.sites, [key]: { ...prog, type: prog.type ?? action.siteType, discovered: true, secured: true } };
      return {
        ...state,
        sites: mineSites,
        roads: drawRoad(state.roads, mineSites, action.cx, action.cz),
        rng: cloneRng(state.rng),
      };
    }

    case "CLEAR_CAVE": {
      // Grotte entièrement nettoyée ⇒ se convertit en avant-poste (le rendu lit `cleared`). Idempotent.
      const key = siteKey(action.cx, action.cz);
      const prog = (state.sites ?? {})[key] ?? {};
      if (prog.cleared) return state;
      const caveSites = { ...state.sites, [key]: { ...prog, discovered: true, cleared: true } };
      return {
        ...state,
        sites: caveSites,
        roads: drawRoad(state.roads, caveSites, action.cx, action.cz), // avant-poste -> route (fusion)
        rng: cloneRng(state.rng),
      };
    }

    case "CRAFT_ITEM": {
      // Fabrique un OBJET : recette puisée dans l'ENTREPÔT. Destination selon le type (M10, fidèle
      // ADR) : un `upgrade` est une possession PERMANENTE du village -> crédité à l'ENTREPÔT (les
      // *stores* d'ADR, jamais perdu à la mort), max 1 ; les autres (arme/outil) vont au SAC
      // (l'outfit — perdus à la mort).
      const item = craftableItemById[action.itemId];
      if (!item) return state;
      if (item.building && (state.buildings[item.building] ?? 0) === 0) return state; // prérequis bâtiment
      const pid = action.playerId;
      if (item.maximum !== undefined) {
        const owned = item.type === "upgrade" ? stockOf(state, item.id) : carriedOf(state, pid, item.id);
        if (owned >= item.maximum) return state; // déjà possédé (upgrades ADR : max 1)
      }
      for (const r of Object.keys(item.recipe)) if (stockOf(state, r) < item.recipe[r]) return state; // ressources manquantes
      const resources = { ...state.resources };
      for (const r of Object.keys(item.recipe)) resources[r] = (resources[r] ?? 0) - item.recipe[r];
      if (item.type === "upgrade") {
        resources[item.id] = (resources[item.id] ?? 0) + 1; // -> entrepôt (possession du village)
        return { ...state, resources, rng: cloneRng(state.rng) };
      }
      if (carryCapacity(state) - carriedTotal(state, pid) <= 0) return state; // sac plein
      const bag = { ...(state.carried[pid] ?? {}) };
      bag[item.id] = (bag[item.id] ?? 0) + 1;
      return { ...state, resources, carried: { ...state.carried, [pid]: bag }, rng: cloneRng(state.rng) };
    }

    case "USE_OUTPOST": {
      // Reste M7 : se ravitailler à un AVANT-POSTE (grotte nettoyée). USAGE UNIQUE fidèle ADR,
      // partagé entre joueurs (premier-servi : l'hôte arbitre). Remplit eau + vivres du joueur
      // (les PV se soignent en mangeant — M8). Pas d'épuisement à vide : si tout est déjà plein,
      // no-op (on ne gaspille pas l'usage unique).
      const key = siteKey(action.cx, action.cz);
      const prog = (state.sites ?? {})[key];
      const pid = action.playerId;
      // M8.5/F4 : utilisable UNE FOIS PAR EXPÉDITION ET PAR JOUEUR (fidèle `usedOutposts` d'ADR,
      // remis à zéro au retour au village — cf. SET_OUTSIDE outside=false).
      if (!prog?.cleared || prog.usedBy?.[pid]) return state; // pas un avant-poste, ou déjà utilisé ce voyage
      const cur = state.survival[pid] ?? baseSurvival();
      const capW = maxWaterOf(state); // M10 : l'outre/baril/citerne agrandit le plein
      if (cur.water >= capW && cur.food >= MAX_FOOD) return state; // rien à remplir
      const rec: PlayerSurvival = {
        ...cur,
        water: capW,
        food: MAX_FOOD,
        // Ré-arme les échéances de drain (on repart « plein », pas à une échéance imminente).
        waterAt: state.tick + WATER_DRAIN_TICKS,
        foodAt: state.tick + FOOD_DRAIN_TICKS,
      };
      return {
        ...state,
        survival: { ...state.survival, [pid]: rec },
        sites: { ...state.sites, [key]: { ...prog, usedBy: { ...(prog.usedBy ?? {}), [pid]: true } } },
        rng: cloneRng(state.rng),
      };
    }

    case "BUY": {
      // M10 : POSTE DE TRAITE — achète UN bien (Room.TradeGoods d'ADR, coûts exacts). Coûts payés
      // à l'ENTREPÔT, gain à l'ENTREPÔT (borné par le plafond). Exige le bâtiment construit.
      const good = tradeGoodById[action.goodId];
      if (!good) return state;
      if ((state.buildings["trading post"] ?? 0) === 0) return state; // pas de poste de traite
      for (const r of Object.keys(good.cost)) if (stockOf(state, r) < good.cost[r]) return state; // fonds insuffisants
      const resources = { ...state.resources };
      for (const r of Object.keys(good.cost)) resources[r] = (resources[r] ?? 0) - good.cost[r];
      resources[good.id] = Math.min(storageCap(state.cabinTier, good.id), (resources[good.id] ?? 0) + 1);
      return { ...state, resources, rng: cloneRng(state.rng) };
    }

    case "USE_MEDS": {
      // M10 : se soigne avec une MÉDECINE du SAC (+20 PV, cap armure, cooldown 7 s — ADR exact).
      const pid = action.playerId;
      if (carriedOf(state, pid, "medicine") < 1) return state;
      const sv = state.survival[pid] ?? baseSurvival();
      const capHp = maxHealthOf(state);
      if (sv.health >= capHp) return state;
      if (state.tick < sv.medsReadyAt) return state;
      const bag = { ...(state.carried[pid] ?? {}) };
      bag["medicine"] -= 1;
      if (bag["medicine"] <= 0) delete bag["medicine"];
      const rec: PlayerSurvival = {
        ...sv,
        health: Math.min(capHp, sv.health + MEDS_HEAL),
        medsReadyAt: state.tick + MEDS_COOLDOWN_TICKS,
      };
      return {
        ...state,
        carried: { ...state.carried, [pid]: bag },
        survival: { ...state.survival, [pid]: rec },
        rng: cloneRng(state.rng),
      };
    }

    case "WITHDRAW": {
      // M10 : S'ÉQUIPER au coffre (l'outfitting d'ADR) — transfert ENTREPÔT -> SAC, borné par le
      // stock ET la capacité de portage. Réciproque de DEPOSIT.
      const pid = action.playerId;
      const want = Math.floor(action.amount);
      if (want <= 0) return state;
      const have = stockOf(state, action.resource);
      const room = carryCapacity(state) - carriedTotal(state, pid);
      const n = Math.min(want, have, room);
      if (n <= 0) return state;
      const resources = { ...state.resources, [action.resource]: have - n };
      const bag = { ...(state.carried[pid] ?? {}) };
      bag[action.resource] = (bag[action.resource] ?? 0) + n;
      return { ...state, resources, carried: { ...state.carried, [pid]: bag }, rng: cloneRng(state.rng) };
    }

    case "SET_OUTSIDE": {
      // M6/M7/M8 : l'état SPATIAL ABSTRAIT du joueur a changé (dehors, tier de danger, route).
      // Lazy-init de la survie à la 1ʳᵉ référence (plein). NO-OP si RIEN n'a changé (idempotent).
      // ⚠️ Les échéances de DRAIN ne sont (ré)armées QUE si `outside` a réellement basculé — un
      // changement de tier/route seul ne doit PAS réinitialiser les horloges de soif/faim (H1).
      const pid = action.playerId;
      const cur = state.survival[pid] ?? baseSurvival();
      const tier = action.tier ?? cur.tier;
      const onRoad = action.onRoad ?? cur.onRoad;
      if (state.survival[pid] && cur.outside === action.outside && cur.tier === tier && cur.onRoad === onRoad) return state;
      const rec: PlayerSurvival = { ...cur, outside: action.outside, tier, onRoad };
      let combat = state.combat;
      if (cur.outside !== action.outside || !state.survival[pid]) {
        if (action.outside) {
          // Sort dehors : (ré)arme les échéances de drain + repart de zéro pas (jamais de combat
          // avant FIGHT_DELAY pas de marche — fidèle à l'esprit du compteur d'ADR).
          rec.waterAt = state.tick + WATER_DRAIN_TICKS;
          rec.foodAt = state.tick + FOOD_DRAIN_TICKS;
          rec.healthAt = state.tick + HEALTH_DRAIN_TICKS;
          rec.fightSteps = 0;
        } else {
          // Rentre au camp : arme la recharge ; un combat en cours est ROMPU (désengagement).
          rec.waterAt = state.tick + RECHARGE_TICKS;
          rec.foodAt = state.tick + RECHARGE_TICKS;
          rec.healthAt = state.tick + RECHARGE_TICKS;
          if (combat[pid]) {
            const { [pid]: _gone, ...rest } = combat;
            combat = rest;
            rec.fightSteps = 0;
          }
        }
      }
      // M8.5/F4 — FIN D'EXPÉDITION : le retour au village « repose » les avant-postes de CE joueur
      // (fidèle ADR : `usedOutposts` est remis à zéro à chaque embarquement).
      let sites = state.sites;
      if (cur.outside && !action.outside) {
        let changed = false;
        const next: typeof sites = { ...sites };
        for (const k of Object.keys(sites)) {
          const sp = sites[k];
          if (sp.usedBy?.[pid]) {
            const { [pid]: _u, ...restUsed } = sp.usedBy;
            next[k] = { ...sp, usedBy: restUsed };
            changed = true;
          }
        }
        if (changed) sites = next;
      }
      return { ...state, survival: { ...state.survival, [pid]: rec }, combat, sites, rng: cloneRng(state.rng) };
    }

    case "VISIT_HOUSE": {
      // M8.5/F3.3 — fidèle au setpiece `house` d'ADR : tirage 25 % médecine ×2–4 / 25 % vivres +
      // EAU REMPLIE / 50 % SQUATTEUR embusqué (combat). One-shot (`visited` = markVisited).
      const pid = action.playerId;
      const key = siteKey(action.cx, action.cz);
      const prog = (state.sites ?? {})[key] ?? {};
      if (prog.visited) return state; // déjà fouillée
      if (state.combat[pid]) return state;
      const rng = cloneRng(state.rng);
      const sites = { ...state.sites, [key]: { ...prog, type: prog.type ?? "house", discovered: true, visited: true } };
      const roll = nextFloat(rng);
      const sv = state.survival[pid] ?? baseSurvival();
      if (roll < 0.25) {
        // Une armoire à pharmacie oubliée : médecine 2–4 (tirage min..max-1 de 2–5, fidèle).
        const n = 2 + nextInt(rng, 3);
        const room = carryCapacity(state) - carriedTotal(state, pid);
        const bag = { ...(state.carried[pid] ?? {}) };
        bag["medicine"] = (bag["medicine"] ?? 0) + Math.max(0, Math.min(n, room));
        if (bag["medicine"] === 0) delete bag["medicine"];
        return { ...state, sites, carried: { ...state.carried, [pid]: bag }, rng };
      }
      if (roll < 0.5) {
        // Des réserves… et un puits encore bon : EAU REMPLIE (fidèle setWater(getMaxWater())).
        const rec: PlayerSurvival = { ...sv, water: maxWaterOf(state) };
        let room = carryCapacity(state) - carriedTotal(state, pid);
        const bag = { ...(state.carried[pid] ?? {}) };
        const TABLE: Array<[string, number, number, number]> = [["cured meat", 0.8, 1, 10], ["cloth", 0.5, 1, 10], ["leather", 0.2, 1, 10]];
        for (const [res, chance, min, max] of TABLE) {
          if (nextFloat(rng) >= chance) continue;
          const n = Math.min(min + nextInt(rng, Math.max(1, max - min)), room);
          if (n <= 0) continue;
          bag[res] = (bag[res] ?? 0) + n;
          room -= n;
        }
        return { ...state, sites, carried: { ...state.carried, [pid]: bag }, survival: { ...state.survival, [pid]: rec }, rng };
      }
      // 50 % : la maison est OCCUPÉE — un squatteur charge, lame rouillée au poing.
      const enemy = enemyById["squatter"];
      const rec: PlayerSurvival = { ...sv, encounterSeq: sv.encounterSeq + 1 };
      const enc: Encounter = {
        enemyId: enemy.id,
        enemyHp: enemy.hp,
        enemyNextAt: state.tick + Math.round(enemy.strikeSeconds * HZ),
        weaponReadyAt: {},
        seq: rec.encounterSeq,
      };
      return { ...state, sites, combat: { ...state.combat, [pid]: enc }, survival: { ...state.survival, [pid]: rec }, rng };
    }

    case "TALK_SWAMP": {
      // M8.5/F3.4 — fidèle au setpiece `swamp` : offrir 1 CHARME (du sac) au vieil ermite ⇒ perk
      // « gastronome » (viande ×2). One-shot.
      const pid = action.playerId;
      const key = siteKey(action.cx, action.cz);
      const prog = (state.sites ?? {})[key] ?? {};
      if (prog.visited || state.perks["gastronome"]) return state;
      if (carriedOf(state, pid, "charm") < 1) return state; // il veut un charme
      const bag = { ...(state.carried[pid] ?? {}) };
      bag["charm"] -= 1;
      if (bag["charm"] <= 0) delete bag["charm"];
      return {
        ...state,
        carried: { ...state.carried, [pid]: bag },
        perks: { ...state.perks, gastronome: true },
        sites: { ...state.sites, [key]: { ...prog, type: prog.type ?? "swamp", discovered: true, visited: true } },
        rng: cloneRng(state.rng),
      };
    }

    case "STEPS": {
      // M8.5/F1 — fidèle `checkFight` d'ADR : pour CHAQUE pas parcouru, incrémente le compteur ;
      // au-delà de FIGHT_DELAY (3), tirage FIGHT_CHANCE ; succès -> compteur remis à zéro et
      // rencontre tirée dans la table (tier × biome). Sur ROUTE : le pool est vide (fidèle —
      // aucune rencontre n'y est éligible) mais le tirage est dépensé. Immobile = jamais appelé.
      const pid = action.playerId;
      const sv = state.survival[pid];
      if (!sv || !sv.outside || state.tick < sv.respawnReadyAt) return state;
      if (state.combat[pid]) return state; // déjà en combat
      const n = Math.max(1, Math.min(MAX_STEPS_PER_ACTION, Math.floor(action.n)));
      let fightSteps = sv.fightSteps;
      let rng = state.rng;
      let encounter: Encounter | null = null;
      let encounterSeq = sv.encounterSeq;
      for (let i = 0; i < n; i++) {
        fightSteps++;
        if (fightSteps <= FIGHT_DELAY_STEPS) continue;
        rng = rng === state.rng ? cloneRng(state.rng) : rng;
        if (!stepFightTriggers(rng, action.tier)) continue;
        fightSteps = 0; // tirage réussi : compteur remis à zéro MÊME si le pool est vide (fidèle)
        const enemy = action.onRoad ? null : pickEnemy(rng, action.tier, action.biome);
        if (!enemy) continue;
        encounterSeq++;
        encounter = {
          enemyId: enemy.id,
          enemyHp: enemy.hp,
          enemyNextAt: state.tick + Math.round(enemy.strikeSeconds * HZ),
          weaponReadyAt: {},
          seq: encounterSeq,
        };
        break; // en combat : les pas restants sont abandonnés
      }
      if (fightSteps === sv.fightSteps && !encounter) return state; // rien n'a changé
      const rec: PlayerSurvival = { ...sv, fightSteps, encounterSeq };
      return {
        ...state,
        survival: { ...state.survival, [pid]: rec },
        combat: encounter ? { ...state.combat, [pid]: encounter } : state.combat,
        rng: rng === state.rng ? cloneRng(state.rng) : rng,
      };
    }

    case "ENGAGE_GUARDIAN": {
      // M8.5/F3.1 — provoque le combat contre le PROCHAIN gardien scripté de la mine (setpiece).
      const pid = action.playerId;
      if (state.combat[pid]) return state;
      const list = mineGuardians[action.siteType];
      if (!list) return state;
      const key = siteKey(action.cx, action.cz);
      const prog = (state.sites ?? {})[key] ?? {};
      const idx = prog.guardians ?? 0;
      if (idx >= list.length) return state; // tous vaincus
      const enemy = enemyById[list[idx]];
      if (!enemy) return state;
      const sv = state.survival[pid] ?? baseSurvival();
      const rec: PlayerSurvival = { ...sv, encounterSeq: sv.encounterSeq + 1 };
      const enc: Encounter = {
        enemyId: enemy.id,
        enemyHp: enemy.hp,
        enemyNextAt: state.tick + Math.round(enemy.strikeSeconds * HZ),
        weaponReadyAt: {},
        seq: rec.encounterSeq,
        siteKey: key,
        siteType: action.siteType,
        guardianIdx: idx,
      };
      return {
        ...state,
        combat: { ...state.combat, [pid]: enc },
        survival: { ...state.survival, [pid]: rec },
        sites: { ...state.sites, [key]: { ...prog, type: prog.type ?? action.siteType, discovered: true } },
        rng: cloneRng(state.rng),
      };
    }

    case "ATTACK": {
      // M8 : frappe l'ennemi de SA rencontre. Guards : rencontre active, arme connue & possédée
      // (poings toujours), cooldown de L'ARME écoulé. Chance de toucher (défaut ADR 0.8) via le
      // RNG à graine. À 0 PV ennemi : VICTOIRE — butin (tirages ADR) au SAC borné, `winSeq`++.
      const pid = action.playerId;
      const enc = state.combat[pid];
      if (!enc) return state;
      const weapon = weaponById[action.weapon];
      if (!weapon) return state;
      if (!ownsWeapon(state, pid, weapon.id)) return state;
      if (!hasAmmo(state, pid, weapon)) return state; // fusil sans balle / sans grenade (M10)
      if (state.tick < (enc.weaponReadyAt[weapon.id] ?? 0)) return state; // l'arme recharge
      const rng = cloneRng(state.rng);
      // Munition consommée À CHAQUE tir (touché ou non — fidèle ADR), depuis le SAC.
      let carriedAfter = state.carried;
      if (weapon.ammo) {
        const bag0 = { ...(state.carried[pid] ?? {}) };
        bag0[weapon.ammo] -= 1;
        if (bag0[weapon.ammo] <= 0) delete bag0[weapon.ammo];
        carriedAfter = { ...state.carried, [pid]: bag0 };
      }
      const hit = nextFloat(rng) < playerHit(state.perks);
      const enemyHp = hit ? enc.enemyHp - attackDamage(weapon, state.perks) : enc.enemyHp;
      if (enemyHp > 0) {
        const nextEnc: Encounter = {
          ...enc,
          enemyHp,
          weaponReadyAt: { ...enc.weaponReadyAt, [weapon.id]: state.tick + Math.round(weapon.cooldownSeconds * HZ) },
        };
        return { ...state, carried: carriedAfter, combat: { ...state.combat, [pid]: nextEnc }, rng };
      }
      // VICTOIRE : butin de l'ennemi -> SAC (borné, boucle clamp de TAKE_LOOT) ; rencontre fermée.
      const enemy = enemyById[enc.enemyId];
      const loot = enemy ? rollEnemyLoot(rng, enemy) : {};
      let bagTotal = 0;
      for (const k of Object.keys(carriedAfter[pid] ?? {})) bagTotal += carriedAfter[pid][k];
      let room = carryCapacity(state) - bagTotal;
      const bag = { ...(carriedAfter[pid] ?? {}) };
      for (const r of Object.keys(loot)) {
        if (room <= 0) break;
        const add = Math.min(loot[r], room);
        bag[r] = (bag[r] ?? 0) + add;
        room -= add;
      }
      const { [pid]: _won, ...restCombat } = state.combat;
      const sv = state.survival[pid] ?? baseSurvival();
      const rec: PlayerSurvival = { ...sv, winSeq: sv.winSeq + 1, fightSteps: 0 };
      // M8.5/F3.1 : victoire sur un GARDIEN de mine -> progression de la séquence scriptée.
      let sites = state.sites;
      if (enc.siteKey !== undefined && enc.guardianIdx !== undefined) {
        const prog = (state.sites ?? {})[enc.siteKey] ?? {};
        if ((prog.guardians ?? 0) === enc.guardianIdx) {
          sites = { ...state.sites, [enc.siteKey]: { ...prog, guardians: enc.guardianIdx + 1 } };
        }
      }
      return {
        ...state,
        carried: { ...carriedAfter, [pid]: bag },
        combat: restCombat,
        survival: { ...state.survival, [pid]: rec },
        sites,
        rng,
      };
    }

    case "EAT_MEAT": {
      // M8 : mange une viande séchée du SAC -> +PV (cap), cooldown anti-spam (EAT_COOLDOWN d'ADR).
      const pid = action.playerId;
      if (carriedOf(state, pid, "cured meat") < 1) return state;
      const sv = state.survival[pid] ?? baseSurvival();
      const capHp = maxHealthOf(state); // M10 : la meilleure ARMURE de l'entrepôt fixe les PV max
      if (sv.health >= capHp) return state; // déjà plein -> on ne gaspille pas
      if (state.tick < sv.eatReadyAt) return state; // trop tôt
      const bag = { ...(state.carried[pid] ?? {}) };
      bag["cured meat"] -= 1;
      if (bag["cured meat"] <= 0) delete bag["cured meat"];
      const heal = state.perks["gastronome"] ? EAT_MEAT_HEAL * 2 : EAT_MEAT_HEAL; // gastronome : viande ×2
      const rec: PlayerSurvival = {
        ...sv,
        health: Math.min(capHp, sv.health + heal),
        eatReadyAt: state.tick + EAT_COOLDOWN_TICKS,
      };
      return {
        ...state,
        carried: { ...state.carried, [pid]: bag },
        survival: { ...state.survival, [pid]: rec },
        rng: cloneRng(state.rng),
      };
    }

    case "FLEE": {
      // M8 : rompt la rencontre (désengagement « physique » du monde continu — adaptation : ADR
      // n'a pas de bouton fuir, le retrait sera affiné en F4). Le DERNIER gardien d'une mine est
      // SANS échappatoire (fidèle « no run button » du chef/vétéran/matriarche).
      const pid = action.playerId;
      const enc = state.combat[pid];
      if (!enc) return state;
      if (enc.guardianIdx !== undefined && enc.siteType) {
        const list = mineGuardians[enc.siteType] ?? [];
        if (enc.guardianIdx >= list.length - 1) return state; // dernier gardien : pas de fuite
      }
      const { [pid]: _fled, ...rest } = state.combat;
      const sv = state.survival[pid] ?? baseSurvival();
      const rec: PlayerSurvival = { ...sv, fightSteps: 0 };
      return { ...state, combat: rest, survival: { ...state.survival, [pid]: rec }, rng: cloneRng(state.rng) };
    }

    case "DEBUG_START_ENCOUNTER": {
      // Force une rencontre (test/e2e) — `enemyHp` optionnel (raccourci « ennemi à 1 PV »).
      const pid = action.playerId;
      const enemy = enemyById[action.enemyId ?? "snarling beast"];
      if (!enemy || state.combat[pid]) return state;
      const sv = state.survival[pid] ?? baseSurvival();
      const rec: PlayerSurvival = { ...sv, encounterSeq: sv.encounterSeq + 1 };
      const enc: Encounter = {
        enemyId: enemy.id,
        enemyHp: action.enemyHp ?? enemy.hp,
        enemyNextAt: state.tick + Math.round(enemy.strikeSeconds * HZ),
        weaponReadyAt: {},
        seq: rec.encounterSeq,
      };
      return {
        ...state,
        combat: { ...state.combat, [pid]: enc },
        survival: { ...state.survival, [pid]: rec },
        rng: cloneRng(state.rng),
      };
    }

    case "RESOLVE_EVENT_CHOICE": {
      if (!state.activeEvent) return state;
      const ev = eventById[state.activeEvent.id];
      const scene = ev?.scenes[state.activeEvent.scene];
      if (!ev || !scene) return state;
      const choice = scene.choices.find((c) => c.id === action.choice);
      if (!choice) return state;
      if (choice.available && !choice.available(state)) return state;
      // Le coût est payé depuis l'ENTREPÔT (gestion village) ; `costCarried` depuis le SAC du
      // joueur qui résout (M10 — ex. la torche du Maître, fidèle ADR).
      if (choice.cost) {
        for (const r of Object.keys(choice.cost)) {
          if (stockOf(state, r) < choice.cost[r]) return state; // pas les moyens -> no-op
        }
      }
      if (choice.costCarried) {
        for (const r of Object.keys(choice.costCarried)) {
          if (carriedOf(state, action.playerId, r) < choice.costCarried[r]) return state; // pas dans le sac
        }
      }
      const rng = cloneRng(state.rng);
      const draft: EffectDraft = {
        resources: { ...state.resources },
        buildings: { ...state.buildings },
        population: state.population,
        workers: { ...state.workers },
        pendingEffects: [...state.pendingEffects],
        tick: state.tick,
        cabinTier: state.cabinTier,
        perks: { ...state.perks },
      };
      if (choice.cost) for (const r of Object.keys(choice.cost)) draft.resources[r] = (draft.resources[r] ?? 0) - choice.cost[r];
      if (choice.reward) addStores(draft.resources, choice.reward, state.cabinTier);
      // Débit du SAC (costCarried) — hors draft (le sac n'y vit pas) : appliqué au retour.
      let carriedOut = state.carried;
      if (choice.costCarried) {
        const bag = { ...(state.carried[action.playerId] ?? {}) };
        for (const r of Object.keys(choice.costCarried)) {
          bag[r] -= choice.costCarried[r];
          if (bag[r] <= 0) delete bag[r];
        }
        carriedOut = { ...state.carried, [action.playerId]: bag };
      }

      let activeEvent: GameState["activeEvent"] = state.activeEvent;
      let eventScheduledAt = state.eventScheduledAt;
      const next = choice.next;
      if (next === "end") {
        activeEvent = null; // fin de l'événement
        // Replanifie le PROCHAIN événement à partir de MAINTENANT (résolution), pas du déclenchement :
        // dismisser un événement (même après une longue absence) laisse un délai PLEIN avant le suivant
        // -> jamais de « rafale » d'événements en retard à la chaîne.
        eventScheduledAt = state.tick + Math.max(1, Math.floor(eventIntervalSeconds(rng) * HZ));
      } else if (typeof next === "string") {
        const target = ev.scenes[next];
        activeEvent = { id: ev.id, scene: next };
        if (target?.onLoad) applyEffect(draft, target.onLoad, rng);
      } else if (next) {
        const targetId = pickWeighted(next, nextFloat(rng));
        const target = ev.scenes[targetId];
        activeEvent = { id: ev.id, scene: targetId };
        if (target?.onLoad) applyEffect(draft, target.onLoad, rng);
      }
      // next absent (undefined) -> on RESTE sur la même scène (boutique) : activeEvent inchangé.
      return {
        ...state,
        resources: draft.resources,
        buildings: draft.buildings,
        population: draft.population,
        workers: draft.workers,
        pendingEffects: draft.pendingEffects,
        perks: draft.perks,
        carried: carriedOut,
        activeEvent,
        eventScheduledAt,
        rng,
      };
    }

    case "DEBUG_TRIGGER_EVENT": {
      // DEBUG (e2e) : force un événement par id (hors réseau, pas dans PlayerAction).
      const ev = eventById[action.id];
      if (!ev || state.activeEvent) return state;
      const rng = cloneRng(state.rng);
      const draft: EffectDraft = {
        resources: { ...state.resources },
        buildings: { ...state.buildings },
        population: state.population,
        workers: { ...state.workers },
        pendingEffects: [...state.pendingEffects],
        tick: state.tick,
        cabinTier: state.cabinTier,
        perks: { ...state.perks },
      };
      const start = ev.scenes["start"];
      if (start?.onLoad) applyEffect(draft, start.onLoad, rng);
      return {
        ...state,
        resources: draft.resources,
        buildings: draft.buildings,
        population: draft.population,
        workers: draft.workers,
        pendingEffects: draft.pendingEffects,
        activeEvent: { id: ev.id, scene: "start" },
        rng,
      };
    }

    // ---- DEBUG : commandes de la console dev (src/dev/). PURES & bornées. ----
    case "DEBUG_GRANT":
    case "DEBUG_SET": {
      const { playerId, target, resource } = action;
      const set = action.type === "DEBUG_SET";
      if (target === "storage") {
        const cur = state.resources[resource] ?? 0;
        const v = Math.max(0, set ? action.amount : cur + action.amount);
        return { ...state, resources: { ...state.resources, [resource]: v }, rng: cloneRng(state.rng) };
      }
      const bag = { ...(state.carried[playerId] ?? {}) };
      const cur = bag[resource] ?? 0;
      bag[resource] = Math.max(0, set ? action.amount : cur + action.amount);
      return { ...state, carried: { ...state.carried, [playerId]: bag }, rng: cloneRng(state.rng) };
    }

    case "DEBUG_CLEAR": {
      if (action.target === "storage") return { ...state, resources: {}, rng: cloneRng(state.rng) };
      return { ...state, carried: { ...state.carried, [action.playerId]: {} }, rng: cloneRng(state.rng) };
    }

    case "DEBUG_SET_FIRE": {
      const level = Math.max(Fire.Dead, Math.min(Fire.Roaring, Math.floor(action.level)));
      return { ...state, fire: level, fireCoolAt: state.tick + FIRE_COOL_TICKS, rng: cloneRng(state.rng) };
    }

    case "DEBUG_SET_BUILDER": {
      const stage = Math.max(BUILDER_ABSENT, Math.min(BUILDER_MAX, Math.floor(action.stage)));
      return { ...state, builder: stage, builderAdvanceAt: state.tick + BUILDER_ADVANCE_TICKS, rng: cloneRng(state.rng) };
    }

    case "DEBUG_ADD_POP": {
      const population = Math.max(0, state.population + Math.floor(action.n));
      const draft: EffectDraft = {
        resources: { ...state.resources }, buildings: { ...state.buildings },
        population, workers: { ...state.workers }, pendingEffects: [...state.pendingEffects], tick: state.tick, cabinTier: state.cabinTier,
        perks: { ...state.perks },
      };
      trimWorkersToPopulation(draft); // si réduction : ramène les ouvriers spécialisés
      return { ...state, population, workers: draft.workers, rng: cloneRng(state.rng) };
    }

    case "DEBUG_BUILD": {
      const c = craftableById[action.id];
      if (!c) return state;
      const count = state.buildings[action.id] ?? 0;
      const next = Math.max(0, Math.min(c.maximum, count + Math.floor(action.count)));
      return { ...state, buildings: { ...state.buildings, [action.id]: next }, rng: cloneRng(state.rng) };
    }

    case "DEBUG_UNLOCK_ALL": {
      const buildings = { ...state.buildings };
      for (const c of craftables) buildings[c.id] = Math.max(buildings[c.id] ?? 0, 1);
      return { ...state, cabinRepaired: true, cabinTier: Math.max(state.cabinTier, 1), builder: BUILDER_MAX, buildings, rng: cloneRng(state.rng) };
    }

    case "DEBUG_SET_SEED": {
      // La graine du monde est autoritaire ; la régénération de la carte est gérée côté rendu.
      return { ...state, worldSeed: action.seed >>> 0, rng: cloneRng(state.rng) };
    }

    case "DEBUG_SET_CABIN_TIER": {
      // Fixe le palier (0/1/5/10) ; `cabinRepaired` est dérivé (>= 1). Console dev.
      const tier = action.tier;
      return { ...state, cabinTier: tier, cabinRepaired: tier >= 1, rng: cloneRng(state.rng) };
    }

    case "DEBUG_SET_SURVIVAL": {
      // Fixe les jauges de survie d'un joueur (test de la mort sans attendre). Console dev / e2e.
      const pid = action.playerId;
      const cur = state.survival[pid] ?? baseSurvival();
      const rec: PlayerSurvival = {
        ...cur,
        water: action.water ?? cur.water,
        food: action.food ?? cur.food,
        health: action.health ?? cur.health,
      };
      return { ...state, survival: { ...state.survival, [pid]: rec }, rng: cloneRng(state.rng) };
    }

    case "TICK": {
      const tick = state.tick + 1;

      // 0) CHANTIERS : la file avance. Le chantier de tête s'achève à son échéance ->
      //    le bâtiment compte enfin dans `buildings`, on retire la tête et le suivant DÉMARRE
      //    (séquentiel : un seul chantier actif). Déterministe (échéances en tics).
      let buildings = state.buildings;
      let constructing = state.constructing;
      while (constructing.length > 0 && constructing[0].doneAt > 0 && tick >= constructing[0].doneAt) {
        const head = constructing[0];
        buildings = { ...buildings, [head.id]: (buildings[head.id] ?? 0) + 1 };
        const rest = constructing.slice(1);
        // Le nouveau chantier de tête démarre maintenant (doneAt calé sur ce tic).
        constructing = rest.length > 0 ? [{ id: rest[0].id, doneAt: tick + buildTicks(rest[0].id) }, ...rest.slice(1)] : rest;
      }

      // 1) Le feu refroidit d'un cran à échéance.
      let fire = state.fire;
      let fireCoolAt = state.fireCoolAt;
      if (fire > Fire.Dead && tick >= fireCoolAt) {
        fire -= 1;
        fireCoolAt = tick + FIRE_COOL_TICKS;
      }

      // 2) La température se rapproche d'un pas du niveau du feu.
      let temperature = state.temperature;
      let tempAdjustAt = state.tempAdjustAt;
      if (tick >= tempAdjustAt) {
        if (temperature < fire) temperature += 1;
        else if (temperature > fire) temperature -= 1;
        temperature = Math.max(Temp.Freezing, Math.min(Temp.Hot, temperature));
        tempAdjustAt = tick + TEMP_ADJUST_TICKS;
      }

      // 3) L'étrangère apparaît dès que le feu est suffisant, puis progresse tant
      //    qu'on entretient le feu (incite à le garder vivant).
      let builder = state.builder;
      let builderAdvanceAt = state.builderAdvanceAt;
      if (builder === BUILDER_ABSENT && fire >= BUILDER_APPEAR_FIRE) {
        builder = 0;
        builderAdvanceAt = tick + BUILDER_ADVANCE_TICKS;
      } else if (builder >= 0 && builder < BUILDER_MAX && fire > Fire.Dead && tick >= builderAdvanceAt) {
        builder += 1;
        builderAdvanceAt = tick + BUILDER_ADVANCE_TICKS;
      }

      // 4) Population : un villageois arrive à échéance si une hutte a de la place.
      //    L'intervalle est tiré via le RNG à graine -> reproductible (P2P).
      let rng = state.rng;
      let population = state.population;
      let popGrowAt = state.popGrowAt;
      const maxPop = (buildings["hut"] ?? 0) * HUT_ROOM;
      if (tick >= popGrowAt) {
        if (population < maxPop) population += 1;
        rng = cloneRng(state.rng);
        const interval = POP_MIN_S + nextFloat(rng) * (POP_MAX_S - POP_MIN_S);
        popGrowAt = tick + Math.max(1, Math.floor(interval * HZ));
      }

      // 5) Revenus des métiers (toutes les INCOME_TICKS) — TOUT-OU-RIEN par métier, fidèle à
      //    A Dark Room : si un intrant manquerait, le métier CHÔME (ni conso ni prod). Les
      //    stocks ne deviennent jamais négatifs, et AUCUN villageois ne meurt ici
      //    (la mort viendra des événements, M5). On note les métiers qui ont produit.
      let resources = state.resources;
      let incomeAt = state.incomeAt;
      let producing = state.producing;
      if (tick >= incomeAt) {
        incomeAt = tick + INCOME_TICKS;
        const res: Record<string, number> = { ...state.resources };
        const prod: Record<string, boolean> = {};
        // Bûcherons = villageois non spécialisés (le « reste »). Occupation par défaut (ADR).
        const specialized = sumWorkers(state.workers) - (state.workers["gatherer"] ?? 0);
        const gatherers = Math.max(0, population - specialized);
        for (const job of jobs) {
          const n = job.id === "gatherer" ? gatherers : state.workers[job.id] ?? 0;
          if (n <= 0) continue;
          const affordable = Object.keys(job.stores).every((s) => (res[s] ?? 0) + job.stores[s] * n >= 0);
          if (!affordable) continue; // le métier chôme ce cycle
          // Production bornée au plafond de l'entrepôt (consommation < cap -> min() neutre).
          for (const s of Object.keys(job.stores)) res[s] = Math.min(storageCap(state.cabinTier, s), (res[s] ?? 0) + job.stores[s] * n);
          prod[job.id] = true;
        }
        resources = res;
        producing = prod;
      }

      // 5b) ENTRETIEN DU FEU par la constructrice (une fois la cabane réparée : elle y « vit »).
      //     FILET DE SÉCURITÉ déterministe : si le feu est tombé bas (mais vivant) et qu'il reste
      //     du bois dans l'ENTREPÔT, elle ré-attise (effet réel, distinct du STOKE manuel du joueur).
      //     Seuil bas + long cooldown -> ne remplace pas le joueur ; puise dans l'entrepôt -> vraie
      //     pression sur la réserve de bois. `builderTendingUntil` ouvre la fenêtre d'animation (rendu).
      let builderTendReadyAt = state.builderTendReadyAt;
      let builderTendingUntil = state.builderTendingUntil;
      if (
        state.cabinRepaired &&
        fire > Fire.Dead && fire <= TEND_THRESHOLD &&
        tick >= builderTendReadyAt &&
        (resources["wood"] ?? 0) >= TEND_WOOD_COST
      ) {
        // Cible ALÉATOIRE (RNG à graine -> déterministe) : « ardent » d'habitude, parfois « rugissant ».
        rng = rng === state.rng ? cloneRng(state.rng) : rng;
        const desired = nextFloat(rng) < TEND_ROARING_CHANCE ? Fire.Roaring : TEND_TARGET;
        const wood = resources["wood"] ?? 0;
        const target = Math.min(desired, fire + Math.floor(wood / TEND_WOOD_COST), Fire.Roaring);
        if (target > fire) {
          const need = (target - fire) * TEND_WOOD_COST; // coût proportionnel aux crans regagnés
          fire = target;
          fireCoolAt = tick + FIRE_COOL_TICKS;
          resources = { ...resources, wood: Math.max(0, wood - need) };
          builderTendReadyAt = tick + TEND_COOLDOWN_TICKS;
          builderTendingUntil = tick + TEND_WALK_TICKS;
        }
      }

      // 6) Événements (M5) : ordonnanceur sur tic (calqué sur popGrowAt) + effets différés.
      //    Tourne côté AUTORITÉ (l'hôte avance le temps) -> les deux joueurs vivent le même
      //    événement. On travaille sur les valeurs POST-income (resources/population à jour).
      let activeEvent = state.activeEvent;
      let eventScheduledAt = state.eventScheduledAt;
      let pendingEffects = state.pendingEffects;
      let workers = state.workers;
      let perksOut = state.perks;
      // `buildings` est déclaré plus haut (avance des chantiers) ; les événements peuvent le modifier.

      const pendingDue = pendingEffects.length > 0 && pendingEffects.some((p) => p.at <= tick);
      const canTrigger = activeEvent === null && (eventScheduledAt === 0 || tick >= eventScheduledAt);
      if (pendingDue || canTrigger) {
        rng = rng === state.rng ? cloneRng(state.rng) : rng; // s'assurer qu'on possède notre RNG
        const draft: EffectDraft = {
          resources: { ...resources },
          buildings: { ...buildings },
          population,
          workers: { ...workers },
          pendingEffects: [...pendingEffects],
          tick,
          cabinTier: state.cabinTier,
          perks: { ...state.perks },
        };

        // a) Drainer les effets différés échus (ex. retour du marchand).
        if (pendingDue) {
          const remaining: typeof draft.pendingEffects = [];
          for (const p of draft.pendingEffects) {
            if (p.at <= tick) addStores(draft.resources, p.stores, state.cabinTier);
            else remaining.push(p);
          }
          draft.pendingEffects = remaining;
        }

        // b) Amorcer / déclencher un événement.
        if (canTrigger) {
          if (eventScheduledAt === 0) {
            // 1ère planification (ou save d'avant M5) : on programme SANS déclencher tout de suite.
            eventScheduledAt = tick + Math.max(1, Math.floor(eventIntervalSeconds(rng) * HZ));
          } else {
            const probe: GameState = {
              ...state, tick, resources: draft.resources, population: draft.population,
              buildings: draft.buildings, workers: draft.workers,
            };
            const candidates = events.filter((e) => e.isAvailable(probe));
            if (candidates.length === 0) {
              // Aucun éligible -> on re-tente plus tôt (× scale), comme ADR.
              eventScheduledAt = tick + Math.max(1, Math.floor(eventIntervalSeconds(rng) * EV_EMPTY_SCALE * HZ));
            } else {
              const e = candidates[nextInt(rng, candidates.length)];
              activeEvent = { id: e.id, scene: "start" };
              const start = e.scenes["start"];
              if (start.onLoad) applyEffect(draft, start.onLoad, rng);
              eventScheduledAt = tick + Math.max(1, Math.floor(eventIntervalSeconds(rng) * HZ));
            }
          }
        }

        resources = draft.resources;
        buildings = draft.buildings;
        population = draft.population;
        workers = draft.workers;
        pendingEffects = draft.pendingEffects;
        perksOut = draft.perks;
      }

      // 7) SURVIE (M6/M7) : par joueur, PAR TEMPS passé DEHORS (pas par case). DEHORS : l'eau puis les
      //    vivres se vident ; à sec des DEUX, la santé baisse (plancher 0 — la MORT est tranchée par
      //    le balayage UNIFIÉ 8c, commun soif/combat). DEDANS : recharge vers le max. Cette phase ne
      //    consomme AUCUN RNG ; le tri reste défensif ici (il devient PORTEUR en 8a/8b).
      let survival = state.survival;
      let carried = state.carried;
      let combat = state.combat;
      const capWater = maxWaterOf(state); // M10 : caps d'équipement (entrepôt, communs)
      const capHp = maxHealthOf(state);
      const survIds = Object.keys(state.survival).sort();
      if (survIds.length > 0) {
        const nextSurv: Record<string, PlayerSurvival> = { ...state.survival };
        let survMutated = false;
        for (const pid of survIds) {
          const s0 = state.survival[pid];
          let { water, food, health, waterAt, foodAt, healthAt } = s0;
          const { outside, respawnReadyAt } = s0;
          let dirty = false;

          if (outside && tick >= respawnReadyAt) {
            if (water > 0 && tick >= waterAt) { water -= 1; waterAt = tick + WATER_DRAIN_TICKS; dirty = true; }
            if (food > 0 && tick >= foodAt) {
              food -= 1; foodAt = tick + FOOD_DRAIN_TICKS; dirty = true;
              // M8.5/F4 — fidèle `useSupplies` d'ADR : manger en voyage SOIGNE (+8, gastronome ×2).
              const heal = state.perks["gastronome"] ? EAT_MEAT_HEAL * 2 : EAT_MEAT_HEAL;
              health = Math.min(capHp, health + heal);
            }
            // À sec d'eau ET de vivres : la santé décline (plancher 0 ; mort en 8c).
            if (water === 0 && food === 0 && health > 0 && tick >= healthAt) { health -= 1; healthAt = tick + HEALTH_DRAIN_TICKS; dirty = true; }
          } else if (!outside && tick >= waterAt && (water < capWater || food < MAX_FOOD || health < capHp)) {
            // DEDANS : recharge cadencée (waterAt sert d'horloge unique) — caps M10 (outre/armure).
            if (water < capWater) water += 1;
            if (food < MAX_FOOD) food += 1;
            if (health < capHp) health += 1;
            waterAt = tick + RECHARGE_TICKS; foodAt = tick + RECHARGE_TICKS; healthAt = tick + RECHARGE_TICKS;
            dirty = true;
          }

          if (dirty) { nextSurv[pid] = { ...s0, water, food, health, waterAt, foodAt, healthAt }; survMutated = true; }
        }
        if (survMutated) survival = nextSurv;
      }

      // (8a — le DÉCLENCHEMENT des rencontres n'est PLUS temporel : il vit dans l'action STEPS,
      //  par PAS de déplacement, fidèle au `checkFight` d'ADR — cf. M8.5/F1.)

      // 8b) COMBAT — FRAPPES ENNEMIES : à l'échéance `enemyNextAt`, tirage de toucher (par ennemi,
      //     comme ADR) -> dégâts sur la santé (plancher 0 ; mort en 8c). Tri PORTEUR (RNG).
      {
        const ids = Object.keys(combat).sort();
        let nextSurv: Record<string, PlayerSurvival> | null = null;
        let nextCombat: Record<string, Encounter> | null = null;
        for (const pid of ids) {
          const enc = (nextCombat ?? combat)[pid];
          const sv = (nextSurv ?? survival)[pid];
          if (!sv || tick < enc.enemyNextAt) continue;
          const enemy = enemyById[enc.enemyId];
          if (!enemy) continue;
          rng = rng === state.rng ? cloneRng(state.rng) : rng;
          nextCombat = nextCombat ?? { ...combat };
          nextCombat[pid] = { ...enc, enemyNextAt: tick + Math.round(enemy.strikeSeconds * HZ) };
          if (nextFloat(rng) < enemyHit(enemy.hit, state.perks)) {
            nextSurv = nextSurv ?? { ...survival };
            nextSurv[pid] = { ...sv, health: Math.max(0, sv.health - enemy.damage) };
          }
        }
        if (nextSurv) survival = nextSurv;
        if (nextCombat) combat = nextCombat;
      }

      // 8c) MORT — balayage UNIFIÉ (soif ET combat) : dehors, hors grâce, 0 PV -> record neuf
      //     (compteurs monotones préservés), sac perdu, knob d'entrepôt, rencontre fermée.
      {
        const ids = Object.keys(survival).sort();
        let nextSurv: Record<string, PlayerSurvival> | null = null;
        for (const pid of ids) {
          const sv = (nextSurv ?? survival)[pid];
          if (!(sv.outside && tick >= sv.respawnReadyAt && sv.health <= 0)) continue;
          nextSurv = nextSurv ?? { ...survival };
          nextSurv[pid] = {
            ...baseSurvival(),
            deathSeq: sv.deathSeq + 1,
            winSeq: sv.winSeq,
            encounterSeq: sv.encounterSeq,
            respawnReadyAt: tick + RESPAWN_COOLDOWN_TICKS,
          };
          if (carried[pid] && Object.keys(carried[pid]).length > 0) carried = { ...carried, [pid]: {} }; // perte du sac
          if (DEATH_STORAGE_PENALTY > 0) {
            const res = { ...resources };
            for (const r of Object.keys(res)) res[r] = Math.max(0, Math.floor(res[r] * (1 - DEATH_STORAGE_PENALTY)));
            resources = res;
          }
          if (combat[pid]) {
            const { [pid]: _dead, ...rest } = combat;
            combat = rest;
          }
        }
        if (nextSurv) survival = nextSurv;
      }

      return {
        ...state,
        tick,
        carried,
        survival,
        combat,
        fire,
        fireCoolAt,
        temperature,
        tempAdjustAt,
        builder,
        builderAdvanceAt,
        builderTendReadyAt,
        builderTendingUntil,
        population,
        popGrowAt,
        incomeAt,
        resources,
        producing,
        workers,
        buildings,
        constructing,
        activeEvent,
        eventScheduledAt,
        pendingEffects,
        perks: perksOut,
        rng: rng === state.rng ? cloneRng(state.rng) : rng,
      };
    }

    default: {
      // Exhaustivité vérifiée par TypeScript.
      const _never: never = action;
      return _never;
    }
  }
}

/** Rejoue une séquence d'actions depuis un état initial (utile pour tests/replay réseau). */
export function reduceAll(initial: GameState, actions: GameAction[]): GameState {
  return actions.reduce(reduce, initial);
}

/** Avance la simulation de `n` tics (raccourci pour la boucle et les tests). */
export function advanceTicks(state: GameState, n: number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = reduce(s, { type: "TICK" });
  return s;
}
