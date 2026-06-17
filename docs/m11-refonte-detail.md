# M11 — REFONTE : SPEC D'IMPLÉMENTATION DÉTAILLÉ (compagnon de la roadmap)

> **Statut : SPEC TECHNIQUE À FAIBLE AMBIGUÏTÉ.** Document compagnon de
> [`m11-refonte-roadmap.md`](m11-refonte-roadmap.md) (l'aperçu / source de périmètre). Ici : modèle de
> données, actions, reducer, rendu, wiring `main.ts`, équilibrage chiffré, co-op/déterminisme, tests et
> ordre d'implémentation — ancrés sur `file:line` réels et signatures **exactes** au 2026-06.
> NE remplace PAS la roadmap (§0-§10, RF1→RF7) : il la complète.
>
> Convention : **DÉCISION PROPOSÉE** = tranché ici avec argument (le dev peut suivre). **QUESTION AU
> PORTEUR** = vrai arbitrage produit restant. Étiquettes inline `[DP]` / `[Q]`.

## 0. Carte du code existant (ancrage `file:line`)

| Sujet | Référence | Note |
|---|---|---|
| État pur | `src/sim/state.ts:18` (`GameState`) ; `ship` `:148` ; `flight` `:153` ; `prestige` `:157` ; `SharedFlight` `:165` ; `SharedEncounter` `:188` ; `SiteProgress` `:231` ; `createInitialState` `:373` | additifs back-fillés au boot |
| Actions union | `src/sim/actions.ts:388` (`GameAction`) / `:444` (`PlayerAction`) ; `isNetworkSafeAction` `:501` | refuse `DEBUG_*` + usurpation `playerId` |
| Reducer | `src/sim/reducer.ts:190` (`reduce`) ; `CLEAR_EXECUTIONER` `:490` ; `REINFORCE_SHIP` `:513` ; `UPGRADE_ENGINE` `:525` ; `LIFT_OFF` `:536` ; `ENGAGE_GUARDIAN` `:866` ; `ATTACK` `:917` ; `TICK` `:1254` (phases 0-9) ; phase 8b combat `:1483` ; phase 9 vol `:1589` | TICK = hôte seul |
| Donjons | `src/sim/dungeon.ts:70` (`dungeonFor`) ; `caveSteps` `:218` ; `townSteps` `:320` ; `lootForNode` `:326` ; `lootNodeIds` `:332` ; `CaveStep` `:170` | PUR, dérivé `worldSeed` |
| Vol | `src/sim/flight.ts:46` (`stepFlight`) ; `mostUrgentAsteroid` `:27` ; `ascentTicks` `:36` | aucun RNG (vagues fixes) |
| Données | `data/world.ts` : `SHIP` `:339` ; `FLIGHT` `:350` ; `mineGuardians` `:323` ; `EXECUTIONER_ALLOY_REWARD` `:334` ; `enemies` `:231` ; `sites` `:328` ; `campLayout` `:523` ; `generateCampLayout` `:481` ; `PERKS` `:158` ; `ARMOR_HEALTH` `:151` | seule source de contenu |
| Intérieurs | `src/render/interior.ts:66` (`Interiors`) ; `INTERIOR_TYPES` `:27` ; `build` `:215` ; `buildShell` `:280` ; `update` `:159` ; gating torche/barrière `:184` ; `activeLoot` `:140` ; obscurité locale `:200` | un seul actif, build/free hystérésis |
| Modèles sites | `src/render/sites.ts:220` (`ship`) / `:279` (`executioner`) | low-poly, ~26 u executioner |
| Kit / persos | `src/render/lowpoly.ts:23` (`P` palette, accents alien `:44`) ; `src/render/characters.ts:33` (`buildHumanoid`) `:164` (`buildBeast`) `:190` (`buildLizard`) `:210` (`buildBird`) | flat-shaded, rig animable |
| Décollage rendu | `src/render/liftoff.ts:30` (`Liftoff`) ; `FlightView` `:20` | cinématique purement locale |
| Cabane reveal | `src/render/cabin.ts` (pattern montée pièce par pièce) | à réutiliser pour vaisseau au camp |
| Wiring | `src/main.ts` : `computeFocus` `:1030` ; `shipView` `:810` ; `liftoffConfirmView` `:843` ; focus executioner `:1239` / ship `:1269` ; `dangerTier` `:1445` ; `biomeStr` `:1458` ; FPV `:1361-1938` ; hooks `__game` `:2102` | rendu local |
| Save | `src/save.ts:21` (strip volatils) ; `VERSION` `:11` (=2) ; back-fill au boot via spread `:31-34` | `carried/survival/encounters/playerPos/drops/flight` strippés |

**Fait de fidélité déjà conforme dans la base :** `SHIP`/`FLIGHT` existent et marchent (E2/E3/E4). **Écart
principal à corriger (RF1) :** `CLEAR_EXECUTIONER` (`reducer.ts:490`) gate `ship_revealed` derrière le
cuirassé (`:508`), et `REINFORCE_SHIP`/`UPGRADE_ENGINE` exigent `ship_revealed` (`:516`,`:527`).
L'interaction vaisseau est au **bord du monde** (`main.ts:1269`), pas au camp.

---

## RF1 — Fidélité du flux de fin (dé-gater + vaisseau au camp) — **S/M, priorité 1**

### Objectif
Dé-coupler le petit vaisseau du cuirassé (fidèle ADR : `World.state.ship = true` sans condition) et
déplacer l'interaction de réparation/décollage **au camp**. L'épave au bord devient une **scène de
découverte**.

### Modèle de données

Renommage sémantique du flag de progression. On garde `perks` comme porteur (persisté, jamais affiché).

| Flag (clé `perks`) | v1 | RF1 | Sémantique |
|---|---|---|---|
| `ship_found` | — (nouveau) | **posé par `DISCOVER_SHIP`** (atteindre l'épave) | « le vaisseau d'évasion existe, gérable au camp » |
| `ship_revealed` | posé par `CLEAR_EXECUTIONER` | **alias de `ship_found`** (migration) | conservé en lecture pour compat ; on bascule les gardes sur `ship_found` |
| `executioner_cleared` | posé par `CLEAR_EXECUTIONER` | inchangé | débloque le Fabricator (RF7), n'affecte PLUS le vaisseau |

`[DP]` **Ne pas créer un champ booléen dédié dans `GameState`** : réutiliser `perks` (déjà additif +
persisté + dans le snapshot, cf. `state.ts:143`). Aucun bump de `state.ts`/save VERSION. Pour la compat
save, back-fill au boot : si `perks.ship_revealed` existe sans `ship_found`, poser `ship_found` (1 ligne
dans le bloc spread de `main.ts`).

Aucune nouvelle structure. `state.ship` (`state.ts:148`) reste possession du village (persisté) — déjà
correct.

### Actions

Nouvelle action **`DISCOVER_SHIP`** (l'épave atteinte pose `ship_found`). Modèle :

```ts
// src/sim/actions.ts
export type DiscoverShipAction = { type: "DISCOVER_SHIP"; playerId: string; cx: number; cz: number };
export function discoverShip(playerId: string, cx: number, cz: number): DiscoverShipAction {
  return { type: "DISCOVER_SHIP", playerId, cx, cz };
}
```

- Ajout aux unions `GameAction` (`actions.ts:388`) **et** `PlayerAction` (`:444`).
- **Réseau-safe : OUI** (porte `playerId`, pas de préfixe `DEBUG_`). Pas host-only.
- `LIFT_OFF`/`REINFORCE_SHIP`/`UPGRADE_ENGINE`/`FLIGHT_FIRE`/`END_FLIGHT`/`PRESTIGE` : **inchangés**
  (déjà corrects). Seules leurs gardes `ship_revealed` deviennent `ship_found`.

### Reducer

1. **Nouveau `case "DISCOVER_SHIP"`** (modèle sur `DISCOVER_SITE` `reducer.ts:389`) :
   ```
   key = siteKey(cx,cz); prog = sites[key] ?? {}
   if perks.ship_found return state                  // idempotent
   sites[key] = { ...prog, type: "ship", discovered: true }
   perks = { ...perks, ship_found: true, ship_revealed: true }  // alias compat
   return { ...state, sites, perks, rng: cloneRng(state.rng) }  // pas de RNG consommé
   ```
2. **`CLEAR_EXECUTIONER` (`:490`)** : RETIRER `ship_revealed` du retour ; **conserver**
   `executioner_cleared: true` + le cache d'alliage (`EXECUTIONER_ALLOY_REWARD`). Le pillage du cuirassé
   ne révèle plus le vaisseau (il livre seulement l'alliage + déblocage Fabricator).
   - `[DP]` Garder le cache d'alliage de la soute (`world.ts:334`) : c'est une **grosse source parallèle
     d'alliage**, fidèle à l'esprit ADR (cité/forages/champs). Migration RF2 transforme ce reward en
     butin réparti par aile (cf. RF2 §Données).
3. **`REINFORCE_SHIP` (`:516`)** / **`UPGRADE_ENGINE` (`:527`)** / **`LIFT_OFF` (`:539`)** : remplacer
   `state.perks["ship_revealed"]` par `state.perks["ship_found"]` (lecture seule). Aucun autre changement.
4. TICK : aucune nouvelle phase.

### Rendu

- **`src/render/cabin.ts` (réutilisé) + `src/render/sites.ts:220` (`ship`)** : un nouveau composant
  `render/shipCamp.ts` (classe `ShipAtCamp`) qui **assemble le vaisseau au camp** au fil de `state.ship.hull`
  (montée pièce par pièce, pattern reveal de la cabane). Le mesh est le `ship-arrow` de `sites.ts:220`
  (extrait en fonction réutilisable `buildShipArrow(K, parent)`).
- **Ancre camp** : ajouter une ancre `ship` dans `campLayout.buildings` (`world.ts:534`). `[DP]` La poser
  au **quartier industrie/sud** dégagé, `{ x: cos(QUARTER.industry)·24, z: sin(...)·24, face: "south" }`
  — assez loin du feu (≥ 20 u) pour un gros mesh, visible à l'arrivée au camp. Réutiliser
  `generateCampLayout`/relaxation (`world.ts:481`) en ajoutant `ship` aux `SINGLE_BUILDINGS` avec un
  `minD` élargi (≈ 6).
- Le mesh décoratif **au bord du monde** (`sites.ts:220`) RESTE (c'est l'épave de découverte) mais devient
  visuellement « morte » (pas de glow drive) une fois `ship_found` — détail cosmétique.

### main.ts / wiring

- **Découverte (bord)** : focus `examiner l'épave` (`main.ts:1269`). RF1 : quand le joueur arrive à
  portée de l'épave et que `!perks.ship_found`, émettre **`discoverShip`** (au lieu d'orienter vers le
  cuirassé). Toast : « cet appareil pourrait voler — ramenez-le à l'esprit : il vous attend au camp. »
  Ensuite l'épave au bord n'offre plus que de la lore.
- **Interaction camp** : déplacer `shipView` (`main.ts:810`) pour qu'il s'ouvre depuis l'**ancre camp**
  (focus near `ShipAtCamp` quand `ship_found`), pas depuis le bord. `shipWorldPos()` (`:806`) renvoie
  l'**ancre camp** (et non l'épave) pour `LIFT_OFF` → le décollage part du camp. La cinématique
  `liftoff.ts` est inchangée (part de `flight.x/z`).
- `__game.liftOff` (`main.ts:2130`) : pointer sur l'ancre camp.

### Données / équilibrage

- `SHIP` (`world.ts:339`) inchangé : `hullMax 20`, `engineMax 3`, `liftoffHullMin 5`, `alloyPerHull 1`,
  `alloyPerEngine 1`. **Caps conservés** `[DP]` (cf. §8.2 roadmap) mais **exposés en config** (déjà le
  cas) ; ADR n'a pas de cap (limité par l'alliage). `[Q]` Lever les caps pour fidélité stricte ? → garder.

### Co-op / déterminisme

- `DISCOVER_SHIP` host-autoritaire (passe par `emit` → hôte). `ship_found` dans `perks` (snapshot +
  persisté) → vu par tous, survit au reload. Aucun RNG → replay trivialement déterministe.
- `ShipAtCamp` (rendu) = **local**, lit `state.ship.hull` → zéro désync.

### Acceptation + tests

- **Accept.** : réparer + décoller **sans toucher au cuirassé**, **depuis le camp** ; alliage de
  n'importe quelle source (forage/cité/champ) suffit ; pillage du cuirassé donne alliage **sans** être
  requis.
- **Tests purs** (`src/sim/sim.test.ts`) :
  - `discoverShip pose ship_found et ship_revealed (alias), idempotent`.
  - `reinforceShip réussit avec ship_found sans executioner_cleared` (1 alliage → hull+1).
  - `clearExecutioner NE pose PAS ship_found/ship_revealed mais pose executioner_cleared + alliage`.
  - `liftOff gaté sur ship_found && hull>=5, pas sur le cuirassé`.
  - `replay déterministe : [DISCOVER_SHIP, REINFORCE_SHIP×5, LIFT_OFF, TICK×N] → même état` (reduceAll).
- **e2e (`__game`)** : `grantPerk("ship_found")` → `reinforceShip()` → `getShip().hull===1` ;
  `liftOff()` → `getFlight().status==="boarding"`.

### Migration v1 / save
- Compat save : aucun bump VERSION (additif). Back-fill `ship_found := ship_revealed` au boot.
- Garde : retirer la dépendance `CLEAR_EXECUTIONER → ship_revealed`. Les vieilles parties ayant déjà pillé
  le cuirassé gardent `ship_revealed` → back-fill donne `ship_found` → vaisseau gérable comme avant.

### Effort : **S/M**. Dépendances : aucune (à faire en premier).

---

## RF2 — Cuirassé explorable : salles + portes + arènes verrouillées — **L/XL, cœur**

### Objectif
Transformer le gantelet de 5 combats (`mineGuardians.executioner`, `world.ts:330`) en **donjon
multi-salles** : antichambre (hub) → 3 ailes (ingénierie/martiale/médicale) → pont (gaté sur les 3 ailes),
avec **combat d'arène verrouillée** par salle (host-autoritaire). `[DP §8.4]` **version condensée
d'abord** : 1 antichambre + 3 ailes (1 salle de combat chacune + boss) + 1 pont. Extensible plus tard.

### Modèle de données

**Nouveau type de donjon** dans `sim/dungeon.ts` : un graphe de **salles** (≠ l'anneau+couloirs continu
des grottes). On étend `Dungeon` avec des champs optionnels (additifs au type, pas à `GameState`) :

```ts
// src/sim/dungeon.ts — additions
export type RoomId = "antechamber" | "engineering" | "martial" | "medical" | "bridge";
export interface DungeonRoom {
  id: RoomId;
  pos: { x: number; z: number };   // centre LOCAL (origine = sas d'entrée du cuirassé)
  size: { w: number; d: number };  // emprise rectangulaire de la salle (u)
  wing?: "engineering" | "martial" | "medical"; // les 3 ailes
  isHub?: boolean;                 // antichambre
  isBridge?: boolean;              // pont (gaté)
  enemies: Array<{ enemyId: string; count: number }>; // vague de la salle (host)
  loot: Record<string, number>;    // butin de fin de salle (drop au sol après clear)
  gatesBridge?: boolean;           // poser le flag d'aile à la fin de cette salle
}
export interface DungeonDoor { from: RoomId; to: RoomId; }
export interface ShipDungeon { type: "executioner"; rooms: DungeonRoom[]; doors: DungeonDoor[]; }
export function executionerDungeon(cx: number, cz: number, worldSeed: number): ShipDungeon { /* scripté + seedé */ }
```

`executionerDungeon` est **déterministe** (seed = `dungeonSeed("executioner", cx, cz, worldSeed)`,
`dungeon.ts:55`) : layout des salles fixe (scripté pour un climax — best-practice roadmap §5), seul le
**butin** des salles est tiré à la graine (comme les grottes). Host et clients le recalculent à
l'identique sans le streamer.

**État de progression du cuirassé** : étendre `SiteProgress` (`state.ts:231`) — **additif**, strippé save
comme le reste de `sites`. NB : `sites` n'est **pas** strippé à la save (`save.ts:21` ne l'inclut pas dans
les volatils) → la progression cuirassé **persiste** (souhaitable : une mort ne remet pas le raid à zéro,
cf. commentaire `world.ts:330`).

