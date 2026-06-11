# Bonnes pratiques — qualité d'expérience joueur

> ⚠️ **MAJ juin 2026 — déjà implémenté** (cocher au fil) : ✅ **juice** HUD (count-up + pop au gain, `prefers-reduced-motion`),
> ✅ **confort** (sliders **FOV** + **sensibilité souris**, persistés), ✅ **villageois dans les huttes** + son de porte,
> ✅ **règle du triangle/bordures** & **biomes distincts** (Chantier C). **Reste prioritaire** : **onboarding** par
> révélation progressive, **rebind clavier** (tuer le bouton « bientôt »), **cycle jour/nuit**, **AO/ombres de contact**,
> **fog ré-activé + ACES**, **reverb par zone** (grottes/cabane). Le reste de ce document = backlog & références.

> **Synthèse de recherche (industrie du jeu vidéo)** appliquée à *A Dark Room 3D* : ce qui rend un jeu
> **agréable, réactif, fluide et beau**. Établie par recherche web (sources en fin de section) sur 6 piliers :
> **fluidité/perf · game feel · UX/caméra/onboarding/accessibilité · design open-world & incrémental ·
> graphisme/lumière/atmosphère · audio**.
>
> But : **enrichir** la doc avec les thématiques, contraintes et optimisations **standard** de l'industrie —
> y compris celles qu'on aurait pu oublier. Chaque point est **tagué** par rapport à NOTRE état :
> ✅ déjà fait · 🟡 partiel à renforcer · 🔴 manquant à fort impact. Priorité : **P0** (gros levier, à faire tôt)
> · **P1** (renforcer l'existant) · **P2** (polish). Détail perf rendu : [`perf-rendu.md`](perf-rendu.md) ;
> refonte monde/camp : [`refonte-monde-campement.md`](refonte-monde-campement.md).

---

## 0. Top priorités transverses (la « short-list »)

| # | Levier | Pilier | Pourquoi c'est le plus rentable | Tag |
|---|---|---|---|---|
| 1 | **Onboarding diégétique par révélation progressive** | UX/design | C'est **l'ADN d'A Dark Room** (1 bouton → un monde) — gratuit en alignement de marque, résout l'absence de tuto | 🔴 P0 |
| 2 | **Bâtiments/cabane en merge+instance** + tuer les allocs/frame | perf | Plus gros gain draw-calls/jank (déjà identifié en A5/drift) | 🔴 P0 |
| 3 | **Cycle jour/nuit** (lumière = ambiance) + **AO/ombres de contact** | graphisme | « postcard → monde vivant » ; l'AO est le levier cheap→premium n°1 | 🔴 P0 |
| 4 | **Juice de la boucle** : nombres animés, pop d'échelle/couleur, easing, **un son par action** | feel | Transforme une boucle de gestion « tableur » en quelque chose de tactile | 🔴 P0 |
| 5 | **Terrain en « triangles »/landmarks** + **biomes distincts** + **compas diégétique** | design open-world | Le remède n°1 au « monde vide/répétitif » (renforce la refonte §A/B) | 🔴 P0 |
| 6 | **Accessibilité/confort de base** : rebind, FOV, head-bob/shake toggles, sensibilité | UX/access | Standard attendu aujourd'hui ; chaque item est petit | 🔴 P0 |
| 7 | **Reverb par zone** (grottes/cabane) + **fog ré-activé** (couleur = ciel) | audio/graphisme | « tu es quelque part » à très bas coût ; profondeur atmosphérique gratuite | 🟡 P1 |

---

## 1. Fluidité & performance (web / Babylon.js / open-world)

> Socle déjà solide (streaming par chunks + hystérésis, LOD entités/props, instancing arbres/décor/sites,
> matrices figées, fog exp2, autoperf ~55 FPS, plafond de delta). Compléments standard de l'industrie :

- **Budget 16,6 ms (60 FPS)** : viser **~14 ms** (marge anti-pic). Savoir si on est **CPU-bound** (draw calls, JS, GC) ou **GPU-bound** (fill, shaders, résolution) — fixes opposés. La **constance** (pas de pics) compte plus que la moyenne. 🟡
- **Réduction des draw calls** (plus gros levier CPU) : **merge** des bâtiments/cabane statiques (par bâtiment/chunk) + `freezeWorldMatrix()` + `material.freeze()` ; **thin instances** pour les très grandes quantités (herbe/cailloux) → **0 surcoût JS par instance** (vs `InstancedMesh` qui crée un objet JS/instance). Cible : **draw calls dans les bas centaines**. 🔴 P0 *(cf. A5/drift)*
- **Allocations par frame = principal jank web (GC)** : bannir `new Vector3` (utiliser `TmpVectors` + math `*ToRef`), **supprimer `JSON.stringify` du hot path** (dirty-flags/compteurs de version ; save throttlée/hors boucle ; réseau en binaire/au débit réseau), ne pas reconstruire de tableaux via `map/filter` chaque frame (muter en place). Vérifier la **dent de scie** du heap dans DevTools. 🔴 P0
- **Amortir le build de chunk** (time-slicing ≤ ~2 ms/frame) + **Web Workers** (génération mesh/JSON hors thread principal, buffers transférables). Évite les pics de streaming. 🔴 P1
- **Cacher le pop-in** : placer le rayon d'unload **dans le fog** ; **fade-in** des nouveaux chunks (alpha 0→1 sur ~0,3 s) ; LOD lointain en **billboard/HLOD** ; dernier palier LOD = **`null` (cull total)**. 🟡 P1
- **DRS affinée** : piloter sur le **temps GPU** (la résolution n'aide pas si CPU-bound) ; **rampe asymétrique** (baisser vite < 55 FPS, remonter lentement > ~58 FPS soutenus) ; bornes (~0,6–1,0). 🟡 P1
- **Contraintes web souvent oubliées** : **Page Visibility API** → pauser sim/physique/audio en onglet caché (le rAF est gelé ; sinon gros `dt` au retour) 🔴 P1 ; **KTX2/Basis** (textures) + **Draco** (glTF importés) + **brotli** du bundle + **tree-shaking Babylon** → first-load rapide (falaise de rétention) 🟡 P2 ; **throttling thermique mobile** (cap FPS, budgets réduits) 🟡 P2.
- **WebGPU** : gros gains **CPU** (draw calls), quasi-parité GPU ; **Snapshot Rendering** ~×10 sur géométrie **statique** (après merge). Mais **corriger les draw calls d'abord** (le repli WebGL2 doit rester fluide). 🟡 P2
- **À NE PAS faire** : occlusion culling GPU (async, 1 frame de retard, popping, faible gain pour des petits objets épars) → s'en tenir à frustum + distance + fog. ✅ (bon choix actuel)

---

## 2. Game feel / « juice » / réactivité

- **Boucle de correction < ~100 ms** (Swink) : tout input doit avoir un **retour audiovisuel immédiat**. La réactivité prime sur le réalisme. 🟡
- **Juice = sortie maximale pour entrée minimale** (un clic → feedback partout). Techniques cheap & à fort impact pour une boucle de gestion :
  - **Nombres animés** (les ressources **comptent** vers leur valeur, ne sautent pas). 🔴 P0
  - **Pop d'échelle + flash de couleur/émissif** sur gain de ressource / pose de bâtiment (1,0→1,15→1,0 ease-back). 🔴 P0
  - **Easing partout** (ease-out à l'arrivée, ease-out-back pour le « snap ») sur **toute** transition HUD/objet. 🔴 P0
  - **Particules** : poussière au pas, étincelles/fumée à la construction, petite gerbe au gain. 🟡 (on a déjà étincelles feu/feuilles/fumée)
  - **Un son sur chaque action** (moitié du « juice », le moins cher des gains). 🟡
  - **Screen shake / hit-stop** : **avec parcimonie** (réservé aux gros temps forts) et **toujours désactivable** (nausée/lisibilité). 🔴 (toggle requis, cf. §3)
- **À éviter** : sur-juicer (bruit visuel, illisibilité, mal des transports). Effets courts (100–300 ms), pas 5 empilés sur un événement.
- **Affordances + buffering** : surligner l'interactif (rim/émissif au survol/proximité) ; **bufferiser** l'appui `E` pendant une transition (ex. bascule auto FPV en cabane) pour ne jamais « manger » l'input. 🟡 P1

---

## 3. UX · caméra · onboarding · accessibilité

### 3.1 Onboarding — **le plus gros levier, et le plus on-brand** 🔴 P0
- **Révélation progressive diégétique** : A Dark Room est **l'exemple canonique** (un bouton → tout un monde). Préserver cet arc en 3D : démarrer **petit/sombre** (la pièce), assembler le camp, **puis** dévoiler l'horizon/compas. Chaque déblocage = une **découverte**, pas une entrée de menu.
- **Révéler l'UI au fur et à mesure** (le compteur de ressource apparaît au 1er gain, etc.) — pas de HUD plein dès la minute 1. Hints **courts, narratifs, skippables**, sur 1ʳᵉ rencontre d'un verbe. **Pas de mur de tuto** : le but volontairement caché EST le ressort.

### 3.2 Caméra (« ~50 % du game feel ») 🟡 P1
- Suivi **amorti/critique** (damping ~4–6 pour l'exploration, confortable). On a déjà **spring-arm + fondu de toit + pointer-lock**.
- **Transition 3ᵉ↔1ʳᵉ personne en fondu/dolly eased** (pas de cut), direction du regard préservée. **Look-ahead** subtil.
- **3ᵉ personne = moins de nausée** que la 1ʳᵉ : caméra stable, ni trop lente ni trop rapide.

### 3.3 Accessibilité & confort — **socle « Basic » attendu** 🔴 P0
*(Game Accessibility Guidelines — les 4 manques les plus signalés : rebind, taille de texte, daltonisme, sous-titres.)*
- **Rebind clavier** (remplacer le bouton « bientôt ») + les **étiquettes E** affichent la **touche réelle** (pas « E » en dur). 🔴
- **Slider de sensibilité souris**, **slider FOV** (FOV bas = nausée), **toggle head-bob**, **toggle/intensité screen-shake** + **respecter `prefers-reduced-motion`** (atténuer shake/tweens/particules). 🔴
- **Sous-titres lisibles** pour tout dialogue ; **rien de critique uniquement par le son OU la couleur** (notre audio riche doit avoir un équivalent visuel). **Volumes séparés** ✅ (on les a). **Tous les réglages persistés.** 🟡
- *(Intermédiaire, P2)* : modes daltoniens / palette colorblind-safe, contraste réglable, option vitesse de jeu, options d'assistance (modèle « Assist Mode » de Celeste).

### 3.4 Lisibilité & friction 🟡 P1
- HUD **minimal** + **révélation progressive** ; **feedback animé** sur chaque changement d'état (delta +/- animé + flash + son). Diégétique pour le peu urgent, overlay net pour le critique/sous pression.
- **Indicateur « sauvegardé » visible** + **save sur `visibilitychange`/`beforeunload`** (pas qu'à l'intervalle) + **gestion propre du blur** (pointer-lock + pause). On a déjà l'autosave ✅.

---

## 4. Design open-world & incrémental (exploration, guidage, progression, survie)

> Renforce directement la refonte ([`refonte-monde-campement.md`](refonte-monde-campement.md) §A/B/D).

### 4.1 Anti « monde vide / répétitif » 🔴 P0
- **Règle du triangle (BotW)** : bâtir le terrain en **triangles/collines** qui **occultent** ce qu'il y a derrière et **révèlent 2–3 nouveaux POI** à chaque crête → boucle de curiosité auto-entretenue. *(C'est le complément « relief » de la refonte §B des bordures et §A des biomes.)*
- **Silhouette + signature unique par POI** lisible de loin (colonne de **fumée** = camp/foyer ; **cristal lumineux** = grotte ; **tour brisée** = ruine ; **mât penché** = épave). Cheap et puissant en low-poly.
- **Densité & courbe d'intérêt** : POI suivant toujours **visible à courte distance** ; les anneaux de distance = une **courbe d'intérêt** (calme→tension→répit). L'eau/nourriture **définit la portée** → la densité doit garantir un POI utile dans le rayon atteignable.
- **Le voyage retour est du contenu** : points de ravito/raccourcis + **la fumée du camp toujours visible** comme balise « maison » (dead reckoning sans minimap).

### 4.2 Navigation & guidage diégétique 🔴 P0
- **Compas diégétique** plutôt que minimap (A Dark Room **gate déjà** la carte derrière la boussole) : aiguille/vent/poussière qui pointe vers le POI non découvert le plus proche ou vers le camp (esprit « vent guide » de *Ghost of Tsushima*).
- **Couleur d'accent réservée** aux interactifs/indices de chemin (le « jaune » de Naughty Dog) — entraîne l'œil. Cohérence stricte sinon ça perd en crédibilité.

### 4.3 Procédural qui semble « fait main » 🟡 P1
- **Hybride** : base procédurale + **set-pieces hand-authored** (ruines à histoire, arène de boss, site final). **Garantir par anneau** : ≥1 source d'eau, ≥1 landmark authored, ≥1 rencontre, la **ressource signature** du biome. *« Garantir, pas espérer »* — c'est la défense n°1 contre le « samey » (renforce la refonte §A).
- **Templates contraints, paramètres variés** (rotation/sous-ensemble de props/niveau de ruine) : varier **dans des bornes authored** lit « designé ».
- **Storytelling environnemental** (« show, don't tell ») : **ruines = vignettes** (mur effondré + jouet + âtre éteint = « une famille a fui ») — curaté, minimaliste (3 props signifiants > 30 aléatoires). *(Aligne la refonte §D « ruines ».)*
- **Biomes visuellement distincts** : palette + fog + silhouette + **ressource signature** par anneau (forêt→marais→cendres/fer→volcanique). *(Aligne la refonte §A.)*

### 4.4 Progression incrémentale & survie 🟡 P1
- **Protéger la révélation progressive** (le mystère est le moteur de rétention, pas les chiffres) ; **mapper les déblocages sur les anneaux** (progression spatiale = progression économique) ; **early rapide** qui ralentit en mid/late ; **automatisation méritée** (les métiers d'A Dark Room).
- **Idle au camp** (les ouvriers produisent pendant l'exploration) **+ actif en expédition** = le rythme naturel ; **célébrer les jalons** (hutte, région nettoyée, épave trouvée) sobrement.
- **Survie en dents de scie** (zone sûre = camp, vrai répit) ; **télégraphier le danger** (fog plus sombre, palette dure, silhouettes/audio à l'entrée d'un anneau plus dur) ; **mort qui motive** (perdre le **butin d'expédition** misé, **garder** le camp/l'économie) — jamais effacer des heures de village.
- **Éthique** : pas de dark patterns (FOMO, notifications-appât, pay-to-skip) ; respecter le temps du joueur — le **mystère et la découverte** ramènent le joueur.

---

## 5. Graphisme low-poly · lumière · atmosphère

> On a déjà : flat-shading + vertex colors, dusk hémisphérique+directionnelle **statique**, fog exp2 **off**,
> post-process (bloom/grading/vignette/grain/FXAA), feu (point light + étincelles), feuilles, fumée.

- **L'art direction prime sur la fidélité** : palette **verrouillée** (12–16 teintes ; palette cosinus d'IQ pour les variations procédurales on-palette), **design en niveaux de gris d'abord** (la valeur porte la lisibilité), **split chaud/froid** (dusk froid vs feu chaud = moteur émotionnel). **Silhouette = l'asset** (tester en noir sur blanc), 2–3 matériaux/modèle. 🟡 P1
- **AO / ombres de contact = levier cheap→premium n°1** : sans, les objets « flottent ». **Bake l'AO dans les vertex colors** (gratuit au runtime sur mesh procéduraux) et/ou **blob shadows** sous joueur/villageois/bâtiments/feu. (SSAO2 possible mais coûteux → garder pour un toggle qualité/WebGPU.) 🔴 P0
- **Cycle jour/nuit** (la lumière EST l'ambiance ; aujourd'hui dusk **statique**) : un seul paramètre `time∈[0,1)` qui **lerp** direction+couleur du **soleil**, couleur **ambiante/hémisphérique**, **dégradé de ciel** (skybox gradient), **couleur du fog**. Aube bleue froide → midi → long dusk chaud → **nuit où le feu domine** (garder un plancher d'ambiant : froid, pas aveugle). 🔴 P0 *(narratif pour A Dark Room)*
- **Fog ré-activé** (`EXP2`, densité basse, **`fogColor` = couleur d'horizon** lerpée jour/nuit) : profondeur atmosphérique gratuite + masque la distance de tirage. 🔴 P1
- **Tone mapping ACES** sous le bloom (sinon bloom/grading se comportent mal) ; bloom **seuil haut** (le feu seulement) ; vignette/ grain subtils ; grading via `colorCurves` (ombres bleues froides / hautes-lumières chaudes). 🟡 P1
- **Eau stylisée** (le disque plat est le plus gros « cheap tell ») : **couleur par profondeur** (shallow→deep) + **écume de bord** (depth diff) + vaguelettes vertex — via **Node Material** Babylon. 🟡 P2
- **Particules** : feu en **couches** (cœur/halo/fumée/étincelles, couleur-sur-vie jaune→orange→gris, ~1,2 s) ; **GPU particles** pour les grandes quantités ; rendu **off-screen fractionnaire** pour la fumée lourde (anti-overdraw). 🟡 P2

---

## 6. Audio (immersion & feel)

> On a déjà : musique adaptative (niveau de feu/lieu), feu spatialisé, **ducking**, variantes de pas, sliders séparés.

- **Reverb par zone** (manque, gros gain immersion) : `ConvolverNode` WebAudio (IR par espace) — **queue de grotte**, **cabane mate/sèche** → « tu es quelque part » instantané ; blend wet/dry au franchissement d'un volume. 🔴 P1
- **Variation sur CHAQUE son répété** (pas que les pas) : **round-robin + jitter pitch (±2–4 demi-tons) & volume (±2–3 dB)** → tue la fatigue auditive. 🟡 P1
- **Un son sur chaque action** (gather/build/craft/UI/clic) — le silence sur une action lit « bug ». 🟡 P1
- **Musique adaptative** — affiner : **layering vertical** (une couche de pad froid la nuit, une couche qui monte avec le feu) + **re-séquençage horizontal** aux frontières musicales (safe→danger) ; **crossfade** sur la mesure, pas de cut. ✅/🟡
- **Atténuation 3D** : modèle **logarithmique**, `refDistance`/`maxDistance`/`rolloffFactor` cohérents ; **occlusion** (low-pass quand la géométrie bloque le feu vu de l'intérieur). 🟡
- **Ambiance & silence** (central pour A Dark Room) : lit d'ambiance évolutif (vent/craquements/feu), **boucles découpées en segments randomisés** (pas de point de boucle détectable) ; **le silence est un instrument** (réservé aux pics/révélations) mais **garder un plancher d'ambiance** (le silence total = stérile). Laisser les sons **se résorber** (pas de hard-cut). 🟡
- **Accessibilité** : volumes séparés ✅ ; option « réduire les sons forts » / compression ; **équivalents visuels** des sons critiques. 🟡

---

## Mise en correspondance avec la roadmap

Ces leviers deviennent un **Chantier D — Qualité d'expérience** (transverse) dans [`roadmap-v2.md`](roadmap-v2.md).
Beaucoup **renforcent la refonte** ([`refonte-monde-campement.md`](refonte-monde-campement.md)) : règle du triangle + biomes distincts (§4.1↔refonte §A/B), ruines-vignettes (§4.3↔refonte §D), atmosphère/jour-nuit/fog (§5↔refonte §E décor). À traiter **en parallèle** des chantiers de contenu, P0 d'abord.

---

## Sources (sélection)

**Perf/web** : Babylon.js (Optimize, LOD, Thin Instances, SceneOptimizer, Occlusion), [Joe Pavitt — Optimizing a Large Babylon Scene], [Inigo Quilez — Fog], web.dev (static mem pools), [Martin Fuller — DRS], Unreal World Partition, [Hoppe — Geometry Clipmaps], Khronos KTX2/Draco, MDN (rAF, Page Visibility).
**Feel/UX/access** : Steve Swink *Game Feel*, Jonasson & Purho *Juice It or Lose It* (GDC), Nijman/Vlambeer *Art of Screenshake*, GMTK (*Celeste*, *Game Feel*), Interaction Design Foundation (affordances, progressive disclosure), Unreal/Godot (spring-arm camera), PC Gamer (FOV/nausée), **Game Accessibility Guidelines** (Basic), AbleGamers *Includification*.
**Design open-world/incrémental** : GMTK + Radiator Blog (*BotW* triangles/gravité), Level Design Book (wayfinding), Game Developer (*Ghost of Tsushima* guiding wind, environmental storytelling, superb survival games), Jesse Schell (interest curve), Rolling Stone (No Man's Sky procedural), Spelunky generation, A Dark Room (Wikipedia/Fandom/PopMatters), ACM (dark patterns).
**Graphisme/audio** : GDC *Art of Monument Valley*, [IQ — palettes], [Narkowicz — ACES], Babylon (DefaultRenderingPipeline, ImageProcessing, SSAO2, stylized water/skybox forums), NVIDIA GPU Gems (off-screen particles), The Game Audio Co. (adaptive music), A Sound Effect / Pro Sound Effects (variation/layering), Wayline (silence in games).
