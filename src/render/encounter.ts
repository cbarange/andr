// ============================================================================
//  RENCONTRES (M8.6) — rendu des ennemis PARTAGÉS, ancrés dans le monde. La sim
//  porte désormais une POSITION AUTORITAIRE par rencontre (`state.encounters`), si
//  bien que TOUS les joueurs voient le même ennemi au même endroit et peuvent
//  l'attaquer ensemble. Ce module matérialise CHAQUE rencontre (un mesh par id),
//  INTERPOLE vers la dernière position connue (snapshot 2 Hz + flux rapide 15 Hz),
//  « fente » à chaque frappe (diff `enemyNextAt`) et « recule » quand l'ennemi
//  encaisse (HP en baisse). Purement visuel : AUCUNE règle (dégâts/butin = reducer).
// ============================================================================

import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { terrainHeight, enemyById, type EnemyDef } from "../../data/world";
import { makeKit, type Kit } from "./lowpoly";
import { buildBeast, buildLizard, buildBird, buildHumanoid } from "./characters";
import { P } from "./lowpoly";

const LUNGE_TIME = 0.35; // durée de la fente d'attaque (aller-retour)
const DESPAWN_TIME = 0.6; // durée de l'effondrement / de la fuite
const LERP_RATE = 12; // lissage de l'interpolation vers la position cible (réactif mais doux)

/** Vue d'une rencontre pour le rendu (sous-ensemble sérialisable de `SharedEncounter`). */
export interface EncView {
  enemyId: string;
  hp: number;
  x: number;
  z: number;
  enemyNextAt: number;
  seq: number;
}

interface ActiveEnemy {
  root: TransformNode;
  jaw: TransformNode | null;
  def: EnemyDef;
  seq: number;
  tx: number; // position CIBLE (interpolée) — alimentée par le snapshot ET le flux rapide
  tz: number;
  prevNextAt: number; // détecte une frappe (ré-armement de l'échéance)
  prevHp: number; // détecte « touché » (recul)
  lunge: number; // 0 = repos ; >0 = fente en cours (décompte)
  flinch: number; // >0 = recul « touché » en cours
}

export class EncounterFx {
  private readonly K: Kit;
  private readonly enemies = new Map<string, ActiveEnemy>();
  private readonly dying: Array<{ root: TransformNode; t: number; mode: "win" | "flee" }> = [];

  constructor(private readonly scene: Scene) {
    this.K = makeKit(scene);
  }

  /** Positions-monde des ennemis actifs (id -> position rendue), pour le focus « frapper » + HUD. */
  positions(): Map<string, { pos: Vector3; name: string }> {
    const out = new Map<string, { pos: Vector3; name: string }>();
    for (const [id, e] of this.enemies) out.set(id, { pos: e.root.position, name: e.def.name });
    return out;
  }

  /** Nom de l'ennemi d'une rencontre donnée (HUD), ou null. */
  enemyName(id: string): string | null {
    return this.enemies.get(id)?.def.name ?? null;
  }

  /**
   * Reflète l'état sim (snapshot) : crée les ennemis nouvellement apparus (par `id`/`seq`), met à
   * jour PV/échéance/cible des existants, retire ceux disparus (effondrement si l'ennemi était
   * presque mort — victoire ; sinon fondu — décrochage par la laisse).
   */
  sync(encs: Record<string, EncView>): void {
    // 1) Retraits : rencontres présentes en scène mais absentes du snapshot.
    for (const id of [...this.enemies.keys()]) {
      if (!encs[id]) {
        const e = this.enemies.get(id)!;
        this.dispose(id, e.prevHp <= e.def.hp * 0.34 ? "win" : "flee");
      }
    }
    // 2) Ajouts / mises à jour.
    for (const id of Object.keys(encs)) {
      const v = encs[id];
      const cur = this.enemies.get(id);
      if (!cur || cur.seq !== v.seq) {
        if (cur) this.dispose(id, "flee"); // un id réutilisé pour une NOUVELLE rencontre : on remplace
        const def = enemyById[v.enemyId];
        if (!def) continue;
        const { root, jaw } = this.buildModel(def);
        root.position.set(v.x, terrainHeight(v.x, v.z), v.z);
        this.enemies.set(id, {
          root, jaw, def, seq: v.seq, tx: v.x, tz: v.z,
          prevNextAt: v.enemyNextAt, prevHp: v.hp, lunge: 0, flinch: 0,
        });
      } else {
        if (v.enemyNextAt !== cur.prevNextAt) { cur.lunge = LUNGE_TIME; cur.prevNextAt = v.enemyNextAt; }
        if (v.hp < cur.prevHp) cur.flinch = 0.25;
        cur.prevHp = v.hp;
        cur.tx = v.x; cur.tz = v.z; // le snapshot pose la cible ; le flux rapide l'affine entre deux
      }
    }
  }

