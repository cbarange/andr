# M11 — Refonte du DÉCOLLAGE : pilotage immersif 3D (esquive)

> **But.** Rendre la phase de décollage *jouée* (le mini-jeu spatial) beaucoup plus **interactive et
> immersive** : on **PILOTE** le vaisseau — on se déplace gauche/droite (et haut/bas) pour **ESQUIVER**
> les astéroïdes pendant l'ascension, fidèle au jeu original, adapté à la 3D et au co-op host-autoritaire.
>
> **Statut.** Proposition + design (cette doc) → mise à jour roadmap → implémentation (phase **RF8**).
> Révise la décision d'origine M11/E3 (« extraction allégée » = ascension + *tirer* sur les débris,
> sans déplacement) vers un **vrai pilotage d'esquive**.

---

## 0. Le problème (état actuel, M11/E3)

Aujourd'hui le décollage (`src/sim/flight.ts` + `src/render/liftoff.ts`) est **on-rails passif** : le
vaisseau monte tout seul (`progress` 0→1), des astéroïdes apparaissent (`impactAt`), et l'unique
interaction est **TIRER** (`FLIGHT_FIRE`, touche E) sur le débris le plus urgent avant l'impact. On ne
**bouge pas** le vaisseau. Résultat (playtest) : peu immersif, pas le « pilotage » attendu.

---

## 1. Analyse du jeu original (A Dark Room — `script/space.js`)

*(Recherche sous-agent sur `doublespeakgames/adarkroom`, corroborée par le wiki ADR.)*

- **Pilotage LIBRE en 2D** : flèches **ou** ZQSD/WASD, **4 directions** (gauche/droite **et** haut/bas,
  diagonales normalisées). Touches **maintenues** (held). Vitesse = `SHIP_SPEED(3) + thrusters` (base 1).
  Mouvement **delta-time** (`dx *= dt/33`) → fluide. Aire de jeu bornée (`[10,690]` px) : un **vrai champ
  d'esquive**, pas un couloir.
- **Astéroïdes** : glyphes ASCII (`# $ % & H`), apparaissent en haut à un **X aléatoire**, **tombent**
  tout droit. Durée de traversée **525–1500 ms** (aléatoire par rock). Cadence d'apparition =
  `1000 − altitude*10` ms (1000 ms à alt 0 → ~400 ms à alt 60).
- **Densité = le vrai pic de difficulté** : par tic d'apparition, **+ d'astéroïdes simultanés** selon
  l'altitude — `≤10 : 1` · `>10 : 2` · `>20 : 4` · `>40 : 6` (commentaires source : `// HAAAAAARDERRRRR`).
- **Collision** : test point-vaisseau dans la boîte de l'astéroïde → `hull--` (**1 dégât/collision**),
  l'astéroïde est **consommé** (pas de multi-hit), **pas d'i-frames**. `hull == 0` → `crash()`.
- **Altitude** : `+1 / seconde` (temps pur, ~**60 s** de vol). Bandes : Troposphère→…→Espace (alt 60).
- **WIN** : `altitude > 60` → évasion (fin du jeu). **LOSE** : `hull 0` → `crash()` → retour à l'écran
  **Ship** (réparer/relancer) + **cooldown 120 s**. **Moteur (thrusters)** : augmente la **vitesse**
  d'esquive (seul moyen de tenir quand 6 rochers/tic arrivent). **Coque** : nombre d'erreurs tolérées.
- **Feel** : ~60 s, montée calme → 4 paliers d'escalade → mur de glyphes final ; musique qui s'efface
  (`vol = 1 − alt/60`), pitch des impacts qui monte. Horloge fixe = tension monotone, **résolution garantie**.

**Essence à préserver** : un **gantelet d'esquive de durée fixe, à escalade, avec climax garanti**.

---

## 2. Proposition — pilotage d'esquive en 3D

### 2.1 Principe
On garde le **plan d'esquive 2D** d'ADR (X = gauche/droite, Y = haut/bas) et on ajoute la **profondeur
comme axe d'ascension** : les astéroïdes **foncent vers le vaisseau le long de −Z** (ils « tombent » vers
nous), et on **déplace le vaisseau dans le plan X/Y** pour les éviter. La 3D rend le « temps avant impact »
viscéral (les rochers grossissent en approchant). C'est la traduction 1:1 du champ 2D d'ADR.

