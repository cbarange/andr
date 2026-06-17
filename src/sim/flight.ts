// ============================================================================
//  DÉCOLLAGE (M11/E3) — helpers PURS & DÉTERMINISTES du climax « extraction ».
//  Aucun RNG (vagues d'astéroïdes FIXES -> replay-équivalent trivial), aucune
//  dépendance Babylon/DOM. Le reducer (hôte) appelle `stepFlight` une fois par
//  tic ; les clients adoptent le snapshot. Co-op : plus de joueurs à bord = plus
//  de canons (`FLIGHT_FIRE`) pour abattre les débris avant l'impact.
// ============================================================================

import { config, FLIGHT } from "../../data/world";
import { GameState, SharedFlight } from "./state";

const HZ = config.simTickHz;
const SPAWN_TICKS = Math.max(1, Math.round(FLIGHT.spawnIntervalSeconds * HZ));
const IMPACT_TICKS = Math.max(1, Math.round(FLIGHT.impactLeadSeconds * HZ));

/** Joueurs DEHORS, vivants, hors grâce de respawn — candidats à l'embarquement. TRIÉS (déterministe). */
// Joueurs VIVANTS (hors grâce de respawn) — candidats à l'embarquement, QU'ILS SOIENT DEHORS OU AU CAMP
// (RF1b : le vaisseau est désormais au CAMP, donc le pilote est « dedans » au lancement). TRIÉS (déterm.).
function aliveCrewPids(state: GameState, tick: number): string[] {
  const out: string[] = [];
  for (const pid of Object.keys(state.survival)) {
    const sv = state.survival[pid];
    if (sv.health > 0 && tick >= sv.respawnReadyAt) out.push(pid);
  }
  return out.sort();
}

/** Astéroïde le PLUS URGENT (plus petit `impactAt`, tie-break par id) — la cible d'un tir. PUR. */
export function mostUrgentAsteroid(flight: SharedFlight): { id: number; impactAt: number } | null {
  let best: { id: number; impactAt: number } | null = null;
  for (const a of flight.asteroids) {
    if (!best || a.impactAt < best.impactAt || (a.impactAt === best.impactAt && a.id < best.id)) best = a;
  }
  return best;
}

/** Nombre de tics d'ascension (le moteur raccourcit le gantelet, borné). */
export function ascentTicks(engine: number): number {
  const factor = 1 - Math.min(0.9, engine * FLIGHT.engineSpeedup);
  return Math.max(1, Math.round(FLIGHT.ascentSeconds * HZ * factor));
}

/**
 * Avance le décollage d'UN tic (PUR). `boarding` : agrège l'équipage à portée puis lance l'ascension
 * (tout le monde à bord OU compte à rebours écoulé). `ascending` : monte, fait apparaître les débris,
 * applique les impacts NON abattus à la coque commune. Terminal `escaped`/`crashed` : inchangé.
 */
export function stepFlight(state: GameState, flight: SharedFlight, tick: number): SharedFlight {
  if (flight.status === "escaped" || flight.status === "crashed") return flight;

  if (flight.status === "boarding") {
    const aboard = { ...flight.aboard };
    let changed = false;
    const candidates = aliveCrewPids(state, tick);
    for (const pid of candidates) {
      const p = state.playerPos[pid];
      if (p && !aboard[pid] && Math.hypot(p.x - flight.x, p.z - flight.z) <= FLIGHT.boardRadius) {
        aboard[pid] = true; changed = true;
      }
    }
    const everyoneAboard = candidates.length > 0 && candidates.every((pid) => aboard[pid]);
    if (tick >= flight.countdownAt || everyoneAboard) {
      // Décollage : la coque part au maximum, l'ascension démarre, 1er astéroïde programmé.
      return { ...flight, aboard, status: "ascending", hull: flight.hullMax, progress: 0, nextSpawnAt: tick + SPAWN_TICKS };
    }
    return changed ? { ...flight, aboard } : flight;
  }

  // --- ascending ---
  let progress = flight.progress + 1 / ascentTicks(flight.engine);
  let asteroids = flight.asteroids;
  let nextSpawnAt = flight.nextSpawnAt;
  let nextAsteroidId = flight.nextAsteroidId;
  // Spawn (tant qu'on n'a pas atteint l'altitude d'évasion).
  if (tick >= nextSpawnAt && progress < 1) {
    asteroids = [...asteroids, { id: nextAsteroidId, impactAt: tick + IMPACT_TICKS }];
    nextAsteroidId += 1;
    nextSpawnAt = tick + SPAWN_TICKS;
  }
  // Impacts : les débris arrivés à échéance et NON abattus griffent la coque commune.
  let hull = flight.hull;
  if (asteroids.length > 0) {
    const survivors: typeof asteroids = [];
    for (const a of asteroids) {
      if (tick >= a.impactAt) hull -= FLIGHT.asteroidDamage;
      else survivors.push(a);
    }
    asteroids = survivors;
  }
  let status: SharedFlight["status"] = "ascending";
  if (hull <= 0) { hull = 0; status = "crashed"; }
  else if (progress >= 1) { progress = 1; status = "escaped"; }
  return { ...flight, progress, asteroids, nextSpawnAt, nextAsteroidId, hull, status };
}
