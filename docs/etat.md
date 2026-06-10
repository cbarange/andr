# État d'avancement — handoff (reprise du travail)

> Document à lire **en premier** si tu reprends le projet. Il dit **où on en est**, **ce qui marche**,
> **les choix faits** et **quoi faire ensuite**. Détail technique : [`architecture.md`](architecture.md).
> Jeu d'origine + roadmap complète : [`roadmap.md`](roadmap.md).

## En une phrase

POC devenu prototype : **A Dark Room réimaginé en 3D web native** (Babylon.js + Havok + Trystero),
avec une simulation **pure, déterministe et host-autoritaire**. La boucle de village d'ADR (feu →
construction → population → métiers/chaînes) est **jouable de bout en bout**, en restant fidèle à
l'esprit du jeu (rareté, révélation progressive, automatisation libératrice).

## Ce qui est FAIT et jouable aujourd'hui

La boucle complète tourne (`npm run dev`) :

1. **Couper du bois** : E sur un arbre (3 coups, l'arbre tombe, un autre repousse ailleurs). Le bois
   va dans le **sac** (plafonné).
2. **Allumer / nourrir le feu** : E près du feu (consomme le bois **du sac**). Le feu refroidit ;
   sa lumière/échelle suivent son niveau. Une **étrangère** (la constructrice) arrive et se réchauffe.
3. **Réparer la cabane** : une fois la constructrice prête, lui parler (E) → réparer la cabane en
   ruine. Elle devient l'**entrepôt / mairie**.
4. **Déposer** au **coffre** (E, dans la cabane) → remplit l'entrepôt. Les **étagères** révèlent les
   ressources au fur et à mesure (cachées avant découverte).
5. **Construire** : parler à la constructrice ouvre **directement la liste** (pièges, charrette,
   hutte, etc.) — payé depuis l'entrepôt, coûts croissants, fidèles à ADR. Un bâtiment qu'on ne peut
   pas s'offrir est **grisé**, avec **au survol** le détail de ce qui manque (« il manque : 53 bois »).
6. **Population & métiers** : les huttes attirent des villageois. Tout villageois est **bûcheron par
   défaut** (occupation du « reste », comme ADR : jamais oisif, il ramasse du bois). Le **grand
   tableau** (dans la cabane, E) sert à **reconvertir** des bûcherons vers un métier spécialisé
   (chasseur, piégeur, tanneur, charcutier…) ; les retirer les renvoie bûcherons. Les ouvriers
   remplissent l'entrepôt **automatiquement** (revenus par cycle, fidèles à ADR ; un métier sans
   intrant **chôme**, personne ne meurt de faim ici). Les **avatars se déplacent selon leur métier**
   (bûcheron ↔ arbres/cabane, piégeur ↔ pièges, chasseur ↔ lisière…) — purement **cosmétique et local**
   (non synchronisé, sans physique) pour faire vivre le village sans coût réseau ni perf.
7. **Pièges** : on les relève **un par un** (E sur un piège **plein** uniquement) → butin (RNG à
   graine) dans le sac ; l'**appât** consommé = une prise en plus. Feedback visuel : **fumée** sur les
   bâtiments qui produisent, **proie (boule)** sur chaque piège plein (disparaît quand on le relève,
   réapparaît au rechargement).

Transverse :
- **Multijoueur P2P** (host-autoritaire) : dans **Paramètres**, **« Ouvrir ma partie »** génère un
  **code/lien à partager** et **épingle l'ouvreur comme hôte autoritaire** (les invités adoptent SON
  état : entrepôt, sacs, feu, village…). Les autres collent le code (ou ouvrent le lien) pour rejoindre.
  Inventaire de chaque joueur synchronisé via l'hôte. (WebRTC via relais Nostr — connexion en qq s.)
- **Caméra** : la souris EST la caméra (pointeur capturé) ; libérée dans les interfaces ; `Échap` =
  menu Paramètres / fermer l'UI.
- **Sauvegarde automatique** (localStorage) : restaurée au rechargement.

