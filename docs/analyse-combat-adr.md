# Analyse de fidélité — combat & exploration vs A Dark Room original

> **Pourquoi ce document** : après test, le porteur trouve le jeu « assez éloigné du jeu originel »
> (taux d'apparition des monstres, déroulement des combats, rôle des lieux). Audit ligne à ligne du
> **code source original** (`doublespeakgames/adarkroom`, branche master : `world.js`, `events.js`,
> `events/encounters.js` 437 l., `events/setpieces.js` 3 587 l., `events/executioner.js` 2 343 l.)
> comparé à notre implémentation (M8/M9/M10). Trois constats structurants, puis la table des écarts
> et un plan de remise en conformité (M8.5).
>
> *Établi : juin 2026. Copies locales des sources : `/tmp/adr_{world,events,encounters,setpieces,executioner}.js`.*

---

## 1. Comment ADR fonctionne VRAIMENT (résumé des sources)

### 1.1 Le déclenchement des combats est lié au DÉPLACEMENT, pas au temps
- Chaque **pas** sur la carte (case non-lieu, hors village) fait : conso d'eau (1 pas) / viande
  (2 pas — et **manger en marchant SOIGNE +8 PV**), puis `checkFight()`.
- `checkFight()` : compteur `fightMove++` ; le tirage (20 %, ×0,5 avec le perk *furtif*) n'a lieu
  qu'à partir du **4ᵉ pas** après le dernier combat (`FIGHT_DELAY: 3`) ; un tirage réussi remet le
  compteur à zéro **même si aucune rencontre n'est éligible**.
- **Immobile = AUCUN combat.** Le minuteur 3–6 min des événements ne pioche jamais dans les
  rencontres.
- **Aucune « zone sûre » pour le tirage** : on peut être attaqué à 1 case du village. La distance
  ne fait que choisir la table (tiers ≤10 / 11–20 / >20 Manhattan).
- **Marcher sur une ROUTE = zéro rencontre** (aucune table ne matche le terrain route — pas une
  simple réduction).
- Marcher sur un **lieu** ne consomme rien et ne tire pas de combat : ça déclenche son **setpiece**.

### 1.2 Les rencontres aléatoires sont gatées par distance ET TERRAIN
11 rencontres (4 + 4 + 3), chacune liée à un biome : la bête grondante ne surgit **qu'en forêt**,
le sniper **que dans les hautes herbes**, les hommes (décharné, grelottant, charognard, soldat)
**que dans les terres arides**. Tables exactes (PV/dég/hit/délai/loot) en annexe A.

### 1.3 L'essentiel du combat vit dans les SETPIECES scriptés des lieux
Chaque lieu est une **machine à scènes** avec embranchements pondérés, combats scriptés, coûts en
torches et butins précis (annexe B). En bref :
| Lieu | Forme | Combats | Issue |
|---|---|---|---|
| **Maison** (×10) | 1 tirage : 25 % médecine / 25 % vivres + **eau remplie** / 50 % **squatter** (10 PV) | 0–1 | one-shot (`markVisited`) |
| **Grotte** (×5) | 11 scènes, 4 niveaux, **1 torche à l'entrée** (+1 possible) | **2–3 scriptés** (bêtes 5→10 PV, lézards 6→10) | 3 fins de butin ⇒ **devient un avant-poste** |
| **Mine de fer** | linéaire, 1 torche | **1 boss : matriarche bestiale** (10 PV/4 dég) | route + **débloque la mine/mineurs** |
| **Mine de charbon** | linéaire | **2 hommes (10 PV) + le chef (20 PV/5)** | idem |
| **Mine de soufre** | linéaire | **2 soldats (50 PV/8, ranged) + vétéran (65 PV/10)** | idem |
| **Ville** (×10) | 18 scènes, 5 niveaux, torche sur 2 branches/3 | **2–3 par traversée** (voyous/bêtes/justicier 25–30 PV ; fou 10 PV/6 dég/hit 0,3) | fins (dont **fusil garanti**) ⇒ **avant-poste** |
| **Cité** (×20 !) | ~33 scènes, 4 grandes branches (rues/militaire/bidonville/hôpital) | jusqu'à 3 (snipers/commandos 30–55 PV, monstres d'hôpital 40–60 PV, **combats forcés sans sortie**) | 15 fins (laser, grenades, **alliage**) ⇒ avant-poste + **`cityCleared`** |
| **Marais** | 3 scènes, coût **1 charme** | 0 | perk **gastronome** |
| **Champ de bataille** | 1 scène | 0 | **armes lourdes** : fusils 0,5, laser 0,3, grenades 0,5, alliage 0,3 |
| **Forage** | 1 scène | 0 | **alliage 1–3 garanti** |
| **Épave / Cuirassé** | endgame | (cuirassé : ~20 combats, 4 boss + l'immortel 500 PV) | M11 |

### 1.4 Le moteur de combat
- **Un bouton PAR ARME portée** (cooldown propre) ; poings si rien. Soins : viande (5 s),
  médecine (7 s), hypo. **PAS de bouton fuir** — un combat se finit par victoire, mort ou script.
- Vaincre ⇒ **écran de BUTIN** (prendre un/tout/laisser, menu de délestage si sac plein), puis
  `continue` enchaîne la scène suivante du setpiece.
- Tirage de butin : `min..max-1` (le max déclaré n'est jamais tiré), chance par entrée.
- Ennemis *ranged* = différence d'animation seulement. PV/armure : 10 base, 15/25/45/85.
- **Mourir** : perte de l'outfit (consommables + armes portées), **état du monde de l'expédition
  perdu** (les lieux « visités » non commis), **cooldown de 120 s** avant de repartir. Les
  possessions des *stores* (armures, outres, sacs) sont conservées.
- **Avant-postes : réutilisables à CHAQUE expédition** (reset au départ du village).
- `checkDanger` : avertissement à ≥8 cases sans armure de fer, ≥18 sans acier.
- Perks d'usage : *furtif* (rencontres ×0,5), *boxeur/artiste martial/maître* (poings ×2/×3/×2 à
  50/150/300 coups), *métabolisme lent*, *rat du désert*… en plus des 3 du Maître.

---

## 2. Notre implémentation aujourd'hui (M8/M9/M10)

- Déclenchement **par TEMPS d'exposition** : tirage toutes les 20 s dehors (20 %, grottes 30 %),
  routes ×0,4, répit 45 s post-victoire / 20 s post-fuite. **Immobile dehors = harcelé** ;
  courir n'augmente pas le risque. Pas de notion de pas ni de FIGHT_DELAY en pas.
- Tables : 11 ennemis mais **sans gating de biome**, avec la **créature à deux têtes manquante**,
  un « tier 4 cavernes » inventé (table aléatoire au lieu des combats scriptés), des `attackDelay`
  largement faux (ADR frappe à 1–2 s, nous 2–4 s), des loots inexacts (pas de **fusil** au soldat/
  sniper 20 %, homme grelottant amputé, quantités 1–2 au lieu de 5–10…), pas de *ranged*.
- **`FLEE` inventé** (bouton de fuite sans coût — n'existe pas dans ADR).
- **Setpieces : la pièce maîtresse manque.** Nos grottes/mines (M9) sont des intérieurs physiques
  **sans gardiens** : `SECURE_MINE` est une simple interaction là où ADR impose la matriarche / les
  hommes + chef / les soldats + vétéran. Maisons/villes/cités = silhouettes sans contenu. Marais
  sans gastronome. Pas de `cityCleared`.
- Champ de bataille/forage (R3a) : l'esprit y est (fouille), mais le butin diverge (pas d'armes
  lourdes au champ de bataille ; ADR y garantit des fusils/laser/grenades).
- Butin de victoire **directement au sac** (pas d'écran prendre/laisser) ; tirage `min..max`
  inclus (ADR : `max-1`).
- Avant-postes **à usage unique permanent** (ADR : par expédition).
- Mort : pas de cooldown 120 s. Viande ne soigne pas en marchant (drain par temps, acté M7).
- Le moteur de duel (armes à cooldown, manger/se soigner, mort = perte du sac) est, lui, fidèle.

---

## 3. Table des écarts, priorisée par impact sur le ressenti

| # | Écart | Gravité ressenti | Effort |
|---|---|---|---|
| **E1** | Déclenchement par temps (vs **par pas**, min 3 pas, jamais immobile) | 🔴 c'est le « taux d'apparition » perçu | M |
| **E2** | **Aucun combat scripté aux lieux** (mines sans gardiens, grottes sans bêtes, maisons vides) | 🔴 le cœur d'ADR | L |
| **E3** | Tables d'ennemis : biome ignoré, stats/loots faux, 2-têtes absente, ranged absent | 🟠 | S |
| **E4** | `FLEE` gratuit inventé / pas d'écran de butin / loot `max` inclus | 🟠 | S/M |
| **E5** | Routes ×0,4 (vs **0**) ; « tier cavernes » aléatoire (vs scripté) | 🟠 | XS |
| **E6** | Avant-postes one-shot permanents (vs par expédition) ; pas de cooldown de mort 120 s | 🟡 | S |
| **E7** | Maisons/marais/cache sans événement ; champ de bataille sans armes lourdes | 🟡 | S/M |
| **E8** | Perks d'usage absents (furtif, boxeur…) ; `checkDanger` absent | 🟡 | S |
| **E9** | Villes/cités sans intérieur (= R3b, déjà au backlog) | 🟠 | L |

---

## 4. Plan de remise en conformité — « M8.5 : fidélité combat & lieux »

> **État (juin 2026)** : **F1 ✅ F2 ✅ F3.1 ✅ F3.3 ✅ F3.4 ✅ F4 ✅** (sauf écran de butin —
> différé). Livrés : déclencheur par pas · tables exactes/biomes · mines gardées · **maisons
> 25/25/50 (médecine / vivres + eau / squatteur)** · **marais → gastronome (1 charme)** · **champ
> de bataille = armes lourdes ADR · forage = alliage 1–3 garanti seul** · **viande soigne en
> voyage (+8, gastronome ×2)** · **mort = 120 s de repos forcé** · **avant-postes par expédition**
> · **désengagement physique** (distancer l'ennemi > 18 u — poursuite bornée 8 u/s ; derniers
> gardiens incassables) · **avertissements checkDanger**. Restent : **F3.2** (grottes scriptées),
> **R3b/F3.5 ✅ VILLES & CITÉS SCRIPTÉES** (graphes town/city d'ADR condensés en branches seedées :
> voyou/charognard/justicier/fou en ville ; sniper/commando/difformes/tentacules en cité, avec les
> **combats forcés d'hôpital sans fuite** ; butins et fins exacts dont fusil garanti, laser, alliage ;
> séquence jouée en SURFACE parmi les ruines, cache finale gatée, nettoyée ⇒ avant-poste). Restent :
> **écran de butin** (F4), **F5** (perks d'usage : furtif, boxeur…), `cityCleared`→Raid militaire (M10).

> Principe : on garde le **monde 3D continu** (acté) — l'unité « pas » d'ADR devient la **distance
> parcourue** (1 pas ≡ 1 cellule de 12 u), mesurée localement et signalée à la sim comme
> `SET_OUTSIDE` (le pont position→sim existant).

### Phase F1 — Le déclencheur fidèle (E1, E5) — M
- Le client mesure la **distance parcourue** dehors (podomètre local, cellule par cellule) et émet
  `STEPS {playerId, n}` (cumul borné, edge/batch). La sim tient `fightSteps` par joueur : tirage
  20 % **par pas** au-delà de 3 pas depuis le dernier combat — fidèle `checkFight`. **Plus aucun
  tirage par temps** ⇒ immobile = tranquille, courir loin = risqué.
- **Route = 0 rencontre** (le pas sur cellule route n'incrémente pas / ne tire pas, fidèle).
- Tirage à toute distance dehors (suppression du seuil de tier minimal), la distance ne choisit
  que la table. Avertissements `checkDanger` (toast à 8/18 cellules ADR ×2 selon armure).
- Supprimer le « tier 4 cavernes » aléatoire (remplacé par F3).

### Phase F2 — Tables exactes (E3) — S
- Recopier l'annexe A : 11 ennemis, stats/loots/délais **exacts**, + `terrain` (biome worldgen
  déjà connu du client → porté par `STEPS` ou recalculé : le tirage utilise le biome de la cellule
  courante), + `ranged` (anim), + fusil 20 % au soldat/sniper, médecine 0,7 au grelottant.

### Phase F3 — Setpieces de lieux (E2, E7) — L, par étapes
1. **Mines gardées** (S) : `SECURE_MINE` exige d'avoir vaincu les gardiens scriptés — fer :
   matriarche (10/4) ; charbon : 2 hommes (10/3) + chef (20/5) ; soufre : 2 soldats (50/8 ranged)
   + vétéran (65/10). Enchaînés via le moteur de rencontre existant (combat forcé, scène suivante
   à la victoire).
2. **Grottes scriptées** (M) : conserver l'intérieur physique M9, mais les nœuds deviennent des
   **scènes** : bêtes/lézards scriptés aux embranchements (stats annexe B), 2ᵉ torche possible,
   3 fins de butin exactes ⇒ avant-poste (déjà fait).
3. **Maisons** (S) : à l'approche, tirage 25/25/50 (médecine ×2–5 / vivres + **eau remplie** /
   squatter 10 PV) — one-shot (`sites[k].visited`).
4. **Marais** (XS) : E → dialogue, coût 1 charme ⇒ perk **gastronome** (viande ×2 — brancher au
   soin). **Champ de bataille** (XS) : butin ADR exact (fusils/laser/grenades/alliage). **Forage** :
   alliage garanti 1–3.
5. **Villes/cités** (= R3b, L) : porter les graphes 18/33 scènes (annexe B) sur des intérieurs ;
   `cityCleared` ⇒ raid militaire.

### Phase F4 — Moteur & règles (E4, E6) — S/M
- **Retirer le bouton `FLEE`** ; en monde continu, le désengagement devient **physique** :
  l'ennemi « accroche » à ~12 u — s'éloigner au-delà rompt la rencontre (équivalent diégétique,
  documenté comme adaptation). Les combats de setpieces (mines/boss) sont **sans désengagement**
  (fidèle « no leave button »).
- **Écran de butin** post-victoire (prendre/laisser, sac plein ⇒ délestage) ; tirage `min..max-1`.
- Avant-postes **par expédition** : `used` devient `usedBy[pid]` reseté au retour en zone sûre.
- **Cooldown de mort 120 s** (re-sortie bloquée — toast) ; viande soigne en marchant (+8 par
  conso de marche, fidèle `useSupplies`).

### Phase F5 — Perks d'usage (E8) — S
- *furtif* (rencontres ×0,5 — l'événement du Voleur épargné l'accorde), *boxeur/artiste martial*
  (compteurs de coups), *métabolisme lent/rat du désert* (compteurs de famine/soif), *gastronome*.

**Ordre conseillé : F1 → F2 → F3.1 (mines) → F4 → F3.2-4 → F5 ; F3.5 = R3b.**
Chaque phase : data → sim (+tests, tables exactes en annexes comme oracle) → rendu → e2e.

---

## Annexe A — Tables de rencontres ADR exactes (encounters.js)

| Tier (dist.) | Ennemi | Terrain | PV | Dég | Hit | Délai (s) | Ranged | Loot (min–max @chance) |
|---|---|---|---|---|---|---|---|---|
| 1 (≤10) | bête grondante | forêt | 5 | 1 | 0,8 | 1 | — | fourrure 1–3 @1 · viande 1–3 @1 · dents 1–3 @0,8 |
| 1 | homme décharné | aride | 6 | 2 | 0,8 | 2 | — | étoffe 1–3 @0,8 · dents 1–2 @0,8 · cuir 1–2 @0,5 |
| 1 | oiseau étrange | champ | 4 | 3 | 0,8 | 2 | — | écailles 1–3 @0,8 · dents 1–2 @0,5 · viande 1–3 @0,8 |
| 1 | **créature à deux têtes** | champ | 10 | 2 | **0,5** | 3 | — | fourrure 2–4 @1 · dents 2–3 @0,8 · viande 2–3 @0,8 |
| 2 (11–20) | homme grelottant | aride | 20 | 5 | 0,5 | **1** | — | étoffe 1 @0,2 · dents 1–2 @0,8 · cuir 1 @0,2 · **médecine 1–3 @0,7** |
| 2 | mangeur d'hommes | forêt | 25 | 3 | 0,8 | **1** | — | fourrure 5–10 @1 · viande 5–10 @1 · dents 5–10 @0,8 |
| 2 | charognard | aride | 30 | 4 | 0,8 | 2 | — | étoffe 5–10 @0,8 · cuir 5–10 @0,8 · fer 1–5 @0,5 · médecine 1–2 @0,1 |
| 2 | grand lézard | champ | 20 | 5 | 0,8 | 2 | — | écailles 5–10 @0,8 · dents 5–10 @0,5 · viande 5–10 @0,8 |
| 3 (>20) | terreur sauvage | forêt | 45 | 6 | 0,8 | **1** | — | fourrure 5–10 @1 · viande 5–10 @1 · dents 5–10 @0,8 |
| 3 | soldat | aride | 50 | 8 | 0,8 | 2 | **oui** | étoffe 5–10 @0,8 · balles 1–5 @0,5 · **fusil 1 @0,2** · médecine 1–2 @0,1 |
| 3 | sniper | champ | 30 | **15** | 0,8 | 4 | **oui** | identique au soldat |

## Annexe B — Combats scriptés des setpieces (stats clés)

- **Grotte** : bête 5/1/0,8/1 (×2 emplacements) · lézard des cavernes 6/3/0,8/2 · grosse bête
  10/3/0,8/2 · lézard géant 10/4/0,8/2. Fins : nid (viande/fourrure/écailles/dents 5–10) · cache
  (étoffe/cuir/fer/viande 5–10, acier @0,5, bolas @0,3, médecine @0,15) · malle (épée d'acier @1,
  bolas @0,5, médecine @0,3).
- **Mines** : matriarche 10/4/0,8/2 (dents/écailles/étoffe 5–10) ; hommes 10/3/0,8/2 ×2 + chef
  20/5/0,8/2 (fer 1–5) ; soldats 50/8/0,8/2 ranged ×2 + vétéran 65/10/0,8/2 (**baïonnette @0,5**).
- **Ville** : voyou/charognard 30/4–5/0,8/2 · bête 25/3–4/0,8/1 · fou 10/6/**0,3**/1 · justicier
  30/6/0,8/2 (fin : **fusil @1 + balles**) ; coffres médecine/torches/balles ; tout ⇒ avant-poste.
- **Cité** : sniper 30/15 · soldat 50/8 · commando 55/3/**0,9** · vétéran 45/6 (baïonnette @0,5) ·
  rats 60/1/0,8/**0,25** · oiseaux 45/5/0,7/1 · difformes 40/8/0,6 · tentacules 60/2/0,6/0,5
  (**forcés**) ; fins : laser @0,3–0,5, grenades, **alliage jusqu'à 1–2 @0,8**, `cityCleared`.
- **Maison** : squatter 10/3/0,8/2. **Cuirassé** : cf. executioner.js (M11 — gardes mécaniques 60,
  tourelles 50/**25**, boss 100–250, l'immortel **500/12** avec spéciaux tournants).