  /** Flux RAPIDE (15 Hz) : positions cibles d'ennemis -> interpolation fluide (anti-saccade). */
  setPositions(pos: Record<string, { x: number; z: number }>): void {
    for (const id of Object.keys(pos)) {
      const e = this.enemies.get(id);
      if (e) { e.tx = pos[id].x; e.tz = pos[id].z; }
    }
  }

  /** À appeler chaque frame : interpole vers la cible, oriente, anime fente/recul et retraits. */
  update(dtSec: number): void {
    const k = Math.min(1, dtSec * LERP_RATE);
    for (const [, e] of this.enemies) {
      const dx = e.tx - e.root.position.x;
      const dz = e.tz - e.root.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-3) {
        e.root.position.x += dx * k;
        e.root.position.z += dz * k;
        e.root.rotation.y = Math.atan2(dx, dz); // face au déplacement (modèles face +Z)
      }
      // Recul « touché » : s'écarte brièvement de sa cible.
      if (e.flinch > 0) {
        e.flinch -= dtSec;
        const inv = dist > 1e-4 ? 1 / dist : 0;
        e.root.position.x -= dx * inv * dtSec * 3;
        e.root.position.z -= dz * inv * dtSec * 3;
      }
      e.root.position.y = terrainHeight(e.root.position.x, e.root.position.z);
      // Fente : gueule ouverte + tangage avant ; sinon retour au repos + respiration.
      if (e.lunge > 0) {
        e.lunge -= dtSec;
        const a = Math.sin((1 - Math.max(0, e.lunge) / LUNGE_TIME) * Math.PI);
        e.root.rotation.x = -0.25 * a;
        if (e.jaw) e.jaw.rotation.x = 0.7 * a;
      } else {
        e.root.rotation.x *= Math.max(0, 1 - dtSec * 8);
        if (e.jaw) e.jaw.rotation.x *= Math.max(0, 1 - dtSec * 8);
        e.root.position.y += Math.sin(performance.now() * 0.004) * 0.02;
      }
    }
    // Retraits animés (effondrement de victoire / fuite au décrochage).
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.t -= dtSec;
      const f = Math.max(0, d.t / DESPAWN_TIME);
      if (d.mode === "win") {
        d.root.scaling.setAll(Math.max(0.01, f)); // s'effondre sur place
        d.root.rotation.z = (1 - f) * 0.9;
      } else {
        d.root.position.z += dtSec * 8; // détale puis disparaît
        d.root.scaling.setAll(Math.max(0.01, f));
      }
      if (d.t <= 0) { d.root.dispose(false); this.dying.splice(i, 1); }
    }
  }

  /** Retire tous les ennemis (changement de partie / nettoyage). */
  clearAll(): void {
    for (const id of [...this.enemies.keys()]) this.dispose(id, null);
  }

  // --------------------------------------------------------------------------

  private buildModel(def: EnemyDef): { root: TransformNode; jaw: TransformNode | null } {
    // Échelle douce selon les PV (la terreur sauvage est PLUS GROSSE que la bête grondante).
    const s = 0.9 + Math.min(0.9, def.hp / 60);
    if (def.model === "beast") return buildBeast(this.K, null, s);
    if (def.model === "lizard") return buildLizard(this.K, null, s);
    if (def.model === "bird") return buildBird(this.K, null, s);
    // Humanoïde hostile : silhouette sombre (haillons), tête nue.
    const { root, rig } = buildHumanoid(this.K, null, { tunic: P.armorDk, legs: P.dark, hat: "none", h: s });
    void rig;
    return { root, jaw: null };
  }

  private dispose(id: string, anim: "win" | "flee" | null): void {
    const e = this.enemies.get(id);
    if (!e) return;
    this.enemies.delete(id);
    if (anim) this.dying.push({ root: e.root, t: DESPAWN_TIME, mode: anim });
    else e.root.dispose(false);
  }
}
