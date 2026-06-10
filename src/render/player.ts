// ============================================================================
//  PERSONNAGE — capsule physique Havok : gravité, collisions, saut (§6).
//  Le rendu lit l'INTENTION (input/) et l'oriente selon la caméra. Il ne contient
//  aucune règle de jeu (le bois vit dans sim/). La rotation est verrouillée pour
//  rester debout ; un repère visuel (le "nez") indique la direction.
// ============================================================================

import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode,
  PhysicsAggregate,
  PhysicsShapeType,
} from "@babylonjs/core";
import { config, terrainHeight } from "../../data/world";
import { PALETTE } from "./scene";
import { makeKit } from "./lowpoly";
import { buildPlayer, animateWalk, type Rig } from "./characters";
import type { MoveIntent } from "../input/input";

const WALK_STRIDE = 1.5; // rad de cycle de marche par unité parcourue (cadence des pas du joueur)

export interface PlayerTransform {
  x: number;
  y: number;
  z: number;
  ry: number; // yaw (radians)
}

const CAPSULE_HEIGHT = 1.8;
const CAPSULE_RADIUS = 0.34; // hitbox calée sur épaules+bras (modèle slim) ; mains débordent (cosmétique)
const HALF_HEIGHT = CAPSULE_HEIGHT / 2;
const FLY_SPEED = 9; // vitesse verticale en mode vol (u/s)

export class Player {
  readonly mesh: Mesh;
  private readonly aggregate: PhysicsAggregate;
  private readonly yawNode: TransformNode;
  private readonly rig: Rig; // membres articulés (cycle de marche)
  private walkPhase = 0;
  private walkInt = 0;
  private facing = 0;
  private flying = false; // /fly : gravité coupée + contrôle vertical
  private noclip = false; // /noclip : traverse le décor (collisions désactivées) — implique le vol
  private origCollideMask = 0; // masque de collision d'origine (restauré quand noclip off)
  private speedMul = 1; // multiplicateur de vitesse (double-tap avant ×, arrière ÷)

  constructor(private readonly scene: Scene) {
    this.mesh = MeshBuilder.CreateCapsule(
      "player",
      { radius: CAPSULE_RADIUS, height: CAPSULE_HEIGHT, tessellation: 8 },
      scene,
    );
    // Apparition près du feu de camp (point de repère), pas dessus.
    this.mesh.position.set(0, terrainHeight(0, 8) + 3, 8);

    const mat = new StandardMaterial("playerMat", scene);
    mat.diffuseColor = PALETTE.player.clone();
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    this.mesh.material = mat;

    // La capsule est le CORPS PHYSIQUE : on la masque et on porte le rendu (modèle
    // low-poly du labo) sur un noeud de yaw indépendant de la physique (qui garde la
    // capsule verticale). Le modèle a son propre « nez » repère de direction.
    this.mesh.isVisible = false;
    this.yawNode = new TransformNode("playerYaw", scene);
    this.yawNode.parent = this.mesh;
    const K = makeKit(scene);
    const model = K.node(this.yawNode, [0, -HALF_HEIGHT, 0]);
    this.rig = buildPlayer(K, model).rig;

    // Corps dynamique. Inertie nulle -> ne bascule pas (reste debout).
    this.aggregate = new PhysicsAggregate(
      this.mesh,
      PhysicsShapeType.CAPSULE,
      { mass: 1, friction: 0.1, restitution: 0 },
      scene,
    );
    this.aggregate.body.setMassProperties({ mass: 1, inertia: new Vector3(0, 0, 0) });
    this.aggregate.body.setAngularDamping(100);
    this.aggregate.body.setLinearDamping(0);
    this.origCollideMask = this.aggregate.shape.filterCollideMask;
  }

  get position(): Vector3 {
    return this.mesh.position;
  }

  /** Affiche/masque le corps visible (on le masque en 1ʳᵉ personne pour ne pas voir l'intérieur). */
  setVisible(v: boolean): void {
    this.yawNode.setEnabled(v);
  }

  get isFlying(): boolean {
    return this.flying;
  }
  get isNoclip(): boolean {
    return this.noclip;
  }
  get speedMultiplier(): number {
    return this.speedMul;
  }

