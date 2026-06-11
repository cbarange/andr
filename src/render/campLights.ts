// ============================================================================
//  LANTERNES DU CAMP (Chantier C — E) — le village s'ENRICHIT avec le palier de
//  cabane : des lanternes s'allument le long des sentiers quand la cabane est
//  améliorée (palier ≥ 5), plus nombreuses à l'entrepôt (palier ≥ 10).
//
//  Purement VISUEL & LOCAL (comme le décor / les villageois) : aucune règle de
//  jeu, aucun réseau, aucun déterminisme requis. Les lampes sont ÉMISSIVES (glow
//  via le bloom déjà en place) — pas de PointLight (trop coûteux en nombre).
//  Positions échantillonnées le long des sentiers de `campLayout.paths` (couloirs
//  ouverts -> pas de chevauchement avec les bâtiments). Voir docs/refonte-monde-campement.md §E.
// ============================================================================

import { Scene, TransformNode } from "@babylonjs/core";
import { terrainHeight, campLayout } from "../../data/world";
import { makeKit, P, type Kit } from "./lowpoly";

const INTERVAL = 6.5; // distance (u) entre deux lanternes le long d'un sentier
const FIRE_CLEAR = 4.5; // pas de lanterne trop près du foyer (le feu éclaire déjà)

export class CampLights {
  private readonly K: Kit;
  private readonly node: TransformNode;
  private readonly lamps: Array<{ root: TransformNode; minTier: number }> = [];
  private tier = -1; // dernier palier appliqué (-1 = rien encore)
  private hidden = false;

  constructor(scene: Scene) {
    this.K = makeKit(scene);
    this.node = new TransformNode("campLights", scene);
    this.build();
    this.apply(0); // tout éteint au départ (cabane en ruine / réparée)
  }

  /** Échantillonne les sentiers et pose une lanterne tous les INTERVAL ; palier alterné 5/10. */
  private build(): void {
    let idx = 0;
    for (const path of campLayout.paths) {
      let acc = INTERVAL * 0.5;
      for (let i = 0; i < path.pts.length - 1; i++) {
        const [ax, az] = path.pts[i];
        const [bx, bz] = path.pts[i + 1];
        const segLen = Math.hypot(bx - ax, bz - az) || 1e-4;
        let d = acc;
        while (d < segLen) {
          const t = d / segLen;
          const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
          if (Math.hypot(x, z) > FIRE_CLEAR) {
            this.addLantern(x, z, idx % 2 === 0 ? 5 : 10); // moitié dès le palier 5, le reste à 10
            idx++;
          }
          d += INTERVAL;
        }
        acc = d - segLen; // report du reste sur le segment suivant (espacement régulier)
      }
    }
  }

  /** Une lanterne sur poteau : montant bois + potence + cage métal + flamme émissive (glow). */
  private addLantern(x: number, z: number, minTier: number): void {
    const K = this.K;
    const root = K.node(this.node, [x, terrainHeight(x, z), z]);
    root.rotation.y = (x * 1.3 + z * 0.7) % (Math.PI * 2); // léger désordre déterministe
    K.cyl(root, P.woodDark, { h: 2.2, d: 0.12, t: 6 }, [0, 1.1, 0]); // montant
    K.box(root, P.metalDark, [0.46, 0.07, 0.07], [0.17, 2.16, 0]); // potence
    const lamp = K.node(root, [0.34, 2.0, 0]);
    K.box(lamp, P.metalDark, [0.04, 0.28, 0.04], [-0.09, 0.02, 0]); // arête de cage
    K.box(lamp, P.metalDark, [0.04, 0.28, 0.04], [0.09, 0.02, 0]);
    K.box(lamp, P.emberHot, [0.12, 0.18, 0.12], [0, 0, 0], { emi: 1.3, unlit: true }); // flamme (bloom)
    K.box(lamp, P.metalDark, [0.22, 0.05, 0.22], [0, 0.17, 0]); // chapeau
    K.box(lamp, P.metalDark, [0.18, 0.04, 0.18], [0, -0.16, 0]); // socle
    this.lamps.push({ root, minTier });
  }

  /** Allume/éteint les lanternes selon le palier de cabane (idempotent : no-op si inchangé). */
  setTier(tier: number): void {
    if (tier === this.tier) return;
    this.apply(tier);
  }

  /** Masque TOUTES les lanternes (éditeur de spawn) sans perdre le palier courant. */
  setVisible(v: boolean): void {
    this.hidden = !v;
    this.apply(this.tier < 0 ? 0 : this.tier);
  }

  private apply(tier: number): void {
    this.tier = tier;
    for (const l of this.lamps) l.root.setEnabled(!this.hidden && tier >= l.minTier);
  }
}
