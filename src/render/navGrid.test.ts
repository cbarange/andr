// ============================================================================
//  TEST — NavGrid (pathfinding A* des villageois). Pur, sans Babylon. Valide qu'avec la
//  navigation A*, les villageois ne restent PLUS bloqués sur le campement réel (le champ de
//  potentiel précédent restait coincé ~7% des trajets). Voir docs / src/render/navGrid.ts.
// ============================================================================

import { describe, it, expect } from "vitest";
import { NavGrid, type NavPt } from "./navGrid";
import { campLayout, trees as treeSlots } from "../../data/world";
import { createRng, nextFloat } from "../sim/rng";

const WALK_SPEED = 1.35, ARRIVE = 0.4, DT = 1 / 20, BUDGET = 40, WP_REACH = 0.7;
const RADIUS: Record<string, number> = {
  hut: 1.9, cart: 1.0, "trading post": 2.2, armoury: 1.9, tannery: 1.9,
  workshop: 1.9, smokehouse: 1.5, lodge: 2.3, steelworks: 2.4, trap: 0,
};

function obstacles(): Array<{ x: number; z: number; r: number }> {
  const o: Array<{ x: number; z: number; r: number }> = [];
  for (const id of Object.keys(campLayout.buildings)) {
    const r = RADIUS[id] ?? 1.8;
    if (r <= 0) continue;
    for (const a of campLayout.buildings[id]) o.push({ x: a.x, z: a.z, r });
  }
  o.push({ x: campLayout.cabin.x, z: campLayout.cabin.z, r: 3.2 });
  o.push({ x: 0, z: 0, r: 1.6 });
  return o;
}
function landmarks(): NavPt[] {
  const p: NavPt[] = [{ x: 0, z: 0 }, { x: campLayout.cabin.x, z: campLayout.cabin.z }];
  for (const id of Object.keys(campLayout.buildings)) for (const a of campLayout.buildings[id]) p.push({ x: a.x, z: a.z });
  for (const t of treeSlots) p.push({ x: t.x, z: t.z });
  return p;
}
function pushOut(p: NavPt, obs: ReturnType<typeof obstacles>, m: number): void {
  for (const o of obs) { const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), want = o.r + m; if (d < want && d > 1e-4) { p.x = o.x + (dx / d) * want; p.z = o.z + (dz / d) * want; } }
}

describe("NavGrid — pathfinding A* des villageois", () => {
  it("amène les villageois à destination sans blocage sur le campement réel", () => {
    const obs = obstacles();
    const nav = new NavGrid(obs);
    const lm = landmarks();
    const rng = createRng(424242);
    const N = 1500;
    let stuck = 0, valid = 0;

    const pick = (): NavPt => {
      const l = lm[Math.floor(nextFloat(rng) * lm.length)];
      const p = { x: l.x + (nextFloat(rng) - 0.5) * 3, z: l.z + (nextFloat(rng) - 0.5) * 3 };
      pushOut(p, obs, ARRIVE + 0.4);
      return p;
    };

    for (let k = 0; k < N; k++) {
      const start = pick(), goal = pick();
      if (Math.hypot(start.x - goal.x, start.z - goal.z) < 4) continue;
      valid++;
      const path = nav.findPath(start, goal);
      // suit les waypoints comme en jeu
      const p = { x: start.x, z: start.z }; let wp = 0; let arrived = false;
      for (let s = 0; s < BUDGET / DT; s++) {
        while (wp < path.length - 1 && Math.hypot(path[wp].x - p.x, path[wp].z - p.z) < WP_REACH) wp++;
        const w = path[Math.min(wp, path.length - 1)];
        const dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz) || 1e-4;
        const step = WALK_SPEED * DT;
        p.x += (dx / d) * step; p.z += (dz / d) * step;
        if (Math.hypot(p.x - goal.x, p.z - goal.z) <= ARRIVE) { arrived = true; break; }
      }
      if (!arrived) stuck++;
    }

    const rate = stuck / valid;
    // L'ancien champ de potentiel restait coincé ~6,9% ; A* doit descendre bien en dessous de 2%.
    expect(rate).toBeLessThan(0.02);
  });

  it("produit un DÉTOUR valide quand la ligne droite est bloquée par un bâtiment", () => {
    const obs = obstacles();
    const nav = new NavGrid(obs);
    const lm = landmarks();
    let found = false;
    // Cherche une paire de repères dont la ligne droite traverse une emprise (robuste au layout).
    for (let i = 0; i < lm.length && !found; i++) for (let j = i + 1; j < lm.length && !found; j++) {
      const a = { ...lm[i] }, b = { ...lm[j] };
      pushOut(a, obs, ARRIVE + 0.4); pushOut(b, obs, ARRIVE + 0.4);
      if (Math.hypot(a.x - b.x, a.z - b.z) < 6) continue;
      if (nav.segClear(a.x, a.z, b.x, b.z)) continue; // ligne droite déjà dégagée -> pas un cas de détour
      const path = nav.findPath(a, b);
      expect(path.length).toBeGreaterThan(1); // contourne, pas une ligne droite
      for (let k = 0; k + 1 < path.length; k++) expect(nav.segClear(path[k].x, path[k].z, path[k + 1].x, path[k + 1].z)).toBe(true); // chaque segment dégagé
      found = true;
    }
    expect(found).toBe(true); // il existe bien des trajets nécessitant un détour dans ce camp
  });
});
