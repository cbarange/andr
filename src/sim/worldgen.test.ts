// ============================================================================
//  TESTS — GÉNÉRATION DU MONDE (M7). Tournent au terminal (`npm run test`), SANS
//  Babylon ni DOM. Vérifient : DÉTERMINISME (carte = fonction de la graine),
//  contiguïté des biomes (viscosité), anneaux des sites, stabilité du scatter.
// ============================================================================

import { describe, it, expect } from "vitest";
import { generateWorld, scatterCell } from "./worldgen";
import { worldgen, Biome, sites } from "../../data/world";

const SEED = worldgen.seed;
const R = worldgen.radiusCells;
const SR = worldgen.safeRadiusCells;

describe("generateWorld — déterminisme", () => {
  it("même graine ⇒ grille STRICTEMENT identique", () => {
    const a = generateWorld(SEED);
    const b = generateWorld(SEED);
    expect(a.biomes.length).toBe((2 * R + 1) ** 2);
    expect(Array.from(a.biomes)).toEqual(Array.from(b.biomes));
  });

  it("graines différentes ⇒ cartes différentes", () => {
    const a = generateWorld(SEED);
    const b = generateWorld(SEED + 1);
    let diffs = 0;
    for (let i = 0; i < a.biomes.length; i++) if (a.biomes[i] !== b.biomes[i]) diffs++;
    expect(diffs).toBeGreaterThan(0);
  });

  it("toutes les cellules sont décidées (aucune valeur ‘indécise’)", () => {
    const m = generateWorld(SEED);
    for (let i = 0; i < m.biomes.length; i++) {
      expect(m.biomes[i]).toBeLessThanOrEqual(Biome.Swamp); // 0..4 (camp..marais), jamais 255
    }
  });
});

describe("generateWorld — le camp central", () => {
  it("le centre et la zone sûre sont en biome ‘camp’", () => {
    const m = generateWorld(SEED);
    expect(m.biomeAt(0, 0)).toBe(Biome.Camp);
    for (let cz = -SR; cz <= SR; cz++) {
      for (let cx = -SR; cx <= SR; cx++) {
        expect(m.biomeAt(cx, cz)).toBe(Biome.Camp);
      }
    }
  });

  it("les cellules collées au camp (orthogonales) sont en forêt (règle ADR)", () => {
    const m = generateWorld(SEED);
    expect(m.biomeAt(SR + 1, 0)).toBe(Biome.Forest);
    expect(m.biomeAt(-(SR + 1), 0)).toBe(Biome.Forest);
    expect(m.biomeAt(0, SR + 1)).toBe(Biome.Forest);
    expect(m.biomeAt(0, -(SR + 1))).toBe(Biome.Forest);
  });

  it("juste au-delà de la zone sûre, ce n'est plus du camp", () => {
    const m = generateWorld(SEED);
    expect(m.biomeAt(SR + 1, 0)).not.toBe(Biome.Camp);
  });
});

describe("generateWorld — viscosité (biomes contigus, pas du bruit)", () => {
  it("les voisins partagent le biome bien plus souvent que le hasard (~0,40)", () => {
    const m = generateWorld(SEED);
    let sameNeighbors = 0;
    let totalNeighbors = 0;
    for (let cz = -R; cz <= R; cz++) {
      for (let cx = -R; cx <= R; cx++) {
        const b = m.biomeAt(cx, cz);
        if (b === Biome.Camp) continue;
        for (const [nx, nz] of [[cx - 1, cz], [cx + 1, cz], [cx, cz - 1], [cx, cz + 1]] as const) {
          if (nx < -R || nx > R || nz < -R || nz > R) continue;
          const nb = m.biomeAt(nx, nz);
          if (nb === Biome.Camp) continue;
          totalNeighbors++;
          if (nb === b) sameNeighbors++;
        }
      }
    }
    const sameFraction = sameNeighbors / totalNeighbors;
    // Hasard pur (poids .15/.35/.5) ≈ 0,40 ; la viscosité doit nettement dépasser ce seuil.
    expect(sameFraction).toBeGreaterThan(0.45);
  });
});

