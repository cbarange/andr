// ============================================================================
//  TEST — NavGrid (pathfinding A* des villageois). Pur, sans Babylon. Valide qu'avec la
//  navigation A*, les villageois ne restent PLUS bloqués sur le campement réel (le champ de
//  potentiel précédent restait coincé ~7% des trajets). Voir docs / src/render/navGrid.ts.
// ============================================================================

import { describe, it, expect } from "vitest";
import { NavGrid, type NavPt } from "./navGrid";
import { pathIntensity } from "./campGround";
import { campLayout, trees as treeSlots, type CampPath } from "../../data/world";
import { createRng, nextFloat } from "../sim/rng";

const PATH_PREFER = 0.35; // même valeur que render/villagers.ts

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
    // Scénario CONTRÔLÉ (indépendant du layout) : une emprise centrale entre deux points alignés.
    const nav = new NavGrid([{ x: 0, z: 0, r: 2.5 }]);
    const a = { x: -8, z: 0 }, b = { x: 8, z: 0 };
    expect(nav.segClear(a.x, a.z, b.x, b.z)).toBe(false); // la ligne droite traverse l'emprise
    const path = nav.findPath(a, b);
    expect(path.length).toBeGreaterThan(1); // A* contourne (pas une ligne droite)
    for (let k = 0; k + 1 < path.length; k++) {
      expect(nav.segClear(path[k].x, path[k].z, path[k + 1].x, path[k + 1].z)).toBe(true); // chaque segment dégagé
    }
  });

  // --- Biais « préférer les sentiers » + caractère DYNAMIQUE (data-driven) ---------------
  // Un bâtiment au centre force un détour ; un sentier dessiné d'un côté doit aiguiller le
  // contournement de CE côté. Changer le tracé du sentier doit changer l'itinéraire -> preuve
  // que le biais est piloté par la donnée (campLayout.paths) et qu'une grille reconstruite s'adapte.
  const withPath = (pts: [number, number][]): NavGrid => {
    const path: CampPath[] = [{ pts, w: 0.6 }];
    return new NavGrid([{ x: 0, z: 0, r: 2.5 }], (x, z) => 1 - PATH_PREFER * pathIntensity(x, z, path));
  };
  const minZ = (wp: NavPt[]): number => Math.min(...wp.map((w) => w.z));
  const maxZ = (wp: NavPt[]): number => Math.max(...wp.map((w) => w.z));

  it("biais : le détour suit le sentier dessiné (côté sud vs nord)", () => {
    const south = withPath([[-10, 0], [0, -5], [10, 0]]).findPath({ x: -10, z: 0 }, { x: 10, z: 0 });
    const north = withPath([[-10, 0], [0, 5], [10, 0]]).findPath({ x: -10, z: 0 }, { x: 10, z: 0 });
    expect(minZ(south)).toBeLessThan(-2); // sentier au sud -> contourne par le sud
    expect(maxZ(north)).toBeGreaterThan(2); // sentier au nord -> contourne par le nord
  });

  it("dynamique : déplacer le sentier change l'itinéraire (rien n'est figé)", () => {
    const a = withPath([[-10, 0], [0, -5], [10, 0]]).findPath({ x: -10, z: 0 }, { x: 10, z: 0 });
    const b = withPath([[-10, 0], [0, 5], [10, 0]]).findPath({ x: -10, z: 0 }, { x: 10, z: 0 });
    expect(minZ(a)).toBeLessThan(0); // itinéraire A passe au sud
    expect(maxZ(b)).toBeGreaterThan(0); // itinéraire B passe au nord
    expect(Math.abs(minZ(a) - minZ(b))).toBeGreaterThan(2); // les deux itinéraires DIFFÈRENT
  });
});
