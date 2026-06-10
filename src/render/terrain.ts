// ============================================================================
//  TERRAIN STREAMÉ (M7) — le sol du MONDE autour du campement, chargé par CHUNKS
//  autour du joueur et déchargé au loin (le brouillard masque la frontière, §8).
//  Chaque chunk = bloc de `worldgen.chunkCells` cellules : un patch de sol déformé
//  par terrainHeight, coloré PAR BIOME (mélange aux frontières via l'échantillonnage
//  par sommet), flat-shaded, + un collider statique (la capsule Havok du joueur s'y
//  pose — cf. player.ts). La carte logique vient de sim/worldgen.ts (pure, à graine).
//  Voir docs/plan-monde.md (Phase 2).
// ============================================================================

import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  VertexBuffer,
  TransformNode,
  PhysicsAggregate,
  PhysicsShapeType,
  type InstancedMesh,
} from "@babylonjs/core";
import { terrainHeight, worldgen, Biome } from "../../data/world";
import { PALETTE } from "./scene";
import { scatterCell, type WorldMap } from "../sim/worldgen";
import { Trees, initialChops, chopScale } from "./trees";
import { Decor } from "./scatter";
import { propBandFor, keepProp, isChoppable, type PropBand } from "./proplod";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// « Texture » du sol = léger MOUCHETAGE déterministe des vertex colors (pas de texture lourde,
// fidèle au style low-poly flat-shaded, §5). Mélange basse fréquence (taches douces) + haute
// fréquence (grain). Renvoie un facteur de luminosité ~[1-AMOUNT, 1+AMOUNT].
const GROUND_NOISE = 0.14; // intensité du mouchetage par facette (± ~14 %)
function groundTint(x: number, z: number): number {
  const soft = Math.sin(x * 0.13) * Math.cos(z * 0.11) + Math.sin((x - z) * 0.07); // ~[-2,2]
  const grain = Math.sin(x * 1.7 + z * 0.9) * Math.sin(x * 0.5 - z * 1.3); // ~[-1,1]
  return 1 + (soft * 0.25 + grain * 0.55) * GROUND_NOISE;
}

const CELL = worldgen.cellSize;
const CHUNK_SIZE = worldgen.chunkCells * CELL; // côté d'un chunk en unités-monde
const SUBDIV = worldgen.chunkCells * 4; // ~3 u/quad : assez fin pour le relief + les biomes
const LOAD = worldgen.loadRadiusChunks;
const UNLOAD = worldgen.unloadRadiusChunks;
const BUILD_PER_FRAME = 1; // amortit la génération (sol + décor) -> pas de micro-freeze
// PHYSIQUE LOCALISÉE (perf, P2) : seuls les chunks dans ce rayon (en chunks) AUTOUR DE
// CHAQUE JOUEUR portent un collider Havok. Le sol reste VISIBLE loin (mesh seul) mais
// sans collider -> la physique ne paie que le voisinage immédiat, même à grande view range.
// MULTIJOUEUR : le rayon est centré sur le joueur local ET sur chaque avatar distant
// (cf. syncPhysics) -> tout pair a du sol solide sous lui, pas seulement l'hôte local.
const PHYS_R = 1; // 1 chunk -> bloc 3×3 autour de chaque joueur (anti-chute aux frontières)
const PROPS_PER_FRAME = 2; // rebuilds de props (changement de palier LOD) amortis par frame (P3)
// Le monde est BORNÉ : on ne génère pas de chunks au-delà du bord (les montagnes du
// terrain — cf. data/terrainHeight — forment le mur ; on déborde d'un chunk pour leur base).
const WORLD_RADIUS = worldgen.radiusCells * worldgen.cellSize;
const MAX_CHUNK_DIST = WORLD_RADIUS + CHUNK_SIZE * 1.5;

// Coupe des arbres sauvages : MÊME comportement que la forêt du camp (cf. forest.ts ; taille
// initiale aléatoire via initialChops/chopScale, partagés dans trees.ts).
const WOBBLE_TIME = 0.32; // secousse après un coup (s)
const FALL_TIME = 1.0; // durée de la chute (s)

