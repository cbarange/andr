// ============================================================================
//  ABSTRACTION DES ENTRÉES — §3.5.
//  La logique ne reçoit que des INTENTIONS ("avancer", "interagir"), jamais des
//  codes de touches bruts. Demain : tactile/manette se branchent ici sans toucher
//  au reste. Supporte ZQSD (AZERTY) ET WASD (QWERTY) + flèches.
// ============================================================================

import { config } from "../../data/world";

const DOUBLE_TAP_MS = config.explore.doubleTapMs; // fenêtre du double-appui
const FWD_KEYS = new Set(["z", "w", "arrowup"]); // « avant »
const BACK_KEYS = new Set(["s", "arrowdown"]); // « arrière »

export interface MoveIntent {
  forward: number; // -1 (reculer) .. +1 (avancer)
  strafe: number; // -1 (gauche) .. +1 (droite)
  jump: boolean; // déclenché sur le front montant, consommé une fois
  vertical: number; // -1 (descendre) .. +1 (monter) — utilisé en mode vol (Espace / Maj)
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
  private eatQueued = false; // M8 : touche F (manger)
  private readonly lastRising: Record<string, number> = {}; // horodatage du dernier VRAI appui par touche
  private doubleTap: DoubleTaps = { forward: false, back: false, jump: false };

  private readonly onKeyDown = (e: KeyboardEvent) => {
    // Ne pas capturer le clavier quand on tape dans un champ (ex. code de salon / console).
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

    const k = e.key.toLowerCase();
    const rising = !this.down.has(k); // vrai appui (pas une répétition clavier maintenue)
    this.down.add(k);
    if (rising) this.registerTap(k);
    if (k === " " || k === "spacebar") {
      this.jumpQueued = true;
      e.preventDefault();
    }
    if (k === "e") this.interactQueued = true;
    if (k === "f") this.eatQueued = true; // M8 : manger (viande séchée) — voisine de E, AZERTY=QWERTY
    if (k.startsWith("arrow") || k === " ") e.preventDefault();
  };

  /** Détecte un double-appui rapide de la MÊME touche (avant / arrière / saut). */
  private registerTap(k: string): void {
    const now = performance.now();
    if (now - (this.lastRising[k] ?? -Infinity) < DOUBLE_TAP_MS) {
      if (FWD_KEYS.has(k)) this.doubleTap.forward = true;
      else if (BACK_KEYS.has(k)) this.doubleTap.back = true;
      else if (k === " " || k === "spacebar") this.doubleTap.jump = true;
      this.lastRising[k] = -Infinity; // un 3e appui ne compte pas comme un nouveau double
    } else {
      this.lastRising[k] = now;
    }
  }

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.key.toLowerCase());
  };

  private readonly onBlur = () => {
    this.down.clear(); // évite les touches "collées" si on perd le focus
  };

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  private axis(negKeys: string[], posKeys: string[]): number {
    const neg = negKeys.some((k) => this.down.has(k)) ? 1 : 0;
    const pos = posKeys.some((k) => this.down.has(k)) ? 1 : 0;
    return pos - neg;
  }

  /** Intention de déplacement + saut (le saut est consommé à la lecture). */
  getIntent(): MoveIntent {
    const forward = this.axis(["s", "arrowdown"], ["z", "w", "arrowup"]);
    const strafe = this.axis(["q", "a", "arrowleft"], ["d", "arrowright"]);
    const jump = this.jumpQueued;
    this.jumpQueued = false;
    // Vol : Espace = monter, Maj = descendre (ignoré hors mode vol).
    const vertical = (this.down.has(" ") ? 1 : 0) - (this.down.has("shift") ? 1 : 0);
    return { forward, strafe, jump, vertical };
  }

  /** Vrai une seule fois par appui sur E (interaction / récolte). */
  consumeInteract(): boolean {
    const v = this.interactQueued;
    this.interactQueued = false;
    return v;
  }

  /** Vrai une seule fois par appui sur F (manger — M8). */
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
