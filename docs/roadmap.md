# A Dark Room 3D — Analyse du jeu original & Roadmap par jalons

> Document de travail. **Partie 1** : analyse du jeu *A Dark Room* (fondée sur son code
> source open-source `doublespeakgames/adarkroom`). **Partie 2** : principes de portage 3D.
> **Partie 3** : roadmap fonctionnelle par jalons, mappée sur notre architecture
> (`sim/` = cerveau pur déterministe, `render/` = corps Babylon, `net/` = P2P hôte-autoritaire).
>
> Le POC actuel est le **jalon 0** : monde 3D, personnage physique, ressource bois,
> simulation pure & déterministe, P2P prêt. Tout ce qui suit s'y greffe.

---

# Partie 1 — Analyse d'A Dark Room

## 1.1 Vue d'ensemble & ressort de game design

A Dark Room est un **incrémental narratif** qui se dévoile par couches. Sa force n'est
pas le contenu mais la **révélation progressive** : on commence avec un unique bouton
(« raviver le feu »), et chaque action débloque la suivante. Le jeu mue 4 fois :

```
   A Dark Room          A Silent Forest        A Dusty Path           An Old Ship
  (la chambre)    →     (le village)      →    (le monde)        →    (l'espace)
  feu + 1 ressource     population +          exploration +          réparation +
  + l'étranger          économie de métiers   survie + combat        fin de partie
```

Le moteur tourne sur des **timers** (le temps qui passe produit/consomme), et **tout
aléatoire est borné** (tables de probabilité). C'est un jeu de **gestion de stocks +
boucles de transformation + risque/récompense en expédition**.

## 1.2 Les 4 modules (et leur déclencheur)

| Module | Nom in-game | Débloqué par | Cœur du gameplay |
|---|---|---|---|
| `Room` | A Dark Room / A Firelit Room | départ | entretenir le feu, l'étranger arrive, construire |
| `Outside` | A Silent Forest | 1er hut construit | population, assignation de métiers, économie de tick |
| `Path`/`World` | A Dusty Path → The World | fabriquer/obtenir la **boussole** → `embark` | carte, survie (eau/nourriture), combat, sites |
| `Ship`/`Space` | An Old Ship → A Ship of Patience | nettoyer l'épave (setpiece executioner) | réparer le vaisseau (alliage), esquive d'astéroïdes, fin |

## 1.3 Le feu & l'étranger (l'accroche, module Room)

- **Feu** : 5 états (`Dead → Smoldering → Flickering → Burning → Roaring`). *Raviver* = init,
  *attiser* coûte **5 bois** (cooldown 10 s) et monte d'un cran. Le feu **refroidit d'un cran
  toutes les 5 min** (`_FIRE_COOL_DELAY`).
- **Température** de la pièce : 5 états (`Freezing…Hot`), converge vers le niveau du feu
  (ajustement toutes les 5 s).
- **L'étranger** (la *builder*) arrive quand le feu est allumé, se réchauffe, puis **réclame
  du bois** (15 s après), puis propose de **construire**. Ses « niveaux » (-1 → 4) scandent le
  début de partie.

## 1.4 Économie des ressources (graphe de dépendances)

```
bois ──┬─> (attiser le feu)
       ├─> construction (tout)
       └─> carburant des métiers (charcutier)
fourrure ─> cuir (tannerie)         ─> armures, sacs, outres
viande ───> viande séchée (fumoir)  ─> nourrit les mineurs / expéditions
dents, écailles, étoffe ─ (pièges)  ─> artisanat (lances, armures…)
fer + charbon ─> acier (aciérie)    ─> épées, armures, fusils
acier + soufre ─> balles (armurerie)
alliage extraterrestre ─> réparation du vaisseau (fin de partie)
fourrure = monnaie d'échange au poste de traite
```

## 1.5 Bâtiments & artisanat (`Craftables`, valeurs réelles)

Coûts **croissants** pour certains (n = nombre déjà construit) ; chaque bâtiment débloque
une mécanique.

| Objet | Type | Coût | Effet | Max |
|---|---|---|---|---|
| trap (piège) | bâtiment | `10 + n×10` bois | récolte fourrure/viande/… (table) | 10 |
| cart (charrette) | bâtiment | 30 bois | +bois par récolte | 1 |
| **hut (hutte)** | bâtiment | `100 + n×50` bois | **+4 places de population** | 20 |
| lodge (loge) | bâtiment | 200 bois,10 fourrure,5 viande | débloque chasseurs | 1 |
| trading post (poste de traite) | bâtiment | 400 bois,100 fourrure | débloque le commerce | 1 |
| tannery (tannerie) | bâtiment | 500 bois,50 fourrure | débloque tanneurs (cuir) | 1 |
| smokehouse (fumoir) | bâtiment | 600 bois,50 viande | débloque charcutiers (viande séchée) | 1 |
| workshop (atelier) | bâtiment | 800 bois,100 cuir,10 écailles | débloque l'artisanat avancé | 1 |
| steelworks (aciérie) | bâtiment | 1500 bois,100 fer,100 charbon | débloque sidérurgistes (acier) | 1 |
| armoury (armurerie) | bâtiment | 3000 bois,100 acier,50 soufre | débloque armuriers (balles) | 1 |
| torch, waterskin, cask, water tank | outils/upgrades | cuir/fer/acier | éclairage / **capacité d'eau** | — |
| rucksack/wagon/convoy | upgrades | cuir / bois+fer / +acier | **capacité de portage** +10/+30/+60 | 1 ch. |
| l/i/s armour | upgrades | cuir+écailles / +fer / +acier | réduction des dégâts | 1 ch. |
| bone spear, iron sword, steel sword, rifle | armes | voir §1.9 | armes d'expédition | — |

