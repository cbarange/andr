# Mines & grottes souterraines — proposition d'implémentation (M9, **sans implémentation**)

> Document de conception. On NE code rien ici : on **analyse le jeu original**, on confronte aux
> contraintes réelles du moteur (heightmap, streaming, sim pure/P2P, « pas de transition »), et on
> propose une **solution open-world seamless** pour entrer/explorer les grottes et les mines.
>
> **Décisions ACTÉES (juin 2026)** — toutes les questions ouvertes du §8 ont été tranchées par
> l'utilisateur, **au plus près d'A Dark Room**. Résumé : entrée par **massif au niveau du sol
> (Option A)** ; grottes à **usage unique** (une grotte nettoyée **devient un avant-poste**, comme
> dans ADR) ; **torche fidèle ADR** (1 bois + 1 étoffe, **consommable**, **requise pour entrer/explorer
> le noir**, **affichée sur le modèle 3D du joueur** quand il en porte une) ; **sécuriser un filon
> suffit** à débloquer le métier ; **butin = objets 3D ramassables** ajoutés au **sac du joueur**, et
> le butin est **commun à toute la carte** (premier arrivé, premier servi : si un joueur ramasse un
> objet, l'autre ne peut plus) ; **combat fidèle à ADR** mais **traité en M8** (documenté, pas
> implémenté ici). Détail en **§8**.
>
> **Plan d'exécution étape par étape** : [`mines-grottes-implementation.md`](mines-grottes-implementation.md)
> (ce doc = le « quoi/pourquoi » ; le plan = le « comment », ancré dans le code réel).
>
> Voir aussi : [`roadmap.md`](roadmap.md) (jalons **M9 — sites & setpieces** et **M8 — combat**),
> [`generation-monde.md`](generation-monde.md), [`plan-monde.md`](plan-monde.md) (Phase 5 sites = faite),
> [`perf-rendu.md`](perf-rendu.md), [`architecture.md`](architecture.md).

---

## 0. Intention (demande utilisateur)

- Le joueur doit pouvoir **entrer** dans les mines et les grottes → entrées **assez larges**.
- À l'intérieur : un **souterrain à explorer** avec des **recoins** qui matérialisent, en 3D physique,
  ce qu'était le **bouton « continuer »** d'*A Dark Room* (avancer plus loin dans le lieu).
- **Open-world complet, connecté au monde existant, SANS transition** (pas d'écran de chargement,
  pas de bascule de scène) : on marche dans l'entrée et on est dedans.
- Le tout **adapté** au moteur 3D open-world du jeu.

---

## 1. Analyse du jeu original (A Dark Room)

Dans ADR, l'extérieur (« the dusty path ») est une carte qu'on explore. Chaque **lieu** (grotte,
mine, maison, ville, épave…) est un **setpiece** : en y entrant, on enchaîne des **scènes/pièces**
reliées par un bouton **« continuer »**, avec parfois des **embranchements** (choix gauche/droite)
qui mènent à des récompenses/risques différents.

Points saillants à transposer :

| ADR | Détail | Transposition 3D voulue |
|---|---|---|
| **« continuer »** | avance d'une pièce à la suivante | **marcher plus loin** dans le tunnel |
| **embranchements** | choix de chemin (loot/risque ≠) | **choisir un tunnel** (gauche/droite) physiquement |
| **recoins / pièces** | nœuds de butin / d'événement | **chambres & culs-de-sac** avec contenu |
| **torche** | **1 bois + 1 étoffe** ; on **ne peut pas entrer** dans une grotte sombre sans elle ; il en faut **plusieurs** pour explorer ; consommable | **objet d'inventaire** ; **requise pour franchir la bouche** (sans torche : on ne s'enfonce pas) ; **affichée sur le modèle 3D** du joueur ; **lumière portée** ; le noir = tension |
| **grotte** | exploration → butin, ennemis, événements ; **une fois nettoyée → devient un AVANT-POSTE** | **donjon ramifié** explorable, à butin (usage **unique**) ; **grotte nettoyée ⇒ avant-poste** (recharge eau + voyage rapide) |
| **mine** (fer/charbon/soufre) | on la **nettoie une fois** ⇒ débloque le **métier de mineur** au village | **descente courte → filon** ; **sécuriser** le filon **suffit** à débloquer le métier (économie du village) |
| **épave / cuirassé** | gros setpiece | (hors scope ici : déjà des sites dédiés `ship`/`executioner`) |

