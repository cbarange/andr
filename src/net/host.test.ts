import { describe, it, expect } from "vitest";
import { resolveHostOnSync } from "./host";

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
