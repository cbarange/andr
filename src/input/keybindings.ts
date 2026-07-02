// ============================================================================
//  BINDINGS CLAVIER (rebind) — MODÈLE PUR, testable au terminal (aucune dépendance DOM/Babylon).
//  Source de vérité unique action -> touches, consommée par TOUS les lecteurs de touches :
//  InputManager (déplacement/interaction), raccourcis globaux de main.ts (V/M/R/F3) et la
//  navigation clavier des dialogues (qui RÉUTILISE les bindings de déplacement — pas de
//  binding propre, sinon double source de vérité).
//
//  Conventions (cf. docs/rebind-clavier-plan.md) :
//   - Les touches sont stockées en `e.key.toLowerCase()` (" " pour Espace, "arrowup", "shift"…).
//   - UNE ACTION peut avoir PLUSIEURS touches (défauts : ZQSD + WASD + flèches -> AZERTY/QWERTY).
//   - Touches RÉSERVÉES (jamais rebindables) : Échap (système : ferme l'UI + déverrouille le
//     pointeur), Entrée/F2 (outils DEV), Tab (focus navigateur).
//   - 100 % présentation/entrée : aucune incidence sim/réseau/déterminisme.
// ============================================================================

export type Action =
  | "forward" | "back" | "left" | "right" | "jump" | "descend"
  | "interact" | "eat" | "toggleView" | "toggleMinimap" | "spyglass" | "toggleDebug";

export type Bindings = Record<Action, string[]>;

/** Ordre d'affichage + libellés FR du panneau de remappage (source unique pour l'UI). */
export const ACTION_LABELS: Array<{ action: Action; label: string }> = [
  { action: "forward", label: "avancer" },
  { action: "back", label: "reculer" },
  { action: "left", label: "gauche" },
  { action: "right", label: "droite" },
  { action: "jump", label: "sauter / monter" },
  { action: "descend", label: "descendre (vol)" },
  { action: "interact", label: "interagir" },
  { action: "eat", label: "manger / se soigner" },
  { action: "toggleView", label: "vue 1ʳᵉ/3ᵉ personne" },
  { action: "toggleMinimap", label: "minimap plein écran" },
  { action: "spyglass", label: "longue-vue (maintenir)" },
  { action: "toggleDebug", label: "overlay debug" },
];

export const DEFAULT_BINDINGS: Bindings = {
  forward: ["z", "w", "arrowup"],
  back: ["s", "arrowdown"],
  left: ["q", "a", "arrowleft"],
  right: ["d", "arrowright"],
  jump: [" "],
  descend: ["shift"],
  interact: ["e"],
  eat: ["f"],
  toggleView: ["v"],
  toggleMinimap: ["m"],
  spyglass: ["r"],
  toggleDebug: ["f3"],
};

/** Touches jamais rebindables (système / outils DEV / navigation focus). */
const RESERVED = new Set(["escape", "enter", "f2", "tab"]);

/** Normalise un événement clavier en touche stockable, ou null si réservée/à ignorer. */
export function normalizeKey(e: { key: string }): string | null {
  const k = e.key.toLowerCase();
  if (k === "spacebar") return " "; // vieux navigateurs
  if (RESERVED.has(k)) return null;
  return k;
}

/** Première action liée à cette touche (pour les raccourcis globaux), ou null. */
export function actionForKey(b: Bindings, key: string): Action | null {
  for (const { action } of ACTION_LABELS) if (b[action].includes(key)) return action;
  return null;
}

/** Ajoute `key` à `action`, en la RETIRANT de toute autre action (une touche = une action). Pur. */
export function withBinding(b: Bindings, action: Action, key: string): Bindings {
  const out = {} as Bindings;
  for (const { action: a } of ACTION_LABELS) {
    const kept = b[a].filter((k) => k !== key);
    out[a] = a === action ? [...kept, key] : kept;
  }
  return out;
}

/** Retire `key` d'`action` (une action peut rester sans touche — l'UI le signale). Pur. */
export function clearBinding(b: Bindings, action: Action, key: string): Bindings {
  return { ...b, [action]: b[action].filter((k) => k !== key) };
}

/** Fusionne une sauvegarde PARTIELLE sur les défauts (évolution du schéma : action absente -> défaut). */
export function mergeDefaults(partial: Partial<Record<string, unknown>> | null | undefined): Bindings {
  const out = {} as Bindings;
  for (const { action } of ACTION_LABELS) {
    const v = partial?.[action];
    out[action] = Array.isArray(v) && v.every((k) => typeof k === "string")
      ? (v as string[]).filter((k) => !RESERVED.has(k))
      : [...DEFAULT_BINDINGS[action]];
  }
  return out;
}

/** Libellé COURT et lisible d'une touche pour les indices affichés (« Espace », « ↑ », « Maj »…). */
export function keyLabel(key: string): string {
  switch (key) {
    case " ": return "Espace";
    case "shift": return "Maj";
    case "arrowup": return "↑";
    case "arrowdown": return "↓";
    case "arrowleft": return "←";
    case "arrowright": return "→";
    default: return key.length === 1 ? key.toUpperCase() : key.toUpperCase();
  }
}

/** Libellé de la PREMIÈRE touche d'une action (pour les indices : « [E] interagir »…). */
export function actionKeyLabel(b: Bindings, action: Action): string {
  const k = b[action][0];
  return k ? keyLabel(k) : "—";
}

/** Libellé compact du bloc DÉPLACEMENT (« ZQSD », « WASD », « ↑←↓→ », sinon les 4 touches). */
export function moveClusterLabel(b: Bindings): string {
  const first = (a: Action): string => b[a][0] ?? "?";
  const combo = [first("forward"), first("left"), first("back"), first("right")];
  const joined = combo.join("");
  if (joined === "zqsd") return "ZQSD";
  if (joined === "wasd") return "WASD";
  return combo.map(keyLabel).join("");
}
