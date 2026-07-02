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
data/world.ts              DONNÉES : config, craftables (bâtiments), craftableItems (objets, ex. torche),
                           jobs (dont mineurs), trapDrops, biomes (dont MARAIS), sites[] (~57 POI), événements,
                           terrainHeight() + BORDURES (borderField/configureBorders : 2 montagnes + 2 océans),
                           generateCampLayout() (placement MATHÉMATIQUE des bâtiments), campLayout, libellés FR.
src/
  sim/                     LE CERVEAU (pur, sans Babylon/DOM) — testé `npm run test`
    state.ts               GameState (structure) + helpers ; champs M9 (sites/roads), M7 (survival),
                           M8.6 (encounters/playerPos/drops), M11 (ship/flight + RF8 : SharedFlight pilotable)
    actions.ts             actions sérialisables (+ PlayerAction réseau) — récolte/construction, combat
                           (ATTACK/EAT_MEAT/TAKE_DROP), M10 (CRAFT_ITEM/BUY/USE_MEDS/WITHDRAW), survie
                           (SET_OUTSIDE/STEPS), M11 (LIFT_OFF/FLIGHT_FIRE/STEER/ENTER_ROOM/REVEAL_CELLS/PRESTIGE)
    reducer.ts             reduce(state, action) -> nouvel état (pur, déterministe). Cœur des règles.
    rng.ts                 mulberry32 à graine (tout aléatoire de la LOGIQUE passe par là)
    worldgen.ts            génération du monde PURE : biomes EN RÉGIONS (bruit + domain warping) + marais-région,
                           sites en anneaux, scatter déterministe
    dungeon.ts             donjons PURS : graphe + butin dérivés de la graine — grottes/mines (M9) + cuirassé
                           explorable salle-par-salle (M11/RF2 : antichambre → 3 ailes → pont, aliens RF3)
    combat.ts              combat CO-OP PUR (M8.6) : engagés par proximité, poursuite, frappe d'un engagé au hasard
    flight.ts              DÉCOLLAGE PUR (M11/RF8) : stepFlight() — pilotage d'esquive (STEER sommé, spawns seedés,
                           collision par position + i-frames), tir support. Déterministe & host-autoritaire.
    roads.ts               drawRoad() : réseau de routes qui FUSIONNE (spirale → plus proche, L Manhattan) — fidèle ADR
    *.test.ts              tests purs (sim, worldgen, dungeon, roads, host, save, campLayout… 300 tests)
  render/                  LE CORPS (Babylon.js)
    scene.ts               moteur WebGPU→WebGL2, lumières, fog, post-process, PALETTE
    physics.ts             chargement du plugin Havok (WASM depuis public/)
    world.ts               feu de camp (intensité = niveau du feu)
    terrain.ts             sol streamé par CHUNKS (clip CARRÉ) : biome + altitude + ROUTES (teinte), colliders localisés
    ocean.ts               plan d'eau du faux océan (caché sauf bordure « océan »)
    forest.ts / trees.ts / scatter.ts   arbres finis qui repoussent · essences · décor instancié
    cabin.ts               cabane ruine→réparée (paliers ×1/×5/×10) : coffre + étagères + grand tableau + lanternes
    buildings.ts           bâtiments low-poly (placement = campLayout maths) + chantier animé + fumée + pièges
    campDecor.ts / campLights.ts / campRuins.ts / campPaths.ts   décor sol · lanternes (palier) · ruines · sentiers
    rampart.ts             rempart/porte/puits de la zone sûre (M6) ; sites.ts : modèles 3D des ~14 types de site + LOD
    interior.ts / shipInterior.ts   intérieur explorable grottes/mines · intérieur du cuirassé salle-par-salle (M11/RF2b)
    encounter.ts / drops.ts   ennemis partagés rendus à leur position monde (co-op, flux 15 Hz) · butin au sol ramassable
    threshold.ts           cinématiques de SEUIL (M11/RF5) : porte animée + fondu à l'entrée/sortie d'un intérieur clos
    liftoff.ts             DÉCOLLAGE (M11/RF8) : vaisseau pilotable qui monte, caméra contre-plongée, pluie de débris
    shipCamp.ts / shipCrashed.ts / shipRepaired.ts / shipUpgrades.ts   vaisseau au camp en 3 états (épave→dressé→amélioré)
    villagers.ts           avatars de population (cosmétique) : métiers, navGrid A*, DANS LES HUTTES + rotation
    navGrid.ts / entities.ts / proplod.ts / autoperf.ts   A* villageois · LOD entités/props · perf adaptative
    stranger.ts            la constructrice (PNJ) · characters.ts (humanoïdes, dont aliens) · player.ts (capsule Havok + confinement)
    camera.ts / remotePlayer.ts   caméra 3e/1re pers · avatars distants interpolés
    audio.ts               AUDIO (présentation) : bus, musique adaptative, SFX (dont PORTE + IMPACT/LANCEMENT synthétisés). Lit l'état.
  ui/hud.ts                HUD (sac, feu, village, combat/décollage), étiquette E, DIALOGUES, menu PARAMÈTRES (son, CONFORT, multi)
  ui/minimap.ts            minimap UNIFIÉE & contextuelle (M11/RF4) : camp / exploration-monde / grotte-mine / vaisseau + fog
  ui/keybindsPanel.ts      panneau « Paramètres des touches » (rebind : capture/retrait/reset) + indices affichés (A6)
  ui/titleScreen.ts        écran-titre (seuil d'entrée : reprendre/nouvelle partie/rejoindre ; sauté en webdriver) (A6)
  dev/gameHooks.ts         hooks d'auto-vérification `window.__game` (type Window + installGameHooks) (A6)
  ui/dialogues.ts          TOUTES les vues de dialogue (constructrice/atelier/troc/coffre/vaisseau/tableau/événement/fin)
                           + plomberie (show/refresh/close) + révélation ADR des craftables (A6)
  input/                   input.ts (clavier→intentions) · keybindings.ts (REBIND : modèle pur action→touches, persisté) · pointerLook.ts (souris=caméra, sensibilité réglable)
  net/                     room.ts (salon + heartbeat/failover) · host.ts (élection PURE) · messages.ts
  save.ts                  saveGame/loadGame (+ migrateSave), réglages audio & CONFORT (localStorage)
  main.ts                  point d'entrée : init, boucle à pas fixe, dialogues, interactions, réseau, save
tests/e2e.spec.ts          Playwright (21 tests) : boucle, P2P, save, perf/LOD, sites, survie, combat, cuirassé, fabricator, raid militaire, décollage→évasion→prestige…
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
- `cabinTier` — palier de la cabane (0 ruine / 1 / 5 / 10) ; la VALEUR est le multiplicateur de capacité de stockage.
- `buildings` : `Record<id,nombre>` — bâtiments construits (= l'état de déblocage des métiers).
- `population`, `workers` (`Record<job,nombre>`), `producing` (`Record<job,bool>` = a produit au
  dernier cycle, pour le feedback visuel).
- `fire` (0 mort..4 rugissant), `temperature` (0..4), `builder` (-1 absente, 0..3 prête).
- Échéances en n° de tic (déterminisme pur) : `fireCoolAt`, `tempAdjustAt`, `builderAdvanceAt`,
  `stokeReadyAt`, `popGrowAt`, `incomeAt`, et **`trapReadyAt`** (`Record<index,tic>` : chaque piège
  a son PROPRE rechargement → on relève les pièges **un par un**, voir §9).
- `rng` — état du générateur à graine.
- **`worldSeed`** — graine de la CARTE (distincte du `rng` de gameplay) ; la carte est une fonction pure de cette graine.
- **`sites`** (M9) : `Record<"cx,cz", SiteProgress>` — état D'EXPLORATION par site (découvert / butin pris [premier-servi
  global] / mine sécurisée / grotte nettoyée). La disposition & le butin, eux, sont dérivés de `worldSeed` (rien à stocker).
