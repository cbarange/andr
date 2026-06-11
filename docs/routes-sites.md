# Routes sécurisées & variété des sites — analyse + roadmap

> **Analyse + plan** (juin 2026). Deux demandes : (1) **réseau de routes** camp ↔ sites nettoyés (qui
> **fusionnent** en réseau, comme l'original) ; (2) **variété & nombre** des sites d'exploration (il en
> manque). Fondé sur le **code source d'A Dark Room** (`script/world.js`, vérifié) et l'état réel du projet.
>
> **Invariants** : la logique (routes, sites) vit dans `sim/` **pure & déterministe** (graine `worldSeed` +
> `state.rng`), synchronisée P2P par le snapshot ; le rendu (routes dessinées, modèles de sites) est
> **présentation locale**. Contenu = `data/world.ts`. Modèles low-poly = portés du labo (`lab/model-lab.html`).

---

## 1. Le système de ROUTES d'A Dark Room (fidèle, à porter)

### 1.1 Déclenchement
- **Nettoyer une grotte / ville déserte / cité** → `clearDungeon()` : la case devient **avant-poste** (`'P'`)
  **puis** `drawRoad()`.
- **Mines (fer/charbon/soufre)** : `drawRoad()` est appelé MAIS la case **reste une mine** (pas d'avant-poste).
- **Maison / marais / champ de bataille / forage / épave / cache** : `markVisited` seulement — **ni route ni
  avant-poste** (ce sont des points de butin/événement, pas des relais).

### 1.2 L'algorithme `drawRoad()` — la « fusion » du réseau
**`findClosestRoad(pos)`** : **spirale vers l'extérieur** le long des contours de distance de Manhattan depuis
la case nettoyée, et renvoie **la PREMIÈRE case** rencontrée qui est une **route**, un **avant-poste** (≠ la
case de départ) ou le **village**. → la nouvelle route ne vise donc **pas** le village mais **le point
connectif le plus proche** : c'est exactement pourquoi les routes **se rejoignent** en un réseau (les sites
tardifs se branchent sur le réseau existant au plus court, au lieu de tracer chacun sa ligne vers le centre).

**Tracé** : une route **en L (Manhattan)** — un segment horizontal + un segment vertical — entre la case
nettoyée et la case connective trouvée. On ne **peint en route que le terrain nu** (jamais par-dessus un
landmark/une route/le village) ; les boucles s'arrêtent une case avant les extrémités → la route **bute**
proprement contre le réseau (effet « réseau fusionné »).

### 1.3 Avant-postes
- **Recharge d'eau complète + 5–10 viande séchée**, **une fois par voyage** (réinitialisé au retour au camp).
- **Pas de voyage rapide** (déplacement toujours pas-à-pas) ; un avant-poste utilisé se fond en route.

### 1.4 Notre adaptation (monde 3D continu, déterministe)
On garde l'algorithme, on l'applique sur **notre grille de cellules** (`worldgen`, 129×129, `cellSize` 12,
village au centre). Deux couches :

**SIM (pur, déterministe, dans `GameState`)** :
- Nouveau champ `roads: Record<"cx,cz", true>` (ensemble des cellules de route) — additif, back-fillé,
  inclus au snapshot P2P (sérialiseur intégral existant).
- À `CLEAR_CAVE` / `SECURE_MINE` / (futur) ville/cité nettoyée → `drawRoad(cx, cz)` **pur** dans le reducer :
  `findClosestRoad` (spirale Manhattan sur la grille, s'arrête à une route/avant-poste/village) puis trace le
  **L** en ajoutant les cellules à `roads`. Avant-postes = les sites `cleared` (déjà suivis via `state.sites`).
- 100 % déterministe (pas de `state.rng` nécessaire — c'est géométrique) → identique chez tous les pairs.

**RENDU (local)** — le plus simple & scalable à l'échelle du monde :
- **Teinte de sol « route »** : `render/terrain.ts paintGround` colore déjà chaque cellule par biome ; on
  ajoute un test « cette cellule est-elle dans `state.roads` ? » → teinte **terre damée** (route claire,
  usée). Aucune géométrie par route, ça suit le terrain, c'est gratuit et ça passe à l'échelle (≠ la
  DynamicTexture du camp qui ne couvre que la clairière). Re-peindre les chunks concernés quand `roads` change.
- **Le décor évite les routes** : étendre l'exclusion du scatter (pas d'arbres/herbe sur une cellule de route)
  — cohérent avec les zones dégagées des sites.
- *(Optionnel, plus tard)* bandes de bordure de route (pierres/ornières) en instances le long des cellules.

**Bénéfices gameplay (branchables plus tard)** :
- **Guidage** : les routes mènent l'œil et le pas vers les sites/le camp (cf. `bonnes-pratiques-jeu.md` §4.2).
- **« Sécurisé »** : sur une cellule de route, **réduire la chance de rencontre** (M8 combat) → voyager par
  les routes est plus sûr (fidèle à l'esprit « route sécurisée »).
- **Avant-poste** : recharge d'eau/vivres (dépend de la **survie M6/M7**) — le hook existe déjà (M9 R4).

---

## 2. Variété & nombre des sites — original vs nous vs cible

### 2.1 Table complète d'A Dark Room (grille 61×61, distance de Manhattan, village au centre)

| Type | Label ADR | `num` | rayon (cellules) | → avant-poste ? | route ? | Rôle |
|---|---|---|---|---|---|---|
| ironmine | Iron Mine | 1 | 5 | non | **oui** | débloque fer |
| coalmine | Coal Mine | 1 | 10 | non | **oui** | débloque charbon |
| sulphurmine | Sulphur Mine | 1 | 20 | non | **oui** | débloque soufre |
| cave | A Damp Cave | **5** | 3–10 | **oui** | oui | petit donjon (proche) |
| house | An Old House | **10** | 0–45 | non | non | butin mineur |
| town | An Abandoned Town | **10** | 10–20 | **oui** | oui | donjon moyen |
| city | A Ruined City | **20** | 20–45 | **oui** | oui | gros donjon (loin, dangereux), **alliage/laser** |
| borehole | A Borehole | **10** | 15–45 | non | non | **alliage extraterrestre** |
| battlefield | A Battlefield | **5** | 18–45 | non | non | armes lourdes (fusils/cellules) |
| swamp | A Murky Swamp | 1 | 15–45 | non | non | événement unique (perk) |
| ship | A Crashed Starship | 1 | 28 | non | non | épave → fin de partie |
| executioner | A Ravaged Battleship | 1 | 28 | non | spécial | arc final (Exécuteur) |
| cache | A Destroyed Village | 1 (prestige) | 10–45 | non | non | rend une partie des stocks de la run précédente |

→ **~64 landmarks** sur 61×61. La **cité (`city`, num 20) est le type le plus nombreux** et le cœur du
butin de fin (alliage). « Ville » (`town`), « cité » (`city`) et « village détruit » (`cache`) sont **3 types
distincts**.

### 2.2 Notre état actuel (vérifié, `data/world.ts`)

| Type | count | rayon (cellules) | modèle 3D ? |
|---|---|---|---|
| cave | 4 | 4–12 | ✅ `sites.ts` |
| house | 5 | 4–18 | ✅ |
| town | 2 | 10–30 | ✅ |
| ironmine/coalmine/sulphurmine | 1/1/1 | 5/10/20 | ✅ |
| swamp | 1 | (région, M9/A) | ✅ |
| ship | 1 | 56–60 | ✅ |
| executioner | 1 | 56–60 | ✅ |
| **city / borehole / battlefield / cache** | **0** | — | **city/borehole/battlefield = au LABO**, pas portés ; **cache = à modéliser** |

**Problème** : **17 sites** sur une grille **129×129** (≈ 4× l'aire d'ADR) → **~16× plus clairsemé** que
l'original. D'où le sentiment de vide. Types manquants : **city** (or c'est le plus nombreux + source d'alliage),
**borehole** (source principale d'alliage — **bloque la fin de partie M11**), **battlefield**, **cache**.

### 2.3 Cible proposée (densité 3D walkable, scalée à notre grille 64)

Notre grille (rayon 64) ≈ 2× le rayon d'ADR (30). On ne vise PAS la densité d'ADR (256 sites — trop pour un
monde où l'on VOIT chaque site) mais une **variété riche sans saturer** (~55–65 sites), tunable en données :

| Type | count cible | rayon (cellules) | notes |
|---|---|---|---|
| cave | 6 | 4–16 | proche |
| house | 14 | 5–50 | dispersées partout |
| town | 8 | 12–38 | moyen |
| **city** | **10** | 26–60 | **NOUVEAU** — loin/dangereux, alliage+laser, pose `cityCleared` (raid M10) |
| ironmine/coalmine/sulphurmine | 1/1/1 | 6/12/24 | inchangé |
| **borehole** | **8** | 18–58 | **NOUVEAU** — alliage (fin M11) |
| **battlefield** | **4** | 24–58 | **NOUVEAU** — armes lourdes |
| swamp | 1 (région) | — | inchangé (M9/A) |
| ship / executioner | 1 / 1 | 56–60 | inchangé |
| **cache** | **1** | 16–52 | **NOUVEAU** — prestige (run précédente), modèle « village détruit » |

→ ~**56 sites**, toute la variété d'ADR présente. Tout en **données** (`sites[]`) → ajustable sans toucher au
moteur. *(Rappel : changer `sites[]` décale le flux RNG de placement → nouveau monde par graine ; OK.)*

---

## 3. Modèles 3D — disponibilité

- **Portés (`render/sites.ts`)** : cave, house, town, 3 mines, swamp, ship, executioner, **outpost** (10).
- **Au labo (`lab/model-lab.html`), à PORTER** : **city** (« cité »), **borehole** (« forage »),
  **battlefield**. → travail de portage `lab → sites.ts buildSite()` + `SITE_TYPES` + `SIL_TINT`.
- **À modéliser** : **cache** (« village détruit ») — pas trouvé au labo ; option : dériver d'une variante de
  `town` en ruine (低 effort) ou nouveau modèle labo. *(Cue audio `landmark-destroyed-village` déjà présent.)*

---

## 4. Roadmap (phasée, données → sim+tests → rendu)

> S'intègre à **M9** (sites/donjons/mines) de [`roadmap-v2.md`](roadmap-v2.md), dont le cœur est fait
> (grotte+mines explorables, transform avant-poste). Ces phases en sont le **reste + une nouvelle brique
> « routes »**.

### Phase R1 — Variété & nombre des sites *(données + modèles)* — **M** — ✅ **FAIT**
> **Livré (juin 2026)** : `sites[]` rééquilibré à **~57 sites** (vs 17) avec **city / borehole / battlefield /
> cache** ajoutés (+ comptes/rayons scalés à la grille 64) ; **4 nouveaux modèles low-poly** dans
> `render/sites.ts` (cité multi-tours + lueur d'alliage, forage+derrick, champ de bataille, village détruit+coffre) ;
> `SITE_TYPES`/`SIL_TINT`/`SITE_CLEAR_RADIUS` étendus ; ressources **`alien alloy`/`energy cell`** déclarées.
> Vérifié : typecheck · 165 unit (comptes/anneaux auto) · 11 e2e (P5 ajusté). *Reste : `cache` réutilise une
> ruine de village (modèle dédié possible) ; le BUTIN (alliage…) vient en R3.*
1. **`data/world.ts`** : étendre `sites[]` avec **city / borehole / battlefield / cache** + rééquilibrer les
   `count`/rayons (table §2.3). Ajouter les ressources **`alien alloy`** + **`energy cell`** (pour leur butin).
2. **`render/sites.ts`** : porter les modèles **city / borehole / battlefield** du labo (`buildSite` +
   `SITE_TYPES` + `SIL_TINT`) ; **cache** = variante ruine de `town` (ou modèle dédié).
3. **`render/terrain.ts`** : `SITE_CLEAR_RADIUS` pour les nouveaux types (sol dégagé autour).
4. **Tests** : `worldgen.test.ts` — comptes & anneaux des nouveaux types ; déterminisme.
- ✅ Critère : on rencontre grottes/maisons/villes/cités/forages/champs de bataille/cache en explorant ; monde
  visiblement plus riche ; 60 FPS (LOD/instancing déjà là).

### Phase R2 — Réseau de ROUTES *(sim pure + rendu)* — **M/L** — ✅ **FAIT**
> **Livré (juin 2026)** : `GameState.roads` (additif, snapshot+save) ; **`sim/roads.ts` `drawRoad()` PUR**
> porté fidèlement d'ADR — `findClosestRoad` (spirale Manhattan → route/avant-poste/village le plus proche)
> + tracé en **L**, ne route que les cellules nues (jamais camp/site) → les routes **FUSIONNENT**. Appelé au
> `TAKE_LOOT`(grotte nettoyée)/`CLEAR_CAVE`/`SECURE_MINE` (mine = route mais PAS avant-poste, fidèle). Rendu :
> **teinte « terre damée » par cellule** dans `terrain.paintGround` (lit `state.roads` via `setRoads`, repeint
> au changement — passe à l'échelle du monde). 4 tests purs (tracé, déterminisme, **fusion**, idempotence).
> Vérifié : typecheck · 169 unit · 11 e2e. *Reste : éviter les props sur les cellules de route (re-scatter) ;
> bénéfices (route « sécurisée » = moins de rencontres) → R4/M8.*
1. **`sim/state.ts`** : `roads: Record<string, true>` (additif, snapshot).
2. **`sim/` (nouveau `roads.ts` + reducer)** : `drawRoad(state, cx, cz)` **pur** — `findClosestRoad` (spirale
   Manhattan → route/avant-poste/village le plus proche) + tracé en **L** (cellules ajoutées à `roads`).
   Appelé par `CLEAR_CAVE`, `SECURE_MINE`, et (avec les donjons ville/cité de R3) leur nettoyage. **Mines =
   route mais pas avant-poste** (fidèle).
3. **`render/terrain.ts`** : teinte « route » par cellule dans `paintGround` (lit `state.roads`), re-peinte
   au changement ; scatter évite les cellules de route.
4. **Tests** : `drawRoad` pur — fusion (se branche sur la route existante la plus proche, pas le village) ;
   L-shape ; idempotence ; déterminisme.
- ✅ Critère : nettoyer une grotte/mine **trace une route** jusqu'au réseau le plus proche ; les routes
  **fusionnent** ; visibles au sol depuis le camp.

### Phase R3 — Donjons ville/cité + effets *(sim+rendu)* — **L** *(prolonge M9)*
- **Intérieurs ville/cité explorables** (aujourd'hui silhouettes) ; `city` nettoyée → avant-poste + route +
  `cityCleared` (débloque le **Raid militaire** M10) + butin **alliage/laser**.
- **borehole/battlefield** : ramassage de butin (alliage / armes lourdes) — pas de donjon, juste un site à
  fouiller. **cache** : rend des stocks de prestige (M11).

### Phase R4 — Bénéfices des routes & avant-postes *(dépend de M6/M7/M8)*
- **Avant-poste** : recharge eau/vivres (survie M6/M7) — hook M9 R4 déjà posé.
- **Route « sécurisée »** : chance de rencontre réduite sur les cellules de route (combat M8).
- *(Optionnel)* guidage diégétique : la boussole/les routes orientent (cf. `bonnes-pratiques-jeu.md`).

---

## 5. Dépendances & séquencement
```
R1 (variété/modèles, données+rendu) ─┬─> R2 (réseau de routes, sim+rendu)
                                     └─> R3 (donjons ville/cité + city/borehole/... effets)
R4 (avant-poste recharge = M6/M7 ; route sécurisée = M8)  ── après les systèmes de survie/combat
```
- **R1 d'abord** (le plus rentable contre le vide ; data + portage de modèles, faible risque).
- **R2** ensuite (la mécanique de routes demandée — sim pure testable + teinte de sol).
- **R3/R4** s'appuient sur les jalons de contenu (M6/M7 survie, M8 combat, M10 raid, M11 fin).

> **Note alliage/fin de partie** : `borehole` + `city` sont les **sources d'alliage** → **R1 débloque la
> matière première de M11** (sans elles, la fin de partie reste inatteignable). À prioriser dans cette optique.
