// ============================================================================
//  GÉNÉRATION DU MONDE (M7) — PURE & déterministe (§3.1, §3.3). Aucune dépendance
//  Babylon/DOM : testable au terminal (`npm run test`). Reprend l'algorithme
//  d'A Dark Room — GRILLE + VISCOSITÉ + SITES PAR ANNEAUX — piloté par un RNG À
//  GRAINE DÉDIÉ (distinct de `state.rng`). Conséquence : la carte est STABLE (elle
//  ne « bouge » pas quand le gameplay tire des nombres) et IDENTIQUE chez tous les
//  pairs — seule la graine voyage sur le réseau.
//  Voir docs/generation-monde.md & docs/plan-monde.md.
// ============================================================================

import { RngState, createRng, nextFloat } from "./rng";
import {
  worldgen, biomes, biomeById, treeSpecies, sites, Biome, type BiomeId, type TreeSpecies,
} from "../../data/world";

/** Un point d'intérêt placé sur la grille (coordonnées CELLULE). */
export interface Site {
  type: string;
  cx: number;
  cz: number;
}

/** Un élément de décor dispersé dans une cellule (coordonnées MONDE). Cosmétique. */
export interface ScatterProp {
  kind: string; // 'tree' | 'rock' | 'grass' | 'fern' | 'mushroom' | 'bush' | 'flower' | 'drybush' | 'bones' | 'log' | 'stump'
  species?: string; // pour les arbres (kind 'tree') : id d'essence (docs/modeles-3d.md §2.4)
  x: number;
  z: number;
  rotY: number;
  scale: number;
}

/** La carte logique, dérivée d'une graine. Petite (~16 Ko) ; le rendu la réalise par chunks. */
export interface WorldMap {
  seed: number;
  radiusCells: number;
  size: number; // côté de la grille = 2R+1
  biomes: Uint8Array; // indexée par index(cx,cz)
  sites: Site[];
  index(cx: number, cz: number): number;
  biomeAt(cx: number, cz: number): BiomeId;
  worldToCell(x: number, z: number): { cx: number; cz: number };
  cellToWorldCenter(cx: number, cz: number): { x: number; z: number };
}

const UNDECIDED = 255;
// index biome -> clé (pour relire les voisins) ; doit suivre l'ordre de `Biome`.
const KEY_BY_BIOME = ["camp", "forest", "field", "barren"] as const;
const BIOME_BY_KEY: Record<string, BiomeId> = {
  camp: Biome.Camp, forest: Biome.Forest, field: Biome.Field, barren: Biome.Barren,
};

/** Tirage pondéré déterministe sur une map clé->poids (>0). Ordre des clés = stable. */
function weightedPick(weights: Record<string, number>, rng: RngState): string {
  const keys = Object.keys(weights);
  let total = 0;
  for (const k of keys) total += weights[k];
  let r = nextFloat(rng) * total;
  for (const k of keys) {
    r -= weights[k];
    if (r < 0) return k;
  }
  return keys[keys.length - 1];
}

/**
 * Le cœur : choisit le biome d'une cellule selon ses voisines DÉJÀ décidées (la VISCOSITÉ).
 * Chaque voisine « tire » la cellule vers son biome ; le camp impose la forêt autour de lui.
 */
function chooseBiome(neighbors: number[], rng: RngState): BiomeId {
  const w: Record<string, number> = {
    forest: worldgen.baseBiomeWeights.forest,
    field: worldgen.baseBiomeWeights.field,
    barren: worldgen.baseBiomeWeights.barren,
  };
  for (const n of neighbors) {
    if (n === Biome.Camp) return Biome.Forest; // règle ADR : le camp est niché dans les bois
    const key = KEY_BY_BIOME[n];
    if (key in w) w[key] += worldgen.stickiness;
  }
  return BIOME_BY_KEY[weightedPick(w, rng)];
}