- **`roads`** (extension M9) : `Record<"cx,cz", true>` — cellules de ROUTE tracées au nettoyage/sécurisation d'un site
  (réseau qui fusionne, cf. `sim/roads.ts`). Géométrique → déterministe.
- **Échéances M5 & entretien** : `eventScheduledAt`, `pendingEffects`, `builderTendReadyAt`, `builderTendingUntil`.

> Tout nouveau champ doit être ADDITIF (back-fillé au boot) et circule **automatiquement** en P2P/save : le snapshot est
> un `structuredClone(state)` INTÉGRAL (plus de liste de champs à maintenir — c'est ainsi que `cabinTier` avait été oublié).

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
  la cabane ; rapprochement rapide (anti-clip), éloignement doux (lerp). *(Étape 1 de la refonte caméra.)*
- **Fondu du toit** (`main.ts` boucle + `cabin.setRoofOpacity`, Étape 1b) : en 3ᵉ personne, le toit de la
  cabane devient **transparent** quand le joueur approche (bande de fondu `[footprintRadius, +ROOF_FADE_SPAN≈4]`)
  → on **voit l'intérieur** sans le toit qui masque. Opaque au loin ; **opaque aussi en FPV** (on est
  dessous, regard vers le haut) via `setRoofOpacity(max(fpv, fondu))`. Côté `cabin.ts`, le toit est bâti
  sous un **nœud dédié** par palier (meshes **cachés** pour éviter une allocation par frame) et l'opacité
  passe par `mesh.visibility` (**par-mesh**) — donc **sans toucher les matériaux PARTAGÉS** (les murs
  restent opaques). No-op sur la ruine (pas de toit).
