// ============================================================================
//  TESTS DE LA SIMULATION — tournent au terminal (`npm run test`), SANS Babylon
//  ni DOM (§3.1, §11). Pureté, déterminisme (§3.3) et règles de jeu.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  createInitialState, Fire, Temp, BUILDER_ABSENT, carriedTotal, carryCapacity, freeWorkers, GameState,
} from "./state";
import { reduce, reduceAll, advanceTicks } from "./reducer";
import {
  gatherWood, lightFire, stokeFire, build, harvestTrap, assignWorker, unassignWorker,
  deposit, repairCabin, upgradeCabin, resolveEventChoice, tick, GameAction,
  debugGrant, debugSet, debugClear, debugAddPop, debugBuild, debugUnlockAll, debugSetFire, debugSetSeed,
  isNetworkSafeAction,
} from "./actions";
import { createRng, cloneRng, nextFloat, nextInt } from "./rng";
import { config, eventById, storageCap, craftableById, craftableRevealed } from "../../data/world";

/** Force le déclenchement d'un événement par id (action de debug, hors réseau). */
function trigger(s: GameState, id: string): GameState {
  return reduce(s, { type: "DEBUG_TRIGGER_EVENT", id });
}

const HZ = config.simTickHz;
const MAX = config.fire.builder.maxLevel;

/** État de base où la cabane est réparée (entrepôt + construction débloqués). */
function repaired(extra: Partial<GameState> = {}): GameState {
  return { ...createInitialState(config.rngSeed, 0), builder: MAX, cabinRepaired: true, cabinTier: 1, ...extra };
}

describe("état initial", () => {
  it("démarre vide, feu mort, cabane en ruine", () => {
    const s = createInitialState(config.rngSeed, 0);
    expect(s.tick).toBe(0);
    expect(carriedTotal(s, "p1")).toBe(0);
    expect(s.fire).toBe(Fire.Dead);
    expect(s.cabinRepaired).toBe(false);
  });
});

describe("récolte -> SAC (plafonné)", () => {
  it("le bois coupé va dans le sac du joueur", () => {
    const s = reduce(createInitialState(config.rngSeed, 0), gatherWood("p1", 8));
    expect(s.carried["p1"].wood).toBe(8);
    expect(s.resources.wood ?? 0).toBe(0); // pas dans l'entrepôt
  });

  it("plafonne à la capacité du sac", () => {
    const s = reduce(createInitialState(config.rngSeed, 0), gatherWood("p1", 1000));
    expect(carriedTotal(s, "p1")).toBe(config.carryCapBase);
  });

  it("chaque joueur a son propre sac", () => {
    let s = reduce(createInitialState(config.rngSeed, 0), gatherWood("a", 8));
    s = reduce(s, gatherWood("b", 8));
    expect(s.carried["a"].wood).toBe(8);
    expect(s.carried["b"].wood).toBe(8);
  });

  it("la charrette augmente la capacité de transport", () => {
    expect(carryCapacity(createInitialState(config.rngSeed, 0))).toBe(config.carryCapBase);
    const withCart = { ...createInitialState(config.rngSeed, 0), buildings: { cart: 1 } };
    expect(carryCapacity(withCart)).toBe(config.carryCapBase + config.cartCapBonus);
  });
});

describe("le feu (allumer / nourrir depuis le sac)", () => {
  it("allume le feu uniquement s'il est mort", () => {
    const s0 = createInitialState(config.rngSeed, 0);
    const s1 = reduce(s0, lightFire("p1"));
    expect(s1.fire).toBe(config.fire.lightLevel);
    expect(reduce(s1, lightFire("p1"))).toBe(s1); // déjà allumé -> no-op
  });

  it("nourrir consomme le bois DU SAC, monte d'un cran, plafonne à Rugissant", () => {
    let s: GameState = { ...createInitialState(config.rngSeed, 0), carried: { p1: { wood: 10 } } };
    s = reduce(s, lightFire("p1")); // -> Burning (3)
    s = reduce(s, stokeFire("p1")); // -> Roaring (4), sac 10-5
    expect(s.fire).toBe(Fire.Roaring);
    expect(s.carried["p1"].wood).toBe(5);
    expect(reduce(s, stokeFire("p1")).carried["p1"].wood).toBe(5); // au max -> pas de gaspillage
  });

  it("refuse de nourrir sans bois dans le sac, ou si le feu est mort", () => {
    const lit = reduce(createInitialState(config.rngSeed, 0), lightFire("p1")); // sac vide
    expect(reduce(lit, stokeFire("p1"))).toBe(lit);
    const dead: GameState = { ...createInitialState(config.rngSeed, 0), carried: { p1: { wood: 99 } } };
    expect(reduce(dead, stokeFire("p1"))).toBe(dead); // feu mort
  });

  it("le feu refroidit cran par cran puis s'éteint", () => {
    const lit = reduce(createInitialState(config.rngSeed, 0), lightFire("p1"));
    const coolTicks = config.fire.coolSeconds * HZ;
    expect(advanceTicks(lit, coolTicks).fire).toBe(config.fire.lightLevel - 1);
    const dead = advanceTicks(lit, coolTicks * config.fire.lightLevel);
    expect(dead.fire).toBe(Fire.Dead);
    expect(advanceTicks(dead, coolTicks).fire).toBe(Fire.Dead); // y reste
  });

  it("la température converge vers le niveau du feu", () => {
    const lit = reduce(createInitialState(config.rngSeed, 0), lightFire("p1"));
    expect(lit.temperature).toBe(Temp.Freezing);
    expect(advanceTicks(lit, config.fire.tempAdjustSeconds * HZ * 5).temperature).toBe(config.fire.lightLevel);
  });
});

