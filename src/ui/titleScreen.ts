// ============================================================================
//  SEUIL D'ENTRÉE (écran-titre) — A6 : extrait de main.ts. Montré au boot (la scène transparaît
//  derrière) ; le 1er clic sert aussi de geste de déverrouillage AUDIO. SAUTÉ en test piloté
//  (navigator.webdriver) sauf override `?title=1` (preview + e2e dédié) -> les e2e existants ne
//  sont pas perturbés. `isOpen` entre dans `uiOpen` (main.ts) : gèle déplacement/interaction.
// ============================================================================

import { clearSave } from "../save";

export interface TitleScreenContext {
  hasSave: boolean; // « reprendre » vs « commencer » + visibilité de « nouvelle partie »
  onFirstGesture: () => void; // déverrouillage audio (resumeOnGesture)
  openSettings: () => void; // « rejoindre une partie » -> menu (multijoueur)
}

export class TitleScreen {
  private openFlag = false;

  constructor(ctx: TitleScreenContext) {
    const el = document.getElementById("titleScreen");
    if (!el) return;
    const forced = new URLSearchParams(location.search).has("title");
    if (navigator.webdriver && !forced) return;
    const startBtn = document.getElementById("titleStart");
    const newBtn = document.getElementById("titleNew");
    const joinBtn = document.getElementById("titleJoin");
    if (startBtn) startBtn.textContent = ctx.hasSave ? "reprendre" : "commencer";
    if (newBtn) newBtn.style.display = ctx.hasSave ? "" : "none"; // « nouvelle partie » : seulement si une partie existe déjà
    const dismiss = (): void => { this.openFlag = false; el.classList.remove("show"); el.style.display = "none"; ctx.onFirstGesture(); };
    startBtn?.addEventListener("click", dismiss);
    joinBtn?.addEventListener("click", () => { dismiss(); ctx.openSettings(); });
    newBtn?.addEventListener("click", () => { clearSave(); location.reload(); }); // reset propre : reboot sur une partie neuve
    this.openFlag = true;
    el.classList.add("show");
  }

  /** L'écran-titre est-il affiché ? (Échap neutralisé ; il se ferme par ses boutons.) */
  get isOpen(): boolean {
    return this.openFlag;
  }
}
