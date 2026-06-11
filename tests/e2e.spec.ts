// ============================================================================
//  VÉRIFICATION VISUELLE (§11) — lance le jeu headless, vérifie la boucle complète
//  (récolte au sac -> feu -> réparer la cabane -> dépôt à l'entrepôt -> construire ->
//  population/métiers) et committe une capture d'écran.
//
//  Headless : pas de GPU -> rendu logiciel (SwiftShader) + repli WebGL2 déterministe
//  (le chemin WebGPU est vérifié manuellement dans un vrai navigateur, cf. README).
// ============================================================================

import { test, expect, type Page } from "@playwright/test";

type GameHook = { ready: boolean; renderer?: string; error?: string; errors?: string[] };

const SETTLED_Y_MAX = 2.4;

const stored = (page: Page, res: string) => page.evaluate((r) => window.__game?.getStored?.()[r] ?? 0, res);
const carried = (page: Page, res: string) => page.evaluate((r) => window.__game?.getCarried?.()[r] ?? 0, res);

test("le POC démarre et déroule la boucle récolte → cabane → entrepôt → village", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto("/");
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  // Ce test ISOLE la boucle économie sur de longs fast-forwards : on gèle l'ordonnanceur
  // d'événements (M5) pour qu'aucun événement aléatoire ne vienne tuer des villageois /
  // détruire un piège en cours de route (les événements ont leur propre test dédié).
  await page.evaluate(() => window.__game?.pauseEventScheduler?.());

  const hook = (await page.evaluate(() => window.__game)) as GameHook;
  expect(hook.error, `erreur de boot: ${hook.error}`).toBeUndefined();
  expect(["webgpu", "webgl2"]).toContain(hook.renderer);

  const canvasSize = await page.evaluate(() => {
    const c = document.getElementById("renderCanvas") as HTMLCanvasElement | null;
    return c ? { w: c.width, h: c.height } : null;
  });
  expect(canvasSize?.w ?? 0).toBeGreaterThan(0);

  // 1) Le sac est vide au départ ; couper du bois le remplit (plafonné).
  await expect(page.locator("#bagCap")).toHaveText("0/24");
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) window.__game?.forceGather?.(); // 3 × 8 -> plafond 24
  });
  await expect.poll(() => carried(page, "wood")).toBe(24);

  // 2) Le feu : allumer (gratuit) puis nourrir avec le bois DU SAC.
  await expect(page.locator("#fireValue")).toHaveText("mort");
  await page.evaluate(() => window.__game?.lightFire?.());
  await expect(page.locator("#fireValue")).toHaveText("ardent");
  await page.evaluate(() => window.__game?.stoke?.());
  await expect(page.locator("#fireValue")).toHaveText("rugissant");
  await expect.poll(() => carried(page, "wood")).toBe(19); // 24 - 5 (du sac)

  // 3) Gravité + collision sol, puis déplacement clavier.
  await page.waitForTimeout(1200);
  const settledY = await page.evaluate(() => window.__game?.getPlayer?.().y ?? NaN);
  expect(settledY).toBeGreaterThan(0);
  expect(settledY).toBeLessThan(SETTLED_Y_MAX);
  const before = await page.evaluate(() => window.__game!.getPlayer!());
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "z" })));
  await page.waitForTimeout(700);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "z" })));
  const after = await page.evaluate(() => window.__game!.getPlayer!());
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.4);

  // 4) La constructrice se réchauffe, puis sa SEULE action : réparer la cabane.
  await page.evaluate(() => window.__game?.fastForward?.(70));
  await page.evaluate(() => {
    for (let i = 0; i < 2; i++) window.__game?.forceGather?.(); // sac >= 20 pour réparer
  });
  await page.evaluate(() => window.__game?.openBuilderDialogue?.());
  await expect(page.locator("#dialogue")).toBeVisible();
  await expect(page.locator("#dlgText")).toContainText("aplomb"); // « remettre d'aplomb »
  await page.locator(".dlgChoice", { hasText: "réparer" }).click();
  await expect.poll(() => page.evaluate(() => window.__game?.getCabinRepaired?.())).toBe(true);
  await page.locator(".dlgChoice", { hasText: "éloigner" }).click();

  // 5) Dépôt au coffre : le sac se vide dans l'ENTREPÔT.
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) window.__game?.forceGather?.();
    window.__game?.deposit?.();
  });
  await expect.poll(() => stored(page, "wood")).toBeGreaterThan(0);
  await expect.poll(() => carried(page, "wood")).toBe(0);

  // 6) Construire une hutte (depuis l'entrepôt) via le dialogue. Coût ADR = 100 bois -> on
  //    dépose de quoi payer hutte (100) + piège (10) avec marge.
  await page.evaluate(() => {
    for (let c = 0; c < 6; c++) {
      for (let i = 0; i < 3; i++) window.__game?.forceGather?.();
      window.__game?.deposit?.();
    }
  });
  await expect.poll(() => stored(page, "wood")).toBeGreaterThan(100);
  // Parler à la constructrice ouvre DIRECTEMENT la liste de construction (plus d'intro). Si « hutte »
  // se révèle juste après l'ouverture, le dialogue se rafraîchit (cf. reflectState) -> le clic attend.
  await page.evaluate(() => window.__game?.openBuilderDialogue?.());
  await page.locator(".dlgChoice", { hasText: "hutte" }).click();
  // Construire un piège (depuis le dialogue) -> exerce le rendu du piège + sa « prise ».
  await page.locator(".dlgChoice", { hasText: "piège" }).click();
  await page.locator(".dlgChoice", { hasText: "éloigner" }).click();
  // La construction est désormais ÉTALÉE DANS LE TEMPS (chantiers animés, séquentiels : la
  // constructrice bâtit un bâtiment à la fois). On avance la simulation jusqu'à l'achèvement
  // des deux chantiers avant de vérifier le compte des bâtiments.
  await page.evaluate(() => window.__game?.fastForward?.(30));
  await expect.poll(() => page.evaluate(() => window.__game?.getBuildings?.().hut ?? 0)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__game?.getBuildings?.().trap ?? 0)).toBe(1);

  // 6b) Relever le piège -> butin dans le sac (nouvelle logique de récolte).
  await page.evaluate(() => window.__game?.harvestTrap?.());
  await expect
    .poll(() => page.evaluate(() => Object.values(window.__game?.getCarried?.() ?? {}).reduce((a, b) => a + (b as number), 0)))
    .toBeGreaterThan(0);

  // 7) Population : les villageois sont BÛCHERONS par défaut (ADR) -> l'entrepôt se remplit
  //    tout seul, SANS aucune assignation.
  await page.evaluate(() => window.__game?.fastForward?.(140));
  await expect.poll(() => page.evaluate(() => window.__game?.getPopulation?.() ?? 0)).toBeGreaterThan(0);
  const woodIdle = await stored(page, "wood");
  await page.evaluate(() => window.__game?.fastForward?.(30));
  await expect.poll(() => stored(page, "wood")).toBeGreaterThan(woodIdle); // bûcherons par défaut -> bois++

  // Le GRAND TABLEAU (Temps 2) : effectif bûcheron par défaut + reconversion vers un métier
  //    spécialisé (piégeur : le piège est construit).
  await page.evaluate(() => window.__game?.openVillageBoard?.());
  // Le bûcheron est listé comme les autres (en lecture seule), le piégeur est assignable.
  await expect(page.locator("#dlgSteppers")).toContainText("bûcheron");
  await expect(page.locator("#dlgSteppers")).toContainText("piégeur");
  // Navigation au CLAVIER (le pointeur reste capturé) : piégeur sélectionné -> flèche droite = +1.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })));
  await expect.poll(() => page.evaluate(() => window.__game?.getWorkers?.().trapper ?? 0)).toBeGreaterThan(0);
  // Échap ferme le dialogue (au clavier).
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  await expect(page.locator("#dialogue")).toBeHidden();

  // 8) Interaction diégétique : près du feu, l'étiquette E propose « nourrir le feu ».
  await page.evaluate(() => {
    window.__game?.lightFire?.(); // ranime le feu (il a pu mourir pendant les fast-forwards)
    window.__game?.teleport?.(0, 0);
  });
  await expect.poll(() => page.evaluate(() => window.__game?.getFocusVerb?.())).toBe("nourrir le feu");
  await expect(page.locator("#interactPrompt")).toBeVisible();

  // 9) Preuve visuelle : vue du campement (feu, cabane, piège « plein »).
  await page.evaluate(() => window.__game?.showcaseCamera?.());
  await page.waitForTimeout(700);
  await page.screenshot({ path: "tests/screenshot.png", fullPage: false });

  const fatal = (hook.errors ?? []).concat(consoleErrors);
  expect(fatal, `erreurs détectées:\n${fatal.join("\n")}`).toEqual([]);
});

