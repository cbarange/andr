// ============================================================================
//  RNG À GRAINE (mulberry32) — §3.3 "simulation déterministe".
//  La logique de jeu ne doit JAMAIS appeler Math.random() directement : tout
//  aléatoire passe par ici. L'état (un entier 32 bits) fait partie de l'état du
//  jeu, ce qui rend les tirages reproductibles à graine + séquence identiques.
// ============================================================================

export interface RngState {
  /** État interne 32 bits non signé. */
  seed: number;
}

export function createRng(seed: number): RngState {
  return { seed: seed >>> 0 };
}

export function cloneRng(rng: RngState): RngState {
  return { seed: rng.seed };
}

/** Avance l'état et renvoie un flottant dans [0, 1). Mute `rng` en place. */
export function nextFloat(rng: RngState): number {
  rng.seed = (rng.seed + 0x6d2b79f5) >>> 0;
  let t = rng.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Entier dans [0, maxExclusive). */
export function nextInt(rng: RngState, maxExclusive: number): number {
  return Math.floor(nextFloat(rng) * maxExclusive);
}
