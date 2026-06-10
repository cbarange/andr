// ============================================================================
//  PALIERS LOD DES PROPS (perf, P3) — décision PURE (aucune dépendance Babylon ->
//  testable au terminal comme entities.ts). Un chunk a un palier `near`/`far` selon
//  sa distance (en chunks) au joueur :
//   - near : pleine densité, TOUT le décor (y compris le petit), arbres COUPABLES ;
//   - far  : petit décor masqué + arbres éclaircis (~50 %) + non coupables.
//  Le sol (mesh) reste visible dans les deux cas (cf. terrain.ts) ; seul le décor s'allège.
//  Voir docs/perf-rendu.md (P3).
// ============================================================================

export type PropBand = "near" | "far";

// Petit décor « tapis de sol » : invisible au loin (gain d'instances sans changer la
// silhouette du paysage, portée par les arbres/rochers qui restent affichés).
const SMALL_DECOR = new Set(["grass", "fern", "mushroom", "flower", "drybush", "reed", "bones"]);

export const PROP_NEAR_R = 1; // ≤ 1 chunk -> palier "near"
export const PROP_HYST = 1; // hystérésis (chunks) pour éviter le va-et-vient à la frontière

/** Palier de props d'un chunk selon sa distance (en chunks, chebyshev) au joueur, avec hystérésis. */
export function propBandFor(chunkDist: number, current: PropBand): PropBand {
  if (current === "near") return chunkDist <= PROP_NEAR_R + PROP_HYST ? "near" : "far";
  return chunkDist <= PROP_NEAR_R ? "near" : "far";
}

/** Faut-il instancier ce prop dans ce palier ? `treeIndex` = rang de l'arbre dans le chunk. */
export function keepProp(kind: string, band: PropBand, treeIndex: number): boolean {
  if (band === "near") return true;
  if (SMALL_DECOR.has(kind)) return false; // petit décor masqué au loin
  if (kind === "tree") return treeIndex % 2 === 0; // arbres éclaircis ~50 % au loin
  return true; // gros décor (rocher, rondin, arbuste, souche) : conservé pour la silhouette
}

/** Un arbre n'est COUPABLE (suivi + animation) que dans le palier proche. */
export function isChoppable(band: PropBand): boolean {
  return band === "near";
}