```ts
// SiteProgress additions (state.ts:231)
/** Cuirassé (RF2) : état d'arène par salle. roomId -> "locked" | "cleared". */
rooms?: Record<string, "locked" | "cleared">;
/** Cuirassé : ailes terminées (gate du pont). */
wings?: Record<"engineering" | "martial" | "medical", true>;
```

`cleared` global de `SiteProgress` reste : posé quand le **pont** est nettoyé (cuirassé fini → route +
masque le modèle, comme une grotte cleared).

### Actions

Trois actions (réutilisent l'infra `SharedEncounter` / `ATTACK` de M8.6 — aucun nouveau système de combat) :

```ts
// ENTRER dans une salle : déclenche le verrou + le spawn (host valide l'entrée).
export type EnterRoomAction = { type: "ENTER_ROOM"; playerId: string; cx: number; cz: number; room: string };
// (Le combat se fait via ATTACK existant sur les SharedEncounter spawnés.)
// La salle se CLEAR automatiquement quand toutes ses encounters meurent (TICK host) — pas d'action.
```

- `[DP]` **Pas d'action `CLEAR_ROOM`** : la transition `locked → cleared` est **émergente** dans TICK
  (host), quand il ne reste aucune encounter taguée à cette salle. Évite la triche/désync (le client ne
  décide pas qu'une salle est vide).
- Ajout `ENTER_ROOM` aux unions `GameAction` + `PlayerAction`. **Réseau-safe : OUI**. Pas host-only.
- `ENGAGE_GUARDIAN` (`reducer.ts:866`) / `CLEAR_EXECUTIONER` (`:490`) sur le cuirassé : **retirés du
  flux** (migration RF2). `CLEAR_EXECUTIONER` reste pour compat save mais n'est plus émis par
  `main.ts:1257` ; à terme on le rend no-op ou on le mappe sur « pont cleared » (cf. migration).

### Reducer

**`case "ENTER_ROOM"`** :
```
key = siteKey(cx,cz); prog = sites[key] ?? {}
room = executionerDungeon(cx,cz,worldSeed).rooms.find(r => r.id === action.room)
if !room return state
if prog.rooms?.[room.id] return state               // déjà locked ou cleared -> no-op
// GATE PONT : le bridge exige les 3 ailes.
if room.isBridge && !(prog.wings?.engineering && prog.wings?.martial && prog.wings?.medical) return state
// Verrou + spawn de la vague (encounters PARTAGÉES ancrées au centre-monde de la salle).
rooms = { ...prog.rooms, [room.id]: "locked" }
encounters = { ...state.encounters }
nextEncId = state.nextEncId
for (enemyId, count) of room.enemies:
  for i in count:
    enemy = enemyById[enemyId]; c = roomWorldCenter(cx,cz,room) + spreadOffset(i)  // déterministe
    id = `exec:${key}:${room.id}:${i}`                 // id stable, host-only spawn
    encounters[id] = { enemyId, enemyHp: enemy.hp, x,z, enemyNextAt: tick + strikeTicks,
                       weaponReadyAt:{}, seq: nextEncId++, siteKey:key, siteType:"executioner",
                       roomId: room.id, noFlee: true }  // ARÈNE : pas de laisse (engagement forcé)
return { ...state, sites:{...sites,[key]:{...prog,type:"executioner",discovered:true,rooms}}, encounters, nextEncId, rng: cloneRng(state.rng) }
```
- Ajouter le champ optionnel `roomId?: string` à `SharedEncounter` (`state.ts:188`) — additif, strippé
  (encounters volatils).
- `noFlee: true` réutilise le comportement existant (`reducer.ts:1534` désactive la laisse) → l'ennemi ne
  décroche pas si le joueur sort de portée → **engagement forcé** = arène. Les portes « scellées » sont
  rendues côté local (RF5) ; côté sim, le verrou EST le `noFlee` + les portes fermées rendues.

**TICK — nouvelle phase 8e (juste après 8d butin, `reducer.ts:1587`)** — **clear de salle + gate des
ailes** (host, pas de RNG sauf via `ATTACK` qui drope déjà le butin) :
```
// Pour chaque site cuirassé ayant des salles "locked" :
for key in sites where sites[key].type==="executioner":
  for roomId in sites[key].rooms where value==="locked":
    // reste-t-il une encounter de cette salle ?
    alive = any enc in encounters where enc.siteKey===key && enc.roomId===roomId
    if !alive:
      rooms[roomId] = "cleared"
      room = executionerDungeon(...).rooms.find(id===roomId)
      if room.wing: wings[room.wing] = true                 // gate du pont
      if room.isBridge: cleared global = true ; roads = drawRoad(...)  // cuirassé fini
      // butin de fin de salle -> drop AU SOL au centre (premier-servi), si non vide
      if room.loot: drops[`exec:${key}:${roomId}`] = { x,z, loot, despawnAt: tick + DROP_DESPAWN_TICKS }
```
- Le butin individuel des ennemis tombe déjà via `ATTACK` (`reducer.ts:952`). Le `room.loot` = bonus de
  fin de salle (alliage des ailes / blueprints / fleet beacon au pont — cf. RF3/RF6).
- **`fleet beacon`** (RF6) : `room.loot` du **bridge** = `{ "fleet beacon": 1 }` → tombe au sol au clear
  du pont, ramassable.

**Migration `CLEAR_EXECUTIONER`** : devient no-op si le cuirassé est déjà géré par salles ; conservé pour
ne pas casser les vieilles saves (back-fill : si `sites[key].cleared && !rooms`, considérer toutes les
salles cleared).

### Rendu

**Étendre `src/render/interior.ts`** — c'est le gros morceau. Aujourd'hui : un anneau + couloirs continus,
un seul intérieur actif. Pour le cuirassé :

- Ajouter `"executioner"` à `INTERIOR_TYPES` (`interior.ts:27`).
- **Machine d'état de salle (local)** : nouveau module `render/shipInterior.ts` (classe
  `ShipInterior`) plutôt que de surcharger `Interiors` (grottes/mines). Réutilise `makeKit`, `terrainHeight`,
  le pattern build/free + obscurité locale de `Interiors`. Différences clés :
  - **Salles distinctes** : chaque `DungeonRoom` = un volume boîte (sol/4 parois/plafond, colliders),
    relié par **sas** (gaps dans les parois + porte mesh animée).
  - **Portes télégraphiées** : une porte mesh par `DungeonDoor`, couleur pilotée par l'état :
    - **verte** (`P.alienGlow`) = sas franchissable (salle adjacente `cleared` ou hub) ;
    - **rouge** (émissif rouge) = sas scellé (salle `locked` en combat) ;
    - **bleue/sombre** = sas du pont tant que `wings` incomplet.
    Lecture **locale** depuis `state.sites[key].rooms/wings` chaque frame (jamais branché sur la logique).
  - **Culling par salle** : `setEnabled(false)` sur les salles hors-champ (best-practice roadmap §5/§9,
    pas d'occlusion GPU en couloir). Une salle = une unité de rendu.
  - **Obscurité locale** : réutiliser le mécanisme `hemi`/`sun` de `interior.ts:200` (zéro désync).
- **Modèle agrandi** : la carcasse externe (`sites.ts:279`, ~26 u, `HL=26`) est **agrandie**
  `[DP]` à `HL≈60` pour contenir l'intérieur, OU (recommandé) on **garde** le mesh externe comme silhouette
  et on bâtit l'intérieur en **volume mesh autonome** posé sur le terrain (comme `interior.ts` fait pour
  les grottes : « massif creux au niveau du sol », pas de trou dans le heightmap). Le mesh externe est
  masqué quand l'intérieur est actif (cf. `interior.ts:104` `activeSiteKey`).
- **Plateau d'aplanissement** : ajouter le cuirassé à `setTerrainPlateaus` (`world.ts:588`) comme les
  grottes/mines, pour que le sol de l'intérieur coïncide avec le terrain.

**Pseudocode machine de salle (local, `ShipInterior`)** :
```
update(playerPos, dtSec, state):
  if near executioner site within BUILD_R and not built: build(dungeon)   // construit toutes les salles
  for room in rooms:
    state = sites[key].rooms[room.id]   // undefined | "locked" | "cleared"
    room.mesh.setEnabled( playerInOrAdjacent(room) )      // culling
    for door of room.doors:
      door.color = doorColorFor(state, adjacentState, wings)  // rouge/vert/bleu
      door.open = (state !== "locked")                         // animation open/close
  applyDarkness(playerInsideAnyRoom)
```

### main.ts / wiring

- **Focus `pénétrer dans le cuirassé`** au sas d'entrée (depuis dehors) → déclenche la cinématique de
  seuil (RF5) puis on est dans l'antichambre. Réutiliser le pattern focus executioner (`main.ts:1239`),
  mais l'action devient `ENTER_ROOM(antechamber)` (l'antichambre n'a pas forcément de combat — c'est un hub).
