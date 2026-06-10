// ============================================================================
//  TESTS — perf adaptative (autoperf.ts est PUR -> testable au terminal).
// ============================================================================

import { describe, it, expect } from "vitest";
import { nextScaling, PERF_TARGET, SCALE_MIN, SCALE_MAX, SCALE_STEP } from "./autoperf";

describe("autoperf — hardware scaling vers un FPS cible", () => {
  it("FPS bas -> dégrade (monte le scaling) d'un pas", () => {
    expect(nextScaling(PERF_TARGET - 20, 1.0)).toBeCloseTo(1.0 + SCALE_STEP, 5);
  });

  it("FPS haut -> améliore (baisse le scaling) d'un pas", () => {
    expect(nextScaling(PERF_TARGET + 20, 1.6)).toBeCloseTo(1.6 - SCALE_STEP, 5);
  });

  it("dans la bande morte -> inchangé (pas d'oscillation)", () => {
    expect(nextScaling(PERF_TARGET, 1.3)).toBe(1.3);
    expect(nextScaling(PERF_TARGET - 2, 1.3)).toBe(1.3); // -2 dans la tolérance basse
    expect(nextScaling(PERF_TARGET + 2, 1.3)).toBe(1.3); // +2 dans la tolérance haute
  });

  it("borne au plancher de qualité (SCALE_MAX) et à la pleine résolution (SCALE_MIN)", () => {
    expect(nextScaling(1, SCALE_MAX)).toBe(SCALE_MAX); // déjà au max -> ne dépasse pas
    expect(nextScaling(120, SCALE_MIN)).toBe(SCALE_MIN); // déjà au natif -> ne descend pas sous 1
    // près du plancher : ne dépasse pas SCALE_MAX
    expect(nextScaling(1, SCALE_MAX - 0.05)).toBe(SCALE_MAX);
  });

  it("converge vers la cible sans déborder (pas de drift flottant)", () => {
    let s = SCALE_MIN;
    for (let i = 0; i < 20; i++) s = nextScaling(10, s); // FPS catastrophique -> monte jusqu'au max
    expect(s).toBe(SCALE_MAX);
    for (let i = 0; i < 20; i++) s = nextScaling(120, s); // FPS excellent -> redescend au natif
    expect(s).toBe(SCALE_MIN);
  });
});
