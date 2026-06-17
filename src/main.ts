// ============================================================================
//  POINT D'ENTRÉE — assemble le cerveau (sim/), le corps (render/), l'UI (ui/),
//  les entrées (input/) et le réseau (net/).
//
//  Règle d'or (§3.1) : la SIM est la seule source de vérité du gameplay. Le rendu
//  et l'UI lisent l'état et émettent des ACTIONS ; ils ne contiennent aucune règle.
// ============================================================================

import { Vector3, Matrix, Scene, Ray } from "@babylonjs/core";

import { createEngine, createScene, setupPostProcess } from "./render/scene";
import { createHavokPlugin } from "./render/physics";
import { createWorld } from "./render/world";
import { Terrain } from "./render/terrain";
import { Trees } from "./render/trees";
import { Decor } from "./render/scatter";
import { CampDecor } from "./render/campDecor";
import { CampLights } from "./render/campLights";
import { CampRuins } from "./render/campRuins";
import { CampPaths } from "./render/campPaths";
import { Rampart } from "./render/rampart";
import { Sites } from "./render/sites";
import { Forest } from "./render/forest";
import { Cabin } from "./render/cabin";
import { Interiors } from "./render/interior";
import { ShipInterior } from "./render/shipInterior";
import { ThresholdCine, AnimatedDoor, DipOverlay } from "./render/threshold";
import { SiteLoot } from "./render/siteLoot";
import { Player } from "./render/player";
import { createCamera, cameraYaw } from "./render/camera";
import { RemotePlayers } from "./render/remotePlayer";
import { Stranger } from "./render/stranger";
import { Village } from "./render/buildings";
import { Villagers } from "./render/villagers";
import { EntityManager, type Entity } from "./render/entities";
import { nextScaling, SCALE_MIN, SCALE_MAX, SCALE_STEP } from "./render/autoperf";
import { InputManager } from "./input/input";
import { PointerLook } from "./input/pointerLook";
import { Hud, type DialogueChoice, type DialogueStepper, type DialogueView } from "./ui/hud";
import { NetRoom } from "./net/room";
import type { StateSyncMsg } from "./net/messages";

import {
  createInitialState, Fire, freeWorkers, carriedTotal, carriedOf, carryCapacity, plannedCount, survivalOf, maxWaterOf, maxHealthOf, stockOf, type GameState, type SharedEncounter,
} from "./sim/state";
import { reduce } from "./sim/reducer";
import { generateWorld } from "./sim/worldgen";
import {
  gatherWood, lightFire, stokeFire, build, harvestTrap, assignWorker, unassignWorker,
  deposit, repairCabin, upgradeCabin, resolveEventChoice, tick, debugSetSeed, debugSetCabinTier, debugSet,
  takeLoot, secureMine, setOutside, debugSetSurvival, useOutpost,
  attack, eatMeat, debugStartEncounter, craftItem, buy, useMeds, withdraw, steps, engageGuardian, enterRoom,
  visitHouse, talkSwamp, setPositions, takeDrop, reinforceShip, upgradeEngine, debugGrantPerk,
  liftOff, flightFire, endFlight, prestige, discoverShip,
  isNetworkSafeAction, type PlayerAction,
} from "./sim/actions";
import { bestReadyWeapon, ENGAGE_RADIUS } from "./sim/combat";
import { caveSteps, townSteps, executionerDungeon } from "./sim/dungeon";
import { EncounterFx, type EncView } from "./render/encounter";
import { GroundDrops } from "./render/drops";
import { Liftoff } from "./render/liftoff";
import { ShipAtCamp } from "./render/shipCamp";
import {
  config, worldgen, FIRE_LABELS, TEMP_LABELS, BUILDER_MESSAGES, RESOURCE_LABELS,
  craftables, craftableCost, craftableRevealed, jobs, terrainHeight, terrainBaseHeight, setTerrainPlateaus, type TerrainPlateau, eventById, nextCabinTier, cabinUpgradeCost, storageCap,
  configureBorders, SEA_LEVEL, BORDER_START, BORDER_BAND, campLayout, campPathsFor,
  enemyById, weaponById, craftableItems, craftableItemById, tradeGoods, mineGuardians, Biome, SHIP,
} from "../data/world";
import { createOcean } from "./render/ocean";

// « Dans le village » = à l'intérieur du retranchement (zone sûre). Au-delà : EXPLORATION
// (les événements ne bloquent plus — cf. reflectState).
const VILLAGE_RADIUS = worldgen.safeRadiusCells * worldgen.cellSize;
import { saveGame, loadGame, clearSave, saveDiscovered, loadDiscovered, saveAudioSettings, loadAudioSettings, saveComfortSettings, loadComfortSettings } from "./save";
import { AudioManager } from "./render/audio";
import { audioManifest } from "../data/audio";
import { DevConsole } from "./dev/console";
import { runCommand, type CommandCtx } from "./dev/commands";
import { SpawnEditor } from "./dev/spawnEditor";

// Ordre d'affichage des ressources dans le sac.
const BAG_ORDER = [
  "wood", "fur", "meat", "cured meat", "leather", "scales", "teeth", "cloth",
  "charm", "bait", "iron", "coal", "sulphur", "steel", "bullets", "medicine",
  "alien alloy", "energy cell", "torch", // butin R3 + outil M9 (sinon invisibles dans le sac)
  "bone spear", "iron sword", "steel sword", "bayonet", "rifle", "grenade", // armes M8/M10 (outfit)
];

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
      endFlight?: () => void;
      getFlight?: () => { status: string; hull: number; hullMax: number; progress: number; asteroids: number; engine: number } | null;
      prestige?: () => void;
      getProgress?: () => { prestige: number };
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

