# Plan d'action — REBIND CLAVIER (remappage des touches, persisté)

> Polish / Chantier D (cf. [`reste-a-faire.md`](reste-a-faire.md) Phase 4). Permettre au joueur de
> **remapper les touches**, persisté en localStorage, sans rien casser. Établi APRÈS un inventaire
> EXHAUSTIF des usages clavier (ci-dessous) — c'est la condition pour ne rien oublier.

---

## 0. Inventaire EXHAUSTIF des usages clavier (état actuel)

### 0.1 Déplacement & interaction — `src/input/input.ts` (déjà abstrait en INTENTIONS)
C'est le **bon foyer** du rebind : la logique ne reçoit que des intentions (`MoveIntent` + consumers),
jamais des codes de touches. Aujourd'hui les touches sont des sets/littéraux EN DUR :

| Action logique | Touches | Lieu |
|---|---|---|
| Avancer | `z` `w` `arrowup` | `FWD_KEYS` (l.11) + `getIntent` (l.89) |
| Reculer | `s` `arrowdown` | `BACK_KEYS` (l.12) + `getIntent` (l.89) |
| Gauche | `q` `a` `arrowleft` | `getIntent` (l.90) |
| Droite | `d` `arrowright` | `getIntent` (l.90) |
| Sauter / monter (vol) | `" "` (espace) | `onKeyDown` (l.45) + `getIntent.vertical` (l.94) |
| Descendre (vol) | `shift` | `getIntent.vertical` (l.94) |
| Interagir | `e` | `onKeyDown` (l.49) |
| Manger / soigner | `f` | `onKeyDown` (l.50) |
| Double-appui (mêmes touches) | avant×2 / arrière×2 / saut×2 | `registerTap` (l.55) |

> **Décollage (RF8)** : pendant l'ascension, `main.ts` lit `raw.strafe`/`raw.forward` (la même intention)
> pour émettre `STEER`. **Rebinder le déplacement rebinde donc le pilotage automatiquement** — rien de
> spécial à faire côté vol.

### 0.2 Raccourcis GLOBAUX — `src/main.ts` window `keydown` (l.1082) — EN DUR, non abstraits
| Touche | Action | Note |
|---|---|---|
| `escape` | ferme l'UI ouverte, sinon ouvre Paramètres | **+ déverrouille le pointeur (navigateur)** — touche système |
| `f3` | bascule l'overlay debug | |
| `f2` | bascule l'éditeur de spawn | **DEV** |
| `v` | bascule 1re/3e personne | |
| `m` | minimap plein écran (RF4b) | |
| `r` (MAINTENU) | zoom « longue-vue » (keyup l.1123 relâche) | |
| `enter` | ouvre la console dev | **DEV** |

### 0.3 Navigation des DIALOGUES — `main.ts` (l.1116-1120) → `hud.dialogueNavigate/Adjust/Confirm`
Re-duplique le déplacement pour piloter l'UI au clavier : `arrowup|z|w` (haut) · `arrowdown|s` (bas) ·
`arrowleft|q|a` (−) · `arrowright|d` (+) · `e|enter` (valider).

### 0.4 Saisies MODALES / champs — NON rebindables (contextuelles)
- `src/ui/hud.ts` (l.451) : champ code de salon — `Enter` = rejoindre.
- `src/dev/console.ts` (l.111) : console DEV — `Enter` (exécute), `Escape` (ferme), `↑`/`↓` (historique).
  Capture sa propre saisie (`stopPropagation`).
- `src/dev/spawnEditor.ts` (l.502) : éditeur DEV — `Escape` (ferme), `[ ( ,` / `] ) .` (rotation),
  flèches (nudge), `Delete`/`Backspace` (supprime), `Enter` (mode chemin).

### 0.5 Indices de contrôle AFFICHÉS (à régénérer dynamiquement après rebind)
- `index.html` `#helpPanel` : « ZQSD se déplacer · Espace sauter · E interagir · Échap menu ».
- `index.html` `#titleScreen .titleHint` : « souris : caméra · ZQSD : se déplacer · E : interagir ».
- `index.html` `#combatPanel .chint` : « E frapper · F manger ».
- HUD dynamique (`main.ts`) : `[E] tirer`, `ESQUIVE (ZQSD)` (libellés du décollage), badge `E` de `#interactPrompt`.
- `README.md` (tableau des contrôles) — doc, mise à jour manuelle.

### 0.6 Config
- `config.explore.doubleTapMs` (fenêtre du double-appui) — inchangé.

