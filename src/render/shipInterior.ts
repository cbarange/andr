// ============================================================================
//  INTÉRIEUR DU CUIRASSÉ (M11/RF2b) — le grand vaisseau alien rendu comme un DONJON DE SALLES
//  explorable (≠ l'anneau+couloirs des grottes : ici des salles rectangulaires reliées par des
//  SAS). Volume MESH autonome posé sur le terrain (même principe qu'`interior.ts` : on ne troue pas
//  le heightmap). Disposition = `executionerDungeon` (sim, PUR) -> identique chez tous les pairs.
//
//  Portes TÉLÉGRAPHIÉES (lecture LOCALE de `state.sites[key].rooms/wings`, jamais d'écriture) :
//   • VERT = sas franchissable (salle adjacente nettoyée / antichambre) ;
//   • ROUGE = arène en cours (salle « locked » — visuel ; côté sim c'est `noFlee` qui tient le combat) ;
//   • BLEU = pont SCELLÉ tant que les 3 ailes ne sont pas faites (collider physique -> vrai gate).
//
//  Obscurité = LOCALE & cosmétique (baisse `hemi`/`sun` quand le joueur local est sous le plafond),
//  comme `interior.ts` -> aucune désync. Culling par salle (setEnabled) -> budget maîtrisé.
// ============================================================================

import { Scene, Mesh, MeshBuilder, TransformNode, Vector3, PhysicsAggregate, PhysicsShapeType, type Light } from "@babylonjs/core";
import { terrainHeight } from "../../data/world";
import { makeKit, P, type Kit } from "./lowpoly";
import { executionerDungeon, type DungeonRoom, type RoomId } from "../sim/dungeon";
import type { WorldMap } from "../sim/worldgen";
import type { GameState } from "../sim/state";

const BUILD_R = 64; // bâtit quand le joueur s'approche du cuirassé (grand : couvre tout le donjon)
const FREE_R = 96; // libère au-delà (hystérésis)
const CULL_M = 13; // marge de culling : salle courante + salles adjacentes visibles

const FT = 0.3; // y local de la SURFACE du sol
const SINK = 0.22; // enfoncement (ressaut de seuil franchissable)
const WALL_H = 4.2; // hauteur des parois (plus haut que les grottes : vaisseau)
const WALL_TH = 0.5; // épaisseur des parois (colliders)
const DOOR_W = 4.4; // largeur du sas (capsule r=0.34 très à l'aise)
const DOOR_H = 3.6; // hauteur de l'ouverture

const GREEN = [0.32, 0.92, 0.46], RED = [0.96, 0.26, 0.2], BLUE = [0.32, 0.52, 0.96];

type Side = "px" | "nx" | "pz" | "nz";
function sideBetween(a: { x: number; z: number }, b: { x: number; z: number }): Side {
  const dx = b.x - a.x, dz = b.z - a.z;
  if (Math.abs(dx) >= Math.abs(dz)) return dx > 0 ? "px" : "nx";
  return dz > 0 ? "pz" : "nz";
}
function opp(s: Side): Side {
  return s === "px" ? "nx" : s === "nx" ? "px" : s === "pz" ? "nz" : "pz";
}

interface DoorVis {
  from: RoomId; to: RoomId | "outside";
  leaves: TransformNode; // 2 vantaux (glissent) — pivot à l'ouverture
  bars: Record<"green" | "red" | "blue", TransformNode>; // bandeaux émissifs (un seul allumé)
  alongZ: boolean; // orientation du sas
  collider: Mesh; // collider du vantail (actif seulement quand BLEU/scellé)
  colliderOn: boolean;
  t: number; // 0 fermé .. 1 ouvert (lissé)
}
interface RoomVis { id: RoomId; node: TransformNode; room: DungeonRoom; }
interface Built {
  root: TransformNode;
  colliders: Mesh[];
  rooms: RoomVis[];
  doors: DoorVis[];
  center: Vector3; // centre-monde du site (antichambre)
  yaw: number; cos: number; sin: number; wx: number; wz: number;
  site: { cx: number; cz: number };
  insideR: number;
}

