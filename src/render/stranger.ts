// ============================================================================
//  L'ÉTRANGÈRE / LA CONSTRUCTRICE (M1) — le premier PNJ. Purement visuel : elle
//  apparaît quand l'état de simulation indique `builder >= 0`, marche jusqu'au feu
//  et s'y tient. Aucune règle de jeu ici (la progression vit dans sim/).
//  Modèle low-poly porté du labo (render/characters.ts). Voir docs/modeles-3d.md.
// ============================================================================

import {
  Scene, TransformNode, Vector3, Mesh, MeshBuilder, StandardMaterial, Color3, DynamicTexture,
} from "@babylonjs/core";
import { terrainHeight } from "../../data/world";
import { makeKit } from "./lowpoly";
import { buildConstructrice } from "./characters";

const SPEED = 1.6; // vitesse de marche (u/s)
const HALF_HEIGHT = 0.9;
const STRIDE = 2.4; // cadence des pas (rad/u)
const FOOT_AMP = 0.4; // amplitude du pas (rad)
const BOB_AMP = 0.05; // flottement vertical en marche (u)

// Point d'arrivée (au bord du campement) et place au coin du feu.
function groundAt(x: number, z: number): Vector3 {
  return new Vector3(x, terrainHeight(x, z) + HALF_HEIGHT, z);
}
const APPROACH = groundAt(11, -7);
const FIRESIDE = groundAt(1.9, 1.3);

export class Stranger {
  // Ancre positionnée (sert à la détection d'interaction / l'étiquette flottante).
  private readonly mesh: TransformNode;
  private readonly yawNode: TransformNode;
  private readonly hipL: TransformNode; // pieds (pivots) — pas de marche
  private readonly hipR: TransformNode;
  private readonly news: Mesh; // « ! » billboard au-dessus de la tête (nouveau bâtiment dispo)
  private walkPhase = 0;
  private walkInt = 0;
  private active = false;
  private home = FIRESIDE.clone(); // lieu de repos : le feu tant qu'elle n'a pas « emménagé »
  private target = FIRESIDE.clone(); // destination courante (cosmétique)

  constructor(scene: Scene) {
    const K = makeKit(scene);
    this.mesh = K.node(null);
    this.mesh.position.copyFrom(APPROACH);
    this.mesh.setEnabled(false);

    // Orientation indépendante (le modèle regarde +Z) + modèle posé au sol
    // (offset -HALF_HEIGHT pour que les pieds touchent le terrain sous l'ancre).
    this.yawNode = K.node(this.mesh);
    const model = K.node(this.yawNode, [0, -HALF_HEIGHT, 0]);
    const c = buildConstructrice(K, model);
    this.hipL = c.hipL;
    this.hipR = c.hipR;

    // « ! » : un panneau billboard au-dessus de la tête, masqué par défaut. `drawText(x=null)`
    // centre horizontalement ; « ! » est symétrique -> pas de souci de miroir.
    const tex = new DynamicTexture("strangerNews", { width: 64, height: 64 }, scene, false);
    tex.hasAlpha = true;
    tex.drawText("!", null, 48, "bold 54px sans-serif", "#ffffff", "transparent", true);
    const mat = new StandardMaterial("strangerNewsMat", scene);
    mat.diffuseTexture = tex;
    mat.opacityTexture = tex;
    mat.emissiveColor = new Color3(0.94, 0.63, 0.31); // teinte « accent » (lueur du feu)
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    this.news = MeshBuilder.CreatePlane("strangerNews", { size: 0.6 }, scene);
    this.news.material = mat;
    this.news.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.news.parent = this.mesh;
    this.news.position.set(0, 1.4, 0); // au-dessus de la tête
    this.news.setEnabled(false);
  }

  /** Affiche le « ! » (un nouveau bâtiment est disponible) — visible seulement si elle est là. */
  setNews(on: boolean): void {
    this.news.setEnabled(this.active && on);
  }

  /** Position monde courante (pour la détection d'interaction / l'étiquette). */
  get position(): Vector3 {
    return this.mesh.position;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Lieu de repos une fois la cabane réparée (son coin : `cabin.builderHome`). */
  setHome(pos: Vector3): void {
    this.home = groundAt(pos.x, pos.z);
  }

  /** Reflète l'étape de l'étrangère issue de la sim (-1 absente, 0..max présente). */
  setBuilder(level: number): void {
    const present = level >= 0;
    if (present && !this.active) {
      this.mesh.position.copyFrom(APPROACH); // (ré)apparaît au bord et marche vers le feu
    }
    this.active = present;
    this.mesh.setEnabled(present);
  }

  /** Destination cosmétique (rejoué depuis la sim) : avant réparation -> au feu ; une fois
   *  installée -> son coin de cabane, SAUF quand elle va RÉALIMENTER le feu (fenêtre `tending`). */
  setActivity(repaired: boolean, tending: boolean): void {
    this.target = !repaired || tending ? FIRESIDE : this.home;
  }

  update(dtSec: number): void {
    if (!this.active) return;
    const pos = this.mesh.position;
    const dir = this.target.subtract(pos);
    const dist = dir.length();
    let moving = false;
    if (dist > 0.05) {
      const step = Math.min(dist, SPEED * dtSec);
      pos.addInPlace(dir.scale(step / dist));
      this.yawNode.rotation.y = Math.atan2(dir.x, dir.z); // tournée vers son déplacement
      this.walkPhase += step * STRIDE;
      moving = true;
    } else {
      this.yawNode.rotation.y = Math.atan2(-pos.x, -pos.z); // au repos : face au feu (origine)
    }
    // Pas de marche : les pieds avancent/reculent en opposition + léger flottement (les bras
    // restent sur le marteau). Fondu via l'intensité (1 en marche, 0 à l'arrêt).
    this.walkInt += ((moving ? 1 : 0) - this.walkInt) * Math.min(1, dtSec * 12);
    const s = Math.sin(this.walkPhase) * FOOT_AMP * this.walkInt;
    this.hipL.rotation.x = s;
    this.hipR.rotation.x = -s;
    this.yawNode.position.y = Math.abs(Math.sin(this.walkPhase)) * BOB_AMP * this.walkInt;
  }
}
