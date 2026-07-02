// ============================================================================
//  FOCUS D'INTERACTION (étiquette + action E) — A6 : extrait de main.ts. Détecte l'interactable
//  le plus proche du joueur et produit { position-monde, verbe, action } pour le prompt diégétique.
//  Ordonné par PRIORITÉ : le combat engagé DOMINE ; sinon le plus proche à portée gagne.
//
//  ⚠️ FRAÎCHEUR : le corps capture l'état en tête (construction synchrone, comme l'original — le
//  focus est recalculé CHAQUE frame) ; les callbacks `act`, exécutés à l'appui de E, relisent l'état
//  via ctx.getState() (jamais la capture) — gates torche/charme inclus.
// ============================================================================

import { Vector3 } from "@babylonjs/core";
import { GameState, SharedEncounter, carriedOf, Fire } from "../sim/state";
import { bestReadyWeapon } from "../sim/combat";
import { caveSteps, townSteps } from "../sim/dungeon";
import {
  attack, discoverShip, engageGuardian, enterRoom, harvestTrap, secureMine, takeDrop, takeLoot,
  talkSwamp, useOutpost, visitHouse, type PlayerAction,
} from "../sim/actions";
import { config, mineGuardians, terrainHeight } from "../../data/world";
import type { generateWorld } from "../sim/worldgen";
import type { Dialogues } from "./dialogues";
import type { Village } from "../render/buildings";
import type { Stranger } from "../render/stranger";
import type { Cabin } from "../render/cabin";
import type { Forest } from "../render/forest";
import type { Interiors } from "../render/interior";
import type { SiteLoot } from "../render/siteLoot";
import type { ShipInterior } from "../render/shipInterior";
import type { ShipAtCamp } from "../render/shipCamp";
import type { GroundDrops } from "../render/drops";
import type { SfxKey } from "../../data/audio";

export interface Focus { world: Vector3; verb: string; act: () => void; }

/** Ce que le focus emprunte à l'orchestrateur (accesseurs pour les `let` rebindés : état, carte). */
export interface FocusContext {
  getState: () => GameState;
  emit: (action: PlayerAction) => void;
  self: () => string;
  selfEngagedEnc: () => { id: string; enc: SharedEncounter } | null;
  dialogs: Dialogues;
  toast: (msg: string) => void;
  playSfx: (key: SfxKey) => void;
  getChopCooldown: () => number;
  interactFire: () => void;
  chopTree: (id: number) => void;
  /** RF5 — une cinématique de seuil est-elle déjà en cours ? (anti-réentrée à l'entrée du SAS). */
  isCineActive: () => boolean;
  /** RF5 — joue la cinématique d'entrée du cuirassé (porte au SAS + pas scripté + fondu -> commit). */
  startShipEntryCine: (commit: () => void) => void;
  player: { position: Vector3 };
  village: Village;
  stranger: Stranger;
  cabin: Cabin;
  forest: Forest;
  interiors: Interiors;
  siteLoot: SiteLoot;
  shipInterior: ShipInterior;
  shipAtCamp: ShipAtCamp;
  groundDrops: GroundDrops;
  /** Carte-monde COURANTE (un `let` rebindé par /seed/prestige -> toujours via accesseur). */
  getWorldMap: () => ReturnType<typeof generateWorld>;
}

