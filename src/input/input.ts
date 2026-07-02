// ============================================================================
//  ABSTRACTION DES ENTRÉES — §3.5.
//  La logique ne reçoit que des INTENTIONS ("avancer", "interagir"), jamais des
//  codes de touches bruts. Demain : tactile/manette se branchent ici sans toucher
//  au reste. Les touches viennent du MODÈLE DE BINDINGS (keybindings.ts — rebindable,
//  défauts ZQSD + WASD + flèches) ; `setBindings` applique un rebind À CHAUD.
// ============================================================================

import { config } from "../../data/world";
import { DEFAULT_BINDINGS, type Bindings } from "./keybindings";

const DOUBLE_TAP_MS = config.explore.doubleTapMs; // fenêtre du double-appui

export interface MoveIntent {
  forward: number; // -1 (reculer) .. +1 (avancer)
  strafe: number; // -1 (gauche) .. +1 (droite)
  jump: boolean; // déclenché sur le front montant, consommé une fois
  vertical: number; // -1 (descendre) .. +1 (monter) — utilisé en mode vol (saut / descendre)
}

/** Doubles-appuis rapides (consommés une fois) : avant=accélérer, arrière=ralentir, saut=vol. */
export interface DoubleTaps {
  forward: boolean;
  back: boolean;
  jump: boolean;
}

export class InputManager {
  private readonly down = new Set<string>();
  private jumpQueued = false;
  private interactQueued = false;
  private eatQueued = false; // M8 : manger (défaut F)
  private readonly lastRising: Record<string, number> = {}; // horodatage du dernier VRAI appui par touche
  private doubleTap: DoubleTaps = { forward: false, back: false, jump: false };
  private bindings: Bindings;

  private readonly onKeyDown = (e: KeyboardEvent) => {
    // Ne pas capturer le clavier quand on tape dans un champ (ex. code de salon / console).
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

    const k = e.key.toLowerCase() === "spacebar" ? " " : e.key.toLowerCase();
    const rising = !this.down.has(k); // vrai appui (pas une répétition clavier maintenue)
    this.down.add(k);
    if (rising) this.registerTap(k);
    if (this.bindings.jump.includes(k)) {
      this.jumpQueued = true;
      e.preventDefault();
    }
    if (this.bindings.interact.includes(k)) this.interactQueued = true;
    if (this.bindings.eat.includes(k)) this.eatQueued = true; // M8 : manger / se soigner
    if (k.startsWith("arrow") || k === " ") e.preventDefault(); // anti-scroll (flèches/Espace liées ou non)
  };

  /** Détecte un double-appui rapide de la MÊME touche (avant / arrière / saut). */
  private registerTap(k: string): void {
    const now = performance.now();
    if (now - (this.lastRising[k] ?? -Infinity) < DOUBLE_TAP_MS) {
      if (this.bindings.forward.includes(k)) this.doubleTap.forward = true;
      else if (this.bindings.back.includes(k)) this.doubleTap.back = true;
      else if (this.bindings.jump.includes(k)) this.doubleTap.jump = true;
      this.lastRising[k] = -Infinity; // un 3e appui ne compte pas comme un nouveau double
    } else {
      this.lastRising[k] = now;
    }
  }

  private readonly onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase() === "spacebar" ? " " : e.key.toLowerCase();
    this.down.delete(k);
  };

  private readonly onBlur = () => {
    this.down.clear(); // évite les touches "collées" si on perd le focus
  };

  constructor(bindings: Bindings = DEFAULT_BINDINGS) {
    this.bindings = bindings;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  /** Applique un rebind À CHAUD (préserve l'état `down` — pas de touche fantôme). */
  setBindings(b: Bindings): void {
    this.bindings = b;
  }

  private axis(negKeys: string[], posKeys: string[]): number {
    const neg = negKeys.some((k) => this.down.has(k)) ? 1 : 0;
    const pos = posKeys.some((k) => this.down.has(k)) ? 1 : 0;
    return pos - neg;
  }

  /** Intention de déplacement + saut (le saut est consommé à la lecture). */
  getIntent(): MoveIntent {
    const forward = this.axis(this.bindings.back, this.bindings.forward);
    const strafe = this.axis(this.bindings.left, this.bindings.right);
    const jump = this.jumpQueued;
    this.jumpQueued = false;
    // Vol : saut = monter, descendre = descendre (ignoré hors mode vol).
    const up = this.bindings.jump.some((k) => this.down.has(k)) ? 1 : 0;
    const downV = this.bindings.descend.some((k) => this.down.has(k)) ? 1 : 0;
    return { forward, strafe, jump, vertical: up - downV };
  }

  /** Vrai une seule fois par appui sur « interagir » (défaut E). */
  consumeInteract(): boolean {
    const v = this.interactQueued;
    this.interactQueued = false;
    return v;
  }

  /** Vrai une seule fois par appui sur « manger » (défaut F — M8). */
  consumeEat(): boolean {
    const v = this.eatQueued;
    this.eatQueued = false;
    return v;
  }

  /** Doubles-appuis détectés depuis le dernier appel (consommés). */
  consumeDoubleTaps(): DoubleTaps {
    const dt = this.doubleTap;
    this.doubleTap = { forward: false, back: false, jump: false };
    return dt;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  }
}
