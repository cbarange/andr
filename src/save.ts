// ============================================================================
//  SAUVEGARDE AUTOMATIQUE — inspirée d'A Dark Room (engine.js : localStorage.gameState
//  = JSON.stringify(State), restauré au démarrage). Ici on sérialise l'état AUTORITAIRE
//  (le GameState, déjà sérialisable). La sim reste en mémoire ; localStorage ne sert qu'à
//  la persistance (≠ logique de jeu).
// ============================================================================

import type { GameState } from "./sim/state";

const KEY = "darkroom3d.save";
const VERSION = 2; // bump -> invalide les anciennes sauvegardes (v2 : palier de cabane `cabinTier`)
// Craftables DÉBLOQUÉS (révélés dans la liste de construction). Donnée LOCALE de présentation
// (≠ GameState déterministe), persistée à part façon A Dark Room : une fois révélé, ça le reste.
const DISC_KEY = "darkroom3d.discovered";

export function saveGame(state: GameState): void {
  try {
    // On NE sérialise PAS `carried` (le sac de chaque pair) : il est re-vidé au chargement
    // (`selfId` change à chaque session) -> inutile de gonfler le blob avec les sacs de tous.
    const slim: GameState = { ...state, carried: {} };
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, state: slim }));
  } catch {
    /* quota / mode privé : on ignore */
  }
}

/**
 * Migration de sauvegarde : transforme une save d'une version ANCIENNE vers la version courante,
 * au lieu de la JETER (perte de progression). Règle (cf. docs/roadmap-v2.md A4) :
 *  - AJOUT ADDITIF d'un champ d'état -> NE PAS bumper VERSION : le spread
 *    `{ ...createInitialState(), ...saved }` au boot (main.ts) back-fille le champ manquant par son
 *    défaut. Rien à faire ici.
 *  - CHANGEMENT CASSANT (renommer/restructurer/changer d'unité) -> bumper VERSION et ajouter une
 *    étape `if (v === N) { ...transforme s...; v = N + 1; }` ci-dessous.
 * Renvoie l'état migré, ou `null` si la save est irrécupérable (plus récente que le code).
 * PURE (pas de localStorage) -> testable.
 */
export function migrateSave(state: GameState, fromVersion: number): GameState | null {
  if (fromVersion > VERSION) return null; // save plus récente que le code : on n'écrase pas à l'aveugle
  const s = state;
  let v = fromVersion;
  // (aucune migration CASSANTE à ce jour — les ajouts additifs sont back-fillés au boot.)
  // Exemple futur (M7, ajout de la survie) :
  //   if (v === 2) { s = { ...s, water: 10, food: 0 } as GameState; v = 3; }
  void v;
  return s;
}

/** Charge la sauvegarde (migrée si besoin), ou null si absente/illisible/trop récente. */
export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { version?: number; state?: GameState };
    if (!data || !data.state || typeof data.version !== "number") return null;
    return migrateSave(data.state, data.version);
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(DISC_KEY);
  } catch {
    /* ignore */
  }
}

/** Persiste l'ensemble des craftables débloqués (révélés). */
export function saveDiscovered(ids: string[]): void {
  try {
    localStorage.setItem(DISC_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

/** Charge les craftables débloqués (liste vide si absente/illisible). */
export function loadDiscovered(): string[] {
  try {
    const raw = localStorage.getItem(DISC_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// Réglages AUDIO (volumes + mute). Préférence LOCALE du joueur (≠ GameState
// déterministe, ≠ réseau) — persistée à part, comme `discovered`.
const AUDIO_KEY = "darkroom3d.audio";
export interface AudioSettings {
  master: number; music: number; sfx: number; muted: boolean;
  disabledSfx: string[]; // effets ponctuels désactivés (par clé logique)
}

export function saveAudioSettings(s: AudioSettings): void {
  try {
    localStorage.setItem(AUDIO_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

// Réglages de CONFORT (FOV + sensibilité souris). Préférence LOCALE (≠ GameState, ≠ réseau),
// persistée à part — comme l'audio. Accessibilité de base (GAG : FOV + sensibilité réglables).
const COMFORT_KEY = "darkroom3d.comfort";
export interface ComfortSettings {
  fov: number; // champ de vision de base (RADIANS)
  sensitivity: number; // multiplicateur de sensibilité souris (1 = défaut)
}

export function saveComfortSettings(s: ComfortSettings): void {
  try {
    localStorage.setItem(COMFORT_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** Charge les réglages de confort, ou null si absents/illisibles (-> défauts du moteur). */
export function loadComfortSettings(): ComfortSettings | null {
  try {
    const raw = localStorage.getItem(COMFORT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<ComfortSettings>;
    if (typeof d?.fov !== "number" || typeof d?.sensitivity !== "number") return null;
    return { fov: d.fov, sensitivity: d.sensitivity };
  } catch {
    return null;
  }
}

/** Charge les réglages audio, ou null si absents/illisibles (-> défauts du moteur). */
export function loadAudioSettings(): AudioSettings | null {
  try {
    const raw = localStorage.getItem(AUDIO_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<AudioSettings>;
    if (typeof d?.master !== "number" || typeof d?.music !== "number" || typeof d?.sfx !== "number") return null;
    const disabledSfx = Array.isArray(d.disabledSfx)
      ? d.disabledSfx.filter((x): x is string => typeof x === "string")
      : [];
    return { master: d.master, music: d.music, sfx: d.sfx, muted: !!d.muted, disabledSfx };
  } catch {
    return null;
  }
}
