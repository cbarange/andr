# État d'avancement — handoff (reprise du travail)

> Document à lire **en premier** si tu reprends le projet. Il dit **où on en est**, **ce qui marche**,
> **les choix faits** et **quoi faire ensuite**. Détail technique : [`architecture.md`](architecture.md).
> Jeu d'origine + principes de portage : [`roadmap.md`](roadmap.md) (Parties 1–2).
> **Roadmap des jalons à jour (post-audit) : [`roadmap-v2.md`](roadmap-v2.md)** — source de vérité de
> l'avancement ; classe l'existant en ✅ fait / 🟡 rendu-mais-inerte / 🔴 mort / ❌ absent.
>
> *Dernière passe de maintenance : juin 2026 (après Chantier C, M9, routes & sites ; puis **construction
> visuelle/temporisée + montée de la cabane**, **sentiers dynamiques + dégagement des emprises**, **étiquettes
> de joueur en P2P** ; puis **M6/M7 : rempart + porte + survie eau/vivres/PV par joueur**).*

## En une phrase
**A Dark Room réimaginé en 3D web native** (Babylon.js + Havok + Trystero), simulation **pure, déterministe,
host-autoritaire**. L'**Acte I jouable de bout en bout** (feu → construction → population → métiers/chaînes),
le **village vivant et harmonieux**, un **monde carré exploré** (biomes en régions, vraies bordures, sites
variés, grottes/mines explorables, routes qui se tissent), et la **survie dehors** (M6/M7 : zone sûre,
eau/vivres/PV, mort = perte du sac). Manquent surtout : **combat, commerce, fin de partie**.

## Vérification (tout vert)
```bash
npm install     # postinstall copie le WASM Havok
npm run dev     # http://localhost:5173
npm run test    # 182 tests de sim/logique (rapide, sans navigateur)
npm run e2e     # 12 tests Playwright (boucle, P2P, save, perf, sites, survie…) + capture
npm run typecheck
```

## Ce qui est FAIT & jouable / visible aujourd'hui

### Boucle de village (Acte I) — ✅
Couper du bois (E, arbres finis qui repoussent → **sac** plafonné) · allumer/nourrir le **feu** (l'**étrangère**
arrive) · **réparer la cabane** (devient entrepôt/mairie : coffre, étagères révélées, **grand tableau** des
métiers) · **construire** via la constructrice (liste à révélation ADR, coûts croissants) · **population &
métiers** (bûcheron par défaut, chaînes bois/cuir/viande séchée, income tout-ou-rien fidèle ADR) · **pièges**
(relève un-par-un, appât = prise bonus) · **événements** (9, scène-machine, cadence ADR 3–6 min).

### Monde & exploration — ✅ (rendu + une partie du gameplay)
- **Monde CARRÉ** (clip par axe — coins pleins, plus de trou/escalier), terrain streamé par chunks + LOD.
- **Biomes en grandes RÉGIONS organiques** (bruit de valeur + domain warping ; fini le moucheté) + **marais =
  vraie région** (~180 u, ancre par graine, site marais recalé dedans).
- **Vraies bordures** : 2 **fausses montagnes** + 2 **faux océans** (tirés par la graine, opposés/adjacents),
  **au-delà** de la zone jouable ; **confinement** (clamp de vitesse) + filet anti-chute → on ne s'échappe plus.
- **Sites variés (~57)** : grottes, maisons, **villes**, **cités**, 3 mines, **forages**, **champs de bataille**,
  marais, **cache (village détruit)**, épave, cuirassé. Tous modélisés low-poly + LOD silhouette→détail.
