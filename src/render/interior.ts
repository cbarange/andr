// ============================================================================
//  INTÉRIEURS SOUTERRAINS (M9, étape R1) — « Option A » : massif creux AU NIVEAU DU SOL.
//  On NE troue PAS le heightmap (impossible : fonction à valeur unique) : un intérieur est un
//  VOLUME MESH autonome (sol + parois + plafond) posé sur le terrain à l'emplacement d'un site
//  `cave`/`*mine`, avec une BOUCHE large face au camp. On entre EN MARCHANT — aucune transition.
//
//  Localisation (calquée sur Cabin + la physique localisée du terrain `PHYS_R`) : on ne BÂTIT
//  l'intérieur (mesh lourd + colliders) qu'à PROXIMITÉ du joueur, et on le LIBÈRE en s'éloignant
//  -> un seul intérieur actif à la fois, budget maîtrisé.
//
//  Obscurité = LOCALE & cosmétique : quand le joueur LOCAL est sous le plafond, on baisse `hemi`/
//  `sun` de SA scène (aucun pair n'en dépend -> pas de désync). Les accents émissifs (filons) luisent.
//
//  Disposition + butin = dérivés de la graine (sim/dungeon.ts) -> identiques chez tous.
//  Voir docs/mines-grottes-implementation.md (R1) & docs/mines-grottes-souterrains.md.
// ============================================================================

import {
  Scene, Mesh, MeshBuilder, TransformNode, Vector3, PhysicsAggregate, PhysicsShapeType, type Light,
} from "@babylonjs/core";
import { terrainHeight } from "../../data/world";
import { makeKit, P, type Kit } from "./lowpoly";
import { dungeonFor, type Dungeon, type DungeonNode } from "../sim/dungeon";
import type { WorldMap } from "../sim/worldgen";

// Types de sites qui possèdent un intérieur explorable.
const INTERIOR_TYPES = new Set(["cave", "ironmine", "coalmine", "sulphurmine"]);

// Distances de build/free (hystérésis) — l'intérieur lourd n'existe qu'autour du joueur.
const BUILD_R = 44; // bâtit quand le joueur s'approche à moins de 44 u du centre du site
const FREE_R = 64; //  libère au-delà de 64 u (marge anti-clignotement)

// Géométrie locale (repère intérieur : origine au sol, +Z vers le camp = côté de la bouche).
const SINK = 0.22; // enfoncement (comme la cabane) -> ressaut de bouche FRANCHISSABLE par la capsule
const FT = 0.3; // y local de la SURFACE du sol
const WALL_H = 3.0; // hauteur des parois (sous plafond)
const WALL_TH = 0.6; // épaisseur des parois (colliders)
const RING_N = 16; // nombre de segments de l'anneau de parois
// Demi-angle de la BOUCHE (ouverture face au camp). Dimensionné pour RETIRER ~2 segments devant ->
// une vraie entrée LARGE (≈ 2·R·sin(MOUTH_HALF)). NB : trop petit, aucun segment n'était retiré (anneau fermé).
const MOUTH_HALF = ((Math.PI * 2) / RING_N) * 1.1;

interface Built {
  root: TransformNode; // visuels (parentés, repère local tourné de `yaw`)
  colliders: Mesh[]; // colliders monde (sol/parois/plafond)
  center: Vector3; // centre-monde du site (x, gy, z)
  insideR: number; // rayon « sous plafond » (pour l'obscurité locale)
  barrier: Mesh; // collider de SEUIL à la bouche (actif tant que le joueur n'a pas de torche)
  barrierOn: boolean; // la barrière a-t-elle un corps physique (bloque-t-elle) ?
  site: { type: string; cx: number; cz: number }; // identité du site (pour les actions sim)
  loot: Array<{ nodeId: string; kind: string; world: Vector3; mesh: TransformNode }>; // caches/filons ramassables
}

