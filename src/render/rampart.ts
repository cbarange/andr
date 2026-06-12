// ============================================================================
//  REMPART & PORTE DU CAMP (M6 — « le seuil ») — matérialise le RETRANCHEMENT
//  central : une palissade de pieux tout autour de la zone sûre, ouverte par une
//  PORTE au sud (+Z, l'approche). Au pied de la porte, un PUITS = point de
//  ravitaillement (la recharge eau/vivres/PV est AUTOMATIQUE dès qu'on est dans
//  la zone sûre — cf. sim TICK phase 7 ; le puits la rend lisible).
//
//  Purement VISUEL & LOCAL (couche « corps ») : aucune règle de jeu, aucun réseau,
//  aucun déterminisme requis. La FRONTIÈRE logique reste le test de rayon
//  (`VILLAGE_RADIUS`, cf. main.ts) — « monde unifié », pas de mur infranchissable :
//  les pieux n'ont PAS de collider (on ne piège pas le joueur ni les routes qui
//  sortent dans toutes les directions) ; seuls les MONTANTS DE PORTE sont solides
//  (la porte se lit comme une vraie structure). Anneau fusionné en 1 mesh (perf).
// ============================================================================

import { Scene, TransformNode, Mesh, PhysicsAggregate, PhysicsShapeType } from "@babylonjs/core";
import { terrainHeight, worldgen } from "../../data/world";
import { makeKit, P, type Kit } from "./lowpoly";

const VILLAGE_RADIUS = worldgen.safeRadiusCells * worldgen.cellSize; // = frontière de la zone sûre
const RING_R = VILLAGE_RADIUS - 1; // léger retrait pour que la palissade soit DANS la zone sûre
const STAKE_GAP = 3.4; // espacement (u) entre deux pieux le long de l'anneau
const GATE_HALF = 5.5; // demi-largeur de l'ouverture de la porte (u) — large, on ne s'y coince pas
const COLLIDER_H = 3.0;

/** Position sur l'anneau : angle 0 = +Z (l'approche sud, où s'ouvre la porte). */
function ringXZ(a: number): [number, number] {
  return [RING_R * Math.sin(a), RING_R * Math.cos(a)];
}

export class Rampart {
  private readonly K: Kit;
  private readonly node: TransformNode;

  constructor(private readonly scene: Scene) {
    this.K = makeKit(scene);
    this.node = new TransformNode("rampart", scene);
    this.buildPalisade();
    this.buildGate();
    this.buildWell();
  }

  /** Anneau de pieux taillés (un mesh fusionné -> ~1 draw call), ouvert au niveau de la porte. */
  private buildPalisade(): void {
    const K = this.K;
    const gateA = GATE_HALF / RING_R; // demi-angle de l'ouverture
    const stakes: Mesh[] = [];
    const step = STAKE_GAP / RING_R;
    for (let a = gateA; a < Math.PI * 2 - gateA; a += step) {
      const [x, z] = ringXZ(a);
      const y = terrainHeight(x, z);
      const h = 2.0 + 0.35 * Math.sin(a * 5.3); // hauteur ondulée (organique, déterministe)
      const lean = 0.05 * Math.sin(a * 3.1); // léger fruit
      // Fût + pointe (pieu taillé). Faces tournées vers l'extérieur (rotation Y selon l'angle).
      stakes.push(K.cyl(this.node, P.woodDark, { h, d: 0.34, t: 6 }, [x, y + h / 2, z], { rot: [lean, a, 0] }));
      stakes.push(K.cone(this.node, P.wood, { h: 0.5, d: 0.34, t: 6 }, [x, y + h + 0.2, z], { rot: [lean, a, 0] }));
    }
    // Fusion en un seul mesh statique (perf : ~1 draw call pour tout l'anneau).
    const merged = Mesh.MergeMeshes(stakes, true, true, undefined, false, false);
    if (merged) {
      merged.parent = this.node;
      merged.isPickable = false;
      merged.freezeWorldMatrix();
    }
  }

  /** Grande PORTE au sud (+Z) : deux montants épais + un linteau, flanqués de petits contreforts.
   *  Seuls les montants portent un collider (la porte = vraie structure ; le reste reste franchissable). */
  private buildGate(): void {
    const K = this.K;
    const postH = 3.4;
    for (const sx of [-1, 1]) {
      const [x, z] = ringXZ((sx * GATE_HALF) / RING_R);
      const y = terrainHeight(x, z);
      K.cyl(this.node, P.woodDark, { h: postH, d: 0.85, t: 8 }, [x, y + postH / 2, z]);
      K.cone(this.node, P.wood, { h: 0.7, d: 0.95, t: 8 }, [x, y + postH + 0.25, z]);
      this.addPostCollider(x, z, 0.95);
    }
    // Linteau : poutre horizontale entre les deux montants (au-dessus de l'ouverture).
    const [lx, lz] = ringXZ(0);
    const y = terrainHeight(lx, lz);
    const span = GATE_HALF * 2 + 0.9;
    // L'ouverture est tangente à l'anneau -> la poutre est orientée selon X (l'arc local est ~plat).
    K.box(this.node, P.woodLight, [span, 0.4, 0.42], [lx, y + postH - 0.1, lz]);
    K.box(this.node, P.woodDark, [span, 0.18, 0.5], [lx, y + postH - 0.45, lz]);
  }

  /** PUITS de ravitaillement au pied de la porte (côté intérieur) : margelle de pierre + eau + potence.
   *  Lisibilité du ravitaillement (la recharge est automatique dans la zone sûre). */
  private buildWell(): void {
    const K = this.K;
    const wx = 0, wz = RING_R - 4; // juste à l'intérieur de la porte
    const y = terrainHeight(wx, wz);
    const w = K.node(this.node, [wx, y, wz]);
    K.cyl(w, P.stone, { h: 0.9, dt: 1.5, db: 1.7, t: 12 }, [0, 0.45, 0]); // margelle
    K.cyl(w, P.water, { h: 0.1, d: 1.25, t: 12 }, [0, 0.82, 0], { emi: 0.15 }); // surface d'eau
    for (const sx of [-1, 1]) K.cyl(w, P.woodDark, { h: 1.7, d: 0.18, t: 6 }, [sx * 0.75, 0.85 + 0.85, 0]); // poteaux de potence
    K.box(w, P.woodLight, [1.9, 0.16, 0.16], [0, 0.85 + 1.7, 0]); // traverse
    K.box(w, P.metalDark, [0.5, 0.45, 0.4], [0, 0.85 + 1.3, 0]); // seau suspendu
  }

  private addPostCollider(x: number, z: number, diameter: number): void {
    const c = this.K.cyl(null, P.dark, { h: COLLIDER_H, d: diameter, t: 8 }, [x, terrainHeight(x, z) + COLLIDER_H / 2, z]);
    c.isVisible = false;
    new PhysicsAggregate(c, PhysicsShapeType.CYLINDER, { mass: 0 }, this.scene);
  }
}
