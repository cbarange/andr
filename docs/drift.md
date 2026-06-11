# Document de DRIFT — A Dark Room 3D

> Analyse complète de l'existant à un instant T : **ce qui s'est écarté des spécifications initiales**
> (les principes de [`architecture.md`](architecture.md) §3 et la roadmap de [`roadmap.md`](roadmap.md)),
> la **dette technique** et les **opportunités d'optimisation**. Établi par audit en éventail des
> 4 sous-systèmes (sim/données, rendu, réseau/persistance/UI, orchestrateur/outils dev).
>
> **Baseline = les principes documentés** : `sim/` pur & déterministe (RNG à graine, pas de
> `Math.random`/Babylon/DOM, reducer non-mutant) · données dans `data/` · **P2P hôte-autoritaire**
> (le snapshot porte TOUT l'état autoritaire) · rendu sans règles · UX diégétique · fidélité ADR.
>
> Codebase : **~10,7k lignes** (≈ ×3 depuis M5). `main.ts` = 1139 lignes. Beaucoup de mécanismes
> ajoutés **sans mise à jour des docs**.

---

## 0. TL;DR — le plus important

| # | Sujet | Gravité | Effort | Où |
|---|---|---|---|---|
| 1 | ✅ **FAIT** — `cabinTier` (et tout l'état) dans le snapshot via **sérialiseur unique** (état complet) | 🔴 Haute | XS | `net/messages.ts`, `main.ts` snapshot/adopt |
| 2 | ✅ **FAIT** — `builderTendingUntil` synchronisé (inclus dans l'état complet) | 🟠 Moy | XS | idem #1 |
| 3 | ✅ **FAIT** — `isNetworkSafeAction` : l'hôte refuse les `DEBUG_*` du réseau + l'usurpation de `playerId` | 🟠 Moy | S | `actions.ts`, `main.ts onGameAction` |
| 4 | **`dev/commands.ts` (cheats) embarqué en prod** + mutateurs `window.__game` non gardés | 🟠 Moy | S | `main.ts:54-56,1002-1083` |
| 5 | ✅ **FAIT** — split-brain résolu déterministe (`resolveHostOnSync` : plus petit id parmi hôtes fixés) | 🟡 Lat | M | `net/host.ts`, `net/room.ts` |
| 6 | ✅ **FAIT** — plus de rafale : échéances + `rng` synchronisés (état complet) | 🟡 Lat | S | idem #1 |
| 7 | **`main.ts` god-object (1139 l.)** + schéma snapshot dupliqué 3× | 🟡 Dette | M | `main.ts` |
| 8 | **Bâtiments/cabane n'utilisent PAS merge+instance** → explosion de draw calls · *plan détaillé : [`todo-batiments-merge-instance.md`](todo-batiments-merge-instance.md)* | 🟡 Perf | M | `buildings.ts`, `lowpoly.ts` |
| 9 | **Allocations par frame** (player vel, listes terrain/obstacles, `reflectState`, `JSON.stringify`) | 🟡 Perf | S→M | `player.ts:179`, `main.ts:733-833,922-925` |

**Bonne nouvelle** : le **cœur `sim/`+`data/` est SAIN** — zéro `Math.random`/Babylon/DOM, RNG à graine
partout, reducer non-mutant, données pures. Le **socle perf** (streaming par chunks, LOD, instancing
des arbres/décor/sites, autoperf) est **bien conçu**. Le drift est concentré dans le **réseau** (champs
oubliés), l'**outillage dev** (exposé en prod) et la **dette de structure** (main.ts, bâtiments).

> **Décisions (juin 2026, post-audit — cf. [`roadmap-v2.md`](roadmap-v2.md) Chantier A) :**
> - **#4 outils dev en prod** → ⏸️ **DIFFÉRÉ** : on **garde** les cheats (phase dev, besoin de tester).
>   À reprendre au build de prod / ouverture du multi public. *(Le risque réseau est déjà couvert par
>   `isNetworkSafeAction` ; reste le cheat local + le poids de bundle.)*
> - **#8 bâtiments merge+instance** → ⏸️ **DIFFÉRÉ** : analyse d'effets de bord faite. Un merge **naïf**
>   casserait l'**animation de chantier** (montée pièce par pièce) + fumée + états de piège. **Chemin sûr**
>   identifié : ne jamais merger le **chantier en cours** (toujours unique, non mergé), merger **seulement
>   les bâtiments achevés** (coque statique, fumée exclue), pièges à part. L'animation n'est **pas** un
>   bloqueur. Détail : `roadmap-v2.md` A5.
> - **A3 robustesse P2P** → ✅ **FAIT** : heartbeat + **failover par époque** (Raft-lite) — `resolveSync`/
>   `shouldTakeOver` purs & testés (`net/host.ts`), `room.checkLiveness` câblé dans la boucle ; STUN publics +
>   slot TURN dans `rtcConfig`. Reste (infra) : un vrai serveur TURN pour les NAT symétriques.
> - **A4 migration de save** → ✅ **FAIT** : `migrateSave` (pure, testée) — on ne jette plus les saves
>   anciennes (back-fill additif au boot ; migration pour les changements cassants) ; `carried` non sérialisé.

> **MAJ juin 2026 — depuis l'audit (beaucoup de contenu ajouté) :** Chantier C (refonte monde/campement)
> **TERMINÉ**, M9 (grottes/mines explorables + avant-postes) **fait**, **routes** (R1 variété ~57 sites + R2
> réseau fusionnant) **faites**. Conséquences sur la dette :
> - **#7 `main.ts` god-object** : a encore GROSSI (interactions M9, confort, routes, ocean…) → le **refactor
>   (A6)** devient plus pressant (extraire `net/sync`, `ui/dialogues`, `interactions`, reflectState).
> - **Nouveaux modules sains** (purs/locaux, bien rangés) : `sim/dungeon.ts`, `sim/roads.ts`,
>   `render/interior.ts` · `ocean.ts` · `campLights.ts` · `campRuins.ts` ; `data/world.ts` a grossi
>   (borderField, generateCampLayout, sites étendus) — envisager de le **scinder** par domaine.
> - **Nouvelle petite dette** : la teinte de ROUTE ne retire pas les props déjà dispersés (re-scatter des
>   chunks concernés à prévoir) ; le `cache` réutilise une ruine de village (modèle dédié possible).
> - **Toujours valable** : #4 (outils dev en prod, différé), #8 (bâtiments merge+instance, différé),
>   #9 (allocations par frame — `Vector3`/`JSON.stringify`/listes reconstruites).

---

## 1. Drift fonctionnel / roadmap

La roadmap prévoyait **M6 (rempart/porte/zone sûre/ravitaillement) → M7 (monde+survie) → M8 (combat)
→ M9 (sites/mines)**. La réalité :

- **M7 a été construit AVANT M6, et seulement sa moitié « rendu ».** Tout le stack monde existe et
  marche : `sim/worldgen.ts` (biomes par viscosité ADR + sites en anneaux, **pur & déterministe**,
  graine `worldSeed`), `render/terrain.ts` (streaming par chunks + LOD + colliders Havok localisés),
  `scatter.ts`/`trees.ts` (dispersion biome-aware), `entities.ts`/`proplod.ts` (LOD), `autoperf.ts`.
  → **C'est le plus gros écart de doc** (etat.md le donnait « pas encore là »).
- **M6 quasi absent.** Aucun `gate`/`rampart`/`palissade`/`wall`/`inSafeZone`/`outfit` dans `src/`.
  Seul `VILLAGE_RADIUS`/`safeRadiusCells` sert… à décider si un panneau d'événement est modal
  (`main.ts:52,808`). Pas de mur physique, pas de seuil de porte, pas de panneau de ravitaillement.
  → Le monde M7 est atteignable mais **la frontière « retranchement » dont il dépend a été sautée**.
- **Survie (eau/nourriture) — cœur de M7 — 0 % dans la sim.** `GameState` n'a ni `water`/`food`/
  `health` ; aucune action d'expédition/outpost/mort-à-sec. **Sortir du camp ne coûte rien.**
- **M8 combat — 0 %** (aucun `ATTACK`/`health`/`encounters` ; seules les tables existent dans le texte
  de la roadmap).
- **M9 sites — stub.** Les sites sont placés et dessinés (silhouettes, `render/sites.ts`), la table
  complète des anneaux (3 mines, épave, exécuteur) est dans `data/world.ts:709-718`, **mais** aucune
  machine de setpiece, aucune entrée, aucun « nettoyer la mine ⇒ débloque le mineur ». `sites.ts:6`
  diffère explicitement l'entrée à M9. → La branche fer/charbon→acier→balles reste donc dormante.
- **Mécanismes nouveaux / hors-roadmap** (polish ou infra) : palier de cabane (`cabinTier` 0/1/5/10 =
  multiplicateur de capacité, `UPGRADE_CABIN`), caps de stockage par rareté de ressource, sol de camp
  dessiné + chemins (`campGround`/`campPaths`), **traînées émergentes** (`trails.ts`), décor de sol
  (`campDecor`), **console dev + ~25 commandes** (`dev/`), **éditeur de spawn F2** (`spawnEditor.ts`),
  adaptive perf, partage de lien P2P.
- **Docs périmées** : `etat.md`/`roadmap.md` ne mentionnent ni worldgen, ni streaming, ni sites, ni
  palier de cabane, ni la console/éditeur dev. **À resynchroniser** (le présent doc + une MAJ d'etat.md).

> **Verdict roadmap** : le projet a **front-loadé l'infra de rendu lourde (M7) et l'outillage** au lieu
> de suivre M6→M7→M8→M9. Ce n'est pas « mauvais » (l'archi monde est le vrai risque technique, le
> sortir tôt est défendable), mais **la sim de gameplay (survie/combat/sites) est en retard d'un cran
> sur le rendu** : on a un monde superbe et traversable où il ne se passe encore rien dehors.

---

## 2. Drift d'architecture / des principes

### 2.1 P2P : le snapshot ne porte PAS tout l'état autoritaire 🔴
Principe : *« le snapshot transporte TOUT l'état autoritaire »*. Comparaison `GameState`
(`state.ts:18-88`) ↔ `StateSyncMsg` (`messages.ts:24-44`) + `snapshot()`/`adoptSnapshot()`
(`main.ts:247-299`) :

- **`cabinTier` MANQUANT** (état autoritaire, lu côté client) → **bug** : un invité garde son
  `cabinTier` local (0) même après réparation/upgrade par l'hôte. `cabinRepaired` est adopté mais pas
  `cabinTier` → incohérence (`cabinRepaired===true` mais `cabinTier===0`). Désync visible sur :
  `storageCap(state.cabinTier,…)` (`main.ts:391,1038`), `cabin.setTier()` (`main.ts:769`, mauvais mesh),
  dialogue d'upgrade (`main.ts:452`). Le commentaire de `messages.ts:28` ne liste même que
  `cabinRepaired`. **Régression « j'ai ajouté un mécanisme, oublié de le synchroniser »** (le palier a
  pourtant bumpé la version de save, `save.ts:11`).
- **`builderTendingUntil` MANQUANT** (autoritaire, lu en rendu client `main.ts:752`) → l'anim « va
  raviver le feu » ne joue pas / mal chez l'invité (il compare le `tick` adopté de l'hôte à son propre
  `builderTendingUntil` figé). Cosmétique, mais c'est bien un champ hôte lu par du rendu non-hôte.
- **Deadlines non synchronisées** (`fireCoolAt`, `tempAdjustAt`, `builderAdvanceAt`,
  `builderTendReadyAt`, `stokeReadyAt`, `popGrowAt`, `incomeAt`, `eventScheduledAt`) : **OK tant qu'on
  reste client** (les clients ne tournent pas `TICK`), **mais risque latent à la migration d'hôte** —
  un client promu hérite de SES deadlines périmées et du `tick` adopté (très en avance) →
  `tick >= incomeAt/popGrowAt/eventScheduledAt` instantanément vrai → **rafale** de revenus/population/
  événements au 1er tic autoritaire. (`rng` non synchronisé est OK par design, mais aggrave la
  divergence de timeline après promotion.)

### 2.2 P2P : élection d'hôte & confiance réseau 🟠
- **Split-brain à deux `forcedHost`** : si deux pairs cliquent « Ouvrir ma partie » dans le même salon
  (ou via un lien au même code), chacun a `forcedHost=true` et **ignore les snapshots de l'autre**
  (`room.ts:106`). → deux autorités qui divergent, rien ne le détecte/résout.
- **Pas d'epoch/heartbeat** : `announcedHost` se met à jour à *chaque* snapshot reçu (`room.ts:107`) et
  n'est nettoyé qu'au départ du pair (`:125`). Un hôte qui se tait (onglet en arrière-plan : il sauve
  mais ne diffuse pas) **fige la sim** chez les autres sans timeout. `onStateSync` adopte même un
  snapshot d'un pair non-autoritaire (pas de champ « je suis l'hôte / epoch » dans le message).