### 0.7 Détails techniques à préserver
- Les touches sont comparées en `e.key.toLowerCase()` (donc `"z"`, `"arrowup"`, `" "`, `"shift"`…).
- `preventDefault` sur Espace (scroll) et flèches (scroll) ; à conserver pour les touches liées.
- Garde « ne pas capturer si on tape dans un INPUT/TEXTAREA » (input.ts l.39, main.ts l.1097).
- `onBlur` vide `down` (anti-touche-collée).
- **Aucune incidence simulation** : le rebind est 100 % présentation/entrée (pas de RNG, pas d'action sim).

---

## 1. Périmètre (ce qui est rebindable, ce qui ne l'est pas)

**Rebindable (le set « joueur ») :** avancer, reculer, gauche, droite, sauter/monter, descendre,
interagir, manger, + bascules **V** (vue), **M** (minimap), **R** (longue-vue), **F3** (debug).

**FIXE (non rebindable) — et pourquoi :**
- **Échap** : touche système (déverrouille aussi le pointeur navigateur) + « retour » universel. La laisser
  fixe évite les pièges (un joueur qui rebinde Échap se piège hors des menus).
- **Outils DEV** : `Entrée` (console), `F2` (éditeur), et toutes les touches internes console/éditeur.
- **Champs de saisie** (code de salon, console) : contextuels.
- **Navigation dialogue** : N'A PAS de binding propre — elle **réutilise** les bindings de déplacement
  (haut=avancer, bas=reculer, etc.) + valider=interagir. Donc elle suit le rebind automatiquement.

> **Décision** : 1 action peut avoir **plusieurs touches** (comme `z`+`w`+`↑` aujourd'hui) — on garde
> ZQSD **et** WASD **et** flèches par défaut (AZERTY/QWERTY). Le rebind permet d'ajouter/remplacer.

---

## 2. Architecture cible

Un **modèle de bindings central**, pur et testable, consommé par TOUS les lecteurs de touches.

### 2.1 `src/input/keybindings.ts` (NOUVEAU — pur, testable)
```ts
export type Action =
  | "forward" | "back" | "left" | "right" | "jump" | "descend"
  | "interact" | "eat" | "toggleView" | "toggleMinimap" | "spyglass" | "toggleDebug";

export type Bindings = Record<Action, string[]>; // touches en e.key.toLowerCase()

export const DEFAULT_BINDINGS: Bindings = {
  forward: ["z", "w", "arrowup"], back: ["s", "arrowdown"],
  left: ["q", "a", "arrowleft"], right: ["d", "arrowright"],
  jump: [" "], descend: ["shift"], interact: ["e"], eat: ["f"],
  toggleView: ["v"], toggleMinimap: ["m"], spyglass: ["r"], toggleDebug: ["f3"],
};

// PUR : normalisation d'une touche capturée, détection de conflit, set/clear, merge defaults.
export function normalizeKey(e: KeyboardEvent): string  // e.key.toLowerCase() (" " pour Espace)
export function actionForKey(b: Bindings, key: string): Action | null  // 1er match (raccourcis globaux)
export function withBinding(b: Bindings, action: Action, key: string): Bindings  // ajoute, en retirant le doublon ailleurs
export function clearBinding(b: Bindings, action: Action, key: string): Bindings
export function mergeDefaults(partial: Partial<Bindings>): Bindings  // back-fill (évolution du schéma)
```
- **Réservé** : `normalizeKey` rejette `escape`, `f2`, `enter`, `tab` (touches fixes/système) -> la capture
  les ignore.
- **Conflit** : `withBinding` retire la touche de toute AUTRE action (une touche = une action pour les
  globaux ; pour le déplacement, plusieurs touches par action restent permises).

### 2.2 Persistance — `src/save.ts`
`saveKeybindings(b)` / `loadKeybindings(): Partial<Bindings> | null` (même pattern que
`saveComfortSettings`/`loadComfortSettings`, clé localStorage dédiée). Boot : `mergeDefaults(loaded ?? {})`.

### 2.3 `InputManager` consomme les bindings (refactor léger)
- Le constructeur prend `bindings: Bindings` (ou un getter `() => Bindings`).
- Remplacer `FWD_KEYS`/`BACK_KEYS`/les littéraux de `getIntent` par des lookups : `axis(bindings.back,
  bindings.forward)`, `bindings.left`/`right`, `jump`=`bindings.jump`, `vertical`=`jump`(up)−`descend`(down).
- `interact`/`eat` : `onKeyDown` teste `bindings.interact.includes(k)` / `bindings.eat.includes(k)`.
- Double-appui : `registerTap` mappe `k` -> action via `forward`/`back`/`jump` (au lieu des sets en dur).
- `preventDefault` : garder pour toute touche liée qui est Espace/flèche (générique : si `k===" "` ||
  `k.startsWith("arrow")`).
- **Méthode `setBindings(b)`** pour appliquer un rebind à chaud (sans recréer l'InputManager).

### 2.4 `main.ts` raccourcis globaux consomment les bindings
- Remplacer les `k === "v"` / `"m"` / `"r"` / `"f3"` par `actionForKey(bindings, k)` -> switch sur l'action.
- `escape`/`enter`(console)/`f2` restent EN DUR (hors périmètre).
- La nav dialogue (l.1116-1120) : remplacer les littéraux par `bindings.forward.includes(k)` (haut),
  `back` (bas), `left` (−), `right` (+), `interact`/enter (valider).
- Le keyup `r` (longue-vue) -> `bindings.spyglass.includes(k)`.

### 2.5 UI — panneau « Paramètres des touches » (le bouton existe déjà, désactivé)
`index.html` l.255 : `<button class="settingsBtn" disabled>Paramètres des touches — bientôt</button>`.
- Le rendre actif -> ouvre une **sous-vue** (réutilise le style `.settingsBtn`/sections du menu).
- Liste les actions rebindables (libellés FR) + leurs touches actuelles (chips). Clic sur une action ->
  **mode capture** (« appuyez sur une touche… ») : le prochain `keydown` (hors réservées) appelle
  `withBinding`, persiste, ré-applique (`input.setBindings`), re-rend la liste + les indices affichés.
- Boutons : **Réinitialiser** (defaults), et par action **+** (ajouter une touche) / **×** (retirer).
- Conflit : si la touche était sur une autre action, elle en est retirée (feedback visuel).

### 2.6 Indices affichés régénérés (cf. 0.5)
- Fonction `keyLabel(action)` (1re touche liée, jolie : « Espace », « ↑ », « Clic »…) -> alimente
  `#helpPanel`, `#titleScreen .titleHint`, `#combatPanel .chint`, le badge `#interactPrompt`, et les
  libellés HUD du décollage. Recalculés au boot et après chaque rebind.
- `README` : note manuelle « touches par défaut, remappables dans Paramètres ».

---

## 3. Étapes (ordre `data/util → input → main → ui → hints → docs`)

1. **`keybindings.ts`** (pur) + **tests vitest** : defaults, `normalizeKey` (espace/shift/flèches, rejette
   réservées), `actionForKey`, `withBinding` (retrait du doublon), `clearBinding`, `mergeDefaults`
   (back-fill). *Aucune dépendance DOM -> testable au terminal.*
2. **`save.ts`** : `saveKeybindings`/`loadKeybindings` (+ test round-trip).
3. **`InputManager`** : consomme `Bindings` + `setBindings` (refactor des sets en dur). Vérifier que
   `getIntent` produit les mêmes intentions qu'avant avec les defaults (non-régression).
4. **`main.ts`** : raccourcis globaux + nav dialogue + keyup via `actionForKey`/`bindings`. Instancier
   les bindings au boot (load+merge), les passer à l'InputManager.
5. **UI** : activer le bouton, vue de remappage (capture/clear/reset), persistance + application à chaud.
6. **Indices affichés** : `keyLabel` + régénération (helpPanel/titleHint/combat/HUD/prompt).
7. **Docs** : `reste-a-faire.md` (rebind coché), `README` (note), `architecture.md` (input.ts + keybindings.ts).

---

## 4. Pièges anticipés
- **Échap rebindé = piège** -> on l'exclut (réservé). Idem `Entrée`/`F2` (DEV) et `Tab` (focus navigateur).
- **Doubles bindings** : garder « plusieurs touches par action » (AZERTY+QWERTY+flèches par défaut) ;
  le conflit ne s'applique qu'entre actions distinctes.
- **`preventDefault`** : conserver pour Espace/flèches liées (sinon scroll de page).
- **Champs de saisie** : la garde INPUT/TEXTAREA reste ; la capture de rebind se fait dans un mode dédié
  (pas un `<input>`), donc pas de conflit avec la garde.
- **Nav dialogue** : ne PAS lui donner de bindings propres -> elle suit le déplacement (sinon double
  source de vérité). Valider = `interact`.
- **Application à chaud** : `setBindings` plutôt que recréer l'InputManager (préserve l'état `down`).
- **Modificateurs** (`shift`) comme binding : autorisé (descend) mais ne pas capturer `shift`/`ctrl`/`alt`
  SEULS pour les actions « tap » (interact/eat) -> ambiguïté ; à n'autoriser que pour les axes maintenus.
- **Pas de sim touchée** : zéro risque déterminisme/réseau (présentation pure).
- **e2e existants** : le mapping par défaut est IDENTIQUE à aujourd'hui -> les 20 e2e (qui tapent `e`,
  flèches, etc.) ne bougent pas.

---

## 5. Vérification
1. `npm run typecheck`.
2. `npm run test` : bloc `keybindings` (purs) + round-trip save. Non-régression `getIntent` (defaults ==
   comportement actuel).
3. `npm run e2e` : (a) non-régression des 20 ; (b) **nouveau** — ouvrir Paramètres -> touches -> rebinder
   « interagir » de `E` vers (ex.) `G` -> vérifier qu'`G` déclenche l'interaction et que `E` ne le fait
   plus ; **Réinitialiser** -> `E` rebranché. (Via clics DOM + dispatch de `keydown`.)
4. **Preview** : panneau de remappage lisible, capture/clear/reset OK, indices `#helpPanel`/titre mis à jour.

---

## 6. Ampleur
**M** — 1 module pur + tests, refactor léger de l'InputManager (iso-comportement par défaut), wiring
`main.ts`, une sous-vue de menu, et la régénération des indices. Risque faible (présentation pure,
mapping par défaut inchangé → e2e protègent la non-régression). Pas de surface réseau/sim.
