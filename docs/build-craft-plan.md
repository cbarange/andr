# Plan — Aligner le menu de construction sur A Dark Room + atelier-station

> Suite de l'analyse de [`drift.md`](drift.md) §A/B (écarts D1–D8 du menu de la constructrice vs ADR).
> Décisions **actées par le porteur du projet** ci-dessous. Ce document **planifie** l'implémentation ;
> il sera tenu à jour au fil des phases. Source de vérité ADR : `room.js` (`Room.craftUnlocked`, 1073).

## Décisions actées (récap)

| Réf | Écart | Décision | Phase |
|---|---|---|---|
| **D1** | seuil bois 100 % (vs 50 % ADR) | **Aligner ADR** : révéler à **bois ≥ 50 %** | 1 |
| **D2** ⭐ | autres ingrédients exigés en totalité (vs ≥1 « vu ») | **Aligner ADR** : ingrédient **vu (≥1)** suffit — *« très important »* | 1 |
| **D3** | pas de notification de nouveauté | **« ! » au-dessus de la constructrice** + **badge « nouveau »** (et message ADR en survol) sur le dialogue | 2 |
| **D4** | gate « cabane réparée » (vs `builder lvl 4`) | **Garder tel quel** | — |
| **D5** | `needsWorkshop` (objets cachés sans atelier) | **Atelier = station d'artisanat interactive** (E sur le bâtiment) — divergence assumée | 4 (futur) |
| **D6** | hutte à moitié prix | **Aligner ADR** : `100 + n×50` bois | 3 |
| **D7** | « agrandir l'entrepôt » (hors ADR) | **Garder** (ajout assumé du modèle sac/entrepôt) | — |
| **D8** | biens/outils/armes absents | **Via l'atelier** quand ils arriveront (M6/M8) | 4 (futur) |

---

## Phase 1 — Révélation fidèle à ADR (D1 + D2) ⭐ ✅ **FAIT**

> ✅ Implémenté : `craftableRevealed` (data/world.ts, pur, **6 tests unit** verts), `updateDiscovered`
> branché dessus + gate D4 (cabane réparée). **Bonus** : le dialogue de la constructrice se
> **rafraîchit** si un bâtiment se révèle pendant qu'il est ouvert (`reflectState` → `refreshDialogue`),
> au lieu d'exiger une réouverture. typecheck + sim (110) verts.


**But** : porter `Room.craftUnlocked` (partie bâtiments) → un bâtiment apparaît dès qu'on a **la moitié
du bois** et **≥ 1 de chaque autre ingrédient**, au lieu d'attendre le coût complet. Restaure le
« teasing d'objectifs » d'ADR (on voit *poste de traite* dès 200 bois + 1 fourrure).

