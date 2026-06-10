// ============================================================================
//  MONDE — terrain (relief + collision) + feu de camp (§5, §6, §8).
//  (Les arbres vivent désormais dans render/forest.ts ; le village dans buildings.ts.)
//  Le FEU est le cœur du jeu : foyer travaillé (lit de cendres + braises, cercle de
//  pierres varié, bûches de base + tipi calciné, flamme sculptée en couches). La taille
//  de la flamme, l'éclat des braises, la lumière et les étincelles SUIVENT le niveau de
//  feu de la sim (0 mort .. 4 rugissant). Modèle porté du labo (lab/model-lab.html → `feu`).
// ============================================================================

import {
  Scene,
  Vector3,
  Color3,
  Color4,
  TransformNode,
  Mesh,
  PointLight,
  ParticleSystem,
  DynamicTexture,
  Texture,
} from "@babylonjs/core";
import { terrainHeight } from "../../data/world";
import { PALETTE } from "./scene";
import { makeKit, P } from "./lowpoly";

export interface World {
  /** Règle l'intensité/échelle du feu selon le niveau de la sim (0 mort .. 4 rugissant). M1. */
  setFireLevel(level: number): void;
  /** Animations purement visuelles (scintillement du feu). */
  update(dtSec: number): void;
}

/** Petite texture disque (dégradé radial) pour les étincelles. */
function discTexture(scene: Scene): Texture {
  const t = new DynamicTexture("sparkTex", { width: 32, height: 32 }, scene, false);
  const c = t.getContext();
  const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 32, 32);
  t.hasAlpha = true;
  t.update();
  return t;
}

