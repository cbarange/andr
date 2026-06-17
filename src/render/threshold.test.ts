// Machine d'état PURE de la cinématique de seuil (M11/RF5) — testable sans Babylon/DOM.
import { describe, it, expect } from "vitest";
import { ThresholdCine } from "./threshold";

describe("cinématique de seuil (RF5) — machine d'état pure", () => {
  it("ENTRÉE : opening -> walking -> dip -> settling -> idle ; commit UNE fois (au fondu max)", () => {
    const c = new ThresholdCine();
    c.start("in", "cave");
    expect(c.active).toBe(true);
    const phases: string[] = [];
    let commits = 0;
    let dipPeak = 0;
    for (let i = 0; i < 200 && c.active; i++) {
      const f = c.advance(0.05); // 50 ms/pas
      phases.push(f.phase);
      if (f.commit) commits++;
      dipPeak = Math.max(dipPeak, f.dip);
    }
    expect(c.active).toBe(false); // revenu à idle bien avant le timeout
    expect(commits).toBe(1); // chargement déclenché exactement une fois
    expect(dipPeak).toBeGreaterThan(0.8); // le fondu au noir atteint quasi 1
    expect(phases).toContain("opening");
    expect(phases).toContain("walking");
    expect(phases).toContain("dip");
    expect(phases).toContain("settling");
    // L'ordre est monotone : chaque phase apparaît APRÈS la précédente (1er index croissant).
    const order = ["opening", "walking", "dip", "settling"];
    const firstIdx = order.map((p) => phases.indexOf(p));
    for (let i = 1; i < firstIdx.length; i++) expect(firstIdx[i]).toBeGreaterThan(firstIdx[i - 1]);
  });

  it("marche : ENTRÉE va de 0 (dehors) à 1 (dedans) ; SORTIE l'inverse", () => {
    const ins = new ThresholdCine(); ins.start("in", "ship");
    const outs = new ThresholdCine(); outs.start("out", "ship");
    // À mi-marche, l'entrée est croissante, la sortie décroissante.
    let inWalk = 0, outWalk = 1;
    for (let i = 0; i < 18; i++) { inWalk = ins.advance(0.05).walk; outWalk = outs.advance(0.05).walk; }
    expect(inWalk).toBeGreaterThan(0.2);
    expect(outWalk).toBeLessThan(0.8);
  });

  it("TIMEOUT de sécurité : un pas géant force idle + commit (jamais coincé)", () => {
    const c = new ThresholdCine();
    c.start("in", "mine");
    const f = c.advance(5.0); // > TIMEOUT (3 s)
    expect(c.active).toBe(false);
    expect(f.commit).toBe(true); // le chargement est tout de même exécuté
  });

  it("skip : déclenche le commit s'il n'a pas encore eu lieu, puis idle", () => {
    const c = new ThresholdCine();
    c.start("in", "cave");
    c.advance(0.1); // en plein opening (pas encore commit)
    expect(c.skip()).toBe(true); // il reste à charger -> commit au skip
    expect(c.active).toBe(false);
    const c2 = new ThresholdCine();
    c2.start("in", "cave");
    for (let i = 0; i < 40 && c2.active; i++) c2.advance(0.05); // déroulé complet -> déjà committé
    expect(c2.skip()).toBe(false); // rien à refaire
  });
});