/** Une cible de butin de l'intérieur ACTIF (pour le focus « ramasser »/« exploiter le filon »). */
export interface LootTarget {
  cx: number;
  cz: number;
  siteType: string;
  nodeId: string;
  kind: string;
  x: number;
  y: number;
  z: number;
}

export class Interiors {
  private readonly scene: Scene;
  private readonly K: Kit;
  private map: WorldMap | null = null;
  private readonly built = new Map<string, Built>(); // un seul actif, mais on garde le cache court
  private activeKey: string | null = null;

  // Obscurité locale : on pilote l'intensité de hemi/sun (lues par nom dans la scène).
  private readonly hemi: Light | null;
  private readonly sun: Light | null;
  private readonly hemiBase: number;
  private readonly sunBase: number;
  private dark = 0; // 0 (dehors) .. 1 (sous plafond), interpolé
  private inside = false;
  private blocked = false; // joueur LOCAL devant une bouche sombre, sans torche (pour le toast)
  private clearedKeys = new Set<string>(); // sites NETTOYÉS ("cx,cz") : devenus avant-postes -> plus d'intérieur

  constructor(scene: Scene) {
    this.scene = scene;
    this.K = makeKit(scene);
    this.hemi = scene.getLightByName("hemi");
    this.sun = scene.getLightByName("sun");
    this.hemiBase = this.hemi?.intensity ?? 0.4;
    this.sunBase = this.sun?.intensity ?? 0.9;
  }

  /** (Re)fournit la carte (au boot et quand /seed la régénère). Repart de zéro. */
  setMap(map: WorldMap): void {
    for (const key of [...this.built.keys()]) this.dispose(key);
    this.activeKey = null;
    this.map = map;
  }

  /** Le joueur LOCAL est-il sous plafond (pour la torche / le gating d'entrée — R2). */
  isLocalPlayerInside(): boolean {
    return this.inside;
  }

  /** Clé "cx,cz" du site dont l'intérieur 3D est ACTUELLEMENT bâti (pour masquer son modèle décoratif). */
  activeSiteKey(): string | null {
    const a = this.activeKey ? this.built.get(this.activeKey) : null;
    return a ? a.site.cx + "," + a.site.cz : null;
  }

  /** DEBUG : liste les sites explorables (coords monde) — pour téléporter dessus en test. */
  debugSites(): Array<{ type: string; cx: number; cz: number; x: number; z: number }> {
    if (!this.map) return [];
    return this.map.sites
      .filter((s) => INTERIOR_TYPES.has(s.type))
      .map((s) => { const w = this.map!.cellToWorldCenter(s.cx, s.cz); return { type: s.type, cx: s.cx, cz: s.cz, x: w.x, z: w.z }; });
  }

  /** Inspecteur DEBUG (vérif numérique sans capture) : intérieur actif, colliders, obscurité, gate. */
  get stats(): { built: number; active: string | null; inside: boolean; colliders: number; dark: number; blocked: boolean; barrierOn: boolean; loot: number } {
    const act = this.activeKey ? this.built.get(this.activeKey) : null;
    return {
      built: this.built.size, active: this.activeKey, inside: this.inside, colliders: act?.colliders.length ?? 0,
      dark: Math.round(this.dark * 100) / 100, blocked: this.blocked, barrierOn: act?.barrierOn ?? false, loot: act?.loot.length ?? 0,
    };
  }

  /** Le joueur LOCAL est-il bloqué devant une bouche faute de torche ? (déclenche un toast côté main) */
  isBlockedNoTorch(): boolean {
    return this.blocked;
  }

  /** Sites NETTOYÉS (clé "cx,cz") : ils sont devenus des avant-postes -> on ne bâtit plus leur intérieur
   *  (usage unique). Si l'un est actuellement bâti, on le libère. Reflété depuis l'état sim. */
  setClearedKeys(keys: Set<string>): void {
    this.clearedKeys = keys;
    for (const [k, b] of [...this.built]) if (keys.has(b.site.cx + "," + b.site.cz)) this.dispose(k);
  }