- **L'hôte applique tout `gameAction` entrant sans validation** (`main.ts:702`) — et `PlayerAction`
  **inclut les `DEBUG_*`** (`actions.ts:181-190` : `DEBUG_UNLOCK_ALL`, `DEBUG_SET_SEED`,
  `DEBUG_ADD_POP`, `DEBUG_GRANT`…). Un client malveillant/ancien peut **griefer l'état autoritaire**.
  De plus l'hôte fait confiance au `playerId` *embarqué* dans l'action, pas au `fromId` réseau.
  → Min. : refuser les `DEBUG_*` venant du réseau ; idéalement vérifier `action.playerId === fromId`.

### 2.3 Outillage dev exposé en production 🟠
- Les 3 modules `dev/*` sont **importés statiquement** en tête de `main.ts:54-56` ; leur *usage* est
  gardé par `if (import.meta.env.DEV)` (`main.ts:1088`). Résultat (vérifié sur le bundle `dist`) :
  `console.ts` et `spawnEditor.ts` sont **tree-shakés**, mais **`commands.ts` SHIP en prod** (ses
  `const COMMANDS`/`ALIASES` construits depuis les données du jeu ne sont pas élagués) → **toutes les
  commandes de triche (`/unlock`,`/give`,`/build`,`/seed`,`/noclip`,`/event`…) sont dans le bundle**.
