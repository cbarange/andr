// ============================================================================
//  CONSOLE DEV — DISPATCHER de commandes (slash). Outil de développement/test.
//  Couche « corps » (dev) : lit l'état, ÉMET des actions (debug, hôte-autoritaire)
//  ou agit en LOCAL (téléport, infos). Aucune règle de jeu ici. Le même dispatcher
//  est exposé en `window.__game.cmd(...)` -> commandes pilotables aussi depuis
//  Playwright / la console du navigateur. Voir la proposition dans le fil.
// ============================================================================

import type { GameState } from "../sim/state";
import {
  type PlayerAction, debugGrant, debugSet, debugClear, debugSetFire, debugSetBuilder,
  debugAddPop, debugBuild, debugUnlockAll, assignWorker, unassignWorker,
} from "../sim/actions";
import { standProfile, type WorldMap } from "../sim/worldgen";
import {
  config, biomes, biomeById, jobs, jobById, craftables, craftableById, sites, RESOURCE_LABELS,
  events,
} from "../../data/world";

/** Tout ce dont les commandes ont besoin (fourni par main.ts). */
export interface CommandCtx {
  getState(): GameState;
  self(): string;
  emit(a: PlayerAction): void;
  teleport(x: number, z: number): void;
  playerPos(): { x: number; z: number };
  getWorldMap(): WorldMap; // courante (peut changer via /seed)
  triggerEvent(id: string): void;
  fastForward(seconds: number): void;
  clearSave(): void;
  saveNow(): void;
  // Lot 2 :
  setFly(on: boolean): void;
  isFlying(): boolean;
  setNoclip(on: boolean): void;
  isNoclip(): boolean;
  reseed(seed: number): void;
}

interface Command {
  usage: string;
  help: string;
  run(args: string[], ctx: CommandCtx): string;
}

const num = (s: string | undefined, def = NaN): number => {
  const v = Number(s);
  return Number.isFinite(v) ? v : def;
};

/** Résout un id de bâtiment depuis des args (gère les ids à espaces : « trading post »). */
function resolveBuilding(args: string[]): { id: string; count: number } | null {
  if (args.length === 0) return null;
  const last = args[args.length - 1];
  const hasCount = args.length > 1 && Number.isFinite(Number(last));
  const id = (hasCount ? args.slice(0, -1) : args).join(" ").toLowerCase();
  const count = hasCount ? Math.floor(Number(last)) : 1;
  return craftableById[id] ? { id, count } : null;
}

const BUILDER_MAX = config.fire.builder.maxLevel;

