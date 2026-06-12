# État d'avancement — handoff (reprise du travail)

> Document à lire **en premier** si tu reprends le projet. Il dit **où on en est**, **ce qui marche**,
> **les choix faits** et **quoi faire ensuite**. Détail technique : [`architecture.md`](architecture.md).
> Jeu d'origine + principes de portage : [`roadmap.md`](roadmap.md) (Parties 1–2).
> **Roadmap des jalons à jour (post-audit) : [`roadmap-v2.md`](roadmap-v2.md)** — source de vérité de
> l'avancement ; classe l'existant en ✅ fait / 🟡 rendu-mais-inerte / 🔴 mort / ❌ absent.
>
> *Dernière passe de maintenance : juin 2026 (après Chantier C, M9, routes & sites ; puis **construction
> visuelle/temporisée + montée de la cabane**, **sentiers dynamiques + dégagement des emprises**, **étiquettes
> de joueur en P2P** ; puis **M6/M7 : rempart + porte + survie eau/vivres/PV par joueur** ; puis
> **M8 : combat temps réel fidèle ADR + R3a fouille des forages (alliage)** ; puis **M10 : atelier
> complet, poste de traite, perks & outfitting**).*

## En une phrase
**A Dark Room réimaginé en 3D web native** (Babylon.js + Havok + Trystero), simulation **pure, déterministe,
host-autoritaire**. L'**Acte I jouable de bout en bout** (feu → construction → population → métiers/chaînes),
le **village vivant et harmonieux**, un **monde carré exploré** (biomes en régions, vraies bordures, sites
variés, grottes/mines explorables, routes qui se tissent), la **survie dehors** (M6/M7), le **combat
temps réel fidèle ADR** (M8) et l'**économie d'objets complète** (M10 : atelier, armures/armes, poste
de traite, perks, outfitting). Manque surtout : **la fin de partie (M11)** — l'alliage a déjà sa source.

