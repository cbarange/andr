import { describe, it, expect } from "vitest";
import { migrateSave } from "./save";
import { createInitialState } from "./sim/state";

// Politique de migration (cf. docs/roadmap-v2.md A4) : on ne JETTE plus une save d'ancienne version ;
// on la migre. Les ajouts ADDITIFS sont back-fillés au boot (main.ts), pas ici. `migrateSave` est PURE.
describe("migrateSave — politique de version de sauvegarde", () => {
  const state = createInitialState(123, 0);

  it("version courante (2) : renvoie l'état tel quel", () => {
    expect(migrateSave(state, 2)).toBe(state);
  });

  it("version ANCIENNE (1) : accepte la save (back-fill au boot, pas de perte)", () => {
    expect(migrateSave(state, 1)).toBe(state);
  });

  it("version PLUS RÉCENTE que le code (3) : refuse (on n'écrase pas à l'aveugle)", () => {
    expect(migrateSave(state, 3)).toBeNull();
  });

  // M6/M7 : `survival` est ADDITIF -> une save d'avant la survie (sans le champ) doit être
  // back-fillée à `{}` par le spread du boot (`{...createInitialState(), ...saved}`), sans crash
  // ni bump de VERSION. On reproduit ce merge ici.
  it("back-fill M7 : une save pré-survie reçoit survival:{}", () => {
    const { survival, ...preM7 } = createInitialState(123, 0); // ancienne save : pas de `survival`
    void survival;
    const booted = { ...createInitialState(123, 0), ...preM7 };
    expect(booted.survival).toEqual({});
  });
});
