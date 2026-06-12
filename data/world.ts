// ============================================================================
//  DONNÉES — seule source de vérité du contenu (§3.2 "piloté par les données").
//  Modifier le contenu = éditer ce fichier, pas le moteur.
//  Ce module est PUR : aucune dépendance Babylon/DOM (il est importé par la sim).
// ============================================================================

// Import de TYPE seulement (erased à la compilation) : aucune dépendance runtime, le
// module data reste pur. Sert aux prédicats `isAvailable` des événements (M5, lecture seule).
import type { GameState } from "../src/sim/state";

export interface TreePos {
  x: number;
  z: number;
}

export const config = {
  rngSeed: 12345, // graine partagée -> déterminisme (§3.3)
  simTickHz: 20, // pas fixe de la simulation (§3.6)
  gatherRange: 2.6, // distance max (XZ) pour couper un arbre
  trapRange: 3.0, // distance max pour relever un piège
  builderRange: 3.4, // distance max pour parler à la constructrice
  cabinRange: 3.6, // distance max pour interagir avec la cabane / le coffre
  outpostRange: 8.0, // distance max (au centre de cellule) pour se ravitailler à un avant-poste (M7)
  // Rechargement des pièges : CHAQUE piège tire son PROPRE délai au hasard dans [min, max]
  // à chaque relève (via le RNG à graine -> déterministe, cohérent en P2P). ADR : ~90 s fixe.
  trapsCooldownMinSeconds: 45,
  trapsCooldownMaxSeconds: 65,

  // --- Récolte & transport (re-rythme façon A Dark Room) ---
  gather: {
    woodPerChop: 8, // bois par coup de hache
    chopsPerTree: 3, // coups pour abattre un arbre (puis il tombe et disparaît)
    chopBusySeconds: 0.6, // durée d'un coup -> couper « prend du temps », pas d'instantané
    treeRegrowSeconds: 45, // un nouvel arbre repousse ailleurs à ce rythme
  },
  carryCapBase: 24, // capacité du sac (≈ un arbre entier = 3×8)
  cartCapBonus: 24, // la charrette double la capacité de transport
  cabinRepairCost: 20, // bois (du sac) pour réparer la cabane en ruine

  // Réglages physiques/mouvement (consommés par le rendu, mais centralisés ici).
  worldSize: 50, // côté du terrain (unités)
  gravity: -20, // gravité (m/s²) — un peu plus sèche que 9.81 pour le ressenti
  moveSpeed: 6, // vitesse de marche (u/s)
  jumpSpeed: 8, // vitesse verticale au saut (u/s)
  transformHz: 15, // fréquence de diffusion réseau de la position de l'avatar
  // Exploration : paliers de vitesse via DOUBLE-TAP avant (×) / arrière (÷) — render-local.
  explore: { speedStep: 1.6, speedMultMin: 0.5, speedMultMax: 10, doubleTapMs: 280 },
  // LOD : distances (unités) du rendu conditionnel des entités (cf. docs/perf-rendu.md).
  // village : ≤ full = animé plein ; ≤ minimal = animé au ralenti ; au-delà = déchargé.
  lod: { villageFull: 45, villageMinimal: 85, hysteresis: 10 },

  // --- M1 : le feu & l'étranger (valeurs en SECONDES, converties en tics par la sim) ---
  // Inspiré d'A Dark Room (feu qui refroidit, attisage au bois, arrivée de l'étrangère),
  // raccourci pour le ressenti 3D. Tout est éditable ici sans toucher au moteur.
  fire: {
    stokeCost: 5, // bois par attisage (1 récolte d'arbre = 1 attisage)
    lightLevel: 3, // niveau du feu juste après l'avoir allumé (Burning)
    coolSeconds: 100, // le feu perd un cran toutes les ~1 min 40 (ADR : 5 min ; on reste un peu en dessous)
    stokeCooldownSeconds: 4, // délai mini entre deux attisages
    tempAdjustSeconds: 8, // la température se rapproche du niveau du feu
    interactRange: 3.5, // distance pour allumer/attiser le feu central
    builder: {
      appearFireLevel: 2, // l'étrangère apparaît dès que le feu atteint « vacillant »
      advanceSeconds: 22, // temps entre deux étapes de l'étrangère (tant que le feu vit)
      maxLevel: 3, // 3 = prête à construire (passerelle vers M2)
      // --- Entretien du feu par la constructrice (une fois la cabane réparée : elle y « vit ») ---
      // Elle RANIME franchement le feu quand il faiblit : le pousse à « ardent », et PARFOIS jusqu'à
      // « rugissant » (tirage aléatoire via le RNG à graine -> déterministe, P2P-safe). Elle puise dans
      // l'ENTREPÔT (pression réelle sur la réserve de bois ; coût proportionnel aux crans regagnés).
      tendThreshold: 2, // intervient quand le feu est tombé à « vacillant » (≤ 2) et encore vivant
      tendTarget: 3, // niveau visé par défaut : « ardent »
      tendRoaringChance: 0.3, // probabilité de pousser jusqu'à « rugissant » (4) plutôt qu'« ardent »
      tendWoodCost: 5, // bois consommé PAR CRAN de feu regagné (depuis l'entrepôt)
      tendCooldownSeconds: 60, // délai entre deux entretiens (> coolSeconds : ne rend pas le feu éternel)
      tendWalkSeconds: 6, // fenêtre d'animation « aller-retour au feu » (rendu, cosmétique)
    },
  },

  // --- M3 : population & économie de tick ---
  population: {
    hutRoom: 4, // places de population par hutte (ADR : 4)
    growMinSeconds: 10, // intervalle mini d'arrivée d'un villageois
    growMaxSeconds: 25, // intervalle maxi (tiré via le RNG à graine)
    incomeSeconds: 10, // période d'application des revenus des métiers (valeur d'ADR)
  },
  // --- Construction : chantiers VISUELS. La constructrice bâtit UN bâtiment à la fois
  //     (file séquentielle, déterministe -> P2P-safe). Le bâtiment ne compte dans la sim
  //     (capacité, métiers, plafonds) qu'une fois le chantier ACHEVÉ (« fonctionnel à la fin »).
  construction: {
    defaultSeconds: 12, // durée d'un chantier sans réglage propre (cf. Craftable.buildSeconds)
  },
  // Appât : chaque appât consommé à la relève = une prise supplémentaire (comme ADR).
  baitPerExtraCatch: 1,

  // --- M5 : événements. CADENCE FIDÈLE À A DARK ROOM (_EVENT_TIME_RANGE : [3, 6] minutes,
  //     on NE compresse PAS). `emptyRescheduleScale` : si aucun événement n'est éligible,
  //     on re-tente plus tôt (× ce facteur), comme l'original. ---
  events: { minSeconds: 180, maxSeconds: 360, emptyRescheduleScale: 0.5 },

  // --- M6/M7 : SURVIE (eau / nourriture / santé), PAR JOUEUR. Pression SPATIALE : la survie ne
  //     se vide que DEHORS (hors zone sûre = au-delà de VILLAGE_RADIUS), par TEMPS (pas par case,
  //     cf. monde unifié). À sec d'eau ET de vivres -> la santé baisse ; à 0 PV -> mort : retour au
  //     camp + perte du SAC (pas de l'entrepôt par défaut). Au camp/avant-poste : recharge. Tout
  //     est en SECONDES (converti en tics par la sim) -> éditable sans toucher au moteur. ---
  survival: {
    baseWater: 10, // outre de départ (sert aussi de capacité d'« outfit » M6 ; baril/citerne = M10)
    maxWater: 10,
    baseFood: 10, // vivres de départ
    maxFood: 10,
    maxHealth: 10,
    waterDrainSeconds: 12, // -1 eau toutes les 12 s dehors  -> ~2 min avant la soif totale
    foodDrainSeconds: 18, // -1 vivre toutes les 18 s dehors -> la faim suit la soif
    healthDrainSeconds: 6, // quand eau ET vivres = 0 : -1 PV toutes les 6 s -> ~1 min de sursis
    rechargeSeconds: 2, // au camp / avant-poste : +1 (eau/vivres/PV) toutes les 2 s vers le max
    respawnCooldownSeconds: 20, // après la mort : grâce avant que la survie ne reprenne dehors
    deathStoragePenalty: 0, // fraction d'entrepôt perdue à la mort (0 = perte du SAC seul ; knob pour durcir)
  },
} as const;