/** Fabrique le calculateur de focus (appelé chaque frame par la boucle de main.ts). */
export function createFocusComputer(ctx: FocusContext): () => Focus | null {
  const { emit, self, dialogs } = ctx;
  return function computeFocus(): Focus | null {
    const state = ctx.getState();
    const worldMap = ctx.getWorldMap();
    const p = ctx.player.position;

    // M8.6 — COMBAT : si le joueur est ENGAGÉ dans une rencontre partagée (à portée), elle DOMINE le
    // contexte (E = frapper avec la meilleure arme PRÊTE ; « frapper… » pendant la recharge, calque du
    // « coupe… » des arbres). Court-circuite tout autre focus. L'ennemi est ancré dans le monde.
    const engaged = ctx.selfEngagedEnc();
    if (engaged) {
      const { id, enc } = engaged;
      const w = bestReadyWeapon(state, self(), enc);
      return {
        world: new Vector3(enc.x, terrainHeight(enc.x, enc.z) + 1.7, enc.z),
        verb: w ? "frapper" : "frapper…",
        act: w
          ? () => {
              emit(attack(self(), w.id, id));
              ctx.playSfx(w.id === "fists" ? "weaponUnarmed" : "weaponMelee");
            }
          : () => {},
      };
    }

    let best: Focus | null = null;
    let bestD = Infinity;
    const consider = (dist: number, range: number, make: () => Focus) => {
      if (dist <= range && dist < bestD) { bestD = dist; best = make(); }
    };

    // M8/M10 — ATELIER construit : station d'artisanat (« fabriquer » : torche, lance d'os…).
    if ((state.buildings["workshop"] ?? 0) > 0) {
      for (const wp of ctx.village.getBuildingPositions("workshop")) {
        consider(Math.hypot(wp.x - p.x, wp.z - p.z), config.cabinRange, () => ({
          world: new Vector3(wp.x, terrainHeight(wp.x, wp.z) + 2.2, wp.z),
          verb: "fabriquer",
          act: () => dialogs.showDialogue(dialogs.craftViewWorkshop),
        }));
      }
    }
    // M10 — POSTE DE TRAITE construit : commerce (« commercer » : Room.TradeGoods d'ADR).
    if ((state.buildings["trading post"] ?? 0) > 0) {
      for (const tp of ctx.village.getBuildingPositions("trading post")) {
        consider(Math.hypot(tp.x - p.x, tp.z - p.z), config.cabinRange, () => ({
          world: new Vector3(tp.x, terrainHeight(tp.x, tp.z) + 2.4, tp.z),
          verb: "commercer",
          act: () => dialogs.showDialogue(dialogs.tradeViewRef),
        }));
      }
    }

    // Feu (centre).
    consider(Math.hypot(p.x, p.z), config.fire.interactRange, () => ({
      world: new Vector3(0, terrainHeight(0, 0) + 1.7, 0),
      verb: state.fire === Fire.Dead ? "raviver le feu" : "nourrir le feu",
      act: ctx.interactFire,
    }));

    // Constructrice.
    if (ctx.stranger.isActive) {
      const s = ctx.stranger.position;
      consider(Math.hypot(s.x - p.x, s.z - p.z), config.builderRange, () => ({
        world: new Vector3(s.x, s.y + 1.3, s.z), verb: "parler", act: dialogs.openBuilderDialogue,
      }));
    }

    // Coffre + grand tableau de l'entrepôt (une fois la cabane réparée).
    if (ctx.cabin.isRepaired) {
      const c = ctx.cabin.chestPosition;
      consider(Math.hypot(c.x - p.x, c.z - p.z), config.cabinRange, () => ({
        world: new Vector3(c.x, c.y + 1.2, c.z), verb: "ouvrir le coffre", act: () => dialogs.showDialogue(dialogs.chestViewRef),
      }));
      const b = ctx.cabin.boardPosition;
      consider(Math.hypot(b.x - p.x, b.z - p.z), config.cabinRange, () => ({
        world: new Vector3(b.x, b.y + 1.9, b.z), verb: "organiser le village", act: dialogs.openBoard,
      }));
    }

    // Pièges — chacun INDIVIDUELLEMENT, et seulement s'il est PLEIN (relevable).
    ctx.village.getTrapPositions().forEach((t, i) => {
      if (state.tick < (state.trapReadyAt[i] ?? 0)) return; // ce piège est vide -> pas d'interaction
      consider(Math.hypot(t.x - p.x, t.z - p.z), config.trapRange, () => ({
        world: new Vector3(t.x, terrainHeight(t.x, t.z) + 1.2, t.z),
        verb: "relever le piège", act: () => { emit(harvestTrap(self(), i)); ctx.playSfx("checkTraps"); },
      }));
    });

    // Arbres (le plus proche dans le rayon).
    let tree: { id: number; x: number; z: number } | null = null;
    let treeD: number = config.gatherRange;
    for (const t of ctx.forest.getTrees()) {
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d <= treeD) { treeD = d; tree = t; }
    }
    if (tree) {
      const t = tree;
      consider(treeD, config.gatherRange, () => ({
        world: new Vector3(t.x, terrainHeight(t.x, t.z) + 2.6, t.z),
        verb: ctx.getChopCooldown() > 0 ? "coupe…" : "couper",
        act: () => ctx.chopTree(t.id),
      }));
    }

    // M9 — caches/filons de l'intérieur souterrain actif (butin 3D, premier-servi). On saute ceux
    // déjà pris (état sim). Le filon d'une mine : « exploiter » = ramasser le minerai + SÉCURISER (métier).
    for (const lt of ctx.interiors.activeLoot()) {
      if (state.sites?.[lt.cx + "," + lt.cz]?.taken?.[lt.nodeId]) continue;
      const d = Math.hypot(lt.x - p.x, lt.z - p.z);
      const isFilon = lt.kind === "deep" && lt.siteType.endsWith("mine");
      // M8.5/F3.1-F3.2 : filon de MINE gardé / CACHE FINALE de grotte au bout du setpiece —
      // la séquence scriptée (combats, torche qui s'éteint) doit être franchie d'abord.
      const isCaveEnd = lt.siteType === "cave" && lt.nodeId === "end";
      const stepsTotal = isFilon
        ? (mineGuardians[lt.siteType]?.length ?? 0)
        : isCaveEnd
          ? caveSteps(lt.cx, lt.cz, state.worldSeed).length
          : 0;
      const stepsDone = state.sites?.[lt.cx + "," + lt.cz]?.guardians ?? 0;
      if ((isFilon || isCaveEnd) && stepsDone < stepsTotal) {
        const next = isCaveEnd ? caveSteps(lt.cx, lt.cz, state.worldSeed)[stepsDone] : null;
        const isGate = next?.kind === "gate";
        consider(d, isCaveEnd ? 14.0 : 5.0, () => ({
          world: new Vector3(lt.x, lt.y + 0.6, lt.z),
          verb: isGate ? "rallumer une torche (1 torche)" : isCaveEnd ? "avancer dans le noir" : "affronter le gardien",
          act: () => {
            if (isGate && carriedOf(ctx.getState(), self(), "torch") < 1) { ctx.toast("la torche s'éteint — il en faut une autre pour continuer."); return; }
            emit(engageGuardian(self(), lt.cx, lt.cz, lt.siteType));
            if (isGate) ctx.toast("vous rallumez une torche — l'obscurité recule.");
          },
        }));
        continue;
      }
      consider(d, 3.6, () => ({
        world: new Vector3(lt.x, lt.y + 0.6, lt.z),
        verb: isFilon ? "exploiter le filon" : "ramasser",
        act: () => {
          emit(takeLoot(self(), lt.cx, lt.cz, lt.siteType, lt.nodeId));
          if (isFilon) { emit(secureMine(self(), lt.cx, lt.cz, lt.siteType)); ctx.toast("filon sécurisé — un mineur peut être assigné au village."); }
          else ctx.toast("butin ramassé.");
          ctx.playSfx("checkTraps");
        },
      }));
    }

    // R3/R3b — FOUILLE DE SURFACE : forages/champs de bataille (butin libre) ET villes/cités, dont
    // la CACHE FINALE (`end`) est GARDÉE par la séquence scriptée (voyous, bête, justicier, combats
    // forcés d'hôpital…) — à franchir avant de la piller (fidèle aux setpieces town/city d'ADR).
    for (const lt of ctx.siteLoot.activeLoot()) {
      const sp = state.sites?.[lt.cx + "," + lt.cz];
      if (sp?.taken?.[lt.nodeId]) continue; // déjà fouillé
      const isDungeonEnd = (lt.siteType === "town" || lt.siteType === "city") && lt.nodeId === "end";
      if (isDungeonEnd) {
        const steps = townSteps(lt.siteType as "town" | "city", lt.cx, lt.cz, state.worldSeed);
        const done = sp?.guardians ?? 0;
        if (done < steps.length) {
          const next = steps[done];
          const isGate = next?.kind === "gate";
          consider(Math.hypot(lt.x - p.x, lt.z - p.z), 6.0, () => ({
            world: new Vector3(lt.x, lt.y + 0.9, lt.z),
            verb: isGate ? "forcer la porte (1 torche)" : "s'enfoncer dans les ruines",
            act: () => {
              if (isGate && carriedOf(ctx.getState(), self(), "torch") < 1) { ctx.toast("il fait trop noir là-dedans — il faut une torche."); return; }
              emit(engageGuardian(self(), lt.cx, lt.cz, lt.siteType));
              if (isGate) ctx.toast("vous forcez le passage, torche au poing.");
            },
          }));
          continue;
        }
      }
      consider(Math.hypot(lt.x - p.x, lt.z - p.z), 3.6, () => ({
        world: new Vector3(lt.x, lt.y + 0.6, lt.z),
        verb: "fouiller",
        act: () => {
          emit(takeLoot(self(), lt.cx, lt.cz, lt.siteType, lt.nodeId));
          ctx.toast("butin récupéré.");
          ctx.playSfx("checkTraps");
        },
      }));
    }

    // M8.5/F3.3-3.4 — MAISONS (fouille one-shot 25/25/50) & MARAIS (charme -> gastronome).
    for (const st of worldMap.sites) {
      if (st.type !== "house" && st.type !== "swamp") continue;
      const k = st.cx + "," + st.cz;
      if (state.sites?.[k]?.visited) continue;
      if (st.type === "swamp" && state.perks["gastronome"]) continue;
      const w = worldMap.cellToWorldCenter(st.cx, st.cz);
      const d = Math.hypot(w.x - p.x, w.z - p.z);
      if (st.type === "house") {
        consider(d, 7.0, () => ({
          world: new Vector3(w.x, terrainHeight(w.x, w.z) + 2.4, w.z),
          verb: "fouiller la maison",
          act: () => { emit(visitHouse(self(), st.cx, st.cz)); ctx.playSfx("checkTraps"); },
        }));
      } else {
        consider(d, 7.0, () => ({
          world: new Vector3(w.x, terrainHeight(w.x, w.z) + 2.4, w.z),
          verb: "offrir un charme",
          act: () => {
            if (carriedOf(ctx.getState(), self(), "charm") < 1) { ctx.toast("le vieil ermite veut un charme (les pièges en attrapent, rarement)."); return; }
            emit(talkSwamp(self(), st.cx, st.cz));
            ctx.toast("l'ermite parle longtemps. la viande nourrira deux fois mieux — gastronome.");
          },
        }));
      }
    }

    // M11/RF2b — LE CUIRASSÉ EXPLORABLE : on PÉNÈTRE par l'antichambre puis on ENTRE salle par salle
    // (ENTER_ROOM -> verrou d'arène + spawn de la vague, combat PARTAGÉ M8.6 ; le focus « frapper »
    // prend le relais). Le pont est SCELLÉ tant que les 3 ailes ne sont pas nettoyées. Le combat est
    // émergent (clear de salle host) — pas de « piller » : la dernière salle (pont) finit le cuirassé.
    for (const et of ctx.shipInterior.enterTargets(ctx.player.position, state)) {
      const d = Math.hypot(et.world.x - p.x, et.world.z - p.z);
      consider(d, 7.0, () => ({
        world: et.world,
        verb: et.verb,
        act: () => {
          if (et.sealed) { ctx.toast("le pont reste scellé — il faut d'abord nettoyer les trois ailes du cuirassé."); return; }
          if (et.room === "antechamber" && !ctx.isCineActive()) {
            // RF5 — pénétrer par le SAS : cinématique de seuil (porte alien ANCRÉE AU SAS + PAS SCRIPTÉ
            // + fondu), ENTER_ROOM(antichambre) émis AU FONDU (chargement masqué). 100 % local, timeout-safe.
            ctx.startShipEntryCine(() => emit(enterRoom(self(), et.cx, et.cz, "antechamber")));
          } else {
            emit(enterRoom(self(), et.cx, et.cz, et.room));
            ctx.playSfx("weaponMelee");
          }
        },
      }));
    }

    // M11/RF1 — L'ÉPAVE (au bord du monde) : la TROUVER suffit (fidèle ADR : indépendant du cuirassé).
    // Tant qu'on ne l'a pas trouvée -> « découvrir l'épave » (DISCOVER_SHIP). Une fois trouvée, l'épave
    // n'est plus interactive : le vaisseau se gère AU CAMP (RF1b, branche dédiée plus bas).
    if (!state.perks["ship_found"]) {
      for (const st of worldMap.sites) {
        if (st.type !== "ship") continue;
        const w = worldMap.cellToWorldCenter(st.cx, st.cz);
        consider(Math.hypot(w.x - p.x, w.z - p.z), 8.0, () => ({
          world: new Vector3(w.x, terrainHeight(w.x, w.z) + 3.2, w.z),
          verb: "découvrir l'épave",
          act: () => {
            emit(discoverShip(self(), st.cx, st.cz));
            ctx.toast("vaisseau wanderer remorqué jusqu'au CAMP. rentre au village (◆ sur la minimap) pour le RÉPARER à l'alliage de l'entrepôt, puis DÉCOLLER.");
            ctx.playSfx("checkTraps");
          },
        }));
      }
    }

    // M11/RF1b — LE VAISSEAU AU CAMP : une fois trouvé, on le répare / décolle DEPUIS LA BASE (fidèle ADR).
    if (state.perks["ship_found"]) {
      const sc = ctx.shipAtCamp.worldPos();
      consider(Math.hypot(sc.x - p.x, sc.z - p.z), 7.0, () => ({
        world: new Vector3(sc.x, terrainHeight(sc.x, sc.z) + 3.0, sc.z),
        verb: "examiner le vaisseau",
        act: () => dialogs.showDialogue(dialogs.shipViewRef),
      }));
    }

    // Reste M7 — AVANT-POSTES : une grotte nettoyée (`cleared`) se ravitaille UNE fois (eau + vivres,
    // usage unique partagé — l'hôte arbitre). Le verbe disparaît une fois l'avant-poste épuisé (`used`).
    // On itère `state.sites` (petit : seuls les sites VISITÉS y vivent), pas les ~57 sites du monde.
    for (const k of Object.keys(state.sites ?? {})) {
      const prog = state.sites[k];
      if (!prog.cleared || prog.usedBy?.[self()]) continue; // une fois PAR EXPÉDITION (M8.5/F4)
      const ci = k.indexOf(",");
      const cx = Number(k.slice(0, ci)), cz = Number(k.slice(ci + 1));
      const w = worldMap.cellToWorldCenter(cx, cz);
      consider(Math.hypot(w.x - p.x, w.z - p.z), config.outpostRange, () => ({
        world: new Vector3(w.x, terrainHeight(w.x, w.z) + 2.4, w.z),
        verb: "se ravitailler",
        act: () => {
          emit(useOutpost(self(), cx, cz));
          ctx.playSfx("deposit");
          ctx.toast("gourdes et vivres remplis — l'avant-poste est épuisé.");
        },
      }));
    }

    // M8.6 — BUTIN AU SOL : à la mort d'un ennemi, son butin tombe en pile ramassable (premier-servi).
    for (const t of ctx.groundDrops.targets()) {
      consider(Math.hypot(t.x - p.x, t.z - p.z), 3.2, () => ({
        world: new Vector3(t.x, t.y + 0.4, t.z),
        verb: "ramasser le butin",
        act: () => {
          emit(takeDrop(self(), t.dropId));
          ctx.playSfx("checkTraps");
          ctx.toast("butin ramassé.");
        },
      }));
    }

    return best;
  };
}