- **Focus `entrer dans l'aile X`** / `monter sur le pont` à chaque sas, depuis l'intérieur : émet
  `ENTER_ROOM(roomId)`. Si pont gaté : verbe grisé « pont scellé (3 ailes requises) ».
- Combat intérieur : le focus **`frapper`** existant (`main.ts:1042`) prend le relais sur les
  `SharedEncounter` spawnées (aucun nouveau verbe). Manger/soigner inchangés.
- Pendant le combat d'arène : les portes rouges (rendu) bloquent la sortie ; côté sim, `noFlee` empêche le
  despawn — l'équipe doit nettoyer. Quand la salle clear → portes vertes (rendu) → sortie/avancée.
- **Caméra** : auto-FPV en intérieur (réutilise `interiors.isLocalPlayerInside()` étendu, `main.ts:1887`).

### Données / équilibrage (chiffres ADR)

Ennemis aliens : ajouter à `enemies` (`world.ts:231`) en **tier 0** (setpiece, jamais aléatoire). Chiffres
ADR exacts (PV/dégât) :

| Salle | Vagues (enemyId, count) | Boss | Reward de fin de salle (`room.loot`) |
|---|---|---|---|
| Antichambre (hub) | aucune (ou 1 `chitinous horror`) | — | déblocage Fabricator (flag, RF7) |
| Ingénierie | `unruly welder`×2, `automated turret`×1 | `unstable prototype` (150 PV / 5) | `alien alloy` 1-3 |
| Martiale | `alien guard`×2, `defence turret`×1, `quadruped`×1 | `murderous robot` (250 PV / 10) | `alien alloy` 1-3 |
| Médicale | `defence turret`×1, `medic drone`×1, `unstable automaton`×1 (100 PV) | `malformed experiment` (200 PV / 5) | `stim` blueprint (RF7) |
| Pont (gaté 3 ailes) | `operative`×2 | `immortal wanderer` (500 PV / 12) | `fleet beacon` ×1 (RF6) |

