// Tests du PLACEMENT MATHÉMATIQUE des bâtiments (Chantier C — C). Pur & déterministe : on vérifie
// le déterminisme, les comptes, le dégagement du feu et l'absence de chevauchement grossier.
import { describe, it, expect } from "vitest";
import { generateCampLayout } from "../../data/world";

const SINGLE = ["cart", "trading post", "workshop", "tannery", "armoury", "steelworks", "smokehouse", "lodge"];

describe("generateCampLayout — placement mathématique des bâtiments", () => {
  it("est DÉTERMINISTE (pas d'aléatoire) — deux générations identiques", () => {
    expect(generateCampLayout()).toEqual(generateCampLayout());
  });

  it("produit les bons COMPTES par type", () => {
    const L = generateCampLayout();
    expect(L["trap"].length).toBe(10);
    expect(L["hut"].length).toBe(20);
    for (const id of SINGLE) expect(L[id].length).toBe(1);
  });

  it("DÉGAGE le foyer central : aucune ancre trop près du feu (0,0)", () => {
    const L = generateCampLayout();
    for (const arr of Object.values(L)) {
      for (const a of arr) expect(Math.hypot(a.x, a.z)).toBeGreaterThan(4);
    }
  });

  it("les bâtiments majeurs ne se CHEVAUCHENT pas (espacement raisonnable)", () => {
    const L = generateCampLayout();
    const pts = SINGLE.map((id) => L[id][0]);
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        expect(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z)).toBeGreaterThan(4);
      }
    }
  });

  it("tout tient dans le rayon du campement (< 30 u)", () => {
    const L = generateCampLayout();
    for (const arr of Object.values(L)) {
      for (const a of arr) expect(Math.hypot(a.x, a.z)).toBeLessThan(30);
    }
  });

  it("respecte les QUARTIERS : artisanat à l'ouest (x<0), industrie à l'est (x>0)", () => {
    const L = generateCampLayout();
    expect(L["workshop"][0].x).toBeLessThan(0);
    expect(L["tannery"][0].x).toBeLessThan(0);
    expect(L["armoury"][0].x).toBeGreaterThan(0);
    expect(L["steelworks"][0].x).toBeGreaterThan(0);
  });
});
