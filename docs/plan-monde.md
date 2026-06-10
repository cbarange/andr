# Plan d'implémentation — le monde autour du campement

> **But.** Construire le **monde 3D continu qui entoure le retranchement** : biomes en
> taches contiguës, relief, **décor dispersé** (les modèles du labo) et **silhouettes de sites**,
> le tout **streamé par chunks**, **déterministe** (carte = fonction de la graine → P2P) et **60 FPS**.
>
> **S'appuie sur** : la spec [`generation-monde.md`](generation-monde.md) (l'algorithme + le format de
> données) et le catalogue [`modeles-3d.md`](modeles-3d.md) (les meshes déjà prototypés au labo).
> **Respecte** [`architecture.md`](architecture.md) (cerveau/corps/données) et l'ordre
> `data/` → `sim/ (+ tests)` → `render/`/`ui/` → `net/`.
>
> **Périmètre.** C'est la **1ʳᵉ moitié de [M7](roadmap.md)** : un monde **visuel et navigable**. La
> **survie** (eau/nourriture), la **récolte sauvage**, le **rempart/la porte** ([M6](roadmap.md)) et le
> **combat** ([M8](roadmap.md)) sont **hors périmètre** ici (voir §7).

> **✅ Avancement (à jour).** Phases **0+1** (data + `sim/worldgen.ts` + tests), **2** (sol streamé
> `terrain.ts`), **3** (`trees.ts` : 9 essences, camp + sauvage) et **4** (`scatter.ts` : décor par
> biome — rochers/herbes/fougère/champignons/fleurs/arbuste sec/ossements/rondin/roseaux) sont
> **FAITES et vérifiées** (typecheck + 63 tests + 5 e2e + visuel WebGPU). **En plus** : relief
> accentué par régions et **anneau de montagnes** qui borne le monde (`terrainHeight` v2 +
> clamp du streaming dans `terrain.ts`). **Phase 5 (sites/silhouettes) FAITE** : [`sites.ts`](../src/render/sites.ts)
> pose les ~17 repères (grotte, ruines, mines, marais, épave & cuirassé alien) en **LOD silhouette →
> détail** via l'`EntityManager` (cf. docs/perf-rendu.md P5). **Reste** : Phase 6 (fog of war / mini-carte).

---

## 1. Décisions de conception (les choix qui rendent le plan sûr)

