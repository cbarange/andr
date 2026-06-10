// ============================================================================
//  TESTS — EntityManager (rendu conditionnel / LOD par distance). entities.ts est
//  PUR (aucune dépendance Babylon) -> testable au terminal comme la sim.
// ============================================================================

import { describe, it, expect } from "vitest";
import { EntityManager, type Entity, type LodBand } from "./entities";

interface SpyEntity extends Entity {
  bands: LodBand[];
  ticks: number;
}

function makeEntity(): SpyEntity {
  const e: SpyEntity = {
    x: 0, z: 0, fullDist: 45, minimalDist: 85, band: "culled",
    bands: [], ticks: 0,
    onBand(b) { (this as SpyEntity).bands.push(b); },
    tick() { (this as SpyEntity).ticks += 1; },
    minimalTick: true,
  };
  return e;
}

describe("EntityManager — LOD par distance", () => {
  it("classe full / minimal / culled selon la distance", () => {
    const m = new EntityManager(10);
    const e = makeEntity();
    m.register(e);
    m.update(0, 0, 0.016); expect(e.band).toBe("full"); // d=0
    m.update(60, 0, 0.016); expect(e.band).toBe("minimal"); // 55 < 60 ≤ 95
    m.update(100, 0, 0.016); expect(e.band).toBe("culled"); // 100 > 95
    m.update(0, 0, 0.016); expect(e.band).toBe("full");
  });

  it("onBand n'est appelé qu'aux CHANGEMENTS de palier", () => {
    const m = new EntityManager(10);
    const e = makeEntity();
    m.register(e);
    m.update(0, 0, 0.016);
    m.update(5, 0, 0.016);
    m.update(10, 0, 0.016); // reste "full"
    expect(e.bands).toEqual(["full"]); // un seul changement (culled -> full)
  });

  it("hystérésis : pas de clignotement autour d'un seuil", () => {
    const m = new EntityManager(10);
    const e = makeEntity();
    m.register(e);
    m.update(0, 0, 0.016); // full
    m.update(50, 0, 0.016); // 50 ≤ 45+10 -> reste full
    expect(e.band).toBe("full");
    m.update(56, 0, 0.016); // 56 > 55 -> minimal
    expect(e.band).toBe("minimal");
    m.update(40, 0, 0.016); // 40 > 45-10 -> reste minimal
    expect(e.band).toBe("minimal");
    m.update(30, 0, 0.016); // 30 ≤ 35 -> full
    expect(e.band).toBe("full");
  });

  it("tick chaque frame en full ; nettement moins en minimal ; jamais en culled", () => {
    const m = new EntityManager(10);
    const e = makeEntity();
    m.register(e);
    for (let i = 0; i < 6; i++) m.update(0, 0, 0.016); // full
    expect(e.ticks).toBe(6);
    e.ticks = 0;
    for (let i = 0; i < 8; i++) m.update(60, 0, 0.016); // minimal -> ~1 frame sur 4
    expect(e.ticks).toBeGreaterThan(0);
    expect(e.ticks).toBeLessThan(8);
    e.ticks = 0;
    for (let i = 0; i < 8; i++) m.update(200, 0, 0.016); // culled -> jamais
    expect(e.ticks).toBe(0);
  });
});
