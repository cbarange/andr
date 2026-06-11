# A Dark Room 3D — Proof of Concept

Tranche verticale jouable d'un jeu inspiré d'*A Dark Room*, en **3D web native**.
Le POC prouve que toute la chaîne technique fonctionne ensemble : monde 3D stylisé,
personnage physique (gravité + collisions), une ressource (le **bois**), et une
architecture **prête pour le multijoueur P2P**, le tout dans le navigateur, sans
installation.

> Ce n'est pas le jeu final, c'est la **fondation**.

> ### 📌 Le projet a LARGEMENT dépassé le POC initial *(MAJ juin 2026)*
> Au-delà de la boucle de village d'A Dark Room (feu → construction → population → métiers, **jouable**),
> le projet a désormais : un **monde carré exploré** (biomes en régions, vraies bordures montagnes/océans,
> ~57 **sites variés**, **grottes/mines explorables**, **routes** qui se tissent), un **village vivant &
> harmonieux** (placement mathématique, lanternes, ruines, villageois dans les huttes), et de l'**audio**.
> Manquent surtout : **survie, combat, commerce, fin de partie**. Pour reprendre, lire dans l'ordre :
> - **[docs/etat.md](docs/etat.md)** — état d'avancement, ce qui marche, décisions, prochaine étape (**à lire en premier**).
> - **[docs/roadmap-v2.md](docs/roadmap-v2.md)** — **roadmap des jalons à jour** (tableau de bord, ✅/🟡/🔴/❌).
> - **[docs/architecture.md](docs/architecture.md)** — architecture technique (carte des fichiers, systèmes, hooks de debug).
> - **[docs/roadmap.md](docs/roadmap.md)** — analyse du jeu original + principes de portage (Parties 1–2).
>
> Les sections « Choix faits », « Definition of Done » et « Idées futures » ci-dessous datent du
> **POC initial** (valeur historique) ; l'état courant fait foi dans `docs/` (`etat.md` + `roadmap-v2.md`).

---

## Démarrage rapide

```bash
npm install        # installe les deps + copie le WASM Havok dans public/ (postinstall)
npm run dev        # serveur de dev Vite -> http://localhost:5173
```

| Commande            | Effet                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| `npm run dev`       | Lance le jeu (rechargement à chaud) sur `http://localhost:5173`.      |
| `npm run test`      | Tests **unitaires de la simulation** (Vitest, terminal, sans Babylon).|
| `npm run e2e`       | Tests **Playwright** : lance le jeu headless, vérifie, capture l'écran.|
| `npm run build`     | Build de production optimisé dans `dist/`.                            |
| `npm run preview`   | Sert le build de production sur `http://localhost:4173`.              |
| `npm run typecheck` | Vérification TypeScript stricte (`tsc --noEmit`).                     |

### Contrôles

| Touche                          | Action            |
| ------------------------------- | ----------------- |
| `Z` `Q` `S` `D` / `W` `A` `S` `D` / flèches | Se déplacer       |
| `Espace`                        | Sauter            |
| `E`                             | **Interagir** avec l'objet ciblé — une étiquette flottante indique l'action (« couper », « nourrir le feu », « parler », « déposer », « relever le piège ») |
| Souris                          | **Oriente la caméra** dès qu'on la bouge (pointeur capturé, curseur masqué). **Cliquer une fois** dans la scène pour activer la capture. |
| Molette                         | Zoom caméra |
| `Échap`                         | Ouvre le **menu Paramètres** (centré) ; ou **ferme** l'interface ouverte (dialogue / tableau / menu). |
| Interfaces (dialogue, tableau, menu) | Le **curseur est libéré** pour cliquer. Les dialogues restent aussi navigables au clavier (`ZQSD`/flèches + `E`). |