interface WildTree {
  mesh: InstancedMesh;
  x: number;
  z: number;
  scale: number; // échelle de base (pour rétrécir proportionnellement à la coupe)
  chopsLeft: number;
  wobble: number; // > 0 : secousse en cours
  falling: number; // > 0 : en train de tomber
}
interface Chunk {
  mesh: Mesh;
  body: PhysicsAggregate | null; // collider Havok : présent SEULEMENT près d'un joueur (P2)
  props: TransformNode; // décor sauvage (arbres…) : disposé avec le chunk
  trees: WildTree[]; // arbres coupables (à la demande, sans tooltip)
  band: PropBand; // palier LOD des props (near = complet/coupable ; far = allégé) (P3)
}

interface BiomeGround {
  low: Color3;
  high: Color3;
}

export class Terrain {
  private readonly chunks = new Map<string, Chunk>();
  private readonly mat: StandardMaterial;
  private readonly ground: Record<number, BiomeGround>;
  private readonly anim: WildTree[] = []; // arbres sauvages en cours de secousse/chute
  private textureOn = true; // mouchetage du sol (switch dans le HUD debug)
  private loadR: number = LOAD; // rayon de chargement (chunks) — réglable via "view range"
  private unloadR: number = UNLOAD; // rayon de déchargement (hystérésis)
  private pcx = 0; // chunk du joueur local (pour le palier LOD des props, P3)
  private pcz = 0;

  constructor(
    private readonly scene: Scene,
    private map: WorldMap, // mutable : remplacée par regenerate() (/seed)
    private readonly trees: Trees,
    private readonly decor: Decor,
  ) {
    // Un seul matériau (couleur portée par les vertex colors) -> peu de draw calls.
    this.mat = new StandardMaterial("terrainMat", scene);
    this.mat.diffuseColor = Color3.White();
    this.mat.specularColor = new Color3(0, 0, 0);

    this.ground = {
      [Biome.Camp]: { low: PALETTE.groundLow, high: PALETTE.ground },
      [Biome.Forest]: { low: PALETTE.forestGroundLow, high: PALETTE.forestGround },
      [Biome.Field]: { low: PALETTE.fieldGroundLow, high: PALETTE.fieldGround },
      [Biome.Barren]: { low: PALETTE.barrenGroundLow, high: PALETTE.barrenGround },
    };

    // Charge d'emblée le voisinage IMMÉDIAT du centre (le joueur y apparaît et tombe
    // dessus) ; le reste du rayon se remplit en quelques frames via update() (amorti).
    const initR = Math.min(1, this.loadR);
    for (let dz = -initR; dz <= initR; dz++) {
      for (let dx = -initR; dx <= initR; dx++) this.build(dx, dz);
    }
    // Le joueur apparaît près de l'origine : il faut un collider sous lui DÈS le boot.
    this.syncPhysics([{ x: 0, z: 0 }]);
  }

  /**
   * Streaming + physique localisée + animations de coupe. À appeler chaque frame.
   * `playerPos` : joueur LOCAL (pilote le streaming visuel). `physicsAt` : positions de TOUS
   * les joueurs (local + distants) autour desquels garder un sol solide — défaut : le local seul.
   */
  update(playerPos: Vector3, dtSec: number, physicsAt?: ReadonlyArray<{ x: number; z: number }>): void {
    this.animateChops(dtSec);
    const ccx = Math.round(playerPos.x / CHUNK_SIZE);
    const ccz = Math.round(playerPos.z / CHUNK_SIZE);
    this.pcx = ccx; // chunk du joueur -> palier LOD des props (P3)
    this.pcz = ccz;

    // 1) Décharger les chunks au-delà du rayon de déchargement.
    for (const [key, ch] of this.chunks) {
      const comma = key.indexOf(",");
      const x = Number(key.slice(0, comma));
      const z = Number(key.slice(comma + 1));
      if (Math.max(Math.abs(x - ccx), Math.abs(z - ccz)) > this.unloadR) {
        ch.body?.dispose();
        ch.mesh.dispose();
        ch.props.dispose(); // dispose aussi les instances de décor enfants
        this.chunks.delete(key);
      }
    }

    // 2) Charger les manquants dans le rayon, du plus proche au plus loin (amorti).
    const missing: Array<{ x: number; z: number; d: number }> = [];
    for (let dz = -this.loadR; dz <= this.loadR; dz++) {
      for (let dx = -this.loadR; dx <= this.loadR; dx++) {
        const cx2 = ccx + dx;
        const cz2 = ccz + dz;
        if (this.chunks.has(cx2 + "," + cz2)) continue;
        if (Math.hypot(cx2 * CHUNK_SIZE, cz2 * CHUNK_SIZE) > MAX_CHUNK_DIST) continue; // hors monde
        missing.push({ x: cx2, z: cz2, d: Math.max(Math.abs(dx), Math.abs(dz)) });
      }
    }
    missing.sort((a, b) => a.d - b.d);
    let built = 0;
    for (const m of missing) {
      const isCurrent = m.x === ccx && m.z === ccz;
      // Le chunk SOUS le joueur est garanti immédiatement (anti-chute) ; le reste est amorti.
      if (!isCurrent && built >= BUILD_PER_FRAME) break;
      this.build(m.x, m.z);
      if (!isCurrent) built++;
    }

    // 3) Physique localisée : (dé)pose les colliders autour de chaque joueur.
    this.syncPhysics(physicsAt ?? [{ x: playerPos.x, z: playerPos.z }]);

    // 4) Paliers LOD des props : éclaircit au loin, densifie en approchant (amorti, P3).
    this.syncPropBands();
  }