// M5 — un événement s'affiche dans le panneau de dialogue et se résout sur un choix.
// (Les effets chiffrés — morts, butin, coûts — sont couverts de façon déterministe par les
//  tests de simulation ; ici on vérifie le CÂBLAGE état -> panneau -> choix -> fermeture.)
test("un événement s'affiche et se résout via le panneau de choix", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });

  // Forcer un événement (hook de debug, réservé à l'autorité — ici hors-ligne).
  await page.evaluate(() => window.__game?.triggerEvent?.("beast_attack"));
  await expect.poll(() => page.evaluate(() => window.__game?.getActiveEvent?.()?.id)).toBe("beast_attack");

  // Le panneau d'événement (réutilise le dialogue) s'ouvre avec le texte de la scène.
  await expect(page.locator("#dialogue")).toBeVisible();
  await expect(page.locator("#dlgText")).toContainText("bêtes");

  // MODAL : Échap ne ferme PAS l'événement (sinon il resterait actif et bloquerait les suivants).
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__game?.getActiveEvent?.()?.id)).toBe("beast_attack");
  await expect(page.locator("#dialogue")).toBeVisible();
  await expect(page.locator("#settings")).toBeHidden();

  // Résoudre le choix « rentrer » (next:'end') ferme l'événement.
  await page.locator(".dlgChoice", { hasText: "rentrer" }).click();
  await expect.poll(() => page.evaluate(() => window.__game?.getActiveEvent?.())).toBeNull();
  await expect(page.locator("#dialogue")).toBeHidden();
});