export const resources = {
  wood: { id: "wood", label: "Bois", initial: 0 },
} as const;

// ============================================================================
//  ENTREPÔT — rareté des ressources, plafonds par PALIER de cabane (cabinTier).
//  La cabane stocke PAR RESSOURCE (pas un total) ; le plafond dépend de la rareté
//  et du palier (×1 / ×5 / ×10). Pure & déterministe -> P2P-safe (cf. reducer).
// ============================================================================

export type Rarity = "standard" | "rare";

/** Rang de rareté par ressource (table validée). « très rare » est fusionné dans « rare ». */
export const RESOURCE_RARITY: Record<string, Rarity> = {
  wood: "standard", fur: "standard", meat: "standard", "cured meat": "standard", bait: "standard",
  leather: "rare", coal: "rare", iron: "rare", scales: "rare", teeth: "rare",
  cloth: "rare", sulphur: "rare", steel: "rare", bullets: "rare", charm: "rare",
  "alien alloy": "rare", "energy cell": "rare", // butin de forage / cité / champ de bataille (fin de partie)
};

/** Plafond de base (palier ×1) par rareté. */
export const STORAGE_CAP_BASE: Record<Rarity, number> = { standard: 1000, rare: 200 };

/** Paliers de la cabane : la VALEUR du palier EST le multiplicateur (1 / 5 / 10). 0 = ruine. */
export const CABIN_TIERS = [1, 5, 10] as const;
export type CabinTier = 0 | 1 | 5 | 10;

/** Coût d'amélioration (puisé dans l'ENTREPÔT), indexé par le palier CIBLE. Tunable. */
export const cabinUpgradeCost: Record<number, Record<string, number>> = {
  5: { wood: 300, leather: 40 }, // ×1 -> ×5
  10: { wood: 1000, iron: 80, leather: 120 }, // ×5 -> ×10
};

/** Palier suivant (1->5->10), ou null si déjà au maximum / pas encore réparée. */
export function nextCabinTier(tier: number): CabinTier | null {
  if (tier === 1) return 5;
  if (tier === 5) return 10;
  return null;
}

/** Plafond de stock d'une ressource pour un palier donné (multiplicateur = max(palier, 1)). */
export function storageCap(cabinTier: number, resourceId: string): number {
  const rarity = RESOURCE_RARITY[resourceId] ?? "standard";
  const mult = Math.max(1, cabinTier); // ruine (0) et ×1 plafonnent au même niveau de base
  return STORAGE_CAP_BASE[rarity] * mult;
}

// Positions des arbres (x, z) du CAMP — éditables à la main. Boussole : Nord = −Z (forêt),
// Sud = +Z (friche/approche). La forêt se DENSIFIE au nord, laisse une TROUÉE autour du
// pavillon de chasse (≈ -2,-24), et garde le SUD dégagé (l'approche). Les flancs E/O sont
// éclaircis. On évite la clairière centrale (r ≳ 9) et les ancres de bâtiments.
export const trees: TreePos[] = [
  // Abords nord & flancs (bois accessible tôt)
  { x: -6, z: -8 }, { x: 5, z: -9 }, { x: -13, z: -9 }, { x: 9, z: -6 },
  { x: -3, z: -12 }, { x: 12, z: -11 }, { x: -14, z: -12 }, { x: 7, z: -14 },
  // Bande nord intermédiaire
  { x: -8, z: -16 }, { x: 14, z: -18 }, { x: -17, z: -16 }, { x: 3, z: -18 },
  { x: 18, z: -14 }, { x: -12, z: -20 }, { x: 10, z: -21 }, { x: -20, z: -9 },
  // Forêt profonde au nord (trouée préservée autour du pavillon -2,-24)
  { x: -9, z: -27 }, { x: 6, z: -28 }, { x: -15, z: -25 }, { x: 13, z: -26 },
  { x: -22, z: -20 }, { x: 20, z: -24 }, { x: 16, z: -29 }, { x: -18, z: -30 },
  // Flancs est/ouest (lisière du village)
  { x: -21, z: 4 }, { x: 21, z: 5 }, { x: -16, z: -3 }, { x: 17, z: -4 },
];

// ============================================================================
//  LAYOUT FIXE DU CAMPEMENT DE DÉPART (≠ génération aléatoire du monde).
//  Chaque bâtiment construit se pose à son ANCRE (pos + orientation) au lieu des
//  anneaux concentriques. Données pures, lues par render/buildings.ts & render/cabin.ts.
//  Voir docs/plan-campement.md.
// ============================================================================

/** Ancre d'un bâtiment. `face` : "fire" = regarde le feu central (défaut) ; "south" =
 *  s'ouvre vers la friche (+Z) ; un nombre = yaw explicite (radians). */
export interface CampAnchor {
  x: number;
  z: number;
  face?: "fire" | "south" | number;
}

/** Chemin dessiné du camp : polyligne (points monde [x,z]) + demi-largeur optionnelle (u).
 *  Tracé via l'éditeur de spawn (F2), peint au sol par render/trails.ts (couche de base) et
 *  évité par le décor (render/campDecor.ts via campGround.campPath). */
export interface CampPath {
  w?: number;
  pts: Array<[number, number]>;
}

// Position de la cabane (point focal, placée à la main) — partagée par le layout calculé.
const CAMP_CABIN = { x: -1.5, z: -5.8 };

// === PLACEMENT MATHÉMATIQUE DES BÂTIMENTS (Chantier C — C) =================================
// Le campement reste FIXE & déterministe, mais HARMONIEUX : le feu (0,0) et la cabane sont des
// points focaux placés à la main ; les AUTRES bâtiments sont répartis par PRINCIPES MATHÉMATIQUES
// — phyllotaxie de Vogel (angle d'or 137,5°) pour les huttes, rayons au NOMBRE D'OR/Fibonacci,
// filtrés par QUARTIER (chasse=N, industrie=E, artisanat=O, habitat=S, cf. plan-campement.md) +
// une passe de RELAXATION anti-chevauchement. PUR (aucun aléatoire) -> identique chez tous les
// pairs. Voir docs/refonte-monde-campement.md §C.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // 137,50776°
// Angle des quartiers ; repère (x,z)=(cos a·r, sin a·r) -> +X=E(0), +Z=S(π/2), −X=O(π), −Z=N(−π/2).
const QUARTER = { hunt: -Math.PI / 2, industry: 0, crafts: Math.PI, home: Math.PI / 2 };
// Bâtiments uniques : quartier (angle de base ± décalage) + rayon (tiers ~Fibonacci 6,5/9/10/…/17).
const SINGLE_BUILDINGS: Array<{ id: string; ang: number; r: number; face?: "fire" | "south" }> = [
  { id: "cart", ang: QUARTER.home + 0.55, r: 6.5 },               // dépôt, près du feu (SE)
  { id: "trading post", ang: QUARTER.home, r: 9, face: "south" }, // échanges, s'ouvre vers la friche (S)
  { id: "workshop", ang: QUARTER.crafts - 0.42, r: 10 },          // artisanat (O)
  { id: "tannery", ang: QUARTER.crafts + 0.42, r: 13 },           // artisanat (O)
  { id: "armoury", ang: QUARTER.industry + 0.42, r: 11 },         // industrie (E)
  { id: "steelworks", ang: QUARTER.industry - 0.42, r: 15 },      // industrie sale, tenue à l'écart (E)
  { id: "smokehouse", ang: QUARTER.hunt + 0.5, r: 12 },           // fumage (N, près de la chasse)
  { id: "lodge", ang: QUARTER.hunt - 0.38, r: 17 },               // pavillon de chasse, clairière (N)
];

