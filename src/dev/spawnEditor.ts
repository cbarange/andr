// ============================================================================
//  ÉDITEUR DE SPAWN (DEV) — outil intégré pour DESSINER l'implantation du campement :
//  vue de dessus, on SÉLECTIONNE / DÉPLACE / TOURNE les bâtiments, on en AJOUTE
//  (huttes, pièges), puis on EXPORTE le `campLayout` (à coller dans data/world.ts).
//
//  Travail PUREMENT éditeur : il masque le village réel, manipule des « ghosts »
//  (vrais modèles via Village.spawnModel), et n'écrit rien tout seul — il produit le
//  texte du layout. Aucune incidence sim/réseau. Voir docs/plan-campement.md.
// ============================================================================

import {
  Scene,
  ArcRotateCamera,
  Vector3,
  TransformNode,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  PointerEventTypes,
  type PointerInfo,
  type Observer,
} from "@babylonjs/core";
import { campLayout, craftables, craftableById, terrainHeight } from "../../data/world";

interface Ghost {
  id: string; // type de bâtiment, ou "cabin"
  root: TransformNode;
}

/** Un chemin en cours de tracé : points monde + meshes de visualisation (repères + segments). */
interface PathDraw {
  pts: Array<{ x: number; z: number }>;
  dots: Mesh[];
  segs: Mesh[];
}

interface EditorDeps {
  spawnModel: (id: string, x: number, z: number, rotY: number) => TransformNode;
  cabin: { x: number; z: number };
  setFollow: (on: boolean) => void; // suivi caméra du joueur (off pendant l'édition)
  setLookEnabled: (on: boolean) => void; // capture du pointeur (off pendant l'édition)
  setWorldHidden: (hidden: boolean) => void; // masque village + cabane + villageois
}

const ROT_STEP = Math.PI / 12; // 15° par cran de rotation
const NUDGE = 0.5; // pas des flèches (u)
const norm = (a: number): number => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

export class SpawnEditor {
  active = false;
  private readonly ghosts: Ghost[] = [];
  private selected: Ghost | null = null;
  private ring: Mesh; // anneau de sélection (repositionné sous le ghost choisi)
  private camTarget = new Vector3(0, 0, 0);
  private prevFog = 0; // brouillard restauré à la fermeture
  private dragging = false; // déplacement du ghost sélectionné
  private panning = false; // déplacement de la vue (clic droit)
  private lastX = 0;
  private lastY = 0;
  private placeSeq = 0; // dispersion des ajouts pour éviter l'empilement exact
  private pointerObs: Observer<PointerInfo> | null = null;
  private readonly panel: HTMLDivElement;
  private readonly out: HTMLTextAreaElement;
  private readonly info: HTMLDivElement;
  // Palette : un bouton par type (cabane + craftables), avec compteur n/max.
  private readonly palette: Array<{ id: string; name: string; max: number; btn: HTMLButtonElement }> = [];
  // Outil de tracé de CHEMINS (campLayout.paths) : mode + chemins dessinés + chemin courant.
  private pathMode = false;
  private readonly paths: PathDraw[] = [];
  private curPath: PathDraw | null = null;
  private pathDotMat?: StandardMaterial;
  private pathSegMat?: StandardMaterial;
  private pathBtn?: HTMLButtonElement;

