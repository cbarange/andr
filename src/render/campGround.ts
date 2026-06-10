// ============================================================================
//  GÉOMÉTRIE DU SOL DESSINÉ DU CAMPEMENT — clairière de terre tassée (bords fluides)
//  + CHEMINS DESSINÉS (polylignes authoring de campLayout.paths). PURE & déterministe.
//  PARTAGÉE : le rendu des chemins (render/trails.ts, couche de base) et la dispersion
//  du décor du camp (campDecor.ts) s'en servent pour ÉVITER clairière nue & sentiers.
//  Voir docs/plan-campement.md.
// ============================================================================

import { campLayout, type CampPath } from "../../data/world";

export const CAMP_R = 25; // rayon de la clairière (au-delà : sol sauvage)
export const CAMP_FADE = 8; // largeur du fondu au bord (transition douce vers l'herbe)
export const PATH_W = 0.3; // demi-largeur PAR DÉFAUT (cœur PLEIN) -> ~0,6 u de cœur : sentier fin « normal »
export const PATH_EDGE = 0.28; // fondu doux/serré de chaque côté (net mais anti-crénelé) -> ~1,15 u total
export const CAMP_EARTH = [0.33, 0.27, 0.2]; // terre tassée de la clairière (chaud, sourd)
export const CAMP_PATH = [0.175, 0.135, 0.1]; // terre damée des sentiers (nettement plus sombre)

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Intensité de la clairière (1 au centre → 0 au-delà du bord), bord perturbé = contour fluide. */
export function campClearing(r: number, x: number, z: number): number {
  const wobble = (Math.sin(x * 0.16) * Math.cos(z * 0.19) + Math.sin((x - z) * 0.11)) * 2.6;
  return clamp01((CAMP_R - (r + wobble)) / CAMP_FADE);
}

/** Distance (XZ) d'un point au SEGMENT [a,b]. */
function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? clamp01(((px - ax) * dx + (pz - az) * dz) / len2) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** Intensité « chemin » [0,1] en (x,z) selon les polylignes DESSINÉES : distance au segment le plus
 *  proche, PROFIL NET (cœur plein jusqu'à `w`, fondu linéaire doux sur `PATH_EDGE`). Tracé fin et
 *  élégant à haute résolution. PURE (testable) — sert au rendu (texture) ET à l'évitement du décor. */
export function pathIntensity(x: number, z: number, paths: CampPath[]): number {
  let m = 0;
  for (const p of paths) {
    const w = p.w ?? PATH_W;
    const pts = p.pts;
    for (let i = 0; i + 1 < pts.length; i++) {
      const d = distToSeg(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      if (d < w + PATH_EDGE) {
        const v = clamp01((w + PATH_EDGE - d) / PATH_EDGE); // 1 dans le cœur, fondu jusqu'à w+EDGE
        if (v > m) m = v;
        if (m >= 1) return 1;
      }
    }
  }
  return m;
}

/** Intensité « sentier » d'une facette du camp : chemins DESSINÉS (campLayout.paths), estompés vers
 *  le bord du camp. Remplace l'ancien réseau radial procédural. */
export function campPath(r: number, x: number, z: number): number {
  if (r > CAMP_R) return 0; // hors clairière : pas de sentier
  return pathIntensity(x, z, campLayout.paths) * clamp01((CAMP_R - r) / 6);
}
