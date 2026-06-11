# Plan d'implémentation — le campement de départ (spawn fixe)

> ⚠️ **MAJ juin 2026 — placement désormais MATHÉMATIQUE (Chantier C — C).** Le campement n'est plus
> placé à la main : les bâtiments sont positionnés par **`generateCampLayout()`** (`data/world.ts`) —
> phyllotaxie de Vogel + nombre d'or + **quartiers** + relaxation anti-chevauchement (cf.
> [`refonte-monde-campement.md`](refonte-monde-campement.md) §C). L'**intention** décrite ici (quartiers,
> gradient artisanat O / industrie E / chasse N / habitat S) **reste valable** ; les ancres manuelles
> ci-dessous et l'éditeur de spawn **F2** sont conservés pour référence/debug, mais ne sont plus la source
> de vérité. Décor sol (`campDecor`), **lanternes** par palier (`campLights`) et **ruines** (`campRuins`) ajoutés.

> **But.** Donner au **campement de départ** une organisation **fixe, dessinée à la main**
> (≠ la génération aléatoire du monde, qui reste intacte au-delà), conforme au plan
> narratif : échanges/vie sociale au centre, artisanat propre à l'ouest, industrie sale
> rejetée à l'est, chasse/forêt au nord, approche/commerce ouverts au sud, habitat dispersé.
> Plus : **décor au sol** au camp, **chemins** (principaux dessinés + émergents par le trafic),
> et **villageois qui contournent les obstacles**.
>
> **Respecte** [`architecture.md`](architecture.md) : le **layout est une DONNÉE**
> ([`data/world.ts`](../data/world.ts)) ; décor/chemins/évitement vivent dans la couche
> **« corps » LOCALE** (cosmétique, non synchronisée, sans physique lourde) — **zéro impact
> sim/déterminisme/réseau**, comme la forêt et les villageois aujourd'hui.

## Décisions actées
- **Ancres fixes uniquement** : on ne pré-construit PAS le village. Le feu + la cabane en ruine
  démarrent comme aujourd'hui ; chaque bâtiment **construit** se pose à son **ancre fixe** du plan
  (au lieu des anneaux concentriques `ringSlot`). **Aucun changement de simulation.**
- **Chemins émergents = carte de chaleur** (DynamicTexture) : un plan transparent au-dessus de la
  clairière, tamponné par le passage des villageois, qui s'accumule et décroît. Chemins principaux
  pré-tamponnés. Léger, organique, fidèle au low-poly.