- **Esquive = mécanique PRIMAIRE** (la demande du joueur : se déplacer pour éviter).
- **Tir = support SECONDAIRE** (on **conserve** `FLIGHT_FIRE` : un « dernier recours » à cooldown pour
  pulvériser un rocher qu'on ne peut plus esquiver ; plus de pilotes = plus de canons). Dodge d'abord,
  tir si coincé.
- **Corridor borné** : un **tube** d'ascension ; la position du vaisseau est clampée au rayon du tube
  (flash de bord si on touche la limite). Le joueur ne sort jamais du champ.

### 2.2 Co-op — qui pilote ? `[À TRANCHER §10]`
Vaisseau & coque **partagés**. Trois modèles (cf. analyse) :
- **A. Pilote unique + rôles support (recommandé baseline)** : un joueur pilote (esquive) ; les autres
  ont des verbes de support (TIRER pour dégager une voie, dépenser de l'alliage pour réparer +1 coque en
  vol, bouclier bref). *Déterministe trivial, feel précis, social.* Choix du pilote = 1er embarqué / hôte.
- **B. Esquive PARTAGÉE (tous pilotent, entrées sommées/clampées)** : tout le monde infléchit le vaisseau.
  *Tous actifs ; mais peut « tirer à hue et à dia » (mou).* OK en mode « party » ; à pondérer (pilote 70 %).
- **C. Contrôles répartis (chacun un axe/sous-système)** : forte coopération forcée ; mieux à 2 ; variante
  « pilote + canonnier + ingénieur » plus tolérante.

**Recommandation** : **B en SOLO devient un pilotage propre** (un seul steerer) ; en co-op, baseline **A**
(un pilote autoritaire + support TIR/répa), avec **B pondéré** ou **C** en option « co-op musclé ». Dans
tous les cas l'hôte simule à partir d'un **flux d'entrées déterministe** → sim reproductible.

> Le plus simple à livrer d'abord (RF8a) : **esquive partagée sommée** (marche en solo ET en co-op, zéro
> désignation de pilote), tuning généreux (i-frames, hitbox indulgente). On affinera vers A si le co-op
> « mou ».

### 2.3 Caméra & immersion (3D)
- **Caméra de poursuite** derrière/sous le vaisseau, regardant **vers le haut** la colonne d'ascension ;
  les astéroïdes **strient** vers le vaisseau (parallaxe, grossissement). Léger **bank** du vaisseau quand
  on steer (retour visuel). Shake + FOV qui montent avec l'altitude (climax). Étoiles + atmosphère qui
  s'amincit ; audio qui s'efface (`1 − alt/maxAlt`, fidèle).
- Réutilise la machinerie de cinématique existante (`liftoff.ts` pilote déjà la caméra pendant le vol).

---

## 3. Modèle de données (sim) — extension de `SharedFlight`

`src/sim/state.ts` `SharedFlight` (additif, volatile, déjà strippé save) :
```ts
// AJOUTS (RF8) :
shipX: number; shipY: number;          // position du vaisseau dans le plan d'esquive (host-intégrée)
steer: Record<string, { x: number; y: number }>; // entrée de pilotage PAR JOUEUR (−1..1), comme playerPos
lastHitAt: number;                      // tic du dernier impact (i-frames co-op)
// asteroids[] passe de {id, impactAt} à :
asteroids: Array<{ id: number; x: number; y: number; impactAt: number; seq: number }>; // x,y = voie (seedés)
```
- `shipX/shipY` : intégrés par l'hôte chaque tic depuis l'agrégat de `steer` (somme triée par pid, clampée
  au tube). Vitesse = `baseSteerSpeed * (1 + engine * engineSteerBonus)` (le moteur = esquive plus vive,
  fidèle thrusters).
- `asteroids[].x/y` : **tirés à la graine** (`state.rng`, déjà déterministe) à l'apparition → host & clients
  identiques. Pas de `Math.random`.
- Tout reste **PUR** : `stepFlight` lit `steer`, intègre `shipX/Y`, teste les collisions par position.

### Actions
```ts
// Entrée de pilotage maintenue, ~10 Hz (comme SET_POSITIONS) — réseau-safe.
export type SteerAction = { type: "STEER"; playerId: string; x: number; y: number };
```
- `FLIGHT_FIRE` **conservé** (tir de support). `STEER` ajouté aux unions + factory. Host agrège.

### Reducer / `stepFlight` (révisé)
```
ascending :
  progress += 1/ascentTicks(engine)                    // horloge fixe (≈ alt +1/s), inchangé
  // 1) PILOTAGE : intègre la position depuis l'agrégat steer (clamp au tube)
  (vx,vy) = sum_aboard(steer[pid]) ; shipX/Y += vx/vy * steerSpeed(engine) * dt ; clamp(radius)
  // 2) SPAWN seedé : interval = spawnBase - alt*spawnAccel ; count = 1/2/4/6 selon paliers d'alt
  for k in spawnCount(alt): x,y = seeded lane ; asteroids.push({x,y,impactAt:tick+leadTicks(alt)})
  // 3) COLLISION par POSITION (à l'impact) : si |asteroid.xy − ship.xy| <= hitRadius ET tick>lastHitAt+iFrames
  //    -> hull-- ; lastHitAt=tick. Sinon ESQUIVÉ. Astéroïde retiré dans tous les cas.
  // 4) TIR (FLIGHT_FIRE) : détruit le rocher le plus proche devant (cooldown par joueur) — support.
  hull<=0 -> crashed ; progress>=1 -> escaped
```
- `boarding` (« le vaisseau attend tout le monde ») : **inchangé**.

---

## 4. Rendu (`src/render/liftoff.ts`) & input

