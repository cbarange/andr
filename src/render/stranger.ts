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

const SPEED = 2.9; // vitesse de marche (u/s) — assez vif pour rejoindre vite un chantier
const HALF_HEIGHT = 0.9;
const STRIDE = 2.4; // cadence des pas (rad/u)
const FOOT_AMP = 0.4; // amplitude du pas (rad)
const BOB_AMP = 0.05; // flottement vertical en marche (u)
const BUILD_STANDOFF = 2.0; // distance d'arrêt devant un chantier (elle frappe sans entrer dedans)
const HAMMER_RATE = 9.0; // cadence de frappe (rad/s)
const HAMMER_AMP = 0.85; // amplitude du coup de marteau (rad)

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
  private readonly armR: TransformNode; // épaule droite + marteau — coup de marteau sur un chantier
  private readonly news: Mesh; // « ! » billboard au-dessus de la tête (nouveau bâtiment dispo)
  private walkPhase = 0;
  private walkInt = 0;
  private hammerPhase = 0;
  private hammerInt = 0; // fondu de la frappe (1 sur le chantier, 0 ailleurs)
  private active = false;
  private home = FIRESIDE.clone(); // lieu de repos : le feu tant qu'elle n'a pas « emménagé »
  private target = FIRESIDE.clone(); // destination courante (cosmétique)
  private buildSite: Vector3 | null = null; // chantier où elle va bâtir (prioritaire sur `target`)

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
    this.armR = c.armR;

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

  /** DEBUG/DEV : la repositionne instantanément (sert à tester l'arrivée sur un chantier sans attendre la marche). */
  teleport(x: number, z: number): void {
    this.mesh.position.copyFrom(groundAt(x, z));
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

  /** Chantier en cours (centre x,z du bâtiment qui se construit) : elle s'y rend et y frappe au
   *  marteau. `null` -> plus de chantier, elle reprend son activité normale (feu / coin de cabane). */
  setBuildSite(site: { x: number; z: number } | null): void {
    this.buildSite = site ? groundAt(site.x, site.z) : null;
  }

  /** Est-elle ARRIVÉE sur le chantier courant (à portée de frappe) ? Sert à ne déclencher la
   *  montée du bâtiment qu'à son arrivée. Comparaison sur la position COURANTE (pas un drapeau
   *  figé) -> robuste au changement de chantier (elle n'est « arrivée » qu'une fois sur place). */
  isAtBuildSite(): boolean {
    if (!this.buildSite || !this.active) return false;
    const p = this.mesh.position;
    return Math.hypot(p.x - this.buildSite.x, p.z - this.buildSite.z) <= BUILD_STANDOFF + 0.6;
  }

  update(dtSec: number): void {
    if (!this.active) return;
    const pos = this.mesh.position;
    // Un chantier est PRIORITAIRE : elle s'arrête à BUILD_STANDOFF du bâtiment et frappe.
    const goal = this.buildSite ?? this.target;
    const standoff = this.buildSite ? BUILD_STANDOFF : 0.05;
    const dir = goal.subtract(pos);
    const dist = dir.length();
    let moving = false, hammering = false;
    if (dist > standoff) {
      const step = Math.min(dist - standoff, SPEED * dtSec);
      pos.addInPlace(dir.scale(step / dist));
      this.yawNode.rotation.y = Math.atan2(dir.x, dir.z); // tournée vers son déplacement
      this.walkPhase += step * STRIDE;
      moving = step > 1e-4;
    } else if (this.buildSite) {
      this.yawNode.rotation.y = Math.atan2(dir.x, dir.z); // arrivée : face au chantier
      hammering = true;
    } else {
      this.yawNode.rotation.y = Math.atan2(-pos.x, -pos.z); // au repos : face au feu (origine)
    }
    // Pas de marche : les pieds avancent/reculent en opposition + léger flottement. Fondu via
    // l'intensité (1 en marche, 0 à l'arrêt).
    this.walkInt += ((moving ? 1 : 0) - this.walkInt) * Math.min(1, dtSec * 12);
    const s = Math.sin(this.walkPhase) * FOOT_AMP * this.walkInt;
    this.hipL.rotation.x = s;
    this.hipR.rotation.x = -s;
    this.yawNode.position.y = Math.abs(Math.sin(this.walkPhase)) * BOB_AMP * this.walkInt;
    // Coup de marteau sur le chantier : oscillation rapide de l'épaule (lever lent / frappe sèche),
    // fondue par `hammerInt` pour ne pas s'enclencher en marche.
    this.hammerInt += ((hammering ? 1 : 0) - this.hammerInt) * Math.min(1, dtSec * 10);
    if (this.hammerInt > 0.01) this.hammerPhase += dtSec * HAMMER_RATE;
    // 0 (levé) -> -HAMMER_AMP (abattu) : (1-cos)/2 monte doucement puis retombe vif côté visuel.
    this.armR.rotation.x = -HAMMER_AMP * (0.5 - 0.5 * Math.cos(this.hammerPhase)) * this.hammerInt;
  }
}
