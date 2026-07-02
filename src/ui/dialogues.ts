// ============================================================================
//  DIALOGUES DU JEU (vues + plomberie + révélation des craftables) — A6 : extrait de main.ts.
//  Toutes les VUES de dialogue (constructrice/atelier/troc/coffre/vaisseau/tableau/événement/fin)
//  + la plomberie (show/refresh/close, pointeur) + le système de RÉVÉLATION façon ADR (collant,
//  persisté, badge « nouveau »).
//
//  ⚠️ IDENTITÉ DES VUES : `eventView`/`rootView` sont créées UNE FOIS (membres) — main.ts compare
//  leur identité (`current() === eventView` : événement MODAL ; rafraîchissement de rootView).
//  ⚠️ FRAÎCHEUR D'ÉTAT : les vues capturent l'état EN TÊTE de construction (identique à l'original,
//  aucun reduce ne survient pendant la construction synchrone) ; les callbacks `onSelect`, exécutés
//  PLUS TARD, relisent l'état via les accesseurs (jamais la capture).
// ============================================================================

import { GameState, carriedOf, carriedTotal, carryCapacity, freeWorkers, stockOf, plannedCount } from "../sim/state";
import {
  assignWorker, build, buy, craftItem, deposit, liftOff, prestige, reinforceShip, repairCabin,
  resolveEventChoice, unassignWorker, upgradeCabin, upgradeEngine, withdraw, type PlayerAction,
} from "../sim/actions";
import {
  config, craftables, craftableCost, craftableItems, craftableRevealed, cabinUpgradeCost,
  nextCabinTier, eventById, jobs, storageCap, tradeGoods, RESOURCE_LABELS, SHIP,
} from "../../data/world";
import { saveDiscovered, loadDiscovered } from "../save";
import type { Hud, DialogueChoice, DialogueStepper, DialogueView } from "./hud";
import type { AudioManager } from "../render/audio";

/** Ce que les dialogues empruntent à l'orchestrateur (accesseurs — l'état y est un `let` rebindé). */
export interface DialoguesContext {
  getState: () => GameState;
  emit: (action: PlayerAction) => void;
  self: () => string;
  hud: Hud;
  audio: AudioManager;
  releasePointer: () => void;
  engagePointer: () => void;
  /** Position-monde du vaisseau au camp (RF1b) — reste côté main (shipAtCamp). */
  shipWorldPos: () => { x: number; z: number };
  /** Après un PRESTIGE appliqué localement : régénère le monde + réveil au camp + save (main). */
  onWorldRestart: () => void;
}

export class Dialogues {
  // Craftables RÉVÉLÉS (présentation, COLLANT + PERSISTÉ, façon A Dark Room) : une fois débloqué,
  // l'élément reste dans la liste de construction (grisé si pas les moyens), même après un
  // rechargement. Donnée LOCALE de présentation (≠ GameState déterministe), restaurée du disque.
  private readonly discovered = new Set<string>(loadDiscovered());
  private readonly pendingReveal = new Set<string>(); // révélés mais pas encore vus -> « ! » constructrice
  private readonly justRevealed = new Set<string>(); // vus dans le dialogue OUVERT -> badge « nouveau »
  private currentDialogue: (() => DialogueView) | null = null;

  constructor(private readonly ctx: DialoguesContext) {}

  // ---- PLOMBERIE (règle souris : ouvrir une UI LIBÈRE le pointeur ; fermer le RECAPTURE) ----

  /** La fabrique de vue COURANTE (identité comparée : `current() === eventView` -> modal). */
  current(): (() => DialogueView) | null {
    return this.currentDialogue;
  }

  showDialogue = (make: () => DialogueView): void => {
    this.currentDialogue = make;
    this.ctx.hud.openDialogue(make(), false);
    this.ctx.releasePointer(); // souris libérée pour cliquer
  };

  refreshDialogue = (): void => {
    if (this.currentDialogue) this.ctx.hud.openDialogue(this.currentDialogue(), true);
  };

