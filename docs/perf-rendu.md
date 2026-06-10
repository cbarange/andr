# Optimisation du rendu — entités, LOD & distance de rendu

> **But.** Permettre une **distance de rendu très importante** (le joueur voit de loin qu'il y a
> des zones à explorer) **sans** payer le plein coût partout : les chunks lointains deviennent
> **minimalistes** et les « entités » (villageois, props, sites) sont **déchargées visuellement**
> quand on s'en éloigne. Le rendu devient **conditionné par la distance**.
>
> Rapport d'analyse + recommandations, ancré sur l'archi réelle ([`architecture.md`](architecture.md),
> [`plan-monde.md`](plan-monde.md)) et sur les bonnes pratiques Babylon.js (sources en fin de doc).
> **Statut : P1→P6 IMPLÉMENTÉS et vérifiés** (typecheck + tests unitaires + e2e). Reste **P7** (web
> workers) et 3 sous-items différés (voir **§0.5 Reprise**). Le §1 ci-dessous décrit la **baseline
> AVANT** optimisation (pour contexte) ; l'état réel est résumé en §0.5.

---

## 0. Règle d'or : MESURER d'abord

La communauté Babylon est unanime : *« the first rule of optimization — measure »*. Avant d'optimiser,
identifier le **goulot** (CPU vs GPU) :
- **GPU‑bound** (trop de pixels/draw calls) → baisser la résolution interne, réduire les draw calls,
  LOD, culling.
- **CPU‑bound** (trop de matrices/meshes actifs/updates JS) → geler les statiques, réduire le nombre
  de nœuds, sortir les calculs lourds, baisser la fréquence d'update des entités lointaines.

Outils : l'**overlay debug** existant (F3 : FPS, frame ms — déjà là), l'**Inspector Babylon**
(`scene.debugLayer`), et le compteur de **draw calls** / `scene.getActiveMeshes().length`.
On a aussi déjà un **stepper « view range »** et des switches (texture sol, brouillard) dans le HUD
debug : parfaits pour corréler distance ↔ FPS pendant le réglage.

---

## 0.5 État & reprise (lire en premier pour reprendre)

**Tout le pipeline LOD/perf est en place (P1→P6).** Voici l'état, les réglages, les outils d'observation
et les points pour **reprendre**. Détail de chaque jalon en **§6**.

### Jalons

| Jalon | État | Fichier(s) clé |
|---|---|---|
| **P1** — `EntityManager` + villageois cullés | ✅ | `render/entities.ts` (pur, testé), `render/villagers.ts`, `main.ts` |
| **P2** — Physique près du joueur (multijoueur) | ✅ | `render/terrain.ts` (`syncPhysics`, `PHYS_R`), `render/remotePlayer.ts` |
| **P3** — Props en paliers (near/far) | ✅ | `render/proplod.ts` (pur, testé), `render/terrain.ts` (`syncPropBands`/`buildProps`) |
| **P4** — Statiques **figés** (`freezeWorldMatrix`) | ✅ | `render/terrain.ts`, `render/sites.ts` |
| **P5** — Sites en LOD silhouette→détail | ✅ | `render/sites.ts` (via `EntityManager`), `main.ts` |
| **P6** — Résolution **adaptative** (FPS cible) | ✅ | `render/autoperf.ts` (pur, testé), `main.ts`, `ui/hud.ts` |
| **P7** — Web workers (génération/scatter) | ⏳ à faire | — |
| *Différé P4* — subdiv réduite des chunks lointains | ⏳ | besoin de **skirts** (anti-fissures T-junction) |
| *Différé P6* — `freezeActiveMeshes` par zone | ⏳ | fragile avec le streaming (reset au changement de set) |

