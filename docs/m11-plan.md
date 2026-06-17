# Plan — M11 : LA FIN DE PARTIE (le départ)

> Le dernier acte manquant d'*A Dark Room 3D*. Fidèle à ADR (raid du cuirassé → réparer le vaisseau →
> décoller → s'évader), adapté à notre **3D coopératif** (rencontres partagées M8.6, sim host-
> autoritaire déterministe), avec les **best-practices de l'industrie** (foreshadowing, UI diégétique,
> point-of-no-return, climax d'extraction co-op, netcode déterministe, perf on-rails).

## Décisions porteur ACTÉES (juin 2026)
1. **Format du climax = EXTRACTION ALLÉGÉE.** Ascension cinématique + survie coopérative : coque
   PARTAGÉE, vagues d'astéroïdes seedés, les joueurs **tirent** pour dégager la voie (pas de pilotage
   libre). Réutilise au plus près le combat M8.6 (engagement par proximité au poste de tir, RNG porteur,
   interpolation). Effort **L** (pas XL). Upgradable vers le shooter complet plus tard.
2. **Embarquement co-op = LE VAISSEAU ATTEND TOUT LE MONDE.** `LIFT_OFF` ne s'arme que si tous les
   joueurs présents sont sur la zone du vaisseau (`aboard`), avec **compte à rebours optionnel**. Solo OK.
3. **Prestige (défaut, ajustable) = reset façon ADR** (nouvelle graine) + **report des `perks`** du
   village + **compteur de prestige** (saveur NG+). Pas de report de stock (on garde la tension).

## Le gros coup d'avance déjà présent
- **`ship` (épave) + `executioner` (cuirassé)** : sites uniques au bord du monde (rayon 56‑60), **déjà
  rendus** ([data/world.ts](../data/world.ts) `sites`, [src/render/sites.ts](../src/render/sites.ts)).
- **`alien alloy`** marqué « fin de partie », obtenable (forages 1‑3 garanti / champs 30 % / villes-cités /
  homme malade 10 % / **troc = fallback infini → anti-softlock**) mais **jamais consommé** aujourd'hui.
- **Moteur d'événements** = machine à états (scènes/choix/`next` pondéré/`grantPerk`/`available`).
- **Sim déterministe host-autoritaire** : un mode de vol = phase de TICK + état partagé (comme
  `encounters`) + actions à cooldown par joueur (comme `ATTACK`/`weaponReadyAt`) ; survit à la migration
  d'hôte (snapshot `structuredClone`) ; RNG à graine → astéroïdes identiques chez tous.
- **Rendu** : API `reveal` (assemblage pièce par pièce de la cabane), caméras cinématiques
  (`showcaseCamera`/`planView`), HUD modal pour l'écran de fin, `InstancedMesh`/`ParticleSystem`.
  **Manque** : pistes audio de fin (à stub dans `data/audio.ts`).

## L'arc en 5 temps (build-up → climax → release → loop)
1. **Le signal** *(foreshadowing — Chekhov's gun)* : l'épave devient un repère lointain + un événement
   one-shot (« une lueur métallique pulse à l'horizon ») gaté sur alliage en stock / 1ʳᵉ cité nettoyée.
2. **Le cuirassé** *(raid d'équipe)* : `executioner` = setpiece scripté (gantelet de combats `noFlee` +
   boss) via la machinerie M8.5 (`siteSteps`). En co-op = vrai raid (rencontres partagées M8.6). Nettoyer
   → gros cache d'alliage + **révèle le vaisseau**.
3. **Réparer le vaisseau** *(puits de ressources, diégétique)* : l'épave devient interactive — *Renforcer
   la coque* (+PV, 1 alliage) / *Calibrer le moteur* (+poussée → vol plus facile). Assemblage visuel via
   `reveal`. La **préparation = la difficulté** (accessibilité élégante, fidèle ADR). « Décoller » gaté.
4. **Le décollage** *(climax co-op — extraction allégée)* : confirmation point-of-no-return → ascension
   cinématique, coque partagée, astéroïdes seedés, chaque joueur **tire** (`FLIGHT_FIRE`, cooldown/joueur).
   Coque 0 → crash → retry. Altitude d'échappée → évasion.
5. **La fin & le prestige** *(release + loop)* : cinématique d'éloignement + écran de fin/crédits
   (overlay HUD), puis prestige/NG+ (reset graine + report perks + compteur).

## Best-practices industrie injectées
- Chekhov's gun (repère lointain) · UI diégétique (Dead Space) · point-of-no-return + confirmation ·
  difficulté = préparation du joueur + option accessibilité (tir auto / astéroïdes lents) ·
  climax d'extraction co-op (final L4D / drop-pod Deep Rock) · netcode déterministe (lockstep host-
  autoritaire + RNG graine + interpolation) · perf on-rails (thinInstances/SPS + pooling + comptage borné,
  zéro physique) · telegraphing + feedback (indicateurs d'entrée, screen-shake/SFX, barre d'altitude,
  montée musicale) · checkpoint (autosave avant décollage) · anti-softlock (troc d'alliage infini).

## Modèle de données & architecture (esquisse)
**Sim** (`state.ts`) — tout persiste sauf le vol live :
- `perks` (persisté) : `signal_seen`, `executioner_cleared`, `ship_revealed`.
- Ship build dans `resources`/`buildings` (persistés) : `ship_hull` (int), `ship_engine` (int).
- `flight?: SharedFlight | null` (volatile, comme `encounters`, strippé save) :
  `{ hull, altitude, asteroids[], nextSpawnAt, fireReadyAt: Record<pid,tick>, aboard: Record<pid,true>, seq }`.

**Actions** (`actions.ts`, réseau-safe — portent `playerId`) : `ENGAGE_GUARDIAN` (réutilisé pour
`executioner` via `siteSteps`), `CLEAR_EXECUTIONER`, `REINFORCE_SHIP`/`UPGRADE_ENGINE`, `BOARD_SHIP`,
`LIFT_OFF` (gaté coque min + tous à bord + confirmation), `FLIGHT_FIRE` (cooldown/joueur, calque `ATTACK`).

**Reducer** — phase **TICK 9) VOL** après *7) SURVIE*, avant *8b) COMBAT* (~`reducer.ts:1369`) : avance
l'altitude, spawn astéroïdes seedés (`cloneRng` lazy copy-on-write), descend les débris, collision →
dégâts coque, escape/crash. Survie/rencontres au sol suspendues pendant le vol.