  /** Caches/filons RAMASSABLES de l'intérieur actif (coords monde) — pour le focus « E ». */
  activeLoot(): LootTarget[] {
    const a = this.activeKey ? this.built.get(this.activeKey) : null;
    if (!a) return [];
    return a.loot.map((l) => ({ cx: a.site.cx, cz: a.site.cz, siteType: a.site.type, nodeId: l.nodeId, kind: l.kind, x: l.world.x, y: l.world.y, z: l.world.z }));
  }

  /** Masque les caches/filons DÉJÀ PRIS (lecture de l'état sim) -> butin commun premier-servi visible. */
  applyProgress(sites: Record<string, { taken?: Record<string, boolean> }>): void {
    const a = this.activeKey ? this.built.get(this.activeKey) : null;
    if (!a) return;
    const taken = sites[a.site.cx + "," + a.site.cz]?.taken ?? {};
    for (const l of a.loot) l.mesh.setEnabled(!taken[l.nodeId]);
  }

  /**
   * À appeler chaque frame : bâtit/dé-bâtit l'intérieur le plus proche, gère l'obscurité locale et
   * la BARRIÈRE de seuil (on ne peut entrer dans le noir SANS TORCHE — fidèle ADR). `hasTorch` = le
   * joueur local porte-t-il une torche.
   */
  update(playerPos: Vector3, dtSec: number, hasTorch: boolean): void {
    if (this.map) {
      // 1) site explorable le plus proche.
      let nearKey: string | null = null;
      let nearD = Infinity;
      let nearSite: { type: string; cx: number; cz: number; x: number; z: number } | null = null;
      for (const s of this.map.sites) {
        if (!INTERIOR_TYPES.has(s.type)) continue;
        if (this.clearedKeys.has(s.cx + "," + s.cz)) continue; // grotte nettoyée = avant-poste -> plus d'intérieur
        const w = this.map.cellToWorldCenter(s.cx, s.cz);
        const d = Math.hypot(w.x - playerPos.x, w.z - playerPos.z);
        if (d < nearD) { nearD = d; nearKey = s.type + ":" + s.cx + "," + s.cz; nearSite = { ...s, x: w.x, z: w.z }; }
      }

      // 2) build à l'approche, free à l'éloignement (hystérésis).
      if (nearKey && nearSite && nearD <= BUILD_R && !this.built.has(nearKey)) {
        this.build(nearKey, nearSite);
      }
      for (const [key, b] of [...this.built]) {
        const d = Math.hypot(b.center.x - playerPos.x, b.center.z - playerPos.z);
        if (d > FREE_R) this.dispose(key);
      }
      this.activeKey = nearKey && this.built.has(nearKey) ? nearKey : null;
    }

    // 3) BARRIÈRE de seuil (gate ADR) : active (bloque) tant que le joueur local n'a PAS de torche.
    const act = this.activeKey ? this.built.get(this.activeKey) : null;
    const distAct = act ? Math.hypot(act.center.x - playerPos.x, act.center.z - playerPos.z) : Infinity;
    if (act) {
      const wantOn = !hasTorch; // sans torche -> on bloque l'entrée
      if (wantOn !== act.barrierOn) {
        if (wantOn) new PhysicsAggregate(act.barrier, PhysicsShapeType.BOX, { mass: 0 }, this.scene);
        else act.barrier.physicsBody?.dispose();
        act.barrierOn = wantOn;
      }
    }
    // Bloqué = sans torche et proche de la bouche (déclenche un toast côté main).
    this.blocked = !!act && !hasTorch && distAct <= act.insideR + 9;

    // 4) obscurité LOCALE : sous plafond si dans le rayon de l'intérieur actif.
    this.inside = !!act && distAct <= act.insideR;
    const target = this.inside ? 1 : 0;
    this.dark += (target - this.dark) * Math.min(1, dtSec * 4);
    if (this.dark < 1e-3) this.dark = 0;
    // On garde un FOND très faible (jamais aveugle) -> on perçoit la forme de la grotte ; la torche
    // + les filons émissifs font le reste. (Trop sombre = injouable ; trop clair = pas d'ambiance.)
    if (this.hemi) this.hemi.intensity = this.hemiBase * (1 - 0.72 * this.dark);
    if (this.sun) this.sun.intensity = this.sunBase * (1 - 0.85 * this.dark);
  }