  constructor(
    private readonly scene: Scene,
    private readonly camera: ArcRotateCamera,
    private readonly deps: EditorDeps,
  ) {
    // Anneau de sélection (plat, émissif), masqué par défaut.
    this.ring = MeshBuilder.CreateTorus("editor-ring", { diameter: 3, thickness: 0.18, tessellation: 28 }, scene);
    const rm = new StandardMaterial("editor-ringMat", scene);
    rm.emissiveColor = new Color3(1, 0.78, 0.32);
    rm.disableLighting = true;
    this.ring.material = rm;
    this.ring.isPickable = false;
    this.ring.setEnabled(false);

    // Panneau DOM (instructions + sélection + actions + zone d'export).
    this.panel = document.createElement("div");
    this.panel.style.cssText =
      "position:fixed;left:12px;top:12px;z-index:50;display:none;width:320px;padding:12px 14px;" +
      "background:rgba(14,18,20,.92);border:1px solid #2a3a40;border-radius:8px;color:#cfe0d6;" +
      "font:12px/1.5 monospace;box-shadow:0 6px 24px rgba(0,0,0,.5)";
    this.panel.innerHTML =
      '<div style="color:#f0a050;font-weight:bold;letter-spacing:1px;margin-bottom:6px">ÉDITEUR DE SPAWN</div>' +
      '<div style="opacity:.8;margin-bottom:8px">clic : sélectionner / glisser · <b>molette : tourner</b> ' +
      "la sélection (Maj+molette : zoom) · clic-droit : déplacer la vue · flèches : ajuster · Échap : quitter</div>" +
      '<div id="se-info" style="margin-bottom:8px;min-height:32px"></div>' +
      '<div style="opacity:.7;margin-bottom:3px">ajouter un élément :</div>' +
      '<div id="se-palette" style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px"></div>' +
      '<div style="opacity:.7;margin-bottom:3px">chemins (clic = point · Entrée = nouveau · Retour = annule) :</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:8px">' +
      '<button id="se-path">✏ tracer un chemin</button><button id="se-pathclr">effacer chemins</button></div>' +
      '<div style="display:flex;gap:6px;margin-bottom:8px">' +
      '<button id="se-del">supprimer</button><button id="se-exp">exporter</button></div>' +
      '<textarea id="se-out" readonly style="display:none;width:100%;height:160px;background:#0b0e10;' +
      'color:#9fd0b0;border:1px solid #2a3a40;border-radius:4px;font:11px/1.4 monospace;padding:6px"></textarea>';
    const btnStyle =
      "background:#1d2a30;color:#cfe0d6;border:1px solid #2a3a40;border-radius:4px;padding:4px 8px;cursor:pointer;font:11px monospace";
    document.body.appendChild(this.panel);
    this.info = this.panel.querySelector("#se-info") as HTMLDivElement;
    this.out = this.panel.querySelector("#se-out") as HTMLTextAreaElement;
    const del = this.panel.querySelector("#se-del") as HTMLButtonElement;
    const exp = this.panel.querySelector("#se-exp") as HTMLButtonElement;
    del.style.cssText = btnStyle; exp.style.cssText = btnStyle;
    del.onclick = () => this.deleteSelected();
    exp.onclick = () => this.exportLayout();
    // Outil chemins.
    this.pathBtn = this.panel.querySelector("#se-path") as HTMLButtonElement;
    const pathClr = this.panel.querySelector("#se-pathclr") as HTMLButtonElement;
    this.pathBtn.style.cssText = btnStyle; pathClr.style.cssText = btnStyle;
    this.pathBtn.onclick = () => this.togglePathMode();
    pathClr.onclick = () => this.clearPaths();
    // Palette : la cabane (singleton) + chaque craftable avec sa quantité max.
    const entries = [{ id: "cabin", name: "cabane", max: 1 }, ...craftables.map((c) => ({ id: c.id, name: c.name, max: c.maximum }))];
    const pal = this.panel.querySelector("#se-palette") as HTMLDivElement;
    for (const e of entries) {
      const btn = document.createElement("button");
      btn.style.cssText = btnStyle;
      btn.onclick = () => this.addGhost(e.id);
      pal.appendChild(btn);
      this.palette.push({ id: e.id, name: e.name, max: e.max, btn });
    }
  }

  private countOf(id: string): number {
    let n = 0;
    for (const g of this.ghosts) if (g.id === id) n++;
    return n;
  }

  private refreshPalette(): void {
    for (const p of this.palette) {
      const n = this.countOf(p.id);
      const full = n >= p.max;
      p.btn.textContent = `${p.name} ${n}/${p.max}`;
      p.btn.disabled = full;
      p.btn.style.opacity = full ? "0.4" : "1";
      p.btn.style.cursor = full ? "default" : "pointer";
    }
  }