  /** Ferme toute interface ouverte (dialogue ou menu) et RECAPTURE le pointeur. */
  closeInteractive = (): void => {
    this.currentDialogue = null;
    this.justRevealed.clear(); // les badges « nouveau » ne valent que pour la session de dialogue
    this.ctx.hud.closeDialogue();
    this.ctx.hud.closeSettings();
    this.ctx.engagePointer(); // appelé dans un geste (clic/Échap) -> recapture
  };

  // ---- RÉVÉLATION des craftables (règle ADR, présentation locale persistée) ----

  /** Des nouveautés attendent-elles d'être vues ? (le « ! » au-dessus de la constructrice). */
  hasPendingReveals(): boolean {
    return this.pendingReveal.size > 0;
  }

  /** Le joueur « voit » les nouveautés : pendingReveal -> justRevealed (badge), « ! » s'éteint. */
  acknowledgeReveals = (): void => {
    for (const id of this.pendingReveal) this.justRevealed.add(id);
    this.pendingReveal.clear();
  };

  /** Révèle les craftables selon la règle d'A Dark Room (`craftableRevealed` : ½ du bois + chaque
   *  autre ingrédient « vu » ≥ 1, ou déjà bâti). Gate D4 : rien avant la cabane réparée (≈ builder
   *  lvl 4 d'ADR). Révélation COLLANTE et persistée ; chaque nouveauté alimente `pendingReveal`. */
  updateDiscovered = (): boolean => {
    const state = this.ctx.getState();
    if (!state.cabinRepaired) return false;
    let grew = false;
    for (const c of craftables) {
      if (this.discovered.has(c.id)) continue;
      if (craftableRevealed(c, state.resources, state.buildings[c.id] ?? 0)) {
        this.discovered.add(c.id);
        this.pendingReveal.add(c.id);
        grew = true;
      }
    }
    if (grew) saveDiscovered([...this.discovered]);
    return grew;
  };

  private formatCost(cost: Record<string, number>): string {
    return Object.keys(cost).map((r) => `${cost[r]} ${RESOURCE_LABELS[r] ?? r}`).join(", ");
  }

  // ---- VUES (fabriques STABLES — créées une fois, l'identité sert aux watchers de main.ts) ----

  private buildChoices(): DialogueChoice[] {
    const state = this.ctx.getState();
    const { emit, self, audio } = this.ctx;
    const choices: DialogueChoice[] = [];
    for (const c of craftables) {
      // Construit + EN CHANTIER : le coût/plafond suit le rang du prochain exemplaire commandé
      // (sinon on pourrait enfiler plusieurs chantiers au même prix et dépasser le maximum).
      const count = plannedCount(state, c.id);
      if (!this.discovered.has(c.id)) continue; // pas encore débloqué (cf. updateDiscovered)
      const cost = craftableCost(c, count);
      const affordable = Object.keys(cost).every((r) => (state.resources[r] ?? 0) >= cost[r]);
      const maxed = count >= c.maximum;
      // Info-bulle au survol : ce qu'il manque à l'entrepôt (le message n'encombre plus le dialogue).
      const missing = Object.keys(cost)
        .map((r) => ({ r, lack: cost[r] - Math.floor(state.resources[r] ?? 0) }))
        .filter((m) => m.lack > 0);
      // On N'AFFICHE PAS le plafond (`c.maximum`) : la limite reste une découverte du joueur.
      // Le compte de ce qu'il a déjà bâti, lui, est légitime (c'est son propre geste).
      const isNew = this.justRevealed.has(c.id);
      // Survol : pour une NOUVEAUTÉ, le message narratif d'ADR ; sinon ce qui manque / le plafond.
      const tooltip = isNew && c.availableMsg
        ? c.availableMsg
        : maxed
          ? "inutile d'en bâtir davantage" // découverte au moment où on bute dessus (sans révéler le chiffre)
          : missing.length
            ? `il manque : ${missing.map((m) => `${m.lack} ${RESOURCE_LABELS[m.r] ?? m.r}`).join(", ")}`
            : undefined;
      choices.push({
        label: count > 0 ? `${c.name} ${count}` : c.name,
        // Coût affiché UNIQUEMENT pour ce qui peut encore être construit (rien au plafond).
        sublabel: maxed ? undefined : this.formatCost(cost),
        tooltip,
        isNew,
        enabled: !maxed && affordable,
        onSelect: () => { emit(build(self(), c.id)); audio.playSfx("build"); this.refreshDialogue(); },
      });
    }
    // Amélioration de l'entrepôt (×1 -> ×5 -> ×10) : coût puisé dans l'entrepôt.
    const next = nextCabinTier(state.cabinTier);
    if (state.cabinRepaired && next !== null) {
      const ucost = cabinUpgradeCost[next] ?? {};
      const affordable = Object.keys(ucost).every((r) => (state.resources[r] ?? 0) >= ucost[r]);
      const missing = Object.keys(ucost)
        .map((r) => ({ r, lack: ucost[r] - Math.floor(state.resources[r] ?? 0) }))
        .filter((m) => m.lack > 0);
      choices.push({
        label: `agrandir l'entrepôt (×${next})`,
        sublabel: this.formatCost(ucost),
        tooltip: missing.length ? `il manque : ${missing.map((m) => `${m.lack} ${RESOURCE_LABELS[m.r] ?? m.r}`).join(", ")}` : undefined,
        enabled: affordable,
        onSelect: () => { emit(upgradeCabin(self())); audio.playSfx("build"); this.refreshDialogue(); },
      });
    }
    return choices;
  }

