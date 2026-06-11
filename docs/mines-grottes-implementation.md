# Mines & grottes — plan d'implémentation étape par étape (M9)

> Plan d'exécution concret du jalon **M9**, ancré dans le code réel. Conception & décisions :
> **[`mines-grottes-souterrains.md`](mines-grottes-souterrains.md)** ; jalon : **[`roadmap.md`](roadmap.md)** /
> **[`roadmap-v2.md`](roadmap-v2.md)** (M9 + M8 combat).
>
> **Décisions actées rappelées** : Option **A** (massif au niveau du sol, on ne troue pas le heightmap) ·
> exploration **physique** (pas d'embranchements HTML) · **torche fidèle ADR** (1 bois + 1 étoffe, requise pour
> entrer, consommable, affichée sur le modèle 3D) · **butin = objets 3D** au **sac du joueur**, **commun à toute
> la carte** (premier-servi, hôte arbitre) · **sécuriser un filon suffit** ⇒ métier · **grotte nettoyée ⇒
> avant-poste** · **combat = M8** (documenté, hors M9).
>
> ### État d'avancement
> - ✅ **S1 — État + graphe (sim pure)** *(2026-06-11)* : `src/sim/dungeon.ts` (`dungeonFor`/`lootForNode`/
>   `lootNodeIds` purs, déterministes) ; champ `GameState.sites{type,discovered,taken,hazards,secured,cleared}`
>   + helper `siteKey` ; 5 actions `DISCOVER_SITE`/`TAKE_LOOT`/`CLEAR_HAZARD`/`SECURE_MINE`/`CLEAR_CAVE` (+ cases
>   reducer, **TAKE_LOOT premier-servi = no-op**). Champ additif (back-fillé au boot, pas de bump save).
> - ✅ **S2 — Mine ⇒ métier** *(2026-06-11)* : `Job.siteType` + métiers `iron_miner`/`coal_miner`/
>   `sulphur_miner` ; garde `ASSIGN_WORKER` (verrouillé sans filon sécurisé) ; la boucle de revenu existante les
>   fait produire ⇒ ressuscite acier→balles.
> - ✅ **R1 — Intérieur jouable « Option A » + colliders localisés + obscurité locale** *(2026-06-11)* :
>   `src/render/interior.ts` (classe `Interiors`) — bâtit/libère l'intérieur du `cave`/`*mine` le plus proche
>   (hystérésis build 44 u / free 64 u, **un seul actif**), massif au sol + sol/parois-en-anneau-avec-bouche/
>   plafond (colliders `PhysicsAggregate` BOX, patron `Cabin`), bouche **face au camp**, filons/torche **émissifs**,
>   **obscurité LOCALE** (baisse `hemi`/`sun` du client sous plafond — pas de désync). Câblé dans `main.ts`
>   (création + `setMap` au boot/seed + `update` par frame). **Vérifié en jeu (WebGPU)** : grotte & mine se
>   bâtissent à l'approche (21 colliders), se libèrent au loin, joueur **stable sur le sol** (ne traverse pas),
>   `inside` true/false correct, `dark` 0↔1, **0 erreur, 120 FPS**.
> - ✅ **P1 — Torche craftable** *(2026-06-11)* : `data/world.ts` `craftableItems`+`torch` (recette 1 bois +
>   1 étoffe, `building:null`) + `craftableItemById` ; action `CRAFT_ITEM` (débite l'entrepôt → ajoute au sac,
>   borné capacité). 3 tests.
> - ✅ **R2 — Torche sur le joueur + gate d'entrée** *(2026-06-11)* : `characters.ts` `buildPlayer` → nœud
>   `torch` (manche + flamme émissive) attaché au bras droit `armR` (oscille à la marche, masqué par défaut) ;
>   `player.ts` `setTorch(carried, lit)` + `PointLight` suiveuse (scintillante) ; `interior.ts` **barrière de
>   seuil** à la bouche (corps physique ⇔ pas de torche) + flag `blocked` ; `main.ts` calcule `hasTorch`,
>   `interiors.update(...,hasTorch)`, `player.setTorch(...)`, toast « il fait trop noir » au front.
> - ✅ **R3 — Verbes focus + butin 3D ramassable** *(2026-06-11)* : `interior.ts` expose `activeLoot()` +
>   `applyProgress(sites)` (masque les caches **pris**) ; `main.ts` `computeFocus` ajoute « ramasser » (cache) /
>   « exploiter le filon » (mine `deep` → `takeLoot` + `secureMine`) → butin au SAC, premier-servi.
> - **Vérifié en jeu (WebGPU)** : sans torche → bouche **bloquée** (`barrierOn`/`blocked` true) ; torche →
>   gate ouvert, `inside`, obscurité ; **ramassage cache** → `{torch}`→`{torch,cloth,leather}` ; **2ᵉ ramassage =
>   no-op** (premier-servi) ; **filon ironmine** → `iron:8`+`coal:2` au sac + `secureMine`. 0 erreur.
> - ✅ **P2 — Rendu `outpost`** *(2026-06-11)* : `sites.ts` `SITE_TYPES`+`SIL_TINT`+`buildSite` case `outpost`
>   (appentis toile/poteaux + petit feu émissif + caisses/tonneau + mât à fanion).
> - ✅ **R4 — Grotte nettoyée ⇒ avant-poste** *(2026-06-11)* : `reducer` `TAKE_LOOT` auto-`cleared` quand TOUS
>   les caches d'une `cave` sont pris ; `sites.ts` `PlacedSite` porte un modèle ALTERNATIF outpost (instancié
>   pour chaque grotte) + `applyBand`/`setCleared` (override LOD : grotte nettoyée → montre l'avant-poste) ;
>   `interior.ts` `setClearedKeys` (plus d'intérieur pour une grotte nettoyée — usage unique) ; `main.ts`
>   reflectState calcule l'ensemble `cleared` → `sites.setCleared` + `interiors.setClearedKeys`.
> - **Vérifié en jeu (WebGPU)** : vider TOUTE une grotte (`takeAllLoot` 2 caches → sac `+meat:2 +scales:3`) ⇒
>   `cleared` ⇒ **intérieur retiré** (`built:0` même au centre) ⇒ rendu avant-poste activé ; 0 erreur, 120 FPS.
> - **Vérifié (global)** : `tsc` OK, **159 tests** (+21 M9), `build` OK.
>
> ### ✅ M9 « entrer/explorer/ramasser » COMPLET (S1·S2·R1·P1·R2·R3·P2·R4)
> Boucle jouable de bout en bout : *fabriquer une torche → entrer (gate ADR) → ramasser le butin 3D
> (premier-servi, sac) → sécuriser un filon (⇒ métier) → vider une grotte (⇒ avant-poste) → déposer*. **Différé
> (v3+ / autres jalons)** : hazards à coût, **consommation** de la torche, événements de lieu, **Option B**
> (vraie descente) + tunnels-couloirs précis, **effet** d'avant-poste (eau/voyage = M6/M7), **combat = M8**.

---

## 0. Principes directeurs (à ne jamais casser)

1. **Ordre d'ajout** (convention repo) : `data/` → `sim/` (+ tests) → `render/`/`ui/` → `net/`. On code et
   teste la **logique pure** AVANT le rendu.
2. **Déterminisme** : disposition du donjon + tables de butin = **fonctions pures de la graine**
   (`worldSeed`), jamais stockées. L'**état d'exploration** (`sites{}`) vit dans `GameState` (snapshot + save).
   Tout tirage aléatoire de gameplay passe par `state.rng` (`cloneRng` + `nextFloat`/`nextInt`).
3. **P2P hôte-autoritaire** : les nouvelles actions sont des `PlayerAction` JSON, filtrées par
   `isNetworkSafeAction` ; l'hôte applique via `reduce()` et diffuse le snapshot. Le **premier-servi** du butin
   est garanti par l'hôte (champ `taken`).
4. **Pas de trou dans le terrain** : `terrainHeight(x,z)` reste **intacte** (Option A). L'intérieur est un
   **volume mesh autonome** (sol/parois/plafond) au niveau du sol, avec ses **propres colliders**.
5. **Le rendu/éclairage est LOCAL & cosmétique** : l'obscurité de grotte se règle **par client** (chaque pair
   assombrit SON hemi/soleil quand SON joueur est sous plafond). Aucun pair n'en dépend → pas de désync.
6. **`carried` (sac) n'est PAS persisté** (vidé au boot, cf. `save.ts:19`) : le butin ramassé mais **non
   déposé** est perdu au rechargement — cohérent avec « rapporter au coffre ». L'état `sites{}` (ce qui est
   pris/sécurisé/nettoyé), lui, **est** persisté (champ additif → pas de bump de `VERSION`).

