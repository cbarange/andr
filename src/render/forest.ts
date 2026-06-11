// ============================================================================
//  LA FORÊT (refonte récolte) — les arbres sont une ressource FINIE qui repousse.
//  Chaque arbre s'abat en plusieurs COUPS (config.gather.chopsPerTree) : il rétrécit
//  à chaque coup, puis TOMBE et disparaît. Un nouvel arbre repousse ailleurs plus tard.
//  État LOCAL au joueur (non synchronisé) — comme la physique ; seul l'entrepôt est partagé.
// ============================================================================

import {
  Scene,
  Mesh,
  MeshBuilder,
  Color4,
  Vector3,
  ParticleSystem,
  DynamicTexture,
  PhysicsAggregate,
  PhysicsShapeType,
  type InstancedMesh,
} from "@babylonjs/core";
import { trees as treeSlots, terrainHeight, config } from "../../data/world";
import { Trees, initialChops, chopScale } from "./trees";

const WOBBLE_TIME = 0.32; // durée de la petite secousse après un coup (s)

interface Slot {
  x: number;
  z: number;
  occupied: boolean;
  excluded?: boolean; // emplacement sous un bâtiment : aucun arbre n'y (re)pousse jamais
}

interface LiveTree {
  id: number;
  slot: number;
  mesh: InstancedMesh;
  collider: Mesh;
  aggregate: PhysicsAggregate;
  chopsLeft: number;
  falling: number; // > 0 : en train de tomber (secondes restantes)
  wobble: number; // > 0 : secousse de coupe en cours (secondes restantes)
}

// Essences disponibles dans la forêt (arbres « pleins » récoltables). Le décor non
// récoltable (buisson, souche, arbre mort…) relève du futur système de dispersion.
const SPECIES = ["pine", "oak", "birch", "autumn", "cypress", "petit"] as const;

/** Essence DÉTERMINISTE (stable, cohérente entre pairs) pour un emplacement. Le NORD du
 *  camp (z ≤ -6) tend vers la PINÈDE (conifères) ; les abords/flancs gardent un mélange. */
function speciesFor(slot: number, z: number): string {
  const h = Math.sin(slot * 127.1 + 311.7) * 43758.5453;
  const r = h - Math.floor(h); // [0,1) stable
  if (z <= -6) {
    const conifers = ["pine", "pine", "cypress", "pine", "petit"]; // forêt de pins au nord
    return conifers[Math.floor(r * conifers.length) % conifers.length];
  }
  return SPECIES[Math.floor(r * SPECIES.length) % SPECIES.length];
}

export class Forest {
  private readonly slots: Slot[];
  private readonly trees = new Map<number, LiveTree>();
  private nextId = 1;
  private nextRegrow: number; // secondes avant la prochaine repousse
  private readonly leaves: ParticleSystem; // UN seul système réutilisé (au repos hors coupe)

  constructor(private readonly scene: Scene, private readonly treeMeshes: Trees) {
    this.slots = treeSlots.map((t) => ({ x: t.x, z: t.z, occupied: false }));
    this.nextRegrow = config.gather.treeRegrowSeconds;
    this.leaves = this.makeLeafParticles();

    // Forêt initiale : on occupe tous les emplacements.
    for (let i = 0; i < this.slots.length; i++) this.spawnAt(i);
  }

  /** Petit système de particules de feuilles, réutilisé pour chaque coup (léger). */
  private makeLeafParticles(): ParticleSystem {
    // Texture minuscule (16px) générée en mémoire : un disque doux, teinté ensuite.
    const tex = new DynamicTexture("leafTex", { width: 16, height: 16 }, this.scene, false);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 16, 16);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(8, 8, 6, 0, Math.PI * 2);
    ctx.fill();
    tex.hasAlpha = true;
    tex.update();