/** Cellules d'un anneau carré (distance de Chebyshev = r), dans un ordre FIXE (déterminisme). */
function ringCells(r: number): Array<[number, number]> {
  if (r === 0) return [[0, 0]];
  const out: Array<[number, number]> = [];
  for (let cx = -r; cx <= r; cx++) { out.push([cx, -r]); out.push([cx, r]); }
  for (let cz = -r + 1; cz <= r - 1; cz++) { out.push([-r, cz]); out.push([r, cz]); }
  return out;
}

/**
 * Génère la carte complète, déterministe. Même graine ⇒ carte identique partout.
 * Remplissage ANNEAU PAR ANNEAU du centre vers l'extérieur : quand on décide une cellule,
 * ses voisines intérieures sont déjà décidées (c'est ce qui fait fonctionner la viscosité).
 */
export function generateWorld(seed: number): WorldMap {
  const R = worldgen.radiusCells;
  const size = 2 * R + 1;
  const grid = new Uint8Array(size * size).fill(UNDECIDED);
  const SR = worldgen.safeRadiusCells;
  const rng = createRng(seed >>> 0);

  const index = (cx: number, cz: number) => (cz + R) * size + (cx + R);
  const inBounds = (cx: number, cz: number) => cx >= -R && cx <= R && cz >= -R && cz <= R;

  // 1) Biomes par viscosité (le camp central est forcé).
  for (let r = 0; r <= R; r++) {
    for (const [cx, cz] of ringCells(r)) {
      if (Math.max(Math.abs(cx), Math.abs(cz)) <= SR) {
        grid[index(cx, cz)] = Biome.Camp;
        continue;
      }
      const neigh: number[] = [];
      const consider = (x: number, z: number) => {
        if (!inBounds(x, z)) return;
        const v = grid[index(x, z)];
        if (v !== UNDECIDED) neigh.push(v);
      };
      consider(cx - 1, cz); consider(cx + 1, cz);
      consider(cx, cz - 1); consider(cx, cz + 1);
      grid[index(cx, cz)] = chooseBiome(neigh, rng);
    }
  }

  // 2) Sites par anneaux de distance (euclidiens), placement déterministe sur une cellule libre.
  const placedSites: Site[] = [];
  const occupied = new Set<string>();
  for (const def of sites) {
    for (let k = 0; k < def.count; k++) {
      for (let tries = 0; tries < 200; tries++) {
        const rr = def.minRadiusCells + nextFloat(rng) * (def.maxRadiusCells - def.minRadiusCells);
        const a = nextFloat(rng) * Math.PI * 2;
        const cx = Math.round(Math.cos(a) * rr);
        const cz = Math.round(Math.sin(a) * rr);
        if (!inBounds(cx, cz)) continue;
        if (Math.max(Math.abs(cx), Math.abs(cz)) <= SR) continue; // jamais dans le camp
        const key = cx + "," + cz;
        if (occupied.has(key)) continue;
        occupied.add(key);
        placedSites.push({ type: def.id, cx, cz });
        break;
      }
    }
  }

  return {
    seed: seed >>> 0,
    radiusCells: R,
    size,
    biomes: grid,
    sites: placedSites,
    index,
    biomeAt: (cx, cz) => (inBounds(cx, cz) ? (grid[index(cx, cz)] as BiomeId) : Biome.Barren),
    worldToCell: (x, z) => ({
      cx: Math.round(x / worldgen.cellSize),
      cz: Math.round(z / worldgen.cellSize),
    }),
    cellToWorldCenter: (cx, cz) => ({ x: cx * worldgen.cellSize, z: cz * worldgen.cellSize }),
  };
}

