// ============================================================================
//  HOOKS D'AUTO-VÉRIFICATION (`window.__game`) — Playwright / console (A6 : extrait de main.ts).
//  Lecture d'état + déclencheurs d'actions, SANS effet sur le gameplay : tout mute via `emit`
//  (hôte-autoritaire) ou via `hostMutate` (raccourcis debug réservés à l'autorité + rebroadcast).
//  Le contexte est un jeu d'ACCESSEURS (l'état de main.ts est un `let` rebindé à chaque reduce).
//  Certains hooks sont ajoutés APRÈS l'installation (cmd, editSpawn, dbg.* en DEV) — cf. main.ts.
// ============================================================================

import { ArcRotateCamera, Scene, Vector3, type AbstractEngine } from "@babylonjs/core";
import { GameState, survivalOf, maxWaterOf, maxHealthOf, carryCapacity, SharedEncounter } from "../sim/state";
import { reduce } from "../sim/reducer";
import {
  attack, assignWorker, build, buy, craftItem, debugGrantPerk, debugSet, debugSetCabinTier,
  debugSetSurvival, debugStartEncounter, deposit, eatMeat, endFlight, enterRoom, flightFire,
  gatherWood, harvestTrap, lightFire, liftOff, reinforceShip, repairCabin, steer, stokeFire,
  takeDrop, tick, upgradeCabin, upgradeEngine, useMeds, withdraw, type PlayerAction,
} from "../sim/actions";
import { config, storageCap, terrainHeight, RESOURCE_LABELS } from "../../data/world";
import { saveGame, clearSave } from "../save";
import type { AudioManager } from "../render/audio";

declare global {
  interface Window {
    __game?: {
      ready: boolean;
      renderer?: string;
      error?: string;
      getStored?: () => Record<string, number>;
      getCarried?: () => Record<string, number>;
      getFire?: () => number;
      getBuildings?: () => Record<string, number>;
      getPopulation?: () => number;
      getWorkers?: () => Record<string, number>;
      getCabinRepaired?: () => boolean;
      getCabinTier?: () => number;
      getSurvival?: () => { water: number; food: number; health: number; outside: boolean; deathSeq: number; winSeq: number; tier: number };
      setSurvival?: (vals: { water?: number; food?: number; health?: number }) => void;
      getCombat?: () => { enemyId: string; enemyHp: number; seq: number } | null;
      getMaxes?: () => { water: number; health: number; carry: number };
      craft?: (itemId: string) => void;
      buy?: (goodId: string) => void;
      useMeds?: () => void;
      withdraw?: (resource: string, amount?: number) => void;
      startEncounter?: (enemyId?: string, enemyHp?: number) => void;
      attack?: (weapon?: string) => void;
      eatMeat?: () => void;
      getDrops?: () => Array<{ id: string; loot: Record<string, number> }>;
      takeDrop?: (id?: string) => void;
      getShip?: () => { hull: number; engine: number };
      enterRoom?: (room: string, cx?: number, cz?: number) => void;
      getRooms?: () => Record<string, string>;
      getWings?: () => Record<string, boolean>;
      shipRoomWorld?: (room: string) => { x: number; z: number } | null;
      shipInteriorStats?: () => { built: boolean; inside: boolean; room: string | null; colliders: number; dark: number };
      reinforceShip?: () => void;
      upgradeEngine?: () => void;
      grantPerk?: (perk: string) => void;
      liftOff?: () => void;
      flightFire?: () => void;
      steer?: (x: number, y: number) => void;
      autoDodge?: () => void;
      endFlight?: () => void;
      getFlight?: () => { status: string; hull: number; hullMax: number; progress: number; asteroids: number; engine: number; shipX: number; shipY: number } | null;
      prestige?: () => void;
      getProgress?: () => { prestige: number };
      endingText?: () => string;
      pauseEncounters?: () => void;
      getPlayer?: () => { x: number; y: number; z: number };
      getTerrainStats?: () => { chunks: number; colliders: number; props: number; near: number; frozen: number };
      getSiteStats?: () => { placed: number; types: number; full: number; minimal: number };
      getHardwareScaling?: () => number;
      setHardwareScaling?: (level: number) => void;
      setAutoPerf?: (on: boolean) => void;
      getFocusVerb?: () => string | null;
      getAudio?: () => { unlocked: boolean; music: string | null; eventMusic: string | null; master: number; musicVol: number; sfxVol: number; muted: boolean; disabledSfx: string[] };
      getActiveEvent?: () => { id: string; scene: string } | null;
      triggerEvent?: (id: string) => void;
      pauseEventScheduler?: () => void;
      forceGather?: () => void;
      lightFire?: () => void;
      stoke?: () => void;
      deposit?: () => void;
      repairCabin?: () => void;
      upgradeCabin?: () => void;
      setCabinTier?: (tier: number) => void;
      fillStorage?: (frac?: number) => void;
      build?: (id: string) => void;
      harvestTrap?: (index?: number) => void;
      assignWorker?: (job: string) => void;
      openBuilderDialogue?: () => void;
      openVillageBoard?: () => void;
      openSettings?: () => void;
      saveNow?: () => void;
      clearSave?: () => void;
      teleport?: (x: number, z: number) => void;
      fastForward?: (seconds: number) => void;
      cmd?: (line: string) => string; // console de dev (DEV) : pilotable depuis Playwright/console
      showcaseCamera?: () => void;
      showcaseCabin?: () => void;
      showcaseBoard?: () => void;
      planView?: (height?: number) => void; // vue de dessus (plan) du campement — debug layout
      editSpawn?: () => void; // ouvre/ferme l'éditeur de spawn (DEV) — aussi via la touche F2
      errors?: string[];
    };
  }
}

