// ============================================================================
//  DONJONS SOUTERRAINS (M9) — génération PURE & déterministe (§3.1, §3.3).
//  La disposition d'une mine/grotte et son butin sont des FONCTIONS de la graine
//  du monde (`worldSeed`) + des coordonnées de cellule (cx, cz) + du type de site.
//  -> identiques chez tous les pairs, rien à stocker (comme worldgen.ts/scatter).
//  AUCUNE dépendance Babylon/DOM ni `state.rng` : testable au terminal.
//  Voir docs/mines-grottes-implementation.md (étape S1) & mines-grottes-souterrains.md.
// ============================================================================

import { createRng, nextFloat, nextInt, type RngState } from "./rng";

/** Nature d'un nœud du graphe de donjon (matérialise les « recoins » d'ADR). */
export type NodeKind = "entry" | "junction" | "chamber" | "deadend" | "deep";

/** Un nœud : une chambre/carrefour/cul-de-sac. `loot` vide = pas de butin ici. */
export interface DungeonNode {
  id: string;
  kind: NodeKind;
  depth: number; // 0 = bouche ; profondeur croissante vers le cœur du lieu
  pos: { x: number; z: number }; // position LOCALE (relative à la bouche), en unités monde
  loot: Record<string, number>; // contenu du cache (ressource -> quantité), {} si aucun
}

/** Un tunnel reliant deux nœuds (le « continuer » d'ADR = avancer le long d'un segment). */
export interface DungeonSegment {
  from: string;
  to: string;
}

/** Le donjon complet d'un site (graphe de nœuds + tunnels). */
export interface Dungeon {
  type: string;
  nodes: DungeonNode[];
  segments: DungeonSegment[];
}

/** Minerai produit par chaque type de mine (le `deep` = le filon). */
const MINE_ORE: Record<string, string> = {
  ironmine: "iron",
  coalmine: "coal",
  sulphurmine: "sulphur",
};