## 1.6 Population & métiers (`_INCOME`, économie de tick)

- Les villageois **arrivent automatiquement** si une hutte a de la place (toutes les
  **0,5 à 3 min**, +1). Population max = `huttes × 4` (jusqu'à ~80).
- On **assigne** les villageois libres à des métiers. Chaque métier produit/consomme
  **toutes les 10 s** (multiplié par le nombre d'ouvriers) :

| Métier | Produit / consomme (par tick de 10 s) |
|---|---|
| gatherer (bûcheron) | +1 bois |
| hunter (chasseur) | +0,5 fourrure, +0,5 viande |
| trapper (piégeur) | −1 viande, +1 appât |
| tanner (tanneur) | −5 fourrure, +1 cuir |
| charcutier | −5 viande, −5 bois, +1 viande séchée |
| iron / coal / sulphur miner | −1 viande séchée, +1 fer/charbon/soufre |
| steelworker (sidérurgiste) | −1 fer, −1 charbon, +1 acier |
| armourer (armurier) | −1 acier, −1 soufre, +1 balle |

- **Famine** : si une ressource consommée passe sous 0, des villageois meurent. Tout
  l'enjeu est d'**équilibrer les chaînes** (assez de chasseurs/charcutiers pour nourrir
  les mineurs, etc.).
- Actions manuelles : *récolter du bois* (cooldown 60 s), *relever les pièges* (90 s) →
  table `TrapDrops` (fourrure 50 % / viande 25 % / écailles / dents / étoffe / charme).

## 1.7 Expédition & survie (`Path` + `World`, constantes réelles)

- Carte = grille **61×61** (`RADIUS 30`), village au centre, génération procédurale
  (`STICKINESS 0.5`), terrains forêt/champ/landes.
- **Avant de partir** : on s'équipe (`outfit`) — eau (max `BASE_WATER 10` +outres) et
  **viande séchée**, dans la limite de la **capacité de portage** (`10` + sac).
- **Déplacement** : consomme **eau** (1 case/eau) et **nourriture** (1 viande / 2 cases).
  Brouillard de guerre (`LIGHT_RADIUS 2`).
- **Mort** si eau ou nourriture épuisée → retour au village, **perte de la cargaison**
  (cooldown 120 s).
- **Avant-postes** (`outpost`) : refont le plein d'eau + point de voyage rapide.
- **Combats aléatoires** : `FIGHT_CHANCE 0.20`, min 3 cases entre deux combats. Difficulté
  croissante avec la **distance au village** (armure de fer conseillée ≥8, acier ≥18).

## 1.8 Sites / setpieces (`events/setpieces.js`)

Chaque **point d'intérêt** de la carte ouvre une **rencontre scriptée à embranchements**
(scènes `start → a1/a2/b1… → end`, avec choix, combats, butin). Sites et leur rôle :

| Site (scene) | Apparition | Récompense / déblocage |
|---|---|---|
| `cave` (grotte), `house` (vieille maison) | proches | butin, étoffe, premières armes ; **torche requise** ; **grotte nettoyée ⇒ devient un `outpost`** |
| `town` (ville), `city` (cité) | r≥10 / r≥20 | gros butin, combats, médecine |
| `ironmine`/`coalmine`/`sulphurmine` | r=5/10/20 | **nettoyer la mine ⇒ débloque le métier mineur** |
| `borehole`, `battlefield`, `swamp` | lointains | ressources rares, énergie |
| `ship` (épave) | r=28 | **alliage extraterrestre** (fin de partie) |
| `executioner` (cuirassé) | r=28 | setpiece de fin → débloque le vaisseau |
| `outpost` | dynamique | recharge eau + voyage rapide |
| `cache` | prestige | bonus de partie précédente |

## 1.9 Combat & armes (`World.Weapons`, **temps réel à recharges**)

ADR est un combat **temps réel** : chaque arme a une **recharge** propre (colonne ci-dessous) et on
peut **en porter plusieurs**, frappant avec l'une pendant que les autres rechargent (**poings** par
défaut). PV de base **10** (`BASE_HEALTH`) **relevés par l'armure** (cuir ~15, acier ~45) ; touche à
80 %. On se soigne en **mangeant de la viande** (+8 PV, toutes les ~5 s) ou de la **médecine** (+20).

| Arme | Type | Dégâts | Recharge | Munition |
|---|---|---|---|---|
| fists (poings) | — | 1 | 2 | — |
| bone spear | mêlée | 2 | 2 | — |
| iron sword | mêlée | 4 | 2 | — |
| steel sword | mêlée | 6 | 2 | — |
| bayonet | mêlée | 8 | 2 | — |
| rifle | distance | 5 | 1 | 1 balle |
| laser rifle | distance | 8 | 1 | 1 cellule |
| grenade | distance | 15 | 5 | 1 grenade |
| bolas / disruptor | distance | étourdit | 15 | — |

**Ennemis** (`events/encounters.js`), tiérés par distance : *snarling beast* (5 PV),
*gaunt man* (6), *strange bird* (4), *two-headed creature* (10), *shivering man* (20),
*man-eater* (25), *scavenger*… chacun avec sa table de butin.

## 1.10 Événements aléatoires (gestion, choix moraux/économiques)

Pop-ups déclenchés sur timers, avec **choix → conséquences** :

- **Room** : The Nomad (troc), Noises, The Beggar, The Shady Builder, The Mysterious
  Wanderer, **The Scout** (apprend la carte / vend la boussole), The Master, The Sick Man.
- **Outside** : A Ruined Trap, **Fire** (incendie), Sickness, **Plague**, **A Beast Attack**,
  **A Military Raid** (perte de population/stocks selon défense).
- **Global** : **The Thief** (vol de stocks).
- **Échange** (poste de traite) : la **fourrure sert de monnaie** ; on achète écailles, fer,
  charbon, acier, médecine, balles, boussole, alliage, fusil laser…

## 1.11 Fin de partie (`Ship` + `Space`)

1. Nettoyer le setpiece `executioner` → accès au vaisseau.
2. **Réparer** : *renforcer la coque* (1 alliage = +PV) et *améliorer les propulseurs*
   (1 alliage = +vitesse). L'alliage vient des épaves/borehole/battlefield.
3. **Décollage** → module Espace : **esquiver des astéroïdes** en montant en altitude
   (0 → 60+). Réussite = **fin du jeu** (puis prestige : bonus pour la partie suivante).

## 1.12 Modèle temporel (les rythmes du jeu)

| Horloge | Période |
|---|---|
| Revenu des métiers | 10 s |
| Feu (refroidissement) | 5 min/cran · attiser : cooldown 10 s |
| Température | 5 s |
| Croissance de population | 0,5–3 min (+1) |
| Récolte bois / pièges (manuel) | 60 s / 90 s |
| Survie en expédition | eau : 1/case · nourriture : 1/2 cases |
| Événements aléatoires | timers randomisés |

---

# Partie 2 — Principes de portage en 3D

Trois règles directrices, cohérentes avec notre architecture actuelle :

1. **Tout système = état + reducer dans `sim/` (le cerveau).** Le feu, les stocks, les
   bâtiments, la population, les métiers, les événements, le combat et la survie sont des
   **machines à états déterministes** ajoutées au `reduce()`. Le 3D ne fait que **présenter**
   et **émettre des actions**. ⇒ chaque mécanique reste **testable au terminal** (`npm run test`)
   avant tout rendu.

2. **Déterminisme obligatoire (P2P).** *Tout* l'aléatoire d'A Dark Room (drops de pièges,
   événements, butins, génération du monde, combats) **doit passer par le RNG à graine**
   ([`sim/rng.ts`](../src/sim/rng.ts)), jamais `Math.random()`. C'est ce qui permet à
   l'hôte de faire autorité et aux pairs de rester cohérents (modèle déjà en place dans
   [`net/room.ts`](../src/net/room.ts)). La règle existante « la physique est locale, la sim
   est autoritaire » se généralise : **les positions/animations sont locales, la gestion est
   autoritaire**.