- Les hooks `window.__game.*` **mutateurs** (`fillStorage`, `setCabinTier`, `triggerEvent`,
  `fastForward`, `clearSave`, `build`, `teleport`, `pauseEventScheduler`…) sont assignés **hors** garde
  DEV (`main.ts:1002-1083`) → présents en prod. Seuls `__game.cmd`/`editSpawn` sont gardés.
  → Fix : `await import()` des 3 modules dev *dans* le bloc DEV ; gicler/garder les mutateurs `__game`.

### 2.4 Ce qui RESPECTE les principes (pas de drift) ✅
- **`sim/` + `data/` purs & déterministes** : aucun `Math.random`/`Date.now`/`performance.now`/Babylon/
  DOM en code de prod (seuls hits = commentaires/tests). `data/world.ts` n'importe `GameState` qu'en
  **type** (effacé). RNG à graine threadé partout ; reducer non-mutant.
- **Exhaustivité reducer SAINE** : le `default` (`reducer.ts:653`) est un check `never` compile-time ;
  les 22 membres du `GameAction` ont un `case`. (Mon inquiétude du tour précédent était infondée une
  fois les `case` M5 ajoutés.)
- **`worldgen.ts` déterministe** depuis `worldSeed`, pur (pas de Babylon).
- **Rendu sans règles de jeu** : aucun calcul de ressources/victoire/RNG-gameplay dans `src/render/`.
  Seule logique « locale assumée » : la coupe d'arbres sauvages décrémente `chopsLeft`/`felled` en
  rendu (`terrain.ts:438-470`) — **sanctionné par la doc** (état local non synchronisé).
