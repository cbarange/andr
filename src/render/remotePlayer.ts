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
  DynamicTexture,
  StandardMaterial,
  Color3,
} from "@babylonjs/core";
import { PALETTE } from "./scene";
import { makeKit, type Kit } from "./lowpoly";
import { buildHumanoid, animateWalk, type Rig } from "./characters";
import type { PlayerTransform } from "./player";

const REMOTE_STRIDE = 1.5; // cadence des pas de l'avatar distant (rad/u, comme le joueur)
const TAG_FONT = "bold 38px sans-serif";
const TAG_Y = 1.4; // hauteur de l'étiquette au-dessus de l'ancre (juste au-dessus de la tête)
const TAG_WORLD_H = 0.34; // hauteur monde de l'étiquette (la largeur suit le texte -> pas d'étirement)

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/** Étiquette flottante (billboard) au-dessus d'un avatar : texte blanc sur pastille sombre,
 *  non éclairée (lisible de nuit). La texture est dimensionnée AU TEXTE -> pas d'étirement,
 *  quelle que soit la longueur de l'id/nom. Le plan renvoyé est à parenter sur l'ancre. */
function makeNameTag(scene: Scene, text: string): Mesh {
  // 1) mesurer le texte pour dimensionner la texture
  const probe = new DynamicTexture("tagProbe", { width: 16, height: 16 }, scene, false);
  const pctx = probe.getContext();
  pctx.font = TAG_FONT;
  const textW = Math.ceil(pctx.measureText(text).width);
  probe.dispose();
  const PAD = 28, H = 72;
  const W = Math.max(48, textW + PAD * 2);
  // 2) dessiner : pastille translucide (fillRect) puis texte centré via drawText (x=null centre ;
  //    clearColor=null -> ne efface PAS la pastille). On évite ainsi textAlign/textBaseline
  //    (absents du type ICanvasRenderingContext de Babylon).
  const tex = new DynamicTexture(`tag-${text}`, { width: W, height: H }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext();
  ctx.fillStyle = "rgba(12,18,16,0.55)";
  ctx.fillRect(0, H * 0.16, W, H * 0.68);
  tex.drawText(text, null, 47, TAG_FONT, "#ffffff", null, true); // invertY -> texte à l'endroit
  // 3) matériau non éclairé (toujours lisible) + plan en billboard
  const mat = new StandardMaterial(`tagMat-${text}`, scene);
  mat.diffuseTexture = tex;
  mat.opacityTexture = tex;
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  const plane = MeshBuilder.CreatePlane("nameTag", { width: TAG_WORLD_H * (W / H), height: TAG_WORLD_H }, scene);
  plane.material = mat;
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.isPickable = false;
  return plane;
}

class RemotePlayer {
  private readonly mesh: Mesh; // capsule = ancre de position (invisible)
  private readonly yawNode: TransformNode;
  private readonly rig: Rig; // membres articulés (cycle de marche)
  private readonly target: Vector3;
  private targetYaw = 0;
  private walkPhase = 0;
  private walkInt = 0;
  private readonly scene: Scene;
  private tag: Mesh; // étiquette flottante au-dessus de la tête (id du joueur, plus tard son nom)
  private tagText: string;

  constructor(scene: Scene, kit: Kit, id: string) {
    this.scene = scene;
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

    // Étiquette : pour l'instant l'identifiant du joueur (sera remplacé par son nom plus tard).
    this.tagText = id;
    this.tag = makeNameTag(scene, id);
    this.tag.parent = this.mesh; // suit l'avatar (pas le yawNode -> ne tourne pas, billboard de toute façon)
    this.tag.position.set(0, TAG_Y, 0);

    this.target = new Vector3(0, 2, 0);
    this.mesh.position.copyFrom(this.target);
  }

  setTransform(t: PlayerTransform): void {
    this.target.set(t.x, t.y, t.z);
    this.targetYaw = t.ry;
  }

  /** Change le texte de l'étiquette (ex. quand le vrai NOM du joueur arrivera, en remplacement de l'id). */
  setLabel(text: string): void {
    if (text === this.tagText) return; // rien à refaire
    this.tagText = text;
    this.tag.dispose(false, true); // libère aussi matériau + texture dynamique
    this.tag = makeNameTag(this.scene, text);
    this.tag.parent = this.mesh;
    this.tag.position.set(0, TAG_Y, 0);
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
    this.tag.dispose(false, true); // étiquette + matériau + texture
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

  /** Définit le NOM affiché au-dessus d'un joueur (remplace l'id par défaut). Prévu pour quand
   *  les vrais noms seront disponibles ; sans effet si le joueur distant n'existe pas encore. */
  setName(id: string, name: string): void {
    this.players.get(id)?.setLabel(name);
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

  /** Positions (x,z) interpolées INDEXÉES par id — pour alimenter `SET_POSITIONS` côté hôte (M8.6). */
  entries(): Array<{ id: string; x: number; z: number }> {
    const out: Array<{ id: string; x: number; z: number }> = [];
    for (const [id, p] of this.players) {
      const v = p.position;
      out.push({ id, x: v.x, z: v.z });
    }
    return out;
  }

  clear(): void {
    for (const p of this.players.values()) p.dispose();
    this.players.clear();
  }
}