| Sujet | Décision | Pourquoi |
|---|---|---|
| **Le camp reste** | Feu, cabane, village, forêt actuelle **inchangés**, aux **cellules centrales** (`distance < safeRadiusCells`, biome `camp`). Le monde généré commence **au-delà**. | **Zéro régression** M0–M5. La porte de M6 sera le seuil. |
| **Granularité** | **Chunk = bloc de `chunkCells × chunkCells` cellules** (ex. 4×4 = 48 u), pas 1 cellule/chunk. | Avec une vue ~55 u, ça fait **~9–16 chunks** chargés, donc **peu de draw calls** pour le sol (vs 169 si 1 cellule = 1 chunk). |
| **Biomes** | **Grille éager** `Uint8Array` (viscosité ADR, remplissage en spirale), générée une fois. **Rendu lazy** par chunk. | Fidèle ADR, ~16 Ko, séquentiel (non parallélisable en `biomeAt` pur). Cf. spec §2.1. |
| **Décor** | **`createInstance`** par prop, groupé sous un nœud de chunk, **disposé au déchargement**. | Déjà éprouvé dans [`forest.ts`](../src/render/forest.ts). Les *thin instances* viendront en optimisation (§5). |
| **Déterminisme** | Disposition (biomes, sites, scatter) **dérivée de `worldSeed`** ; **seul `worldSeed` voyage**. RNG **dédié** à la génération, **distinct de `state.rng`** (gameplay). | Carte identique chez tous les pairs sans rien transférer ; carte **stable** alors que le gameplay **avance**. |
| **Relief** | `terrainHeight(x,z)` reste **pure et globale** ; en v1 le biome ne change **pas** la hauteur (modulation d'amplitude = raffinement). | Préserve la **détection au sol analytique** du joueur (marche partout, sans raycast). |
| **Brouillard** | On **réutilise** le fog exp2 existant (`0.028`) pour **masquer la frontière de chargement**. | Double rôle ambiance/perf d'ADR — déjà en place ([`scene.ts`](../src/render/scene.ts)). |
| **Forêt/décor sauvages** | **Cosmétiques et non récoltables** dans cette phase (pure ambiance). Le bois reste la **forêt du camp** (récolte locale existante). | Garde le périmètre serré : pas de nouvel état de jeu synchronisé pour le décor. |

---

## 2. Carte des nouveaux fichiers

| Fichier | Couche | Rôle |
|---|---|---|
| `data/world.ts` (étendu) | données | `worldgen`, `biomes`, `sites`, table des **essences d'arbres** + **densités de scatter** par biome |
| `src/sim/worldgen.ts` | **cerveau (pur)** | `generateWorld(seed)`, `scatterCell(...)`, helpers `worldToCell`/`cellToWorldCenter`/`biomeAt` |
| `src/sim/worldgen.test.ts` | tests | reproductibilité, contiguïté des blobs, anneaux, stabilité du scatter |
| `src/render/kit.ts` | corps | le **kit `K`** du labo (box/cyl/cone/sph/ico/tor/node) extrait → portage **mécanique** des modèles |
| `src/render/trees.ts` | corps | les **9 essences** en meshes de base instanciables (un par essence) + `createTreeInstance` |
| `src/render/scatter.ts` | corps | meshes de base du **décor** (rochers, herbes, fougère…) + instanciation par chunk selon le biome |
| `src/render/terrain.ts` | corps | **streamer** : charge/décharge les chunks (sol + props) autour du joueur (remplace `createGround`) |
| `src/render/sites.ts` | corps | **silhouettes** des sites aux positions de `map.sites` |
| `src/ui/minimap.ts` | UI | **fog of war** : mini-carte 2D qui se révèle autour du joueur |
| `src/render/scene.ts` (étendu) | corps | `PALETTE` enrichie (couleurs de biomes + décor) |
| `src/main.ts` (câblage) | orchestration | instancie le streamer, lui passe la position du joueur + la `WorldMap`, met à jour la minimap |

---

## 3. Les phases (chacune **lançable / testable**)

### Phase 0 — Préparatifs partagés (data + kit + palette) — **S**
**Objectif** : poser les fondations sans rien changer de visible.
- **`scene.ts`** : étendre `PALETTE` avec les teintes de biomes (`camp`, `forest`, `field`, `barren`,
  `swamp`) et du décor (roche, herbe sèche, etc.), en restant crépusculaire/froid.
- **`src/render/kit.ts`** : extraire le **kit `K`** du labo ([`model-lab.html`](../lab/model-lab.html))
  (`box/cyl/cone/sph/ico/tor/node`, signature `opts` identique). → les `build(K)` du labo se collent
  presque tels quels dans `trees.ts`/`scatter.ts`.
- **`data/world.ts`** : ajouter les blocs `worldgen`, `biomes`, `sites` (cf. spec §5.1) **+** la table
  des **essences** (id, mesh, biomes, poids) et les **densités de scatter par biome** (reprises de
  [`modeles-3d.md §3.4`](modeles-3d.md)).
- ✅ **Critère** : `npm run typecheck` vert ; le jeu démarre identique à aujourd'hui.

### Phase 1 — Le cerveau de la carte (`sim/worldgen.ts`, pur, **testé avant tout rendu**) — **M**
**Objectif** : la carte logique, déterministe et vérifiée au terminal.
- `generateWorld(seed) → WorldMap` : grille de biomes par **viscosité** (remplissage en spirale,
  `chooseBiome`), **camp forcé** au centre + voisines en forêt (règle ADR), **sites par anneaux**
  euclidiens (`placeSites`). Helpers `worldToCell`/`cellToWorldCenter`/`biomeAt`.
- `scatterCell(cx, cz, biome, seed) → ScatterProp[]` : dispersion **lazy** et **déterministe** (RNG
  semé par `hash(cx,cz,seed)`), densité selon le biome.
- **État** : ajouter `worldSeed: number` à `GameState` + `createInitialState`, et au
  **snapshot/`adoptSnapshot`** (P2P) + à la **sauvegarde** (bump `VERSION` de [`save.ts`](../src/save.ts)).
- **Tests** (`worldgen.test.ts`) : même graine ⇒ grille identique (hash) ; graines ≠ ⇒ cartes ≠ ;
  blobs contigus (taille moyenne > seuil) ; chaque site ∈ `[min,max]` et hors zone sûre ; `scatterCell`
  stable ; **zéro `Math.random`**.
- ✅ **Critère** : `npm run test` vert (les ~35 tests + les nouveaux). **Aucun changement visuel.**

### Phase 2 — Le sol streamé (`terrain.ts`) — **L** *(le vrai sujet de perf)*
**Objectif** : marcher hors du camp et voir le terrain s'étendre, coloré par biome.
- `TerrainStreamer(scene, map)` : à chaque frame, à partir de la **position du joueur**, calcule les
  chunks dans `loadRadius`, **instancie** les manquants, **dispose** ceux au-delà de `unloadRadius`
  (**hystérésis**). Chaque chunk = **un patch de sol** (subdivisé), déformé par `terrainHeight`,
  **vertex colors par cellule** (biome), `convertToFlatShadedMesh`, collider statique (`PhysicsAggregate`
  MESH).
- **Frontières fondues** : couleur de vertex = **mélange** des biomes voisins aux bords de cellule.
- Cellules centrales = biome `camp` (dégradé `ground`/`groundLow` actuel) → le camp reste cohérent.
- **`main.ts`** : remplacer `createWorld`→`createGround` par le streamer ; **garder le feu de camp** ;
  appeler `terrain.update(player.position)` dans la boucle (à côté de `forest.update`).
- La **détection au sol** du joueur est déjà analytique (`terrainHeight`) → marche partout, **rien à
  changer** côté physique du joueur.
- ✅ **Critère** : sortir du camp, le sol défile sans couture ni à-coup ; **60 FPS** ; le brouillard
  masque la frontière. (Vérif manuelle WebGPU + e2e WebGL2.)

### Phase 3 — Les arbres (variété déterministe) (`trees.ts`) — **M**
**Objectif** : casser le cône unique avec les **9 essences** du labo.
- Porter chaque essence en **mesh de base fusionné** (vertex colors, flat shading, instanciable) — un
  par essence — via le kit `K`. `petit-arbre` = le mesh actuel.
- `createTreeInstance(species, pos, {scale, rotY})` → `InstancedMesh`.
- **Deux consommateurs** :
  1. **Camp** : [`forest.ts`](../src/render/forest.ts) tire l'essence + l'échelle d'un slot via le
     **RNG à graine** (cohérence P2P) au lieu du cône unique.
  2. **Sauvage** : le scatter (phase 4) pose des arbres par biome.
- ✅ **Critère** : la forêt du camp montre des essences variées ; capture e2e à jour.

### Phase 4 — Le décor dispersé (`scatter.ts`, intégré au streamer) — **L**
**Objectif** : un monde **vivant et lisible par biome**.
- Porter le décor du labo en meshes de base instanciables : `rochers-sml` (S/M/L), `herbes`
  (**recolorable** par biome), `fougere`, `champignons`, `fleurs`, `arbuste-sec`, `ossements`,
  `roseaux`, `rondin`, `souche`.
- À l'instanciation d'un chunk, pour chacune de ses cellules : `scatterCell(...)` → poser les props
  (position perturbée, **rotation Y** + **échelle** aléatoires) sous le **nœud du chunk** ; **disposer**
  au déchargement (avec le sol).
- **Densités par biome** (cf. [`modeles-3d.md §3.4`](modeles-3d.md)) : forêt dense, champ herbeux,
  lande clairsemée, roseaux en bordure d'eau. **Pas de collision** (cosmétique ; sauf gros rochers
  optionnels).