- **`hud.ts` est view-only** (542 l. de DOM, aucune règle), **localStorage = persistance seule**,
  `discovered` (UI) gardé **hors** de `GameState` (`save.ts:47-65`). Bonne hygiène.
- **`Math.random` côté UI uniquement** : `genRoomCode` (`main.ts:711`) et dispersion de l'éditeur —
  hors sim, acceptable (à commenter pour ne pas le confondre avec une violation).

---

## 3. Dette technique

### 3.1 Structure / orchestration
- **`main.ts` god-object (1139 l., un seul `boot()`)** mêle ≥ 11 responsabilités : boot moteur, physique,
  construction monde/terrain/sites, load/merge état, **couche P2P** (snapshot/adopt/emit/join), toutes
  les interactions diégétiques, **tous les builders de dialogue**, routeur clavier, `computeFocus`,
  boucle à pas fixe, autosave, autoperf, overlay debug, surface `window.__game` (~45 clés), wiring dev.
  Cibles d'extraction : `net/sync.ts` (snapshot/adopt/emit/join, ~120 l.), `ui/dialogues.ts`
  (buildChoices/workerSteppers/eventView/rootView/format*, ~250 l.), `interactions.ts`,
  `reflectState`/render-loop.
- **Schéma du snapshot dupliqué 3×** : `snapshot()` + `adoptSnapshot()` + `createInitialState` listent
  les mêmes champs → tout nouveau champ = footgun 3 éditions **et c'est exactement comme ça que
  `cabinTier` a été oublié**. → un seul sérialiseur/liste de champs.