  toggle(): void {
    if (this.active) this.close(); else this.open();
  }

  open(): void {
    if (this.active) return;
    this.active = true;
    this.placeSeq = 0;
    this.deps.setFollow(false);
    this.deps.setLookEnabled(false);
    this.deps.setWorldHidden(true);
    this.prevFog = this.scene.fogMode;
    this.scene.fogMode = Scene.FOGMODE_NONE; // pas de brouillard pour lire le plan de haut

    // Caméra de dessus (débridée) centrée sur le feu.
    this.camTarget.set(0, terrainHeight(0, 0), 0);
    this.camera.lowerBetaLimit = 0.001;
    this.camera.upperRadiusLimit = 400;
    this.camera.target.copyFrom(this.camTarget);
    this.camera.alpha = -Math.PI / 2;
    this.camera.beta = 0.12;
    this.camera.radius = 70;

    this.spawnGhosts();
    this.spawnPaths(); // recharge les chemins dessinés existants (campLayout.paths)
    this.panel.style.display = "block";

    const canvas = this.scene.getEngine().getRenderingCanvas();
    canvas?.addEventListener("contextmenu", this.onContext);
    canvas?.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", this.onKey, true);
    this.pointerObs = this.scene.onPointerObservable.add((pi) => this.onPointer(pi));
    this.select(null);
    this.refreshPalette();
    this.refreshPathBtn();
  }

  close(): void {
    if (!this.active) return;
    this.active = false;
    this.select(null);
    for (const g of this.ghosts) g.root.dispose(false, true);
    this.ghosts.length = 0;
    // Chemins : dispose les visus + reset (l'export aura déjà capté le tracé).
    for (const p of this.paths) { p.dots.forEach((m) => m.dispose()); p.segs.forEach((m) => m.dispose()); }
    this.paths.length = 0;
    this.curPath = null;
    this.pathMode = false;
    this.ring.setEnabled(false);
    this.panel.style.display = "none";

    const canvas = this.scene.getEngine().getRenderingCanvas();
    canvas?.removeEventListener("contextmenu", this.onContext);
    canvas?.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKey, true);
    if (this.pointerObs) { this.scene.onPointerObservable.remove(this.pointerObs); this.pointerObs = null; }