### Jalons (cf. roadmap pour le détail)
- **M0 Fondation** ✅ · **M1 Feu & étranger** ✅ · **M2 Construction** ✅ · **M3 Population & métiers** ✅
- **Refonte récolte & cabane** (sac/entrepôt, arbres finis, cabane-mairie, dépôt) ✅ (Temps 1 + Temps 2 tableau)
- **M4 Chaînes : équilibrage & feedback** ✅ (income fidèle ADR, fumée/proie, appât)
- **M5 Événements** ✅ (9 événements scène-machine, ordonnanceur RNG cadence ADR 3–6 min, `RESOLVE_EVENT_CHOICE`, perte de pop réintroduite, snapshot P2P étendu ; 49 tests sim + e2e)
- **Refontes UX** ✅ : interactions diégétiques (E + étiquette), dialogues, caméra pointer-lock, menu Paramètres, sauvegarde auto.

## Décisions clés (et pourquoi)

- **Monde 3D UNIFIÉ** (décision actée) : pas d'écran « village » vs « carte » ; le campement est un
  **retranchement central**, on sortira explorer en franchissant la porte (M7). Difficulté croissante
  avec la distance.
- **Deux stocks** : **sac** (par joueur, plafonné, récolte manuelle, nourrit feu/réparation) vs
  **entrepôt** (partagé, ouvriers + dépôts, construction/chaînes). C'est ce qui re-rythme la récolte
  façon ADR ; l'automatisation soulage la corvée manuelle.
- **Arbres = ressource finie qui repousse** (3 coups → chute → repousse ailleurs) — plus immersif
  qu'un cooldown.
- **La cabane est le hub** : coffre (dépôt), grand tableau (métiers), étagères (stocks révélés).
  La constructrice ne gère QUE réparer puis construire.
- **Income fidèle à ADR** : tout-ou-rien par métier (chôme si pas d'intrant), jamais de stock négatif,
  **pas de mort par manque d'intrant** (la mort viendra des événements). **Chiffres d'origine conservés.**
- **Pas de chasse active dans le village** (erreur corrigée) : dans ADR, les créatures qu'on combat /
  qui lâchent du butin sont des **rencontres du monde** → ça vit en **M7/M8**, pas au village.
- **Diégétique d'abord** : touche **E** contextuelle + étiquette flottante ; actions complexes via
  **dialogues** ; pas de panneaux de gestion flottants.
- **Caméra** : pointeur capturé en jeu, libéré en UI, recapturé à la fermeture ; `Échap` = menu / fermer
  (et non « libérer la souris »).
- **Déterminisme + host-autoritaire** : tout l'aléatoire via RNG à graine ; la sim est l'autorité
  (hôte), la physique/les transforms sont locaux.
- **Combat** : ⏳ **décision repoussée** (tour par tour vs temps réel) — n'impacte pas M1–M7.

## M5 — Événements ✅ FAIT

9 événements (bruits dehors/dedans, mendiant, marchand mystérieux bois/fourrure, pièges saccagés,
incendie de hutte, **attaque de bêtes**, nomade) en **machines à états à scènes**, avec **choix →
conséquences**. Ce qui a été livré :
- **Sim** : ordonnanceur **sur tic** (cadence **fidèle ADR 3–6 min**, intervalles via RNG à graine),
  définitions déclaratives en `data/world.ts` (conditions = prédicats purs, effets = données appliquées
  par `applyEffect`), action `RESOLVE_EVENT_CHOICE` + `DEBUG_TRIGGER_EVENT` (e2e). **La perte de
  villageois revient ici** (incendie, attaque, cf. décision M4). Piloté par l'hôte → P2P-safe.
- **UI** : panneau de choix réutilisant le **dialogue** existant ; watcher dans `reflectState`
  (ouvre/rafraîchit/ferme selon `state.activeEvent`) ; toasts narratifs.
- **Réseau** : `StateSyncMsg` + snapshot/adopt étendus (`activeEvent`, `eventScheduledAt`, `pendingEffects`).
- **Vérifié** : **49 tests sim** (+14 : gating, bornes, branchement déterministe, coût, effet différé,
  ordonnanceur reproductible, replay) + **e2e dédié** (panneau → choix → fermeture). Détail : [`m5-plan.md`](m5-plan.md).
- **Reportés** (dépendances non construites) : Éclaireur, Maître, Homme malade (carte/perks/medicine),
  Raid militaire (`cityCleared`, M9), Maladie/Peste (medicine). Le moteur étant générique, ils se
  brancheront sans refonte.

## Prochaine étape recommandée : M6 — Le rempart, la porte & le ravitaillement

→ puis **M7** (terres sauvages + survie) → **M8** (combat & créatures, table d'ennemis/butin déjà
documentée dans la roadmap). Voir la fiche **M6** de [`roadmap.md`](roadmap.md).

> **Analyses & plans en attente d'implémentation** : [`drift.md`](drift.md) (drift complet, dette,
> perf — dont 2 bugs P2P : `cabinTier`/`builderTendingUntil` hors snapshot) ; [`build-craft-plan.md`](build-craft-plan.md)
> (alignement du menu de construction sur ADR : révélation progressive, coût hutte `100+50`, notification
> « ! », atelier = station d'artisanat) ; [`plan-audio.md`](plan-audio.md) (**audio** — moteur d'A Dark Room
> analysé, 86 `.flac` originaux dans `public/audio/`. **A1 socle + A2 musique du feu + A3 SFX d'action
> (gather/build/dépôt/relève + footsteps) = ✅ FAITS** (niveau musique compensé, fondus single-ramp) ;
> reste A4 feu spatial, A5 événements, A6 village. Audio = **présentation**, hors `sim/`).