### Observer (overlay debug, **F3**)
Lignes ajoutées par l'optimisation (à corréler avec `fps`/`frame`) :
- **`villageois`** `rendus/total` (P1) — passe à `0/N` loin du village.
- **`chunks`** `N▣ M■/T` — **N** chunks au palier *near* (P3) · **M** avec collider Havok (P2) · **T** chargés.
- **`props`** `X (Y❄ figés)` — **X** instances de décor affichées (P3) · **Y** à matrice monde gelée (P4).
- **`sites`** `N◆ M△/P` — **N** sites en détail · **M** en silhouette · **P** posés (P5).
- Switches : **texture sol**, **brouillard**, **perf auto** (P6). Steppers : **view range** (P2/P3), **résolution** (P6).

### Réglages (boutons à tourner)

| Réglage | Où | Valeur | Effet |
|---|---|---|---|
| LOD villageois | `data/world.ts` → `config.lod` | `villageFull 45`, `villageMinimal 85`, `hysteresis 10` | distances détail/ralenti/déchargé |
| Rayon physique | `render/terrain.ts` → `PHYS_R` | `1` chunk (bloc 3×3) | sol solide autour de chaque joueur |
| Palier props | `render/proplod.ts` → `PROP_NEAR_R`/`PROP_HYST`, `SMALL_DECOR` | `1`/`1` | où le décor s'allège ; quoi masquer loin (+ arbres −50 %) |
| LOD sites | `render/sites.ts` → `SITE_FULL`/`SITE_MINIMAL` | `80`/`380` | détail / silhouette / masqué |
| FPS cible | `render/autoperf.ts` → `PERF_TARGET`, `SCALE_*` | `55`, `[1.0, 2.0]`, pas `0.15` | agressivité de la résolution adaptative |
| Cadence adaptative | `main.ts` → `PERF_TICK_MS` | `1000` ms | fréquence d'ajustement résolution |
| View range | HUD stepper / `worldgen.loadRadiusChunks` | `2` (1→6) | rayon de chunks chargés (voir loin) |

### Hooks dev (`window.__game`, DEV) — pour piloter/mesurer
`getTerrainStats()` → `{chunks, colliders, props, near, frozen}` · `getSiteStats()` → `{placed, types, full, minimal}` ·
`getHardwareScaling()` / `setHardwareScaling(lvl)` / `setAutoPerf(on)` · `getPlayer()` · `teleport(x,z)` ·
`cmd("/tp <site>")`, `cmd("/seed N")`, `cmd("/fly")`… (console dev, `ENTER`).

### Tests (le filet de sécurité)
- **Unitaires** (`npm run test`, **87**) : logique PURE testée au terminal — `entities.test.ts` (4, LOD/hystérésis),
  `proplod.test.ts` (7, paliers/sélection), `autoperf.test.ts` (5, FPS cible) + sim/worldgen existants.
- **e2e** (`npm run e2e`, **10**, Playwright headless) : un test par jalon — `…(P2)` physique localisée,
  `…(P3)` props allégés, `…(P4)` figés, `…(P5)` sites, `…(P6)` résolution. Les tests dépendant du streaming
  utilisent `expect.poll` (pas de délai fixe) pour rester robustes.
  > ⚠️ **Flakiness connue (environnement, pas le code)** : enchaîner **plusieurs suites complètes** sur un
  > **serveur dev réutilisé** (`reuseExistingServer: true`) — surtout avec une page de **preview encore
  > connectée** — dégrade le GPU/serveur headless (pression mémoire WebGPU) → timeouts sur les tests lourds.
  > **Un run frais isolé est fiable (10/10 ~25 s).** Fermer la preview avant de lancer les e2e.

### Pour reprendre (prochaines étapes)
1. **P7 — web workers** : sortir `generateWorld`/`scatterCell` du thread principal (la sim est **pure** →
   transférable). Le streamer (`terrain.ts`) posterait les coords de chunk au worker et recevrait positions+
   types de props. Gain : zéro micro-freeze de génération à grande view range. *(Le plus lourd ; « scale ».)*
2. **Différé P4 — subdiv réduite des chunks lointains** : recoder `makeGroundMesh` avec une subdivision
   `far` plus grossière **+ skirts** (jupes verticales au bord, couleur du sol) pour masquer les fissures
   T-junction. Rebuild au changement de palier (réordonner : bandes **avant** `syncPhysics`). **À vérifier
   visuellement** (idéalement onglet jeu au premier plan dans la preview).