> **Distinction importante** : *grotte = explorer pour du butin* (ramifié, ponctuel, **à usage
> unique** ; **une fois vidée/nettoyée elle se convertit en avant-poste** comme dans ADR) ;
> *mine = nettoyer pour débloquer une production continue* (court, orienté vers UN filon).
> La roadmap (M9) prévoyait des « embranchements **HTML** ». La demande est plus forte :
> **embranchements PHYSIQUES** (on marche les chemins), cohérents avec l'open-world. On adopte
> donc l'approche **100 % 3D physique**, le HTML ne servant qu'aux dialogues/événements ponctuels.

---

## 2. Contraintes réelles du moteur (ce qui cadre la solution)

| Contrainte | Conséquence pour le souterrain |
|---|---|
| **Terrain = heightmap pur** `terrainHeight(x,z)` ([`data/world.ts`]) ; mesh par chunk déformé en Y, collider **MESH** par chunk, créé **seulement près du joueur** (`PHYS_R=1`, ~48 u) ([`src/render/terrain.ts`]). | **Impossible de creuser un VRAI trou/surplomb dans le terrain** (fonction à valeur unique). On peut en revanche **creuser une cuvette** (faire plonger `terrainHeight` sur l'emprise du site) — ça reste mono-valué. Le « plafond » d'une grotte doit donc être un **mesh séparé**, pas le terrain. |
| **Sites = instances déterministes, SANS collider** (LOD silhouette→détail via `EntityManager`) ([`src/render/sites.ts`]). | L'intérieur explorable est un **nouveau palier LOD** à bâtir ; il faut lui **ajouter des colliders** (les instances n'en ont pas). |
| **Joueur = capsule Havok dynamique** ; `isGrounded` lit `terrainHeight` analytique ([`src/render/player.ts`]). | Le joueur marche sur le terrain partout ; pour marcher **sur des sols de mesh** (tunnels), il faut des `PhysicsAggregate` sur ces sols, et accepter que `isGrounded` (analytique) soit imparfait sous terre (sauter sous terre = cas marginal). |
| **Sim pure & déterministe, P2P hôte-autoritaire** ([`architecture.md`]) ; carte = fonction pure de la graine ([`src/sim/worldgen.ts`]). | **Disposition du souterrain + butin + rencontres = dérivés de la graine** (identiques chez tous). L'**état d'exploration** (chambre fouillée, mine sécurisée…) doit vivre dans le **reducer** (sauvegarde + cohérence réseau). |
| **« Pas de transition »** | Pas de swap de scène, pas de chargement : on **marche** dedans ; le monde reste chargé mais **occulté** par les parois ; l'obscurité se fait par **fondu local** (pas par changement de scène). |
| **Éclairage/brouillard GLOBAUX** (hemi + soleil bas, fog exp2 désactivé par défaut) ([`src/render/scene.ts`]) ; pas de volume lumineux local ; **pas de torche**. | Le « souterrain sombre » se fait par : géométrie qui **occulte le ciel/soleil** + accents **émissifs/unlit** (filons luisants) + **lumière portée** (torche = `PointLight` suiveuse) + éventuel **fondu de brouillard local** quand on franchit la bouche. |
| **Sites déjà placés/déterministes**, `map.sites` (type, cx, cz), `cellToWorldCenter`, `safeRadiusCells`. | On greffe le souterrain **sur les sites existants** (`cave`, `ironmine`, `coalmine`, `sulphurmine`) sans toucher au worldgen de placement. |