    const ps = new ParticleSystem("leafBurst", 80, this.scene); // capacité modeste
    ps.particleTexture = tex;
    ps.emitter = new Vector3(0, 0, 0); // repositionné à chaque coup
    ps.minEmitBox = new Vector3(-0.4, -0.2, -0.4);
    ps.maxEmitBox = new Vector3(0.4, 0.3, 0.4);
    // Feuilles plus claires que le feuillage dense (elles captent la lumière) + quelques
    // teintes jaunes -> lisibles au crépuscule, plus vivantes.
    ps.color1 = new Color4(0.5, 0.72, 0.42, 1);
    ps.color2 = new Color4(0.66, 0.6, 0.3, 1);
    ps.colorDead = new Color4(0.32, 0.3, 0.2, 0); // se fane en tombant
    ps.minSize = 0.08;
    ps.maxSize = 0.2;
    ps.minLifeTime = 0.5;
    ps.maxLifeTime = 1.0;
    ps.emitRate = 0; // aucune émission continue : on n'émet QUE par bouffées manuelles
    ps.manualEmitCount = 0;
    ps.gravity = new Vector3(0, -4, 0); // les feuilles retombent
    ps.direction1 = new Vector3(-1, 1.4, -1);
    ps.direction2 = new Vector3(1, 2.4, 1);
    ps.minEmitPower = 0.5;
    ps.maxEmitPower = 1.5;
    ps.minAngularSpeed = -3;
    ps.maxAngularSpeed = 3;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.start();
    return ps;
  }

  /** Émet une bouffée de feuilles au point donné (réutilise l'unique système). Public :
   *  les arbres sauvages (render/terrain.ts) réutilisent ce même effet via main.ts. */
  burstLeaves(x: number, y: number, z: number, count: number): void {
    (this.leaves.emitter as Vector3).set(x, y, z);
    this.leaves.manualEmitCount = count; // émis à la prochaine frame, puis repasse à 0
  }

  /** Arbres vivants (non en train de tomber) — pour la détection d'interaction. */
  getTrees(): Array<{ id: number; x: number; z: number }> {
    const out: Array<{ id: number; x: number; z: number }> = [];
    for (const t of this.trees.values()) {
      if (t.falling <= 0) out.push({ id: t.id, x: this.slots[t.slot].x, z: this.slots[t.slot].z });
    }
    return out;
  }

  /** Un coup de hache : l'arbre rétrécit ; renvoie `true` s'il vient d'être abattu. */
  chop(id: number): boolean {
    const t = this.trees.get(id);
    if (!t || t.falling > 0) return false;
    t.chopsLeft -= 1;
    const sx = this.slots[t.slot].x;
    const sz = this.slots[t.slot].z;
    const sy = terrainHeight(sx, sz);
    if (t.chopsLeft <= 0) {
      // Abattu : on retire la collision tout de suite, l'arbre bascule puis disparaît.
      t.aggregate.dispose();
      t.collider.dispose();
      t.falling = 1.0;
      this.burstLeaves(sx, sy + 2.4, sz, 22); // chute -> plus de feuilles
      return true;
    }
    // Rétrécit visuellement selon les coups restants + petite secousse + feuilles.
    const k = chopScale(t.chopsLeft);
    t.mesh.scaling.setAll(k);
    t.wobble = WOBBLE_TIME;
    this.burstLeaves(sx, sy + 2.7 * k, sz, 9); // coup -> petite bouffée au niveau du feuillage
    return false;
  }

  update(dtSec: number): void {
    // Animation de chute + disparition, ou petite secousse de coupe.
    for (const t of [...this.trees.values()]) {
      if (t.falling > 0) {
        t.falling -= dtSec;
        const fall = 1 - Math.max(0, t.falling); // 0 -> 1
        t.mesh.rotation.z = fall * (Math.PI / 2.1);
        t.mesh.position.y = terrainHeight(this.slots[t.slot].x, this.slots[t.slot].z) - fall * 0.6;
        if (t.falling <= 0) {
          t.mesh.dispose();
          this.slots[t.slot].occupied = false;
          this.trees.delete(t.id);
        }
      } else if (t.wobble > 0) {
        // Oscillation amortie : forte au départ, s'éteint vers 0.
        t.wobble = Math.max(0, t.wobble - dtSec);
        const p = t.wobble / WOBBLE_TIME; // 1 -> 0
        t.mesh.rotation.z = t.wobble > 0 ? Math.sin(t.wobble * 40) * 0.07 * p : 0;
      }
    }
    // Repousse : à intervalle régulier, un arbre réapparaît sur un emplacement libre.
    this.nextRegrow -= dtSec;
    if (this.nextRegrow <= 0) {
      this.nextRegrow = config.gather.treeRegrowSeconds;
      const free = this.slots.findIndex((s) => !s.occupied && !s.excluded); // jamais sous un bâtiment
      if (free >= 0) this.spawnAt(free);
    }
  }

  /** Dégage l'emprise d'un bâtiment : retire les arbres du camp qui s'y trouvent et EXCLUT
   *  définitivement ces emplacements (plus aucune repousse dedans). Appelé à la construction. */
  clearFootprint(x: number, z: number, r: number): void {
    const r2 = r * r;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if ((s.x - x) ** 2 + (s.z - z) ** 2 > r2) continue;
      s.excluded = true; // ne repoussera plus jamais ici
      // Retire l'arbre vivant éventuel posé sur cet emplacement.
      for (const t of this.trees.values()) {
        if (t.slot !== i) continue;
        if (t.falling <= 0) { t.aggregate.dispose(); t.collider.dispose(); }
        t.mesh.dispose();
        this.trees.delete(t.id);
        break;
      }
    }
  }

  private spawnAt(slotIndex: number): void {
    const slot = this.slots[slotIndex];
    slot.occupied = true;
    const y = terrainHeight(slot.x, slot.z);
    const id = this.nextId++;

    // TAILLE INITIALE aléatoire (déterministe par slot) : coups restants ∈ [1, max] -> échelle.
    // Un arbre peut apparaître petit (1 seul coup avant de tomber) -> hauteurs variées.
    const chopsLeft = initialChops(slotIndex);
    const s0 = chopScale(chopsLeft);

    // Essence déterministe par emplacement -> diversité stable et cohérente P2P.
    const mesh = this.treeMeshes.createInstance(
      speciesFor(slotIndex, slot.z), slot.x, y, slot.z, (slotIndex * 1.7) % (Math.PI * 2), s0,
    );

    // Collider proportionnel à la taille de l'arbre (petit arbre -> petit collider).
    const colH = 3.2 * s0;
    const collider = MeshBuilder.CreateCylinder(`treeCol-${id}`, { height: colH, diameter: 0.8 * s0, tessellation: 6 }, this.scene);
    collider.position.set(slot.x, y + colH / 2, slot.z);
    collider.isVisible = false;
    const aggregate = new PhysicsAggregate(collider, PhysicsShapeType.CYLINDER, { mass: 0 }, this.scene);

    this.trees.set(id, { id, slot: slotIndex, mesh, collider, aggregate, chopsLeft, falling: 0, wobble: 0 });
  }
}