const COMMANDS: Record<string, Command> = {
  help: {
    usage: "/help [commande]",
    help: "liste les commandes (ou l'aide d'une commande)",
    run(args) {
      if (args[0]) {
        const c = COMMANDS[args[0].toLowerCase()] ?? ALIASES[args[0].toLowerCase()];
        return c ? `${c.usage} — ${c.help}` : `inconnue : ${args[0]}`;
      }
      return "cmds : " + Object.keys(COMMANDS).sort().map((k) => "/" + k).join(" ");
    },
  },

  add: {
    usage: "/add <self|storage> <ressource> <n>",
    help: "ajoute n d'une ressource au sac (self) ou à l'entrepôt (storage)",
    run(args, ctx) {
      const [target, res, nStr] = args;
      if (target !== "self" && target !== "storage") return "cible : self | storage";
      if (!res) return "ressource manquante";
      const n = num(nStr, NaN);
      if (!Number.isFinite(n)) return "quantité invalide";
      ctx.emit(debugGrant(ctx.self(), target, res, n));
      const tag = RESOURCE_LABELS[res] ? "" : " (ressource inconnue ?)";
      return `${n >= 0 ? "+" : ""}${n} ${res} → ${target}${tag}`;
    },
  },

  give: {
    usage: "/give <ressource> <n>",
    help: "ajoute n d'une ressource au SAC du joueur (raccourci de /add self)",
    run(args, ctx) {
      const [res, nStr] = args;
      if (!res) return "ressource manquante";
      const n = num(nStr, NaN);
      if (!Number.isFinite(n)) return "quantité invalide";
      ctx.emit(debugGrant(ctx.self(), "self", res, n));
      return `${n >= 0 ? "+" : ""}${n} ${res} → sac`;
    },
  },

  set: {
    usage: "/set <self|storage> <ressource> <n>",
    help: "fixe la quantité exacte d'une ressource",
    run(args, ctx) {
      const [target, res, nStr] = args;
      if (target !== "self" && target !== "storage") return "cible : self | storage";
      if (!res) return "ressource manquante";
      const n = num(nStr, NaN);
      if (!Number.isFinite(n)) return "quantité invalide";
      ctx.emit(debugSet(ctx.self(), target, res, n));
      return `${res} = ${Math.max(0, n)} (${target})`;
    },
  },

  clear: {
    usage: "/clear <self|storage>",
    help: "vide le sac ou l'entrepôt",
    run(args, ctx) {
      const target = args[0];
      if (target !== "self" && target !== "storage") return "cible : self | storage";
      ctx.emit(debugClear(ctx.self(), target));
      return `${target} vidé`;
    },
  },

  build: {
    usage: "/build <id> [n]",
    help: "construit gratuitement n exemplaires (ids : " + craftables.map((c) => c.id).join(", ") + ")",
    run(args, ctx) {
      const r = resolveBuilding(args);
      if (!r) return "bâtiment inconnu — voir /build help";
      ctx.emit(debugBuild(r.id, r.count));
      return `build ${r.id} ×${r.count}`;
    },
  },

  unlock: {
    usage: "/unlock",
    help: "débloque tout : cabane réparée + constructrice prête + 1 de chaque bâtiment",
    run(_args, ctx) {
      ctx.emit(debugUnlockAll());
      return "tout débloqué (cabane + métiers)";
    },
  },

  repair: {
    usage: "/repair",
    help: "prépare la constructrice + répare la cabane (débloque l'entrepôt)",
    run(_args, ctx) {
      ctx.emit(debugSetBuilder(BUILDER_MAX));
      ctx.emit(debugGrant(ctx.self(), "self", "wood", config.cabinRepairCost));
      ctx.emit({ type: "REPAIR_CABIN", playerId: ctx.self() });
      return "cabane réparée";
    },
  },

  pop: {
    usage: "/pop <n>",
    help: "ajoute n villageois (n négatif en retire)",
    run(args, ctx) {
      const n = num(args[0], NaN);
      if (!Number.isFinite(n)) return "n invalide";
      ctx.emit(debugAddPop(Math.floor(n)));
      return `${n >= 0 ? "+" : ""}${Math.floor(n)} villageois`;
    },
  },

  assign: {
    usage: "/assign <métier> <n>",
    help: "assigne n ouvriers à un métier (n négatif retire). métiers : " + jobs.filter((j) => j.id !== "gatherer").map((j) => j.id).join(", "),
    run(args, ctx) {
      const key = (args[0] ?? "").toLowerCase();
      const job = jobById[key] ?? jobs.find((j) => j.name.toLowerCase() === key);
      if (!job) return "métier inconnu";
      const n = Math.floor(num(args[1], NaN));
      if (!Number.isFinite(n) || n === 0) return "n invalide";
      for (let i = 0; i < Math.abs(n); i++) ctx.emit(n > 0 ? assignWorker(ctx.self(), job.id) : unassignWorker(ctx.self(), job.id));
      return `${n > 0 ? "+" : ""}${n} ${job.name}`;
    },
  },

  fire: {
    usage: "/fire <0-4>",
    help: "fixe le niveau du feu",
    run(args, ctx) {
      const l = num(args[0], NaN);
      if (!Number.isFinite(l)) return "niveau 0..4";
      ctx.emit(debugSetFire(l));
      return `feu = ${Math.max(0, Math.min(4, Math.floor(l)))}`;
    },
  },

  builder: {
    usage: "/builder <-1..3>",
    help: "fixe l'étape de la constructrice",
    run(args, ctx) {
      const s = num(args[0], NaN);
      if (!Number.isFinite(s)) return "étape -1..3";
      ctx.emit(debugSetBuilder(s));
      return `constructrice = ${Math.floor(s)}`;
    },
  },

  event: {
    usage: "/event <id|list>",
    help: "déclenche un événement M5",
    run(args, ctx) {
      if (!args[0] || args[0] === "list") return "événements : " + events.map((e) => e.id).join(", ");
      ctx.triggerEvent(args[0]);
      return `événement : ${args[0]}`;
    },
  },

  ff: {
    usage: "/ff <secondes>",
    help: "avance la simulation de n secondes (autorité)",
    run(args, ctx) {
      const s = num(args[0], NaN);
      if (!Number.isFinite(s) || s <= 0) return "secondes > 0";
      ctx.fastForward(s);
      return `+${s}s simulés`;
    },
  },

  tp: {
    usage: "/tp <x> <z> | /tp camp | /tp <site>",
    help: "téléporte (coordonnées, camp, ou un type de site : " + sites.map((s) => s.id).join(", ") + ")",
    run(args, ctx) {
      if (args[0] === "camp" || args.length === 0) { ctx.teleport(0, 8); return "→ camp"; }
      // type de site connu ?
      const map = ctx.getWorldMap();
      const site = map.sites.find((s) => s.type === args[0]);
      if (site) {
        const w = map.cellToWorldCenter(site.cx, site.cz);
        ctx.teleport(w.x, w.z);
        return `→ ${args[0]} (${Math.round(w.x)}, ${Math.round(w.z)})`;
      }
      const x = num(args[0], NaN), z = num(args[1], NaN);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return "usage : /tp <x> <z> | camp | <site>";
      ctx.teleport(x, z);
      return `→ (${x}, ${z})`;
    },
  },

  where: {
    usage: "/where",
    help: "position du joueur : coordonnées, cellule, biome, distance au camp",
    run(_args, ctx) {
      const p = ctx.playerPos();
      const map = ctx.getWorldMap();
      const c = map.worldToCell(p.x, p.z);
      const b = biomeById[map.biomeAt(c.cx, c.cz)];
      const dist = Math.round(Math.hypot(p.x, p.z));
      return `(${Math.round(p.x)}, ${Math.round(p.z)}) · cellule (${c.cx}, ${c.cz}) · ${b?.label ?? "?"} · ${dist}u du camp`;
    },
  },

  biome: {
    usage: "/biome",
    help: "biome sous le joueur (+ liste des biomes)",
    run(_args, ctx) {
      const p = ctx.playerPos();
      const map = ctx.getWorldMap();
      const c = map.worldToCell(p.x, p.z);
      const b = biomeById[map.biomeAt(c.cx, c.cz)];
      return `ici : ${b?.label ?? "?"} — biomes : ${biomes.map((x) => x.label).join(", ")}`;
    },
  },

  stand: {
    usage: "/stand",
    help: "essence dominante + pureté du peuplement courant (arbres)",
    run(_args, ctx) {
      const p = ctx.playerPos();
      const map = ctx.getWorldMap();
      const c = map.worldToCell(p.x, p.z);
      const b = biomeById[map.biomeAt(c.cx, c.cz)];
      const prof = standProfile(c.cx, c.cz, b?.key ?? "barren", map.seed);
      return `peuplement (${b?.label ?? "?"}) : dominante ${prof.dominant?.id ?? "—"} · pureté ${prof.purity.toFixed(2)}`;
    },
  },

  sites: {
    usage: "/sites",
    help: "liste les sites du monde et leur distance (en cellules) au camp",
    run(_args, ctx) {
      return ctx.getWorldMap().sites
        .map((s) => `${s.type}@${Math.round(Math.hypot(s.cx, s.cz))}`)
        .join("  ") || "aucun site";
    },
  },

  save: { usage: "/save", help: "sauvegarde immédiate", run(_a, ctx) { ctx.saveNow(); return "sauvegardé"; } },
  clearsave: { usage: "/clearsave", help: "efface la sauvegarde", run(_a, ctx) { ctx.clearSave(); return "sauvegarde effacée"; } },
  reset: { usage: "/reset", help: "efface la sauvegarde et recharge", run(_a, ctx) { ctx.clearSave(); location.reload(); return "reset…"; } },

  fly: {
    usage: "/fly [on|off]",
    help: "vol libre : gravité coupée, Espace monte / Maj descend (bascule par défaut)",
    run(args, ctx) {
      const on = args[0] === "on" ? true : args[0] === "off" ? false : !ctx.isFlying();
      ctx.setFly(on);
      return `vol ${on ? "ON (Espace ↑ / Maj ↓)" : "OFF"}`;
    },
  },
  noclip: {
    usage: "/noclip [on|off]",
    help: "traverse le décor (implique le vol)",
    run(args, ctx) {
      const on = args[0] === "on" ? true : args[0] === "off" ? false : !ctx.isNoclip();
      ctx.setNoclip(on);
      return `noclip ${on ? "ON (vol activé)" : "OFF"}`;
    },
  },
  seed: {
    usage: "/seed <n>",
    help: "régénère tout le monde avec une nouvelle graine (biomes, relief, sites, décor)",
    run(args, ctx) {
      const n = num(args[0], NaN);
      if (!Number.isFinite(n)) return "graine invalide (entier)";
      ctx.reseed(Math.floor(n) >>> 0);
      return `monde régénéré · graine ${Math.floor(n) >>> 0}`;
    },
  },
};

const ALIASES: Record<string, Command> = {
  g: COMMANDS.give,
  tpc: COMMANDS.tp,
  h: COMMANDS.help,
};

/** Exécute une ligne de commande (avec ou sans `/`). Renvoie un message pour le retour visuel. */
export function runCommand(raw: string, ctx: CommandCtx): string {
  const line = raw.trim().replace(/^\//, "");
  if (!line) return "";
  const parts = line.split(/\s+/);
  const name = (parts[0] ?? "").toLowerCase();
  const args = parts.slice(1);
  const cmd = COMMANDS[name] ?? ALIASES[name];
  if (!cmd) return `inconnue : /${name} — tape /help`;
  try {
    return cmd.run(args, ctx);
  } catch (e) {
    return `erreur : ${(e as Error).message}`;
  }
}
