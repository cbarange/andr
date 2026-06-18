# Reste à faire — roadmap forward (post-M11/RF8)

> **Document de planification, source de vérité du « et maintenant ? ».** Établi en juin 2026, après que
> **la boucle d'A Dark Room est complète, finissable, ET fidèle** : M0–M11 livrés + **refonte M11 RF1→RF8**
> (cuirassé explorable, vaisseau au camp dé-gaté, minimap unifiée, cinématiques de seuil, fleet beacon,
> Fabricator, **décollage pilotable en esquive 3D**). État détaillé : [`etat.md`](etat.md) · jalons :
> [`roadmap-v2.md`](roadmap-v2.md) · refonte M11 : [`m11-refonte-roadmap.md`](m11-refonte-roadmap.md).
>
> Vérif courante : **typecheck propre · 286 tests unitaires · 18 e2e Playwright**.

---

## En une phrase

Le jeu est **complet et jouable de bout en bout**. Ce qui reste n'est plus du **contenu de boucle**
manquant, mais : **(1) de l'équilibrage qui se juge manette en main**, **(2) quelques événements/écrans
de finition**, **(3) de la dette technique** (surtout `main.ts` devenu gros), **(4) du confort/polish**,
**(5) de la longue traîne optionnelle de fidélité**, et **(6) le packaging/distribution**.

---

## Priorisation (ordre recommandé)

| # | Phase | Pourquoi maintenant | Ampleur |
|---|---|---|---|
| **1** | **Playtest & équilibrage (M12)** | Tout est posé ; le *feel* ne se règle qu'en jouant | M (itératif) |
| **2** | **Finition du combat & des événements** | Boucler les fils ADR encore ouverts (raid, butin, perks d'usage) | M |
| **3** | **Dette technique (Chantier A)** | `main.ts` est devenu gros (M8.6 + M11) ; refactor avant d'empiler | M–L |
| **4** | **Confort & polish (Chantier D)** | Qualité d'expérience (rebind, jour/nuit, AO, écran-titre) | M |
| **5** | **Longue traîne optionnelle** | Fidélité fine, contenu bonus (Fabricator, bolas, fog d'exploration) | S–M |
| **6** | **Packaging & distribution** | Quand le contenu est figé (TURN, bundle, Tauri/Capacitor) | M |

---

## Phase 1 — PLAYTEST & ÉQUILIBRAGE (M12) — *prioritaire, itératif*

Le seul vrai bloquant restant à la qualité : **rien de tout ça ne se règle en headless**. Il faut
jouer, mesurer le ressenti, ajuster les chiffres dans `data/world.ts`, rejouer.

- [ ] **Feel du décollage (RF8)** — sensibilité du pilotage (`FLIGHT.steerSpeed`, `engineSteerBonus`),
  difficulté de la pluie d'astéroïdes (`spawnInterval*`, `densityFor`, `impactLeadSeconds`, `hitRadius`,
  `iframeSeconds`), lisibilité de la caméra de contre-plongée (`liftoff.ts` : `CAM_BELOW/LOOK_UP/FOLLOW`).
  *Question ouverte : solo vs co-op — l'esquive sommée est-elle trop facile/dure à 2+ ?*
- [ ] **Feel des cinématiques de seuil (RF5)** — durées/choré/esthétique des portes, **caméra serrée**
  (spring-arm sphere-cast) en couloir ; *skippable* après la 1re fois (anti-lassitude sur trajets répétés).
- [ ] **Équilibrage GLOBAL** (le cœur de M12) : courbe de survie (drain eau/vivres dehors), létalité des
  tiers de combat (T2/T3 sans/avec armure), courbe d'économie (income métiers, coûts de construction
  croissants), coût de la fin (alliage requis vs sources). Tout est centralisé dans `data/world.ts`.
- [ ] **Vérification co-op MANUELLE (2 onglets)** : la couverture co-op est **testée en unitaire/replay**,
  mais le ressenti P2P (combat partagé, raid du cuirassé à plusieurs, **décollage co-piloté**) doit être
  validé à la main — l'e2e ne couvre que l'init du salon + l'élection d'hôte.
- [ ] **Vérification WebGPU manuelle** : Playwright tourne en WebGL2 (headless = SwiftShader). Vérifier le
  chemin WebGPU dans un vrai navigateur (badge « rendu : WEBGPU » en bas à droite).

> **Livrable** : un doc `docs/equilibrage-m12.md` qui consigne les valeurs avant/après + le raisonnement,
> au fil des sessions de playtest.

---

## Phase 2 — FINITION DU COMBAT & DES ÉVÉNEMENTS

Fils ADR encore ouverts, repérés dans [`roadmap-v2.md`](roadmap-v2.md) (M8.5/M8.6/M10) :

- [ ] **Raid militaire** (M10) — événement gaté sur une **cité nettoyée** (`cityCleared`, déjà posé par la
  cité scriptée R3b) : il reste à **brancher l'événement** (`data/world.ts` events + reducer + e2e).
- [ ] **Écran de butin** — à la mort d'un ennemi, un récap du butin tombé (aujourd'hui : pile 3D au sol +
  verbe « ramasser », sans synthèse). Polish UX.
- [ ] **F5 — perks d'USAGE** (vs les perks de village déjà faits) : les perks consommables/situationnels
  d'ADR encore absents.
- [ ] **Bolas** (arme de *stun*) — différée ; **boussole** — décision ouverte (utilité avec la minimap RF4 ?).

---

## Phase 3 — DETTE TECHNIQUE (Chantier A)