describe("generateWorld — sites par anneaux de distance", () => {
  it("chaque site tombe dans son anneau [min, max] (à la tolérance d'arrondi de cellule) et hors du camp", () => {
    const m = generateWorld(SEED);
    const defById = Object.fromEntries(sites.map((s) => [s.id, s]));
    for (const site of m.sites) {
      const def = defById[site.type];
      const dist = Math.hypot(site.cx, site.cz);
      // L'arrondi à la cellule la plus proche peut décaler la distance de ~1 cellule.
      expect(dist).toBeGreaterThanOrEqual(def.minRadiusCells - 1.5);
      expect(dist).toBeLessThanOrEqual(def.maxRadiusCells + 1.5);
      expect(Math.max(Math.abs(site.cx), Math.abs(site.cz))).toBeGreaterThan(SR);
    }
  });

  it("place le bon nombre de sites et de façon reproductible", () => {
    const a = generateWorld(SEED);
    const b = generateWorld(SEED);
    const expected = sites.reduce((n, s) => n + s.count, 0);
    expect(a.sites.length).toBe(expected);
    expect(a.sites).toEqual(b.sites);
  });
});

describe("generateWorld — helpers de coordonnées", () => {
  it("worldToCell / cellToWorldCenter sont cohérents", () => {
    const m = generateWorld(SEED);
    const c = m.cellToWorldCenter(5, -3);
    expect(c.x).toBe(5 * worldgen.cellSize);
    expect(c.z).toBe(-3 * worldgen.cellSize);
    const back = m.worldToCell(c.x, c.z);
    expect(back).toEqual({ cx: 5, cz: -3 });
  });
});

describe("scatterCell — décor déterministe par biome", () => {
  it("même (cx, cz, biome, seed) ⇒ props identiques", () => {
    const a = scatterCell(7, 7, Biome.Forest, SEED);
    const b = scatterCell(7, 7, Biome.Forest, SEED);
    expect(a).toEqual(b);
  });

  it("le camp ne disperse aucun décor", () => {
    expect(scatterCell(0, 0, Biome.Camp, SEED)).toEqual([]);
  });

  it("la forêt est bien plus dense en arbres que la lande", () => {
    let forestTrees = 0;
    let barrenTrees = 0;
    for (let cz = 0; cz < 10; cz++) {
      for (let cx = 0; cx < 10; cx++) {
        forestTrees += scatterCell(cx, cz, Biome.Forest, SEED).filter((p) => p.kind === "tree").length;
        barrenTrees += scatterCell(cx, cz, Biome.Barren, SEED).filter((p) => p.kind === "tree").length;
      }
    }
    expect(forestTrees).toBeGreaterThan(barrenTrees);
  });

  it("les arbres forment des PEUPLEMENTS : l'essence dominante varie selon la zone", () => {
    const dominantsByCell = new Set<string>();
    for (let cx = 0; cx < 60; cx++) {
      const trees = scatterCell(cx, 0, Biome.Forest, SEED).filter((p) => p.kind === "tree");
      if (trees.length === 0) continue;
      const counts: Record<string, number> = {};
      let top = "";
      for (const t of trees) {
        const s = t.species ?? "";
        counts[s] = (counts[s] ?? 0) + 1;
        if (counts[s] > (counts[top] ?? 0)) top = s;
      }
      dominantsByCell.add(top);
    }
    // plusieurs types de peuplements à travers la carte (pas une seule essence partout)
    expect(dominantsByCell.size).toBeGreaterThan(1);
  });

  it("les props tombent dans les limites de leur cellule + portent essence/échelle/rotation", () => {
    const cs = worldgen.cellSize;
    const props = scatterCell(4, -2, Biome.Forest, SEED);
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) {
      expect(Math.abs(p.x - 4 * cs)).toBeLessThanOrEqual(cs / 2 + 1e-9);
      expect(Math.abs(p.z - -2 * cs)).toBeLessThanOrEqual(cs / 2 + 1e-9);
      expect(p.scale).toBeGreaterThan(0);
      expect(p.rotY).toBeGreaterThanOrEqual(0);
      if (p.kind === "tree") expect(typeof p.species).toBe("string");
    }
  });
});