/** Génère les ancres des bâtiments (phyllotaxie + nombre d'or, par quartier) puis relaxe les
 *  chevauchements. PUR & déterministe. Remplace le placement manuel (harmonisation maths). */
export function generateCampLayout(): Record<string, CampAnchor[]> {
  interface LNode { id: string; x: number; z: number; minD: number; face?: "fire" | "south" }
  const nodes: LNode[] = [];
  const add = (id: string, x: number, z: number, minD: number, face?: "fire" | "south") => nodes.push({ id, x, z, minD, face });

  for (const b of SINGLE_BUILDINGS) add(b.id, Math.cos(b.ang) * b.r, Math.sin(b.ang) * b.r, 3.6, b.face);
  // Huttes (20) : spirale de Vogel dans la bande 10..22 u, orientée habitat (S) -> nappe régulière.
  for (let n = 0; n < 20; n++) {
    const r = 10 + 12 * Math.sqrt(n / 19);
    const a = QUARTER.home + n * GOLDEN_ANGLE;
    add("hut", Math.cos(a) * r, Math.sin(a) * r, 3.3);
  }
  // Pièges (10) : arc large autour de la forêt nord (terrains de chasse), r 18..27 u.
  for (let n = 0; n < 10; n++) {
    const a = QUARTER.hunt + (n - 4.5) * 0.42; // NO -> N -> NE
    add("trap", Math.cos(a) * (19 + (n % 3) * 3), Math.sin(a) * (19 + (n % 3) * 3), 1.6);
  }

  // Relaxation : écarte les paires trop proches + dégage le feu (r≥5) et la cabane (≥4,5).
  const clearOf = (n: LNode, ox: number, oz: number, minD: number): void => {
    const dx = n.x - ox, dz = n.z - oz, d = Math.hypot(dx, dz);
    if (d < minD && d > 1e-4) { n.x = ox + (dx / d) * minD; n.z = oz + (dz / d) * minD; }
  };
  for (let pass = 0; pass < 5; pass++) {
    for (let i = 0; i < nodes.length; i++) {
      clearOf(nodes[i], 0, 0, 5); // dégager le feu
      clearOf(nodes[i], CAMP_CABIN.x, CAMP_CABIN.z, 4.5); // dégager la cabane
      clearOf(nodes[i], 0, 8, 3.5); // dégager le point d'apparition du joueur (cf. player.ts)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1e-4;
        const want = a.minD + b.minD;
        if (d < want) { const p = (want - d) / 2, ux = dx / d, uz = dz / d; a.x -= ux * p; a.z -= uz * p; b.x += ux * p; b.z += uz * p; }
      }
    }
  }

  const out: Record<string, CampAnchor[]> = {};
  for (const n of nodes) (out[n.id] ??= []).push({ x: Math.round(n.x * 10) / 10, z: Math.round(n.z * 10) / 10, face: n.face ?? "fire" });
  return out;
}

export const campLayout: {
  cabin: { x: number; z: number; face?: number };
  buildings: Record<string, CampAnchor[]>;
  paths: CampPath[];
} = {
  // Layout du campement — dessiné à la main via l'éditeur de spawn (F2) puis exporté ici.
  // `cabin.face` = orientation de la cabane en radians (0 = façade vers +Z, défaut). L'éditeur
  // l'exporte quand on tourne la cabane ; cabin.ts l'applique (visuel + colliders + ancres).
  cabin: { ...CAMP_CABIN, face: 0.262 },
  // Bâtiments CALCULÉS par principes mathématiques (phyllotaxie + nombre d'or, par quartier) —
  // remplace l'ancien placement manuel pour gagner en harmonie. Cf. generateCampLayout() ci-dessus.
  buildings: generateCampLayout(),
  // Chemins du village : GÉNÉRÉS AU RUNTIME (cf. campPathsFor) à partir des bâtiments réellement
  // bâtis -> plus il y a de bâtiments, plus le réseau de sentiers s'étoffe (reliant chaque structure
  // au feu et, de proche en proche, aux voisines). Vide au départ ; rempli par main.ts puis peint
  // (render/campPaths.ts) et suivi par les villageois (biais navGrid). Voir docs/plan-campement.md.
  paths: [],
};

/**
 * Réseau de SENTIERS du camp : arbre couvrant minimal (Prim) reliant le FEU `(0,0)` (racine) et
 * chaque position fournie (cabane + bâtiments construits). Chaque structure est ainsi reliée au
 * centre ET, de proche en proche, à ses voisines — un vrai maillage de village qui CROÎT avec les
 * constructions. PUR & déterministe. Cosmétique + biais de déplacement (aucun impact sim/réseau).
 */
export function campPathsFor(positions: Array<{ x: number; z: number }>): CampPath[] {
  const nodes: Array<{ x: number; z: number }> = [{ x: 0, z: 0 }, ...positions]; // 0 = le feu (racine)
  if (nodes.length < 2) return [];
  const inTree = nodes.map(() => false);
  inTree[0] = true;
  const out: CampPath[] = [];
  for (let added = 1; added < nodes.length; added++) {
    let bi = -1, bj = -1, best = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      if (!inTree[i]) continue;
      for (let j = 0; j < nodes.length; j++) {
        if (inTree[j]) continue;
        const dx = nodes[i].x - nodes[j].x, dz = nodes[i].z - nodes[j].z, d = dx * dx + dz * dz;
        if (d < best) { best = d; bi = i; bj = j; }
      }
    }
    if (bj < 0) break;
    inTree[bj] = true;
    out.push({ pts: [[nodes[bi].x, nodes[bi].z], [nodes[bj].x, nodes[bj].z]] });
  }
  return out;
}

const clampN = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

// (Bordures du monde : voir le bloc « BORDURES DU MONDE » plus bas, après la config `worldgen`
//  dont elles dépendent — terrainHeight() les utilise via la fonction hoistée `borderField`.)

// PLATEAUX d'aplanissement (M9) : autour des sites grotte/mine, on APLANIT le terrain en plateau
// pour que le RELIEF de la carte = le SOL PLAT de l'intérieur (sinon le terrain ressort à travers le
// plancher de la grotte + incohérence de collision). Réglés au boot/seed depuis la liste des sites
// (`setTerrainPlateaus`, appelé par main.ts). État de RENDU (≠ sim ; le sim n'utilise pas terrainHeight).
export interface TerrainPlateau {
  x: number; z: number; // centre monde
  ri: number; // rayon INTÉRIEUR : terrain parfaitement plat (= h) — couvre le sol de l'intérieur
  ro: number; // rayon EXTÉRIEUR : raccord lissé vers le relief naturel
  h: number; // hauteur du plateau (= relief naturel au centre du site)
}
let terrainPlateaus: TerrainPlateau[] = [];
/** Fixe les plateaux d'aplanissement (autour des sites). Déterministe (dérivés de la graine). */
export function setTerrainPlateaus(p: TerrainPlateau[]): void {
  terrainPlateaus = p;
}

