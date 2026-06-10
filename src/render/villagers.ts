// ============================================================================
//  VILLAGEOIS (M3) — représentation 3D (cosmétique) de la population. On lit le
//  nombre de villageois ET la répartition des métiers de la SIM, et on anime
//  autant de petits avatars qui **se déplacent pour effectuer leur métier**.
//  Aucune règle de jeu ici : c'est purement visuel et LOCAL (non synchronisé),
//  comme la forêt ou l'étrangère — donc zéro coût réseau, zéro impact déterminisme.
//
//  Chaque villageois est un INDIVIDU : silhouette capsule + tête + un « nez » qui
//  pointe dans sa direction de marche. Déplacement = steering trivial (ligne droite
//  + pause de « travail »), sans physique ni pathfinding -> très léger.
// ============================================================================

import { Scene, TransformNode } from "@babylonjs/core";
import { terrainHeight, config, campLayout } from "../../data/world";
import { makeKit, type Kit } from "./lowpoly";
import { buildHumanoid, VILLAGER_SPECS, animateWalk, type Rig } from "./characters";
import { NavGrid, type NavPt } from "./navGrid";
import { pathIntensity } from "./campGround";
import type { Trails } from "./trails";

const MAX_AVATARS = 48; // garde-fou perf
const GOLDEN = 2.399963; // angle d'or pour une répartition régulière
const WALK_SPEED = 1.35; // u/s — lent (le joueur va à 6)
const ARRIVE_DIST = 0.4; // distance à laquelle on considère la cible atteinte
const WORK_MIN = 2.0; // durée mini d'une pause de « travail » (s)
const WORK_MAX = 5.5; // durée maxi
const TURN_RATE = 7; // lissage de l'orientation (rad/s)
const WORLD_HALF = config.worldSize / 2 - 2; // bornes du terrain
// Gestes de travail (Phase 2) — penché/coups/accroupi/guet.
const CHOP_AMP = 0.5; // amplitude du balancement de coupe (rad)
const CROUCH_SQUASH = 0.74; // écrasement vertical (accroupi sur un piège)
const WALK_STRIDE = 2.4; // rad de cycle de marche par unité parcourue (cadence des pas)
const WALK_EASE = 12; // vitesse de fondu entrée/sortie du cycle de marche

// Ordre stable des rôles (le bûcheron = le « reste »), pour répartir les avatars.
const ROLE_ORDER = ["gatherer", "hunter", "trapper", "tanner", "charcutier", "steelworker", "armourer"];
// Métier -> bâtiment où il s'active (les autres ont leurs propres repères).
const JOB_BUILDING: Record<string, string> = {
  tanner: "tannery", charcutier: "smokehouse", steelworker: "steelworks", armourer: "armoury",
};

/** Repères du monde que les villageois visitent (fournis par main.ts). */
export interface VillageLandmarks {
  trees(): Array<{ x: number; z: number }>;
  traps(): Array<{ x: number; z: number }>;
  buildings(id: string): Array<{ x: number; z: number }>;
  cabin: { x: number; z: number };
  fire: { x: number; z: number };
  /** Emprises à CONTOURNER (bâtiments + cabane). Re-lu à chaque pas (le village grandit). */
  obstacles(): Array<{ x: number; z: number; r: number }>;
}

// Évitement d'obstacles (steering trivial, sans physique) : un villageois CONTOURNE les
// emprises et ne finit jamais à l'intérieur — comme le joueur évite les murs.
const BODY = 0.29; // demi-corps : jamais à l'intérieur d'une emprise (poussée dure de sécurité)
// Navigation A* : le chemin (waypoints) contourne déjà les bâtiments -> plus de répulsion réactive
// (qui rouvrait les minima locaux / les pièges en couloir étroit). Voir docs + src/render/navGrid.ts.
const WP_REACH = 0.7; // distance à laquelle on passe au waypoint suivant
const STUCK_SECONDS = 4; // filet anti-blocage : si on n'avance plus, re-choisir une cible
const PATH_PREFER = 0.35; // biais : marcher sur un sentier dessiné coûte jusqu'à -35% -> les villageois suivent les chemins