  /**
   * Réconcilie le PALIER de props de chaque chunk avec sa distance au joueur (P3). En
   * approchant (far -> near) on densifie (petit décor + arbres coupables) ; en s'éloignant
   * (near -> far) on allège. Les rebuilds sont amortis (PROPS_PER_FRAME) et priorisés du plus
   * proche au plus loin (la pop la plus visible d'abord) -> pas de micro-freeze.
   */
  private syncPropBands(): void {
    const changes: Array<{ ch: Chunk; cx: number; cz: number; band: PropBand; d: number }> = [];
    for (const [key, ch] of this.chunks) {
      const comma = key.indexOf(",");
      const cx = Number(key.slice(0, comma));
      const cz = Number(key.slice(comma + 1));
      const d = Math.max(Math.abs(cx - this.pcx), Math.abs(cz - this.pcz));
      const band = propBandFor(d, ch.band);
      if (band !== ch.band) changes.push({ ch, cx, cz, band, d });
    }
    if (changes.length === 0) return;
    changes.sort((a, b) => a.d - b.d); // les plus proches d'abord (upgrades prioritaires)
    for (let i = 0; i < changes.length && i < PROPS_PER_FRAME; i++) {
      const c = changes[i];
      this.setPropBand(c.ch, c.cx, c.cz, c.band);
    }
  }

  /**
   * Réconcilie les COLLIDERS : un chunk chargé porte un collider Havok si et seulement si
   * un joueur (local ou distant) est à ≤ PHYS_R chunks. Crée/supprime à la volée -> coût
   * physique borné au voisinage des joueurs, indépendamment de la distance de rendu.
   * MULTIJOUEUR : `positions` contient le joueur local ET tous les avatars distants.
   */
  private syncPhysics(positions: ReadonlyArray<{ x: number; z: number }>): void {
    const pc = positions.map((p) => ({
      cx: Math.round(p.x / CHUNK_SIZE),
      cz: Math.round(p.z / CHUNK_SIZE),
    }));
    for (const [key, ch] of this.chunks) {
      const comma = key.indexOf(",");
      const cx = Number(key.slice(0, comma));
      const cz = Number(key.slice(comma + 1));
      let near = false;
      for (const p of pc) {
        if (Math.max(Math.abs(cx - p.cx), Math.abs(cz - p.cz)) <= PHYS_R) {
          near = true;
          break;
        }
      }
      if (near && !ch.body) {
        ch.body = new PhysicsAggregate(ch.mesh, PhysicsShapeType.MESH, { mass: 0 }, this.scene);
      } else if (!near && ch.body) {
        ch.body.dispose();
        ch.body = null;
      }
    }
  }

  /** Active/désactive le MOUCHETAGE du sol (texture). Re-colore les chunks déjà chargés. */
  setGroundTexture(on: boolean): void {
    if (on === this.textureOn) return;
    this.textureOn = on;
    for (const [key, ch] of this.chunks) {
      const comma = key.indexOf(",");
      const ox = Number(key.slice(0, comma)) * CHUNK_SIZE;
      const oz = Number(key.slice(comma + 1)) * CHUNK_SIZE;
      this.paintGround(ch.mesh, ox, oz);
    }
  }