describe("l'étrangère", () => {
  it("n'apparaît pas tant que le feu est trop faible", () => {
    expect(advanceTicks(createInitialState(config.rngSeed, 0), 1000).builder).toBe(BUILDER_ABSENT);
  });

  it("apparaît quand le feu est suffisant puis progresse jusqu'au max", () => {
    const lit = reduce(createInitialState(config.rngSeed, 0), lightFire("p1"));
    expect(advanceTicks(lit, 1).builder).toBe(0);
    const need = config.fire.builder.advanceSeconds * HZ * (MAX + 1);
    expect(advanceTicks(lit, need).builder).toBe(MAX);
  });
});

describe("réparer la cabane (1re action de la constructrice)", () => {
  it("réussit si l'étrangère est prête et qu'on a le bois (du sac)", () => {
    const warmed: GameState = {
      ...createInitialState(config.rngSeed, 0), builder: MAX, carried: { p1: { wood: config.cabinRepairCost } },
    };
    const r = reduce(warmed, repairCabin("p1"));
    expect(r.cabinRepaired).toBe(true);
    expect(r.carried["p1"].wood).toBe(0);
  });

  it("refuse tant que l'étrangère n'est pas complètement réchauffée", () => {
    const cold: GameState = { ...createInitialState(config.rngSeed, 0), builder: 0, carried: { p1: { wood: 99 } } };
    expect(reduce(cold, repairCabin("p1"))).toBe(cold);
  });

  it("refuse sans assez de bois", () => {
    const poor: GameState = { ...createInitialState(config.rngSeed, 0), builder: MAX, carried: { p1: { wood: 1 } } };
    expect(reduce(poor, repairCabin("p1"))).toBe(poor);
  });
});

describe("dépôt à l'entrepôt", () => {
  it("vide le sac dans l'entrepôt (cabane réparée)", () => {
    const s = repaired({ carried: { p1: { wood: 10, fur: 3 } } });
    const d = reduce(s, deposit("p1"));
    expect(d.resources.wood).toBe(10);
    expect(d.resources.fur).toBe(3);
    expect(carriedTotal(d, "p1")).toBe(0);
  });

  it("refuse tant que la cabane n'est pas réparée", () => {
    const s: GameState = { ...createInitialState(config.rngSeed, 0), carried: { p1: { wood: 10 } } };
    expect(reduce(s, deposit("p1"))).toBe(s);
  });
});

describe("construction (depuis l'entrepôt, après réparation)", () => {
  it("refuse tant que la cabane n'est pas réparée", () => {
    const notRepaired: GameState = { ...createInitialState(config.rngSeed, 0), builder: MAX, resources: { wood: 999 } };
    expect(reduce(notRepaired, build("p1", "cart"))).toBe(notRepaired);
  });

  it("construit et déduit le coût de l'entrepôt", () => {
    const s = repaired({ resources: { wood: 50 } });
    const b = reduce(s, build("p1", "cart")); // 30
    expect(b.buildings["cart"]).toBe(1);
    expect(b.resources.wood).toBe(20);
  });

  it("applique des coûts croissants et respecte le maximum", () => {
    let s = repaired({ resources: { wood: 100 } });
    s = reduce(s, build("p1", "trap")); // 10
    s = reduce(s, build("p1", "trap")); // 10 + 1×10 = 20
    expect(s.buildings["trap"]).toBe(2);
    expect(s.resources.wood).toBe(70);
    const cart1 = reduce(s, build("p1", "cart"));
    expect(reduce(cart1, build("p1", "cart"))).toBe(cart1); // cart max 1
  });

  it("refuse une ressource non encore disponible (loge : fourrure)", () => {
    expect(reduce(repaired({ resources: { wood: 9999 } }), build("p1", "lodge")).buildings["lodge"] ?? 0).toBe(0);
  });
});