> **Sauvegarde automatique** (façon A Dark Room) : la partie est sérialisée dans le `localStorage`
> du navigateur toutes les ~15 s et à la fermeture de l'onglet ; elle est **restaurée au
> rechargement**. (La simulation reste en mémoire ; `localStorage` ne sert qu'à la persistance.)
> Le **multijoueur** (rejoindre un salon) se trouve dans le menu **Paramètres** (`Échap`).

> Le jeu est **diégétique** : pas de panneaux de gestion. On agit avec **E** sur les objets
> (étiquette flottante au niveau de l'objet) ou via des **dialogues**.
>
> **Boucle (cf. [docs/roadmap.md](docs/roadmap.md))**
> 1. **Couper du bois** (E sur un arbre — 3 coups, l'arbre tombe puis un autre repousse ailleurs).
>    Le bois va dans votre **sac**, qui est **plafonné**.
> 2. **Allumer puis nourrir le feu** (E près du feu) — consomme le bois **du sac** ; le feu
>    refroidit avec le temps. Une **étrangère** attirée par les flammes arrive et se réchauffe.
> 3. Une fois réchauffée, parlez-lui (E) : sa première action est de **réparer la cabane** en ruine.
>    La cabane devient l'**entrepôt** / mairie du village.
> 4. **Déposer** votre sac au **coffre** dans la cabane (E) → remplit l'entrepôt. Chaque ressource
>    découverte a son **étagère** avec sa quantité (les autres restent cachées).
> 5. La constructrice débloque alors la **construction** (pièges, charrette, hutte…), payée depuis
>    l'entrepôt.
> 6. Les huttes attirent des **villageois** ; dans le dialogue, *répartir les villageois* par métier
>    (bûcheron, chasseur…). Les ouvriers remplissent l'entrepôt **automatiquement** — l'automatisation
>    soulage la récolte manuelle. Gare à la **famine** si les chaînes ne sont pas équilibrées.

---

## Jouer à deux (multijoueur P2P)

Le multijoueur utilise **WebRTC** via **Trystero** (stratégie *Nostr* par défaut :
le signaling passe par des relais publics, **rien à héberger**).

1. Lancez `npm run dev`.
2. Ouvrez **deux onglets/navigateurs** sur `http://localhost:5173`.
3. Dans chacun, ouvrez le **menu Paramètres** (`Échap`), saisissez **le même code de salon**
   et cliquez **Rejoindre**. Astuce : `http://localhost:5173/?room=monsalon` rejoint
   automatiquement.
4. Résultat attendu : chaque joueur voit **l'avatar de l'autre** bouger, et le
   **compteur de bois est partagé** (si l'un récolte, le total monte pour les deux).

> Pour tester depuis deux machines différentes, exposez le port (`npm run dev` écoute
> déjà sur le réseau local) ou déployez `dist/`. Sur réseaux très restrictifs, un relais
> TURN serait nécessaire (hors périmètre, voir « Idées futures »).

### Modèle réseau (hôte-autoritaire)

- Le **premier pair** d'un salon (id le plus petit, calcul identique chez tous) est
  l'**hôte** : il détient l'état officiel de la simulation (le bois partagé).
- `playerTransform` : position/rotation de l'avatar, **diffusé par chaque pair** et
  **interpolé** chez les autres.
- `gameAction` (ex. `GATHER_WOOD`) : **envoyée à l'hôte**, qui l'applique à l'état
  autoritaire puis **rediffuse** le total (`stateSync`).
- ⚠️ La **physique reste locale** à chaque joueur (chacun simule la sienne et diffuse
  sa position). Seule la **simulation de jeu** (le bois) est rendue cohérente par
  l'autorité de l'hôte. Ce sont deux choses distinctes (§7 du brief).

---

## Architecture (le point le plus important)

Le code sépare strictement **le cerveau** (simulation pure) du **corps** (rendu), de
**l'interface** (DOM), du **réseau** et de la **persistance**.

> 🗺️ **La carte des fichiers à jour et le détail des systèmes** (sac/entrepôt, dialogues,
> caméra pointer-lock, sauvegarde, P2P host-autoritaire, hooks de debug) sont dans
> **[docs/architecture.md](docs/architecture.md)**. Aperçu : `data/world.ts` (données/réglages) ·
> `src/sim/` (cerveau pur testable) · `src/render/` (Babylon : scene, world, forest, cabin,
> buildings, villagers, stranger, player, camera, remotePlayer, physics) · `src/ui/hud.ts` (HUD +
> dialogues + menu) · `src/input/` (input, pointerLook) · `src/net/` (Trystero) · `src/save.ts`
> (sauvegarde) · `src/main.ts` (orchestration).

Principes appliqués (§3 du brief), toujours valables :

1. **Cerveau ≠ corps** — `sim/` n'importe ni Babylon ni le DOM ; il est testé au
   terminal (`npm run test`, **~169 tests**). Le rendu/UI **lisent** l'état et **émettent**
   des actions.
2. **Piloté par les données** — tout le contenu (bois, positions des arbres, équilibrage)
   vit dans [`data/world.ts`](data/world.ts).
3. **Déterminisme** — état + même séquence d'actions ⇒ même résultat. Tout aléatoire
   passe par le RNG à graine ([`rng.ts`](src/sim/rng.ts)) ; **jamais** `Math.random()`
   dans la logique (vérifié par les tests de replay).
4. **Actions, pas états** — toute mutation passe par une action sérialisable : c'est ce
   qui circule sur le réseau.
5. **Abstraction des entrées** — la logique reçoit des intentions (« avancer »,
   « interagir »), pas des codes de touches.
6. **Boucle à pas fixe** — la simulation avance par tics fixes (20 Hz), indépendamment
   du framerate ; le rendu interpole.

---

## Style visuel (§5)

Low-poly (primitives : un arbre = cylindre + cône), **flat shading**, **vertex colors**
+ dégradés (pas de textures lourdes), **brouillard** (ambiance + perf), une lumière
directionnelle douce + une ambiante, et un **post-processing léger** (color grading,
vignettage, grain, FXAA, bloom discret pour la lueur du feu). Palette restreinte,
crépusculaire/froide, centralisée dans `PALETTE` ([`scene.ts`](src/render/scene.ts)).

Capture committée : [`tests/screenshot.png`](tests/screenshot.png) (générée par Playwright).

---

## Performance (§8)

- **WebGPU prioritaire, repli WebGL2 automatique** (détection `WebGPUEngine.IsSupportedAsync`,
  repli dans un `try/catch`). Le badge en bas à droite indique le rendu actif.
- **Arbres instanciés** (un mesh de base + `createInstance`) → peu de draw calls.
- **Brouillard** qui masque le lointain.
- Téléchargement : ~**1,3 Mo de JS gzippé** + **2 Mo de WASM Havok** — très en deçà du
  budget de 25 Mo.

---

## Choix faits (et pourquoi)

En cas d'ambiguïté, le brief demande la solution la plus simple respectant le §3 ; voici
les décisions notables :

- **Trystero — stratégie Nostr (défaut).** L'import `trystero` pointe sur la stratégie
  Nostr (relais publics), plus fiable que les trackers BitTorrent et sans config.
- **WASM Havok servi depuis `public/`.** Le package `@babylonjs/havok` n'expose pas son
  `.wasm` via son champ `exports` (import `?url` impossible). Un script
  ([`scripts/copy-havok-wasm.mjs`](scripts/copy-havok-wasm.mjs)) le copie dans `public/`
  (hooks `postinstall`/`predev`/`prebuild`) et il est localisé via `locateFile`. Robuste
  en dev **et** au build. `src/render/physics.ts` (non listé dans le §9) isole ce chargement.
- **Imports Babylon depuis `@babylonjs/core` (top-level).** Choisi pour la fiabilité ;
  Rollup tree-shake l'inutilisé. Le budget de 25 Mo étant large, on n'a pas poussé les
  *deep imports* (optimisation listée en « idées futures »).
- **Détection « au sol » analytique.** Le saut/gravité s'appuie sur `terrainHeight()`
  (data) plutôt qu'un raycast, car le terrain est déterministe : plus simple et stable.
- **Mise en évidence de l'arbre récolté = pulsation d'échelle.** Le *vertex color* (tronc
  brun / feuillage vert) et une couleur par instance partagent le même attribut de shader ;
  pour préserver les deux couleurs de l'arbre, la mise en évidence est une brève pulsation
  (le brief précise que le changement de couleur est « optionnel minimal »).
- **Collisions des arbres = cylindres statiques invisibles.** Les instances ne portent pas
  de physique propre ; un collider statique par arbre (peu coûteux) gère le « ne pas traverser ».
- **Hook de debug `window.__game`.** Expose des lecteurs et déclencheurs d'actions pour
  l'auto-vérification Playwright et le debug console (sans effet sur le gameplay). Liste complète
  à jour dans [docs/architecture.md](docs/architecture.md) §11.
- **Headless = WebGL2.** Chromium headless n'a pas de GPU : Playwright force le rendu
  logiciel (SwiftShader) → le repli WebGL2 est testé de façon déterministe. **Le chemin
  WebGPU se vérifie manuellement** dans un vrai navigateur (badge « rendu : WEBGPU »).

---

## Vérification (Definition of Done, §11)

- ✅ `npm install` puis `npm run dev` lancent le jeu sans erreur.
- ✅ Démarre en WebGPU, repli WebGL2 si absent (sans plantage).
- ✅ Scène 3D stylisée : sol vallonné, arbres, feu de camp, fog, post-processing.
- ✅ Personnage clavier, gravité, ne traverse ni le sol ni les arbres, saute.
- ✅ Caméra de suivi 3e personne.
- ✅ S'approcher d'un arbre + `E` augmente le compteur de bois (UI HTML).
- ✅ Simulation pure testable : `npm run test` (**~169 tests** aujourd'hui) sans Babylon.
- ✅ Aucun `Math.random()` dans la logique (RNG à graine + test de replay déterministe).
- ✅ Architecture P2P + mode 2 joueurs (avatars + bois partagé hôte-autoritaire).
- ✅ Perf : 60 FPS visés, téléchargement réduit.
- ✅ README (lancement, tests, P2P, choix).
- ✅ Capture d'écran Playwright committée ([`tests/screenshot.png`](tests/screenshot.png)).

Couverture automatique : `npm run test` (sim) + `npm run e2e` (boot, rendu/repli WebGL2,
chaîne action→sim→UI sur le bois, **gravité + collision sol**, **entrées→déplacement**,
**init P2P + bascule HUD**). Le scénario « deux navigateurs partagent le bois » est à
vérifier **manuellement** (cf. « Jouer à deux »), car il dépend de WebRTC + relais publics
(difficile à rendre fiable en headless).

---

## Idées futures (telles que notées au POC)

> ℹ️ Plusieurs de ces items ont depuis été **réalisés** (ressources multiples, construction,
> population/métiers, persistance/sauvegarde…) ou sont **planifiés par jalons** dans
> [docs/roadmap.md](docs/roadmap.md) (événements M5, monde/survie M7, combat M8, mines M9, fin M11).
> Restent surtout des optimisations/finitions :

- Synchronisation réseau par **échange d'actions** (lock-step) plutôt que par snapshot d'état
  (la sim est déjà pure & déterministe pour le permettre).
- Relais **TURN** pour les réseaux restrictifs.
- *Deep imports* Babylon + code-splitting (bundle).
- Ombres portées (désactivées pour le budget perf), LOD, occlusion ; streaming de terrain pour M7.
- **Audio** : socle + musique de l'état du feu **faits** (cf. [docs/plan-audio.md](docs/plan-audio.md)) ;
  reste SFX d'action, feu spatial 3D, musique d'événement/village. Écran-titre, emballage bureau (Tauri) /
  mobile (Capacitor) restent à faire.
```