## Vérification (tout vert)
```bash
npm install     # postinstall copie le WASM Havok
npm run dev     # http://localhost:5173
npm run test    # 227 tests de sim/logique (rapide, sans navigateur)
npm run e2e     # 15 tests Playwright (boucle, P2P, save, perf, sites, survie, combat…) + capture
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
- **FOUILLE DE SURFACE (R3a)** : les **forages** se fouillent (E) et donnent l'**ALLIAGE extraterrestre**
  (+ cellules) — la matière de la fin de partie a enfin une **source** ; les **champs de bataille** rendent
  munitions/acier/cellules. Butin 3D premier-servi (`render/siteLoot.ts`, nœuds dérivés de la graine).

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
- **Avant-postes ACTIFS** (`USE_OUTPOST`) : une grotte nettoyée se ravitaille **UNE fois** (usage unique
  fidèle ADR, partagé entre joueurs — premier-servi) ; remplit **eau + vivres** (PV = manger, M8) ; no-op si
  tout est plein ; verbe « se ravitailler » qui disparaît une fois l'avant-poste épuisé (`SiteProgress.used`).

### Combat temps réel (M8 — récent) — ✅ FIDÈLE ADR
- **Rencontre NON-SPATIALE par joueur** (duel abstrait 1v1, fidèle à l'écran de combat d'ADR) :
  `combat[pid]` + déclenchement par TEMPS d'exposition dehors (FIGHT_CHANCE 0.20 d'ADR, tirages RNG
  hôte), **tiers de danger par anneaux de distance** (1..3 + cavernes), **routes = rencontres
  raréfiées** (×0.4 — livre R4 « route sécurisée »).
- **Tables d'ennemis du code source ADR, NON adoucies** : T1 bête grondante/homme décharné/oiseau
  étrange · T2 homme grelottant (→ **médecine**)/mangeur d'hommes/charognard/grand lézard · T3
  terreur sauvage/soldat/sniper · cavernes : lézard/bête. **Tier 2/3 mortels sans armure (M10) —
  design ADR : FUIR est la réponse.**
- **Armes à COOLDOWN propre** : poings (1 dég/2 s) toujours ; **lance d'os** (2/2 s, recette ADR
  100 bois + 5 dents, **atelier requis**). `ATTACK` (hit 0.8), `EAT_MEAT` (**F** : +8 PV, viande
  séchée du sac, cooldown 5 s), `FLEE` sans pénalité ; mort = chemin unifié M7 (sac perdu, respawn).
- **Rendu** : créatures low-poly (quadrupède/lézard/oiseau/humanoïde sombre) qui **rôdent, font
  face, fentent** à chaque frappe (`render/encounter.ts`) ; panneau HUD (nom + PV + arme/recharge) ;
  musique `encounter-tier-N` en overlay ; victoire = effondrement + butin (winSeq), observée par diff.
- **Fabrication DIÉGÉTIQUE enfin branchée** (trou M9 comblé) : « fabriquer un objet… » chez la
  constructrice (torche — room-craft ADR) + verbe **E « fabriquer »** sur l'atelier construit (tous
  les objets, dont la lance d'os).

### Atelier, commerce & perks (M10 — récent) — ✅ FIDÈLE ADR (valeurs du code source)
- **Objets d'atelier** (recettes Room.Craftables EXACTES) : eau (outre +10 / baril +20 / citerne +50),
  portage (sac de cuir +10 / chariot +30 / convoi +60), **armures** (cuir 15 / fer 25 / acier 45 PV),
  armes (épées de fer 4 / d'acier 6, **fusil 5 dég/1 s à 1 balle/tir**). **Sémantique `World.die()`
  fidèle** : les *upgrades* sont des possessions du VILLAGE (entrepôt — jamais perdues à la mort,
  persistées, max 1, best-of) ; les *armes* vivent au SAC (perdues à la mort, comme l'outfit d'ADR).
- **Poste de traite ACTIF** (Room.TradeGoods exact) : fourrure/écailles/dents = monnaies — écailles,
  dents, fer, charbon, acier, médecine, balles, cellules, **grenade** (arme 15 dég/5 s), **baïonnette**
  (8 dég/2 s), **alliage** (1500 fourrure + 750 écailles + 300 dents). Verbe « commercer ».
- **OUTFITTING** (le coffre d'ADR) : E sur le coffre → « tout déposer » + **s'équiper** (`WITHDRAW`,
  entrepôt → sac : viande séchée, médecine, balles, grenades, torches, appâts).
- **Perks du village** (événement « le Maître », coût ADR 100 viande + 100 fourrure + 1 torche du sac) :
  précis +0,1 hit · barbare ×1,5 mêlée · insaisissable ×0,8 hit ennemi. **« L'homme malade »** :
  1 médecine → tirage pondéré ADR (10 % alliage / 30 % cellules ×3 / 50 % écailles ×5).
- **Soin** : F = manger (+8) puis médecine (`USE_MEDS`, **+20 PV/7 s** — MEDS_HEAL ADR), caps d'armure.

### Transverse — ✅
- **Multijoueur P2P** host-autoritaire (Trystero/WebRTC) : « Ouvrir ma partie » (lien à partager) ; **failover
  par époque** (un hôte silencieux ne fige plus les autres ; heartbeat + Raft-lite) + **STUN** publics ;
  anti-triche `isNetworkSafeAction` ; snapshot = `structuredClone` intégral.
- **Sauvegarde auto** (localStorage) avec **migration** (un ajout de champ ne jette plus la partie).
- **Audio** A1–A6 (musique du feu/village/exploration, feu spatialisé, événements, SFX d'action + porte).
- Caméra pointer-lock (3ᵉ↔1ʳᵉ auto en cabane), menu Paramètres, console dev + ~25 commandes, éditeur de spawn F2.

### Jalons (détail : [`roadmap-v2.md`](roadmap-v2.md))
- **M0–M5** ✅ (fondation, feu/étranger, construction, population/métiers, chaînes, événements).
- **M6 (seuil) ✅ · M7 (survie) ✅** — rempart/porte/puits + survie par joueur (drain dehors, mort = perte
  du sac, recharge camp) + **ravitaillement aux avant-postes** (`USE_OUTPOST`, usage unique fidèle ADR).
  Reste : fog of war (différé), équilibrage (M12).
- **M8 (combat) ✅ cœur** — temps réel fidèle ADR. Reste : rendu de l'ennemi d'un pair distant.
- **M10 (atelier/commerce/perks) ✅** — les 2 derniers bâtiments inertes (atelier, poste de traite)
  sont VIVANTS ; tiers 2/3 jouables avec armures ; outfitting au coffre. Reste : bolas (stun),
  boussole (décision ouverte), laser/plasma (butin de cité, M11).
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
1. **M8.5 — FIDÉLITÉ combat & lieux** ([`analyse-combat-adr.md`](analyse-combat-adr.md)) :
   **F1-F2-F3.1-F3.3-F3.4-F4 ✅** — rencontres **PAR PAS** (immobile = rien, routes = zéro),
   tables **exactes/biomes**, **mines gardées**, **maisons** 25/25/50 (médecine / vivres + eau /
   squatteur), **marais → gastronome**, champ de bataille = **armes lourdes ADR**, forage =
   **alliage garanti**, **viande soigne en voyage**, **mort = 120 s de repos**, **avant-postes par
   expédition**, **désengagement physique** (poursuite bornée), avertissements de danger.
   **Reste** : F3.2 (grottes scriptées), F3.5 (villes/cités = R3b), écran de butin, F5 (perks d'usage).
2. **M11 (fin de partie)** : épave → réparer le vaisseau (alliage : source R3a + troc M10) →
   décollage → fin → prestige. Le DERNIER acte manquant.
3. **R3b (donjons ville/cité)** : intérieurs explorables + `cityCleared` (→ Raid militaire) + butin
   lourd (laser, alliage) — alimente M11 **et M8.5-F3.5** (graphes de scènes ADR documentés).
4. Polish au fil de l'eau (Chantier D) : rebind clavier, cycle jour/nuit, AO/ombres de contact ;
   A6 (refactor main.ts — de plus en plus gros).

## Limitations connues / quirks (à savoir avant de coder)
- **Fin de partie = absente** (M11 : seul acte manquant). Combat : l'ennemi d'un joueur DISTANT n'est
  pas rendu (sim non-spatiale, v1) ; tier/onRoad déclarés par le client (même confiance que SET_OUTSIDE).
- **Équipement & perks = au VILLAGE** (entrepôt partagé/perks communs — divergence coop assumée,
  fidèle aux *stores* d'ADR qui est solo) ; bolas/boussole différés.
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
