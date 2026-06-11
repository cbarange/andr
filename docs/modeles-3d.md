# Modèles 3D — catalogue & guide d'utilisation

> ⚠️ **MAJ juin 2026** : nouveaux modèles dans `render/sites.ts` — **cité** (tours brisées + lueur d'alliage),
> **forage** (margelle + derrick + lueur au fond), **champ de bataille** (cratères/armes/chariot/étendard),
> **village détruit / cache** (maisons effondrées + coffre qui luit), **avant-poste**. Ajout aussi des
> **lanternes** (`campLights`, par palier de cabane) et des **ruines** (`campRuins`). Les bâtiments du village
> sont placés par **`generateCampLayout()`** (placement mathématique, cf. [`refonte-monde-campement.md`](refonte-monde-campement.md) §C).

Référence des modèles low-poly prototypés dans le **labo** ([`lab/model-lab.html`](../lab/model-lab.html))
et **comment bien les utiliser** : placement, échelle, orientation, densité par biome, puis
**portage** vers `src/render/*`.

> Pré-requis de lecture : [`architecture.md`](architecture.md) — la stratification
> **cerveau / corps / données** est non négociable. Ces modèles relèvent du **corps** (`src/render/`) :
> ils sont **purement visuels**, ils ne contiennent **aucune règle de jeu**. Pour la dispersion du
> décor dans le monde, voir [`generation-monde.md`](generation-monde.md).

> Ouvrir le labo : `npm run dev` → <http://localhost:5173/lab/model-lab.html> (ou double-clic sur le
> fichier). Mode d'emploi de l'outil : [`lab/README.md`](../lab/README.md).

---

## 1. Conventions communes (à respecter pour rester cohérent)

Tout modèle, en jeu comme au labo, suit ces règles. Les enfreindre = le modèle « jure » avec le reste.

| Convention | Règle |
|---|---|
| **Style** | Low-poly, **flat shading** (`convertToFlatShadedMesh`), faces facettées. Pas de texture (sauf panneaux DynamicTexture du jeu). |
| **Palette** | Couleurs tirées d'une **palette unique** (`P` au labo = `PALETTE` de [`scene.ts`](../src/render/scene.ts), étendue). Jamais de couleur « en dur » hors palette. |
| **Sol** | Le sol est à **`y = 0`**. Tout modèle est posé dessus (rien sous terre, sauf effet voulu : os, pierres de charnière). |
| **Avant = `+Z`** | La « face » d'un modèle regarde **+Z**. Les personnages portent un **« nez »** (petit bloc) en +Z : c'est le **repère de direction** lu par le jeu — à conserver. |
| **Échelle** | Le **joueur ≈ 1,8 m**. Tout se mesure par rapport à lui (bouton **« échelle 1,8 m »** du labo = silhouette de référence). |
| **Émissif & bloom** | Seul l'**émissif** brille (feu, foyer, fenêtres) : bloom au-delà du seuil **1,25**. Une surface claire éclairée **ne doit pas** dépasser ce seuil (sinon halo parasite). |
| **Déterminisme** | Tout aléatoire de **gameplay** passe par le RNG à graine ([`rng.ts`](../src/sim/rng.ts)). Le **cosmétique local** (villageois, forêt, décor) peut utiliser `Math.random` — mais ce qui doit être **identique entre pairs** (P2P) reste déterministe. |

**Le kit de construction (`K`)** — primitives flat-shaded, un matériau par pièce. Signature commune
`opts = { rot:[x,y,z], scale:n|[x,y,z], emi:k, alpha:a, unlit:true, smooth:true }` :

| Méthode | Forme |
|---|---|
| `K.box(p, c, [w,h,d], [x,y,z], opt)` | boîte |
| `K.cyl(p, c, {h, dt, db, t} \| {h, d, t}, pos, opt)` | cylindre / tronc (dt=db=`d`) |
| `K.cone(p, c, {h, d, t}, pos, opt)` | cône (cyl à sommet nul) |
| `K.sph(p, c, {d, seg}, pos, opt)` | sphère |
| `K.ico(p, c, {d, sub}, pos, opt)` | icosphère (rochers, têtes) |
| `K.tor(p, c, {d, thick, t}, pos, opt)` | tore (cerclage, collerette, côtes) |
| `K.node(p, pos)` | `TransformNode` (groupe / charnière) |