**Idée-force qui découle de ces contraintes :** comme on ne peut pas trouer le heightmap, le
souterrain est un **volume mesh autonome** (sol + parois + **plafond mesh**) **raccordé au terrain à
la bouche**. Deux façons de « descendre » sans surplomb terrain :
- soit le souterrain est **dans un massif rocheux posé au sol** (montagne creuse, sol ~au niveau) ;
- soit on **abaisse le heightmap en cuvette** sous l'emprise et le souterrain **coiffe** la cuvette
  d'un plafond mesh → vraie sensation de **descente**, sans trou ni surplomb dans le terrain.

---

## 3. Solution proposée — souterrain mesh « cousu » au terrain, sans transition

### 3.1 Géométrie : 3 options, une recommandée

**Option A — Massif creux au niveau du sol (✅ RETENUE — décision §8.Q1).**
Le site est un **gros rocher/colline** (mesh) posé sur le terrain ; on y perce une **bouche large**,
et l'**intérieur** (tunnels + chambres, sol/parois/plafond mesh) est creusé DANS le massif, sol
~au niveau du terrain. « Souterrain » = enfermé + sombre, même si on ne descend presque pas.
✅ zéro modif terrain · ✅ robuste · ➖ peu de sensation de descente.
**C'est l'approche retenue** : la plus sûre, sans toucher au heightmap, et suffisante pour l'esprit
ADR (entrer dans un lieu fermé, sombre, ramifié). La sensation de descente n'est pas un objectif.

**Option B — Cuvette de heightmap + intérieur coiffé (repoussée, v3+).**
On fait **plonger `terrainHeight`** en **entonnoir** sur l'emprise du site (un bol/rampe qui descend),
puis on **coiffe** le fond d'un **plafond mesh** + on prolonge en **tunnels mesh** sous ce plafond.
Le joueur **descend la rampe** (terrain réel, avec collider) jusqu'à la **bouche** (raccord terrain↔mesh
caché par la roche), puis marche dans l'intérieur (sols mesh à colliders, plafond mesh qui occulte le ciel).
✅ vraie **descente sous terre** · ➖ il faut une **dépression locale** dans `terrainHeight` + aplanir
proprement les bords. **Non retenue pour l'instant** : gain d'immersion non prioritaire vs la robustesse de A.

**Option C — Masque de collider terrain (trou réel).** Supprimer le collider+rendu du terrain sous
l'emprise et plonger un intérieur en dessous. ➖ coutures, bords où l'on tombe, streaming à gérer →
**à éviter** (gain faible).

> **Décision : Option A.** A et B partagent 90 % du code (intérieur mesh + colliders + LOD + contenu) ;
> seule diffère la **bouche**. Bâtir sur A garde la porte ouverte à une cuvette B ultérieure (v3) sans
> rejouer l'intérieur.

### 3.2 Transition « invisible » (pas de scène, pas de chargement)

1. On **marche** dans la bouche : aucune action, aucun swap — c'est de la géométrie de plus.
2. La **bouche est coudée** (le 1er tunnel tourne) → la lumière du dehors **ne pénètre pas**, le
   plafond mesh **occulte** soleil/ciel ⇒ il fait naturellement sombre.
