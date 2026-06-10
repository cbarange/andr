// ============================================================================
//  PERF ADAPTATIVE (P6) — décision PURE (aucune dépendance Babylon -> testable au
//  terminal). On vise un FPS cible en jouant sur le « hardware scaling » du moteur :
//  monter le niveau = rendre à plus basse résolution interne (moins de pixels ->
//  plus de FPS) ; le baisser = revenir vers la pleine résolution quand le FPS est
//  confortable. Bande morte autour de la cible pour éviter l'oscillation.
//  Le levier choisi (résolution) est PRÉVISIBLE : il ne touche ni la géométrie ni
//  les post-process (contrairement à SceneOptimizer). Voir docs/perf-rendu.md (P6).
// ============================================================================

export const PERF_TARGET = 55; // FPS visé
export const SCALE_MIN = 1.0; // pleine résolution native
export const SCALE_MAX = 2.0; // 1/4 des pixels (2× en linéaire) : plancher de qualité
export const SCALE_STEP = 0.15; // pas d'ajustement par tick
const LOW = 5; // sous (cible - LOW) -> on dégrade (monte le scaling)
const HIGH = 3; // au-dessus de (cible + HIGH) -> on améliore (baisse le scaling)

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Niveau de hardware scaling à appliquer au prochain tick, selon le FPS mesuré.
 * Renvoie `current` inchangé dans la bande morte (pas d'oscillation).
 */
export function nextScaling(fps: number, current: number): number {
  if (fps < PERF_TARGET - LOW && current < SCALE_MAX) return round2(Math.min(SCALE_MAX, current + SCALE_STEP));
  if (fps > PERF_TARGET + HIGH && current > SCALE_MIN) return round2(Math.max(SCALE_MIN, current - SCALE_STEP));
  return current;
}
