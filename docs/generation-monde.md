# Génération procédurale du monde — spec (sous-lot technique de M7)

> ⚠️ **MAJ juin 2026 (Chantier C — A & B) : implémenté, avec écarts ASSUMÉS vs cette spec.**
> - **Biomes** : la « viscosité » par voisins est **remplacée** par du **bruit de valeur multi-octaves +
>   domain warping** → grandes régions organiques (fini le moucheté). Le **marais est une vraie RÉGION** (≠ point).
> - **Bordures** : monde **CARRÉ** (clip de chunks par axe), **2 fausses montagnes + 2 faux océans** tirés par
>   graine, **au-delà** de la zone jouable, + **confinement** joueur (anti-fuite/anti-chute).
> - Reste valable : sites en **anneaux**, déterminisme par graine, streaming/fog. Détail :
>   [`refonte-monde-campement.md`](refonte-monde-campement.md) §A/B ; sites/routes : [`routes-sites.md`](routes-sites.md).

> **Où ça vit.** C'est le **vrai sujet d'archi** signalé par la roadmap pour
> [**M7 — Les terres sauvages**](roadmap.md#-m7--les-terres-sauvages--monde-continu--survie--l).
> Ça s'appuie sur [**M6**](roadmap.md#-m6--le-rempart-la-porte--le-ravitaillement--sm) (porte, `inSafeZone`,
> ravitaillement) et ça **alimente** [**M8**](roadmap.md) (combat tiéré par distance) et
> [**M9**](roadmap.md) (sites/setpieces explorables). Lire avant : [`architecture.md`](architecture.md)
> (la stratification cerveau/corps est **non négociable**) et la décision actée du
> [**monde unifié à anneaux concentriques**](roadmap.md#24-topologie--un-monde-unifié-décision-actée-) (§2.4).

> **Statut.** Proposition de conception. Rien n'est encore codé. À valider, puis à implémenter
> **dans l'ordre habituel** : `data/` → `sim/ (+ tests)` → `render/`/`ui/` → `net/`.

---

## 0. L'idée en une phrase

On reprend **tel quel le « cerveau »** d'A Dark Room (grille + viscosité + anneaux de distance),
piloté par notre **RNG à graine**, et on ne réinvente que la **couche d'affichage** (tuiles de
biome + relief par bruit + dispersion instanciée + **streaming par chunks** masqué par le
brouillard). Résultat : une génération riche, **déterministe** (donc P2P sans transfert de carte —
les pairs n'échangent **qu'une graine**) et **performante** sur un grand monde.

```
        LOGIQUE (sim/ + data/, pure, déterministe, testable)        RÉALISATION 3D (render/, Babylon)
        ─────────────────────────────────────────────────          ──────────────────────────────────
        graine ──► generateWorld(seed)                              chunks chargés autour du joueur
                     │  grille de biomes (viscosité ADR)    ───►    sol déformé + couleurs de biome
                     │  sites par anneaux de distance        ───►   silhouettes de sites (épave, tour…)
                     └─ scatterCell() : props par cellule    ───►   arbres/rochers/herbes INSTANCIÉS
        terrainHeight(x,z) : relief par bruit fBm            ───►   maillage du sol + détection au sol
                                                                    + brouillard de découverte (fog of war)
```

