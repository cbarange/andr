// ============================================================================
//  ÉTAT DU JEU — structure de données pure (§3.1 "le cerveau").
//  Sérialisable, sans méthode, sans dépendance moteur. C'est ce qui pourra être
//  transmis/recalculé pour le multijoueur.
// ============================================================================

import { RngState, createRng } from "./rng";
import { config, worldgen } from "../../data/world";

// --- M1 : énumérations du feu, de la température et de l'étrangère ---
// (entiers volontairement : sérialisables, comparables, indexent les libellés)
export const Fire = { Dead: 0, Smoldering: 1, Flickering: 2, Burning: 3, Roaring: 4 } as const;
export const Temp = { Freezing: 0, Cold: 1, Mild: 2, Warm: 3, Hot: 4 } as const;

/** L'étrangère n'est pas encore là. */
export const BUILDER_ABSENT = -1;

export interface GameState {
  /** Nombre de tics de simulation écoulés (pas fixe, §3.6). */
  tick: number;
  /**
   * ENTREPÔT du village (map ressource -> quantité). Rempli par les ouvriers et les
   * dépôts ; consommé par la construction et les chaînes de métiers. Partagé/autoritaire.
   */
  resources: Record<string, number>;
  /**
   * SAC porté par chaque joueur (playerId -> ressource -> quantité). Plafonné.
   * Rempli par la récolte manuelle ; nourrit le feu / répare la cabane ; se vide à l'entrepôt.
   */
  carried: Record<string, Record<string, number>>;
  /** La cabane en ruine a-t-elle été réparée ? (débloque entrepôt + construction). */
  cabinRepaired: boolean;
  /**
   * Palier de la cabane : 0 (ruine) / 1 (réparée) / 5 (améliorée) / 10 (entrepôt). La VALEUR
   * est le multiplicateur de plafond de stock (cf. storageCap). `cabinRepaired` reste dérivé
   * (cabinTier >= 1) — conservé pour compat des appels existants.
   */
  cabinTier: number;
  /** Bâtiments ACHEVÉS (map id -> nombre). Un bâtiment ne compte ici — donc dans la sim
   *  (capacité, métiers, plafonds) — qu'une fois son chantier terminé. M2. */
  buildings: Record<string, number>;
  /**
   * File de CHANTIERS en cours (la constructrice en bâtit un à la fois, dans l'ordre).
   * Le 1ᵉʳ élément est ACTIF ; `doneAt` = tic d'achèvement (les suivants ont `doneAt: 0`
   * tant qu'ils attendent leur tour). À l'échéance : `buildings[id]++`, on retire la tête,
   * et le suivant démarre. Déterministe (tics) -> rejouable et synchronisable en P2P.
   */
  constructing: Array<{ id: string; doneAt: number }>;

  // --- M3 : population & métiers ---
  /** Nombre total de villageois. */
  population: number;
  /** Villageois assignés par métier (map job -> nombre). Les non-assignés sont « libres ». */
  workers: Record<string, number>;
  /** Métiers ayant effectivement produit au dernier cycle de revenu (pour le feedback). */
  producing: Record<string, boolean>;

  // --- M5 : événements ---
  /** Événement en cours (id + scène courante), ou `null` si aucun. Piloté par l'hôte. */
  activeEvent: { id: string; scene: string } | null;
  /** Tic du prochain déclenchement d'événement (0 = pas encore amorcé). */
  eventScheduledAt: number;
  /** Effets différés en attente (ex. retour du marchand) : appliqués quand `tick >= at`. */
  pendingEffects: Array<{ at: number; stores: Record<string, number>; note?: string }>;

  // --- M1 : la chambre ---
  /** Niveau du feu : 0 (mort) .. 4 (rugissant). */
  fire: number;
  /** Température de la pièce : 0 (glacial) .. 4 (brûlant), converge vers le feu. */
  temperature: number;
  /** Étape de l'étrangère : -1 (absente), 0..maxLevel (3 = prête à construire). */
  builder: number;

  // Échéances internes (en n° de tic) pour un avancement déterministe et pur.
  fireCoolAt: number; // tic où le feu perdra un cran
  tempAdjustAt: number; // tic où la température s'ajustera
  builderAdvanceAt: number; // tic où l'étrangère franchira l'étape suivante
  builderTendReadyAt: number; // tic à partir duquel la constructrice peut RÉALIMENTER le feu
  builderTendingUntil: number; // tic jusqu'auquel elle est « en déplacement vers le feu » (rendu)
  stokeReadyAt: number; // tic à partir duquel on peut ré-attiser
  /** Par piège (index -> tic) : tic à partir duquel CE piège est plein/relevable. */
  trapReadyAt: Record<number, number>;
  popGrowAt: number; // tic d'arrivée du prochain villageois
  incomeAt: number; // tic de la prochaine application des revenus

  /** État du générateur pseudo-aléatoire à graine (déterminisme, §3.3). */
  rng: RngState;

  // --- M7 : génération du monde ---
  /**
   * Graine du MONDE (disposition de la carte). Distincte de `rng` : la carte est une
   * fonction PURE de cette graine (cf. sim/worldgen.ts), donc identique chez tous les
   * pairs — seule cette graine voyage sur le réseau. Stable pour toute la partie.
   */
  worldSeed: number;

