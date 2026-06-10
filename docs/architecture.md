# Architecture — A Dark Room 3D

Doc technique de référence (état réel du code). Pour **où on en est / quoi reprendre**, voir
[`docs/etat.md`](etat.md). Pour **le jeu d'origine + la roadmap**, voir [`docs/roadmap.md`](roadmap.md).

---

## 1. Idée directrice : cerveau / corps / interface / réseau

Le code est strictement stratifié. Cette séparation est **non négociable** (elle garantit testabilité,
déterminisme et P2P) :

| Couche | Dossier | Rôle | Dépend de Babylon/DOM ? |
|---|---|---|---|
| **Cerveau** | `src/sim/` | état + règles du jeu, **pur & déterministe** | **NON** (testable au terminal) |
| **Données** | `data/world.ts` | tout le contenu/équilibrage (source de vérité) | non |
| **Corps** | `src/render/` | rendu 3D Babylon.js | oui |
| **Interface** | `src/ui/hud.ts` | surcouche HTML/CSS (HUD, dialogues, menu) | DOM |
| **Entrées** | `src/input/` | clavier → intentions ; souris → caméra (pointer lock) | DOM |
| **Réseau** | `src/net/` | P2P WebRTC via Trystero | non (browser API) |
| **Persistance** | `src/save.ts` | sauvegarde auto (localStorage) | localStorage |
| **Orchestration** | `src/main.ts` | assemble tout + boucle à pas fixe | oui |

Règle d'or : **le rendu et l'UI LISENT l'état de la sim et ÉMETTENT des actions ; ils ne contiennent
aucune règle de jeu.** Toute mutation de l'état passe par une **action** appliquée par le **reducer**.

---

## 2. Carte des fichiers (à jour)

```
data/world.ts              DONNÉES : config (réglages), craftables (bâtiments), jobs (métiers),
                           trapDrops, positions d'arbres, terrainHeight(), libellés FR.
src/
  sim/                     LE CERVEAU (pur, sans Babylon/DOM)
    state.ts               GameState (structure) + helpers (carried/freeWorkers/carryCapacity…)
    actions.ts             actions nommées & sérialisables (+ PlayerAction = ce qui circule sur le réseau)
    reducer.ts             reduce(state, action) -> nouvel état (pur, déterministe). Cœur des règles.
    rng.ts                 mulberry32 à graine (tout aléatoire de la logique passe par là)
    sim.test.ts            35 tests (npm run test) — sans Babylon
  render/                  LE CORPS (Babylon.js)
    scene.ts               moteur WebGPU→WebGL2, lumières, fog, post-process, PALETTE
    physics.ts             chargement du plugin Havok (WASM depuis public/)
    world.ts               terrain (relief + collision) + feu de camp (intensité = niveau du feu)
    forest.ts              arbres = ressource FINIE qui repousse (coupe en 3 coups -> chute -> repousse)
    cabin.ts               cabane ruine→réparée : entrepôt (coffre + étagères révélées + grand tableau)
    buildings.ts           village : bâtiments low-poly + fumée (production) + proie des pièges
    villagers.ts           avatars de population (cosmétique)
    stranger.ts            la constructrice (PNJ) qui arrive au feu
    player.ts              capsule physique Havok : gravité, collisions, saut, teleport(debug)
    camera.ts              ArcRotateCamera de suivi 3e personne (orbite pilotée par pointerLook)
    remotePlayer.ts        avatars des autres joueurs (interpolés)
    audio.ts               AUDIO (présentation) : Babylon AudioV2, bus master/musique/SFX, musique
                           de l'état du feu (fondu enchaîné), SFX. Lit l'état, ne le mute jamais.
  ui/hud.ts                HUD (sac, feu, village), étiquette d'interaction, DIALOGUES (clavier+souris),
                           menu PARAMÈTRES (centré, contient le multijoueur)
  input/
    input.ts               clavier -> intentions (ZQSD/WASD/flèches, saut, interagir)
    pointerLook.ts         capture du pointeur : souris = caméra ; libérée en UI ; clic pour (ré)activer
  net/
    room.ts                salon Trystero, élection d'hôte (ouvreur épinglé / défère au diffuseur), envoi/réception
    messages.ts            types des messages (PlayerTransformMsg, GameActionMsg, StateSyncMsg)
  save.ts                  saveGame/loadGame/clearSave (localStorage, façon ADR)
  main.ts                  point d'entrée : init, boucle à pas fixe, dialogues, interactions, réseau, save
tests/e2e.spec.ts          Playwright (3 tests) : boucle complète, P2P smoke, sauvegarde/rechargement
```

