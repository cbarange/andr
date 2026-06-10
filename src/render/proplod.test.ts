// ============================================================================
//  TESTS — paliers LOD des props (proplod.ts est PUR -> testable au terminal).
// ============================================================================

import { describe, it, expect } from "vitest";
import { propBandFor, keepProp, isChoppable } from "./proplod";

describe("proplod — palier near/far par distance", () => {
  it("near près du joueur, far au-delà (PROP_NEAR_R = 1)", () => {
    expect(propBandFor(0, "far")).toBe("near");
    expect(propBandFor(1, "far")).toBe("near");
    expect(propBandFor(2, "far")).toBe("far");
  });

  it("hystérésis : pas de va-et-vient à la frontière", () => {
    // Déjà near : reste near jusqu'à 1 + hystérésis(1) = 2.
    expect(propBandFor(2, "near")).toBe("near");
    expect(propBandFor(3, "near")).toBe("far");
    // Déjà far : ne redevient near qu'à ≤ 1.
    expect(propBandFor(2, "far")).toBe("far");
    expect(propBandFor(1, "far")).toBe("near");
  });
});

describe("proplod — sélection des props par palier", () => {
  it("near : tout est gardé", () => {
    for (const k of ["tree", "grass", "rock", "flower", "log", "reed"]) {
      expect(keepProp(k, "near", 0)).toBe(true);
      expect(keepProp(k, "near", 1)).toBe(true);
    }
  });

  it("far : petit décor masqué", () => {
    for (const k of ["grass", "fern", "mushroom", "flower", "drybush", "reed", "bones"]) {
      expect(keepProp(k, "far", 0)).toBe(false);
    }
  });

  it("far : gros décor conservé (silhouette)", () => {
    for (const k of ["rock", "log", "bush", "stump"]) {
      expect(keepProp(k, "far", 0)).toBe(true);
    }
  });

  it("far : arbres éclaircis ~50 % (un sur deux)", () => {
    expect(keepProp("tree", "far", 0)).toBe(true);
    expect(keepProp("tree", "far", 1)).toBe(false);
    expect(keepProp("tree", "far", 2)).toBe(true);
    expect(keepProp("tree", "far", 3)).toBe(false);
  });

  it("coupable uniquement de près", () => {
    expect(isChoppable("near")).toBe(true);
    expect(isChoppable("far")).toBe(false);
  });
});
