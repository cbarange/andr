// ============================================================================
//  COMBAT (M8) — helpers PURS & déterministes (§3.1, §3.3), fidèles A Dark Room.
//  Aucune dépendance Babylon/DOM ; tout l'aléa passe par le RNG À GRAINE fourni
//  par l'appelant (le reducer, côté hôte). Testable au terminal.
// ============================================================================

import { RngState, nextFloat, nextInt } from "./rng";
import { config, enemiesForTier, weaponById, weapons, type EnemyDef, type WeaponDef } from "../../data/world";
import { GameState, carriedOf, survivalOf, type SharedEncounter } from "./state";

/** Rayon (u) à partir duquel un joueur est ENGAGÉ dans une rencontre (peut frapper & être ciblé). */
export const ENGAGE_RADIUS = config.combat.engageRadius;
/** Rayon (u) de LAISSE : au-delà, plus aucun joueur « tient » l'ennemi -> il décroche (despawn). */
export const LEASH_RADIUS = config.combat.leashRadius;
/** Vitesse de POURSUITE de l'ennemi (u/s) — < sprint : on peut le semer. */
export const CHASE_SPEED = config.combat.chaseSpeed;

/**
 * Joueurs ENGAGÉS dans une rencontre (M8.6) : DEHORS, vivants (PV > 0), hors grâce de respawn, et
 * à ≤ `radius` de l'ennemi (via `state.playerPos`). PUR. Liste TRIÉE (ordre stable -> RNG porteur).
 */
export function engagedPids(state: GameState, enc: SharedEncounter, tick: number, radius: number = ENGAGE_RADIUS): string[] {
  const out: string[] = [];
  for (const pid of Object.keys(state.playerPos)) {
    const p = state.playerPos[pid];
    const sv = state.survival[pid];
    if (!sv || !sv.outside || sv.health <= 0 || tick < sv.respawnReadyAt) continue;
    if (Math.hypot(p.x - enc.x, p.z - enc.z) <= radius) out.push(pid);
  }
  return out.sort();
}

/**
 * Tirage de DÉCLENCHEMENT au PAS (M8.5/F1, fidèle `checkFight` d'ADR) : 20 % par pas (30 % en
 * caverne — intérim F3.2), appelé par le reducer UNIQUEMENT au-delà de FIGHT_DELAY pas.
 * CONSOMME un tirage du RNG fourni.
 */
export function stepFightTriggers(rng: RngState, tier: number): boolean {
  if (tier <= 0) return false;
  return nextFloat(rng) < config.combat.fightChance; // sous terre : plus d'aléatoire (grottes scriptées F3.2)
}

/**
 * Choisit un ennemi éligible : tier de distance ET terrain/biome (gating EXACT des `isAvailable`
 * d'ADR — la bête grondante n'existe qu'en forêt, le sniper que dans l'herbe…). Tirage UNIFORME
 * dans le pool (fidèle `triggerFight`). Pool vide (route, marais…) -> null = pas de combat,
 * mais le compteur de pas a été remis à zéro par l'appelant (fidèle, le tirage est « dépensé »).
 * CONSOMME un tirage.
 */
export function pickEnemy(rng: RngState, tier: number, terrain: string): EnemyDef | null {
  const pool = enemiesForTier(tier).filter((e) => e.terrain === terrain);
  if (pool.length === 0) { nextFloat(rng); return null; } // tirage consommé quand même (stabilité replay)
  return pool[nextInt(rng, pool.length)];
}

/**
 * Butin d'une victoire : tirages INDÉPENDANTS par entrée `[ressource, chance, min, max]`.
 * Quantité FIDÈLE à `drawLoot` d'ADR : `floor(random*(max-min)) + min` -> min..max-1 (le max
 * déclaré n'est jamais tiré ; min si max == min). CONSOMME des tirages (2 par entrée au plus).
 */
export function rollEnemyLoot(rng: RngState, enemy: EnemyDef): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [res, chance, min, max] of enemy.loot) {
    if (nextFloat(rng) >= chance) continue;
    out[res] = (out[res] ?? 0) + min + nextInt(rng, Math.max(1, max - min));
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
 * Meilleure arme PRÊTE du joueur dans une rencontre (plus gros dégâts d'abord, poings en dernier
 * recours), ou `null` si tout recharge / sans munitions. Cooldowns PAR JOUEUR (`enc.weaponReadyAt[pid]`).
 * Sert au verbe « frapper » (UI) — PUR.
 */
export function bestReadyWeapon(state: GameState, playerId: string, enc: SharedEncounter): WeaponDef | null {
  const ready = enc.weaponReadyAt[playerId] ?? {};
  let best: WeaponDef | null = null;
  for (const w of weapons) {
    if (!ownsWeapon(state, playerId, w.id)) continue;
    if (!hasAmmo(state, playerId, w)) continue;
    if (state.tick < (ready[w.id] ?? 0)) continue;
    if (!best || w.damage > best.damage) best = w;
  }
  return best;
}

/** Position après un pas de POURSUITE vers (tx,tz), borné par `CHASE_SPEED * dt`. PUR. */
export function stepEnemyToward(enc: SharedEncounter, tx: number, tz: number, dtSec: number): { x: number; z: number } {
  const dx = tx - enc.x, dz = tz - enc.z;
  const dist = Math.hypot(dx, dz);
  const step = CHASE_SPEED * dtSec;
  if (dist <= step || dist < 1e-4) return { x: tx, z: tz };
  return { x: enc.x + (dx / dist) * step, z: enc.z + (dz / dist) * step };
}

void survivalOf; // (réservé pour usages futurs ; engagedPids lit state.survival directement)

/** Définition d'une arme par id (réexport pratique pour le rendu/HUD). */
export { weaponById };