---

## 3. Le modèle d'état (`GameState`, `src/sim/state.ts`)

`GameState` est un **objet JSON pur** (sérialisable → réseau + sauvegarde). Champs :

- `tick` — n° de tic de simulation (pas fixe).
- **`resources`** : `Record<res,nombre>` — l'**ENTREPÔT** du village (partagé/autoritaire). Rempli par
  les ouvriers + les dépôts ; consommé par la construction & les chaînes de métiers.
- **`carried`** : `Record<playerId, Record<res,nombre>>` — le **SAC** de chaque joueur (plafonné).
  Rempli par la récolte manuelle ; nourrit le feu / répare la cabane ; se vide à l'entrepôt.
- `cabinRepaired` — la cabane est-elle réparée (débloque entrepôt + construction).
- `buildings` : `Record<id,nombre>` — bâtiments construits (= l'état de déblocage des métiers).
- `population`, `workers` (`Record<job,nombre>`), `producing` (`Record<job,bool>` = a produit au
  dernier cycle, pour le feedback visuel).
- `fire` (0 mort..4 rugissant), `temperature` (0..4), `builder` (-1 absente, 0..3 prête).
- Échéances en n° de tic (déterminisme pur) : `fireCoolAt`, `tempAdjustAt`, `builderAdvanceAt`,
  `stokeReadyAt`, `popGrowAt`, `incomeAt`, et **`trapReadyAt`** (`Record<index,tic>` : chaque piège
  a son PROPRE rechargement → on relève les pièges **un par un**, voir §9).
- `rng` — état du générateur à graine.

### Les DEUX stocks (décision structurante)

| | **Sac** (`carried[pid]`) | **Entrepôt** (`resources`) |
|---|---|---|
| plafonné | oui (`carryCapacity` = base + charrette) | non |
| rempli par | récolte manuelle (couper, relever pièges) | **ouvriers (auto)** + dépôts |
| consommé par | **nourrir le feu**, **réparer la cabane** | **construction**, chaînes de métiers |
| P2P | par joueur, **dans l'état autoritaire** (host) | partagé/autoritaire |

C'est ce qui re-rythme la récolte façon A Dark Room : friction manuelle au début (sac plafonné →
allers-retours au coffre), puis **l'automatisation par les ouvriers la soulage** (l'entrepôt se
remplit seul). Détails : section « Refonte récolte & cabane » de la roadmap.

---

## 4. Flux : actions → reducer → rendu

1. Le joueur/la boucle émet une **action** (`src/sim/actions.ts`). `PlayerAction` = actions joueur
   (récolte, feu, build, dépôt, réparation, métiers, pièges) ; `TICK` = avance du temps (boucle).
2. **`reduce(state, action)`** (`src/sim/reducer.ts`) renvoie un **nouvel état** — fonction PURE :
   - ne mute jamais l'entrée ; même (état, action) ⇒ même sortie partout ;
   - aucun `Math.random()` (utilise `state.rng`) ; aucune dépendance Babylon/DOM.
   - C'est **le seul endroit** où les règles vivent (feu, température, étrangère, population,
     revenus tout-ou-rien, famine, construction, pièges…).
3. La **boucle à pas fixe** (`main.ts`, 20 Hz via un accumulateur) applique `TICK` côté autorité,
   puis le **rendu lit `state`** chaque frame (`reflectState`) et interpole.

### Boucle à pas fixe (extrait conceptuel, `main.ts`)
- côté **autorité** (hors-ligne ou hôte) : `while (acc >= tickMs) state = reduce(state, tick())` ;
  diffusion d'un snapshot throttlé ; sauvegarde auto throttlée.
- toujours : entrées → joueur ; interaction E ; caméra suit ; reflet de l'état → HUD/rendu ;
  diffusion de la position.

---

## 5. Déterminisme & RNG

