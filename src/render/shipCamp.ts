// ============================================================================
//  LE VAISSEAU AU CAMP (M11/RF1b) — l'engin d'évasion « ramené à la base » (fidèle ADR :
//  l'onglet « An Old Starship » se gère depuis le village). Une fois l'épave TROUVÉE
//  (`ship_found`), un vaisseau wanderer low-poly apparaît à une ancre du camp et
//  S'ASSEMBLE au fil de la coque réparée (pattern `reveal` de la cabane). Purement visuel :
//  la règle (réparer/décoller) vit dans la sim ; ici on REFLÈTE `state.ship`.
// ============================================================================

import { Scene, TransformNode } from "@babylonjs/core";
import { makeKit, P, type Kit } from "./lowpoly";
import { terrainHeight, SHIP } from "../../data/world";
import { prepareReveal, applyReveal, type RevealEl } from "./reveal";

export class ShipAtCamp {
  private readonly K: Kit;
  private readonly root: TransformNode;
  private parts: RevealEl[] = [];
  private prevP = -1;
  private prevVisible = false;

  constructor(scene: Scene, readonly x: number, readonly z: number) {
    this.K = makeKit(scene);
    this.root = this.K.node(null, [x, terrainHeight(x, z), z]);
    this.root.rotation.y = Math.atan2(-x, -z); // proue tournée vers le cœur du camp (modèles face +Z)
    this.build();
    this.parts = prepareReveal(this.root); // mesuré pendant qu'il est ENABLED (avant de masquer)
    this.root.setEnabled(false);
  }

  /** Position-monde de l'ancre (pour le focus « examiner le vaisseau » et le décollage). */
  worldPos(): { x: number; z: number } {
    return { x: this.x, z: this.z };
  }

  /**
   * Reflète l'état : ENTIÈREMENT VISIBLE dès que le vaisseau est TROUVÉ (sauf pendant un décollage — la
   * cinématique `liftoff.ts` prend le relais). La réparation (`hull`) est un état de VOL, pas de
   * visibilité (avant, l'assemblage progressif rendait le vaisseau quasi invisible non réparé — bug
   * playtest « modèle inexistant »). On garde juste un léger fini selon la coque (90 % → 100 %).
   */
  sync(visible: boolean, hull: number): void {
    if (visible !== this.prevVisible) { this.root.setEnabled(visible); this.prevVisible = visible; }
    if (!visible) return;
    const p = 0.9 + 0.1 * Math.min(1, hull / Math.max(1, SHIP.hullMax)); // toujours >= 90 % visible
    if (Math.abs(p - this.prevP) < 0.001) return;
    this.prevP = p;
    applyReveal(this.parts, p);
  }

  /** Léger flottement/respiration cosmétique (vie). */
  update(_dtSec: number): void {
    if (!this.prevVisible) return;
    this.root.position.y = terrainHeight(this.x, this.z) + Math.sin(performance.now() * 0.0015) * 0.04;
  }

  // --------------------------------------------------------------------------

