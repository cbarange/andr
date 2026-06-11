// ============================================================================
//  ROUTES (extension M9) — porté FIDÈLEMENT d'A Dark Room (`world.js` drawRoad/
//  findClosestRoad). Quand on NETTOIE un site (grotte/ville/cité) ou qu'on SÉCURISE
//  une mine, une route est tracée vers le réseau EXISTANT le plus proche (route /
//  avant-poste / village) -> les routes FUSIONNENT en réseau (au lieu de viser
//  chacune le village). PUR & déterministe (géométrique, pas de RNG) -> P2P-safe.
//  Voir docs/routes-sites.md §1.
// ============================================================================

import { worldgen } from "../../data/world";
import { siteKey, type SiteProgress } from "./state";

const R = worldgen.radiusCells;
const SR = worldgen.safeRadiusCells;
const inBounds = (cx: number, cz: number): boolean => cx >= -R && cx <= R && cz >= -R && cz <= R;
const cheb = (cx: number, cz: number): number => Math.max(Math.abs(cx), Math.abs(cz));

type Roads = Record<string, true>;
type Sites = Record<string, SiteProgress>;

/** Une cellule est-elle CONNECTIVE (route / avant-poste / village) ? `isStart` = la case qu'on relie
 *  (exclue : c'est le NOUVEAU point, comme ADR exclut l'outpost de départ). */
function connective(roads: Roads, sites: Sites, cx: number, cz: number, isStart: boolean): boolean {
  if (isStart) return false;
  if (roads[siteKey(cx, cz)]) return true; // route existante
  if (cheb(cx, cz) <= SR) return true; // village / camp central
  const s = sites[siteKey(cx, cz)];
  return !!(s && (s.cleared || s.secured)); // avant-poste : grotte nettoyée / mine sécurisée
}

/** Spirale le long des contours de Manhattan -> 1ʳᵉ cellule connective rencontrée (sinon le village
 *  (0,0)). C'est ce qui fait que les routes se BRANCHENT au plus proche -> réseau fusionné (fidèle ADR). */
function findClosestRoad(roads: Roads, sites: Sites, sx: number, sz: number): [number, number] {
  let x = 0, y = 0, dx = 1, dy = -1;
  const maxI = Math.pow(Math.abs(sx) + Math.abs(sz) + 2, 2); // borne : couvre jusqu'au village
  for (let i = 0; i < maxI; i++) {
    const cx = sx + x, cz = sz + y;
    if (inBounds(cx, cz) && connective(roads, sites, cx, cz, x === 0 && y === 0)) return [cx, cz];
    if (x === 0 || y === 0) { const t = dx; dx = -dy; dy = t; } // tourne au coin du contour
    if (x === 0 && y <= 0) x++;
    else { x += dx; y += dy; }
  }
  return [0, 0]; // repli : rien trouvé -> on rejoint le village
}

/**
 * Trace une route depuis (cx,cz) vers le réseau le plus proche (fusion) et renvoie un NOUVEAU `roads`.
 * Tracé en L (Manhattan) — segment le long de l'axe le plus long d'abord (comme ADR). On ne « route »
 * que des cellules NUES (jamais le camp ni une case de site) -> la route bute proprement sur le réseau.
 */
export function drawRoad(roads: Roads, sites: Sites, cx: number, cz: number): Roads {
  const [rx, rz] = findClosestRoad(roads, sites, cx, cz);
  const xDist = cx - rx, zDist = cz - rz;
  const xDir = Math.sign(xDist), zDir = Math.sign(zDist);
  const out: Roads = { ...roads };
  const mark = (mx: number, mz: number): void => {
    if (!inBounds(mx, mz)) return;
    if (cheb(mx, mz) <= SR) return; // jamais dans le camp
    if (sites[siteKey(mx, mz)]) return; // ne pas recouvrir une case de site (≈ « terrain nu » d'ADR)
    out[siteKey(mx, mz)] = true;
  };
  // Coin du L au croisement des deux segments (axe le plus long en premier, fidèle ADR).
  if (Math.abs(xDist) > Math.abs(zDist)) {
    for (let i = 0; i < Math.abs(xDist); i++) mark(rx + xDir * i, cz); // segment horizontal (rangée cz)
    for (let j = 0; j < Math.abs(zDist); j++) mark(rx, rz + zDir * j); // segment vertical (colonne rx)
  } else {
    for (let i = 0; i < Math.abs(xDist); i++) mark(rx + xDir * i, rz); // segment horizontal (rangée rz)
    for (let j = 0; j < Math.abs(zDist); j++) mark(cx, rz + zDir * j); // segment vertical (colonne cx)
  }
  return out;
}