// Hauteur déterministe du terrain en (x, z), AVANT aplanissement (relief naturel pur). PURE.
// Le camp (centre) reste plat ; le relief s'accentue avec la distance, par régions ; le bord
// du monde est ceinturé de montagnes.
export function terrainBaseHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  // 1) CHAMP D'INTENSITÉ de relief (basse fréquence, 2 échelles) : de grandes régions tantôt
  //    PLATES (intensity ~0), tantôt VALLONNÉES (intensity ~1). Contraste poussé -> fini la monotonie.
  let intensity =
    0.5 +
    0.5 * Math.sin(x * 0.0042 + 1.3) * Math.cos(z * 0.0037 - 0.7) +
    0.25 * Math.sin(x * 0.0009 - z * 0.0011); // 2e échelle -> régions encore plus larges
  intensity = clampN((intensity - 0.35) / 0.5, 0, 1); // vraies plaines + vrais reliefs
  intensity *= clampN((r - 36) / 110, 0, 1); // le camp et ses abords restent plats/praticables
  // 2) ondulation de base douce (atténuée dans les plaines).
  const base = (Math.sin(x * 0.18) * 0.5 + Math.cos(z * 0.21) * 0.5) * (0.3 + 0.7 * intensity);
  // 3) collines multi-octaves ; AMPLITUDE pilotée par l'intensité (plaines ~0, reliefs ~amplitude).
  const A = worldgen.relief.amplitude;
  const hills =
    (Math.sin(x * 0.021) * Math.cos(z * 0.018) + // larges collines
      0.55 * Math.sin((x * 0.5 - z * 0.7) * 0.013) + // crêtes diagonales
      0.32 * Math.sin(x * 0.047 + z * 0.041) + // relief moyen
      0.22 * Math.sin(x * 0.09 - z * 0.085)) * // ondulations locales (visibles)
    A * intensity;
  // 4) BORDURES du monde (montagnes/océans par côté, au-delà de la zone jouable).
  const bf = borderField(x, z);
  const h = base + hills;
  // Dans la zone jouable (bf == 0) : on garde le sol AU-DESSUS de l'eau (plancher) -> le plan d'eau
  // global (faux océan) ne transparaît jamais dans une cuvette intérieure ; il n'apparaît que là où
  // une bordure « océan » fait plonger le terrain sous SEA_LEVEL.
  if (bf === 0) return h < SEA_LEVEL + 0.6 ? SEA_LEVEL + 0.6 : h;
  return h + bf;
}

// Hauteur FINALE du terrain : relief naturel APLANI en plateau autour des sites (grotte/mine) ->
// le sol de la carte rejoint celui de l'intérieur, sans relief qui transperce. Tous les
// consommateurs (maillage du sol, colliders, pose du joueur, intérieurs) passent par ici -> cohérent.
export function terrainHeight(x: number, z: number): number {
  let h = terrainBaseHeight(x, z);
  for (const p of terrainPlateaus) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d >= p.ro) continue; // hors d'influence
    // t : 0 au cœur (terrain = h du plateau, PLAT) -> 1 au bord externe (relief naturel). Lissé (smoothstep).
    const u = clampN((d - p.ri) / Math.max(0.001, p.ro - p.ri), 0, 1);
    const t = u * u * (3 - 2 * u);
    h = p.h * (1 - t) + h * t;
  }
  return h;
}

// --- Libellés narratifs (contenu, indexés par niveau ; M1) ---
export const FIRE_LABELS = ["mort", "fumant", "vacillant", "ardent", "rugissant"];
export const TEMP_LABELS = ["glacial", "froid", "doux", "chaud", "brûlant"];

// Messages déclenchés quand l'étrangère franchit une étape (builder.level 0..maxLevel).
export const BUILDER_MESSAGES = [
  "une étrangère s'approche du feu, transie.",
  "l'étrangère se réchauffe. elle observe le campement.",
  "l'étrangère se relève. elle a l'air de vouloir aider.",
  "l'étrangère dit qu'elle sait construire des choses.",
];

// ============================================================================
//  M2 — CRAFTABLES (bâtiments) & ressources, portés d'A Dark Room.
//  Coûts en bois croissants pour piège/hutte (base + n × incrément), comme l'original.
//  Les bâtiments qui exigent fourrure/viande/fer… resteront verrouillés tant que ces
//  ressources n'existent pas (elles arrivent en M3/M4) — fidèle à la révélation d'ADR.
// ============================================================================

export type CraftableType = "building";

export interface Craftable {
  id: string;
  name: string;
  type: CraftableType;
  maximum: number;
  /** Coût de base (1er exemplaire). */
  cost: Record<string, number>;
  /** Surcoût par exemplaire déjà construit (optionnel). */
  costPerLevel?: Record<string, number>;
  /** Durée du chantier en secondes (défaut : config.construction.defaultSeconds). */
  buildSeconds?: number;
  /** Ce que débloque le bâtiment (affiché dans l'UI ; les effets viennent en M3/M4). */
  desc: string;
  /** Message narratif (porté d'ADR) affiché au survol quand le bâtiment vient d'être révélé. */
  availableMsg?: string;
}

export const craftables: Craftable[] = [
  { id: "trap", name: "piège", type: "building", maximum: 10,
    cost: { wood: 10 }, costPerLevel: { wood: 10 }, buildSeconds: 10,
    desc: "capture des créatures (fourrure, viande…)",
    availableMsg: "elle dit qu'elle peut fabriquer des pièges pour attraper les créatures encore en vie dehors." },
  { id: "cart", name: "charrette", type: "building", maximum: 1,
    cost: { wood: 30 }, buildSeconds: 11, desc: "double la capacité de transport du sac",
    availableMsg: "elle dit qu'elle peut bricoler une charrette pour rapporter plus de bois." },
  { id: "hut", name: "hutte", type: "building", maximum: 20,
    cost: { wood: 100 }, costPerLevel: { wood: 50 }, buildSeconds: 14, // chiffres ADR (100 + n×50)
    desc: "abrite des villageois (+4 places)",
    availableMsg: "elle dit qu'il y a d'autres errants. ils travailleront, eux aussi." },
  { id: "lodge", name: "loge", type: "building", maximum: 1,
    cost: { wood: 200, fur: 10, meat: 5 }, buildSeconds: 16, desc: "permet d'assigner des chasseurs",
    availableMsg: "les villageois pourraient chasser, avec le bon équipement." },
  { id: "trading post", name: "poste de traite", type: "building", maximum: 1,
    cost: { wood: 400, fur: 100 }, buildSeconds: 16, desc: "ouvre le commerce avec les nomades",
    availableMsg: "un poste de traite faciliterait le commerce." },
  { id: "tannery", name: "tannerie", type: "building", maximum: 1,
    cost: { wood: 500, fur: 50 }, buildSeconds: 16, desc: "transforme la fourrure en cuir",
    availableMsg: "elle dit que le cuir serait utile. les villageois pourraient en faire." },
  { id: "smokehouse", name: "fumoir", type: "building", maximum: 1,
    cost: { wood: 600, meat: 50 }, buildSeconds: 16, desc: "fume la viande (viande séchée)",
    availableMsg: "il faudrait fumer la viande avant qu'elle ne pourrisse. elle peut arranger ça." },
  { id: "workshop", name: "atelier", type: "building", maximum: 1,
    cost: { wood: 800, leather: 100, scales: 10 }, buildSeconds: 18, desc: "débloque l'artisanat avancé",
    availableMsg: "elle dit qu'elle ferait de plus belles choses, avec les bons outils." },
  { id: "steelworks", name: "aciérie", type: "building", maximum: 1,
    cost: { wood: 1500, iron: 100, coal: 100 }, buildSeconds: 20, desc: "produit de l'acier",
    availableMsg: "elle dit que les villageois pourraient produire de l'acier, avec l'outillage." },
  { id: "armoury", name: "armurerie", type: "building", maximum: 1,
    cost: { wood: 3000, steel: 100, sulphur: 50 }, buildSeconds: 20, desc: "produit des balles",
    availableMsg: "elle dit qu'une source régulière de balles serait utile." },
];

export const craftableById: Record<string, Craftable> = Object.fromEntries(
  craftables.map((c) => [c.id, c]),
);

/** Durée d'un chantier (secondes) : réglage propre du craftable, sinon le défaut global. */
export function buildSecondsFor(id: string): number {
  return craftableById[id]?.buildSeconds ?? config.construction.defaultSeconds;
}