  private buildView(): DialogueView {
    return {
      speaker: "la constructrice",
      text: "« qu'est-ce qu'on bâtit ? »",
      choices: [
        ...this.buildChoices(),
        // M8/M10 — fabrication d'OBJETS simples (sans atelier : la torche, fidèle au room-craft ADR).
        { label: "fabriquer un objet…", enabled: true, onSelect: () => this.showDialogue(this.craftViewBuilder) },
        { label: "(s'éloigner)", enabled: true, onSelect: this.closeInteractive },
      ],
    };
  }

  // M8/M10 — vue « FABRIQUER » réutilisable : liste les `craftableItems` accessibles. `atelier` :
  // true = station d'artisanat (E sur l'atelier construit — tous les items dont le prérequis
  // bâtiment est satisfait) ; false = via la constructrice (items SANS bâtiment requis, ex. torche).
  // Coûts puisés dans l'ENTREPÔT, l'objet va au SAC (guards sim CRAFT_ITEM : recette/bâtiment/place).
  private craftView(atelier: boolean): DialogueView {
    const state = this.ctx.getState();
    const { emit, self, audio, hud } = this.ctx;
    const items = craftableItems.filter((it) => {
      // M11/RF7 — Fabricator : items gatés PERK (tech alien) -> à l'atelier, seulement une fois
      // l'antichambre du cuirassé franchie. Jamais chez la constructrice (objets simples).
      if (it.requiresPerk) return atelier && !!state.perks[it.requiresPerk];
      return atelier ? !it.building || (state.buildings[it.building] ?? 0) > 0 : !it.building;
    });
    const hasFab = atelier && craftableItems.some((it) => it.requiresPerk && !!state.perks[it.requiresPerk]);
    const room = carryCapacity(state) - carriedTotal(state, self()) > 0;
    const choices: DialogueChoice[] = items.map((it) => {
      const isUpgrade = it.type === "upgrade"; // M10 : possession du village -> entrepôt, max 1
      const owned = isUpgrade && it.maximum !== undefined && stockOf(state, it.id) >= it.maximum;
      const needsRoom = !isUpgrade && !room; // un upgrade ne prend pas de place de sac
      const missing = Object.keys(it.recipe)
        .map((r) => ({ r, lack: it.recipe[r] - Math.floor(state.resources[r] ?? 0) }))
        .filter((m) => m.lack > 0);
      return {
        label: it.name,
        sublabel: owned ? "déjà possédé" : Object.keys(it.recipe).map((r) => `${it.recipe[r]} ${RESOURCE_LABELS[r] ?? r}`).join(", "),
        tooltip: needsRoom
          ? "sac plein"
          : missing.length && !owned
            ? `il manque : ${missing.map((m) => `${m.lack} ${RESOURCE_LABELS[m.r] ?? m.r}`).join(", ")}`
            : undefined,
        enabled: !owned && missing.length === 0 && !needsRoom,
        onSelect: () => {
          emit(craftItem(self(), it.id));
          audio.playSfx("deposit");
          hud.toast(isUpgrade ? `${it.name} — le village s'équipe.` : `${it.name} — dans votre sac.`);
          this.refreshDialogue();
        },
      };
    });
    return {
      speaker: hasFab ? "l'atelier · fabricateur" : atelier ? "l'atelier" : "la constructrice",
      text: hasFab
        ? "l'établi ronronne d'une lueur alien — le fabricateur a appris d'étranges plans. qu'est-ce qu'on forge ?"
        : atelier ? "l'établi est prêt. qu'est-ce qu'on fabrique ?" : "« je peux te préparer quelques objets simples. »",
      choices: [...choices, { label: "(fermer)", enabled: true, onSelect: this.closeInteractive }],
    };
  }
  readonly craftViewBuilder = (): DialogueView => this.craftView(false);
  readonly craftViewWorkshop = (): DialogueView => this.craftView(true);