describe("révélation du menu de build (fidèle ADR : ½ bois + ingrédient vu)", () => {
  const post = craftableById["trading post"]; // coût { wood: 400, fur: 100 }
  it("révèle dès la MOITIÉ du bois ET ≥1 de chaque autre ingrédient", () => {
    expect(craftableRevealed(post, { wood: 200, fur: 1 }, 0)).toBe(true);
  });
  it("cache si bois < 50 % du coût", () => {
    expect(craftableRevealed(post, { wood: 199, fur: 1 }, 0)).toBe(false);
  });
  it("cache si un ingrédient n'a jamais été vu (0)", () => {
    expect(craftableRevealed(post, { wood: 400, fur: 0 }, 0)).toBe(false);
  });
  it("révèle si déjà bâti, quelles que soient les ressources", () => {
    expect(craftableRevealed(post, {}, 1)).toBe(true);
  });
  it("bâtiment bois seul (piège) : révélé à 50 % du bois", () => {
    expect(craftableRevealed(craftableById["trap"], { wood: 5 }, 0)).toBe(true);
    expect(craftableRevealed(craftableById["trap"], { wood: 4 }, 0)).toBe(false);
  });
  it("hutte (coût ADR 100) : révélée à 50 bois", () => {
    expect(craftableRevealed(craftableById["hut"], { wood: 50 }, 0)).toBe(true);
    expect(craftableRevealed(craftableById["hut"], { wood: 49 }, 0)).toBe(false);
  });
});

describe("garde réseau (isNetworkSafeAction)", () => {
  it("refuse les actions DEBUG_* venant du réseau", () => {
    expect(isNetworkSafeAction({ type: "DEBUG_UNLOCK_ALL" }, "a")).toBe(false);
    expect(isNetworkSafeAction({ type: "DEBUG_SET_SEED", seed: 1 }, "a")).toBe(false);
  });
  it("refuse d'agir au nom d'un autre joueur (usurpation d'identité)", () => {
    expect(isNetworkSafeAction(gatherWood("b", 8), "a")).toBe(false);
  });
  it("accepte une action de jeu légitime de l'émetteur", () => {
    expect(isNetworkSafeAction(gatherWood("a", 8), "a")).toBe(true);
    expect(isNetworkSafeAction(lightFire("a"), "a")).toBe(true);
  });
});

