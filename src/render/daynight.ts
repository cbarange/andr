// ============================================================================
//  CYCLE JOUR/NUIT (présentation — Chantier D). Ambiance COSMÉTIQUE : aucune incidence sur la
//  simulation ni l'équilibrage. Pour « A Dark Room », l'alternance lumière/obscurité renforce le
//  thème du feu et de la survie.
//
//  Contraintes d'intégration (sûreté) :
//   - On NE TOUCHE JAMAIS aux INTENSITÉS de `hemi`/`sun` : elles sont possédées par les intérieurs
//     (interior.ts / shipInterior.ts les baissent sous un plafond, en capturant la base à la
//     construction). On n'agit que sur les COULEURS + la direction du soleil + l'EXPOSITION (post-proc).
//   - L'écriture du CIEL (clearColor/fog) est COUPÉE pendant le décollage (le décollage possède le ciel
//     « espace »). Cf. `skySuppressed`.
//   - La phase est dérivée du `tick` de sim -> COHÉRENTE en co-op (présentation lisant l'état, admis),
//     sans aléatoire ni horloge murale.
//
//  Palette CRÉPUSCULAIRE (jamais de plein jour ensoleillé — fidèle au ton du jeu) : nuit profonde ->
//  aube violacée -> « jour » crépusculaire (≈ l'aspect de base) -> crépuscule orangé -> nuit. Cyclique.
// ============================================================================

import { DirectionalLight, HemisphericLight, Scene, type DefaultRenderingPipeline } from "@babylonjs/core";

const DAY_TICKS = 7 * 60 * 20; // ~7 min réelles par cycle complet (20 Hz)

interface Phase {
  at: number; // position dans le cycle [0,1)
  sky: [number, number, number];
  hemiD: [number, number, number];
  hemiG: [number, number, number];
  sunD: [number, number, number];
  sunDir: [number, number, number];
  exposure: number;
}

const PHASES: Phase[] = [
  { at: 0.0, sky: [0.06, 0.09, 0.14], hemiD: [0.38, 0.48, 0.66], hemiG: [0.05, 0.07, 0.10], sunD: [0.45, 0.52, 0.72], sunDir: [-0.30, -1, -0.50], exposure: 0.80 }, // nuit
  { at: 0.25, sky: [0.20, 0.21, 0.27], hemiD: [0.60, 0.62, 0.78], hemiG: [0.10, 0.12, 0.15], sunD: [0.95, 0.78, 0.66], sunDir: [-0.78, -0.50, -0.30], exposure: 0.98 }, // aube
  { at: 0.5, sky: [0.18, 0.26, 0.30], hemiD: [0.66, 0.78, 0.90], hemiG: [0.10, 0.14, 0.16], sunD: [1.0, 0.93, 0.80], sunDir: [-0.20, -1, -0.35], exposure: 1.10 }, // jour (crépusculaire)
  { at: 0.75, sky: [0.24, 0.16, 0.18], hemiD: [0.72, 0.60, 0.62], hemiG: [0.12, 0.10, 0.10], sunD: [1.0, 0.62, 0.40], sunDir: [0.70, -0.50, -0.30], exposure: 0.96 }, // crépuscule
];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class DayNight {
  private readonly sun: DirectionalLight | null;
  private readonly hemi: HemisphericLight | null;

  constructor(private readonly scene: Scene, private readonly pipe: DefaultRenderingPipeline | null) {
    this.sun = scene.getLightByName("sun") as DirectionalLight | null;
    this.hemi = scene.getLightByName("hemi") as HemisphericLight | null;
  }

  /** À appeler chaque frame. `skySuppressed` = vrai pendant le décollage (le ciel « espace » prime). */
  update(tick: number, skySuppressed: boolean): void {
    const phase = ((tick / DAY_TICKS + 0.5) % 1 + 1) % 1; // +0.5 -> démarre sur le « jour » crépusculaire familier
    let i = 0;
    for (let k = 0; k < PHASES.length; k++) if (phase >= PHASES[k].at) i = k;
    const a = PHASES[i];
    const b = PHASES[(i + 1) % PHASES.length];
    const span = (((b.at - a.at) % 1) + 1) % 1 || 1; // distance cyclique a->b
    const t = ((((phase - a.at) % 1) + 1) % 1) / span;
    const m = (x: [number, number, number], y: [number, number, number], j: number): number => lerp(x[j], y[j], t);

    if (!skySuppressed) {
      this.scene.clearColor.set(m(a.sky, b.sky, 0), m(a.sky, b.sky, 1), m(a.sky, b.sky, 2), 1);
      this.scene.fogColor.set(m(a.sky, b.sky, 0), m(a.sky, b.sky, 1), m(a.sky, b.sky, 2));
    }
    if (this.hemi) {
      this.hemi.diffuse.set(m(a.hemiD, b.hemiD, 0), m(a.hemiD, b.hemiD, 1), m(a.hemiD, b.hemiD, 2));
      this.hemi.groundColor.set(m(a.hemiG, b.hemiG, 0), m(a.hemiG, b.hemiG, 1), m(a.hemiG, b.hemiG, 2));
    }
    if (this.sun) {
      this.sun.diffuse.set(m(a.sunD, b.sunD, 0), m(a.sunD, b.sunD, 1), m(a.sunD, b.sunD, 2));
      this.sun.direction.set(m(a.sunDir, b.sunDir, 0), m(a.sunDir, b.sunDir, 1), m(a.sunDir, b.sunDir, 2));
    }
    if (this.pipe) this.pipe.imageProcessing.exposure = lerp(a.exposure, b.exposure, t);
  }
}
