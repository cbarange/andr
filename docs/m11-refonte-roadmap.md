# M11 — REFONTE : fidélité ADR + cuirassé explorable + vaisseau au camp + minimap

> **Statut : DOCUMENT DE PLANIFICATION (aucune implémentation encore).** Établi après audit du **code
> source officiel** d'*A Dark Room* (`github.com/doublespeakgames/adarkroom`), recherche des
> best-practices de l'industrie, et audit de notre base de code. Reprend et corrige le plan initial
> [`m11-plan.md`](m11-plan.md). À valider/arbitrer avant de coder (cf. §8 Décisions ouvertes).

---

## 0. Pourquoi cette refonte — les écarts de fidélité (VÉRIFIÉS sur le code source d'ADR)

M11 v1 est livré et fonctionnel (E1→E5, 258 tests verts), mais s'écarte de l'original sur **trois points
durs** + manque d'immersion. Tout est sourcé sur le code d'ADR (le wiki ne sert que de recoupement) :

1. **Le cuirassé n'est PAS un prérequis du petit vaisseau.** Le setpiece `'ship'` (« A Crashed Starship »)
   pose simplement `World.state.ship = true`, **sans aucune condition** (`script/events/setpieces.js`).
   L'**alien alloy** (carburant des réparations) vient de **sources parallèles** : forages (garanti 1-3),
   champs de bataille, et de nombreuses scènes de la **Cité**. → Notre gating `ship_revealed` derrière
   `CLEAR_EXECUTIONER` (reducer.ts:508) est **infidèle**.
2. **Le petit vaisseau se gère DEPUIS LA BASE.** On le *découvre* au bord du monde (rayon max), mais au
   **retour au village**, `goHome()` appelle `Ship.init()` qui crée l'onglet permanent **« An Old
   Starship »** ; réparations (1 alliage/coque, 1 alliage/moteur, **sans plafond**) et **décollage** se
   font **depuis la base** (`script/ship.js`, `script/world.js`). → Notre interaction « au bord du
   monde » est **infidèle**.
3. **Le `fleet beacon` (optionnel) manque.** Drop **garanti** du boss final du cuirassé (Immortal
   wanderer, 500 PV). Il **n'affecte que la cinématique de fin** (`endGame()` : branche « ending
   alternatif » si possédé) — ni requis pour piloter, ni pour gagner (`script/space.js`,
   `script/events/executioner.js`). → **Oublié** dans notre v1.

Et deux manques d'**immersion** demandés :
4. **Le cuirassé n'est pas explorable.** Dans ADR c'est un **donjon multi-salles** (antichambre → ailes
   **ingénierie / martiale / médicale** → **pont de commandement**, gaté sur les 3 ailes), avec des
   **ennemis aliens spécifiques** (cf. §1.3). Chez nous : un simple **gantelet de 5 combats**
   (`mineGuardians.executioner`).
5. **Pas de minimap / orientation.** Aucune infra (le `planView` est debug-only).

> ⚠️ **Note honnête** : notre **format de décollage** (« extraction allégée » : ascension on-rails, on
> *abat* les débris entrants, pas de pilotage libre) est une **adaptation co-op assumée** (décision
> porteur actée), différente du mini-jeu solo d'ADR (esquive libre, `SHIP_SPEED 3`). Ce n'est pas un
> « bug de fidélité » mais un choix — à **reconfirmer** (§8), pas à corriger par défaut.

---

## 1. La fin de partie FIDÈLE (cible) — d'après le code source d'ADR

### 1.1 Découverte (exploration)
Explorer jusqu'au **rayon max** (≈ 28 tuiles dans ADR ; chez nous 56-60 cellules) révèle **DEUX sites
INDÉPENDANTS**, déjà placés et rendus chez nous :
- **L'épave** (`ship`, « A Crashed Starship ») = **le petit vaisseau d'évasion**.
- **Le cuirassé** (`executioner`, « A Ravaged Battleship ») = **le grand vaisseau alien** (donjon).

### 1.2 Le petit vaisseau (cible)
- Atteindre l'épave → pose un drapeau « vaisseau trouvé » (ADR : `World.state.ship`). **Aucun combat,
  aucun prérequis.**