// --- M3 : MÉTIERS (_INCOME d'A Dark Room). `stores` = production/consommation par
//     période de revenu (config.population.incomeSeconds). `building` = prérequis
//     (null = toujours dispo). Les mineurs (fer/charbon/soufre) viendront avec les
//     sites du monde (M9). ---
export interface Job {
  id: string;
  name: string;
  building: string | null;
  stores: Record<string, number>;
  /**
   * M9 — prérequis SITE : ce métier n'est assignable qu'une fois une mine de ce TYPE
   * (`ironmine`/`coalmine`/`sulphurmine`) SÉCURISÉE (action `SECURE_MINE`). Absent = pas de prérequis site.
   */
  siteType?: string;
}

export const jobs: Job[] = [
  { id: "gatherer", name: "bûcheron", building: null, stores: { wood: 1 } },
  { id: "hunter", name: "chasseur", building: "lodge", stores: { fur: 0.5, meat: 0.5 } },
  { id: "trapper", name: "piégeur", building: "trap", stores: { meat: -1, bait: 1 } },
  { id: "tanner", name: "tanneur", building: "tannery", stores: { fur: -5, leather: 1 } },
  { id: "charcutier", name: "charcutier", building: "smokehouse", stores: { meat: -5, wood: -5, "cured meat": 1 } },
  // Mineurs (M9) : débloqués en sécurisant la mine correspondante (pas de bâtiment requis ; la mine
  // EST le lieu de travail). Consomment de la viande séchée, façon A Dark Room.
  { id: "iron_miner", name: "mineur de fer", building: null, siteType: "ironmine", stores: { "cured meat": -1, iron: 1 } },
  { id: "coal_miner", name: "mineur de charbon", building: null, siteType: "coalmine", stores: { "cured meat": -1, coal: 1 } },
  { id: "sulphur_miner", name: "mineur de soufre", building: null, siteType: "sulphurmine", stores: { "cured meat": -1, sulphur: 1 } },
  { id: "steelworker", name: "sidérurgiste", building: "steelworks", stores: { iron: -1, coal: -1, steel: 1 } },
  { id: "armourer", name: "armurier", building: "armoury", stores: { steel: -1, sulphur: -1, bullets: 1 } },
];

export const jobById: Record<string, Job> = Object.fromEntries(jobs.map((j) => [j.id, j]));

// --- M9 / M10 : OBJETS fabriqués (≠ bâtiments). La torche est avancée ici (M9 P1) car elle GATE
//     l'entrée des grottes ; l'atelier (M10) en sera plus tard la station officielle. Recette = stocks
//     de l'ENTREPÔT ; l'objet va dans le SAC du joueur. `building: null` = fabricable sans bâtiment (v1). ---
export interface CraftableItem {
  id: string;
  name: string;
  type: "good" | "tool" | "weapon";
  building: string | null; // prérequis bâtiment (M10 : "workshop") ; null = aucun (v1)
  recipe: Record<string, number>; // coût en ressources de l'entrepôt
}

export const craftableItems: CraftableItem[] = [
  // ADR : torche = bois + étoffe ; requise pour entrer dans le noir (cf. mines-grottes-*).
  { id: "torch", name: "torche", type: "tool", building: null, recipe: { wood: 1, cloth: 1 } },
];

export const craftableItemById: Record<string, CraftableItem> = Object.fromEntries(craftableItems.map((i) => [i.id, i]));

/** Coût effectif du prochain exemplaire (base + count × incrément). PUR. */
export function craftableCost(c: Craftable, count: number): Record<string, number> {
  const out: Record<string, number> = { ...c.cost };
  if (c.costPerLevel) {
    for (const r of Object.keys(c.costPerLevel)) {
      out[r] = (out[r] ?? 0) + c.costPerLevel[r] * count;
    }
  }
  return out;
}

/**
 * Un bâtiment est-il RÉVÉLÉ dans le menu de la constructrice ? — fidèle à A Dark Room
 * (`room.js:craftUnlocked`) : visible dès qu'on a la **moitié du bois** ET **≥ 1 de chaque autre
 * ingrédient** (« déjà vu »), ou s'il est déjà bâti. Prédicat PUR (sur le coût de base + l'entrepôt).
 * La révélation est « collante » côté appelant ; ici on calcule juste l'état instantané.
 */
export function craftableRevealed(c: Craftable, stored: Record<string, number>, built: number): boolean {
  if (built > 0) return true;
  if ((stored.wood ?? 0) < (c.cost.wood ?? 0) * 0.5) return false; // bois >= 50 % du coût bois
  for (const r of Object.keys(c.cost)) {
    if (r !== "wood" && (stored[r] ?? 0) < 1) return false; // chaque autre ingrédient « vu » (>= 1)
  }
  return true;
}

// Libellés FR des ressources (pour afficher les coûts).
export const RESOURCE_LABELS: Record<string, string> = {
  wood: "bois", fur: "fourrure", meat: "viande", "cured meat": "viande séchée",
  leather: "cuir", scales: "écailles", teeth: "dents", cloth: "étoffe", charm: "charme",
  iron: "fer", coal: "charbon", sulphur: "soufre", steel: "acier", bullets: "balles", bait: "appât",
  "alien alloy": "alliage", "energy cell": "cellule", torch: "torche",
};

// Table de butin des pièges, portée d'A Dark Room (seuils cumulés). Tirage via le RNG
// à graine (déterministe) -> cohérent en P2P. Le 1er seuil dont r < rollUnder gagne.
export const trapDrops: Array<{ rollUnder: number; id: string }> = [
  { rollUnder: 0.5, id: "fur" },
  { rollUnder: 0.75, id: "meat" },
  { rollUnder: 0.85, id: "scales" },
  { rollUnder: 0.93, id: "teeth" },
  { rollUnder: 0.995, id: "cloth" },
  { rollUnder: 1.0, id: "charm" },
];

// ============================================================================
//  M5 — ÉVÉNEMENTS (aléatoires & de gestion), portés du code source d'A Dark Room
//  (doublespeakgames/adarkroom : script/events/{room,outside,global}.js).
//  Modèle : chaque événement est une MINI-MACHINE À ÉTATS (graphe de `scenes`). Les
//  CONDITIONS sont des prédicats purs en lecture seule ; les EFFETS sont DÉCLARATIFS et
//  appliqués par le reducer (déterministe, RNG à graine). Voir docs/m5-plan.md.
//  Sémantique d'un choix (fidèle au moteur d'ADR) : `next` = 'end' ferme l'événement ;
//  une map de poids `{0.5:'a',1:'b'}` tire la scène suivante (plus petit seuil tel que r<seuil) ;
//  ABSENT = on RESTE sur la scène (boutique : on applique coût/récompense et le panneau reste).
//  NB : les magnitudes de gains/pertes sont adaptées à l'économie compressée d'andr (≠ ADR),
//       éditables ici sans toucher au moteur ; la CADENCE, elle, reste fidèle à ADR (config.events).
// ============================================================================

export interface EventEffect {
  /** Delta sur l'entrepôt (borné à 0 : jamais de stock négatif). */
  stores?: Record<string, number>;
  /** Échange proportionnel d'un stock (ex. « -10 % du bois -> écailles », ratio = 5 bois/1). */
  convert?: { from: string; pct: number; to: string; ratio: number; min?: number };
  /** Tue des villageois (tirage RNG borné). C'est ICI que revient la perte de population (M4 -> M5). */
  killVillagers?: { min: number; max: number };
  /** Détruit des bâtiments (tirage RNG borné, plafonné au nombre réellement construit). */
  destroyBuildings?: { id: string; min: number; max: number };
  /** Récompense DIFFÉRÉE et probabiliste (le marchand qui « revient plus tard »). */
  delayedStores?: { chance: number; delaySeconds: number; stores: Record<string, number>; note?: string };
}