// AUDIO (A1+A2) — on vérifie le CÂBLAGE état -> musique + les réglages, pas l'oreille (headless
// n'émet pas de son audible). La piste voulue (`getAudio().music`) est posée par reflectState
// indépendamment du déverrouillage du contexte, donc déterministe en headless.
test("la musique suit l'état du feu et le menu Son règle les volumes", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });

  // Au boot : feu mort -> piste « fire-dead », volumes par défaut, non coupé.
  const boot = await page.evaluate(() => window.__game?.getAudio?.());
  expect(boot?.music).toBe("fire-dead");
  expect(boot?.muted).toBe(false);

  // Allumer le feu fait basculer la musique de fond (mapping fire-level -> piste, fidèle ADR).
  await page.evaluate(() => window.__game?.lightFire?.());
  await expect.poll(() => page.evaluate(() => window.__game?.getAudio?.().music)).toBe("fire-burning");
  // Attiser (coûte du bois -> on en récolte d'abord) pousse le feu d'un cran -> autre piste.
  await page.evaluate(() => { for (let i = 0; i < 2; i++) window.__game?.forceGather?.(); window.__game?.stoke?.(); });
  await expect.poll(() => page.evaluate(() => window.__game?.getAudio?.().music)).toBe("fire-roaring");

  // A6 — la musique suit le LIEU : hors du camp -> exploration « world » ; au retour -> ambiance de feu.
  await page.evaluate(() => window.__game?.teleport?.(300, 300));
  await expect.poll(() => page.evaluate(() => window.__game?.getAudio?.().music)).toBe("world");
  await page.evaluate(() => window.__game?.teleport?.(0, 0));
  await expect.poll(() => page.evaluate(() => window.__game?.getAudio?.().music)).not.toBe("world");

  // A5 — un événement déclenche une musique d'événement (overlay par-dessus le fond).
  await page.evaluate(() => window.__game?.triggerEvent?.("beast_attack"));
  await expect.poll(() => page.evaluate(() => window.__game?.getAudio?.().eventMusic)).toBe("event-beast-attack");
  // Résoudre l'événement coupe la musique d'événement.
  await page.locator(".dlgChoice", { hasText: "rentrer" }).click();
  await expect.poll(() => page.evaluate(() => window.__game?.getAudio?.().eventMusic)).toBeNull();

  // Section « Son » du menu Paramètres : curseurs + mute présents et fonctionnels.
  await page.evaluate(() => window.__game?.openSettings?.());
  for (const id of ["volMaster", "volMusic", "volSfx", "muteBtn"]) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
  // Le curseur « Général » règle le master (événement input -> callback 0..1).
  await page.evaluate(() => {
    const el = document.getElementById("volMaster") as HTMLInputElement;
    el.value = "40"; el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__game?.getAudio?.().master)).toBeCloseTo(0.4, 2);
  // Le bouton mute bascule l'état.
  await page.locator("#muteBtn").click();
  expect(await page.evaluate(() => window.__game?.getAudio?.().muted)).toBe(true);

  // « Effets actifs » : une case par effet ; décocher un effet le désactive (persisté).
  await expect(page.locator("#sfxToggles input[type=checkbox]")).toHaveCount(8);
  await page.locator("#sfxToggles label", { hasText: "Pas / déplacement" }).locator("input").uncheck();
  expect(await page.evaluate(() => window.__game?.getAudio?.().disabledSfx)).toContain("footsteps");
});

