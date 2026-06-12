// ============================================================================
//  COMBAT (M8) — helpers PURS & déterministes (§3.1, §3.3), fidèles A Dark Room.
//  Aucune dépendance Babylon/DOM ; tout l'aléa passe par le RNG À GRAINE fourni
//  par l'appelant (le reducer, côté hôte). Testable au terminal.
// ============================================================================

import { RngState, nextFloat, nextInt } from "./rng";
import { config, enemiesForTier, weaponById, weapons, type EnemyDef, type WeaponDef } from "../../data/world";
import { GameState, carriedOf, type Encounter } from "./state";

/**
 * Tirage de DÉCLENCHEMENT d'une rencontre (FIGHT_CHANCE d'ADR, par période et non par case —
 * adaptation « par temps » actée comme la survie M7). Routes : chance réduite (R4 « sécurisée »).
 * CONSOMME un tirage du RNG fourni.
 */
export function shouldTriggerEncounter(rng: RngState, tier: number, onRoad: boolean): boolean {
  if (tier <= 0) return false;
  const base = tier === 4 ? config.combat.caveFightChance : config.combat.fightChance;
  const chance = base * (onRoad ? config.combat.roadChanceFactor : 1);
  return nextFloat(rng) < chance;
}

/** Choisit un ennemi du tier (tirage pondéré par `weight`). CONSOMME un tirage. */
export function pickEnemy(rng: RngState, tier: number): EnemyDef | null {
  const pool = enemiesForTier(tier);
  if (pool.length === 0) return null;
  let total = 0;
  for (const e of pool) total += e.weight;
  let r = nextFloat(rng) * total;
  for (const e of pool) {
    r -= e.weight;
    if (r <= 0) return e;
  }
  return pool[pool.length - 1];
}

/**
 * Butin d'une victoire : tirages INDÉPENDANTS par entrée `[ressource, chance, min, max]`
 * (fidèle au modèle d'encounters.js). CONSOMME des tirages (2 par entrée au plus).
 */
export function rollEnemyLoot(rng: RngState, enemy: EnemyDef): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [res, chance, min, max] of enemy.loot) {
    if (nextFloat(rng) >= chance) continue;
    out[res] = (out[res] ?? 0) + min + nextInt(rng, max - min + 1);
  }
  return out;
}

/** Le joueur possède-t-il cette arme ? (`fists` toujours ; sinon présence au SAC, pattern torche.) */
export function ownsWeapon(state: GameState, playerId: string, weaponId: string): boolean {
  if (weaponId === "fists") return true;
  return carriedOf(state, playerId, weaponId) > 0;
}

/** L'arme a-t-elle ses MUNITIONS (au SAC) ? (fusil -> balle ; grenade -> elle-même ; sinon oui.) */
export function hasAmmo(state: GameState, playerId: string, w: WeaponDef): boolean {
  if (!w.ammo) return true;
  return carriedOf(state, playerId, w.ammo) >= 1;
}

/** Dégâts d'une frappe : « barbare » booste la MÊLÉE ×1,5 (floor) — fidèle events.js d'ADR. M10. */
export function attackDamage(w: WeaponDef, perks: Record<string, true>): number {
  if (w.kind === "melee" && perks["barbarian"]) return Math.floor(w.damage * 1.5);
  return w.damage;
}

/** Chance de toucher du JOUEUR : 0.8 +0.1 si « précis » — fidèle getHitChance d'ADR. M10. */
export function playerHit(perks: Record<string, true>): number {
  return config.combat.playerHitChance + (perks["precise"] ? 0.1 : 0);
}

/** Chance de toucher de L'ENNEMI : son `hit`, ×0.8 si « insaisissable » — fidèle ADR. M10. */
export function enemyHit(enemyHitChance: number, perks: Record<string, true>): number {
  return enemyHitChance * (perks["evasive"] ? 0.8 : 1);
}

/**
 * Meilleure arme PRÊTE du joueur (plus gros dégâts d'abord, poings en dernier recours), ou
 * `null` si tout est en recharge / sans munitions. Sert au verbe « frapper » (UI) — PUR.
 */
export function bestReadyWeapon(state: GameState, playerId: string, enc: Encounter): WeaponDef | null {
  let best: WeaponDef | null = null;
  for (const w of weapons) {
    if (!ownsWeapon(state, playerId, w.id)) continue;
    if (!hasAmmo(state, playerId, w)) continue;
    if (state.tick < (enc.weaponReadyAt[w.id] ?? 0)) continue;
    if (!best || w.damage > best.damage) best = w;
  }
  return best;
}

/** Définition d'une arme par id (réexport pratique pour le rendu/HUD). */
export { weaponById };
