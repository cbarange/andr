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

// === BIOMES EN RÉGIONS (bruit de valeur warpé) ============================================
// Remplace l'ancienne « viscosité » (remplissage par voisins) qui donnait un moucheté uniforme.
// Ici les biomes forment de GRANDES régions organiques (domain warping façon Inigo Quilez), et
// le marais est une VRAIE région (≠ un point lointain). Tout est fonction PURE de (cx, cz, seed)
// -> identique chez tous les pairs ; n'utilise PAS le RNG des sites. Voir docs/refonte-monde-campement.md §A.

/** Hash entier (ix, iz, seed) -> [0,1). Déterministe. */
function ihash(ix: number, iz: number, seed: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (ix | 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (iz | 0), 0xc2b2ae35) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** Bruit de valeur 2D (interpolation lisse des coins entiers) -> [0,1). */
function vnoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = x - x0, fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = ihash(x0, z0, seed) + (ihash(x0 + 1, z0, seed) - ihash(x0, z0, seed)) * sx;
  const b = ihash(x0, z0 + 1, seed) + (ihash(x0 + 1, z0 + 1, seed) - ihash(x0, z0 + 1, seed)) * sx;
  return a + (b - a) * sz;
}
/** fBm (3 octaves) -> [0,1). */
function fbm(x: number, z: number, seed: number): number {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < 3; o++) { v += amp * vnoise(x * f, z * f, (seed + o * 101) >>> 0); norm += amp; f *= 2; amp *= 0.5; }
  return v / norm;
}
const BF = 0.09; // fréquence des régions : ~1 région par ~11 cellules
/** Champ de biome DOMAIN-WARPÉ -> frontières organiques, pas de grille. */
function biomeField(cx: number, cz: number, seed: number): number {
  const wx = fbm(cx * BF + 5.2, cz * BF + 1.3, (seed ^ 0x111) >>> 0) - 0.5;
  const wz = fbm(cx * BF + 8.3, cz * BF + 2.8, (seed ^ 0x222) >>> 0) - 0.5;
  return fbm(cx * BF + wx * 2.5, cz * BF + wz * 2.5, seed);
}
/** Biome « de fond » (hors camp/collier/marais) : forêt / prairie / lande, en régions. */
function noiseBiome(cx: number, cz: number, seed: number): BiomeId {
  const v = biomeField(cx, cz, seed);
  return v < 0.4 ? Biome.Barren : v < 0.66 ? Biome.Field : Biome.Forest;
}
/** Ancre déterministe de la RÉGION de marais : distance moyenne, angle tiré de la graine. */
function swampAnchor(seed: number): { cx: number; cz: number } {
  const ang = ihash(7, 13, (seed ^ 0x5151) >>> 0) * Math.PI * 2;
  const rr = 14 + ihash(31, 17, (seed ^ 0x7373) >>> 0) * 8; // 14..22 cellules
  return { cx: Math.round(Math.cos(ang) * rr), cz: Math.round(Math.sin(ang) * rr) };
}
const SWAMP_R = 7.5; // rayon ~7,5 cellules -> ~180 u de diamètre (une VRAIE zone, pas une flaque)
/** La cellule est-elle dans la région de marais ? (bord rendu organique par un bruit local) */
function inSwamp(cx: number, cz: number, anchor: { cx: number; cz: number }, seed: number): boolean {
  const d = Math.hypot(cx - anchor.cx, cz - anchor.cz);
  const wobble = 1 + 0.5 * (vnoise(cx * 0.25, cz * 0.25, (seed ^ 0x9999) >>> 0) - 0.5);
  return d < SWAMP_R * wobble;
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

  // 1) Biomes en RÉGIONS (bruit warpé) — n'utilise PAS `rng` (réservé aux sites) :
  //    camp central forcé + collier de forêt autour (camp niché dans les bois) + marais-région.
  const swamp = swampAnchor(seed >>> 0);
  for (let cz = -R; cz <= R; cz++) {
    for (let cx = -R; cx <= R; cx++) {
      const cheb = Math.max(Math.abs(cx), Math.abs(cz));
      let b: BiomeId;
      if (cheb <= SR) b = Biome.Camp; // retranchement central (zone sûre)
      else if (cheb <= SR + 1) b = Biome.Forest; // collier de forêt (règle ADR : camp dans les bois)
      else if (inSwamp(cx, cz, swamp, seed >>> 0)) b = Biome.Swamp; // région de marais
      else b = noiseBiome(cx, cz, seed >>> 0); // forêt / prairie / lande en régions
      grid[index(cx, cz)] = b;
    }
  }

  // 2) Sites par anneaux de distance (euclidiens), placement déterministe sur une cellule libre.
  const placedSites: Site[] = [];
  const occupied = new Set<string>();
  for (const def of sites) {
    // Le SITE marais (eau/roseaux) se pose AU CŒUR de la région de marais -> visuel cohérent
    // (≠ un point isolé loin de tout). Hors camp et dans les bornes.
    if (def.id === "swamp") {
      const k = swamp.cx + "," + swamp.cz;
      if (inBounds(swamp.cx, swamp.cz) && !occupied.has(k) && Math.max(Math.abs(swamp.cx), Math.abs(swamp.cz)) > SR) {
        occupied.add(k);
        placedSites.push({ type: "swamp", cx: swamp.cx, cz: swamp.cz });
      }
      continue;
    }
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