// Overlay debug : visible par défaut, affiche le FPS, et se masque avec F3.
test("l'overlay debug affiche le FPS et se bascule avec F3", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });

  const overlay = page.locator("#debugOverlay");
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText("fps"); // se peuple après la 1ʳᵉ frame
  await expect(overlay).toContainText("latence");

  // F3 masque l'overlay…
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "F3" })));
  await expect(overlay).toBeHidden();
  // …et le ré-affiche.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "F3" })));
  await expect(overlay).toBeVisible();
});

// Smoke test du réseau : rejoindre un salon initialise Trystero/WebRTC en navigateur,
// élit l'hôte et bascule le HUD en ligne — SANS dépendre d'un 2e pair (non flaky).
test("rejoindre un salon initialise le P2P et bascule le HUD en ligne", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/");
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });

  // Le multijoueur vit désormais dans le menu Paramètres (Échap) -> on l'ouvre d'abord.
  await page.evaluate(() => window.__game?.openSettings?.());
  await expect(page.locator("#settings")).toBeVisible();
  await page.fill("#roomInput", "darkroom-poc-smoke");
  await page.click("#roomBtn");

  await expect(page.locator("#netStatus")).toHaveClass(/online/, { timeout: 10_000 });
  await expect(page.locator("#netStatusText")).toContainText("hôte");

  expect(pageErrors, `erreurs réseau:\n${pageErrors.join("\n")}`).toEqual([]);
});

// Sauvegarde automatique : l'état est restauré au rechargement (≠ partie neuve).
test("la sauvegarde auto restaure l'état au rechargement", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });

  // Allumer le feu (≠ état neuf où le feu est mort), puis sauvegarder explicitement.
  await page.evaluate(() => window.__game?.lightFire?.());
  await expect.poll(() => page.evaluate(() => window.__game?.getFire?.() ?? 0)).toBeGreaterThan(0);
  await page.evaluate(() => window.__game?.saveNow?.());

  // Recharger : la sauvegarde doit être restaurée -> le feu est encore allumé.
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__game?.getFire?.() ?? 0)).toBeGreaterThan(0);
});