async function boot(): Promise<void> {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  const hud = new Hud();

  const errors: string[] = [];
  window.addEventListener("error", (e) => errors.push(String(e.message)));
  window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));

  const { engine, rendererLabel } = await createEngine(canvas);
  hud.setRenderer(rendererLabel);

  const scene = createScene(engine);
  const havok = await createHavokPlugin();
  scene.enablePhysics(new Vector3(0, config.gravity, 0), havok);

  const camera = createCamera(scene, canvas);
  setupPostProcess(scene, camera);
  // Caméra à capture de pointeur : orientation souris sans clic-glisser (phase libre),
  // curseur rendu en dialogue/UI.
  const pointerLook = new PointerLook(camera, canvas, document.getElementById("lockHint"));
  // Réglages de CONFORT (FOV + sensibilité souris) — locaux, persistés (cf. save.ts). Le FOV est
  // appliqué plus bas (après capture de `baseFov`) ; la sensibilité l'est ici.
  const savedComfort = loadComfortSettings();
  let sensMul = savedComfort?.sensitivity ?? 1;
  pointerLook.setSensitivity(sensMul);

  // ---- AUDIO (PRÉSENTATION : musique + SFX) — hors sim, 100 % local (cf. docs/plan-audio.md).
  //      A1 socle (engine/bus/volumes/mute/déverrouillage) + A2 musique de l'état du feu. ----
  const audio = new AudioManager();
  // Effets ponctuels listés dans Paramètres -> « Effets actifs » (clés = manifeste SFX).
  const SFX_LABELS: Array<{ key: string; label: string }> = [
    { key: "gatherWood", label: "Couper du bois" },
    { key: "lightFire", label: "Allumer le feu" },
    { key: "stokeFire", label: "Attiser le feu" },
    { key: "build", label: "Construire / réparer" },
    { key: "deposit", label: "Déposer au coffre" },
    { key: "checkTraps", label: "Relever les pièges" },
    { key: "footsteps", label: "Pas / déplacement" },
    { key: "door", label: "Portes des huttes" },
  ];
  const savedAudio = loadAudioSettings();
  if (savedAudio) {
    audio.setMaster(savedAudio.master);
    audio.setMusicVolume(savedAudio.music);
    audio.setSfxVolume(savedAudio.sfx);
    audio.setMuted(savedAudio.muted);
    for (const key of savedAudio.disabledSfx) audio.setSfxEnabled(key, false);
  }
  void audio.init(); // crée le moteur AudioV2 (échec silencieux : on n'a juste pas de son)
  audio.attachListener(camera); // A4 : l'« oreille » spatiale suit la caméra (le feu s'atténue au loin)
  // Politique d'autoplay : on débloque le contexte au 1er geste utilisateur (le même clic
  // qui active le pointer lock). resumeAsync est idempotent.
  canvas.addEventListener("pointerdown", () => audio.resumeOnGesture(), { once: true });
  // Section « Son » du menu Paramètres — volumes + mute + effets actifs, persistés HORS GameState.
  const persistAudio = (): void => saveAudioSettings({
    master: audio.master, music: audio.musicVolume, sfx: audio.sfxVolume, muted: audio.muted,
    disabledSfx: audio.getDisabledSfx(),
  });
  hud.setAudioValues(audio.master, audio.musicVolume, audio.sfxVolume, audio.muted);
  hud.onAudioVolume((kind, v) => {
    if (kind === "master") audio.setMaster(v);
    else if (kind === "music") audio.setMusicVolume(v);
    else audio.setSfxVolume(v);
    persistAudio();
  });
  hud.onMuteToggle((m) => { audio.setMuted(m); persistAudio(); });
  // Cases à cocher « Effets actifs » : activer/désactiver chaque effet ponctuel.
  hud.buildSfxToggles(
    SFX_LABELS.map((s) => ({ ...s, enabled: audio.isSfxEnabled(s.key) })),
    (key, enabled) => { audio.setSfxEnabled(key, enabled); persistAudio(); },
  );

  // A5 — musique d'événement : nos ids M5 -> fichiers event-*.flac (overlay + ducking du fond).
  const EVENT_MUSIC: Record<string, string> = {
    noises_outside: audioManifest.events.noisesOutside,
    noises_inside: audioManifest.events.noisesInside,
    beggar: audioManifest.events.beggar,
    nomad: audioManifest.events.nomad,
    ruined_trap: audioManifest.events.ruinedTrap,
    hut_fire: audioManifest.events.hutFire,
    beast_attack: audioManifest.events.beastAttack,
    wanderer_wood: audioManifest.events.mysteriousWanderer,
    wanderer_fur: audioManifest.events.mysteriousWanderer,
  };

  // A6 — musique de fond = fonction du LIEU et de l'état : dehors -> exploration ; au camp ->
  // musique de village selon la population (mélodique) ; tout début (sans villageois) ->
  // ambiance de feu (spatialisée, lot A4). Renvoie le NOM de fichier voulu.
  function pickMusic(): string {
    const p = player.position;
    if (Math.hypot(p.x, p.z) > VILLAGE_RADIUS) return audioManifest.music.exploration; // dehors
    const pop = state.population;
    if (pop >= 1) {
      const tiers = audioManifest.music.village; // lonely-hut -> raucous-village
      const i = pop >= 40 ? 4 : pop >= 20 ? 3 : pop >= 10 ? 2 : pop >= 4 ? 1 : 0;
      return tiers[i];
    }
    const fire = audioManifest.music.fire; // 0..4
    return fire[Math.max(0, Math.min(fire.length - 1, state.fire))];
  }

  const world = createWorld(scene);
  // Registre d'arbres PARTAGÉ (un mesh de base par essence) : forêt du camp + décor sauvage.
  const treeMeshes = new Trees(scene);
  // Registre de DÉCOR partagé (rochers, herbes, fougère…) pour la dispersion sauvage.
  const decor = new Decor(scene);
  // Décor au sol du CAMP : fleurs/herbes/cailloux dans les poches vivables (Phase 2).
  const campDecor = new CampDecor(scene, decor);
  // Lanternes du camp : s'allument quand la cabane s'améliore (palier ≥5, plus à ≥10) — cf. campLights.ts.
  const campLights = new CampLights(scene);
  // Ruines : gravats sur ~1/3 des emplacements à venir (remplacés à la construction) + permanentes.
  const campRuins = new CampRuins(scene);
  // Rempart & porte (M6 — « le seuil ») : palissade autour de la zone sûre + porte au sud + puits.
  // Purement visuel/local ; la frontière logique reste `VILLAGE_RADIUS` (cf. reflectState).
  new Rampart(scene);
  // Chemins du camp : texture fine plaquée au sol, RE-cuite quand le réseau s'étoffe (cf. boucle).
  const campPaths = new CampPaths(scene);
  const forest = new Forest(scene, treeMeshes);
  const cabin = new Cabin(scene);
  const player = new Player(scene);
  const remotes = new RemotePlayers(scene);
  const stranger = new Stranger(scene);
  stranger.setHome(cabin.builderHome); // une fois la cabane réparée, elle « vit » dans son coin
  const village = new Village(scene);
  // À la construction d'un bâtiment (début de chantier + achèvement) : dégage son emprise —
  // les arbres du camp et le décor au sol qui s'y trouvent sont retirés, et plus aucun arbre n'y
  // repoussera (cf. forest.clearFootprint). Rayons un peu plus larges que la silhouette visible.
  const CLEAR_R: Record<string, number> = {
    hut: 2.8, cart: 2.4, "trading post": 3.0, armoury: 2.6, tannery: 2.6,
    workshop: 2.6, smokehouse: 2.4, lodge: 3.2, steelworks: 3.2, trap: 1.6,
  };
  village.setOnPlaced((id, x, z) => {
    const r = CLEAR_R[id] ?? 2.6;
    forest.clearFootprint(x, z, r);
    campDecor.clearFootprint(x, z, r);
  });
  const villagers = new Villagers(scene);
  // Repères que les villageois visitent pour « faire leur métier » (cosmétique, local).
  villagers.setLandmarks({
    trees: () => forest.getTrees(),
    traps: () => village.getTrapPositions(),
    buildings: (id) => village.getBuildingPositions(id),
    // Emprises à contourner : bâtiments + cabane + foyer (le feu).
    obstacles: () => [
      ...village.getObstacles(),
      { x: cabin.center.x, z: cabin.center.z, r: cabin.footprintRadius },
      { x: 0, z: 0, r: 1.6 },
    ],
    cabin: { x: cabin.center.x, z: cabin.center.z },
    fire: { x: 0, z: 0 },
  });
  // Son de porte (entrée/sortie de hutte) — atténué par la distance au joueur + petit cooldown
  // anti-spam (les portes peuvent s'enchaîner). 100 % présentation locale.
  let lastDoorMs = 0;
  const DOOR_MAX_DIST = 28; // au-delà : inaudible
  villagers.setDoorSound((x, z) => {
    const now = performance.now();
    if (now - lastDoorMs < 90) return; // anti-chœur de portes
    const dx = player.position.x - x, dz = player.position.z - z;
    const dist = Math.hypot(dx, dz);
    if (dist > DOOR_MAX_DIST) return;
    lastDoorMs = now;
    const gain = Math.pow(1 - dist / DOOR_MAX_DIST, 1.5); // atténuation douce
    audio.playDoor(gain);
  });

  // ---- RENDU CONDITIONNEL (LOD) : les entités sont (dé)chargées/animées selon la distance
  //      au joueur. P1 : le VILLAGE (les villageois) ne sont rendus/animés que de près. ----
  const entities = new EntityManager(config.lod.hysteresis);
  const villageEntity: Entity = {
    x: 0, z: 0, // centre du village (le feu)
    fullDist: config.lod.villageFull,
    minimalDist: config.lod.villageMinimal,
    band: "culled",
    onBand: (b) => villagers.setVisible(b !== "culled"), // déchargés au-delà du minimal
    tick: (dt) => villagers.update(dt), // animés en full ; au ralenti en minimal
    minimalTick: true,
  };
  entities.register(villageEntity);

  const input = new InputManager();
  // Console de développement (slash-commandes) — créée plus bas en DEV uniquement.
  let devConsole: DevConsole | null = null;
  let spawnEditor: SpawnEditor | null = null; // éditeur de layout du spawn (DEV, touche F2)

  // ---- LE CERVEAU : état de simulation local (restauré depuis la sauvegarde si présente) ----
  const loaded = loadGame();
  // On fusionne sur un état neuf : remplit les champs manquants (évolution du schéma) et
  // repart d'un sac vide (le selfId change à chaque session -> le sac n'est pas persistant).
  let state: GameState = loaded
    ? { ...createInitialState(config.rngSeed, 0), ...loaded, carried: {}, survival: {}, encounters: {}, playerPos: {}, drops: {}, flight: null }
    : createInitialState(config.rngSeed, 0);
  // M11/RF1 — compat save : les vieilles parties révélaient le vaisseau via le cuirassé (`ship_revealed`).
  // Désormais le flag est `ship_found` (indépendant). Back-fill : si révélé jadis, considéré trouvé.
  if (state.perks["ship_revealed"] && !state.perks["ship_found"]) state = { ...state, perks: { ...state.perks, ship_found: true } };
  // M11/RF2b — compat save : un cuirassé nettoyé via le vieux gantelet (`cleared` mais sans `rooms`)
  // est considéré comme un donjon entièrement vidé (toutes salles cleared + 3 ailes) -> pas de re-spawn.
  {
    let sitesPatched: GameState["sites"] | null = null;
    for (const k of Object.keys(state.sites ?? {})) {
      const pr = state.sites[k];
      if (pr.type !== "executioner") continue;
      if (pr.cleared && !pr.rooms) {
        // Vieux gantelet nettoyé -> donjon entièrement vidé (pas de re-spawn).
        sitesPatched = sitesPatched ?? { ...state.sites };
        sitesPatched[k] = { ...pr, rooms: { antechamber: "cleared", engineering: "cleared", martial: "cleared", medical: "cleared", bridge: "cleared" }, wings: { engineering: true, martial: true, medical: true } };
      } else if (pr.rooms && Object.values(pr.rooms).includes("locked")) {
        // Save prise EN PLEINE ARÈNE : les rencontres sont volatiles (strippées) -> une salle « locked »
        // rechargée n'a plus d'ennemis et serait auto-nettoyée (8e) = aile gratuite. On la REMET à
        // « non entrée » : on devra y re-rentrer (re-combat). Fidèle (ADR ne sauvegarde pas en plein combat).
        const rooms: Record<string, "locked" | "cleared"> = {};
        for (const [rid, st] of Object.entries(pr.rooms)) if (st === "cleared") rooms[rid] = "cleared";
        sitesPatched = sitesPatched ?? { ...state.sites };
        sitesPatched[k] = { ...pr, rooms };
      }
    }
    if (sitesPatched) state = { ...state, sites: sitesPatched };
  }

  // ---- LE MONDE (M7) : carte logique dérivée de worldSeed (pure, identique chez tous les
  //      pairs) + sol STREAMÉ par chunks autour du joueur. Chargé d'emblée autour du centre
  //      pour que la capsule du joueur tombe sur le sol au boot. ----
  configureBorders(state.worldSeed); // bordures (2 montagnes + 2 océans) tirées de la graine AVANT le terrain
  // PLATEAUX d'aplanissement : autour des grottes/mines, le terrain est mis à PLAT (= sol de l'intérieur)
  // -> plus de relief qui transperce le plancher, jonction propre. `ri` couvre le sol intérieur, `ro` lisse.
  const PLATEAU_R: Record<string, { ri: number; ro: number }> = {
    cave: { ri: 20, ro: 32 }, ironmine: { ri: 16, ro: 27 }, coalmine: { ri: 16, ro: 27 }, sulphurmine: { ri: 16, ro: 27 },
    // Ruines (maison/grappe/cité) : fondations plates -> on aplanit le sol sous leur emprise.
    house: { ri: 5, ro: 11 }, town: { ri: 8, ro: 16 }, city: { ri: 11, ro: 21 },
    // Cuirassé (dreadnought écrasé, unique & colossal) : grand champ de crash aplani — assez large
    // pour porter TOUT l'intérieur explorable (antichambre → ailes → pont, ~55 u de profondeur).
    executioner: { ri: 60, ro: 78 },
  };
  function registerPlateaus(map: typeof worldMap): void {
    const plateaus: TerrainPlateau[] = [];
    for (const s of map.sites) {
      const rr = PLATEAU_R[s.type];
      if (!rr) continue;
      const w = map.cellToWorldCenter(s.cx, s.cz);
      plateaus.push({ x: w.x, z: w.z, ri: rr.ri, ro: rr.ro, h: terrainBaseHeight(w.x, w.z) });
    }
    setTerrainPlateaus(plateaus);
  }
  let worldMap = generateWorld(state.worldSeed); // mutable : /seed la remplace
  registerPlateaus(worldMap); // AVANT le terrain : les chunks se déforment déjà aplanis aux sites
  const terrain = new Terrain(scene, worldMap, treeMeshes, decor);
  // Faux océan : un grand plan d'eau plat, caché sauf là où une bordure « océan » plonge le terrain.
  const ocean = createOcean(scene, SEA_LEVEL, BORDER_START + BORDER_BAND + 100);
  // SITES / repères (M7 Phase 5) : silhouettes des points d'intérêt, en LOD via l'EntityManager
  // (silhouette de loin -> détail de près -> masqué au-delà). Posées après l'init de `entities`.
  const sites = new Sites(scene);
  sites.placeAll(worldMap, entities);
  // INTÉRIEURS souterrains (M9 R1) : bâtit/libère l'intérieur du site `cave`/`*mine` le plus proche
  // quand on s'en approche (mesh + colliders localisés), + obscurité locale sous plafond. Aucune transition.
  const interiors = new Interiors(scene);
  interiors.setMap(worldMap);
  // INTÉRIEUR DU CUIRASSÉ (M11/RF2b) : donjon de salles explorable (antichambre → ailes → pont),
  // portes télégraphiées, culling par salle, obscurité locale — bâti à l'approche du site `executioner`.
  const shipInterior = new ShipInterior(scene);
  shipInterior.setMap(worldMap);
  // CINÉMATIQUE DE SEUIL (M11/RF5) : à l'entrée du cuirassé, une mini-cinématique LOCALE (porte iris
  // qui s'ouvre → pas franchi → bref fondu au noir qui masque le passage → FPV dedans). 100 % local,
  // timeout-safe (l'input est toujours rendu). Voir render/threshold.ts.
  const cine = new ThresholdCine();
  const cineDoor = new AnimatedDoor(scene);
  const dipOverlay = new DipOverlay();
  let cineCommit: (() => void) | null = null;
  // FOUILLE DE SURFACE (R3) : butin 3D posé autour des forages/champs de bataille (alliage…).
  const siteLoot = new SiteLoot(scene);
  siteLoot.setMap(worldMap);
  // RENCONTRES (M8.6) : ennemis PARTAGÉS ancrés dans le monde — chacun rendu à sa position
  // autoritaire (visible de tous), interpolé vers le flux rapide de l'hôte. + BUTIN AU SOL (drops).
  const encounterFx = new EncounterFx(scene);
  const groundDrops = new GroundDrops(scene);
  // M11/E3b — mise en scène CINÉMATIQUE du décollage (ciel d'espace, vaisseau qui s'élève, débris).
  const liftoff = new Liftoff(scene, camera);
  // M11/RF1b — LE VAISSEAU AU CAMP (« ramené à la base », fidèle ADR) : apparaît une fois l'épave
  // trouvée et s'assemble au fil de la coque. Ancre à l'est du camp, dégagée des bâtiments (≤ r15).
  const SHIP_CAMP = { x: 24, z: 0 };
  const shipAtCamp = new ShipAtCamp(scene, SHIP_CAMP.x, SHIP_CAMP.z);
  // Vue sérialisable des rencontres pour le rendu (snapshot 2 Hz : positions/PV/échéances/seq).
  const toEncViews = (encs: Record<string, SharedEncounter>): Record<string, EncView> => {
    const out: Record<string, EncView> = {};
    for (const id of Object.keys(encs)) {
      const e = encs[id];
      out[id] = { enemyId: e.enemyId, hp: e.enemyHp, x: e.x, z: e.z, enemyNextAt: e.enemyNextAt, seq: e.seq };
    }
    return out;
  };
  // Rencontre où le joueur LOCAL est ENGAGÉ (à portée) — la plus proche s'il y en a plusieurs.
  // Sert au focus « frapper », au HUD de combat et au gel du podomètre. Calque `engagedPids` (sim) :
  // il faut être DEHORS et hors grâce de respawn, sinon le HUD/focus offriraient un combat que la
  // sim refuserait (ennemi venu rôder au bord du village, joueur fraîchement réapparu).
  const selfEngagedEnc = (): { id: string; enc: SharedEncounter } | null => {
    const sv = survivalOf(state, self());
    if (!sv.outside || sv.health <= 0 || state.tick < sv.respawnReadyAt) return null;
    const p = player.position;
    let best: { id: string; enc: SharedEncounter } | null = null;
    let bestD = Infinity;
    for (const id of Object.keys(state.encounters)) {
      const e = state.encounters[id];
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d <= ENGAGE_RADIUS && d < bestD) { bestD = d; best = { id, enc: e }; }
    }
    return best;
  };
  let prevBlockedNoTorch = false; // front montant -> un seul toast « il fait trop noir »
  const EMPTY_KEYS = new Set<string>(); // (réutilisé : pas d'alloc/frame quand aucun intérieur actif)
  // Switches dev (HUD debug, F3) : texture du sol + brouillard.
  hud.addDebugToggle("texture sol", terrain.groundTextureOn, (on) => terrain.setGroundTexture(on));
  hud.addDebugToggle("brouillard", scene.fogMode !== Scene.FOGMODE_NONE, (on) => {
    scene.fogMode = on ? Scene.FOGMODE_EXP2 : Scene.FOGMODE_NONE;
  });
  // « view range » : rayon de chunks chargés (on voit plus loin) + brouillard ajusté en
  // conséquence. Affiché en mètres. Plus grand = plus loin mais plus coûteux.
  const baseFog = scene.fogDensity;
  const baseRange = worldgen.loadRadiusChunks;
  const chunkSize = worldgen.chunkCells * worldgen.cellSize;
  hud.addDebugStepper(
    "view range", terrain.loadRadius, 1, 6, 1,
    (n) => {
      terrain.setLoadRadius(n);
      scene.fogDensity = (baseFog * baseRange) / n; // plus de portée -> moins de brouillard
    },
    (n) => `${n * chunkSize} m`,
  );

  // ---- PERF GLOBALE / ADAPTATIVE (P6) : levier de RÉSOLUTION (hardware scaling) + mode AUTO
  //      qui vise un FPS cible (cf. render/autoperf.ts). Levier prévisible : ne touche que la
  //      résolution interne (ni géométrie ni post-process). « perf auto » pilote alors le stepper.
  const RES_LABEL = "résolution";
  const PERF_TICK_MS = 1000; // cadence d'ajustement adaptatif
  let autoPerf = false;
  let perfAcc = 0;
  const setScaling = (lvl: number): void => {
    engine.setHardwareScalingLevel(lvl);
    hud.setDebugStepperValue(RES_LABEL, lvl);
  };
  hud.addDebugStepper(
    RES_LABEL, engine.getHardwareScalingLevel(), SCALE_MIN, SCALE_MAX, SCALE_STEP,
    (lvl) => engine.setHardwareScalingLevel(lvl), // manuel : « perf auto » écrasera s'il est ON
    (lvl) => `${Math.round(100 / lvl)} %`, // résolution linéaire vs natif
  );
  hud.addDebugToggle("perf auto", autoPerf, (on) => { autoPerf = on; perfAcc = 0; });

  // ---- RÉSEAU (hôte-autoritaire, §7) ----
  const net = new NetRoom();
  hud.setNetStatus("Hors-ligne", false);

  // Snapshot = COPIE de l'état autoritaire complet (sérialiseur unique -> plus aucun champ oublié)
  // + revendication d'autorité de l'émetteur (anti split-brain). `structuredClone` : défense contre
  // toute mutation entre l'émission et la sérialisation (coût négligeable, l'objet est petit).
  function snapshot(): StateSyncMsg {
    return { state: structuredClone(state), host: { id: net.selfId, forced: net.isForcedHost, epoch: net.epoch } };
  }

  // Régénère TOUTE la couche monde locale pour la graine courante de `state` (changement de /seed
  // ou PRESTIGE). Idempotent vis-à-vis du rendu (re-pose terrain/sites/intérieurs, vide les FX).
  function regenerateWorld(): void {
    configureBorders(state.worldSeed);
    worldMap = generateWorld(state.worldSeed);
    registerPlateaus(worldMap); // aplanissement aux sites AVANT de regénérer le terrain
    terrain.regenerate(worldMap, player.position);
    sites.placeAll(worldMap, entities);
    interiors.setMap(worldMap);
    shipInterior.setMap(worldMap);
    siteLoot.setMap(worldMap);
    encounterFx.clearAll(); // les ennemis du monde précédent n'ont plus lieu d'être
    groundDrops.clearAll();
  }

  function adoptSnapshot(s: StateSyncMsg): void {
    const seedChanged = s.state.worldSeed !== worldMap.seed;
    state = s.state; // remplacement INTÉGRAL (cabinTier, builderTendingUntil, échéances, rng… tout est là)
    if (seedChanged) regenerateWorld(); // l'hôte a changé la graine (/seed ou prestige) -> on régénère
  }

  function applyAuthoritative(action: PlayerAction): void {
    state = reduce(state, action);
    if (net.connected) net.broadcastStateSync(snapshot());
  }
  function emit(action: PlayerAction): void {
    if (!net.connected || net.isHost) applyAuthoritative(action);
    else net.sendGameActionToHost(action);
  }

  const self = () => net.selfId;

  // ====== INTERACTIONS DIÉGÉTIQUES ======
  // Craftables RÉVÉLÉS (présentation, COLLANT + PERSISTÉ, façon A Dark Room) : une fois débloqué,
  // l'élément reste dans la liste de construction (grisé si pas les moyens), même après un
  // rechargement. Donnée LOCALE de présentation (≠ GameState déterministe), restaurée du disque.
  const discovered = new Set<string>(loadDiscovered());
  const pendingReveal = new Set<string>(); // révélés mais pas encore vus -> « ! » au-dessus de la constructrice
  const justRevealed = new Set<string>(); // vus dans le dialogue OUVERT -> badge « nouveau » (vidé à la fermeture)
  /** Le joueur « voit » les nouveautés : on passe pendingReveal -> justRevealed (badge), « ! » s'éteint. */
  function acknowledgeReveals(): void {
    for (const id of pendingReveal) justRevealed.add(id);
    pendingReveal.clear();
  }
  let chopCooldown = 0; // « couper prend du temps » : délai entre deux coups de hache

  /** Révèle les craftables selon la règle d'A Dark Room (`craftableRevealed` : ½ du bois + chaque
   *  autre ingrédient « vu » ≥ 1, ou déjà bâti). Gate D4 : rien avant la cabane réparée (≈ builder
   *  lvl 4 d'ADR). Révélation COLLANTE et persistée ; chaque nouveauté alimente `pendingReveal`
   *  (le « ! » au-dessus de la constructrice + le badge « nouveau »). Donnée LOCALE de présentation. */
  function updateDiscovered(): boolean {
    if (!state.cabinRepaired) return false;
    let grew = false;
    for (const c of craftables) {
      if (discovered.has(c.id)) continue;
      if (craftableRevealed(c, state.resources, state.buildings[c.id] ?? 0)) {
        discovered.add(c.id);
        pendingReveal.add(c.id);
        grew = true;
      }
    }
    if (grew) saveDiscovered([...discovered]);
    return grew;
  }

  function formatCost(cost: Record<string, number>): string {
    return Object.keys(cost).map((r) => `${cost[r]} ${RESOURCE_LABELS[r] ?? r}`).join(", ");
  }

  /** Allumer / nourrir le feu — consomme le bois DU SAC. */
  function interactFire(): void {
    if (state.fire === Fire.Dead) {
      emit(lightFire(self()));
      audio.playSfx("lightFire");
    } else if (state.fire >= Fire.Roaring) {
      hud.toast("le feu rugit déjà.");
    } else if (carriedOf(state, self(), "wood") < config.fire.stokeCost) {
      hud.toast(`il faut ${config.fire.stokeCost} bois dans le sac.`);
    } else {
      emit(stokeFire(self()));
      audio.playSfx("stokeFire");
    }
  }

  /** Un coup de hache sur un arbre : remplit le sac, abat l'arbre au bout de N coups. */
  function chopTree(id: number): void {
    if (chopCooldown > 0) return; // en plein effort
    if (carriedTotal(state, self()) >= carryCapacity(state)) {
      hud.toast("sac plein — videz-le à la cabane.");
      return;
    }
    emit(gatherWood(self(), config.gather.woodPerChop));
    audio.playSfx("gatherWood");
    chopCooldown = config.gather.chopBusySeconds;
    if (forest.chop(id)) hud.toast("l'arbre s'abat.");
  }

  /** Couper un arbre SAUVAGE (hors village) : pas de tooltip, MAIS même comportement que la
   *  forêt du camp — plusieurs coups, rétrécissement/secousse, chute animée, feuilles, et
   *  +woodPerChop par coup. (L'arbre réapparaît au rechargement du chunk.) */
  function chopWildTree(): void {
    if (chopCooldown > 0) return; // un coup « prend du temps »
    if (carriedTotal(state, self()) >= carryCapacity(state)) {
      hud.toast("sac plein — videz-le à la cabane.");
      return;
    }
    const hit = terrain.chopNearestTree(player.position.x, player.position.z, config.gatherRange);
    if (!hit) return;
    emit(gatherWood(self(), config.gather.woodPerChop)); // par coup, comme au camp
    audio.playSfx("gatherWood");
    chopCooldown = config.gather.chopBusySeconds;
    forest.burstLeaves(hit.x, hit.y, hit.z, hit.felled ? 22 : 9); // mêmes feuilles que le camp
    if (hit.felled) hud.toast("l'arbre s'abat.");
  }

  function depositAtChest(): void {
    if (carriedTotal(state, self()) <= 0) {
      hud.toast("le sac est vide.");
      return;
    }
    // Surplus PERDU au dépôt : l'entrepôt borne chaque ressource à son plafond (clamp sec dans
    // le reducer pur). On le PRÉDIT localement depuis l'état pré-dépôt — feedback HUD seul, sans
    // toucher à la sim ni au déterminisme.
    const bag = state.carried[self()] ?? {};
    const overflow: string[] = [];
    for (const id of Object.keys(bag)) {
      const total = (state.resources[id] ?? 0) + bag[id];
      if (total - Math.min(storageCap(state.cabinTier, id), total) > 0) overflow.push(RESOURCE_LABELS[id] ?? id);
    }
    emit(deposit(self()));
    audio.playSfx("deposit");
    hud.toast(overflow.length
      ? `entrepôt plein : surplus de ${overflow.join(", ")} perdu`
      : "rangé dans l'entrepôt.");
  }

  // ---- INTERFACES INTERACTIVES (dialogues + menu) ----
  // Règle souris : ouvrir une UI LIBÈRE le pointeur (curseur visible) ; fermer le RECAPTURE.
  // Cliquables à la souris ET navigables au clavier (le dialogue).
  let currentDialogue: (() => DialogueView) | null = null;
  function showDialogue(make: () => DialogueView): void {
    currentDialogue = make;
    hud.openDialogue(make(), false);
    pointerLook.release(); // souris libérée pour cliquer
  }
  function refreshDialogue(): void {
    if (currentDialogue) hud.openDialogue(currentDialogue(), true);
  }
  function openSettings(): void {
    hud.openSettings();
    pointerLook.release();
  }
  /** Ferme toute interface ouverte (dialogue ou menu) et RECAPTURE le pointeur. */
  function closeInteractive(): void {
    currentDialogue = null;
    justRevealed.clear(); // les badges « nouveau » ne valent que pour la session de dialogue
    hud.closeDialogue();
    hud.closeSettings();
    pointerLook.engage(); // appelé dans un geste (clic/Échap) -> recapture
  }

  function buildChoices(): DialogueChoice[] {
    const choices: DialogueChoice[] = [];
    for (const c of craftables) {
      // Construit + EN CHANTIER : le coût/plafond suit le rang du prochain exemplaire commandé
      // (sinon on pourrait enfiler plusieurs chantiers au même prix et dépasser le maximum).
      const count = plannedCount(state, c.id);
      if (!discovered.has(c.id)) continue; // pas encore débloqué (révélation gérée par updateDiscovered)
      const cost = craftableCost(c, count);
      const affordable = Object.keys(cost).every((r) => (state.resources[r] ?? 0) >= cost[r]);
      const maxed = count >= c.maximum;
      // Info-bulle au survol : ce qu'il manque à l'entrepôt (le message n'encombre plus le dialogue).
      const missing = Object.keys(cost)
        .map((r) => ({ r, lack: cost[r] - Math.floor(state.resources[r] ?? 0) }))
        .filter((m) => m.lack > 0);
      // On N'AFFICHE PAS le plafond (`c.maximum`) : la limite reste une découverte du joueur.
      // Le compte de ce qu'il a déjà bâti, lui, est légitime (c'est son propre geste).
      const isNew = justRevealed.has(c.id);
      // Survol : pour une NOUVEAUTÉ, le message narratif d'ADR ; sinon ce qui manque / le plafond.
      const tooltip = isNew && c.availableMsg
        ? c.availableMsg
        : maxed
          ? "inutile d'en bâtir davantage" // découverte au moment où on bute dessus (sans révéler le chiffre)
          : missing.length
            ? `il manque : ${missing.map((m) => `${m.lack} ${RESOURCE_LABELS[m.r] ?? m.r}`).join(", ")}`
            : undefined;
      choices.push({
        label: count > 0 ? `${c.name} ${count}` : c.name,
        // Coût affiché UNIQUEMENT pour ce qui peut encore être construit (rien sur un bâtiment au plafond).
        sublabel: maxed ? undefined : formatCost(cost),
        tooltip,
        isNew,
        enabled: !maxed && affordable,
        onSelect: () => { emit(build(self(), c.id)); audio.playSfx("build"); refreshDialogue(); },
      });
    }
    // Amélioration de l'entrepôt (×1 -> ×5 -> ×10) : coût puisé dans l'entrepôt.
    const next = nextCabinTier(state.cabinTier);
    if (state.cabinRepaired && next !== null) {
      const ucost = cabinUpgradeCost[next] ?? {};
      const affordable = Object.keys(ucost).every((r) => (state.resources[r] ?? 0) >= ucost[r]);
      const missing = Object.keys(ucost)
        .map((r) => ({ r, lack: ucost[r] - Math.floor(state.resources[r] ?? 0) }))
        .filter((m) => m.lack > 0);
      choices.push({
        label: `agrandir l'entrepôt (×${next})`,
        sublabel: formatCost(ucost),
        tooltip: missing.length ? `il manque : ${missing.map((m) => `${m.lack} ${RESOURCE_LABELS[m.r] ?? m.r}`).join(", ")}` : undefined,
        enabled: affordable,
        onSelect: () => { emit(upgradeCabin(self())); audio.playSfx("build"); refreshDialogue(); },
      });
    }
    return choices;
  }

  function buildView(): DialogueView {
    return {
      speaker: "la constructrice",
      text: "« qu'est-ce qu'on bâtit ? »",
      choices: [
        ...buildChoices(),
        // M8/M10 — fabrication d'OBJETS simples (sans atelier : la torche, fidèle au room-craft ADR).
        { label: "fabriquer un objet…", enabled: true, onSelect: () => showDialogue(craftViewBuilder) },
        { label: "(s'éloigner)", enabled: true, onSelect: closeInteractive },
      ],
    };
  }

  // M8/M10 — vue « FABRIQUER » réutilisable : liste les `craftableItems` accessibles. `atelier` :
  // true = station d'artisanat (E sur l'atelier construit — tous les items dont le prérequis
  // bâtiment est satisfait) ; false = via la constructrice (items SANS bâtiment requis, ex. torche).
  // Coûts puisés dans l'ENTREPÔT, l'objet va au SAC (guards sim CRAFT_ITEM : recette/bâtiment/place).
  function craftView(atelier: boolean): DialogueView {
    const items = craftableItems.filter((it) =>
      atelier ? !it.building || (state.buildings[it.building] ?? 0) > 0 : !it.building,
    );
    const room = carryCapacity(state) - carriedTotal(state, self()) > 0;
    const choices: DialogueChoice[] = items.map((it) => {
      const isUpgrade = it.type === "upgrade"; // M10 : possession du village -> entrepôt, max 1
      const owned = isUpgrade && it.maximum !== undefined && stockOf(state, it.id) >= it.maximum;
      const needsRoom = !isUpgrade && !room; // un upgrade ne prend pas de place de sac
      const missing = Object.keys(it.recipe)
        .map((r) => ({ r, lack: it.recipe[r] - Math.floor(state.resources[r] ?? 0) }))
        .filter((m) => m.lack > 0);
      return {
        label: it.name,
        sublabel: owned ? "déjà possédé" : Object.keys(it.recipe).map((r) => `${it.recipe[r]} ${RESOURCE_LABELS[r] ?? r}`).join(", "),
        tooltip: needsRoom
          ? "sac plein"
          : missing.length && !owned
            ? `il manque : ${missing.map((m) => `${m.lack} ${RESOURCE_LABELS[m.r] ?? m.r}`).join(", ")}`
            : undefined,
        enabled: !owned && missing.length === 0 && !needsRoom,
        onSelect: () => {
          emit(craftItem(self(), it.id));
          audio.playSfx("deposit");
          hud.toast(isUpgrade ? `${it.name} — le village s'équipe.` : `${it.name} — dans votre sac.`);
          refreshDialogue();
        },
      };
    });
    return {
      speaker: atelier ? "l'atelier" : "la constructrice",
      text: atelier ? "l'établi est prêt. qu'est-ce qu'on fabrique ?" : "« je peux te préparer quelques objets simples. »",
      choices: [...choices, { label: "(fermer)", enabled: true, onSelect: closeInteractive }],
    };
  }
  const craftViewBuilder = (): DialogueView => craftView(false);
  const craftViewWorkshop = (): DialogueView => craftView(true);

  // M10 — POSTE DE TRAITE : vue de commerce (Room.TradeGoods d'ADR — coûts exacts, fourrure/
  // écailles/dents = monnaies). Achats payés à l'ENTREPÔT, gains à l'ENTREPÔT (guards sim BUY).
  function tradeView(): DialogueView {
    const choices: DialogueChoice[] = tradeGoods.map((g) => {
      const missing = Object.keys(g.cost)
        .map((r) => ({ r, lack: g.cost[r] - Math.floor(state.resources[r] ?? 0) }))
        .filter((m) => m.lack > 0);
      return {
        label: RESOURCE_LABELS[g.id] ?? g.id,
        sublabel: Object.keys(g.cost).map((r) => `${g.cost[r]} ${RESOURCE_LABELS[r] ?? r}`).join(", "),
        tooltip: missing.length
          ? `il manque : ${missing.map((m) => `${m.lack} ${RESOURCE_LABELS[m.r] ?? m.r}`).join(", ")}`
          : undefined,
        enabled: missing.length === 0,
        onSelect: () => { emit(buy(self(), g.id)); audio.playSfx("buy"); refreshDialogue(); },
      };
    });
    return {
      speaker: "le poste de traite",
      text: "les étals sont garnis. la fourrure fait foi.",
      choices: [...choices, { label: "(fermer)", enabled: true, onSelect: closeInteractive }],
    };
  }
  const tradeViewRef = (): DialogueView => tradeView();

  // M10 — COFFRE : « tout déposer » + S'ÉQUIPER (l'outfitting d'ADR : retirer des consommables
  // d'expédition de l'entrepôt vers le sac — action WITHDRAW bornée par stock & capacité).
  const OUTFIT_IDS = ["cured meat", "medicine", "bullets", "grenade", "torch", "bait"];
  function chestView(): DialogueView {
    const total = Math.floor(carriedTotal(state, self()));
    const cap = carryCapacity(state);
    const steppers: DialogueStepper[] = OUTFIT_IDS
      .filter((id) => stockOf(state, id) > 0 || carriedOf(state, self(), id) > 0)
      .map((id) => ({
        label: RESOURCE_LABELS[id] ?? id,
        value: `${Math.floor(carriedOf(state, self(), id))}`,
        sublabel: `entrepôt : ${Math.floor(stockOf(state, id))}`,
        canDec: false, // re-déposer = « tout déposer » (DEPOSIT vide le sac entier)
        canInc: stockOf(state, id) > 0 && total < cap,
        onDec: () => {},
        onInc: () => { emit(withdraw(self(), id, 1)); refreshDialogue(); },
      }));
    return {
      speaker: "le coffre",
      text: `votre sac : ${total}/${cap}. prendre des vivres pour la route, ou tout déposer.`,
      steppers,
      choices: [
        { label: "tout déposer", sublabel: total > 0 ? `${total} au total` : "(sac vide)", enabled: total > 0,
          onSelect: () => { depositAtChest(); refreshDialogue(); } },
        { label: "(fermer)", enabled: true, onSelect: closeInteractive },
      ],
    };
  }
  const chestViewRef = (): DialogueView => chestView();

  // M11/E2 — LE VAISSEAU : réparer l'épave avec l'alliage (l'écran Ship d'ADR). Renforcer la coque
  // (PV de l'ascension) / calibrer le moteur (réduit la difficulté du décollage). Le décollage (E3)
  // s'arme une fois la coque minimale atteinte — annoncé ici pour donner le cap.
  /** Position-monde du vaisseau — l'ANCRE AU CAMP (RF1b : réparé/décollé depuis la base, fidèle ADR). */
  function shipWorldPos(): { x: number; z: number } {
    return shipAtCamp.worldPos();
  }
  function shipView(): DialogueView {
    const alloy = Math.floor(stockOf(state, "alien alloy"));
    const { hull, engine } = state.ship;
    const ready = hull >= SHIP.liftoffHullMin;
    return {
      speaker: "le vaisseau",
      text: `coque ${hull}/${SHIP.hullMax} · moteur ${engine}/${SHIP.engineMax} · alliage en réserve : ${alloy}. `
        + (ready ? "la coque tiendra l'ascension." : `il faut au moins ${SHIP.liftoffHullMin} de coque pour décoller.`),
      choices: [
        {
          label: "renforcer la coque", sublabel: `${SHIP.alloyPerHull} alliage → +1 coque`,
          tooltip: hull >= SHIP.hullMax ? "coque au maximum" : (alloy < SHIP.alloyPerHull ? "pas assez d'alliage" : undefined),
          enabled: hull < SHIP.hullMax && alloy >= SHIP.alloyPerHull,
          onSelect: () => { emit(reinforceShip(self())); audio.playSfx("build"); refreshDialogue(); },
        },
        {
          label: "calibrer le moteur", sublabel: `${SHIP.alloyPerEngine} alliage → +1 poussée`,
          tooltip: engine >= SHIP.engineMax ? "moteur au maximum" : (alloy < SHIP.alloyPerEngine ? "pas assez d'alliage" : undefined),
          enabled: engine < SHIP.engineMax && alloy >= SHIP.alloyPerEngine,
          onSelect: () => { emit(upgradeEngine(self())); audio.playSfx("build"); refreshDialogue(); },
        },
        {
          label: "DÉCOLLER", sublabel: ready ? "quitter cette planète" : `coque insuffisante (${hull}/${SHIP.liftoffHullMin})`,
          tooltip: ready ? undefined : "renforce d'abord la coque",
          enabled: ready,
          onSelect: () => showDialogue(liftoffConfirmView), // point-of-no-return : on confirme
        },
        { label: "(fermer)", enabled: true, onSelect: closeInteractive },
      ],
    };
  }
  const shipViewRef = (): DialogueView => shipView();
  // Confirmation du décollage (point-of-no-return — standard de l'industrie avant un climax irréversible).
  const liftoffConfirmView = (): DialogueView => ({
    speaker: "le vaisseau",
    text: "les moteurs grondent. une fois lancés, plus de retour en arrière — il faudra percer l'atmosphère. prêt ?",
    choices: [
      { label: "décoller — quitter ce monde", enabled: true, onSelect: () => { const w = shipWorldPos(); emit(liftOff(self(), w.x, w.z)); closeInteractive(); } },
      { label: "pas encore", enabled: true, onSelect: () => showDialogue(shipViewRef) },
    ],
  });

  // M11/E4 — ÉCRAN DE FIN (épilogue) + PRESTIGE (NG+). Ouvert à l'évasion ; « recommencer » réamorce
  // un monde neuf (graine fraîche) en reportant les perks. « contempler » laisse l'écran ouvert.
  function restartWorld(): void {
    const before = state.worldSeed;
    emit(prestige(self())); // hôte/hors-ligne -> applique localement ; client -> demande à l'hôte (snapshot)
    closeInteractive();
    if (state.worldSeed !== before) { // appliqué localement -> régénère le monde + réveil au camp
      regenerateWorld();
      player.teleport(cabin.center.x + 1, cabin.center.z + 0.5);
      cameraFollow = true;
      saveGame(state);
    }
    hud.toast(`un monde neuf s'éveille. (évasions : ${state.prestige})`);
  }
  const endingView = (): DialogueView => ({
    speaker: "épilogue",
    text: "le vaisseau perce les nuages, puis le vide. la planète sombre rétrécit — un point, puis rien. "
      + "derrière vous, un feu que vous avez nourri ; devant, les étoiles. vous êtes libre.",
    choices: [
      { label: "recommencer — un monde neuf", enabled: true, onSelect: restartWorld },
      { label: "contempler les étoiles", enabled: true, onSelect: () => { /* reste sur l'écran de fin */ } },
    ],
  });
  const endingViewRef = (): DialogueView => endingView();

  function formatStores(stores: Record<string, number>): string {
    return Object.keys(stores).map((s) => `${stores[s] > 0 ? "+" : ""}${stores[s]} ${RESOURCE_LABELS[s] ?? s}`).join(", ");
  }

  function workerSteppers(): DialogueStepper[] {
    const free = freeWorkers(state);
    const steppers: DialogueStepper[] = [];
    for (const j of jobs) {
      if (j.building && (state.buildings[j.building] ?? 0) === 0) continue;
      // Le bûcheron est l'occupation par défaut (le « reste ») : listé comme les autres, mais
      // SANS +/- (on ne l'assigne pas, on reconvertit des bûcherons vers les métiers).
      if (j.id === "gatherer") {
        steppers.push({
          label: j.name,
          value: String(free),
          sublabel: formatStores(j.stores),
          canDec: false,
          canInc: false,
          onDec: () => {},
          onInc: () => {},
          readOnly: true,
        });
        continue;
      }
      const n = state.workers[j.id] ?? 0;
      steppers.push({
        label: j.name,
        value: String(n),
        sublabel: formatStores(j.stores),
        canDec: n > 0,
        canInc: free > 0,
        onDec: () => { emit(unassignWorker(self(), j.id)); refreshDialogue(); },
        onInc: () => { emit(assignWorker(self(), j.id)); refreshDialogue(); },
      });
    }
    return steppers;
  }

  // Le GRAND TABLEAU (dans la cabane) gère la répartition des villageois (Temps 2).
  function workersView(): DialogueView {
    return {
      speaker: "le tableau du village",
      text: "qui fait quoi au village ?",
      steppers: workerSteppers(),
      choices: [{ label: "(fermer)", enabled: true, onSelect: closeInteractive }],
    };
  }

  // La CONSTRUCTRICE : réparer la cabane, puis construire.
  function rootView(): DialogueView {
    const speaker = "la constructrice";
    if (state.builder < config.fire.builder.maxLevel) {
      return { speaker, text: "« laisse-moi me réchauffer encore un peu près du feu… »",
        choices: [{ label: "(s'éloigner)", enabled: true, onSelect: closeInteractive }] };
    }
    if (!state.cabinRepaired) {
      const have = Math.floor(carriedOf(state, self(), "wood"));
      const cost = config.cabinRepairCost;
      return {
        speaker,
        text: "« cette vieille cabane tient encore debout. aide-moi à la remettre d'aplomb. »",
        choices: [
          { label: "réparer la cabane", sublabel: `${cost} bois (sac : ${have})`, enabled: have >= cost,
            onSelect: () => { emit(repairCabin(self())); audio.playSfx("build"); refreshDialogue(); } },
          { label: "(s'éloigner)", enabled: true, onSelect: closeInteractive },
        ],
      };
    }
    // Cabane réparée → directement la liste de construction (plus de dialogue d'intro inutile).
    return buildView();
  }

  function openBuilderDialogue(): void { acknowledgeReveals(); showDialogue(rootView); }
  function openBoard(): void { showDialogue(workersView); }

  // M5 — panneau d'ÉVÉNEMENT : la scène courante de l'état -> DialogueView (réutilise le dialogue).
  // L'ouverture/fermeture/rafraîchissement est piloté par le watcher dans reflectState (l'état
  // fait foi : en P2P, l'événement arrive par snapshot et les deux joueurs voient le même panneau).
  function eventView(): DialogueView {
    const active = state.activeEvent;
    const ev = active ? eventById[active.id] : undefined;
    const scene = ev && active ? ev.scenes[active.scene] : undefined;
    if (!ev || !scene) {
      return { speaker: "", text: "", choices: [{ label: "(fermer)", enabled: true, onSelect: closeInteractive }] };
    }
    const choices: DialogueChoice[] = scene.choices
      .filter((c) => c.available?.(state) ?? true)
      .map((c) => {
        const missing = c.cost
          ? Object.keys(c.cost)
              .map((r) => ({ r, lack: c.cost![r] - Math.floor(state.resources[r] ?? 0) }))
              .filter((m) => m.lack > 0)
          : [];
        return {
          label: c.text,
          sublabel: c.cost ? formatCost(c.cost) : undefined,
          tooltip: missing.length
            ? `il manque : ${missing.map((m) => `${m.lack} ${RESOURCE_LABELS[m.r] ?? m.r}`).join(", ")}`
            : undefined,
          enabled: missing.length === 0,
          onSelect: () => emit(resolveEventChoice(self(), c.id)),
        };
      });
    return { speaker: ev.title, text: scene.text.join(" "), choices };
  }

  // Échap (global) : ferme l'interface ouverte, sinon ouvre le menu Paramètres.
  // (NB : Échap libère aussi le pointer lock côté navigateur — c'est voulu pour le menu.)
  // Sinon, navigation clavier du DIALOGUE (la souris marche aussi : curseur libéré).
  hud.onSettingsResume(() => closeInteractive());
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "f3") { e.preventDefault(); hud.toggleDebug(); return; } // bascule l'overlay debug
    if (k === "f2") { e.preventDefault(); spawnEditor?.toggle(); return; } // éditeur de spawn (DEV)
    if (k === "escape") {
      e.preventDefault();
      // Un événement est MODAL : on ne peut pas le fermer sans choisir (chaque scène a une
      // option gratuite). Sinon il resterait actif et invisible -> bloquerait les suivants.
      if (state.activeEvent && currentDialogue === eventView) return;
      if (hud.interactiveOpen) closeInteractive();
      else openSettings();
      return;
    }
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    // V (hors UI) : bascule 1ʳᵉ/3ᵉ personne (filet manuel, en plus de l'auto en intérieur).
    if (k === "v" && !hud.interactiveOpen) { forceFpv = !forceFpv; e.preventDefault(); return; }
    // R (MAINTENU, hors UI) : zoom « longue-vue » (façon OptiFine). Relâché -> keyup ci-dessous.
    if (k === "r" && !hud.interactiveOpen && !devConsole?.isOpen && !spawnEditor?.active) {
      zoomHeld = true;
      e.preventDefault();
      return;
    }
    // ENTER (hors UI) -> ouvre la CONSOLE DE DEV (montée en DEV uniquement). Ensuite la
    // console capte sa propre saisie (stopPropagation) : ce listener ne la voit plus.
    if (k === "enter" && devConsole && !hud.interactiveOpen && !devConsole.isOpen) {
      devConsole.openConsole();
      e.preventDefault();
      return;
    }
    if (!hud.dialogueOpen) return; // (le menu se manie à la souris)
    if (k === "arrowup" || k === "z" || k === "w") { hud.dialogueNavigate(-1); e.preventDefault(); }
    else if (k === "arrowdown" || k === "s") { hud.dialogueNavigate(1); e.preventDefault(); }
    else if (k === "arrowleft" || k === "q" || k === "a") { hud.dialogueAdjust(-1); e.preventDefault(); }
    else if (k === "arrowright" || k === "d") { hud.dialogueAdjust(1); e.preventDefault(); }
    else if (k === "e" || k === "enter") { hud.dialogueConfirm(); e.preventDefault(); }
  });
  // Relâcher R -> fin du zoom (toujours, même si une UI s'est ouverte entre-temps).
  window.addEventListener("keyup", (e) => { if (e.key.toLowerCase() === "r") zoomHeld = false; });

  // ---- Détection de l'interactable le plus proche (étiquette + action E) ----
  interface Focus { world: Vector3; verb: string; act: () => void; }

  function computeFocus(): Focus | null {
    const p = player.position;

    // M8.6 — COMBAT : si le joueur est ENGAGÉ dans une rencontre partagée (à portée), elle DOMINE le
    // contexte (E = frapper avec la meilleure arme PRÊTE ; « frapper… » pendant la recharge, calque du
    // « coupe… » des arbres). Court-circuite tout autre focus. L'ennemi est ancré dans le monde.
    const engaged = selfEngagedEnc();
    if (engaged) {
      const { id, enc } = engaged;
      const w = bestReadyWeapon(state, self(), enc);
      return {
        world: new Vector3(enc.x, terrainHeight(enc.x, enc.z) + 1.7, enc.z),
        verb: w ? "frapper" : "frapper…",
        act: w
          ? () => {
              emit(attack(self(), w.id, id));
              audio.playSfx(w.id === "fists" ? "weaponUnarmed" : "weaponMelee");
            }
          : () => {},
      };
    }

    let best: Focus | null = null;
    let bestD = Infinity;
    const consider = (dist: number, range: number, make: () => Focus) => {
      if (dist <= range && dist < bestD) { bestD = dist; best = make(); }
    };

    // M8/M10 — ATELIER construit : station d'artisanat (« fabriquer » : torche, lance d'os…).
    if ((state.buildings["workshop"] ?? 0) > 0) {
      for (const wp of village.getBuildingPositions("workshop")) {
        consider(Math.hypot(wp.x - p.x, wp.z - p.z), config.cabinRange, () => ({
          world: new Vector3(wp.x, terrainHeight(wp.x, wp.z) + 2.2, wp.z),
          verb: "fabriquer",
          act: () => showDialogue(craftViewWorkshop),
        }));
      }
    }
    // M10 — POSTE DE TRAITE construit : commerce (« commercer » : Room.TradeGoods d'ADR).
    if ((state.buildings["trading post"] ?? 0) > 0) {
      for (const tp of village.getBuildingPositions("trading post")) {
        consider(Math.hypot(tp.x - p.x, tp.z - p.z), config.cabinRange, () => ({
          world: new Vector3(tp.x, terrainHeight(tp.x, tp.z) + 2.4, tp.z),
          verb: "commercer",
          act: () => showDialogue(tradeViewRef),
        }));
      }
    }

    // Feu (centre).
    consider(Math.hypot(p.x, p.z), config.fire.interactRange, () => ({
      world: new Vector3(0, terrainHeight(0, 0) + 1.7, 0),
      verb: state.fire === Fire.Dead ? "raviver le feu" : "nourrir le feu",
      act: interactFire,
    }));

    // Constructrice.
    if (stranger.isActive) {
      const s = stranger.position;
      consider(Math.hypot(s.x - p.x, s.z - p.z), config.builderRange, () => ({
        world: new Vector3(s.x, s.y + 1.3, s.z), verb: "parler", act: openBuilderDialogue,
      }));
    }

    // Coffre + grand tableau de l'entrepôt (une fois la cabane réparée).
    if (cabin.isRepaired) {
      const c = cabin.chestPosition;
      consider(Math.hypot(c.x - p.x, c.z - p.z), config.cabinRange, () => ({
        world: new Vector3(c.x, c.y + 1.2, c.z), verb: "ouvrir le coffre", act: () => showDialogue(chestViewRef),
      }));
      const b = cabin.boardPosition;
      consider(Math.hypot(b.x - p.x, b.z - p.z), config.cabinRange, () => ({
        world: new Vector3(b.x, b.y + 1.9, b.z), verb: "organiser le village", act: openBoard,
      }));
    }

    // Pièges — chacun INDIVIDUELLEMENT, et seulement s'il est PLEIN (relevable).
    village.getTrapPositions().forEach((t, i) => {
      if (state.tick < (state.trapReadyAt[i] ?? 0)) return; // ce piège est vide -> pas d'interaction
      consider(Math.hypot(t.x - p.x, t.z - p.z), config.trapRange, () => ({
        world: new Vector3(t.x, terrainHeight(t.x, t.z) + 1.2, t.z),
        verb: "relever le piège", act: () => { emit(harvestTrap(self(), i)); audio.playSfx("checkTraps"); },
      }));
    });

    // Arbres (le plus proche dans le rayon).
    let tree: { id: number; x: number; z: number } | null = null;
    let treeD: number = config.gatherRange;
    for (const t of forest.getTrees()) {
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d <= treeD) { treeD = d; tree = t; }
    }
    if (tree) {
      const t = tree;
      consider(treeD, config.gatherRange, () => ({
        world: new Vector3(t.x, terrainHeight(t.x, t.z) + 2.6, t.z),
        verb: chopCooldown > 0 ? "coupe…" : "couper",
        act: () => chopTree(t.id),
      }));
    }

    // M9 — caches/filons de l'intérieur souterrain actif (butin 3D, premier-servi). On saute ceux
    // déjà pris (état sim). Le filon d'une mine : « exploiter » = ramasser le minerai + SÉCURISER (métier).
    for (const lt of interiors.activeLoot()) {
      if (state.sites?.[lt.cx + "," + lt.cz]?.taken?.[lt.nodeId]) continue;
      const d = Math.hypot(lt.x - p.x, lt.z - p.z);
      const isFilon = lt.kind === "deep" && lt.siteType.endsWith("mine");
      // M8.5/F3.1-F3.2 : filon de MINE gardé / CACHE FINALE de grotte au bout du setpiece —
      // la séquence scriptée (combats, torche qui s'éteint) doit être franchie d'abord.
      const isCaveEnd = lt.siteType === "cave" && lt.nodeId === "end";
      const stepsTotal = isFilon
        ? (mineGuardians[lt.siteType]?.length ?? 0)
        : isCaveEnd
          ? caveSteps(lt.cx, lt.cz, state.worldSeed).length
          : 0;
      const stepsDone = state.sites?.[lt.cx + "," + lt.cz]?.guardians ?? 0;
      if ((isFilon || isCaveEnd) && stepsDone < stepsTotal) {
        const next = isCaveEnd ? caveSteps(lt.cx, lt.cz, state.worldSeed)[stepsDone] : null;
        const isGate = next?.kind === "gate";
        consider(d, isCaveEnd ? 14.0 : 5.0, () => ({
          world: new Vector3(lt.x, lt.y + 0.6, lt.z),
          verb: isGate ? "rallumer une torche (1 torche)" : isCaveEnd ? "avancer dans le noir" : "affronter le gardien",
          act: () => {
            if (isGate && carriedOf(state, self(), "torch") < 1) { hud.toast("la torche s'éteint — il en faut une autre pour continuer."); return; }
            emit(engageGuardian(self(), lt.cx, lt.cz, lt.siteType));
            if (isGate) hud.toast("vous rallumez une torche — l'obscurité recule.");
          },
        }));
        continue;
      }
      consider(d, 3.6, () => ({
        world: new Vector3(lt.x, lt.y + 0.6, lt.z),
        verb: isFilon ? "exploiter le filon" : "ramasser",
        act: () => {
          emit(takeLoot(self(), lt.cx, lt.cz, lt.siteType, lt.nodeId));
          if (isFilon) { emit(secureMine(self(), lt.cx, lt.cz, lt.siteType)); hud.toast("filon sécurisé — un mineur peut être assigné au village."); }
          else hud.toast("butin ramassé.");
          audio.playSfx("checkTraps");
        },
      }));
    }

    // R3/R3b — FOUILLE DE SURFACE : forages/champs de bataille (butin libre) ET villes/cités, dont
    // la CACHE FINALE (`end`) est GARDÉE par la séquence scriptée (voyous, bête, justicier, combats
    // forcés d'hôpital…) — à franchir avant de la piller (fidèle aux setpieces town/city d'ADR).
    for (const lt of siteLoot.activeLoot()) {
      const sp = state.sites?.[lt.cx + "," + lt.cz];
      if (sp?.taken?.[lt.nodeId]) continue; // déjà fouillé
      const isDungeonEnd = (lt.siteType === "town" || lt.siteType === "city") && lt.nodeId === "end";
      if (isDungeonEnd) {
        const steps = townSteps(lt.siteType as "town" | "city", lt.cx, lt.cz, state.worldSeed);
        const done = sp?.guardians ?? 0;
        if (done < steps.length) {
          const next = steps[done];
          const isGate = next?.kind === "gate";
          consider(Math.hypot(lt.x - p.x, lt.z - p.z), 6.0, () => ({
            world: new Vector3(lt.x, lt.y + 0.9, lt.z),
            verb: isGate ? "forcer la porte (1 torche)" : "s'enfoncer dans les ruines",
            act: () => {
              if (isGate && carriedOf(state, self(), "torch") < 1) { hud.toast("il fait trop noir là-dedans — il faut une torche."); return; }
              emit(engageGuardian(self(), lt.cx, lt.cz, lt.siteType));
              if (isGate) hud.toast("vous forcez le passage, torche au poing.");
            },
          }));
          continue;
        }
      }
      consider(Math.hypot(lt.x - p.x, lt.z - p.z), 3.6, () => ({
        world: new Vector3(lt.x, lt.y + 0.6, lt.z),
        verb: "fouiller",
        act: () => {
          emit(takeLoot(self(), lt.cx, lt.cz, lt.siteType, lt.nodeId));
          hud.toast("butin récupéré.");
          audio.playSfx("checkTraps");
        },
      }));
    }

    // M8.5/F3.3-3.4 — MAISONS (fouille one-shot 25/25/50) & MARAIS (charme -> gastronome).
    for (const st of worldMap.sites) {
      if (st.type !== "house" && st.type !== "swamp") continue;
      const k = st.cx + "," + st.cz;
      if (state.sites?.[k]?.visited) continue;
      if (st.type === "swamp" && state.perks["gastronome"]) continue;
      const w = worldMap.cellToWorldCenter(st.cx, st.cz);
      const d = Math.hypot(w.x - p.x, w.z - p.z);
      if (st.type === "house") {
        consider(d, 7.0, () => ({
          world: new Vector3(w.x, terrainHeight(w.x, w.z) + 2.4, w.z),
          verb: "fouiller la maison",
          act: () => { emit(visitHouse(self(), st.cx, st.cz)); audio.playSfx("checkTraps"); },
        }));
      } else {
        consider(d, 7.0, () => ({
          world: new Vector3(w.x, terrainHeight(w.x, w.z) + 2.4, w.z),
          verb: "offrir un charme",
          act: () => {
            if (carriedOf(state, self(), "charm") < 1) { hud.toast("le vieil ermite veut un charme (les pièges en attrapent, rarement)."); return; }
            emit(talkSwamp(self(), st.cx, st.cz));
            hud.toast("l'ermite parle longtemps. la viande nourrira deux fois mieux — gastronome.");
          },
        }));
      }
    }

    // M11/RF2b — LE CUIRASSÉ EXPLORABLE : on PÉNÈTRE par l'antichambre puis on ENTRE salle par salle
    // (ENTER_ROOM -> verrou d'arène + spawn de la vague, combat PARTAGÉ M8.6 ; le focus « frapper »
    // prend le relais). Le pont est SCELLÉ tant que les 3 ailes ne sont pas nettoyées. Le combat est
    // émergent (clear de salle host) — pas de « piller » : la dernière salle (pont) finit le cuirassé.
    for (const et of shipInterior.enterTargets(player.position, state)) {
      const d = Math.hypot(et.world.x - p.x, et.world.z - p.z);
      consider(d, 7.0, () => ({
        world: et.world,
        verb: et.verb,
        act: () => {
          if (et.sealed) { hud.toast("le pont reste scellé — il faut d'abord nettoyer les trois ailes du cuirassé."); return; }
          if (et.room === "antechamber" && !cine.active) {
            // RF5 — pénétrer par le SAS : cinématique de seuil (porte alien + pas franchi + fondu),
            // ENTER_ROOM(antichambre) émis AU FONDU (chargement masqué). 100 % local, timeout-safe.
            const yaw = cameraYaw(camera);
            const fx = Math.sin(yaw), fz = Math.cos(yaw);
            const dx = player.position.x + fx * 3, dz = player.position.z + fz * 3;
            cineDoor.place("ship", dx, terrainHeight(dx, dz) + 0.3, dz, yaw);
            cineDoor.setEnabled(true);
            cineCommit = () => emit(enterRoom(self(), et.cx, et.cz, "antechamber"));
            cine.start("in", "ship");
            audio.playSfx("checkTraps");
          } else {
            emit(enterRoom(self(), et.cx, et.cz, et.room));
            audio.playSfx("weaponMelee");
          }
        },
      }));
    }

    // M11/RF1 — L'ÉPAVE (au bord du monde) : la TROUVER suffit (fidèle ADR : indépendant du cuirassé).
    // Tant qu'on ne l'a pas trouvée -> « découvrir l'épave » (DISCOVER_SHIP). Une fois trouvée, l'épave
    // n'est plus interactive : le vaisseau se gère AU CAMP (RF1b, branche dédiée plus bas).
    if (!state.perks["ship_found"]) {
      for (const st of worldMap.sites) {
        if (st.type !== "ship") continue;
        const w = worldMap.cellToWorldCenter(st.cx, st.cz);
        consider(Math.hypot(w.x - p.x, w.z - p.z), 8.0, () => ({
          world: new Vector3(w.x, terrainHeight(w.x, w.z) + 3.2, w.z),
          verb: "découvrir l'épave",
          act: () => {
            emit(discoverShip(self(), st.cx, st.cz));
            hud.toast("les courbes familières d'un vaisseau wanderer émergent de la cendre — il vous attend désormais au camp.");
            audio.playSfx("checkTraps");
          },
        }));
      }
    }

    // M11/RF1b — LE VAISSEAU AU CAMP : une fois trouvé, on le répare / décolle DEPUIS LA BASE (fidèle ADR).
    if (state.perks["ship_found"]) {
      const sc = shipAtCamp.worldPos();
      consider(Math.hypot(sc.x - p.x, sc.z - p.z), 7.0, () => ({
        world: new Vector3(sc.x, terrainHeight(sc.x, sc.z) + 3.0, sc.z),
        verb: "examiner le vaisseau",
        act: () => showDialogue(shipViewRef),
      }));
    }

    // Reste M7 — AVANT-POSTES : une grotte nettoyée (`cleared`) se ravitaille UNE fois (eau + vivres,
    // usage unique partagé — l'hôte arbitre). Le verbe disparaît une fois l'avant-poste épuisé (`used`).
    // On itère `state.sites` (petit : seuls les sites VISITÉS y vivent), pas les ~57 sites du monde.
    for (const k of Object.keys(state.sites ?? {})) {
      const prog = state.sites[k];
      if (!prog.cleared || prog.usedBy?.[self()]) continue; // une fois PAR EXPÉDITION (M8.5/F4)
      const ci = k.indexOf(",");
      const cx = Number(k.slice(0, ci)), cz = Number(k.slice(ci + 1));
      const w = worldMap.cellToWorldCenter(cx, cz);
      consider(Math.hypot(w.x - p.x, w.z - p.z), config.outpostRange, () => ({
        world: new Vector3(w.x, terrainHeight(w.x, w.z) + 2.4, w.z),
        verb: "se ravitailler",
        act: () => {
          emit(useOutpost(self(), cx, cz));
          audio.playSfx("deposit");
          hud.toast("gourdes et vivres remplis — l'avant-poste est épuisé.");
        },
      }));
    }

    // M8.6 — BUTIN AU SOL : à la mort d'un ennemi, son butin tombe en pile ramassable (premier-servi).
    for (const t of groundDrops.targets()) {
      consider(Math.hypot(t.x - p.x, t.z - p.z), 3.2, () => ({
        world: new Vector3(t.x, t.y + 0.4, t.z),
        verb: "ramasser le butin",
        act: () => {
          emit(takeDrop(self(), t.dropId));
          audio.playSfx("checkTraps");
          hud.toast("butin ramassé.");
        },
      }));
    }

    return best;
  }

  let currentFocus: Focus | null = null;
  let cameraFollow = true;
  // Zoom « longue-vue » (maintien R, façon Minecraft/OptiFine) : resserre le FOV de la caméra
  // pour voir loin avec précision, + réduit la sensibilité souris. Transition lissée.
  // FOV de base réglable (confort) : appliqué à la caméra + base du zoom « longue-vue ».
  let baseFov = savedComfort?.fov ?? camera.fov; // RADIANS (défaut Babylon ≈ 0.8 rad)
  camera.fov = baseFov;
  const ZOOM_FOV = 0.22; // FOV resserré (~12,6°) -> ~3,6× de grossissement
  const ZOOM_SPEED = 12; // vitesse de transition du zoom
  let zoomHeld = false;

  // Câblage des curseurs « Confort » du menu (FOV + sensibilité) — persistés à chaque changement.
  const persistComfort = (): void => saveComfortSettings({ fov: baseFov, sensitivity: sensMul });
  hud.setComfortValues(baseFov, sensMul);
  hud.onComfort((kind, v) => {
    if (kind === "fov") baseFov = v;
    else { sensMul = v; pointerLook.setSensitivity(v); }
    persistComfort();
  });

  // Spring-arm caméra : rapproche le rayon EFFECTIF si un mur de la cabane s'interpose (la caméra
  // passe alors sous le toit, à l'intérieur). Rapprochement rapide (anti-clip), éloignement plus doux.
  const SPRING_MARGIN = 0.45; // marge avant le mur
  const SPRING_MIN = 1.4; // rayon mini (quasi 1ʳᵉ personne dans un coin)
  const SPRING_IN = 26; // vitesse de rapprochement (lissage)
  const SPRING_OUT = 8; // vitesse d'éloignement
  const SPRING_NEAR = 9; // on ne raye que près de la cabane (perf)
  let camOccluders = cabin.occluders();
  const camDir = new Vector3();
  const springRay = new Ray(new Vector3(), new Vector3(0, 0, 1), 1);

  // Bascule 3ᵉ ↔ 1ʳᵉ personne (transition LISSÉE, jamais de cut). FPV auto DANS la cabane
  // (espace renfermé) + toggle manuel (touche V) partout. Réutilise l'ArcRotateCamera : en FPV la
  // cible passe devant les yeux le long de la direction d'orbite (alpha/beta) -> la caméra est à l'œil.
  const FPV_RADIUS = 0.06; // ~0 : la caméra colle à l'œil
  const FPV_EYE_Y = 0.75; // hauteur des yeux au-dessus du CENTRE capsule (~1,65 m du sol)
  const FPV_SPEED = 6; // vitesse de la transition 3e<->1ere (lissage)
  // Tangage FPV : le MÊME beta sert l'élévation d'orbite (3PV) et le regard (FPV). Au repos (3PV
  // beta≈1.05, caméra par-dessus l'épaule), un regard FPV brut viserait ~30° vers le sol. On REMAPPE
  // donc le beta voulu (souris) -> tangage FPV centré sur l'horizon (π/2) au repos, amplifié, borné.
  const FPV_BETA_REST = 1.05; // beta voulu au repos -> regard horizontal en FPV
  const FPV_PITCH_GAIN = 1.4; // amplification du tangage en FPV (regard haut/bas plus marqué)
  const FPV_BETA_MIN = 0.5; // borne basse du tangage FPV (~62° vers le bas)
  const FPV_BETA_MAX = 2.4; // borne haute du tangage FPV (~47° vers le haut)
  // ArcRotate clampe `beta` aux limites caméra. On ÉLARGIT la limite haute pour que la FPV puisse
  // viser l'horizon/le ciel (beta > π/2) ; le beta VOULU reste borné à [0.35,1.45] côté pointerLook
  // (déjà capturé), donc la 3ᵉ personne ne descend pas sous l'horizon malgré cette limite élargie.
  camera.upperBetaLimit = FPV_BETA_MAX;
  let fpv = 0; // 0 = 3e personne, 1 = 1ere personne (valeur lissée)
  let insideCabin = false; // hystérésis d'entrée/sortie de la cabane
  let forceFpv = false; // toggle manuel (V) : force la 1ʳᵉ personne partout
  const ROOF_FADE_SPAN = 4; // largeur (u) de la bande de fondu du toit en 3PV (emprise -> opaque)

  function projectToScreen(world: Vector3): { x: number; y: number; visible: boolean } {
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    const pt = Vector3.Project(world, Matrix.IdentityReadOnly, scene.getTransformMatrix(), camera.viewport.toGlobal(w, h));
    return { x: pt.x, y: pt.y, visible: pt.z > 0 && pt.z < 1 };
  }

  function joinRoomByCode(code: string, asHost = false): void {
    code = code.trim().toUpperCase(); // codes en MAJUSCULES -> appariement insensible à la casse
    net.join(code, {
      onStatus: (text, online) => hud.setNetStatus(text, online),
      onHostChange: (isHost) => { if (isHost) net.broadcastStateSync(snapshot()); },
      onPeerJoin: () => { if (net.isHost) net.broadcastStateSync(snapshot()); },
      onPeerLeave: (id) => remotes.remove(id),
      onTransform: (id, t) => remotes.setTransform(id, t),
      // M8.6 — flux rapide d'ennemis (hôte -> tous) : on alimente les cibles d'interpolation. Les
      // CLIENTS s'en servent ; l'hôte ignore (il simule lui-même les positions autoritaires).
      onEnemies: (m) => { if (!net.isHost) { const pos: Record<string, { x: number; z: number }> = {}; for (const e of m.e) pos[e.id] = { x: e.x, z: e.z }; encounterFx.setPositions(pos); } },
      // L'hôte n'applique QUE les actions réseau sûres (ni `DEBUG_*`, ni usurpation d'identité).
      onGameAction: (action, fromId) => { if (net.isHost && isNetworkSafeAction(action, fromId)) applyAuthoritative(action); },
      onStateSync: (s) => { if (!net.isHost) adoptSnapshot(s); },
      onSplitBrain: () => hud.toast("conflit d'hôte résolu — ta partie adopte l'autre."),
    }, asHost);
    hud.setRoomCode(code);
  }
  // Code de salon : CHIFFRES + LETTRES MAJUSCULES uniquement, 8 caractères. Purement UI.
  function genRoomCode(): string {
    const cs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let s = "";
    for (let i = 0; i < 8; i++) s += cs[Math.floor(Math.random() * cs.length)];
    return s;
  }
  // « Ouvrir ma partie » : génère un code, on devient l'hôte autoritaire, on partage le lien.
  function openGameToOthers(): void {
    const code = genRoomCode();
    joinRoomByCode(code, true);
    const link = `${location.origin}${location.pathname}#room=${code}`;
    hud.showShareCode(code, link);
  }
  hud.onHostGame(openGameToOthers);
  hud.onJoin((code) => joinRoomByCode(code, false));
  const urlCode = new URLSearchParams(location.search).get("room") || location.hash.replace(/^#room=/, "");
  if (urlCode) joinRoomByCode(urlCode, false); // arriver par un lien partagé = rejoindre

  // ---- Reflet de l'état vers le rendu/HUD + toasts narratifs ----
  let prevFire = state.fire;
  let prevBuilder = state.builder;
  let prevCabin = state.cabinRepaired;
  let prevTier = state.cabinTier;
  let prevEventKey: string | null = null; // null au boot -> rouvre un événement restauré d'une sauvegarde
  let prevEventSig = "";
  let prevInVillage: boolean | null = null; // null -> 1ère frame force l'état initial du HUD contextuel
  let prevDeathSeq = survivalOf(state, self()).deathSeq; // M7 : compteur de morts (téléport au camp au +1)
  let prevWinSeq = survivalOf(state, self()).winSeq; // M8 : compteur de victoires (effondrement + toast)
  let prevFlightStatus: string | null = state.flight?.status ?? null; // M11/E3 : transitions évasion/crash
  let lastEncSeen: SharedEncounter | null = null; // dernière rencontre où l'on était engagé (toast gardien)
  let prevDangerTier = -1; // M8 : tier de danger émis (watcher triple avec inVillage/onRoad)
  let prevOnRoad: boolean | null = null;
  let prevDangerWarn = 0; // niveau d'avertissement checkDanger déjà signalé (0/1/2)
  let prevDialogueSig = ""; // signature de l'état dont dépendent les dialogues (resync MP, cf. plus bas)

  /** Tier de DANGER local (0 = zone sûre, 1..3 = anneaux de distance ADR ×2, 4 = caverne). */
  function dangerTier(): number {
    if (interiors.isLocalPlayerInside() || shipInterior.isLocalPlayerInside()) return 4;
    const rCells = Math.hypot(player.position.x, player.position.z) / worldgen.cellSize;
    if (rCells <= worldgen.safeRadiusCells) return 0;
    return rCells <= 16 ? 1 : rCells <= 38 ? 2 : 3;
  }
  /** Le joueur est-il sur une cellule de ROUTE ? (= AUCUNE rencontre, fidèle ADR — M8.5.) */
  function onRoadCell(): boolean {
    const cx = Math.round(player.position.x / worldgen.cellSize);
    const cz = Math.round(player.position.z / worldgen.cellSize);
    return !!state.roads[cx + "," + cz];
  }
  /** Biome du terrain courant (gating des rencontres, fidèle ADR) ; « cave » sous terre. */
  function biomeStr(): string {
    if (interiors.isLocalPlayerInside() || shipInterior.isLocalPlayerInside()) return "cave"; // pas de rencontre aléatoire dans le cuirassé (arènes scriptées)
    const cx = Math.round(player.position.x / worldgen.cellSize);
    const cz = Math.round(player.position.z / worldgen.cellSize);
    const b = worldMap.biomeAt(cx, cz);
    return b === Biome.Forest ? "forest" : b === Biome.Field ? "field" : b === Biome.Barren ? "barrens"
      : b === Biome.Swamp ? "swamp" : "camp";
  }
  function reflectState(): void {
    // Déblocages (façon ADR) : révèle les craftables atteignables, de façon collante + persistée.
    const grew = updateDiscovered();
    // Si le dialogue de la constructrice est OUVERT, on acquitte (badge « nouveau ») et on rafraîchit
    // pour que le bâtiment fraîchement révélé apparaisse tout de suite, sans réouverture.
    if (currentDialogue === rootView && pendingReveal.size > 0) acknowledgeReveals();
    if (grew && currentDialogue === rootView) refreshDialogue();
    // Sac du joueur (ce qu'il porte).
    const bag = state.carried[self()] ?? {};
    const entries: Array<{ label: string; value: number }> = [];
    for (const id of BAG_ORDER) {
      const v = Math.floor(bag[id] ?? 0);
      if (v > 0) entries.push({ label: RESOURCE_LABELS[id] ?? id, value: v });
    }
    hud.setBag(Math.floor(carriedTotal(state, self())), carryCapacity(state), entries);

    // Survie (M6/M7) : jauges eau/vivres/PV (fractions) + observation de la MORT (téléport au camp).
    const sv = survivalOf(state, self());
    const SU = config.survival;
    const capW = maxWaterOf(state); // M10 : caps d'équipement (outre/armure de l'entrepôt)
    const capHp = maxHealthOf(state);
    hud.setSurvival(sv.water / capW, sv.food / SU.maxFood, sv.health / capHp);
    hud.setEatHint(
      (carriedOf(state, self(), "cured meat") > 0 || carriedOf(state, self(), "medicine") > 0) && sv.health < capHp,
    ); // F : manger / se soigner (M8/M10)
    if (sv.deathSeq !== prevDeathSeq) {
      prevDeathSeq = sv.deathSeq;
      // M8.6 : l'ennemi est PARTAGÉ (il survit à notre mort et continue contre les autres) — on ne le
      // retire plus ici ; on quitte simplement l'engagement en réapparaissant au camp (hors de portée).
      audio.playSfx("death");
      player.teleport(cabin.center.x + 1, cabin.center.z + 0.5); // réveil au camp (à côté de la cabane)
      hud.toast("vous vous effondrez — réveil au camp, le sac vidé.");
    }

    hud.setFire(FIRE_LABELS[state.fire]);
    hud.setTemp(TEMP_LABELS[state.temperature]);
    const maxPop = (state.buildings["hut"] ?? 0) * config.population.hutRoom;
    hud.setPopulation(`${state.population}/${maxPop}`);

    // HUD contextuel : le Feu + le Village ne s'affichent que DANS le village (zone sûre) ;
    // en exploration on ne garde que le Sac. Bascule au franchissement du périmètre.
    const inVillage = Math.hypot(player.position.x, player.position.z) <= VILLAGE_RADIUS;
    const tier = dangerTier();
    const onRoad = onRoadCell();
    if (inVillage !== prevInVillage || tier !== prevDangerTier || onRoad !== prevOnRoad) {
      if (inVillage !== prevInVillage) {
        hud.setCampInfoVisible(inVillage);
        hud.setZone(!inVillage);
      }
      // M6/M7/M8 : la position est LOCALE -> on signale à la sim l'état spatial ABSTRAIT (dehors +
      // tier de danger + route) au CHANGEMENT seulement (edge ; 1ère frame incluse). Le reducer ne
      // ré-arme les drains QUE si `outside` a basculé (H1) ; un combat est rompu au retour au camp.
      emit(setOutside(self(), !inVillage, tier, onRoad));
      prevInVillage = inVillage;
      prevDangerTier = tier;
      prevOnRoad = onRoad;
    }
    // M8.5/F4 — `checkDanger` d'ADR : avertissement aux seuils de distance sans l'armure adéquate
    // (≥ 16 cellules sans armure de fer ; ≥ 36 sans armure d'acier — seuils ADR ×2, monde ×2).
    {
      const rCells = Math.hypot(player.position.x, player.position.z) / worldgen.cellSize;
      const hasIron = stockOf(state, "i armour") > 0 || stockOf(state, "s armour") > 0;
      const hasSteel = stockOf(state, "s armour") > 0;
      const lvl = rCells >= 36 && !hasSteel ? 2 : rCells >= 16 && !hasIron ? 1 : 0;
      if (lvl > prevDangerWarn) {
        hud.toast(lvl === 2
          ? "il est périlleux d'aller si loin sans armure d'acier."
          : "il est dangereux d'être si loin du village sans protection.");
      }
      prevDangerWarn = lvl;
    }

    world.setFireLevel(state.fire);
    audio.setBackgroundMusic(pickMusic()); // A2/A6 : fond = feu (spatial) / village / exploration (idempotent)
    stranger.setBuilder(state.builder);
    stranger.setActivity(state.cabinRepaired, state.tick < state.builderTendingUntil); // va réalimenter le feu (cosmétique)
    stranger.setNews(state.cabinRepaired && pendingReveal.size > 0); // « ! » : un nouveau bâtiment est dispo
    village.sync(state.buildings, state.constructing);
    campRuins.sync(state.buildings, state.constructing[0]?.id ?? null); // gravats des emplacements futurs
    // Sentiers du village : RE-générés dès qu'un bâtiment (hors piège) est achevé — ou la cabane
    // réparée. Le maillage (arbre couvrant : feu + cabane + bâtiments) s'étoffe avec le village ;
    // peint par campPaths + suivi par les villageois (le biais navGrid se reconstruit tout seul).
    let coreCount = state.cabinRepaired ? 1 : 0;
    for (const c of craftables) if (c.id !== "trap") coreCount += state.buildings[c.id] ?? 0;
    if (coreCount !== pathSig) {
      pathSig = coreCount;
      const sites: Array<{ x: number; z: number }> = [];
      if (state.cabinRepaired) sites.push({ x: cabin.center.x, z: cabin.center.z });
      for (const c of craftables) if (c.id !== "trap") for (const p of village.getBuildingPositions(c.id)) sites.push({ x: p.x, z: p.z });
      campLayout.paths.length = 0;
      campLayout.paths.push(...campPathsFor(sites));
      campPaths.rebake();
    }
    terrain.setRoads(state.roads); // réseau de routes (teinte de sol) — no-op si inchangé
    stranger.setBuildSite(village.getChantierSite()); // chantier actif -> elle va y frapper au marteau
    // La montée du bâtiment ne démarre qu'une fois la constructrice ARRIVÉE sur le chantier
    // (et se cale pour finir à l'achèvement sim). Évalué après setBuildSite -> arrivée vs site courant.
    village.revealChantier(state.tick, stranger.isAtBuildSite());
    // Répartition des métiers -> chaque avatar se déplace selon son rôle (bûcheron = le reste).
    const roleCounts: Record<string, number> = { gatherer: freeWorkers(state) };
    for (const j of jobs) if (j.id !== "gatherer") roleCounts[j.id] = state.workers[j.id] ?? 0;
    villagers.sync(state.population, roleCounts);
    // Feedback : bâtiments dont le métier produit -> fumée ; pièges relevables -> proie visible.
    const activeBuildings = new Set<string>();
    for (const j of jobs) if (state.producing[j.id] && j.building) activeBuildings.add(j.building);
    village.setActivity(activeBuildings);
    // Proie visible UNIQUEMENT sur les pièges pleins (chacun a son propre rechargement).
    const readyTraps = new Set<number>();
    const trapCount = state.buildings["trap"] ?? 0;
    for (let i = 0; i < trapCount; i++) {
      if (state.tick >= (state.trapReadyAt[i] ?? 0)) readyTraps.add(i);
    }
    village.setTrapsReady(readyTraps);
    cabin.setTier(state.cabinTier); // ruine (0) / réparée (1) / améliorée (5) / entrepôt (10)
    campLights.setTier(state.cabinTier); // le village s'enrichit : lanternes dès le palier 5, plus à 10
    cabin.setStorage(state.resources); // étagères de l'entrepôt (révélation progressive)

    // M9 — sites NETTOYÉS : une grotte vidée devient un avant-poste (rendu) et n'a plus d'intérieur.
    const cleared = new Set<string>();
    for (const k of Object.keys(state.sites ?? {})) if (state.sites[k].cleared) cleared.add(k);
    sites.setCleared(cleared);
    interiors.setClearedKeys(cleared);
    // Grand tableau : population + métiers DISPONIBLES (s'agrandit avec les bâtiments).
    cabin.setOrganisation(
      state.population,
      maxPop,
      jobs
        .filter((j) => !j.building || (state.buildings[j.building] ?? 0) > 0)
        // Le bûcheron affiche le « reste » (occupation par défaut), les autres leur effectif assigné.
        .map((j) => ({ name: j.name, count: j.id === "gatherer" ? freeWorkers(state) : state.workers[j.id] ?? 0 })),
    );

    if (state.fire !== prevFire) {
      hud.toast(`le feu est ${FIRE_LABELS[state.fire]}.`);
      prevFire = state.fire;
    }
    if (state.builder !== prevBuilder) {
      if (state.builder >= 0 && state.builder < BUILDER_MESSAGES.length) hud.toast(BUILDER_MESSAGES[state.builder]);
      prevBuilder = state.builder;
    }
    if (state.cabinRepaired !== prevCabin) {
      if (state.cabinRepaired) hud.toast("la cabane est réparée — l'entrepôt est ouvert.");
      prevCabin = state.cabinRepaired;
    }
    if (state.cabinTier !== prevTier) {
      if (state.cabinTier > prevTier && prevTier >= 1) hud.toast(state.cabinTier >= 10 ? "l'entrepôt est agrandi — capacité ×10." : "la cabane est améliorée — capacité ×5.");
      prevTier = state.cabinTier;
      camOccluders = cabin.occluders(); // la coque a changé -> rafraîchir les occulteurs caméra
    }

    // SYNCHRO MULTIJOUEUR — un dialogue OUVERT (métiers, construction) doit refléter l'état
    // AUTORITAIRE en continu : dès qu'il change (snapshot distant, OU action d'un AUTRE joueur
    // appliquée par l'hôte), on ré-affiche. Sans ça, les effectifs/coûts/affordabilités se
    // figeaient à l'ouverture — ex. les métiers assignés par l'autre joueur n'apparaissaient pas,
    // et chez un client sa propre assignation (envoyée à l'hôte) ne se voyait qu'après réouverture.
    // L'eventView a déjà son propre suivi (signature des stocks) -> on l'exclut ici.
    if (currentDialogue && currentDialogue !== eventView) {
      const sig = `${state.population}|${state.cabinTier}|${state.cabinRepaired}|${state.builder}|`
        + `${JSON.stringify(state.workers)}|${JSON.stringify(state.buildings)}|${JSON.stringify(state.resources)}`;
      if (sig !== prevDialogueSig) { refreshDialogue(); prevDialogueSig = sig; }
    }

    // M5 — événement actif : ouvrir / rafraîchir / fermer le panneau de choix. On suit la
    // scène (id/scene) ; une signature des stocks rafraîchit l'affordabilité d'une boutique
    // qui RESTE ouverte (ex. le nomade), y compris quand l'état arrive par snapshot (P2P).
    const ae = state.activeEvent;
    const key = ae ? `${ae.id}/${ae.scene}` : null;
    if (key !== prevEventKey) {
      if (ae) {
        const ev = eventById[ae.id];
        const sc = ev?.scenes[ae.scene];
        const p = player.position;
        const inVillage = Math.hypot(p.x, p.z) <= VILLAGE_RADIUS;
        if (inVillage) {
          if (sc?.notification) hud.toast(sc.notification);
          showDialogue(eventView);
          const track = EVENT_MUSIC[ae.id]; // A5 : musique d'événement (overlay + ducking), idempotent
          if (track) audio.playEventMusic(track);
        } else if (sc) {
          // EXPLORATION : aucun panneau bloquant. Effet-seul (onLoad déjà appliqué par la sim)
          // -> simple toast de ce qui s'est passé ; sinon (offre/choix) -> ignoré. On clôt
          // l'événement automatiquement (on choisit l'option qui termine sans coût).
          const note = sc.notification ?? ev?.title ?? "un événement";
          hud.toast(sc.onLoad ? note : `${note} — ignoré (exploration)`);
          const decline =
            sc.choices.find((c) => c.next === "end" && !c.cost && (c.available?.(state) ?? true)) ??
            sc.choices.find((c) => !c.cost && (c.available?.(state) ?? true)) ??
            sc.choices[0];
          if (decline) emit(resolveEventChoice(self(), decline.id));
        }
      } else {
        if (currentDialogue === eventView) closeInteractive(); // l'événement s'est résolu -> referme le panneau
        audio.stopEventMusic(); // A5 : restaure le fond (no-op si aucune musique d'événement)
      }
      prevEventKey = key;
      prevEventSig = JSON.stringify(state.resources);
    } else if (key && currentDialogue === eventView) {
      const sig = JSON.stringify(state.resources);
      if (sig !== prevEventSig) { refreshDialogue(); prevEventSig = sig; }
    }

    // M8.6 — RENCONTRES PARTAGÉES : matérialise TOUS les ennemis + le butin au sol (état autoritaire),
    // et reflète le combat où le joueur LOCAL est engagé (panneau + musique). Placé APRÈS le bloc M5 :
    // la musique de combat (overlay, idempotente) garde la priorité. La victoire (coup fatal porté par
    // CE joueur) est observée par diff de `winSeq`, robuste à la coalescence de snapshots.
    encounterFx.sync(toEncViews(state.encounters)); // ajoute/retire/anime les ennemis du monde
    groundDrops.sync(state.drops); // piles de butin tombées
    const engagedNow = selfEngagedEnc();
    if (engagedNow) lastEncSeen = engagedNow.enc; // mémo : toast de victoire (gardien de site ou non)
    if (sv.winSeq !== prevWinSeq) {
      prevWinSeq = sv.winSeq;
      // M8.5/F3.1 : message dédié pour la séquence des gardiens de site (mine/grotte).
      if (lastEncSeen?.guardianIdx !== undefined && lastEncSeen.siteType) {
        const isCave = lastEncSeen.siteType === "cave";
        const total = isCave && lastEncSeen.siteKey
          ? caveSteps(Number(lastEncSeen.siteKey.split(",")[0]), Number(lastEncSeen.siteKey.split(",")[1]), state.worldSeed).length
          : mineGuardians[lastEncSeen.siteType]?.length ?? 0;
        if (lastEncSeen.guardianIdx >= total - 1) {
          hud.toast(isCave ? "la grotte est silencieuse — la cache du fond est à vous." : "la mine est sûre — le filon peut être exploité.");
        } else {
          hud.toast(isCave ? "la bête tombe — quelque chose remue encore plus loin." : "le gardien tombe — d'autres défendent encore les lieux.");
        }
      } else {
        hud.toast("l'ennemi s'effondre — son butin gît au sol, à ramasser.");
      }
      audio.playSfx("checkTraps");
    }
    // M11/E3-E4 — DÉCOLLAGE : transitions terminales (évasion / crash) observées par diff de statut.
    const fStatus = state.flight?.status ?? null;
    if (fStatus !== prevFlightStatus) {
      if (fStatus === "escaped") {
        // ÉVASION : écran de fin (le vaisseau s'éloigne en fond, cf. liftoff) -> prestige / contempler.
        audio.stopEventMusic();
        audio.playSfx("buy");
        showDialogue(endingViewRef);
      } else if (fStatus === "crashed") {
        hud.toast("la coque cède — le vaisseau retombe en flammes. il faudra réparer et réessayer.");
        audio.playSfx("death");
        const w = shipWorldPos();
        player.teleport(w.x, w.z);
        emit(endFlight(self()));
      } else if (fStatus === null && prevFlightStatus === "escaped" && hud.interactiveOpen) {
        closeInteractive(); // prestige déclenché par un AUTRE joueur (co-op) -> on referme l'épilogue
      }
      prevFlightStatus = fStatus;
    }

    if (state.flight && (state.flight.status === "boarding" || state.flight.status === "ascending")) {
      // HUD du décollage (réutilise le panneau de combat) : coque commune + altitude + débris entrants.
      const f = state.flight;
      const boarding = f.status === "boarding";
      hud.setCombat({
        name: boarding ? "embarquement…" : "ascension",
        hpFrac: f.hull / Math.max(1, f.hullMax),
        weaponLabel: boarding ? "le vaisseau attend l'équipage" : `altitude ${Math.round(f.progress * 100)}% · ${f.asteroids.length} entrant(s) — [E] tirer`,
        ready: !boarding && f.asteroids.length > 0,
      });
    } else if (engagedNow) {
      const enc = engagedNow.enc;
      const def = enemyById[enc.enemyId];
      const w = bestReadyWeapon(state, self(), enc);
      hud.setCombat({
        name: def?.name ?? enc.enemyId,
        hpFrac: def ? enc.enemyHp / def.hp : 1,
        weaponLabel: w ? w.name : "recharge…",
        ready: !!w,
      });
      // Musique de rencontre par tier (les cavernes — tier 4 — jouent le tier 1). Idempotent.
      const ti = Math.min(3, Math.max(1, sv.tier === 4 ? 1 : sv.tier || 1));
      audio.playEventMusic(audioManifest.music.encounter[ti - 1]);
    } else {
      hud.setCombat(null);
      // Ne coupe QUE notre musique de combat (jamais celle d'un événement M5 en cours).
      const cur = audio.currentEventMusic;
      if (cur && cur.startsWith("encounter-")) {
        const track = state.activeEvent ? EVENT_MUSIC[state.activeEvent.id] : undefined;
        if (track) audio.playEventMusic(track);
        else audio.stopEventMusic();
      }
    }
  }

  // ---- BOUCLE À PAS FIXE (§3.6) + rendu interpolé ----
  const tickMs = 1000 / config.simTickHz;
  const transformMs = 1000 / config.transformHz;
  const snapshotMs = 500;
  const SAVE_MS = 15_000; // sauvegarde auto toutes les 15 s (état autoritaire)
  const SAVE_TOAST_MS = 45_000; // notification « sauvegardé » throttlée
  const STEP_SECONDS = 0.4; // cadence des pas (footsteps) quand on marche
  let stepAcc = STEP_SECONDS; // démarré « plein » -> 1er pas immédiat au départ
  let simAcc = 0;
  let encountersPaused = false; // DEBUG (e2e) : bloque l'émission de STEPS (podomètre)
  let pedoPrev: { x: number; z: number } | null = null; // podomètre (M8.5/F1)
  let pedoAcc = 0; // distance accumulée vers le prochain « pas » (12 u)
  let lastDeathGateToast = 0; // throttle du toast « trop faible pour repartir »
  let transformAcc = 0;
  let posFeedAcc = 0; // M8.6 : cadence d'injection des positions dans la sim (SET_POSITIONS, hôte)
  const POS_FEED_MS = 100; // ~10 Hz : assez pour une poursuite fluide, sans surcharger la sim
  let snapshotAcc = 0;
  let saveAcc = 0;
  let saveToastAcc = SAVE_TOAST_MS; // 1ʳᵉ sauvegarde notifiée
  // Overlay debug : rafraîchi à ~4 Hz, latence mesurée à ~1 Hz (le ping est asynchrone).
  const DEBUG_REFRESH_MS = 250;
  const PING_MS = 1000;
  let debugAcc = DEBUG_REFRESH_MS;
  let pingAcc = 0;
  let lastPing: number | null = null;
  let pinging = false;
  let pathSig = -1; // signature « cabane réparée + nb de bâtiments (hors pièges) » -> régénère le réseau de sentiers

  // Plafond du delta par frame : empêche le « rattrapage » massif après un AFK / onglet en
  // arrière-plan (sinon `simAcc` accumule toute l'absence et la sim la rejoue à ~15× le temps réel
  // au retour -> rafale d'événements en chaîne). Au-delà, le temps d'absence est simplement ignoré
  // (la sim REPREND, elle ne rattrape pas). Borne ≈ le plafond de pas/frame (5 × 50 ms).
  const MAX_FRAME_MS = 250;
  scene.onBeforeRenderObservable.add(() => {
    const dtMs = Math.min(engine.getDeltaTime(), MAX_FRAME_MS);
    const dtSec = dtMs / 1000;
    if (chopCooldown > 0) chopCooldown = Math.max(0, chopCooldown - dtSec);

    // 0) Heartbeat d'hôte : si l'hôte s'est tu (onglet en arrière-plan, déco silencieuse), le plus
    //    petit pair vivant reprend l'autorité (failover). On diffuse aussitôt notre état.
    if (net.connected && !net.isHost && net.checkLiveness(performance.now())) {
      net.broadcastStateSync(snapshot());
      hud.toast("hôte injoignable — tu prends le relais");
    }

    // 1) Simulation à pas fixe — uniquement côté autorité (hôte/hors-ligne).
    const authoritative = !net.connected || net.isHost;
    if (authoritative) {
      // M8.6 — POSITIONS DANS LA SIM : injecte (~10 Hz) les positions des joueurs depuis les transforms
      // qu'on a DÉJÀ (la nôtre + les avatars distants) AVANT les tics -> le reducer PUR fait poursuivre
      // & engager les ennemis. Appliqué EN DIRECT (pas de broadcast : les positions voyagent dans le
      // snapshot 2 Hz ; l'ennemi a son propre flux rapide). Host-local : zéro trafic client->hôte ajouté.
      posFeedAcc += dtMs;
      if (posFeedAcc >= POS_FEED_MS) {
        posFeedAcc = 0;
        const positions: Record<string, { x: number; z: number }> = { [self()]: { x: player.position.x, z: player.position.z } };
        for (const e of remotes.entries()) positions[e.id] = { x: e.x, z: e.z };
        state = reduce(state, setPositions(positions));
      }
      simAcc += dtMs;
      let ticksDone = 0;
      while (simAcc >= tickMs && ticksDone < 5) {
        state = reduce(state, tick());
        simAcc -= tickMs;
        ticksDone++;
      }
      // DEBUG (e2e) : `encountersPaused` bloque l'émission de STEPS (cf. podomètre) — les
      //               rencontres étant désormais déclenchées PAR PAS, il n'y a rien d'autre à geler.
      if (net.connected) {
        snapshotAcc += dtMs;
        if (snapshotAcc >= snapshotMs) { snapshotAcc = 0; net.broadcastStateSync(snapshot()); }
      }
      // Sauvegarde automatique de l'état autoritaire (façon ADR), throttlée.
      saveAcc += dtMs;
      if (saveAcc >= SAVE_MS) {
        saveAcc = 0;
        saveGame(state);
        saveToastAcc += SAVE_MS;
        if (saveToastAcc >= SAVE_TOAST_MS) { saveToastAcc = 0; hud.toast("partie sauvegardée"); }
      }
    }

    // 2) Entrées -> personnage + interaction (E). Le déplacement est neutralisé quand une UI
    //    est ouverte (les touches servent alors à naviguer le dialogue, cf. listener clavier).
    const uiOpen = hud.interactiveOpen || (devConsole?.isOpen ?? false) || (spawnEditor?.active ?? false);
    // M11/E3b — DÉCOLLAGE en cours : la caméra/mouvement passent en mode cinématique (l'équipage est
    // à bord, dans l'espace) ; l'interaction (E) sert à TIRER sur les débris entrants.
    const flying = !!state.flight && (state.flight.status === "boarding" || state.flight.status === "ascending" || state.flight.status === "escaped");
    // M11/RF5 — CINÉMATIQUE DE SEUIL : si active, on avance la machine d'état, on pilote la porte/le
    // fondu, on émet le commit (ENTER_ROOM) au fondu max, et l'input est neutralisé (pas scripté pendant
    // la phase « walking »). Timeout-safe : la machine revient toujours à `idle` (jamais coincé).
    const cineFrame = cine.active ? cine.advance(dtSec) : null;
    const cineActive = cine.active;
    if (cineFrame) {
      cineDoor.setOpen(cineFrame.doorOpen);
      dipOverlay.set(cineFrame.dip);
      if (cineFrame.commit && cineCommit) { cineCommit(); cineCommit = null; }
      if (!cine.active) { cineDoor.setEnabled(false); dipOverlay.set(0); } // cinématique terminée
    }
    const raw = input.getIntent(); // consomme aussi le front du saut
    const cineWalk = cineActive && cineFrame?.phase === "walking";
    const intent = (uiOpen || flying || cineActive)
      ? { forward: cineWalk ? 0.7 : 0, strafe: 0, jump: false, vertical: 0 } // pas scripté pendant le franchissement
      : raw;
    player.update(dtSec, intent, cameraYaw(camera));
    // Footsteps (A3) : pas réguliers tant qu'on se déplace au sol (cosmétique, variante au hasard).
    const walking = !player.isFlying && (Math.abs(intent.forward) > 0.05 || Math.abs(intent.strafe) > 0.05);
    if (walking) {
      stepAcc += dtSec;
      if (stepAcc >= STEP_SECONDS) { stepAcc -= STEP_SECONDS; audio.playSfx("footsteps"); }
    } else {
      stepAcc = STEP_SECONDS; // à l'arrêt : le prochain départ déclenche un pas tout de suite
    }
    // Doubles-appuis (consommés chaque frame) : Z×2 = +vitesse, S×2 = −vitesse, Espace×2 = vol.
    const taps = input.consumeDoubleTaps();
    if (!uiOpen && !cineActive) {
      if (taps.forward) hud.toast(`vitesse ×${player.adjustSpeed(1).toFixed(1)}`);
      if (taps.back) hud.toast(`vitesse ×${player.adjustSpeed(-1).toFixed(1)}`);
      if (taps.jump) { player.setFly(!player.isFlying); hud.toast(player.isFlying ? "vol ON (Espace ↑ / Maj ↓)" : "vol OFF"); }
    }
    currentFocus = (uiOpen || flying || cineActive) ? null : computeFocus();
    const interacted = input.consumeInteract();
    if (flying) {
      // E = TIRER sur le débris le plus urgent (la sim borne via le cooldown par joueur).
      if (interacted && state.flight?.status === "ascending") { emit(flightFire(self())); audio.playSfx("weaponRanged"); }
    } else if (!uiOpen && !cineActive && interacted) {
      // Avec focus (village/camp) -> action ciblée (tooltip). Sinon, en exploration ->
      // on coupe l'arbre sauvage le plus proche (sans tooltip).
      if (currentFocus) currentFocus.act();
      else chopWildTree();
    }
    // M8/M10 — F : MANGER une viande séchée, sinon SE SOIGNER (médecine). La sim re-vérifie tout.
    if (!uiOpen && input.consumeEat()) {
      const svNow = survivalOf(state, self());
      const capHpNow = maxHealthOf(state);
      if (carriedOf(state, self(), "cured meat") > 0 && svNow.health < capHpNow && state.tick >= svNow.eatReadyAt) {
        emit(eatMeat(self()));
        audio.playSfx("eatMeat");
      } else if (carriedOf(state, self(), "medicine") > 0 && svNow.health < capHpNow && state.tick >= svNow.medsReadyAt) {
        emit(useMeds(self()));
        audio.playSfx("useMeds");
      }
    }

    // 3) Caméra : suit le joueur + spring-arm (collision murs) + bascule 3ᵉ↔1ʳᵉ personne lissée.
    //    (Sautée pendant le décollage : `liftoff` pilote alors la caméra cinématique.)
    const pp = player.position;
    if (cameraFollow && !flying) {
      const distCabin = Math.hypot(pp.x - cabin.center.x, pp.z - cabin.center.z);
      // Entrée/sortie de la cabane avec HYSTÉRÉSIS (pas de clignotement dans l'embrasure).
      if (insideCabin) { if (distCabin > cabin.footprintRadius + 0.8) insideCabin = false; }
      else if (distCabin < cabin.footprintRadius - 0.3) insideCabin = true;
      // 1ʳᵉ personne aussi SOUS TERRE (grottes/mines) : on réutilise toute la machinerie FPV (§8).
      const wantFpv = forceFpv || insideCabin || interiors.isLocalPlayerInside() || shipInterior.isLocalPlayerInside();
      fpv += ((wantFpv ? 1 : 0) - fpv) * Math.min(1, dtSec * FPV_SPEED);

      // Fondu du toit : transparent en 3PV quand on approche/est sous l'emprise (on voit l'intérieur),
      // opaque au loin ; en FPV (sous le toit) on le garde opaque (regard vers le haut). `max(fpv, …)`.
      const roofFade = Math.max(0, Math.min(1, (distCabin - cabin.footprintRadius) / ROOF_FADE_SPAN));
      cabin.setRoofOpacity(Math.max(fpv, roofFade));

      // Tangage : `camera.beta` = beta VOULU (souris) en 3PV, remappé vers l'horizon en FPV, mélangé
      // par `fpv`. Comme la caméra regarde toujours selon beta, c'est le SEUL moyen d'orienter la FPV.
      const betaUser = pointerLook.desiredBeta;
      const betaFpv = Math.max(
        FPV_BETA_MIN,
        Math.min(FPV_BETA_MAX, Math.PI / 2 + (betaUser - FPV_BETA_REST) * FPV_PITCH_GAIN),
      );
      camera.beta = betaUser + (betaFpv - betaUser) * fpv;

      // a) Rayon 3ᵉ personne : voulu, rapproché par le spring-arm si un mur s'interpose. On le SAUTE
      //    en 1ʳᵉ personne (fpv haut) : à l'œil, il n'y a pas de « bras » caméra-cible à protéger, et
      //    le raycast cible->caméra (dirigé vers l'ARRIÈRE) accrochait le mur derrière -> oscillation.
      let r3 = pointerLook.desiredRadius;
      if (fpv < 0.9 && distCabin < cabin.footprintRadius + SPRING_NEAR) {
        camera.position.subtractToRef(camera.target, camDir);
        const len = camDir.length();
        if (len > 1e-3) {
          camDir.scaleInPlace(1 / len);
          springRay.origin.copyFrom(camera.target);
          springRay.direction.copyFrom(camDir);
          springRay.length = r3;
          const hit = scene.pickWithRay(springRay, (m) => camOccluders.indexOf(m) !== -1);
          if (hit?.hit && hit.distance < r3) r3 = Math.max(SPRING_MIN, hit.distance - SPRING_MARGIN);
        }
      }

      // b) RAYON d'abord (lissage spring-arm), PUIS on cale la cible 1ʳᵉ personne dessus : la caméra
      //    retombe EXACTEMENT sur l'œil quel que soit le rayon (position = cible − rayon·avant = œil).
      //    Avant, la cible utilisait FPV_RADIUS pendant que le rayon lissait ailleurs -> léger décalage
      //    avant-arrière permanent. En liant la cible au rayon RÉEL de la caméra, l'erreur s'annule.
      const rWanted = r3 + (FPV_RADIUS - r3) * fpv;
      const k = rWanted < camera.radius ? SPRING_IN : SPRING_OUT;
      camera.radius += (rWanted - camera.radius) * Math.min(1, dtSec * k);

      // c) Pose 1ʳᵉ personne : œil + direction « avant » (alpha/beta), décalée du RAYON RÉEL de la caméra.
      const a = camera.alpha, b = camera.beta;
      const fx = -Math.cos(a) * Math.sin(b), fy = -Math.cos(b), fz = -Math.sin(a) * Math.sin(b);
      const r = camera.radius;
      const eyeY = pp.y + FPV_EYE_Y;
      const tFx = pp.x + fx * r, tFy = eyeY + fy * r, tFz = pp.z + fz * r;

      // d) Blend de la cible : la tête en 3PV -> l'œil-avant en 1ʳᵉ personne.
      camera.target.copyFromFloats(pp.x + (tFx - pp.x) * fpv, (pp.y + 1.0) + (tFy - (pp.y + 1.0)) * fpv, pp.z + (tFz - pp.z) * fpv);
      player.setVisible(fpv < 0.6); // masquer le corps une fois nettement en 1ʳᵉ personne
    }

    // 3a-bis) Zoom « longue-vue » (maintien R) : FOV resserré + sensibilité souris réduite,
    // transition lissée. Désactivé hors suivi (éditeur/showcase) -> revient au FOV normal.
    const fovTarget = zoomHeld && cameraFollow ? ZOOM_FOV : baseFov;
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dtSec * ZOOM_SPEED);
    pointerLook.setLookScale(camera.fov / baseFov);

    // 3b) Étiquette d'interaction projetée au niveau de l'objet.
    if (!uiOpen && currentFocus) {
      const s = projectToScreen(currentFocus.world);
      hud.setPrompt(s.visible ? currentFocus.verb : null, s.x, s.y);
    } else {
      hud.setPrompt(null);
    }

    // 4) Rendu : avatars, monde, forêt, reflet, étrangère, villageois.
    remotes.update(dtSec);
    world.update(dtSec);
    // Streaming visuel autour du joueur local ; physique localisée autour de CHAQUE joueur
    // (local + avatars distants) -> tout pair a du sol solide sous lui en multijoueur (P2).
    terrain.update(player.position, dtSec, [
      { x: player.position.x, z: player.position.z },
      ...remotes.positions(),
    ]);
    forest.update(dtSec);
    village.update(dtSec);
    cabin.update(dtSec); // montée « construction » de la cabane (réparation / amélioration)
    // M9 : build/free de l'intérieur proche + obscurité locale + gate de torche ; torche sur le modèle.
    const hasTorch = carriedOf(state, self(), "torch") > 0;
    interiors.update(player.position, dtSec, hasTorch);
    interiors.applyProgress(state.sites ?? {}); // masque les caches/filons déjà pris (premier-servi)
    shipInterior.update(player.position, dtSec, state); // M11/RF2b : cuirassé explorable (APRÈS interiors -> l'obscurité du vaisseau l'emporte)
    siteLoot.update(player.position); // butin de SURFACE (forages/champs de bataille, R3)
    siteLoot.applyProgress(state.sites ?? {});
    encounterFx.update(dtSec); // M8.6 : interpolation vers la position cible + fente/recul/retraits
    groundDrops.update(dtSec); // piles de butin au sol (flottement + rotation)
    liftoff.update(dtSec, state.flight, state.tick); // M11/E3b : cinématique du décollage (caméra incluse)
    // M11/RF1b : le vaisseau au camp — visible une fois trouvé, s'assemble au fil de la coque ; masqué
    // pendant le décollage (la cinématique `liftoff` représente alors le vaisseau).
    shipAtCamp.sync(!!state.perks["ship_found"] && !flying, state.ship.hull);
    shipAtCamp.update(dtSec);
    // M8.5/F1 — PODOMÈTRE : les rencontres se déclenchent PAR PAS de déplacement (1 pas = 1 cellule
    // = 12 u), fidèle au `checkFight` d'ADR. Immobile = rien ; téléport (saut > 3 u/frame) ignoré.
    // Gelé tant qu'on est déjà ENGAGÉ (M8.6) : on n'empile pas une 2ᵉ rencontre sous ses pieds.
    {
      const px = player.position.x, pz = player.position.z;
      if (pedoPrev) {
        const d = Math.hypot(px - pedoPrev.x, pz - pedoPrev.z);
        const outsideNow = Math.hypot(px, pz) > VILLAGE_RADIUS;
        if (d < 3 && outsideNow && !encountersPaused && !selfEngagedEnc()) {
          pedoAcc += d;
          if (pedoAcc >= config.combat.stepUnits) {
            const n = Math.min(config.combat.maxStepsPerAction, Math.floor(pedoAcc / config.combat.stepUnits));
            pedoAcc -= n * config.combat.stepUnits;
            emit(steps(self(), n, dangerTier(), biomeStr(), onRoadCell(), px, pz));
          }
        } else if (d >= 3) {
          pedoAcc = 0; // téléport : on repart proprement
        }
      }
      pedoPrev = { x: px, z: pz };
    }
    // M8.6 — DÉSENGAGEMENT : plus de bouton/flux client. L'ennemi POURSUIT (sim) et DÉCROCHE de lui-même
    // (laisse) quand plus aucun joueur n'est à portée — il faut le SEMER (sprint au-delà du rayon de
    // laisse). Les boss (`noFlee`) ne lâchent jamais. Tout est host-autoritaire (cf. reducer TICK 8b).
    // M8.5/F4 — COOLDOWN DE MORT (120 s, fidèle DEATH_COOLDOWN) : trop faible pour repartir — le
    // franchissement de la porte est refusé (retour au camp + toast).
    {
      const svNow = survivalOf(state, self());
      if (svNow.deathSeq > 0 && state.tick < svNow.respawnReadyAt
          && Math.hypot(player.position.x, player.position.z) > VILLAGE_RADIUS) {
        player.teleport(cabin.center.x + 1, cabin.center.z + 0.5);
        const remain = Math.ceil((svNow.respawnReadyAt - state.tick) / config.simTickHz);
        if (performance.now() - lastDeathGateToast > 3000) {
          lastDeathGateToast = performance.now();
          hud.toast(`trop faible pour repartir — repos forcé (${remain} s).`);
        }
      }
    }
    // Masque le modèle décoratif du site dont l'intérieur est actif (grotte/mine OU cuirassé RF2b).
    const suppressed = new Set<string>();
    const activeSite = interiors.activeSiteKey();
    if (activeSite) suppressed.add(activeSite);
    const activeShip = shipInterior.activeSiteKey();
    if (activeShip) suppressed.add(activeShip);
    sites.setSuppressed(suppressed.size ? suppressed : EMPTY_KEYS);
    player.setTorch(hasTorch, interiors.isLocalPlayerInside());
    const blockedNow = interiors.isBlockedNoTorch();
    if (blockedNow && !prevBlockedNoTorch) hud.toast("il fait trop noir — il te faut une torche.");
    prevBlockedNoTorch = blockedNow;
    reflectState();
    audio.update(dtSec); // applique le fondu enchaîné musical (cibles posées par reflectState)
    stranger.update(dtSec);
    // Villageois animés/rendus seulement près du village (via le rendu conditionnel).
    // En édition du spawn, on fige (le village est masqué et le joueur ne bouge pas).
    if (!(spawnEditor?.active)) entities.update(player.position.x, player.position.z, dtSec);

    // 5) Diffusion réseau de notre position (+ les positions d'ennemis si l'on est hôte, M8.6).
    if (net.connected) {
      transformAcc += dtMs;
      if (transformAcc >= transformMs) {
        transformAcc = 0;
        net.broadcastTransform(player.getTransform());
        if (net.isHost) {
          const ids = Object.keys(state.encounters);
          if (ids.length) net.broadcastEnemies({ e: ids.map((id) => ({ id, x: state.encounters[id].x, z: state.encounters[id].z })) });
        }
      }
    }

    // 5b) PERF ADAPTATIVE (P6) : ajuste la résolution interne vers le FPS cible (~1 Hz).
    if (autoPerf) {
      perfAcc += dtMs;
      if (perfAcc >= PERF_TICK_MS) {
        perfAcc = 0;
        const cur = engine.getHardwareScalingLevel();
        const lvl = nextScaling(engine.getFps(), cur);
        if (lvl !== cur) setScaling(lvl);
      }
    }

    // 6) Overlay debug (FPS, latence…) — rafraîchi à ~4 Hz, latence sondée à ~1 Hz.
    if (hud.debugShown) {
      pingAcc += dtMs;
      if (pingAcc >= PING_MS) {
        pingAcc = 0;
        if (net.connected && !pinging) {
          pinging = true;
          void net.measurePing().then((ms) => { lastPing = ms; }).finally(() => { pinging = false; });
        } else if (!net.connected) {
          lastPing = null;
        }
      }
      debugAcc += dtMs;
      if (debugAcc >= DEBUG_REFRESH_MS) {
        debugAcc = 0;
        const p = player.position;
        const ts = terrain.stats; // calculé une fois (P2/P3)
        const ss = sites.stats; // sites posés + paliers LOD (P5)
        const net1 = !net.connected
          ? "hors-ligne"
          : `${net.isHost ? "hôte" : "client"} · ${net.peerCount} pair(s)`;
        hud.setDebug([
          ["fps", String(Math.round(engine.getFps()))],
          ["frame", `${dtMs.toFixed(1)} ms`],
          ["rendu", rendererLabel.toUpperCase()],
          ["tick", String(state.tick)],
          ["pos", `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`],
          ["distance", `${Math.round(Math.hypot(p.x, p.z))} m`], // au feu de camp (origine)
          ["villageois", `${villagers.rendered}/${villagers.count}`], // rendus/total (LOD)
          ["chunks", `${ts.near}▣ ${ts.colliders}■/${ts.chunks}`], // near/colliders/chargés (P2+P3)
          ["props", `${ts.props} (${ts.frozen}❄ figés)`], // décor affiché / objets à matrice figée (P3+P4)
          ["sites", `${ss.full}◆ ${ss.minimal}△/${ss.placed}`], // détail/silhouette/posés (P5)
          ["réseau", net1],
          ["latence", net.connected ? (lastPing != null ? `${lastPing} ms` : "…") : "—"],
        ]);
      }
    }
  });

  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
  // Sauvegarde à la fermeture/masquage de l'onglet (si on est l'autorité).
  const saveIfAuthoritative = () => {
    if (!net.connected || net.isHost) saveGame(state);
  };
  window.addEventListener("beforeunload", saveIfAuthoritative);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveIfAuthoritative();
  });

  // ---- Hooks d'auto-vérification (Playwright/console). ----
  window.__game = {
    ready: true,
    renderer: rendererLabel,
    getStored: () => ({ ...state.resources }),
    getCarried: () => ({ ...(state.carried[self()] ?? {}) }),
    getFire: () => state.fire,
    getBuildings: () => ({ ...state.buildings }),
    getPopulation: () => state.population,
    getWorkers: () => ({ ...state.workers }),
    getCabinRepaired: () => state.cabinRepaired,
    getCabinTier: () => state.cabinTier,
    getSurvival: () => { const s = survivalOf(state, self()); return { water: s.water, food: s.food, health: s.health, outside: s.outside, deathSeq: s.deathSeq, winSeq: s.winSeq, tier: s.tier }; },
    setSurvival: (vals: { water?: number; food?: number; health?: number }) => emit(debugSetSurvival(self(), vals)),
    getCombat: () => { const e = selfEngagedEnc(); return e ? { enemyId: e.enc.enemyId, enemyHp: e.enc.enemyHp, seq: e.enc.seq } : null; },
    getMaxes: () => ({ water: maxWaterOf(state), health: maxHealthOf(state), carry: carryCapacity(state) }),
    craft: (itemId: string) => emit(craftItem(self(), itemId)),
    buy: (goodId: string) => emit(buy(self(), goodId)),
    useMeds: () => emit(useMeds(self())),
    withdraw: (resource: string, amount = 1) => emit(withdraw(self(), resource, amount)),
    startEncounter: (enemyId?: string, enemyHp?: number) => emit(debugStartEncounter(self(), enemyId, enemyHp)),
    attack: (weapon = "fists") => { const e = selfEngagedEnc(); if (e) emit(attack(self(), weapon, e.id)); },
    eatMeat: () => emit(eatMeat(self())),
    getDrops: () => Object.keys(state.drops).map((id) => ({ id, loot: { ...state.drops[id].loot } })),
    takeDrop: (id?: string) => { const d = id ?? Object.keys(state.drops)[0]; if (d) emit(takeDrop(self(), d)); },
    getShip: () => ({ ...state.ship }),
    enterRoom: (room: string, cx?: number, cz?: number) => {
      let ecx = cx, ecz = cz;
      if (ecx === undefined || ecz === undefined) { const s = worldMap.sites.find((s) => s.type === "executioner"); if (s) { ecx = s.cx; ecz = s.cz; } }
      if (ecx !== undefined && ecz !== undefined) emit(enterRoom(self(), ecx, ecz, room));
    },
    getRooms: () => { const s = worldMap.sites.find((s) => s.type === "executioner"); const k = s ? s.cx + "," + s.cz : null; return k ? { ...(state.sites?.[k]?.rooms ?? {}) } : {}; },
    getWings: () => { const s = worldMap.sites.find((s) => s.type === "executioner"); const k = s ? s.cx + "," + s.cz : null; return k ? { ...(state.sites?.[k]?.wings ?? {}) } : {}; },
    reinforceShip: () => emit(reinforceShip(self())),
    upgradeEngine: () => emit(upgradeEngine(self())),
    grantPerk: (perk: string) => emit(debugGrantPerk(perk)),
    liftOff: () => { const w = shipWorldPos(); emit(liftOff(self(), w.x, w.z)); },
    flightFire: () => emit(flightFire(self())),
    endFlight: () => emit(endFlight(self())),
    getFlight: () => { const f = state.flight; return f ? { status: f.status, hull: f.hull, hullMax: f.hullMax, progress: f.progress, asteroids: f.asteroids.length, engine: f.engine } : null; },
    prestige: () => restartWorld(),
    getProgress: () => ({ prestige: state.prestige }),
    pauseEncounters: () => { encountersPaused = true; },
    getPlayer: () => { const p = player.position; return { x: p.x, y: p.y, z: p.z }; },
    getTerrainStats: () => terrain.stats, // P2 : colliders (physique) vs chunks (visible)
    getSiteStats: () => sites.stats, // P5 : sites posés + paliers LOD (détail/silhouette)
    getHardwareScaling: () => engine.getHardwareScalingLevel(), // P6 : résolution interne
    setHardwareScaling: (level: number) => setScaling(level),
    setAutoPerf: (on: boolean) => { autoPerf = on; perfAcc = 0; },
    getFocusVerb: () => currentFocus?.verb ?? null,
    getAudio: () => ({
      unlocked: audio.unlocked, music: audio.currentMusic, eventMusic: audio.currentEventMusic,
      master: audio.master, musicVol: audio.musicVolume, sfxVol: audio.sfxVolume, muted: audio.muted,
      disabledSfx: audio.getDisabledSfx(),
    }),
    getActiveEvent: () => (state.activeEvent ? { ...state.activeEvent } : null),
    triggerEvent: (id: string) => {
      if (net.connected && !net.isHost) return; // seul l'hôte déclenche
      state = reduce(state, { type: "DEBUG_TRIGGER_EVENT", id });
      if (net.connected) net.broadcastStateSync(snapshot());
    },
    // DEBUG : gèle l'ordonnanceur d'événements (pour les tests qui isolent une autre mécanique
    // sur de longs fast-forwards). triggerEvent reste utilisable (il court-circuite le scheduler).
    pauseEventScheduler: () => { state = { ...state, eventScheduledAt: Number.MAX_SAFE_INTEGER }; },
    forceGather: () => emit(gatherWood(self(), config.gather.woodPerChop)),
    lightFire: () => emit(lightFire(self())),
    stoke: () => emit(stokeFire(self())),
    deposit: () => emit(deposit(self())),
    repairCabin: () => emit(repairCabin(self())),
    upgradeCabin: () => emit(upgradeCabin(self())),
    setCabinTier: (tier: number) => emit(debugSetCabinTier(tier)),
    // DEBUG : remplit l'entrepôt à `frac` du plafond de chaque ressource connue (test des paliers/étiquettes).
    fillStorage: (frac = 1) => {
      for (const id of Object.keys(RESOURCE_LABELS)) emit(debugSet(self(), "storage", id, Math.floor(storageCap(state.cabinTier, id) * frac)));
    },
    build: (id: string) => emit(build(self(), id)),
    harvestTrap: (index = 0) => emit(harvestTrap(self(), index)),
    assignWorker: (job: string) => emit(assignWorker(self(), job)),
    openBuilderDialogue: () => openBuilderDialogue(),
    openVillageBoard: () => openBoard(),
    openSettings: () => openSettings(),
    saveNow: () => saveGame(state),
    clearSave: () => clearSave(),
    teleport: (x: number, z: number) => player.teleport(x, z),
    fastForward: (seconds: number) => {
      if (net.connected && !net.isHost) return;
      const n = Math.floor(seconds * config.simTickHz);
      for (let i = 0; i < n; i++) state = reduce(state, tick());
      if (net.connected) net.broadcastStateSync(snapshot());
    },
    showcaseCamera: () => {
      const p = player.position;
      camera.setPosition(new Vector3(p.x + 2, p.y + 9, p.z + 13));
    },
    // Cadre l'intérieur de la cabane (coffre, étagères, grand tableau) pour la capture.
    showcaseCabin: () => {
      player.teleport(cabin.center.x + 1, cabin.center.z + 0.5);
      camera.setPosition(new Vector3(cabin.center.x + 6, cabin.center.y + 7, cabin.center.z + 8));
    },
    // Debug : cadre le grand tableau DE FACE (caméra figée) pour vérifier le texte.
    showcaseBoard: () => {
      cameraFollow = false;
      const bp = cabin.boardPosition;
      camera.setTarget(new Vector3(bp.x - 0.8, cabin.center.y + 1.3, bp.z + 0.3));
      camera.setPosition(new Vector3(bp.x + 3, cabin.center.y + 1.35, bp.z + 0.3));
    },
    // Debug : VUE DE DESSUS du campement (plan) pour juger l'implantation des bâtiments.
    planView: (height = 64) => {
      cameraFollow = false;
      scene.fogMode = Scene.FOGMODE_NONE; // pas de brouillard pour lire le plan
      camera.lowerBetaLimit = 0.001; // débride le tangage (sinon clampé à 0.35 -> oblique)
      camera.upperRadiusLimit = 600;
      camera.setTarget(new Vector3(0, terrainHeight(0, 0), 0));
      camera.alpha = -Math.PI / 2; // -Z (nord/forêt) vers le HAUT de l'image
      camera.beta = 0.08; // quasi vertical (plan)
      camera.radius = height;
    },
    errors,
  };

  // ---- CONSOLE DE DÉVELOPPEMENT (DEV uniquement) : ENTER l'ouvre ; `/commande` l'exécute.
  //      Les mutations d'état passent par `emit` (hôte-autoritaire) ; le reste agit en local.
  //      Mêmes commandes pilotables via window.__game.cmd(...) (Playwright / console). ----
  if (import.meta.env.DEV) {
    const cmdCtx: CommandCtx = {
      getState: () => state,
      self,
      emit,
      teleport: (x, z) => player.teleport(x, z),
      playerPos: () => ({ x: player.position.x, z: player.position.z }),
      getWorldMap: () => worldMap,
      triggerEvent: (id) => window.__game?.triggerEvent?.(id),
      fastForward: (s) => window.__game?.fastForward?.(s),
      clearSave: () => clearSave(),
      saveNow: () => saveGame(state),
      setFly: (on) => player.setFly(on),
      isFlying: () => player.isFlying,
      setNoclip: (on) => player.setNoclip(on),
      isNoclip: () => player.isNoclip,
      reseed: (n) => {
        emit(debugSetSeed(n));
        configureBorders(n >>> 0); // re-tirer les bordures pour la nouvelle graine
        worldMap = generateWorld(n >>> 0);
        registerPlateaus(worldMap); // aplanissement aux sites pour la nouvelle graine
        terrain.regenerate(worldMap, player.position);
        sites.placeAll(worldMap, entities);
        interiors.setMap(worldMap);
        siteLoot.setMap(worldMap);
      },
    };
    devConsole = new DevConsole(
      (line) => {
        const out = runCommand(line, cmdCtx);
        if (out) hud.toast(out); // la console se ferme après exécution -> retour via toast
        return out;
      },
      (open) => (open ? pointerLook.release() : pointerLook.engage()),
    );
    if (window.__game) window.__game.cmd = (line: string) => runCommand(line, cmdCtx);

    // Éditeur de spawn (F2 ou window.__game.editSpawn()) : déplacer/tourner/ajouter les
    // bâtiments en vue de dessus, puis exporter le campLayout (cf. docs/plan-campement.md).
    spawnEditor = new SpawnEditor(scene, camera, {
      spawnModel: (id, x, z, ry) => village.spawnModel(id, x, z, ry),
      cabin: { x: cabin.center.x, z: cabin.center.z },
      setFollow: (on) => { cameraFollow = on; },
      setLookEnabled: (on) => pointerLook.setEnabled(on),
      setWorldHidden: (h) => { village.setVisible(!h); cabin.setHidden(h); villagers.setVisible(!h); campDecor.setVisible(!h); campLights.setVisible(!h); campRuins.setVisible(!h); ocean.setEnabled(!h); },
    });
    if (window.__game) window.__game.editSpawn = () => spawnEditor?.toggle();

    // DEBUG (DEV) : pilotage de frames + inspection du chantier, pour vérifier le rendu de la
    // construction quand l'onglet d'aperçu n'est pas visible (rAF figé). Hors build de prod.
    const dbg = window.__game as unknown as Record<string, unknown>;
    if (dbg) {
      dbg.renderFrame = (n = 1): void => { for (let i = 0; i < n; i++) scene.render(); };
      dbg.getConstructing = (): Array<{ id: string; doneAt: number }> => state.constructing.map((c) => ({ ...c }));
      dbg.getChantierSite = (): { x: number; z: number } | null => village.getChantierSite();
      dbg.getChantierProgress = (): number => village.getChantierProgress();
      dbg.builderTeleport = (x: number, z: number): void => stranger.teleport(x, z);
      // Faux joueur distant (test des avatars + étiquette de nom en solo) : posé DEVANT le joueur.
      dbg.spawnRemote = (id = "TESTPEER", ahead = 3): void => {
        const p = player.position;
        remotes.setTransform(id, { x: p.x, y: p.y - 0.9, z: p.z + ahead, ry: Math.PI });
      };
      dbg.setRemoteName = (id: string, name: string): void => remotes.setName(id, name);
      dbg.stepCabin = (sec = 0.25): void => cabin.update(sec); // avance la montée de la cabane (anim render)
      dbg.cabinRise = (): number => cabin.getRiseProgress(); // avancement de la montée (0..1, -1 si aucune)
      dbg.campPathCount = (): number => campLayout.paths.length; // nb de segments de sentier (réseau du village)
      dbg.treesOnBuildings = (): number => { // arbres restant SUR une emprise (doit valoir 0 après construction)
        let n = 0; const trees = forest.getTrees();
        for (const c of craftables) { const r = CLEAR_R[c.id] ?? 2.6; for (const p of village.getBuildingPositions(c.id)) for (const t of trees) if ((t.x - p.x) ** 2 + (t.z - p.z) ** 2 < r * r) n++; }
        return n;
      };
      dbg.interiorStats = (): { built: number; active: string | null; inside: boolean; colliders: number; dark: number } => interiors.stats;
      dbg.fpv = (): number => fpv; // facteur 1ʳᵉ personne lissé (0 = 3PV, 1 = FPV)
      dbg.th = (x: number, z: number): number => terrainHeight(x, z); // hauteur terrain (aplanie aux sites)
      dbg.interiorSites = (): Array<{ type: string; cx: number; cz: number; x: number; z: number }> => interiors.debugSites();
      dbg.shipSite = (): { cx: number; cz: number; x: number; z: number } | null => { const s = worldMap.sites.find((s) => s.type === "executioner"); if (!s) return null; const w = worldMap.cellToWorldCenter(s.cx, s.cz); return { cx: s.cx, cz: s.cz, x: w.x, z: w.z }; };
      dbg.shipInteriorStats = (): { built: boolean; inside: boolean; room: string | null; colliders: number; dark: number } => shipInterior.stats;
      dbg.testThresholdCine = (site: "cave" | "mine" | "ship" = "ship"): void => {
        if (cine.active) return;
        const yaw = cameraYaw(camera), fx = Math.sin(yaw), fz = Math.cos(yaw);
        const dx = player.position.x + fx * 3, dz = player.position.z + fz * 3;
        cineDoor.place(site, dx, terrainHeight(dx, dz) + 0.3, dz, yaw);
        cineDoor.setEnabled(true);
        cineCommit = null;
        cine.start("in", site);
      };
      dbg.cineActive = (): boolean => cine.active;
      dbg.shipRoomWorld = (room: string): { x: number; z: number } | null => {
        const s = worldMap.sites.find((s) => s.type === "executioner"); if (!s) return null;
        const w = worldMap.cellToWorldCenter(s.cx, s.cz);
        const r = executionerDungeon(s.cx, s.cz, worldMap.seed).rooms.find((x) => x.id === room); if (!r) return null;
        return { x: w.x + r.pos.x, z: w.z + r.pos.z }; // axis-aligned (cf. ShipInterior : yaw=0, aligné sur la sim)
      };
      dbg.inspect = (cx: number, cz: number, top = false, dist = 19): void => {
        cameraFollow = false;
        scene.fogMode = Scene.FOGMODE_NONE;
        camera.upperRadiusLimit = 600; camera.lowerBetaLimit = 0.001;
        const w = worldMap.cellToWorldCenter(cx, cz); const gy = terrainHeight(w.x, w.z);
        camera.setTarget(new Vector3(w.x, gy + (top ? 0 : 1.4), w.z));
        if (top) { camera.alpha = -Math.PI / 2; camera.beta = 0.5; camera.radius = dist === 19 ? 46 : dist; }
        else { const L = Math.hypot(w.x, w.z) || 1; camera.setPosition(new Vector3(w.x - (w.x / L) * dist, gy + dist * 0.28, w.z - (w.z / L) * dist)); }
      };
      dbg.takeAllLoot = (): number => {
        const ls = interiors.activeLoot(); let n = 0;
        for (const lt of ls) {
          emit(takeLoot(self(), lt.cx, lt.cz, lt.siteType, lt.nodeId));
          if (lt.kind === "deep" && lt.siteType.endsWith("mine")) emit(secureMine(self(), lt.cx, lt.cz, lt.siteType));
          n++;
        }
        return n;
      };
      dbg.takeNearestLoot = (): unknown => {
        const pp = player.position; let best: ReturnType<typeof interiors.activeLoot>[number] | null = null; let bd = Infinity;
        for (const lt of interiors.activeLoot()) { const d = Math.hypot(lt.x - pp.x, lt.z - pp.z); if (d < bd) { bd = d; best = lt; } }
        if (!best) return null;
        emit(takeLoot(self(), best.cx, best.cz, best.siteType, best.nodeId));
        if (best.kind === "deep" && best.siteType.endsWith("mine")) emit(secureMine(self(), best.cx, best.cz, best.siteType));
        return best;
      };
      // Gel/reprise de la boucle de rendu : permet de capturer une frame d'animation à l'arrêt
      // (sinon le temps réel défile entre deux commandes et l'anim se termine).
      dbg.stopLoop = (): void => engine.stopRenderLoop();
      dbg.startLoop = (): void => engine.runRenderLoop(() => scene.render());
    }
  }
}

boot().catch((err) => {
  console.error("[boot] échec :", err);
  const tag = document.getElementById("rendererTag");
  if (tag) tag.textContent = "ERREUR : " + (err?.message ?? String(err));
  window.__game = { ready: false, error: String(err?.message ?? err) };
});