Cette séparation **mime exactement** le pattern déjà en place dans le projet : une **couche
logique pas chère et déterministe** (cf. `terrainHeight()`, la liste `trees[]`) + une **réalisation
3D à la demande** (le maillage du sol, les instances d'arbres). On ne fait que **généraliser** ce
qu'on a déjà.

---

## 1. Rappel : l'algorithme d'A Dark Room (le « cerveau »)

Trois idées simples (pas de Perlin, pas de maths compliquées) :

1. **Grille carrée, centre, remplissage en spirale.** Tableau 2D `61×61` (`RADIUS 30`), village au
   centre, rempli **anneau carré par anneau carré** du centre vers l'extérieur. Avantage : chaque
   nouvelle case a déjà des **voisines décidées** côté intérieur → ça permet l'astuce suivante.
2. **La viscosité (`STICKINESS 0.5`) — le cœur malin.** Pour choisir le type d'une case, on regarde
   ses 4 voisines déjà placées. Probas de base : **landes 50 % / champs 35 % / forêt 15 %**. Chaque
   voisine déjà posée **tire** la case vers son propre biome (ajoute un poids fixe). Résultat :
   **taches contiguës** au lieu d'un bruit de pixels. À 0 → bruit pur ; proche de 1 → immenses
   régions homogènes. Règle spéciale : toute case touchant le village devient **forêt**.
3. **Points d'intérêt par anneaux de distance.** Chaque type de site a un **nombre** d'exemplaires et
   une **fourchette de rayon** `[min, max]`. Pour chacun : tire une distance + une direction, et
   recommence tant qu'on ne tombe pas sur une case de terrain libre. C'est ce qui crée le gradient
   **« centre sûr → frontière mortelle »** (mines proches, épave/marais lointains), qui pilote aussi
   la difficulté des combats.

> ADR utilise `Math.random()` (carte différente à chaque partie). **Nous, on remplace ça par le RNG
> à graine** ([`sim/rng.ts`](../src/sim/rng.ts)) → carte **reproductible** et **partageable par une
> seule graine**. C'est la clé du portage P2P (cf. [`architecture.md §5-6`](architecture.md)).

---

## 2. Adaptation 3D — décisions de conception

### 2.1 Le modèle : une grille de cellules bornée, centrée sur le camp

Conforme à la décision actée (monde unifié, retranchement central, difficulté croissante avec la
distance). Le monde est une **grille carrée bornée** ; le brouillard borne le rendu (pas besoin
d'infini).

- `radiusCells` (ex. **64**) → grille `(2R+1)² = 129×129 ≈ 16 600 cellules`.
- `cellSize` (ex. **12 unités**) → monde **≈ 1 536 u de côté** (vs **50** aujourd'hui — l'agrandissement
  que la roadmap exige).
- Cellule `(0,0)` au centre = le **retranchement**. Les cellules à `distance < safeRadiusCells` sont la
  **zone sûre** (= le `inSafeZone` de M6 : survie gelée, recharge, pas de danger).

**Coût mémoire de la grille logique : ~16 Ko** (`Uint8Array`, 1 octet/cellule). Négligeable. On la
génère **en entier, une fois** (la viscosité d'ADR est séquentielle — remplissage en spirale — donc
non parallélisable en `biomeAt(x,z)` pur ; mais 16 Ko, on s'en fiche). En revanche, on **ne rend pas**
toute la grille en 3D : on **streame** par chunks (§3). C'est le bon découpage :

> **Grille de biomes = ÉAGER** (logique, minuscule, viscosité fidèle ADR).
> **Réalisation 3D = LAZY** (streaming par chunks, lourd, autour du joueur seulement).

### 2.2 Distance euclidienne (pas Manhattan)

En 3D fluide, les anneaux de difficulté/sites paraissent plus naturels en **distance euclidienne**
qu'en losange de Manhattan. On garde le gradient « centre sûr → bords dangereux ».

### 2.3 Relief par bruit (on fait évoluer `terrainHeight`)

Aujourd'hui `terrainHeight(x,z)` est une somme de sinus (pur, déterministe, sert **à la fois** au
maillage du sol **et** à la détection au sol analytique). On **garde ce contrat** (fonction pure,
échantillonnable partout) mais on l'enrichit en **bruit de valeur fBm à graine** (plusieurs octaves)
→ collines douces, plus variées, **qui changent avec la graine**. Le biome **module l'amplitude**
(champs plats, landes vallonnées). C'est ce qui « donne du travail à la gravité » (monter/descendre)
sans casser la décision « détection au sol analytique » ([README, « Choix faits »](../README.md)).

### 2.4 Dispersion des props (lazy, déterministe, instanciée)

À l'intérieur de chaque cellule, on **disperse** arbres/rochers/herbes via un **RNG local semé par
`hash(cx, cz, worldSeed)`** : position perturbée, rotation et échelle aléatoires, **densité selon le
biome** (forêt → beaucoup d'arbres ; champ → herbes ; landes → rares rochers). Comme c'est un hash
pur :

- **identique pour tous les pairs** et **stable au rechargement** (déterminisme P2P gratuit) ;
- **calculable à la demande, chunk par chunk** (pas de stockage des props lointains).

C'est la généralisation directe du `trees[]` écrit à la main aujourd'hui (qui devient « la forêt du
camp »). On **instancie** ces meshes (thin instances / `createInstance`) → peu de draw calls, comme
déjà fait pour les arbres ([README §8](../README.md)).

### 2.5 Sites par anneaux (silhouettes en M7, setpieces en M9)

Chaque type de site : `{ count, minRadiusCells, maxRadiusCells }`. Placement déterministe via le
RNG de génération (tire distance ∈ [min,max] + angle, cherche une cellule de terrain libre). En **M7**
ce sont des **silhouettes repérables de loin** (épave, tour en ruine, marais) vers lesquelles on
marche ; **M9** les transforme en **rencontres scriptées explorables**. La **distance pilote la
difficulté** (M8).

---

## 3. La couche 3D : streaming par chunks (le vrai sujet de perf)

On **ne peut pas** afficher 129×129 cellules pleines d'arbres. Donc :

- **Chunk = 1 cellule** (ou un petit bloc de cellules — à mesurer). Un chunk porte : un **patch de sol**
  (déformé par `terrainHeight`, couleurs de vertex selon le biome, **frontières fondues**) + les **props
  instanciés** de ses cellules (issus de `scatterCell`).
- **Chargement/déchargement** : on n'instancie que les chunks dans `loadRadius` autour du joueur ; on
  **dispose** ceux au-delà de `unloadRadius` (**hystérésis** pour éviter le clignotement à la frontière).
- **Le brouillard masque la frontière de chargement** — exactement le double rôle du brouillard d'ADR
  (ambiance **et** perf). Le `fog exp2` est **déjà en place** ([`scene.ts`](../src/render/scene.ts)).
- **LOD** : chunks proches = pleine densité ; chunks lointains = densité réduite / billboards / petits
  props sautés. Les **thin instances** de Babylon rendent ça peu coûteux.
- **Frontières de biomes fondues** : on échantillonne le biome aux coins de la cellule, on **mélange**
  les couleurs de vertex et la dispersion à la lisière → le monde n'a pas l'air quadrillé (roadmap :
  « fondre les frontières de biomes »).

### Brouillard de découverte (fog of war) — distinct du brouillard de rendu

Suivre les cellules **explorées** (révélation dans un rayon autour du joueur). Deux options :

| Option | Description | Reco |
|---|---|---|
| **(a) Mini-carte qui se remplit** | HUD : une carte 2D de la grille de biomes qui se dévoile | **Recommandé** d'abord — simple, lisible, P2P trivial (chaque pair la dérive de la graine + son set de cellules vues) |
| (b) Obscurité/brouillard 3D | un voile littéral qui se lève à mesure qu'on avance | plus immersif, plus coûteux ; possible en M12/polish |

Les cellules vues sont **locales au joueur** (comme la forêt/la physique). Si on veut une carte
**partagée** entre coéquipiers, on en fait un champ d'état (bitset) — à décider en M7.

---

## 4. Multijoueur : seule la graine voyage

C'est l'extension directe du modèle hôte‑autoritaire ([`architecture.md §6`](architecture.md)) :

| Donnée | Origine | Voyage sur le réseau ? |
|---|---|---|
| **Disposition du monde** (biomes, relief, props, position des sites) | **dérivée de `worldSeed`** | **NON** — chaque pair appelle `generateWorld(worldSeed)` et obtient la **carte identique** |
| `worldSeed` | fixé à la création (ou par le code de salon) | **OUI**, une fois, dans le **snapshot initial** |
| **État de jeu des sites** (`siteCleared`, butin pris…) | gameplay → autoritaire (hôte) | **OUI**, dans le snapshot (s'enrichit comme prévu) |
| Survie (`water`, `food`), cellules explorées, transforms, animations | par joueur, local | transforms : oui (déjà) ; survie/exploration : local |

> Règle généralisée déjà énoncée par la roadmap (§2.2) : **« les positions/animations sont locales, la
> gestion est autoritaire »**. La carte est une **fonction pure de la graine** → P2P sans transfert de
> carte. Exactement le « les pairs n'échangent qu'un seul nombre ».

**À ajouter à l'état** : un `worldSeed: number` dans `GameState` (séparé de `rng` !). On utilise une
**instance RNG dédiée** pour la génération (`createRng(worldSeed)`), **distincte de `state.rng`** (qui
est consommé par le gameplay : pièges, événements…). Sinon la carte « bougerait » au fil des tirages de
jeu. La carte doit être **stable** ; le gameplay, **avançant**.

---

## 5. Format des données (prêt à coder)

### 5.1 `data/world.ts` — nouveaux blocs (source de vérité, éditable sans toucher au moteur)

```ts
// --- M7 : génération du monde (tous les "boutons" de réglage) ---
export const worldgen = {
  radiusCells: 64,          // rayon de la grille -> 129×129 cellules
  cellSize: 12,             // unités-monde par cellule -> monde ≈ 1536 u
  safeRadiusCells: 3,       // le retranchement central = zone sûre (M6 : inSafeZone)
  stickiness: 0.5,          // VISCOSITÉ (blobbiness) — le bouton ADR. 0 = bruit, ~1 = grandes régions
  baseBiomeWeights: {       // probas de base d'ADR (landes/champs/forêt)
    barren: 0.5, field: 0.35, forest: 0.15,
  },
  relief: {                 // bruit fBm pour terrainHeight (collines douces)
    octaves: 4, baseFrequency: 0.015, amplitude: 6, lacunarity: 2, gain: 0.5,
  },
  scatter: {                // densité de props par biome (props/cellule, modulée par bruit)
    forest: { tree: 14, rock: 1, grass: 8 },
    field:  { tree: 1,  rock: 1, grass: 20 },
    barren: { tree: 0,  rock: 3, grass: 2 },
  },
} as const;

export interface BiomeDef {
  id: string; label: string;
  colorLow: string; colorHigh: string;  // dégradé de vertex color (cohérent PALETTE)
  reliefMul: number;                     // multiplie l'amplitude du relief (champ plat, landes vallonnées)
}
export const biomes: BiomeDef[] = [ /* barren, field, forest, + camp (centre forcé) */ ];

// Sites par anneaux de distance (rayons en cellules). count = nb d'exemplaires.
// minRadius == maxRadius => anneau ponctuel (ex. la mine de fer d'ADR à r=5).
export interface SiteDef { id: string; label: string; count: number; minRadiusCells: number; maxRadiusCells: number; }
export const sites: SiteDef[] = [
  { id: "cave",        label: "grotte",       count: 4, minRadiusCells: 4,  maxRadiusCells: 12 },
  { id: "house",       label: "vieille maison",count: 5, minRadiusCells: 4, maxRadiusCells: 18 },
  { id: "town",        label: "ville",        count: 2, minRadiusCells: 10, maxRadiusCells: 30 },
  { id: "ironmine",    label: "mine de fer",  count: 1, minRadiusCells: 5,  maxRadiusCells: 5  },
  { id: "coalmine",    label: "mine de charbon",count: 1, minRadiusCells: 10, maxRadiusCells: 10 },
  { id: "sulphurmine", label: "mine de soufre",count: 1, minRadiusCells: 20, maxRadiusCells: 20 },
  { id: "swamp",       label: "marais",       count: 1, minRadiusCells: 40, maxRadiusCells: 55 },
  { id: "ship",        label: "épave",        count: 1, minRadiusCells: 56, maxRadiusCells: 60 },
  { id: "executioner", label: "cuirassé",     count: 1, minRadiusCells: 56, maxRadiusCells: 60 },
];
```

### 5.2 `src/sim/worldgen.ts` — PUR (aucun import Babylon/DOM), testable au terminal

```ts
export type Biome = number; // 0 barren, 1 field, 2 forest, 3 camp (indexe biomes[])
export interface Site { type: string; cx: number; cz: number; }

export interface WorldMap {
  seed: number;
  radiusCells: number;
  biomes: Uint8Array;                 // (2R+1)², indexée par idx(cx,cz)
  sites: Site[];
  biomeAt(cx: number, cz: number): Biome;
  worldToCell(x: number, z: number): { cx: number; cz: number };
  cellToWorldCenter(cx: number, cz: number): { x: number; z: number };
}

/** Génération complète, déterministe. Même graine ⇒ carte identique partout. */
export function generateWorld(seed: number): WorldMap;

/** Props d'une cellule, dispersés de façon déterministe (lazy, par chunk). */
export interface ScatterProp { kind: string; x: number; z: number; rotY: number; scale: number; }
export function scatterCell(cx: number, cz: number, biome: Biome, seed: number): ScatterProp[];
```

### 5.3 Le cœur — `chooseBiome` (viscosité ADR, paramétré proprement)

```ts
// Remplissage EN SPIRALE du centre vers l'extérieur : chaque cellule voit ses voisines
// DÉJÀ décidées côté intérieur (c'est ce qui fait fonctionner la viscosité).
function chooseBiome(neighbors: Biome[], rng: RngState): Biome {
  // 1) poids de base (landes/champs/forêt d'ADR)
  const w = { ...worldgen.baseBiomeWeights };  // { barren, field, forest }
  // 2) chaque voisine déjà posée TIRE la cellule vers son biome (la viscosité)
  for (const n of neighbors) {
    if (n === CAMP) return FOREST;              // règle ADR : le camp est niché dans les bois
    w[biomeName(n)] += worldgen.stickiness;     // ajoute un poids fixe -> taches contiguës
  }
  // 3) tirage pondéré normalisé (ajouter à un biome réduit d'autant la part des autres)
  return weightedPick(w, rng);                  // rng = RNG DÉDIÉ à la génération (pas state.rng)
}
```

> `weightedPick` normalise les poids puis tire via `nextFloat(rng)`. **Aucun `Math.random()`** —
> tout passe par le RNG à graine (règle d'or, [`architecture.md §13`](architecture.md)).

### 5.4 Sites par anneaux (Euclidien)

```ts
function placeSites(map, rng): Site[] {
  const out = [];
  for (const def of sites) {
    for (let k = 0; k < def.count; k++) {
      let placed = false, tries = 0;
      while (!placed && tries++ < 100) {
        const r = lerp(def.minRadiusCells, def.maxRadiusCells, nextFloat(rng));
        const a = nextFloat(rng) * 2 * Math.PI;
        const cx = Math.round(Math.cos(a) * r), cz = Math.round(Math.sin(a) * r);
        if (inBounds(cx, cz) && isLandFree(map, cx, cz)) {       // pas le camp, pas déjà pris
          out.push({ type: def.id, cx, cz }); placed = true;
        }
      }
    }
  }
  return out;
}
```

---

## 6. Réalisation 3D — nouveaux modules `render/` (cohérent avec l'existant)

| Module proposé | Rôle | S'inspire de |
|---|---|---|
| `src/render/terrain.ts` | **streaming par chunks** : charge/décharge les patchs de sol autour du joueur, déforme via `terrainHeight`, peint les biomes, fond les frontières, LOD | remplace `createGround` de [`world.ts`](../src/render/world.ts) pour le **dehors** ; le camp garde son sol actuel |
| `src/render/scatter.ts` | instancie les props d'un chunk (`scatterCell`) — arbres/rochers/herbes en **thin instances**, colliders statiques au besoin | [`forest.ts`](../src/render/forest.ts) (instances + collider statique par arbre) |
| `src/render/sites.ts` | silhouettes low-poly des sites aux positions de `map.sites` ; déclenche l'entrée (M9) à l'approche | [`buildings.ts`](../src/render/buildings.ts) (placement déterministe) |
| `src/ui/minimap.ts` | mini-carte (fog of war) qui se remplit | HUD existant ([`hud.ts`](../src/ui/hud.ts)) |

Le **camp actuel reste** (feu, cabane, village, forêt écrite à la main) : il occupe les cellules
centrales (`distance < safeRadiusCells`, biome `camp`/forêt). Le **monde généré commence au-delà** ;
la **porte de M6** est le seuil. **Aucune régression** sur M0–M5.

---

## 7. Déterminisme & tests (le filet de sécurité, façon « 35 tests »)

`worldgen.ts` étant **pur**, il se teste au terminal sans Babylon (ajouter à
[`sim.test.ts`](../src/sim/sim.test.ts) ou un `worldgen.test.ts`) :

- **Reproductibilité** : `generateWorld(s)` deux fois ⇒ grilles **strictement égales** (hash du `Uint8Array`).
- **Graines différentes** ⇒ cartes différentes (anti-régression « on a oublié de semer »).
- **Contiguïté** : la viscosité produit des **taches** (ex. taille moyenne de blob > seuil) — garde-fou
  contre un STICKINESS cassé.
- **Anneaux** : chaque site tombe dans `[minRadius, maxRadius]` ; `count` respecté ; jamais dans la zone sûre.
- **Camp** : les cellules centrales sont bien `camp`/forêt ; voisines du camp = forêt (règle ADR).
- **`scatterCell`** : même `(cx,cz,seed)` ⇒ mêmes props (stabilité reload + P2P).
- **Zéro `Math.random()`** dans `sim/` et `data/` (déjà vérifié par les tests de replay existants).

---

## 8. Paramètres exposés (les boutons à régler)

| Bouton | Effet | Défaut proposé |
|---|---|---|
| `worldSeed` | **LA graine partagée** → carte identique pour tous les pairs | code de salon / 12345 |
| `radiusCells`, `cellSize` | taille du monde | 64 / 12 (≈ 1536 u) |
| `safeRadiusCells` | rayon du retranchement (zone sûre M6) | 3 |
| `stickiness` | **blobbiness** des biomes (0 = bruit, ~1 = grandes régions) | 0.5 (ADR) |
| `baseBiomeWeights` | mix landes/champs/forêt | 0.5 / 0.35 / 0.15 (ADR) |
| `relief.*` | octaves/fréquence/amplitude du bruit de relief | 4 / 0.015 / 6 |
| `scatter[biome]` | densité de props par biome | voir 5.1 |
| `sites[]` | `count` + anneau `[min,max]` par site | voir 5.1 |
| `loadRadius` / `unloadRadius` | distance de streaming (+ hystérésis) | à mesurer (≈ 6 / 9 cellules) |
| LOD thresholds | densité de props selon la distance | à mesurer |

---

## 9. Intégration roadmap & ordre de travail

```
M6 (porte, inSafeZone, outfit, capacité de portage)   ──┐  prérequis
                                                          ▼
M7 = CE DOCUMENT : data(worldgen/biomes/sites) → sim(worldgen.ts + tests)
     → render(terrain/scatter/sites streaming, fog of war) → net(worldSeed)
        ├──► M8 lit la DISTANCE pour le tier d'ennemis
        └──► M9 transforme les SILHOUETTES de sites en setpieces explorables (siteCleared en état)
```

**Lot M7 découpé (chaque étape jouable/testable) :**
1. **`data/world.ts`** : `worldgen`, `biomes`, `sites`. (aucun risque, pure data)
2. **`src/sim/worldgen.ts`** + tests (reproductibilité, contiguïté, anneaux). **Cœur déterministe**, validé **avant tout rendu**.
3. **`worldSeed`** dans `GameState` + `createInitialState` + snapshot/`adoptSnapshot` ([`architecture.md §13`](architecture.md)).
4. **`render/terrain.ts`** : streaming de chunks + relief (1 biome plat d'abord, pour valider la perf 60 FPS).
5. **`render/scatter.ts`** : dispersion instanciée + LOD ; frontières fondues.
6. **`render/sites.ts`** : silhouettes ; **`ui/minimap.ts`** : fog of war.
7. **Survie** (`water`/`food`, drain hors zone sûre, `OUTPOST_REFILL`) — la 2ᵉ moitié de M7.

---

## 10. Décisions ouvertes (mes recommandations)

| Sujet | Options | Reco |
|---|---|---|
| **Biomes : grille éager vs bruit lazy** | (a) grille `Uint8Array` + viscosité ADR ; (b) `biomeAt(x,z)` par bruit pur | **(a)** — fidèle à ADR, ~16 Ko, plus simple ; le lazy ne sert qu'au *rendu* |
| **Chunk = 1 cellule vs bloc N×N** | granularité du streaming | démarrer **1 cellule**, mesurer, regrouper si trop de draw calls |
| **Fog of war : mini-carte vs voile 3D** | cf. §3 | **mini-carte** d'abord (simple, P2P trivial) ; voile 3D en polish |
| **Carte explorée partagée ?** | locale par joueur vs champ d'état partagé | **locale** d'abord (comme la forêt) ; partagée si le co-op l'exige |
| **Relief : enrichir `terrainHeight` ?** | garder trig vs fBm à graine | **fBm à graine** — varie avec la graine, garde le contrat de fonction pure |

---

## 11. Modèles 3D nécessaires (liste complète)

> **Style.** Tout est **low-poly construit en code** (primitives `MeshBuilder` fusionnées, *flat
> shading*, *vertex colors*, palette de [`scene.ts`](../src/render/scene.ts)) — pas de `.glb` lourds.
> Les modèles se **prototypent/redessinent dans le [model-lab](../lab/model-lab.html)**.
> **Deux familles** : les **props dispersés** (gros volume → **instanciés**, thin instances) et les
> **sites uniques** (faible nombre → meshes one-off, plus détaillés).

### A. Sol & eau (générés, pas « auteurs »)
| Mesh | Rôle | État | Notes |
|---|---|---|---|
| Patch de sol (chunk) | terrain déformé par `terrainHeight`, vertex colors par biome | **nouveau** | généré, pas un modèle ; frontières fondues, collider statique |
| Surface d'eau | marais / mares | **nouveau** | plan translucide + ondulation vertex (visuel) |

### B. Props de dispersion (instanciés) — `scatterCell`
| Mesh | Biome(s) | État | Inst. | Collider |
|---|---|---|---|---|
| Conifère (tronc+cône) | forêt | **réutilisé** ([`forest.ts`](../src/render/forest.ts)) | ✅ | cylindre statique |
| Arbre mort / sec | forêt, lande | nouveau | ✅ | optionnel |
| Souche / tronc couché | forêt | nouveau | ✅ | bas |
| Buisson / arbuste | forêt, champ | nouveau | ✅ | non |
| Fougère / sous-bois | forêt | nouveau | ✅ | non |
| Champignon (détail) | forêt | nouveau | ✅ | non |
| Touffe d'herbe | champ (+ tous, recoloré) | nouveau | ✅ | non |
| Fleurs sauvages | champ | nouveau | ✅ | non |
| Rocher S / M / L | tous (surtout lande) | nouveau | ✅ | M/L : oui |
| Arbuste sec / broussaille | lande | nouveau | ✅ | non |
| Ossements (détail d'ambiance) | lande | nouveau | ✅ | non |
| Roseaux | marais | nouveau | ✅ | non |

> Set **minimal** pour un premier M7 jouable (cohérent avec le `scatter` de `data/world.ts`) :
> **conifère + rocher + touffe d'herbe**. Le reste = enrichissement visuel.

### C. Sites / repères (uniques) — `sites[]`
| Mesh | Site | Jalon | Notes |
|---|---|---|---|
| Entrée de grotte | `cave` | M7 silhouette → M9 explorable | arche rocheuse + ouverture sombre |
| Maison en ruine | `house` | M7 → M9 | murs ébréchés, toit effondré |
| Grappe de ruines | `town` | M7 → M9 | plusieurs `house` regroupées |
| Grande ruine / tour | `city` | M9 | repère visible de loin |
| Entrée de mine (fer) | `ironmine` | M7 → M9 | charpente bois + tas de minerai (teinte rouille) |
| Entrée de mine (charbon) | `coalmine` | M9 | variante sombre |
| Entrée de mine (soufre) | `sulphurmine` | M9 | variante jaunâtre |
| Marais (composite) | `swamp` | M7 | eau + arbres morts + roseaux |
| Épave de vaisseau | `ship` | M9/M11 | fin de partie (alliage) |
| Cuirassé / grande épave blindée | `executioner` | M9/M11 | setpiece de fin |
| Avant-poste | `outpost` | M7 | structure construite + drapeau (voyage rapide / recharge) |
| Cratère / puits | `borehole` | M9 | ressource rare |
| Champ de bataille (débris) | `battlefield` | M9 | armes brisées, carcasses |
| Cachette | `cache` | M9 | marqueur discret (prestige) |

### D. Retranchement & seuil (prérequis M6)
| Mesh | Rôle | Notes |
|---|---|---|
| Segment de palissade / rempart | clôt la zone sûre | instancié le long du périmètre |
| Porte | le seuil « dedans/dehors » | l'élément central de M6 |
| Tour de guet (optionnel) | silhouette du camp | polish |

### E. Déjà présents (camp central, pas « génération » mais à raccorder)
Feu de camp ([`world.ts`](../src/render/world.ts)), cabane ([`cabin.ts`](../src/render/cabin.ts)),
bâtiments du village ([`buildings.ts`](../src/render/buildings.ts)), avatars
([`villagers.ts`](../src/render/villagers.ts)) — occupent les **cellules centrales** ; le monde
généré commence au-delà du `safeRadius`.

---

## 12. Pourquoi c'est élégant, performant, beau & multijoueur

- **Élégant** : on **réutilise le pattern du projet** (logique pure pas chère + réalisation 3D à la
  demande). `worldgen.ts` rejoint `sim/` comme un reducer de plus ; `data/world.ts` reste la source de
  vérité ; rien de neuf dans la philosophie.
- **Performant** : grille logique 16 Ko, **streaming par chunks** + **LOD** + **instances**, le
  **brouillard (déjà là)** borne le rendu et masque la frontière. C'est le sujet d'archi que la
  roadmap a explicitement réservé à M7.
- **Belle génération** : **viscosité** (taches de biomes contiguës) + **relief fBm** (collines) +
  **dispersion instanciée** + **frontières fondues** = un monde riche à partir de règles simples.
- **Multijoueur** : tout est **dérivé d'une graine** → les pairs n'échangent **qu'un nombre**, la
  carte est identique partout, et ça **prolonge** le modèle hôte‑autoritaire sans le complexifier.