3. **Différé P6 — `freezeActiveMeshes` par zone** : ne tenter qu'avec un **reset** propre à chaque
   changement du set de meshes actifs (chunk load/unload, bascule LOD). Risque : meshes invisibles. Mesurer
   le gain réel d'abord (le gel par objet de P4 capte déjà beaucoup).
4. **Mesurer** systématiquement au F3 (et activer **perf auto**) en montant la **view range** : c'est le but
   final — « voir loin » sans chute de FPS.

---

## 1. État actuel — *baseline AVANT optimisation* (pour contexte)

| Système | Rendu actuel | Coût / limite |
|---|---|---|
| **Terrain (chunks)** | `render/terrain.ts` : 1 mesh sol/chunk (subdiv 24, flat‑shaded) + **collider physique MESH** + props instanciés. Streaming par `loadR`/`unloadR` (réglable via *view range*). | **Tous les chunks chargés sont au plein détail** : même subdiv, **collider Havok partout**, props pleins. Augmenter la *view range* multiplie tout ça linéairement → coûteux. |
| **Props sauvages** (arbres, rochers, herbes…) | `render/scatter.ts` + `render/trees.ts` : `createInstance` (instances **régulières**) par prop, parentées au nœud du chunk. Arbres = registre coupable. | Beaucoup de **nœuds JS** (des centaines/chunk). Les instances régulières profitent du **frustum culling** mais chaque instance reste un objet à gérer. Pas de **LOD** (même densité de près comme de loin). |
| **Villageois** | `render/villagers.ts` : jusqu'à **48 avatars**, chacun un `TransformNode` + **plusieurs sous‑meshes** (corps, tête, chapeau, nez…). `update()` **chaque frame pour tous** (steering, gestes, bob). | Cosmétique mais **toujours rendus et mis à jour**, quelle que soit la distance. ~48 × ~10 meshes = **centaines de meshes** + maths JS par frame, même quand le joueur est à 800 m du village. |
| **Forêt du camp** | `render/forest.ts` : instances + colliders cylindre par arbre, particules de feuilles. | Local au camp, borné (~24 slots) — coût modéré, mais toujours actif. |
| **Sites** | (à venir, Phase 5) silhouettes. | À concevoir directement en LOD (silhouette de loin, détail de près). |
| **Caméra / scène** | `scene.ts` : fog exp2, post‑process (FXAA, color grading, vignette, grain, bloom). Caméra `maxZ` par défaut. | Le **fog** sert déjà de borne de vue + masque la frontière de chunks. Le post‑process a un coût fixe (plein écran). |

**Constat clé :** aujourd'hui « charger un chunk » = tout charger (sol détaillé + collider + props pleins),
et « avoir un villageois » = le rendre et l'animer en continu. Pour une **grande** distance de rendu,
c'est intenable. Il faut **graduer** le rendu selon la distance et **décharger** ce qui n'est pas utile loin.

---

## 2. Le concept d'« ENTITY » à rendu conditionnel

L'idée demandée : une **entité** = quelque chose qui a une **position dans le monde** et une **politique
de rendu** fonction de sa **distance au joueur** (ou à la caméra). On centralise la décision
« afficher / simplifier / décharger » au lieu de la coder au cas par cas.