// M7/P2 — PHYSIQUE LOCALISÉE : en explorant loin, seuls les chunks AUTOUR du joueur portent
// un collider Havok (le sol reste visible bien au-delà). On vérifie que le nombre de colliders
// reste borné (≪ chunks chargés) ET que le joueur ne traverse pas le sol au loin (y stable,
// pas de chute libre) — preuve que le collider SUIT le joueur.
test("la physique reste localisée autour du joueur en exploration lointaine (P2)", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/");
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__game?.pauseEventScheduler?.());

  // Au camp : peu de colliders (le bloc 3×3 autour du joueur), tous les chunks chargés.
  await page.waitForTimeout(800);
  const atCamp = await page.evaluate(() => window.__game?.getTerrainStats?.());
  expect(atCamp, "getTerrainStats indisponible").toBeTruthy();
  expect(atCamp!.colliders).toBeGreaterThan(0); // sol solide sous le joueur
  expect(atCamp!.colliders).toBeLessThanOrEqual(12); // bloc 3×3 (+ marge transitoire)

  // Téléporter LOIN (dans le monde borné). Le streaming est AMORTI (1 chunk/frame) -> on attend
  // (poll, pas un délai fixe) que l'anneau se remplisse, sinon le test est fragile en headless lent.
  await page.evaluate(() => window.__game?.teleport?.(300, 300));
  await expect
    .poll(async () => {
      const t = await page.evaluate(() => window.__game?.getTerrainStats?.());
      return t ? t.chunks - t.colliders : 0; // > 0 dès qu'il y a des chunks VISIBLES sans collider
    }, { timeout: 15_000 })
    .toBeGreaterThan(0);

  const far = await page.evaluate(() => window.__game?.getTerrainStats?.());
  // Localisation : beaucoup de chunks VISIBLES, mais peu de colliders (uniquement près du joueur).
  expect(far!.colliders).toBeLessThanOrEqual(12);
  expect(far!.chunks).toBeGreaterThan(far!.colliders);

  // Anti-chute : le joueur repose sur le sol au loin -> y STABLE (pas de chute libre).
  const y1 = await page.evaluate(() => window.__game?.getPlayer?.().y ?? NaN);
  await page.waitForTimeout(900);
  const y2 = await page.evaluate(() => window.__game?.getPlayer?.().y ?? NaN);
  expect(Number.isFinite(y1) && Number.isFinite(y2)).toBe(true);
  expect(y2).toBeGreaterThan(-5); // n'a pas traversé le sol
  expect(Math.abs(y2 - y1)).toBeLessThan(1.0); // au repos, pas en chute

  expect(pageErrors, `erreurs:\n${pageErrors.join("\n")}`).toEqual([]);
});

// M7/P3 — PALIERS LOD DES PROPS : le décor est COMPLET près du joueur (palier `near`) et
// ALLÉGÉ au loin (palier `far` : petit décor masqué + arbres éclaircis + non coupables). On
// vérifie au runtime que ce découpage existe (near < chunks), qu'il produit du décor, et qu'il
// se reconstruit sans casse quand on se déplace. (La logique de sélection est couverte par
// les tests unitaires de proplod.)
test("le décor s'allège au loin : paliers LOD des props (P3)", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/");
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__game?.pauseEventScheduler?.());

  // Attend (poll, pas un délai fixe) que l'anneau se remplisse au-delà du noyau « near » : il
  // existe alors des chunks LOINTAINS (décor allégé) -> le découpage de paliers P3 est actif.
  await expect
    .poll(async () => {
      const t = await page.evaluate(() => window.__game?.getTerrainStats?.());
      return t ? t.chunks - t.near : 0;
    }, { timeout: 15_000 })
    .toBeGreaterThan(0);
  const s = await page.evaluate(() => window.__game?.getTerrainStats?.());
  expect(s!.near).toBeGreaterThanOrEqual(1); // des chunks PROCHES (décor complet) autour du joueur
  expect(s!.chunks).toBeGreaterThan(s!.near); // ET des chunks LOINTAINS (décor allégé)
  expect(s!.props).toBeGreaterThan(0); // du décor est bien instancié

  // En explorant ailleurs, le système se reconstruit (rebuild de props) sans casser le jeu.
  await page.evaluate(() => window.__game?.teleport?.(150, 150));
  await expect
    .poll(async () => {
      const t = await page.evaluate(() => window.__game?.getTerrainStats?.());
      return t ? t.chunks - t.near : 0;
    }, { timeout: 15_000 })
    .toBeGreaterThan(0);

  expect(pageErrors, `erreurs:\n${pageErrors.join("\n")}`).toEqual([]);
});

