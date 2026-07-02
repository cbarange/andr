// ============================================================================
//  TESTS — bindings clavier (module PUR, cf. keybindings.ts + docs/rebind-clavier-plan.md).
//  Couvre : défauts (iso-comportement actuel), normalisation (réservées rejetées), résolution
//  touche->action, ajout avec retrait du doublon, retrait, merge d'une save partielle, libellés.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  DEFAULT_BINDINGS, ACTION_LABELS, normalizeKey, actionForKey, withBinding, clearBinding,
  mergeDefaults, keyLabel, actionKeyLabel, moveClusterLabel, type Bindings,
} from "./keybindings";

describe("bindings clavier (rebind — module pur)", () => {
  it("DÉFAUTS : identiques au mapping historique (ZQSD + WASD + flèches, E, F, Espace, Maj…)", () => {
    expect(DEFAULT_BINDINGS.forward).toEqual(["z", "w", "arrowup"]);
    expect(DEFAULT_BINDINGS.back).toEqual(["s", "arrowdown"]);
    expect(DEFAULT_BINDINGS.left).toEqual(["q", "a", "arrowleft"]);
    expect(DEFAULT_BINDINGS.right).toEqual(["d", "arrowright"]);
    expect(DEFAULT_BINDINGS.jump).toEqual([" "]);
    expect(DEFAULT_BINDINGS.descend).toEqual(["shift"]);
    expect(DEFAULT_BINDINGS.interact).toEqual(["e"]);
    expect(DEFAULT_BINDINGS.eat).toEqual(["f"]);
    expect(DEFAULT_BINDINGS.toggleView).toEqual(["v"]);
    expect(DEFAULT_BINDINGS.toggleMinimap).toEqual(["m"]);
    expect(DEFAULT_BINDINGS.spyglass).toEqual(["r"]);
    expect(DEFAULT_BINDINGS.toggleDebug).toEqual(["f3"]);
    // ACTION_LABELS couvre exactement les actions du modèle (l'UI itère dessus).
    expect(ACTION_LABELS.map((a) => a.action).sort()).toEqual(Object.keys(DEFAULT_BINDINGS).sort());
  });

  it("normalizeKey : minuscule, Espace normalisé, RÉSERVÉES rejetées (Échap/Entrée/F2/Tab)", () => {
    expect(normalizeKey({ key: "G" })).toBe("g");
    expect(normalizeKey({ key: "ArrowUp" })).toBe("arrowup");
    expect(normalizeKey({ key: " " })).toBe(" ");
    expect(normalizeKey({ key: "Spacebar" })).toBe(" ");
    expect(normalizeKey({ key: "Escape" })).toBeNull();
    expect(normalizeKey({ key: "Enter" })).toBeNull();
    expect(normalizeKey({ key: "F2" })).toBeNull();
    expect(normalizeKey({ key: "Tab" })).toBeNull();
  });

  it("actionForKey : résout la touche vers son action (ou null)", () => {
    expect(actionForKey(DEFAULT_BINDINGS, "e")).toBe("interact");
    expect(actionForKey(DEFAULT_BINDINGS, "arrowleft")).toBe("left");
    expect(actionForKey(DEFAULT_BINDINGS, "f3")).toBe("toggleDebug");
    expect(actionForKey(DEFAULT_BINDINGS, "x")).toBeNull();
  });

  it("withBinding : ajoute la touche ET la retire de toute autre action (une touche = une action)", () => {
    const b = withBinding(DEFAULT_BINDINGS, "interact", "g"); // E reste, G s'ajoute
    expect(b.interact).toEqual(["e", "g"]);
    const b2 = withBinding(b, "eat", "g"); // G migre vers manger
    expect(b2.eat).toContain("g");
    expect(b2.interact).toEqual(["e"]);
    // Pur : les entrées d'origine ne sont pas mutées.
    expect(DEFAULT_BINDINGS.interact).toEqual(["e"]);
  });

  it("clearBinding : retire une touche (une action peut rester vide)", () => {
    const b = clearBinding(DEFAULT_BINDINGS, "interact", "e");
    expect(b.interact).toEqual([]);
    expect(actionForKey(b, "e")).toBeNull();
  });

  it("mergeDefaults : back-fill d'une save PARTIELLE/corrompue + filtre les réservées", () => {
    expect(mergeDefaults(null)).toEqual(DEFAULT_BINDINGS);
    const merged = mergeDefaults({ interact: ["g"], forward: "oops", jump: ["escape", "x"] });
    expect(merged.interact).toEqual(["g"]); // valeur sauvée respectée
    expect(merged.forward).toEqual(DEFAULT_BINDINGS.forward); // corrompue -> défaut
    expect(merged.jump).toEqual(["x"]); // réservée filtrée
    expect(merged.back).toEqual(DEFAULT_BINDINGS.back); // absente -> défaut
  });

  it("libellés : keyLabel lisible, actionKeyLabel = 1ʳᵉ touche, moveClusterLabel compact", () => {
    expect(keyLabel(" ")).toBe("Espace");
    expect(keyLabel("shift")).toBe("Maj");
    expect(keyLabel("arrowup")).toBe("↑");
    expect(keyLabel("g")).toBe("G");
    expect(actionKeyLabel(DEFAULT_BINDINGS, "interact")).toBe("E");
    expect(actionKeyLabel(clearBinding(DEFAULT_BINDINGS, "interact", "e"), "interact")).toBe("—");
    expect(moveClusterLabel(DEFAULT_BINDINGS)).toBe("ZQSD");
    // Un cluster remappé en WASD pur s'affiche « WASD ».
    let b: Bindings = { ...DEFAULT_BINDINGS, forward: ["w"], left: ["a"], back: ["s"], right: ["d"] };
    expect(moveClusterLabel(b)).toBe("WASD");
    b = { ...b, forward: ["arrowup"], left: ["arrowleft"], back: ["arrowdown"], right: ["arrowright"] };
    expect(moveClusterLabel(b)).toBe("↑←↓→");
  });
});
