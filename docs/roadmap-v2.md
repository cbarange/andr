# A Dark Room 3D — Roadmap v2 (corrigée, post-audit)

> **Statut** : ce document **remplace la Partie 3 (jalons)** de [`roadmap.md`](roadmap.md).
> Les **Partie 1** (analyse d'A Dark Room) et **Partie 2** (principes de portage 3D) de `roadmap.md`
> restent **valides et de référence** — on ne les duplique pas ici.
>
> **Méthode** : établi par audit croisé (1) du **jeu original** (code source `doublespeakgames/adarkroom`
> + wiki), (2) du **code réel** d'`andr` (sim + rendu + réseau, lu ligne à ligne), (3) de la **doc existante**
> ([`etat.md`](etat.md), [`drift.md`](drift.md), [`build-craft-plan.md`](build-craft-plan.md),
> [`plan-audio.md`](plan-audio.md), [`generation-monde.md`](generation-monde.md)). But : dire **la vérité
> sur l'état**, **corriger ce qui dérive**, et **séquencer ce qui manque**.
>
> Principe d'ordre inchangé : **`data/` → `sim/` (+ tests) → `render/`/`ui/` → `net/`**, chaque jalon
> jouable et testé (vitest + e2e Playwright + capture).

---

## 0. Tableau de bord (juin 2026)

| Bloc | État |
|---|---|
| **M0–M5** (Acte I : feu→village→métiers→événements) | ✅ |
| **M9** sites/donjons/mines | 🟢 cœur fait (grotte+mines explorables, avant-poste, **chaîne acier→balles ressuscitée**) |
| **Chantier C** (refonte monde & campement : A·B·C·D·E·F) | ✅ **TERMINÉ** |
| **Routes & sites** : R1 variété (~57 sites) · R2 routes · R3a forages/champs de bataille · **R3b villes/cités scriptées** | ✅ ✅ ✅ ✅ · R4 ⏳ |
| **Chantier A** : A3 (P2P failover) · A4 (migration save) | ✅ ✅ · A2 ⏸️(dev) · A5 ⏸️ · A6 ⏳ |
| **Chantier D** : juice 🟡 · confort FOV/sensibilité ✅ | reste rebind, jour/nuit, AO, reverb… |
| **M6 seuil · M7 survie** : rempart/porte/puits · eau/vivres/PV par joueur (drain dehors, mort = perte du sac, recharge camp) · **ravitaillement aux avant-postes** (usage unique) | ✅ · ✅ (fog of war ⏸️ différé ; équilibrage = M12) |
| **M8 combat temps réel** : rencontres tiérées (FIGHT_CHANCE ADR), armes à cooldown, EAT_MEAT/FLEE, mort unifiée, créatures 3D, fabrication diégétique (torche/lance d'os) | ✅ cœur (reste : armes/armures M10, ennemi des pairs distants) |
| **M10 atelier · poste de traite · perks** : 12 objets ADR exacts (eau/portage/armures/armes), troc TradeGoods, outfitting (WITHDRAW), Maître/homme malade, USE_MEDS | ✅ (reste : bolas, boussole — différés) |
| **M8.5 fidélité combat & lieux** ([`analyse-combat-adr.md`](analyse-combat-adr.md)) | ✅ **F1-F4 + R3b FAITS** (par pas · tables/biomes · mines/grottes/villes/cités SCRIPTÉES · maisons/marais · armes lourdes · soin en voyage · mort 120 s · avant-postes/expédition · désengagement) — reste écran de butin, F5 (perks d'usage) |
| **Contenu manquant** : fin de partie (M11) | ❌ |

> Vérif à chaque pas : **typecheck · ~234 tests unit · 15 e2e**. Détails par bloc ci-dessous + docs liées
> ([`routes-sites.md`](routes-sites.md), [`refonte-monde-campement.md`](refonte-monde-campement.md),
> [`bonnes-pratiques-jeu.md`](bonnes-pratiques-jeu.md), [`mines-grottes-implementation.md`](mines-grottes-implementation.md)).

---

## 1. État réel vérifié — la doc dit-elle vrai ?

**Globalement oui, à deux nuances près** (corrigées ci-dessous). Le cœur `sim/` est sain et fidèle à ADR ;
le rendu est de **qualité production**, très au-delà d'un POC. Mais deux écarts faussent la lecture de
l'avancement :

> ⚠️ **Écart de doc n°1 — le monde n'est PAS « pas encore là ».** [`etat.md`](etat.md) (lignes 119, 128)
> écrit « Mines/monde/combat/fin : pas encore là (M7–M11) ». **Faux pour le rendu** : tout le stack monde
> existe et tourne — `sim/worldgen.ts` (biomes par viscosité ADR + sites en anneaux, **pur & déterministe**),
> `render/terrain.ts` (streaming par chunks + LOD + colliders Havok localisés), `render/sites.ts` (les 9 types
> de sites **dessinés**, y compris l'épave et le cuirassé). C'est [`drift.md`](drift.md) §1 qui est exact :
> **M7 a été construit en avance, mais seulement sa moitié « rendu »**. On a un monde superbe et traversable
> **où il ne se passe rien dehors** (aucune logique de survie/combat/site dans la sim).

> ✅ **Écart de doc n°2 — les 2 bugs P2P sont CORRIGÉS.** `drift.md` §0 listait `cabinTier` et
> `builderTendingUntil` hors snapshot. **Résolu** : le snapshot est désormais un **sérialiseur unique**
> (`snapshot() = structuredClone(state)`, `adoptSnapshot()` = remplacement intégral). Tout l'état autoritaire
> circule (échéances + `rng` compris → plus de rafale à la migration d'hôte). `architecture.md` §6 et
> `drift.md` §0/§5 sont à jour ; seul le **TL;DR de `drift.md`** reste utile pour les points **non** faits (#4 outils
> dev en prod, #7 god-object, #8 bâtiments draw calls, #9 allocs/frame).

### 1.1 Classement par état (la grille de lecture)

| Légende | Sens |
|---|---|
| ✅ **FAIT & JOUABLE** | implémenté, testé, jouable de bout en bout |
| 🟡 **INERTE** | rendu/généré, mais **aucune logique sim** ne s'en sert (semble fait, ne l'est pas) |
| 🔴 **MORT** | déclaré dans les données mais **inatteignable** en jeu normal (aucun producteur) |
| ❌ **ABSENT** | n'existe pas |

**✅ FAIT & JOUABLE — l'Acte I d'ADR (la chambre + le village) :**
- Feu (0–4) / température / l'étrangère (constructrice) — machines à états en tics, déterministes.
- Cabane ruine → réparée → paliers de stockage `cabinTier` 1/5/10 (`UPGRADE_CABIN`).
- Récolte de bois (arbres finis qui repoussent), **sac** (par joueur, plafonné) vs **entrepôt** (partagé).
- Pièges (relève un-par-un, cooldown par piège, appât = prise bonus), table de butin `trapDrops`.
- Population + huttes (cap = `huttes × 4`), arrivée via RNG à graine.
- **Économie de métiers** (income 10 s, tout-ou-rien) : bûcheron, chasseur, piégeur, tanneur, charcutier
  — chaînes **bois / fourrure→cuir / viande→viande séchée** complètes et nettes-positives.
- **9 événements** scène-machine (nomade, mendiant, marchands, bruits, pièges saccagés, incendie, attaque
  de bêtes) + ordonnanceur cadence ADR 3–6 min + `RESOLVE_EVENT_CHOICE` + effets différés.
- Déterminisme RNG, **save auto** (localStorage), **P2P hôte-autoritaire** (Trystero/WebRTC, élection
  d'hôte testée, anti-triche `isNetworkSafeAction`).
- **Rendu** : terrain streaming + LOD, camp/bâtiments/personnages/sites low-poly instanciés, perf adaptative
  (`autoperf`), audio spatialisé/adaptatif **A1–A6**, UI diégétique (E + dialogues), outillage dev (console,
  ~25 commandes, éditeur de spawn F2).
- ~110 tests sim + 10–11 e2e.

**🟡 INERTE — le monde entier (l'Acte II « rendu » sans gameplay) :**
- Carte 129×129, biomes (camp/forêt/champ/friche), **9 types de sites** placés en anneaux et **dessinés**
  (grotte, maison, ville, 3 mines, marais, épave, cuirassé). Walkable. **Mais** `sim/` ne lit jamais `map.sites` :
  aucune entrée de site, aucun « nettoyer la mine », aucun butin, aucune pression de survie hors camp.
  **Sortir du camp ne coûte rien.**

**🔴 MORT — la chaîne industrielle & 2 bâtiments :**
- `iron, coal, sulphur, steel, bullets` : **aucun producteur** (les mines sont inertes). Donc :
  - métiers **sidérurgiste** & **armurier** → chômage permanent (intrants jamais dispo) ;
  - bâtiments **aciérie** & **armurerie** → inconstructibles sans DEBUG (coûtent fer/charbon/acier/soufre) ;
  - palier de cabane **×10** → inatteignable (coûte 80 fer).
- `charm` (charme) : seul drop possible de piège (0,5 %), **jamais consommé** par rien.
- **poste de traite** & **atelier** : bâtissables mais **sans effet sim** (« débloque le commerce / l'artisanat
  avancé » = description seule ; aucune mécanique ne s'y branche).

**❌ ABSENT — les Actes II & III (cœur du jeu manquant) :**
- Survie : pas de `water`/`food`/`health` dans `GameState`, pas d'expédition, pas d'avant-poste, pas de mort.
- **Combat** : 0 — aucun ennemi/PV/arme/butin (seul `killVillagers` narratif dans les événements).
- **Sites/donjons/setpieces** : 0 machine, 0 entrée, 0 déblocage de mine.
- **Commerce** (poste de traite) : 0 (seul le troc du **nomade** existe, en événement).
- **Objets/artisanat** : torche, outres, sacs (rucksack/wagon/convoy), armures, armes — **0**.
- **Perks** & événements qui en dépendent : Éclaireur, Maître, Homme malade, Maladie/Peste, Raid militaire.
- **Fin de partie** : épave → alliage → réparation du vaisseau → décollage → esquive d'astéroïdes → fin.
  **Aucune condition de victoire.** `alien alloy` / `energy cell` **ont désormais une SOURCE** (R3a :
  fouille des forages/champs de bataille) ; restent les sources cité/épave + l'usage (vaisseau) → M11.
- **Prestige** (cache, report de partie).

> **Verdict** : `andr` est une **excellente fondation** — l'Acte I jouable, déterministe, P2P, et toute
> l'infra de rendu d'un grand monde — mais **≈ le premier tiers** des systèmes d'ADR. Le reste est soit
> inerte (le monde), soit mort (la chaîne industrielle), soit absent (survie/combat/sites/commerce/fin).

---

## 2. Matrice de couverture vs A Dark Room

| Système ADR | État `andr` | Cible |
|---|---|---|
| Feu / température / l'étranger | ✅ FAIT | — |
| Bois, sac/entrepôt, dépôt | ✅ FAIT | — |
| Pièges + appât + butin | ✅ FAIT | — |
| Population + huttes | ✅ FAIT | — |
| Métiers bois/fourrure→cuir/viande→séchée | ✅ FAIT | — |
| Construction (10 bâtiments, coûts croissants, révélation ADR) | ✅ FAIT (+ **temporisée & animée** : file de chantiers, montée pièce par pièce, fonctionnel à l'achèvement) | — |
| Événements (room/outside, choix→conséquences) | ✅ 9/~15 | M5 fait ; reste → M10 |
| Carte / biomes / sites (génération + rendu) | 🟡 INERTE | M7/M9 (logique) |
| Survie eau / nourriture / mort | ✅ **FAIT** (M6+M7 : drain dehors, mort = perte du sac, recharge camp) | équilibrage M12 |
| Combat (ennemis, armes, PV, butin, soin) | ✅ **FAIT** (M8 : temps réel, tables ADR exactes, soin = manger) | armes/armures = M10 |
| Mines fer/charbon/soufre (sécuriser ⇒ mineur) | ✅ **FAIT** (M9) | — |
| Sidérurgie acier→balles | ✅ **ressuscité** (M9) | équilibrage M12 |
| Sites/donjons : **grotte + 3 mines** explorables | ✅ **FAIT** (M9) | — |
| Sites/donjons : **maison / ville / cité** | 🟡 INERTE (silhouettes) | M9 (reste) |
| Avant-poste (grotte vidée ⇒ avant-poste, ravitaillement usage unique) | ✅ **FAIT** (M9 rendu + M7 `USE_OUTPOST`) | — |
| Atelier → objets (torche/outres/sacs/armures/armes) | ✅ **FAIT** (M10, recettes ADR exactes) | — |
| Poste de traite → commerce (fourrure = monnaie) | ✅ **FAIT** (M10, TradeGoods exact) | — |
| Perks (précis/barbare/insaisissable via le Maître) + homme malade | ✅ **FAIT** (M10) | éclaireur/voleur… = M12 |
| Boussole (débloque la carte dans ADR) | ❌ ABSENT | **M10** (rôle à redéfinir, monde unifié) |
| Cité, borehole, champ de bataille, cache, avant-poste (types de sites) | ❌ ABSENT (worldgen) | **M9/M11** (étendre `sites[]`) |
| Alliage extraterrestre | ✅ **source ACTIVE** (R3a : forages ; appoint champs de bataille) | sources cité/épave + usage = **M11** |
| Vaisseau (coque/propulseurs) + décollage + espace + fin | ❌ ABSENT | **M11** |
| Prestige / cache | ❌ ABSENT | **M11** |
| Audio combat/sites/fin (A7) | ❌ (assets présents) | par jalon M8/M9/M11 |

---

## 3. Deux chantiers en parallèle

Le projet a deux dettes distinctes : du **gameplay manquant** (Chantier B) et de la **qualité/correctness à
rattraper** (Chantier A). Les faire en parallèle évite de bâtir l'Acte II sur des fondations qui dérivent.

---

## 🧹 Chantier A — Assainissement (corriger ce qui n'est pas bien fait)

> Issu de [`drift.md`](drift.md). Rien ici n'est bloquant pour jouer **en solo**, mais A1–A2 touchent la
> **sécurité/triche** et A3 la **coop**, à régler **avant** d'ouvrir le multi à des inconnus. A5–A6 sont de
> la **scalabilité** pour quand le monde se peuplera (M7+).

### A1 — Resynchroniser la doc — **XS** — *à faire en premier*
- `etat.md` : corriger « monde pas encore là » → « monde **rendu** (M7-render fait), **gameplay** survie/combat/
  sites à faire ». Refléter le palier de cabane, la console/éditeur dev, les sites dessinés.
- `roadmap.md` : marquer la Partie 3 comme **remplacée par ce document** (`roadmap-v2.md`).
- Mettre `drift.md` à jour (P2P #1/#2/#6 = ✅ ; ne garder ouverts que #4/#7/#8/#9).

### A2 — Sortir l'outillage dev du bundle de prod — **S** — ⏸️ **DIFFÉRÉ (choix porteur)**
> **Décision (juin 2026)** : **on garde les cheats pour l'instant** — phase de **dev mode**, les commandes
> (`/unlock`,`/give`,`/build`,`/seed`,`/noclip`,`/event`…) et les hooks `window.__game.*` mutateurs sont
> **nécessaires pour tester**. À **reprendre au moment du build de prod / de l'ouverture du multi à des
> inconnus** (sinon n'importe qui peut tricher/griefer l'état autoritaire).
- Rappel du constat : `dev/commands.ts` **ship en prod** (vérifié sur `dist`) ; les hooks **mutateurs**
  `window.__game.*` sont assignés **hors** garde DEV.
- **Fix (quand on le fera)** : `await import()` des 3 modules `dev/*` **dans** le bloc
  `if (import.meta.env.DEV)` ; ne garder en prod que les hooks `__game` **en lecture** (Playwright).
- *Note* : le risque **réseau** est déjà couvert — `isNetworkSafeAction` refuse les `DEBUG_*` venant d'un pair.
  Le risque restant est **local** (cheat depuis sa propre console) + le **poids de bundle**.

### A3 — Robustesse P2P (au-delà des 2 bugs déjà corrigés) — **M** — ✅ **FAIT**
> **Livré (juin 2026)** :
> - **Heartbeat + failover par époque (Raft-lite)** : `StateSyncMsg.host` porte une **`epoch`** (terme
>   d'autorité). Décisions **pures & testées** dans [`net/host.ts`](../src/net/host.ts) : `resolveSync`
>   (l'époque la plus haute gagne, sinon règle historique) + `shouldTakeOver` (après `HOST_TIMEOUT_MS` = 6 s
>   de silence, le **plus petit pair vivant** — hôte muet exclu — reprend l'autorité). `room.ts` suit le
>   dernier heartbeat (`performance.now()`) et expose `checkLiveness(now)` ; `main.ts` l'appelle chaque frame
>   côté client et **rediffuse** en reprenant la main. → un **hôte en arrière-plan ne fige plus** les autres ;
>   l'ancien hôte revenu (époque plus basse) est **ignoré** (pas de flip-flop).
> - **ICE/STUN + emplacement TURN** : `joinRoom` reçoit un `rtcConfig` avec **STUN publics** (meilleure
>   traversée de NAT, gratuit) et un **slot TURN** prêt à renseigner.
> - **Tests** : `host.test.ts` +3 describes (resolveSync, shouldTakeOver) ; typecheck + 138 unit + 11 e2e verts.
>
> **Reste (hors code, infra)** : fournir un **vrai serveur TURN** (coturn auto-hébergé ou service payant)
> pour les NAT symétriques — le câblage est là, il manque les identifiants. Le failover *runtime* P2P n'est
> vérifié qu'au niveau **logique pure** (les tests) + **init de salon** (e2e) ; le scénario de bascule réelle
> reste à valider **à la main** (WebRTC peu fiable en headless, cf. `etat.md`).

### A4 — Migration de sauvegarde — **S** — ✅ **FAIT**
> **Livré (juin 2026)** : [`save.ts`](../src/save.ts) — `loadGame` ne **jette plus** une save d'ancienne
> version : elle passe par `migrateSave(state, fromVersion)` (PURE, testée) qui accepte tout `version ≤
> VERSION` (back-fill additif au boot) et refuse seulement une save **plus récente** que le code. Squelette
> de chaîne de migration prêt pour les **changements cassants** (M7+). `saveGame` **ne sérialise plus
> `carried`** (blob allégé). Tests : `save.test.ts` (3). *Détail de la politique ci-dessous.*

**De quoi il s'agit.** La sauvegarde ([`save.ts`](../src/save.ts)) écrit dans `localStorage` un objet
`{ version: 2, state }` (le `GameState` complet sérialisé). Au chargement, `loadGame()` fait :
```ts
if (data.version !== VERSION) return null;   // <-- version différente => on jette TOUTE la save
```
Donc **dès qu'on incrémente `VERSION`** (ce qu'on fait « par sécurité » quand on ajoute un champ d'état),
**la partie sauvegardée du joueur est supprimée** : il repart de zéro (chambre noire, feu éteint).

**Ce qu'est une « migration ».** Au lieu de **jeter** une save d'ancien format, on la **transforme** vers le
nouveau (remplir les nouveaux champs avec des défauts, renommer/restructurer ce qui a changé), puis on la
charge normalement. Ex. quand M6/M7 ajouteront `water`/`food`/`health` : une save v2 ne les a pas → la
migration les pose à leurs valeurs initiales (`water = BASE_WATER`, etc.) et passe la save en v3 — **le
joueur garde son village.**

**Nuance importante (déjà à moitié en place).** Au boot, `main.ts` fait déjà un *back-fill* par spread :
`{ ...createInitialState(), ...saved, carried: {} }` → tout **nouveau champ de premier niveau** absent de la
save est **rempli par le défaut** de `createInitialState`. **Conséquence** : pour un ajout **purement additif**
(un nouveau compteur/échéance au premier niveau), **il n'est PAS nécessaire de bumper `VERSION`** — le spread
suffit. Le vrai besoin de migration ne concerne que les **changements cassants** (restructurer un objet,
renommer une clé, changer une unité). La recommandation tient en deux règles :
1. **Ajout additif** → **ne pas** bumper `VERSION` (laisser le spread back-filler) ;
2. **Changement cassant** → écrire une **chaîne de migration** `migrate(version, state)` (`v2→v3→v4…`) que
   `loadGame` applique au lieu de renvoyer `null`.

**Pourquoi ça compte.** **M6 → M11 ajoutent tous des champs d'état** (survie, équipement, sites visités,
vaisseau, prestige). Sans cette discipline, **chaque mise à jour effacera la progression des joueurs**. Côté
**dev** c'est aujourd'hui peu gênant (`DEBUG_UNLOCK_ALL` reconstruit une partie en 1 commande), mais ça devient
**critique dès qu'il y a de vrais joueurs** avec des parties longues (jeu incrémental = parties qui durent).
- **Bonus** : ne pas sérialiser `carried` (re-vidé au load de toute façon, `selfId` change à chaque session)
  → blob de save allégé.

**Effort : S.** **Sévérité : basse aujourd'hui (solo/dev), montante à l'ouverture publique + à chaque champ
ajouté en M6+.**

### A5 — Perf : bâtiments en merge+instance & allocations par frame — **M** — ⏸️ **DIFFÉRÉ (analyse de risque)**
> **Décision (juin 2026)** : **on attend.** Crainte légitime : un merge naïf **casserait** le nouveau système
> d'**animation de construction** (« chantier » qui monte pièce par pièce). L'analyse ci-dessous **confirme la
> crainte pour l'approche naïve** mais dégage un **chemin échelonné à risque quasi nul** pour quand on s'y mettra.

**Comment ça marche aujourd'hui (pourquoi le merge est délicat) :**
- Un bâtiment = un `root` (`TransformNode`) portant **des dizaines de meshes primitifs** (`box/cyl/cone/…`),
  chacun avec un matériau **mis en cache par couleur** (`makeKit`, [`lowpoly.ts`](../src/render/lowpoly.ts)).
  Les matériaux sont **partagés**, mais **chaque mesh = un draw call** (pas de merge, pas d'instance). Couleur
  **par matériau** (pas de vertex colors) + `convertToFlatShadedMesh()` **par mesh**.
- **L'animation de chantier** ([`buildings.ts`](../src/render/buildings.ts) `makeChantier`/`applyReveal`)
  collecte **chaque mesh enfant**, lui donne un seuil = sa **hauteur normalisée**, puis fait **pousser chaque
  pièce individuellement** (`setEnabled` + `scaling` avec un `easePop`) du **bas vers le haut**. → l'effet
  **repose entièrement sur des meshes individuels transformables un par un**.
- États dynamiques **par bâtiment** : la **fumée** (`addSmoke` → nœud séparé animé + `setEnabled`) et les
  **pièges** (deux sous-arbres `armed`/`sprung` basculés par `setTrapsReady`).

**Effets de bord d'un merge/instance NAÏF (= la crainte, justifiée) :**
| Risque | Cause | Gravité |
|---|---|---|
| 🔴 **Animation de chantier cassée** | un mesh mergé ne peut plus scaler/activer ses pièces une à une | bloquant |
| 🔴 **Fumée figée** | si la cheminée est mergée dans la coque, plus d'anim ni de toggle par cycle | haute |
| 🔴 **Pièges sans états** | un piège mergé ne peut plus basculer armé ↔ pris | haute |
| 🟠 **Couleurs perdues** | merge multi-couleurs sans vertex colors → soit multi-matériaux, soit teinte unique | moyenne |
| 🟢 **Colliders** | indépendants (`addCollider`, cylindre physique séparé) → **non touchés** | nul |
| 🟢 **Déterminisme / P2P** | `buildings.ts` est **100 % présentation locale** → **aucun** impact sim/réseau | nul |

**Le chemin sûr (échelonné, à faire quand on s'y mettra) :**
1. **Ne JAMAIS merger le chantier en cours.** Il n'y en a **qu'un à la fois** (`constructing[0]`) et il est
   déjà construit à part (`makeChantier`). On le laisse en meshes individuels → **l'animation reste intacte.**
2. **Merger uniquement les bâtiments ACHEVÉS** (étape 1 de `sync`, là où `makeBuilding` pose le vrai
   bâtiment). On merge la **coque statique** en **excluant le nœud de fumée** (gardé séparé, animable) ;
   merge **multi-matériaux** (`MergeMeshes(..., multiMulti=true)`) → **1 mesh / quelques sous-meshes** au lieu
   de dizaines, `freezeWorldMatrix`. **C'est ~90 % du gain draw-call, sans toucher l'animation.**
3. **Pièges : laisser non mergés** (max 10, peu coûteux) **ou** merger `armed` et `sprung` en **deux** meshes
   basculés par `setEnabled` (le socle commun reste à part). Décision au moment de l'implémentation.
4. **(Plus tard, gros lot, optionnel)** Instancier les bâtiments **identiques** (huts par variante, pièges) et
   **unifier le kit en vertex colors** (1 seul matériau → vrai 1 draw call + instances). Touche
   `stranger/villagers/player` → **risque plus élevé, à isoler** (cf. `drift.md` §3.3 « deux kits parallèles »).

> **Conclusion pour la décision** : **l'animation n'est PAS un bloqueur** — elle ne vit que sur le **chantier
> unique non mergé** ; tous les **bâtiments finis** peuvent être mergés sans la toucher. On peut donc **attendre
> sereinement** et, le jour venu, faire **étapes 1–3** (sûres, gain principal) en gardant l'étape 4 (instancing +
> vertex colors) **optionnelle et isolée**. Pas urgent tant que le village reste petit ; le devient quand la pop
> grossit (M7+).

**Allocs/frame (indépendant du merge, plus sûr à faire d'abord)** : `Vector3` scratch joueur (`player.ts`),
buffers réutilisés terrain/obstacles, cadencer `reflectState` (dirty-flag au lieu de chaque frame), supprimer le
**`JSON.stringify(resources)` par frame** quand un panneau d'événement est ouvert (`main.ts`).

### A6 — Refactor `main.ts` (god-object ~1100–1360 l.) — **M** — 🟡 dette
- Extraire `net/sync.ts` (snapshot/adopt/emit/join), `ui/dialogues.ts` (builders de dialogue), `interactions.ts`
  (`computeFocus` + verbes), et sortir `reflectState`/boucle. Casser le `case "TICK"` monolithique (~190 l.)
  en helpers purs (comme `applyEffect`). Dédupliquer « bûcheron = le reste » (3×) et les helpers de rendu.
- *Conseillé avant* d'empiler la survie/combat dans le même fichier.

---

## 🎮 Chantier B — Contenu (ajouter ce qui manque)

> Le grand principe de portage reste **le monde 3D unifié** (décision actée, `roadmap.md` §2.4) : pas d'écran
> « village » vs « carte ». Le campement est un **retranchement central** ; on explore en **franchissant la
> porte**. La survie devient une **pression spatiale/temporelle** (l'eau/la nourriture se vident **dehors**),
> et les avant-postes d'ADR deviennent des **bases avancées**.

### 🚪 M6 — Le seuil : rempart, porte, zone sûre & équipement — **S/M** — ✅ **FAIT (juin 2026)**
> **Livré** : `render/rampart.ts` — palissade **fusionnée en 1 mesh** autour de la zone sûre, **porte au
> sud** (+Z ; seuls les montants ont un collider — monde unifié, on ne piège pas le joueur), **puits** de
> ravitaillement ; indicateur HUD « zone sûre / dehors » + jauges ; `config.survival` (capacités/cadences =
> l'« outfit » de base ; outre/baril = M10). La frontière LOGIQUE reste le rayon `VILLAGE_RADIUS` ; la
> recharge au camp est AUTOMATIQUE (cf. M7) → l'acceptation (franchir ⇒ dehors ; revenir ⇒ gel/recharge)
> est couverte. Top-up manuel à la station = bonus optionnel.

**Pré-requis sauté par le projet** (le monde M7-render existe déjà, mais la frontière dont dépend la survie
manque). Objectif : matérialiser le retranchement et le franchissement, et poser l'**état d'équipement**.

- **`data/`** : `BASE_WATER`, capacités d'outres ; `DEFAULT_BAG_SPACE` ; coûts d'outfit (eau + viande séchée).
- **`sim/`** : `GameState.inSafeZone` (drapeau dérivé de la distance au camp ; gèle la survie + autorise la
  recharge) ; état d'équipement d'expédition (eau emportée, vivres) ; capacité de portage déjà branchée
  (sac + charrette) à étendre (rucksack/wagon/convoy quand M10 fournira les sacs).
- **`render`/`ui`** : palissade/remparts low-poly + **une porte** (réutilise le kit low-poly) ; indicateur
  HUD « zone sûre / dehors » ; panneau/station de **ravitaillement** au camp (eau, vivres, capacité).
- **Acceptation** : franchir la porte fait passer « dehors » ; revenir **gèle/recharge** la survie ;
  tests sim de `inSafeZone` + recharge ; capture.

### 🌲 M7 — Survie en terres sauvages *(le RENDU est fait ; ici = la SIM)* — **M/L** — ✅ **FAIT (juin 2026)**
> **Livré** : `GameState.survival` PAR JOUEUR (eau/vivres/PV, échéances en tics façon `trapReadyAt`,
> compteur `deathSeq`), action **`SET_OUTSIDE`** (le client signale le franchissement — edge-triggered,
> validé par `isNetworkSafeAction`), **phase TICK 7 « survie »** : drain par TEMPS dehors ; eau+vivres à
> sec → PV ; 0 PV → **mort : retour au camp + perte du SAC** (entrepôt intact — knob
> `deathStoragePenalty=0`) + grâce ; **recharge auto au camp**. 0 RNG → déterministe ; champ ADDITIF
> (pas de bump de save ; strippé comme `carried`). Rendu : 3 jauges HUD + chip de zone, mort observée par
> diff `deathSeq` → téléport au camp. Tests : **+14 unit** (drain/mort/recharge/idempotence/replay/back-fill)
> + **1 e2e** (sortie → drain → mort → sac vidé → retour zone sûre).
> **Avant-postes ACTIFS** (`USE_OUTPOST`) : une grotte nettoyée se ravitaille **UNE fois** (fidèle ADR :
> usage unique, partagé entre joueurs — premier-servi, l'hôte arbitre) ; remplit **eau + vivres** (les PV
> se soignent en mangeant = M8) ; no-op si tout est plein (on ne gaspille pas l'usage) ; champ
> `SiteProgress.used` additif ; verbe diégétique « se ravitailler » (disparaît une fois épuisé). +4 tests.
> **Reste** : **fog of war** (⏸️ différé, décision actée — seam : `visited` additif + `VISIT_CELL` calqué
> sur `DISCOVER_SITE`), équilibrage des cadences (M12).

**Correction majeure** : ne PAS refaire le monde (il existe). Brancher la **logique** qui manque.

- **`sim/`** (le gros du travail) : champs `water`/`food`/`health` (par joueur) dans `GameState` ;
  **consommation par temps/distance hors zone sûre** (et non « par case » — fidèle au choix monde unifié) ;
  **mort à sec** → retour au camp, **perte de la cargaison du sac**, cooldown ; `OUTPOST_REFILL` (bases
  avancées : recharge + point de voyage). Tout déterministe (RNG à graine), porté dans le snapshot P2P.
- **`render`/`ui`** : **brouillard de découverte (fog of war)** qui se lève autour du joueur (état de
  cellules visitées — à décider : état sim partagé vs local par joueur) ; barres **eau/nourriture/vie** au HUD
  (déjà notées « pour plus tard » dans `cabane-phases-jeu`) ; rendu des **avant-postes** qu'on établit.
- **`net`** : eau/nourriture **par joueur** ; danger local ; **butin/état du monde autoritaires** (hôte).
- **Worldgen — combler** : ajouter le type **`outpost`** (dynamique, créé par le joueur) à la logique.
- **Acceptation** : s'éloigner vide l'eau ; revenir/avant-poste recharge ; courir à sec = mort + retour ;
  monde reproductible à graine (déjà testé) ; **60 FPS tenus** (streaming/LOD/autoperf déjà là).

### ⚔️ M8 — Combat 3D & créatures — **L** — ✅ **CŒUR FAIT (juin 2026)**
> **Livré** : rencontre **NON-SPATIALE par joueur** (`combat[pid]`, duel abstrait fidèle à l'écran
> ADR ; l'ennemi est rendu LOCALEMENT — il rôde/fente, `render/encounter.ts`) ; déclenchement par
> temps d'exposition (FIGHT_CHANCE 0.20, tiers par anneaux 1..3 + cavernes, **routes ×0.4 = R4**) ;
> `ATTACK` à cooldown PAR ARME (poings 1/2 s, lance d'os 2/2 s — recette ADR 100 bois+5 dents,
> atelier requis), hit 0.8, **tables d'ennemis ADR exactes** (hit/dégâts/butin PAR ennemi, médecine
> du grelottant) ; `EAT_MEAT` (**F**, +8 PV/5 s) ; `FLEE` sans pénalité ; **auto-flee** au retour
> camp ; **mort = balayage UNIFIÉ** soif/combat (sac perdu, `deathSeq`) ; victoire observée par
> `winSeq` (butin RNG hôte → sac borné). Phases TICK 8a/8b/8c (tri PORTEUR de déterminisme, RNG
> clone-on-first-use). Musique `encounter-tier-N` (bus event, non ducké), sfx armes/mort/manger.
> **Fabrication diégétique branchée** (constructrice + station atelier). +17 unit, +2 e2e.
> **Reste** : vraies armes/armures (M10 — tiers 2/3 jouables), perks, rendu de l'ennemi d'un pair.

**C'est ICI que vivent les créatures d'ADR** (rencontres du monde, pas le village). Tables d'ennemis tiérées
par distance déjà documentées (`roadmap.md` Partie 3, M8).

- **✅ Décision ACTÉE (juin 2026)** : **(b) action TEMPS RÉEL, fidèle à ADR** (armes à **recharge**, on en
  **porte plusieurs** et on frappe avec l'une pendant que les autres rechargent ; **poings** par défaut ; **PV
  fixés par l'armure** — cuir ~15, acier ~45 ; **soin en MANGEANT de la viande** ~+8 PV / ~5 s), **butin validé
  par l'hôte** (P2P-safe). *(L'option « tour par tour » est abandonnée.)* Cf. `roadmap.md` M8 + `mines-grottes-souterrains.md` §8.Q6.
- **`sim/`** : résolution **temps réel host-autoritaire** (`ATTACK` par arme avec **cooldown** propre,
  `EAT_MEAT`/`USE_MEDS`, PV joueur **dérivés de l'armure**, dégâts/recharge d'arme, tables `encounters` ; RNG à
  graine pour le butin), butin appliqué à l'état autoritaire ; déclenchement aléatoire en expédition
  (`FIGHT_CHANCE`, min 3 cases) **et dans les grottes/mines de M9**. **Dépend de M10** pour les vraies
  armes/armures (sinon : poings + lance d'os). **Ennemis de cavernes fidèles ADR** : **Lézard des cavernes**
  (6 PV / 3 dég → écailles, dents), **Bête grognante** (5 PV / 1 dég → fourrure, viande, dents).
- **`render`/`ui`** : ennemi low-poly (kit du labo `model-lab.html`), barres de PV, **jauges de recharge par
  arme**, intégration FPV (prévue, `architecture.md` §8).
- **🔊 A7** : `encounter-tier-1..3` + `weapon-*`/`death`/`eat-meat`/`use-meds` (assets déjà dans `public/audio/`).
- **Acceptation** : combat jouable, butin reproductible à graine, soin fonctionnel ; tests de résolution.

### 🏛️ M9 — Sites, donjons & mines → **ressuscite la chaîne industrielle** — **L** — 🟢 **EN GRANDE PARTIE FAIT**
> **Revue (juin 2026)** — implémentation **fidèle et solide** (cf. [`mines-grottes-implementation.md`](mines-grottes-implementation.md)) :
> - ✅ **Grottes & mines explorables physiquement** (`render/interior.ts`, Option A : massif au sol, colliders
>   localisés, obscurité locale) — pas d'embranchements HTML : **divergence assumée** (plus diégétique, fidèle à
>   l'esprit « E + monde » du projet) vs ce que cette fiche prévoyait.
> - ✅ **Donjon pur & déterministe** (`sim/dungeon.ts`, graine `worldSeed`+cx+cz+type) ; butin **3D ramassable,
>   premier-servi** (hôte arbitre) ; **torche** craftable + gate d'entrée + modèle/lumière sur le joueur.
> - ✅ **Mine sécurisée ⇒ métier mineur** (`iron/coal/sulphur_miner`, gardés par `secured && type`) → **ressuscite
>   acier→balles** (la branche 🔴 morte est vivante). ✅ **Grotte vidée ⇒ avant-poste** (rendu). Vérifié : `tsc`,
>   **159 tests** (+21), build OK.
>
> **Reste pour clore M9** (à inscrire au backlog) : (a) **type de site `city`** non ajouté — nécessaire au **Raid
> militaire** (M10) et à une source partielle d'**alliage** ; (b) **intérieurs maison/ville** (seuls `cave`+mines
> ont un intérieur ; maisons/villes restent des silhouettes) ; (c) **hazards / consommation de torche / événements
> de lieu** (différés v3+, OK) ; (d) **effet** d'avant-poste (eau/voyage) = dépend de M6/M7 ; (e) **combat** sous
> terre = M8. *Le cœur du jalon (entrer/explorer/ramasser/sécuriser/ressusciter la chaîne) est livré.*
>
> 🛣️ **Extension M9 — RÉSEAU DE ROUTES & VARIÉTÉ DE SITES** (analyse + plan détaillés :
> **[`routes-sites.md`](routes-sites.md)**). Deux manques majeurs identifiés vs A Dark Room :
> - **Variété/nombre** : 17 sites sur une grille **4× plus grande** qu'ADR (≈ 16× plus clairsemé). Manquent
>   **city / borehole / battlefield / cache** (or `city`+`borehole` sont les **sources d'alliage** → bloquent la
>   fin M11). Modèles **city/borehole/battlefield déjà au labo** (à porter) ; cache à modéliser. → **Phase R1**
>   (étendre `sites[]` ~56 sites + porter modèles).
> - **Routes sécurisées** : absentes. À porter fidèlement d'ADR — nettoyer un site **trace une route** qui
>   **fusionne** au réseau (`findClosestRoad` = spirale vers la route/avant-poste/village le plus proche, tracé
>   en L Manhattan). SIM pure (`roads` dans l'état) + rendu (teinte de sol par cellule). → **Phase R2**. Bénéfices
>   (avant-poste recharge = M6/M7 ; route « sécurisée » = M8) → **R4**.

Le jalon qui transforme l'**inerte** en jouable **et** rend la branche **morte** vivante.

- **Conception détaillée + décisions actées** : **[`mines-grottes-souterrains.md`](mines-grottes-souterrains.md)**.
  Décisions (juin 2026, fidèles ADR) : **souterrain mesh « cousu » au terrain, Option A** (massif au niveau du
  sol — on ne troue pas le heightmap) ; exploration **PHYSIQUE** (on marche les tunnels — **plus d'« embranchements
  HTML »** ; le « continuer » d'ADR = avancer, le choix de chemin = choisir un tunnel) ; **torche fidèle ADR**
  (1 bois + 1 étoffe, **requise pour entrer** dans le noir, consommable, **affichée sur le modèle 3D du joueur**) ;
  **butin = objets 3D ramassables** au **sac du joueur**, **commun à toute la carte** (premier-servi : pris par
  l'un ⇒ indisponible pour l'autre, l'hôte tranche) ; **sécuriser UN filon suffit** ⇒ métier mineur ; **grotte
  nettoyée ⇒ devient un `outpost`** (usage unique) ; **combat sous terre = M8** (M9 expose les emplacements).
- **`sim/`** : machines de **setpieces pilotées par les données** (réutilise le moteur d'événements M5),
  champs `sites{ discovered, taken, secured, cleared }` (snapshot autoritaire), actions **pures**
  `DISCOVER_SITE/TAKE_LOOT/CLEAR_HAZARD/SECURE_MINE/CLEAR_CAVE`. **Le déblocage clé** : *sécuriser une mine de
  fer/charbon/soufre ⇒ le métier mineur correspondant devient disponible* → **les mineurs produisent enfin
  fer/charbon/soufre** → la chaîne **sidérurgiste (acier)** puis **armurier (balles)** sort de son chômage, et
  l'**aciérie/armurerie** deviennent atteignables sans DEBUG. *(C'est le correctif du 🔴 MORT du §1.)*
- **⚠️ Dépendance torche** : la torche gate l'entrée des grottes (M9) mais est listée comme objet d'**atelier
  (M10)**. **Avancer sa recette** (1 bois + 1 étoffe) avec M9, ou gater les premières grottes sur une torche de base.
- **Worldgen — combler** : ajouter le type **`city`** (cité — butin lourd : alliage, fusil laser, cellules ;
  pose `cityCleared` ⇒ débloque l'événement **Raid militaire** de M10) ; augmenter les compteurs vers ADR
  (maison 5→~10, ville 2→~10, grotte 4→~5) si l'équilibrage le demande.
- **`render`/`ui`** : **intérieurs de sites explorables en 3D PHYSIQUE** (on marche dans la bouche, **sans
  transition** — l'entrée est explicitement différée à M9 dans `render/sites.ts:6`) ; palier **LOD `interior`**
  (mesh + colliders bâtis à proximité, libérés au loin) ; obscurité par **occlusion + torche** (`PointLight`
  suiveuse) ; **butin = objets 3D** posés dans les nœuds (disparaissent chez tous une fois `taken`) ; verbes
  `computeFocus` **fouiller/miner/forcer/ramasser**. HTML réservé aux dialogues/événements ponctuels.
- **🔊 A7** : `landmark-*` (13 ambiances de lieu) à l'entrée/sortie d'un site.
- **Acceptation** : on entre/sort d'une grotte **sans transition** ; on **ramasse un objet 3D** (qui disparaît
  chez l'autre pair) ; **sécuriser la mine de fer débloque les mineurs et la chaîne acier→balles** ; une grotte
  nettoyée **devient un avant-poste** ; ≥ 2–3 setpieces ; tests sim (butin borné, **2ᵉ ramassage = no-op**,
  mine⇒métier, grotte⇒avant-poste, déterminisme).

### 🛠️ M10 — Atelier (objets) · Poste de traite (commerce) · Perks & événements reportés — **M/L** — ✅ **FAIT (juin 2026)**
> **Livré, valeurs du CODE SOURCE ADR vérifiées** (room.js/world.js/path.js/events) : 12 objets
> d'atelier (recettes exactes ; **upgrades = possessions du village à l'ENTREPÔT**, fidèle
> `World.die()` — jamais perdues à la mort, max 1, best-of : eau +10/20/50, portage +10/30/60,
> armures 15/25/45 PV ; **armes au SAC**, perdues à la mort comme l'outfit) ; **fusil** 5 dég/1 s à
> 1 balle/tir, **grenade** 15/5 s (consommable), **baïonnette** 8/2 s via le troc ; **poste de
> traite** = Room.TradeGoods exact (jusqu'à l'**alliage** 1500 fourrure) ; **OUTFITTING** au coffre
> (« tout déposer » + s'équiper, action `WITHDRAW`) ; **perks du village** via « le Maître » (coût
> exact 100 viande + 100 fourrure + 1 torche du sac, `costCarried`) : précis/barbare/insaisissable
> (effets exacts events.js) ; « l'homme malade » (tirage pondéré 10/30/50 %) ; `USE_MEDS` +20 PV/7 s.
> +11 unit, +1 e2e. **Différés** : bolas (stun inexistant), boussole (décision §5), laser/plasma (M11).

Rend **non-inertes** les deux bâtiments morts (atelier, poste de traite) et complète l'arsenal d'événements.

- **Atelier = station d'artisanat** (décision actée, [`build-craft-plan.md`](build-craft-plan.md) Phase 4) :
  `computeFocus` ajoute le verbe **« fabriquer »** sur l'atelier construit ; `craftView()` (réutilise les
  dialogues) ; objets en **données** (`type: good|tool|weapon|upgrade`) + action **`CRAFT`** (sim). Objets :
  torche, **outre/baril/citerne** (capacité d'eau → M6/M7), **rucksack/wagon/convoy** (portage), **armures**
  cuir/fer/acier (PV → M8), **lance d'os/épées/fusil** (armes → M8). *(L'atelier cesse d'être un no-op.)*
- **Poste de traite = commerce** : actions `BUY`/`SELL`, table `TradeGoods` en données, **fourrure = monnaie** ;
  achat d'écailles/fer/charbon/acier/médecine/balles/alliage. *(Le poste de traite cesse d'être un no-op.)*
- **Boussole** : dans ADR elle débloque la carte — **monde unifié oblige, redéfinir son rôle** (révélation
  longue portée / voyage rapide / cartographie du fog) ou la retirer (voir §5).
- **Perks + événements reportés de M5** (le moteur les accueille sans refonte) : **Éclaireur** (vision carte,
  vend boussole), **Maître** (perks de combat), **Homme malade** (alliage/cellule contre médecine),
  **Maladie/Peste** (médecine), **Raid militaire** (`cityCleared` de M9), **Voleur** (vol de stocks > 5000).
- **🔊 A7** : `buy` (SFX) sur `BUY` ; brancher la piste `shadyBuilder` orpheline du manifeste.
- **Acceptation** : fabriquer une outre/un sac/une arme à l'atelier ; troquer fourrure→boussole/écailles ;
  au moins un perk actif ; tests des coûts/effets.

### 🚀 M11 — Fin de partie : épave → vaisseau → espace → fin → prestige — **M/L**
L'arc final. **`alien alloy` a désormais sa source principale** (R3a : fouille des forages) ; reste à brancher cité/épave et surtout l'USAGE (réparer le vaisseau).

- **Worldgen — combler (critique)** : ajouter **`borehole`** (×~10, source principale d'alliage) et
  **`battlefield`** (armes lourdes) ; **`cache`** (×1, report de prestige). *(Sans eux, la fin est
  inatteignable : seuls `ship`/`executioner` existent.)* ~~Ajouter la ressource `alien alloy` + `energy cell`~~
  ✅ (déjà déclarées dans la table de rareté ; **reste à leur donner une source** via ces sites).
- **`sim/`** : setpiece **`executioner`** (3 ailes + l'immortel) → accès au vaisseau ; `ship` (coque/propulseurs),
  `REINFORCE_HULL`/`UPGRADE_ENGINE` (coût alliage) ; **mini-jeu spatial** (esquive d'astéroïdes, altitude 0→60+ —
  peut rester **arcade local**, score validé par l'hôte) ; **fin de partie** + le **twist narratif** (« vous êtes
  un wanderer ») ; ébauche de **prestige** (la cache reverse les stocks de la partie précédente).
- **`render`/`ui`** : site de l'épave, séquence de réparation, **mini-jeu d'ascension 3D**, écran de fin.
- **🔊 A7** : `ship`/`space`/`ending` (musique) + `reinforce-hull`/`upgrade-engine`/`lift-off`/`asteroid-hit-1..8`/`crash`.
- **Acceptation** : boucle complète atteignable de bout en bout ; fin déclenchée ; persistance de la partie.

### ✨ M12 (transverse) — Équilibrage, polish, perf, accessibilité, audio
- Réglage des courbes (coûts/income), écran-titre, ombres/LOD, *deep imports* Babylon (bundle), TURN robuste.
- **Audio A7** complété au fil de M8/M9/M11 (assets déjà là ; *optionnel* transcodage `.flac → .ogg`).
- **Accessibilité** : rebind clavier (bouton « bientôt » d'`index.html` à activer), contrastes, options de confort
  FPV (déjà pensées anti-malaise).

---

## 🎨 Chantier C — Refonte monde & campement (polish — **demandé en priorité, avant plus de contenu B**)

> **Plan & analyse détaillés : [`refonte-monde-campement.md`](refonte-monde-campement.md)** (constat code +
> formules + sources). Résumé des 6 sous-chantiers et de leur ordre :

| Réf | Sujet | Couche | Risque | Effort |
|---|---|---|---|---|
| **F** ✅ **FAIT** | Villageois **dans les huttes** + rotation + **son de porte** (~50 % cachés → perf + village vivant) | rendu local | très bas | S/M |
| **E** 🟡 *(amorcé)* | **Village s'améliore avec le palier de cabane** : ✅ **lanternes** (sentiers, allumées palier ≥5, plus à ≥10) ; *reste* : fanions, densité de décor ×10, flicker | rendu local | bas | S |
| **D** 🟡 *(amorcé)* | ✅ **Ruines** sur ~1/3 des emplacements majeurs à venir (remplacées à la construction) + 4 ruines permanentes ; *reste* : chemins mieux rendus (résolution/decal), + densité de décor | rendu local | bas | M |
| **C** ✅ **FAIT** | **Placement mathématique** des bâtiments : `generateCampLayout()` pur & testé — phyllotaxie de Vogel (angle d'or) pour les huttes, rayons Fibonacci, **filtré par quartier** (chasse N / industrie E / artisanat O / habitat S) + relaxation anti-chevauchement (feu/cabane/spawn dégagés). ✅ **Sentiers régénérés dynamiquement** depuis le layout (`campPathsFor` = arbre couvrant minimal feu+cabane+bâtiments, **s'étoffe à chaque construction**) + ✅ **dégagement des emprises** à la construction (arbres/décor retirés, **pas de repousse**) | `data/` + rendu local | moyen | M |

> **🎉 Chantier C — Refonte monde & campement : TERMINÉ** (A·B·C·D·E·F tous ✅). Reste, hors refonte :
> le **rebind clavier** (Chantier D, P0 accessibilité) et les **contenus** M6→M11 (survie, combat, intérieurs
> maison/ville, commerce, fin de partie).
| **A** ✅ **FAIT** | Biomes **moins répétitifs** : bruit de valeur **multi-octaves + domain warping** (grandes régions organiques, fini le moucheté) + **marais = vraie RÉGION** (ancre par graine à distance moyenne, ~180 u, site marais recalé dessus) ; *reste éventuel* : Worley pur, plus de variété de palettes | `sim/` pur | moyen-haut | M/L |
| **B** ✅ **FAIT** | **Vraies bordures** : 2 fausses montagnes + 2 faux océans (tirées par graine, opposés/adjacents), **au-delà** de la zone jouable (intérieur plat préservé), **infranchissables** (clamp de vitesse + filet anti-chute), plan d'eau global ; *reste éventuel* : vaguelettes/écume de l'eau, crêtes plus sculptées | `data/`+`render`+`player` | haut | M/L |

**Ordre recommandé** : **F → E → D** (local, gros effet ressenti, risque ~nul) → **C** (data pur, déterministe) →
**A → B** (les plus structurels : sous-graines séparées, threading de `worldSeed` dans la config de bordure,
extension de `MAX_CHUNK_DIST`, confinement joueur). Tout reste **déterministe** (graine) côté `sim/`/`data/` et
**cosmétique local** côté rendu. Détail, formules (Vogel `r=c√n`/θ=137,5°, domain warp, Worley, smoothstep de
bordure, assignation 2-of-4 par graine, occupation ~50 %) et risques : **[`refonte-monde-campement.md`](refonte-monde-campement.md)**.

---

## 🌟 Chantier D — Qualité d'expérience (transverse : feel, UX, accessibilité, perf, atmosphère)

> **Synthèse de recherche industrie : [`bonnes-pratiques-jeu.md`](bonnes-pratiques-jeu.md)** (6 piliers, sources).
> Ce qui rend le jeu **agréable, réactif, fluide, beau**. À mener **en parallèle** des contenus, P0 d'abord.
> Beaucoup de points **renforcent le Chantier C** (règle du triangle, biomes distincts, ruines-vignettes,
> atmosphère/jour-nuit).

**P0 — gros leviers, à faire tôt** :
1. **Onboarding diégétique par révélation progressive** (l'ADN d'A Dark Room ; résout l'absence de tuto sans mur de texte).
2. **Bâtiments/cabane merge+instance + tuer les allocs/frame** (= A5 ; plus gros gain perf/jank).
3. **Cycle jour/nuit + AO/ombres de contact** (la lumière = ambiance ; l'AO = levier cheap→premium n°1).
4. **Juice de la boucle** 🟡 *(amorcé)* : ✅ HUD **count-up + pop au gain** (sac, lignes persistantes, respect `prefers-reduced-motion`) + sons d'action déjà larges + ✅ **construction ANIMÉE** (chantier qui **monte pièce par pièce** + **constructrice qui marche/frappe** ; **cabane** idem à la réparation/amélioration) ; *reste* : pops sur d'autres milestones, easing des panneaux de dialogue, poussière de chantier.
5. **Terrain en triangles/landmarks + biomes distincts + compas diégétique** (anti monde vide ; ↔ Chantier C).
6. **Accessibilité/confort de base** 🟡 *(amorcé)* : ✅ **slider FOV** + **slider sensibilité souris** (persistés) + `prefers-reduced-motion` (animations HUD) ; *reste (gros morceau dédié)* : **rebind clavier** (tuer le bouton « bientôt » + étiquettes E sur la touche réelle), sous-titres lisibles, modes daltoniens. *(head-bob/shake : sans objet pour l'instant — le jeu n'a ni l'un ni l'autre.)*

**P1 — renforcer l'existant** : fog ré-activé (couleur = ciel) + ACES ; **reverb par zone** (grottes/cabane) ;
variation sur **chaque** SFX répété ; Web Workers + time-slicing du streaming + **pause onglet caché** (Page
Visibility) ; transition 3ᵉ↔1ʳᵉ en fondu + look-ahead ; surlignage des interactifs + buffering d'input ;
indicateur « sauvegardé » + save sur `visibilitychange`.

**P2 — polish** : eau stylisée (profondeur+écume), particules feu en couches/GPU, KTX2/Draco/brotli + tree-shaking,
Snapshot Rendering (WebGPU), modes daltoniens/contraste/vitesse de jeu, milestones sonores.

> Détail, paramètres et sources : **[`bonnes-pratiques-jeu.md`](bonnes-pratiques-jeu.md)**.

---

## 4. Séquencement & dépendances

```
Chantier A (assainissement) — en parallèle, A1→A2 d'abord :
   A1 docs ─ A2 sécu dev ─ A3 P2P ─ A4 save ─ A5 perf ─ A6 refactor

Chantier B (contenu) :
   [Acte I ✅ M1–M5] ─> M6 (seuil/zone sûre) ─> M7 (survie SIM) ─┬─> M8 (combat) ─┐
                                                                  └─> M9 (sites+mines ⇒ acier/balles) ─> M11 (fin)
                                              M10 (atelier/commerce/perks) ── dépend de M6 (objets) ; alimente M8 (armes) & M9 (médecine)
```

- **M6 avant M7** (la survie a besoin de la zone sûre). **M7 = surtout de la sim** (le rendu est fait).
- **M8 ↔ M10** : le combat veut de vraies armes/armures → M10 (atelier) ; M10 veut un débouché → M8.
  Faisable en s'amorçant (poings + lance d'os en M8, le reste en M10).
- **M9 débloque la chaîne industrielle** (mines) **et** la cité (→ raid militaire M10, alliage partiel).
- **M11 dépend du worldgen étendu** (borehole/cité pour l'alliage) → faire l'extension `sites[]` en amont (M9).

---

## 5. Décisions ouvertes (à trancher par le porteur)

| Sujet | Pourquoi ça bloque | Options |
|---|---|---|
| ~~**Modèle de combat** (M8)~~ | — | ✅ **TRANCHÉ (juin 2026)** : **temps réel fidèle ADR**, butin validé par l'hôte (cf. M8). |
| **Rôle de la boussole** (M10) | son rôle ADR (« débloquer la carte ») n'existe pas en monde unifié | révélation longue portée / voyage rapide / cartographie du fog · ou la retirer |
| ~~**Fog of war : sim partagé ou local ?** (M7)~~ | — | ✅ **TRANCHÉ (juin 2026)** : **différé** (hors périmètre M7 ; seam prêt : `visited` additif + `VISIT_CELL` calqué sur `DISCOVER_SITE`). |
| ~~**Mort en expédition : perte du sac seulement, ou pénalité d'entrepôt ?** (M7)~~ | — | ✅ **TRANCHÉ (juin 2026)** : **perte du SAC seul** (fidèle ADR) ; knob `deathStoragePenalty` (0 par défaut) pour durcir plus tard. |

---

## 6. Invariants à préserver (ne pas casser)

- **`sim/` + `data/` purs & déterministes** : jamais de Babylon/DOM/`Math.random`/`Date.now` ; tout l'aléatoire
  via `state.rng` (à graine). C'est ce qui rend l'Acte II (combat, survie, sites) **P2P-safe** par construction.
- **Toute règle de jeu → `reduce`** ; rendu/UI **lisent** l'état et **émettent** des actions.
- **Tout nouveau champ d'état** : l'ajouter à `GameState` + `createInitialState` ; le snapshot étant désormais
  un **`structuredClone` intégral**, il circule automatiquement (ne pas réintroduire de liste de champs manuelle).
- **Timers = compteurs de tics** (20 Hz), pas de `setTimeout`.
- **Audio = présentation** : hors `sim/`, piloté par le diff d'état, jamais `state.rng`.
- **Sac (par joueur) vs entrepôt (partagé)** : conserver la distinction (c'est ce qui re-rythme la récolte).
- **Données = source de vérité** : tout contenu ADR (objets, ennemis, sites, TradeGoods, perks) se porte en
  `data/world.ts`, éditable sans toucher au moteur.
```