/** Tout ce que les hooks empruntent à l'orchestrateur (accesseurs — l'état y est un `let` rebindé). */
export interface GameHooksContext {
  rendererLabel: string;
  errors: string[];
  getState: () => GameState;
  setState: (s: GameState) => void;
  /** Mutation DEBUG réservée à l'autorité (no-op côté client) + rebroadcast du snapshot si connecté. */
  hostMutate: (mutate: (s: GameState) => GameState) => void;
  emit: (action: PlayerAction) => void;
  self: () => string;
  selfEngagedEnc: () => { id: string; enc: SharedEncounter } | null;
  worldMap: { sites: Array<{ type: string; cx: number; cz: number }> };
  shipWorldPos: () => { x: number; z: number };
  restartWorld: () => void;
  endingText: () => string;
  pauseEncounters: () => void;
  player: { position: { x: number; y: number; z: number }; teleport: (x: number, z: number) => void };
  getTerrainStats: () => { chunks: number; colliders: number; props: number; near: number; frozen: number };
  getSiteStats: () => { placed: number; types: number; full: number; minimal: number };
  engine: AbstractEngine;
  setScaling: (level: number) => void;
  setAutoPerf: (on: boolean) => void;
  getFocusVerb: () => string | null;
  audio: AudioManager;
  openBuilderDialogue: () => void;
  openBoard: () => void;
  openSettings: () => void;
  camera: ArcRotateCamera;
  scene: Scene;
  cabin: { center: { x: number; y: number; z: number }; boardPosition: { x: number; z: number } };
  setCameraFollow: (on: boolean) => void;
}

