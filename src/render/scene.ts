// ============================================================================
//  MOTEUR + SCÈNE — §2 (WebGPU prioritaire, repli WebGL2) et §5 (style visuel).
//  Lumières douces, brouillard (ambiance + perf), post-processing léger.
// ============================================================================

import {
  AbstractEngine,
  Engine,
  WebGPUEngine,
  Scene,
  Color3,
  Color4,
  Vector3,
  Camera,
  HemisphericLight,
  DirectionalLight,
  DefaultRenderingPipeline,
} from "@babylonjs/core";

export type RendererLabel = "webgpu" | "webgl2";

export interface EngineInfo {
  engine: AbstractEngine;
  rendererLabel: RendererLabel;
}

// Palette restreinte, crépusculaire / froide (§5). Source de vérité des couleurs.
export const PALETTE = {
  fog: new Color3(0.17, 0.23, 0.27),
  ground: new Color3(0.18, 0.3, 0.27), // = sol du CAMP (biome `camp`)
  groundLow: new Color3(0.09, 0.16, 0.19),
  trunk: new Color3(0.24, 0.17, 0.13),
  foliage: new Color3(0.2, 0.45, 0.36),
  fire: new Color3(1.0, 0.55, 0.2),
  player: new Color3(0.88, 0.8, 0.62),
  remote: new Color3(0.55, 0.74, 0.96),
  // M7 — sols par biome (dégradé bas->haut selon l'altitude), cohérents avec la palette froide.
  forestGround: new Color3(0.13, 0.25, 0.19),
  forestGroundLow: new Color3(0.07, 0.13, 0.11),
  fieldGround: new Color3(0.3, 0.36, 0.2),
  fieldGroundLow: new Color3(0.17, 0.22, 0.13),
  barrenGround: new Color3(0.27, 0.25, 0.21),
  barrenGroundLow: new Color3(0.15, 0.14, 0.12),
};

/** Crée le moteur : WebGPU si supporté, sinon repli automatique WebGL2 (§2, §11). */
export async function createEngine(canvas: HTMLCanvasElement): Promise<EngineInfo> {
  try {
    if (await WebGPUEngine.IsSupportedAsync) {
      const engine = new WebGPUEngine(canvas, {
        antialias: true,
        stencil: true,
      });
      await engine.initAsync();
      return { engine, rendererLabel: "webgpu" };
    }
  } catch (err) {
    console.warn("[engine] WebGPU indisponible, repli WebGL2 :", err);
  }
  const engine = new Engine(canvas, true, {
    stencil: true,
    preserveDrawingBuffer: true, // utile pour les captures d'écran (Playwright)
    powerPreference: "high-performance",
  });
  return { engine, rendererLabel: "webgl2" };
}

/** Scène : couleur de fond, brouillard exp2, lumière directionnelle + ambiante (§5). */
export function createScene(engine: AbstractEngine): Scene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(PALETTE.fog.r, PALETTE.fog.g, PALETTE.fog.b, 1);

  // Brouillard : ambiance + masque le lointain. DÉSACTIVÉ PAR DÉFAUT (réactivable via le
  //  switch « brouillard » du HUD debug). Couleur + densité restent configurées pour que
  //  l'activation et l'ajustement « view range » fonctionnent immédiatement.
  scene.fogMode = Scene.FOGMODE_NONE;
  scene.fogColor = PALETTE.fog.clone();
  scene.fogDensity = 0.028;

  // Lumière ambiante douce (ciel/sol). Volontairement basse -> ambiance crépusculaire,
  // et laisse le feu de camp « ressortir ».
  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.4;
  hemi.diffuse = new Color3(0.62, 0.74, 0.88);
  hemi.groundColor = new Color3(0.1, 0.14, 0.16);

  // Lumière directionnelle douce (soleil bas, crépusculaire).
  const sun = new DirectionalLight("sun", new Vector3(-0.55, -1, -0.4), scene);
  sun.position = new Vector3(30, 50, 30);
  sun.intensity = 0.9;
  sun.diffuse = new Color3(1.0, 0.9, 0.78);

  return scene;
}

/** Post-processing léger (§5) : color grading, vignettage, grain, FXAA, bloom (lueur du feu). */
export function setupPostProcess(scene: Scene, camera: Camera): DefaultRenderingPipeline {
  const pipe = new DefaultRenderingPipeline("default", true, scene, [camera]);

  pipe.fxaaEnabled = true;

  // Color grading via image processing (pas de LUT lourde).
  pipe.imageProcessingEnabled = true;
  pipe.imageProcessing.contrast = 1.2;
  pipe.imageProcessing.exposure = 1.05;
  pipe.imageProcessing.toneMappingEnabled = true;

  // Vignettage.
  pipe.imageProcessing.vignetteEnabled = true;
  pipe.imageProcessing.vignetteWeight = 2.5;
  pipe.imageProcessing.vignetteColor = new Color4(0, 0.01, 0.03, 0);

  // Grain léger animé.
  pipe.grainEnabled = true;
  pipe.grain.intensity = 7;
  pipe.grain.animated = true;

  // Bloom discret pour faire « luire » le feu de camp émissif.
  pipe.bloomEnabled = true;
  pipe.bloomThreshold = 0.75;
  pipe.bloomWeight = 0.35;
  pipe.bloomScale = 0.5;

  return pipe;
}