/** Hash FNV-1a d'une chaîne (mélange le type de site dans la graine du donjon). */
function hashStr(s: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Graine déterministe d'un donjon = hash(type, cx, cz, worldSeed). Même entrée ⇒ même graine. */
function dungeonSeed(type: string, cx: number, cz: number, worldSeed: number): number {
  let h = ((worldSeed >>> 0) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ ((cx + 0x7f4a7c15) >>> 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ ((cz + 0x165667b1) >>> 0), 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ hashStr(type), 0x27d4eb2f) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Génère le donjon d'un site, PUR & déterministe.
 *  - mines (`ironmine`/`coalmine`/`sulphurmine`) : COURT — bouche → carrefour → `deep` (le filon).
 *  - grottes (`cave`) : RAMIFIÉ — bouche → carrefour → 2-3 branches (chambres à butin / culs-de-sac).
 * Positions LOCALES (la bouche est l'origine ; le rendu translatera au centre-monde du site).
 */
export function dungeonFor(type: string, cx: number, cz: number, worldSeed: number): Dungeon {
  const rng = createRng(dungeonSeed(type, cx, cz, worldSeed));
  const nodes: DungeonNode[] = [];
  const segments: DungeonSegment[] = [];

  const entry: DungeonNode = { id: "entry", kind: "entry", depth: 0, pos: { x: 0, z: 0 }, loot: {} };
  nodes.push(entry);

  if (type === "borehole") {
    // --- ADR EXACT (setpieces.js) : UN forage = alliage 1–3 GARANTI (la seule source sûre
    //     d'alliage avant la fin de partie). Un seul point de fouille. ---
    const ang = nextFloat(rng) * Math.PI * 2;
    const r = 4 + nextFloat(rng) * 4;
    nodes.push({ id: "s0", kind: "chamber", depth: 0, pos: { x: Math.cos(ang) * r, z: Math.sin(ang) * r },
      loot: { "alien alloy": 1 + nextInt(rng, 3) } }); // 1..3 (min..max-1 de 1–3+1, fidèle)
    segments.push({ from: "entry", to: "s0" });
    return { type, nodes, segments };
  }
  if (type === "battlefield") {
    // --- ADR EXACT : la table UNIQUE du champ de bataille (armes lourdes), tirée une fois puis
    //     RÉPARTIE sur 2-3 points de fouille (adaptation : une scène ADR -> des objets 3D).
    //     [ressource, chance, min, max] avec tirage min..max-1, fidèle drawLoot. ---
    const TABLE: Array<[string, number, number, number]> = [
      ["rifle", 0.5, 1, 3], ["bullets", 0.8, 5, 20], ["laser rifle", 0.3, 1, 3],
      ["energy cell", 0.5, 5, 10], ["grenade", 0.5, 1, 5], ["alien alloy", 0.3, 1, 1],
    ];
    const drops: Array<[string, number]> = [];
    for (const [res, chance, min, max] of TABLE) {
      if (nextFloat(rng) >= chance) continue;
      drops.push([res, min + nextInt(rng, Math.max(1, max - min))]);
    }
    const spots = 2 + nextInt(rng, 2); // 2..3 points
    const loots: Array<Record<string, number>> = Array.from({ length: spots }, () => ({}));
    drops.forEach(([res, n], i) => { loots[i % spots][res] = (loots[i % spots][res] ?? 0) + n; });
    for (let i = 0; i < spots; i++) {
      const ang = nextFloat(rng) * Math.PI * 2;
      const r = 4 + nextFloat(rng) * 5;
      const hasLoot = Object.keys(loots[i]).length > 0;
      nodes.push({ id: "s" + i, kind: hasLoot ? "chamber" : "deadend", depth: 0,
        pos: { x: Math.cos(ang) * r, z: Math.sin(ang) * r }, loot: loots[i] });
      if (hasLoot) segments.push({ from: "entry", to: "s" + i });
    }
    return { type, nodes, segments };
  }

  if (type === "town" || type === "city") {
    // --- VILLE/CITÉ (R3b) : séquence scriptée jouée PARMI les ruines (surface). Les butins
    //     intermédiaires + la FIN (gatée par les étapes) deviennent des nœuds 3D. ---
    const path = type === "town" ? rollTownPath(rng) : rollCityPath(rng);
    path.lootNodes.forEach((loot, i) => {
      if (Object.keys(loot).length === 0) return;
      const ang = nextFloat(rng) * Math.PI * 2;
      const rr = 5 + nextFloat(rng) * 5;
      nodes.push({ id: "l" + i, kind: "chamber", depth: 0, pos: { x: Math.cos(ang) * rr, z: Math.sin(ang) * rr }, loot });
      segments.push({ from: "entry", to: "l" + i });
    });
    const ang = nextFloat(rng) * Math.PI * 2;
    nodes.push({ id: "end", kind: "chamber", depth: 1, pos: { x: Math.cos(ang) * 8, z: Math.sin(ang) * 8 }, loot: path.endLoot });
    segments.push({ from: "entry", to: "end" });
    return { type, nodes, segments };
  }

  const ore = MINE_ORE[type];
  if (ore) {
    // --- MINE : descente courte, orientée vers UN filon. ---
    const jx = (nextFloat(rng) - 0.5) * 4;
    nodes.push({ id: "j0", kind: "junction", depth: 1, pos: { x: jx, z: -8 }, loot: {} });
    const oreQty = 6 + nextInt(rng, 6); // 6..11
    const deepLoot: Record<string, number> = { [ore]: oreQty };
    if (ore === "iron") deepLoot.coal = 1 + nextInt(rng, 3); // un peu de charbon avec le fer (ADR)
    nodes.push({ id: "deep", kind: "deep", depth: 2, pos: { x: jx + (nextFloat(rng) - 0.5) * 3, z: -16 }, loot: deepLoot });
    segments.push({ from: "entry", to: "j0" }, { from: "j0", to: "deep" });
    return { type, nodes, segments };
  }

  // --- GROTTE (M8.5/F3.2) : le SETPIECE d'ADR (setpieces.js `cave`, poids et butins EXACTS),
  //     adapté à l'exploration physique. Le CHEMIN (a -> b -> c -> end) est tiré à la graine :
  //     les COMBATS/GATES deviennent la séquence `caveSteps` (progression type « gardiens »),
  //     les scènes de BUTIN deviennent des nœuds 3D ramassables ; la FIN (end1/2/3) est un nœud
  //     gaté par la séquence. Tout l'aléa est consommé dans un ORDRE FIXE -> déterministe. ---
  const path = rollCavePath(rng);
  nodes.push({ id: "j0", kind: "junction", depth: 1, pos: { x: 0, z: -8 }, loot: {} });
  segments.push({ from: "entry", to: "j0" });
  let prev = "j0";
  if (path.campLoot) {
    nodes.push({ id: "camp", kind: "chamber", depth: 1, pos: { x: 3 + nextFloat(rng) * 2, z: -11 }, loot: path.campLoot });
    segments.push({ from: prev, to: "camp" });
  }
  if (path.wandererLoot) {
    nodes.push({ id: "wanderer", kind: "chamber", depth: 2, pos: { x: -3 - nextFloat(rng) * 2, z: -17 }, loot: path.wandererLoot });
    segments.push({ from: prev, to: "wanderer" });
    prev = "wanderer";
  }
  nodes.push({ id: "end", kind: "chamber", depth: 3, pos: { x: (nextFloat(rng) - 0.5) * 4, z: -26 }, loot: path.endLoot });
  segments.push({ from: prev, to: "end" });
  return { type, nodes, segments };
}

/** Une étape de PROGRESSION scriptée : un combat (parfois SANS échappatoire — combats forcés des
 *  hôpitaux de cité, boss de mines), ou une gate « torche » (continuer coûte 1 torche). */
export type CaveStep = { kind: "fight"; enemyId: string; noFlee?: boolean } | { kind: "gate" };

/** Tire le CHEMIN du setpiece grotte (poids ADR exacts) + ses butins. Consomme le RNG en ordre fixe. */
function rollCavePath(rng: RngState): {
  steps: CaveStep[];
  campLoot: Record<string, number> | null;
  wandererLoot: Record<string, number> | null;
  endLoot: Record<string, number>;
} {
  const roll = (table: Array<[string, number, number, number]>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [res, chance, min, max] of table) {
      if (nextFloat(rng) >= chance) continue;
      out[res] = (out[res] ?? 0) + min + nextInt(rng, Math.max(1, max - min));
    }
    return out;
  };
  const steps: CaveStep[] = [];
  let campLoot: Record<string, number> | null = null;
  let wandererLoot: Record<string, number> | null = null;
  // A : 30 % combat (a1) / 30 % boyau (a2) / 40 % vieux camp (a3).
  const rA = nextFloat(rng);
  const A = rA < 0.3 ? "a1" : rA < 0.6 ? "a2" : "a3";
  if (A === "a1") steps.push({ kind: "fight", enemyId: "cave beast" });
  if (A === "a3") campLoot = roll([["cured meat", 1.0, 1, 5], ["torch", 0.5, 1, 5], ["leather", 0.3, 1, 5]]);
  // B (selon A) : b1 cadavre de wanderer / b2 « la torche s'éteint » / b3 combat bête / b4 combat lézard.
  const rB = nextFloat(rng);
  const B = A === "a1" ? (rB < 0.5 ? "b1" : "b2") : A === "a2" ? (rB < 0.5 ? "b2" : "b3") : rB < 0.5 ? "b3" : "b4";
  if (B === "b1") wandererLoot = roll([["iron sword", 1.0, 1, 1], ["cured meat", 0.8, 1, 5], ["torch", 0.5, 1, 3], ["medicine", 0.1, 1, 2]]);
  if (B === "b2") steps.push({ kind: "gate" });
  if (B === "b3") steps.push({ kind: "fight", enemyId: "cave beast lesser" });
  if (B === "b4") steps.push({ kind: "fight", enemyId: "cave lizard" });
  // C : b1/b2 -> grosse bête (c1) ; b3/b4 -> lézard géant (c2).
  const C = B === "b1" || B === "b2" ? "c1" : "c2";
  steps.push({ kind: "fight", enemyId: C === "c1" ? "large beast" : "giant lizard" });
  // FIN : c1 -> 50 % end1/end2 ; c2 -> 70 % end2 / 30 % end3.
  const rE = nextFloat(rng);
  const END = C === "c1" ? (rE < 0.5 ? "end1" : "end2") : rE < 0.7 ? "end2" : "end3";
  const endLoot =
    END === "end1"
      ? roll([["meat", 1.0, 5, 10], ["fur", 1.0, 5, 10], ["scales", 1.0, 5, 10], ["teeth", 1.0, 5, 10], ["cloth", 0.5, 5, 10]])
      : END === "end2"
        ? roll([["cloth", 1.0, 5, 10], ["leather", 1.0, 5, 10], ["iron", 1.0, 5, 10], ["cured meat", 1.0, 5, 10], ["steel", 0.5, 5, 10], ["bolas", 0.3, 1, 3], ["medicine", 0.15, 1, 4]])
        : roll([["steel sword", 1.0, 1, 1], ["bolas", 0.5, 1, 3], ["medicine", 0.3, 1, 3]]);
  return { steps, campLoot, wandererLoot, endLoot };
}

/** Étapes de PROGRESSION d'une grotte (combats scriptés + gates) — PUR, dérivé de la graine. */
export function caveSteps(cx: number, cz: number, worldSeed: number): CaveStep[] {
  const rng = createRng(dungeonSeed("cave", cx, cz, worldSeed));
  return rollCavePath(rng).steps;
}

// ============================================================================
//  M8.5/R3b — VILLES & CITÉS : les setpieces `town` (18 scènes) et `city` (~33 scènes) d'ADR,
//  CONDENSÉS en branches linéaires (poids de branche, ennemis, gates torche, butins et FINS
//  exacts — cf. docs/analyse-combat-adr.md annexe B). Adaptation « surface » : la séquence se
//  joue PARMI les ruines déjà modélisées (pas d'intérieur), butins = objets 3D, fin gatée.
// ============================================================================

type RolledPath = { steps: CaveStep[]; lootNodes: Array<Record<string, number>>; endLoot: Record<string, number> };

function rollLootTable(rng: RngState, table: Array<[string, number, number, number]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [res, chance, min, max] of table) {
    if (nextFloat(rng) >= chance) continue;
    out[res] = (out[res] ?? 0) + min + nextInt(rng, Math.max(1, max - min));
  }
  return out;
}

/** VILLE : 30 % école (torche) / 30 % rue (embuscade) / 40 % clinique (torche). */
function rollTownPath(rng: RngState): RolledPath {
  const steps: CaveStep[] = [];
  const lootNodes: Array<Record<string, number>> = [];
  let endLoot: Record<string, number> = {};
  const r = nextFloat(rng);
  if (r < 0.3) {
    // ÉCOLE (a1, torche) : casier -> charognard -> voyou -> charognard armé -> camp/réserve.
    steps.push({ kind: "gate" });
    if (nextFloat(rng) < 0.5) lootNodes.push(rollLootTable(rng, [["cured meat", 1.0, 1, 5], ["torch", 0.8, 1, 3], ["bullets", 0.3, 1, 5], ["medicine", 0.05, 1, 3]]));
    else steps.push({ kind: "fight", enemyId: "scavenger" });
    steps.push({ kind: "fight", enemyId: "thug" });
    steps.push({ kind: "fight", enemyId: "town scavenger" });
    endLoot = nextFloat(rng) < 0.5
      ? rollLootTable(rng, [["steel sword", 1.0, 1, 1], ["steel", 1.0, 5, 10], ["cured meat", 1.0, 5, 10], ["bolas", 0.5, 1, 5], ["medicine", 0.3, 1, 2]])
      : rollLootTable(rng, [["coal", 1.0, 5, 10], ["cured meat", 1.0, 5, 10], ["leather", 1.0, 5, 10]]);
  } else if (r < 0.6) {
    // RUE (a2) : voyou -> bête OU caravane -> bête féroce -> justicier -> FUSIL garanti / réserve.
    steps.push({ kind: "fight", enemyId: "thug" });
    if (nextFloat(rng) < 0.5) steps.push({ kind: "fight", enemyId: "town beast" });
    else lootNodes.push(rollLootTable(rng, [["cured meat", 0.8, 1, 5], ["torch", 0.5, 1, 3], ["bullets", 0.3, 1, 5], ["medicine", 0.1, 1, 3]]));
    steps.push({ kind: "fight", enemyId: "town beast fierce" });
    steps.push({ kind: "fight", enemyId: "vigilante" });
    endLoot = nextFloat(rng) < 0.5
      ? rollLootTable(rng, [["rifle", 1.0, 1, 1], ["bullets", 1.0, 1, 5]])
      : rollLootTable(rng, [["cured meat", 1.0, 5, 10], ["iron", 1.0, 5, 10], ["torch", 1.0, 1, 5], ["bolas", 0.5, 1, 5], ["medicine", 0.1, 1, 2]]);
  } else {
    // CLINIQUE (a3, torche) : le fou furieux -> 30 % tiroirs à médecine / 70 % clinique pillée.
    steps.push({ kind: "gate" });
    steps.push({ kind: "fight", enemyId: "madman" });
    endLoot = nextFloat(rng) < 0.3 ? rollLootTable(rng, [["medicine", 1.0, 2, 5]]) : {};
  }
  return { steps, lootNodes, endLoot };
}

/** CITÉ : 20 % rues / 30 % périmètre militaire / 30 % bidonville / 20 % hôpital (torche). */
function rollCityPath(rng: RngState): RolledPath {
  const steps: CaveStep[] = [];
  const lootNodes: Array<Record<string, number>> = [];
  let endLoot: Record<string, number> = {};
  const r = nextFloat(rng);
  if (r < 0.2) {
    // RUES/TOUR : lézard -> gravats -> oiseau charognard OU nuée de rats -> nid / cache.
    steps.push({ kind: "fight", enemyId: "huge lizard" });
    lootNodes.push(rollLootTable(rng, [["bullets", 0.5, 1, 5], ["steel", 0.8, 1, 10], ["alien alloy", 0.01, 1, 1], ["cloth", 1.0, 1, 10]]));
    steps.push({ kind: "fight", enemyId: nextFloat(rng) < 0.5 ? "carrion bird" : "rats" });
    endLoot = nextFloat(rng) < 0.5
      ? rollLootTable(rng, [["bullets", 0.8, 5, 10], ["bolas", 0.5, 1, 5], ["alien alloy", 0.5, 1, 1]])
      : rollLootTable(rng, [["torch", 0.8, 1, 5], ["cured meat", 0.5, 1, 5]]);
  } else if (r < 0.5) {
    // PÉRIMÈTRE MILITAIRE : sniper OU soldat -> vétéran / soldat / commando -> fins lourdes.
    steps.push({ kind: "fight", enemyId: nextFloat(rng) < 0.5 ? "sniper" : "soldier" });
    const r2 = nextFloat(rng);
    steps.push({ kind: "fight", enemyId: r2 < 0.34 ? "old veteran" : r2 < 0.67 ? "soldier" : "commando" });
    endLoot = nextFloat(rng) < 0.5
      ? rollLootTable(rng, [["rifle", 0.8, 1, 1], ["bullets", 0.8, 1, 5], ["laser rifle", 0.3, 1, 1], ["energy cell", 0.3, 1, 5], ["alien alloy", 0.3, 1, 1]])
      : rollLootTable(rng, [["rifle", 1.0, 1, 1], ["bullets", 1.0, 1, 10], ["grenade", 0.8, 1, 5]]);
  } else if (r < 0.8) {
    // BIDONVILLE : homme frêle (50 %) -> échoppe pillée -> squatteurs.
    if (nextFloat(rng) < 0.5) steps.push({ kind: "fight", enemyId: "frail man" });
    lootNodes.push(rollLootTable(rng, [["steel sword", 0.8, 1, 1], ["rifle", 0.5, 1, 1], ["bullets", 0.25, 1, 8], ["alien alloy", 0.01, 1, 1], ["medicine", 0.5, 1, 4]]));
    steps.push({ kind: "fight", enemyId: "squatters" });
    endLoot = rollLootTable(rng, [["rifle", 0.8, 1, 1], ["bullets", 0.8, 1, 5], ["bolas", 0.5, 1, 5], ["alien alloy", 0.2, 1, 1]]);
  } else {
    // HÔPITAL (torche) : vieil homme OU couloirs vides -> lézards/squatteurs -> COMBAT FORCÉ
    // (créature difforme OU tentacules — « no leave button », fidèle) -> réserve d'hôpital.
    steps.push({ kind: "gate" });
    if (nextFloat(rng) < 0.5) steps.push({ kind: "fight", enemyId: "old man" });
    steps.push({ kind: "fight", enemyId: nextFloat(rng) < 0.5 ? "hospital lizards" : "squatters" });
    const forced = nextFloat(rng) < 0.5 ? "deformed" : "tentacles";
    steps.push({ kind: "fight", enemyId: forced, noFlee: true });
    endLoot = forced === "deformed"
      ? rollLootTable(rng, [["medicine", 1.0, 3, 12], ["energy cell", 0.8, 2, 5], ["cloth", 0.5, 1, 3], ["steel", 0.3, 2, 3], ["alien alloy", 0.3, 1, 1]])
      : rollLootTable(rng, [["steel sword", 0.5, 1, 3], ["rifle", 0.3, 1, 2], ["teeth", 1.0, 2, 8], ["cloth", 0.5, 3, 6], ["alien alloy", 0.1, 1, 1]]);
  }
  return { steps, lootNodes, endLoot };
}

/** Étapes de PROGRESSION d'une ville/cité — PUR, dérivé de la graine. */
export function townSteps(type: "town" | "city", cx: number, cz: number, worldSeed: number): CaveStep[] {
  const rng = createRng(dungeonSeed(type, cx, cz, worldSeed));
  return (type === "town" ? rollTownPath(rng) : rollCityPath(rng)).steps;
}

// ============================================================================
//  M11/RF2 — LE CUIRASSÉ EXPLORABLE : un DONJON DE SALLES (≠ l'anneau+couloirs continu des
//  grottes). Antichambre (hub) → 3 ailes (ingénierie/martiale/médicale) → pont (gaté sur les 3
//  ailes). Layout SCRIPTÉ (climax fidèle ADR `setpieces.js ship`) ; seul le BUTIN de fin de salle
//  est tiré à la graine. PUR & déterministe (host et clients le recalculent à l'identique).
//  Positions LOCALES (origine = sas d'entrée ; le rendu translate au centre-monde du site).
// ============================================================================

export type RoomId = "antechamber" | "engineering" | "martial" | "medical" | "bridge";

/** Une salle du cuirassé : volume rectangulaire, vague d'ennemis (host) + butin de fin de salle. */
export interface DungeonRoom {
  id: RoomId;
  pos: { x: number; z: number }; // centre LOCAL (origine = sas d'entrée)
  size: { w: number; d: number }; // emprise rectangulaire (u)
  wing?: "engineering" | "martial" | "medical"; // les 3 ailes (poser le flag à la fin = gate du pont)
  isHub?: boolean; // antichambre (pas de combat)
  isBridge?: boolean; // pont (gaté sur les 3 ailes)
  enemies: Array<{ enemyId: string; count: number }>; // vague d'arène (spawn host à l'entrée)
  loot: Record<string, number>; // butin de fin de salle (drop au sol au clear)
}

/** Un sas reliant deux salles (porte rendue, couleur = état d'arène — RF2b/RF5). */
export interface DungeonDoor {
  from: RoomId;
  to: RoomId;
}

/** Le donjon du cuirassé (graphe de salles + sas). */
export interface ShipDungeon {
  type: "executioner";
  rooms: DungeonRoom[];
  doors: DungeonDoor[];
}

/**
 * Génère le donjon du cuirassé — PUR & déterministe. Layout FIXE (scripté pour le climax) ;
 * seul le butin de fin de salle (alliage) est tiré à la graine, en ORDRE FIXE.
 *  - antichambre (hub, sans combat) -> point de départ vers les 3 ailes ;
 *  - chaque aile = une arène (piétaille + boss) qui pose son flag d'aile au clear ;
 *  - pont = gaté sur les 3 ailes ; son clear FINIT le cuirassé (le `fleet beacon` y tombera — RF6).
 */
export function executionerDungeon(cx: number, cz: number, worldSeed: number): ShipDungeon {
  const rng = createRng(dungeonSeed("executioner", cx, cz, worldSeed));
  const alloy = (): Record<string, number> => ({ "alien alloy": 1 + nextInt(rng, 3) }); // 1..3
  const engLoot = alloy();
  const marLoot = alloy();
  const medLoot = alloy();
  // Pont : gros cache d'alliage + le FLEET BEACON GARANTI (M11/RF6 — drop du boss `immortal wanderer`,
  // change la fin : épilogue étendu si ramené à l'évasion ; optionnel, non reporté au prestige).
  const briLoot: Record<string, number> = { "alien alloy": 3 + nextInt(rng, 3), "fleet beacon": 1 }; // 3..5 + 1 beacon
  // Layout AXIS-ALIGNED & salles ADJACENTES (parois mitoyennes -> sas franc, rendu RF2b simple) :
  // antichambre au centre ; ingénierie/martiale à l'ouest/est ; médicale au nord ; pont au-delà.
  const rooms: DungeonRoom[] = [
    { id: "antechamber", pos: { x: 0, z: 0 }, size: { w: 20, d: 22 }, isHub: true, enemies: [], loot: {} },
    { id: "engineering", pos: { x: -20, z: 0 }, size: { w: 20, d: 22 }, wing: "engineering", loot: engLoot,
      enemies: [{ enemyId: "unruly welder", count: 2 }, { enemyId: "automated turret", count: 1 }, { enemyId: "unstable prototype", count: 1 }] },
    { id: "martial", pos: { x: 20, z: 0 }, size: { w: 20, d: 22 }, wing: "martial", loot: marLoot,
      enemies: [{ enemyId: "alien guard", count: 2 }, { enemyId: "defence turret", count: 1 }, { enemyId: "chitinous horror", count: 1 }, { enemyId: "murderous robot", count: 1 }] },
    { id: "medical", pos: { x: 0, z: 22 }, size: { w: 20, d: 22 }, wing: "medical", loot: medLoot,
      enemies: [{ enemyId: "defence turret", count: 1 }, { enemyId: "unstable automaton", count: 1 }, { enemyId: "malformed experiment", count: 1 }] },
    { id: "bridge", pos: { x: 0, z: 44 }, size: { w: 22, d: 22 }, isBridge: true, loot: briLoot,
      enemies: [{ enemyId: "operative", count: 2 }, { enemyId: "immortal wanderer", count: 1 }] },
  ];
  const doors: DungeonDoor[] = [
    { from: "antechamber", to: "engineering" },
    { from: "antechamber", to: "martial" },
    { from: "antechamber", to: "medical" },
    { from: "medical", to: "bridge" },
  ];
  return { type: "executioner", rooms, doors };
}

/** Butin d'un nœud précis (lecture pure du donjon généré). {} si inconnu / sans butin. */
export function lootForNode(type: string, cx: number, cz: number, worldSeed: number, nodeId: string): Record<string, number> {
  const node = dungeonFor(type, cx, cz, worldSeed).nodes.find((n) => n.id === nodeId);
  return node ? node.loot : {};
}

/** Liste des nœuds PORTEURS de butin d'un site (pour décider « grotte entièrement vidée »). */
export function lootNodeIds(type: string, cx: number, cz: number, worldSeed: number): string[] {
  return dungeonFor(type, cx, cz, worldSeed)
    .nodes.filter((n) => Object.keys(n.loot).length > 0)
    .map((n) => n.id);
}
