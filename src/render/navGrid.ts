// ============================================================================
//  GRILLE DE NAVIGATION + A* — pathfinding des villageois autour des emprises du camp.
//  PUR (aucun Babylon) -> testable au terminal. Élimine les minima locaux du champ de
//  potentiel : si un chemin existe, A* le trouve (contournement garanti). Calculé UNE FOIS
//  par retarget (pas par frame). Biais de coût optionnel pour PRÉFÉRER les sentiers dessinés.
//  Coût mesuré (cf. recherche) : ~166 cellules explorées, quelques dizaines de µs par chemin.
// ============================================================================

export interface NavPt { x: number; z: number }
export interface NavObstacle { x: number; z: number; r: number }

const MIN = -30, MAX = 30, CELL = 1.0; // la grille couvre le camp (r≈25) ; dehors = pas d'emprise
const BODY = 0.3; // demi-corps : une cellule est bloquée si elle est à < r+BODY d'une emprise
const GN = Math.round((MAX - MIN) / CELL) + 1;
const cellCenter = (i: number): number => MIN + i * CELL;
const toCell = (v: number): number => Math.max(0, Math.min(GN - 1, Math.round((v - MIN) / CELL)));
const inBounds = (x: number, z: number): boolean => x >= MIN && x <= MAX && z >= MIN && z <= MAX;

export class NavGrid {
  private readonly blocked: Uint8Array;
  private readonly cost: Float32Array; // multiplicateur de coût par cellule (<1 = préférée)
  private readonly obstacles: NavObstacle[];
  // Tampons A* réutilisés (zéro allocation par chemin).
  private readonly gCost = new Float64Array(GN * GN);
  private readonly fCost = new Float64Array(GN * GN);
  private readonly came = new Int32Array(GN * GN);
  private readonly closed = new Uint8Array(GN * GN);

  /** `pathCostAt(x,z)` (optionnel) : <1 rend la cellule moins chère -> A* préfère y passer. */
  constructor(obstacles: NavObstacle[], pathCostAt?: (x: number, z: number) => number) {
    this.obstacles = obstacles;
    this.blocked = new Uint8Array(GN * GN);
    this.cost = new Float32Array(GN * GN).fill(1);
    for (let iz = 0; iz < GN; iz++) for (let ix = 0; ix < GN; ix++) {
      const x = cellCenter(ix), z = cellCenter(iz);
      let b = 0;
      for (const o of obstacles) { if (Math.hypot(x - o.x, z - o.z) < o.r + BODY) { b = 1; break; } }
      this.blocked[iz * GN + ix] = b;
      if (!b && pathCostAt) this.cost[iz * GN + ix] = Math.max(0.1, pathCostAt(x, z));
    }
  }

  /** Segment [a,b] dégagé de toute emprise (ligne de vue) ? */
  segClear(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1e-9;
    for (const o of this.obstacles) {
      const t = Math.max(0, Math.min(1, ((o.x - ax) * dx + (o.z - az) * dz) / len2));
      if (Math.hypot(ax + t * dx - o.x, az + t * dz - o.z) < o.r + BODY) return false;
    }
    return true;
  }

  /**
   * Chemin (waypoints, lissé par ligne de vue, FIN = cible RÉELLE) de `start` à `goal`.
   * Renvoie `[goal]` (direct) si la ligne de vue est dégagée ou si l'on est hors du camp ;
   * ne renvoie JAMAIS vide (si A* échoue, direct -> le filet anti-blocage prend le relais).
   */
  findPath(start: NavPt, goal: NavPt): NavPt[] {
    if (!inBounds(start.x, start.z) || !inBounds(goal.x, goal.z)) return [{ x: goal.x, z: goal.z }];
    if (this.segClear(start.x, start.z, goal.x, goal.z)) return [{ x: goal.x, z: goal.z }];
    const raw = this.astar(start, goal);
    if (!raw) return [{ x: goal.x, z: goal.z }];
    const sm = this.smooth(raw);
    sm.push({ x: goal.x, z: goal.z }); // finir sur la cible réelle (pas le centre de cellule)
    return sm;
  }

  /** Cellule libre la plus proche (anneaux) — start/goal peuvent tomber sur une cellule gonflée. */
  private nearestFree(px: number, pz: number): number {
    const cx = toCell(px), cz = toCell(pz);
    if (!this.blocked[cz * GN + cx]) return cz * GN + cx;
    for (let rad = 1; rad < 12; rad++) for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== rad) continue;
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nx >= GN || nz < 0 || nz >= GN) continue;
      if (!this.blocked[nz * GN + nx]) return nz * GN + nx;
    }
    return cz * GN + cx;
  }

  private astar(start: NavPt, goal: NavPt): NavPt[] | null {
    const s = this.nearestFree(start.x, start.z);
    const g = this.nearestFree(goal.x, goal.z);
    const gx = g % GN, gz = (g - gx) / GN;
    const { gCost, fCost, came, closed } = this;
    gCost.fill(Infinity); fCost.fill(Infinity); came.fill(-1); closed.fill(0);
    const h = (x: number, z: number) => Math.hypot(x - gx, z - gz);
    const open: number[] = [s];
    const sx = s % GN, sz = (s - sx) / GN;
    gCost[s] = 0; fCost[s] = h(sx, sz);
    while (open.length) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (fCost[open[i]] < fCost[open[bi]]) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % GN, cz = (cur - cx) / GN;
      if (cur === g) {
        const out: NavPt[] = []; let c = cur;
        while (c !== -1) { const x = c % GN, z = (c - x) / GN; out.unshift({ x: cellCenter(x), z: cellCenter(z) }); c = came[c]; }
        return out;
      }
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nx >= GN || nz < 0 || nz >= GN) continue;
        const ni = nz * GN + nx;
        if (this.blocked[ni] || closed[ni]) continue;
        if (dx && dz && (this.blocked[cz * GN + (cx + dx)] || this.blocked[(cz + dz) * GN + cx])) continue; // pas de coin coupé
        const ng = gCost[cur] + Math.hypot(dx, dz) * this.cost[ni];
        if (ng < gCost[ni]) { gCost[ni] = ng; fCost[ni] = ng + h(nx, nz); came[ni] = cur; open.push(ni); }
      }
    }
    return null;
  }

  /** Lissage par ligne de vue : saute les waypoints intermédiaires si le segment est dégagé. */
  private smooth(path: NavPt[]): NavPt[] {
    if (path.length <= 2) return path.slice();
    const out: NavPt[] = [path[0]]; let i = 0;
    while (i < path.length - 1) {
      let j = path.length - 1;
      while (j > i + 1 && !this.segClear(path[i].x, path[i].z, path[j].x, path[j].z)) j--;
      out.push(path[j]); i = j;
    }
    return out;
  }
}