  get groundTextureOn(): boolean {
    return this.textureOn;
  }

  /** Règle la « view range » = rayon de chunks chargés (plus grand = voir plus loin, plus coûteux). */
  setLoadRadius(chunks: number): void {
    this.loadR = Math.max(1, Math.floor(chunks));
    this.unloadR = this.loadR + 1; // hystérésis
  }

  get loadRadius(): number {
    return this.loadR;
  }

  /** Stats HUD/e2e : chunks chargés (mesh visible), colliders (physique active, P2), instances
   *  de décor (props, P3), chunks au palier proche, et objets à matrice monde FIGÉE (P4). */
  get stats(): { chunks: number; colliders: number; props: number; near: number; frozen: number } {
    let colliders = 0;
    let props = 0;
    let near = 0;
    let frozen = 0;
    for (const ch of this.chunks.values()) {
      if (ch.body) colliders++;
      if (ch.band === "near") near++;
      if (ch.mesh.isWorldMatrixFrozen) frozen++;
      const kids = ch.props.getChildMeshes(true);
      props += kids.length;
      for (const k of kids) if (k.isWorldMatrixFrozen) frozen++;
    }
    return { chunks: this.chunks.size, colliders, props, near, frozen };
  }

  /** Couleur PAR FACETTE d'un patch de sol : biome + altitude au centre de la face, × mouchetage
   *  (si activé). Réutilisé à la construction du chunk ET au basculement du switch. */
  private paintGround(mesh: Mesh, ox: number, oz: number): void {
    const fp = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const fcols = new Array<number>((fp.length / 3) * 4);
    for (let f = 0; f < fp.length; f += 9) { // 3 sommets (9 floats) par triangle
      const cxw = (fp[f] + fp[f + 3] + fp[f + 6]) / 3 + ox;
      const cyw = (fp[f + 1] + fp[f + 4] + fp[f + 7]) / 3;
      const czw = (fp[f + 2] + fp[f + 5] + fp[f + 8]) / 3 + oz;
      const cell = this.map.worldToCell(cxw, czw);
      const g = this.ground[this.map.biomeAt(cell.cx, cell.cz)] ?? this.ground[Biome.Barren];
      const t = clamp01((cyw + 2) / 4);
      const tint = this.textureOn ? groundTint(cxw, czw) : 1; // mouchetage désactivable
      const r = clamp01(lerp(g.low.r, g.high.r, t) * tint);
      const gg = clamp01(lerp(g.low.g, g.high.g, t) * tint);
      const b = clamp01(lerp(g.low.b, g.high.b, t) * tint);
      const v0 = f / 3;
      for (let k = 0; k < 3; k++) {
        const ci = (v0 + k) * 4;
        fcols[ci] = r;
        fcols[ci + 1] = gg;
        fcols[ci + 2] = b;
        fcols[ci + 3] = 1;
      }
    }
    mesh.setVerticesData(VertexBuffer.ColorKind, fcols, false);
  }

  /** Régénère le monde sur une nouvelle carte (/seed) : décharge tout, recharge autour du joueur. */
  regenerate(newMap: WorldMap, around: Vector3): void {
    for (const ch of this.chunks.values()) {
      ch.body?.dispose();
      ch.mesh.dispose();
      ch.props.dispose();
    }
    this.chunks.clear();
    this.map = newMap;
    const ccx = Math.round(around.x / CHUNK_SIZE);
    const ccz = Math.round(around.z / CHUNK_SIZE);
    this.pcx = ccx; // palier LOD des props relatif au point de régénération (P3)
    this.pcz = ccz;
    const initR = Math.min(1, this.loadR);
    for (let dz = -initR; dz <= initR; dz++) {
      for (let dx = -initR; dx <= initR; dx++) this.build(ccx + dx, ccz + dz);
    }
    this.syncPhysics([{ x: around.x, z: around.z }]); // sol solide sous le joueur après /seed
  }