export interface EventChoice {
  id: string; // identifiant STABLE : c'est lui qui circule dans l'action RESOLVE_EVENT_CHOICE
  text: string;
  cost?: Record<string, number>; // payé depuis l'ENTREPÔT
  reward?: Record<string, number>; // gain immédiat (entrepôt)
  available?: (g: GameState) => boolean; // lecture seule (sinon : toujours disponible)
  /** 'end' ferme ; absent = reste sur la scène ; map de poids = tirage de la scène suivante. */
  next?: string | Record<number, string>;
}

export interface EventScene {
  text: string[];
  notification?: string; // toast à l'entrée de la scène
  onLoad?: EventEffect; // effet appliqué à l'ENTRÉE de la scène
  choices: EventChoice[];
}

export interface GameEvent {
  id: string;
  title: string;
  isAvailable: (g: GameState) => boolean; // condition de déclenchement (lecture seule, pure)
  scenes: Record<string, EventScene>; // DOIT contenir 'start'
}

const stock = (g: GameState, r: string): number => g.resources[r] ?? 0;
const built = (g: GameState, id: string): number => g.buildings[id] ?? 0;

export const events: GameEvent[] = [
  { // Bruits dehors — cadeau aléatoire
    id: "noises_outside",
    title: "des bruits",
    isAvailable: (g) => stock(g, "wood") > 0,
    scenes: {
      start: {
        text: ["des bruits feutrés passent à travers les murs.", "impossible de dire ce qu'ils trament."],
        notification: "des bruits étranges, dehors.",
        choices: [
          { id: "investigate", text: "aller voir", next: { 0.3: "stuff", 1: "nothing" } },
          { id: "ignore", text: "les ignorer", next: "end" },
        ],
      },
      stuff: {
        text: ["un fagot de bois attend sur le seuil, enveloppé de fourrures grossières."],
        onLoad: { stores: { wood: 30, fur: 6 } },
        choices: [{ id: "back", text: "rentrer", next: "end" }],
      },
      nothing: {
        text: ["des formes vagues s'éloignent.", "le silence revient."],
        choices: [{ id: "back", text: "rentrer", next: "end" }],
      },
    },
  },
  { // Bruits dedans — l'entrepôt grignoté, mais contre mieux
    id: "noises_inside",
    title: "des bruits",
    isAvailable: (g) => stock(g, "wood") > 0,
    scenes: {
      start: {
        text: ["des grattements montent de l'entrepôt.", "quelque chose s'y est glissé."],
        notification: "quelque chose s'agite dans l'entrepôt.",
        choices: [
          { id: "investigate", text: "aller voir", next: { 0.5: "scales", 0.8: "teeth", 1: "cloth" } },
          { id: "ignore", text: "ne rien faire", next: "end" },
        ],
      },
      scales: {
        text: ["un peu de bois a disparu.", "le sol est jonché de petites écailles."],
        onLoad: { convert: { from: "wood", pct: 0.1, to: "scales", ratio: 5, min: 1 } },
        choices: [{ id: "leave", text: "partir", next: "end" }],
      },
      teeth: {
        text: ["un peu de bois a disparu.", "le sol est jonché de petites dents."],
        onLoad: { convert: { from: "wood", pct: 0.1, to: "teeth", ratio: 5, min: 1 } },
        choices: [{ id: "leave", text: "partir", next: "end" }],
      },
      cloth: {
        text: ["un peu de bois a disparu.", "le sol est jonché de bouts d'étoffe."],
        onLoad: { convert: { from: "wood", pct: 0.1, to: "cloth", ratio: 5, min: 1 } },
        choices: [{ id: "leave", text: "partir", next: "end" }],
      },
    },
  },
  { // Le mendiant — fourrure contre mieux
    id: "beggar",
    title: "le mendiant",
    isAvailable: (g) => stock(g, "fur") > 0,
    scenes: {
      start: {
        text: ["un mendiant arrive.", "il demande quelques fourrures pour passer la nuit."],
        notification: "un mendiant arrive.",
        choices: [
          { id: "give10", text: "donner 10 fourrures", cost: { fur: 10 }, next: { 0.5: "scales", 0.8: "teeth", 1: "cloth" } },
          { id: "give20", text: "donner 20 fourrures", cost: { fur: 20 }, next: { 0.5: "teeth", 0.8: "scales", 1: "cloth" } },
          { id: "deny", text: "le renvoyer", next: "end" },
        ],
      },
      scales: { text: ["le mendiant remercie.", "il laisse un tas d'écailles."], onLoad: { stores: { scales: 5 } }, choices: [{ id: "bye", text: "au revoir", next: "end" }] },
      teeth: { text: ["le mendiant remercie.", "il laisse un tas de dents."], onLoad: { stores: { teeth: 5 } }, choices: [{ id: "bye", text: "au revoir", next: "end" }] },
      cloth: { text: ["le mendiant remercie.", "il laisse des bouts d'étoffe."], onLoad: { stores: { cloth: 5 } }, choices: [{ id: "bye", text: "au revoir", next: "end" }] },
    },
  },
  { // Marchand mystérieux — pari sur le bois (retour différé & probabiliste)
    id: "wanderer_wood",
    title: "le marchand mystérieux",
    isAvailable: (g) => stock(g, "wood") > 0,
    scenes: {
      start: {
        text: ["un marchand arrive, charrette vide.", "« confiez-moi du bois et j'en rapporterai plus. »", "rien ne dit qu'on le reverra."],
        notification: "un marchand mystérieux arrive.",
        choices: [
          { id: "give20", text: "confier 20 bois", cost: { wood: 20 }, next: "gave_small" },
          { id: "give50", text: "confier 50 bois", cost: { wood: 50 }, next: "gave_big" },
          { id: "deny", text: "le renvoyer", next: "end" },
        ],
      },
      gave_small: {
        text: ["le marchand s'éloigne, la charrette chargée de bois."],
        onLoad: { delayedStores: { chance: 0.5, delaySeconds: 60, stores: { wood: 60 }, note: "le marchand revient, la charrette pleine de bois." } },
        choices: [{ id: "bye", text: "au revoir", next: "end" }],
      },
      gave_big: {
        text: ["le marchand s'éloigne, la charrette chargée de bois."],
        onLoad: { delayedStores: { chance: 0.3, delaySeconds: 60, stores: { wood: 150 }, note: "le marchand revient, la charrette pleine de bois." } },
        choices: [{ id: "bye", text: "au revoir", next: "end" }],
      },
    },
  },
  { // Marchand mystérieux — pari sur la fourrure
    id: "wanderer_fur",
    title: "le marchand mystérieux",
    isAvailable: (g) => stock(g, "fur") > 0,
    scenes: {
      start: {
        text: ["une marchande arrive, charrette vide.", "« confiez-moi des fourrures et j'en rapporterai plus. »", "rien ne dit qu'on la reverra."],
        notification: "une marchande mystérieuse arrive.",
        choices: [
          { id: "give20", text: "confier 20 fourrures", cost: { fur: 20 }, next: "gave_small" },
          { id: "give50", text: "confier 50 fourrures", cost: { fur: 50 }, next: "gave_big" },
          { id: "deny", text: "la renvoyer", next: "end" },
        ],
      },
      gave_small: { text: ["la marchande s'éloigne, la charrette chargée de fourrures."], onLoad: { delayedStores: { chance: 0.5, delaySeconds: 60, stores: { fur: 60 }, note: "la marchande revient, la charrette pleine de fourrures." } }, choices: [{ id: "bye", text: "au revoir", next: "end" }] },
      gave_big: { text: ["la marchande s'éloigne, la charrette chargée de fourrures."], onLoad: { delayedStores: { chance: 0.3, delaySeconds: 60, stores: { fur: 150 }, note: "la marchande revient, la charrette pleine de fourrures." } }, choices: [{ id: "bye", text: "au revoir", next: "end" }] },
    },
  },
  { // Pièges saccagés — perte de bâtiment + traque (butin ou rien)
    id: "ruined_trap",
    title: "des pièges saccagés",
    isAvailable: (g) => built(g, "trap") > 0,
    scenes: {
      start: {
        text: ["des pièges ont été mis en pièces.", "de larges empreintes s'enfoncent dans la forêt."],
        notification: "des pièges ont été détruits.",
        onLoad: { destroyBuildings: { id: "trap", min: 1, max: 3 } },
        choices: [
          { id: "track", text: "les pister", next: { 0.5: "nothing", 1: "catch" } },
          { id: "ignore", text: "laisser tomber", next: "end" },
        ],
      },
      nothing: { text: ["les traces se perdent après quelques minutes.", "la forêt est silencieuse."], choices: [{ id: "back", text: "rentrer", next: "end" }] },
      catch: { text: ["une grosse bête gît non loin du village, le pelage poisseux de sang.", "elle ne résiste pas longtemps."], onLoad: { stores: { fur: 30, meat: 30, teeth: 3 } }, choices: [{ id: "back", text: "rentrer", next: "end" }] },
    },
  },
  { // Incendie de hutte — perte de hutte + morts (réintroduit la mort de villageois)
    id: "hut_fire",
    title: "un incendie",
    isAvailable: (g) => built(g, "hut") > 0 && g.population >= 8,
    scenes: {
      start: {
        text: ["un incendie ravage l'une des huttes et la réduit en cendres.", "ceux qui s'y trouvaient n'en sont pas sortis."],
        notification: "un incendie a éclaté.",
        onLoad: { destroyBuildings: { id: "hut", min: 1, max: 1 }, killVillagers: { min: 1, max: 4 } },
        choices: [{ id: "mourn", text: "pleurer les morts", next: "end" }],
      },
    },
  },
  { // Attaque de bêtes — l'événement-phare M5 (morts + butin)
    id: "beast_attack",
    title: "une attaque de bêtes",
    isAvailable: (g) => g.population > 0,
    scenes: {
      start: {
        text: [
          "une meute de bêtes hargneuses jaillit des arbres.",
          "le combat est bref et sanglant ; les bêtes sont repoussées.",
          "les villageois se retirent pour pleurer les morts.",
        ],
        notification: "des bêtes sauvages attaquent le village.",
        onLoad: { killVillagers: { min: 1, max: 5 }, stores: { fur: 30, meat: 30, teeth: 3 } },
        choices: [{ id: "mourn", text: "rentrer", next: "end" }],
      },
    },
  },
  { // Le nomade — boutique (le panneau reste) ; boussole retirée (la carte arrive en M7)
    id: "nomad",
    title: "le nomade",
    isAvailable: (g) => stock(g, "fur") > 0,
    scenes: {
      start: {
        text: ["un nomade entre dans le camp, chargé de sacs ficelés.", "il ne dira pas d'où il vient, mais il ne reste pas."],
        notification: "un nomade s'arrête pour troquer.",
        choices: [
          { id: "buyScales", text: "acheter des écailles", cost: { fur: 20 }, reward: { scales: 1 } },
          { id: "buyTeeth", text: "acheter des dents", cost: { fur: 40 }, reward: { teeth: 1 } },
          { id: "buyBait", text: "acheter de l'appât", cost: { fur: 5 }, reward: { bait: 1 } },
          { id: "goodbye", text: "le saluer", next: "end" },
        ],
      },
    },
  },
];