3. **Diégétique d'abord, panneaux ensuite.** A Dark Room est 100 % texte ; en 3D, on
   **spatialise** ce qui gagne à l'être (attiser un vrai feu, marcher jusqu'aux arbres,
   voir les huttes et les villageois, explorer une vraie grotte) et on garde des **panneaux
   HTML** (notre HUD) pour la gestion dense (assignation de métiers, équipement, troc).

### 2.4 Topologie : un monde unifié (DÉCISION ACTÉE ✅)

**On abandonne la séparation « écran village / écran carte » de l'original.** Tout se
passe dans **un seul monde 3D continu** :

- Le **campement est un retranchement central** (palissade/remparts) au milieu de la carte.
- Le monde s'étend tout autour ; **on part explorer simplement en franchissant la porte** —
  pas de menu « embarquer », pas de changement de scène. Transition **fluide et diégétique**.
- Les 4 « phases » d'A Dark Room deviennent des **zones concentriques** + des **paliers de
  progression**, et non des modules séparés :

```
                 ┌─────────────────────────────────────┐
                 │            TERRES LOINTAINES          │  sites rares, ennemis durs,
                 │   ┌───────────────────────────────┐   │  alliage, épave, fin de partie
                 │   │        TERRES PROCHES          │   │  forêt/champs, 1ers sites,
                 │   │   ┌───────────────────────┐    │   │  combats faciles
                 │   │   │   RETRANCHEMENT        │    │   │  ZONE SÛRE : feu, huttes,
                 │   │   │   (campement, centre)  │    │   │  métiers, construction,
                 │   │   └───────────────────────┘    │   │  recharge eau, pas de danger
                 │   └───────────────────────────────┘   │
                 └─────────────────────────────────────┘
        difficulté & rareté croissantes avec la distance au centre (comme le `RADIUS` d'ADR)
```

**Conséquences de design :**
- **Le retranchement = zone sûre** : la gestion (M1–M5) s'y déroule ; pas de drain de survie,
  recharge d'eau, ravitaillement. C'est le « hub ».
- **La survie devient une pression spatiale/temporelle** : l'eau et la nourriture se vident
  quand on est **dehors** (selon le temps/la distance parcourue), plus selon des « cases ». Les
  **avant-postes** d'ADR deviennent des **bases avancées** qu'on établit pour pousser plus loin.