- **De retour au camp**, une **interaction permanente « vaisseau » au camp** apparaît (ADR : onglet
  « An Old Starship »). On y **renforce la coque** (1 alliage → +1 PV) et **améliore le moteur**
  (1 alliage → +1 poussée), puis on **décolle** — **tout depuis le camp**.
- Alliage : n'importe quelle source (forages garantis / champs / cité / cuirassé). **Le cuirassé n'est
  pas requis.**

### 1.3 Le cuirassé (optionnel mais riche) — donjon explorable
Structure ADR (`script/events/executioner.js`) :
- **Antichambre** (hub) → pose le drapeau `executioner` (déclenche le **Fabricator** au retour, §6).
- **3 ailes** (chacune pose son drapeau) :
  - **Ingénierie** : welders/gardes/tourelles → boss **Unstable prototype** (150 PV) → **alliage 1-3**.
  - **Martiale** : gardes/tourelles/quadrupèdes → boss **Murderous robot** (250 PV) → **alliage 1-3**.
  - **Médicale** : tourelles/medics → **Unstable automaton** (100 PV) → boss **Malformed experiment**
    (200 PV) → **stim blueprint**.
- **Pont de commandement** (dispo si **les 3 ailes** faites) → boss final **Immortal wanderer** (500 PV,
  12 dég) → **`fleet beacon` garanti**.
- Ennemis spécifiques (noms exacts) : *chitinous horror/queen, operative, researcher, ancient beast,
  automated/defence turret, unruly welder, guard, unstable prototype/automaton, murderous robot,
  malformed experiment, immortal wanderer*.