---

## 1. Prérequis (à débloquer avant les grottes)

Ces deux briques sont nécessaires au gating ADR mais sont aujourd'hui **absentes** ; on les pose d'abord,
minimalement.

### P1 — Objet `torch` craftable (1 bois + 1 étoffe)
- **Pourquoi** : la torche **gate** l'entrée des grottes. Le système d'objets d'atelier est prévu **M10** ;
  on **avance** juste la torche (ou on la fabrique au feu de camp en v1 pour ne pas bloquer).
- **`data/world.ts`** : nouvelle table `craftableItems: CraftableItem[]` (parallèle à `craftables`
  bâtiments) avec
  ```ts
  export interface CraftableItem { id: string; name: string; type: "good"|"tool"|"weapon";
    building: string | null; recipe: Record<string, number>; }
  // v1 : building:null (fabricable au feu) ; M10 : building:"workshop"
  { id: "torch", name: "torche", type: "tool", building: null, recipe: { wood: 1, cloth: 1 } }
  ```
- **`src/sim/actions.ts`** : `CraftItemAction { type:"CRAFT_ITEM"; playerId; itemId }` + `craftItem(...)`.
- **`src/sim/reducer.ts`** : case `CRAFT_ITEM` — vérifie le bâtiment requis (si non null) + les ressources
  (depuis l'entrepôt `state.resources`), débite, ajoute 1 `torch` au **sac** `carried[playerId]`.
- **Tests** : craft débite l'entrepôt + crédite le sac ; refus si ressource manquante ; déterminisme.

### P2 — Type de site `outpost` rendu
- **Pourquoi** : « grotte nettoyée ⇒ avant-poste » a besoin d'un visuel d'avant-poste.
- **`src/render/sites.ts`** : ajouter `"outpost"` à `SITE_TYPES`, une entrée `SIL_TINT.outpost`, et un
  `case "outpost"` dans `buildSite()`. **Le modèle existe déjà au labo** (`model-lab.html` entrée `outpost` —
  bâche en `CreateRibbon`, feu extérieur, viande séchée). ⚠️ `CreateRibbon`/`CreateTube` **ne sont pas** dans
  le kit jeu → ajouter les helpers à `lowpoly.ts`/`scatter.ts` OU simplifier le modèle au portage.
- Pas de logique ici (le rendu d'`outpost` sera **déclenché** par l'état `cleared` à l'étape 6).

> P1 et P2 sont **indépendants** → parallélisables. Aucun des deux ne touche encore aux grottes.

---

## 2. Étape S1 — État d'exploration & graphe de donjon (sim pure, AUCUN rendu)

**But** : poser la donnée + la logique déterministe, testées, sans toucher au 3D.

### S1.1 — Générateur de donjon pur
- **Nouveau fichier `src/sim/dungeon.ts`** :
  ```ts
  export interface DungeonNode { id: string; kind: "junction"|"chamber"|"deadend"|"deep"; depth: number;
    pos: { x: number; z: number }; loot?: Record<string, number>; }
  export interface DungeonSegment { from: string; to: string; } // tunnels
  export interface Dungeon { nodes: DungeonNode[]; segments: DungeonSegment[]; }
  export function dungeonFor(type: string, cx: number, cz: number, worldSeed: number): Dungeon;
  ```
- **Pur** : RNG local `createRng(cellSeed(cx,cz,worldSeed))` (réutilise le mécanisme de `worldgen.ts`, **PAS**
  `state.rng`). Profil par type : `*mine` = court (bouche → 1 `junction` → 1 `deep`=filon) ; `cave` = ramifié
  (2-3 branches, `chamber`/`deadend`, profondeur ↑ avec la distance au camp via `maxRadiusCells`).
- **Tables de butin** : `lootFor(type, node, worldSeed)` pur → `Record<resource, qty>` (fer/charbon/soufre,
  + écailles/dents/fourrure/étoffe pour `cave`). Ressources **déjà déclarées** (`RESOURCE_RARITY`/`LABELS`).
- **Tests** (`dungeon.test.ts`) : `dungeonFor` **identique pour même (type,cx,cz,seed)** ; mine = exactement 1
  nœud `deep` ; cave ramifiée a ≥ 2 branches ; loot reproductible.

### S1.2 — Champ d'état `sites{}` dans GameState
- **`src/sim/state.ts`** : ajouter au `GameState` + `createInitialState` (= `{}`) :
  ```ts
  sites: Record<string, {            // clé = "cx,cz"
    discovered?: boolean;
    taken?: Record<string, boolean>; // nodeId -> butin déjà pris (premier-servi GLOBAL)
    secured?: boolean;               // mine : filon sécurisé
    cleared?: boolean;               // grotte : entièrement nettoyée -> avant-poste
  }>;
  ```
- **Additif** → `save.ts` le back-fille par `{...createInitialState(), ...saved}` au boot (cf. règle
  `migrateSave`) : **pas de bump `VERSION`**. Vérifier que `saveGame` ne le strip pas (il ne strip que
  `carried`).
- Helper `siteKey(cx,cz) => \`${cx},${cz}\``.

### S1.3 — Les 5 actions pures
- **`src/sim/actions.ts`** (suivre le patron `gatherWood`, champ `playerId`, ajouter à `GameAction` **et**
  `PlayerAction`) :
  - `DISCOVER_SITE { playerId, cx, cz }` → `sites[k].discovered = true` (cosmétique/fog).
  - `TAKE_LOOT { playerId, cx, cz, nodeId }` → **premier-servi** : si `sites[k].taken[nodeId]` ⇒ **no-op**
    (renvoie `state` inchangé). Sinon : calcule `lootFor(...)`, l'ajoute au **sac** (borné par
    `carryCapacity(state) - carriedTotal(state,pid)`), marque `taken[nodeId]=true`.
  - `CLEAR_HAZARD { playerId, cx, cz, nodeId }` → débite un coût/outil, marque le nœud dégagé.
  - `SECURE_MINE { playerId, cx, cz }` → `sites[k].secured = true` (⇒ métier, étape S2).
  - `CLEAR_CAVE { playerId, cx, cz }` → `sites[k].cleared = true` (⇒ avant-poste, étape 6).
- **Toutes immuables** : cloner `sites` + l'entrée, `cloneRng(state.rng)` si tirage.
- **`isNetworkSafeAction`** les accepte déjà (non-DEBUG + `playerId` vérifié) — rien à changer.

### S1.4 — Tests sim (`sim.test.ts`)
- `TAKE_LOOT` ajoute au sac + borne à la capacité ; **2ᵉ `TAKE_LOOT` sur le même nodeId = no-op**
  (premier-servi) ; loot reproductible à graine.
- `SECURE_MINE` pose `secured` ; idempotent.
- `CLEAR_CAVE` pose `cleared` ; idempotent.
- **Déterminisme global** : même séquence (discover/loot/secure/clear + ticks) ⇒ `toEqual`.

> ✅ **Jalon S1 « done »** : `npm test` vert, état & graphe purs, **zéro rendu**, déterminisme prouvé.

---

## 3. Étape S2 — Mine sécurisée ⇒ métier de mineur (économie)

**But** : brancher le filon sécurisé sur la chaîne industrielle morte.

- **`data/world.ts`** :
  - Étendre `Job` avec `siteType?: string` (ex. `"ironmine"`).
  - Ajouter les métiers : `{ id:"iron_miner", name:"mineur de fer", building:null, siteType:"ironmine",
    stores:{ "cured meat": -1, iron: 1 } }` (+ `coal_miner`/`sulphur_miner`). *(Coût d'entretien : viande
    séchée, façon ADR — à équilibrer.)*
- **`src/sim/reducer.ts`** `case "ASSIGN_WORKER"` : ajouter la garde
  ```ts
  if (job.siteType) {
    const ok = Object.entries(state.sites).some(([k, s]) =>
      s.secured && siteTypeOf(state, k) === job.siteType); // siteTypeOf via la carte/worldgen
    if (!ok) return state; // métier verrouillé tant qu'aucune mine du bon type n'est sécurisée
  }
  ```
  *(Le type d'un site se relit depuis la carte déterministe ; sinon stocker `type` dans `sites[k]` lors du
  `SECURE_MINE`.)*
- **Boucle de revenu** : **déjà implémentée** (`reducer.ts` cycle income, tout-ou-rien) → dès que le mineur
  est assignable + assigné, il **produit** sur le cycle. Rien à ajouter côté production.
- **Tests** : mineur **non-assignable** sans mine sécurisée ; **assignable** après `SECURE_MINE` ; il produit
  du fer au cycle de revenu ; la chaîne acier→balles redevient atteignable.

> ✅ **Jalon S2 « done »** : sécuriser la mine de fer (action sim) débloque le mineur **et** ressuscite
> acier/balles, prouvé par test — toujours sans rendu d'intérieur.

---

## 4. Étape R1 — Intérieur 3D « Option A » + colliders (rendu statique)

**But** : on entre physiquement dans une grotte et on en ressort, **sans transition**. Pas encore de
butin/torche.

### R1.1 — Modules d'intérieur (mesh)
- **Nouveau `src/render/interior.ts`** : `buildInterior(K: VCKit, dungeon: Dungeon): TransformNode`.
  Modules **instanciés** le long du graphe (segment droit, coude, carrefour, chambre) via le kit
  `makeVCKit(scene, sink, glowSink)` (vertex colors + accents `emi`/`unlit` → glow). Sol + parois + **plafond
  mesh** (le plafond occulte le soleil ; teintes sombres). Bouche **coudée** (la lumière du dehors n'entre
  pas). Sol ~au **niveau du terrain** à la bouche (Option A : pas de descente).
- Style cohérent : palette pierre (`P.stoneDark`), filons **émissifs** comme repères.

### R1.2 — Manager d'intérieur localisé (colliders + build/free)
- **Décision d'archi** : NE PAS passer par les 3 bandes de `EntityManager` (full/minimal/culled). Créer un
  **`InteriorManager`** dédié (calqué sur **`cabin.ts`** + la **localisation physique du terrain**
  `terrain.ts` `PHYS_R`) :
  - garde une distance joueur↔bouche ; sous un seuil (~30 u) → **build** le mesh intérieur + **colliders** ;
    au-delà → **dispose** (mesh + `physicsBody`).
  - **Colliders** = `PhysicsAggregate` BOX/MESH `mass:0` pour sol/parois/plafond — **copier le patron
    `rebuildColliders(tier)` de `cabin.ts`** (dispose + rebuild, coords locales tournées via un `vAt`).
  - **Un seul** intérieur actif à la fois (le joueur n'est que dans un) → budget mesh/collider maîtrisé.
- Le joueur étant une **capsule Havok dynamique**, prévoir un **seuil de bouche franchissable** (cf. fix
  cabane `SINK` : éviter un rebord > ~0.25 u qui bloque l'entrée).

### R1.3 — Obscurité locale (cosmétique, par client)
- **`src/render/scene.ts`** (ou un petit contrôleur) : quand le **joueur local** est « sous plafond »
  (drapeau de `InteriorManager`), **baisser en douceur** `hemi.intensity`/`sun.intensity` **localement** et/ou
  monter un brouillard sombre ; restaurer à la sortie. **Local uniquement** (l'autre pair gère son propre
  éclairage) → aucune désync.
- Repères visibles via accents **émissifs** (glow déjà en place) même sans torche (la torche vient en R2).

### R1.4 — `isGrounded` sous terre
- `player.ts` `isGrounded` lit `terrainHeight` analytique → imparfait sur sol mesh. Acceptable (sauter sous
  terre = marginal) ; si besoin, OR-er avec un raycast court vers le bas sur les colliders d'intérieur.

> ✅ **Jalon R1 « done »** : on marche dans une grotte (1 bouche coudée + 1-2 chambres), colliders OK, il fait
> sombre, on ressort — **même monde, aucune transition**. Vérif : capture + eval numérique (min Y, colliders
> présents près du joueur / absents au loin).

---

## 5. Étape R2 — Torche fidèle ADR (gate + modèle joueur + lumière)

**But** : la torche conditionne l'entrée et s'affiche sur le joueur.

### R2.1 — Modèle de torche attaché au joueur
- **`src/render/characters.ts`** `buildPlayer()` : exposer un **nœud d'attache** (main droite, près de
  `armR`/y≈0.9, ou dos) et renvoyer `torchNode`. Y bâtir un petit **mesh torche** (manche + tête émissive),
  désactivé par défaut.
- **`src/render/player.ts`** : stocker `torchNode` + méthode `setTorch(carried: boolean, lit: boolean)` qui
  l'active quand `carried` et, si `lit`, allume une **`PointLight` suiveuse** (chaude, range ~12-15, flicker —
  calquer `createCampfire` dans `world.ts`).

### R2.2 — Câblage état → rendu
- **`src/main.ts`** (dans `reflectState()`/boucle) :
  ```ts
  const hasTorch = (state.carried[self()]?.torch ?? 0) > 0;
  const underground = interiorMgr.isLocalPlayerInside();
  player.setTorch(hasTorch, hasTorch && underground);
  ```

### R2.3 — Gate d'entrée (pas de torche ⇒ on ne s'enfonce pas)
- **`InteriorManager`** / **`main.ts`** : à la **bouche**, si `hasTorch === 0`, **bloquer la progression**
  (collider de seuil actif + `hud.toast("il fait trop noir — il te faut une torche")`). Avec torche : on entre
  (et v3 : consommation).

### R2.4 — Consommation (peut être v3)
- Décrément temporel de `carried[pid].torch` sous terre (action sim `CONSUME_TORCH` ou tick local borné) ;
  « plusieurs torches pour aller plus loin ». **Reportable en v3** si on veut R2 minimal d'abord.

> ✅ **Jalon R2 « done »** : sans torche on ne rentre pas (toast) ; avec, la torche **apparaît sur le joueur**
> et éclaire ; co-op : chaque client gère sa lumière.

---

## 6. Étape R3 — Verbes d'interaction & butin 3D ramassable

**But** : relier le focus existant aux actions sim et matérialiser le butin.

### R3.1 — Objets de butin 3D dans les nœuds
- **`src/render/interior.ts`** : poser des **objets ramassables** (instances + petit collider/trigger de
  pickup) aux nœuds `chamber`/`deep`, selon `dungeonFor`. Ils **disparaissent chez tous** dès que le nœud est
  `taken` (lecture de `state.sites[k].taken[nodeId]`).

### R3.2 — Verbes de focus
- **`src/main.ts`** `computeFocus()` : ajouter des `consider(...)` (patron existant) pour les nœuds proches :
  - **« ramasser »** → `emit(takeLoot(self(), cx, cz, nodeId))`
  - **« miner »** (nœud `deep` d'une mine) → `emit(secureMine(self(), cx, cz))`
  - **« forcer le passage »** (hazard) → `emit(clearHazard(...))`
  - **« fouiller »**/**« entrer/découvrir »** → `emit(discoverSite(...))`
- Affichage via `hud.setPrompt(verb, screenX, screenY)` (déjà en place).
- **« nettoyer la grotte »** : `emit(clearCave(...))` quand tous les nœuds `cave` sont `taken` (peut être
  auto-déclenché dans le reducer au dernier `TAKE_LOOT`).

### R3.3 — Flux réseau (premier-servi visible)
- `emit()` → hôte applique `TAKE_LOOT` (no-op si déjà pris) → diffuse le snapshot → **tous** voient l'objet
  disparaître. Rien de spécial à ajouter : c'est le flux host-autoritaire existant + le no-op du reducer (S1.3)
  qui garantissent le premier-servi.

> ✅ **Jalon R3 « done »** : on ramasse un objet 3D qui **disparaît chez l'autre pair** ; « miner » sur le
> filon **débloque le mineur** (chaîne S2) ; les caches vidées restent vidées (save + réseau).

---

## 7. Étape R4 — Grotte nettoyée ⇒ avant-poste

- **`src/render/sites.ts`** : au rendu d'un site, si `state.sites[siteKey]?.cleared` ⇒ **remplacer le visuel**
  par `"outpost"` (modèle de P2). C'est un **override d'état** (le `type` worldgen reste `cave`, seul le rendu
  change).
- **Effet d'avant-poste** (recharge eau + voyage rapide) : **dépend de M6/M7 (survie)** → poser le **hook**
  (`isOutpost(siteKey)`), implémenter l'effet quand la survie existe. Documenter la dépendance.
- **Tests** : `CLEAR_CAVE` pose `cleared` ; (rendu vérifié en jeu) la grotte affiche l'avant-poste.

> ✅ **Jalon R4 « done »** : une grotte entièrement vidée se **transforme en avant-poste** (visuel), prêt à
> recharger l'eau quand M6/M7 seront là.

---

## 8. Étape V3+ — Tension & finitions (différé, fidèle ADR)

- **Hazards** : éboulements à **forcer** (outil/coût) — `CLEAR_HAZARD` déjà posé ; bloquer un tunnel tant que
  non dégagé.
- **Torche consommable** (R2.4 si reportée) + profondeur ⇒ plus sombre ⇒ risque.
- **Événements de lieu** : réutiliser le **moteur d'événements M5** déclenché à l'entrée d'une `chamber`.
- **Combat sous terre** : **M8** (séparé). M9 expose seulement les emplacements de rencontre ; ennemis
  fidèles ADR (Lézard des cavernes 6 PV/3 dég, Bête grognante 5 PV/1 dég) — voir roadmap M8.
- **Option B** (cuvette + plafond, vraie descente) : possible **plus tard** sans rejouer l'intérieur (A et B
  partagent 90 % du code, seule la bouche diffère).
- **Fog-of-war** (Phase 6) : `discovered` déjà posé.

---

## 9. Séquencement & dépendances

```
P1 (torche craft) ─┐
P2 (rendu outpost) ─┤(parallèles, prérequis)
                    │
S1 (état+graphe, sim+tests) ─► S2 (mine⇒métier, sim+tests)
                    │
                    └─► R1 (intérieur+colliders) ─► R2 (torche gate+modèle) ─► R3 (verbes+butin 3D) ─► R4 (cave⇒outpost)
                                                                                                   │
                                                                                          V3+ (hazards/conso/events) · M8 (combat) · Option B
```

- **Chemin critique jouable minimal** : P1 → S1 → R1 → R2 → R3 (= « entrer avec torche, ramasser, ressortir »).
- **Chemin économie** : S1 → S2 (indépendant du rendu — testable seul, livre la résurrection acier/balles).
- **Parallélisable** : P1 ∥ P2 ∥ (S1 puis S2) côté sim pendant que R1 démarre le rendu.

---

## 10. Récap des fichiers touchés

| Fichier | Étape | Geste |
|---|---|---|
| `data/world.ts` | P1, S2 | `craftableItems`+`torch` ; `Job.siteType`+mineurs ; (équilibrage butin) |
| `src/sim/dungeon.ts` *(nouveau)* | S1.1 | `dungeonFor()`/`lootFor()` purs (RNG = `cellSeed`) |
| `src/sim/state.ts` | S1.2 | champ `sites{}` + init |
| `src/sim/actions.ts` | P1, S1.3 | `CRAFT_ITEM` ; `DISCOVER_SITE/TAKE_LOOT/CLEAR_HAZARD/SECURE_MINE/CLEAR_CAVE` |
| `src/sim/reducer.ts` | P1, S1.3, S2 | cases nouvelles + garde `ASSIGN_WORKER` (siteType) |
| `src/sim/sim.test.ts` + `dungeon.test.ts` | S1, S2 | premier-servi, mine⇒métier, déterminisme |
| `src/save.ts` | S1.2 | (vérif : `sites{}` persisté, additif, pas de bump) |
| `src/render/interior.ts` *(nouveau)* | R1, R3.1 | `buildInterior()` + objets de butin 3D ; `InteriorManager` (colliders localisés) |
| `src/render/sites.ts` | P2, R4 | `outpost` (type+sil+case) ; override rendu si `cleared` |
| `src/render/lowpoly.ts`/`scatter.ts` | P2 | helpers `CreateRibbon`/`CreateTube` (pour l'outpost) |
| `src/render/characters.ts` | R2.1 | nœud d'attache + mesh torche sur le joueur |
| `src/render/player.ts` | R2.1 | `torchNode` + `setTorch()` + PointLight suiveuse |
| `src/render/scene.ts` | R1.3 | assombrissement local sous plafond (cosmétique) |
| `src/main.ts` | R2.2, R3.2 | `setTorch` ; verbes focus `ramasser/miner/forcer/fouiller` ; gate torche |

---

## 11. Définition de « terminé » pour M9

- On **entre/sort** d'une grotte **sans transition** ; il fait sombre ; la **torche** est requise et s'affiche
  sur le joueur.
- On **ramasse des objets 3D** ajoutés au **sac** ; le butin est **global premier-servi** (disparaît chez
  l'autre pair) ; on les **dépose** au coffre (flux existant).
- **Sécuriser une mine** débloque le **mineur** et **ressuscite acier→balles**.
- Une **grotte nettoyée devient un avant-poste**.
- **Tests sim** verts (déterminisme, premier-servi=no-op, mine⇒métier, cave⇒outpost) ; `tsc` + build OK ;
  60 FPS tenus (un seul intérieur actif, colliders localisés).
- **Combat = hors M9** (M8). **Option B / hazards / conso de torche = v3+**.