export const eventById: Record<string, GameEvent> = Object.fromEntries(events.map((e) => [e.id, e]));

// ============================================================================
//  M7 — GÉNÉRATION DU MONDE (le monde autour du campement).
//  Données PURES (aucune dépendance Babylon). L'ALGORITHME vit dans
//  src/sim/worldgen.ts ; ICI uniquement les « boutons » de réglage + les tables
//  (biomes, essences d'arbres, sites). Voir docs/generation-monde.md & docs/plan-monde.md.
// ============================================================================

/** Biomes : indices STABLES (sérialisables, indexent `biomes`). `camp` = centre forcé. */
export const Biome = { Camp: 0, Forest: 1, Field: 2, Barren: 3, Swamp: 4 } as const;
export type BiomeId = (typeof Biome)[keyof typeof Biome];

/** Tous les « boutons » de la génération. `seed` = graine du MONDE (≠ rngSeed gameplay). */
export const worldgen = {
  seed: 1337, // graine de la carte (disposition) — distincte de la graine de gameplay
  radiusCells: 64, // rayon de la grille -> (2R+1)² cellules (129×129)
  cellSize: 12, // unités-monde par cellule -> monde ≈ 1536 u de côté
  chunkCells: 4, // un chunk de rendu = bloc de 4×4 cellules (48 u) — moins de draw calls
  safeRadiusCells: 3, // retranchement central (zone sûre, M6) -> biome `camp`
  loadRadiusChunks: 2, // streaming (render) : chunks chargés autour du joueur
  unloadRadiusChunks: 3, // hystérésis : déchargés au-delà (anti-clignotement)
  stickiness: 0.5, // VISCOSITÉ (blobbiness des biomes) — le bouton d'A Dark Room
  baseBiomeWeights: { forest: 0.15, field: 0.35, barren: 0.5 }, // probas de base d'ADR
  standCells: 6, // taille d'un PEUPLEMENT (bloc de cellules, ~72 u > portée de vue) -> ensembles lisibles (sapinière, boulaie…)
  // Relief par bruit fBm — RÉSERVÉ au rendu (Phase 2). terrainHeight() reste global en v1.
  relief: { octaves: 4, baseFrequency: 0.015, amplitude: 10, lacunarity: 2, gain: 0.5 }, // amplitude = hauteur des collines (zones vallonnées)
} as const;

// === BORDURES DU MONDE (Chantier C — B) ====================================================
// Le monde est un grand CARRÉ. Sur ses 4 côtés, exactement 2 « fausses montagnes » (mur qui
// monte) et 2 « faux océans » (terrain qui plonge sous l'eau), répartis ALÉATOIREMENT par la
// graine (parfois opposés, parfois adjacents). La bordure commence AU-DELÀ de la zone jouable
// (l'intérieur reste plat/praticable) ; le joueur est confiné en deçà (cf. render/player.ts).
// Placé APRÈS `worldgen` (dont WR dépend) ; `terrainHeight()` plus haut y accède via le hoisting.
const WR = worldgen.radiusCells * worldgen.cellSize; // bord de la zone jouable (unités) = 768
export const BORDER_START = WR; // la bordure commence ICI, AU-DELÀ de la zone jouable
export const BORDER_BAND = 180; // largeur (u) de la bande de bordure (montée/descente)
export const SEA_LEVEL = -3; // niveau de l'eau du faux océan (sous le sol jouable)
export const PLAY_HALF = WR - 8; // limite de confinement du joueur (juste avant la bordure)
const MOUNTAIN_H = 95; // hauteur du mur de montagne au bord
const OCEAN_DEPTH = 30; // profondeur de descente du faux océan

export type BorderSide = "mountain" | "ocean";
export interface BorderSides { e: BorderSide; w: BorderSide; n: BorderSide; s: BorderSide; }
// Par défaut : ceinture de montagnes (sûr tant que `configureBorders` n'a pas tourné).
let borderSides: BorderSides = { e: "mountain", w: "mountain", n: "mountain", s: "mountain" };
// Les 6 sous-ensembles possibles de 2 côtés (océan) parmi 4 -> couvre opposés ET adjacents.
const OCEAN_PAIRS: Array<[keyof BorderSides, keyof BorderSides]> = [
  ["e", "w"], ["e", "n"], ["e", "s"], ["w", "n"], ["w", "s"], ["n", "s"],
];

/** Tire DÉTERMINISTE 2 côtés « océan » (parmi 6 paires) depuis la graine ; les 2 autres = montagnes.
 *  À appeler à chaque (re)génération du monde AVANT de bâtir le terrain (cf. main.ts). */