  // ========================================================================
  //  Construction d'un intérieur (Option A : massif au sol + cavité + bouche).
  // ========================================================================

  private build(key: string, site: { type: string; cx: number; cz: number; x: number; z: number }): void {
    const K = this.K;
    const wx = site.x, wz = site.z;
    const gy = terrainHeight(wx, wz);
    const rootY = gy - SINK;
    // La bouche regarde le CAMP (origine) : +Z local pointe vers (0,0).
    const yaw = Math.atan2(-wx, -wz);
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    // (lx,lz) LOCAL -> point MONDE (même convention de rotation que Cabin.vAt).
    const worldX = (lx: number, lz: number): number => wx + lx * cos + lz * sin;
    const worldZ = (lx: number, lz: number): number => wz - lx * sin + lz * cos;

    const root = K.node(null);
    root.position.copyFromFloats(wx, rootY, wz);
    root.rotation.y = yaw;

    const dungeon = dungeonFor(site.type, site.cx, site.cz, this.map!.seed);

    // Emprise : cercle englobant les nœuds (centré sur leur barycentre), + marge.
    let cz0 = 0;
    for (const n of dungeon.nodes) cz0 += n.pos.z;
    cz0 /= Math.max(1, dungeon.nodes.length);
    let R = 6;
    for (const n of dungeon.nodes) R = Math.max(R, Math.hypot(n.pos.x, n.pos.z - cz0) + 4.5);

    const colliders: Mesh[] = [];
    const collBox = (name: string, w: number, d: number, h: number, lx: number, lz: number, topLocalY: number, ry = 0): void => {
      const col = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
      col.isVisible = false;
      col.position.set(worldX(lx, lz), rootY + topLocalY - h / 2, worldZ(lx, lz));
      col.rotation.y = yaw + ry;
      new PhysicsAggregate(col, PhysicsShapeType.BOX, { mass: 0 }, this.scene);
      colliders.push(col);
    };

    const lootMeshes = new Map<string, TransformNode>();
    this.buildShell(root, dungeon, cz0, R, gy, collBox, lootMeshes, site.type);

    // Caches/filons ramassables (coords MONDE + mesh) — pour le focus et le masquage « pris ».
    const loot = dungeon.nodes
      .filter((n) => Object.keys(n.loot).length > 0 && lootMeshes.has(n.id))
      .map((n) => ({ nodeId: n.id, kind: n.kind, world: new Vector3(worldX(n.pos.x, n.pos.z), gy + FT + 0.5, worldZ(n.pos.x, n.pos.z)), mesh: lootMeshes.get(n.id)! }));

    // BARRIÈRE de seuil à la bouche (sans corps physique au départ ; activée selon la torche). Elle
    // couvre TOUTE la largeur de l'ouverture (sinon on la contournerait sans torche).
    const mouthW = 2 * R * Math.sin(MOUTH_HALF);
    const blz = cz0 + R * Math.cos(MOUTH_HALF);
    const barrier = MeshBuilder.CreateBox("intBarrier", { width: mouthW + 1.0, height: WALL_H, depth: WALL_TH }, this.scene);
    barrier.isVisible = false;
    barrier.position.set(worldX(0, blz), rootY + FT + WALL_H / 2, worldZ(0, blz));
    barrier.rotation.y = yaw;

    // `center` = centroïde de la CAVITÉ (local (0,cz0)), pas le centre du site (qui est près de la
    // bouche) -> « dedans » couvre TOUTE la cavité (obscurité + FPV restent actifs jusqu'au fond).
    this.built.set(key, {
      root, colliders, center: new Vector3(worldX(0, cz0), gy, worldZ(0, cz0)), insideR: R * 0.85, barrier, barrierOn: false,
      site: { type: site.type, cx: site.cx, cz: site.cz }, loot,
    });
  }

