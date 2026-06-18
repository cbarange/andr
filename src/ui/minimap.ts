// ============================================================================
//  MINIMAP UNIFIÉE & CONTEXTUELLE (M11/RF4b) — UN seul widget 2D toujours présent, qui se
//  CONTEXTUALISE automatiquement selon où se trouve le joueur :
//    • CAMP      : au village -> plan rapproché (cabane, feu, bâtiments, vaisseau).
//    • INTÉRIEUR : sous terre / dans le cuirassé -> le DONJON (grotte = graphe ; cuirassé = salles
//                  + portes colorées par état).
//    • MONDE     : en exploration -> camp au centre, sites DÉCOUVERTS (fog), routes, anneaux.
//  Dessin 2D (canvas) — JAMAIS de caméra ortho (perf). 100 % LOCAL : lit le snapshot, n'écrit rien.
//  Fog-of-war PARTAGÉ via `state.visitedCells` (RF4a). Joueur (flèche orientée) + coéquipiers + objectif.
// ============================================================================

import type { GameState } from "../sim/state";
import type { WorldMap } from "../sim/worldgen";
import { dungeonFor, executionerDungeon } from "../sim/dungeon";
import { worldgen, campLayout } from "../../data/world";

const CELL = worldgen.cellSize;
const SAFE_R = worldgen.safeRadiusCells * CELL; // rayon de la zone sûre (camp) en u
const CHUNK = worldgen.chunkCells * CELL; // taille d'un chunk de fog (u)
const WORLD_R = worldgen.radiusCells * CELL; // demi-étendue du monde jouable (u)

/** Contexte fourni chaque frame par main.ts (tout pré-calculé -> le widget reste « bête »). */
export interface MinimapCtx {
  state: GameState;
  self: string;
  px: number; pz: number; yaw: number; // position-monde du joueur + cap caméra (rad)
  worldMap: WorldMap;
  /** Intérieur actif (grotte/mine/cuirassé) ou null. `yaw` = rotation du repère local du donjon. */
  interior: { type: string; cx: number; cz: number; yaw: number } | null;
  peers: Array<{ id: string; x: number; z: number; dead?: boolean }>;
}

type Layer = "camp" | "interior" | "world";