**Réseau** — flux rapide de positions d'astéroïdes (réutilise `broadcastEnemies`/interpolation M8.6) ;
le reste voyage dans le snapshot.

**Rendu** — beacon sur l'épave (déjà émissive) ; build via `reveal.ts` ; ascension in-world (caméra
cinématique + bascule skybox + débris instanciés on-rails) ; fin via overlay HUD.

## Découpage (chaque phase laisse l'arbre vert)
- **E1 — Le signal & le cuirassé scripté** *(M)* : gantelet `executioner` (`siteSteps`/gardiens),
  `CLEAR_EXECUTIONER` (gate : tous gardiens vaincus → cache d'alliage + `executioner_cleared` →
  `ship_revealed`), événement « signal » one-shot, focus de site (forcer/piller). Jouable seul.
- **E2 — Réparer le vaisseau** *(M)* : interaction à l'épave, `REINFORCE_SHIP`/`UPGRADE_ENGINE`,
  assemblage visuel (reveal), gate de décollage + confirmation point-of-no-return. Tests purs.
- **E3 — Le décollage (climax extraction)** *(L)* : `flight` sim déterministe (phase TICK 9),
  `FLIGHT_FIRE`, astéroïdes seedés, coque/altitude, crash/retry, embarquement « attend tout le monde »
  + compte à rebours ; rendu ascension + débris instanciés + caméra + audio (stub pistes). Le gros morceau.
- **E4 — Fin, prestige & co-op** *(M)* : écran de fin/crédits, prestige/NG+ (reset graine + report perks
  + compteur), synchro co-op de la fin.
- **E5 — Vérif & docs** *(S)* : tests purs (raid, économie anti-softlock, vol déterministe replay 2
  joueurs), e2e (`/tp ship` existe → décollage → fin via hooks `__game`), preview SP + 2 onglets,
  docs (etat/roadmap-v2), commits atomiques.

## Pièges anticipés
- **Déterminisme du vol** : inputs = actions seedées-safe, astéroïdes via `state.rng` → `reduceAll ×2`
  identique. Interpolation côté client uniquement.
- **Softlock économique** : vérifier qu'avec le troc on peut TOUJOURS atteindre la coque min.
- **Co-op** : solo doit marcher (hôte seul) ; le vaisseau attend tout le monde (compte à rebours).
- **Perf** : astéroïdes en instances/SPS + pooling + comptage borné + on-rails (zéro physique) ;
  pré-chauffer les pools (anti-hitch GC).
- **Migration d'hôte en plein vol** : `flight` dans le snapshot → le nouvel hôte continue.
- **`main.ts` god-object** : E3 l'alourdit → isoler le vol dans `src/sim/flight.ts` + `src/render/liftoff.ts`
  (ou faire A6 d'abord).

## Vérification (à chaque phase)
1. `npm run typecheck` · 2. `npm run test` (tests purs + replay déterministe) · 3. `npm run e2e`
   (`/tp ship` → décollage → fin) · 4. **preview SP + 2 onglets** (raid co-op, décollage groupé) ·
   5. docs (etat/roadmap-v2) + commits atomiques (scan secrets + Conventional Commits).