  /** Ajuste la vitesse par paliers (double-tap avant=+, arrière=−). Renvoie le nouveau ×. */
  adjustSpeed(dir: 1 | -1): number {
    const e = config.explore;
    const m = dir > 0 ? this.speedMul * e.speedStep : this.speedMul / e.speedStep;
    this.speedMul = Math.max(e.speedMultMin, Math.min(e.speedMultMax, m));
    return this.speedMul;
  }

  /** Active/désactive le VOL (gravité coupée, contrôle vertical Espace/Maj). DEBUG. */
  setFly(on: boolean): void {
    this.flying = on;
    this.applyMode();
  }

  /** Active/désactive le NOCLIP (traverse le décor). Implique le vol. DEBUG. */
  setNoclip(on: boolean): void {
    this.noclip = on;
    if (on) this.flying = true;
    this.applyMode();
  }

  private applyMode(): void {
    const free = this.flying || this.noclip;
    this.aggregate.body.setGravityFactor(free ? 0 : 1);
    // Collisions désactivées en noclip (masque = 0), restaurées sinon.
    this.aggregate.shape.filterCollideMask = this.noclip ? 0 : this.origCollideMask;
  }

  /** Téléporte le personnage (debug/tests) : pose au sol et annule la vitesse. */
  teleport(x: number, z: number): void {
    this.mesh.position.set(x, terrainHeight(x, z) + HALF_HEIGHT + 0.2, z);
    const body = this.aggregate.body;
    body.setLinearVelocity(Vector3.Zero());
    // Pour un corps dynamique Havok, on autorise une lecture de la position du mesh
    // au prochain pas (sinon la physique écrase notre téléportation), puis on rétablit.
    body.disablePreStep = false;
    this.scene.onAfterRenderObservable.addOnce(() => {
      body.disablePreStep = true;
    });
  }

  /** Au sol si le bas de la capsule est proche du terrain analytique (data/world.ts). */
  private isGrounded(): boolean {
    const p = this.mesh.position;
    const bottom = p.y - HALF_HEIGHT;
    return bottom - terrainHeight(p.x, p.z) < 0.18;
  }

  /**
   * @param camYaw orientation horizontale de la caméra (rad) — sert de repère "avant".
   */
  update(dtSec: number, intent: MoveIntent, camYaw: number): void {
    const body = this.aggregate.body;
    const current = body.getLinearVelocity();

    let vx = 0;
    let vz = 0;
    if (intent.forward !== 0 || intent.strafe !== 0) {
      const sinY = Math.sin(camYaw);
      const cosY = Math.cos(camYaw);
      // avant caméra = (sinY, cosY) ; droite = (cosY, -sinY)
      let dx = sinY * intent.forward + cosY * intent.strafe;
      let dz = cosY * intent.forward - sinY * intent.strafe;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const speed = config.moveSpeed * this.speedMul;
      vx = dx * speed;
      vz = dz * speed;
      this.facing = Math.atan2(dx, dz);
    }

    let vy: number;
    if (this.flying || this.noclip) {
      // Vol : la gravité est coupée -> on pilote la vitesse verticale (hover si 0).
      vy = intent.vertical * FLY_SPEED;
    } else {
      vy = current.y;
      if (intent.jump && this.isGrounded()) vy = config.jumpSpeed;
    }

    body.setLinearVelocity(new Vector3(vx, vy, vz));
    this.yawNode.rotation.y = this.facing;

    // Cycle de marche des membres : la phase avance avec la distance horizontale parcourue ;
    // l'intensité fond vers 1 en mouvement, 0 à l'arrêt. Cosmétique (sous le nœud de yaw).
    const hspeed = Math.hypot(vx, vz);
    this.walkPhase += hspeed * dtSec * WALK_STRIDE;
    const target = hspeed > 0.4 ? 1 : 0;
    this.walkInt += (target - this.walkInt) * Math.min(1, dtSec * 12);
    animateWalk(this.rig, this.walkPhase, this.walkInt);
  }

  getTransform(): PlayerTransform {
    const p = this.mesh.position;
    return { x: p.x, y: p.y, z: p.z, ry: this.facing };
  }
}
