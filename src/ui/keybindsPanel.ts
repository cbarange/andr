// ============================================================================
//  PANNEAU « PARAMÈTRES DES TOUCHES » (rebind — cf. docs/rebind-clavier-plan.md) — A6 : extrait de
//  main.ts. Sous-vue du menu Paramètres : `isOpen` entre dans `uiOpen` (gèle le jeu) et Échap ramène
//  au menu (géré par main.ts via isOpen/capturing/cancelCapture/close). Rendu = ACTION_LABELS -> chips.
//  Régénère aussi les INDICES de contrôle affichés (aide, écran-titre, combat, badge E) après rebind.
// ============================================================================

import {
  ACTION_LABELS, actionKeyLabel, clearBinding, keyLabel, mergeDefaults, moveClusterLabel,
  normalizeKey, withBinding, type Action, type Bindings,
} from "../input/keybindings";

/** Ce que le panneau emprunte à l'orchestrateur (accesseurs — `bindings` y est un `let` rebindé). */
export interface KeybindsPanelContext {
  getBindings: () => Bindings;
  /** Applique + persiste + rafraîchit les indices (implémenté par main.ts : setBindings/save/hints). */
  applyBindings: (b: Bindings) => void;
  closeSettings: () => void;
  openSettings: () => void;
  releasePointer: () => void;
  engagePointer: () => void;
  toast: (msg: string) => void;
}

export class KeybindsPanel {
  private openFlag = false;
  private capture: Action | null = null; // action en attente de CAPTURE d'une touche
  private readonly el = document.getElementById("keybinds");
  private readonly listEl = document.getElementById("keybindList");

  constructor(private readonly ctx: KeybindsPanelContext) {
    document.getElementById("keysBtn")?.addEventListener("click", () => this.open());
    document.getElementById("keybindBack")?.addEventListener("click", () => this.close(true));
    document.getElementById("keybindReset")?.addEventListener("click", () => {
      ctx.applyBindings(mergeDefaults(null)); // retour aux défauts (persisté)
      this.capture = null;
      this.render();
      ctx.toast("touches réinitialisées");
    });
  }

  /** Le panneau est-il affiché ? (entre dans `uiOpen` — gèle déplacement/interaction). */
  get isOpen(): boolean {
    return this.openFlag;
  }

  /** Une capture de touche est-elle en attente ? (le prochain keydown lui revient). */
  get capturing(): boolean {
    return this.capture !== null;
  }

  open(): void {
    this.ctx.closeSettings();
    this.openFlag = true;
    if (this.el) this.el.style.display = "block";
    this.render();
    this.ctx.releasePointer();
  }

  close(backToSettings: boolean): void {
    this.openFlag = false;
    this.capture = null;
    if (this.el) this.el.style.display = "none";
    if (backToSettings) this.ctx.openSettings();
    else this.ctx.engagePointer();
  }

  /** Échap pendant une capture : annule la capture, reste sur le panneau. */
  cancelCapture(): void {
    this.capture = null;
    this.render();
  }

  /** Capture la prochaine touche pour l'action en attente (réservées ignorées via normalizeKey). */
  captureKey(e: KeyboardEvent): void {
    e.preventDefault();
    const key = normalizeKey(e);
    if (this.capture === null) return;
    if (key !== null) {
      this.ctx.applyBindings(withBinding(this.ctx.getBindings(), this.capture, key));
      this.capture = null; // réservée -> on reste en capture
    }
    this.render();
  }

  /** (Re)construit la liste actions -> touches. Appelé à l'ouverture et après chaque changement. */
  private render(): void {
    if (!this.listEl) return;
    const bindings = this.ctx.getBindings();
    this.listEl.textContent = "";
    for (const { action, label } of ACTION_LABELS) {
      const row = document.createElement("div");
      row.className = "kbRow" + (this.capture === action ? " capturing" : "");
      const name = document.createElement("span");
      name.className = "kbName";
      name.textContent = label;
      row.appendChild(name);
      const keys = document.createElement("span");
      keys.className = "kbKeys";
      if (this.capture === action) {
        const cap = document.createElement("span");
        cap.className = "kbCapture";
        cap.textContent = "appuyez sur une touche… (Échap : annuler)";
        keys.appendChild(cap);
      } else {
        if (bindings[action].length === 0) {
          const none = document.createElement("span");
          none.className = "kbNone";
          none.textContent = "aucune touche";
          keys.appendChild(none);
        }
        for (const k of bindings[action]) {
          const chip = document.createElement("span");
          chip.className = "kbKey";
          chip.appendChild(document.createTextNode(keyLabel(k)));
          const rm = document.createElement("button");
          rm.textContent = "×";
          rm.title = "retirer cette touche";
          rm.addEventListener("click", () => { this.ctx.applyBindings(clearBinding(this.ctx.getBindings(), action, k)); this.render(); });
          chip.appendChild(rm);
          keys.appendChild(chip);
        }
        const add = document.createElement("button");
        add.className = "kbAdd";
        add.textContent = "+";
        add.title = "lier une touche";
        add.addEventListener("click", () => { this.capture = action; this.render(); });
        keys.appendChild(add);
      }
      row.appendChild(keys);
      this.listEl.appendChild(row);
    }
  }
}

/** Régénère les INDICES de contrôle affichés (aide, titre, combat, badge E) après un rebind. */
export function refreshKeyHints(bindings: Bindings): void {
  const move = moveClusterLabel(bindings);
  const jump = actionKeyLabel(bindings, "jump");
  const interact = actionKeyLabel(bindings, "interact");
  const eat = actionKeyLabel(bindings, "eat");
  const help = document.getElementById("helpControls");
  if (help) help.innerHTML = `<kbd>${move}</kbd> se déplacer · <kbd>${jump}</kbd> sauter · <kbd>${interact}</kbd> interagir · souris : caméra`;
  const title = document.getElementById("titleControls");
  if (title) title.textContent = `souris : caméra · ${move} : se déplacer · ${interact} : interagir`;
  const hit = document.getElementById("combatKeyHit");
  if (hit) hit.textContent = interact;
  const eatK = document.getElementById("combatKeyEat");
  if (eatK) eatK.textContent = eat;
  const promptK = document.getElementById("promptKey");
  if (promptK) promptK.textContent = interact;
  const eatHint = document.getElementById("eatHint");
  if (eatHint) eatHint.textContent = `${eat} : manger (+8 vie)`;
}