  /**
   * Massif au sol + SOL/PLAFOND + anneau de roche (bouche large) + COULOIRS le long des segments du
   * donjon (vrais tunnels à parois) + décoration TYPÉE (grotte : stalagmites/stalactites/cristaux ;
   * mine : étais en bois + rails + filons) + PORTAIL d'entrée distinct (arche rocheuse / cadre minier).
   */
  private buildShell(
    root: TransformNode,
    dungeon: Dungeon,
    cz0: number,
    R: number,
    gy: number,
    collBox: (name: string, w: number, d: number, h: number, lx: number, lz: number, topLocalY: number, ry?: number) => void,
    lootMeshes: Map<string, TransformNode>,
    type: string,
  ): void {
    const K = this.K;
    const isMine = type !== "cave";
    const stone = P.stoneDark, stone2 = P.stone, rock = [0.17, 0.19, 0.21], rockL = [0.26, 0.28, 0.31];
    const wood = P.woodDark, woodL = P.woodLight, rail = P.metalDark;
    const crystal = type === "sulphurmine" ? P.sulphurRock : type === "ironmine" ? P.rust : type === "coalmine" ? [0.45, 0.5, 0.6] : [0.45, 0.8, 0.95];
    void gy;
    const nodeById: Record<string, DungeonNode> = {};
    for (const n of dungeon.nodes) nodeById[n.id] = n;
    const mouthW = 2 * R * Math.sin(MOUTH_HALF); // largeur réelle de l'ouverture
    const mzf = cz0 + R * Math.cos(MOUTH_HALF); // z (local) du plan de la bouche

    // --- SOL (visuel sombre + collider plein sur toute l'emprise). ---
    K.cyl(root, [0.11, 0.12, 0.13], { h: 0.1, d: R * 2.1, t: 18 }, [0, FT - 0.05, cz0]);
    collBox("intFloor", R * 2.2, R * 2.2, 0.6, 0, cz0, FT);

    // --- PAROIS EN ANNEAU (roche brute) avec la BOUCHE au +Z (face camp). ---
    for (let i = 0; i < RING_N; i++) {
      const a0 = (i / RING_N) * Math.PI * 2, a1 = ((i + 1) / RING_N) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      if (Math.abs(Math.atan2(Math.sin(am), Math.cos(am))) < MOUTH_HALF) continue; // ouverture
      const x0 = Math.sin(a0) * R, z0 = cz0 + Math.cos(a0) * R;
      const x1 = Math.sin(a1) * R, z1 = cz0 + Math.cos(a1) * R;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const len = Math.hypot(x1 - x0, z1 - z0) + 0.4;
      const segRy = Math.atan2(x1 - x0, z1 - z0);
      collBox("intWall", WALL_TH, len, WALL_H, mx, mz, FT + WALL_H, segRy);
      const seg = K.node(root, [mx, FT, mz]); seg.rotation.y = segRy;
      K.box(seg, i % 2 ? stone : stone2, [WALL_TH + 0.5, WALL_H, len], [0, WALL_H / 2, 0]);
      K.ico(seg, rock, { d: 1.6 + (i % 3) * 0.4, sub: 1 }, [0, 0.4 + (i % 2) * 0.5, 0], { scale: [1, 0.8, 1] });
    }

    // --- PLAFOND (occulte le ciel) + dôme rocheux (silhouette de colline dehors). ---
    K.cyl(root, [0.07, 0.08, 0.09], { h: 0.5, d: R * 2.15, t: 18 }, [0, FT + WALL_H + 0.1, cz0]);
    collBox("intCeil", R * 2.2, R * 2.2, 0.5, 0, cz0, FT + WALL_H + 0.5);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      K.ico(root, i % 2 ? rock : stone, { d: 3.0 + (i % 3), sub: 1 }, [Math.sin(a) * R * 0.7, FT + WALL_H + 0.4 + (i % 2) * 0.6, cz0 + Math.cos(a) * R * 0.7], { scale: [1, 0.7, 1] });
    }