export function configureBorders(seed: number): void {
  const k = (Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0) % 6;
  const [a, b] = OCEAN_PAIRS[k];
  borderSides = { e: "mountain", w: "mountain", n: "mountain", s: "mountain" };
  borderSides[a] = "ocean";
  borderSides[b] = "ocean";
}
/** Répartition courante des bordures (pour le rendu / debug). */
export function getBorderSides(): BorderSides {
  return borderSides;
}

const smooth01 = (t: number): number => { const x = t < 0 ? 0 : t > 1 ? 1 : t; return x * x * (3 - 2 * x); };

// Champ de bordure : monte (montagne) ou descend (océan) AU-DELÀ de la zone jouable, par côté,
// avec mélange doux aux coins (somme pondérée par la pénétration -> cap/promontoire naturel).
// Renvoie 0 partout DANS la zone jouable (intérieur plat préservé).
function borderField(x: number, z: number): number {
  const P = BORDER_START, B = BORDER_BAND;
  const peE = (x - P) / B, peW = (-x - P) / B, peN = (z - P) / B, peS = (-z - P) / B; // pénétration par côté
  const tE = peE > 0 ? peE : 0, tW = peW > 0 ? peW : 0, tN = peN > 0 ? peN : 0, tS = peS > 0 ? peS : 0;
  const wSum = tE + tW + tN + tS;
  if (wSum < 1e-4) return 0; // entièrement dans la zone jouable -> plat
  const mtn = MOUNTAIN_H * clampN(0.8 + Math.sin(x * 0.04) * 0.3 + Math.sin(z * 0.055) * 0.2, 0.55, 1.3); // crête irrégulière
  const c = (t: number, side: BorderSide): number => (t <= 0 ? 0 : (side === "ocean" ? -OCEAN_DEPTH : mtn) * smooth01(t));
  const sum = tE * c(tE, borderSides.e) + tW * c(tW, borderSides.w) + tN * c(tN, borderSides.n) + tS * c(tS, borderSides.s);
  return sum / wSum;
}

export interface BiomeDef {
  id: BiomeId;
  key: "camp" | "forest" | "field" | "barren" | "swamp";
  label: string;
  /** Multiplie l'amplitude du relief (appliqué au rendu, plus tard). */
  reliefMul: number;
  /** Densité de props PAR CELLULE, par type (consommée par scatterCell + le rendu). */
  scatter: Record<string, number>;
}

// Densités de scatter par biome (cf. docs/modeles-3d.md §3.4). Le `camp` ne disperse rien
// (il gère son propre décor : feu, cabane, village, forêt écrite à la main).
export const biomes: BiomeDef[] = [
  { id: Biome.Camp, key: "camp", label: "campement", reliefMul: 0.3, scatter: {} },
  { id: Biome.Forest, key: "forest", label: "forêt", reliefMul: 1.0,
    scatter: { tree: 12, fern: 4, mushroom: 1.5, bush: 1, log: 0.4, stump: 0.4, rock: 0.6, grass: 5 } },
  { id: Biome.Field, key: "field", label: "prairie", reliefMul: 0.6,
    scatter: { grass: 18, flower: 5, bush: 1, tree: 0.6, rock: 0.4 } },
  { id: Biome.Barren, key: "barren", label: "lande", reliefMul: 1.3,
    scatter: { rock: 3, drybush: 2, tree: 0.5, bones: 0.25, grass: 1 } },
  // Marais (région, ≠ point) : roseaux + fougères + champignons + cyprès/arbres morts épars.
  { id: Biome.Swamp, key: "swamp", label: "marais", reliefMul: 0.35,
    scatter: { reed: 10, fern: 3, mushroom: 2, grass: 2, drybush: 1, tree: 1.2 } },
];
export const biomeById: Record<number, BiomeDef> = Object.fromEntries(biomes.map((b) => [b.id, b]));

// Essences d'arbres (kind 'tree' du scatter). `id` = mesh du labo (docs/modeles-3d.md §2.4).
// `biomes` = où l'essence apparaît ; `weight` = poids de tirage dans ce biome.
export interface TreeSpecies {
  id: string;
  type: string;
  biomes: Array<BiomeDef["key"]>;
  weight: number; // poids dans le MÉLANGE (essences non dominantes)
  minScale: number;
  maxScale: number;
  /** Peut être l'essence DOMINANTE d'un peuplement ? (défaut oui ; faux = accent dispersé). */
  canDominate?: boolean;
}
export const treeSpecies: TreeSpecies[] = [
  { id: "petit-arbre", type: "petit", biomes: ["forest"], weight: 2, minScale: 0.7, maxScale: 1.0 },
  { id: "sapin", type: "pine", biomes: ["forest"], weight: 3, minScale: 0.9, maxScale: 1.3 },
  { id: "chene", type: "oak", biomes: ["forest", "field"], weight: 3, minScale: 0.9, maxScale: 1.2 },
  { id: "bouleau", type: "birch", biomes: ["forest"], weight: 2, minScale: 0.9, maxScale: 1.2 },
  { id: "automne", type: "autumn", biomes: ["forest"], weight: 2, minScale: 0.9, maxScale: 1.2 },
  { id: "cypres", type: "cypress", biomes: ["forest", "barren", "swamp"], weight: 2, minScale: 0.9, maxScale: 1.3 },
  { id: "arbre-mort", type: "dead", biomes: ["forest", "barren", "swamp"], weight: 1, minScale: 0.8, maxScale: 1.2, canDominate: false },
];

// Sites / points d'intérêt par ANNEAUX de distance (rayons en cellules ; cf. ADR minRadius/maxRadius).
// count = nb d'exemplaires ; min == max => anneau ponctuel (ex. la mine de fer d'ADR à r=5).
export interface SiteDef {
  id: string;
  label: string;
  count: number;
  minRadiusCells: number;
  maxRadiusCells: number;
}
// Variété & nombre calqués sur A Dark Room, scalés à notre grille (rayon 64) — cf. docs/routes-sites.md.
// La cité est le type le plus nombreux (gros donjon, alliage) ; borehole/battlefield = butin lointain.
export const sites: SiteDef[] = [
  { id: "cave", label: "grotte", count: 6, minRadiusCells: 4, maxRadiusCells: 16 },
  { id: "house", label: "vieille maison", count: 14, minRadiusCells: 5, maxRadiusCells: 50 },
  { id: "town", label: "ville", count: 8, minRadiusCells: 12, maxRadiusCells: 38 },
  { id: "city", label: "cité", count: 10, minRadiusCells: 26, maxRadiusCells: 60 }, // gros donjon lointain (alliage/laser)
  { id: "ironmine", label: "mine de fer", count: 1, minRadiusCells: 5, maxRadiusCells: 5 },
  { id: "coalmine", label: "mine de charbon", count: 1, minRadiusCells: 10, maxRadiusCells: 10 },
  { id: "sulphurmine", label: "mine de soufre", count: 1, minRadiusCells: 20, maxRadiusCells: 20 },
  { id: "borehole", label: "forage", count: 8, minRadiusCells: 18, maxRadiusCells: 58 }, // alliage extraterrestre
  { id: "battlefield", label: "champ de bataille", count: 4, minRadiusCells: 24, maxRadiusCells: 58 }, // armes lourdes
  { id: "swamp", label: "marais", count: 1, minRadiusCells: 12, maxRadiusCells: 24 }, // posé AU CŒUR de la région de marais (cf. worldgen)
  { id: "cache", label: "village détruit", count: 1, minRadiusCells: 16, maxRadiusCells: 52 }, // prestige (run précédente)
  { id: "ship", label: "épave", count: 1, minRadiusCells: 56, maxRadiusCells: 60 },
  { id: "executioner", label: "cuirassé", count: 1, minRadiusCells: 56, maxRadiusCells: 60 },
];