```ts
// Esquisse (render/, couche corps). PAS de règle de jeu : purement visuel/local.
type LodBand = "full" | "minimal" | "culled";

interface Entity {
  x: number; z: number;
  band: LodBand;                 // palier courant (mémorisé pour ne réagir qu'aux CHANGEMENTS)
  enter(band: LodBand): void;    // appelé quand on entre dans un palier (créer/échanger le mesh)
  tick?(dtSec: number): void;    // mise à jour (animation) — appelée seulement en "full" (ou réduite)
}

class EntityManager {
  private readonly entities = new Set<Entity>();
  // bornes au carré (évite les sqrt). Réglables, liées à la "view range".
  constructor(private nearSq: number, private farSq: number) {}
  register(e: Entity) { this.entities.add(e); }
  unregister(e: Entity) { this.entities.delete(e); }
  update(px: number, pz: number, dtSec: number) {
    for (const e of this.entities) {
      const d2 = (e.x - px) ** 2 + (e.z - pz) ** 2;
      const band: LodBand = d2 <= this.nearSq ? "full" : d2 <= this.farSq ? "minimal" : "culled";
      if (band !== e.band) { e.band = band; e.enter(band); } // ne fait le travail qu'au changement
      if (band === "full") e.tick?.(dtSec);                  // anime seulement de près
    }
  }
}
```

Points importants de conception :
- **Hystérésis** sur les bornes (entrer en `full` à 60 m, en sortir à 70 m) pour éviter le clignotement
  quand on longe une frontière. (Même principe que `loadR`/`unloadR` du terrain.)
- **On ne fait le travail qu'au changement de palier** (`enter`) : créer/disposer/échanger un mesh est
  coûteux, pas à faire chaque frame.
- **`tick` seulement en `full`** : les villageois lointains ne s'animent plus du tout (énorme gain CPU),
  et on peut même mettre les `minimal` à jour 1 frame sur N.
- **Déterminisme préservé** : ce gestionnaire est **render‑local** (comme la forêt, les villageois) ;
  il ne touche pas la sim. Deux pairs peuvent avoir des paliers différents selon où ils sont — sans
  impact sur l'état partagé.
- **Source de vérité des positions** : pour les props/sites, la position vient déjà du **scatter
  déterministe** (`worldgen.scatterCell`) / des `worldMap.sites`. L'entité n'est qu'une **réalisation**.

Le `EntityManager` se branche dans la boucle de `main.ts` à côté de `terrain.update(...)`, alimenté par
`player.position`. Les bornes dérivent de la *view range* (déjà réglable dans le HUD).

---

## 3. Stratégie par paliers de distance

L'objectif « voir loin, mais pas cher loin » se traduit par **3–4 anneaux** autour du joueur :

```
        ┌───────────────────────────────────────────────────────────┐
        │  AU-DELÀ (culled)            silhouette / brume, rien d'actif │  perçu mais ~gratuit
        │  ┌─────────────────────────────────────────────────────┐   │
        │  │  LOIN (minimal)        sol grossier, props fusionnés/    │ │  draw calls minimes,
        │  │  ┌───────────────────────────────────────────────┐   │ │  0 physique, 0 anim
        │  │  │  MOYEN (réduit)   props instanciés, pas d'anim,  │ │ │
        │  │  │  ┌─────────────────────────────────────────┐   │ │ │  villageois figés
        │  │  │  │  PRÈS (full)  tout : détail, physique,    │ │ │ │
        │  │  │  │               anim, props, villageois     │ │ │ │  plein coût (peu de chunks)
        │  │  │  └─────────────────────────────────────────┘   │ │ │
        │  │  └───────────────────────────────────────────────┘ │ │
        │  └─────────────────────────────────────────────────────┘ │
        └───────────────────────────────────────────────────────────┘
```