    // --- COULOIRS le long des segments du donjon (+ une amorce mouche -> entrée). ---
    const CW = 2.2; // demi-largeur d'un couloir (passage ~4,4 u, capsule r=0.34 à l'aise)
    const corridor = (ax: number, az: number, bx: number, bz: number): void => {
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1, ang = Math.atan2(dx, dz);
      const nx = -dz / len, nz = dx / len; // normale
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      for (const side of [-1, 1]) {
        const wx2 = mx + nx * CW * side, wz2 = mz + nz * CW * side;
        collBox("intCorrWall", WALL_TH, len + 1.0, WALL_H, wx2, wz2, FT + WALL_H, ang);
        const w = K.node(root, [wx2, FT, wz2]); w.rotation.y = ang;
        K.box(w, side < 0 ? stone : stone2, [WALL_TH + 0.35, WALL_H, len + 1.0], [0, WALL_H / 2, 0]);
        const studs = Math.max(1, Math.round(len / 3));
        for (let s = 0; s < studs; s++) K.ico(w, rock, { d: 0.9 + (s % 2) * 0.5, sub: 1 }, [0.1, 0.5 + (s % 2) * 0.5, -len / 2 + (s + 0.5) / studs * len], { scale: [0.7, 1.1, 1] });
      }
      // plafond bas du tunnel (roche)
      const cnode = K.node(root, [mx, FT + WALL_H, mz]); cnode.rotation.y = ang;
      K.box(cnode, rock, [CW * 2 + 0.5, 0.4, len + 1.0], [0, 0, 0]);
      // décoration le long du couloir
      const steps = Math.max(2, Math.round(len / 2.4));
      for (let s = 1; s < steps; s++) {
        const t = s / steps, px = ax + dx * t, pz = az + dz * t, sgn = s % 2 ? 1 : -1;
        if (isMine) {
          if (s % 2 === 0) { // étai : 2 montants + chapeau (cadre de boisage minier)
            for (const side of [-1, 1]) K.cyl(root, wood, { h: WALL_H - 0.2, d: 0.16, t: 6 }, [px + nx * (CW - 0.25) * side, FT + (WALL_H - 0.2) / 2, pz + nz * (CW - 0.25) * side]);
            const beam = K.node(root, [px, FT + WALL_H - 0.25, pz]); beam.rotation.y = ang + Math.PI / 2;
            K.box(beam, woodL, [0.16, 0.18, CW * 2 - 0.3], [0, 0, 0]);
          }
        } else {
          K.cone(root, stone2, { h: 0.5 + 0.45 * (s % 3), d: 0.42, t: 6 }, [px + nx * (CW - 0.5) * sgn, FT + 0.28, pz + nz * (CW - 0.5) * sgn]); // stalagmite
          K.cone(root, stone, { h: 0.55, d: 0.34, t: 6 }, [px - nx * (CW - 0.6) * sgn, FT + WALL_H - 0.28, pz - nz * (CW - 0.6) * sgn], { rot: [Math.PI, 0, 0] }); // stalactite
          if (s % 3 === 1) K.ico(root, crystal, { d: 0.3, sub: 1 }, [px + nx * (CW - 0.4) * sgn, FT + 0.5, pz + nz * (CW - 0.4) * sgn], { emi: 1.5, unlit: true }); // cristal luisant
        }
      }
      // mine : rails + traverses au sol
      if (isMine) {
        const rn = K.node(root, [mx, FT + 0.05, mz]); rn.rotation.y = ang;
        for (const side of [-1, 1]) K.box(rn, rail, [0.07, 0.06, len + 0.6], [side * 0.45, 0, 0]);
        const ties = Math.max(2, Math.round(len / 1.1));
        for (let s = 0; s < ties; s++) K.box(rn, [0.22, 0.16, 0.1], [1.2, 0.05, 0.16], [0, -0.01, -len / 2 + (s + 0.5) / ties * len]);
      }
    };
    // amorce : de la bouche (z=mzf) vers le 1ᵉʳ nœud (entry ≈ origine)
    const entry = nodeById["entry"] ?? { pos: { x: 0, z: 0 } } as DungeonNode;
    corridor(0, mzf - 0.6, entry.pos.x, entry.pos.z);
    for (const seg of dungeon.segments) {
      const a = nodeById[seg.from], b = nodeById[seg.to];
      if (a && b) corridor(a.pos.x, a.pos.z, b.pos.x, b.pos.z);
    }