Stats exactes ADR à porter (`world.ts:218` `EnemyDef`) :

| enemyId | hp | damage | hit | strikeSeconds | model | notes |
|---|---|---|---|---|---|---|
| `chitinous horror` | 60 | 1 | 0.8 | 1 | `beast` (variante alien) | rapide, nuée |
| `operative` | 60 | 8 | 0.8 | 2 | `humanoid` | ranged |
| `unstable prototype` | 150 | 5 | 0.8 | 2 | `humanoid`/robot | boss ingé |
| `murderous robot` | 250 | 10 | 0.8 | 2 | robot massif | boss martial (tank) |
| `unstable automaton` | 100 | 5 | 0.7 | 2 | robot | médical |
| `malformed experiment` | 200 | 5 | 0.6 | 2 | `beast` difforme | boss médical |
| `immortal wanderer` | 500 | 12 | 0.8 | 2 | `humanoid` flottant magenta | boss final |
| `automated turret` / `defence turret` | 60 | 8 | 0.8 | 2 | tourelle (statique) | `ranged`, ne poursuit pas |
| `unruly welder` | 30 | 4 | 0.8 | 2 | `humanoid` | ingé |
| `alien guard` | 50 | 8 | 0.8 | 2 | `humanoid` | martial |

- `loot` par ennemi : alliage/cellules (cf. `enemies` cité `world.ts:285`). Le boss du pont
  `immortal wanderer` : `room.loot` du bridge = `fleet beacon` (garanti, RF6).
- **Taille de salle** `[DP]` : `w≈20, d≈22` (assez pour 4-5 combattants + boss + esquive), parois `WALL_H≈4`
  (plus haut que grottes : vaisseau). Sas largeur ≈ 4 u (capsule r=0.34 à l'aise).
- Tourelles `[DP]` : `model: "humanoid"` statique au spawn (pas de poursuite) → réutiliser
  `stepEnemyToward` mais avec `chaseSpeed=0` (champ optionnel `EnemyDef.static?: boolean` → la poursuite la
  saute). Additif.

### Co-op / déterminisme

| Host (autoritaire) | Local (par joueur) |
|---|---|
| `ENTER_ROOM` valide entrée + verrou + spawn (TICK) ; clear de salle (phase 8e) ; gate des ailes/pont ; butin de fin de salle ; layout/seed des salles | culling par salle (`setEnabled`) ; couleur/animation des portes ; obscurité ; FPV ; cinématique de seuil ; minimap |
| `executionerDungeon` PUR → host et clients identiques | rendu lit `sites.rooms/wings` (snapshot) sans écrire |

- **Désync évitée** : le `noFlee` + le spawn host-only (ids stables `exec:key:room:i`) → pas de double
  spawn. Le clear est dérivé de `encounters` (snapshot complet `structuredClone`, host) → tous les clients
  voient la même salle vidée. Wind-up d'attaque (RF3) envoyé tôt.
- **Co-op « ne pas couper l'équipe »** (roadmap §2.2) `[DP]` : le verrou (`noFlee`) ne s'arme **qu'à
  l'`ENTER_ROOM`** ; les retardataires entrent par la porte (rendue ouverte côté hub) tant qu'au moins une
  encounter vit, mais le combat les aspire (engagement). On NE bloque pas l'entrée des coéquipiers (porte
  scellée = visuel + côté gameplay le combat est déjà engagé). `[Q]` Faut-il un délai de grâce d'entrée
  (ex. 3 s) avant de sceller visuellement la porte d'entrée ? → recommandé, purement rendu.

### Acceptation + tests