  private build(): void {
    const K = this.K, root = this.root;
    // Langage visuel « wanderer » alien (cf. executioner) à PETITE échelle : coque teal facettée,
    // veines/accents émissifs cyan (+ violet/magenta ponctuels), nervures d'alliage, verrière cyan,
    // ailes forward-swept, nacelle de poussée, mât-capteur, et 4 trains qui posent l'engin au sol.
    const hull = [0.22, 0.34, 0.4], hullDk = [0.14, 0.22, 0.26], alloy = P.alienAlloy,
      cyan = [0.45, 0.95, 0.9], cyanHot = [0.72, 1.0, 0.97], violet = [0.62, 0.42, 0.92], magenta = P.alienBoss,
      scorch = P.scorch;

    // ── FUSELAGE — fuseau hexagonal effilé le long de +Z (échelle conservée ~4u) + ventre + nez.
    K.cyl(root, hull, { h: 4.0, dt: 0.7, db: 1.12, t: 6 }, [0, 1.5, 0], { rot: [Math.PI / 2, 0, 0] });
    K.cyl(root, hullDk, { h: 3.6, dt: 0.42, db: 0.78, t: 6 }, [0, 1.18, -0.1], { rot: [Math.PI / 2, 0, 0] }); // ventre / quille
    K.cone(root, hullDk, { h: 1.5, d: 0.74, t: 6 }, [0, 1.52, 2.65], { rot: [Math.PI / 2, 0, 0] }); // nez facetté
    K.cone(root, alloy, { h: 0.45, d: 0.16, t: 6 }, [0, 1.52, 3.42], { rot: [Math.PI / 2, 0, 0] }); // sonde de proue
    // Nervures / coutures de plaques le long du dos (anneaux d'alliage).
    for (const z of [1.7, 0.7, -0.4, -1.4]) K.cyl(root, alloy, { h: 0.08, dt: 1.0, db: 1.14, t: 6 }, [0, 1.5, z], { rot: [Math.PI / 2, 0, 0] });
    K.cyl(root, alloy, { h: 0.16, d: 1.18, t: 6 }, [0, 1.5, 0.55], { rot: [Math.PI / 2, 0, 0] }); // ceinture maîtresse
    K.cyl(root, cyan, { h: 0.1, d: 1.22, t: 6 }, [0, 1.5, 0.55], { rot: [Math.PI / 2, 0, 0], emi: 1.2, unlit: true }); // bandeau lumineux
    // Veines de flanc émissives (cyan).
    for (const sx of [1, -1]) K.box(root, cyan, [0.05, 0.05, 3.2], [sx * 0.58, 1.45, 0.1], { emi: 1.2, unlit: true });

    // ── COCKPIT / VERRIÈRE — encadrement d'alliage + bulle de verre cyan reconnaissable, vers l'avant.
    K.box(root, alloy, [0.66, 0.34, 1.05], [0, 1.86, 1.28], { rot: [-0.12, 0, 0] }); // socle de cabine
    K.sph(root, cyanHot, { d: 0.78, seg: 8 }, [0, 2.04, 1.42], { scale: [0.78, 0.62, 1.3], emi: 1.5, unlit: true }); // canopée
    K.box(root, alloy, [0.05, 0.3, 1.0], [0, 2.05, 1.4], { rot: [-0.12, 0, 0] }); // arête centrale de verrière
    for (const sx of [1, -1]) K.box(root, alloy, [0.05, 0.26, 0.85], [sx * 0.3, 1.96, 1.42], { rot: [-0.12, 0, 0] }); // montants latéraux

    // ── AILES forward-swept (symétriques) : plan d'aile facetté + bord d'attaque + veine + feu de bout d'aile + canon-pylône.
    for (const sx of [1, -1]) {
      const w = K.node(root, [sx * 1.05, 1.32, -0.15]); w.rotation.set(0, sx * -0.34, sx * -0.06);
      K.box(w, hull, [1.8, 0.12, 1.15], [sx * 0.6, 0, 0]); // plan d'aile
      K.box(w, hullDk, [1.85, 0.06, 0.18], [sx * 0.62, 0.02, 0.52], { rot: [0, 0, 0] }); // bord d'attaque
      K.box(w, cyan, [1.55, 0.05, 0.08], [sx * 0.6, 0.08, 0.05], { emi: 1.1, unlit: true }); // veine
      K.ico(w, cyanHot, { d: 0.2 }, [sx * 1.42, 0.04, 0.1], { emi: 1.6, unlit: true }); // feu de bout d'aile
      K.cyl(w, alloy, { h: 0.9, d: 0.12, t: 5 }, [sx * 0.55, -0.12, 0.55], { rot: [Math.PI / 2, 0, 0] }); // pylône / mini-canon
      K.cyl(w, violet, { h: 0.1, d: 0.14, t: 5 }, [sx * 0.55, -0.12, 1.05], { rot: [Math.PI / 2, 0, 0], emi: 1.5, unlit: true });
    }
    // Petits canards avant (stabilisateurs) émissifs.
    for (const sx of [1, -1]) K.box(root, hullDk, [0.6, 0.06, 0.32], [sx * 0.62, 1.55, 1.7], { rot: [0, sx * 0.4, 0] });

    // ── DÉRIVE dorsale + petits ailerons de queue en V.
    K.box(root, hull, [0.12, 1.05, 1.15], [0, 2.12, -1.5]);
    K.box(root, cyan, [0.06, 0.95, 0.06], [0, 2.12, -1.05], { emi: 1.1, unlit: true }); // bord lumineux de dérive
    for (const sx of [1, -1]) K.box(root, hullDk, [0.1, 0.7, 0.6], [sx * 0.4, 1.85, -1.6], { rot: [0, 0, sx * 0.55] });
    // Épine dorsale à nodules cyan (du cockpit vers la poupe).
    for (let i = 0; i < 4; i++) K.sph(root, cyan, { d: 0.12 }, [0, 1.9, 0.6 - i * 0.55], { emi: 1.5, unlit: true });

    // ── DRIVE arrière : carter d'alliage + tuyère cerclée à cœur violet/cyan + 2 petites nacelles latérales.
    K.cyl(root, alloy, { h: 0.55, dt: 0.86, db: 0.96, t: 6 }, [0, 1.5, -2.15], { rot: [Math.PI / 2, 0, 0] }); // carter
    K.tor(root, alloy, { d: 0.96, thick: 0.08, t: 12 }, [0, 1.5, -2.4], { rot: [Math.PI / 2, 0, 0] }); // cerclage
    K.cyl(root, violet, { h: 0.2, dt: 0.3, db: 0.74, t: 8 }, [0, 1.5, -2.55], { rot: [Math.PI / 2, 0, 0], emi: 1.5, unlit: true }); // halo violet
    K.cyl(root, cyanHot, { h: 0.12, d: 0.42, t: 8 }, [0, 1.5, -2.68], { rot: [Math.PI / 2, 0, 0], emi: 2.0, unlit: true }); // cœur cyan
    for (const sx of [1, -1]) {
      K.cyl(root, alloy, { h: 0.7, dt: 0.26, db: 0.34, t: 6 }, [sx * 0.66, 1.32, -1.95], { rot: [Math.PI / 2, 0, 0] }); // nacelle
      K.cyl(root, cyan, { h: 0.08, d: 0.3, t: 6 }, [sx * 0.66, 1.32, -2.32], { rot: [Math.PI / 2, 0, 0], emi: 1.7, unlit: true });
    }

    // ── MÂT-CAPTEUR / antenne (dôme + tige) sur le dos, derrière la verrière.
    K.cyl(root, alloy, { h: 0.55, d: 0.05, t: 5 }, [0.22, 2.2, 0.5], { rot: [0.15, 0, -0.1] });
    K.ico(root, cyan, { d: 0.12 }, [0.27, 2.5, 0.46], { emi: 1.6, unlit: true });
    K.ico(root, alloy, { d: 0.26 }, [-0.2, 2.0, 0.2]); K.ico(root, cyan, { d: 0.1 }, [-0.2, 2.12, 0.28], { emi: 1.5, unlit: true }); // dôme capteur

    // ── ÉCOUTILLE / rampe d'embarquement (indice) sur le flanc droit, sous l'aile.
    K.box(root, hullDk, [0.04, 0.6, 0.9], [0.56, 1.32, 0.55], { rot: [0, 0, 0] }); // sas (panneau encadré)
    K.box(root, alloy, [0.05, 0.62, 0.06], [0.56, 1.32, 0.12]); K.box(root, alloy, [0.05, 0.62, 0.06], [0.56, 1.32, 0.98]);
    K.box(root, cyan, [0.05, 0.04, 0.7], [0.57, 1.05, 0.55], { emi: 1.0, unlit: true }); // liseré bas de rampe
    K.box(root, hull, [0.5, 0.04, 0.85], [0.62, 0.62, 0.55], { rot: [0, 0, -0.55] }); // rampe abaissée au sol

    // ── TRAINS D'ATTERRISSAGE (4 béquilles) : jambe d'alloy + vérin + sabot + petit feu de pied.
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const f = K.node(root, [sx * 0.78, 1.05, sz * 1.25]); f.rotation.set(sz * 0.16, 0, sx * 0.2);
      K.cyl(f, alloy, { h: 0.55, d: 0.1, t: 5 }, [0, -0.05, 0]); // logement
      K.cyl(f, hullDk, { h: 0.95, d: 0.13, t: 5 }, [0, -0.62, 0]); // jambe
      K.box(f, alloy, [0.32, 0.07, 0.4], [0, -1.12, 0]); // sabot
      K.ico(f, cyan, { d: 0.08 }, [0, -1.12, 0.16], { emi: 1.4, unlit: true }); // feu de pied
    }
    // Légère trace de roussi sous le ventre (vaisseau qui a vécu un crash).
    K.cyl(root, scorch, { h: 0.02, d: 1.3, t: 10 }, [0, 0.42, -0.2], { scale: [1.1, 1, 1.6], unlit: true });
  }
}
