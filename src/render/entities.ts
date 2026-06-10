// ============================================================================
//  ENTITÉS À RENDU CONDITIONNEL (perf, P1) — socle réutilisable. Couche « corps »,
//  purement visuelle/LOCALE : n'affecte ni la sim ni le déterminisme (deux pairs
//  peuvent avoir des paliers différents selon où ils sont).
//
//  Principe : chaque ENTITÉ a une position monde + des distances de bascule, et un
//  PALIER LOD (full / minimal / culled) fonction de sa distance au joueur. Le travail
//  coûteux (créer/échanger/cacher un mesh) ne se fait QU'AU CHANGEMENT de palier
//  (onBand). L'animation (tick) ne tourne qu'en `full` (et au ralenti en `minimal`).
//  Hystérésis pour éviter le clignotement quand on longe une frontière.
//  Voir docs/perf-rendu.md.
// ============================================================================

export type LodBand = "full" | "minimal" | "culled";

export interface Entity {
  x: number;
  z: number;
  fullDist: number; // ≤ : palier "full"
  minimalDist: number; // ≤ : palier "minimal" ; au-delà : "culled"
  band: LodBand; // géré par le manager (init "culled")
  /** Appelé au CHANGEMENT de palier : (dé)charger / échanger / cacher le rendu. */
  onBand(band: LodBand): void;
  /** Animation. Appelée chaque frame en `full` ; 1 frame sur N (dt cumulé) en `minimal` si minimalTick. */
  tick?(dtSec: number): void;
  /** Si vrai, `tick` tourne aussi en `minimal` (au ralenti). */
  minimalTick?: boolean;
}

const MINIMAL_EVERY = 4; // en "minimal", on tick 1 frame sur 4 (avec dt × 4)

export class EntityManager {
  private readonly entities = new Set<Entity>();
  private frame = 0;

  constructor(private readonly hysteresis = 10) {}

  register(e: Entity): Entity {
    this.entities.add(e);
    return e;
  }

  unregister(e: Entity): void {
    this.entities.delete(e);
  }

  /** À appeler chaque frame avec la position du joueur. */
  update(px: number, pz: number, dtSec: number): void {
    this.frame++;
    for (const e of this.entities) {
      const d = Math.hypot(e.x - px, e.z - pz);
      const band = this.classify(d, e);
      if (band !== e.band) {
        e.band = band;
        e.onBand(band);
      }
      if (e.tick) {
        if (e.band === "full") e.tick(dtSec);
        else if (e.band === "minimal" && e.minimalTick && this.frame % MINIMAL_EVERY === 0) {
          e.tick(dtSec * MINIMAL_EVERY); // ralenti : moins souvent, pas plus grand (vitesse moyenne conservée)
        }
      }
    }
  }

  /** Palier selon la distance, avec hystérésis (seuils élargis quand on est déjà plus proche). */
  private classify(d: number, e: Entity): LodBand {
    const h = this.hysteresis;
    const f = e.fullDist;
    const m = e.minimalDist;
    switch (e.band) {
      case "full":
        return d <= f + h ? "full" : d <= m + h ? "minimal" : "culled";
      case "minimal":
        return d <= f - h ? "full" : d <= m + h ? "minimal" : "culled";
      default: // "culled"
        return d <= f - h ? "full" : d <= m - h ? "minimal" : "culled";
    }
  }
}