/** Graine locale d'une cellule (hash de cx, cz, worldSeed) -> scatter stable et déterministe. */
function cellSeed(cx: number, cz: number, seed: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ ((cx + 0x7f4a7c15) >>> 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ ((cz + 0x165667b1) >>> 0), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Tirage pondéré d'une essence d'arbre disponible dans ce biome (le MÉLANGE). */
function pickTreeSpecies(biomeKey: string, rng: RngState): TreeSpecies | null {
  const candidates = treeSpecies.filter((s) => (s.biomes as readonly string[]).includes(biomeKey));
  if (candidates.length === 0) return null;
  let total = 0;
  for (const c of candidates) total += c.weight;
  let r = nextFloat(rng) * total;
  for (const c of candidates) {
    r -= c.weight;
    if (r < 0) return c;
  }
  return candidates[candidates.length - 1];
}

/**
 * Profil d'un PEUPLEMENT (bloc de `standCells` cellules) : une essence DOMINANTE (tirée
 * uniformément parmi celles qui peuvent dominer) + une PURETÉ. Déterministe (hash du bloc).
 * -> des ensembles tantôt quasi mono-essence (sapinière, boulaie…), tantôt mélangés, et qui
 * changent d'un bloc à l'autre. Les rangées sont décalées en quinconce (pas de grille carrée).
 */
export function standProfile(cx: number, cz: number, biomeKey: string, seed: number): { dominant: TreeSpecies | null; purity: number } {
  const n = worldgen.standCells;
  const row = Math.floor(cz / n);
  const col = Math.floor((cx + (((row % 2) + 2) % 2 ? n / 2 : 0)) / n); // quinconce
  const srng = createRng(cellSeed(col + 4096, row + 8192, (seed ^ 0x5bd1e995) >>> 0));
  const all = treeSpecies.filter((s) => (s.biomes as readonly string[]).includes(biomeKey));
  const dominants = all.filter((s) => s.canDominate !== false);
  const pool = dominants.length ? dominants : all;
  const dominant = pool.length ? pool[Math.floor(nextFloat(srng) * pool.length)] : null;
  const purity = 0.4 + nextFloat(srng) * 0.55; // 0.4 (mélangé) .. ~0.95 (quasi pur)
  return { dominant: dominant ?? null, purity };
}

/**
 * Décor dispersé d'UNE cellule — LAZY (appelé par chunk au rendu) et DÉTERMINISTE (même
 * (cx, cz, seed) ⇒ mêmes props chez tous les pairs et à chaque rechargement). Purement
 * cosmétique : n'entre PAS dans l'état de jeu. Le `camp` (centre) ne disperse rien.
 */
export function scatterCell(cx: number, cz: number, biome: BiomeId, seed: number): ScatterProp[] {
  const def = biomeById[biome];
  if (!def || biome === Biome.Camp) return [];
  const rng = createRng(cellSeed(cx, cz, seed));
  const cs = worldgen.cellSize;
  const baseX = cx * cs;
  const baseZ = cz * cs;
  const out: ScatterProp[] = [];
  // Essence dominante + pureté du peuplement de cette cellule (RNG dédié -> n'affecte pas
  // les positions/densités). Les arbres seront majoritairement de l'essence dominante.
  const stand = standProfile(cx, cz, def.key, seed);

  for (const kind of Object.keys(def.scatter)) {
    const density = def.scatter[kind];
    const whole = Math.floor(density);
    const count = whole + (nextFloat(rng) < density - whole ? 1 : 0); // densité fractionnaire
    for (let i = 0; i < count; i++) {
      const x = baseX + (nextFloat(rng) - 0.5) * cs;
      const z = baseZ + (nextFloat(rng) - 0.5) * cs;
      const rotY = nextFloat(rng) * Math.PI * 2;
      if (kind === "tree") {
        // PURETÉ : majorité de l'essence dominante du peuplement ; sinon mélange pondéré.
        const roll = nextFloat(rng);
        const sp = stand.dominant && roll < stand.purity ? stand.dominant : pickTreeSpecies(def.key, rng);
        if (!sp) continue;
        const scale = sp.minScale + nextFloat(rng) * (sp.maxScale - sp.minScale);
        // IMPORTANT : on transmet le `type` (clé de render/trees.ts), pas l'`id` data.
        out.push({ kind, species: sp.type, x, z, rotY, scale });
      } else {
        const scale = 0.8 + nextFloat(rng) * 0.5;
        out.push({ kind, x, z, rotY, scale });
      }
    }
  }
  return out;
}