- `src/sim/rng.ts` = **mulberry32** à graine ; l'état du RNG fait partie de `GameState`.
- **Aucune** logique n'appelle `Math.random()`. Tout tirage (butin des pièges, intervalle d'arrivée
  des villageois) passe par `state.rng`. Vérifié par des **tests de replay** (même graine + même
  séquence ⇒ état identique).
- Les fonctions purement **visuelles** (scintillement du feu, fumée, déambulation des villageois)
  peuvent utiliser `Math`/le temps : elles ne touchent pas l'état autoritaire.

---

## 6. Réseau P2P (`src/net/`, `main.ts`)

- **Trystero** (stratégie *Nostr* par défaut → relais publics, **rien à héberger**). `room.ts` :
  `joinRoom`, 3 canaux (`xform`, `gameAct`, `sync`).
- **Élection d'hôte** :
  - **« Ouvrir ma partie »** (`join(code, cb, asHost=true)`) → `forcedHost` : CE pair reste l'hôte
    autoritaire tant qu'il est connecté (les autres adoptent SON état) ; il **ignore** les états reçus.
  - **« Rejoindre »** (`asHost=false`) → on **défère au pair qui diffuse l'état** (`announcedHost`,
    capturé via `ctx.peerId` du `sync`). Bootstrap / ré-élection (si l'hôte part) = **id le plus petit**.
  - Décision pure & testée à chaque `sync` reçu : **`resolveHostOnSync`** (`net/host.ts`) → `defer`
    (non-fixé : s'aligner) · `ignore` (hôte fixé : garder l'autorité) · `yield` (collision de **deux**
    hôtes fixés → le **plus petit id** gagne, l'autre cède via `onSplitBrain`). Garantit que l'ouvreur
    ne se fait pas « voler » l'autorité par un invité, et que deux ouvreurs convergent.
  - **Anti-triche** : l'hôte n'applique une action réseau que si `isNetworkSafeAction` (pas de `DEBUG_*`
    venant d'un pair, pas d'usurpation de `playerId`).
- **Modèle hôte-autoritaire** :
  - `playerTransform` : position/rotation d'avatar, **diffusé par chaque pair**, **interpolé** chez
    les autres (`remotePlayer.ts`). La **physique est locale** à chaque joueur.
  - `gameAction` (= une `PlayerAction`) : un client l'envoie **à l'hôte** ; l'hôte l'applique.
  - `stateSync` (= `StateSyncMsg`, snapshot de l'état autoritaire) : l'hôte rediffuse ; les clients
    **adoptent** (ils n'avancent PAS le temps eux-mêmes).
- Le `StateSyncMsg` transporte **l'état autoritaire COMPLET** : `{ state: GameState, host: {id, forced} }`.
  `GameState` est conçu sérialisable (cf. `state.ts`) → un **sérialiseur unique** (`snapshot()` =
  `structuredClone(state)`, `adoptSnapshot()` = remplacement intégral) évite tout champ oublié (c'est
  ainsi que `cabinTier` avait été manqué) et transmet aussi les **échéances + le `rng`**, si bien qu'un
  client promu hôte reprend la timeline **sans rafale**. `host` = revendication d'autorité (anti
  split-brain). Invariant : l'état doit rester JSON-sérialisable (test de round-trip dans `sim.test.ts`).
- Hors-ligne, le joueur EST l'autorité (tout est local & instantané) — c'est le mode principal.

---

## 7. Sauvegarde automatique (`src/save.ts`)

Inspirée d'A Dark Room (`localStorage.gameState = JSON.stringify(State)`).
- `saveGame(state)` → `localStorage["darkroom3d.save"] = {version, state}`.
- `loadGame()` → l'état sauvegardé, ou `null` (absent/incompatible : bump `VERSION` pour invalider).
- Dans `main.ts` : au boot, on **restaure** (`{ ...neuf, ...sauvegarde, carried: {} }` — remplit les
  champs manquants si le schéma évolue ; le sac repart vide car `selfId` change à chaque session).
  Sauvegarde **toutes les ~15 s** (si autorité) + à `beforeunload`/`visibilitychange`.
- La **sim reste en mémoire** ; localStorage ne sert qu'à la persistance (≠ logique de jeu).

---

## 8. Souris / caméra / Échap / dialogues (le sujet le plus subtil)

But : **immersif**. En jeu, la souris EST la caméra (curseur masqué). En interface, la souris est libre.

- **`src/input/pointerLook.ts`** (capture du pointeur / pointer lock) :
  - **Jeu** (aucune UI) : pointeur **capturé**, curseur masqué, `mousemove` → orbite (alpha/beta),
    molette → **rayon VOULU** (`pointerLook.desiredRadius` ; on ne touche plus `camera.radius` direct).
    Un **clic initial** active la capture (exigence navigateur).
  - **UI ouverte** : `release()` → curseur **libre** pour cliquer. `engage()` (appelé dans le geste
    de fermeture) **recapture**. Indice « cliquez pour orienter » seulement quand non capturé & hors UI.
- **Spring-arm (collision caméra)** (`main.ts`, boucle) : le **rayon EFFECTIF** se rapproche si un mur
  s'interpose entre la cible (tête du joueur) et la caméra — raycast vers `cabin.occluders()` près de
  la cabane ; rapprochement rapide (anti-clip), éloignement doux (lerp). → dans la cabane, la caméra
  passe **sous le toit, à l'intérieur** (≈ épaule), au lieu d'être bloquée par les murs. *(Étape 1 de la
  refonte caméra ; étapes suivantes prévues : bascule 1ʳᵉ personne sur arme/grotte — transition lissée.)*
- **`Échap`** (géré dans `main.ts`, global) : si une UI est ouverte → la **ferme** ; sinon → ouvre le
  **menu Paramètres**. (Échap libère aussi le lock côté navigateur — voulu, car le menu veut le curseur.)
- **Dialogues** (`hud.ts`) : cliquables à la souris **ET** navigables au clavier (`ZQSD`/flèches +
  `E`/Entrée ; surlignage de la sélection). Recomposés « en place » après une action via
  `refreshDialogue` (conserve la sélection).
  - **Constructrice** : une fois la cabane réparée, lui parler ouvre **directement la liste de
    construction** (`rootView` délègue à `buildView`, plus d'écran d'intro « construire »).
  - Un choix **non disponible** porte une **info-bulle au survol** (`DialogueChoice.tooltip`) — ex.
    « il manque : 53 bois ». Subtilité : un `<button disabled>` ne reçoit pas les événements de
    survol, donc on le laisse **actif mais grisé** (classe `.disabled`) et on neutralise le clic.
- **`hud.interactiveOpen`** = un dialogue OU le menu est ouvert → le déplacement du joueur est
  neutralisé et le pointeur est libéré.

### Interactions diégétiques (`main.ts`)
- `computeFocus()` choisit, chaque frame, l'interactable le plus proche dans son rayon : feu,
  constructrice, coffre/tableau (si cabane réparée), pièges, arbres. Il produit un **verbe**
  (« couper », « nourrir le feu », « relever le piège », « parler », « déposer », « organiser le village »)
  projeté en **étiquette flottante** au-dessus de l'objet ; `E` déclenche l'action du focus.

---

## 9. Rendu (notes par module)

- **`scene.ts`** : `createEngine` (WebGPU prioritaire, repli WebGL2 dans un try/catch) ; fog exp2 ;
  hémisphérique + directionnelle ; post-process léger (color grading, vignette, grain, FXAA, bloom).
  `PALETTE` = source de vérité des couleurs (crépusculaire/froide).
- **`forest.ts`** : arbres = base mesh instanciée. Chaque arbre a une **réserve finie** (`chopsPerTree`) ;
  un coup le rétrécit, déclenche une **petite secousse amortie** + une **bouffée de feuilles**, au dernier
  il **tombe et disparaît** ; un autre **repousse** ailleurs après `treeRegrowSeconds`. État **local** au
  joueur (non synchronisé), collider statique par arbre. Les feuilles = **un seul `ParticleSystem`
  réutilisé** (au repos hors coupe, bouffées manuelles `manualEmitCount`) → très léger.
- **`cabin.ts`** : ruine → réparée (échange de meshes). Intérieur **où l'on entre** (murs + porte +
  collisions) : un **coffre** (dépôt), des **étagères** (une par ressource **découverte**, panneau de
  quantité ; cachées tant que non découvertes) et le **grand tableau** d'organisation (population +
  métiers, DynamicTexture, miroir U corrigé). Le tableau s'agrandit avec les métiers débloqués.
- **`buildings.ts`** : bâtiments low-poly placés en anneaux **déterministes** (cohérence P2P) ;
  **fumée** sur ceux dont le métier produit (`setActivity`) ; **proie** sur chaque piège **plein**
  (`setTrapsReady(indices)`). Les pièges se relèvent **un par un** (`E` ne relève que le piège ciblé,
  et seulement s'il est plein) — chacun se vide puis se recharge indépendamment. Le **délai de
  rechargement est tiré au hasard dans `[trapsCooldownMinSeconds, trapsCooldownMaxSeconds]`** (45–65 s)
  **par piège et à chaque relève**, via le RNG à graine → déterministe et cohérent en P2P.
- **`villagers.ts`** : avatars cosmétiques de la population. Chaque villageois = **capsule + tête +
  « nez »** (qui pointe dans sa direction de marche, même langage que le joueur). Variations
  **déterministes** par index (`hash(i)`) : taille, tenue (couleur), tête → on les distingue comme des
  **individus** (apparence identique chez tous les pairs). **Déplacement « par métier »** : chaque
  avatar reçoit un rôle (depuis la répartition des `workers`, bûcheron = le reste) et **se déplace vers
  les repères correspondants** — bûcheron : arbre ↔ cabane (dépôt) ; piégeur : un piège ↔ camp ;
  chasseur : la lisière ↔ le feu ; métier de bâtiment : autour de son bâtiment ; sinon repos au feu.
  Les repères (`VillageLandmarks`) sont fournis par `main.ts` (`forest.getTrees`,
  `village.getTrap/BuildingPositions`, `cabin.center`). Steering trivial (ligne droite vers une cible +
  pause de « travail »), `y` via `terrainHeight`, **aucune physique/pathfinding** → très léger.
  **Gestes de travail** pendant la pause, selon le métier et le lieu : bûcheron → balancement de
  **coupe** (`rotation.x`), piégeur → **accroupi** sur le piège (`scaling.y`), chasseur → **guet**
  (balaie l'horizon), métier de bâtiment → affairé ; au repos/retour, simple flottement.
  **Purement local et NON synchronisé** (comme la forêt) : zéro coût réseau, aucun impact déterminisme ;
  `Math.random` est admis ici car cosmétique. Plafond à 48 avatars.
- **`player.ts`** : capsule Havok dynamique, inertie nulle (reste debout), vitesse contrôlée par
  l'intention ; saut si au sol (détection **analytique** via `terrainHeight`). `teleport` (debug).
- **`physics.ts`** : Havok chargé via `locateFile` → `public/HavokPhysics.wasm` (copié par
  `scripts/copy-havok-wasm.mjs`, hooks postinstall/predev/prebuild).

---

## 10. Données & réglages (`data/world.ts`)

Tout l'équilibrage est ici (éditable sans toucher au moteur) :
- `config` : `simTickHz` 20, `rngSeed`, rayons d'interaction, `gather` (woodPerChop 8, chopsPerTree 3,
  chopBusySeconds, treeRegrowSeconds), `carryCapBase` 24 / `cartCapBonus` 24, `cabinRepairCost` 20,
  `fire` (coût/refroidissement/étrangère), `population` (hutRoom 4, intervalles d'arrivée,
  `incomeSeconds` 10), `baitPerExtraCatch`.
- `craftables` : 10 bâtiments d'ADR (coûts croissants, maximums) — chiffres **d'origine**.
- `jobs` : métiers (ex-`_INCOME`), chiffres **d'origine ADR** (bûcheron +1 bois, chasseur +0,5
  fourrure/viande, tanneur −5 fourrure→+1 cuir…) ; chaque métier spécialisé gardé par un `building`.
- `trapDrops` : table de butin des pièges (RNG à graine).

> **Bûcheron = occupation par défaut (fidèle ADR)** : le `gatherer` n'est **pas un poste qu'on
> assigne**, c'est le **« reste »** — `freeWorkers = population − ouvriers spécialisés`. Tout villageois
> sans métier ramasse du bois (jamais oisif). `ASSIGN_WORKER` refuse `gatherer` ; le tableau **liste le
> bûcheron comme les autres mais en lecture seule** (effectif, sans boutons +/-, façon ADR) et ne rend
> assignables que les métiers spécialisés (les retirer renvoie au bûcheronnage). L'income calcule le
> nombre de bûcherons comme ce reste.
>
> **Logique d'income (fidèle ADR)** : à chaque cycle (`incomeSeconds`), chaque métier est appliqué
> **tout-ou-rien** ; s'il ne peut pas payer ses intrants, il **chôme** (ni conso ni prod). Les stocks
> ne deviennent **jamais négatifs** et **aucun villageois ne meurt** du manque d'intrant (la mort de
> villageois viendra des **événements**, M5).