- **Accept.** : explorer le cuirassé salle par salle ; `ENTER_ROOM` verrouille (combat) ; le pont s'ouvre
  une fois les 3 ailes cleared ; co-op cohérent ; replay déterministe.
- **Tests purs** :
  - `executionerDungeon déterministe : même (cx,cz,seed) -> mêmes salles/portes/loot`.
  - `ENTER_ROOM spawn N encounters taguées roomId, noFlee, ids stables`.
  - `ENTER_ROOM(bridge) no-op tant que wings incomplet ; réussit quand les 3 ailes cleared`.
  - `TICK clear de salle quand les encounters de la salle meurent -> rooms[id]="cleared" + wing posé`.
  - `clear du pont -> sites.cleared global + fleet beacon dropé au sol`.
  - `replay : [ENTER engineering, ATTACK× (kill all), TICK, ENTER martial, ...] -> wings complets, pont ouvrable`.
- **e2e (`__game`)** : ajouter `enterRoom(room)`, `getRooms()`, `getWings()` aux hooks. Scénario : kill
  toutes les encounters d'une aile via `attack`, vérifier `getWings()`.

### Migration v1 / save
- `ENGAGE_GUARDIAN`/`CLEAR_EXECUTIONER` sur cuirassé retirés du wiring (`main.ts:1239-1264`). Conserver les
  cases reducer pour compat. Back-fill : `sites[key].cleared && !rooms` → toutes salles cleared, wings
  complets (vieille partie ayant « pillé » l'ancien gantelet = cuirassé fini).
- `mineGuardians.executioner` (`world.ts:330`) : conservé pour compat mais plus utilisé.

### Effort : **L/XL**. Dépendances : RF1 (dé-gating). RF3 (ennemis) en parallèle. Bloque RF6 (beacon au pont).

---

## RF3 — Ennemis aliens (modèles + table) — **M**

### Objectif
Modéliser 3-4 archétypes aliens à **silhouettes distinctes** (forme = fonction), **émissif = menace**,
**télégraphie wind-up** envoyée tôt par l'hôte.

### Modèle de données
- Aucun champ `GameState`. **Données** : entrées `enemies` (`world.ts:231`) du tableau RF2.
- `EnemyDef` (`world.ts:218`) : ajouter `model` valeurs aliens. `[DP]` Étendre l'union `model` :
  `"beast" | "lizard" | "bird" | "humanoid" | "chitinid" | "turret" | "robot" | "wanderer"`. Champ additif
  `static?: boolean` (tourelles, cf. RF2). Champ additif `windupSeconds?: number` (télégraphie ; défaut =
  une fraction de `strikeSeconds`).

### Reducer
- Aucun nouveau case. La **télégraphie** : l'hôte pose `enemyNextAt` (déjà fait au spawn,
  `reducer.ts:849`). Le rendu lit `enemyNextAt - tick` pour anticiper le coup → **envoyé tôt** car
  `enemyNextAt` est déjà dans le snapshot avant la frappe. `[DP]` Pas besoin d'un champ wind-up sim
  supplémentaire : `enemyNextAt` dans le snapshot suffit (le client connaît l'instant du coup à l'avance).

### Rendu
- **`src/render/characters.ts`** : 3-4 nouveaux builders réutilisant `makeKit` + accents `P.alienGlow`/
  `P.alienHull`/`P.alienAlloy` (`lowpoly.ts:44`), suivant le style du `ship`/`executioner` (`sites.ts`) :
  - `buildChitinid` (massif bas, carapace facettée, yeux émissifs cyan) — tank/nuée.
  - `buildTurret` (statique, 2 canons + cœur cyanHot — réutilise le pattern `turret` de `sites.ts:313`).
  - `buildRobot` (humanoïde rigide métal, articulations alloy) — réutilise `buildHumanoid` rig + skin métal.
  - `buildWanderer` (silhouette flottante, cœur magenta émissif — réutilise la sentinelle `sites.ts:341`).
- **Wind-up visuel** : pose exagérée + **pulse émissif** au wind-up (`enemyNextAt - tick < windupTicks`),
  piloté local depuis le snapshot. `jaw`/membres animés (rig existant `characters.ts:87` `animateWalk`).
- Le mapping `enemyId → builder` vit dans le composant de rendu des encounters (là où `buildBeast`/etc.
  sont déjà dispatchés par `EnemyDef.model`).

### main.ts / wiring
- Aucun changement de flux ; le dispatch `model → builder` est dans le module de rendu des
  `SharedEncounter`. Vérifier la lisibilité en intérieur sombre (émissif).

### Données / équilibrage
- Voir tableau RF2 (PV/dégâts/hit/strike). `[DP]` 2-3 types par salle max + boss réservé au pont (roadmap
  §2.3). Émissif : cyan = standard, magenta = boss/danger élevé.

### Co-op / déterminisme
- 100 % rendu local (modèles, wind-up, pulse). Aucune incidence sim. Le wind-up lit `enemyNextAt`
  (snapshot host) → cohérent.

### Acceptation + tests
- **Accept.** : silhouettes lisibles, distinctes de la faune terrestre ; émissif visible en intérieur.
- **Tests** : purs sur les **stats** (`enemyById["immortal wanderer"].hp===500`, etc.). Rendu = revue
  visuelle (model-lab : `lab/model-lab.html`, cf. memory). e2e : `startEncounter("murderous robot")` →
  `getCombat().enemyId`.

### Effort : **M**. Dépendances : indépendant (peut précéder RF2 sur la partie modèles ; la table sert RF2).

---

## RF4 — Minimap UNIFIÉE & CONTEXTUELLE (échelle monde) — **M/L**

### Objectif
UN seul widget minimap toujours présent, à **3 layers auto-sélectionnés** (CAMP / MONDE / INTÉRIEUR),
dessin **2D schématique** (pas de caméra ortho), fog-of-war **partagé co-op**, joueur + coéquipiers +
marqueur d'objectif/edge-pointer, carte plein écran sur touche dédiée. `[Tranché porteur §8.5]`.

### Modèle de données

**Fog-of-war partagé** : on a besoin d'un set de cellules/sites/salles **vus par n'importe qui**, persisté
+ sync par l'hôte. `[DP]` Réutiliser/étendre `SiteProgress.discovered` (déjà là) pour les **sites**, et
ajouter un champ **cellules** :

```ts
// GameState addition (state.ts:18) — ADDITIF, persisté (fog partagé), dans le snapshot.
/** RF4 : cellules du monde révélées (fog-of-war PARTAGÉ co-op). Clé = "cx,cz". Premier-vu global. */
visitedCells: Record<string, true>;
```
- **Additif** → back-fill `{}` au boot, pas de bump VERSION. `[DP]` **Persisté** (≠ volatil) : le fog doit
  survivre au reload. NB : c'est un champ qui peut grossir ; borné par le nombre de cellules réellement
  parcourues (granularité « chunk » plutôt que cellule pour limiter la taille — cf. ci-dessous).
- `[DP]` **Granularité chunk** (`worldgen.chunkCells=4`, `world.ts:1204`) plutôt que cellule : clé
  `"chunkX,chunkZ"`. Réduit la taille du save (129×129 cellules → ~33×33 chunks). Suffisant pour une
  minimap schématique.
- **Salles du cuirassé** : déjà couvertes par `SiteProgress.rooms` (RF2) — une salle « connue » = présente
  dans `rooms` (locked/cleared) ou adjacente à une connue.

### Actions

```ts
// Le client signale les chunks qu'il VOIT (révélation fog). Émis au franchissement de chunk (edge),
// comme SET_OUTSIDE. Réseau-safe. L'hôte fusionne dans visitedCells (premier-vu global).
export type RevealCellsAction = { type: "REVEAL_CELLS"; playerId: string; chunks: string[] };
```
- `[DP]` Émettre **par edge** (changement de chunk), pas par frame, et borner `chunks.length` (anti-abus,
  ex. ≤ 32). Ajout aux unions. Réseau-safe : OUI.

