# TODO (plus tard) — Bâtiments : fusionner + instancier

> **Statut : NON COMMENCÉ — gisement de perf pour plus tard.** Optimisation du rendu des **bâtiments
> du camp** (huttes, loges, pièges…), aujourd'hui reconstruits comme des arbres de dizaines de meshes
> indépendants. Correspond au point **#8 du [`drift.md`](drift.md)** (« Bâtiments/cabane n'utilisent
> PAS merge+instance → explosion de draw calls », effort estimé **M**). Complète l'analyse perf de
> [`perf-rendu.md`](perf-rendu.md) (qui couvre terrain/props/sites, déjà optimisés).
>
> **Pas urgent** : à faire quand le nombre de bâtiments posés devient un vrai coût (gros villages),
> ou en passe d'optimisation dédiée. **Règle d'or : MESURER avant/après** (cf. perf-rendu.md §0).

---

## 1. Le problème (état actuel)

Chaque bâtiment est construit comme un **arbre de dizaines de petits meshes indépendants**.
`buildHut` (`src/render/buildings.ts:90`) enchaîne ~25–35 appels `K.box`/`K.cyl` (fondation, murs,
poteaux, toit, porte, fenêtres, cheminée, bûches…), et **chaque appel crée un `Mesh` séparé** (le Kit
fait `MeshBuilder.CreateBox`/`CreateCylinder` à chaque fois, cf. `src/render/lowpoly.ts`). Idem
`buildLodge`, `buildTrap`, etc.

Or **1 mesh ≈ 1 « draw call »** = une commande que le CPU prépare et envoie au GPU **à chaque frame**.
Le coût n'est pas dans le nombre de triangles (minuscules) mais dans le **nombre de commandes**.

> Une hutte ≈ ~30 draw calls. Un village (≈8 huttes + loges + pièges) = **plusieurs centaines de
> draw calls**, et les bâtiments **identiques sont reconstruits intégralement** au lieu d'être réutilisés
> (`drift.md:175-176`). C'est le **plus gros gisement de draw calls** restant.

**À noter** : le moteur fait **déjà** de l'instancing pour les **arbres, le décor et les sites**
(`render/scatter.ts`, `trees.ts`, `sites.ts` via `createInstance` — cf. `perf-rendu.md:108`). Les
bâtiments sont **les seuls** à ne pas en profiter. La technique est donc déjà maîtrisée dans la base.

---

## 2. Les deux techniques (complémentaires)

### 2.1 Fusionner (merge) — `Mesh.MergeMeshes()`
Souder les ~30 morceaux d'**un même** bâtiment en **un seul mesh** (en pratique : **un mesh par
matériau**). Résultat : 1 hutte = **1–3 draw calls** au lieu de ~30.
- **Contrainte** : on perd la capacité de bouger/animer les sous-pièces indépendamment → **OK pour un
  bâtiment statique**, pas pour une partie animée.
- API : `Mesh.MergeMeshes(meshes, disposeSource, allow32BitsIndices, meshSubclass, subdivideWithSubMeshes, multiMultiMaterials)`.
  - Le plus simple/perf : **grouper les meshes par matériau** et faire un merge par groupe (≥1 draw
    call par matériau). Notre Kit met déjà les matériaux **en cache par couleur** (`lowpoly.ts:111`),
    donc les morceaux d'une hutte partagent peu de matériaux distincts (bois clair/foncé, pierre,
    métal…) → **poignée de groupes**.

### 2.2 Instancier (instance) — `master.createInstance()` / thin instances
Quand la **même** géométrie apparaît **N fois** (N huttes identiques), envoyer la géométrie au GPU
**une seule fois**, puis dessiner les N copies en **un appel groupé**, chacune avec sa **matrice**
(position/rotation/échelle).
- **Contrainte** : toutes les instances **partagent la même géométrie ET le même matériau** ; on ne
  varie que la **transformation** (et, en *thin instances*, optionnellement une **couleur par instance**).
- API : `master.createInstance("...")` (instances régulières, frustum-cullées individuellement) ou
  `master.thinInstanceAdd(matrix)` (encore plus léger, idéal pour beaucoup de copies fixes).

### 2.3 Le combo
```
1. Construire UN prototype par type+variante (ex. hutte ronde) → MERGE ses parts en 1 mesh/matériau.
2. Le cacher (master), puis createInstance() / thinInstanceAdd() pour CHAQUE bâtiment posé.
```
Coût pour N huttes : **1 upload de géométrie + ~1 draw call groupé/matériau**, au lieu de
**N × 30 meshes / N × 30 draw calls**. Gain spectaculaire dès qu'un type est répété.