/** Installe `window.__game` (lecture d'état + déclencheurs). Extrait tel quel de main.ts (A6). */
export function installGameHooks(ctx: GameHooksContext): void {
  const { emit, self, selfEngagedEnc, worldMap } = ctx;
  const state = ctx.getState; // raccourci : l'état COURANT (jamais capturé — toujours relu)
  window.__game = {
    ready: true,
    renderer: ctx.rendererLabel,
    getStored: () => ({ ...state().resources }),
    getCarried: () => ({ ...(state().carried[self()] ?? {}) }),
    getFire: () => state().fire,
    getBuildings: () => ({ ...state().buildings }),
    getPopulation: () => state().population,
    getWorkers: () => ({ ...state().workers }),
    getCabinRepaired: () => state().cabinRepaired,
    getCabinTier: () => state().cabinTier,
    getSurvival: () => { const s = survivalOf(state(), self()); return { water: s.water, food: s.food, health: s.health, outside: s.outside, deathSeq: s.deathSeq, winSeq: s.winSeq, tier: s.tier }; },
    setSurvival: (vals: { water?: number; food?: number; health?: number }) => emit(debugSetSurvival(self(), vals)),
    getCombat: () => { const e = selfEngagedEnc(); return e ? { enemyId: e.enc.enemyId, enemyHp: e.enc.enemyHp, seq: e.enc.seq } : null; },
    getMaxes: () => ({ water: maxWaterOf(state()), health: maxHealthOf(state()), carry: carryCapacity(state()) }),
    craft: (itemId: string) => emit(craftItem(self(), itemId)),
    buy: (goodId: string) => emit(buy(self(), goodId)),
    useMeds: () => emit(useMeds(self())),
    withdraw: (resource: string, amount = 1) => emit(withdraw(self(), resource, amount)),
    startEncounter: (enemyId?: string, enemyHp?: number) => emit(debugStartEncounter(self(), enemyId, enemyHp)),
    attack: (weapon = "fists") => { const e = selfEngagedEnc(); if (e) emit(attack(self(), weapon, e.id)); },
    eatMeat: () => emit(eatMeat(self())),
    getDrops: () => Object.keys(state().drops).map((id) => ({ id, loot: { ...state().drops[id].loot } })),
    takeDrop: (id?: string) => { const d = id ?? Object.keys(state().drops)[0]; if (d) emit(takeDrop(self(), d)); },
    getShip: () => ({ ...state().ship }),
    enterRoom: (room: string, cx?: number, cz?: number) => {
      let ecx = cx, ecz = cz;
      if (ecx === undefined || ecz === undefined) { const s = worldMap.sites.find((s) => s.type === "executioner"); if (s) { ecx = s.cx; ecz = s.cz; } }
      if (ecx !== undefined && ecz !== undefined) emit(enterRoom(self(), ecx, ecz, room));
    },
    getRooms: () => { const s = worldMap.sites.find((s) => s.type === "executioner"); const k = s ? s.cx + "," + s.cz : null; return k ? { ...(state().sites?.[k]?.rooms ?? {}) } : {}; },
    getWings: () => { const s = worldMap.sites.find((s) => s.type === "executioner"); const k = s ? s.cx + "," + s.cz : null; return k ? { ...(state().sites?.[k]?.wings ?? {}) } : {}; },
    reinforceShip: () => emit(reinforceShip(self())),
    upgradeEngine: () => emit(upgradeEngine(self())),
    grantPerk: (perk: string) => emit(debugGrantPerk(perk)),
    liftOff: () => { const w = ctx.shipWorldPos(); emit(liftOff(self(), w.x, w.z)); },
    flightFire: () => emit(flightFire(self())),
    steer: (x: number, y: number) => emit(steer(self(), x, y)),
    // RF8 — AUTOPILOTE d'esquive (tests/démo) : fuit le barycentre des astéroïdes pondéré par l'imminence
    // (positions réelles de la sim). Exerce le vrai chemin STEER ; rend l'évasion fiable sans pilotage manuel.
    autoDodge: () => {
      const f = state().flight;
      if (!f || f.status !== "ascending") return;
      let bx = 0, by = 0, w = 0;
      for (const a of f.asteroids) { const wt = 1 / Math.max(1, a.impactAt - state().tick + 1); bx += a.x * wt; by += a.y * wt; w += wt; }
      if (w === 0) { emit(steer(self(), 0, 0)); return; }
      const dx = -bx / w, dy = -by / w, m = Math.hypot(dx, dy) || 1;
      emit(steer(self(), dx / m, dy / m));
    },
    endFlight: () => emit(endFlight(self())),
    getFlight: () => { const f = state().flight; return f ? { status: f.status, hull: f.hull, hullMax: f.hullMax, progress: f.progress, asteroids: f.asteroids.length, engine: f.engine, shipX: f.shipX, shipY: f.shipY } : null; },
    prestige: () => ctx.restartWorld(),
    getProgress: () => ({ prestige: state().prestige }),
    endingText: () => ctx.endingText(), // M11/RF6 : variante d'épilogue (étendue si fleet beacon possédé)
    pauseEncounters: () => ctx.pauseEncounters(),
    getPlayer: () => { const p = ctx.player.position; return { x: p.x, y: p.y, z: p.z }; },
    getTerrainStats: () => ctx.getTerrainStats(), // P2 : colliders (physique) vs chunks (visible)
    getSiteStats: () => ctx.getSiteStats(), // P5 : sites posés + paliers LOD (détail/silhouette)
    getHardwareScaling: () => ctx.engine.getHardwareScalingLevel(), // P6 : résolution interne
    setHardwareScaling: (level: number) => ctx.setScaling(level),
    setAutoPerf: (on: boolean) => ctx.setAutoPerf(on),
    getFocusVerb: () => ctx.getFocusVerb(),
    getAudio: () => ({
      unlocked: ctx.audio.unlocked, music: ctx.audio.currentMusic, eventMusic: ctx.audio.currentEventMusic,
      master: ctx.audio.master, musicVol: ctx.audio.musicVolume, sfxVol: ctx.audio.sfxVolume, muted: ctx.audio.muted,
      disabledSfx: ctx.audio.getDisabledSfx(),
    }),
    getActiveEvent: () => (state().activeEvent ? { ...state().activeEvent! } : null),
    triggerEvent: (id: string) => ctx.hostMutate((s) => reduce(s, { type: "DEBUG_TRIGGER_EVENT", id })),
    // DEBUG : gèle l'ordonnanceur d'événements (pour les tests qui isolent une autre mécanique
    // sur de longs fast-forwards). triggerEvent reste utilisable (il court-circuite le scheduler).
    pauseEventScheduler: () => ctx.setState({ ...state(), eventScheduledAt: Number.MAX_SAFE_INTEGER }),
    forceGather: () => emit(gatherWood(self(), config.gather.woodPerChop)),
    lightFire: () => emit(lightFire(self())),
    stoke: () => emit(stokeFire(self())),
    deposit: () => emit(deposit(self())),
    repairCabin: () => emit(repairCabin(self())),
    upgradeCabin: () => emit(upgradeCabin(self())),
    setCabinTier: (tier: number) => emit(debugSetCabinTier(tier)),
    // DEBUG : remplit l'entrepôt à `frac` du plafond de chaque ressource connue (test des paliers/étiquettes).
    fillStorage: (frac = 1) => {
      for (const id of Object.keys(RESOURCE_LABELS)) emit(debugSet(self(), "storage", id, Math.floor(storageCap(state().cabinTier, id) * frac)));
    },
    build: (id: string) => emit(build(self(), id)),
    harvestTrap: (index = 0) => emit(harvestTrap(self(), index)),
    assignWorker: (job: string) => emit(assignWorker(self(), job)),
    openBuilderDialogue: () => ctx.openBuilderDialogue(),
    openVillageBoard: () => ctx.openBoard(),
    openSettings: () => ctx.openSettings(),
    saveNow: () => saveGame(state()),
    clearSave: () => clearSave(),
    teleport: (x: number, z: number) => ctx.player.teleport(x, z),
    fastForward: (seconds: number) => ctx.hostMutate((s) => {
      const n = Math.floor(seconds * config.simTickHz);
      for (let i = 0; i < n; i++) s = reduce(s, tick());
      return s;
    }),
    showcaseCamera: () => {
      const p = ctx.player.position;
      ctx.camera.setPosition(new Vector3(p.x + 2, p.y + 9, p.z + 13));
    },
    // Cadre l'intérieur de la cabane (coffre, étagères, grand tableau) pour la capture.
    showcaseCabin: () => {
      ctx.player.teleport(ctx.cabin.center.x + 1, ctx.cabin.center.z + 0.5);
      ctx.camera.setPosition(new Vector3(ctx.cabin.center.x + 6, ctx.cabin.center.y + 7, ctx.cabin.center.z + 8));
    },
    // Debug : cadre le grand tableau DE FACE (caméra figée) pour vérifier le texte.
    showcaseBoard: () => {
      ctx.setCameraFollow(false);
      const bp = ctx.cabin.boardPosition;
      ctx.camera.setTarget(new Vector3(bp.x - 0.8, ctx.cabin.center.y + 1.3, bp.z + 0.3));
      ctx.camera.setPosition(new Vector3(bp.x + 3, ctx.cabin.center.y + 1.35, bp.z + 0.3));
    },
    // Debug : VUE DE DESSUS du campement (plan) pour juger l'implantation des bâtiments.
    planView: (height = 64) => {
      ctx.setCameraFollow(false);
      ctx.scene.fogMode = Scene.FOGMODE_NONE; // pas de brouillard pour lire le plan
      ctx.camera.lowerBetaLimit = 0.001; // débride le tangage (sinon clampé à 0.35 -> oblique)
      ctx.camera.upperRadiusLimit = 600;
      ctx.camera.setTarget(new Vector3(0, terrainHeight(0, 0), 0));
      ctx.camera.alpha = -Math.PI / 2; // -Z (nord/forêt) vers le HAUT de l'image
      ctx.camera.beta = 0.08; // quasi vertical (plan)
      ctx.camera.radius = height;
    },
    errors: ctx.errors,
  };
}