- **Bascule 3ᵉ ↔ 1ʳᵉ personne** (`main.ts`, boucle — Étape 2) : une seule `ArcRotateCamera` sert les deux
  vues, mélangées par un facteur `fpv` ∈ [0,1] lissé chaque frame. **3PV** (`fpv→0`) = pose spring-arm
  ci-dessus, corps visible. **FPV** (`fpv→1`) = astuce ArcRotate : on place la **cible** à `œil + avant·R`
  avec un **rayon minuscule** (`FPV_RADIUS≈0.06`), si bien que la caméra retombe **exactement sur l'œil**
  du joueur (`FPV_EYE_Y=0.75` au-dessus du centre capsule ≈ **1,65 m du sol**) en **regardant vers l'avant** ;
  le corps est **masqué** (`player.setVisible(fpv<0.6)`) pour ne pas voir l'intérieur du modèle.
  - **Remap du tangage** : la caméra regarde **toujours selon `beta`** (changer `target` ne fait que la
    déplacer, pas la réorienter). Or le repos 3PV (`beta≈1.05`) viserait ~30° vers le sol en FPV. On
    **découple** donc le **beta voulu** (souris → `pointerLook.desiredBeta`, borné à la plage 3PV
    `[0.35,1.45]`) du **beta rendu** : en FPV on remappe vers l'**horizon** (`π/2`) au repos, amplifié
    (`FPV_PITCH_GAIN`) et borné (`[FPV_BETA_MIN, FPV_BETA_MAX]≈[0.5,2.4]`), puis on **mélange** par `fpv`
    (`camera.beta = lerp(betaVoulu, betaFpv, fpv)`). Pour viser le ciel il faut `beta>π/2`, donc `main`
    **élargit `camera.upperBetaLimit`** à `FPV_BETA_MAX` (sinon ArcRotate clampe) ; la 3PV reste bornée
    car c'est `desiredBeta` qui plafonne à 1.45, pas la limite caméra. Le **yaw (`alpha`)** reste direct
    (identique dans les deux vues).
  - **Déclencheurs** : **(a) automatique** en entrant dans la cabane — détection `insideCabin` avec
    **hystérésis** (entrée sous `footprintRadius−0.3`, sortie au-delà de `+0.8`) pour éviter le clignotement
    au seuil ; **(a′) automatique SOUS TERRE** (grottes/mines, M9) — `interiors.isLocalPlayerInside()`
    (joueur sous plafond, rayon `insideR` centré sur la cavité) ; **(b) manuel** via la touche **`V`**
    (`forceFpv`, hors UI). `wantFpv = forceFpv || insideCabin || interiors.isLocalPlayerInside()`.
    Sous terre, la lueur de **torche** ([`player.ts`](../src/render/player.ts) `setTorch`) est parentée à la
    **capsule** (pas au modèle) — sinon, le modèle masqué en FPV (`yawNode.setEnabled(false)`) éteindrait la
    lumière par cascade et la grotte serait noire.
  - Transition **lissée** (lerp de la cible, du rayon ET du tangage) → pas de saut, pensé anti-malaise.
  - **Stabilité (anti-tremblement)** : on lisse le **rayon d'abord**, puis on **cale la cible FPV sur le
    rayon RÉEL** (`cible = œil + avant·camera.radius`) → `position = cible − rayon·avant = œil` **exactement,
    quel que soit le rayon**. Et le **spring-arm est coupé en FPV** (`fpv ≥ 0.9`) : à l'œil il n'y a pas de
    « bras » à protéger, et son raycast cible→caméra (dirigé vers l'arrière) accrochait le mur derrière →
    oscillation avant-arrière. *(Sans ces deux points, un écart cible/rayon produisait un tremblement de
    quelques cm le long de l'axe du regard.)*
  *(✅ FPV étendue aux **grottes/mines** (M9, 2026-06-11). Reste prévu : FPV de **combat/armes** — M8.)*
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

- **`npm run test`** (Vitest, `src/sim/*.test.ts` + `src/input/keybindings.test.ts`, **300 tests**) : règles pures + **déterminisme**
  (replay), sans Babylon — survie, combat co-op, donjons, routes, fin de partie + décollage d'esquive (RF8).
  C'est le filet de sécurité principal.
- **`npm run e2e`** (Playwright, `tests/e2e.spec.ts`, **21 tests**) : (1) boucle complète headless
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