  // M10 — POSTE DE TRAITE : vue de commerce (Room.TradeGoods d'ADR — coûts exacts, fourrure/
  // écailles/dents = monnaies). Achats payés à l'ENTREPÔT, gains à l'ENTREPÔT (guards sim BUY).
  readonly tradeViewRef = (): DialogueView => {
    const state = this.ctx.getState();
    const { emit, self, audio } = this.ctx;
    const choices: DialogueChoice[] = tradeGoods.map((g) => {
      const missing = Object.keys(g.cost)
        .map((r) => ({ r, lack: g.cost[r] - Math.floor(state.resources[r] ?? 0) }))
        .filter((m) => m.lack > 0);
      return {
        label: RESOURCE_LABELS[g.id] ?? g.id,
        sublabel: Object.keys(g.cost).map((r) => `${g.cost[r]} ${RESOURCE_LABELS[r] ?? r}`).join(", "),
        tooltip: missing.length
          ? `il manque : ${missing.map((m) => `${m.lack} ${RESOURCE_LABELS[m.r] ?? m.r}`).join(", ")}`
          : undefined,
        enabled: missing.length === 0,
        onSelect: () => { emit(buy(self(), g.id)); audio.playSfx("buy"); this.refreshDialogue(); },
      };
    });
    return {
      speaker: "le poste de traite",
      text: "les étals sont garnis. la fourrure fait foi.",
      choices: [...choices, { label: "(fermer)", enabled: true, onSelect: this.closeInteractive }],
    };
  };

  /** Vider le sac au coffre — feedback HUD sur le surplus perdu (prédiction locale, sim inchangée). */
  private depositAtChest(): void {
    const state = this.ctx.getState();
    const { emit, self, audio, hud } = this.ctx;
    if (carriedTotal(state, self()) <= 0) {
      hud.toast("le sac est vide.");
      return;
    }
    // Surplus PERDU au dépôt : l'entrepôt borne chaque ressource à son plafond (clamp sec dans
    // le reducer pur). On le PRÉDIT localement depuis l'état pré-dépôt — feedback HUD seul.
    const bag = state.carried[self()] ?? {};
    const overflow: string[] = [];
    for (const id of Object.keys(bag)) {
      const total = (state.resources[id] ?? 0) + bag[id];
      if (total - Math.min(storageCap(state.cabinTier, id), total) > 0) overflow.push(RESOURCE_LABELS[id] ?? id);
    }
    emit(deposit(self()));
    audio.playSfx("deposit");
    hud.toast(overflow.length
      ? `entrepôt plein : surplus de ${overflow.join(", ")} perdu`
      : "rangé dans l'entrepôt.");
  }

