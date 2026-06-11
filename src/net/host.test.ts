import { describe, it, expect } from "vitest";
import { resolveHostOnSync, resolveSync, shouldTakeOver } from "./host";

describe("resolveHostOnSync — élection d'hôte à la réception d'un état", () => {
  it("non-hôte-fixé : on s'aligne sur l'émetteur (defer)", () => {
    expect(resolveHostOnSync("b", false, "a", false)).toBe("defer");
    expect(resolveHostOnSync("a", false, "b", true)).toBe("defer");
  });

  it("hôte fixé + émetteur fixé d'id PLUS PETIT : on cède (yield, plus petit gagne)", () => {
    expect(resolveHostOnSync("b", true, "a", true)).toBe("yield");
  });

  it("hôte fixé + émetteur fixé d'id plus grand : on garde l'autorité (ignore)", () => {
    expect(resolveHostOnSync("a", true, "b", true)).toBe("ignore");
  });

  it("hôte fixé + émetteur NON fixé (invité) : on garde l'autorité, même si son id est plus petit (ignore)", () => {
    expect(resolveHostOnSync("b", true, "a", false)).toBe("ignore");
  });
});

describe("resolveSync — décision avec ÉPOQUE (terme d'autorité)", () => {
  it("époque émetteur PLUS HAUTE : elle gagne (defer si pas fixé, yield si fixé)", () => {
    expect(resolveSync("a", false, 0, "b", false, 1)).toBe("defer");
    expect(resolveSync("a", true, 0, "b", false, 1)).toBe("yield"); // on lâche notre autorité périmée
  });

  it("époque émetteur PLUS BASSE : on ignore (autorité périmée, ex. ancien hôte revenu)", () => {
    expect(resolveSync("a", false, 2, "b", true, 1)).toBe("ignore");
    expect(resolveSync("a", true, 2, "b", true, 1)).toBe("ignore");
  });

  it("époque ÉGALE : on retombe sur la règle historique (resolveHostOnSync)", () => {
    expect(resolveSync("b", false, 1, "a", false, 1)).toBe("defer");
    expect(resolveSync("b", true, 1, "a", true, 1)).toBe("yield"); // split-brain, plus petit id gagne
    expect(resolveSync("a", true, 1, "b", true, 1)).toBe("ignore");
  });
});

describe("shouldTakeOver — failover quand l'hôte se tait", () => {
  it("pas d'hôte établi (null) : jamais de failover (bootstrap par id)", () => {
    expect(shouldTakeOver("a", ["b"], null, 99_999, 6000)).toBe(false);
  });

  it("avant le timeout : on patiente", () => {
    expect(shouldTakeOver("a", ["b", "host"], "host", 3000, 6000)).toBe(false);
  });

  it("après timeout : le plus petit id VIVANT (hôte silencieux exclu) reprend", () => {
    // candidats = {a, b} (host exclu) -> 'a' est le plus petit -> 'a' reprend, 'b' attend.
    expect(shouldTakeOver("a", ["b", "host"], "host", 7000, 6000)).toBe(true);
    expect(shouldTakeOver("b", ["a", "host"], "host", 7000, 6000)).toBe(false);
  });

  it("client seul face à l'hôte silencieux : il reprend", () => {
    expect(shouldTakeOver("z", ["host"], "host", 7000, 6000)).toBe(true);
  });
});