### Reducer
**`case "REVEAL_CELLS"`** :
```
let changed = false; const v = { ...state.visitedCells }
for c in action.chunks.slice(0, 32): if !v[c] { v[c] = true; changed = true }
return changed ? { ...state, visitedCells: v, rng: cloneRng(state.rng) } : state   // pas de RNG
```
- `DISCOVER_SITE` (`reducer.ts:389`) pose déjà `discovered` → réutilisé pour les sites du fog.
- `PRESTIGE` (`reducer.ts:572`) : `visitedCells` repart à `{}` (créé via `createInitialState` → ajouter le
  champ à `state.ts:373`).

### Rendu

**Nouveau `src/ui/minimap.ts`** (classe `Minimap`) — **dessin 2D** (canvas 2D ou Babylon GUI). 100 % local.

- **3 layers (machine d'état locale, contexte joueur)** :
  - **CAMP** : `Math.hypot(player.x, player.z) <= safeRadiusCells*cellSize` → plan rapproché depuis
    `campLayout` (`world.ts:523`) : cabane, bâtiments construits (`state.buildings`), feu (0,0), ancre
    vaisseau (RF1).
  - **INTÉRIEUR** : `interiors.isLocalPlayerInside()` (`interior.ts:100`, étendu cuirassé) →
    - grotte/mine : graphe `dungeonFor` (`dungeon.ts:70`) — nœuds + segments + butin pris/restant
      (`sites[key].taken`).
    - cuirassé : `executionerDungeon` (RF2) — salles + portes (vert/rouge/bleu) + objectif (pont).
  - **MONDE** : sinon → camp au centre, **sites découverts** (`worldMap.sites` filtrés par
    `state.sites[k].discovered` OU fog `visitedCells`), **routes** (`state.roads`), anneaux de distance.
- **Sélecteur** : `pickLayer()` chaque frame (CAMP > INTÉRIEUR > MONDE). **Transition fluide** (fondu/zoom
  doux ~0.3 s) au changement de contexte, pas de swap brut.
- **Sources** : toutes déjà disponibles (`worldMap.sites`, `worldMap.cellToWorldCenter`, `state.roads`,
  `dungeonFor`, `campLayout`, `state.sites`). **JAMAIS** de caméra ortho (perf, roadmap §3/§9).
- **Joueur + coéquipiers** : flèche d'orientation locale (player.position + yaw caméra) ; coéquipiers
  depuis les transforms réseau déjà reçus (`config.transformHz=15`, `world.ts:45`) — couleur par joueur,
  « à terre » clignotant si `survivalOf(state,pid).health<=0`. Positions interpolées (~5-10 Hz roadmap §3).
- **Marqueur d'objectif** : chevron vers l'épave (avant `ship_found`) puis vaisseau-au-camp / cuirassé /
  pont (selon progression). **Edge-pointer** quand hors-cadre.
- Style **minimaliste monochrome** (ton ADR). Coin d'écran + **carte plein écran** (touche dédiée, ex. `M`).

**Phasage interne** (roadmap §RF4) : (a) MONDE → (b) INTÉRIEUR (utile dès RF2) → (c) CAMP → (d)
coéquipiers + plein écran. L'objectif final = le widget contextuel unique.

### main.ts / wiring
- Instancier `Minimap` près de `interiors`/`hud` (`main.ts:391`). `update(state, player, camera, worldMap,
  peers)` chaque frame.
- **Émission `REVEAL_CELLS`** : dans le watcher de position (là où `SET_OUTSIDE`/`steps` sont émis), au
  **changement de chunk** courant + voisins visibles (rayon de vue). Edge-triggered.
- Touche `M` (plein écran) : ajouter au routeur d'entrées clavier. Neutralisée pendant les cinématiques.

### Données / équilibrage
- Cadence coéquipiers : réutiliser `transformHz=15` (déjà diffusé) ; interpolation locale. `[DP]` Rayon de
  révélation fog ≈ `loadRadiusChunks=2` (`world.ts:1206`).

### Co-op / déterminisme
| Host | Local |
|---|---|
| fusion `visitedCells` (premier-vu global) ; `discovered` des sites ; seed NG+ reset le fog | rendu 2D, layers, transitions, edge-pointer, flèches coéquipiers |
- Désync impossible : la minimap **lit** le snapshot, n'écrit rien. `REVEAL_CELLS` est additif idempotent.

### Acceptation + tests
- **Accept.** : la MÊME minimap situe/oriente partout (camp, monde, grotte/mine, cuirassé), contexte auto ;
  fog + coéquipiers en co-op.
- **Tests purs** : `REVEAL_CELLS fusionne les chunks (premier-vu), idempotent, borné à 32` ;
  `PRESTIGE remet visitedCells à {}`. **e2e** : `getProgress` étendu ou hook `getVisitedCells()` ; vérifier
  qu'explorer révèle des chunks. Rendu = revue visuelle.

### Effort : **M/L**. Dépendances : layer INTÉRIEUR-cuirassé attend RF2 (le reste est indépendant).

---

## RF5 — Caméra intérieur & TRANSITIONS CINÉMATIQUES de seuil — **M**

### Objectif
(1) Caméra intérieur serrée (spring-arm sphere-cast, auto-FPV couloir, fade des murs). (2) **Mini-
cinématique de seuil** à chaque entrée/sortie d'environnement clos : **GROTTE, MINE, VAISSEAU/CUIRASSÉ
uniquement** (`[Tranché porteur §8.6]`). **Exception : CABANE** (garde son fondu actuel `main.ts:1361`).
100 % LOCAL → zéro désync.

### Modèle de données
- **AUCUN champ `GameState`.** Tout est local (caméra/commandes/cinématique par joueur). C'est le pilier
  « zéro désync » : la cinématique ne touche jamais la sim.
- État local (dans le composant, pas dans `GameState`) : `threshold` (`idle | opening | walking | dip |
  settling`), `dir` (in/out), `t` (avancement), `siteType` (mine/cave/ship).

### Actions / Reducer
- **Aucune.** L'entrée logique dans la grotte se fait déjà **en marchant** (`interior.ts` build par
  proximité). La cinématique **encapsule** ce passage : elle joue **par-dessus** au franchissement du
  seuil, sans rien changer à la sim. Pour le cuirassé, `ENTER_ROOM(antechamber)` (RF2) est émis **à la fin
  de la cinématique d'entrée** (au moment du dip-to-black, quand on bascule à l'intérieur).

### Rendu

**Nouveau `src/render/threshold.ts`** : deux briques.

1. **`AnimatedDoor`** (mesh de seuil animé, par type) — réutilise `makeKit` :
   - **mine** : portillon bois battant sur charnière (cf. cadre minier `interior.ts:381`).
   - **grotte** : herse de bois / rideau de lianes écarté (un seuil lisible — cf. arche `interior.ts:400`).
   - **vaisseau/cuirassé** : **iris circulaire** ou porte coulissante latérale + halo `P.alienGlow`.
   - Méthodes : `open(t)`, `close(t)`, `setType(t)`. Posé au seuil (bouche du site / sas du cuirassé).
2. **`ThresholdCinematic`** (orchestrateur) — verrouillage input + spline/lerp caméra + marche scriptée + dip :
   ```
   trigger(dir, siteType, doorMesh):
     lockInput()                              // commandes neutralisées (cf. main.ts)
     phase opening:  door.open(t over ~0.4s)
     phase walking:  player marche scripté à travers le seuil (ease-in/out ~0.5s) ; caméra dolly-in suit
     phase dip:      bref creux au noir (<0.4s) PILE au seuil
                       -> AU NOIR : interiors.build/free (chargement masqué) ; émettre ENTER_ROOM si cuirassé
     phase settling: de l'autre côté -> caméra s'installe (FPV dedans / 3PV dehors)
     unlockInput()
   total < 1.5s, courbes ease (anti mal des transports), JAMAIS de cut.
   skippable après la 1ère fois (par type de site) -> flag local.
   timeout de sécurité (ex. 3s) -> force unlock (jamais coincé, roadmap §9).
   ```

