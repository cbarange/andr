// ============================================================================
//  CONSOLE DEV — ligne de saisie de commandes (bas-centre). Couche UI/dev, purement
//  visuelle. ENTER (hors UI) l'ouvre ; on tape `/cmd args`, ENTER exécute, ESC ferme,
//  ↑/↓ parcourt l'historique. Un vrai <input> focalisé -> InputManager ignore déjà la
//  frappe (cf. input.ts), donc taper ne déplace pas le joueur. stopPropagation empêche
//  les raccourcis globaux (ESC=menu, ENTER=dialogue) de se déclencher pendant la saisie.
//  Le dispatch vit dans src/dev/commands.ts. Console montée en DEV uniquement (main.ts).
// ============================================================================

export class DevConsole {
  private readonly root: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly output: HTMLDivElement;
  private readonly history: string[] = [];
  private histIndex = 0;
  private open = false;

  /**
   * @param run     exécute une ligne et renvoie un message de retour (affiché au-dessus).
   * @param onToggle notifié à l'ouverture/fermeture (main : libère/recapture le pointeur).
   */
  constructor(
    private readonly run: (line: string) => string,
    private readonly onToggle: (open: boolean) => void,
  ) {
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "fixed", left: "50%", bottom: "56px", transform: "translateX(-50%)",
      width: "min(680px, 84vw)", display: "none", zIndex: "60",
      font: "13px ui-monospace, SFMono-Regular, Menlo, monospace", pointerEvents: "none",
    } as CSSStyleDeclaration);

    this.output = document.createElement("div");
    Object.assign(this.output.style, {
      color: "#cfe3df", background: "rgba(10,16,18,0.78)", padding: "4px 10px",
      borderRadius: "6px 6px 0 0", minHeight: "18px", whiteSpace: "pre-wrap",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
    } as CSSStyleDeclaration);

    const bar = document.createElement("div");
    Object.assign(bar.style, {
      display: "flex", alignItems: "center", gap: "6px",
      background: "rgba(10,16,18,0.92)", padding: "6px 10px", borderRadius: "0 0 6px 6px",
      pointerEvents: "auto", boxShadow: "0 4px 18px rgba(0,0,0,0.4)",
    } as CSSStyleDeclaration);

    const slash = document.createElement("span");
    slash.textContent = "/";
    Object.assign(slash.style, { color: "#ffd78a", fontWeight: "700" } as CSSStyleDeclaration);

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.spellcheck = false;
    this.input.setAttribute("autocomplete", "off");
    this.input.placeholder = "add storage wood 100 · unlock · tp ship · help";
    Object.assign(this.input.style, {
      flex: "1", background: "transparent", border: "none", outline: "none",
      color: "#f2f5f4", font: "inherit",
    } as CSSStyleDeclaration);

    bar.appendChild(slash);
    bar.appendChild(this.input);
    this.root.appendChild(this.output);
    this.root.appendChild(bar);
    document.body.appendChild(this.root);

    this.input.addEventListener("keydown", (e) => this.onKeyDown(e));
  }

  get isOpen(): boolean {
    return this.open;
  }

  openConsole(): void {
    if (this.open) return;
    this.open = true;
    this.root.style.display = "block";
    this.input.value = "";
    this.input.focus();
    this.onToggle(true);
  }

  closeConsole(): void {
    if (!this.open) return;
    this.open = false;
    this.root.style.display = "none";
    this.input.blur();
    this.onToggle(false);
  }

  private submit(): void {
    const line = this.input.value;
    this.input.value = "";
    if (line.trim()) {
      this.history.push(line);
      this.histIndex = this.history.length;
      this.run(line); // le résultat est affiché via un toast (cf. main.ts)
    }
    // On FERME après exécution : la main revient au jeu (déplacement / vol). ENTER pour rouvrir.
    this.closeConsole();
  }

  private recall(dir: -1 | 1): void {
    if (this.history.length === 0) return;
    this.histIndex = Math.max(0, Math.min(this.history.length, this.histIndex + dir));
    this.input.value = this.history[this.histIndex] ?? "";
    // place le curseur en fin de champ
    requestAnimationFrame(() => this.input.setSelectionRange(this.input.value.length, this.input.value.length));
  }

  private onKeyDown(e: KeyboardEvent): void {
    e.stopPropagation(); // ne pas déclencher les raccourcis globaux (ESC=menu, ENTER=dialogue)
    if (e.key === "Enter") {
      this.submit(); // exécute (si non vide) PUIS ferme -> rend la main au jeu
      e.preventDefault();
    } else if (e.key === "Escape") {
      this.closeConsole();
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      this.recall(-1);
      e.preventDefault();
    } else if (e.key === "ArrowDown") {
      this.recall(1);
      e.preventDefault();
    }
  }
}