// Hash déterministe [0,1) -> variations d'apparence stables (cohérence visuelle entre pairs).
function hash(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Position déterministe de spawn du i-ème villageois (anneau interne).
function spot(i: number): { x: number; z: number } {
  const radius = 4 + (i % 6) * 1.15;
  const angle = i * GOLDEN;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

// Mouvement = cosmétique local -> Math.random est admis (aucune contrainte de déterminisme).
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function jitter(p: { x: number; z: number }, r: number): { x: number; z: number } {
  const a = Math.random() * Math.PI * 2;
  const d = Math.random() * r;
  return { x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d };
}
function clampWorld(p: { x: number; z: number }): { x: number; z: number } {
  return {
    x: Math.max(-WORLD_HALF, Math.min(WORLD_HALF, p.x)),
    z: Math.max(-WORLD_HALF, Math.min(WORLD_HALF, p.z)),
  };
}
// Repousse un point HORS de toute emprise (avec marge) -> une cible reste atteignable. Une passe.
function pushOut(p: { x: number; z: number }, obstacles: Array<{ x: number; z: number; r: number }>, margin: number): void {
  for (const o of obstacles) {
    const dx = p.x - o.x, dz = p.z - o.z;
    const d = Math.hypot(dx, dz);
    const want = o.r + margin;
    if (d < want && d > 1e-4) { p.x = o.x + (dx / d) * want; p.z = o.z + (dz / d) * want; }
  }
}
// Rapproche un angle d'un autre (gère le passage ±π) -> rotation douce, pas de saut.
function approachAngle(cur: number, target: number, maxStep: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

interface Avatar {
  node: TransformNode;
  phase: number; // déphasage du flottement
  bob: number; // amplitude du flottement
  role: string;
  x: number;
  z: number;
  tx: number; // cible courante
  tz: number;
  working: boolean; // en pause de « travail » à destination
  timer: number; // temps restant de la pause
  goingHome: boolean; // alterne aller (travail) / retour (camp) pour les métiers à boucle
  yaw: number; // orientation courante (lissée)
  workYaw: number; // orientation figée pendant le travail (le geste s'anime autour)
  scale: number; // échelle de base (pour l'écrasement « accroupi »)
  rig: Rig; // membres articulés (jambes/bras/tête) — cycle de marche
  walkPhase: number; // phase du cycle de marche (avance avec la distance)
  walkInt: number; // intensité 0..1 (fond le cycle de marche : 1 en marche, 0 à l'arrêt/au travail)
  path: NavPt[]; // chemin A* (waypoints) vers la cible — dernier = cible réelle
  wp: number; // index du waypoint courant
  stuckT: number; // temps sans progression réelle (filet anti-blocage)
}

export class Villagers {
  private readonly avatars: Avatar[] = [];
  private readonly K: Kit;
  private landmarks: VillageLandmarks | null = null;
  private trails: Trails | null = null;
  private nav: NavGrid | null = null; // grille de pathfinding (reconstruite quand le village change)
  private navSig = -1; // signature des emprises -> détecte un nouveau bâtiment
  private rolesKey = "";
  private time = 0;
  private visible = true; // rendu conditionnel (LOD) : caché quand loin du village

  constructor(private readonly scene: Scene) {
    this.K = makeKit(scene);
  }

  /** Branche les repères du monde (appelé une fois, après la création des autres modules). */
  setLandmarks(l: VillageLandmarks): void {
    this.landmarks = l;
  }

  /** Grille de navigation courante : reconstruite seulement quand les emprises changent
   *  (un bâtiment apparaît). Biais de coût léger pour préférer les sentiers dessinés. */
  private ensureNav(): NavGrid | null {
    if (!this.landmarks) return null;
    const obs = this.landmarks.obstacles();
    let sig = obs.length;
    for (const o of obs) sig += o.x * 7.13 + o.z * 13.37 + o.r * 17.71;
    if (this.nav && sig === this.navSig) return this.nav;
    this.navSig = sig;
    this.nav = new NavGrid(obs, (x, z) => 1 - PATH_PREFER * pathIntensity(x, z, campLayout.paths));
    return this.nav;
  }

  /** Branche la carte des chemins émergents : chaque pas de marche y dépose une trace. */
  setTrails(t: Trails): void {
    this.trails = t;
  }

  /** Rendu conditionnel (LOD) : affiche/masque TOUS les avatars d'un coup. Quand masqués,
   *  on ne les rend plus ET on cesse de les animer (le manager coupe `update`). */
  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    for (const a of this.avatars) a.node.setEnabled(v);
  }

  /** Nombre d'avatars instanciés. */
  get count(): number {
    return this.avatars.length;
  }
  /** Nombre d'avatars effectivement rendus (0 si déchargés par le LOD). */
  get rendered(): number {
    return this.visible ? this.avatars.length : 0;
  }

  /**
   * Ajuste le nombre d'avatars à la population et leur attribue un RÔLE selon la
   * répartition des métiers (`roleCounts`, dont `gatherer` = bûcherons par défaut).
   */
  sync(population: number, roleCounts: Record<string, number>): void {
    const target = Math.min(population, MAX_AVATARS);
    while (this.avatars.length < target) this.spawn(this.avatars.length);

    // Séquence ordonnée de rôles (réassignée seulement si la répartition change).
    const seq: string[] = [];
    for (const r of ROLE_ORDER) {
      const n = Math.max(0, Math.floor(roleCounts[r] ?? 0));
      for (let k = 0; k < n; k++) seq.push(r);
    }
    const key = `${this.avatars.length}|${seq.join(",")}`;
    if (key !== this.rolesKey) {
      this.rolesKey = key;
      this.avatars.forEach((a, i) => { a.role = seq[i] ?? "gatherer"; });
    }
  }

  private spawn(i: number): void {
    const { x, z } = spot(i);
    const node = new TransformNode(`villager-${i}`, this.scene);
    node.position.set(x, terrainHeight(x, z), z);
    // Apparence : une variante STABLE par index (casquette, capuche, paille, barbu,
    // enfant) — finis les clones. Le modèle a son propre « nez » repère de direction.
    const spec = VILLAGER_SPECS[Math.floor(hash(i + 5) * VILLAGER_SPECS.length) % VILLAGER_SPECS.length];
    const { rig } = buildHumanoid(this.K, node, { tunic: spec.tunic, head: spec.head, hair: spec.hair, hat: spec.hat });
    // L'échelle du villageois est portée par le NŒUD (et animée à l'écrasement) ;
    // on y intègre la taille de la variante (l'enfant reste plus petit).
    const scale = (0.9 + hash(i) * 0.18) * (spec.h ?? 1);
    node.scaling.setAll(scale);

    node.setEnabled(this.visible); // respecte l'état LOD courant (spawn possible en zone masquée)

    const a: Avatar = {
      node, phase: i * 1.7, bob: 0.04 + hash(i + 11) * 0.04, role: "gatherer",
      x, z, tx: x, tz: z, working: false, timer: 0, goingHome: false,
      yaw: hash(i + 3) * Math.PI * 2, workYaw: 0, scale,
      rig, walkPhase: i * 1.7, walkInt: 0,
      path: [], wp: 0, stuckT: 0,
    };
    this.pickTarget(a);
    this.avatars.push(a);
  }

  /** Choisit la prochaine destination de l'avatar selon son métier. */
  private pickTarget(a: Avatar): void {
    const L = this.landmarks;
    let p: { x: number; z: number };
    if (!L) {
      p = spot(0);
    } else {
      switch (a.role) {
        case "gatherer": {
          // Boucle : un arbre (couper) <-> la cabane (déposer).
          a.goingHome = !a.goingHome;
          if (a.goingHome) p = jitter(L.cabin, 1.6);
          else { const t = L.trees(); p = t.length ? jitter(pick(t), 1.0) : jitter(L.fire, 2.5); }
          break;
        }
        case "hunter": {
          // Sort vers la lisière (les terres sauvages), puis revient au feu.
          a.goingHome = !a.goingHome;
          if (a.goingHome) { p = jitter(L.fire, 3); }
          else { const ang = Math.random() * Math.PI * 2, r = 15 + Math.random() * 6; p = { x: Math.cos(ang) * r, z: Math.sin(ang) * r }; }
          break;
        }
        case "trapper": {
          // Va relever un piège <-> revient au camp.
          const tr = L.traps();
          a.goingHome = !a.goingHome;
          p = a.goingHome || tr.length === 0 ? jitter(L.cabin, 2) : jitter(pick(tr), 0.8);
          break;
        }
        default: {
          // Métier de bâtiment : tourne autour de son lieu de travail (sinon, repos au feu).
          const bid = JOB_BUILDING[a.role];
          const bs = bid ? L.buildings(bid) : [];
          p = bs.length ? jitter(pick(bs), 1.3) : jitter(L.fire, 2.5);
        }
      }
    }
    p = clampWorld(p);
    if (L) pushOut(p, L.obstacles(), ARRIVE_DIST + 0.4); // cible hors des emprises -> atteignable
    a.tx = p.x;
    a.tz = p.z;
    // Chemin A* qui CONTOURNE les bâtiments (calculé ici, au retarget — pas par frame).
    const nav = this.ensureNav();
    a.path = nav ? nav.findPath({ x: a.x, z: a.z }, p) : [{ x: p.x, z: p.z }];
    a.wp = 0;
    a.stuckT = 0;
  }

  /** Déplacement + petits gestes de travail. Maths pures, aucune allocation par frame. */
  update(dtSec: number): void {
    this.time += dtSec;
    const obstacles = this.landmarks ? this.landmarks.obstacles() : [];
    for (const a of this.avatars) {
      let lean = 0; // bascule avant (rotation X) — coups de hache, penché…
      let sway = 0; // balayage du regard (ajouté au yaw figé)
      let squash = 1; // écrasement vertical — accroupi

      if (a.working) {
        a.timer -= dtSec;
        if (a.timer <= 0) {
          this.pickTarget(a);
          a.working = false;
          a.yaw = a.workYaw; // repart de l'orientation de travail
        } else if (!a.goingHome && a.role === "gatherer") {
          lean = (0.5 - 0.5 * Math.cos(this.time * 8 + a.phase)) * CHOP_AMP; // coups réguliers
        } else if (!a.goingHome && a.role === "trapper") {
          squash = CROUCH_SQUASH; lean = 0.22; // accroupi, penché sur le piège
        } else if (!a.goingHome && a.role === "hunter") {
          sway = Math.sin(this.time * 1.3 + a.phase) * 0.7; // guette, balaie l'horizon
        } else if (JOB_BUILDING[a.role]) {
          lean = Math.sin(this.time * 4 + a.phase) * 0.12; // affairé près du bâtiment
        }
        // (repos / retour au camp) : pas de geste, juste le flottement
      } else {
        const fdist = Math.hypot(a.tx - a.x, a.tz - a.z); // distance à la CIBLE finale
        if (fdist <= ARRIVE_DIST) {
          a.working = true;
          a.timer = WORK_MIN + Math.random() * (WORK_MAX - WORK_MIN);
          a.workYaw = a.yaw; // fige l'orientation pour la durée du travail
        } else {
          // Suit le CHEMIN A* : avance vers le waypoint courant (le chemin contourne déjà les
          // bâtiments -> pas de répulsion réactive, donc pas de minimum local ni piège de couloir).
          while (a.wp < a.path.length - 1 && Math.hypot(a.path[a.wp].x - a.x, a.path[a.wp].z - a.z) < WP_REACH) a.wp++;
          const w = a.path.length ? a.path[Math.min(a.wp, a.path.length - 1)] : { x: a.tx, z: a.tz };
          const dx = w.x - a.x, dz = w.z - a.z;
          const wd = Math.hypot(dx, dz) || 1e-4;
          const dirx = dx / wd, dirz = dz / wd;
          const step = WALK_SPEED * dtSec;
          const bx = a.x, bz = a.z;
          a.x += dirx * step;
          a.z += dirz * step;
          // Sécurité : jamais à l'intérieur d'une emprise (le chemin est dégagé, mais on garantit).
          for (const o of obstacles) {
            const ox = a.x - o.x, oz = a.z - o.z;
            const od = Math.hypot(ox, oz);
            const want = o.r + BODY;
            if (od < want && od > 1e-4) { a.x = o.x + (ox / od) * want; a.z = o.z + (oz / od) * want; }
          }
          const moved = Math.hypot(a.x - bx, a.z - bz);
          a.walkPhase += moved * WALK_STRIDE; // le cycle de marche avance avec la distance réelle
          a.yaw = approachAngle(a.yaw, Math.atan2(dirx, dirz), TURN_RATE * dtSec);
          this.trails?.stamp(a.x, a.z); // usure du sol là où il marche (chemins émergents)
          // FILET ANTI-BLOCAGE : si la progression réelle s'effondre, re-choisir une cible (chemin neuf).
          if (moved < step * 0.3) { a.stuckT += dtSec; if (a.stuckT > STUCK_SECONDS) this.pickTarget(a); }
          else a.stuckT = 0;
        }
      }

      const bob = Math.sin(this.time * 1.8 + a.phase) * a.bob;
      a.node.position.set(a.x, terrainHeight(a.x, a.z) + bob, a.z);
      a.node.rotation.x = lean;
      a.node.rotation.y = a.working ? a.workYaw + sway : a.yaw;
      a.node.scaling.y = a.scale * squash; // (x,z gardent l'échelle de base posée au spawn)

      // Cycle de marche des membres : actif en déplacement, neutre au travail/à l'arrêt.
      const walkTarget = a.working ? 0 : 1;
      a.walkInt += (walkTarget - a.walkInt) * Math.min(1, dtSec * WALK_EASE);
      animateWalk(a.rig, a.walkPhase, a.walkInt);
    }
  }
}