---

## 2. Catalogue

### 2.1 Personnages (catégorie « Personnages »)

| id | Modèle | Échelle | Caractéristiques | Repère |
|---|---|---|---|---|
| `constructrice` | La constructrice | ~1,95 m | Robe évasée + ceinture, **cagoule** (visage dégagé), mantelet d'épaules, sacoche, bandoulière, **marteau planté** à la main | Doit se **distinguer** des villageois (plus grande, robe longue, capuchon, outil). |
| `villageois` | Villageois (variété) | 0,8–1,3 m | **5 individus distincts** : casquette, capuche pointue, chapeau de paille, barbu, enfant ; tuniques de teintes variées | Le **« nez »** repère de direction est conservé. |
| `joueur` | Le joueur | ~1,8 m | Tunique chaude (couleur joueur), écharpe, **sac à dos** (le « sac » plafonné), hachette à la ceinture | Repère de nez conservé. |

Chacun a une **version actuelle du jeu** (bouton **avant / après**) pour comparer la proposition à
l'existant (`stranger.ts`, `villagers.ts`, `player.ts`).

### 2.2 Bâtiments (catégorie « Bâtiments »)

| id | Modèle | Empreinte (≈) | Rôle gameplay | Détails / éléments animés |
|---|---|---|---|---|
| `cabane` | Cabane / entrepôt | 6 × 6 | Mairie-entrepôt | **Toit ouvert** (on voit l'intérieur), coffre, étagères, enseigne, sablière. |
| `hutte` | Hutte (variété) | ≈ 2,8 × 2,8 (habitable) | Loge la population | **Habitation à taille humaine** : fondation pierre, murs torchis sur ossature bois, chaume, **porte à seuil + cadre**, **fenêtre(s) émissive(s)**, **cheminée externe fumante** (du sol au-dessus du toit). Helper paramétré `buildHut(K, ctx, parent, v)` — **3 variantes légères** : ronde (toit conique) / carrée toit **pyramidal** (apex ponctuel) / **rectangulaire** toit **en croupe** (faîtage horizontal, maillage `makeHipRoof`), avec tas de bois, tonneau ou banc posés au sol devant. Porte décentrable (`v.doorX`) + fenêtre de façade positionnable (`v.frontWinX`). |
| `charrette` | Charrette | 0,9 × 1,5 (+ brancards) | Double la capacité de transport | 2 roues latérales (essieu le long de X), **brancards à l'avant** + poignée, chargement de rondins. |
| `loge` | Loge de chasse | ≈ 2,8 × 2,4 (cabane en rondins) | Assigner des chasseurs | **Cabane en rondins** (angles entaillés) à **toit à deux pentes, pignon en façade** (helper `makeGableRoof`). **Trophée crâne + bois** sur le pignon, fenêtre à volets éclairée, **cheminée arrière fumante**. Props chasse : 2 **cadres à peaux tendues** + tas de fourrures, **séchoir à viande** + gibier suspendu, **billot + hache plantée**, équipement façade (arc & flèches, épieux, collets, corne, lanterne). |
| `tannerie` | Tannerie | 2 × 1,6 | Fourrure → cuir | **Appentis** (poteaux arrière hauts / avant courts), **2 perches** reliant les poteaux, peaux qui sèchent, cuve. |
| `fumoir` | Fumoir | ≈ 1,7 × 1,5 (haut) | Viande → viande séchée | Cabanon en **planches verticales**, toit à 2 pentes + **évent fumant** au faîte, **porte entrebâillée** sur claies de **viande + poissons**, **foyer à braises** (émissif) au pied, tas de bois de fumage. |
| `acierie` | Aciérie | ≈ 3,2 × 2,4 (forge à l'air libre) | Produit de l'acier | Massif **fourneau** de pierre (gueulard incandescent + **coulée en fusion** émissive), haute **cheminée fumante**, gros **soufflet en cuir**, **enclume sur billot** (marteau/tenailles), **bac de trempe**, tas de charbon/minerai + **lingots d'acier**. |
| `poste` | Poste de traite | ≈ 3,0 × 2,0 (plancher) | Commerce nomade | **Plancher** + **auvent** incliné sur 4 poteaux, comptoir, **étagère de stock** arrière (caisses, bocaux, ballots, rouleau de tissu), marchandises variées (pelleteries, caisse, tonneau, **panier de produits**), **balance** + bottes d'herbes + lanterne suspendues, **fanion** de traite, tabouret. |
| `atelier` | Atelier | ≈ 3,0 × 2,2 (appentis) | Artisanat avancé | Hangar en **appentis** bardé + chevrons, **établi avec étau**, **mur d'outils** (scie, marteau, équerre, ciseaux), **chevalet de sciage** + planche, **meule à manivelle**, pile de planches + tonneau de chutes. |
| `armurerie` | Armurerie | ≈ 2,6 × 2,0 (fortifiée) | Produit des balles | Madriers + **contreforts de pierre**, **toit bas renforcé**, **porte bardée de fer** + lucarne à barreaux, **râtelier de mousquets**, **tonneaux de poudre** marqués, caisses de munitions et **poste de fonte des balles** (foyer + **creuset de plomb fondu**, louche, lingots, seau de balles). |

> **Cheminées / foyers** : `hutte`, `fumoir`, `acierie` ont une **fumée animée** (au labo via `ctx.animate`).
> En jeu, la fumée est gérée par [`buildings.ts`](../src/render/buildings.ts) (`setActivity` + puffs animés) ;
> l'émissif du foyer/fenêtre est un matériau `emissive` + `disableLighting`.

### 2.3 Pièges (catégorie « Pièges ») — **2 états**

| id | État | Description |
|---|---|---|
| `piege` | **Armé** | Piège à **assommoir (deadfall)** : lourde dalle de bois relevée par un **montant**, **appât** au sol dessous, bâton déclencheur, pierres de charnière. |
| `piege-pris` | **Prise** | La dalle **retombée**, montant éjecté, **créature prise dessous** (tête/oreilles/museau qui dépassent). |

> Important pour le portage : le piège a désormais **deux états distincts** (≠ ancienne sphère
> montrée/masquée). Voir §4.3.

### 2.4 Arbres (catégorie « Arbres ») — **9 essences**

Casser la monotonie de l'unique cône actuel. Mélanger les essences via [`data/world.ts`](../data/world.ts).

| Essence | type | Hauteur (≈) | Biome | Rôle |
|---|---|---|---|---|
| `petit-arbre` | `petit` | 2,6 m | forêt | **Arbre d'origine du jeu**, conservé en **petit** sujet / jeune pousse. |
| `sapin` | `pine` | 3,6 m | forêt | Conifère en étages — silhouette de forêt sombre. |
| `chene` | `oak` | 3,8 m | forêt, champ | Feuillu rond et touffu. |
| `bouleau` | `birch` | 4,1 m | forêt | Tronc clair élancé — apporte de la lumière. |
| `automne` | `autumn` | 3,6 m | forêt | Feuillage chaud bicolore — ponctue de couleur. |
| `cypres` | `cypress` | 4,6 m | forêt, lande | Cyprès/peuplier étroit — **accent vertical**. |
| `arbre-mort` | `dead` | 3,0 m | forêt, lande | Tronc nu + branches — ambiance désolée. |
| `buisson` | `bush` | 1,0 m | forêt, champ | Arbuste bas — remplit sans masquer la vue. |
| `souche` | `stump` | 0,55 m | forêt | Vestige d'arbre abattu. |

`Tous les arbres` (`arbres`) = panorama des 9 côte à côte (+ bouton **avant/après** = 5 cônes
identiques du jeu actuel).

### 2.5 Nature / décor (catégorie « Nature ») — **par biome**

| id | Modèle | Biome | Taille (≈) | Usage |
|---|---|---|---|---|
| `rochers` | Rochers (amas) | tous, surtout lande | 1,6 m | Amas mêlé de blocs. |
| `rochers-sml` | Rochers S / M / L | tous, surtout lande | 0,55 / 1,0 / 1,75 (échelle) | **3 tailles réutilisables** de bloc facetté. |
| `rondin` | Rondin (tronc couché) | forêt | 2,4 m long | Décor, indice de récolte passée. |
| `herbes` | Touffes d'herbe | champ (**recolorable**) | 0,4 m | Habille le sol nu. |
| `fougere` | Fougère | forêt | 0,8 m | Sous-bois, pied des grands arbres. |
| `champignons` | Champignons | forêt | petit | Détail de sous-bois. |
| `fleurs` | Fleurs sauvages | champ | 0,4 m | Touche de couleur (blanc/jaune/violet/rose). |
| `arbuste-sec` | Arbuste sec / broussaille | lande | 0,8 m | Brindilles sèches — désolation. |
| `ossements` | Ossements | lande | ~1 m | Crâne à cornes + cage thoracique + os épars. |
| `roseaux` | Roseaux | marais | 1,3 m | Tiges + massettes sur fond de vase. |

### 2.6 Feu (catégorie « Feu »)

| id | Modèle | Détails |
|---|---|---|
| `feu` | Feu de camp | Cercle de pierres, bûches en croix, **noyau émissif**, **lumière ponctuelle chaude**, **flammèches en particules**. Cœur du jeu — porté par [`world.ts`](../src/render/world.ts). |

### 2.7 Sites / setpieces (catégorie « Sites ») — **monde, M7→M11**

Repères/lieux du monde ouvert (terres sauvages). Le `site` correspond à l'id de génération
prévu ; la colonne « quand » au jalon. À disperser/poser par le système de monde (M7/M9), pas
par le village.

| id | Modèle | Site | Quand |
|---|---|---|---|
| `cave` | Entrée de grotte | cave | silhouette M7 → explorable M9 |
| `house` | Maison en ruine | house | M7 → M9 |
| `town` | Grappe de ruines | town | M7 → M9 |
| `city` | Grande ruine / tour | city | M9 |
| `mines` | Entrées de mine (3 teintes : fer/charbon/soufre) | ironmine / coalmine / sulphurmine | M7 → M9 |
| `swamp` | Marais (composite : eau + arbres morts + roseaux) | swamp | M7 |
| `ship` | Épave de vaisseau | ship | M9 / M11 |
| `executioner` | Cuirassé / grande épave blindée | executioner | M9 / M11 |
| `outpost` | Avant-poste (structure + drapeau + feu de signal) | outpost | M7 (recharge / voyage rapide) |
| `borehole` | Cratère / puits (trépied de forage) | borehole | M9 |
| `battlefield` | Champ de bataille (débris, armes, ossements) | battlefield | M9 |
| `cache` | Cachette (réserve camouflée + cairn) | cache | M9 |

> **Échelle.** Ces sites sont **bien plus grands** que les bâtiments du village (tour ~5 m,
> épaves 5–8 m). Au portage, ils relèvent de la **génération du monde** ([`generation-monde.md`](generation-monde.md)) :
> placement par anneaux de distance + RNG à graine, en setpieces, masqués au loin par le brouillard.
> `mines` est une **rangée de démo** (3 teintes) ; en jeu, paramétrer la teinte par type de minerai.

---

## 3. Bien les utiliser (placement, échelle, densité)

1. **Échelle d'abord.** Avant de poser quoi que ce soit, comparer au gabarit **1,8 m** (joueur). Une
   hutte ≈ 2× la hauteur du joueur (habitation où l'on tient debout) ; un sapin ≈ 2×. Un décor (fleur, champignon) reste **au ras du sol**.
2. **Orientation.** Tourner les modèles pour que l'**avant (+Z)** regarde l'espace utile : une hutte
   porte ouverte vers le feu/chemin ; un comptoir face au passage ; un piège, appât accessible.
3. **Ne pas encombrer le cœur du village.** Rayon ~5 autour du feu = zone d'action ; le décor lourd
   (gros rochers, arbres) va **au-delà**. Les bâtiments suivent les **anneaux concentriques** de
   [`buildings.ts`](../src/render/buildings.ts).
4. **Dispersion (scatter) du décor par biome** — densité indicative (par « tuile » de monde) :

   | Biome | À semer | Densité |
   |---|---|---|
   | **forêt** | sapin, chêne, bouleau, automne, petit-arbre · fougère, champignons, buisson, rondin, souche | arbres **denses**, sous-bois moyen |
   | **champ / prairie** | herbes (recolorées vert vif), fleurs, buisson, chêne isolé | herbes **denses**, fleurs en **touffes** éparses |
   | **lande** | arbre-mort, cyprès, arbuste-sec, **rochers S/M/L**, ossements | **clairsemé** (désolation) |
   | **marais** | roseaux (en bordure d'eau), herbes, arbre-mort | roseaux en **bouquets** sur les berges |

5. **Touffe d'herbe recolorable.** `herbes` est prévue pour être **recolorée** selon le biome (vert
   prairie → jaune lande → vert sombre sous-bois) : exposer un paramètre de teinte au portage.
6. **Variété, pas répétition.** Mélanger les essences/tailles et **varier l'échelle** (`scaling`) et la
   **rotation Y** par instance pour éviter l'effet « copier-coller » (c'est ce que fait déjà la forêt
   instanciée).

---

## 4. Porter un modèle du labo vers le jeu

Le labo et le jeu partagent les conventions → le portage est **mécanique**. Toujours dans l'ordre
**`data/` → `sim/` (+ tests si règle) → `render/`** (cf. [`architecture.md`](architecture.md)).

### 4.1 Correspondance labo → `src/render/`

| Labo | Fichier jeu |
|---|---|
| `constructrice` | [`stranger.ts`](../src/render/stranger.ts) |
| `villageois` | [`villagers.ts`](../src/render/villagers.ts) (`spawn`) |
| `joueur` | [`player.ts`](../src/render/player.ts) |
| `cabane` | [`cabin.ts`](../src/render/cabin.ts) (version réparée) |
| `hutte`, `charrette`, `loge`, `tannerie`, `fumoir`, `acierie`, `poste`, `atelier`, `armurerie` | [`buildings.ts`](../src/render/buildings.ts) (`makeBuilding`, `switch(id)`) — **versions retravaillées portées** : builders `buildHut`/`buildLodge`/`buildSmokehouse`/`buildSteelworks`/`buildTradingPost`/`buildWorkshop`/`buildArmoury`. La **hutte a 3 variantes** choisies par `hutVariantFor(x,z)` (déterministe → cohérent P2P). Toitures custom via `K.gableRoof`/`K.hipRoof` ([`lowpoly.ts`](../src/render/lowpoly.ts)). Fumée gérée côté jeu (`addSmoke`), pas par `smokePuffs`. |
| `piege`, `piege-pris` | [`buildings.ts`](../src/render/buildings.ts) (cas `trap`) |
| arbres (9 essences) | [`forest.ts`](../src/render/forest.ts) + positions/essences dans [`data/world.ts`](../data/world.ts) |
| décor (Nature) | **système de scatter** ([`generation-monde.md`](generation-monde.md)) |
| `feu` | [`world.ts`](../src/render/world.ts) (`createCampfire`) |

### 4.2 Matériau par pièce vs vertex colors (perf)

- Le **labo** utilise **un matériau par pièce** (simple à prototyper).
- Le **jeu** privilégie, pour les éléments **nombreux et instanciés** (arbres, décor), un **mesh de
  base fusionné** (`Mesh.MergeMeshes`) peint en **vertex colors** + `convertToFlatShadedMesh`, puis
  `createInstance` → **peu de draw calls** (voir `forest.ts`).
- **Règle de portage** : un personnage/bâtiment **unique ou rare** → garder les matériaux par pièce ;
  un élément **répété en masse** (arbres, herbes, rochers, fleurs) → **mesh de base instancié** (un par
  essence/variante).

### 4.3 Spécificités par catégorie

- **Personnages** : conserver le **« nez »** (repère de direction) et le **`yawNode`** (l'orientation
  est portée par un nœud indépendant de la physique, qui garde le corps droit — cf. `player.ts`).
  La constructrice doit rester **plus grande/distincte** des villageois.
- **Bâtiments** : placement **déterministe** par (type, n-ième exemplaire) → identique chez tous les
  pairs (`ringSlot` dans `buildings.ts`). Fumée → `setActivity` ; foyer/fenêtre → matériau émissif.
- **Pièges** : le deadfall a **2 états** (dalle relevée / dalle tombée + créature). À remplacer
  l'actuel `setTrapsReady` (qui montre/masque une sphère) par une **bascule entre deux sous-meshes**
  (armé ↔ pris).
- **Arbres** : prévoir **plusieurs meshes de base** (un par essence), tirer l'essence et l'échelle
  d'un slot via le **RNG à graine** (cohérence P2P). `petit-arbre` = le mesh existant à échelle
  réduite.
- **Décor** : **cosmétique local** → dispersion par biome pilotée par le RNG, instanciée, masquée par
  le brouillard au loin (cf. [`generation-monde.md`](generation-monde.md)). Pas de collision, pas
  d'impact déterminisme côté sim.

### 4.4 Checklist avant de committer un portage

- [ ] Le modèle est posé sur **`y = 0`**, rien ne **flotte** ni ne **traverse** (vérifier sous tous les angles).
- [ ] Couleurs **issues de `PALETTE`** ; aucune surface claire ne **bloome** anormalement.
- [ ] Avant (+Z) cohérent ; **nez** présent pour les personnages.
- [ ] Élément répété → **instancié** (mesh de base), pas N matériaux.
- [ ] Aléa visible des deux côtés du réseau → **RNG à graine** ; sinon `Math.random` admis.
- [ ] `npm run typecheck` + `npm run test` (sim) verts ; capture e2e à jour si rendu visible.

---

## 5. Ajouter / modifier un modèle au labo

Tout vit dans le `<script>` de [`lab/model-lab.html`](../lab/model-lab.html), dans le registre
`MODELS` :

```js
add({
  id:'mon-modele', name:'Mon modèle', cat:'Bâtiments',
  desc:"[biome] Une phrase sur le rôle dans le jeu.",
  // grid:false  // (optionnel) exclut de la vue d'ensemble (modèles larges/panoramas)
  build(K) {                       // K = kit de primitives flat-shaded ; P = palette
    const root = K.node();
    K.box(root, P.wood, [1,1,1], [0, 0.5, 0]);
    return root;                   // TransformNode posé sur le sol (y=0)
  },
  // current(K) {...}              // (optionnel) version ACTUELLE du jeu -> bouton « avant / après »
});
```

Bonnes pratiques de modélisation :
- Construire **autour de l'origine**, base à `y = 0`.
- Utiliser des **nœuds-charnières** (`K.node`) pour les éléments articulés (toit incliné, dalle de
  piège) afin de pivoter proprement.
- Pour un toit en pente, **adapter la hauteur des poteaux** au bord qu'ils soutiennent (cf. correctifs
  tannerie / poste de traite).
- Tester **sous plusieurs angles** + activer **« échelle 1,8 m »** pour juger les proportions.

---

*Doc générée pour accompagner le labo de modèles. Source de vérité visuelle : le labo lui-même
([`lab/model-lab.html`](../lab/model-lab.html)) ; source de vérité du contenu en jeu :
[`data/world.ts`](../data/world.ts).*