/** Cible « entrer dans la salle » exposée à `main.ts` (focus E -> ENTER_ROOM). */
export interface EnterTarget {
  cx: number; cz: number; room: RoomId; verb: string;
  world: Vector3; sealed: boolean; // sealed = pont gaté (verbe grisé)
}

export class ShipInterior {
  private readonly scene: Scene;
  private readonly K: Kit;
  private map: WorldMap | null = null;
  private built: Built | null = null;
  private readonly hemi: Light | null;
  private readonly sun: Light | null;
  private readonly hemiBase: number;
  private readonly sunBase: number;
  private dark = 0;
  private inside = false;
  private curRoom: RoomId | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
    this.K = makeKit(scene);
    this.hemi = scene.getLightByName("hemi");
    this.sun = scene.getLightByName("sun");
    this.hemiBase = this.hemi?.intensity ?? 0.4;
    this.sunBase = this.sun?.intensity ?? 0.9;
  }

  setMap(map: WorldMap): void {
    if (this.built) this.dispose();
    this.map = map;
  }

  /** Le joueur LOCAL est-il dans le cuirassé (FPV + obscurité). */
  isLocalPlayerInside(): boolean {
    return this.inside;
  }

  /** Clé "cx,cz" du cuirassé dont l'intérieur est bâti (pour masquer son modèle décoratif externe). */
  activeSiteKey(): string | null {
    return this.built ? this.built.site.cx + "," + this.built.site.cz : null;
  }

  get stats(): { built: boolean; inside: boolean; room: string | null; colliders: number; dark: number } {
    return { built: !!this.built, inside: this.inside, room: this.curRoom, colliders: this.built?.colliders.length ?? 0, dark: Math.round(this.dark * 100) / 100 };
  }

  /** Position-monde locale -> repère intérieur (inverse de la rotation `yaw`). */
  private toLocal(b: Built, px: number, pz: number): { lx: number; lz: number } {
    const dx = px - b.wx, dz = pz - b.wz;
    return { lx: dx * b.cos - dz * b.sin, lz: dx * b.sin + dz * b.cos };
  }

  /** Salle contenant un point local (marge incluse), ou null. */
  private roomAt(b: Built, lx: number, lz: number, margin = 0): RoomId | null {
    for (const rv of b.rooms) {
      const r = rv.room;
      if (Math.abs(lx - r.pos.x) <= r.size.w / 2 + margin && Math.abs(lz - r.pos.z) <= r.size.d / 2 + margin) return rv.id;
    }
    return null;
  }

  /**
   * Cibles « entrer » à proposer au focus (E). Antichambre = « pénétrer dans le cuirassé » (depuis
   * dehors). Ailes/pont = « entrer dans … » depuis l'antichambre/une salle adjacente NETTOYÉE. Une
   * salle déjà locked/cleared n'est plus proposée. Le pont gaté est proposé « scellé » (verbe grisé).
   */
  enterTargets(playerPos: Vector3, state: GameState): EnterTarget[] {
    const b = this.built;
    if (!b) return [];
    const key = b.site.cx + "," + b.site.cz;
    const prog = state.sites?.[key];
    if (prog?.cleared) return []; // cuirassé fini
    const rooms = prog?.rooms ?? {};
    const wings = prog?.wings ?? {};
    const bridgeReady = !!(wings.engineering && wings.martial && wings.medical);
    const dungeon = executionerDungeon(b.site.cx, b.site.cz, this.map!.seed);
    const { lx, lz } = this.toLocal(b, playerPos.x, playerPos.z);
    const here = this.roomAt(b, lx, lz, 2);
    const out: EnterTarget[] = [];
    for (const room of dungeon.rooms) {
      if (rooms[room.id]) continue; // déjà locked/cleared
      const wc = new Vector3(this.worldXOf(b, room.pos.x, room.pos.z), terrainHeight(b.wx, b.wz) + 1.8, this.worldZOf(b, room.pos.x, room.pos.z));
      if (room.isHub) {
        // Pénétrer depuis DEHORS (le joueur n'est encore dans aucune salle).
        if (here === null) out.push({ cx: b.site.cx, cz: b.site.cz, room: room.id, verb: "pénétrer dans le cuirassé", world: wc, sealed: false });
        continue;
      }
      // Aile/pont : proposable si le joueur est dans une salle ADJACENTE par une porte.
      const adj = dungeon.doors.some((d) => (d.from === room.id && d.to === here) || (d.to === room.id && d.from === here));
      if (!adj) continue;
      const sealed = !!room.isBridge && !bridgeReady;
      const label = room.isBridge ? "prendre le pont" : `entrer — ${roomLabel(room.id)}`;
      out.push({ cx: b.site.cx, cz: b.site.cz, room: room.id, verb: sealed ? "pont scellé (3 ailes requises)" : label, world: wc, sealed });
    }
    return out;
  }

  private worldXOf(b: Built, lx: number, lz: number): number { return b.wx + lx * b.cos + lz * b.sin; }
  private worldZOf(b: Built, lx: number, lz: number): number { return b.wz - lx * b.sin + lz * b.cos; }

  /** Chaque frame : build/free, culling par salle, télégraphie des portes, obscurité locale. */
  update(playerPos: Vector3, dtSec: number, state: GameState): void {
    if (this.map) {
      let near: { cx: number; cz: number; x: number; z: number } | null = null;
      let nearD = Infinity;
      for (const s of this.map.sites) {
        if (s.type !== "executioner") continue;
        const w = this.map.cellToWorldCenter(s.cx, s.cz);
        const d = Math.hypot(w.x - playerPos.x, w.z - playerPos.z);
        if (d < nearD) { nearD = d; near = { cx: s.cx, cz: s.cz, x: w.x, z: w.z }; }
      }
      const key = near ? near.cx + "," + near.cz : null;
      const cleared = key ? state.sites?.[key]?.cleared : false;
      if (near && key && nearD <= BUILD_R && !this.built && !cleared) this.build(near);
      if (this.built) {
        const d = Math.hypot(this.built.center.x - playerPos.x, this.built.center.z - playerPos.z);
        const stillCleared = state.sites?.[this.built.site.cx + "," + this.built.site.cz]?.cleared;
        if (d > FREE_R || stillCleared) this.dispose();
      }
    }

    const b = this.built;
    if (!b) { this.inside = false; this.curRoom = null; this.fade(0, dtSec); return; }

    const { lx, lz } = this.toLocal(b, playerPos.x, playerPos.z);
    this.curRoom = this.roomAt(b, lx, lz, 1.5);
    this.inside = this.roomAt(b, lx, lz, 1.0) !== null;

    // Culling par salle : la salle courante + ses voisines (marge).
    for (const rv of b.rooms) {
      const r = rv.room;
      const visible = Math.abs(lx - r.pos.x) <= r.size.w / 2 + CULL_M && Math.abs(lz - r.pos.z) <= r.size.d / 2 + CULL_M;
      if (rv.node.isEnabled() !== visible) rv.node.setEnabled(visible);
    }

    // Télégraphie + animation des portes (lecture pure de l'état sim).
    const key = b.site.cx + "," + b.site.cz;
    const prog = state.sites?.[key];
    const rooms = prog?.rooms ?? {};
    const wings = prog?.wings ?? {};
    const bridgeReady = !!(wings.engineering && wings.martial && wings.medical);
    for (const door of b.doors) {
      let color: "green" | "red" | "blue" = "green";
      if ((door.to === "bridge" || door.from === "bridge") && !bridgeReady) color = "blue";
      else if (rooms[door.from as RoomId] === "locked" || (door.to !== "outside" && rooms[door.to] === "locked")) color = "red";
      for (const c of ["green", "red", "blue"] as const) if (door.bars[c].isEnabled() !== (c === color)) door.bars[c].setEnabled(c === color);
      // Ouvert sauf BLEU (pont scellé). Le rouge reste OUVERT (l'arène tient par `noFlee`, pas par un mur).
      const open = color !== "blue";
      door.t += ((open ? 1 : 0) - door.t) * Math.min(1, dtSec * 6);
      const slide = (DOOR_W / 2) * door.t;
      door.leaves.getChildTransformNodes(true).forEach((leaf, i) => {
        const s = i === 0 ? -1 : 1;
        if (door.alongZ) leaf.position.z = s * (DOOR_W / 4 + slide);
        else leaf.position.x = s * (DOOR_W / 4 + slide);
      });
      // Collider du vantail : seulement quand BLEU (vrai gate du pont).
      const wantColl = color === "blue";
      if (wantColl !== door.colliderOn) {
        if (wantColl) new PhysicsAggregate(door.collider, PhysicsShapeType.BOX, { mass: 0 }, this.scene);
        else door.collider.physicsBody?.dispose();
        door.colliderOn = wantColl;
      }
    }

    // Obscurité LOCALE (fond jamais aveugle ; les accents émissifs + portes luisent).
    this.fade(this.inside ? 1 : 0, dtSec);
  }

  private fade(target: number, dtSec: number): void {
    this.dark += (target - this.dark) * Math.min(1, dtSec * 4);
    if (this.dark < 1e-3) this.dark = 0;
    // Le cuirassé est ALIMENTÉ : intérieur tamisé (pas une grotte aveugle) -> on garde davantage de
    // fond + les nombreux accents émissifs (nervures/bandeaux/portes) portent la lecture.
    if (this.hemi) this.hemi.intensity = this.hemiBase * (1 - 0.45 * this.dark);
    if (this.sun) this.sun.intensity = this.sunBase * (1 - 0.55 * this.dark);
  }

  // ========================================================================
  //  Construction
  // ========================================================================

  private build(site: { cx: number; cz: number; x: number; z: number }): void {
    const K = this.K, scene = this.scene;
    const wx = site.x, wz = site.z, gy = terrainHeight(wx, wz), rootY = gy - SINK;
    // AXIS-ALIGNED (yaw=0) — IMPÉRATIF : la sim spawn les ennemis à `siteCenter + room.pos` (PAS de
    // rotation, cf. reducer.roomWorldCenter). Le rendu DOIT utiliser le même repère, sinon les aliens
    // tombent hors des salles rendues. L'entrée n'est pas « orientée » (focus de proximité), donc aucune
    // perte d'ergonomie. (Une orientation vers le camp exigerait de tourner AUSSI la sim — non requis.)
    const yaw = 0, cos = 1, sin = 0;
    const worldX = (lx: number, lz: number): number => wx + lx * cos + lz * sin;
    const worldZ = (lx: number, lz: number): number => wz - lx * sin + lz * cos;

    const root = K.node(null);
    root.position.copyFromFloats(wx, rootY, wz);
    root.rotation.y = yaw;

    const colliders: Mesh[] = [];
    const collBox = (w: number, d: number, h: number, lx: number, lz: number, topLocalY: number): void => {
      const col = MeshBuilder.CreateBox("shipColl", { width: w, height: h, depth: d }, scene);
      col.isVisible = false;
      col.position.set(worldX(lx, lz), rootY + topLocalY - h / 2, worldZ(lx, lz));
      col.rotation.y = yaw;
      new PhysicsAggregate(col, PhysicsShapeType.BOX, { mass: 0 }, scene);
      colliders.push(col);
    };

    const dungeon = executionerDungeon(site.cx, site.cz, this.map!.seed);
    const roomById: Record<string, DungeonRoom> = {};
    for (const r of dungeon.rooms) roomById[r.id] = r;

    // Sides porteurs d'une porte, par salle (pour ne PAS y bâtir de paroi pleine).
    const doorSides: Record<string, Set<Side>> = {};
    for (const r of dungeon.rooms) doorSides[r.id] = new Set();
    for (const d of dungeon.doors) {
      doorSides[d.from].add(sideBetween(roomById[d.from].pos, roomById[d.to].pos));
      doorSides[d.to].add(sideBetween(roomById[d.to].pos, roomById[d.from].pos));
    }
    doorSides["antechamber"].add("nz"); // entrée (face camp) — pas de voisin, sas ouvert

    const hull = [0.15, 0.17, 0.2], hullDk = [0.1, 0.11, 0.13], deck = [0.13, 0.14, 0.17];

    // --- SALLES (sol/plafond/parois pleines hors portes + déco), culling par salle. ---
    const rooms: RoomVis[] = [];
    for (const r of dungeon.rooms) {
      const node = K.node(root);
      const hw = r.size.w / 2, hd = r.size.d / 2, cx = r.pos.x, cz = r.pos.z;
      // sol + plafond (visibles + colliders)
      K.box(node, deck, [r.size.w, 0.2, r.size.d], [cx, FT - 0.1, cz]);
      collBox(r.size.w, r.size.d, 0.6, cx, cz, FT);
      K.box(node, hullDk, [r.size.w, 0.3, r.size.d], [cx, FT + WALL_H, cz]);
      collBox(r.size.w, r.size.d, 0.4, cx, cz, FT + WALL_H + 0.3);
      // 4 parois : pleine si pas de porte sur ce côté, sinon 2 segments encadrant le sas.
      const sides: Array<{ s: Side; alongZ: boolean; ox: number; oz: number; len: number }> = [
        { s: "px", alongZ: true, ox: hw, oz: 0, len: r.size.d },
        { s: "nx", alongZ: true, ox: -hw, oz: 0, len: r.size.d },
        { s: "pz", alongZ: false, ox: 0, oz: hd, len: r.size.w },
        { s: "nz", alongZ: false, ox: 0, oz: -hd, len: r.size.w },
      ];
      for (const side of sides) {
        const has = doorSides[r.id].has(side.s);
        const segs: Array<{ off: number; l: number }> = has
          ? [{ off: -(side.len + DOOR_W) / 4, l: (side.len - DOOR_W) / 2 }, { off: (side.len + DOOR_W) / 4, l: (side.len - DOOR_W) / 2 }]
          : [{ off: 0, l: side.len }];
        for (const seg of segs) {
          if (seg.l <= 0.01) continue;
          const lx = cx + side.ox + (side.alongZ ? 0 : seg.off);
          const lz = cz + side.oz + (side.alongZ ? seg.off : 0);
          const w = side.alongZ ? WALL_TH : seg.l, d = side.alongZ ? seg.l : WALL_TH;
          K.box(node, hull, [w, WALL_H, d], [lx, FT + WALL_H / 2, lz]);
          collBox(w, d, WALL_H, lx, lz, FT + WALL_H);
          // linteau au-dessus du sas (ferme le haut de l'ouverture)
          if (has && seg === segs[segs.length - 1]) {
            const dlx = cx + side.ox, dlz = cz + side.oz;
            K.box(node, hullDk, [side.alongZ ? WALL_TH : DOOR_W, WALL_H - DOOR_H, side.alongZ ? DOOR_W : WALL_TH], [dlx, FT + DOOR_H + (WALL_H - DOOR_H) / 2, dlz]);
          }
        }
      }
      // Déco / ÉCLAIRAGE alien : nervures murales émissives aux 4 coins + 2 bandeaux de plafond
      // croisés + 2 rubans lumineux au sol (balisage) -> le vaisseau « luit » de l'intérieur.
      for (const cnx of [-1, 1]) for (const cnz of [-1, 1]) {
        K.box(node, P.alienGlow, [0.1, WALL_H - 1.0, 0.1], [cx + cnx * (hw - 0.3), FT + WALL_H / 2, cz + cnz * (hd - 0.3)], { emi: 1.1, unlit: true });
      }
      K.box(node, P.alienGlow, [r.size.w * 0.62, 0.14, 0.14], [cx, FT + WALL_H - 0.22, cz], { emi: 1.0, unlit: true });
      K.box(node, P.alienGlow, [0.14, 0.14, r.size.d * 0.62], [cx, FT + WALL_H - 0.22, cz], { emi: 1.0, unlit: true });
      for (const sx of [-1, 1]) K.box(node, P.alienHot, [0.16, 0.05, r.size.d * 0.7], [cx + sx * hw * 0.45, FT + 0.04, cz], { emi: 0.8, unlit: true }); // rubans au sol
      if (r.isBridge) { // pont : grande baie émissive (poste de pilotage)
        K.box(node, P.alienGlow, [r.size.w * 0.7, 1.4, 0.12], [cx, FT + 1.8, cz + hd - 0.4], { emi: 1.2, unlit: true });
        K.box(node, hull, [3.4, 1.0, 1.4], [cx, FT + 0.5, cz + hd - 1.8]); // console
        K.box(node, P.alienHot, [3.0, 0.1, 1.0], [cx, FT + 1.05, cz + hd - 1.8], { emi: 1.0, unlit: true }); // pupitre lumineux
      }
      rooms.push({ id: r.id, node, room: r });
    }

    // --- PORTES (sur root, toujours rendues — peu nombreuses). ---
    const doors: DoorVis[] = [];
    const mkDoor = (from: RoomId, to: RoomId | "outside", atRoom: DungeonRoom, side: Side): void => {
      const alongZ = side === "px" || side === "nx";
      const hw = atRoom.size.w / 2, hd = atRoom.size.d / 2;
      const dlx = atRoom.pos.x + (side === "px" ? hw : side === "nx" ? -hw : 0);
      const dlz = atRoom.pos.z + (side === "pz" ? hd : side === "nz" ? -hd : 0);
      const frame = K.node(root, [dlx, FT, dlz]);
      // 2 vantaux (glissent), métal sombre.
      const leaves = this.K.node(frame, [0, 0, 0]);
      for (const sgn of [-1, 1]) {
        const leaf = this.K.node(leaves, alongZ ? [0, 0, sgn * (DOOR_W / 4)] : [sgn * (DOOR_W / 4), 0, 0]);
        K.box(leaf, [0.18, 0.2, 0.24], alongZ ? [0.3, DOOR_H, DOOR_W / 2] : [DOOR_W / 2, DOOR_H, 0.3], [0, DOOR_H / 2, 0]);
      }
      // bandeaux émissifs (un seul allumé) au-dessus du sas.
      const bars = {} as DoorVis["bars"];
      for (const [c, col] of [["green", GREEN], ["red", RED], ["blue", BLUE]] as const) {
        const bn = this.K.node(frame, [0, FT + DOOR_H - 0.1, 0]);
        K.box(bn, col, alongZ ? [0.24, 0.12, DOOR_W] : [DOOR_W, 0.12, 0.24], [0, 0, 0], { emi: 1.6, unlit: true });
        bn.setEnabled(c === "green");
        bars[c] = bn;
      }
      // collider du vantail (pont scellé) — créé éteint, activé selon l'état.
      const collider = MeshBuilder.CreateBox("shipDoor", { width: alongZ ? 0.6 : DOOR_W, height: DOOR_H, depth: alongZ ? DOOR_W : 0.6 }, scene);
      collider.isVisible = false;
      collider.position.set(worldX(dlx, dlz), rootY + FT + DOOR_H / 2, worldZ(dlx, dlz));
      collider.rotation.y = yaw;
      doors.push({ from, to, leaves, bars, alongZ, collider, colliderOn: false, t: 1 });
    };
    for (const d of dungeon.doors) mkDoor(d.from, d.to, roomById[d.from], sideBetween(roomById[d.from].pos, roomById[d.to].pos));
    mkDoor("antechamber", "outside", roomById["antechamber"], "nz"); // entrée

    const insideR = 30;
    this.built = { root, colliders, rooms, doors, center: new Vector3(wx, gy, wz), yaw, cos, sin, wx, wz, site: { cx: site.cx, cz: site.cz }, insideR };
  }

  private dispose(): void {
    const b = this.built;
    if (!b) return;
    for (const c of b.colliders) { c.physicsBody?.dispose(); c.dispose(); }
    for (const d of b.doors) { d.collider.physicsBody?.dispose(); d.collider.dispose(); }
    b.root.dispose();
    this.built = null;
    this.inside = false;
    this.curRoom = null;
  }
}

function roomLabel(id: RoomId): string {
  return id === "engineering" ? "ingénierie" : id === "martial" ? "soute martiale" : id === "medical" ? "baie médicale" : id === "bridge" ? "pont" : "antichambre";
}