- **LOD** : chunks lointains → densité réduite / petits props sautés.
- ✅ **Critère** : chaque biome se **reconnaît au premier coup d'œil** ; 60 FPS tenus ; variété (pas
  d'effet copier-coller).

### Phase 5 — Les sites / repères (`sites.ts`) — **M** — ✅ FAIT
**Objectif** : des **silhouettes repérables de loin** qui matérialisent le gradient « centre sûr →
bords dangereux ». *(Réalisé : `sites.ts` + LOD silhouette→détail via `EntityManager` — cf. perf-rendu.md P5.)*
- Pour chaque `map.sites` : poser une **silhouette low-poly** (grotte, maison/ruines, entrée de mine,
  marais composite, épave, cuirassé…). v1 = silhouette ; **l'entrée explorable est M9**.
- Sites peu nombreux (~15) → on peut tout **instancier d'emblée** (le brouillard masque les lointains)
  ou les streamer comme les chunks. **Reco** : tout charger (simple, peu coûteux), mesurer ensuite.
- ✅ **Critère** : on aperçoit l'épave/le marais au loin et on peut marcher jusqu'à eux ; positions
  **identiques** d'un rechargement/pair à l'autre.

### Phase 6 — Fog of war (`ui/minimap.ts`) + finitions P2P — **S/M**
**Objectif** : la **sensation d'exploration** d'ADR et la cohérence multijoueur.
- **Mini-carte 2D** de la grille de biomes qui **se révèle** dans un rayon autour du joueur (cellules
  vues = `Set` **local** au joueur). Marqueurs des sites découverts. (Voile 3D littéral = polish, M12.)