- **Grottes & mines EXPLORABLES** (M9) : intérieur 3D (massif au sol, colliders localisés, obscurité),
  **torche** craftable + porte gardée, **butin 3D premier-servi** (sac), **grotte nettoyée ⇒ avant-poste**,
  **mine sécurisée ⇒ métier mineur** ⇒ **ressuscite la chaîne acier→balles** (n'est plus 🔴 morte).
- **RÉSEAU DE ROUTES** : nettoyer/sécuriser un site **trace une route** (terre damée) qui **fusionne** au
  réseau le plus proche (algo `drawRoad` fidèle ADR). Déterministe, P2P, persistée.

### Vie & confort du village (Chantier C — refonte, TERMINÉ) — ✅
- **Placement MATHÉMATIQUE** des bâtiments (phyllotaxie de Vogel + nombre d'or + quartiers + relaxation) —
  remplace le placement manuel (l'éditeur de spawn F2 devient accessoire).
- **Lanternes** qui s'allument avec le **palier de cabane** (≥5, plus à ≥10).
- **Ruines** : gravats sur ~1/3 des emplacements de bâtiments à venir (remplacés à la construction) + ruines
  permanentes en périphérie.
- **Villageois dans les huttes** : ~50 % « à l'intérieur » (non rendus → allègement), **rotation** entrée/sortie
  + **son de porte** (synthétisé en WebAudio, aucun asset, atténué par la distance).
- **Juice** : nombres de ressources **animés (count-up) + pop couleur** au gain (HUD).
- **Confort/accessibilité** : sliders **FOV** + **sensibilité souris** (persistés).

### Construction VISUELLE & sentiers vivants (récent) — ✅
- **Construction étalée dans le temps** : `build` n'est plus instantané — il **enfile un chantier** (sim
  `constructing`, file séquentielle déterministe → P2P-safe) ; le coût est débité tout de suite, mais le
  bâtiment ne **compte dans la sim** (capacité/métiers/plafonds) **qu'une fois ACHEVÉ** (« fonctionnel à la fin »).
- **Montée « assemblage par éléments »** (`render/reveal.ts`, partagée) : le bâtiment **sort de terre** pièce
  par pièce (fondation → murs → toit, petit « pop ») ; la **constructrice marche jusqu'au chantier et y frappe
  au marteau** ; la montée **ne démarre qu'à son arrivée** et se cale pour finir **pile à l'achèvement** (filet
  anti-pop : jamais d'apparition instantanée). Même montée pour la **réparation/amélioration de la cabane**.
- **Sentiers DYNAMIQUES** (`campPathsFor`, arbre couvrant minimal feu + cabane + bâtiments) : le réseau de
  chemins se **génère depuis le layout** et **s'étoffe à chaque construction** (≈ 1 sentier de plus par bâtiment,
  reliant chaque structure au feu et aux voisines) ; peint par `campPaths` + **suivi par les villageois** (biais
  navGrid reconstruit tout seul). Remplace les anciens chemins dessinés à la main.
- **Dégagement des emprises à la construction** : les **arbres** du camp et le **décor au sol** (cailloux…) sur
  l'emplacement d'un bâtiment sont **retirés** dès le début du chantier, et **aucun arbre n'y repousse** (slots exclus).
- **Multijoueur** : **étiquette de nom** (billboard) au-dessus de chaque joueur distant — **l'id pour l'instant**,
  remplaçable par le vrai nom via `RemotePlayers.setName(id, name)` quand le réseau le fournira.

### Le seuil & la survie (M6/M7 — récent) — ✅
- **Rempart & porte** (`render/rampart.ts`) : palissade de pieux **fusionnée en 1 mesh** autour de la zone
  sûre, **porte au sud** (+Z, seuls les montants ont un collider — monde unifié, pas de mur-prison), **puits**
  de ravitaillement. Cosmétique/local : la frontière logique reste le rayon `VILLAGE_RADIUS`.
- **Survie PAR JOUEUR** (sim) : `survival[pid]` = eau/vivres/PV + échéances en tics + `deathSeq`. **Drain par
  TEMPS passé DEHORS** (pont position→sim : le client émet `SET_OUTSIDE` au franchissement, edge-triggered,
  réseau-safe) ; eau ET vivres à sec ⇒ les PV baissent ; à 0 ⇒ **mort : retour au camp + perte du SAC**
  (entrepôt intact — knob `deathStoragePenalty`) + grâce ; **recharge automatique au camp**. 0 RNG ⇒
  déterministe ; champ **additif** (pas de bump de save ; strippé comme `carried` à la sauvegarde).
- **HUD** : jauges eau/vivres/vie (visibles partout) + chip « zone sûre / dehors » ; la mort est observée
  par diff de `deathSeq` ⇒ téléport au camp (calque `builderTendingUntil`).

### Transverse — ✅
- **Multijoueur P2P** host-autoritaire (Trystero/WebRTC) : « Ouvrir ma partie » (lien à partager) ; **failover
  par époque** (un hôte silencieux ne fige plus les autres ; heartbeat + Raft-lite) + **STUN** publics ;
  anti-triche `isNetworkSafeAction` ; snapshot = `structuredClone` intégral.
- **Sauvegarde auto** (localStorage) avec **migration** (un ajout de champ ne jette plus la partie).
- **Audio** A1–A6 (musique du feu/village/exploration, feu spatialisé, événements, SFX d'action + porte).
- Caméra pointer-lock (3ᵉ↔1ʳᵉ auto en cabane), menu Paramètres, console dev + ~25 commandes, éditeur de spawn F2.

### Jalons (détail : [`roadmap-v2.md`](roadmap-v2.md))
- **M0–M5** ✅ (fondation, feu/étranger, construction, population/métiers, chaînes, événements).
- **M6 (seuil) ✅ · M7 (survie) 🟢** — rempart/porte/puits + survie par joueur (drain dehors, mort = perte
  du sac, recharge camp). Reste : **recharge aux avant-postes** (`OUTPOST_REFILL`), fog of war (différé).
- **M9 — sites/donjons/mines** 🟢 cœur fait (grotte+mines explorables, avant-poste, chaîne ressuscitée) ;
  **+ routes (R2)** ✅ et **+ variété de sites (R1)** ✅. Reste : intérieurs maison/ville/cité, butin alliage (R3).
- **Chantier C — refonte monde & campement** ✅ TERMINÉ (A biomes · B bordures · C placement maths · D ruines ·
  E lanternes · F villageois-huttes).
- **Chantier A — assainissement** : A3 (P2P) ✅, A4 (migration save) ✅ ; A2 (cheats hors prod) ⏸️ gardé en dev,
  A5 (bâtiments merge+instance) ⏸️ différé (analyse de risque faite), A6 (refactor `main.ts`) ⏳.
- **Chantier D — qualité d'expérience** : juice 🟡 amorcé (HUD count-up + **construction/cabane animées** ✅),
  confort FOV/sensibilité ✅ ; reste rebind clavier, jour/nuit, AO…

## Décisions clés (et pourquoi)
- **Monde 3D UNIFIÉ** : pas d'écran « village » vs « carte » ; retranchement central, difficulté ↑ avec la distance.
- **Deux stocks** : **sac** (par joueur, plafonné) vs **entrepôt** (partagé) — re-rythme la récolte façon ADR.
- **Income fidèle ADR** : tout-ou-rien (chôme si pas d'intrant), jamais négatif, mort par les **événements** seulement.
- **Diégétique d'abord** : touche **E** + étiquette, dialogues ; pas de panneaux flottants.
- **Déterminisme + host-autoritaire** : tout l'aléatoire via RNG à graine ; sim autoritaire, physique/transforms locaux.
- **Placement maths du campement** : remplace le placement manuel (harmonie) — l'éditeur F2 reste pour du debug.
- **Bordures 2 montagnes + 2 océans par graine** ; **biomes en régions** (anti-répétition) ; **marais-région**.
- **Routes fidèles ADR** : `findClosestRoad` (spirale → plus proche route/avant-poste/village) → fusion.
- **Son de porte SYNTHÉTISÉ** (A Dark Room n'a pas d'asset de porte).
- **Mort en expédition (M7) : perte du SAC seul** (fidèle ADR) — knob `deathStoragePenalty` pour durcir ;
  **fog of war différé** (seam prêt : `visited` additif + `VISIT_CELL` calqué sur `DISCOVER_SITE`).
- **Combat** : ✅ **décision ACTÉE (juin 2026)** — **temps réel fidèle ADR** (cf. `roadmap-v2.md` M8).

## Prochaine étape recommandée
1. **R3 (butin des forages/cités → alliage)** : **débloque la matière première de la fin de partie (M11)**.
2. **Reste M7 — effet des avant-postes** (`OUTPOST_REFILL`) : recharge de survie HORS camp (zone sûre
   secondaire autour des grottes nettoyées) — petite extension de la phase TICK 7.
3. **M8 (combat temps réel, décision actée)** — active la route « sécurisée » et les ennemis de cavernes.
4. Polish au fil de l'eau (Chantier D) : rebind clavier, cycle jour/nuit, AO/ombres de contact.

## Limitations connues / quirks (à savoir avant de coder)
- **Combat/commerce/fin = absents** : la **survie existe** (M6/M7 : pression eau/vivres dehors, mort = perte
  du sac, recharge au camp) mais les **avant-postes ne rechargent pas encore** (`OUTPOST_REFILL` à venir) ;
  ni combat, ni poste de traite/atelier fonctionnels, ni fin.
- **Sac & survie réinitialisés au rechargement** (`carried`/`survival` indexés par `selfId` aléatoire) ;
  entrepôt/village/sites persistent.
- **Poste de traite & atelier = bâtissables mais sans effet** (commerce/objets = M10).
- **Props sur les routes** : la teinte de route ne retire pas les arbres/herbe déjà dispersés (re-scatter = polish R2).
- **Outils dev EN PROD** (A2 différé, gardé pour le dev) : `dev/commands.ts` + mutateurs `window.__game` shippent.
- **WebGPU non testé en headless** : Playwright = WebGL2 ; vérifier WebGPU à la main (badge en bas à droite).
- **P2P** : les 2-joueurs-partagent-l'état vérifié **à la main** ; l'e2e ne teste que l'init du salon + l'élection.

## Comment reprendre concrètement
- **Comprendre une règle** : `src/sim/reducer.ts` (le cerveau) + `data/world.ts` (chiffres & contenu).
- **Ajouter du contenu** : éditer `data/world.ts` → brancher sim (action/reducer + **test**) → rendu/UI → réseau → e2e.
- **Debug console** : `window.__game` (cf. [`architecture.md`](architecture.md) §11) — ex. `fastForward(120)`, `clearSave()`, `/seed`, `/tp`, `/unlock`.
- **Workflow** : `data/` → `sim/` (+ test) → `render`/`ui` → `net` → e2e. **Toujours** garder `src/sim/` pur & déterministe.
- **Plans détaillés** : [`roadmap-v2.md`](roadmap-v2.md) (jalons), [`routes-sites.md`](routes-sites.md) (routes/sites R1–R4),
  [`refonte-monde-campement.md`](refonte-monde-campement.md) (Chantier C), [`bonnes-pratiques-jeu.md`](bonnes-pratiques-jeu.md)
  (feel/UX/perf à venir), [`drift.md`](drift.md) (dette technique), [`mines-grottes-implementation.md`](mines-grottes-implementation.md) (M9).
