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
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, state }));
  } catch {
    /* quota / mode privé : on ignore */
  }
}

/** Charge la sauvegarde, ou null si absente/incompatible. */
export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { version?: number; state?: GameState };
    if (!data || data.version !== VERSION || !data.state) return null;
    return data.state;
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