  // M10 — COFFRE : « tout déposer » + S'ÉQUIPER (l'outfitting d'ADR : retirer des consommables
  // d'expédition de l'entrepôt vers le sac — action WITHDRAW bornée par stock & capacité).
  private static readonly OUTFIT_IDS = ["cured meat", "medicine", "bullets", "grenade", "torch", "bait"];
  readonly chestViewRef = (): DialogueView => {
    const state = this.ctx.getState();
    const { emit, self } = this.ctx;
    const total = Math.floor(carriedTotal(state, self()));
    const cap = carryCapacity(state);
    const steppers: DialogueStepper[] = Dialogues.OUTFIT_IDS
      .filter((id) => stockOf(state, id) > 0 || carriedOf(state, self(), id) > 0)
      .map((id) => ({
        label: RESOURCE_LABELS[id] ?? id,
        value: `${Math.floor(carriedOf(state, self(), id))}`,
        sublabel: `entrepôt : ${Math.floor(stockOf(state, id))}`,
        canDec: false, // re-déposer = « tout déposer » (DEPOSIT vide le sac entier)
        canInc: stockOf(state, id) > 0 && total < cap,
        onDec: () => {},
        onInc: () => { emit(withdraw(self(), id, 1)); this.refreshDialogue(); },
      }));
    return {
      speaker: "le coffre",
      text: `votre sac : ${total}/${cap}. prendre des vivres pour la route, ou tout déposer.`,
      steppers,
      choices: [
        { label: "tout déposer", sublabel: total > 0 ? `${total} au total` : "(sac vide)", enabled: total > 0,
          onSelect: () => { this.depositAtChest(); this.refreshDialogue(); } },
        { label: "(fermer)", enabled: true, onSelect: this.closeInteractive },
      ],
    };
  };

  // M11/E2 — LE VAISSEAU : réparer l'épave avec l'alliage (l'écran Ship d'ADR). Renforcer la coque
  // (PV de l'ascension) / calibrer le moteur (réduit la difficulté du décollage). Le décollage (E3)
  // s'arme une fois la coque minimale atteinte — annoncé ici pour donner le cap.
  readonly shipViewRef = (): DialogueView => {
    const state = this.ctx.getState();
    const { emit, self, audio } = this.ctx;
    const alloy = Math.floor(stockOf(state, "alien alloy"));
    const { hull, engine } = state.ship;
    const ready = hull >= SHIP.liftoffHullMin;
    return {
      speaker: "le vaisseau",
      text: `coque ${hull}/${SHIP.hullMax} · moteur ${engine}/${SHIP.engineMax} · alliage en réserve : ${alloy}. `
        + (ready ? "la coque tiendra l'ascension." : `il faut au moins ${SHIP.liftoffHullMin} de coque pour décoller.`),
      choices: [
        {
          label: "renforcer la coque", sublabel: `${SHIP.alloyPerHull} alliage → +1 coque`,
          tooltip: hull >= SHIP.hullMax ? "coque au maximum" : (alloy < SHIP.alloyPerHull ? "pas assez d'alliage" : undefined),
          enabled: hull < SHIP.hullMax && alloy >= SHIP.alloyPerHull,
          onSelect: () => { emit(reinforceShip(self())); audio.playSfx("build"); this.refreshDialogue(); },
        },
        {
          label: "calibrer le moteur", sublabel: `${SHIP.alloyPerEngine} alliage → +1 poussée`,
          tooltip: engine >= SHIP.engineMax ? "moteur au maximum" : (alloy < SHIP.alloyPerEngine ? "pas assez d'alliage" : undefined),
          enabled: engine < SHIP.engineMax && alloy >= SHIP.alloyPerEngine,
          onSelect: () => { emit(upgradeEngine(self())); audio.playSfx("build"); this.refreshDialogue(); },
        },
        {
          label: "DÉCOLLER", sublabel: ready ? "quitter cette planète" : `coque insuffisante (${hull}/${SHIP.liftoffHullMin})`,
          tooltip: ready ? undefined : "renforce d'abord la coque",
          enabled: ready,
          onSelect: () => this.showDialogue(this.liftoffConfirmView), // point-of-no-return : on confirme
        },
        { label: "(fermer)", enabled: true, onSelect: this.closeInteractive },
      ],
    };
  };