| Anneau | Terrain | Props (arbres/décor) | Villageois | Sites | Physique |
|---|---|---|---|---|---|
| **Près** (~1–2 chunks) | subdiv pleine + texture | instances pleines, animées (chute…) | rendus + **animés** | détail (M9) | **collider** sol + arbres |
| **Moyen** | subdiv pleine | instances, **pas d'animation**, densité pleine | rendus, **figés** (update 1/N ou off) | mesh détaillé | **pas** de collider props |
| **Loin** (jusqu'à la *view range*) | **subdiv réduite**, props **fusionnés** dans le mesh du sol (1 draw call, figé) ou **densité réduite** | silhouettes/imposteurs basse densité | **déchargés** | **silhouette** (billboard/mesh simple) | **aucune** physique |
| **Au‑delà** | non chargé ; **fond/brume** + éventuelle silhouette de relief | — | — | éventuelle silhouette repère | — |

Idée directrice : **le joueur voit qu'il y a « quelque chose là‑bas »** (relief, silhouette de forêt,
masse d'un site) sans qu'on rende le détail. Le **brouillard** (déjà découplé de la *view range*) et une
**perspective aérienne** (teinte qui se fond vers l'horizon) vendent la profondeur à coût quasi nul.

---

## 4. Techniques Babylon.js applicables (et où, dans le projet)

### 4.1 LOD natif (`mesh.addLODLevel`)
`mesh.addLODLevel(distance, autreMesh)` échange automatiquement un mesh contre une version simplifiée
au‑delà d'une distance ; `addLODLevel(d, null)` **arrête de le rendre** au‑delà de `d`.
- **Pour nous** : idéal pour les **sites** (mesh détaillé → silhouette → null) et éventuellement les
  **bases d'arbres** (mesh plein → billboard → null). ⚠️ S'applique au **mesh source**, pas trivialement
  aux **instances** (les instances suivent le LOD de leur source, ce qui peut convenir : au‑delà de `d`,
  tout le lot disparaît — utile pour des props purement décoratifs).

### 4.2 Instances régulières vs **thin instances**
- **Instances régulières** (`createInstance`, ce qu'on utilise) : **frustum‑cullées individuellement**,
  manipulables/disposables une par une (nécessaire pour les **arbres coupables**), mais 1 **nœud JS** chacune.
- **Thin instances** (`thinInstanceAdd`) : **zéro objet JS** → des milliers sans coût CPU, MAIS
  **toutes rendues si la base est visible** (pas de culling individuel) et pas d'objet par instance.
- **Pour nous** : garder des **instances régulières** pour les arbres **coupables proches** ; pour le
  **décor lointain non interactif** (herbes, petits rochers), passer en **thin instances par chunk** ou
  carrément **fusionner** (`Mesh.MergeMeshes`) en un seul mesh figé → 1 draw call, 0 nœud.

### 4.3 « Minimaliser » un chunk lointain
- **Fusionner** sol + props statiques du chunk en **un seul mesh** (`MergeMeshes`), **figé**, sans
  collider → un chunk lointain = **1 draw call, 0 physique, 0 instance**.
- Ou **réduire la subdivision** du sol lointain (moins de triangles) et **omettre les props**.
- **Ne créer le collider physique que près du joueur** : aujourd'hui **chaque** chunk chargé a un
  `PhysicsAggregate` MESH (coûteux). Le joueur n'a besoin de colliders que **sous/autour de lui**
  (~1 chunk). → **gros gain** quand la *view range* est grande. (Décorréler « visible » de « collidable ».)

### 4.4 Geler les statiques (CPU)
Pour tout mesh qui ne bouge plus (sol, props posés) :
- `mesh.freezeWorldMatrix()` — ne recalcule plus sa matrice monde.
- `mesh.material.freeze()` — saute la vérif d'état du matériau.
- `mesh.doNotSyncBoundingInfo = true` — saute la synchro de bounding (statique).
- `scene.freezeActiveMeshes()` + `scene.getActiveMeshes().reset()` au rechargement de chunks :
  **fige la liste des meshes actifs** (saute le culling CPU par frame). À **réappliquer** quand le set
  de chunks change (sinon les nouveaux ne s'affichent pas). La communauté recommande de **geler par
  zone autour du joueur**, pas toute la scène d'un coup.

### 4.5 Culling
- `mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY` — culling plus rapide
  (sphère seule) pour les nombreux props.
- **Octree** (`scene.createOrUpdateSelectionOctree()`) accélère la sélection quand il y a beaucoup de
  meshes (marche avec instances régulières, **pas** avec thin instances).

### 4.6 Leviers GPU globaux
- `engine.setHardwareScalingLevel(n>1)` — rend à **résolution interne réduite** (gros gain GPU,
  perte de netteté). Excellent **switch HUD debug** ou option « performance ».
- `scene.autoClear=false` / `scene.autoClearDepthAndStencil=false` quand l'écran est entièrement
  redessiné (sol opaque couvrant) → saute des clears.
- `scene.skipPointerMovePicking = true`, `scene.blockMaterialDirtyMechanism = true`.
- **`SceneOptimizer`** : ajuste des réglages au runtime pour tenir un FPS cible (hardware scaling,
  post‑process, etc.). Bon filet de sécurité **adaptatif**.

### 4.7 Sortir le travail du thread principal
La piste long terme citée par la communauté pour les très grands mondes : **streaming + web workers**
(génération de chunks/scatter dans un worker). Lourd à mettre en place, à garder pour M12/scale.

---

## 5. Recommandations concrètes par système

1. **Villageois → entités cullées (gain immédiat, faible risque).** Brancher `Villagers` sur le
   `EntityManager` : au‑delà d'un rayon (≈ 1.5× le rayon du village), **masquer** les nœuds
   (`node.setEnabled(false)`) et **couper `update()`**. Revenir en `full` les réactive. Coût ~nul
   quand on explore loin. (Option intermédiaire : à distance moyenne, garder visibles mais **figés**,
   update 1 frame sur 4.)
2. **Props lointains → fusion / thin instances + falloff de densité.** Dans `terrain.ts`, au‑delà d'un
   anneau : ne pas instancier le **petit décor** (herbes, fleurs, champignons), ne garder que les
   **gros repères** (arbres, gros rochers) en densité réduite, voire **fusionnés** par chunk. Garder les
   **arbres coupables en instances régulières** uniquement dans l'anneau proche.
3. **Physique seulement près du joueur.** Ne créer le `PhysicsAggregate` du sol que pour les chunks à
   ≤ ~1 chunk du joueur ; les chunks visibles plus loin n'ont **pas** de collider. → débloque une grande
   *view range* sans exploser le coût Havok.
4. **Chunks lointains minimalistes.** Deux niveaux de build : **proche** (subdiv pleine + props +
   collider) vs **lointain** (subdiv réduite, props fusionnés/omis, figé, pas de collider). Le palier
   est choisi à la construction selon la distance ; rebascule possible si le joueur s'approche.
5. **Sites en LOD natif.** Construire chaque site avec `addLODLevel` : mesh détaillé (proche) →
   **silhouette** (loin) → `null` (très loin). Le joueur repère la masse de loin, le détail n'apparaît
   qu'à l'approche (→ déclenche M9).
6. **Geler le statique + culling sphère** sur sol et props posés (4.4 / 4.5).
7. **Switches HUD debug** (cohérents avec l'existant) : `hardware scaling` (×1 / ×1.5 / ×2),
   `villageois` (on/off rendu), `props lointains` (on/off), et étendre la *view range* maintenant que les
   anneaux la rendent abordable.
8. **Perspective aérienne** : faire tendre la couleur du sol/props lointains vers la couleur du fog
   (au‑delà du dernier anneau) pour que l'horizon « se devine » sans détail.

---

## 6. Plan par jalons (chacun mesurable au F3)

> Ordre = **gain/risque décroissant**. On mesure le FPS (overlay) à *view range* fixe avant/après.

- **P1 — `EntityManager` + villageois cullés. ✅ FAIT.** Socle réutilisable
  ([`render/entities.ts`](../src/render/entities.ts), pur, **4 tests** unitaires) ; le village est
  une entité (centre = le feu) : villageois **animés** ≤ `villageFull`, **au ralenti** ≤
  `villageMinimal`, **déchargés** (`setEnabled(false)` + plus d'`update`) au‑delà. Distances dans
  `config.lod`. Le HUD debug affiche **`villageois rendus/total`** (passe à `0/N` quand on s'éloigne).
- **P2 — Physique près du joueur uniquement. ✅ FAIT.** Le collider Havok est découplé du
  mesh visible dans [`terrain.ts`](../src/render/terrain.ts) : à la construction, un chunk n'a
  **aucun** collider ; `syncPhysics()` (chaque frame) (dé)pose un `PhysicsAggregate` seulement sur
  les chunks à ≤ `PHYS_R` chunks (bloc 3×3) d'**un joueur**. Le sol reste **visible** loin, mais la
  physique ne paie que le voisinage immédiat → ~9 colliders au lieu de tous les chunks chargés.
  **MULTIJOUEUR** : `syncPhysics` reçoit le joueur **local + tous les avatars distants**
  (`RemotePlayers.positions()`) → chaque pair a du sol solide sous lui, pas seulement l'hôte. HUD
  debug : ligne **`chunks N■/M`** (colliders/chargés). Vérifié par e2e (téléport à 424 m : colliders
  ≤ 12, `chunks > colliders`, joueur posé/y stable). *Débloque la grande view range.*
- **P3 — Props en paliers. ✅ FAIT.** Chaque chunk a un palier `near`/`far`
  ([`proplod.ts`](../src/render/proplod.ts), pur, **7 tests**) selon sa distance (chunks) au joueur,
  avec hystérésis. `near` : décor **complet** + arbres **coupables**. `far` : **petit décor masqué**
  (herbe, fougère, champignons, fleurs, broussaille, roseaux, ossements), **arbres éclaircis ~50 %**
  (déterministe), **non coupables** ; gros décor (rochers, rondins, arbustes, souches) conservé pour
  la silhouette. Les props sont **reconstruits au changement de palier** (`setPropBand`, amorti
  `PROPS_PER_FRAME`, plus proches d'abord) → densification en approchant, allègement en s'éloignant.
  HUD debug : **`N▣`** (chunks near) et ligne **`props`** (instances affichées). Vérifié par e2e
  (découpage near/far actif, reconstruction sans casse en explorant). *Réduit fortement le coût des
  chunks lointains à grande view range.*
- **P4 — Chunks lointains minimalistes : « figés ». ✅ FAIT (partiel, assumé).** Le sol et tout le
  décor **statique** ne bougent jamais -> leur **matrice monde est gelée** (`freezeWorldMatrix`,
  dans [`terrain.ts`](../src/render/terrain.ts)) : plus aucun recalcul de transform par frame, gain
  qui croît avec la view range. Seuls les arbres **coupables** (palier near) restent libres (ils
  s'animent à la coupe). Les instances restent **cullées** individuellement. HUD debug : **`N❄ figés`**.
  Vérifié par e2e (tous les sols figés + props figés, sans casse). **Différé volontairement** :
  *(1) subdiv réduite* — coarsen le sol lointain crée des **fissures en T-junction** dans le relief
  (termes haute-fréquence de `terrainHeight`, λ≈35 u) ; correct seulement avec des **skirts**/stitching,
  artefact que je ne peux pas vérifier tant que l'onglet jeu de la preview est en arrière-plan → à
  faire en suivi vérifiable. *(2) « merge »* — non retenu : nos props sont des **instances à base
  partagée** (déjà ~1 draw-call par type, globalement) ; fusionner par chunk **augmenterait** le
  nombre de meshes uniques/draw-calls. Le bon levier ici était bien le **gel**, pas le merge.
- **P5 — Sites en LOD (silhouette → détail). ✅ FAIT.** Les ~17 points d'intérêt
  ([`sites.ts`](../src/render/sites.ts), géométrie portée du labo) sont posés aux positions
  déterministes de `map.sites` (yaw dérivé de la graine -> identique chez tous les pairs) et pilotés
  par l'**`EntityManager` (P1)** : `full` = modèle détaillé (≤ 80 u) · `minimal` = **silhouette**
  simplifiée (bloc sombre lisible de loin, ≤ 380 u) · `culled` au-delà (le brouillard masque).
  **Choix assumé** : bascule À LA MAIN via l'EntityManager plutôt que `Mesh.addLODLevel` — c'est la
  voie robuste avec nos **instances** (cf. §7) et elle est testable/déterministe (multijoueur). Les
  instances sont **figées** (P4). HUD debug : **`N◆ M△/posés`**. Vérifié par e2e (17 posés, 9 types,
  bascule silhouette→détail en s'approchant) + preview (4◆/10△ au camp, 1◆/13△ après `/tp town`).
  *S'imbrique avec la Phase 5 du monde (le détail explorable des sites reste M9).*
- **P6 — Leviers globaux & adaptatif : résolution adaptative. ✅ FAIT (partiel, assumé).** Levier
  **`hardware scaling`** manuel (stepper HUD **« résolution »**, % de pixels) + mode **« perf auto »**
  qui vise un **FPS cible** (~55) en montant/baissant la résolution interne, bande morte anti-oscillation
  ([`autoperf.ts`](../src/render/autoperf.ts), pur, **5 tests** ; bascule à ~1 Hz dans la boucle). Levier
  **prévisible** : ne touche ni la géométrie ni les post-process. Vérifié par e2e (round-trip du levier
  + auto sans casse). **Différé volontairement** : *(1) `freezeActiveMeshes` global* — **fragile** avec
  notre streaming + le (dé)chargement LOD (set de meshes actifs qui change sans cesse → meshes
  invisibles si mal resynchronisé, cf. §7) ; le **gel par objet** (P4 : `freezeWorldMatrix`) capte déjà
  l'essentiel sans ce risque. *(2) `SceneOptimizer`* — écarté au profit d'un contrôleur **maison** qui
  ne joue QUE sur la résolution (SceneOptimizer désactive aussi post-process/ombres → dégradations
  visuelles surprenantes). *(3) `cullingStrategy`* — gain marginal pour nos meshes, non prioritaire.
- **P7 (scale) — Web workers** pour la génération/scatter hors thread principal.

À mesure que P2→P4 réduisent le coût par chunk lointain, on **augmente la *view range* par défaut** :
c'est ce qui réalise l'objectif « voir loin qu'il y a des zones à explorer ».

---

## 7. Pièges à éviter

- **Ne pas geler toute la scène** d'un coup (`freezeActiveMeshes` global) si des entités bougent :
  geler **par zone**, et **reset** quand le set de chunks change (sinon meshes invisibles).
- **Thin instances ≠ cullées individuellement** : utiles seulement là où on accepte que tout le lot
  s'affiche dès que le chunk est visible (donc plutôt **par chunk**, déjà borné).
- **`addLODLevel` + instances** : le LOD vit sur le mesh source ; valider le comportement sur nos
  instances (au pire, gérer la bascule à la main via le `EntityManager`).
- **Créer/disposer chaque frame** = pire que tout : toute bascule de palier passe par `enter()`, jamais
  par frame.
- **Mesurer** avant/après chaque jalon : une « optim » non mesurée peut empirer les choses (ex. trop
  d'octrees, freeze mal placé).

---

## 8. Sources

- [Optimizing Your Scene — Babylon.js Documentation](https://doc.babylonjs.com/features/featuresDeepDive/scene/optimize_your_scene)
- [Levels of Detail (LOD) — Babylon.js Documentation](https://doc.babylonjs.com/features/featuresDeepDive/mesh/LOD)
- [Simplifying Meshes With Auto‑LOD — Babylon.js Documentation](https://doc.babylonjs.com/features/featuresDeepDive/mesh/simplifyingMeshes/)
- [Thin Instances — Babylon.js Documentation](https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/thinInstances)
- [Instances — Babylon.js Documentation](https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/instances)
- [Open world optimization — Babylon.js Forum](https://forum.babylonjs.com/t/open-world-optimization/37045)
- [Best practice for instances and culling — Babylon.js Forum](https://forum.babylonjs.com/t/best-practice-for-instances-and-culling/30814)
- [Creating thousands of animated entities in Babylon.js — Medium](https://babylonjs.medium.com/creating-thousands-of-animated-entities-in-babylon-js-ce3c439bdacf)
- [Improving Performance in BabylonJS — mikecann.blog](https://mikecann.blog/posts/improving-performance-in-babylonjs)
