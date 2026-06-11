import { describe, it, expect } from "vitest";
import { runCommand, type CommandCtx } from "./commands";
import { createInitialState, type GameState } from "../sim/state";
import type { PlayerAction } from "../sim/actions";
import { config, RESOURCE_LABELS, storageCap } from "../../data/world";

// ctx minimal : on capture les actions émises ; le reste est inerte (la commande /fill
// n'utilise que getState/self/emit). Les autres champs sont des stubs typés.
function makeCtx(state: GameState): { ctx: CommandCtx; emitted: PlayerAction[] } {
  const emitted: PlayerAction[] = [];
  const ctx: CommandCtx = {
    getState: () => state,
    self: () => "p1",
    emit: (a) => { emitted.push(a); },
    teleport: () => {},
    playerPos: () => ({ x: 0, z: 0 }),
    getWorldMap: () => { throw new Error("non utilisé"); },
    triggerEvent: () => {},
    fastForward: () => {},
    clearSave: () => {},
    saveNow: () => {},
    setFly: () => {},
    isFlying: () => false,
    setNoclip: () => {},
    isNoclip: () => false,
    reseed: () => {},
  };
  return { ctx, emitted };
}

describe("commande /fill (cheat : entrepôt au max)", () => {
  it("fixe CHAQUE ressource connue à son plafond pour le palier courant", () => {
    const tier = 5;
    const state = { ...createInitialState(config.rngSeed, 0), cabinTier: tier };
    const { ctx, emitted } = makeCtx(state);

    const msg = runCommand("/fill", ctx);

    const ids = Object.keys(RESOURCE_LABELS);
    // Une action DEBUG_SET storage par ressource, exactement.
    const sets = emitted.filter((a) => a.type === "DEBUG_SET");
    expect(sets).toHaveLength(ids.length);
    for (const id of ids) {
      const a = sets.find((s) => "resource" in s && s.resource === id);
      expect(a, `action manquante pour ${id}`).toBeDefined();
      expect(a).toMatchObject({ type: "DEBUG_SET", target: "storage", resource: id, amount: storageCap(tier, id) });
    }
    expect(msg).toContain(`palier ${tier}`);
  });

  it("respecte le palier de cabane (plafonds plus bas au palier 0)", () => {
    const s0 = { ...createInitialState(config.rngSeed, 0), cabinTier: 0 };
    const { ctx, emitted } = makeCtx(s0);
    runCommand("/fill", ctx);
    const wood = emitted.find((a) => a.type === "DEBUG_SET" && "resource" in a && a.resource === "wood");
    expect(wood).toMatchObject({ amount: storageCap(0, "wood") });
    // palier 0 plafonne sous le palier 5
    expect(storageCap(0, "wood")).toBeLessThan(storageCap(5, "wood"));
  });
});