---

## 11. Hooks de debug (`window.__game`, dans `main.ts`)

Exposés pour Playwright et le debug console (sans effet sur le gameplay) :
- Lecture : `ready`, `renderer`, `getStored()`, `getCarried()`, `getFire()`, `getBuildings()`,
  `getPopulation()`, `getWorkers()`, `getCabinRepaired()`, `getPlayer()`, `getFocusVerb()`, `errors`.
- Actions : `forceGather()`, `lightFire()`, `stoke()`, `deposit()`, `repairCabin()`, `build(id)`,
  `harvestTrap()`, `assignWorker(job)`, `openBuilderDialogue()`, `openVillageBoard()`, `openSettings()`.
- Outils : `fastForward(seconds)` (avance la sim — réservé autorité), `teleport(x,z)`,
  `saveNow()`, `clearSave()`, `showcaseCamera()/showcaseCabin()/showcaseBoard()` (cadrages capture).

---

## 12. Tests & vérification

- **`npm run test`** (Vitest, `src/sim/sim.test.ts`, 35 tests) : règles pures + **déterminisme**
  (replay), sans Babylon. C'est le filet de sécurité principal.
- **`npm run e2e`** (Playwright, `tests/e2e.spec.ts`, 3 tests) : (1) boucle complète headless
  (récolte→feu→cabane→entrepôt→construction→population, gravité, déplacement, relève de piège) +
  capture `tests/screenshot.png` ; (2) smoke P2P (rejoindre un salon → HUD en ligne) ; (3)
  **sauvegarde/rechargement** (l'état est restauré). Headless = repli **WebGL2** (rendu logiciel) ;
  le **WebGPU se vérifie à la main** dans un vrai navigateur.
- **`npm run typecheck`** : `tsc --noEmit` strict.

---

## 13. Conventions & contraintes à respecter (pour ne pas casser l'architecture)

- **Ne jamais importer Babylon/DOM dans `src/sim/`** ni `data/`.
- **Toute règle de jeu → dans `reduce`** (pur, déterministe). Le rendu/UI ne décident rien.
- **Aucun `Math.random()` dans la logique** : utiliser `state.rng`.
- **Toute nouvelle donnée d'état** : l'ajouter à `GameState` + `createInitialState` + (si
  partagée) au `StateSyncMsg`/snapshot/`adoptSnapshot`. Penser au sac (par joueur) vs entrepôt (global).
- **Contenu/équilibrage → `data/world.ts`**, pas en dur dans le moteur.
- Timers de gameplay = **compteurs de tics** (déterministes), pas des `setTimeout`.
- **Audio = PRÉSENTATION** (comme les villageois cosmétiques / la fumée / le brouillard) :
  [`render/audio.ts`](../src/render/audio.ts) (`AudioManager`, Babylon `AudioV2`) **lit l'état** et se
  déclenche sur le **diff de présentation** (`reflectState` → `setFireMusic`) ou les actions locales
  (`interactFire` → SFX) — **jamais dans `sim/`**, ne mute jamais `GameState`, n'utilise jamais `state.rng`
  (`Math.random` admis car cosmétique). Aucun ajout au snapshot/réseau (audio 100 % local ; la cohérence P2P
  vient déjà du snapshot). Manifeste swappable en [`data/audio.ts`](../data/audio.ts) ; réglages volume/mute
  persistés hors `GameState` ([`save.ts`](../src/save.ts)). Plan & reste-à-faire : [`plan-audio.md`](plan-audio.md).
