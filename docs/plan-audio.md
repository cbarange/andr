# Audio — analyse du jeu original & plan d'implémentation

> Document de travail. **Partie 1** : comment *A Dark Room* gère son audio (moteur Web Audio +
> bibliothèque de sons, fondé sur le code source open-source `doublespeakgames/adarkroom`, MPL-2.0).
> **Partie 2** : la question de **licence des fichiers** (à trancher avant de bundler quoi que ce soit).
> **Partie 3** : le **plan d'implémentation** mappé sur NOTRE architecture (`sim/` pur · `render/` Babylon ·
> `ui/` DOM · `net/` P2P), avec phasage par lots, manifeste de données, et règles de déterminisme/P2P.
>
> L'audio est listé en **M12** de la [roadmap](roadmap.md) (« sons : interdits dans le POC, bienvenus
> ensuite »). Ce doc est sa **fiche d'implémentation**. Rien n'est encore codé : **zéro ligne d'audio**
> dans `src/` aujourd'hui.

---

## TL;DR

- Le jeu original a un moteur audio **Web Audio** soigné : **musique de fond en couches** (fond + overlay
  d'événement avec **fondu enchaîné**), **effets sonores** ponctuels, **cache de buffers décodés**.
- **Cadeau d'architecture** : les 5 pistes `fire-*.flac` du jeu original (`dead → smoldering → flickering
  → burning → roaring`) correspondent **exactement** à notre enum `state.fire` (0–4). Pareil pour les SFX
  (`light-fire`, `stoke-fire`, `gather-wood`, `build`, `check-traps`…) qui s'alignent sur **nos actions
  existantes**, et la musique de village qui **scale avec la population** (`lonely-hut → raucous-village`).
- **Notre contrainte clé** : `sim/` est **pur et déterministe**. L'audio est de la **présentation** (comme
  les villageois cosmétiques, le brouillard, la fumée) → il **lit l'état et joue localement**, ne touche
  **jamais** `GameState`, n'utilise **jamais** `state.rng` (mais peut utiliser `Math.random`). Il se branche
  dans `main.ts`/`reflectState()` via le **diff d'état déjà en place** (`prevFire`, `prevBuilder`,
  `prevEventKey`…).
- **Babylon 9.11 expose `AudioV2`** (moteur audio moderne, **spatialisé**) → on en profite pour un
  **crépitement de feu positionné en 3D** (plus fort quand on s'approche du foyer) — un atout que le jeu
  original 2D n'a pas.
- ✅ **Décision prise (Partie 2)** : on **réemploie les assets originaux** (le porteur du projet a confirmé
  la licence). Les **86 fichiers `.flac` ont été récupérés** dans `public/audio/` (4,9 Mo, intègres). Le
  manifeste de données reste **swappable** au cas où on voudrait en remplacer certains.

---

# Partie 1 — Comment l'audio marche dans *A Dark Room*

Deux fichiers portent tout : [`script/audio.js`](https://github.com/doublespeakgames/adarkroom/blob/main/script/audio.js)
(le moteur) et [`script/audioLibrary.js`](https://github.com/doublespeakgames/adarkroom/blob/main/script/audioLibrary.js)
(le catalogue : constantes → chemins de fichiers). Les sons sont **déclenchés impérativement** depuis la
logique de jeu (`AudioEngine.playSound(AudioLibrary.X)`).

## 1.1 Le moteur (`AudioEngine`, Web Audio API)

- **`AudioContext`** unique (`window.AudioContext || webkitAudioContext`).
- **Graphe de gain hiérarchique** :
  ```
  sources SFX ─────────────────────────────┐
  musique de fond → envelope (gain) ────────┤→  MASTER gain → destination
  musique d'événement → envelope (gain) ────┘
  ```
  - **Master gain** : volume global.
  - **Envelope de fond** & **envelope d'événement** : gains séparés → **fondus indépendants**.
  - Les **SFX** se branchent **directement** au master (pas d'enveloppe : ils sont brefs).
- **Chargement & cache** : `loadAudioFile()` → `fetch` + `decodeAudioData` → stocke l'`AudioBuffer`
  **décodé** dans `AUDIO_BUFFER_CACHE` (plus de requête réseau ni de re-décodage ensuite). Gère le
  `decodeAudioData` **non-promesse de Safari** (polling 20 ms) et un **buffer de repli** (bip) si le décodage
  échoue.
- **Fondus** : constante `FADE_TIME = 1` s ; les transitions d'événement utilisent `FADE_TIME * 2` (2 s).
  Rampes via `linearRampToValueAtTime`, avec annulation des automations en conflit (`cancelScheduledValues`).

**Fonctions publiques** (le contrat à reproduire) :

| Fonction | Rôle |
|---|---|
| `init()` | crée le contexte + le master |
| `playSound(name)` | joue un SFX **sans boucle** |
| `playBackgroundMusic(name)` | charge + joue une piste de fond **en boucle** (fond enchaîné avec l'ancienne) |
| `playEventMusic(name)` | joue une musique d'événement **par-dessus** le fond (qui **baisse à 20 %**) |
| `stopEventMusic()` | coupe l'événement, **remonte** le fond à 100 % |
| `setMasterVolume(v, fade?)` | volume global, fondu optionnel |
| `setBackgroundMusicVolume(v)` | volume du fond indépendamment |

## 1.2 Le catalogue (`AudioLibrary`) — l'inventaire réel des fichiers

Tous les fichiers sont dans `audio/`, au format **`.flac`** (sans perte, donc **lourd pour le web** : voir
§3.6). Inventaire **exact** récupéré du dépôt (74 fichiers) :

**Musique « état du feu » (5)** — *mappe 1:1 sur notre enum `state.fire`* :
`fire-dead.flac` · `fire-smoldering.flac` · `fire-flickering.flac` · `fire-burning.flac` · `fire-roaring.flac`

**Musique « taille du village » (4 + la hutte)** — *scale avec la population* :
`lonely-hut.flac` · `tiny-village.flac` · `modest-village.flac` · `large-village.flac` · `raucous-village.flac`

**Musique de monde / phases** : `silent-forest.flac` · `dusty-path.flac` · `world.flac` · `ship.flac` ·
`space.flac` · `ending.flac`

**Musique de combat (3 paliers)** : `encounter-tier-1/2/3.flac`

**Sons d'événement (16)** — *mappe sur nos événements M5* : `event-nomad` · `event-noises-outside` ·
`event-noises-inside` · `event-beggar` · `event-shady-builder` · `event-mysterious-wanderer` · `event-scout` ·
`event-wandering-master` · `event-sick-man` · `event-ruined-trap` · `event-hut-fire` · `event-sickness` ·
`event-plague` · `event-beast-attack` · `event-soldier-attack` · `event-thief` (`.flac`)

**Sons de lieux (13)** — *pour M9* : `landmark-cave` · `landmark-house` · `landmark-town` · `landmark-city` ·
`landmark-swamp` · `landmark-battlefield` · `landmark-borehole` · `landmark-friendly-outpost` ·
`landmark-destroyed-village` · `landmark-crashed-ship` · `landmark-iron/coal/sulphurmine` (`.flac`)

**SFX d'action (gros morceau)** — *les plus utiles tout de suite en gras* :
**`light-fire`** (7,8 ko) · **`stoke-fire`** (6,7 ko) · **`gather-wood`** (6,7 ko) · **`build`** (13 ko) ·
`craft` (9,3 ko) · `buy` (2,5 ko) · **`check-traps`** (8,6 ko) · `embark` (6 ko) · `eat-meat` · `use-meds` ·
`death` · **`footsteps-1..6`** (~1,4 ko chacun) · `weapon-unarmed-1..3` · `weapon-melee-1..3` ·
`weapon-ranged-1..3` · `reinforce-hull` · `upgrade-engine` · `lift-off` · `asteroid-hit-1..8` · `crash`

> Les SFX sont **minuscules** (1–13 ko), la musique pèse 40–200 ko/piste. Les `footsteps` et `weapons`
> existent en **variantes numérotées** → l'original en **tire une au hasard** pour éviter la répétition
> (chez nous : `Math.random`, c'est purement cosmétique, **pas** `state.rng`).

## 1.3 Le modèle de déclenchement (où les sons sont appelés)

Deux régimes, qu'on retrouvera chez nous :

1. **SFX = bord d'action** : appelés **dans l'action** qui les produit. Exemples vérifiés dans
   `script/room.js` :
   - `lightFire()` → `playSound(LIGHT_FIRE)` · `stokeFire()` → `playSound(STOKE_FIRE)`
   - `build()` → `playSound(BUILD)` (bâtiment) ou `CRAFT` (arme/outil/upgrade) · `buy()` → `playSound(BUY)`
2. **Musique = fonction de l'état** : `setMusic()` choisit la piste de fond selon l'**état courant**
   (niveau de feu, taille de village, module) et appelle `playBackgroundMusic()`. Appelée aux **transitions
   d'état** (le feu change de cran, on arrive dans un module). Mapping feu→musique :

   | `state.fire` | piste |
   |---|---|
   | 0 Dead | `fire-dead` |
   | 1 Smoldering | `fire-smoldering` |
   | 2 Flickering | `fire-flickering` |
   | 3 Burning | `fire-burning` |
   | 4 Roaring | `fire-roaring` |

3. **Musique d'événement** : un événement appelle `playEventMusic(EVENT_X)` (le fond **baisse**),
   `stopEventMusic()` à la résolution (le fond **remonte**).

---

# Partie 2 — Licence des fichiers audio (✅ tranché)

- Le **code** d'A Dark Room est **MPL-2.0**.
- **Décision du porteur du projet** : la licence permet le réemploi des assets → on **utilise les fichiers
  audio originaux**.
- **État** : les **86 fichiers `.flac` ont été récupérés** depuis
  [`audio/`](https://github.com/doublespeakgames/adarkroom/tree/main/audio) (raw GitHub) dans
  **`public/audio/`** — **4,9 Mo**, tous vérifiés comme **FLAC valides** (intégrité confirmée par taille +
  `file`). Servis comme assets statiques (même mécanisme que le WASM Havok dans `public/`).

> Le **manifeste de données** (§3.5) reste **swappable** : si on veut un jour remplacer une piste par une
> alternative, c'est une simple édition de `data/audio.ts`, sans toucher au moteur.

---

# Partie 3 — Plan d'implémentation (mappé sur notre architecture)

## 3.1 Principe directeur : l'audio est de la PRÉSENTATION

Exactement comme les **villageois cosmétiques**, la **fumée**, le **brouillard** ou le **scintillement du
feu** (cf. [`architecture.md`](architecture.md) §5) :

- **JAMAIS dans `src/sim/` ni `data/world.ts` (logique)** : pas d'import audio dans le cerveau.
- **Ne mute jamais `GameState`**, n'émet aucune action, n'influence pas le réseau.
- **N'utilise jamais `state.rng`** (réservé au déterministe). Pour varier footsteps/impacts : `Math.random`
  est **admis** (cosmétique, comme dans `villagers.ts`).
- **Lit l'état et joue localement.** En P2P, **chaque pair** joue SON audio d'après l'état qu'il a adopté →
  **zéro trafic réseau ajouté**, et comme les événements arrivent par snapshot, **les deux joueurs entendent
  le même événement** (notre déterminisme nous l'offre gratuitement).

## 3.2 Nouveau module : `src/render/audio.ts` (`AudioManager`)

Encapsule le moteur audio. Deux pistes techniques possibles — **on recommande Babylon `AudioV2`** :

| Piste | Pour | Contre |
|---|---|---|
| **Babylon `AudioV2`** (présent en 9.11) | **audio spatialisé** natif (feu 3D), intégré au moteur/scene, gère le contexte & le déverrouillage | API à apprendre |
| Wrapper **Web Audio** maison (calqué sur `audio.js`) | contrôle total, 1:1 avec l'original | on réécrit cache/fondus/spatialisation à la main |

Surface publique (contrat, calqué sur l'original + besoins 3D) :

```ts
class AudioManager {
  init(scene): Promise<void>          // crée le moteur audio (AudioV2) + bus master/music/sfx
  resumeOnGesture(): void             // débloque le contexte au 1er clic (autoplay policy, cf. 3.4)
  // MUSIQUE (en boucle, fondu enchaîné)
  setBackgroundMusic(key | null)      // idempotent : ne recharge pas si déjà la bonne piste
  playEventMusic(key) / stopEventMusic()
  // SFX (ponctuels)
  playSfx(key)                        // tire une variante au hasard si le manifeste en liste plusieurs
  // FOYER SPATIAL (3D)
  setFireSpatial(level, x, y, z)      // crépitement positionné, volume = f(niveau de feu)
  // VOLUMES (persistés, cf. 3.4)
  setMaster(v) / setMusic(v) / setSfx(v) / setMuted(bool)
}
```

Buffers décodés **mis en cache** (comme `AUDIO_BUFFER_CACHE`) ; chargement **paresseux** (on ne charge une
piste qu'au moment de la jouer) pour ne pas plomber le boot.

## 3.3 Le branchement : piloté par le DIFF d'état (déjà en place)

On **réutilise** le système de détection de transitions de `reflectState()` dans
[`main.ts`](../src/main.ts) (qui fait déjà `prevFire`, `prevBuilder`, `prevCabin`, `prevTier`,
`prevEventKey` pour les toasts). On y ajoute des appels audio — **sans nouvelle plomberie** :

```
reflectState():
  // MUSIQUE = pure fonction de l'état (idempotente)
  audio.setBackgroundMusic(pickMusic(state, player.position))   // feu / village / exploration
  if (state.activeEvent change) audio.playEventMusic(...) / stopEventMusic()
  // SFX = sur transition détectée
  if (state.fire !== prevFire && state.fire > prevFire) audio.playSfx("stokeFire" | "lightFire")
  // FOYER spatial
  audio.setFireSpatial(state.fire, 0, fireY, 0)
```

Et pour les **SFX d'action ponctuels**, on se greffe sur les **fonctions locales déjà existantes** (pas
besoin de l'état) :

| Endroit existant dans `main.ts` | SFX |
|---|---|
| `chopTree()` / `chopWildTree()` | `gather-wood` (à chaque coup), + variante « chute » à l'abattage |
| `interactFire()` (light vs stoke) | `light-fire` / `stoke-fire` |
| `buildChoices().onSelect` (`build`) | `build` (bâtiment) |
| `depositAtChest()` | dépôt (réutiliser `build`/`craft` ou son dédié) |
| `harvestTrap` (focus piège) | `check-traps` |
| `player.update()` quand au sol + en mouvement | `footsteps-1..6` (cadence selon la vitesse, variante au hasard) |

> **Pourquoi pas dans le reducer ?** Parce que le reducer est **rejoué** (replay déterministe, adoption de
> snapshots, fast-forward debug) : y déclencher un son le ferait jouer en rafale au rattrapage. Le **diff de
> présentation** (1×/frame, côté affichage) est le bon endroit — **même raison** que les toasts y vivent.

## 3.4 Politique d'autoplay, réglages, persistance

- **Déverrouillage navigateur** : un `AudioContext` démarre *suspended* tant qu'il n'y a pas eu de **geste
  utilisateur**. On a **déjà** un clic initial obligatoire (celui qui active le pointer lock,
  [`pointerLook.ts`](../src/input/pointerLook.ts)) → on y branche `audio.resumeOnGesture()`. Un petit indice
  « 🔇 cliquez pour le son » si encore suspendu.
- **Réglages dans le menu Paramètres** (Échap, déjà existant, [`hud.ts`](../src/ui/hud.ts)) : 3 curseurs
  **master / musique / SFX**, un **mute**, et une section **« Effets actifs »** = une **case à cocher par
  effet** (couper du bois, allumer/attiser le feu, construire, déposer, relever les pièges, pas) pour
  activer/désactiver chaque SFX individuellement. Cohérent avec « pas de panneaux flottants ».
- **Persistance** : volumes/mute sauvegardés en `localStorage` **à part du `GameState`** (réglage local du
  joueur, ≠ état de jeu déterministe) — même esprit que `discovered`/`save.ts`. Clé dédiée, p.ex.
  `darkroom3d.audio`.

## 3.5 Manifeste de données (swappable A/B/C) — `data/audio.ts`

Le **catalogue** (clé logique → fichier) vit en **données**, comme tout le reste (cf. §2 « piloté par les
données »). Changer d'assets (option A↔B) = **éditer ce fichier**, pas le moteur.

```ts
export const audioManifest = {
  basePath: "/audio/",
  format: "flac",                 // fichiers originaux récupérés (FLAC décodable par Web Audio ; cf. 3.6)
  music: {
    // index par state.fire (0..4) — mapping 1:1 avec l'original
    fire: ["fire-dead", "fire-smoldering", "fire-flickering", "fire-burning", "fire-roaring"],
    // paliers de population (seuils définis côté pickMusic) — A Dark Room scale ainsi
    village: ["lonely-hut", "tiny-village", "modest-village", "large-village", "raucous-village"],
    exploration: "world",         // hors retranchement (M7)
  },
  // clés alignées sur NOS ids d'événements M5 (data/world.ts)
  events: {
    noisesOutside: "event-noises-outside", noisesInside: "event-noises-inside",
    beggar: "event-beggar", nomad: "event-nomad", ruinedTrap: "event-ruined-trap",
    hutFire: "event-hut-fire", beastAttack: "event-beast-attack",
    mysteriousWanderer: "event-mysterious-wanderer", /* … */
  },
  sfx: {
    lightFire: "light-fire", stokeFire: "stoke-fire", gatherWood: "gather-wood",
    treeFall: "build" /* placeholder */, build: "build", deposit: "craft",
    checkTraps: "check-traps",
    footsteps: ["footsteps-1","footsteps-2","footsteps-3","footsteps-4","footsteps-5","footsteps-6"],
  },
  fireCrackle: "fire-loop", // ambiance spatiale en boucle (à fournir ; absente telle quelle de l'original)
} as const;
```

> Les **clés** sont stables (le code y fait référence) ; seuls les **fichiers** changent selon l'option de
> licence. En **option B**, on remplit avec des sons libres ; en **A**, avec les `.flac` originaux transcodés.

## 3.6 Format & poids

- **Fichiers récupérés en `.flac`** (sans perte) dans `public/audio/` (4,9 Mo au total). **Bonne nouvelle** :
  le **FLAC est directement décodable par Web Audio** (`decodeAudioData`) dans tous les navigateurs modernes
  (Chrome, Firefox, Edge, Safari ≥ 11) → **aucun transcodage bloquant** pour démarrer. Les SFX sont en plus
  **minuscules** (1–13 ko).
- **Chargement paresseux + cache** : on ne télécharge/décode une piste qu'à sa **première** lecture. Le
  budget reste maîtrisé (cf. README « ~1,3 Mo JS + 2 Mo WASM » ; l'audio s'ajoute **à la demande**, pas au
  boot). Servis comme assets statiques depuis `public/audio/` (même mécanisme que le WASM Havok).
- **Optimisation ultérieure (optionnelle)** : transcoder en **`.ogg`/Opus** (≈ 5–10× plus léger) via un
  script de build `scripts/transcode-audio.mjs` (ffmpeg) — utile surtout pour la **musique** (40–200 ko/piste)
  si on vise un poids minimal. Le manifeste a un champ `format` pour basculer sans toucher au moteur.

### Niveau & « grésillement » (diagnostic complet + résolution)
Symptôme : un **bruit constant désagréable** « derrière » le feu, perçu partout (même loin du camp).
Démarche de diagnostic (mesures réelles via `AnalyserNode` branché en sortie master + analyse des buffers) :
1. **Localisation** : `Musique = 0` → **silence total** (toutes bandes à 0) ; `SFX = 0` → inchangé ;
   `Master = 0` → silence. ⇒ le bruit vient **uniquement des pistes de musique** (donc *réglable*).
2. **Pas un défaut de lecture** : les fichiers de feu sont **sains** — pas de clic de boucle
   (`|dernier − premier|` ≈ 0), pas de DC offset, pas de pic inter-échantillon. Spectre **basse-fréquence**
   (120–1000 Hz dominant, quasi rien > 5 kHz) ⇒ un **souffle/crépitement grave**, pas un sifflement aigu.
3. **Cause réelle** : c'est le **contenu d'ambiance de feu d'A Dark Room** (un crépitement en boucle),
   intrinsèquement présent. Un essai de **gain de compensation ×5** (pour « remonter » des pistes
   masterisées bas) a **amplifié exactement ce qui dérange** → mauvaise piste, abandonnée.

**Résolution retenue (validée avec le porteur du projet)** :
- **Pas de gain de compensation** (`MUSIC_MAKEUP = 1`) : l'ambiance de feu reste au **niveau natif (faible)**,
  réglable/coupable via le **curseur Musique**.
- **Fondus en un seul ramp Web Audio** (`setVolume(target, { duration })`) — pas de réglage de volume par
  frame (évite tout *zipper noise* en transition).
- **Effets désactivables un par un** (cf. §3.4) : section « Effets actifs » du menu, une case par SFX.
> Leçon : ne pas « booster » une ambiance jugée gênante ; la laisser discrète et **donner le contrôle au
> joueur** (curseur Musique + cases d'effets). Les futures pistes **mélodiques** (village A6, événements A5)
> pourront, elles, mériter un gain propre — à traiter **par piste**, pas globalement sur le bus.

## 3.7 Spatialisation 3D — l'atout qu'on a et pas l'original

Le jeu original est 2D : sa musique de feu est **non spatiale**. Nous, on peut poser un **crépitement de feu
en son 3D positionné** au foyer (Babylon `AudioV2` spatial) : **plus fort quand on s'approche**, atténué en
s'éloignant, **modulé par `state.fire`** (mort = silence, rugissant = nourri). Idem possible plus tard :
fumée/tannerie qui « bruissent » de près, pièges, etc. **Diégétique** et cohérent avec « la souris EST la
caméra ». À garder **léger** (un seul son en boucle, pas un par villageois).

## 3.8 Réseau / déterminisme — récapitulatif des garde-fous

- Audio **100 % local** : aucune nouvelle donnée dans `GameState`, le `StateSyncMsg`, le snapshot ou les
  actions. Rien à ajouter à `adoptSnapshot`/`isNetworkSafeAction`.
- **Cohérence P2P gratuite** : l'événement/feu/population arrivent par snapshot → les deux pairs déclenchent
  la **même** musique/event-music chacun de leur côté.
- **Déterminisme intact** : la sim ne sait pas que l'audio existe → `npm run test` (replay) reste vert
  **sans modification**. Variations sonores via `Math.random` uniquement.

---

## 3.9 Phasage par lots (chaque lot est testable & livrable)

On suit l'ordre habituel `data/ → render/(audio.ts) → ui/(réglages) → main.ts(branchement)`. **Aucun lot ne
touche `sim/`.**

| Lot | Contenu | Dépend de | Taille |
|---|---|---|---|
| **A1 — Socle** ✅ **FAIT** | `AudioManager` ([`src/render/audio.ts`](../src/render/audio.ts)) : init `AudioV2`, bus master/musique/SFX, cache + chargement paresseux, `playSfx`, déverrouillage au 1er clic ; `data/audio.ts` ; **réglages volume + mute dans Paramètres**, persistance `localStorage` ([`save.ts`](../src/save.ts)) | — | **M** |
| **A2 — Musique du feu** 🔥 ✅ **FAIT** | 5 pistes ↔ `state.fire`, **fondu enchaîné** (manuel par frame), branché sur le diff dans `reflectState` ; **SFX `light-fire`/`stoke-fire`** sur l'action. *L'accroche émotionnelle.* | A1 | **S** |
| **A3 — SFX d'action** ✅ **FAIT** | `gather-wood` (coupe camp + sauvage), `build` (construire/réparer/agrandir), `craft` (dépôt), `check-traps` (relève), **footsteps** (6 variantes au hasard, cadence régulière à la marche au sol). Câblés sur les fonctions d'interaction de `main.ts`. | A1 | **S/M** |
| **A4 — Feu spatial 3D** | crépitement positionné au foyer, volume = f(`state.fire`, distance) | A1 | **S** |
| **A5 — Musique d'événement (M5)** | overlay + **ducking** du fond, branché sur `state.activeEvent` ; clés ↔ nos ids d'événements | A1, A2 | **S** |
| **A6 — Musique de village/exploration** | `lonely-hut → raucous-village` selon la population ; `world` hors retranchement (M7) | A2 | **S** |
| **A7 — Plus tard (par jalon)** | `encounter-tier-*` (combat M8), `landmark-*` (sites M9), `ship`/`space`/`ending` (fin M11), armes/impacts | M8/M9/M11 | — |

**Premier jet conseillé** : **A1 + A2** (socle + musique du feu). C'est le plus fort rapport
émotion/effort, et ça valide toute la chaîne (déverrouillage, fondu, réglages, persistance).

## 3.10 Vérification (Definition of Done du lot audio) — A1+A2 ✅

- ✅ `npm run test` (sim) **inchangé et vert** : **120 tests** (preuve que l'audio n'a pas fui dans le cerveau).
- ✅ `npm run typecheck` vert.
- ✅ **e2e** (`tests/e2e.spec.ts`, **11 tests verts**) : un test dédié *« la musique suit l'état du feu et le
  menu Son règle les volumes »* expose `window.__game.getAudio()` et vérifie : au boot `music === "fire-dead"` ;
  allumer le feu → `"fire-burning"` ; attiser → `"fire-roaring"` ; les curseurs + mute présents et
  fonctionnels (le master suit le curseur, le bouton bascule le mute). *(Headless n'émet pas de son audible →
  on teste l'**état** voulu, posé indépendamment du déverrouillage ; l'écoute reste manuelle, comme WebGPU.)*
- ✅ **Runtime** (Playwright sur le serveur dev) : 0 erreur de boot/console ; déverrouillage du contexte au
  clic ; bascule de piste live à l'allumage. Capture : [`audio-settings.png`](audio-settings.png).
- **À faire à l'oreille** (vrai navigateur) : confirmer fondu enchaîné + SFX `light/stoke-fire`, et régler les
  volumes dans Paramètres puis recharger → réglages **persistés**.

## 3.11 Carte des fichiers touchés (récap)

```
public/audio/            ✅ FAIT — 86 .flac originaux récupérés (4,9 Mo), servis en statique
data/audio.ts            ✅ FAIT — manifeste (clés logiques → fichiers), swappable
src/render/audio.ts      ✅ FAIT — AudioManager (Babylon AudioV2 : bus, cache, fondus). Spatial = A4.
src/main.ts              ✅ FAIT — init audio, déverrouillage au 1er clic, setFireMusic dans reflectState,
                         SFX light/stoke (interactFire) + A3 (gather/build/deposit/check-traps + footsteps
                         dans la boucle), audio.update() dans la boucle, hook getAudio
src/ui/hud.ts            ✅ FAIT — section « Son » : curseurs général/musique/SFX, mute, + cases « Effets actifs »
src/save.ts              ✅ FAIT — saveAudioSettings/loadAudioSettings (volumes + mute + disabledSfx)
tests/e2e.spec.ts        ✅ FAIT — test « la musique suit l'état du feu et le menu Son règle les volumes »
index.html               ✅ FAIT — markup + styles de la section « Son »
scripts/transcode-audio.mjs  OPTIONNEL (futur) — .flac → .ogg (ffmpeg) pour alléger la musique
```
> Le déverrouillage au geste est branché côté `main.ts` (listener `pointerdown` sur le canvas) plutôt que
> dans `pointerLook.ts` — `AudioV2` gère déjà `resumeOnInteraction`, on double juste la sécurité.

---

## Sources

- Dépôt original (MPL-2.0) : <https://github.com/doublespeakgames/adarkroom>
- Moteur : [`script/audio.js`](https://github.com/doublespeakgames/adarkroom/blob/main/script/audio.js)
- Catalogue : [`script/audioLibrary.js`](https://github.com/doublespeakgames/adarkroom/blob/main/script/audioLibrary.js)
- Dossier des assets (74 `.flac`) : [`audio/`](https://github.com/doublespeakgames/adarkroom/tree/main/audio)
- Déclenchements : [`script/room.js`](https://github.com/doublespeakgames/adarkroom/blob/main/script/room.js)
- Notre moteur audio dispo : Babylon `@babylonjs/core` 9.11 → module `AudioV2` (audio spatialisé moderne).
