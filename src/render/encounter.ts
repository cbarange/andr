// ============================================================================
//  RENCONTRE (M8) — rendu LOCAL de l'ennemi du duel du joueur. La sim est
//  NON-SPATIALE (un combat = un état abstrait par joueur) : l'ennemi est donc
//  matérialisé ICI, devant le joueur local — il rôde, fait face, et « fente »
//  quand la sim enregistre une frappe (diff de `enemyNextAt`). Purement visuel
//  & local : AUCUNE règle de jeu (dégâts/butin = reducer, hôte-autoritaire).
//  ⚠️ v1 : seul l'ennemi du joueur LOCAL est rendu (celui d'un pair distant est
//  invisible — la sim ne porte pas de position, assumé, cf. docs/roadmap-v2 M8).
// ============================================================================

import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { terrainHeight, enemyById, type EnemyDef } from "../../data/world";
import { makeKit, type Kit } from "./lowpoly";
import { buildBeast, buildLizard, buildBird, buildHumanoid } from "./characters";
import { P } from "./lowpoly";
import type { Encounter as EncounterState } from "../sim/state";

const STALK_DIST = 2.4; // distance de rôdaille (l'ennemi se tient là, face au joueur)
const APPROACH = 3.5; // vitesse d'approche (lissage)
const LUNGE_TIME = 0.35; // durée de la fente d'attaque (aller-retour)
const DESPAWN_TIME = 0.6; // durée de l'effondrement / de la fuite

interface ActiveEnemy {
  root: TransformNode;
  jaw: TransformNode | null;
  def: EnemyDef;
  seq: number;
  prevNextAt: number; // pour détecter une frappe (ré-armement de l'échéance)
  prevHp: number; // pour le feedback « touché » (recul)
  lunge: number; // 0 = repos ; >0 = fente en cours (décompte)
  flinch: number; // >0 = recul « touché » en cours
}

export class EncounterFx {
  private readonly K: Kit;
  private enemy: ActiveEnemy | null = null;
  private dying: { root: TransformNode; t: number; mode: "win" | "flee" } | null = null;

  constructor(private readonly scene: Scene) {
    this.K = makeKit(scene);
  }

  /** Position-monde de l'ennemi actif (pour le focus « frapper »), ou null. */
  enemyWorldPos(): Vector3 | null {
    return this.enemy ? this.enemy.root.position : null;
  }

  /** Nom affichable de l'ennemi actif (HUD), ou null. */
  enemyName(): string | null {
    return this.enemy?.def.name ?? null;
  }

  /**
   * Reflète l'état sim : crée l'ennemi quand une rencontre (nouvelle `seq`) apparaît, le retire
   * quand elle disparaît (`reason` venant des diffs observés par main : victoire / mort / fuite).
   */
  sync(enc: EncounterState | null, playerPos: Vector3, forward: { x: number; z: number }): void {
    if (enc && (!this.enemy || this.enemy.seq !== enc.seq)) {
      this.disposeEnemy(null); // remplace une éventuelle rencontre précédente (sécurité)
      const def = enemyById[enc.enemyId];
      if (!def) return;
      const { root, jaw } = this.buildModel(def);
      // Apparaît DEVANT le regard du joueur, posé au sol.
      const d = 4.5;
      const x = playerPos.x + forward.x * d;
      const z = playerPos.z + forward.z * d;
      root.position.set(x, terrainHeight(x, z), z);
      this.enemy = { root, jaw, def, seq: enc.seq, prevNextAt: enc.enemyNextAt, prevHp: enc.enemyHp, lunge: 0, flinch: 0 };
    } else if (!enc && this.enemy) {
      this.disposeEnemy("flee"); // raison par défaut ; main appelle clear() AVANT pour victoire/mort
    } else if (enc && this.enemy) {
      // Frappe ennemie : l'échéance a été ré-armée -> fente. Touché : HP a baissé -> recul.
      if (enc.enemyNextAt !== this.enemy.prevNextAt) { this.enemy.lunge = LUNGE_TIME; this.enemy.prevNextAt = enc.enemyNextAt; }
      if (enc.enemyHp < this.enemy.prevHp) { this.enemy.flinch = 0.25; this.enemy.prevHp = enc.enemyHp; }
    }
  }

  /** Retire l'ennemi avec la mise en scène adaptée (victoire = effondrement ; mort/fuite = retrait). */
  clear(reason: "win" | "death" | "flee"): void {
    if (!this.enemy) return;
    if (reason === "death") this.disposeEnemy(null); // le joueur respawn au camp : retrait immédiat
    else this.disposeEnemy(reason);
  }

  /** À appeler chaque frame : rôde autour du joueur, fente, et anime les retraits. */
  update(dtSec: number, playerPos: Vector3): void {
    const e = this.enemy;
    if (e) {
      const dx = playerPos.x - e.root.position.x;
      const dz = playerPos.z - e.root.position.z;
      const dist = Math.hypot(dx, dz) || 1e-4;
      // Cible : à STALK_DIST du joueur (la fente s'approche davantage).
      const want = e.lunge > 0 ? 0.8 : STALK_DIST;
      const move = (dist - want) * Math.min(1, dtSec * APPROACH);
      e.root.position.x += (dx / dist) * move;
      e.root.position.z += (dz / dist) * move;
      // Recul « touché » (s'éloigne brièvement).
      if (e.flinch > 0) {
        e.flinch -= dtSec;
        e.root.position.x -= (dx / dist) * dtSec * 3;
        e.root.position.z -= (dz / dist) * dtSec * 3;
      }
      e.root.position.y = terrainHeight(e.root.position.x, e.root.position.z);
      e.root.rotation.y = Math.atan2(dx, dz); // face au joueur (modèles face +Z)
      // Fente : gueule ouverte + tangage avant.
      if (e.lunge > 0) {
        e.lunge -= dtSec;
        const k = Math.sin((1 - Math.max(0, e.lunge) / LUNGE_TIME) * Math.PI);
        e.root.rotation.x = -0.25 * k;
        if (e.jaw) e.jaw.rotation.x = 0.7 * k;
      } else {
        e.root.rotation.x *= Math.max(0, 1 - dtSec * 8);
        if (e.jaw) e.jaw.rotation.x *= Math.max(0, 1 - dtSec * 8);
        // Respiration/rôdaille légère (vie).
        e.root.position.y += Math.sin(performance.now() * 0.004) * 0.02;
      }
    }
    // Retrait animé (effondrement de victoire / fuite).
    const d = this.dying;
    if (d) {
      d.t -= dtSec;
      const k = Math.max(0, d.t / DESPAWN_TIME);
      if (d.mode === "win") {
        d.root.scaling.setAll(Math.max(0.01, k)); // s'effondre sur place
        d.root.rotation.z = (1 - k) * 0.9;
      } else {
        d.root.position.z += dtSec * 8; // détale (direction approximative : peu importe, il disparaît)
        d.root.scaling.setAll(Math.max(0.01, k));
      }
      if (d.t <= 0) { d.root.dispose(false); this.dying = null; }
    }
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

  private disposeEnemy(anim: "win" | "flee" | null): void {
    if (!this.enemy) return;
    if (this.dying) { this.dying.root.dispose(false); this.dying = null; } // un seul retrait à la fois
    if (anim) this.dying = { root: this.enemy.root, t: DESPAWN_TIME, mode: anim };
    else this.enemy.root.dispose(false);
    this.enemy = null;
  }
}