describe("snapshot P2P : l'état complet est sérialisable (invariant)", () => {
  it("survit à un aller-retour JSON sans perte (deadlines, rng, événements inclus)", () => {
    let s = reduce(createInitialState(config.rngSeed, 0), gatherWood("p1", 8));
    s = advanceTicks(s, 50); // avance le temps -> échéances + rng modifiés
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe("pièges -> SAC (un par un, par index)", () => {
  it("relève UN seul piège (1 prise), pas tous d'un coup", () => {
    const s: GameState = { ...createInitialState(config.rngSeed, 0), buildings: { trap: 3 } };
    expect(carriedTotal(reduce(s, harvestTrap("p1", 0)), "p1")).toBe(1);
  });

  it("chaque piège a son propre état : relever l'un n'empêche pas de relever l'autre", () => {
    let s: GameState = { ...createInitialState(config.rngSeed, 0), buildings: { trap: 2 } };
    s = reduce(s, harvestTrap("p1", 0)); // piège 0 relevé -> vide
    expect(reduce(s, harvestTrap("p1", 0))).toBe(s); // piège 0 vide -> no-op (rechargement)
    const after1 = reduce(s, harvestTrap("p1", 1)); // piège 1 encore plein -> ok
    expect(carriedTotal(after1, "p1")).toBe(2); // 1 (piège 0) + 1 (piège 1)
  });

  it("refuse un index de piège inexistant et respecte le sac plein", () => {
    const s: GameState = { ...createInitialState(config.rngSeed, 0), buildings: { trap: 1 } };
    expect(reduce(s, harvestTrap("p1", 5))).toBe(s); // index hors borne
    const full: GameState = {
      ...createInitialState(config.rngSeed, 0), buildings: { trap: 1 }, carried: { p1: { wood: config.carryCapBase } },
    };
    expect(reduce(full, harvestTrap("p1", 0))).toBe(full); // sac plein
  });

  it("est déterministe à graine + tic identiques", () => {
    const s: GameState = { ...createInitialState(config.rngSeed, 0), buildings: { trap: 2 } };
    expect(reduce(s, harvestTrap("p1", 0)).carried).toEqual(reduce(s, harvestTrap("p1", 0)).carried);
  });

  it("l'appât (de l'entrepôt) ajoute une prise et est consommé", () => {
    const base = { ...createInitialState(config.rngSeed, 0), buildings: { trap: 1 } } as GameState;
    const sansAppat = reduce(base, harvestTrap("p1", 0));
    const avecAppat = reduce({ ...base, resources: { bait: 5 } }, harvestTrap("p1", 0));
    expect(carriedTotal(avecAppat, "p1")).toBeGreaterThan(carriedTotal(sansAppat, "p1"));
    expect(avecAppat.resources.bait).toBeLessThan(5); // appât consommé
  });

  it("chaque relève tire SON rechargement aléatoire dans [45 s, 65 s]", () => {
    const HZ = config.simTickHz;
    let s: GameState = { ...createInitialState(config.rngSeed, 0), buildings: { trap: 4 } };
    const delays = new Set<number>();
    for (let i = 0; i < 4; i++) {
      s = reduce(s, harvestTrap("p1", i)); // tic 0 -> trapReadyAt[i] = délai en tics
      const cd = s.trapReadyAt[i];
      expect(cd).toBeGreaterThanOrEqual(config.trapsCooldownMinSeconds * HZ);
      expect(cd).toBeLessThanOrEqual(config.trapsCooldownMaxSeconds * HZ);
      delays.add(cd);
    }
    expect(delays.size).toBeGreaterThan(1); // les délais varient d'un piège à l'autre (aléatoire)
  });
});

describe("population & métiers (économie de tick)", () => {
  function village(o: { buildings?: Record<string, number>; population?: number; workers?: Record<string, number> }): GameState {
    return {
      ...createInitialState(config.rngSeed, 0),
      buildings: o.buildings ?? {},
      population: o.population ?? 0,
      workers: o.workers ?? {},
      // Ces tests ISOLENT l'économie de population : on neutralise l'ordonnanceur d'événements
      // (M5) qui, sinon, tuerait des villageois sur de longs `advanceTicks`.
      eventScheduledAt: Number.MAX_SAFE_INTEGER,
    };
  }

  it("le bûcheron est l'occupation PAR DÉFAUT (non assignable) ; on reconvertit vers un métier", () => {
    // Bûcheron non assignable : un villageois sans métier l'est déjà par défaut.
    const one = village({ population: 1 });
    expect(reduce(one, assignWorker("p", "gatherer"))).toBe(one); // refusé (occupation par défaut)
    expect(freeWorkers(one)).toBe(1); // ce villageois est bûcheron
    // Métier nécessitant un bâtiment absent -> refusé.
    expect(reduce(one, assignWorker("p", "hunter"))).toBe(one);
    // Avec le bâtiment : le bûcheron devient chasseur (puis il n'y a plus de libre).
    const lodge = village({ buildings: { lodge: 1 }, population: 1 });
    const hunter1 = reduce(lodge, assignWorker("p", "hunter"));
    expect(hunter1.workers.hunter).toBe(1);
    expect(freeWorkers(hunter1)).toBe(0); // plus de bûcheron disponible
    expect(reduce(hunter1, assignWorker("p", "hunter"))).toBe(hunter1); // aucun à reconvertir
    // Retirer le chasseur le renvoie bûcheron (libre).
    const back = reduce(hunter1, unassignWorker("p", "hunter"));
    expect(back.workers.hunter).toBe(0);
    expect(freeWorkers(back)).toBe(1);
  });

  it("les villageois arrivent jusqu'au plafond (huttes × places)", () => {
    const grown = advanceTicks(village({ buildings: { hut: 1 } }), 120 * HZ);
    expect(grown.population).toBe(config.population.hutRoom);
    expect(advanceTicks(grown, 120 * HZ).population).toBe(config.population.hutRoom);
  });

  it("PAR DÉFAUT, les villageois non assignés sont bûcherons et remplissent l'ENTREPÔT", () => {
    // Aucun métier assigné -> les 2 villageois ramassent du bois automatiquement (ADR).
    const s = village({ population: 2 });
    expect(advanceTicks(s, 1).resources.wood).toBe(2); // 1 × 2 bûcherons -> entrepôt
  });

  it("affecter un métier RETIRE des bûcherons (le bois baisse en conséquence)", () => {
    // 3 villageois : 1 chasseur -> 2 bûcherons restants -> 2 bois/cycle (au lieu de 3).
    const s = village({ buildings: { lodge: 1 }, population: 3, workers: { hunter: 1 } });
    expect(advanceTicks(s, 1).resources.wood).toBe(2);
  });

  it("un métier sans intrant CHÔME : pas de négatif, pas de mort (fidèle ADR)", () => {
    // population 1 toute affectée au charcutier -> 0 bûcheron, pour isoler le métier.
    const s = village({ buildings: { smokehouse: 1 }, population: 1, workers: { charcutier: 1 } });
    const after = advanceTicks(s, config.population.incomeSeconds * HZ + 5);
    expect(after.resources["cured meat"] ?? 0).toBe(0); // rien produit
    expect(after.resources.meat ?? 0).toBe(0); // jamais négatif
    expect(after.resources.wood ?? 0).toBe(0); // 0 bûcheron -> pas de bois
    expect(after.population).toBe(1); // personne ne meurt
  });

  it("chaîne fourrure->cuir : nette positive avec assez de chasseurs (chiffres ADR)", () => {
    const s = village({ buildings: { lodge: 1, tannery: 1, hut: 2 }, population: 6, workers: { hunter: 4, tanner: 1 } });
    const after = advanceTicks(s, config.population.incomeSeconds * HZ * 6);
    expect(after.resources.leather ?? 0).toBeGreaterThanOrEqual(1); // du cuir est produit
    expect(after.resources.fur ?? 0).toBeGreaterThanOrEqual(0); // la fourrure ne passe jamais < 0
    expect(after.population).toBeGreaterThanOrEqual(6); // aucune mort
  });
});

describe("RNG à graine (mulberry32) — §3.3", () => {
  it("séquence reproductible pour une même graine", () => {
    const seqOf = (r: ReturnType<typeof createRng>) => Array.from({ length: 5 }, () => nextFloat(r));
    expect(seqOf(createRng(42))).toEqual(seqOf(createRng(42)));
  });
  it("graines différentes -> séquences différentes", () => {
    expect(nextFloat(createRng(1))).not.toBe(nextFloat(createRng(2)));
  });
  it("bornes [0,1) et [0,n)", () => {
    const r = createRng(999);
    for (let i = 0; i < 500; i++) {
      const f = nextFloat(r);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = nextInt(r, 6);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(6);
    }
  });
  it("cloneRng isole l'état", () => {
    const r = createRng(7);
    nextFloat(cloneRng(r));
    expect(r.seed).toBe(7);
  });
});

describe("événements (M5)", () => {
  it("conditions d'éligibilité (isAvailable) : gating par population / stocks / bâtiments", () => {
    const empty = createInitialState(config.rngSeed, 0);
    expect(eventById["beast_attack"].isAvailable(empty)).toBe(false); // population 0
    expect(eventById["beast_attack"].isAvailable({ ...empty, population: 1 })).toBe(true);
    expect(eventById["ruined_trap"].isAvailable(empty)).toBe(false); // aucun piège
    expect(eventById["ruined_trap"].isAvailable({ ...empty, buildings: { trap: 1 } })).toBe(true);
    expect(eventById["beggar"].isAvailable(empty)).toBe(false); // pas de fourrure
    expect(eventById["beggar"].isAvailable({ ...empty, resources: { fur: 1 } })).toBe(true);
    expect(eventById["hut_fire"].isAvailable({ ...empty, buildings: { hut: 1 }, population: 4 })).toBe(false); // pop < 8
    expect(eventById["hut_fire"].isAvailable({ ...empty, buildings: { hut: 3 }, population: 8 })).toBe(true);
  });

  it("attaque de bêtes : tue des villageois (borné, jamais < 0) + butin, puis se résout", () => {
    const base: GameState = { ...createInitialState(config.rngSeed, 0), population: 3 };
    const s = trigger(base, "beast_attack");
    expect(s.activeEvent).toEqual({ id: "beast_attack", scene: "start" });
    expect(s.population).toBeLessThan(3);
    expect(s.population).toBeGreaterThanOrEqual(0);
    expect(s.resources.fur).toBe(30); // butin (stores appliqués)
    expect(s.resources.meat).toBe(30);
    // « rentrer » (next:'end') ferme l'événement.
    const done = reduce(s, resolveEventChoice("p1", "mourn"));
    expect(done.activeEvent).toBeNull();
  });

  it("ne tue jamais plus que la population (borne basse à 0)", () => {
    const one: GameState = { ...createInitialState(config.rngSeed, 0), population: 1 };
    expect(trigger(one, "beast_attack").population).toBe(0);
  });

  it("incendie : détruit une hutte ET tue des villageois", () => {
    const base: GameState = { ...createInitialState(config.rngSeed, 0), buildings: { hut: 2 }, population: 8 };
    const s = trigger(base, "hut_fire");
    expect(s.buildings.hut).toBe(1); // une hutte de moins
    expect(s.population).toBeLessThan(8); // des morts
  });

  it("pièges saccagés : détruit au moins un piège (plafonné au nombre construit)", () => {
    const base: GameState = { ...createInitialState(config.rngSeed, 0), buildings: { trap: 3 } };
    const s = trigger(base, "ruined_trap");
    expect(s.buildings.trap).toBeLessThan(3);
    expect(s.buildings.trap).toBeGreaterThanOrEqual(0);
  });

  it("mendiant : le coût (fourrure) est déduit de l'entrepôt et une récompense arrive", () => {
    const base: GameState = { ...createInitialState(config.rngSeed, 0), resources: { fur: 30 } };
    const s = trigger(base, "beggar");
    const after = reduce(s, resolveEventChoice("p1", "give10"));
    expect(after.resources.fur).toBe(20); // 30 - 10
    // Branche vers écailles/dents/étoffe : 5 de l'une d'elles.
    expect((after.resources.scales ?? 0) + (after.resources.teeth ?? 0) + (after.resources.cloth ?? 0)).toBe(5);
  });

  it("refuse un choix dont on ne peut pas payer le coût (no-op)", () => {
    const base: GameState = { ...createInitialState(config.rngSeed, 0), resources: { fur: 5 } };
    const s = trigger(base, "beggar");
    expect(reduce(s, resolveEventChoice("p1", "give10"))).toBe(s); // coût 10 > 5 -> no-op
  });

  it("bruits dedans : branchement déterministe + échange proportionnel (-10% bois)", () => {
    const base: GameState = { ...createInitialState(config.rngSeed, 0), resources: { wood: 100 } };
    const s = trigger(base, "noises_inside");
    const a = reduce(s, resolveEventChoice("p1", "investigate"));
    const b = reduce(s, resolveEventChoice("p1", "investigate"));
    expect(a.resources).toEqual(b.resources); // déterministe à graine identique
    expect(a.resources.wood).toBe(90); // -10 %
    expect((a.resources.scales ?? 0) + (a.resources.teeth ?? 0) + (a.resources.cloth ?? 0)).toBe(2); // 10/5
  });

  it("nomade : une boutique qui RESTE ouverte (choix sans `next`)", () => {
    const base: GameState = { ...createInitialState(config.rngSeed, 0), resources: { fur: 100 } };
    const s = trigger(base, "nomad");
    const buy1 = reduce(s, resolveEventChoice("p1", "buyScales")); // -20 fourrure, +1 écaille
    expect(buy1.resources.fur).toBe(80);
    expect(buy1.resources.scales).toBe(1);
    expect(buy1.activeEvent).toEqual({ id: "nomad", scene: "start" }); // reste sur la boutique
    const buy2 = reduce(buy1, resolveEventChoice("p1", "buyScales"));
    expect(buy2.resources.scales).toBe(2);
    expect(reduce(buy2, resolveEventChoice("p1", "goodbye")).activeEvent).toBeNull(); // « le saluer » ferme
  });

  it("effet différé : un stock en attente est appliqué à échéance (retour du marchand)", () => {
    const base: GameState = {
      ...createInitialState(config.rngSeed, 0),
      resources: { wood: 0 },
      pendingEffects: [{ at: 10, stores: { wood: 60 } }],
    };
    const before = advanceTicks(base, 5);
    expect(before.resources.wood ?? 0).toBe(0); // pas encore
    const after = advanceTicks(base, 12);
    expect(after.resources.wood).toBe(60); // appliqué
    expect(after.pendingEffects.length).toBe(0); // et retiré de la file
  });

  it("ordonnanceur : un événement finit par se déclencher, de façon reproductible", () => {
    // population>0 -> au moins `beast_attack` est éligible (et les bûcherons remplissant
    // l'entrepôt rendent aussi `noises_*` possibles). On ne pré-suppose pas LEQUEL se déclenche.
    const base: GameState = { ...createInitialState(777, 0), population: 3 };
    const window = config.events.maxSeconds * 2 * HZ; // borne large (1ʳᵉ planif + intervalle)
    const a = advanceTicks(base, window);
    const b = advanceTicks(base, window);
    expect(a.activeEvent).not.toBeNull(); // un événement s'est bien déclenché
    expect(a).toEqual(b); // intégralement reproductible (graine + séquence identiques)
  });
});

describe("déterminisme (replay / réseau par échange d'actions)", () => {
  it("même état + même séquence d'actions -> état identique (boucle complète)", () => {
    const base: GameState = { ...createInitialState(321, 0), builder: MAX, cabinRepaired: true, buildings: { hut: 1 } };
    const seq: GameAction[] = [
      gatherWood("a", 8), gatherWood("a", 8), gatherWood("a", 8), // sac
      deposit("a"), // entrepôt
      gatherWood("a", 8), lightFire("a"), stokeFire("a"),
      build("a", "trap"), harvestTrap("a", 0),
      assignWorker("a", "gatherer"),
      ...Array.from({ length: 600 }, () => tick()),
    ];
    expect(seq.reduce(reduce, base)).toEqual(seq.reduce(reduce, base));
  });
});

describe("DEBUG (console de dev) — actions pures & bornées", () => {
  it("DEBUG_GRANT ajoute à l'entrepôt et au sac, et borne à 0", () => {
    let s = reduce(createInitialState(1, 0), debugGrant("p1", "storage", "wood", 100));
    expect(s.resources.wood).toBe(100);
    s = reduce(s, debugGrant("p1", "self", "fur", 5));
    expect(s.carried["p1"].fur).toBe(5);
    s = reduce(s, debugGrant("p1", "storage", "wood", -1000)); // ne descend jamais sous 0
    expect(s.resources.wood).toBe(0);
  });

  it("DEBUG_SET fixe la valeur exacte, DEBUG_CLEAR vide", () => {
    let s = reduce(createInitialState(1, 0), debugSet("p1", "storage", "iron", 42));
    expect(s.resources.iron).toBe(42);
    s = reduce(s, debugClear("p1", "storage"));
    expect(Object.keys(s.resources).length).toBe(0);
  });

  it("DEBUG_BUILD construit gratuitement, borné au maximum", () => {
    let s = reduce(createInitialState(1, 0), debugBuild("trap", 3));
    expect(s.buildings.trap).toBe(3);
    s = reduce(s, debugBuild("cart", 5)); // cart max = 1
    expect(s.buildings.cart).toBe(1);
    expect(reduce(s, debugBuild("inconnu", 1))).toEqual(s); // id inconnu -> no-op
  });

  it("DEBUG_UNLOCK_ALL répare la cabane, prépare la constructrice, pose 1 de chaque bâtiment", () => {
    const s = reduce(createInitialState(1, 0), debugUnlockAll());
    expect(s.cabinRepaired).toBe(true);
    expect(s.builder).toBe(config.fire.builder.maxLevel);
    expect(s.buildings.trap).toBeGreaterThanOrEqual(1);
    expect(s.buildings.lodge).toBeGreaterThanOrEqual(1);
  });

  it("DEBUG_ADD_POP ajoute puis retire des villageois (et ramène les ouvriers)", () => {
    let s: GameState = { ...createInitialState(1, 0), population: 5, workers: { hunter: 4 } };
    s = reduce(s, debugAddPop(3));
    expect(s.population).toBe(8);
    s = reduce(s, debugAddPop(-6)); // population 2 -> les 4 chasseurs ne tiennent plus
    expect(s.population).toBe(2);
    expect((s.workers.hunter ?? 0)).toBeLessThanOrEqual(2);
  });

  it("DEBUG_SET_SEED change la graine du monde (régénération côté rendu)", () => {
    const s = reduce(createInitialState(1, 0), debugSetSeed(999));
    expect(s.worldSeed).toBe(999);
  });

  it("ne mute jamais l'état d'entrée (pureté) et fait avancer le RNG", () => {
    const before = createInitialState(7, 0);
    const snapshot = JSON.stringify(before);
    const after = reduce(before, debugSetFire(4));
    expect(JSON.stringify(before)).toBe(snapshot); // entrée intacte
    expect(after.fire).toBe(Fire.Roaring);
    expect(after).not.toBe(before);
  });
});

describe("entrepôt : plafonds par rareté + paliers + entretien du feu", () => {
  it("le dépôt est borné au plafond (standard 1000 / rare 200) au palier ×1", () => {
    const s = repaired({ carried: { p1: { wood: 5000, leather: 500 } } });
    const r = reduce(s, deposit("p1"));
    expect(r.resources["wood"]).toBe(1000); // standard ×1
    expect(r.resources["leather"]).toBe(200); // rare ×1
  });

  it("storageCap suit la rareté et le palier", () => {
    expect(storageCap(1, "wood")).toBe(1000);
    expect(storageCap(5, "wood")).toBe(5000);
    expect(storageCap(10, "wood")).toBe(10000);
    expect(storageCap(1, "iron")).toBe(200);
    expect(storageCap(5, "iron")).toBe(1000);
    expect(storageCap(10, "iron")).toBe(2000);
  });

  it("UPGRADE_CABIN débite l'entrepôt, relève le palier, et le plafond suit (×5)", () => {
    const s = repaired({ resources: { wood: 300, leather: 40 } });
    const r = reduce(s, upgradeCabin("p1"));
    expect(r.cabinTier).toBe(5);
    expect(r.resources["wood"]).toBe(0);
    expect(r.resources["leather"]).toBe(0);
    // au palier ×5, un dépôt va désormais jusqu'à 5000 (standard)
    const r2 = reduce({ ...r, carried: { p1: { wood: 9000 } } }, deposit("p1"));
    expect(r2.resources["wood"]).toBe(5000);
  });

  it("UPGRADE_CABIN refuse si l'entrepôt n'a pas le coût", () => {
    const s = repaired({ resources: { wood: 100 } });
    expect(reduce(s, upgradeCabin("p1")).cabinTier).toBe(1); // no-op
  });

  it("la chaîne ×1 -> ×5 -> ×10 s'arrête au maximum", () => {
    let s = repaired({ resources: { wood: 100000, leather: 100000, iron: 100000 } });
    s = reduce(s, upgradeCabin("p1")); expect(s.cabinTier).toBe(5);
    s = reduce(s, upgradeCabin("p1")); expect(s.cabinTier).toBe(10);
    s = reduce(s, upgradeCabin("p1")); expect(s.cabinTier).toBe(10); // déjà au max -> no-op
  });

  it("la production des métiers est bornée au plafond de l'entrepôt", () => {
    // bûcherons : avec assez de population, le bois plafonne à 1000 (×1), pas davantage.
    const s = repaired({ population: 40, resources: { wood: 999 }, fireCoolAt: Number.MAX_SAFE_INTEGER, fire: Fire.Burning });
    const r = advanceTicks(s, config.population.incomeSeconds * HZ + 2);
    expect(r.resources["wood"]).toBeLessThanOrEqual(1000);
  });

  it("la constructrice RANIME le feu (à ardent, parfois rugissant), depuis l'entrepôt", () => {
    const s = repaired({ fire: Fire.Flickering, fireCoolAt: Number.MAX_SAFE_INTEGER, builderTendReadyAt: 0, resources: { wood: 100 } });
    const r = advanceTicks(s, 1);
    expect(r.fire).toBeGreaterThanOrEqual(Fire.Burning); // poussé au moins à « ardent »
    expect(r.fire).toBeLessThanOrEqual(Fire.Roaring);
    // coût = nb de crans regagnés × tendWoodCost (invariant déterministe)
    expect(r.resources["wood"]).toBe(100 - (r.fire - Fire.Flickering) * config.fire.builder.tendWoodCost);
    expect(r.builderTendReadyAt).toBeGreaterThan(1); // cooldown armé
  });

  it("elle n'entretient PAS le feu en ruine, ni quand le feu est haut, ni sans bois", () => {
    const ruin = { ...createInitialState(config.rngSeed, 0), fire: Fire.Smoldering, fireCoolAt: Number.MAX_SAFE_INTEGER, resources: { wood: 100 } };
    expect(advanceTicks(ruin, 1).fire).toBe(Fire.Smoldering); // pas réparée -> pas d'entretien
    const high = repaired({ fire: Fire.Burning, fireCoolAt: Number.MAX_SAFE_INTEGER, resources: { wood: 100 } });
    expect(advanceTicks(high, 1).fire).toBe(Fire.Burning); // feu trop haut -> pas d'intervention
    const broke = repaired({ fire: Fire.Smoldering, fireCoolAt: Number.MAX_SAFE_INTEGER, resources: { wood: 2 } });
    expect(advanceTicks(broke, 1).fire).toBe(Fire.Smoldering); // pas assez de bois
  });

  it("respecte le cooldown : un seul entretien dans la fenêtre", () => {
    const s = repaired({ fire: Fire.Flickering, fireCoolAt: Number.MAX_SAFE_INTEGER, builderTendReadyAt: 0, resources: { wood: 100 } });
    const r = advanceTicks(s, 5); // plusieurs tics : un seul geste (cooldown long)
    // un seul boost -> bois retiré = (crans regagnés)×coût, et le feu reste à sa cible (pas re-tendu)
    expect(r.resources["wood"]).toBe(100 - (r.fire - Fire.Flickering) * config.fire.builder.tendWoodCost);
    expect(r.fire).toBeGreaterThanOrEqual(Fire.Burning);
  });

  it("déterministe : même graine + mêmes actions (dont upgrade) => même état", () => {
    const acts: GameAction[] = [debugUnlockAll(), debugSet("p1", "storage", "wood", 5000), debugSet("p1", "storage", "leather", 500), upgradeCabin("p1"), tick(), tick()];
    const a = reduceAll(createInitialState(config.rngSeed, 0), acts);
    const b = reduceAll(createInitialState(config.rngSeed, 0), acts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
