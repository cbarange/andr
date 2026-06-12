// ============================================================================
//  DONJONS SOUTERRAINS (M9) — génération PURE & déterministe (§3.1, §3.3).
//  La disposition d'une mine/grotte et son butin sont des FONCTIONS de la graine
//  du monde (`worldSeed`) + des coordonnées de cellule (cx, cz) + du type de site.
//  -> identiques chez tous les pairs, rien à stocker (comme worldgen.ts/scatter).
//  AUCUNE dépendance Babylon/DOM ni `state.rng` : testable au terminal.
//  Voir docs/mines-grottes-implementation.md (étape S1) & mines-grottes-souterrains.md.
// ============================================================================

import { createRng, nextFloat, nextInt } from "./rng";

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

/** Table de butin d'une grotte : [ressource, min, max] (tirage borné, déterministe). */
const CAVE_LOOT: Array<[string, number, number]> = [
  ["fur", 2, 5],
  ["meat", 1, 4],
  ["leather", 1, 3],
  ["teeth", 1, 3],
  ["scales", 1, 2],
  ["cloth", 1, 2],
];

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

  if (type === "borehole" || type === "battlefield") {
    // --- SITE DE SURFACE (R3) : pas de tunnel — des points de FOUILLE autour du centre. ---
    // Le forage est la source PRINCIPALE d'alliage extraterrestre (fidèle ADR) ; le champ de
    // bataille rend les restes des combats (munitions, métal — les ARMES elles-mêmes = M10).
    const spots = 2 + nextInt(rng, 2); // 2..3 points de fouille
    for (let i = 0; i < spots; i++) {
      const ang = nextFloat(rng) * Math.PI * 2;
      const r = 4 + nextFloat(rng) * 5; // 4..9 u du centre du site
      const loot: Record<string, number> = {};
      if (type === "borehole") {
        loot["alien alloy"] = 1 + nextInt(rng, 3); // 1..3
        if (nextFloat(rng) < 0.35) loot["energy cell"] = 1 + nextInt(rng, 2);
      } else {
        const roll = nextFloat(rng);
        if (roll < 0.5) loot["bullets"] = 2 + nextInt(rng, 5);
        else if (roll < 0.85) loot["steel"] = 1 + nextInt(rng, 3);
        else loot["energy cell"] = 1 + nextInt(rng, 2);
        if (nextFloat(rng) < 0.12) loot["alien alloy"] = 1; // éclat rare
      }
      nodes.push({ id: "s" + i, kind: "chamber", depth: 0, pos: { x: Math.cos(ang) * r, z: Math.sin(ang) * r }, loot });
      segments.push({ from: "entry", to: "s" + i });
    }
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

  // --- GROTTE : carrefour + plusieurs branches (le choix gauche/droite d'ADR). ---
  nodes.push({ id: "j0", kind: "junction", depth: 1, pos: { x: 0, z: -8 }, loot: {} });
  segments.push({ from: "entry", to: "j0" });
  const branches = 2 + nextInt(rng, 2); // 2..3 branches
  for (let b = 0; b < branches; b++) {
    const ang = (b / Math.max(1, branches - 1)) * Math.PI - Math.PI / 2; // éventail
    const x = Math.cos(ang) * 10;
    const z = -12 - Math.abs(Math.sin(ang)) * 6;
    const isChamber = nextFloat(rng) < 0.7; // 70 % chambre à butin, sinon cul-de-sac
    const loot: Record<string, number> = {};
    if (isChamber) {
      const picks = 1 + nextInt(rng, 2); // 1..2 ressources
      for (let p = 0; p < picks; p++) {
        const [res, lo, hi] = CAVE_LOOT[nextInt(rng, CAVE_LOOT.length)];
        loot[res] = (loot[res] ?? 0) + lo + nextInt(rng, hi - lo + 1);
      }
    }
    nodes.push({ id: "b" + b, kind: isChamber ? "chamber" : "deadend", depth: 2, pos: { x, z }, loot });
    segments.push({ from: "j0", to: "b" + b });
  }
  return { type, nodes, segments };
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
