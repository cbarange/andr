// ============================================================================
//  CAMÉRA À CAPTURE DE POINTEUR (pointer lock) — modèle simple :
//  - JEU (aucune interface ouverte) : pointeur CAPTURÉ, curseur masqué, la souris
//    oriente la caméra (aucun clic-glisser). Un clic initial active la capture
//    (exigence navigateur).
//  - INTERFACE ouverte (dialogue / tableau / menu Paramètres) : pointeur LIBÉRÉ,
//    curseur visible -> la souris sert à cliquer. On RECAPTURE à la fermeture.
//  Échap n'est PAS géré ici (c'est `main` qui décide : fermer l'UI, ou ouvrir le menu).
//
//  En headless (Playwright), le pointer lock est absent : tout reste inerte, sans erreur.
// ============================================================================

import type { ArcRotateCamera } from "@babylonjs/core";

export class PointerLook {
  private locked = false;
  private enabled = true; // false pendant l'éditeur de spawn : ne pas recapturer au clic
  private suppressHint = false; // UI ouverte : pointeur libéré volontairement, pas d'indice
  private static readonly BASE_SENS = 0.0042; // rad / pixel (sensibilité de référence)
  private sensMul = 1; // multiplicateur réglable par le joueur (réglage de confort, persisté)
  private readonly zoomSensitivity = 0.012;
  private lookScale = 1; // < 1 pendant le zoom « longue-vue » (R) -> visée précise (façon OptiFine)
  // Rayon VOULU par le joueur (zoom molette). La caméra peut s'en écarter (spring-arm : la boucle
  // de rendu rapproche le rayon EFFECTIF si un mur s'interpose). On ne touche donc plus `camera.radius`.
  private _desiredRadius: number;
  // Beta VOULU par le joueur (tangage souris). En 3ᵉ personne `camera.beta` le suit à l'identique ;
  // en 1ʳᵉ personne la boucle de rendu le REMAPPE (regard horizontal au repos). On ne touche donc
  // plus `camera.beta` direct — seul `_desiredBeta` est l'intention brute. (Alpha/yaw reste direct.)
  private _desiredBeta: number;
  // Bornes du tangage VOULU (intention 3ᵉ personne), capturées à la construction. `main` peut
  // ensuite élargir `camera.upperBetaLimit` pour la 1ʳᵉ personne (regard vers le haut) sans que
  // le beta voulu sorte de la plage 3PV — d'où une capture figée, pas une lecture live des limites.
  private readonly betaLo: number;
  private readonly betaHi: number;

  constructor(
    private readonly camera: ArcRotateCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly hint?: HTMLElement | null,
  ) {
    this._desiredRadius = camera.radius;
    this._desiredBeta = camera.beta;
    this.betaLo = camera.lowerBetaLimit ?? 0.1;
    this.betaHi = camera.upperBetaLimit ?? Math.PI - 0.1;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("mousemove", this.onMove);
    this.updateHint();
  }

  /** Ouverture d'une UI : libère le pointeur (curseur visible pour cliquer). */
  release(): void {
    this.suppressHint = true; // en UI, pas d'indice « cliquez pour orienter »
    if (this.locked) document.exitPointerLock();
    this.updateHint();
  }

  /** Fermeture d'une UI / clic : recapture le pointeur (doit être appelé dans un geste). */
  engage(): void {
    if (!this.enabled) return; // éditeur actif : on garde le curseur libre
    this.suppressHint = false;
    if (!this.locked) this.requestLock();
    this.updateHint();
  }

  /** Active/désactive la capture (false = éditeur de spawn : curseur toujours libre). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.release();
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("wheel", this.onWheel);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("mousemove", this.onMove);
  }

  private requestLock(): void {
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
      /* headless / sans geste : on ignore */
    }
  }

  private onPointerDown = (): void => {
    if (!this.enabled) return; // éditeur actif : le clic sert à sélectionner, pas à capturer
    if (!this.locked) this.requestLock(); // clic dans la scène -> (re)capture
  };

  private onLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas;
    this.updateHint();
  };

  /** Règle la sensibilité souris (multiplicateur ; 1 = défaut). Réglage de confort persisté. */
  setSensitivity(mul: number): void {
    this.sensMul = Math.max(0.1, Math.min(4, mul));
  }

  private onMove = (e: MouseEvent): void => {
    if (!this.locked) return; // libéré (UI) -> la souris ne touche pas la caméra
    const s = PointerLook.BASE_SENS * this.sensMul * this.lookScale;
    this.camera.alpha -= e.movementX * s; // yaw : identique en 3ᵉ/1ʳᵉ -> direct
    // Tangage : on n'écrit QUE l'intention (bornée à la plage 3PV). `main` applique `camera.beta`
    // (tel quel en 3ᵉ, remappé vers l'horizon en 1ʳᵉ personne).
    this._desiredBeta = Math.max(this.betaLo, Math.min(this.betaHi, this._desiredBeta - e.movementY * s));
  };

  /** Échelle de sensibilité souris (1 = normal ; < 1 quand on zoome -> mouvement plus fin). */
  setLookScale(scale: number): void {
    this.lookScale = scale;
  }

  private onWheel = (e: WheelEvent): void => {
    if (!this.locked) return;
    e.preventDefault();
    const lo = this.camera.lowerRadiusLimit ?? 4;
    const hi = this.camera.upperRadiusLimit ?? 20;
    this._desiredRadius = Math.max(lo, Math.min(hi, this._desiredRadius + e.deltaY * this.zoomSensitivity));
  };

  /** Rayon voulu par le joueur (le spring-arm de la boucle peut rapprocher le rayon effectif). */
  get desiredRadius(): number {
    return this._desiredRadius;
  }

  /** Beta (tangage) voulu par le joueur ; `main` l'applique tel quel en 3ᵉ, remappé en 1ʳᵉ personne. */
  get desiredBeta(): number {
    return this._desiredBeta;
  }

  // Indice « cliquez pour orienter la caméra » : uniquement au tout début (pointeur jamais
  // encore capturé). Disparaît dès le 1er clic ; ne réapparaît pas sur les UI.
  private updateHint(): void {
    if (!this.hint) return;
    this.hint.style.display = !this.locked && !this.suppressHint ? "block" : "none";
  }
}
