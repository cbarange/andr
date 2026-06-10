// ============================================================================
//  AVATARS DISTANTS — §7. Chaque pair diffuse sa position ; on l'affiche ici en
//  INTERPOLANT entre les transforms reçus (rendu fluide malgré un réseau saccadé).
//  Purement visuel : pas de physique (la physique est locale à chaque joueur).
// ============================================================================

import {
  Scene,
  Mesh,
  MeshBuilder,
  Vector3,
  TransformNode,
} from "@babylonjs/core";
import { PALETTE } from "./scene";
import { makeKit, type Kit } from "./lowpoly";
import { buildHumanoid, animateWalk, type Rig } from "./characters";
import type { PlayerTransform } from "./player";

const REMOTE_STRIDE = 1.5; // cadence des pas de l'avatar distant (rad/u, comme le joueur)

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

class RemotePlayer {
  private readonly mesh: Mesh; // capsule = ancre de position (invisible)
  private readonly yawNode: TransformNode;
  private readonly rig: Rig; // membres articulés (cycle de marche)
  private readonly target: Vector3;
  private targetYaw = 0;
  private walkPhase = 0;
  private walkInt = 0;

  constructor(scene: Scene, kit: Kit, id: string) {
    // Capsule = ancre de position/hitbox (alignée sur le joueur), INVISIBLE : le rendu est le
    // modèle humanoïde porté par le yawNode (comme le joueur local).
    this.mesh = MeshBuilder.CreateCapsule(`remote-${id}`, { radius: 0.34, height: 1.8, tessellation: 8 }, scene);
    this.mesh.isVisible = false;

    this.yawNode = new TransformNode(`remoteYaw-${id}`, scene);
    this.yawNode.parent = this.mesh;
    const model = kit.node(this.yawNode, [0, -0.9, 0]); // pieds au bas de la capsule
    // Humanoïde générique en couleur « distante » (sans sac/hachette) -> distinct du joueur local.
    const remote = [PALETTE.remote.r, PALETTE.remote.g, PALETTE.remote.b];
    this.rig = buildHumanoid(kit, model, { tunic: remote, hat: "cap" }).rig;

    this.target = new Vector3(0, 2, 0);
    this.mesh.position.copyFrom(this.target);
  }

  setTransform(t: PlayerTransform): void {
    this.target.set(t.x, t.y, t.z);
    this.targetYaw = t.ry;
  }

  get position(): Vector3 {
    return this.mesh.position;
  }

  update(dtSec: number): void {
    const k = Math.min(1, dtSec * 12); // facteur d'interpolation
    const px = this.mesh.position.x, pz = this.mesh.position.z;
    this.mesh.position.set(
      this.mesh.position.x + (this.target.x - this.mesh.position.x) * k,
      this.mesh.position.y + (this.target.y - this.mesh.position.y) * k,
      this.mesh.position.z + (this.target.z - this.mesh.position.z) * k,
    );
    this.yawNode.rotation.y = lerpAngle(this.yawNode.rotation.y, this.targetYaw, k);
    // Cycle de marche calé sur le mouvement VISIBLE (interpolé) -> pieds synchro avec l'image.
    const moved = Math.hypot(this.mesh.position.x - px, this.mesh.position.z - pz);
    this.walkPhase += moved * REMOTE_STRIDE;
    const target = dtSec > 0 && moved / dtSec > 0.5 ? 1 : 0;
    this.walkInt += (target - this.walkInt) * Math.min(1, dtSec * 12);
    animateWalk(this.rig, this.walkPhase, this.walkInt);
  }

  dispose(): void {
    this.mesh.dispose();
  }
}

export class RemotePlayers {
  private readonly players = new Map<string, RemotePlayer>();
  private readonly kit: Kit; // kit low-poly PARTAGÉ (cache de matériaux) pour tous les avatars distants

  constructor(private readonly scene: Scene) {
    this.kit = makeKit(scene);
  }

  setTransform(id: string, t: PlayerTransform): void {
    let p = this.players.get(id);
    if (!p) {
      p = new RemotePlayer(this.scene, this.kit, id);
      this.players.set(id, p);
    }
    p.setTransform(t);
  }

  remove(id: string): void {
    this.players.get(id)?.dispose();
    this.players.delete(id);
  }

  update(dtSec: number): void {
    for (const p of this.players.values()) p.update(dtSec);
  }

  /** Positions (x,z) interpolées des avatars distants — pour entourer chaque joueur de physique (P2). */
  positions(): Array<{ x: number; z: number }> {
    const out: Array<{ x: number; z: number }> = [];
    for (const p of this.players.values()) {
      const v = p.position;
      out.push({ x: v.x, z: v.z });
    }
    return out;
  }

  clear(): void {
    for (const p of this.players.values()) p.dispose();
    this.players.clear();
  }
}
