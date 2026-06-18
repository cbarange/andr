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
  PlayerSurvival, baseSurvival, SharedEncounter, SharedFlight, SiteProgress, maxWaterOf, maxHealthOf, nearestPlayerTo, createInitialState,
} from "./state";
import { GameAction } from "./actions";
import { cloneRng, nextFloat, nextInt, RngState } from "./rng";
import { lootForNode, lootNodeIds, caveSteps, townSteps, executionerDungeon, type CaveStep, type DungeonRoom } from "./dungeon";
import { drawRoad } from "./roads";
import {
  stepFightTriggers, pickEnemy, rollEnemyLoot, ownsWeapon, hasAmmo, attackDamage, playerHit, enemyHit,
  engagedPids, stepEnemyToward, ENGAGE_RADIUS, LEASH_RADIUS,
} from "./combat";
import { stepFlight, mostUrgentAsteroid } from "./flight";
import {
  config, craftables, craftableById, craftableCost, buildSecondsFor, trapDrops, jobs, jobById,
  craftableItemById, events, eventById, type EventEffect, storageCap, nextCabinTier, cabinUpgradeCost,
  weaponById, enemyById, tradeGoodById, mineGuardians, worldgen, EXECUTIONER_ALLOY_REWARD, SHIP, FLIGHT, PERKS,
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
// --- M8.6 : combat coopératif (rencontres partagées, poursuite, butin au sol) ---
const TICK_SEC = 1 / HZ; // durée d'un tic en secondes (pour la poursuite : pas borné = CHASE_SPEED * dt)
const LEASH_GRACE_TICKS = Math.round(config.combat.leashGraceSeconds * HZ); // hors laisse N tics -> despawn
const DROP_DESPAWN_TICKS = Math.round(config.combat.dropDespawnSeconds * HZ); // durée de vie d'un drop au sol

/** Centre MONDE d'un site (cx,cz) — fidèle à `cellToWorldCenter` du worldgen. Ancre des gardiens. */
function siteCenter(cx: number, cz: number): { x: number; z: number } {
  return { x: cx * worldgen.cellSize, z: cz * worldgen.cellSize };
}

/** M11/RF2 : centre MONDE d'une salle du cuirassé (centre du site + offset local de la salle). PUR. */
function roomWorldCenter(cx: number, cz: number, room: DungeonRoom): { x: number; z: number } {
  const c = siteCenter(cx, cz);
  return { x: c.x + room.pos.x, z: c.z + room.pos.z };
}

/** M11/RF2 : offset déterministe (sans RNG) du i-ème ennemi d'une arène autour du centre de salle —
 *  un anneau en angle d'or, pour les répartir lisiblement à l'entrée du joueur. PUR. */
function spreadOffset(i: number): { x: number; z: number } {
  const ang = i * 2.39996; // angle d'or (rad)
  const r = 2 + (i % 3) * 1.5; // 2 / 3.5 / 5 u
  return { x: Math.cos(ang) * r, z: Math.sin(ang) * r };
}

/** Le joueur est-il ENGAGÉ dans une rencontre quelconque (à portée) ? Garde anti-action en plein
 *  combat (M8.6 — dépend de `state.playerPos` ; sans position connue, considéré NON engagé). PUR. */
function playerEngaged(state: GameState, pid: string, tick: number): boolean {
  for (const id of Object.keys(state.encounters)) {
    if (engagedPids(state, state.encounters[id], tick).includes(pid)) return true;
  }
  return false;
}

/** Durée d'un chantier en TICS (>= 1) — la constructrice bâtit ce bâtiment en autant de tics. */
function buildTicks(id: string): number {
  return Math.max(1, Math.round(buildSecondsFor(id) * HZ));
}

/** Étapes de PROGRESSION scriptées d'un site (M8.5) : mines = gardiens fixes ; grottes = chemin
 *  du setpiece tiré de la graine (combats + « la torche s'éteint »). PUR. */
function siteSteps(siteType: string, cx: number, cz: number, worldSeed: number): CaveStep[] {
  if (siteType === "cave") return caveSteps(cx, cz, worldSeed);
  if (siteType === "town" || siteType === "city") return townSteps(siteType, cx, cz, worldSeed);
  const list = mineGuardians[siteType];
  // Dernier gardien de mine = SANS échappatoire (chef / vétéran / matriarche — fidèle).
  return list ? list.map((enemyId, i) => ({ kind: "fight", enemyId, noFlee: i === list.length - 1 }) as CaveStep) : [];
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

    case "DISCOVER_SHIP": {
      // M11/RF1 — atteindre l'ÉPAVE la « trouve » : le vaisseau d'évasion devient gérable AU CAMP
      // (flag `ship_found`). Fidèle ADR (`World.state.ship`) : INDÉPENDANT du cuirassé. Idempotent.
      // `ship_revealed` est posé en ALIAS (compat lecture des vieilles parties / gardes legacy).
      if (state.perks["ship_found"]) return state;
      const key = siteKey(action.cx, action.cz);
      const prog = (state.sites ?? {})[key] ?? {};
      return {
        ...state,
        sites: { ...state.sites, [key]: { ...prog, type: prog.type ?? "ship", discovered: true } },
        perks: { ...state.perks, ship_found: true, ship_revealed: true },
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
      // M8.5/F3.2-R3b : la CACHE FINALE d'une grotte/ville/cité est gardée par la séquence du setpiece.
      if ((action.siteType === "cave" || action.siteType === "town" || action.siteType === "city") && action.nodeId === "end") {
        const steps = siteSteps(action.siteType, action.cx, action.cz, state.worldSeed);
        if ((prog.guardians ?? 0) < steps.length) return state; // des étapes restent
      }
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
      // Grotte/ville/cité ENTIÈREMENT vidée -> nettoyée : devient un AVANT-POSTE + trace une route
      // (fidèle clearDungeon d'ADR ; la cité nettoyée arme aussi le Raid militaire futur).
      let cleared = prog.cleared ?? false;
      if (!cleared && (action.siteType === "cave" || action.siteType === "town" || action.siteType === "city")) {
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

    case "CLEAR_EXECUTIONER": {
      // M11/E1+RF1 — le CUIRASSÉ est tombé : avoir vaincu TOUS ses gardiens scriptés (comme une mine).
      // Sa soute livre un gros cache d'alliage (borné). RF1/FIDÉLITÉ : le cuirassé ne RÉVÈLE PLUS le
      // vaisseau (sources d'alliage parallèles, fidèle ADR) — il pose juste `executioner_cleared`
      // (débloque le Fabricator, RF7) + l'alliage. Idempotent ; trace une route (fusion).
      const key = siteKey(action.cx, action.cz);
      const prog = (state.sites ?? {})[key] ?? {};
      if (prog.cleared) return state;
      const guardians = mineGuardians["executioner"] ?? [];
      if ((prog.guardians ?? 0) < guardians.length) return state; // gardiens restants
      const resources = { ...state.resources };
      const cap = storageCap(state.cabinTier, "alien alloy");
      resources["alien alloy"] = Math.min(cap, (resources["alien alloy"] ?? 0) + EXECUTIONER_ALLOY_REWARD);
      const sites = { ...state.sites, [key]: { ...prog, type: prog.type ?? "executioner", discovered: true, cleared: true } };
      return {
        ...state,
        resources,
        sites,
        roads: drawRoad(state.roads, sites, action.cx, action.cz),
        perks: { ...state.perks, executioner_cleared: true },
        rng: cloneRng(state.rng),
      };
    }

    case "REINFORCE_SHIP": {
      // M11/E2 — renforce la COQUE : 1 alliage de l'ENTREPÔT -> +1 coque (fidèle ADR : possession du
      // village). Gaté : le vaisseau doit être RÉVÉLÉ (cuirassé nettoyé), coque < max, alliage en stock.
      if (!state.perks["ship_found"]) return state;
      if (state.ship.hull >= SHIP.hullMax) return state;
      if (stockOf(state, "alien alloy") < SHIP.alloyPerHull) return state;
      const resources = { ...state.resources };
      resources["alien alloy"] = stockOf(state, "alien alloy") - SHIP.alloyPerHull;
      if (resources["alien alloy"] <= 0) delete resources["alien alloy"];
      return { ...state, resources, ship: { ...state.ship, hull: state.ship.hull + 1 }, rng: cloneRng(state.rng) };
    }

    case "UPGRADE_ENGINE": {
      // M11/E2 — améliore le MOTEUR : 1 alliage -> +1 cran (ascension plus sûre en E3). Mêmes gardes.
      if (!state.perks["ship_found"]) return state;
      if (state.ship.engine >= SHIP.engineMax) return state;
      if (stockOf(state, "alien alloy") < SHIP.alloyPerEngine) return state;
      const resources = { ...state.resources };
      resources["alien alloy"] = stockOf(state, "alien alloy") - SHIP.alloyPerEngine;
      if (resources["alien alloy"] <= 0) delete resources["alien alloy"];
      return { ...state, resources, ship: { ...state.ship, engine: state.ship.engine + 1 }, rng: cloneRng(state.rng) };
    }

    case "LIFT_OFF": {
      // M11/E3 — arme le DÉCOLLAGE : le vaisseau passe en EMBARQUEMENT (attend l'équipage à `boardRadius`
      // ou le compte à rebours), puis monte (cf. TICK 9). Gaté : révélé, coque >= seuil, pas de vol en cours.
      if (!state.perks["ship_found"] || state.flight) return state;
      if (state.ship.hull < SHIP.liftoffHullMin) return state;
      const flight: SharedFlight = {
        status: "boarding",
        x: action.x, z: action.z,
        hull: state.ship.hull, hullMax: state.ship.hull, engine: state.ship.engine,
        progress: 0, asteroids: [], nextSpawnAt: 0, nextAsteroidId: 1,
        fireReadyAt: {}, aboard: { [action.playerId]: true },
        countdownAt: state.tick + Math.round(FLIGHT.boardingCountdownSeconds * HZ),
        seq: state.tick,
      };
      return { ...state, flight, rng: cloneRng(state.rng) };
    }

    case "FLIGHT_FIRE": {
      // M11/E3 — tir d'un membre d'équipage : abat l'astéroïde le plus urgent (cooldown PAR JOUEUR).
      const f = state.flight;
      const pid = action.playerId;
      if (!f || f.status !== "ascending" || !f.aboard[pid]) return state;
      if (state.tick < (f.fireReadyAt[pid] ?? 0)) return state; // recharge
      const target = mostUrgentAsteroid(f);
      if (!target) return state; // rien à abattre -> pas de tir « à vide »
      const asteroids = f.asteroids.filter((a) => a.id !== target.id);
      const fireReadyAt = { ...f.fireReadyAt, [pid]: state.tick + Math.round(FLIGHT.fireCooldownSeconds * HZ) };
      return { ...state, flight: { ...f, asteroids, fireReadyAt }, rng: cloneRng(state.rng) };
    }

    case "END_FLIGHT": {
      // M11/E3 — clôt le vol (après l'évasion -> écran de fin E4, ou le crash -> retour au vaisseau).
      if (!state.flight) return state;
      return { ...state, flight: null, rng: cloneRng(state.rng) };
    }

    case "PRESTIGE": {
      // M11/E4 — NG+ : recommence un MONDE NEUF (graine fraîche tirée du RNG -> déterministe). On REPORTE
      // les perks de combat du village (precise/barbarian/evasive/gastronome) et on incrémente le compteur
      // d'évasions ; tout le reste repart à zéro (progression, sites, stocks...). Gaté : avoir survécu à
      // l'évasion (`flight.status === "escaped"`). Le changement de `worldSeed` régénère la carte (clients).
      if (state.flight?.status !== "escaped") return state;
      const rng = cloneRng(state.rng);
      const newSeed = 1 + nextInt(rng, 1_000_000_000);
      const carry: Record<string, true> = {};
      for (const k of Object.keys(state.perks)) if (PERKS[k]) carry[k] = true; // perks « réels », pas les flags de progression
      return {
        ...createInitialState(config.rngSeed, 0),
        worldSeed: newSeed,
        perks: carry,
        prestige: state.prestige + 1,
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
      if (item.requiresPerk && !state.perks[item.requiresPerk]) return state; // M11/RF7 — Fabricator gaté (antichambre du cuirassé)
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
      if (cur.outside !== action.outside || !state.survival[pid]) {
        if (action.outside) {
          // Sort dehors : (ré)arme les échéances de drain + repart de zéro pas (jamais de combat
          // avant FIGHT_DELAY pas de marche — fidèle à l'esprit du compteur d'ADR).
          rec.waterAt = state.tick + WATER_DRAIN_TICKS;
          rec.foodAt = state.tick + FOOD_DRAIN_TICKS;
          rec.healthAt = state.tick + HEALTH_DRAIN_TICKS;
          rec.fightSteps = 0;
        } else {
          // Rentre au camp : arme la recharge. Le DÉSENGAGEMENT d'un combat est désormais ÉMERGENT
          // (M8.6) : `outside:false` exclut le joueur des `engagedPids` -> l'ennemi cesse de le viser ;
          // s'il ne reste personne, la laisse fera décrocher la rencontre (cf. TICK 8b).
          rec.waterAt = state.tick + RECHARGE_TICKS;
          rec.foodAt = state.tick + RECHARGE_TICKS;
          rec.healthAt = state.tick + RECHARGE_TICKS;
          rec.fightSteps = 0;
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
      return { ...state, survival: { ...state.survival, [pid]: rec }, sites, rng: cloneRng(state.rng) };
    }

    case "REVEAL_CELLS": {
      // M11/RF4 — FOG-OF-WAR PARTAGÉ : l'hôte fusionne les chunks vus (premier-vu global). Additif &
      // idempotent ; borné à 32 par message (anti-abus réseau). NO-OP si rien de neuf (pas de RNG).
      let changed = false;
      const v = { ...state.visitedCells };
      for (const c of action.chunks.slice(0, 32)) {
        if (!v[c]) { v[c] = true; changed = true; }
      }
      return changed ? { ...state, visitedCells: v, rng: cloneRng(state.rng) } : state;
    }

    case "VISIT_HOUSE": {
      // M8.5/F3.3 — fidèle au setpiece `house` d'ADR : tirage 25 % médecine ×2–4 / 25 % vivres +
      // EAU REMPLIE / 50 % SQUATTEUR embusqué (combat). One-shot (`visited` = markVisited).
      const pid = action.playerId;
      const key = siteKey(action.cx, action.cz);
      const prog = (state.sites ?? {})[key] ?? {};
      if (prog.visited) return state; // déjà fouillée
      if (playerEngaged(state, pid, state.tick)) return state; // pas de fouille en plein combat
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
      // 50 % : la maison est OCCUPÉE — un squatteur charge, lame rouillée au poing. Rencontre
      // PARTAGÉE ancrée au centre de la maison (M8.6) : un pair proche peut prêter main-forte.
      void sv;
      const enemy = enemyById["squatter"];
      const c = siteCenter(action.cx, action.cz);
      const id = String(state.nextEncId);
      const enc: SharedEncounter = {
        enemyId: enemy.id,
        enemyHp: enemy.hp,
        x: c.x, z: c.z,
        enemyNextAt: state.tick + Math.round(enemy.strikeSeconds * HZ),
        weaponReadyAt: {},
        seq: state.nextEncId,
      };
      return { ...state, sites, encounters: { ...state.encounters, [id]: enc }, nextEncId: state.nextEncId + 1, rng };
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
      // M8.6 — « déjà en combat » = déjà à portée d'une rencontre (on n'en empile pas une 2ᵉ sous ses pieds).
      for (const id of Object.keys(state.encounters)) {
        const e = state.encounters[id];
        if (Math.hypot(action.x - e.x, action.z - e.z) <= ENGAGE_RADIUS) return state;
      }
      const n = Math.max(1, Math.min(MAX_STEPS_PER_ACTION, Math.floor(action.n)));
      let fightSteps = sv.fightSteps;
      let rng = state.rng;
      let encounter: SharedEncounter | null = null;
      for (let i = 0; i < n; i++) {
        fightSteps++;
        if (fightSteps <= FIGHT_DELAY_STEPS) continue;
        rng = rng === state.rng ? cloneRng(state.rng) : rng;
        if (!stepFightTriggers(rng, action.tier)) continue;
        fightSteps = 0; // tirage réussi : compteur remis à zéro MÊME si le pool est vide (fidèle)
        const enemy = action.onRoad ? null : pickEnemy(rng, action.tier, action.biome);
        if (!enemy) continue;
        encounter = {
          enemyId: enemy.id,
          enemyHp: enemy.hp,
          x: action.x, z: action.z, // ANCRE la rencontre PARTAGÉE où le joueur l'a déclenchée (M8.6)
          enemyNextAt: state.tick + Math.round(enemy.strikeSeconds * HZ),
          weaponReadyAt: {},
          seq: state.nextEncId,
        };
        break; // en combat : les pas restants sont abandonnés
      }
      if (fightSteps === sv.fightSteps && !encounter) return state; // rien n'a changé
      const rec: PlayerSurvival = { ...sv, fightSteps };
      return {
        ...state,
        survival: { ...state.survival, [pid]: rec },
        encounters: encounter ? { ...state.encounters, [String(state.nextEncId)]: encounter } : state.encounters,
        nextEncId: encounter ? state.nextEncId + 1 : state.nextEncId,
        rng: rng === state.rng ? cloneRng(state.rng) : rng,
      };
    }

    case "ENGAGE_GUARDIAN": {
      // M8.5/F3.1-F3.2 — la PROCHAINE étape scriptée d'un site (mine OU grotte) : un COMBAT de
      // gardien, ou la « torche qui s'éteint » (gate : rallumer coûte 1 torche du sac).
      const pid = action.playerId;
      const key = siteKey(action.cx, action.cz);
      if (state.encounters[key]) return state; // le gardien de ce site est DÉJÀ sur le terrain
      const list = siteSteps(action.siteType, action.cx, action.cz, state.worldSeed);
      if (list.length === 0) return state;
      const prog = (state.sites ?? {})[key] ?? {};
      const idx = prog.guardians ?? 0;
      if (idx >= list.length) return state; // toutes les étapes franchies
      const step = list[idx];
      if (step.kind === "gate") {
        // « la torche s'éteint » (scène b2 d'ADR) : continuer coûte UNE torche de plus.
        if (carriedOf(state, pid, "torch") < 1) return state;
        const bag = { ...(state.carried[pid] ?? {}) };
        bag["torch"] -= 1;
        if (bag["torch"] <= 0) delete bag["torch"];
        return {
          ...state,
          carried: { ...state.carried, [pid]: bag },
          sites: { ...state.sites, [key]: { ...prog, type: prog.type ?? action.siteType, discovered: true, guardians: idx + 1 } },
          rng: cloneRng(state.rng),
        };
      }
      const enemy = enemyById[step.enemyId];
      if (!enemy) return state;
      // Rencontre PARTAGÉE ancrée au CENTRE du site (déterministe) ; son id EST le `siteKey` (un
      // seul gardien à la fois par site). M8.6 — plusieurs joueurs peuvent l'attaquer ensemble.
      const c = siteCenter(action.cx, action.cz);
      const enc: SharedEncounter = {
        enemyId: enemy.id,
        enemyHp: enemy.hp,
        x: c.x, z: c.z,
        enemyNextAt: state.tick + Math.round(enemy.strikeSeconds * HZ),
        weaponReadyAt: {},
        seq: state.nextEncId,
        siteKey: key,
        siteType: action.siteType,
        guardianIdx: idx,
        ...(step.noFlee ? { noFlee: true } : {}),
      };
      return {
        ...state,
        encounters: { ...state.encounters, [key]: enc },
        nextEncId: state.nextEncId + 1,
        sites: { ...state.sites, [key]: { ...prog, type: prog.type ?? action.siteType, discovered: true } },
        rng: cloneRng(state.rng),
      };
    }

    case "ENTER_ROOM": {
      // M11/RF2 — PÉNÉTRER dans une salle du cuirassé : verrou d'arène + spawn de la vague (host).
      // L'antichambre (hub) n'a pas de combat -> se nettoie au tic suivant. Le PONT exige les 3 ailes.
      // Idempotent : une salle déjà locked/cleared (ou un cuirassé fini) ne re-spawn jamais.
      const key = siteKey(action.cx, action.cz);
      const prog = (state.sites ?? {})[key] ?? {};
      if (prog.cleared) return state; // cuirassé déjà fini (ou vieille save migrée)
      const dungeon = executionerDungeon(action.cx, action.cz, state.worldSeed);
      const room = dungeon.rooms.find((r) => r.id === action.room);
      if (!room) return state;
      if (prog.rooms?.[room.id]) return state; // déjà locked ou cleared -> no-op
      // GATE PONT : le pont n'est franchissable qu'avec les 3 ailes nettoyées.
      if (room.isBridge && !(prog.wings?.engineering && prog.wings?.martial && prog.wings?.medical)) return state;
      const rooms = { ...(prog.rooms ?? {}), [room.id]: "locked" as const };
      const encounters = { ...state.encounters };
      let nextEncId = state.nextEncId;
      const center = roomWorldCenter(action.cx, action.cz, room);
      let i = 0;
      for (const wave of room.enemies) {
        const enemy = enemyById[wave.enemyId];
        if (!enemy) continue;
        for (let c = 0; c < wave.count; c++) {
          const off = spreadOffset(i);
          const id = `exec:${key}:${room.id}:${i}`; // id STABLE (host-only) -> pas de double spawn
          encounters[id] = {
            enemyId: enemy.id,
            enemyHp: enemy.hp,
            x: center.x + off.x,
            z: center.z + off.z,
            enemyNextAt: state.tick + Math.round(enemy.strikeSeconds * HZ),
            weaponReadyAt: {},
            seq: nextEncId++,
            siteKey: key,
            siteType: "executioner",
            roomId: room.id,
            noFlee: true, // ARÈNE : pas de laisse -> engagement forcé (l'équipe doit nettoyer la salle)
          };
          i++;
        }
      }
      return {
        ...state,
        sites: { ...state.sites, [key]: { ...prog, type: "executioner", discovered: true, rooms } },
        encounters,
        nextEncId,
        rng: cloneRng(state.rng),
      };
    }

    case "ATTACK": {
      // M8.6 : frappe une rencontre PARTAGÉE (par `encId`). Guards : rencontre vivante, joueur ENGAGÉ
      // (à portée — via `playerPos`), arme connue & possédée (poings toujours), cooldown PAR JOUEUR
      // écoulé. Chance de toucher (0.8 ADR) via le RNG à graine. À 0 PV : VICTOIRE -> butin AU SOL
      // (premier-servi), rencontre retirée, `winSeq`++ du tueur, progression du setpiece.
      const pid = action.playerId;
      const enc = state.encounters[action.encId];
      if (!enc) return state;
      if (!engagedPids(state, enc, state.tick).includes(pid)) return state; // hors de portée
      const weapon = weaponById[action.weapon];
      if (!weapon) return state;
      if (!ownsWeapon(state, pid, weapon.id)) return state;
      if (!hasAmmo(state, pid, weapon)) return state; // fusil sans balle / sans grenade (M10)
      const ready = enc.weaponReadyAt[pid] ?? {};
      if (state.tick < (ready[weapon.id] ?? 0)) return state; // l'arme de CE joueur recharge
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
      const cooldownAt = state.tick + Math.round(weapon.cooldownSeconds * HZ);
      if (enemyHp > 0) {
        const nextEnc: SharedEncounter = {
          ...enc,
          enemyHp,
          weaponReadyAt: { ...enc.weaponReadyAt, [pid]: { ...ready, [weapon.id]: cooldownAt } },
        };
        return { ...state, carried: carriedAfter, encounters: { ...state.encounters, [action.encId]: nextEnc }, rng };
      }
      // VICTOIRE : l'ennemi tombe -> son butin se répand AU SOL (premier-servi, M8.6) ; rencontre retirée.
      const enemy = enemyById[enc.enemyId];
      const loot = enemy ? rollEnemyLoot(rng, enemy) : {};
      const { [action.encId]: _won, ...restEnc } = state.encounters;
      let drops = state.drops;
      let nextEncId = state.nextEncId;
      if (Object.keys(loot).length > 0) {
        drops = { ...state.drops, [String(nextEncId)]: { x: enc.x, z: enc.z, loot, despawnAt: state.tick + DROP_DESPAWN_TICKS } };
        nextEncId += 1;
      }
      const sv = state.survival[pid] ?? baseSurvival();
      const rec: PlayerSurvival = { ...sv, winSeq: sv.winSeq + 1, fightSteps: 0 };
      // M8.5/F3.1 : victoire sur un GARDIEN de site -> progression de la séquence scriptée.
      let sites = state.sites;
      if (enc.siteKey !== undefined && enc.guardianIdx !== undefined) {
        const prog = (state.sites ?? {})[enc.siteKey] ?? {};
        if ((prog.guardians ?? 0) === enc.guardianIdx) {
          sites = { ...state.sites, [enc.siteKey]: { ...prog, guardians: enc.guardianIdx + 1 } };
        }
      }
      return {
        ...state,
        carried: carriedAfter,
        encounters: restEnc,
        drops,
        nextEncId,
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

    case "SET_POSITIONS": {
      // M8.6 — l'hôte injecte les positions des joueurs DANS la sim (s'auto-applique depuis les
      // transforms qu'il reçoit déjà, ~10 Hz). Permet au reducer PUR de calculer poursuite &
      // engagement. Host-only (pas réseau-safe : généré localement comme TICK). Pas de RNG.
      return { ...state, playerPos: action.positions };
    }

    case "TAKE_DROP": {
      // M8.6 — ramasse une pile de butin AU SOL (premier-servi) : butin -> SAC borné (boucle clamp
      // de TAKE_LOOT), pile retirée. NO-OP si la pile n'existe plus (un autre l'a prise / expirée).
      const pid = action.playerId;
      const drop = state.drops[action.dropId];
      if (!drop) return state;
      let bagTotal = 0;
      for (const k of Object.keys(state.carried[pid] ?? {})) bagTotal += state.carried[pid][k];
      let room = carryCapacity(state) - bagTotal;
      const bag = { ...(state.carried[pid] ?? {}) };
      for (const r of Object.keys(drop.loot)) {
        if (room <= 0) break;
        const add = Math.min(drop.loot[r], room);
        if (add <= 0) continue;
        bag[r] = (bag[r] ?? 0) + add;
        room -= add;
      }
      const { [action.dropId]: _taken, ...restDrops } = state.drops;
      return { ...state, carried: { ...state.carried, [pid]: bag }, drops: restDrops, rng: cloneRng(state.rng) };
    }

    case "DEBUG_START_ENCOUNTER": {
      // Force une rencontre PARTAGÉE (test/e2e) — ancrée à la position connue du joueur (ou origine).
      // `enemyHp` optionnel (raccourci « ennemi à 1 PV »).
      const pid = action.playerId;
      const enemy = enemyById[action.enemyId ?? "snarling beast"];
      if (!enemy || playerEngaged(state, pid, state.tick)) return state;
      const p = state.playerPos[pid] ?? { x: 0, z: 0 };
      const id = String(state.nextEncId);
      const enc: SharedEncounter = {
        enemyId: enemy.id,
        enemyHp: action.enemyHp ?? enemy.hp,
        x: p.x, z: p.z,
        enemyNextAt: state.tick + Math.round(enemy.strikeSeconds * HZ),
        weaponReadyAt: {},
        seq: state.nextEncId,
      };
      return {
        ...state,
        encounters: { ...state.encounters, [id]: enc },
        nextEncId: state.nextEncId + 1,
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

    case "DEBUG_GRANT_PERK": {
      // Accorde un perk/drapeau du village (perk de combat ou flag de progression M11). Console dev / e2e.
      return { ...state, perks: { ...state.perks, [action.perk]: true }, rng: cloneRng(state.rng) };
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
      const capWater = maxWaterOf(state); // M10 : caps d'équipement (entrepôt, communs)
      const capHp = maxHealthOf(state);
      const survIds = Object.keys(state.survival).sort();
      // M11/E3 — pendant l'ascension, l'expédition est SUSPENDUE (l'équipage est dans l'espace) :
      // ni drain de survie, ni combat au sol. Le climax (phase 9) prend le relais.
      const ascending = state.flight?.status === "ascending";
      if (survIds.length > 0 && !ascending) {
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

      // 8b) COMBAT COOPÉRATIF (M8.6) — par rencontre PARTAGÉE (tri PORTEUR du RNG). Pour chacune :
      //   (1) ENGAGÉS = joueurs dehors/vivants à <= ENGAGE_RADIUS (sous-ensemble des « tenus en laisse ») ;
      //   (2) POURSUITE : l'ennemi avance (borné) vers le plus proche des joueurs tenus en laisse ;
      //   (3) FRAPPE : à l'échéance `enemyNextAt`, il touche UN engagé au hasard (RNG seedé) -> dégâts ;
      //   (4) LAISSE : aucun joueur à <= LEASH_RADIUS pendant LEASH_GRACE tics -> il décroche (despawn ;
      //       setpiece : `guardians` conservé). `noFlee` (boss) désactive la laisse.
      let encounters = state.encounters;
      {
        const ids = Object.keys(encounters).sort();
        for (const id of ids) {
          const enc0 = encounters[id];
          const enemy = enemyById[enc0.enemyId];
          if (!enemy) continue;
          let enc = enc0;
          const stateNow = { ...state, survival };
          const leashed = engagedPids(stateNow, enc, tick, LEASH_RADIUS); // dehors/vivants, à portée de laisse
          const engaged = leashed.filter((pid) => {
            const p = state.playerPos[pid];
            return p !== undefined && Math.hypot(p.x - enc.x, p.z - enc.z) <= ENGAGE_RADIUS;
          });

          // (2) POURSUITE vers le plus proche des joueurs tenus en laisse (sinon l'ennemi reste sur place).
          //     Les tourelles (`static`, M11/RF3) ne se déplacent jamais — elles tirent sur place.
          const near = leashed.length ? nearestPlayerTo(stateNow, enc.x, enc.z, leashed) : null;
          if (near && !enemy.static) {
            const target = state.playerPos[near.pid];
            if (target) {
              const moved = stepEnemyToward(enc, target.x, target.z, TICK_SEC);
              if (moved.x !== enc.x || moved.z !== enc.z) enc = { ...enc, x: moved.x, z: moved.z };
            }
          }

          // (3) FRAPPE : à l'échéance, un engagé au hasard encaisse (RNG porteur : 1 tirage de cible + 1 de toucher).
          if (tick >= enc.enemyNextAt) {
            enc = { ...enc, enemyNextAt: tick + Math.round(enemy.strikeSeconds * HZ) };
            if (engaged.length > 0) {
              rng = rng === state.rng ? cloneRng(state.rng) : rng;
              const victim = engaged[nextInt(rng, engaged.length)];
              const hit = nextFloat(rng) < enemyHit(enemy.hit, state.perks);
              if (hit) {
                const sv = survival[victim];
                if (sv) {
                  survival = survival === state.survival ? { ...state.survival } : survival;
                  survival[victim] = { ...sv, health: Math.max(0, sv.health - enemy.damage) };
                }
              }
              if (enc.lastTarget !== victim) enc = { ...enc, lastTarget: victim };
            }
          }

          // (4) LAISSE : compteur de tics « hors laisse » (remis à zéro dès qu'un joueur est tenu).
          let drop = false;
          if (!enc.noFlee) {
            const lost = leashed.length ? 0 : (enc.lostTicks ?? 0) + 1;
            if (lost !== (enc.lostTicks ?? 0)) enc = { ...enc, lostTicks: lost };
            if (lost >= LEASH_GRACE_TICKS) drop = true;
          }

          if (drop) {
            encounters = encounters === state.encounters ? { ...state.encounters } : encounters;
            delete encounters[id];
          } else if (enc !== enc0) {
            encounters = encounters === state.encounters ? { ...state.encounters } : encounters;
            encounters[id] = enc;
          }
        }
      }

      // 8c) MORT — balayage UNIFIÉ (soif ET combat) : dehors, hors grâce, 0 PV -> record neuf
      //     (compteurs monotones préservés), sac perdu, knob d'entrepôt. La sortie de l'engagement
      //     est ÉMERGENTE (M8.6 : le mort, `outside:false`, est exclu des `engagedPids` dès le tic suivant).
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
            respawnReadyAt: tick + RESPAWN_COOLDOWN_TICKS,
          };
          if (carried[pid] && Object.keys(carried[pid]).length > 0) carried = { ...carried, [pid]: {} }; // perte du sac
          if (DEATH_STORAGE_PENALTY > 0) {
            const res = { ...resources };
            for (const r of Object.keys(res)) res[r] = Math.max(0, Math.floor(res[r] * (1 - DEATH_STORAGE_PENALTY)));
            resources = res;
          }
        }
        if (nextSurv) survival = nextSurv;
      }

      // 8d) BUTIN AU SOL — expiration : les piles dont la durée de vie est écoulée disparaissent.
      let drops = state.drops;
      {
        let nextDrops: typeof drops | null = null;
        for (const id of Object.keys(drops)) {
          if (drops[id].despawnAt <= tick) {
            nextDrops = nextDrops ?? { ...drops };
            delete nextDrops[id];
          }
        }
        if (nextDrops) drops = nextDrops;
      }

      // 8e) CUIRASSÉ (M11/RF2) — CLEAR DE SALLE ÉMERGENT : une salle "locked" dont toutes les
      //     rencontres sont mortes (via ATTACK) passe "cleared" (host — le client ne décide pas qu'une
      //     salle est vide). Pose le flag d'AILE (gate du pont) ; le PONT nettoyé FINIT le cuirassé
      //     (cleared global -> route + masque modèle, comme une grotte). Butin de fin de salle -> drop
      //     au sol (premier-servi). Aucun RNG (les opérations commutent : indépendantes par salle).
      let sites = state.sites;
      let roads = state.roads;
      {
        for (const key of Object.keys(sites).sort()) {
          const prog = sites[key];
          if (prog.type !== "executioner" || !prog.rooms) continue;
          const locked = Object.keys(prog.rooms).filter((r) => prog.rooms![r] === "locked").sort();
          if (locked.length === 0) continue;
          const [cxs, czs] = key.split(",").map(Number);
          const dungeon = executionerDungeon(cxs, czs, state.worldSeed);
          for (const roomId of locked) {
            const stillAlive = Object.keys(encounters).some((id) => {
              const e = encounters[id];
              return e.siteKey === key && e.roomId === roomId;
            });
            if (stillAlive) continue; // la salle est encore contestée
            const room = dungeon.rooms.find((r) => r.id === roomId);
            if (!room) continue;
            const cur = sites[key];
            const newProg: SiteProgress = { ...cur, rooms: { ...cur.rooms!, [roomId]: "cleared" } };
            if (room.wing) newProg.wings = { ...(newProg.wings ?? {}), [room.wing]: true }; // gate du pont
            // M11/RF7 — franchir l'ANTICHAMBRE débloque le Fabricator au camp (perk `executioner_cleared`).
            if (room.isHub && !perksOut["executioner_cleared"]) perksOut = { ...perksOut, executioner_cleared: true };
            if (room.isBridge) newProg.cleared = true; // cuirassé FINI
            sites = { ...sites, [key]: newProg };
            if (room.isBridge) roads = drawRoad(roads, sites, cxs, czs);
            // Bonus de fin de salle -> drop au sol (le butin individuel des ennemis est déjà tombé via ATTACK).
            if (Object.keys(room.loot).length > 0) {
              const c = roomWorldCenter(cxs, czs, room);
              drops = drops === state.drops ? { ...state.drops } : drops;
              drops[`exec:${key}:${roomId}`] = { x: c.x, z: c.z, loot: { ...room.loot }, despawnAt: tick + DROP_DESPAWN_TICKS };
            }
          }
        }
      }

      // 9) DÉCOLLAGE (M11/E3) — ascension du vaisseau (host-autoritaire, déterministe). Hors vol : no-op.
      //    La survie utilise les valeurs FRAÎCHES (post-drain) pour l'embarquement (joueurs dehors/vivants).
      let flight = state.flight;
      if (flight) flight = stepFlight({ ...state, survival }, flight, tick);

      return {
        ...state,
        tick,
        carried,
        survival,
        encounters,
        drops,
        flight,
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
        sites,
        roads,
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