- **Deux surfaces de debug parallèles** : `window.__game.*` et `dev/commands.ts` (verbes qui se
  recouvrent : `triggerEvent`, `fastForward`, `clearSave`…).

### 3.2 Sim
- **`case "TICK"` monolithique (~190 l.,** `reducer.ts:463-651`) : 6+ sous-phases inlinées (feu, temp,
  builder, population, income, tending, événements) → extraire en helpers purs (comme `applyEffect`).
- **`EffectDraft` dupliqué 4×** (`reducer.ts:330,374,430,577`) → helper `draftFrom(state)`.
- **Règle « bûcheron = le reste » dupliquée 3×** (`state.ts:107`, `reducer.ts:521`, `main.ts:755/778`).
- **Config morte / data-driven incomplet** : `config.relief` déclare `octaves/baseFrequency/lacunarity/
  gain` **non lus** par `terrainHeight` (`world.ts:262` ne lit que `amplitude`) ; nombreux littéraux de
  fréquence/amplitude inline (`world.ts:235-271`). `worldgen.ts` a des magiques (`0.4+…*0.55`,
  `tries<200`, offsets de hash) hors data.
- **Idiome de garde RNG fragile** (`rng = rng===state.rng ? clone : rng`, 4 occurrences) : correct
  aujourd'hui mais l'invariant « toujours passer par le `rng` local après clone » est implicite.

### 3.3 Rendu
- **Bâtiments/cabane n'utilisent PAS le pattern merge+instance** que le reste du code a établi
  (arbres/décor/sites). `buildings.ts` (692 l.) = 8 builders à la main, chaque bâtiment = des dizaines
  de meshes primitifs `lowpoly` **flat-shadés un par un** (`lowpoly.ts:136`) jamais mergés → **un hut =
  des dizaines de draw calls, un village = des centaines** ; les `trap` (×N, ~20 meshes chacun) et huts
  identiques sont **reconstruits** au lieu d'être instanciés. C'est le plus gros gisement de draw calls.
- **Helpers dupliqués** : `paint()`/`paintFlat()` (vertex colors) en 3 copies (`trees.ts:40`,
  `scatter.ts:22`, `sites.ts:56`) ; `lerpAngle`/`approachAngle` ×2 (`remotePlayer.ts:19`,
  `villagers.ts:93`) ; **anim de chute/wobble d'arbre dupliquée** entre `forest.ts:158` et
  `terrain.ts:480` (mêmes constantes `WOBBLE_TIME=0.32` etc.) ; **deux kits low-poly parallèles**
  (`lowpoly.ts` lit vs `scatter.ts` VC) avec interfaces `Dim/Opt` dupliquées.