> **Nature** : la révélation reste un **état UI local** (`discovered`, persisté en `localStorage`,
> **non** dans `GameState`, **non** synchronisé) qui LIT l'entrepôt autoritaire (`state.resources`).
> Aucun impact déterminisme/P2P (chaque pair calcule sa propre révélation depuis les ressources
> partagées). On conserve aussi notre **gate D4** : rien ne se révèle avant la **cabane réparée**
> (équivalent du `builder.level == 4` d'ADR).

**1. `data/world.ts`** — extraire le prédicat **pur** (testable, fidèle à `room.js:1073`) :
```ts
/** Un bâtiment est-il RÉVÉLÉ dans le menu ? (fidèle ADR : ½ du bois + chaque autre ingrédient vu). */
export function craftableRevealed(c: Craftable, stored: Record<string, number>, built: number): boolean {
  if (built > 0) return true;                                  // déjà bâti -> visible
  if ((stored.wood ?? 0) < (c.cost.wood ?? 0) * 0.5) return false; // bois >= 50 % du coût bois
  for (const r of Object.keys(c.cost)) {                       // chaque AUTRE ingrédient « vu » (>= 1)
    if (r !== "wood" && (stored[r] ?? 0) < 1) return false;
  }
  return true;
}
```

**2. `src/main.ts`** — `updateDiscovered()` utilise le prédicat + gate D4 :
```ts
function updateDiscovered(): void {
  if (!state.cabinRepaired) return;                 // gate D4 (≈ builder lvl 4 d'ADR)
  let grew = false;
  for (const c of craftables) {
    if (discovered.has(c.id)) continue;
    if (craftableRevealed(c, state.resources, state.buildings[c.id] ?? 0)) {
      discovered.add(c.id);
      pendingReveal.add(c.id);                       // Phase 2 (notif)
      grew = true;
    }
  }
  if (grew) saveDiscovered([...discovered]);
}
```
(Le reste de `buildChoices` est inchangé : `enabled` reste « entièrement payable », `tooltip` =
« il manque : … ». On révèle plus tôt, mais l'item reste **grisé** tant qu'il n'est pas payable —
exactement comme ADR.)

**Tests**
- **Unit (sim.test.ts)** sur `craftableRevealed` : *poste de traite* révélé à `{wood:200, fur:1}`,
  PAS à `{wood:199, fur:1}`, PAS à `{wood:400, fur:0}` ; *piège* à `{wood:5}` ; déjà-bâti → vrai.
- **e2e** : inchangé (les bâtiments testés sont révélés avec le bois déposé) — vérifier après Phase 3.

**Doc** : marquer D1/D2 « ✅ aligné » dans `drift.md` ; note dans `architecture.md` (§ menu de build).
**Effort : S.**

---

## Phase 2 — Notification de nouveauté (D3) ✅ **FAIT**

> ✅ Implémenté & vérifié : **« ! » billboard** au-dessus de la constructrice (`stranger.setNews`,
> bascule avec `pendingReveal`), **badge « nouveau »** sur les bâtiments fraîchement révélés
> (`DialogueChoice.isNew` + CSS `.dcNew`), **message ADR `availableMsg`** au survol. Acquittement :
> ouvrir le dialogue passe `pendingReveal → justRevealed` (le « ! » s'éteint) ; fermeture vide le badge.
> Vérifié : « ! » false→true à la révélation, true→false à l'ouverture ; 3 badges effacés à la
> réouverture ; survol = texte narratif. typecheck · sim 110 · e2e 10/10.


**But** : remplacer le toast texte par **(a)** un **« ! » flottant au-dessus de la constructrice**
quand un bâtiment devient disponible, et **(b)** un **badge « nouveau »** sur la ligne du dialogue,
avec en **survol** le message narratif d'ADR (« la constructrice dit qu'elle peut faire des pièges… »).

**1. État (`main.ts`)** : `const pendingReveal = new Set<string>()` (alimenté en Phase 1). Persister
avec `discovered` (le « ! » survit au reload tant que non vu). `let justRevealed = new Set<string>()`
(snapshot pour le badge pendant que le dialogue est ouvert).

**2. Indicateur « ! » (`src/render/stranger.ts`)** : `setNews(on: boolean)` qui affiche/masque un
petit panneau billboard « ! » (DynamicTexture, comme le tableau de la cabane) ancré au-dessus de la
tête. Dans `reflectState` : `stranger.setNews(state.cabinRepaired && pendingReveal.size > 0)`.

**3. Badge dialogue (`hud.ts` + `index.html`)** : ajouter `isNew?: boolean` à `DialogueChoice` ; rendu
d'une pastille « nouveau » (classe CSS) sur la ligne. `buildChoices` met `isNew: justRevealed.has(c.id)`
et, pour ces lignes, `tooltip = availableMsg` (voir 5).

**4. Acquittement** : à l'ouverture du dialogue de build, `justRevealed = new Set(pendingReveal);
pendingReveal.clear()` (→ le « ! » disparaît) ; à la fermeture (`closeInteractive`), `justRevealed.clear()`.

**5. Texte narratif (`data/world.ts`)** : ajouter `availableMsg: string` (FR) à chaque `Craftable`
(porté d'ADR : trap → « elle dit qu'elle peut fabriquer des pièges… », etc.). Sert de contenu du badge
en survol. *(Aucune règle, pur contenu.)*

**Tests** : e2e — déposer de quoi révéler un bâtiment non encore vu → vérifier `stranger` « news » (hook
debug `getPendingReveal()`), ouvrir le dialogue → la ligne porte le badge → après ouverture, `pendingReveal`
vidé. **Effort : S/M** (rendu + UI).

---

## Phase 3 — Coût de la hutte fidèle à ADR (D6) ✅ **FAIT**

> ✅ `hut` → `100 + n×50` (data/world.ts) ; e2e ajusté (dépose ≥ 120 bois). Tests verts.


**1. `data/world.ts`** : `hut` → `cost: { wood: 100 }, costPerLevel: { wood: 50 }` (au lieu de 50/25).
**2. `tests/e2e.spec.ts`** : l'étape « construire une hutte » dépose ~72 bois (coût 50) → **passer à
≥ 120 bois** (ajouter des cycles `forceGather`/`deposit`, ajuster l'assertion `stored > 50` → `> 100`).
**3. Sim tests** : aucun n'asserte le coût de la hutte (les tests de coût utilisent cart/trap) → RAS.
**Note d'équilibrage** : huttes 2× plus chères → population plus lente (fidèle ADR, assumé).
**Doc** : `roadmap.md` listait déjà `100 + n×50` (c'était la **donnée** qui driftait) → cohérent après fix.
**Effort : XS.**

---

## Phase 4 — Atelier = station d'artisanat interactive (D5 + D8) *(futur, planifié seulement)*

**But** : quand les **biens/outils/armes** arriveront (torche, outre, sacs, armures, épées, fusil —
M6 ravitaillement / M8 armes), ils **ne** passeront **pas** par le menu de la constructrice. Le joueur
ira **interagir avec le bâtiment atelier** (E → « fabriquer ») pour les confectionner. La constructrice
reste **bâtiments uniquement**.

**Direction d'implémentation (non engagée maintenant)** :
- `computeFocus()` ajoute un verbe **« fabriquer »** sur l'atelier une fois construit (comme le coffre /
  le tableau de la cabane).
- Un `craftView()` (réutilise le système de dialogue) liste les objets ; coût payé depuis l'entrepôt ;
  même logique de révélation (½ ressources + ingrédients vus) que les bâtiments.
- Les objets sont des **données** (`data/world.ts`, type `good|tool|weapon|upgrade`) interprétées par le
  reducer (action `CRAFT` produisant un objet/stat), cohérent avec le modèle « actions, pas d'états ».
- **Divergence assumée vs ADR** (menu unique gated par `needsWorkshop`) → station diégégique séparée.

**Dépendances** : nécessite d'abord le modèle d'objets/outfit (M6) et/ou armes (M8). À rattacher à la
fiche M6 de `roadmap.md`. **Effort : M (quand les objets existeront).**

---

## Inchangé (rappel)
- **D4** : déblocage du build via **cabane réparée** (notre gate, ≈ builder lvl 4).
- **D7** : « agrandir l'entrepôt » (×5/×10) reste dans le menu (ajout maison, hors ADR).

## Séquencement & effort
1. **Phase 3** (XS) — coût hutte (+ e2e). *Rapide, isolé.*
2. **Phase 1** (S) — révélation ADR (prédicat pur + tests). *Le cœur « fidélité ».*
3. **Phase 2** (S/M) — « ! » constructrice + badge « nouveau » + `availableMsg`.
4. **Phase 4** — **planifié seulement** ; s'implémentera avec les objets (M6/M8).

Gate à chaque phase : `npm run typecheck` + `npm run test` + `npm run e2e` (+ capture si pertinent).