  private build(ccx: number, ccz: number): void {
    const key = ccx + "," + ccz;
    if (this.chunks.has(key)) return;

    const ox = ccx * CHUNK_SIZE; // centre monde du chunk
    const oz = ccz * CHUNK_SIZE;
    if (Math.hypot(ox, oz) > MAX_CHUNK_DIST) return; // au-delà du bord du monde : pas de chunk
    const mesh = MeshBuilder.CreateGround(
      "chunk-" + key,
      { width: CHUNK_SIZE, height: CHUNK_SIZE, subdivisions: SUBDIV, updatable: true },
      this.scene,
    );
    mesh.position.set(ox, 0, oz);

    // 1) Relief : on bake terrainHeight dans la géométrie (sol + collider cohérents).
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i + 1] = terrainHeight(pos[i] + ox, pos[i + 2] + oz);
    }
    mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
    mesh.createNormals(true);
    mesh.convertToFlatShadedMesh(); // sommets dédupliqués PAR FACE -> facettes low-poly

    // 2) Couleur PAR FACETTE (biome + altitude + mouchetage si activé).
    this.paintGround(mesh, ox, oz);
    mesh.material = this.mat;
    mesh.useVertexColors = true;
    mesh.receiveShadows = true;
    // P4 : le sol ne bouge JAMAIS -> on FIGE sa matrice monde (plus de recalcul par frame).
    // Le mouchetage (vertex colors) et le collider restent modifiables ; seul le transform est gelé.
    mesh.freezeWorldMatrix();

    // P2 : PAS de collider à la construction. syncPhysics() en posera un seulement si un
    // joueur est proche (le sol reste visible au loin sans coûter à la physique).

    // Palier LOD initial selon la distance au joueur (P3) : un chunk apparu au BORD du rayon
    // de chargement naît directement « far » (décor allégé) ; il sera densifié en approchant.
    const dist = Math.max(Math.abs(ccx - this.pcx), Math.abs(ccz - this.pcz));
    const band = propBandFor(dist, "far");
    const chunk: Chunk = { mesh, body: null, props: new TransformNode("chunkProps-" + key, this.scene), trees: [], band };
    this.buildProps(chunk, ccx, ccz, band);
    this.chunks.set(key, chunk);
  }

  /** Disperse le décor SAUVAGE déterministe du chunk selon son palier LOD (P3) : arbres (Trees) +
   *  décor (Decor) issus de sim/worldgen.scatterCell. `near` = complet + coupable ; `far` = allégé. */
  private buildProps(chunk: Chunk, ccx: number, ccz: number, band: PropBand): void {
    const node = chunk.props;
    const cc = worldgen.chunkCells;
    const half = Math.floor(cc / 2);
    let treeIdx = 0; // rang des arbres dans le chunk (éclaircissement déterministe au loin)
    for (let lx = 0; lx < cc; lx++) {
      for (let lz = 0; lz < cc; lz++) {
        const cellX = cc * ccx - half + lx;
        const cellZ = cc * ccz - half + lz;
        const biome = this.map.biomeAt(cellX, cellZ);
        if (biome === Biome.Camp) continue; // le camp a sa propre forêt (forest.ts)
        for (const p of scatterCell(cellX, cellZ, biome, this.map.seed)) {
          const idx = p.kind === "tree" ? treeIdx++ : 0;
          if (!keepProp(p.kind, band, idx)) continue; // petit décor masqué / arbres éclaircis au loin
          const y = terrainHeight(p.x, p.z);
          let inst: InstancedMesh | null = null;
          let choppable = false;
          if (p.kind === "tree" && p.species) {
            // TAILLE INITIALE aléatoire (déterministe par position) : coups ∈ [1, max] -> échelle,
            // par-dessus l'échelle d'essence du scatter. Paysage aux hauteurs variées. (cf. forest.ts)
            const chops = initialChops(p.x * 127.1 + p.z * 311.7);
            const s0 = p.scale * chopScale(chops);
            inst = this.trees.createInstance(p.species, p.x, y, p.z, p.rotY, s0);
            choppable = isChoppable(band);
            if (inst && choppable) {
              chunk.trees.push({ mesh: inst, x: p.x, z: p.z, scale: p.scale, chopsLeft: chops, wobble: 0, falling: 0 });
            }
          } else if (p.kind === "bush" || p.kind === "stump") {
            inst = this.trees.createInstance(p.kind, p.x, y, p.z, p.rotY, p.scale);
          } else {
            inst = this.decor.createInstance(p.kind, p.x, y, p.z, p.rotY, p.scale);
          }
          if (inst) {
            inst.parent = node;
            // P4 : décor STATIQUE -> matrice monde FIGÉE (zéro recalcul/frame). Seuls les arbres
            // COUPABLES restent libres (ils s'animent à la coupe : secousse + chute). Reste cullé.
            if (!choppable) inst.freezeWorldMatrix();
          }
        }
      }
    }
  }

  /** Bascule un chunk déjà chargé vers un autre palier LOD : jette ses props et les reconstruit (P3). */
  private setPropBand(chunk: Chunk, ccx: number, ccz: number, band: PropBand): void {
    if (chunk.band === band) return;
    // Retire les arbres coupables de ce chunk de la file d'animation avant de tout jeter.
    for (const t of chunk.trees) {
      const i = this.anim.indexOf(t);
      if (i >= 0) this.anim.splice(i, 1);
    }
    chunk.trees.length = 0;
    chunk.props.dispose(); // dispose les instances enfants
    chunk.props = new TransformNode("chunkProps-" + ccx + "," + ccz, this.scene);
    chunk.band = band;
    this.buildProps(chunk, ccx, ccz, band);
  }

  /**
   * UN coup de hache sur l'arbre sauvage le plus proche dans `range` (interaction « à la demande »,
   * SANS tooltip — cf. main.ts). MÊME comportement que la forêt du camp : 3 coups (rétrécit +
   * secousse), puis chute animée. Renvoie le point (pour les feuilles) + `felled` (abattu ce coup).
   * NB : le scatter étant déterministe, l'arbre réapparaît si le chunk est rechargé.
   */
  chopNearestTree(px: number, pz: number, range: number): { x: number; y: number; z: number; felled: boolean } | null {
    let bestD = range;
    let bestList: WildTree[] | null = null;
    let bestIdx = -1;
    for (const ch of this.chunks.values()) {
      for (let i = 0; i < ch.trees.length; i++) {
        const t = ch.trees[i];
        if (t.falling > 0) continue; // déjà en train de tomber
        const d = Math.hypot(t.x - px, t.z - pz);
        if (d < bestD) {
          bestD = d;
          bestList = ch.trees;
          bestIdx = i;
        }
      }
    }
    if (!bestList) return null;
    const t = bestList[bestIdx];
    t.chopsLeft -= 1;
    const baseY = terrainHeight(t.x, t.z);
    if (this.anim.indexOf(t) < 0) this.anim.push(t);
    if (t.chopsLeft <= 0) {
      // Abattu : il bascule puis disparaît ; retiré des arbres coupables.
      t.falling = FALL_TIME;
      bestList.splice(bestIdx, 1);
      return { x: t.x, y: baseY + 2.4, z: t.z, felled: true };
    }
    // Coup : rétrécit (proportionnel à l'échelle de base) + petite secousse.
    const k = chopScale(t.chopsLeft);
    t.mesh.scaling.setAll(t.scale * k);
    t.wobble = WOBBLE_TIME;
    return { x: t.x, y: baseY + 2.7 * k * t.scale, z: t.z, felled: false };
  }

  /** Anime les arbres sauvages en cours de secousse (après un coup) ou de chute (abattus). */
  private animateChops(dtSec: number): void {
    for (let i = this.anim.length - 1; i >= 0; i--) {
      const t = this.anim[i];
      if (t.mesh.isDisposed()) {
        this.anim.splice(i, 1); // ex. chunk déchargé en pleine animation
        continue;
      }
      if (t.falling > 0) {
        t.falling -= dtSec;
        const fall = 1 - Math.max(0, t.falling); // 0 -> 1
        t.mesh.rotation.z = fall * (Math.PI / 2.1);
        t.mesh.position.y = terrainHeight(t.x, t.z) - fall * 0.6;
        if (t.falling <= 0) {
          t.mesh.dispose();
          this.anim.splice(i, 1);
        }
      } else if (t.wobble > 0) {
        t.wobble = Math.max(0, t.wobble - dtSec);
        const p = t.wobble / WOBBLE_TIME;
        t.mesh.rotation.z = t.wobble > 0 ? Math.sin(t.wobble * 40) * 0.07 * p : 0;
        if (t.wobble <= 0) this.anim.splice(i, 1);
      } else {
        this.anim.splice(i, 1);
      }
    }
  }
}
