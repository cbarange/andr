// ============================================================================
//  FOUILLE DE SURFACE (R3) — forages (`borehole`) & champs de bataille (`battlefield`) :
//  leur butin (alliage extraterrestre, cellules, munitions) est posé EN SURFACE autour
//  du site — pas de donjon, on « fouille » à l'E (TAKE_LOOT, premier-servi global).
//
//  Calqué sur `interior.ts` en plus léger : les meshes de butin ne sont BÂTIS qu'à
//  PROXIMITÉ du joueur (un seul site actif, hystérésis build/free), et les points déjà
//  pris (état sim `taken`) sont masqués chez tous (`applyProgress`).
//
//  Positions + contenu = dérivés de la graine (sim/dungeon.ts, nœuds de surface) ->
//  identiques chez tous les pairs. Couche « corps » 100 % locale : aucune règle ici.
// ============================================================================

import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { terrainHeight } from "../../data/world";
import { makeKit, P, type Kit } from "./lowpoly";
import { dungeonFor } from "../sim/dungeon";
import type { WorldMap } from "../sim/worldgen";
import type { LootTarget } from "./interior";

const SURFACE_TYPES = new Set(["borehole", "battlefield"]);
const BUILD_R = 52; // bâtit les points de fouille quand le joueur approche du site
const FREE_R = 72; // libère au-delà (marge anti-clignotement)

interface Built {
  root: TransformNode;
  center: { x: number; z: number };
  site: { type: string; cx: number; cz: number };
  loot: Array<{ nodeId: string; world: Vector3; mesh: TransformNode }>;
}

export class SiteLoot {
  private readonly K: Kit;
  private map: WorldMap | null = null;
  private built: Built | null = null; // un seul site actif à la fois

  constructor(private readonly scene: Scene) {
    this.K = makeKit(scene);
  }

  /** (Re)fournit la carte (au boot et quand /seed la régénère). Repart de zéro. */
  setMap(map: WorldMap): void {
    this.disposeBuilt();
    this.map = map;
  }

  /** Points de fouille RAMASSABLES du site actif (coords monde) — pour le focus « E ». */
  activeLoot(): LootTarget[] {
    if (!this.built) return [];
    const b = this.built;
    return b.loot.map((l) => ({
      cx: b.site.cx, cz: b.site.cz, siteType: b.site.type, nodeId: l.nodeId, kind: "chamber",
      x: l.world.x, y: l.world.y, z: l.world.z,
    }));
  }

  /** Masque les points DÉJÀ FOUILLÉS (état sim) -> butin commun premier-servi visible. */
  applyProgress(sites: Record<string, { taken?: Record<string, boolean> }>): void {
    if (!this.built) return;
    const taken = sites[this.built.site.cx + "," + this.built.site.cz]?.taken ?? {};
    for (const l of this.built.loot) l.mesh.setEnabled(!taken[l.nodeId]);
  }

  /** À appeler chaque frame : bâtit le site fouillable le plus proche, libère au loin. */
  update(playerPos: Vector3): void {
    if (!this.map) return;
    let near: { type: string; cx: number; cz: number; x: number; z: number } | null = null;
    let nearD = Infinity;
    for (const s of this.map.sites) {
      if (!SURFACE_TYPES.has(s.type)) continue;
      const w = this.map.cellToWorldCenter(s.cx, s.cz);
      const d = Math.hypot(w.x - playerPos.x, w.z - playerPos.z);
      if (d < nearD) { nearD = d; near = { ...s, x: w.x, z: w.z }; }
    }
    const wantKey = near && nearD <= BUILD_R ? near.type + ":" + near.cx + "," + near.cz : null;
    const curKey = this.built ? this.built.site.type + ":" + this.built.site.cx + "," + this.built.site.cz : null;
    if (curKey && this.built) {
      const d = Math.hypot(this.built.center.x - playerPos.x, this.built.center.z - playerPos.z);
      if (d > FREE_R) this.disposeBuilt();
    }
    if (wantKey && wantKey !== curKey && near) {
      this.disposeBuilt();
      this.build(near);
    }
  }

  // --------------------------------------------------------------------------

  private build(site: { type: string; cx: number; cz: number; x: number; z: number }): void {
    const root = new TransformNode("siteLoot:" + site.cx + "," + site.cz, this.scene);
    const d = dungeonFor(site.type, site.cx, site.cz, this.map!.seed);
    const loot: Built["loot"] = [];
    for (const n of d.nodes) {
      if (Object.keys(n.loot).length === 0) continue;
      const wx = site.x + n.pos.x, wz = site.z + n.pos.z;
      const gy = terrainHeight(wx, wz);
      const mesh = site.type === "borehole" ? this.makeAlloyShard(wx, gy, wz) : this.makeWarCache(wx, gy, wz);
      mesh.parent = root;
      loot.push({ nodeId: n.id, world: new Vector3(wx, gy + 0.5, wz), mesh });
    }
    this.built = { root, center: { x: site.x, z: site.z }, site: { type: site.type, cx: site.cx, cz: site.cz }, loot };
  }

  /** Éclat d'ALLIAGE d'un forage : fragment métallique fiché en terre + lueur alien (glow bloom). */
  private makeAlloyShard(x: number, gy: number, z: number): TransformNode {
    const K = this.K;
    const n = K.node(null, [x, gy, z]);
    K.ico(n, P.alienAlloy, { d: 0.9, sub: 1 }, [0, 0.32, 0], { rot: [0.4, x * 0.7, 0.3] });
    K.box(n, P.alienHull, [0.5, 0.7, 0.4], [0.35, 0.25, -0.2], { rot: [0.2, 0.9, 0.35] });
    K.ico(n, P.alienGlow, { d: 0.3, sub: 1 }, [-0.25, 0.45, 0.2], { emi: 0.9 }); // lueur (bloom)
    return n;
  }

  /** Cache de guerre d'un champ de bataille : caisse de munitions cabossée + débris métalliques. */
  private makeWarCache(x: number, gy: number, z: number): TransformNode {
    const K = this.K;
    const n = K.node(null, [x, gy, z]);
    K.box(n, P.metalDark, [0.9, 0.5, 0.55], [0, 0.25, 0], { rot: [0, x * 0.5, 0.06] });
    K.box(n, P.metal, [0.92, 0.1, 0.57], [0, 0.5, 0], { rot: [0, x * 0.5, 0.06] }); // couvercle
    K.cyl(n, P.rust, { h: 0.5, d: 0.16, t: 6 }, [0.55, 0.25, 0.25], { rot: [0.9, 0, 0.4] }); // douille/débris
    K.box(n, P.armorDk, [0.4, 0.12, 0.3], [-0.5, 0.06, -0.3], { rot: [0, 0.7, 0] });
    return n;
  }

  private disposeBuilt(): void {
    if (!this.built) return;
    // dispose des ENFANTS seulement — les matériaux restent (cache partagé du kit, réutilisés).
    this.built.root.dispose(false);
    this.built = null;
  }
}