**Caméra intérieur serrée** (extension de la machinerie FPV existante `main.ts:1361-1938`) :
- **Spring-arm sphere-cast** : remplacer le raycast simple par un sphere-cast (rayon ~0.3-0.5) —
  `camera.checkCollisions` + `collisionRadius` (Babylon) ; **rapprocher vite / éloigner lentement** (déjà
  l'esprit du lissage `FPV_SPEED`, `main.ts:1366`).
- **Auto-FPV en couloir étroit** : déjà fait pour grottes (`main.ts:1887` `interiors.isLocalPlayerInside()`).
  Étendre au cuirassé (couloirs/sas).
- **Fade des murs** entre caméra et joueur : réutiliser le pattern `cabin.setRoofOpacity` (`main.ts:1893`).

### main.ts / wiring
- **Verbes de seuil** : « pénétrer dans le vaisseau » / « entrer dans la grotte » / « descendre dans la
  mine » (depuis dehors, à la bouche) ; « ressortir » (dedans, près du seuil). Ajoutés à `computeFocus`
  (`main.ts:1030`). L'`act()` lance `ThresholdCinematic.trigger(...)`.
- **Neutralisation pendant la cinématique** : un drapeau local `cineActive` (comme `flying`,
  `main.ts:1854`) → `computeFocus()` renvoie `null`, input mouvement/caméra désactivé, comme pendant le
  décollage (`liftoff.isActive`). À la fin → restaure input + état caméra.
- **Exception cabane** : la cabane garde le fondu 3PV↔1PV à hystérésis (`main.ts:1361`), **pas** de
  cinématique de seuil. La condition de trigger exclut explicitement la cabane.

### Données / équilibrage
- Durée totale **< 1,5 s** (roadmap §2.5/§9) ; dip-to-black **< 0,4 s** ; ouverture porte ~0,4 s ; marche
  ~0,5 s. Skippable après 1ère fois/type. Timeout sécurité 3 s.

### Co-op / déterminisme
- **100 % local** (caméra/commandes/cinématique par joueur ; build intérieur déjà local). **Aucune
  incidence host → zéro désync.** Pour le cuirassé : `ENTER_ROOM` émis au dip-to-black est la **seule**
  interaction sim, déjà host-autoritaire (RF2). Si un joueur skippe, il émet `ENTER_ROOM` plus tôt — sans
  conséquence (host idempotent).

### Acceptation + tests
- **Accept.** : entrer/sortir grotte/mine/vaisseau joue une cinématique fluide (porte qui s'ouvre,
  travelling, passage 3e↔1re) ; aucune coupe sèche ; combat intérieur lisible ; 100 % local (pas de
  désync) ; cabane exclue.
- **Tests** : peu de pur (logique locale). e2e/manuel : entrer dans une grotte → caméra se fige, porte
  s'ouvre, marche, dip, FPV dedans, input rendu ; vérifier le **timeout de sécurité** (cinématique
  interrompue → joueur jamais coincé). Test pur possible : la machine d'état `ThresholdCinematic` (sans
  Babylon, mock du temps) atteint `idle` après `total` et après timeout.

### Effort : **M**. Dépendances : s'applique aux grottes/mines **existantes** (gain immédiat, indépendant
de RF2) + au cuirassé (après RF2 pour les sas).

---

## RF6 — Beacon & fins — **S**

### Objectif
`fleet beacon` = drop **garanti** du boss final (`immortal wanderer`) au clear du pont (RF2). À l'évasion,
**fin étendue** si possédé ; sinon fin standard. **Non reporté au prestige** (comme l'alliage).

### Modèle de données
- **AUCUN nouveau champ.** Le beacon est une **ressource** : `state.resources["fleet beacon"]` (entrepôt)
  ou drop au sol → sac → entrepôt. Ajouter `"fleet beacon"` à `RESOURCE_RARITY` (`world.ts:374`, rare) et
  `RESOURCE_LABELS` (`world.ts:823`).
- `[DP]` Le beacon vit à l'**entrepôt** (possession du village, comme l'alliage) — ramassé au sol
  (`TAKE_DROP`) puis déposé (`DEPOSIT`). Non strippé save (resources persisté).

### Actions / Reducer
- **Aucune nouvelle action.** Le drop est posé par RF2 (phase 8e, `room.loot` du bridge =
  `{ "fleet beacon": 1 }`). Ramassage = `TAKE_DROP` existant (`reducer.ts:1016`).
- **`PRESTIGE` (`reducer.ts:572`)** : le beacon ne doit PAS être reporté → `createInitialState` repart sans
  resources, donc déjà OK (PRESTIGE ne reporte que `perks` réels, `:580`). Vérifier qu'aucun back-fill ne
  le réinjecte.

### Rendu / main.ts
- **Écran de fin** (`main.ts:852+`, `restartWorld` `:854`) : à l'évasion (`flight.status==="escaped"`),
  brancher la **variante de fin** : si `stockOf(state,"fleet beacon")>0` OU le joueur l'a au sac →
  épilogue **étendu** (worldships / flotte wanderer / l'air qui manque) ; sinon épilogue standard.
- Détail : vérifier le beacon au moment de l'ouverture de l'écran de fin (transition `prevFlightStatus`,
  `main.ts:1437`/`:1697`).

### Données / équilibrage
- Drop **garanti** (chance 1.0) au clear du pont. Non monnayable (pas dans `tradeGoods`).

### Co-op / déterminisme
- Le drop (host, RF2) et le ramassage (`TAKE_DROP`, host) sont autoritaires. L'écran de fin est local mais
  lit `state.resources` (snapshot) → tous les joueurs voient la même variante.

### Acceptation + tests
- **Accept.** : deux variantes de fin (avec/sans beacon) ; beacon non reporté au prestige.
- **Tests purs** : `clear du pont drope fleet beacon (garanti)` (couvert RF2) ;
  `PRESTIGE ne reporte pas fleet beacon`. **e2e** : grant `fleet beacon`, déclencher escape, vérifier la
  variante de fin (hook sur l'écran de fin).

### Effort : **S**. Dépendances : RF2 (le pont droppe le beacon).

---

## RF7 — Fabricator (optionnel) + polish + audio — **M**

### Objectif
Onglet **Fabricator** au camp, gaté sur l'antichambre du cuirassé franchie (`executioner_cleared`, posé
RF2). Fabrique avec de l'alliage (energy blade, disruptor, plasma rifle, kinetic armour, hypo, stim, cargo
drone…). **Optionnel** (puissance parallèle, pas requis pour la fin). + audio de fin/espace + équilibrage.

### Modèle de données
- **AUCUN champ `GameState`.** Le gating = `state.perks["executioner_cleared"]` (déjà posé RF2). Les objets
  Fabricator = nouvelles entrées `craftableItems` (`world.ts:770`) avec `building: "fabricator"` (ou un flag
  spécial) + recettes alliage. `[DP]` Réutiliser l'atelier M10 (`CRAFT_ITEM`, `reducer.ts:590`) tel quel :
  pas de nouveau système.

### Actions / Reducer
- **Aucune nouvelle action.** `CRAFT_ITEM` (`reducer.ts:590`) gère déjà recette/sac/upgrade. Ajouter une
  garde : si l'item a `building: "fabricator"`, exiger `state.perks["executioner_cleared"]` (plutôt qu'un
  bâtiment construit) — petite extension du case existant (`:597` `item.building && buildings[...]===0`).
  `[DP]` Introduire un `item.requiresPerk?: string` (additif) plutôt que d'abuser de `building`.

