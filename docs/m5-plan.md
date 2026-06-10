# M5 — Événements : fiche d'implémentation détaillée

> ✅ **IMPLÉMENTÉ** (49 tests sim + e2e verts). Ce document reste la référence de conception ; il
> décrit ce qui a été livré. Code : `data/world.ts` (catalogue/types), `src/sim/{state,actions,reducer}.ts`,
> `src/main.ts` (panneau + watcher + hooks), `src/net/messages.ts` (snapshot).

> Plan de travail pour le jalon **M5 (événements aléatoires & de gestion)**. À lire avec la fiche
> **M5** de [`roadmap.md`](roadmap.md) (le quoi) et l'état courant dans [`etat.md`](etat.md).
> Conventions techniques (couches, déterminisme, snapshot) : [`architecture.md`](architecture.md).
>
> **Source de vérité du contenu** : ce plan a été établi en lisant le **code source d'A Dark Room**
> (`doublespeakgames/adarkroom`, fichiers `script/events/room.js`, `outside.js`, `global.js`, et
> l'ordonnanceur `script/events.js`). Les conditions, choix et effets ci-dessous en sont extraits.

## Objectif

Recréer le « sel narratif/économique » d'ADR : des événements déclenchés sur timer, avec
**choix → conséquences**. C'est aussi le jalon qui **réintroduit la perte de villageois** au bon
endroit (retirée de l'économie en M4 : « la mort viendra des événements », cf.
[`../src/sim/reducer.ts`](../src/sim/reducer.ts)). Et c'est le **test grandeur nature du déterminisme
P2P** : les deux joueurs doivent vivre exactement le même événement → tout passe par l'hôte + le RNG
à graine.

## Deux constats tirés de la source (qui cadrent le design)

1. **Un événement n'est PAS « un choix → un effet », c'est une mini-machine à états.** Chaque
   événement est un graphe de **scènes** (`start → … → end`) avec **branchements probabilistes** :
   `nextScene: { 0.5: 'scales', 0.8: 'teeth', 1: 'cloth' }`. Conséquence : l'état doit porter la
   **scène courante**, et `RESOLVE_EVENT_CHOICE` fait une **transition de scène** (avec tirage RNG sur
   les poids), pas une résolution one-shot.

2. **L'ordonnanceur est trivial et se calque sur l'existant.** `_EVENT_TIME_RANGE: [3, 6]` minutes ;
   `triggerEvent` : si aucun événement actif → liste des événements `isAvailable()`, tirage
   **uniforme** ; si la liste est vide → re-planifier à `0.5×`. C'est **exactement** le pattern
   `popGrowAt` déjà dans [`../src/sim/reducer.ts`](../src/sim/reducer.ts) (intervalle tiré via RNG à
   graine).

## Décision d'architecture centrale : prédicats vs effets déclaratifs

ADR met des `function(){…}` dans les données (`isAvailable`, `onLoad`, `onChoose`). On ne copie pas
ça tel quel — la règle du projet est « **toute règle dans `reduce`, effets déterministes et
testables** ». On scinde donc :

- **Conditions** (`isAvailable`, disponibilité d'un choix) = **prédicats purs en lecture seule** dans
  `data/world.ts`. Admis (le projet a déjà `craftableCost`, `terrainHeight` comme fonctions de
  données), non sérialisé : `data/world.ts` est importé à l'identique par chaque pair.
- **Effets** (gains/pertes, morts, destructions, branchements) = **données déclaratives** interprétées
  par un seul helper `applyEffect()` dans le reducer. C'est ce qui garde le RNG dans la sim, rend tout
  rejouable, et testable au terminal.

## Périmètre du catalogue (déduit de la source)

Croisé avec les systèmes **déjà présents** dans andr (feu, stocks, population, bâtiments). Ressources
`scales`/`teeth`/`cloth`/`bait` : **existent** (table `trapDrops`). `medicine`, `compass`, `alien
alloy`, **perks**, **carte**, `cityCleared` : **n'existent pas** (M7/M8/M9/M11).

| Événement (source) | Condition | Effet clé | Statut M5 |
|---|---|---|---|
| **Noises Outside** | `wood>0` | 30 % → +100 bois / +10 fourrure | ✅ tel quel |
| **Noises Inside** | `wood>0` | −10 % bois → écailles/dents/étoffe | ✅ tel quel |
| **The Beggar** | `fur>0` | donne fourrure → écailles/dents/étoffe | ✅ tel quel |
| **Mysterious Wanderer** (×2) | `wood`/`fur>0` | pari : retour différé ×3 (50 %/30 %) | ✅ tel quel* |
| **A Ruined Trap** | `traps>0` | détruit 1..N pièges, traque → butin | ✅ **perte de bâtiment** |
| **Hut Fire** | `huts>0 && pop>seuil` | détruit 1 hutte + occupants meurent | ✅ **perte de pop** (rescaler le seuil) |
| **A Beast Attack** | `pop>0` | tue 1..10 villageois, +butin | ✅ **l'événement-phare** |
| **The Nomad** | `fur>0` | troc fourrure → écailles/dents/appât (+compass) | 🟡 retirer le bouton *compass* |
| **The Thief** | flag `thieves` | rend les stocks volés / perk | 🟡 simplifier le sous-système de vol |
| **Sickness / Plague** | `pop` + `medicine` | soigne ou tue | 🔴 reporter (dépend de `medicine`, M9/M10) |
| **A Military Raid** | `pop>0 && cityCleared` | tue 1..40, +balles | 🔴 reporter (M9) |
| **The Scout / Master / Sick Man** | carte / perks / medicine | carte, perks, alliage | 🔴 reporter (M7/M8/M11) |

\* *Mysterious Wanderer* introduit un **effet différé** (retour ~60 s plus tard) — petit mécanisme en
plus, trivial avec les compteurs de tics existants.

**Périmètre M5 livré** : les 8 ✅ + *The Nomad* (sans compass). Ils couvrent **toutes les mécaniques**
du système (récompense pure, troc de stocks, pari/différé, perte de bâtiment, perte de population).
Le reste se branche sans refonte quand ses dépendances arrivent (moteur générique piloté par données).

## 1. Données — `data/world.ts`

```ts
// --- M5 : événements ---
export interface EventEffect {                 // tous optionnels, ordre d'application fixe
  stores?: Record<string, number>;             // delta entrepôt (borné à 0, jamais négatif)
  convert?: { from: string; pct: number; to: string; ratio: number; min?: number }; // Noises Inside
  killVillagers?: { min: number; max: number } | { maxFraction: number };           // tirage RNG borné
  destroyBuildings?: { id: string; min: number; max: number };                       // Ruined Trap / Hut Fire
  delayedStores?: { chance: number; delaySeconds: number; stores: Record<string, number> }; // Wanderer
}
export interface EventChoice {
  id: string;                                  // identifiant stable (= ce qui circule dans l'action)
  text: string;
  cost?: Record<string, number>;               // payé depuis l'ENTREPÔT (gestion village)
  reward?: Record<string, number>;             // gain immédiat (entrepôt)
  available?: (g: GameState) => boolean;        // lecture seule
  next?: string | Record<number, string>;      // 'end' (défaut), une scène, ou poids cumulés
}
export interface EventScene {
  text: string[];
  notification?: string;                        // toast à l'entrée de la scène
  onLoad?: EventEffect;                         // effet à l'ENTRÉE de la scène (ex. Ruined Trap)
  choices: EventChoice[];
}
export interface GameEvent {
  id: string;
  title: string;
  isAvailable: (g: GameState) => boolean;
  scenes: Record<string, EventScene>;           // DOIT contenir 'start'
}
export const events: GameEvent[] = [ /* le catalogue acté ci-dessus */ ];
export const eventById: Record<string, GameEvent> = Object.fromEntries(events.map(e => [e.id, e]));
```

Cadence — **fidèle à A Dark Room** (`_EVENT_TIME_RANGE: [3, 6]` minutes, décision : on NE compresse
PAS) :
```ts
events: { minSeconds: 180, maxSeconds: 360, emptyRescheduleScale: 0.5 },
```

**Rescaler les seuils de population** : ADR teste `pop>50` (Hut Fire) / `10..50` (Sickness). Le village
d'andr est bien plus petit → baisser ces seuils en données (équilibrage, pas moteur).

## 2. Simulation — `src/sim/`

**`state.ts`** (ajouts à `GameState` + `createInitialState`) :
```ts
activeEvent: { id: string; scene: string } | null;   // événement en cours + scène courante
eventScheduledAt: number;                             // tic du prochain déclenchement
pendingEffects: Array<{ at: number; stores: Record<string, number>; note?: string }>; // effets différés
```

**`actions.ts`** : `ResolveEventChoiceAction = { type: "RESOLVE_EVENT_CHOICE"; playerId; choice }`,
ajoutée à **`GameAction` ET `PlayerAction`** (+ fabrique).

**`reducer.ts`** :
- Helper `applyEffect(state, eff, rng)` — pur, mute `rng` en place (comme `HARVEST_TRAP`), **borne tout
  stock à 0**, passe tout tirage par `nextFloat`/`nextInt`. **La mort de villageois atterrit ici**
  (réduit `population`, raccroche `workers` si nécessaire).
- Bloc scheduler dans `case "TICK"` — **calque du bloc `popGrowAt`** : si `tick >= eventScheduledAt`
  et `activeEvent == null`, filtrer `events` par `isAvailable(state)` ; vide → reprogrammer à
  `× emptyRescheduleScale` ; sinon tirer `nextInt(rng, n)`, poser `activeEvent={id,'start'}`, appliquer
  `scenes.start.onLoad`, reprogrammer dans `[min,max]`. **+ drainer `pendingEffects`** dont `at<=tick`.
- `case "RESOLVE_EVENT_CHOICE"` : garde `activeEvent`, trouve scène+choix par id, vérifie `available?`
  et coût payable (entrepôt), déduit le coût, applique `reward` ; résout `next` (`'end'`→fin ;
  string→scène ; map→tirage RNG) et applique le `onLoad` de la scène cible.

**`sim.test.ts`** (~8-10 tests) : déterminisme du scheduler · gating (`beast_attack` sans pop,
`ruined_trap` sans piège) · effet borné (pas de pop négative) · branchement probabiliste déterministe
· coût (`beggar`) · destruction (`hut_fire`, `ruined_trap`) · effet différé (`wanderer`) · **replay
complet**.

## 3. UI / rendu — `src/main.ts` (HUD inchangé)

`DialogueView`/`DialogueChoice` couvre déjà tout (label, sublabel, tooltip, enabled, onSelect).

- `eventView()` : map la scène courante → `DialogueView` (même style que `buildView`/`workersView` ;
  `tooltip` = coût manquant dans l'entrepôt ; `onSelect` → `emit(resolveEventChoice(self(), c.id))`).
- Watcher dans `reflectState()` (modèle `prevFire`/`prevBuilder`) : suivre une clé `id+scene` ; à son
  changement → `hud.toast(scene.notification)` + `showDialogue(eventView)` ; à `null` → `closeInteractive()`.
  Tourne pour **les deux joueurs** (l'`activeEvent` arrive par snapshot) → même événement vécu ; la
  transition de scène vient du nouveau snapshot (pas de `refreshDialogue` manuel — l'état fait foi).
- Diégétique (polish, optionnel M5) : faire entrer un PNJ (`stranger.ts`/`villagers.ts`) pour nomade/mendiant.
- Hooks `window.__game` : `getActiveEvent()`, `triggerEvent(id?)` (force `eventScheduledAt=tick`, ou
  injecte un id donné) — **réservé à l'autorité**, comme `fastForward`.

## 4. Réseau — `src/net/messages.ts`, `src/main.ts` (point critique P2P)

Trois ajouts **symétriques** : `StateSyncMsg` + `snapshot()` + `adoptSnapshot()` transportent
`activeEvent`, `eventScheduledAt`, `pendingEffects`. Le scheduler ne tourne que côté autorité (seul
l'hôte applique `TICK`) → l'événement est tiré **une fois** puis diffusé. `emit()`/`onGameAction`/
`onStateSync` gèrent déjà l'aller-retour des choix.

## 5. Tests e2e — `tests/e2e.spec.ts`

`__game.triggerEvent('beast_attack')` → attendre le panneau → lire `getPopulation()` avant → cliquer un
choix → vérifier que la population a baissé et que l'événement s'est fermé (+ capture éventuelle).

## Découpage en commits (ordre du projet) & taille

1. **data** — types + catalogue + `config.events` + libellés. *(S)*
2. **sim** — state + actions + `applyEffect` + scheduler + `RESOLVE_EVENT_CHOICE` **+ tests**. *(M — le cœur)*
3. **ui** — `eventView`, watcher `reflectState`, hooks debug. *(S)*
4. **net** — `StateSyncMsg` + `snapshot`/`adopt`. *(XS)*
5. **e2e** — test Playwright + capture. *(S)*

Conforme au classement **M** de la roadmap. Risque concentré sur l'étape 2 (déterminisme des
branchements + tirages de morts/destructions) → d'où le poids des tests de replay.

## Décisions figées

- **Cadence = fidèle à ADR** : `[3, 6]` minutes (`minSeconds: 180, maxSeconds: 360`). **On ne compresse pas.**
- **Coûts/récompenses des événements = entrepôt** (pas le sac) — cohérent avec la construction.
- **Conditions = prédicats purs** en données ; **effets = déclaratifs** interprétés par `applyEffect`.
- Périmètre = 8 événements fidèles + Nomade (sans compass) ; Scout/Master/Sick Man/Raid/Sickness/Plague
  reportés jusqu'à l'arrivée de leurs dépendances (carte/perks/medicine/cityCleared).
