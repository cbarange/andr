// ============================================================================
//  TESTS — intensité des chemins dessinés (campGround.pathIntensity est PUR).
//  Profil NET : cœur plein jusqu'à `w`, fondu linéaire sur `PATH_EDGE`.
// ============================================================================

import { describe, it, expect } from "vitest";
import { pathIntensity, PATH_EDGE } from "./campGround";
import type { CampPath } from "../../data/world";

const seg: CampPath[] = [{ w: 1, pts: [[0, 0], [10, 0]] }]; // demi-largeur 1

describe("campGround — pathIntensity (profil net + bord doux)", () => {
  it("vaut 1 sur la ligne du chemin", () => {
    expect(pathIntensity(5, 0, seg)).toBe(1);
  });

  it("vaut 1 dans tout le cœur (jusqu'à la demi-largeur w)", () => {
    expect(pathIntensity(5, 0.9, seg)).toBe(1); // 0.9 < w=1
  });

  it("fond linéairement dans la zone de bord [w, w+EDGE]", () => {
    const mid = pathIntensity(5, 1 + PATH_EDGE / 2, seg); // au milieu du bord
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
  });

  it("vaut 0 au-delà de w + EDGE", () => {
    expect(pathIntensity(5, 1 + PATH_EDGE + 0.01, seg)).toBe(0);
  });

  it("se borne aux extrémités du segment (pas de prolongement infini)", () => {
    expect(pathIntensity(15, 0, seg)).toBe(0); // au-delà de l'extrémité (10,0)
  });

  it("aucun chemin -> 0", () => {
    expect(pathIntensity(0, 0, [])).toBe(0);
  });

  it("prend le MAX sur plusieurs chemins", () => {
    const two: CampPath[] = [{ w: 1, pts: [[0, 0], [10, 0]] }, { w: 1, pts: [[0, 8], [10, 8]] }];
    expect(pathIntensity(5, 8, two)).toBe(1); // sur le 2e chemin
  });
});