    this.scene.fogMode = this.prevFog;
    this.deps.setWorldHidden(false);
    this.deps.setLookEnabled(true);
    this.deps.setFollow(true);
  }

  // ---- Ghosts ----------------------------------------------------------------
  private spawnGhosts(): void {
    // Un ghost par ANCRE existante de campLayout -> on édite le layout EN PLACE (vide -> éditeur blanc).
    for (const c of craftables) {
      const anchors = campLayout.buildings[c.id] ?? [];
      for (const a of anchors) this.makeGhost(c.id, a.x, a.z, this.resolveFace(a.x, a.z, a.face));
    }
    this.makeCabinGhost(campLayout.cabin.x, campLayout.cabin.z, campLayout.cabin.face ?? 0); // cabane (position + orientation bakées, éditables)
  }

  private resolveFace(x: number, z: number, face: unknown): number {
    if (typeof face === "number") return face;
    if (face === "south") return 0;
    return Math.atan2(-x, -z); // "fire" (défaut)
  }

  private makeGhost(id: string, x: number, z: number, rotY: number): Ghost {
    const root = this.deps.spawnModel(id, x, z, rotY);
    const g: Ghost = { id, root };
    root.getChildMeshes().forEach((m) => { m.isPickable = true; });
    // Les PIÈGES sont plats/au ras du sol -> difficiles à cliquer. On leur ajoute un VOLUME de
    // clic invisible qui dépasse, pour les sélectionner aussi facilement qu'un bâtiment.
    if (id === "trap") {
      const helper = MeshBuilder.CreateBox("editor-pickHelper", { width: 2.4, height: 3, depth: 2.6 }, this.scene);
      helper.parent = root;
      helper.position.y = 1.4;
      helper.isVisible = false; // non rendu, mais pris en compte par scene.pick (prédicat custom)
      helper.isPickable = true;
    }
    root.metadata = { ghost: g };
    this.ghosts.push(g);
    return g;
  }

  private makeCabinGhost(x: number, z: number, rotY = 0): Ghost {
    const root = new TransformNode("editor-cabin", this.scene);
    root.position.set(x, terrainHeight(x, z), z);
    root.rotation.y = rotY; // orientation initiale (face bakée) -> éditable + exportable
    const mat = new StandardMaterial("editor-cabinMat", this.scene);
    mat.diffuseColor = new Color3(0.34, 0.27, 0.2);
    mat.specularColor = new Color3(0, 0, 0);
    const body = MeshBuilder.CreateBox("editor-cabinBody", { width: 6, height: 2.4, depth: 6 }, this.scene);
    body.material = mat; body.parent = root; body.position.y = 1.2;
    const doorMat = new StandardMaterial("editor-cabinDoor", this.scene);
    doorMat.emissiveColor = new Color3(0.5, 0.4, 0.18); doorMat.disableLighting = true;
    const door = MeshBuilder.CreateBox("editor-cabinDoor", { width: 1.6, height: 1.4, depth: 0.2 }, this.scene);
    door.material = doorMat; door.parent = root; door.position.set(0, 0.7, 3); // façade +z
    const g: Ghost = { id: "cabin", root };
    root.metadata = { ghost: g };
    this.ghosts.push(g);
    return g;
  }

  private addGhost(id: string): void {
    const max = id === "cabin" ? 1 : craftableById[id]?.maximum ?? 99;
    if (this.countOf(id) >= max) return; // quantité max atteinte
    // Dispersion en spirale pour ne pas empiler exactement les ajouts successifs.
    const n = this.placeSeq++;
    const r = 4 + (n % 8) * 1.4;
    const a = n * 2.39996;
    const x = Math.round(Math.cos(a) * r * 10) / 10;
    const z = Math.round(Math.sin(a) * r * 10) / 10;
    const g = id === "cabin" ? this.makeCabinGhost(x, z) : this.makeGhost(id, x, z, Math.atan2(-x, -z));
    this.select(g);
    this.refreshPalette();
  }

  private deleteSelected(): void {
    if (!this.selected) return;
    const i = this.ghosts.indexOf(this.selected);
    if (i >= 0) this.ghosts.splice(i, 1);
    this.selected.root.dispose(false, true);
    this.select(null);
    this.refreshPalette();
  }

  // ---- Chemins (campLayout.paths) --------------------------------------------
  private togglePathMode(): void {
    this.pathMode = !this.pathMode;
    if (this.pathMode) { this.select(null); this.startPath(); } // pas de sélection pendant le tracé
    else this.finishPath();
    this.refreshPathBtn();
    this.refreshInfo();
  }

  private startPath(): void {
    this.curPath = { pts: [], dots: [], segs: [] };
    this.paths.push(this.curPath);
  }

  /** Termine le chemin courant : rejette s'il a < 2 points (sinon il reste). */
  private finishPath(): void {
    const cp = this.curPath;
    this.curPath = null;
    if (cp && cp.pts.length < 2) {
      cp.dots.forEach((m) => m.dispose());
      cp.segs.forEach((m) => m.dispose());
      const i = this.paths.indexOf(cp);
      if (i >= 0) this.paths.splice(i, 1);
    }
  }

  private addPathPoint(x: number, z: number): void {
    if (!this.curPath) this.startPath();
    const cp = this.curPath!;
    const prev = cp.pts[cp.pts.length - 1];
    cp.pts.push({ x, z });
    cp.dots.push(this.makeDot(x, z));
    if (prev) cp.segs.push(this.makeSeg(prev, { x, z }));
    this.refreshInfo();
  }

  private undoPathPoint(): void {
    const cp = this.curPath;
    if (!cp || cp.pts.length === 0) return;
    cp.pts.pop();
    cp.dots.pop()?.dispose();
    cp.segs.pop()?.dispose();
    this.refreshInfo();
  }

  private clearPaths(): void {
    for (const p of this.paths) { p.dots.forEach((m) => m.dispose()); p.segs.forEach((m) => m.dispose()); }
    this.paths.length = 0;
    this.curPath = null;
    if (this.pathMode) this.startPath();
    this.refreshInfo();
  }

  /** Recrée les meshes de visu d'un chemin existant (chargement de campLayout.paths). */
  private spawnPaths(): void {
    for (const p of campLayout.paths) {
      const pd: PathDraw = { pts: [], dots: [], segs: [] };
      this.paths.push(pd);
      for (const [x, z] of p.pts) {
        const prev = pd.pts[pd.pts.length - 1];
        pd.pts.push({ x, z });
        pd.dots.push(this.makeDot(x, z));
        if (prev) pd.segs.push(this.makeSeg(prev, { x, z }));
      }
    }
  }

  private makeDot(x: number, z: number): Mesh {
    if (!this.pathDotMat) {
      const m = new StandardMaterial("editor-pathDotMat", this.scene);
      m.emissiveColor = new Color3(0.98, 0.62, 0.26);
      m.disableLighting = true;
      this.pathDotMat = m;
    }
    const d = MeshBuilder.CreateCylinder("editor-pathDot", { height: 0.08, diameter: 0.8, tessellation: 12 }, this.scene);
    d.material = this.pathDotMat;
    d.position.set(x, terrainHeight(x, z) + 0.14, z);
    d.isPickable = false;
    return d;
  }

  private makeSeg(a: { x: number; z: number }, b: { x: number; z: number }): Mesh {
    if (!this.pathSegMat) {
      const m = new StandardMaterial("editor-pathSegMat", this.scene);
      m.emissiveColor = new Color3(0.7, 0.45, 0.2);
      m.disableLighting = true;
      this.pathSegMat = m;
    }
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 0.01;
    const seg = MeshBuilder.CreateBox("editor-pathSeg", { width: 0.45, height: 0.06, depth: len }, this.scene);
    seg.material = this.pathSegMat;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    seg.position.set(mx, terrainHeight(mx, mz) + 0.12, mz);
    seg.rotation.y = Math.atan2(dx, dz); // axe local +Z aligné au segment
    seg.isPickable = false;
    return seg;
  }

  private refreshPathBtn(): void {
    if (!this.pathBtn) return;
    this.pathBtn.textContent = this.pathMode ? "● tracé EN COURS" : "✏ tracer un chemin";
    this.pathBtn.style.background = this.pathMode ? "#5a3a18" : "#1d2a30";
  }

  // ---- Sélection -------------------------------------------------------------
  private select(g: Ghost | null): void {
    this.selected = g;
    if (g) {
      this.ring.setEnabled(true);
      this.placeRing();
    } else {
      this.ring.setEnabled(false);
    }
    this.refreshInfo();
  }

  private placeRing(): void {
    if (!this.selected) return;
    const p = this.selected.root.position;
    this.ring.position.set(p.x, terrainHeight(p.x, p.z) + 0.06, p.z);
  }

  private refreshInfo(): void {
    if (this.pathMode) {
      const n = this.curPath?.pts.length ?? 0;
      const done = this.paths.filter((p) => p.pts.length >= 2).length;
      this.info.innerHTML =
        '<b style="color:#f0a050">tracé de chemin</b><br>chemin courant : ' + n + " point(s) · " +
        done + " chemin(s) terminé(s)";
      return;
    }
    if (!this.selected) {
      this.info.innerHTML = '<span style="opacity:.6">aucune sélection (' + this.ghosts.length + " éléments)</span>";
      return;
    }
    const p = this.selected.root.position;
    const deg = Math.round((this.selected.root.rotation.y * 180) / Math.PI);
    this.info.innerHTML =
      '<b style="color:#f0a050">' + this.selected.id + "</b><br>x " + p.x.toFixed(1) +
      " · z " + p.z.toFixed(1) + " · " + deg + "°";
  }

  // ---- Entrées ---------------------------------------------------------------
  private ghostFromMesh(mesh: { parent: unknown } | null): Ghost | null {
    let node: any = mesh; // remonte la chaîne de parenté jusqu'à une racine taguée
    while (node) {
      if (node.metadata && node.metadata.ghost) return node.metadata.ghost as Ghost;
      node = node.parent;
    }
    return null;
  }

  private groundPoint(): { x: number; z: number } | null {
    const ray = this.scene.createPickingRay(this.scene.pointerX, this.scene.pointerY, null, this.camera);
    if (Math.abs(ray.direction.y) < 1e-5) return null;
    const t = (this.camTarget.y - ray.origin.y) / ray.direction.y;
    if (t <= 0) return null;
    return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
  }

  private onPointer(pi: PointerInfo): void {
    if (!this.active) return;
    const ev = pi.event as PointerEvent;
    if (pi.type === PointerEventTypes.POINTERDOWN) {
      this.lastX = this.scene.pointerX; this.lastY = this.scene.pointerY;
      if (ev.button === 2) { this.panning = true; return; } // clic droit : déplacer la vue
      if (this.pathMode) { const gp = this.groundPoint(); if (gp) this.addPathPoint(gp.x, gp.z); return; } // clic = point de chemin
      // On ne sélectionne QUE des meshes appartenant à un ghost : les colliders invisibles des
      // bâtiments (bcol-*), le sol, les arbres… sont ignorés -> le rayon les traverse jusqu'au ghost.
      const hit = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => this.ghostFromMesh(m) !== null);
      const g = hit?.pickedMesh ? this.ghostFromMesh(hit.pickedMesh) : null;
      this.select(g);
      this.dragging = !!g;
    } else if (pi.type === PointerEventTypes.POINTERMOVE) {
      if (this.panning) {
        const k = this.camera.radius / 640; // pixels -> unités-monde (dépend du zoom)
        this.camTarget.x -= (this.scene.pointerX - this.lastX) * k;
        this.camTarget.z += (this.scene.pointerY - this.lastY) * k;
        this.camera.target.copyFrom(this.camTarget);
        this.lastX = this.scene.pointerX; this.lastY = this.scene.pointerY;
      } else if (this.dragging && this.selected) {
        const p = this.groundPoint();
        if (p) {
          this.selected.root.position.set(p.x, terrainHeight(p.x, p.z), p.z);
          this.placeRing();
          this.refreshInfo();
        }
      }
    } else if (pi.type === PointerEventTypes.POINTERUP) {
      this.dragging = false; this.panning = false;
    }
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Molette = TOURNER la sélection (temps réel) ; Maj+molette (ou rien de sélectionné) = zoom.
    if (this.selected && !e.shiftKey) {
      const step = (e.ctrlKey ? Math.PI / 36 : Math.PI / 12) * (e.deltaY > 0 ? 1 : -1);
      this.selected.root.rotation.y = norm(this.selected.root.rotation.y + step);
      this.refreshInfo();
      return;
    }
    this.camera.radius = Math.max(12, Math.min(380, this.camera.radius + e.deltaY * 0.06));
  };

  private onContext = (e: Event): void => { e.preventDefault(); };

  private onKey = (e: KeyboardEvent): void => {
    if (!this.active) return;
    const k = e.key;
    if (this.pathMode) {
      // En mode tracé : Échap SORT du mode (sans fermer l'éditeur) ; Entrée = nouveau chemin ;
      // Retour arrière = retire le dernier point.
      e.preventDefault(); e.stopImmediatePropagation();
      if (k === "Escape") { this.pathMode = false; this.finishPath(); this.refreshPathBtn(); this.refreshInfo(); }
      else if (k === "Enter") { this.finishPath(); this.startPath(); this.refreshInfo(); }
      else if (k === "Backspace" || k === "Delete") this.undoPathPoint();
      return;
    }
    if (k === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); this.close(); return; }
    if (this.selected) {
      const r = this.selected.root;
      const step = e.shiftKey ? ROT_STEP / 3 : ROT_STEP;
      // Rotation au clavier — alias AZERTY/QWERTY ( [ ( , = anti-horaire · ] ) . = horaire ).
      if (k === "[" || k === "(" || k === ",") r.rotation.y = norm(r.rotation.y - step);
      else if (k === "]" || k === ")" || k === ".") r.rotation.y = norm(r.rotation.y + step);
      else if (k === "ArrowLeft") r.position.x -= NUDGE;
      else if (k === "ArrowRight") r.position.x += NUDGE;
      else if (k === "ArrowUp") r.position.z += NUDGE;
      else if (k === "ArrowDown") r.position.z -= NUDGE;
      else if (k === "Delete" || k === "Backspace") { this.deleteSelected(); e.preventDefault(); e.stopImmediatePropagation(); return; }
      else return;
      r.position.y = terrainHeight(r.position.x, r.position.z);
      this.placeRing();
      this.refreshInfo();
      e.preventDefault(); e.stopImmediatePropagation();
    }
  };

  // ---- Export ----------------------------------------------------------------
  private faceLiteral(id: string, g: Ghost): string {
    const x = g.root.position.x, z = g.root.position.z, yaw = g.root.rotation.y;
    if (Math.abs(norm(yaw - Math.atan2(-x, -z))) < 0.05) return ""; // "fire" = défaut, omis
    if (Math.abs(norm(yaw)) < 0.05) return ', face: "south"';
    return ", face: " + (Math.round(yaw * 1000) / 1000);
  }

  private exportLayout(): void {
    const cabin = this.ghosts.find((g) => g.id === "cabin");
    const cx = cabin ? cabin.root.position.x : campLayout.cabin.x;
    const cz = cabin ? cabin.root.position.z : campLayout.cabin.z;
    const cYaw = cabin ? norm(cabin.root.rotation.y) : campLayout.cabin.face ?? 0;
    const cFace = Math.abs(cYaw) > 0.01 ? ", face: " + Math.round(cYaw * 1000) / 1000 : ""; // omis si 0
    let s = "  cabin: { x: " + r1(cx) + ", z: " + r1(cz) + cFace + " },\n  buildings: {\n";
    for (const c of craftables) {
      const list = this.ghosts.filter((g) => g.id === c.id);
      if (list.length === 0) continue;
      const items = list.map((g) =>
        "{ x: " + r1(g.root.position.x) + ", z: " + r1(g.root.position.z) + this.faceLiteral(c.id, g) + " }",
      );
      const key = c.id.includes(" ") ? '"' + c.id + '"' : c.id;
      s += "    " + key + ": [" + items.join(", ") + "],\n";
    }
    s += "  },\n";
    // Chemins dessinés (≥ 2 points). Le chemin courant (en cours) est inclus s'il est valide.
    const drawn = this.paths.filter((p) => p.pts.length >= 2);
    if (drawn.length === 0) {
      s += "  paths: [],";
    } else {
      const lines = drawn.map(
        (p) => "    { pts: [" + p.pts.map((pt) => "[" + r1(pt.x) + ", " + r1(pt.z) + "]").join(", ") + "] }",
      );
      s += "  paths: [\n" + lines.join(",\n") + ",\n  ],";
    }
    this.out.style.display = "block";
    this.out.value = s;
    this.out.select();
    try { void navigator.clipboard?.writeText(s); } catch { /* ignore */ }
    // eslint-disable-next-line no-console
    console.log("[spawn-editor] campLayout:\n" + s);
  }
}

const r1 = (v: number): number => Math.round(v * 10) / 10;