- **Rendu** : vaisseau positionné à `(shipX, shipY)` dans le plan ; astéroïdes (mesh low-poly + traînée)
  qui foncent vers le vaisseau le long de +Z avec grossissement ; bank du vaisseau selon le steer ;
  caméra de poursuite ; étoiles/atmosphère ; flashs d'impact + i-frame (clignote). Interpolation cliente.
- **Input (`main.ts`)** : pendant `ascending`, les touches de **déplacement (ZQSD/flèches)** émettent
  `STEER` (au lieu du mouvement au sol) ~10 Hz ; **E = TIRER** (support, `FLIGHT_FIRE`, conservé). HUD :
  coque, altitude/bande, indicateur d'esquive. Neutralisé hors `ascending`.

---

## 5. Co-op & déterminisme (rappel des invariants)
| Host (autoritaire) | Local (par joueur) |
|---|---|
| intègre `shipX/Y` depuis `steer` agrégé ; spawn **seedé** (`state.rng`) ; collisions par position ; coque/altitude/escape/crash | rendu 3D, caméra, bank, parallaxe, flashs ; émission `STEER`/`FLIGHT_FIRE` |
- Spawns = fonction pure de `(rng, tic)` → tous les clients voient les mêmes rochers. `STEER` agrégé **trié
  par pid** (ordre stable). I-frames = simple `lastHitAt` (déterministe). `structuredClone` complet →
  migration d'hôte en plein vol OK. **Aucune** `Math.random`/`Date.now`.

---

## 6. Équilibrage (chiffres ADR portés en config `FLIGHT`)
- **Horloge** : ascension ≈ **60 s** (config `ascentSeconds`, raccourcie par le moteur).
- **Densité** : `1 / 2 / 4 / 6` astéroïdes par spawn aux paliers d'altitude `≤25% / >25% / >50% / >80%`.
- **Cadence** : intervalle de spawn qui **rétrécit** avec l'altitude.
- **Vitesse d'esquive** : `baseSteerSpeed * (1 + engine * bonus)` (moteur = clé du end-game, fidèle).
- **Dégâts** : **1 coque/collision** (fidèle ADR, ≠ 2 actuel) + **i-frames ~0,5 s** (ajout co-op, anti
  pile-up injuste). **Hitbox indulgente** (co-op). Tir support : cooldown par joueur.
- **Crash** : `hull 0` → retour au **vaisseau du camp** (réparer/relancer), comme aujourd'hui.

---

## 7. Phasage (chaque étape laisse l'arbre VERT)
- **RF8a — Sim pilotage** : `SharedFlight` étendu (shipX/Y, steer, asteroids x/y, i-frames) ; action
  `STEER` ; `stepFlight` révisé (intégration position + spawn seedé + collision par position + tir
  support). **Tests purs** : intégration/clamp, spawn seedé déterministe, esquive vs collision, i-frames,
  densité par palier, replay, réseau-safe. *(Pas de visuel ; testable headless.)*
- **RF8b — Rendu/caméra/input** : `liftoff.ts` (vaisseau steerable + astéroïdes 3D + caméra de poursuite +
  bank + flashs) ; câblage input `STEER`/`FLIGHT_FIRE` pendant `ascending` ; HUD. Vérif preview + e2e.
- **RF8c — Co-op & polish** : modèle de pilotage co-op retenu (A pondéré / B / C), audio spatial, tuning
  du feel (durées, densité, i-frames) — **affiné en playtest**.

## 8. Acceptation
- On **déplace** le vaisseau (gauche/droite + haut/bas) pour **esquiver** ; les rochers ratés ne touchent
  pas, ceux touchés coûtent 1 coque ; le moteur rend l'esquive plus vive ; 60 s d'escalade jusqu'à
  l'évasion ; crash → réparer/relancer. Co-op cohérent (vaisseau partagé), **replay déterministe**.

## 9. Réutilisation
| Existant | Réutilisé pour RF8 |
|---|---|
| `SharedFlight` / `stepFlight` (`flight.ts`) | étendu (position, steer, collision par position) |
| `boarding` (« attend tout le monde ») | inchangé |
| `FLIGHT_FIRE` + cooldown par joueur | tir de **support** |
| `SET_POSITIONS` (flux ~10 Hz host) | patron pour `STEER` |
| `liftoff.ts` (caméra cinématique de vol) | base de la caméra de poursuite |
| `state.rng` (seedé, déterministe) | spawns d'astéroïdes |

## 10. Décisions à trancher (avant RF8)
1. **Pilotage co-op** : B sommé d'abord (simple, solo+co-op) puis A si « mou » ? ou viser A direct ?
   *(reco : B sommé pondéré d'abord.)*
2. **Axes** : gauche/droite **+ haut/bas** (fidèle ADR) ? ou seulement gauche/droite (la demande
   minimale) ? *(reco : les deux — plus immersif, fidèle.)*
3. **Garder le TIR de support** ? *(reco : oui — indulgence + valorise le co-op/munitions.)*
