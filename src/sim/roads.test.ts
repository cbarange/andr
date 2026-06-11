// Tests du réseau de ROUTES (extension M9). `drawRoad` est PUR & géométrique (pas de RNG) : on
// vérifie le tracé vers le camp, le déterminisme, et surtout la FUSION (branchement au plus proche).
import { describe, it, expect } from "vitest";
import { drawRoad } from "./roads";
import { siteKey, type SiteProgress } from "./state";

const k = siteKey;
const cheb = (key: string): number => { const [a, b] = key.split(",").map(Number); return Math.max(Math.abs(a), Math.abs(b)); };

describe("drawRoad — réseau de routes (fusion façon A Dark Room)", () => {
  it("relie un site nettoyé au camp et ne route JAMAIS dans le camp", () => {
    const roads = drawRoad({}, { [k(10, 0)]: { cleared: true } }, 10, 0);
    const cells = Object.keys(roads);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells).toContain(k(9, 0)); // une cellule près du site
    expect(cells).toContain(k(4, 0)); // une cellule près du camp
    expect(cells.every((key) => cheb(key) > 3)).toBe(true); // jamais dans le camp (Chebyshev <= safeRadius)
  });

  it("est DÉTERMINISTE (même entrée -> même sortie)", () => {
    const sites: Record<string, SiteProgress> = { [k(8, 5)]: { cleared: true } };
    expect(drawRoad({}, sites, 8, 5)).toEqual(drawRoad({}, sites, 8, 5));
  });

  it("FUSIONNE : un 2e site se branche sur le réseau/avant-poste le plus proche, pas sur le village", () => {
    const sites: Record<string, SiteProgress> = { [k(10, 0)]: { cleared: true } };
    const roadsA = drawRoad({}, sites, 10, 0); // 1ʳᵉ route -> camp
    sites[k(10, 8)] = { cleared: true };
    const roadsB = drawRoad(roadsA, sites, 10, 8); // 2e site, proche du 1er
    const newCells = Object.keys(roadsB).filter((key) => !roadsA[key]);
    expect(newCells.length).toBeGreaterThan(0);
    // le branchement rejoint l'avant-poste (10,0) -> colonne x=10 (et PAS un nouveau tracé vers le camp)
    expect(newCells.every((key) => Number(key.split(",")[0]) === 10)).toBe(true);
  });

  it("idempotent à graine d'état égale (re-tracer ne casse pas le réseau)", () => {
    const sites: Record<string, SiteProgress> = { [k(12, -6)]: { cleared: true } };
    const r1 = drawRoad({}, sites, 12, -6);
    const r2 = drawRoad(r1, sites, 12, -6); // la 1ʳᵉ cellule connective trouvée est maintenant une route -> tracé court/identique
    expect(Object.keys(r2).length).toBeGreaterThanOrEqual(Object.keys(r1).length);
  });
});