    // --- PORTAIL D'ENTRÉE (distinct selon le type), aux bords de la bouche. ---
    const jL = -Math.sin(MOUTH_HALF) * R, jR = Math.sin(MOUTH_HALF) * R, jz = cz0 + Math.cos(MOUTH_HALF) * R;
    for (const jx of [jL, jR]) collBox("intJamb", 1.2, 1.2, WALL_H, jx, jz, FT + WALL_H);
    if (isMine) {
      // ADIT MINIER : cadre de boisage massif (2 montants + chapeau + jambettes), déblais, wagonnet, rails sortants.
      for (const jx of [jL, jR]) {
        K.cyl(root, wood, { h: WALL_H + 0.3, d: 0.4, t: 6 }, [jx * 0.92, FT + (WALL_H + 0.3) / 2, mzf]);
        K.ico(root, rock, { d: 2.4, sub: 1 }, [jx, FT + 1.4, jz], { scale: [1, 1.5, 1] });
      }
      K.box(root, woodL, [mouthW + 0.4, 0.4, 0.4], [0, FT + WALL_H, mzf]); // chapeau (linteau massif)
      K.box(root, wood, [mouthW + 0.4, 0.25, 0.25], [0, FT + WALL_H - 0.5, mzf]); // sous-poutre
      // déblais de minerai de part et d'autre
      const tail = type === "coalmine" ? [0.16, 0.16, 0.2] : type === "sulphurmine" ? P.sulphurRock : P.rust;
      K.ico(root, tail, { d: 1.0, sub: 1 }, [jL * 0.7, FT + 0.3, mzf + 1.4]);
      K.ico(root, tail, { d: 0.7, sub: 1 }, [jR * 0.6, FT + 0.25, mzf + 1.6]);
      // wagonnet sur rails, juste devant la bouche
      const cart = K.node(root, [jR * 0.45, FT, mzf + 1.8]);
      K.box(cart, rail, [0.7, 0.45, 0.95], [0, 0.35, 0]);
      K.box(cart, tail, [0.6, 0.2, 0.85], [0, 0.6, 0]);
      for (const wsx of [-1, 1]) for (const wsz of [-1, 1]) K.tor(cart, P.metalDark, { d: 0.32, thick: 0.05, t: 10 }, [wsx * 0.32, 0.18, wsz * 0.34], { rot: [0, 0, Math.PI / 2] });
      // 2 lanternes accrochées (repère lumineux d'entrée)
      for (const jx of [jL, jR]) { K.box(root, [1.0, 0.82, 0.45], [0.16, 0.22, 0.16], [jx * 0.9, FT + WALL_H - 0.5, mzf - 0.1], { emi: 1.2, unlit: true }); }
    } else {
      // ARCHE DE GROTTE : gros rochers en encorbellement + linteau rocheux + 2 torches sur la roche.
      for (const jx of [jL, jR]) {
        K.ico(root, rockL, { d: 2.8, sub: 1 }, [jx, FT + 1.3, jz], { scale: [1.1, 1.5, 1] });
        K.ico(root, rock, { d: 1.6, sub: 1 }, [jx * 0.85, FT + 0.6, jz + 0.3], { scale: [1, 1.1, 1] });
        K.cyl(root, wood, { h: 0.7, d: 0.08, t: 5 }, [jx * 0.8, FT + 1.5, jz - 0.2], { rot: [0.35, 0, 0] }); // brandon
        K.ico(root, P.ember, { d: 0.34 }, [jx * 0.8, FT + 1.95, jz - 0.55], { emi: 1.9, unlit: true });
      }
      K.ico(root, rockL, { d: mouthW * 0.8, sub: 1 }, [0, FT + WALL_H + 0.2, jz], { scale: [1, 0.5, 0.7] }); // surplomb rocheux
    }