### Rendu / main.ts
- Nouvel onglet « fabricator » dans l'UI de craft (réutilise l'atelier M10). Visible si
  `perks.executioner_cleared`. Modèles d'armes/armures aliens : réutiliser le kit low-poly.

### Données / équilibrage (ADR)
- Recettes ADR (alliage) : `energy blade` (1 alliage), `disruptor`, `plasma rifle`, `kinetic armour`,
  `hypo`, `stim`, `cargo drone`. Stats/recettes à porter de `fabricator.js` d'ADR. `[Q]` Lesquels inclure
  au premier jet ? → recommandé : `stim` (le blueprint médical RF2), `plasma rifle`, `kinetic armour`
  (puissance perceptible) ; le reste en extension.

### Co-op / déterminisme
- `CRAFT_ITEM` host-autoritaire (déjà). Gating via `perks` (snapshot). Aucun nouveau risque.

### Acceptation + tests
- **Accept.** : onglet Fabricator gaté antichambre ; fabrication alliage fonctionne ; optionnel.
- **Tests purs** : `CRAFT_ITEM fabricator gaté sur executioner_cleared` ; recettes consomment l'alliage.
- **e2e** : `grantPerk("executioner_cleared")` → `craft("plasma rifle")` → présent au sac.

### Effort : **M**. Dépendances : RF2 (pose `executioner_cleared`).

---

## Transversale A — Minimap unifiée
Couverte en **RF4** (le porteur a tranché que c'est le but, pas une option). Voir RF4.

## Transversale B — Transitions de seuil
Couverte en **RF5**. Points durs rappelés : 100 % local (zéro désync), `< 1,5 s`, skippable, courbes ease,
build/free **pendant le dip-to-black**, **timeout de sécurité**, **cabane exclue**.

---

## Ordre d'implémentation (dépendances)

```
RF1 (dé-gating + vaisseau camp)        ── indépendant ── EN PREMIER
  └─> RF2 (cuirassé salles/arènes)     ── cœur, dépend de RF1
        ├─> RF6 (beacon au pont)       ── dépend de RF2
        ├─> RF7 (fabricator)           ── dépend de RF2 (executioner_cleared)
        └─> RF4 layer INTÉRIEUR-cuirassé
RF3 (ennemis aliens)                   ── parallèle (table sert RF2 ; modèles indépendants)
RF4 (minimap MONDE/CAMP/coéquipiers)   ── largement indépendant
RF5 (caméra + seuils)                  ── grottes/mines d'abord (indépendant), cuirassé après RF2
```

Recommandation de jalons : **J1 = RF1** (laisse l'arbre vert, gros gain de ressenti) → **J2 = RF3 table +
RF2 sim** (salles/arènes, déterministe) → **J3 = RF2 rendu + RF5 seuils** → **J4 = RF4 minimap** → **J5 =
RF6 + RF7 + polish/audio**. Chaque jalon laisse l'arbre **VERT** (roadmap §7).

---

## Pièges (synthèse, par sujet)

- **Perf** : culling par salle via `setEnabled` (RF2), **pas** d'occlusion GPU en couloir ;
  `freezeWorldMatrix` + instances pour les statiques ; minimap = dessin 2D du graphe (**jamais** caméra
  ortho temps réel, RF4) ; `visitedCells` en granularité **chunk** (taille save).
- **Désync co-op** : verrou d'arène (`noFlee`), spawn (ids stables `exec:key:room:i`), clear de salle, gate
  des ailes, timers, fog partagé, seed NG+ = **host**. Culling/portes/obscurité/cinématique/minimap =
  **local**. Wind-up via `enemyNextAt` (déjà dans le snapshot → envoyé tôt). `structuredClone` complet de
  l'hôte → tous les clients voient la même salle vidée.
- **Caméra / mal des transports** (RF5) : pas de TPS large en couloir (resserrer/FPV) ; pas de snap (lerp,
  sphere-cast) ; rapprocher vite, éloigner lentement ; courbes ease ; cinématique **< 1,5 s** + skippable +
  **timeout de sécurité** (jamais coincé) ; build/free **pendant le dip-to-black**.
- **Fidélité ADR** : cuirassé **optionnel** (RF1) mais **très récompensant** (alliage des ailes + beacon +
  Fabricator) `[DP §8.3]` ; caps hull/moteur conservés mais en config `[DP §8.2]` ; beacon = **fin
  seulement**, non-prestige ; ne pas sur-expliquer le twist du wanderer (montrer pas dire).
- **Save** : tout nouvel état est **additif** (back-fill, pas de bump VERSION) sauf `visitedCells`
  (persisté, additif) ; `rooms`/`wings` vivent dans `sites` (persisté). `encounters`/`drops`/`flight`
  restent volatils (strip `save.ts:21`).

---

## Récap — DÉCISIONS PROPOSÉES vs QUESTIONS AU PORTEUR

### Décisions proposées (tranché, le dev peut suivre)
- **[DP-RF1]** `ship_found` = nouveau flag dans `perks` (pas de champ `GameState` dédié) ; `ship_revealed`
  devient alias/back-fill. `CLEAR_EXECUTIONER` ne révèle plus le vaisseau (mais garde alliage +
  `executioner_cleared`). Ancre vaisseau au camp via `generateCampLayout`.
- **[DP-RF2]** Version **condensée** (hub + 3 ailes 1-salle + pont). Salles/portes dans `sim/dungeon.ts`
  (`executionerDungeon`, scripté+seedé). Verrou d'arène = **`noFlee`** + spawn host à `ENTER_ROOM` ; clear
  **émergent** dans TICK (pas d'action `CLEAR_ROOM`). État dans `SiteProgress.rooms/wings` (persisté).
  Rendu = nouveau `ShipInterior` (≠ surcharge `Interiors`), culling par salle.
- **[DP-RF3]** Pas de champ wind-up sim : `enemyNextAt` (snapshot) suffit. Tourelles statiques via
  `EnemyDef.static`. Builders aliens dans `characters.ts`.
- **[DP-RF4]** Fog partagé = `visitedCells` (granularité **chunk**, persisté) + `discovered` des sites.
  `REVEAL_CELLS` edge-triggered, borné. Minimap 2D (canvas/GUI), jamais d'ortho. 3 layers auto.
- **[DP-RF5]** Zéro champ sim (100 % local). `ENTER_ROOM` émis au dip-to-black. Timeout de sécurité. Cabane
  exclue. `< 1,5 s`, skippable.
- **[DP-RF6]** Beacon = ressource (`state.resources`), drop garanti du pont, entrepôt, non-prestige.
- **[DP-RF7]** Réutiliser `CRAFT_ITEM` + `item.requiresPerk`. Gating `executioner_cleared`.

### Questions au porteur — ✅ TRANCHÉES (porteur, juin 2026 : « recos OK »)
- **[Q-1]** Décollage → **garder l'« extraction allégée » co-op** (pas le dodge-shooter solo).
- **[Q-2]** Caps hull/moteur (20/3) → **conserver** (exposés en config).
- **[Q-3]** Incitation du cuirassé → **à doser en playtest** (cuirassé très récompensant mais non requis).
- **[Q-4]** Grâce d'entrée d'arène co-op → **~3 s** (purement rendu).
- **[Q-5]** Objets Fabricator du 1er jet → **stim, plasma rifle, kinetic armour**.
- **[Q-6]** Ampleur du cuirassé → **condensé d'abord** (hub + 3 ailes 1-salle + pont), ailes multi-salles plus tard.
- **[Q-7]** Touches → **carte plein écran = `M`**, skip de cinématique = touche d'interaction/Échap (à finaliser au câblage).