  // Confirmation du décollage (point-of-no-return — standard de l'industrie avant un climax irréversible).
  readonly liftoffConfirmView = (): DialogueView => ({
    speaker: "le vaisseau",
    text: "les moteurs grondent. une fois lancés, plus de retour en arrière — il faudra percer l'atmosphère. prêt ?",
    choices: [
      { label: "décoller — quitter ce monde", enabled: true,
        onSelect: () => { const w = this.ctx.shipWorldPos(); this.ctx.emit(liftOff(this.ctx.self(), w.x, w.z)); this.closeInteractive(); } },
      { label: "pas encore", enabled: true, onSelect: () => this.showDialogue(this.shipViewRef) },
    ],
  });

  // M11/E4 — ÉCRAN DE FIN (épilogue) + PRESTIGE (NG+). Ouvert à l'évasion ; « recommencer » réamorce
  // un monde neuf (graine fraîche) en reportant les perks. « contempler » laisse l'écran ouvert.
  readonly restartWorld = (): void => {
    const { emit, self, hud } = this.ctx;
    const before = this.ctx.getState().worldSeed;
    emit(prestige(self())); // hôte/hors-ligne -> applique localement ; client -> demande à l'hôte (snapshot)
    this.closeInteractive();
    if (this.ctx.getState().worldSeed !== before) this.ctx.onWorldRestart(); // appliqué localement -> monde neuf + réveil au camp
    hud.toast(`un monde neuf s'éveille. (évasions : ${this.ctx.getState().prestige})`);
  };

  readonly endingView = (): DialogueView => {
    const state = this.ctx.getState();
    // M11/RF6 — FIN ÉTENDUE si le `fleet beacon` (drop du boss du pont) a été ramené à bord
    // (à l'entrepôt OU au sac). Sinon, fin standard. Le beacon est OPTIONNEL (n'empêche pas l'évasion).
    const hasBeacon = stockOf(state, "fleet beacon") > 0 || carriedOf(state, this.ctx.self(), "fleet beacon") > 0;
    const text = hasBeacon
      ? "le vaisseau perce les nuages, puis le vide. la planète sombre rétrécit — un point, puis rien. "
        + "la balise de flotte s'éveille dans la soute : un signal court vers les ténèbres, et QUELQUE CHOSE "
        + "répond. des silhouettes immenses glissent entre les étoiles — la flotte des wanderers vous a "
        + "entendu·e. vous n'êtes pas seul·e. la première à fuir, jamais la dernière."
      : "le vaisseau perce les nuages, puis le vide. la planète sombre rétrécit — un point, puis rien. "
        + "derrière vous, un feu que vous avez nourri ; devant, les étoiles. le silence est total. vous êtes libre.";
    return {
      speaker: "épilogue",
      text,
      choices: [
        { label: "recommencer — un monde neuf", enabled: true, onSelect: this.restartWorld },
        { label: "contempler les étoiles", enabled: true, onSelect: () => { /* reste sur l'écran de fin */ } },
      ],
    };
  };

  private formatStores(stores: Record<string, number>): string {
    return Object.keys(stores).map((s) => `${stores[s] > 0 ? "+" : ""}${stores[s]} ${RESOURCE_LABELS[s] ?? s}`).join(", ");
  }

  private workerSteppers(): DialogueStepper[] {
    const state = this.ctx.getState();
    const { emit, self } = this.ctx;
    const free = freeWorkers(state);
    const steppers: DialogueStepper[] = [];
    for (const j of jobs) {
      if (j.building && (state.buildings[j.building] ?? 0) === 0) continue;
      // Le bûcheron est l'occupation par défaut (le « reste ») : listé comme les autres, mais
      // SANS +/- (on ne l'assigne pas, on reconvertit des bûcherons vers les métiers).
      if (j.id === "gatherer") {
        steppers.push({
          label: j.name,
          value: String(free),
          sublabel: this.formatStores(j.stores),
          canDec: false,
          canInc: false,
          onDec: () => {},
          onInc: () => {},
          readOnly: true,
        });
        continue;
      }
      const n = state.workers[j.id] ?? 0;
      steppers.push({
        label: j.name,
        value: String(n),
        sublabel: this.formatStores(j.stores),
        canDec: n > 0,
        canInc: free > 0,
        onDec: () => { emit(unassignWorker(self(), j.id)); this.refreshDialogue(); },
        onInc: () => { emit(assignWorker(self(), j.id)); this.refreshDialogue(); },
      });
    }
    return steppers;
  }

