// ============================================================================
//  DÉCOLLAGE (M11/E3 → RF8) — helpers PURS & DÉTERMINISTES du climax « extraction ».
//  RF8 : PILOTAGE D'ESQUIVE — on déplace le vaisseau dans le plan transversal (X/Y) pour ÉVITER les
//  astéroïdes qui foncent vers lui ; on n'encaisse que ceux qu'on chevauche à l'impact (sinon esquivé).
//  Spawns SEEDÉS (`state.rng`) -> déterministe (replay & co-op). Aucune dépendance Babylon/DOM.
//  Le reducer (hôte) appelle `stepFlight` une fois par tic ; les clients adoptent le snapshot.
//  Pilotage CO-OP : les entrées `steer` des pilotes à bord sont SOMMÉES (consensus). Tir = SUPPORT.
// ============================================================================

import { config, FLIGHT } from "../../data/world";
import { GameState, SharedFlight } from "./state";
import { nextFloat, type RngState } from "./rng";

const HZ = config.simTickHz;
const TICK_SEC = 1 / HZ;
const IMPACT_TICKS = Math.max(1, Math.round(FLIGHT.impactLeadSeconds * HZ));
const IFRAME_TICKS = Math.max(0, Math.round(FLIGHT.iframeSeconds * HZ));

/** Joueurs VIVANTS (hors grâce de respawn) — candidats à l'embarquement, dehors OU au camp (RF1b). TRIÉS. */
function aliveCrewPids(state: GameState, tick: number): string[] {
  const out: string[] = [];
  for (const pid of Object.keys(state.survival)) {
    const sv = state.survival[pid];
    if (sv.health > 0 && tick >= sv.respawnReadyAt) out.push(pid);
  }
  return out.sort();
}

/** Astéroïde le PLUS URGENT (plus petit `impactAt`, tie-break par id) — la cible du TIR de support. PUR. */
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

/** Vitesse latérale d'esquive (u/s) — le moteur la rend plus vive (fidèle aux thrusters d'ADR). */
export function steerSpeed(engine: number): number {
  return FLIGHT.steerSpeed * (1 + engine * FLIGHT.engineSteerBonus);
}

/** Astéroïdes par spawn selon l'altitude (escalade façon ADR : 1 / 2 / 4 / 6). */
function densityFor(progress: number): number {
  return progress > 0.8 ? 6 : progress > 0.5 ? 4 : progress > 0.25 ? 2 : 1;
}

/** Intervalle de spawn (tics) : rétrécit avec l'altitude (mur d'astéroïdes au climax). */
function spawnIntervalTicks(progress: number): number {
  const sec = FLIGHT.spawnIntervalSeconds - (FLIGHT.spawnIntervalSeconds - FLIGHT.spawnIntervalMin) * Math.min(1, progress);
  return Math.max(1, Math.round(sec * HZ));
}

const clampTube = (v: number): number => (v < -FLIGHT.tubeRadius ? -FLIGHT.tubeRadius : v > FLIGHT.tubeRadius ? FLIGHT.tubeRadius : v);

/**
 * Avance le décollage d'UN tic (PUR). `boarding` : agrège l'équipage à portée puis lance l'ascension.
 * `ascending` : (1) intègre la position du vaisseau depuis l'agrégat `steer` (somme des pilotes, clampée
 * au tube) ; (2) fait apparaître des astéroïdes SEEDÉS (voie x/y), densité croissante avec l'altitude ;
 * (3) à l'impact, n'écorne la coque QUE si le vaisseau chevauche l'astéroïde (collision par position) +
 * i-frames. Le TIR de support (`FLIGHT_FIRE`) retire l'astéroïde le plus urgent (reducer). Terminal inchangé.
 * `rng` est consommé UNIQUEMENT par les spawns (le reducer le clone avant l'appel -> déterministe).
 */
export function stepFlight(state: GameState, flight: SharedFlight, tick: number, rng: RngState): SharedFlight {
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
      return { ...flight, aboard, status: "ascending", hull: flight.hullMax, progress: 0, shipX: 0, shipY: 0, lastHitAt: -1, nextSpawnAt: tick + spawnIntervalTicks(0) };
    }
    return changed ? { ...flight, aboard } : flight;
  }

  // --- ascending ---
  // (1) PILOTAGE : somme des vecteurs `steer` des pilotes À BORD (ordre stable), magnitude clampée à 1.
  let sx = 0, sy = 0;
  for (const pid of Object.keys(flight.aboard).sort()) {
    const s = flight.steer[pid];
    if (s) { sx += s.x; sy += s.y; }
  }
  const mag = Math.hypot(sx, sy);
  if (mag > 1) { sx /= mag; sy /= mag; }
  const spd = steerSpeed(flight.engine);
  const shipX = clampTube(flight.shipX + sx * spd * TICK_SEC);
  const shipY = clampTube(flight.shipY + sy * spd * TICK_SEC);

  let progress = flight.progress + 1 / ascentTicks(flight.engine);
  let asteroids = flight.asteroids;
  let nextSpawnAt = flight.nextSpawnAt;
  let nextAsteroidId = flight.nextAsteroidId;
  // (2) SPAWN seedé (voie x/y dans [−laneRadius, laneRadius]), densité par palier d'altitude.
  if (tick >= nextSpawnAt && progress < 1) {
    const count = densityFor(progress);
    const spawned = asteroids.slice();
    for (let k = 0; k < count; k++) {
      const ax = (nextFloat(rng) * 2 - 1) * FLIGHT.laneRadius;
      const ay = (nextFloat(rng) * 2 - 1) * FLIGHT.laneRadius;
      spawned.push({ id: nextAsteroidId, x: ax, y: ay, impactAt: tick + IMPACT_TICKS });
      nextAsteroidId += 1;
    }
    asteroids = spawned;
    nextSpawnAt = tick + spawnIntervalTicks(progress);
  }
  // (3) COLLISION par POSITION à l'impact (+ i-frames) : esquivé si le vaisseau ne chevauche pas la voie.
  let hull = flight.hull;
  let lastHitAt = flight.lastHitAt;
  if (asteroids.length > 0) {
    const survivors: typeof asteroids = [];
    for (const a of asteroids) {
      if (tick >= a.impactAt) {
        const hit = Math.hypot(a.x - shipX, a.y - shipY) <= FLIGHT.hitRadius;
        if (hit && tick > lastHitAt + IFRAME_TICKS) { hull -= FLIGHT.asteroidDamage; lastHitAt = tick; }
        // l'astéroïde a franchi le plan du vaisseau -> consommé (touché OU esquivé).
      } else {
        survivors.push(a);
      }
    }
    asteroids = survivors;
  }
  let status: SharedFlight["status"] = "ascending";
  if (hull <= 0) { hull = 0; status = "crashed"; }
  else if (progress >= 1) { progress = 1; status = "escaped"; }
  return { ...flight, shipX, shipY, progress, asteroids, nextSpawnAt, nextAsteroidId, hull, lastHitAt, status };
}