// M7/P4 — CHUNKS LOINTAINS MINIMALISTES (« figés ») : le sol et le décor STATIQUE ne bougent
// jamais -> leur matrice monde est gelée (plus de recalcul par frame). On vérifie au runtime que
// le gel est bien appliqué (tous les sols + des props figés) et que le jeu tourne sans casse.
test("le sol et le décor statique sont figés (P4)", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/");
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__game?.pauseEventScheduler?.());

  // Attend que des props soient instanciés ET figés (le gel s'applique à la construction).
  await expect
    .poll(async () => {
      const t = await page.evaluate(() => window.__game?.getTerrainStats?.());
      return t ? t.frozen : 0;
    }, { timeout: 15_000 })
    .toBeGreaterThan(0);

  const s = await page.evaluate(() => window.__game?.getTerrainStats?.());
  expect(s!.frozen).toBeGreaterThanOrEqual(s!.chunks); // CHAQUE sol de chunk est figé
  expect(s!.frozen).toBeGreaterThan(s!.chunks); // + des props figés (frozen > nb de sols)
  expect(s!.props).toBeGreaterThan(0);

  expect(pageErrors, `erreurs:\n${pageErrors.join("\n")}`).toEqual([]);
});

// M7/P5 — SITES / REPÈRES : silhouettes des points d'intérêt posées aux positions déterministes
// de la carte, en LOD via l'EntityManager (silhouette de loin -> détail de près -> masqué au-delà).
// On vérifie le placement (somme des counts) ET la bascule de palier quand on s'approche.
test("les sites sont posés et passent en LOD silhouette → détail (P5)", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/");
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__game?.pauseEventScheduler?.());

  // 1) Tous les sites sont posés (somme des `count` de data/world.ts) et tous les types ont un mesh.
  const s0 = await page.evaluate(() => window.__game?.getSiteStats?.());
  expect(s0, "getSiteStats indisponible").toBeTruthy();
  // Somme des `count` de data/world.ts (~57 : grottes/maisons/villes/cités/mines/forages/champs/marais/cache/épave/cuirassé).
  // Tolérance : la cellule-ancre du marais peut être déjà occupée pour certaines graines (1 site en moins).
  expect(s0!.placed).toBeGreaterThanOrEqual(56);
  expect(s0!.types).toBe(14); // 13 types POSÉS + le modèle alternatif `outpost` (grotte nettoyée -> avant-poste)

  // 2) Au camp : des sites proches sont visibles (au moins en silhouette) une fois la boucle lancée.
  await expect
    .poll(async () => {
      const t = await page.evaluate(() => window.__game?.getSiteStats?.());
      return t ? t.full + t.minimal : 0;
    }, { timeout: 15_000 })
    .toBeGreaterThan(0);

  // 3) En se téléportant SUR un site (l'épave, au bord du monde), il passe en DÉTAIL (palier full).
  await page.evaluate(() => window.__game?.cmd?.("/tp ship"));
  await expect
    .poll(async () => {
      const t = await page.evaluate(() => window.__game?.getSiteStats?.());
      return t ? t.full : 0;
    }, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1);

  expect(pageErrors, `erreurs:\n${pageErrors.join("\n")}`).toEqual([]);
});

// M7/P6 — PERF GLOBALE / ADAPTATIVE : levier de RÉSOLUTION (hardware scaling) manuel + mode AUTO
// (vise un FPS cible). On vérifie le round-trip du levier manuel et que l'auto tourne sans casse.
test("le levier de résolution s'applique et la perf auto tourne sans casse (P6)", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/");
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });

  // Levier manuel : régler la résolution interne s'applique au moteur (round-trip).
  await page.evaluate(() => window.__game?.setHardwareScaling?.(1.6));
  expect(await page.evaluate(() => window.__game?.getHardwareScaling?.())).toBeCloseTo(1.6, 5);
  await page.evaluate(() => window.__game?.setHardwareScaling?.(1.0));
  expect(await page.evaluate(() => window.__game?.getHardwareScaling?.())).toBeCloseTo(1.0, 5);

  // Mode auto : ne casse rien et garde la résolution dans les bornes [1, 2].
  await page.evaluate(() => window.__game?.setAutoPerf?.(true));
  await page.waitForTimeout(1500);
  const lvl = await page.evaluate(() => window.__game?.getHardwareScaling?.() ?? NaN);
  expect(lvl).toBeGreaterThanOrEqual(1.0);
  expect(lvl).toBeLessThanOrEqual(2.0);
  await page.evaluate(() => window.__game?.setAutoPerf?.(false));

  expect(pageErrors, `erreurs:\n${pageErrors.join("\n")}`).toEqual([]);
});