## Limitations connues / quirks (à savoir avant de coder)

- **Sac réinitialisé au rechargement** : `carried` est indexé par `selfId` (aléatoire à chaque
  session) ; au reload on repart d'un sac vide (l'entrepôt/le village persistent). Acceptable.
- **Branche fer/charbon→acier→balles dormante** : les métiers sidérurgiste/armurier existent mais
  n'ont pas d'intrants tant que les **mines (M9)** n'existent pas.
- **Fumée des bâtiments** : visible seulement sur les bâtiments « à cheminée » qui produisent
  (tannerie/fumoir/…). La tannerie/le fumoir coûtent cher (chiffres ADR) → peu visibles en partie courte.
- **WebGPU non testé en headless** : Playwright tourne en **WebGL2** (SwiftShader). Vérifier WebGPU
  **à la main** dans un vrai navigateur (badge « rendu : WEBGPU » en bas à droite).
- **Pointer lock** : exige un **clic initial** (sécurité navigateur) ; `Échap` libère le lock côté
  navigateur (voulu). Léger cooldown navigateur possible sur une recapture immédiate après Échap.
- **P2P « 2 joueurs partagent l'état »** vérifié **manuellement** (relais Nostr + WebRTC, peu fiable
  en headless). L'e2e ne teste que l'**initialisation** du salon.
- **Mines/monde/combat/fin** : pas encore là (M7–M11).

## Comment reprendre concrètement

```bash
npm install        # (postinstall copie le WASM Havok)
npm run dev        # http://localhost:5173
npm run test       # 35 tests de sim (rapide, sans navigateur)
npm run e2e        # 3 tests Playwright (boucle + P2P + sauvegarde) + capture
npm run typecheck  # tsc --noEmit
```

- **Pour comprendre une règle** : lire `src/sim/reducer.ts` (tout est là) + `data/world.ts` (chiffres).
- **Pour ajouter du contenu** (bâtiment, métier, ressource) : éditer `data/world.ts`, puis brancher
  côté sim (action/reducer + test) et rendu.
- **Debug rapide en console** : `window.__game` (voir la liste dans
  [`architecture.md`](architecture.md) §11) — ex. `window.__game.fastForward(120)`,
  `window.__game.clearSave()`.
- **Workflow recommandé** : données → sim (+ test) → rendu/UI → (réseau) → e2e. Toujours garder
  `src/sim/` pur et déterministe.