- [ ] **A6 — refactor `main.ts`** *(priorité)* : le fichier est devenu gros (orchestration de M8.6 combat
  co-op + tout M11/RF1-RF8). Extraire des sous-systèmes (boucle de décollage, wiring des cinématiques,
  feed de positions, HUD contextuel) en modules dédiés **sans changer le comportement** (couvert par e2e).
- [ ] **A2 — outils dev hors prod** : `dev/commands.ts` + mutateurs `window.__game` **shippent** en prod
  (gardés volontairement pour le dev). À gater derrière un flag de build avant distribution publique.
- [ ] **A5 — bâtiments merge + instance** : ⏸️ différé (analyse de risque faite) — optimisation de draw calls
  si le profil perf l'exige.

---

## Phase 4 — CONFORT & POLISH (Chantier D)

- [ ] **Rebind clavier** (remapping des touches, persisté).
- [ ] **Cycle jour/nuit** (ambiance ; impacte l'éclairage, pas la sim).
- [ ] **AO / ombres de contact** (désactivées pour le budget perf au POC — à réévaluer en WebGPU).
- [ ] **Reverb spatiale** (intérieurs grotte/mine/cuirassé) — la couche audio est prête (bus dédiés).
- [ ] **Écran-titre / menu principal** (aujourd'hui : on tombe directement dans le jeu).
- [ ] **Juice** (suite) : déjà HUD count-up + construction/cabane animées ✅ ; reste micro-feedbacks divers.

---

## Phase 5 — LONGUE TRAÎNE OPTIONNELLE (fidélité fine & bonus)

- [ ] **Recettes Fabricator** restantes (RF7) : stim, disruptor, cargo drone, hyperdrive… (tech alien gatée
  par le clear de l'antichambre ; système déjà en place, il suffit d'ajouter les `requiresPerk` + stats).
- [ ] **Fog of war d'EXPLORATION** (monde) : le seam est prêt côté sim (`visited` additif) ; la fog **de la
  minimap** est déjà faite (RF4a `visitedCells`). Reste l'obscurcissement du monde non-exploré si désiré.
- [ ] **R4 — sites/routes phase 4** : derniers intérieurs (maison/ville/cité explorables vs fouille de
  surface actuelle), variété supplémentaire.
- [ ] **Audio de fin / espace dédié** : la musique de tension du décollage réutilise `encounter-tier-3` ;
  une piste spatiale propre serait plus immersive (asset à produire/sourcer).
- [ ] **Noms de joueurs réels en P2P** : l'étiquette billboard affiche l'id ; `RemotePlayers.setName(id,
  name)` est prêt à recevoir le vrai nom quand le réseau le fournira (saisie d'un pseudo au salon).

---

## Phase 6 — PACKAGING & DISTRIBUTION

- [ ] **Relais TURN** pour les réseaux restrictifs (le P2P passe aujourd'hui par STUN + relais Nostr ;
  un TURN serait nécessaire derrière NAT symétrique).
- [ ] **Bundle** : *deep imports* Babylon + code-splitting (réduire le JS ; budget large mais propre).
- [ ] **Emballage** : Tauri (bureau) / Capacitor (mobile), une fois le contenu figé.
- [ ] **Optimisations rendu** : ombres portées, LOD étendu, occlusion GPU si le profil le demande.

---

## Ce qui est DÉJÀ FAIT (pour mémoire — ne pas refaire)

- **Boucle de village (Acte I)** : feu → étrangère → cabane/entrepôt → construction → population/métiers/
  chaînes → pièges → événements. ✅
- **Monde & exploration** : monde carré (biomes-régions, bordures montagnes/océans), ~57 sites, grottes/mines
  explorables, routes qui se tissent, fouille de surface (alliage). ✅
- **Village vivant** (Chantier C) : placement mathématique, lanternes, ruines, villageois dans les huttes,
  construction visuelle temporisée, sentiers dynamiques. ✅
- **Seuil & survie (M6/M7)** : rempart/porte/puits, survie par joueur (drain dehors, mort = perte du sac,
  recharge camp), avant-postes (ravitaillement usage unique). ✅
- **Combat COOPÉRATIF (M8→M8.6)** : rencontres partagées ancrées dans le monde (HP commun, poursuite,
  frappe d'un engagé au hasard), déclenchement par pas, tables ADR exactes, butin au sol premier-servi,
  setpieces scriptés (mines/grottes/villes/cités). ✅
- **Atelier, commerce & perks (M10)** : 12 objets ADR, troc TradeGoods, armures, armes, outfitting au coffre,
  perks du village, soin (manger/médecine). ✅
- **Fin de partie (M11) + REFONTE (RF1→RF8)** : cuirassé **donjon explorable** (salles/aliens/portes
  télégraphiées), vaisseau **géré au camp** (dé-gaté, 3 états visuels épave→dressé→amélioré), **minimap
  unifiée contextuelle** + fog partagé, **cinématiques de seuil** (grotte/mine/vaisseau), **fleet beacon**
  + fin étendue, **Fabricator** (tech alien), **décollage PILOTABLE en esquive 3D** (STEER co-op sommé,
  caméra de contre-plongée, audio de tension), **ÉVASION** → **PRESTIGE** (NG+). ✅
- **Transverse** : P2P host-autoritaire (failover par époque), sauvegarde auto + migration, audio A1–A6,
  caméra pointer-lock, menu Paramètres, console dev. ✅

---

## Méthode (rappel)

`data/world.ts` (données/réglages) → `src/sim/` (cerveau **pur & déterministe** + **tests**) →
`render/`/`ui/` → `net/` → **e2e**. Chaque pas laisse l'arbre vert (typecheck + tests + e2e). Tout
l'aléatoire passe par le RNG à graine ; **jamais** `Math.random()`/`Date.now()` dans `sim/`.
