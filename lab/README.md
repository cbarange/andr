# Labo de modèles 3D — `lab/model-lab.html`

Un **bac à sable standalone** pour prototyper et **revoir les modèles 3D** du jeu
(personnages, bâtiments, pièges, arbres, nature, feu) avant de les porter dans
`src/render/*`.

> Aucun package npm. Babylon.js est chargé depuis un CDN. Même esthétique que le
> jeu : low-poly, flat shading, palette crépusculaire (`PALETTE`).

> 📖 **Catalogue complet des modèles + guide d'utilisation (placement, biomes) et de portage** :
> [`docs/modeles-3d.md`](../docs/modeles-3d.md).

## Ouvrir

Deux options :

1. **Double-clic** sur `lab/model-lab.html` (ouvre en `file://`).
   → nécessite une connexion internet (CDN Babylon).
2. **Via le serveur de dev** (recommandé) : `npm run dev` puis
   <http://localhost:5173/lab/model-lab.html>.

## Utiliser

- **Liste à gauche** : choisir un modèle (groupé par catégorie).
- **Souris** : glisser = orbite, molette = zoom. `←` / `→` = modèle précédent/suivant.
- **Barre d'outils** :
  - `⟳ tourne` — table tournante (auto-rotation).
  - `avant / après` — quand dispo, compare la **proposition** avec la **version
    actuelle du jeu** (telle qu'elle est aujourd'hui dans `src/render`). Touche `C`.
  - `échelle 1,8 m` — affiche une silhouette humaine translucide de 1,8 m pour
    juger les proportions (un bâtiment, un arbre…).
  - `ombres`, `fil de fer`, `brouillard` — bascules d'aide visuelle.
  - `⊞ grille` — vue d'ensemble de tous les modèles disposés sur le sol.
  - `⤓ PNG` — exporte une capture.

## Ajouter / modifier un modèle

Tout est dans le `<script>` de `model-lab.html`. Un modèle est une entrée du
registre `MODELS` :

```js
add({
  id:'mon-modele', name:'Mon modèle', cat:'Bâtiments',
  desc:"Une phrase qui explique le rôle dans le jeu.",
  build(K) {                 // K = kit de primitives flat-shaded
    const root = K.node();
    K.box(root, P.wood, [1,1,1], [0, 0.5, 0]);   // (parent, couleur, [w,h,d], [x,y,z], opt)
    K.cyl(root, P.roof, { h:1, dt:0, db:2, t:4 }, [0, 1.5, 0]); // cône/cyl
    return root;             // TransformNode posé sur le sol (y=0)
  },
  // current(K) {...}        // optionnel : la version actuelle, pour « avant / après »
});
```

Le **kit `K`** (flat shading + matériau par pièce) : `box`, `cyl`, `cone`, `sph`,
`ico`, `tor`, `node`. Options communes : `{ rot:[x,y,z], scale:n|[x,y,z], emi:k,
alpha:a, unlit:true, smooth:true }`. Les couleurs vivent dans l'objet `P`
(la `PALETTE` du jeu, étendue).

## Porter un modèle validé dans le jeu

Le labo et le jeu partagent les conventions, donc le portage est direct :

| Labo (`model-lab.html`)        | Jeu (`src/render/…`)                         |
| ------------------------------ | -------------------------------------------- |
| `constructrice`                | `stranger.ts` (l'étrangère / constructrice)  |
| `villageois`                   | `villagers.ts` (méthode `spawn`)             |
| `joueur`                       | `player.ts`                                  |
| `cabane`                       | `cabin.ts` (version réparée)                 |
| `hutte`, `charrette`, `loge`…  | `buildings.ts` (`makeBuilding`)              |
| `piege`, `piege-pris`          | `buildings.ts` (case `trap`) + `setTrapsReady` |
| arbres (`sapin`, `chene`…)     | `forest.ts` + positions dans `data/world.ts` |
| `feu`                          | `world.ts` (`createCampfire`)                |

Différences à garder en tête lors du portage :
- Le jeu utilise des **vertex colors** + `convertToFlatShadedMesh` pour les arbres
  **instanciés** (`forest.ts`) ; le labo utilise un matériau par pièce (plus simple
  à prototyper). Pour la diversité d'arbres, prévoir **plusieurs meshes de base**
  instanciés (un par essence) et tirer l'essence d'un slot via le RNG à graine.
- Garder le **« nez »** repère de direction sur les personnages (présent dans le labo).
- Respecter le déterminisme : tout aléatoire de gameplay passe par `src/sim/rng.ts`
  (le cosmétique local — villageois, forêt — peut utiliser `Math.random`).