    // --- NŒUDS : chambres décorées + FILONS/CACHES émissifs (repères de butin, ramassables). ---
    for (const n of dungeon.nodes) {
      if (n.kind === "entry") continue;
      if (n.kind === "junction") {
        // carrefour : petit fût/lanterne suspendue au plafond (repère lumineux + landmark)
        K.cyl(root, wood, { h: 0.5, d: 0.04, t: 5 }, [n.pos.x, FT + WALL_H - 0.25, n.pos.z]);
        K.box(root, [1.0, 0.82, 0.45], [0.2, 0.26, 0.2], [n.pos.x, FT + WALL_H - 0.55, n.pos.z], { emi: 1.1, unlit: true });
        continue;
      }
      if (Object.keys(n.loot).length > 0) {
        // CHAMBRE à butin : filon/cache lumineux (émissif) + amas autour. Mesh ENREGISTRÉ (ramassable).
        const oreCol = n.loot.iron ? P.rust : n.loot.coal ? [0.2, 0.2, 0.24] : n.loot.sulphur ? P.sulphurRock : crystal;
        const node = K.node(root, [n.pos.x, FT, n.pos.z]);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          K.ico(node, oreCol, { d: 0.4 + (i % 2) * 0.25, sub: 1 }, [Math.cos(a) * 0.55, 0.25 + (i % 2) * 0.25, Math.sin(a) * 0.55], { emi: isMine ? 1.5 : 1.8, unlit: true });
        }
        K.ico(node, oreCol, { d: 0.7, sub: 1 }, [0, 0.45, 0], { emi: isMine ? 1.7 : 2.0, unlit: true });
        if (isMine) { K.cyl(node, woodL, { h: 0.9, d: 0.12, t: 6 }, [0.7, 0.45, -0.2], { rot: [0, 0, 0.3] }); K.box(node, rail, [0.12, 0.06, 0.5], [0.78, 0.1, 0.2]); } // pioche/outil planté
        lootMeshes.set(n.id, node);
      } else {
        // cul-de-sac : petit amas rocheux (recoin)
        K.ico(root, rock, { d: 1.3, sub: 1 }, [n.pos.x, FT + 0.5, n.pos.z], { scale: [1, 1.3, 1] });
      }
    }
  }

  private dispose(key: string): void {
    const b = this.built.get(key);
    if (!b) return;
    for (const c of b.colliders) { c.physicsBody?.dispose(); c.dispose(); }
    b.barrier.physicsBody?.dispose(); b.barrier.dispose();
    // dispose le sous-arbre visuel (meshes) MAIS PAS les matériaux : le kit les met en cache PARTAGÉ
    // (par couleur) -> les disposer casserait un intérieur rebâti plus tard. Set borné -> aucun leak réel.
    b.root.dispose();
    this.built.delete(key);
    if (this.activeKey === key) this.activeKey = null;
  }
}