- **La difficulté est portée par la distance** : forêt proche = sûr ; plus on s'éloigne du
  centre, plus les ennemis/sites sont coriaces et rares (fidèle au `minRadius`/`maxRadius` des
  landmarks d'ADR).
- **Le multijoueur co-op tombe naturellement** : les deux avatars partagent déjà le même monde
  (transforms P2P, fait en M0). Explorer à deux ne demande pas de mode dédié.

**Conséquences techniques (à anticiper) :**
- Monde **bien plus grand** que les 50×50 actuels → **terrain par chunks / streaming**, LOD,
  et le **brouillard** (déjà en place) pour borner la distance de rendu. À traiter en M7 comme
  un vrai sujet d'archi (voir sa fiche).
- Le canal `stateSync` (aujourd'hui « un total de bois ») doit évoluer vers un **snapshot/diff
  d'état** plus riche (dès M2/M3).

### 2.5 Décisions encore ouvertes

| Sujet | Statut | Options |
|---|---|---|
| **La carte / le monde** | ✅ **ACTÉ** | monde **3D continu unifié**, retranchement central, exploration libre par la porte |
| **Le combat** | ✅ **ACTÉ** (juin 2026) | **Action temps réel, FIDÈLE à ADR** (armes à recharge, multi-armes, poings par défaut ; PV via armure ; soin en mangeant de la viande), **butin validé par l'hôte** (P2P-safe). **Documenté, implémenté en M8** (n'impacte pas M1–M7). Cf. M8 + [`mines-grottes-souterrains.md`](mines-grottes-souterrains.md) §8.Q6. |
| **Multijoueur** | ✅ orientation | co-op dans le **monde partagé** (hôte-autoritaire) ; le solo reste jouable |
| **Persistance** | ✅ amorcé | **sauvegarde auto** (façon ADR) : `GameState` autoritaire sérialisé dans `localStorage` toutes les ~15 s + à la fermeture, restauré au boot ([`src/save.ts`](../src/save.ts)). Reste pour plus tard : import/export, prestige (M11) |

---

# Partie 3 — Roadmap par jalons

> ⚠️ **REMPLACÉE par [`roadmap-v2.md`](roadmap-v2.md)** (post-audit, juin 2026). La section ci-dessous
> reste pour l'**historique** (état des jalons M0–M5 + leur conception), mais la **vérité sur l'avancement**
> (✅ fait / 🟡 rendu-mais-inerte / 🔴 mort / ❌ absent), le **séquencement corrigé** et le **chantier
> d'assainissement** sont dans `roadmap-v2.md`. Les **Parties 1 et 2 de ce document restent de référence.**

Chaque jalon est **jouable et testable** en fin de course (sim testée + e2e Playwright +
capture). On ajoute **toujours dans cet ordre** : `data/` → `sim/ (+ tests)` → `render/`/`ui/`
→ `net/`. Estimations en taille relative (S/M/L), non en jours.

> **Jalon 0 — Fondation (FAIT).** Monde 3D, personnage physique, récolte de bois, sim pure
> déterministe, boucle à pas fixe, P2P hôte-autoritaire, e2e + capture. ✅

---

### 🔥 M1 — Le feu & l'étranger *(la chambre)* — **S/M** — ✅ **FAIT**
**Objectif** : recréer l'accroche émotionnelle d'ADR. Le feu de camp central devient
**vivant et entretenu** ; un premier PNJ (l'étranger) apparaît.

- **Sim** : `fire` (enum 0–4), `temperature` (converge vers le feu), refroidissement sur tick,
  `LIGHT_FIRE`/`STOKE_FIRE` (coût bois, cooldown, anti-gaspillage), `builder` (-1→3) qui apparaît
  puis progresse tant que le feu vit. Tout en échéances de tics ⇒ déterministe. Données dans
  [`data/world.ts`](../data/world.ts) (`config.fire`).
- **3D/UI** : intensité/échelle/émissif du feu pilotés par `state.fire` ; touche `E`
  **contextuelle** (près du feu → allumer/attiser, sinon → récolter) ; l'étrangère
  ([`stranger.ts`](../src/render/stranger.ts)) apparaît et marche jusqu'au feu ; HUD feu +
  température ; toasts narratifs.
- **Réseau** : **étape d'archi** — l'état autoritaire (hôte) passe de « un total de bois » à un
  **snapshot** (`tick/wood/fire/temperature/builder`). Les clients **n'avancent plus le temps**,
  ils adoptent les snapshots ; les actions joueur (gather/stoke/light) vont à l'hôte.
- **Acceptation** : ✅ feu qui décline/ravive, attisage au bois, étrangère qui arrive ;
  **9 tests de sim** (machine d'état du feu, température, étrangère, déterminisme) + chaîne
  e2e (allumer → attiser → HUD « rugissant »).

### 🏚️ M2 — Construction du village & ressources multiples — **M** — ✅ **FAIT**
**Objectif** : transformer le bois en **bâtiments 3D** qui débloquent des mécaniques.

- **Sim** : `resources` passe d'un nombre à une **map multi-ressources** ;
  `buildings: Record<string,number>` ; action `BUILD` (coût **croissant**, `maximum`, étrangère
  requise, vérif des stocks) ; table `Craftables` (10 bâtiments d'ADR) portée dans
  [`data/world.ts`](../data/world.ts) avec coûts/effets.
- **3D/UI** : [`Village`](../src/render/buildings.ts) instancie les bâtiments low-poly autour du
  feu (placement **déterministe par (type, n°)** → cohérent entre pairs) ; **menu de construction**
  HTML à révélation progressive (un bâtiment apparaît dès qu'on peut payer son coût de base).
- **Réseau** : le snapshot autoritaire transporte désormais `resources` + `buildings` (maps).
- **Acceptation** : ✅ construire piège/charrette/hutte modifie le monde 3D ; **7 tests de sim**
  (coûts croissants, maximum, gating étrangère, ressources manquantes, déterminisme) + chaîne
  e2e (révélation du menu → clic « construire » → bâtiments synchronisés).

> **Débloqué pour la suite** : `buildings.hut` (places de population) et `buildings.lodge`/
> `tannery`/… serviront de **prérequis** aux métiers de M3/M4. La map `buildings` EST l'état de
> déblocage (pas de flags séparés).

### 👥 M3 — Population & métiers *(le village)* — **L** — ✅ **FAIT**
**Objectif** : l'**économie de tick** d'ADR, cœur incrémental du jeu.

- **Sim** : `population`, `workers: Record<job,number>` ; **revenus par période** (`incomeSeconds`)
  appliqués dans `reduce` ; arrivée des villageois (intervalle tiré via le **RNG à graine** →
  reproductible) jusqu'au plafond `huttes × 4` ; **famine** (ressource négative → bornée à 0 +
  un villageois meurt). Actions `ASSIGN_WORKER`/`UNASSIGN_WORKER`. Table des métiers (`jobs`,
  ex-`_INCOME`) en [`data/world.ts`](../data/world.ts), chaque métier gardé par un bâtiment.
- **3D/UI** : villageois = avatars qui flânent près du feu ([`villagers.ts`](../src/render/villagers.ts)) ;
  **assignation par DIALOGUE** (steppers ± dans le hub de la constructrice — pas de panneau) ;
  ligne `village n/max` dans le HUD.
- **Réseau** : le snapshot autoritaire transporte `population` + `workers` ; les clients adoptent.
- **Acceptation** : ✅ assigner des bûcherons fait monter le bois automatiquement ; une chaîne
  non nourrie provoque une famine ; **8 tests d'économie** (assignation, prérequis, plafond,
  famine, revenus, déterminisme).

> **Note d'ergonomie (refonte diégétique, appliquée avant M3)** : plus aucun panneau de gestion.
> Les actions passent par la touche **E** (étiquette flottante au niveau de l'objet : « récolter »,
> « nourrir le feu », « relever le piège ») ou par des **dialogues**. La **constructrice est le hub
> du village** : une fois *complètement réchauffée*, son dialogue offre *construire* et *répartir
> les villageois*. La relève des pièges donne du butin (table `TrapDrops`, RNG à graine).

### 🪵 Refonte « récolte & cabane » — re-rythme façon A Dark Room (Temps 1 ✅ FAIT)

Le passage en 3D avait rendu la récolte trop libre/instantanée — à l'opposé de la rareté lente
d'ADR. Refonte appliquée pour **rythmer** la récolte et spatialiser la « pièce » :

- **Deux stocks** : le **sac** (par joueur, plafonné — `carryCapBase` ; alimenté par la récolte
  manuelle ; nourrit le feu / répare la cabane) et l'**entrepôt** (autoritaire/partagé — rempli par
  les ouvriers + dépôts ; consommé par la construction et les chaînes). Tout reste dans la sim
  testée. Les **ouvriers déposent directement** dans l'entrepôt → l'automatisation soulage le portage.
- **Arbres = ressource finie qui repousse** : 3 coups pour abattre (couper « prend du temps »),
  l'arbre tombe et disparaît, un autre repousse ailleurs ([`forest.ts`](../src/render/forest.ts)).
- **La cabane** ([`cabin.ts`](../src/render/cabin.ts)) : démarre **en ruine** ; 1ʳᵉ action de la
  constructrice = la **réparer**. Elle devient l'entrepôt/mairie où l'on **entre** : un **coffre**
  (dépôt en un geste) et des **étagères** par ressource avec panneau de quantité, **révélées
  progressivement** (signature d'ADR). La construction est **gated** derrière la réparation.
- Chiffres : 8 bois/coup, sac 24 (≈ 1 arbre), charrette +24, réparation 20 bois, hutte 50 (+25/niv).

**Temps 2 ✅ FAIT — le grand tableau d'organisation.** La répartition des métiers a quitté le
dialogue de la constructrice (qui ne fait plus que *réparer* puis *construire*) pour un **grand
tableau dans la cabane** ([`cabin.ts`](../src/render/cabin.ts)) : il **affiche** la population et
la répartition (DynamicTexture) et s'**agrandit** — une ligne par métier débloqué (selon les
bâtiments). On interagit avec lui (E) pour assigner/retirer (steppers ±). Trois stations distinctes
dans la cabane : **coffre** (dépôt), **tableau** (métiers), **étagères** (stocks révélés).

- *Notés pour plus tard* : sélecteur de quantité fin pour le **retrait** (outfitting, M6) ; barres
  vie/énergie/eau (survie, M7+).

### 🍖 M4 — Chaînes de transformation : équilibrage & feedback — **S** (largement déjà fait)
> **Correctif (fidélité ADR)** : il n'existe **aucune chasse active dans le village** dans A Dark
> Room. La nourriture/les peaux côté village viennent **uniquement** des **pièges** (déjà : `HARVEST_TRAP`)
> et du **métier de chasseur** (loge, déjà). Les **créatures qu'on combat et qui lâchent du
> butin** sont des **rencontres de la carte du monde** → elles relèvent de **M7 (terres sauvages)** +
> **M8 (combat)**, pas du village. (Une attaque de bêtes *sur le village* existe, mais c'est un
> **événement** → M5.)

**Fait ✅** (le village food/peaux était déjà branché en M2/M3 ; ici on a fiabilisé + poli) :
- **Logique d'income fidèle ADR** : tout-ou-rien par métier (un métier sans intrant **chôme**),
  **jamais** de stock négatif, **plus de mort par manque d'intrant** (la mort de villageois part
  vers les événements, M5). **Chiffres d'origine conservés** (+0,5 fourrure, −5→+1 cuir, période 10 s).
- **Feedback visuel** : **fumée** aux bâtiments dont le métier produit (cheminée), **proie** visible
  sur les pièges relevables ([`buildings.ts`](../src/render/buildings.ts) ; flags `producing` portés
  dans l'état/snapshot).
- **Appât** : chaque appât (entrepôt) consommé à la relève = une **prise supplémentaire** (ADR).
- Branche fer/charbon→acier→balles toujours **dormante** jusqu'aux **mines (M9)**.
- **Vérifié** : 35 tests sim (chôme sans intrant / pas de mort ; chaîne fourrure→cuir nette positive ;
  appât) + e2e (construction/relève de piège).

### 🎲 M5 — Événements (aléatoires & gestion) — **M** — ✅ **FAIT**
**Objectif** : le sel narratif/économique : Nomade, Mendiant, Éclaireur, Voleur, Incendie,
Peste, Attaque de bêtes, Raid militaire — avec **choix → conséquences**.

> **Livré** : 9 événements (bruits dehors/dedans, mendiant, marchand mystérieux bois/fourrure,
> pièges saccagés, incendie de hutte, attaque de bêtes, nomade) en **machines à états à scènes** ;
> ordonnanceur sur tic (cadence **fidèle ADR 3–6 min**, RNG à graine) ; action `RESOLVE_EVENT_CHOICE` ;
> effets déclaratifs (`applyEffect`) dont la **perte de villageois** (revient ici, cf. M4) ; snapshot P2P
> étendu ; panneau de choix réutilisant le dialogue. **49 tests sim** (+14) + e2e dédié. Éclaireur/Maître/
> Homme malade/Raid/Maladie-Peste **reportés** (carte/perks/medicine/cityCleared). Détail : `m5-plan.md`.

- **Sim** : ordonnanceur d'événements **sur tick** (timers via RNG à graine), définitions
  d'événements en données (conditions, choix, effets), action `RESOLVE_EVENT_CHOICE`.
- **3D/UI** : événement **diégétique** quand c'est naturel (un nomade entre dans le camp) +
  panneau de choix HTML. Effets visibles (un hut brûle, etc.).
- **Réseau** : **critique** — les événements doivent être pilotés par l'**hôte** (graine) pour
  que les deux joueurs vivent le même événement. Bon test de notre déterminisme.
- **Acceptation** : événements reproductibles à graine ; choix appliqués à l'état partagé ;
  tests de quelques événements clés.
- **Plan d'implémentation détaillé** (modèle de données scène-machine, scheduler calqué sur `popGrowAt`,
  périmètre déduit du code source d'ADR, découpage en commits) : [`m5-plan.md`](m5-plan.md).

### 🚪 M6 — Le rempart, la porte & le ravitaillement — **S/M**
**Objectif** : matérialiser le **retranchement** et son seuil. Sortir = franchir la porte
(pas d'écran d'embarquement). On se ravitaille avant de pousser loin.

- **Sim** : `outfit` (eau, viande séchée…), capacité de portage (`DEFAULT_BAG_SPACE` + sacs),
  eau max (`BASE_WATER` + outres), flags d'équipement (armes, armures). Notion de **zone sûre** :
  un drapeau `inSafeZone` (dans le retranchement) qui gèle la survie et permet la recharge.
- **3D/UI** : palissade/remparts low-poly autour du camp + **une porte** ; panneau de
  ravitaillement accessible au camp (capacité, eau, vivres) ; indicateur « zone sûre / dehors ».
- **Acceptation** : franchir la porte fait passer « dehors » ; revenir recharge/gèle la survie ;
  capacité de portage respectée.
- **Atelier = station d'artisanat (décision actée)** : les **objets** (torche, outre, sacs, armures,
  armes…) se **fabriquent en interagissant avec le bâtiment atelier** (E → « fabriquer »), **pas** dans
  le menu de la constructrice (qui reste bâtiments-only). Divergence assumée vs le menu unique d'ADR
  gardé par `needsWorkshop`. Cf. **[`build-craft-plan.md`](build-craft-plan.md)** (Phase 4).
- **Menu de la constructrice aligné ADR** : révélation progressive (bois ≥ 50 %, ingrédient « vu » ≥ 1),
  coût des huttes `100 + n×50`, notification « ! » + badge « nouveau ». Cf. `build-craft-plan.md` (P1–P3).

### 🌲 M7 — Les terres sauvages : monde continu & survie — **L**
**Objectif** : le cœur du parti pris 3D — **un seul monde continu** autour du camp, avec
difficulté/rareté **croissantes selon la distance** et **survie eau/nourriture** hors zone sûre.

> 📐 **Spec détaillée de la génération procédurale** (viscosité ADR à graine, anneaux de distance,
> streaming par chunks, fog of war, P2P par graine, format de données prêt à coder) :
> [`docs/generation-monde.md`](generation-monde.md).
> 🛠️ **Plan d'implémentation phasé** (le monde autour du campement, étape par étape, appuyé sur les
> modèles du labo) : [`docs/plan-monde.md`](plan-monde.md).
> ⚡ **Optimisation du rendu** (entités à rendu conditionnel, LOD par distance, chunks lointains
> minimalistes, physique près du joueur, grande view range) : [`docs/perf-rendu.md`](perf-rendu.md).