---

## 3. Application à NOTRE code

| Élément | Traitement |
|---|---|
| **Types répétés** (`hut`, `lodge`, `trap`…) | candidats parfaits : prototype mergé **par type + variante** (cf. `hutVariantFor` rond/carré → 1 prototype/variante), puis instances. |
| **Variantes** | une variante = un master mergé distinct. Garder le **choix déterministe** existant (`hutVariantFor(x,z)`) pour rester cohérent entre pairs P2P. |
| **Collisions** | **restent à part** : boîtes physiques Havok (`addCollider`, `buildings.ts:~569`). Elles ne se mergent pas — on les pose comme aujourd'hui (1 collider/bâtiment), indépendamment du visuel instancié. |
| **Parties émissives / animées** | fenêtres qui luisent (`emi`, `unlit`), fumée, etc. : **exclure du merge** si elles varient/s'animent, ou les accepter figées dans le merge si elles sont statiques. |
| **Orientation** | la rotation par ancre (`faceYaw`, `buildings.ts:40`) passe dans la **matrice d'instance** — pas besoin de géométrie distincte. |
| **La cabane (`cabin.ts`)** | cas **à part** : exemplaire **unique** (pas de répétition) → l'**instancing n'apporte rien**, mais un **merge par palier** réduirait ses draw calls. ⚠️ **Attention** : le **fondu du toit** (Étape 1b) repose sur `mesh.visibility` **par-mesh** du nœud toit — si on merge, garder le **toit comme groupe mergé séparé** pour pouvoir continuer à le fondre. Le coffre/tableau (DynamicTextures) et les fittings dynamiques restent hors merge. |

---

## 4. Pièges / contraintes

- **Le merge fige la géométrie** : toute pièce qui doit bouger/s'animer/apparaître séparément doit
  être **hors du mesh mergé** (cf. toit de la cabane, fenêtres animées).
- **Instances = même matériau** : si deux bâtiments « identiques » diffèrent par une teinte, soit en
  faire deux masters, soit utiliser des **thin instances avec couleur par instance**.
- **Frustum culling** : les instances régulières sont cullées une par une (bien) ; les thin instances
  sont cullées en bloc (à surveiller si le camp est étalé). Pour le camp (compact), peu d'impact.
- **Dispose/teardown** : à la régénération (`/seed`) il faut **disposer masters + instances** (le
  `drift.md:182-185` note déjà l'absence de teardown des colliders de bâtiments — à traiter ensemble).
- **Le Kit construit en `convertToFlatShadedMesh()`** : vérifier que le merge **préserve le flat
  shading** (sinon refaire `convertToFlatShadedMesh()` sur le mesh mergé, ou merger des géométries
  déjà flat).

---

## 5. Plan d'implémentation suggéré (par incréments, MESURER à chaque pas)

1. **Mesurer la baseline** : afficher `scene.getActiveMeshes().length` + draw calls (instrumentation
   `scene.debugLayer` / overlay) **avec un village peuplé**. Noter le chiffre.
2. **Pilote sur UN type** (les **huttes**, les plus nombreuses) :
   - extraire `buildHut` en **prototype** (construire sur un root temporaire), **merger par matériau**,
     cacher le master ;
   - remplacer chaque pose par `createInstance()` (+ matrice d'orientation `faceYaw`) ;
   - garder les colliders inchangés.
3. **Re-mesurer** : draw calls avant/après sur le même village. Valider le gain réel.
4. **Étendre** aux autres types répétés (`lodge`, `trap`, …) si le gain est confirmé.
5. **(Optionnel) Cabane** : merge par palier **en gardant le toit comme groupe séparé** (préserver le
   fondu Étape 1b).
6. **Teardown** : disposer masters + instances + colliders à la régénération (mutualiser avec #8/teardown).
7. **Vérifs** : `typecheck` + `test` (sim inchangée) + `e2e` (la boucle camp doit rester verte) +
   capture visuelle (les bâtiments doivent être **identiques à l'œil**).

---

## 6. Références
- Babylon — *Instances* : https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/instances
- Babylon — *Thin instances* : https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/thinInstances
- Babylon — *Merging meshes* : https://doc.babylonjs.com/features/featuresDeepDive/mesh/mergeMeshes
- Interne : [`perf-rendu.md`](perf-rendu.md) (terrain/props/sites déjà optimisés), [`drift.md`](drift.md) §3.3 & #8.