- **Pas de teardown/dispose** pour les modules « permanents du camp » : colliders de `buildings`
  (`addCollider` jamais tracké, `:569`), textures de `cabin` (chest/board DynamicTextures, ≤15),
  `ParticleSystem`+texture de `forest`, DynamicTextures de `trails`/`campPaths`. → fuite uniquement à
  la **régénération** (`/seed`) et dans l'éditeur de spawn, pas en jeu normal — mais réel pour ces flux.
- **Couleurs/dimensions en `number[]` magiques** partout dans les builders (pas de palette nommée,
  contourne le typage).

### 3.4 Persistance
- **`save.ts` sérialise tout `GameState`** dont `carried` (sacs de tous les pairs) et `rng` ; `carried`
  est re-vidé au load (`main.ts:194`) mais reste **écrit** sur disque (blob gonflé).
- **Pas de migration** : version ≠ ⇒ save jetée (`loadGame:30`) ; les nouveaux champs sont back-fillés
  par spread seulement si la version matche.

---

## 4. Optimisations (perf)

> Le socle (streaming chunks, LOD `entities`/`proplod`, instancing arbres/décor/sites, `autoperf`,
> matrices figées, build amorti) est **solide**. Les gains restants sont concentrés dans le **glue**
> qui tourne **chaque frame**, et dans les **bâtiments du camp**.

1. **Allocations par frame (GC churn)** :
   - `player.ts:179` : `setLinearVelocity(new Vector3(...))` **chaque frame** → `Vector3` scratch + `set`.
   - `main.ts:922-925` : `[ {x,z}, ...remotes.positions() ]` + `remotes.positions()` (`remotePlayer.ts:101`)
     + `terrain.syncPhysics` `positions.map(...)` (`terrain.ts:212`) → **3 alloc/frame** même en solo.
   - **`reflectState()` tourne CHAQUE frame** (`main.ts:733-833`) et reconstruit `new Set()` (×2),
     `roleCounts`, `entries.map(...)`, et fait **`JSON.stringify(state.resources)` par frame** quand un
     panneau d'événement est ouvert (`:828-830`). → cadencer sur le tic / dirty-flag.
   - `computeFocus()` (`main.ts:621-682`) chaque frame : closures `make`, `new Vector3` par branche, et
     `forest.getTrees()` **réalloue la liste d'arbres vivants à chaque appel** (`forest.ts:123`).
   - `villagers.update` : `landmarks.obstacles()` **réalloué chaque frame** (`buildings.ts:479`) puis
     steering O(48 × bâtiments) en deux passes → cacher les obstacles (invalidés à `village.sync`).
2. **Bâtiments → merge+instance** (cf. 3.3) : merger les parts par bâtiment (1 root flat-shadé → 1-2
   draw calls) et instancier les bâtiments identiques. **Le plus gros gain draw-call statique.**
3. **Snapshot = deep-copy à chaque action + 2 Hz** (`main.ts:247`) : le reducer renvoyant déjà des objets
   immuables, les spreads défensifs sont largement superflus (Trystero sérialise en JSON de toute façon).
4. **Terrain** : `paintGround` alloue un `Array` JS par chunk (`terrain.ts:282`) → `Float32Array` ; le
   toggle de texture repeint **tous** les chunks chargés d'un coup (pic de frame, `:240`) ; 3 boucles
   plein-chunks/frame reparsent la clé `"cx,cz"` (`:144,191,217`) → stocker `cx/cz` numériques.
5. **`updateDiscovered()`** itère tous les craftables chaque frame (`main.ts:322`) → sur changement de
   ressources seulement.

---

## 5. Recommandations (ordre conseillé)