- Récompense réelle de la traversée : **alliage** (ailes) + **fleet beacon** (boss) + déblocage du
  **Fabricator** (dès l'antichambre).

### 1.4 Le beacon
**Optionnel.** S'il est en stock à l'évasion → **fin étendue** (les worldships, la flotte wanderer, l'air
qui manque…). Sinon → fin standard. **Non reporté au prestige** (comme l'alliage).

### 1.5 Décollage / mini-jeu / prestige
- Hull ≥ 1 pour décoller ; **crash → retry** (cooldown, **sans perte**) ; altitude pleine → fin.
- **Prestige** : reporte une **fraction des stocks** de la partie (PAS l'alliage, PAS le beacon).
- → Notre v1 est globalement conforme ici (garder), sauf : caps hull/moteur (ADR n'en a pas — §8), et
  brancher le **beacon** dans la fin (§7).

---

## 2. Le cuirassé EXPLORABLE & IMMERSIF — design cible

### 2.1 Modèle 3D : agrandir + structurer en salles
- **Agrandir** le modèle actuel (`sites.ts` case `executioner`, ~26 u) en une **carcasse** assez vaste
  pour contenir un **intérieur**.
- **Structurer en SALLES distinctes** reliées par **sas/portes** (rooms + portals) : antichambre (hub) →
  3 ailes → pont. Chaque salle = une **unité de gameplay ET de rendu**.
- **Réutiliser/étendre `render/interior.ts`** (build/free par proximité avec hystérésis, obscurité
  locale, gating « torche » → ici « brèche/clé/sas »). **À étendre** : la notion de **salles séparées**
  (aujourd'hui un anneau + couloirs continus) + **portes** entre elles.
- **Graphe** : nouveau type dans `sim/dungeon.ts` (`executioner`/`spaceship`) = salles (nodes) + portes
  (segments), **déterministe à la graine** (host et clients ont le même plan sans le streamer).

### 2.2 Combat salle-par-salle (arène verrouillée) — host-autoritaire
Best-practice « arène » (résout le *Door Problem*) :
- Franchir le **seuil** d'une salle déclenche le combat ET **scelle les portes** (sas) → engagement forcé.
- **Télégraphie en 3 temps** : (a) on *voit* la salle + les ennemis 1-2 s avant le trigger, (b) vagues,
  (c) **déverrouillage clair** des sas à la dernière mort (porte rouge → verte).
- **Réutilise les rencontres partagées M8.6** (`SharedEncounter`, combat co-op) pour peupler les salles.
- **Host-autoritaire** : l'hôte valide l'entrée, passe la salle en `LOCKED`, spawn, puis `CLEARED` quand
  vide et rouvre. **Co-op** : ne verrouiller que quand assez de joueurs sont entrés (ou aspirer les
  retardataires) pour ne pas couper l'équipe. Le **culling reste local** (jamais branché sur la logique).

### 2.3 Ennemis aliens spécifiques (à modéliser)
- **3-4 archétypes** max, **silhouettes distinctes** (la forme dit la fonction : massif=tank, fin=rapide,
  flottant=distance), **émissif = code de menace** (lisibilité en intérieur sombre, low-poly).
- **Télégraphie d'attaque** : pose exagérée + pulse émissif au *wind-up* (envoyé **tôt** par l'hôte pour
  contrer la latence). 2-3 types par salle ; le boss réservé au pont.
- Réutiliser le **kit low-poly** + `characters.ts` (rig humanoïde, beast/lizard) ; **créer** les variantes
  aliens (chitineux, tourelle automatisée, robot/automate, wanderer immortel).

### 2.4 Caméra en intérieur serré
- **Spring-arm sphere-cast** (rayon ~0.3-0.5) au lieu d'un simple raycast (Babylon : `camera.checkCollisions`
  + `collisionRadius`) ; **rapprocher vite / éloigner lentement** (anti-oscillation en coin).
- **Auto-FPV** (ou TPS très serré) dans les couloirs étroits ; **fade des murs** entre caméra et joueur.
- **Transition extérieur→intérieur** : voir §2.5 (cinématique de seuil, qui REMPLACE le simple lerp).
- Tout est **local** (zéro incidence host). Réutilise la machinerie FPV existante (déjà active en cabane/grottes).

### 2.5 Transitions CINÉMATIQUES de seuil (« portes morales ») — exigence porteur
> **Exigence** : entrer/sortir d'un **environnement clos** (grotte, mine, **vaisseau/cuirassé**) déclenche
> une **mini-cinématique** : la caméra se fige, le joueur lâche les commandes, une **porte/un portillon
> s'ouvre**, le personnage avance de quelques pas à l'intérieur (mouvement cinématographique), une
> transition visuelle joue, puis la **maniabilité est rendue** et la caméra passe en **1re personne**.
> Même chose à la SORTIE (se retourner vers la porte → interagir → cinématique inverse → 3e personne dehors).
> **Exception : la CABANE** (garde son fondu 3PV↔1PV à hystérésis actuel, sans cinématique).
> Généralise : *à chaque changement d'angle de caméra nécessaire, une cinématographie joue* (fluide + esthétique).

- **Le seuil = une « porte morale »** matérialisée par un **élément 3D ANIMÉ** propre au type de site :
  - **Mine** : un **portillon en bois** (battant sur charnière) qui s'ouvre.
  - **Grotte** : une **arche/faille** marquée (ex. rideau de lianes écarté, ou herse de bois ; un seuil
    lisible, pas forcément une « porte »).
  - **Vaisseau / cuirassé** : une **porte futuriste** (coulissante latérale ou **iris circulaire**) +
    halo lumineux.
- **Verbe d'interaction** au seuil (touche d'interaction principale, depuis dehors) : « **pénétrer dans
  le vaisseau** » / « **entrer dans la grotte** » / « **descendre dans la mine** ». Depuis dedans, près
  du seuil : « **ressortir** ».
- **Séquence d'ENTRÉE** (commandes verrouillées, caméra scriptée) :
  1. la porte/portillon joue son **animation d'ouverture** ;
  2. le personnage **avance** de quelques pas à travers le seuil (déplacement scripté, ease-in/out) ;
  3. **transition visuelle** au franchissement (reco : *dolly-in* qui suit le perso + **bref creux au noir
     « mi-fondu »** pile au seuil — masque le build de l'intérieur, technique AAA classique de porte) ;
  4. de l'autre côté : la caméra **s'installe en 1re personne**, **les commandes reviennent**.
- **Séquence de SORTIE** : symétrique (marche vers la porte → ouverture vers l'extérieur → dolly-out →
  mi-fondu → installation en 3e personne dehors → commandes rendues).
- **Technique recommandée** (l'industrie masque le streaming par une **occlusion/fondu bref au seuil** :
  RE/Mass Effect/portes) : *dolly-through + dip-to-black* court (**< 1,5 s**), courbes ease-in/out (anti
  mal des transports), **jamais de coupe sèche**. **Skippable** après la 1re fois (anti-lassitude sur trajets répétés).
- **100 % LOCAL** (caméra/commandes/cinématique par joueur ; l'intérieur se build déjà localement via
  `interior.ts`). **Aucune incidence host → zéro risque de désync.** Le creux au noir est le **moment idéal
  pour déclencher le build/free** de l'intérieur (chargement masqué).
- **Réutilise** : la machinerie FPV (cabane/grottes) pour l'état 1re personne ; `interior.ts` pour le
  build au franchissement. **À créer** : un composant « **seuil animé** » (mesh de porte + animation
  open/close par type) et un petit **orchestrateur de cinématique** (verrouillage input + spline/lerp
  caméra + marche scriptée + fondu).

---

## 3. Minimap UNIFIÉE & CONTEXTUELLE — à l'échelle du monde entier (à créer)

> **Exigence porteur** : UNE SEULE minimap, **toujours présente**, qui couvre **tout le jeu** et se
> **CONTEXTUALISE selon l'emplacement du joueur** — village, exploration du monde, grotte/mine,
> intérieur du vaisseau. Pas une minimap « intérieur » + une « monde » séparées : **le même widget**
> bascule de représentation selon le contexte. (Ce n'est donc PAS une décision optionnelle — c'est le but.)

- **Une machine à 3 LAYERS, sélectionnée automatiquement par le contexte du joueur :**
  - **CAMP** (dans le périmètre du village) : plan rapproché du campement (cabane, bâtiments, feu, porte).
    Source : `campLayout` / positions des bâtiments.
  - **MONDE** (en exploration dehors) : plan à **l'échelle du monde entier** — camp au centre, **sites
    découverts** (grottes, mines, villes, cités, forages, champs, **épave**, **cuirassé**), **routes**
    tracées, anneaux de distance. Source : `worldMap.sites` + `state.roads` + worldgen.
  - **INTÉRIEUR** (sous terre / dans une structure : grotte, mine, **cuirassé**) : plan **schématique des
    salles** de la structure courante (salles + portes/sas + butin). Source : le **graphe de donjon**
    (`dungeon.ts`) de la structure active.
- **Transition fluide** quand on change de contexte (entrer dans une grotte/vaisseau → bascule MONDE→INTÉRIEUR ;
  ressortir → INTÉRIEUR→MONDE ; rentrer au camp → MONDE→CAMP). Un fondu/zoom doux, pas un swap brutal.
- **Rendu** : dessin **2D schématique** (Babylon GUI / canvas) à partir des données ci-dessus — **JAMAIS**
  une caméra ortho temps réel (coûteuse). On a déjà toute la donnée (sites, routes, graphes de donjon,
  campLayout). Style **minimaliste, monochrome** (ton ADR). Coin d'écran + **carte plein écran** (touche
  dédiée) pour la vue MONDE et INTÉRIEUR détaillées.
- **Fog-of-war PARTAGÉ co-op** : cellules/sites/salles révélés à la première visite **par n'importe quel
  joueur** (vu par un = vu par tous), persisté/sync par l'hôte (réutilise le seam `visited` déjà prévu).
- **Le joueur (orientation/flèche) + les COÉQUIPIERS** (couleur par joueur, « à terre » clignotant) sur
  tous les layers. Positions diffusées par l'hôte à **basse fréquence** (~5-10 Hz), interpolées.
- **Marqueur d'objectif** (chevron vers l'épave / le cuirassé / l'objectif courant) sur le layer pertinent
  + **edge-pointer** quand la cible est hors-cadre. Minimaliste, monochrome.

---

## 4. « Ramener le vaisseau à la base » & cohérence globale

- **Le petit vaisseau au CAMP** : nouvelle **ancre** dans `campLayout` + interaction « vaisseau » au camp
  (le `shipView` actuel y est déplacé). **Réutiliser le pattern `cabin.ts` reveal** : le vaisseau
  **s'assemble visuellement** au camp à mesure qu'on renforce la coque (montée pièce par pièce).
- **Décollage depuis le camp** (et non au bord du monde). La cinématique `liftoff.ts` est réutilisée telle
  quelle (elle part de la position du vaisseau).
- L'**épave au bord du monde** devient une **scène de découverte** (le setpiece qui « trouve » le vaisseau
  et déclenche son apparition au camp), pas le lieu de réparation.

---

## 5. Best-practices industrie appliquées (synthèse sourcée)

| Axe | Reco appliquée | Source |
|---|---|---|
| Intérieurs | rooms+portals, **scripté seedé** (pas procédural pour un climax), culling par salle (`setEnabled`), **pas** d'occlusion GPU en couloir | [Level Design Book](https://book.leveldesignbook.com/process/combat/encounter), [Dead Space LD](https://www.gamedeveloper.com/design/dead-space---storytelling-through-level-design), [Babylon occlusion](https://doc.babylonjs.com/features/featuresDeepDive/occlusionQueries) |
| Combat de salle | **arène verrouillée** + télégraphie (survey → vagues → déverrouillage), portes rouge/vert | [Door Problem](https://www.gamedeveloper.com/design/the-door-problem-of-combat-design) |
| Caméra | spring-arm **sphere-cast**, auto-FPV en couloir, fade des murs, transition amortie | [Game AI Pro ch.47](https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter47_Tips_and_Tricks_for_a_Robust_Third-Person_Camera_System.pdf), [Unreal TPS](https://www.unrealengine.com/en-US/tech-blog/six-ingredients-for-a-dynamic-third-person-camera) |
| Minimap | **graphe de salles** (pas ortho), fog-of-war partagé, marqueur d'objectif, coéquipiers | [Mini-map](https://en.wikipedia.org/wiki/Mini-map), [Diegetic Interfaces](https://www.wayline.io/blog/diegetic-interfaces-game-design) |
| Extraction co-op | engin **au hub**, **point-of-no-return**, **tout le monde embarque**, climax (compte à rebours/vague), **NG+ reseed** | [Rogue Point](https://www.pcgamer.com/games/fps/rogue-point-is-a-fps-roguelite-that-does-everything-in-its-power-to-encourage-players-to-actually-work-as-a-team/), [Cogmind layouts](https://www.gridsagegames.com/blog/2019/03/roguelike-level-design-addendum-procedural-layouts/) |
| Récit | **montrer pas dire**, préserver le **twist du wanderer**, UI minimaliste fidèle ADR | [Minimalism in Narrative](https://www.gamedeveloper.com/design/minimalism-in-game-narrative-can-we-say-more-by-talking-less-), [Env. Storytelling](https://www.wayline.io/blog/environmental-storytelling-in-games) |
| Ennemis | silhouettes uniques, **émissif = menace**, télégraphie *wind-up* envoyée **tôt**, 2-3 types/salle | [Blizzard silhouettes](https://motheread.org/how-blizzard-uses-enemy-silhouettes-to-help-players-react-instantly-in-combat/), [GDKeys Attack](https://gdkeys.com/keys-to-combat-design-1-anatomy-of-an-attack/) |

---

## 6. Le Fabricator (optionnel, fidèle ADR)

Dès l'**antichambre** du cuirassé franchie (`executioner` vrai), ADR débloque au camp le **Fabricator** :
un atelier qui fabrique avec de l'alliage (energy blade, disruptor, plasma rifle, kinetic armour, hypo,
stim, cargo drone…). **Optionnel** (contenu de puissance parallèle, pas requis pour la fin). → Candidat à
une **phase tardive** (réutilise l'atelier M10 + un onglet « fabricator » gaté).

---

## 7. ROADMAP FONCTIONNELLE (par fonction joueur ; chaque phase laisse l'arbre VERT)

> Principe : on **corrige d'abord la fidélité** (faible risque, gros gain, débloque le ressenti correct),
> puis on **ajoute l'immersion** (gros morceaux rendu+sim), puis le **polish**.

### **RF1 — Fidélité du flux de fin** *(S/M — sim + UI)* — ✅ **FAIT**
- ✅ **Dé-gaté** : `DISCOVER_SHIP` (atteindre l'épave) pose `ship_found` ; `CLEAR_EXECUTIONER` ne révèle
  plus le vaisseau (garde `executioner_cleared` + alliage). Gardes réparer/décoller sur `ship_found`.
- ✅ **Vaisseau au CAMP** (`render/shipCamp.ts`, ancre `(24,0)`) : s'assemble au fil de la coque (reveal) ;
  interaction « examiner le vaisseau » + décollage **depuis le camp** ; l'épave au bord = scène de
  découverte (« découvrir l'épave »). Embarquement corrigé : le pilote « dedans » (au camp) embarque
  (`flight.ts` n'exige plus `outside`). `shipWorldPos()` → ancre camp.
- ✅ **Vérif** : 263 tests purs (+5 RF1 : DISCOVER_SHIP, dé-gating, embarquement camp…) + e2e M11 (clean)
  « découvrir l'épave » → camp → réparer → décoller → évasion → prestige. Compat save (back-fill).

### **RF2 — Cuirassé explorable : salles + portes + arènes** *(L/XL — cœur de la refonte)*
- ✅ **Sim FAIT** : `executionerDungeon(cx,cz,seed)` dans `dungeon.ts` (antichambre hub → 3 ailes
  ingénierie/martiale/médicale → pont gaté sur les 3 ailes ; layout scripté + butin seedé). Action
  `ENTER_ROOM` (réseau-safe) : verrou d'arène (`noFlee`) + spawn de la vague (ids stables `exec:key:room:i`,
  réutilise M8.6). `SiteProgress.rooms`/`wings` + `SharedEncounter.roomId` (additifs). **Clear ÉMERGENT**
  (TICK 8e, host) : salle vidée → `cleared` + flag d'aile ; **pont nettoyé = cuirassé fini** (`cleared`
  global + route + drop de fin). Tourelles `static` ne poursuivent pas. Compat : `ENGAGE_GUARDIAN`/
  `CLEAR_EXECUTIONER` gardés (dormants jusqu'à RF2b). **8 tests purs** (déterminisme, spawn, gate pont,
  clear émergent, raid complet, replay, réseau-safe, static).
- ✅ **RF2b FAIT (rendu + wiring)** : `render/shipInterior.ts` (salles boîte sol/parois/plafond + sas,
  **portes télégraphiées** rouge=arène/vert=franchissable/bleu=pont scellé+collider, **culling par salle**,
  obscurité locale, accents émissifs « vaisseau alimenté »). `main.ts` : focus `pénétrer`/`entrer — <aile>`/
  `prendre le pont` → `ENTER_ROOM` ; gantelet `ENGAGE_GUARDIAN`/`CLEAR_EXECUTIONER` **retiré du flux** ;
  FPV intérieur ; plateau d'aplanissement élargi ; **back-fill** (vieux gantelet → donjon vidé ; save en
  pleine arène → salle remise à « non entrée »). Aligné sim/rendu (**yaw=0** : les aliens spawnent dans les
  salles). Vérifié : e2e clean (`entrer verrouille l'arène + aliens engagés + pont gaté`) + preview
  (intérieur bâti, FPV, portes, zéro erreur). **263→271 tests, 16→17 e2e.**
- ⏳ **Reste : RF5 (cinématique de seuil)** + le pulse de wind-up émissif (RF3b) — prochain incrément.
- **Accept.** : on explore le cuirassé salle par salle ; entrer dans une salle déclenche un combat
  verrouillé ; le pont s'ouvre une fois les 3 ailes faites ; co-op cohérent. Replay déterministe.

### **RF3 — Ennemis aliens** *(M — données + modèles)*
- ✅ **Données FAITES** : table d'aliens en tier 0 (`world.ts`) — *chitinous horror, unruly welder, alien
  guard, operative, automated/defence turret, unstable automaton* + boss (*unstable prototype 150,
  malformed experiment 200, murderous robot 250, immortal wanderer 500*), stats ADR exactes ; `EnemyDef`
  étendu (`model` + `static?` + `windupSeconds?`).
- ✅ **RF3b FAIT (modèles)** : builders low-poly `buildChitinid`/`buildTurret`/`buildRobot`/`buildWanderer`
  (`characters.ts`), émissif = menace (cyan standard / magenta boss), dispatch `model→builder` dans
  `encounter.ts`, palette étendue. Vérifié en preview (boss « Vagabond Immortel » lisible, zéro erreur).
- ⏳ **Reste (RF2b, avec RF5)** : le pulse de wind-up émissif (`enemyNextAt`) + la revue esthétique en
  contexte (salles sombres) se font quand `ENTER_ROOM` est câblé et l'intérieur rendu.

### **RF4 — Minimap UNIFIÉE & CONTEXTUELLE (échelle monde)** *(M/L)*
- **Un seul widget minimap**, toujours présent, à **3 layers auto-sélectionnés** (CAMP / MONDE / INTÉRIEUR)
  selon le contexte du joueur ; transition fluide à chaque changement ; dessin 2D schématique (pas de
  caméra ortho) ; fog-of-war **partagé co-op** ; joueur + coéquipiers + marqueur d'objectif/edge-pointer ;
  carte plein écran sur touche dédiée. (cf. §3 pour le détail des sources de données par layer.)
- **Phasage interne suggéré** (sans casser l'unité visée) : (a) layer MONDE (sites/routes/fog) → (b) layer
  INTÉRIEUR (graphe de salles, utile dès RF2 pour ne pas se perdre dans le cuirassé) → (c) layer CAMP →
  (d) coéquipiers + carte plein écran. Mais l'**objectif final = le widget contextuel unique**.
- **Accept.** : la MÊME minimap me situe et m'oriente **partout** — au village, en exploration (monde
  entier, sites/routes), en grotte/mine, et dans le cuirassé — en se contextualisant automatiquement ;
  fog-of-war et coéquipiers visibles en co-op.

### **RF5 — TRANSITIONS CINÉMATIQUES de seuil** *(M — partiellement fait)*
- ✅ **Infrastructure FAITE** (`render/threshold.ts`) : `ThresholdCine` (machine d'état PURE & testable :
  `opening→walking→dip→settling`, **timeout-safe** = input jamais perdu) + `AnimatedDoor` (portillon bois /
  herse de grotte / **iris alien coulissant**) + `DipOverlay` (fondu au noir DOM). 100 % LOCAL (zéro désync).
  **4 tests purs** (progression des phases, marche entrée/sortie, timeout, skip).
- ✅ **ENTRÉE DU CUIRASSÉ FAITE** (`main.ts`) : la porte alien s'ouvre → pas franchi (marche scriptée,
  réutilise le mouvement normal — zéro reprise de caméra = faible risque) → **fondu au noir** PILE au seuil
  (qui émet `ENTER_ROOM(antichambre)`) → FPV dedans. Input neutralisé pendant, restauré à la fin. Vérifié
  preview (joue, revient à idle, input rendu, zéro erreur). Hooks debug `testThresholdCine`/`cineActive`.
- ⏳ **Reste** : étendre aux **grottes/mines** (entrée) + la **SORTIE** (« ressortir »), via des verbes de
  seuil ; **caméra serrée** (spring-arm sphere-cast) ; **réglage du FEEL** (durées, choré, esthétique de la
  porte) — à affiner via **playtest** (le ressenti se juge en interactif, pas en headless).
- **Exception : cabane** (garde son fondu 3PV↔1PV). **Accept.** : entrer joue une mini-cinématique fluide,
  aucune coupe sèche, 100 % local.

### **RF6 — Beacon & fins** *(S)*
- `fleet beacon` = drop du boss final du cuirassé ; à l'évasion, **fin étendue** si possédé. **Accept.** :
  deux variantes de fin ; beacon non reporté au prestige.

### **RF7 — Fabricator (optionnel) + polish + audio** *(M)*
- Onglet Fabricator au camp (gaté antichambre cuirassé), audio de fin/espace dédié, équilibrage.

---

## 8. Décisions OUVERTES (à trancher avant de coder RF1+)

1. **Format du décollage** : garder l'« extraction allégée » co-op actuelle (décision porteur), ou se
   rapprocher du **dodge-shooter libre** d'ADR (pilotage + esquive) ? *(reco : garder l'allégée, c'est un
   choix co-op assumé.)*
2. **Caps coque/moteur** : ADR n'en a pas (limité par l'alliage). Garder nos caps (20/3) pour l'équilibre,
   ou les lever pour la fidélité ? *(reco : garder des caps, mais les exposer en config.)*
3. **Cuirassé = obligatoire OU optionnel pour la fin ?** Fidèle = **optionnel** (RF1). Mais pour un climax
   3D, veut-on le rendre **fortement incitatif** (meilleure source d'alliage + beacon + Fabricator) sans
   le rendre obligatoire ? *(reco : optionnel mais très récompensant — fidèle ET satisfaisant.)*
4. **Ampleur des salles du cuirassé** : reproduire les 3 ailes + pont d'ADR, ou une version condensée
   (1 hub + 2-3 salles + pont) pour un premier jet jouable ? *(reco : version condensée d'abord, extensible.)*
5. **Minimap** : ✅ **TRANCHÉ (porteur)** — minimap **UNIFIÉE & CONTEXTUELLE à l'échelle du monde
   entier**, toujours présente, qui se contextualise (camp / exploration-monde / grotte-mine / vaisseau).
   Cf. §3 et RF4. (Seul reste un choix de *phasage* interne, pas de périmètre.)
6. **Transitions de seuil** : ✅ **TRANCHÉ (porteur)** — **cinématique à chaque entrée/sortie** d'environnement
   clos : **GROTTE, MINE, VAISSEAU uniquement** (vrais intérieurs clos). **PAS** les sites de surface
   (ville/cité = fouille en surface, non clos). **Cabane exclue** (garde son fondu actuel). Style recommandé :
   *dolly-through + mi-fondu < 1,5 s, skippable*. Cf. §2.5 et RF5.

---

## 9. Pièges (perf · désync co-op · caméra · ton)

- **Perf** : culling par salle via `setEnabled` (pas d'occlusion GPU en couloir) ; `freezeWorldMatrix` +
  instances pour les statiques ; minimap = dessin 2D du graphe (pas de caméra ortho).
- **Désync co-op (host-autoritaire)** : verrou d'arène, spawn, état des portes, timers, NG+ seed =
  **host**. Le culling/visuel est **local uniquement** (l'hôte simule même hors-champ). Wind-up d'attaque
  envoyé **tôt** ; timers en `startTime` absolu.
- **Caméra** : pas de TPS large en couloir (resserrer/FPV) ; pas de snap (lerp) ; rapprocher vite,
  éloigner lentement.
- **Transitions de seuil (§2.5)** : garder COURT (< 1,5 s) + **skippable** après la 1re fois (lassitude
  sur trajets répétés) ; courbes ease (anti mal des transports) ; **build/free de l'intérieur PENDANT le
  creux au noir** (chargement masqué) ; bien **rendre les commandes** et restaurer l'état caméra à la fin
  (pas de joueur « coincé » si la cinématique est interrompue — prévoir un timeout de sécurité).
- **Ton** : montrer plutôt que dire ; ne pas sur-expliquer le twist du wanderer ; UI minimaliste fidèle ADR.

---

## 10. Réutilisable / À étendre / À créer (issu de l'audit code)

| Système | Fichier | Verdict |
|---|---|---|
| Intérieurs build/free + obscurité + gating | `render/interior.ts` | **étendre** (salles distinctes + portes) |
| Graphe de donjon scripté | `sim/dungeon.ts` | **étendre** (type `executioner` multi-salles) |
| Rencontres partagées (combat co-op) | `sim/state.ts`/`combat.ts` (M8.6) | **réutiliser** (peupler les salles) |
| État/actions vaisseau + vol + prestige | `sim/state.ts`, `flight.ts`, `reducer.ts` | **réutiliser** (RF1 : dé-gater + déplacer) |
| Cinématique de décollage | `render/liftoff.ts` | **réutiliser** (part de la pos du vaisseau) |
| Révélation progressive (cabane) | `render/cabin.ts`, `reveal.ts` | **réutiliser** (vaisseau qui s'assemble au camp) |
| Kit low-poly + rig humanoïde | `render/lowpoly.ts`, `characters.ts` | **réutiliser** (créer variantes aliens) |
| Modèles ship/executioner | `render/sites.ts` | **étendre** (agrandir + intérieur) |
| Placement des sites | `data/world.ts` `sites`, `worldgen.ts` | **réutiliser** |
| Minimap / boussole | — | **à créer** (zéro infra) |
| Seuils animés (portillon/faille/porte iris) + orchestrateur de cinématique de transition | — (FPV existant réutilisé) | **à créer** (composant porte animée + scripteur caméra/input) |
| Atelier (pour Fabricator) | M10 craft UI | **réutiliser/étendre** |

---

## Sources
- **Code source ADR** : [github.com/doublespeakgames/adarkroom](https://github.com/doublespeakgames/adarkroom)
  (`ship.js`, `space.js`, `world.js`, `events/setpieces.js`, `events/executioner.js`, `fabricator.js`,
  `prestige.js`). Wiki (recoupement) : [A Ravaged Battleship](https://adarkroom.fandom.com/wiki/A_Ravaged_Battleship).
- **Industrie** : Level Design Book, Game Developer (Door Problem, Dead Space, Minimalism), Game AI Pro
  ch.47, Unreal TPS camera, Babylon.js docs, Blizzard silhouettes, GDKeys — liens en §5.
