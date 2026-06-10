# Plan d'implémentation — le campement de départ (spawn fixe)

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

## Sol dessiné du campement — ⛔ RETIRÉ
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

### Phase 4 — Évitement des obstacles ✅ FAIT (`render/villagers.ts`)
Registre d'**emprises** (`Village.getObstacles()` + cabane, exposé via `landmarks.obstacles()`). Dans
`villagers.update` : **braquage d'évitement** (répulsion des emprises proches mêlée à la direction
voulue) + **poussée dure** (un villageois ne finit jamais à l'intérieur d'une emprise) → ils
**contournent** les bâtiments au lieu de les traverser. Les cibles de travail sont aussi repoussées
hors des emprises pour rester atteignables. Pièges franchissables (rayon 0). Sans physique, très léger.

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

## Risques / garde-fous
- **Déterminisme/P2P** : tout le travail reste dans la couche corps **locale** ; aucune ressource ni
  position de bâtiment n'entre dans l'état de sim. Les ancres sont identiques chez tous (données).
- **Perf** : décor en `createInstance` (comme le scatter sauvage) ; carte de chaleur = 1 seul plan +
  1 DynamicTexture (pas de travail par-vertex, pas de mesh par chemin).
- **Repli** : si un type dépasse le nombre d'ancres (ne devrait pas, borné par `maximum`), `ringSlot`
  reprend la main → jamais de crash.
- **Cabane** : repositionnée sans rotation en Phase 1 (sa porte `+z` regarde déjà la clairière depuis
  le NO). Rotation arbitraire = raffinement ultérieur (les colliders ne sont pas parentés au root).