  // --- M9 : exploration des sites (mines & grottes) ---
  /**
   * État D'EXPLORATION par site, indexé par `siteKey(cx,cz)`. La DISPOSITION et le BUTIN sont
   * dérivés de `worldSeed` (cf. sim/dungeon.ts — rien à stocker) ; ICI ne vit que ce qui CHANGE :
   * ce qui a été découvert / pris / sécurisé / nettoyé. Autoritaire (snapshot + sauvegarde),
   * d'où le « butin commun à toute la carte » (premier-servi : `taken` partagé). Champ ADDITIF
   * (back-fillé `{}` au boot pour les vieilles sauvegardes) -> pas de bump de save VERSION.
   */
  sites: Record<string, SiteProgress>;

  // --- Routes (extension M9, cf. docs/routes-sites.md) : cellules de route tracées quand on
  //     NETTOIE un site / SÉCURISE une mine. Réseau qui FUSIONNE (route vers le point connectif le
  //     plus proche). Clé = `siteKey(cx,cz)`. Déterministe (géométrique) -> P2P via snapshot. Additif. ---
  roads: Record<string, true>;
}

/** Progression d'exploration d'UN site (mine/grotte). Tous les champs sont optionnels/diffus. */
export interface SiteProgress {
  /** Type du site (`cave`/`ironmine`/…), renseigné à la 1ʳᵉ interaction — sert au gating métier. */
  type?: string;
  /** Le joueur a découvert le site (cosmétique / fog-of-war). */
  discovered?: boolean;
  /** Nœuds dont le BUTIN a déjà été pris (nodeId -> true). PREMIER-SERVI global. */
  taken?: Record<string, boolean>;
  /** Nœuds dont l'éboulement a été dégagé (nodeId -> true). */
  hazards?: Record<string, boolean>;
  /** Mine : le filon a été sécurisé ⇒ débloque le métier de mineur correspondant. */
  secured?: boolean;
  /** Grotte : entièrement nettoyée ⇒ se convertit en avant-poste (rendu). */
  cleared?: boolean;
}

/** Clé d'un site dans `state.sites` à partir de ses coordonnées de cellule. */
export function siteKey(cx: number, cz: number): string {
  return cx + "," + cz;
}

/** Accès sûr à un stock (0 si la clé n'existe pas encore). */
export function stockOf(state: GameState, resource: string): number {
  return state.resources[resource] ?? 0;
}

/** Nombre total de villageois assignés à un métier. */
export function sumWorkers(workers: Record<string, number>): number {
  let n = 0;
  for (const k of Object.keys(workers)) n += workers[k];
  return n;
}

/**
 * Villageois **bûcherons par défaut** : ceux qui ne sont affectés à AUCUN métier spécialisé.
 * Fidèle à A Dark Room — un villageois sans métier n'est jamais oisif, il ramasse du bois.
 * (Robuste à une éventuelle clé `gatherer` résiduelle : le bûcheron n'est pas un métier assigné.)
 */
export function freeWorkers(state: GameState): number {
  const specialized = sumWorkers(state.workers) - (state.workers["gatherer"] ?? 0);
  return state.population - specialized;
}

/** Quantité d'une ressource dans le sac d'un joueur. */
export function carriedOf(state: GameState, playerId: string, resource: string): number {
  return state.carried[playerId]?.[resource] ?? 0;
}

/** Total porté par un joueur (toutes ressources confondues). */
export function carriedTotal(state: GameState, playerId: string): number {
  const bag = state.carried[playerId];
  if (!bag) return 0;
  let n = 0;
  for (const k of Object.keys(bag)) n += bag[k];
  return n;
}

/** Capacité de transport du sac (base + bonus de la charrette). */
export function carryCapacity(state: GameState): number {
  const cart = (state.buildings["cart"] ?? 0) > 0 ? config.cartCapBonus : 0;
  return config.carryCapBase + cart;
}

/**
 * Nombre de bâtiments d'un type qui COMPTENT pour le maximum et le coût escaladant :
 * les exemplaires ACHEVÉS plus ceux EN CHANTIER (déjà payés). Évite de dépasser le `maximum`
 * en enfilant plusieurs chantiers du même bâtiment avant qu'ils ne soient finis.
 */
export function plannedCount(state: GameState, id: string): number {
  let n = state.buildings[id] ?? 0;
  for (const c of state.constructing) if (c.id === id) n++;
  return n;
}

export function createInitialState(seed: number, initialWood: number): GameState {
  return {
    tick: 0,
    resources: initialWood > 0 ? { wood: initialWood } : {},
    carried: {},
    cabinRepaired: false,
    cabinTier: 0,
    buildings: {},
    constructing: [],
    population: 0,
    workers: {},
    producing: {},
    activeEvent: null,
    eventScheduledAt: 0,
    pendingEffects: [],
    fire: Fire.Dead,
    temperature: Temp.Freezing,
    builder: BUILDER_ABSENT,
    fireCoolAt: 0,
    tempAdjustAt: 0,
    builderAdvanceAt: 0,
    builderTendReadyAt: 0,
    builderTendingUntil: 0,
    stokeReadyAt: 0,
    trapReadyAt: {},
    popGrowAt: 0,
    incomeAt: 0,
    rng: createRng(seed),
    worldSeed: worldgen.seed,
    sites: {},
    roads: {},
  };
}