function createCampfire(scene: Scene): {
  setFireLevel: (level: number) => void;
  update: (dt: number) => void;
} {
  const K = makeKit(scene);
  const gy = terrainHeight(0, 0);
  const root = K.node(null);
  root.position.set(0, gy, 0);

  const char = [0.1, 0.09, 0.085], ash = [0.17, 0.16, 0.15];
  const yellow = [1.0, 0.86, 0.4], coreC = [1.0, 0.95, 0.72], deep = [0.82, 0.22, 0.08], bark2 = [0.24, 0.17, 0.12];

  // --- LIT : sol calciné + cendres (légèrement bombé) ---
  K.cyl(root, ash, { h: 0.07, dt: 2.0, db: 2.2, t: 18 }, [0, 0.035, 0]);
  K.cyl(root, char, { h: 0.07, dt: 1.4, db: 1.6, t: 16 }, [0, 0.085, 0]);

  // --- CERCLE DE PIERRES : TOUS des CAILLOUX (ico aux proportions variées), légèrement enterrés ---
  const N = 9;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + Math.sin(i * 2.3) * 0.09;
    const r = 1.06 + Math.sin(i * 1.7) * 0.07;
    const s = 0.46 + Math.abs(Math.sin(i * 3.1)) * 0.24;
    const col = i % 3 === 0 ? P.stoneDark : i % 3 === 1 ? P.stone : [0.29, 0.32, 0.34];
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const sy = 0.72 + 0.22 * Math.sin(i * 1.9), sxz = 0.9 + 0.18 * Math.cos(i * 2.7); // galet plus ou moins aplati/allongé
    K.ico(root, col, { d: s, sub: 1 }, [x, s * 0.28, z], { rot: [Math.sin(i * 1.3) * 0.4, a, Math.cos(i * 2.1) * 0.3], scale: [sxz, sy, 1] });
    if (i % 3 === 0) K.ico(root, P.stoneDark, { d: s * 0.5, sub: 1 }, [x * 0.85, s * 0.16, z * 0.85], { rot: [0.2, a, 0.3], scale: [1, 0.7, 1] });
  }

  // --- BÛCHES : 3 grands RONDINS traversants à 60° -> ÉTOILE à 6 branches, symétrique, un seul niveau ---
  const lly = 0.22, lh = 1.3, ld = 0.2; // 3 bûches pleines centrées -> 6 bouts qui dépassent
  const woods = [P.trunk, bark2, [0.31, 0.22, 0.15]];
  for (let i = 0; i < 3; i++) {
    const n = K.node(root, [0, lly, 0]);
    n.rotation.y = i * Math.PI / 3;
    K.cyl(n, woods[i], { h: lh, d: ld, t: 7 }, [0, 0, 0], { rot: [Math.PI / 2, 0, 0] }); // rondin couché, orienté à i×60°
  }

  // --- BRAISES (cœur incandescent) : node à part -> éteint quand le feu est mort ---
  const embers = K.node(root, [0, 0, 0]);
  for (let i = 0; i < 8; i++) {
    const a = i * 2.39, r = 0.18 + (i % 3) * 0.2;
    K.box(embers, i % 2 ? P.ember : P.emberHot, [0.17, 0.1, 0.17], [Math.cos(a) * r, 0.12, Math.sin(a) * r], { emi: 1.5, unlit: true, rot: [0, a, 0] });
  }

  // --- FLAMME sculptée (node mis à l'échelle/animé) : corps profond -> orange -> jaune -> cœur + langues ---
  const flame = K.node(root, [0, 0.34, 0]);
  K.ico(flame, deep, { d: 0.72, sub: 1 }, [0, 0.24, 0], { emi: 1.5, unlit: true, scale: [1, 1.55, 1] });
  K.cone(flame, P.fire, { h: 1.05, d: 0.62, t: 6 }, [0, 0.56, 0], { emi: 1.9, unlit: true });
  const t2 = K.cone(flame, yellow, { h: 0.72, d: 0.36, t: 6 }, [0.05, 0.9, -0.02], { emi: 2.3, unlit: true });
  const t3 = K.cone(flame, coreC, { h: 0.42, d: 0.2, t: 5 }, [-0.03, 1.12, 0.03], { emi: 2.7, unlit: true });
  const sL = K.cone(flame, P.fire, { h: 0.5, d: 0.24, t: 5 }, [-0.24, 0.5, 0.08], { emi: 1.9, unlit: true, rot: [0, 0, 0.42] });
  const sR = K.cone(flame, P.fire, { h: 0.46, d: 0.22, t: 5 }, [0.24, 0.48, -0.06], { emi: 1.9, unlit: true, rot: [0, 0, -0.46] });

  // --- Lumière chaude ponctuelle ---
  const light = new PointLight("fireLight", new Vector3(0, 1.1, 0), scene);
  light.parent = root;
  light.diffuse = PALETTE.fire.clone();
  light.specular = new Color3(0, 0, 0);
  light.intensity = 1.4;
  light.range = 22;

  // --- Étincelles (montent du foyer) : débit selon le niveau ---
  const sparks = new ParticleSystem("fireSparks", 90, scene);
  sparks.particleTexture = discTexture(scene);
  sparks.emitter = new Vector3(0, gy + 0.7, 0);
  sparks.minEmitBox = new Vector3(-0.18, 0, -0.18);
  sparks.maxEmitBox = new Vector3(0.18, 0.15, 0.18);
  sparks.color1 = new Color4(1.0, 0.7, 0.25, 1);
  sparks.color2 = new Color4(1.0, 0.4, 0.12, 1);
  sparks.colorDead = new Color4(0.4, 0.12, 0.05, 0);
  sparks.minSize = 0.06; sparks.maxSize = 0.18;
  sparks.minLifeTime = 0.4; sparks.maxLifeTime = 0.9;
  sparks.emitRate = 0;
  sparks.gravity = new Vector3(0, 2.8, 0);
  sparks.direction1 = new Vector3(-0.3, 1, -0.3);
  sparks.direction2 = new Vector3(0.3, 1.5, 0.3);
  sparks.minEmitPower = 0.5; sparks.maxEmitPower = 1.1;
  sparks.blendMode = ParticleSystem.BLENDMODE_ADD;
  sparks.start();

  // Scintillement (visuel uniquement -> trigonométrie, pas d'aléatoire de logique).
  // La TAILLE de la flamme, l'éclat des braises, la lumière et les étincelles suivent le niveau (M1).
  let time = 0;
  let level = 0; // 0 mort .. 4 rugissant
  const setEnabled = (n: TransformNode, on: boolean): void => { if (n.isEnabled() !== on) n.setEnabled(on); };
  return {
    setFireLevel: (l: number) => { level = l; },
    update: (dt: number) => {
      time += dt;
      const lit = level > 0;
      setEnabled(flame, lit);
      setEnabled(embers, lit);
      const flicker = 0.9 + 0.1 * Math.sin(time * 11) + 0.05 * Math.sin(time * 7.3);
      light.intensity = (lit ? 0.4 + level * 0.34 : 0.04) * flicker;
      sparks.emitRate = lit ? 8 + level * 16 : 0;
      if (lit) {
        // taille de la flamme selon le niveau (niveau 3 « ardent » ≈ pleine taille du modèle).
        const s = (0.5 + level * 0.16) * flicker;
        flame.scaling.set(s, s * (1 + 0.06 * Math.sin(time * 9)), s);
        flame.rotation.y = Math.sin(time * 2.5) * 0.06;
        (t2 as Mesh).rotation.z = Math.sin(time * 7) * 0.13;
        (t3 as Mesh).rotation.z = Math.sin(time * 11 + 2) * 0.2;
        (sL as Mesh).scaling.y = 1 + Math.sin(time * 13) * 0.22;
        (sR as Mesh).scaling.y = 1 + Math.sin(time * 13 + 2) * 0.22;
      }
    },
  };
}

export function createWorld(scene: Scene): World {
  // Le SOL est désormais streamé par chunks (render/terrain.ts) ; ici, seulement le feu.
  const fire = createCampfire(scene);
  return {
    setFireLevel(level: number) {
      fire.setFireLevel(level);
    },
    update(dtSec: number) {
      fire.update(dtSec);
    },
  };
}