  // Le GRAND TABLEAU (dans la cabane) gère la répartition des villageois (Temps 2).
  readonly workersView = (): DialogueView => ({
    speaker: "le tableau du village",
    text: "qui fait quoi au village ?",
    steppers: this.workerSteppers(),
    choices: [{ label: "(fermer)", enabled: true, onSelect: this.closeInteractive }],
  });

  // La CONSTRUCTRICE : réparer la cabane, puis construire.
  readonly rootView = (): DialogueView => {
    const state = this.ctx.getState();
    const { emit, self, audio } = this.ctx;
    const speaker = "la constructrice";
    if (state.builder < config.fire.builder.maxLevel) {
      return { speaker, text: "« laisse-moi me réchauffer encore un peu près du feu… »",
        choices: [{ label: "(s'éloigner)", enabled: true, onSelect: this.closeInteractive }] };
    }
    if (!state.cabinRepaired) {
      const have = Math.floor(carriedOf(state, self(), "wood"));
      const cost = config.cabinRepairCost;
      return {
        speaker,
        text: "« cette vieille cabane tient encore debout. aide-moi à la remettre d'aplomb. »",
        choices: [
          { label: "réparer la cabane", sublabel: `${cost} bois (sac : ${have})`, enabled: have >= cost,
            onSelect: () => { emit(repairCabin(self())); audio.playSfx("build"); this.refreshDialogue(); } },
          { label: "(s'éloigner)", enabled: true, onSelect: this.closeInteractive },
        ],
      };
    }
    // Cabane réparée → directement la liste de construction (plus de dialogue d'intro inutile).
    return this.buildView();
  };

  readonly openBuilderDialogue = (): void => { this.acknowledgeReveals(); this.showDialogue(this.rootView); };
  readonly openBoard = (): void => { this.showDialogue(this.workersView); };

  // M5 — panneau d'ÉVÉNEMENT : la scène courante de l'état -> DialogueView (réutilise le dialogue).
  // L'ouverture/fermeture/rafraîchissement est piloté par le watcher dans reflectState (l'état
  // fait foi : en P2P, l'événement arrive par snapshot et les deux joueurs voient le même panneau).
  readonly eventView = (): DialogueView => {
    const state = this.ctx.getState();
    const { emit, self } = this.ctx;
    const active = state.activeEvent;
    const ev = active ? eventById[active.id] : undefined;
    const scene = ev && active ? ev.scenes[active.scene] : undefined;
    if (!ev || !scene) {
      return { speaker: "", text: "", choices: [{ label: "(fermer)", enabled: true, onSelect: this.closeInteractive }] };
    }
    const choices: DialogueChoice[] = scene.choices
      .filter((c) => c.available?.(state) ?? true)
      .map((c) => {
        const missing = c.cost
          ? Object.keys(c.cost)
              .map((r) => ({ r, lack: c.cost![r] - Math.floor(state.resources[r] ?? 0) }))
              .filter((m) => m.lack > 0)
          : [];
        return {
          label: c.text,
          sublabel: c.cost ? this.formatCost(c.cost) : undefined,
          tooltip: missing.length
            ? `il manque : ${missing.map((m) => `${m.lack} ${RESOURCE_LABELS[m.r] ?? m.r}`).join(", ")}`
            : undefined,
          enabled: missing.length === 0,
          onSelect: () => emit(resolveEventChoice(self(), c.id)),
        };
      });
    return { speaker: ev.title, text: scene.text.join(" "), choices };
  };
}