- **Sim** : état d'expédition (`water`, `food`), **consommation par temps/distance** hors du
  retranchement (et non « par case »), `OUTPOST_REFILL` (bases avancées), mort (perte de
  cargaison + cooldown, retour au camp). Placement **déterministe** (RNG à graine) des biomes et
  des sites en **anneaux de distance** (cf. `minRadius`/`maxRadius` d'ADR).
- **3D/render** : **agrandir le monde** → terrain par **chunks/streaming** + LOD, brouillard de
  rendu (déjà en place) pour borner la distance, **brouillard de découverte** (fog of war) qui se
  lève autour du joueur. Réutilise le contrôleur joueur (M0). ⚠️ **C'est le vrai sujet d'archi du
  projet** (perf d'un grand monde) — prévoir un sous-lot technique « streaming de terrain ».
- **Réseau** : co-op **naturel** (les deux avatars partagent le monde, M0) ; eau/nourriture
  **par joueur** ; danger géré localement, butin/état du monde **autoritaires** (hôte).
- **Acceptation** : on s'éloigne du camp, l'eau baisse ; revenir au camp / à une base avancée
  recharge ; courir à sec = mort & retour au camp ; monde reproductible à graine (test) ; 60 FPS
  tenus malgré l'agrandissement (streaming/LOD).

### ⚔️ M8 — Combat 3D & créatures — **L**
**Objectif** : les rencontres. Armes (table portée en données), ennemis, butin, soin.
**C'est ICI que vivent les créatures d'ADR** (et NON dans le village) : rencontres aléatoires de
la carte du monde, qui **attaquent** et **lâchent du butin**, tiérées par la distance (`encounters.js`) :

| Tier | Créatures (PV / dégâts) | Butin typique |
|---|---|---|
| 1 (proche) | bête grondante (5/1), homme décharné (6/2), oiseau étrange (4/3), créature à 2 têtes (10/2) | fourrure, viande, dents, écailles, étoffe, cuir |
| 2 (moyen) | homme grelottant (20/5), mangeur d'hommes (25), charognard (30), lézard (20) | + médecine, cuir, étoffe |
| 3 (loin) | terreur sauvage (45), soldat (50/8), sniper | + fer, **fusil, balles** |

**Fidélité ADR (décision actée — juin 2026).** Le combat suit **fidèlement l'ADR original** :
**temps réel**, **armes à recharge** (on **porte plusieurs armes** — épée d'acier, bolas, fusil… — et
on **frappe avec l'une pendant que les autres rechargent** ; **poings** si pas d'arme) ; **les PV sont
fixés par l'armure** (sans armure ~10 PV ; cuir ~15 ; acier ~45) ; **on se soigne en MANGEANT** de la
viande (~**+8 PV** toutes les ~5 s, davantage avec un perk type Gastronome) ; chaque ennemi a **PV /
dégâts / butin** propres. **Reste host-autoritaire** : la résolution temps réel tourne chez l'hôte
(butin reproductible / validé), les clients adoptent le résultat — c'est l'option « action temps réel,
butin validé par l'hôte » du §2.5, désormais **tranchée**. **Documenté ici ; implémentation au présent
jalon M8** (pas avant).

- **Sim** : résolution de combat **temps réel host-autoritaire** (RNG à graine pour le butin) :
  `ATTACK` (par arme, avec **cooldown** propre), `EAT_MEAT`/`USE_MEDS` (soin), PV joueur **dérivés de
  l'armure**, dégâts/recharge d'arme, tables d'ennemis (`encounters`). Butin appliqué à l'état (autoritaire).
- **Créatures de cavernes (lien M9)** : les grottes/mines de M9 exposent les **emplacements** de
  rencontre ; la **résolution** est ce jalon. Ennemis de cave **fidèles ADR** : **Lézard des cavernes**
  (6 PV / 3 dég → écailles, dents), **Bête grognante** (5 PV / 1 dég → fourrure, viande, dents).
- **3D/UI** : présentation 3D du combat (ennemi low-poly, barres de PV, **jauges de recharge par arme**) ;
  déclenchement aléatoire en expédition (`FIGHT_CHANCE`) et dans les sites souterrains.
- **Acceptation** : combat jouable temps réel, **multi-armes à cooldown**, butin reproductible à
  graine, soin par la viande fonctionnel, PV pilotés par l'armure ; tests de résolution de combat.
- 🔊 **Audio (A7)** : brancher `encounter-tier-1..3` (musique de combat) + `weapon-*`/`death`/`eat-meat`/
  `use-meds` (SFX). Assets déjà dans `public/audio/` ; clés à ajouter à `data/audio.ts`. Cf. [`plan-audio.md`](plan-audio.md) §3.12.

### 🏛️ M9 — Mines & grottes souterraines explorables (donjons physiques) — **L**
**Objectif** : grottes, **mines** (sécuriser un filon ⇒ débloque le métier), maisons/villes/épaves —
**explorables EN 3D PHYSIQUE, sans transition** (on marche dans la bouche, on est dedans). Conception
détaillée + décisions actées : **[`mines-grottes-souterrains.md`](mines-grottes-souterrains.md)** ;
**plan d'implémentation étape par étape** : **[`mines-grottes-implementation.md`](mines-grottes-implementation.md)**.

**Décisions actées (juin 2026, au plus près d'ADR)** :
- **Souterrain = volume mesh « cousu » au terrain**, **Option A** (massif creux **au niveau du sol** —
  on ne peut pas trouer le heightmap). Embranchements **PHYSIQUES** (on marche les tunnels), **pas
  d'« embranchements HTML »** : le « continuer » d'ADR devient **avancer dans le tunnel**, le choix
  de chemin devient **choisir un tunnel**. Donjon **déterministe** dérivé de la graine.
- **Torche fidèle ADR** : recette **1 bois + 1 étoffe**, **requise pour entrer** dans le noir
  (pas d'entrée sans), **consommable** (il en faut plusieurs) ; **affichée sur le modèle 3D du joueur**
  quand il en porte une (attachée main/dos), portant la lumière une fois allumée.
- **Butin = objets 3D ramassables** ajoutés au **sac du joueur** ; **commun à toute la carte**
  (**premier arrivé, premier servi** : si un joueur prend un objet, l'autre ne peut plus ; l'objet
  disparaît du monde chez tous). Cohérence garantie par l'**hôte** (snapshot autoritaire).
- **Mine : sécuriser UN filon SUFFIT** ⇒ débloque le métier de mineur au village.
- **Grotte à usage UNIQUE** : une grotte **entièrement nettoyée se convertit en AVANT-POSTE**
  (`outpost` : recharge eau + voyage rapide), fidèle à ADR.
- **Combat sous terre** : **renvoyé à M8** (fidèle ADR, voir ci-dessus) — M9 expose les emplacements,
  M8 résout. Pas de combat implémenté en M9.

- **Sim** : champs `sites{ discovered, taken, secured, cleared }` (snapshot autoritaire) ; actions
  **pures** `DISCOVER_SITE` / `TAKE_LOOT` (butin global premier-servi, clamp sac) / `CLEAR_HAZARD` /
  `SECURE_MINE` (⇒ métier) / `CLEAR_CAVE` (⇒ avant-poste) ; disposition + tables de butin = **dérivées
  de la graine** (identiques chez tous, rien à stocker).
- **3D/UI** : palier **LOD `interior`** (mesh lourd + **colliders** sols/parois/plafond, bâti à
  proximité, libéré au loin — comme la physique terrain localisée) ; obscurité par **occlusion +
  torche** ; verbes de focus **fouiller/miner/forcer/ramasser** (réutilise `computeFocus`).
- **Acceptation** : on entre/sort d'une grotte sans transition ; on **ramasse un objet 3D** (qui
  disparaît chez l'autre pair) ; **sécuriser une mine de fer débloque les mineurs** ; une grotte
  nettoyée **devient un avant-poste** ; tests sim (butin borné, premier-servi = no-op au 2ᵉ, mine⇒métier,
  grotte⇒avant-poste, déterminisme).
- 🔊 **Audio (A7)** : brancher `landmark-*` (13 ambiances de lieu) à l'entrée d'un site, restauré à la
  sortie. Assets déjà là ; clés à ajouter à `data/audio.ts`. Cf. [`plan-audio.md`](plan-audio.md) §3.12.

### 🛒 M10 — Échange & poste de traite — **S/M**
**Objectif** : économie ouverte. La fourrure comme monnaie, `TradeGoods`.

- **Sim** : actions `BUY`/`SELL`, table `TradeGoods` en données, prérequis (poste de traite).
- **3D/UI** : marchand nomade au poste de traite ; panneau de troc.
- **Acceptation** : acheter une boussole/des écailles contre fourrure ; tests des coûts.
- 🔊 **Audio (A7)** : brancher `buy` (SFX d'achat) sur `BUY`. Asset déjà là ; clé à ajouter à `data/audio.ts`.

### 🚀 M11 — Fin de partie : vaisseau & espace — **M/L**
**Objectif** : l'arc final. Épave → alliage → réparation → décollage → esquive → fin.

- **Sim** : `ship` (coque/propulseurs), `REINFORCE_HULL`/`UPGRADE_ENGINE` (coût alliage),
  mini-jeu spatial (peut rester **arcade local**, score validé par l'hôte). Sauvegarde explicite
  + ébauche de **prestige**.
- **3D/UI** : site de l'épave ; séquence de réparation ; **mini-jeu d'ascension 3D** (astéroïdes) ;
  écran de fin.
- **Acceptation** : boucle complète atteignable de bout en bout ; fin déclenchée ; persistance
  de la partie.
- 🔊 **Audio (A7)** : brancher `ship`/`space`/`ending` (musique) + `reinforce-hull`/`upgrade-engine`/
  `lift-off`/`asteroid-hit-1..8`/`crash` (SFX). Assets déjà là ; clés à ajouter à `data/audio.ts`.
  Cf. [`plan-audio.md`](plan-audio.md) §3.12.

### ✨ M12 (transverse) — Équilibrage, audio, polish, perf
Réglage des courbes (coûts/income), sons (interdits dans le POC, bienvenus ensuite), écran-titre,
ombres/LOD, *deep imports* Babylon pour alléger le bundle, TURN pour P2P robuste.

> 🔊 **Audio** : plan complet + analyse du moteur d'A Dark Room dans **[`docs/plan-audio.md`](plan-audio.md)**
> (audio = **présentation**, jamais dans `sim/` ; piloté par le **diff d'état** ; Babylon `AudioV2`).
> **A1–A6 ✅ FAITS** — 86 `.flac` originaux dans `public/audio/`. A1 socle (bus, volumes, mute, **cases
> « Effets actifs »**, persistance) · A2 musique de l'état du feu · A3 SFX d'action (gather/build/dépôt/relève
> + footsteps) · **A4 feu spatialisé** (listener=caméra, le feu s'atténue au loin) · **A5 musique d'événement**
> (overlay + ducking) · **A6 musique de village/exploration** (`pickMusic` : feu/village-par-population/`world`
> dehors). +1 test e2e dédié (11 e2e verts). **Reste** : A7 (combat M8 / sites M9 / fin M11), assets déjà là ;
> *optionnel* transcodage `.flac→.ogg`.

---

## Dépendances entre jalons

```
M1 ─> M2 ─> M3 ─┬─> M4 ─> M5
                └─> M6 ─> M7 ─> M8 ─> M9 ─> M11
                              M10 (après M6/poste de traite)
```

## Ce que notre architecture nous offre déjà (et qu'il faut préserver)

- **`sim/` pur & déterministe** : prêt à accueillir feu/stocks/population/événements/combat
  comme reducers testables. Ne JAMAIS y importer Babylon/DOM.
- **Boucle à pas fixe (20 Hz)** : les timers d'ADR (income 10 s, feu 5 min…) deviennent des
  **compteurs de tics** — déterministes par construction.
- **RNG à graine** : déjà là ; c'est la clé du portage P2P de tout l'aléatoire d'ADR.
- **P2P hôte-autoritaire** : le canal `stateSync` doit passer d'« un total de bois » à un
  **diff/snapshot d'état** plus riche (à prévoir dès M2/M3).
- **Données = source de vérité** : tout le contenu d'ADR (bâtiments, métiers, ennemis, événements,
  setpieces) se porte en `data/`, éditable sans toucher au moteur.