const C = {
  bg: "rgba(14,17,19,0.82)", frame: "rgba(120,140,150,0.5)", grid: "rgba(120,140,150,0.16)",
  ink: "#9fb0b8", inkDim: "rgba(159,176,184,0.45)", self: "#e8f0f2", obj: "#ffd78a",
  road: "rgba(200,180,120,0.55)", site: "#7fa0ad", siteDone: "#8fd0a0",
  doorOpen: "#52e676", doorLocked: "#f4422f", doorSealed: "#5288f6", peer: "#6cc7e0",
};

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx2d: CanvasRenderingContext2D;
  private full = false;
  private layer: Layer = "world";
  private fade = 1; // transition douce au changement de layer (0 -> 1)

  constructor() {
    const c = document.createElement("canvas");
    c.width = 360; c.height = 360; // résolution interne (retina-friendly via CSS scale)
    this.applyStyle(c, false);
    document.body.appendChild(c);
    this.canvas = c;
    this.ctx2d = c.getContext("2d")!;
  }

  private applyStyle(c: HTMLCanvasElement, full: boolean): void {
    if (full) {
      c.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(72vmin,640px);height:min(72vmin,640px);"
        + "z-index:40;border-radius:10px;box-shadow:0 8px 40px rgba(0,0,0,0.6);pointer-events:none";
    } else {
      c.style.cssText = "position:fixed;right:18px;top:18px;width:180px;height:180px;z-index:18;"
        + "border-radius:8px;opacity:0.94;pointer-events:none";
    }
  }

  toggleFullscreen(): void {
    this.full = !this.full;
    this.applyStyle(this.canvas, this.full);
  }

  isFullscreen(): boolean {
    return this.full;
  }

  // --------------------------------------------------------------------------

  update(ctx: MinimapCtx): void {
    const next: Layer = ctx.interior ? "interior" : (Math.hypot(ctx.px, ctx.pz) <= SAFE_R ? "camp" : "world");
    if (next !== this.layer) { this.layer = next; this.fade = 0; } // transition douce
    this.fade = Math.min(1, this.fade + 0.08);

    const g = this.ctx2d, S = this.canvas.width;
    g.clearRect(0, 0, S, S);
    // Cadre + fond.
    g.fillStyle = C.bg; this.roundRect(g, 1, 1, S - 2, S - 2, 10); g.fill();
    g.globalAlpha = 0.35 + 0.65 * this.fade; // fondu d'entrée du layer

    if (this.layer === "camp") this.drawCamp(ctx);
    else if (this.layer === "interior") this.drawInterior(ctx);
    else this.drawWorld(ctx);

    g.globalAlpha = 1;
    g.strokeStyle = C.frame; g.lineWidth = 2; this.roundRect(g, 1, 1, S - 2, S - 2, 10); g.stroke();
    // Étiquette de contexte.
    g.fillStyle = C.inkDim; g.font = "11px monospace"; g.textAlign = "left";
    g.fillText(this.layer === "camp" ? "CAMP" : this.layer === "interior" ? "INTÉRIEUR" : "MONDE", 10, 18);
    g.textAlign = "right"; g.fillText("M", S - 10, 18);
  }

  // ---- Layers ----

  /** Plan rapproché du village : feu (0,0), cabane, bâtiments construits, ancre vaisseau. */
  private drawCamp(ctx: MinimapCtx): void {
    const S = this.canvas.width, span = 90; // u visibles (de part et d'autre du feu)
    const map = (wx: number, wz: number): [number, number] => [S / 2 + (wx / span) * (S / 2 - 16), S / 2 + (wz / span) * (S / 2 - 16)];
    const g = this.ctx2d;
    this.gridRings(g, [SAFE_R], (r) => (r / span) * (S / 2 - 16));
    // Feu (centre).
    const [fx, fy] = map(0, 0);
    g.fillStyle = C.obj; this.dot(g, fx, fy, 4);
    // Cabane.
    const [cx, cy] = map(campLayout.cabin.x, campLayout.cabin.z);
    g.fillStyle = C.ink; g.fillRect(cx - 4, cy - 4, 8, 8);
    // Bâtiments CONSTRUITS (compte par type -> on prend les N premières ancres du type).
    g.fillStyle = C.inkDim;
    for (const id of Object.keys(ctx.state.buildings ?? {})) {
      const n = ctx.state.buildings[id] ?? 0;
      const anchors = campLayout.buildings[id] ?? [];
      for (let i = 0; i < Math.min(n, anchors.length); i++) { const [bx, by] = map(anchors[i].x, anchors[i].z); this.dot(g, bx, by, 2.4); }
    }
    // Ancre du vaisseau (RF1) si trouvé.
    if (ctx.state.perks["ship_found"]) { const [sx, sy] = map(24, 0); g.fillStyle = C.obj; g.strokeStyle = C.obj; this.diamond(g, sx, sy, 5); }
    this.drawSelf(ctx, map);
    this.drawPeers(ctx, map);
  }

  /** Donjon : grotte/mine = graphe de nœuds+tunnels ; cuirassé = salles + portes (état). */
  private drawInterior(ctx: MinimapCtx): void {
    const it = ctx.interior!;
    const S = this.canvas.width;
    const center = ctx.worldMap.cellToWorldCenter(it.cx, it.cz);
    const cos = Math.cos(it.yaw), sin = Math.sin(it.yaw);
    // monde -> LOCAL du donjon (inverse de la rotation de rendu).
    const toLocal = (wx: number, wz: number): [number, number] => { const dx = wx - center.x, dz = wz - center.z; return [dx * cos - dz * sin, dx * sin + dz * cos]; };
    const g = this.ctx2d;

    if (it.type === "executioner") {
      const dungeon = executionerDungeon(it.cx, it.cz, ctx.worldMap.seed);
      const span = 64; // u
      const map = (lx: number, lz: number): [number, number] => [S / 2 + (lx / span) * (S / 2 - 18), S / 2 + (lz / span) * (S / 2 - 18)];
      const prog = ctx.state.sites?.[it.cx + "," + it.cz];
      const rooms = prog?.rooms ?? {};
      const wings = prog?.wings ?? {};
      const bridgeReady = !!(wings.engineering && wings.martial && wings.medical);
      const byId: Record<string, (typeof dungeon.rooms)[number]> = {};
      for (const r of dungeon.rooms) byId[r.id] = r;
      // Portes (sas) colorées par état.
      g.lineWidth = 3;
      for (const d of dungeon.doors) {
        const a = byId[d.from], b = byId[d.to]; if (!a || !b) continue;
        const locked = rooms[d.from] === "locked" || rooms[d.to] === "locked";
        const sealed = (d.from === "bridge" || d.to === "bridge") && !bridgeReady;
        g.strokeStyle = sealed ? C.doorSealed : locked ? C.doorLocked : C.doorOpen;
        const [ax, ay] = map(a.pos.x, a.pos.z), [bx, by] = map(b.pos.x, b.pos.z);
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      }
      // Salles.
      for (const r of dungeon.rooms) {
        const [x, y] = map(r.pos.x, r.pos.z);
        const w = (r.size.w / span) * (S / 2 - 18), h = (r.size.d / span) * (S / 2 - 18);
        const st = rooms[r.id];
        g.fillStyle = st === "cleared" ? "rgba(143,208,160,0.25)" : st === "locked" ? "rgba(244,66,47,0.25)" : "rgba(159,176,184,0.12)";
        g.strokeStyle = r.isBridge ? C.obj : C.inkDim; g.lineWidth = r.isBridge ? 2 : 1;
        g.fillRect(x - w / 2, y - h / 2, w, h); g.strokeRect(x - w / 2, y - h / 2, w, h);
      }
      const mapW = (wx: number, wz: number): [number, number] => map(...toLocal(wx, wz));
      this.drawSelf(ctx, mapW);
      this.drawPeers(ctx, mapW);
    } else {
      // GROTTE / MINE : graphe dungeonFor (nœuds + segments).
      const dungeon = dungeonFor(it.type, it.cx, it.cz, ctx.worldMap.seed);
      const span = 36;
      const map = (lx: number, lz: number): [number, number] => [S / 2 + (lx / span) * (S / 2 - 18), S / 2 + (lz / span) * (S / 2 - 18)];
      const byId: Record<string, { pos: { x: number; z: number } }> = {};
      for (const n of dungeon.nodes) byId[n.id] = n;
      g.strokeStyle = C.inkDim; g.lineWidth = 3;
      for (const seg of dungeon.segments) { const a = byId[seg.from], b = byId[seg.to]; if (!a || !b) continue; const [ax, ay] = map(a.pos.x, a.pos.z), [bx, by] = map(b.pos.x, b.pos.z); g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); }
      const taken = ctx.state.sites?.[it.cx + "," + it.cz]?.taken ?? {};
      for (const n of dungeon.nodes) {
        const [x, y] = map(n.pos.x, n.pos.z);
        const hasLoot = Object.keys(n.loot).length > 0;
        g.fillStyle = n.id === "entry" ? C.ink : hasLoot ? (taken[n.id] ? C.inkDim : C.obj) : C.site;
        this.dot(g, x, y, n.id === "entry" ? 3.5 : hasLoot ? 4 : 2.5);
      }
      const mapW = (wx: number, wz: number): [number, number] => map(...toLocal(wx, wz));
      this.drawSelf(ctx, mapW);
      this.drawPeers(ctx, mapW);
    }
  }

  /** Vue MONDE : camp au centre, fog (chunks vus), sites découverts, routes, anneaux de distance. */
  private drawWorld(ctx: MinimapCtx): void {
    const S = this.canvas.width, span = WORLD_R + 60;
    const map = (wx: number, wz: number): [number, number] => [S / 2 + (wx / span) * (S / 2 - 12), S / 2 + (wz / span) * (S / 2 - 12)];
    const g = this.ctx2d;
    // Fog : chunks révélés (premier-vu partagé).
    g.fillStyle = "rgba(159,176,184,0.07)";
    const cs = (CHUNK / span) * (S / 2 - 12);
    for (const key of Object.keys(ctx.state.visitedCells ?? {})) {
      const ci = key.indexOf(","); if (ci < 0) continue;
      const chx = Number(key.slice(0, ci)), chz = Number(key.slice(ci + 1));
      const [x, y] = map((chx + 0.5) * CHUNK, (chz + 0.5) * CHUNK); // centre de la cellule de chunk
      g.fillRect(x - cs / 2, y - cs / 2, cs, cs);
    }
    // Anneaux de distance (×2 ADR : 16/38 cellules).
    this.gridRings(g, [16 * CELL, 38 * CELL, WORLD_R], (r) => (r / span) * (S / 2 - 12));
    // Routes.
    g.fillStyle = C.road;
    for (const key of Object.keys(ctx.state.roads ?? {})) {
      const ci = key.indexOf(","); if (ci < 0) continue;
      const w = ctx.worldMap.cellToWorldCenter(Number(key.slice(0, ci)), Number(key.slice(ci + 1)));
      const [x, y] = map(w.x, w.z); g.fillRect(x - 1, y - 1, 2.5, 2.5);
    }
    // Sites DÉCOUVERTS (par interaction ou fog).
    for (const s of ctx.worldMap.sites) {
      const prog = ctx.state.sites?.[s.cx + "," + s.cz];
      const chunkKey = Math.floor((s.cx * CELL) / CHUNK) + "," + Math.floor((s.cz * CELL) / CHUNK);
      const known = prog?.discovered || ctx.state.visitedCells?.[chunkKey];
      if (!known) continue;
      const w = ctx.worldMap.cellToWorldCenter(s.cx, s.cz);
      const [x, y] = map(w.x, w.z);
      g.fillStyle = prog?.cleared || prog?.secured ? C.siteDone : s.type === "executioner" ? C.doorLocked : C.site;
      if (s.type === "executioner" || s.type === "ship") { g.strokeStyle = C.obj; this.diamond(g, x, y, 4); }
      else this.dot(g, x, y, 2.6);
    }
    // Feu (camp) au centre.
    g.fillStyle = C.obj; this.dot(g, S / 2, S / 2, 3);
    this.drawSelf(ctx, map);
    this.drawPeers(ctx, map);
    this.drawObjective(ctx, map);
  }

  // ---- Briques ----

  /** Flèche du joueur (orientée selon le cap caméra). Edge-clampée si hors-cadre. */
  private drawSelf(ctx: MinimapCtx, map: (wx: number, wz: number) => [number, number]): void {
    const g = this.ctx2d, S = this.canvas.width;
    let [x, y] = map(ctx.px, ctx.pz);
    x = Math.max(8, Math.min(S - 8, x)); y = Math.max(8, Math.min(S - 8, y));
    g.save(); g.translate(x, y); g.rotate(ctx.yaw);
    g.fillStyle = C.self; g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 6); g.lineTo(0, 3); g.lineTo(-5, 6); g.closePath(); g.fill();
    g.restore();
  }

  private drawPeers(ctx: MinimapCtx, map: (wx: number, wz: number) => [number, number]): void {
    const g = this.ctx2d, S = this.canvas.width;
    for (const p of ctx.peers) {
      let [x, y] = map(p.x, p.z); x = Math.max(6, Math.min(S - 6, x)); y = Math.max(6, Math.min(S - 6, y));
      g.fillStyle = p.dead ? C.doorLocked : "#6cc7e0"; this.dot(g, x, y, 3);
    }
  }

  /** Chevron vers l'objectif courant : AVANT découverte -> l'ÉPAVE ; APRÈS -> le VAISSEAU AU CAMP
   *  (qu'on doit rejoindre pour réparer/décoller). Clampé au bord si hors-cadre (edge-pointer). */
  private drawObjective(ctx: MinimapCtx, map: (wx: number, wz: number) => [number, number]): void {
    let target: { x: number; z: number } | null = null;
    if (!ctx.state.perks["ship_found"]) {
      const wreck = ctx.worldMap.sites.find((s) => s.type === "ship");
      if (wreck) target = ctx.worldMap.cellToWorldCenter(wreck.cx, wreck.cz);
    } else if (!ctx.state.flight) {
      target = { x: 24, z: 0 }; // ancre du vaisseau AU CAMP (SHIP_CAMP) — aller le réparer / décoller
    }
    if (!target) return;
    const g = this.ctx2d, S = this.canvas.width;
    let [x, y] = map(target.x, target.z);
    x = Math.max(10, Math.min(S - 10, x)); y = Math.max(10, Math.min(S - 10, y));
    g.fillStyle = C.obj; this.diamond(g, x, y, 5);
  }

  // ---- Helpers de dessin ----

  private gridRings(g: CanvasRenderingContext2D, radiiU: number[], toPx: (r: number) => number): void {
    const S = this.canvas.width;
    g.strokeStyle = C.grid; g.lineWidth = 1;
    for (const r of radiiU) { const rp = toPx(r); g.beginPath(); g.arc(S / 2, S / 2, rp, 0, Math.PI * 2); g.stroke(); }
  }
  private dot(g: CanvasRenderingContext2D, x: number, y: number, r: number): void { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  private diamond(g: CanvasRenderingContext2D, x: number, y: number, r: number): void { g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fill(); }
  private roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  dispose(): void {
    this.canvas.remove();
  }
}
