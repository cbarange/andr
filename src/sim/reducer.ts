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
  GameState, Fire, Temp, BUILDER_ABSENT, stockOf, freeWorkers, sumWorkers, carriedTotal, carryCapacity, plannedCount, siteKey,
  PlayerSurvival, baseSurvival,
} from "./state";
import { GameAction } from "./actions";
import { cloneRng, nextFloat, nextInt, RngState } from "./rng";
import { lootForNode, lootNodeIds } from "./dungeon";
import { drawRoad } from "./roads";
import {
  config, craftables, craftableById, craftableCost, buildSecondsFor, trapDrops, jobs, jobById,
  craftableItemById, events, eventById, type EventEffect, storageCap, nextCabinTier, cabinUpgradeCost,
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
const MAX_WATER = config.survival.maxWater;
const MAX_FOOD = config.survival.maxFood;
const MAX_HEALTH = config.survival.maxHealth;
const DEATH_STORAGE_PENALTY = config.survival.deathStoragePenalty;

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
      const key = siteKey(action.cx, action.cz);
      const prog = (state.sites ?? {})[key] ?? {};
      if (prog.secured) return state;
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
      // Fabrique un OBJET : recette puisée dans l'ENTREPÔT, objet ajouté au SAC (occupe 1 de portage).
      const item = craftableItemById[action.itemId];
      if (!item) return state;
      if (item.building && (state.buildings[item.building] ?? 0) === 0) return state; // prérequis bâtiment
      for (const r of Object.keys(item.recipe)) if (stockOf(state, r) < item.recipe[r]) return state; // ressources manquantes
      const pid = action.playerId;
      if (carryCapacity(state) - carriedTotal(state, pid) <= 0) return state; // sac plein
      const resources = { ...state.resources };
      for (const r of Object.keys(item.recipe)) resources[r] = (resources[r] ?? 0) - item.recipe[r];
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
      if (!prog?.cleared || prog.used) return state; // pas un avant-poste, ou déjà épuisé
      const pid = action.playerId;
      const cur = state.survival[pid] ?? baseSurvival();
      if (cur.water >= MAX_WATER && cur.food >= MAX_FOOD) return state; // rien à remplir
      const rec: PlayerSurvival = {
        ...cur,
        water: MAX_WATER,
        food: MAX_FOOD,
        // Ré-arme les échéances de drain (on repart « plein », pas à une échéance imminente).
        waterAt: state.tick + WATER_DRAIN_TICKS,
        foodAt: state.tick + FOOD_DRAIN_TICKS,
      };
      return {
        ...state,
        survival: { ...state.survival, [pid]: rec },
        sites: { ...state.sites, [key]: { ...prog, used: true } },
        rng: cloneRng(state.rng),
      };
    }

    case "SET_OUTSIDE": {
      // M6/M7 : le client signale qu'il a franchi la frontière de la zone sûre. Lazy-init de la survie
      // à la 1ʳᵉ référence (plein). NO-OP si le bord n'a pas changé (idempotent ; calque DISCOVER_SITE).
      const pid = action.playerId;
      const cur = state.survival[pid] ?? baseSurvival();
      if (state.survival[pid] && cur.outside === action.outside) return state;
      const rec: PlayerSurvival = { ...cur, outside: action.outside };
      if (action.outside) {
        // Sort dehors : (ré)arme les échéances de drain à partir de maintenant.
        rec.waterAt = state.tick + WATER_DRAIN_TICKS;
        rec.foodAt = state.tick + FOOD_DRAIN_TICKS;
        rec.healthAt = state.tick + HEALTH_DRAIN_TICKS;
      } else {
        // Rentre au camp : arme la recharge (la régénération se fera dans TICK).
        rec.waterAt = state.tick + RECHARGE_TICKS;
        rec.foodAt = state.tick + RECHARGE_TICKS;
        rec.healthAt = state.tick + RECHARGE_TICKS;
      }
      return { ...state, survival: { ...state.survival, [pid]: rec }, rng: cloneRng(state.rng) };
    }

    case "RESOLVE_EVENT_CHOICE": {
      if (!state.activeEvent) return state;
      const ev = eventById[state.activeEvent.id];
      const scene = ev?.scenes[state.activeEvent.scene];
      if (!ev || !scene) return state;
      const choice = scene.choices.find((c) => c.id === action.choice);
      if (!choice) return state;
      if (choice.available && !choice.available(state)) return state;
      // Le coût est payé depuis l'ENTREPÔT (gestion village).
      if (choice.cost) {
        for (const r of Object.keys(choice.cost)) {
          if (stockOf(state, r) < choice.cost[r]) return state; // pas les moyens -> no-op
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
      };
      if (choice.cost) for (const r of Object.keys(choice.cost)) draft.resources[r] = (draft.resources[r] ?? 0) - choice.cost[r];
      if (choice.reward) addStores(draft.resources, choice.reward, state.cabinTier);

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
      }

      // 7) SURVIE (M6/M7) : par joueur, PAR TEMPS passé DEHORS (pas par case). DEHORS : l'eau puis les
      //    vivres se vident ; à sec des DEUX, la santé baisse ; à 0 PV -> MORT (retour au camp signalé
      //    par `deathSeq`, perte du SAC, knob `deathStoragePenalty` pour l'entrepôt). DEDANS : recharge
      //    vers le max. Aucune consommation de RNG -> l'ordre d'itération n'affecte pas le déterminisme
      //    (tri défensif au cas où on y ajouterait un tirage plus tard).
      let survival = state.survival;
      let carried = state.carried;
      const survIds = Object.keys(state.survival).sort();
      if (survIds.length > 0) {
        const nextSurv: Record<string, PlayerSurvival> = { ...state.survival };
        let survMutated = false;
        for (const pid of survIds) {
          const s0 = state.survival[pid];
          let { water, food, health, waterAt, foodAt, healthAt } = s0;
          const { outside, respawnReadyAt, deathSeq } = s0;
          let dirty = false;

          if (outside && tick >= respawnReadyAt) {
            if (water > 0 && tick >= waterAt) { water -= 1; waterAt = tick + WATER_DRAIN_TICKS; dirty = true; }
            if (food > 0 && tick >= foodAt) { food -= 1; foodAt = tick + FOOD_DRAIN_TICKS; dirty = true; }
            // À sec d'eau ET de vivres : la santé décline.
            if (water === 0 && food === 0 && tick >= healthAt) { health -= 1; healthAt = tick + HEALTH_DRAIN_TICKS; dirty = true; }
            if (health <= 0) {
              // MORT : on REMPLACE l'enregistrement par un neuf (plein, dedans) + signal `deathSeq`.
              nextSurv[pid] = { ...baseSurvival(), deathSeq: deathSeq + 1, respawnReadyAt: tick + RESPAWN_COOLDOWN_TICKS };
              survMutated = true;
              if (carried[pid] && Object.keys(carried[pid]).length > 0) carried = { ...carried, [pid]: {} }; // perte du sac
              if (DEATH_STORAGE_PENALTY > 0) {
                const res = { ...resources };
                for (const r of Object.keys(res)) res[r] = Math.max(0, Math.floor(res[r] * (1 - DEATH_STORAGE_PENALTY)));
                resources = res;
              }
              continue; // enregistrement déjà posé
            }
          } else if (!outside && tick >= waterAt && (water < MAX_WATER || food < MAX_FOOD || health < MAX_HEALTH)) {
            // DEDANS : recharge cadencée (waterAt sert d'horloge de recharge unique).
            if (water < MAX_WATER) water += 1;
            if (food < MAX_FOOD) food += 1;
            if (health < MAX_HEALTH) health += 1;
            waterAt = tick + RECHARGE_TICKS; foodAt = tick + RECHARGE_TICKS; healthAt = tick + RECHARGE_TICKS;
            dirty = true;
          }

          if (dirty) { nextSurv[pid] = { ...s0, water, food, health, waterAt, foodAt, healthAt }; survMutated = true; }
        }
        if (survMutated) survival = nextSurv;
      }

      return {
        ...state,
        tick,
        carried,
        survival,
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
