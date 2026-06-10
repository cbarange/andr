# Cabane principale — phases jeu

> **✅ IMPLÉMENTÉ (2026-06-10).** Les 3 phases ci-dessous sont désormais codées et testées
> (97 tests verts, typecheck + build OK). Ce qui suit reste la spécification de référence ;
> l'implémentation réelle peut différer à la marge. Résumé de ce qui a été livré :
> - **Phase 2 (rendu)** : `src/render/cabin.ts` réécrit — `setTier(0|1|5|10)` porte les 4 modèles
>   du labo (coques + toits + décor), aménagements partagés (coffres/tableau/dépôt/outils) en
>   `DynamicTexture`, colliders sur les murs pleins (entrées ouvertes). Emprise au sol inchangée
>   entre paliers (le toit MONTE, on n'élargit pas).
> - **Phase 3 (stockage)** : `data/world.ts` → `RESOURCE_RARITY`, `STORAGE_CAP_BASE`,
>   `storageCap(tier,id)`, `cabinUpgradeCost`, `nextCabinTier`. `state.cabinTier` (0/1/5/10).
>   Reducer : clamp centralisé (dépôt, revenus, effets d'événements/différés), `REPAIR_CABIN`→×1,
>   nouvelle action `UPGRADE_CABIN` (coût puisé dans l'entrepôt). Option « agrandir l'entrepôt »
>   dans le menu de construction.
> - **Phase 4 (constructrice)** : `config.fire.builder.tend*`. Reducer `TICK` : entretien du feu
>   (filet de sécurité — seuil bas, long cooldown, bois pris dans l'entrepôt) via `builderTendReadyAt`
>   /`builderTendingUntil`. Rendu : `stranger.ts` se repose dans son coin (`cabin.builderHome`) et
>   fait l'aller-retour au feu pendant la fenêtre d'entretien.
> - **Save** : `VERSION` bumpée à 2. **Hooks debug** : `setCabinTier`, `upgradeCabin`, `getCabinTier`,
>   `fillStorage`. **Coûts d'amélioration** (tunables, `cabinUpgradeCost`) : ×5 = 300 bois + 40 cuir ;
>   ×10 = 1000 bois + 80 fer + 120 cuir. **Surplus au plafond** : perdu (clamp sec).
>
> ---
>
> ## (spécification d'origine — sans implémentation)

> Document de conception. Les **modèles 3D** des 4 états existent déjà au labo
> (`lab/model-lab.html` → `buildCabin(K, ctx, root, tier)`, entrées `cabane-ruine` /
> `cabane` / `cabane-v5` / `cabane-v10`). Ici on décrit **comment les brancher au jeu** et le
> **gameplay** associé (plafonds de stock, IA de la constructrice qui entretient le feu).
> Aucune ligne de code n'est écrite : c'est le plan de travail des phases 2 → 4.
>
> Voir aussi : [`modeles-3d.md`](modeles-3d.md), [`architecture.md`](architecture.md),
> [`plan-campement.md`](plan-campement.md).

---

## 0. Rappel de l'intention (demande utilisateur)

La cabane a **4 états** :

1. **Ruine** (départ).
2. **Réparée (×1)** — par la constructrice. Stocke **par ressource** (plafond, pas un total) :
   **1000** par ressource *standard*, **200** par ressource *rare*.
3. **Améliorée (×5)** — **5000** standard / **1000** rare.
4. **Entrepôt (×10)** — **10000** standard / **2000** rare.

Autres exigences :
- Bâtisse **petite à la base**, qui grandit avec les paliers.
- **Pratique à traverser** (plusieurs entrées, toit partiel) — déjà porté par le modèle.
- Devient le **lieu de la constructrice** : elle y vit, et **va réalimenter le feu** quand il
  faiblit (effet **réel** sur le feu). Le feu est donc maintenu par **le joueur ET la constructrice**.
- Stockage lisible : **piles rustiques** + **réserve en pierre** pour les rares, **tableau**
  d'organisation des métiers, **coffre de dépôt**, **coin de la constructrice**.

### Rangs de rareté (validés)

| Rang | Ressources (`id`) | Plafond ×1 / ×5 / ×10 |
|---|---|---|
| **standard** | `wood`, `fur`, `meat`, `cured meat`, `bait` | 1000 / 5000 / 10000 |
| **rare** | `leather`, `coal`, `iron`, `scales`, `teeth`, `cloth`, `sulphur`, `steel`, `bullets`, `charm` | 200 / 1000 / 2000 |

(« très rare » a été fusionné dans « rare ».)

---

## 1. État actuel du code (points d'ancrage)

| Sujet | Où | Détail |
|---|---|---|
| Modèle cabane | [`src/render/cabin.ts`](../src/render/cabin.ts) | classe `Cabin` : **2 états** `ruin`/`built` (`setRepaired`), coffre, tableau (`setOrganisation`), étagères (`setStorage` → `createShelf`). |
| **Bug étagères** | `cabin.ts` `createShelf` | les coffres s'alignent au sol `z = -HALF+1 + i*0.8` → 15 ressources atteignent `z≈9`, **hors** de la cabane (mur à `z=3`). |
| État cabane (sim) | [`src/sim/state.ts`](../src/sim/state.ts) | booléen `cabinRepaired`. **Pas** de notion de palier. |
| Stock | `state.resources: Record<string, number>` | **non plafonné** : `DEPOSIT` et la production font `resources[k] += …` (cf. `reducer.ts`). |
| Feu | `state.fire` (0 mort … 4 rugissant), `fireCoolAt`, `stokeReadyAt` | décroît d'un cran tous les `config.fire.coolSeconds` (action `TICK`). `STOKE` = +1 cran, coûte `config.fire.stokeCost` bois, cooldown `stokeCooldownSeconds`. |
| Constructrice | `state.builder` (-1 absente … `config.fire.builder.maxLevel`=3) | **compteur abstrait** : apparaît à `appearFireLevel`, progresse tant que le feu vit, et à `maxLevel` permet `REPAIR_CABIN`. Pas (encore) un agent physique. |
| Câblage rendu | [`src/main.ts`](../src/main.ts) | `cabin.setRepaired(state.cabinRepaired)`, `cabin.setStorage(state.resources)`, `cabin.setOrganisation(...)`. Hooks debug `window.__game` (`repairCabin`, `lightFire`, `stoke`, …). |
| Constructrice rendu | [`src/render/stranger.ts`](../src/render/stranger.ts) | modèle low-poly sur un nœud d'ancrage (logique de marche/position déjà présente). |

**Invariants à respecter** (cf. `architecture.md`) :
- La **SIM est pure et déterministe** (RNG à graine) → tout effet de gameplay doit transiter par
  le **reducer** pour rester **cohérent en P2P**. Le **rendu** ne fait que lire l'état.
- Les **mouvements/animations** sont **cosmétiques** (locaux) ; seuls comptent pour la sim les
  **effets** (feu +1, −bois). Donc : l'IA de la constructrice **décide dans la sim**, et le
  **rendu rejoue** le déplacement.

---

## 2. Phase 2 — Porter le modèle (4 états) dans `cabin.ts`

Objectif : remplacer le modèle actuel par celui du labo et **régler le débordement** des coffres.

### 2.1 Pré-requis kit
- Le modèle labo utilise des helpers (`cabLogWall`, `cabPile`, `cabStrongroom`, `cabHang`,
  `cabBoard`, `cabChest`, `cabCorner`, `cabinRuin`) bâtis sur le kit. Pour le jeu : porter ces
  helpers en TS dans `cabin.ts` (ou un module `cabin-model.ts`) via le kit partagé
  (`render/lowpoly.ts`) — comme pour les bâtiments (`buildings.ts`).
- Toiture : `cabLogWall` n'utilise que des primitives du kit ; pas besoin de `gableRoof`/`hipRoof`
  (le toit de la cabane est un **appentis** = simple boîte inclinée). ✅ rien à ajouter au kit.

### 2.2 4 états au lieu de 2
- Remplacer `ruin`/`built` par **un état paramétré** `tier ∈ {0,1,5,10}`.
- Nouvelle API rendu : `cabin.setTier(tier)` (rebâtit / bascule le bon nœud). Conserver
  `setStorage` et `setOrganisation` (le tableau et les quantités restent pilotés par la sim).
- Garder la **collision** : aujourd'hui les murs `built` portent un `PhysicsAggregate`. Le nouveau
  modèle est ouvert (poteaux + murets) → poser des **colliders** sur les murets/poteaux pleins
  seulement, en **laissant libres les ouvertures** (entrées multiples). À calibrer pour que le
  joueur **circule** sans rester coincé.

### 2.3 Régler le rangement (le bug)
- `createShelf(i)` aligne au sol → **abandonner**. Le modèle range désormais en **piles**
  rustiques le long du pourtour + réserve en pierre. Deux options pour la **révélation
  progressive** (chaque ressource découverte devient visible, signature ADR) :
  - **(a) Conteneurs fixes + panneaux dynamiques** : N emplacements **pré-placés** dans le modèle
    (piles standard + casiers de la réserve rare), chacun avec un `DynamicTexture` d'étiquette
    (label + quantité). `setStorage` n'**affiche** que les emplacements dont la ressource est > 0.
    → simple, pas de débordement, lisible.
  - **(b) Remplissage visuel proportionnel** : la **hauteur/le nombre** d'éléments d'une pile suit
    la quantité (jolie, mais plus coûteux à animer). À réserver à plus tard.
- **Recommandation** : (a). Mapper les **15 ressources** sur des emplacements **2D fixes**
  (standard → piles ; rare → coffres de la réserve en pierre), jamais une ligne 1D.

### 2.4 Position / ancre
- Inchangé : `campLayout.cabin` (nord-ouest du feu) ; façade +Z vers le feu. Le modèle est
  centré sur l'ancre ; vérifier que l'**empreinte agrandie** (×5/×10) ne chevauche pas la
  clairière du feu ni les bâtiments voisins (re-spacer l'ancre si besoin, cf. la démarche des
  autres bâtiments).

---

## 3. Phase 3 — Stockage : raretés + plafonds + paliers

### 3.1 Données (`data/world.ts`)
- **Rareté par ressource** : `RESOURCE_RARITY: Record<string,'standard'|'rare'>` (table §0).
- **Plafonds de base** : `STORAGE_CAP_BASE = { standard: 1000, rare: 200 }`.
- **Multiplicateurs de palier** : `CABIN_TIERS = [{ tier:1, mult:1 }, { tier:5, mult:5 }, { tier:10, mult:10 }]`.
- Helper pur : `storageCap(state, resourceId)` = `STORAGE_CAP_BASE[rarity] * tierMult(state.cabinTier)`.

### 3.2 État (sim)
- Ajouter `cabinTier: 0 | 1 | 5 | 10` (0 = ruine). `cabinRepaired` devient dérivé (`cabinTier >= 1`)
  ou conservé pour compat + migration (cf. §6).
- `REPAIR_CABIN` (existant) → passe `cabinTier` de 0 à **1**.
- Nouvelle action `UPGRADE_CABIN` → 1 → 5 → 10 (cf. §3.4).

### 3.3 Application des plafonds (reducer — **le point critique**)
Tout ajout à `state.resources` doit être **borné** par `storageCap`. Concerné :
- `DEPOSIT` (dépôt du sac) — `reducer.ts`.
- Revenus/production des métiers (income).
- Effets d'événements (`EventEffect.stores`, `convert`) — `m5-plan.md`.
- Effets différés (`pendingEffects`).

→ Centraliser via un helper **pur** `addStock(resources, id, delta, state)` qui **clamp à
`storageCap`**. Décisions de design (à trancher) :
- **Surplus perdu** (clamp sec) ou **refus du dépôt** quand plein ? (ADR : clamp sec, le surplus
  est perdu — le plus simple et lisible.)
- **Feedback** : signaler « entrepôt plein » dans l'UI / le panneau de la ressource (étiquette qui
  vire au rouge).

⚠️ **Déterminisme** : le clamp est une fonction pure de l'état → P2P-safe par construction.

### 3.4 Amélioration de la cabane
- **Déclencheur** : un `craftable` (ou une option du dialogue de la constructrice) « Agrandir
  l'entrepôt ». Coût croissant (bois + une ressource rare ?) — **à définir** (open question).
- **Conditions** : constructrice présente (`builder >= maxLevel`), palier précédent atteint.
- **Action** `UPGRADE_CABIN` (reducer, pure) : débite le coût, `cabinTier = next`.
- **Rendu** : `cabin.setTier(state.cabinTier)`.

---

## 4. Phase 4 — IA de la constructrice (présence + entretien du feu)

But : la constructrice **vit dans la cabane** (son coin) et **va réalimenter le feu** quand il
faiblit, avec un **effet réel** — le feu est co-entretenu par le joueur et par elle.

### 4.1 Séparer EFFET (sim) et DÉPLACEMENT (rendu)
- **Sim (déterministe)** — dans `TICK` du reducer, après la décroissance du feu :
  - Condition d'intervention : `cabinRepaired` **et** `fire <= config.fire.builder.tendThreshold`
    **et** `tick >= builderTendReadyAt` **et** bois disponible dans l'entrepôt
    (`resources.wood >= config.fire.builder.tendWoodCost`).
  - Effet : `fire = min(fire+1, Roaring)` ; `resources.wood -= tendWoodCost` ; `fireCoolAt`
    repoussé ; `builderTendReadyAt = tick + tendCooldown`.
  - Nouveaux champs d'état : `builderTendReadyAt` (tic), éventuellement `builderTendingUntil`
    (tic, fenêtre pendant laquelle elle est « en déplacement » pour l'animation).
  - **Important** : c'est **son** geste, distinct du `STOKE` joueur (qui reste manuel). Les deux
    sources s'additionnent → le feu tient mieux quand elle est là.
- **Rendu (cosmétique, local)** — `stranger.ts` :
  - Position de repos = **son coin dans la cabane** (dérivé de `cabin` + tier).
  - Quand la sim déclenche/annonce un entretien (`builderTendingUntil` ou détection du bump de
    feu attribué à `builder`), jouer un **aller-retour cabane ↔ feu** (marche, petite pause au
    feu). Purement visuel : aucun pair ne dépend de la trajectoire.

### 4.2 Réglages (`config.fire.builder`, dans `data/world.ts`)
| Clé | Rôle | Piste |
|---|---|---|
| `tendThreshold` | niveau de feu sous lequel elle intervient | ex. ≤ 1 (vacillant) |
| `tendWoodCost` | bois consommé par geste (depuis l'entrepôt) | ex. = `config.fire.stokeCost` |
| `tendCooldown` | délai entre 2 interventions | ex. > `coolSeconds` pour ne pas rendre le feu auto-éternel |
| `tendFireGain` | crans gagnés | 1 (comme `STOKE`) |

**Équilibrage à surveiller** : avec une constructrice qui ré-attise, le feu peut devenir
quasi-autonome tant qu'il reste du bois. Choisir `tendThreshold` bas + `tendCooldown` long pour
qu'elle soit un **filet de sécurité**, pas un substitut au joueur. (Et elle puise dans
**l'entrepôt** → ça crée une vraie pression sur la réserve de bois.)

### 4.3 Disponibilité
- Tant que la cabane est **en ruine**, pas d'entretien (elle n'a pas encore « emménagé »).
- Si elle est occupée à construire/améliorer, on peut suspendre l'entretien (option).

---

## 5. Cohérence P2P, sauvegarde, tests

- **P2P / déterminisme** : tous les nouveaux effets (clamp de stock, `UPGRADE_CABIN`, entretien
  du feu) passent par le **reducer pur** → identiques chez tous les pairs. Les seuls éléments
  **locaux** sont les **animations** (déplacement de la constructrice, remplissage visuel des
  piles).
- **Sauvegarde / migration** ([`src/save.ts`](../src/save.ts)) : nouveaux champs `cabinTier`,
  `builderTendReadyAt`. Migration d'une save existante : `cabinTier = cabinRepaired ? 1 : 0`.
- **Tests** ([`src/sim/sim.test.ts`](../src/sim/sim.test.ts)) :
  - le stock ne dépasse jamais `storageCap` (dépôt, production, événements, effets différés) ;
  - `UPGRADE_CABIN` débite le coût et relève le palier (et le plafond suit) ;
  - l'entretien du feu respecte seuil + cooldown + coût, et ne s'active pas en ruine ;
  - déterminisme : même graine + mêmes actions ⇒ même état (inclut le nouveau comportement).
- **Hooks debug** (`window.__game`, [`src/dev`](../src/dev)) : ajouter `upgradeCabin()`,
  `setCabinTier(t)`, `fillStorage()` (pour tester les plafonds/étiquettes) ; `getCabin()` exposant
  `tier` + caps.

---

## 6. Ordre de travail conseillé & dépendances

1. **Phase 2** (visuel) : port du modèle 4 états + `setTier` + correction du rangement
   (mapping 2D). *Indépendant du gameplay* → livrable visible rapidement.
2. **Phase 3** (stockage) : `cabinTier` + raretés + `storageCap` + clamp centralisé +
   `UPGRADE_CABIN`. *Dépend de Phase 2 pour le rendu des paliers.*
3. **Phase 4** (constructrice) : effet d'entretien (sim) + animation (rendu). *Dépend du coin
   de la constructrice (Phase 2) et de l'entrepôt en bois (Phase 3 pour le coût).*

---

## 7. Questions ouvertes (à trancher avant implémentation)

1. **Coût des améliorations** ×1→×5→×10 (quelles ressources, quelle courbe) ?
2. **Surplus au plafond** : perdu (clamp sec, recommandé) ou dépôt refusé ?
3. **Cadence d'entretien** de la constructrice (`tendThreshold` / `tendCooldown` / coût) — pour
   qu'elle reste un filet de sécurité, pas un pilote automatique du feu.
4. **Un seul plafond par rang** ou ajustement fin par ressource plus tard ?
5. **Déblocage des paliers** : librement via craftable, ou conditionné (population, métiers,
   événement) ?