## Boussole du campement
Feu au centre `(0,0)`. **Nord = −Z** (forêt), **Sud = +Z** (friche/approche, le joueur apparaît au
sud en `z=+8`), **Ouest = −X** (artisanat), **Est = +X** (industrie). Par défaut, **tout bâtiment
regarde le feu** (sa façade `+z` locale pointe vers l'origine) ; exception : le **poste de traite**
s'ouvre vers la friche (sud).

## État de l'existant (ce qu'on remplace)
| Sujet | Aujourd'hui | Fichier |
|---|---|---|
| Placement des bâtiments | `ringSlot()` = anneaux concentriques, yaw arbitraire `slot*1.3` | [buildings.ts](../src/render/buildings.ts) |
| Cabane | position **codée en dur** `(-7,-5)` | [cabin.ts](../src/render/cabin.ts) |
| Forêt du camp | 24 arbres **dispersés tout autour** | [`trees[]` data/world.ts](../data/world.ts) |
| Décor au sol au camp | **rien** (le scatter saute le biome `camp`) | [terrain.ts](../src/render/terrain.ts):270, [worldgen.ts](../src/sim/worldgen.ts):213 |
| Déplacement villageois | **ligne droite**, traverse tout (aucun évitement) | [villagers.ts](../src/render/villagers.ts):236 |
| Chemins | **inexistants** | — |
| Colliders des bâtiments | **aucun** (le joueur traverse aussi tout sauf arbres + murs de la cabane) | [buildings.ts](../src/render/buildings.ts) |

## Layout cible (chiffré, RESSERRÉ ; à affiner en jeu)
> Densité revue (cf. vue concept) : cœur collé à la clairière, **quartier des métiers & échanges en
> grappe** (on passe d'un atelier à l'autre en quelques pas), logements rapprochés. Seules la chasse
> (pièges/pavillon) et l'industrie (aciérie) gardent leur distance — le gradient est conservé, comprimé.

| Élément | Ancre (x,z) | Orientation |
|---|---|---|
| cabane (stockage) | (−5, −4) NO, bord de place | porte vers le feu (sud) |
| charrette (+ pile de bois) | (5, 4) SE, bord de place | face feu |
| **Arc « métiers & échanges » (O, r≈10, du SO au NO)** | | |
| poste de traite | (−7, 7) | **vers la friche (sud)** |
| armurerie | (−9.5, 3) | face feu |
| tannerie | (−10.5, −1.5) | face feu |
| atelier | (−10, −7) | face feu |
| **Au loin (gradient conservé)** | | |
| fumoir | (2, −11) (sentier nord, chasse) | face village |
| pavillon (loge) | (−1, −17) N (clairière des pins) | face village |
| aciérie | (15, 0.5) E (tenue à l'écart) | face feu |
| pièges (≤10) | **arc large O→N→E** (−22,1)…(−1,−24)…(24,1) — disséminés | — |
| huttes (≤20) | grappes SO ≈(−11,11) · S ≈(3,14) · SE ≈(10,11) · anneau extérieur | face feu |

→ poste de traite + armurerie + tannerie + atelier = **arc régulier « métiers & échanges »** (O),
tous tournés vers le feu. Pièges **hors du village**, disséminés en **arc autour de la forêt nord**.
Huttes en grappes dans les poches sud (S/SO/SE), le long des sentiers.

## Éditeur de spawn (DEV — `src/dev/spawnEditor.ts`)
Outil intégré pour **dessiner l'implantation** : touche **F2** (ou `window.__game.editSpawn()`).
Passe en **vue de dessus** (sans brouillard), masque le village réel et affiche un **ghost** (vrai
modèle) par ancre de `campLayout` + la cabane. **Clic** = sélectionner / glisser sur le sol · **molette**
= zoom · **clic-droit** = déplacer la vue · **[** **]** = tourner (Maj = pas fin) · **flèches** = ajuster ·
**+ hutte / + piège** = ajouter · **supprimer** · **exporter** = produit le `campLayout` (console +
presse-papier + zone de texte) à coller dans [`data/world.ts`](../data/world.ts). **Échap** / F2 = quitter
(restaure le jeu). Aucune écriture automatique : l'outil ne fait que **proposer le texte du layout**.

> ⚠️ **CORRECTION (juin 2026, audit)** : section **partiellement périmée**. Les **chemins dessinés sont de
> nouveau ACTIFS** — `CampPaths` est câblé (`main.ts` ~`:226`) et **rend** les polylignes de `campLayout.paths`
> via une DynamicTexture drapée (`render/campPaths.ts`). Restent retirés/inertes : la coloration **par facette**
> (`paintGround`) et les **trails émergents** (`render/trails.ts` = code mort, `setTrails` jamais appelé).
> Améliorations prévues (résolution + decal de terre) : cf. [`refonte-monde-campement.md`](refonte-monde-campement.md) §D.

## Sol dessiné du campement — ⛔ RETIRÉ (chemins ré-activés depuis — voir correction ci-dessus)
Tentative (clairière de terre tassée + sentiers peints **par facette** dans `paintGround`) **abandonnée** :
les facettes du terrain sont trop grosses (~3 u) pour rendre des chemins nets → toute la zone du camp
virait au marron uniforme, sans chemin lisible. Le sol du camp est revenu au **sol de biome naturel**.
Idem pour les **chemins émergents** (carte de chaleur `trails.ts`) : wiring retiré de `main.ts`.
- Fichiers conservés (dormants, réutilisables) : [`campGround.ts`](../src/render/campGround.ts) (encore
  utilisé par `campDecor` pour la logique de placement) et [`trails.ts`](../src/render/trails.ts).
- **Reprise possible** : pour de vrais chemins, faire un **overlay de texture fine** (plan drapé avec
  une vraie texture/decal, comme le plan des trails) plutôt qu'une coloration par sommet du terrain grossier.
Vue de dessus de debug : `window.__game.planView()`.

---

## Les phases

### Phase 1 — Layout fixe + forêt orientée *(en cours)*
- **`data/world.ts`** : table `campLayout` (ancres `{x,z,face?}` par type + cabane + huttes pré-réparties)
  et **réécriture de `trees[]`** : pinède dense au **nord**, **trouée** autour du pavillon, **sud dégagé**.
- **`buildings.ts`** : `ringSlot` → lecture des ancres `campLayout` ; yaw = `face` (« fire » par défaut,
  « south » pour le poste de traite, ou angle explicite). `ringSlot` conservé en **repli** de sécurité.
  Ajout d'une **petite pile de bois** au modèle de la charrette.
- **`cabin.ts`** : position lue depuis `campLayout.cabin` (au lieu de `(-7,-5)`).
- **`forest.ts`** : `speciesFor` biaisé par position → **conifères au nord** (pinède).
- ✅ Critère : `npm run typecheck` vert ; village construit conforme au plan ; forêt nord-dense.

### Phase 2 — Décor au sol du camp ✅ FAIT (`render/campDecor.ts`)
`CampDecor` disperse (graine dédiée, **déterministe**) `grass/flower/fern/mushroom/rock/drybush` du
registre [`Decor`](../src/render/scatter.ts) dans les **poches vivables**, en **excluant** : le foyer
(r < 4,2), les **sentiers** et la **clairière fondue** (via `campGround`), les **emprises des bâtiments**
(cabane + `campLayout`) et les **arbres** du camp. Densité **faible au centre** (place usée), **plus
fournie vers la lisière**. Cosmétique & local ; masqué par l'éditeur de spawn. La géométrie clairière/
sentiers est **partagée** dans [`render/campGround.ts`](../src/render/campGround.ts) (utilisée par
`terrain.ts` ET `campDecor.ts`, plus de duplication).
- ✅ Critère : le sol du camp n'est plus nu (herbes/fleurs/cailloux) ; clairière, sentiers et bâtiments restent dégagés.

### Phase 3 — Chemins émergents ⛔ RETIRÉ (code conservé dans `render/trails.ts`)
> Retiré en même temps que le sol dessiné (chemins peu lisibles). Wiring enlevé de `main.ts` ; le
> module reste pour une reprise éventuelle (overlay de texture fine plutôt que coloration de facettes).

<!-- description d'origine (archive) :
### Phase 3 — Chemins émergents (`render/trails.ts`)
Les sentiers principaux sont **dessinés dans le sol** (Phase 1 ci-dessus). Les **émergents** : une
grille d'accumulation (`Trails`) que chaque pas de villageois noircit (`stamp`) et qui **décroît
lentement**, rendue dans une DynamicTexture sur un **plan drapé au-dessus de la clairière**. Trace
légère (terre damée, alpha ≤ 0.55) qui se creuse là où le trafic est dense → renforce les sentiers.
Cosmétique & local (zéro réseau). Amorti (upload ~10 Hz).
-->

### Phase 4 — Navigation des villageois ✅ FAIT (`render/navGrid.ts` + `render/villagers.ts`)
**Pathfinding A\*** sur grille de navigation (remplace l'ancien champ de potentiel qui restait bloqué
~7 % des trajets — minima locaux). Mesuré en simulation : **6,9 % → 0,8 % de blocage**, ~44 µs/chemin.
- **`NavGrid`** (pur, testable) : grille du camp, cellule bloquée si `< rayon+corps` d'une emprise
  (`Village.getObstacles()` + cabane + feu ; pièges franchissables, rayon 0). `findPath` → waypoints
  lissés (ligne de vue), `[goal]` direct si la ligne est dégagée ou hors-camp. Tampons réutilisés.
- **`villagers`** : chemin calculé **au retarget** (pas par frame), suivi par waypoints **sans répulsion
  réactive** (qui rouvrait les minima/pièges de couloir) ; seule une **poussée dure** garantit qu'on ne
  finit jamais dans une emprise. **Filet anti-blocage** : si la progression réelle s'effondre > 4 s →
  re-choix de cible (pas de no-clip). Coût en jeu ≈ 0,2 ms/s. Tests : [`navGrid.test.ts`](../src/render/navGrid.test.ts).

#### Biais « suivre les sentiers » — DYNAMIQUE (data-driven)
`NavGrid` accepte un coût par cellule `1 − PATH_PREFER·pathIntensity(x,z, campLayout.paths)` (cellules
sur un sentier dessiné = moins chères → A\* les préfère sur les détours). **Adaptatif** : la signature
de cache de `villagers.ensureNav()` couvre **emprises ET chemins** (points + largeur) → dès que tu
**déplaces/ajoutes/retires un chemin**, la grille (et donc le biais) se reconstruit. Aucune géométrie en
dur : tout vient de `campLayout.paths`. `PATH_PREFER` (0,35) tunable, 0 = off. Validé par tests
(détour suit le sentier sud vs nord ; déplacer le tracé change l'itinéraire).
- *Note* : le biais ne joue que sur les **détours** (quand un bâtiment force A\*) ; sur terrain dégagé
  les villageois vont droit (raccourci ligne de vue). Pour qu'ils suivent les routes même à découvert,
  il suffirait de lancer A\* aussi quand la ligne est dégagée si un biais existe (1 ligne, perf OK).

### (archive) Phase 3 — Chemins (principaux dessinés + émergents)
- **5–6 chemins authored** (données) : feu → artisanat (O) ; feu → forêt (N, fourche fumoir/pavillon) ;
  feu → aciérie (E) ; feu → poste de traite (SE) ; feu → logements (S/SO).
- **Émergents** : carte de chaleur sur DynamicTexture (un plan au-dessus de la clairière). Chaque pas
  de villageois tamponne une brosse douce (accumulation + décroissance lente) ; chemins principaux
  pré-tamponnés. Sert aussi de **réseau de waypoints** pour la Phase 4.
- ✅ Critère : chemins visibles, légers ; se renforcent là où les villageois passent.

### Phase 4 — Villageois qui contournent les obstacles
- **Steering + push-out** sans physique : registre d'obstacles du camp (cercles/emprises des bâtiments
  + cabane, exposés par `Village`/`Cabin`). Dans `villagers.update` : (a) ne jamais rester dans une
  emprise (poussée hors-obstacle), (b) contourner par la tangente si le segment vers la cible croise
  un obstacle. Optionnel : biaiser le trajet le long du réseau de chemins (renforce les chemins émergents).
- À décider plus tard : ajouter aussi des **colliders** aux bâtiments pour que **le joueur** ne les
  traverse plus (aujourd'hui il les traverse).
- ✅ Critère : les villageois ne traversent plus les bâtiments.

## Construction visuelle ✅ FAIT (« assemblage par éléments », fonctionnel à la fin)
Un bâtiment ne surgit plus d'un coup : il est **bâti pièce par pièce**, et il ne compte dans la sim
(capacité, métiers, plafonds) **qu'une fois achevé**. Choix utilisateur : *B — assemblage par éléments*
+ *fonctionnel à la fin de la construction*.
- **Sim** (`sim/state.ts` + `sim/reducer.ts`, déterministe → P2P-safe) : nouveau champ
  `constructing: {id, doneAt}[]` = **file de chantiers séquentielle** (un seul actif à la fois).
  `BUILD` **débite le coût immédiatement** et **enfile** (n'incrémente plus `buildings`) ; le compte
  pour le *maximum* et le *coût escaladant* est `plannedCount` = achevés + en file. `TICK` fait avancer
  la tête : à `doneAt`, `buildings[id]++`, on retire la tête, le suivant **démarre**. Durées dans
  `data/world.ts` (`Craftable.buildSeconds`, défaut `config.construction.defaultSeconds`). La save
  (fusion sur les défauts) et le snapshot réseau (état complet) le transportent sans surcoût.
  Tests : `sim/sim.test.ts` (enfilage, débit immédiat, séquentiel, plafond avec file, « fonctionnel
  à la fin », déterminisme du replay).
- **Montée mutualisée** (`render/reveal.ts`) : `prepareReveal(root)` trie les meshes d'un assemblage
  par hauteur et `applyReveal(els, p)` les fait sortir de terre du bas vers le haut (petit « pop »
  d'échelle, taille finale non uniforme préservée). PARTAGÉE par les bâtiments ET la cabane.
- **Rendu** (`render/buildings.ts`) : `Village.sync(buildings, constructing)` crée un **CHANTIER** pour
  le bâtiment de tête, à son ancre (caché au départ). Ses meshes sont triés par hauteur (centre) et
  **révélés du bas vers le haut** (fondation → murs → détails → toit) avec un petit « pop » d'échelle
  (`easePop`, fenêtre `REVEAL_WINDOW`) ; la taille finale non uniforme est préservée (`base`). À
  l'achèvement, la sim pose le vrai bâtiment complet (collider + fumée) et le chantier est retiré
  (pas de doublon). Pièces initialement masquées (ex. état « pris » d'un piège) ignorées.
- **La montée DÉMARRE À L'ARRIVÉE de la constructrice** : `revealChantier(tick, builderArrived)`
  (appelé après `setBuildSite`) verrouille `revealStart` au tic où elle arrive sur place, puis fait
  monter le bâtiment de `revealStart` jusqu'à `doneAt` → il **finit pile quand il devient fonctionnel**
  (aucun « pop »). Tant qu'elle n'est pas là, rien ne sort de terre (`progress = 0`). C'est **cosmétique
  et local** : la complétion (sim) reste autoritaire/synchronisée ; chaque pair voit la montée démarrer
  à l'arrivée de SA constructrice. Vérifié en headless (avancer la sim sans la déplacer → `progress`
  reste 0 ; une fois arrivée + temps → 0 → 0,5).
- **Filet ANTI-POP** (`MIN_RISE_TICKS` ≈ 2 s) : si le trajet est plus long que le chantier et que la
  constructrice n'est pas encore arrivée, la montée se DÉCLENCHE QUAND MÊME sur les dernières secondes
  (`doneAt − tick ≤ MIN_RISE_TICKS`). Conséquence : un bâtiment ne surgit **jamais** d'un coup — au pire
  il monte vite à la fin. (Bug observé ~15 % du temps avant, surtout sur les pièges = durée courte +
  emplacement lointain.) Vérifié headless : sans déplacer la constructrice, `progress` reste 0 jusqu'aux
  2 dernières secondes puis monte (0 → 0,5), au lieu d'apparaître d'un coup.
- **Constructrice** (`render/stranger.ts` + `render/characters.ts`) : son bras droit + le marteau sont
  groupés sous un **pivot d'épaule `armR`** ; `setBuildSite(centre)` l'envoie **marcher jusqu'au
  chantier** (`SPEED` 2,4 u/s, arrêt à `BUILD_STANDOFF`) où elle **frappe au marteau** (oscillation de
  `armR`, fondue). `isAtBuildSite()` (distance position↔site, robuste au changement de chantier) pilote
  le démarrage de la montée. `null` → elle reprend son activité (feu / coin de cabane).
- **Durées** allongées (réalisme) : `buildSeconds` 10 (piège) · 11 (charrette) · 14 (hutte) · 16
  (métiers) · 18 (atelier) · 20 (aciérie/armurerie) ; `config.construction.defaultSeconds` 12. La montée
  visible = `doneAt − arrivée` ; `SPEED` 2,9 u/s pour qu'elle arrive bien avant la fin et laisse une
  longue montée. (Réglables : `buildSeconds` dans `data/world.ts`, `SPEED` dans `stranger.ts`.)
- *Nuance* : l'horloge sim **démarre au clic** (le coût part tout de suite, l'affordabilité se met à
  jour en direct), mais la **montée visuelle n'apparaît qu'à l'arrivée** de la constructrice. Tous les
  bâtiments sélectionnés sont bâtis **en séquence**.
- **Cabane principale** (`render/cabin.ts`) : même montée (via `reveal.ts`) lors d'une **augmentation de
  palier en cours de partie** — réparation (ruine 0 → ×1) et améliorations (×1 → ×5 → ×10). `setTier`
  distingue une **augmentation jouée** (anime, `startRise`) d'un **calage initial** (partie fraîche ou
  sauvegarde chargée → instantané, drapeau `established`) ; `cabin.update(dt)` déroule la montée
  (`CABIN_RISE_SECONDS` 6 s), l'aménagement intérieur (coffres, tableau) ne se pose **qu'à la fin**.

## Sentiers DYNAMIQUES + dégagement des emprises ✅ FAIT
- **Réseau de sentiers généré** (`data/world.ts` → `campPathsFor(positions)`) : **arbre couvrant minimal
  (Prim)** sur `{feu(0,0), cabane, bâtiments construits}` -> chaque structure est reliée au **centre**
  ET, de proche en proche, à ses **voisines**. **Pur & déterministe**. Croît avec le village : **1 segment
  par bâtiment** (hors pièges, tenus à l'écart dans les bois). `campLayout.paths` est désormais VIDE au
  départ et **rempli au runtime** (`main.ts`, à chaque achèvement ou réparation de cabane) ; re-cuit par
  `CampPaths.rebake()` et **suivi par les villageois** (le biais navGrid se reconstruit seul via sa
  signature). Vérifié : 26 bâtiments + cabane → **27 segments**.
- **Dégagement des emprises** (`Village.setOnPlaced` → `forest.clearFootprint` + `campDecor.clearFootprint`) :
  dès le **début du chantier** (et à l'achèvement / au chargement), les **arbres** du camp et le **décor au
  sol** (cailloux…) présents sur l'emprise sont **retirés** ; les emplacements d'arbres concernés sont
  **EXCLUS** (drapeau `excluded`) -> **plus aucune repousse** dedans (`forest.update` saute ces slots).
  Rayons `CLEAR_R` par type (un peu plus larges que la silhouette). Vérifié : `treesOnBuildings = 0`.

## Risques / garde-fous
- **Déterminisme/P2P** : tout le travail reste dans la couche corps **locale** ; aucune ressource ni
  position de bâtiment n'entre dans l'état de sim. Les ancres sont identiques chez tous (données).
- **Perf** : décor en `createInstance` (comme le scatter sauvage) ; carte de chaleur = 1 seul plan +
  1 DynamicTexture (pas de travail par-vertex, pas de mesh par chemin).
- **Repli** : si un type dépasse le nombre d'ancres (ne devrait pas, borné par `maximum`), `ringSlot`
  reprend la main → jamais de crash.
- **Cabane** : repositionnée sans rotation en Phase 1 (sa porte `+z` regarde déjà la clairière depuis
  le NO). Rotation arbitraire = raffinement ultérieur (les colliders ne sont pas parentés au root).