3. Un **volume de seuil** (zone autour de la bouche) **fond** l'ambiance : on baisse en douceur
   `hemi`/`sun` perçus (via un facteur d'éclairage local) et/ou on **monte un brouillard sombre**
   localement, et on **allume la torche** du joueur. Tout est **local et cosmétique** (aucun pair n'en dépend).
4. Le **monde extérieur reste chargé** (pas de unload) mais est **caché par les parois** ; option
   perf : **suspendre le rendu des chunks lointains** tant que le joueur est « sous plafond »
   (l'`EntityManager`/terrain le savent déjà par distance ; on ajoute juste un flag « sous terre »).

### 3.3 Les « recoins / continuer » = graphe de tunnels déterministe

Le souterrain est un **graphe** généré **déterministe** depuis `(type, cx, cz, seed)` (donc identique
chez tous les pairs, sans rien stocker) :

```
bouche → puits/tunnel principal → CARREFOUR ──► branche A ──► chambre (butin)
                                            ├─► branche B ──► cul-de-sac (cache / piège)
                                            └─► descente ───► … (plus profond) … → CHAMBRE PROFONDE (récompense / filon)
```

- **Avancer dans un tunnel = « continuer »** ; **choisir un embranchement = le choix ADR**.
- **Nœuds** (paramétrés par type de site) :
  - `junction` : carrefour (2-3 sorties) ;
  - `chamber` : salle avec **contenu** (cache de butin, **filon d'minerai**, **déclencheur d'événement**, repère) ;
  - `deadend` / `recoin` : petite niche → cache, ou rien (exploration) ;
  - `hazard` : éboulement à dégager (outil requis), gaz, vide… (tension) ;
  - `deep` : la **chambre profonde** = le « cœur » du lieu (gros butin ; pour une mine = **le filon** dont la sécurisation **débloque le métier**).
- **Profil par type** : `ironmine/coalmine/sulphurmine` = **court** (bouche → 1 carrefour → filon),
  `cave` = **ramifié** (plusieurs branches, butin/événements), la taille/profondeur peut croître avec
  la **distance au camp** (sites de bord = plus grands/dangereux, cohérent avec le gradient existant).
- Génération : un petit **générateur de donjon** (croissance de couloirs sur une grille locale, RNG =
  `cellSeed(cx,cz,seed)`) → liste de **segments** (tunnels) + **nœuds**, que `sites.ts` instancie en mesh.

### 3.4 Interactions (réutilise le système de focus existant)

Le système de **focus** (`computeFocus()` dans [`src/main.ts`], verbe « E ») est extensible. On ajoute :
- **« entrer »** : optionnel — l'entrée étant physique, ce verbe peut juste afficher le **nom du lieu**
  / déclencher la **découverte** (marque le site « connu » dans la sim). On peut s'en passer (entrer = marcher).
- **« fouiller »** (cache), **« miner »** (filon), **« forcer le passage »** (éboulement, coûte un outil),
  **« ramasser »** (butin au sol). Chaque verbe → **action sim déterministe** (résultat tiré de `state.rng`),
  l'état du nœud (fouillé/épuisé/dégagé) passant dans le reducer.

### 3.5 Éclairage & torche (fidélité ADR — décision §8.Q3)

Dans ADR, la **torche** se fabrique avec **1 bois + 1 étoffe**, **on ne peut PAS entrer** dans une
grotte sombre (ni un bâtiment abandonné) **sans en avoir**, et il en faut **plusieurs** pour explorer
une grotte en entier : elle est **consommable**. On reste **fidèle** :

- **Objet d'inventaire `torch`** (déjà listé dans les craftables d'outils, cf. roadmap §1.4). Recette
  ADR : **1 bois + 1 étoffe** (`cloth`/`leather` selon l'économie en place).
- **Requise pour s'enfoncer dans le noir** : au **volume de seuil** de la bouche, si le joueur n'a
  **aucune torche** en sac, il ne peut pas progresser (rebut doux + toast « il fait trop noir — il
  faut une torche »). Avec une torche, il **l'allume** en entrant (elle passe « en main »).
- **Affichée sur le modèle 3D du joueur** : dès qu'une torche est dans l'inventaire, un **modèle de
  torche est attaché naturellement** au personnage (tenue en main / accrochée au dos selon l'état),
  porté par un **nœud d'attache** sur le rig (cf. `src/render/player.ts` / `characters.ts`). Allumée,
  elle porte une **`PointLight` suiveuse** (chaude, portée courte) + un petit halo émissif.
- **Consommation = tension (ADR)** : une torche **s'épuise** (durée/temps sous terre) ; en avoir
  **plusieurs** permet d'aller plus loin ; à court de torches au fond ⇒ on doit ressortir. Profondeur
  ⇒ plus sombre ⇒ risque. Le **décompte de torches** vit dans le **sac du joueur** (état sim).
- Les filons/cristaux **émissifs** (techno « glow » des sites, `glowSink`/`makeVCKit`) servent de
  **repères lumineux** dans le noir, même torche éteinte.

---

## 4. Sim, déterminisme & P2P

- **Disposition + tables de butin + rencontres = pures (graine)** → aucun stockage, identiques partout.
- **État d'exploration = dans le reducer** (sauvegardé, P2P-safe). Nouveaux champs `GameState`
  (à la M9), p.ex. : `sites: Record<siteKey, { discovered, clearedNodes:Set, taken:Set, cleared }>` où
  `siteKey = "cx,cz"`. Nouvelles actions **pures** :
  - `DISCOVER_SITE(cx,cz)` (cosmétique de découverte, fog-of-war Phase 6) ;
  - `TAKE_LOOT(cx,cz,itemId)` → **butin = objet 3D au sol** : le joueur le **ramasse** et il est ajouté
    à **SON sac** (`carried[selfId]`). **Le butin est COMMUN à toute la carte (décision §8.Q5)** :
    chaque objet posé est **unique et global** — `taken` (dans le snapshot autoritaire) garantit que
    **si un joueur le ramasse, l'autre ne peut plus** (premier arrivé, premier servi). L'objet 3D
    **disparaît du monde** chez tous les pairs dès qu'il est pris (résolu par l'**hôte** → aucun
    double-ramassage). Le sac respecte les bornes (`storageCap`/capacité de sac) ;
  - `CLEAR_HAZARD(cx,cz,nodeId)` (débite l'outil/le coût) ;
  - `SECURE_MINE(cx,cz)` → **sécuriser le filon SUFFIT** (décision §8.Q4) ⇒ **débloque le métier de
    mineur** correspondant (un `ironmine` sécurisé rend le métier mineur-fer assignable au village) ;
  - `CLEAR_CAVE(cx,cz)` → une grotte **entièrement nettoyée** (usage **unique**, décision §8.Q2)
    **se convertit en AVANT-POSTE** (fidélité ADR) : le site bascule `cleared` et **se comporte dès
    lors comme un `outpost`** (recharge eau + point de voyage rapide, cf. roadmap §1.6).
- **Réseau / butin partagé** : `taken`, `cleared`, `secured` entrent dans le **snapshot
  hôte-autoritaire** → tous les pairs voient les mêmes objets déjà pris, la même mine sécurisée, la
  même grotte devenue avant-poste. **Co-op** : plusieurs joueurs peuvent fouiller la même grotte ; le
  **butin global premier-servi** crée une **course** coopérative/compétitive sans incohérence (l'hôte
  tranche l'ordre). Le **ramassage va au sac de CELUI qui ramasse** (pas à un pot commun) — c'est
  l'**objet** qui est commun, pas le sac.
- **Tests** (`src/sim/sim.test.ts`) : ramassage borné, **objet déjà pris ⇒ second `TAKE_LOOT` = no-op**
  (premier-servi), mine sécurisée ⇒ métier débloqué, **grotte nettoyée ⇒ devient avant-poste**,
  déterminisme (même graine + actions ⇒ même état), idempotence (re-fouiller un nœud vidé = no-op).

---

## 5. Rendu, LOD & perf

- **Nouveau palier LOD « interior »** sur les sites concernés (en plus de `full`/`minimal`/`culled`) :
  l'intérieur (mesh lourd + colliders) n'est **bâti qu'à proximité** (joueur dans l'emprise / proche de
  la bouche), et **libéré** en s'éloignant — comme la physique terrain localisée (`PHYS_R`).
- **Colliders** : sols/parois/plafond de l'intérieur = `PhysicsAggregate` (BOX/MESH, mass 0) créés/dé-
  truits avec le palier `interior` (réutilise le motif `rebuildColliders` de la cabane, et la
  localisation physique du terrain).
- **Occlusion** : sous plafond, les parois cachent le monde ; option **« sous terre » → ne pas rendre
  les chunks/sites lointains** (gros gain), puisqu'invisibles.
- **Instancing** : tunnels = quelques **modules** (segment droit, coude, carrefour, chambre) **instanciés**
  le long du graphe → coût maîtrisé, style cohérent (kit `makeVCKit`, vertex colors + `glowSink` émissif).
- **Silhouette de loin** : inchangée (on voit la bouche/le massif au loin, on marche jusqu'à lui).

---

## 6. Intégration au code existant (points d'ancrage)

| Sujet | Fichier | Geste |
|---|---|---|
| Bouche en cuvette (Option B) | `data/world.ts` `terrainHeight` | ajouter une **dépression** locale (entonnoir) centrée sur les sites `cave/*mine` (mono-valuée) ; veiller au raccord/aplani des bords. |
| Génération du donjon | `src/sim/worldgen.ts` (ou nouveau `dungeon.ts`) | fonction **pure** `dungeonFor(type,cx,cz,seed) → { segments, nodes }` (RNG = `cellSeed`). |
| Mesh intérieur + LOD `interior` | `src/render/sites.ts` (+ `entities.ts`) | `buildInterior(K, graph)` (modules instanciés) ; nouveau palier LOD + colliders + flag « sous terre ». |
| Torche & obscurité locale | `src/render/scene.ts` / `world.ts` / nouveau | `PointLight` suiveuse ; **volume de seuil** qui **bloque l'entrée sans torche** + fond éclairage/brouillard ; toggle rendu monde lointain. |
| **Torche sur le modèle** | `src/render/player.ts` / `characters.ts` | **nœud d'attache** (main/dos) ; un **mesh torche** apparaît quand `carried[self].torch > 0`, allumé sous terre (porte la `PointLight`). |
| Focus & verbes | `src/main.ts` `computeFocus` | ajouter foci **fouiller/miner/forcer/ramasser** (+ « entrer/découvrir ») sur les nœuds/objets proches. |
| État & règles | `src/sim/{state,reducer,actions}.ts` | champs `sites{…}` (`taken`/`secured`/`cleared`) ; actions `DISCOVER/TAKE_LOOT/CLEAR_HAZARD/SECURE_MINE/CLEAR_CAVE` **pures** ; **butin global premier-servi** (hôte tranche) ; clamp sac (`storageCap`). |
| Métier débloqué | `data/world.ts` `jobs` | `SECURE_MINE` ⇒ rend le métier mineur correspondant **assignable** (déjà des jobs de production). |
| **Grotte → avant-poste** | `src/sim/reducer.ts` + `src/render/sites.ts` | `CLEAR_CAVE` bascule le site en `outpost` (recharge eau + voyage rapide) ; le rendu affiche dès lors le modèle/silhouette `outpost`. |
| Butin = objets 3D | `src/render/sites.ts` + `data/world.ts` | **objets ramassables** posés dans les nœuds (instances + collider de pickup) ; tables de **butin** par type/profondeur ; ils **disparaissent chez tous** une fois `taken`. |
| Données de contenu | `data/world.ts` | tables de **butin**, **coûts** (forcer un éboulement), **recette torche (1 bois + 1 étoffe)** + durée, tailles de donjon par anneau. |

---

## 7. Phasage conseillé

1. **v1 — entrer & explorer (statique, sûr).** Option **A** (massif creux au niveau du sol — décision
   actée) sur `cave` : bouche large + 1 tunnel coudé + 1-2 chambres + colliders + palier LOD `interior`
   + obscurité simple (occlusion). **Butin = objets 3D ramassables** dans 1-2 caches (`TAKE_LOOT` →
   sac, **global premier-servi**, clamp). **Aucune transition.**
   *Livrable visible : on marche dans une grotte, on ramasse un objet, on ressort — même monde.*
2. **v2 — graphe, torche, mines & avant-postes.** Générateur de donjon ramifié (déterministe) ;
   `cave` ramifiée. **Torche fidèle ADR** : recette **1 bois + 1 étoffe**, **requise pour entrer**,
   **affichée sur le modèle du joueur**, consommable + `PointLight` suiveuse + repères émissifs.
   `*mine` courte → **filon** → `SECURE_MINE` **débloque le métier**. **Grotte nettoyée → `CLEAR_CAVE`
   ⇒ devient un AVANT-POSTE** (recharge eau + voyage rapide).
3. **v3 — descente & tension.** Option **B** (cuvette + plafond) pour la vraie descente ;
   **hazards** (éboulements à forcer), événements de lieu (réutiliser le moteur d'événements M5 en
   le **déclenchant à l'entrée d'une chambre**), torche qui s'épuise plus vite en profondeur.
   **Combat sous terre = M8** (ennemis de grotte fidèles ADR — Lézard des cavernes, Bête grognante) :
   **documenté, pas implémenté ici** (cf. §8.Q6 et roadmap M8).
4. **v4 — finitions monde.** Fog-of-war (Phase 6) : la **découverte** d'un site/d'une branche ;
   équilibrage co-op (densité de butin global vs nombre de joueurs).

---

## 8. Décisions actées (tranchées par l'utilisateur, juin 2026)

> Toutes ces questions étaient ouvertes ; elles sont désormais **tranchées**, au plus près d'ADR.
> Elles cadrent l'implémentation future (M9, et M8 pour le combat).

1. **Géométrie d'entrée → Option A** (massif creux **au niveau du sol**). Pas de modif `terrainHeight`.
   La descente réelle (B) reste un objectif **v3+** non prioritaire. *(cf. §3.1)*
2. **Grottes → usage UNIQUE** (pas de refresh du butin). **Mieux** : fidèle à ADR, **une grotte
   entièrement nettoyée se convertit en AVANT-POSTE** (`outpost` : recharge eau + voyage rapide).
   *(cf. §1, §4 `CLEAR_CAVE`, §7 v2)*
3. **Torche → fidèle ADR & consommable.** Recette **1 bois + 1 étoffe** ; **requise pour s'enfoncer
   dans le noir** (pas d'entrée sans torche) ; il en faut **plusieurs** pour une grotte ; elle
   **s'épuise**. **Quand le joueur en porte une, elle est affichée sur son modèle 3D**, attachée
   naturellement (main/dos), et porte la lumière une fois allumée. *(cf. §3.5)*
4. **Mine → métier : sécuriser UN filon SUFFIT.** Pas d'obligation de miner physiquement ;
   `SECURE_MINE` débloque le métier de mineur correspondant au village. *(cf. §4 `SECURE_MINE`)*
5. **Butin → objets 3D ramassables, ajoutés au SAC du joueur, COMMUNS à toute la carte.** Chaque objet
   est **unique et global** : **premier arrivé, premier servi** — si un joueur le ramasse, l'autre ne
   peut plus (l'objet disparaît du monde chez tous). C'est l'**objet** qui est commun, pas le sac : le
   ramassage va au sac de celui qui prend. Cohérence garantie par l'**hôte** (snapshot autoritaire,
   champ `taken`). *(cf. §4 `TAKE_LOOT`)*
6. **Combat → fidèle à l'ADR original, mais PAS implémenté ici** : il relève de **M8** (combat 3D &
   créatures). On documente seulement la cible (cf. **roadmap M8**) : **temps réel**, **armes à
   recharge** (on en porte plusieurs, on frappe avec l'une pendant que les autres rechargent ; poings
   par défaut), **PV remontés par les armures** (cuir/acier), **soin en mangeant** de la viande
   (~+8 PV toutes les ~5 s), ennemis de cavernes **fidèles** (**Lézard des cavernes** 6 PV/3 dég →
   écailles/dents ; **Bête grognante** 5 PV/1 dég → fourrure/viande/dents). En M9, les grottes
   exposent les **emplacements** de rencontre ; la **résolution** vient avec M8.
7. **Taille/perf (cadrage technique, non bloquant).** Profondeur de donjon **bornée** par anneau
   (sites de bord = plus grands) ; **un seul** site `interior` actif à la fois (le joueur n'est que
   dans un) → budget meshes/colliders maîtrisé via le palier LOD `interior` (build/free à proximité).
