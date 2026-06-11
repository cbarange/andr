# Refonte — Génération du monde, bordures & vie du campement

> ✅ **TERMINÉ (juin 2026)** — les 6 chantiers sont implémentés & vérifiés (typecheck · 169 unit · 11 e2e) :
> **A** biomes en régions + marais-région · **B** vraies bordures (2 montagnes + 2 océans par graine, monde
> carré, confinement) · **C** placement mathématique des bâtiments (`generateCampLayout`) · **D** ruines ·
> **E** lanternes par palier de cabane · **F** villageois dans les huttes + son de porte. Ce document reste la
> **référence de conception** (formules, décisions). Suite hors refonte : voir [`routes-sites.md`](routes-sites.md) (R3/R4) et [`roadmap-v2.md`](roadmap-v2.md).

> **Analyse + plan** (post-audit, juin 2026). Couvre 6 chantiers demandés : (A) génération de carte moins
> répétitive + marais ; (B) **vraies bordures** (2 fausses montagnes + 2 faux océans, réparties aléatoirement) ;
> (C) **placement mathématique** élégant des bâtiments (nombre d'or / Fibonacci / phyllotaxie) ; (D) décor +
> **ruines** + chemins ; (E) le **village s'améliore** avec le palier de cabane ; (F) **villageois dans les
> huttes** avec rotation + son de porte.
>
> **Invariants respectés** : `sim/`+`data/` purs & déterministes (RNG à graine, jamais `Math.random`) ;
> rendu/UI = présentation locale (Math.random OK, cosmétique) ; audio = présentation. Le campement reste
> **FIXE** (identique d'une partie à l'autre), confirmé : `campLayout` est une donnée hand-authored, pas de
> génération aléatoire.
>
> Bases techniques (recherche) : phyllotaxie de **Vogel**, **domain warping** (Inigo Quilez), **bruit de
> Worley** (régions), **fBm**, **smoothstep** pour les bordures. Détails & sources en annexe.

---

## État des lieux vérifié (le « pourquoi c'est moche aujourd'hui »)

| Sujet | Constat (code) | Cause |
|---|---|---|
| **Biomes répétitifs** | `worldgen.chooseBiome` = remplissage par anneaux avec biais voisin (`stickiness 0.5`) | aucune **structure grande échelle** (pas de warping, pas de régions Voronoi) ; `barren 0.5` domine → moucheté uniforme |
| **Marais minuscule/absent** | `sites[]` : swamp **count 1**, anneau 40–55 cellules (480–660 u), modèle = **disque d'eau Ø6 u** à l'échelle 1 | site = **point unique** très loin + petit prop ; aucune notion de **région** |
| **Bordure « montagne »** | `mountainEdge(r)` dans `terrainHeight` : **radiale**, démarre à `0.8·WR = 614 u` **SUR la carte** | mange ~150 u de zone jouable ; **pente praticable** (pas un mur) ; pas par-côté |
| **On tombe dans le vide** | aucun collider au-delà de `PHYS_R` ; chunks s'arrêtent à `~840 u` ; **aucun clamp / reset de chute** | pas de **confinement** ; en `/fly`/`/noclip` on sort trivialement |
| **Campement sans harmonie** | `campLayout.buildings` = ancres **placées à la main** (éditeur F2) | placement intuitif, pas de principe de composition |
| **Cabane ↑ ≠ village ↑** | `cabin.setTier` change la cabane ; **aucun hook** ne fait évoluer le village | `Village`/`CampDecor` ignorent `cabinTier` |
| **80 PNJ qui errent** | `villagers` cap **48** rendus, **tous dehors**, pas d'état « dans la hutte » | aucune notion d'occupation des huttes |
| **Chemins** | `CampPaths` **EST câblé** (5 polylignes, texture 384px) — *la doc `plan-campement.md` est périmée* | rendu basique (couleur plate à 384px) ; trails émergents = **code mort** |

---

## A) Génération du monde — moins répétitive + marais-région

**Objectif** : casser l'uniformité, donner une **structure grande échelle**, et faire du **marais une vraie
région** de taille lisible (pas un point lointain).

**`sim/worldgen.ts` + `data/world.ts`** (pur, déterministe — on garde `createRng(worldSeed)`) :

1. **Régions de biomes par bruit de Worley** (remplace/complète la viscosité). Découper l'espace en cellules
   de Voronoi autour de points-graines ; chaque région reçoit un biome. La **taille de cellule contrôle la
   taille des biomes** → fini le moucheté. Bordures adoucies en perturbant la distance par du `fbm`
   (`d *= 1 + 0.3·(fbm(p·0.1) − 0.5)`) → frontières organiques, pas polygonales.
2. **Domain warping** sur le champ de biome/altitude : `valeur = fbm(p + 4·q)` avec
   `q = (fbm(p), fbm(p+(5.2,1.3)))`. Casse instantanément l'aspect grillé. Garder le warp sur la
   **basse fréquence** (sinon bouillie).
3. **fBm multi-octaves** (lacunarité 2, gain 0.5, 4–6 octaves) pour le détail à toutes les échelles.
4. **Marais = RÉGION** : ajouter `Biome.Swamp` (enum `world.ts`) + `BiomeDef` + palette sol (`terrain.ts`).
   Le poser comme **une cellule de Worley dédiée** ou un **masque de rayon** ancré par graine :
   `mask = 1 − smoothstep(0.6, 1.0, dist/rayon)`, rayon ≈ 60–100 u, à distance moyenne (pas 480 u). Le
   site-prop « marais » (réservoir d'eau, roseaux, arbres morts) se **disperse alors dans la région** au lieu
   d'être un disque Ø6 u isolé.

> ⚠️ **Déterminisme / graines** : la génération de biomes consomme le **même flux `rng`** que le placement
> des sites → changer la génération **décale les positions des sites** pour une graine donnée. Recommandation :
> **sous-graines séparées par sous-système** (`seedFor(name) = hash(worldSeed ^ tag)`) → biomes / sites /
> bordures indépendants, et on pourra modifier l'un sans casser les autres. C'est une **nouvelle version de
> monde** (les anciennes graines rendront un monde différent — acceptable en PoC).

---

## B) Vraies bordures — 2 fausses montagnes + 2 faux océans (réparties aléatoirement)

**Objectif** : un grand **carré** ; sur ses 4 côtés, exactement **2 montagnes + 2 océans**, assignés
**aléatoirement par la graine** (parfois opposés, parfois adjacents) ; la bordure **commence AU-DELÀ** de la
zone jouable (l'intérieur reste plat) ; le joueur **ne peut pas s'échapper ni tomber**.

**`data/world.ts` (`terrainHeight` + nouvelle config) :**

1. **Champ de bordure additif par côté** (remplace `mountainEdge` radial). Pour le demi-côté `P` (bord de la
   zone jouable) et une bande `B` au-delà, calculer la **pénétration** par côté :
   `tN = clamp((z−P)/B, 0,1)` … `tW = clamp((−x−P)/B, 0,1)` → **0 partout dans la zone jouable**, monte
   0→1 dans la bande extérieure. Profil lissé : `ramp = smoothstep(0,1,t)` (ou `t²`/`t³` pour un pied doux
   et un mur raide).
2. **Type par côté** : `contrib(côté) = (montagne ? +H_max : −D_max)·ramp(t_côté)`.
   `H_max ≈ 3–6× la taille du joueur` (inescaladable), `D_max ≈ 1.5–3×`, `seaLevel` juste sous la zone jouable.
3. **Mélange des coins** (somme pondérée par la pénétration) :
   `bordH = Σ t_côté·contrib(côté) / (Σ t_côté + ε)` → un coin montagne∧océan devient un **promontoire/cap**
   naturel. Variation du faîte par `fbm` basse fréquence (`H_max·(0.8 + 0.4·fbm(p·0.05))`) → ce n'est pas un
   mur lisse.
4. **Faux océan** : plan d'eau (`P.water`) au `seaLevel` ; le terrain plonge dessous → côte automatique.
5. **Démarrer AU-DELÀ** : `B` vit **entièrement hors** de `P` (zone jouable intacte). Étendre
   `MAX_CHUNK_DIST` (`terrain.ts`, +1.5 chunk aujourd'hui) pour **rendre** la bande de bordure.

**Assignation 2-montagne / 2-océan déterministe** :
```
PAIRS = [{N,E},{N,S},{N,W},{E,S},{E,W},{S,W}]  // les 6 sous-ensembles de 2 côtés
k = floor(rand_seed() * 6);  oceanSides = PAIRS[k]   // les 2 autres = montagnes
```
→ donne naturellement adjacents (4 cas) et opposés (2 cas). Calculé **une fois** depuis `worldSeed`.

> **Threading de la graine** : `terrainHeight(x,z)` est aujourd'hui une fonction **globale pure sans graine**
> (15 appelants). Solution la plus propre sans tout réécrire : `generateWorld` calcule `borderSides` (déterministe)
> et le **stocke dans `WorldMap`** ; un `configureBorders(borderSides)` (variable de module) est appelé à chaque
> (re)génération **avant** tout build de terrain. C'est cohérent avec le fait que `terrainHeight` est déjà liée
> à l'unique monde actif.

**Confinement (anti-fuite / anti-chute) — `src/render/player.ts`** :
- **Clamp de position/vitesse** : annuler la composante de vitesse qui pousse au-delà de `±(P+B)` (robuste même
  là où il n'y a pas de collider, car les colliders sont localisés `PHYS_R`).
- **Filet de chute** : si `position.y < seuil` → `player.teleport(dernière position sûre)` (la méthode existe).
- **Respecter `/fly` & `/noclip`** (debug) : le clamp s'efface dans ces modes.

---

## C) Campement — placement mathématique élégant (nombre d'or / Fibonacci / phyllotaxie)

**Objectif** : garder un campement **fixe** mais **harmonieux**, calculé par des principes mathématiques tout
en respectant l'intention de **quartiers** (artisanat O, industrie E, chasse N, approche S — cf.
`plan-campement.md`).

**Approche hybride recommandée** (la recherche le confirme pour 10–30 bâtiments) :
1. **Foyers placés à la main** : le **feu** (centre `0,0`) et la **cabane** restent des points d'ancrage
   composés manuellement (façade, axe principal).
2. **Le reste via phyllotaxie de Vogel, filtrée par secteur** :
   ```
   GOLDEN_ANGLE = π·(3−√5) ≈ 2.39996 rad (137.5°)
   pour le n-ième bâtiment : θ = n·GOLDEN_ANGLE ; r = c·√n     (densité constante, ni anneaux ni paquets)
   c ≈ 0.564·espacement_voulu   (ex. espacement 9 u → c ≈ 5 ; r₁≈5, r₃₀≈27)
   ```
   On **n'utilise pas** un cercle complet : on **remappe** la suite (équidistribuée) dans le **secteur** du
   quartier — artisanat dans le wedge Ouest, industrie à l'Est, etc. → chaque bâtiment garde une position
   organique **dans son quartier**.
3. **Rayons de zones au nombre d'or** (`R_k = R₀·φ^k` ≈ Fibonacci 8/13/21/34) pour les anneaux feu→artisanat→
   habitat→industrie, et **comptes par anneau en Fibonacci** (3, 5, 8…).
4. **2–3 passes de relaxation de Lloyd** (vers le centroïde de Voronoï) pour dé-chevaucher proprement le mélange
   foyers-manuels + phyllotaxie, sans perdre l'organique.

**Où ça se branche** : `buildings.ts:574-578` (`sync`) + le chantier `:632-638`. Aujourd'hui les ancres
`campLayout` priment et `ringSlot` (anneaux basiques) est le repli. **Décision** : (a) **générer** `campLayout`
par un petit module **pur** (`data/`, calculé une fois, déterministe — pas de `Math.random`) façon Vogel+secteurs,
ou (b) garder les ancres comme **overrides** et ne calculer que les emplacements vides. → je recommande **(a)**
avec possibilité d'override manuel ponctuel (best of both). Note : un `GOLDEN = 2.399963` **existe déjà**
(`villagers.ts:22`) — précédent dans le code.

> Contrainte : placement **déterministe par (type, index)** (cohérence P2P cosmétique, `buildings.ts:4-7`) →
> formule pure, jamais `Math.random`. Les positions alimentent les obstacles (`getObstacles`), l'exclusion
> décor (`campDecor`) et le navGrid → tout se met à jour automatiquement.

---

## D) Décor, ruines & chemins

1. **Ruines sur les emplacements de bâtiments à venir** : nouveau petit module (façon `CampDecor`) qui lit les
   ancres `campLayout.buildings` **non encore bâties** et y pose des **gravats** (réutiliser/dériver le
   `buildRuin` de `cabin.ts:271-295`). À la construction (`buildings.ts:569-586`, quand `have < target`
   devient vrai), la ruine est **remplacée** par le chantier puis le bâtiment.
2. **Ruines décoratives permanentes** (sans évolution) : un sous-ensemble d'emplacements porte une ruine
   **définitive** (placée par graine dédiée, ajoutée aux exclusions de `campDecor` pour ne pas l'envahir).
   → rappelle l'esthétique « monde dévasté » d'ADR (on bâtit sur des restes).
3. **Chemins mieux représentés** : `CampPaths` est **déjà actif** (corriger `plan-campement.md` qui le dit
   retiré). Améliorations : monter `TEX` (384→768), passer d'une **couleur plate** à un **decal/texture de
   terre damée** (drap au-dessus du sol, `zOffset:-2` déjà géré), élargir/varier la largeur par chemin. Option :
   **re-câbler les trails émergents** (`trails.ts`, aujourd'hui **code mort** — le `stamp` existe dans
   `villagers.ts:340` mais `setTrails` n'est jamais appelé) pour creuser les sentiers là où les PNJ passent.

---

## E) Le village s'améliore avec le palier de cabane

**Objectif** : quand `cabinTier` monte (1→5→10), le **village** s'enrichit (lanternes, fanions, plus de décor),
pas seulement la cabane.

- **Hook** : le bloc de changement de palier **existe déjà** (`main.ts`, `if (state.cabinTier !== prevTier)`).
  Y appeler `village.setTier(t)` / `campDecor.setTier(t)`.
- **Lanternes** : réutiliser `Cabin.lantern` (`cabin.ts:341-348`, à exposer) — en disposer le long des
  **chemins** et autour de la place à partir du palier ×5, plus denses à ×10 (émissives → bloom déjà en place ;
  belles à la nuit/au feu).
- **Pattern** : pré-construire les décors par palier et **basculer la visibilité** (modèle des `shells` de
  `cabin.ts:114-130`) plutôt que reconstruire — propre et sans fuite. `CampDecor` doit devenir **tier-aware**
  (aujourd'hui construit une seule fois dans le constructeur).
- Cosmétique & local → zéro impact sim/réseau.

---

## F) Vie du village — villageois dans les huttes + rotation + son de porte

**Objectif** : avec jusqu'à 80 habitants, **~50 % à l'intérieur des huttes** à tout moment, avec **rotation**
entrée/sortie et un **bruit de porte**. Réduit la foule et fait vivre le village. **100 % local/cosmétique**
(`Math.random` autorisé, aucune désync).

**`src/render/villagers.ts`** :
1. **État `inside`** ajouté à `Avatar` ; un avatar « dedans » est **non rendu et non animé** (`setEnabled(false)`)
   → **gros gain perf** (on ne dessine plus que ~la moitié). C'est l'optimisation clé (« les PNJ derrière une
   porte fermée n'ont pas besoin d'être dessinés »).
2. **Hutte d'attache** par avatar au `spawn` (via `landmarks.buildings("hut")`). Porte = local `+Z` de la hutte
   (`buildHut`, `buildings.ts:143-150`) tournée par le `face` de l'ancre.
3. **Rotation échelonnée** : `nextSwap[i] = now + base + hash(i)%spread` (base ≈ 20–60 s, spread ±50 %) → les
   échanges **se diffusent** (pas de « relève » synchrone visible). Cible auto-correctrice ~50 % :
   `pGoInside = clamp(0.5 + k·(wantInside − countInside)/N, 0,1)`.
4. **Transition** : petit **tween d'entrée/sortie** (0,3–0,5 s vers la porte) avant `setEnabled(false/true)` →
   pas de pop « téléportation ».
5. **Son de porte** : nouvelle clé SFX (`data/audio.ts`, ex. `door: ["door-open","door-close"]` ; **fichier
   `.flac` à fournir dans `public/audio/`**), jouée au franchissement, **gâchée par la distance** (pas de chœur
   de portes) + petit cooldown par hutte. Injecter `AudioManager` (ou un callback `onDoor()`) dans `Villagers`
   (qui n'a pas de réf audio aujourd'hui).
6. **Densité visible** : « moitié dedans » + cap `MAX_AVATARS=48` (vs pop 80) peut rendre le village **clairsemé**
   → envisager de **monter le cap** (ex. 64) maintenant que la moitié est cachée, et/ou pondérer **quels rôles**
   se cachent (les sans-métier rentrent plus volontiers).

---

## Séquencement, risques & tests

```
F (villageois huttes)   ─ local, isolé, gros effet/effort faible ─┐
E (village ↑ palier)    ─ local, hook existant ───────────────────┤  → "vie & confort" (rendu pur, sûr)
D (ruines/chemins/décor)─ local ──────────────────────────────────┘
C (placement maths)     ─ data pur, change campLayout ────────────── "harmonie" (déterministe)
A (biomes/marais)       ─ sim pur, change le flux RNG monde ───────┐
B (bordures+confinement)─ data+player, threading graine, MAX_CHUNK ─┘  → "monde" (le plus structurel)
```
- **Commencer par F, E, D** (local/cosmétique, gros effet ressenti, risque quasi nul, aucun impact sim/réseau).
- **Puis C** (data pur, déterministe — vérifier que les nouvelles positions ne chevauchent ni le feu ni la cabane,
  via `OBSTACLE_RADIUS`/relaxation).
- **A & B en dernier** (les plus structurels) : A change le flux RNG du monde (→ sous-graines séparées) ; B
  demande de **threader `worldSeed`** dans la config de bordure + étendre `MAX_CHUNK_DIST` + le confinement joueur.

**Risques principaux**
- **A/B déterminisme** : tout via graine (sous-graines par sous-système) — jamais `Math.random` dans `sim/`/`data/`.
  Re-tuner le test `worldgen.test.ts` (fraction même-voisin) sans le casser.
- **B threading** : un appelant de `terrainHeight` oublié → désync hauteur ; centraliser la config de bordure.
- **F densité** : « moitié dedans » peut sembler vide → ajuster cap & ratio.
- **C** : ne pas casser le navGrid / l'évitement (positions feedées automatiquement, mais vérifier l'espacement).

**Tests** : `worldgen.test.ts` (déterminisme régions + assignation 2/2 des bordures reproductible) ; test pur du
**générateur de layout** (phyllotaxie : N points, pas de chevauchement, secteurs respectés) ; e2e capture
(camp embelli, bordures montagne/océan, villageois qui entrent/sortent). F/E/D = cosmétiques (e2e visuel surtout).

---

## Annexe — formules & sources (recherche)

- **Phyllotaxie de Vogel** : `θ=n·137.50776°`, `r=c·√n`, `c≈0.564·espacement`. Skipper les premiers `n` pour le
  centre. [Vogel/phyllotaxis], [ThatsMaths]. **Lloyd relaxation** : [Red Blob Voronoi].
- **Nombre d'or** φ=1.618 (1/φ=0.618, 1/φ²=0.382) : rayons de zones `R₀·φ^k`, ratios d'espacement 1:1.618.
- **Domain warping** : `fbm(p+4·q)`, `q=(fbm(p),fbm(p+(5.2,1.3)))`. [Inigo Quilez — warp].
- **Worley/Voronoi** : F1=région (taille cellule=taille biome), F2−F1=frontières. [Worley], [Red Blob maps].
- **fBm** : lacunarité 2, gain 0.5, octaves 4–6. [Inigo Quilez — fbm].
- **Bordures** : `H·smoothstep(0,1,dEdge/B)`, bande B≈15–25 % de P, mélange coins par somme pondérée. [Smoothstep],
  [Red Blob island].
- **Occupation PNJ** : ~50 % dedans, **cacher les intérieurs**, rotation échelonnée 20–60 s ±50 %. [NPC scheduling].
- **PRNG/bruit à graine** : mulberry32/splitmix32 + simplex/value-noise (déjà : `rng.ts` mulberry32, `cellSeed`).