- **P2P** : confirmer que `worldSeed` part dans le **snapshot initial** et que chaque pair appelle
  `generateWorld(worldSeed)` → **carte identique** ; rien d'autre ne transite.
- ✅ **Critère** : la carte se dévoile en marchant ; à deux dans un salon, **même monde** des deux côtés.

---

## 4. Réglages concrets de départ (tous dans `data/world.ts`, à mesurer)

| Paramètre | Valeur de départ | Note |
|---|---|---|
| `radiusCells` / `cellSize` | 64 / 12 u | monde ≈ 1536 u (vs 50 aujourd'hui) |
| `chunkCells` | 4 (chunk = 48 u) | compromis draw calls / granularité de chargement |
| `loadRadius` / `unloadRadius` | 2 / 3 chunks (~96 / 144 u) | hystérésis anti-clignotement ; > portée du fog (~55 u) |
| `safeRadiusCells` | 3 | le retranchement (zone sûre M6) |
| `stickiness` | 0.5 | viscosité ADR (blobbiness) |
| `baseBiomeWeights` | landes 0.5 / champs 0.35 / forêt 0.15 | mix d'ADR |
| `relief` (fBm) | octaves 4, freq 0.015, ampl 6 | collines douces |
| densités scatter | forêt dense · champ herbeux · lande clairsemée | cf. `modeles-3d.md §3.4` |
| `fogDensity` | 0.028 (inchangé) | masque la frontière de chargement |

---

## 5. Points d'attention & risques

- **Coutures entre chunks** : partager exactement `terrainHeight` aux bords (mêmes sommets) et
  **mélanger les biomes aux coins de cellule** ; sinon murs/trous visibles. *Risque principal.*
- **Draw calls du sol** : si chunk = 1 cellule → trop de meshes. → **chunk = bloc** (décision §1).
- **Cohérence du camp** : forcer le biome `camp` au centre + garder le dégradé de sol actuel pour que
  le campement « ne bouge pas » sous les pieds du joueur.
- **Coût de génération de chunk** (déformer + peindre + instancier) sur le thread principal : **amortir**
  (1–2 chunks par frame max), prioriser les plus proches ; sinon micro-freezes en marchant.
- **Schéma de sauvegarde** : ajouter `worldSeed` → **bump `VERSION`** dans [`save.ts`](../src/save.ts)
  (les vieilles sauvegardes sont invalidées proprement).
- **Optimisations différées** (M12) : *thin instances* (au lieu de `createInstance`), LOD agressif,
  occlusion, voile 3D du fog of war.

---

## 6. Ordre de démarrage recommandé (la 1ʳᵉ itération)

1. **Phase 0 + Phase 1** ensemble : data + `worldgen.ts` **avec ses tests**. C'est **invisible mais
   solide** — on valide le cœur déterministe au terminal **avant** d'écrire une ligne de rendu (fidèle
   au workflow du projet). *Aucun risque de régression.*
2. Puis **Phase 2** (terrain streamé, **1 seul biome plat d'abord**) pour valider la **perf** et le
   streaming **isolément**, avant d'ajouter la complexité visuelle.
3. Puis **3 → 4 → 5 → 6** dans l'ordre (chacune ajoute une couche jouable).

> Chaque phase finit par : `npm run typecheck` + `npm run test` (+ `npm run e2e` & capture dès qu'il y a
> du visible). On garde `src/sim/` **pur et déterministe**.

---

## 7. Ce qui reste après (hors de ce plan)

- **[M6](roadmap.md)** — rempart + **porte** + ravitaillement + `inSafeZone` (le seuil dedans/dehors).
- **[M7](roadmap.md) (2ᵉ moitié)** — **survie** (eau/nourriture qui se vident dehors), **bases
  avancées** (avant-postes), mort + retour au camp.
- **Récolte sauvage** — rendre certaines ressources du monde récoltables (état de jeu synchronisé).
- **[M8](roadmap.md)** — **combat** tiéré par la **distance** (lue depuis la carte).
- **[M9](roadmap.md)** — **sites explorables** (les silhouettes deviennent des setpieces ; mine nettoyée
  ⇒ métier mineur).