1. ✅ **FAIT — snapshot = état complet** (🔴 #1/#2/#6) : `StateSyncMsg = { state: GameState, host }`,
   `snapshot()` = `structuredClone(state)`, `adoptSnapshot()` = remplacement intégral. Corrige
   `cabinTier`/`builderTendingUntil`, synchronise échéances + `rng` (plus de rafale post-migration), et
   **supprime la duplication 3× du schéma** (cause-racine de l'oubli). Invariant de sérialisation testé.
2. ✅ **FAIT — durcissement réseau** (🟠 #3/#5) : `isNetworkSafeAction` (refus `DEBUG_*` réseau +
   usurpation `playerId`) ; `resolveHostOnSync` (split-brain déterministe, plus petit id parmi hôtes
   fixés) + toast d'avertissement. Tests unitaires : 4 (host) + 3 (garde) + invariant.
3. **Gater l'outillage dev** (🟠 #4) : `await import()` des modules dev dans le bloc DEV ; sortir les
   mutateurs `window.__game` du prod. ⟵ *reste à faire*
5. **Perf glue** (🟡 #9) : `Vector3` scratch joueur, buffers réutilisés terrain/obstacles, cadencer
   `reflectState` (dirty-flag), supprimer le `JSON.stringify` par frame.
6. **Bâtiments merge+instance** (🟡 #8) — gain draw-call, effort M.
7. **Refactor `main.ts`** (🟡 #7) en modules (`net/sync`, `ui/dialogues`, `interactions`).
8. **Resync des docs** : MAJ `etat.md`/`roadmap.md` (M7 rendu fait, M6 sauté, survie/combat/sites à
   faire) — ce `drift.md` en est la base.

> Aucun de ces points n'est bloquant pour jouer en solo. Les **#1–#4** touchent la **coop** et la
> **sécurité** (triche) ; les **#5–#8** sont de la **scalabilité** pour quand le monde se peuplera.

---

## 6. Menu de construction (constructrice) vs A Dark Room

Analyse dédiée des **propositions de build** et de leurs **conditions d'apparition**, comparées à la
source ADR (`room.js` : `Craftables`, `Room.craftUnlocked` ligne 1073). **Décisions actées** ci-dessous ;
plan d'implémentation détaillé : **[`build-craft-plan.md`](build-craft-plan.md)**.

| Réf | Écart constaté | Décision |
|---|---|---|
| **D1** | révélation à **bois 100 %** (ADR : **50 %**) | **Aligné ADR** (½ du bois) — ✅ **FAIT** (Phase 1) |
| **D2** ⭐ | autres ingrédients exigés en **totalité** (ADR : **≥ 1 « vu »**) → on ne « tease » pas les objectifs | **Aligné ADR** (ingrédient vu) — ✅ **FAIT** (Phase 1) |
| **D3** | aucune notification (ADR : message « builder says… ») | **« ! » au-dessus de la constructrice** + **badge « nouveau »** (+ message ADR en survol) — ✅ **FAIT** (Phase 2) |
| **D4** | gate via **cabane réparée** (ADR : `builder lvl 4`) | **Garder** (notre mécanisme) |
| **D5** | objets cachés sans **atelier** (`needsWorkshop`) | **Atelier = station d'artisanat interactive** (E sur le bâtiment) — divergence assumée — *Phase 4 (futur)* |
| **D6** | hutte **moitié prix** (`50+25` vs `100+50`) | **Aligné ADR** (`100 + n×50`) — ✅ **FAIT** (Phase 3) |
| **D7** | « agrandir l'entrepôt » ×5/×10 (hors ADR) | **Garder** (modèle sac/entrepôt maison) |
| **D8** | biens/outils/armes absents du menu | **Via l'atelier** quand ils arriveront (M6/M8) — *Phase 4* |

> **Cœur de l'alignement** : D1+D2 restaurent la **révélation progressive** d'ADR — on voit tôt les
> bâtiments lointains (grisés, avec leur coût) comme **objectifs**, au lieu de ne les dévoiler qu'une
> fois entièrement payables. La révélation reste un **état UI local** (`discovered`, non synchronisé)
> qui lit l'entrepôt autoritaire → aucun impact P2P/déterminisme.
