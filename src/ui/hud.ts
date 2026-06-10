// ============================================================================
//  HUD — surcouche HTML/CSS par-dessus le canvas (§2, §6).
//  Aucune règle de jeu ici : le HUD LIT l'état et ÉMET des intentions.
//
//  Refonte « diégétique » : la plupart des actions passent par des ÉTIQUETTES
//  d'interaction (au niveau de l'objet) et des DIALOGUES, pas par des panneaux.
// ============================================================================

/** Une option de dialogue. */
export interface DialogueChoice {
  label: string;
  /** Texte secondaire (ex. coût). */
  sublabel?: string;
  /** Info-bulle au survol (ex. ressources manquantes pour une construction). */
  tooltip?: string;
  /** Affiche un badge « nouveau » (bâtiment fraîchement révélé, pas encore vu). */
  isNew?: boolean;
  enabled: boolean;
  onSelect: () => void;
}

/** Une ligne « + / − » de dialogue (ex. répartition des villageois). */
export interface DialogueStepper {
  label: string;
  value: string;
  sublabel?: string;
  canDec: boolean;
  canInc: boolean;
  onDec: () => void;
  onInc: () => void;
  /** Affichée comme les autres mais SANS boutons +/- ni sélection (ex. occupation par défaut). */
  readOnly?: boolean;
}

export interface DialogueView {
  speaker: string;
  text: string;
  choices: DialogueChoice[];
  steppers?: DialogueStepper[];
}

export class Hud {
  private readonly bagCapEl: HTMLElement;
  private readonly bagList: HTMLElement;
  private readonly fireEl: HTMLElement;
  private readonly tempEl: HTMLElement;
  private readonly popEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly statusTextEl: HTMLElement;
  private readonly roomInput: HTMLInputElement;
  private readonly roomBtn: HTMLButtonElement;
  private readonly hostBtn: HTMLButtonElement;
  private readonly shareRow: HTMLElement;
  private readonly shareLink: HTMLInputElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly rendererTag: HTMLElement;
  private readonly toastEl: HTMLElement;
  private toastTimer: number | undefined;

  // Overlay debug (FPS, latence…), bascule F3.
  private readonly debugEl: HTMLElement;
  private debugVisible = true;
  // Switches (on/off) + steppers (−/+) ajoutés au bas de l'overlay debug — outils de dev.
  private readonly debugToggles: Array<{ label: string; on: boolean; onToggle: (on: boolean) => void }> = [];
  private readonly debugSteppers: Array<{
    label: string; value: number; min: number; max: number; step: number;
    onChange: (v: number) => void; format: (v: number) => string;
  }> = [];
  private lastDebugRows: Array<[string, string]> = [];

  // Menu Paramètres (centré). « UI interactive » = dialogue OU menu.
  private readonly settingsEl: HTMLElement;
  private readonly settingsResumeBtn: HTMLButtonElement;
  private settingsIsOpen = false;

  // Réglages audio (section « Son » du menu Paramètres).
  private readonly volMaster: HTMLInputElement;
  private readonly volMusic: HTMLInputElement;
  private readonly volSfx: HTMLInputElement;
  private readonly volMasterVal: HTMLElement;
  private readonly volMusicVal: HTMLElement;
  private readonly volSfxVal: HTMLElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly sfxTogglesEl: HTMLElement;
  private audioMuted = false;

  // Étiquette d'interaction (ancrée à l'écran au-dessus de l'objet).
  private readonly promptEl: HTMLElement;
  private readonly promptVerbEl: HTMLElement;

  // Dialogue.
  private readonly dialogueEl: HTMLElement;
  private readonly dlgSpeakerEl: HTMLElement;
  private readonly dlgTextEl: HTMLElement;
  private readonly dlgSteppersEl: HTMLElement;
  private readonly dlgChoicesEl: HTMLElement;
  private dialogueIsOpen = false;
  // Navigation clavier : éléments sélectionnables (steppers puis choix) + index courant.
  private navItems: Array<{ el: HTMLElement; choice?: DialogueChoice; stepper?: DialogueStepper }> = [];
  private selectedIndex = 0;
  // Info-bulle flottante (créée à la demande) — ex. ressources manquantes au survol.
  private tooltipEl: HTMLElement | null = null;

  constructor() {
    this.bagCapEl = this.byId("bagCap");
    this.bagList = this.byId("bagList");
    this.fireEl = this.byId("fireValue");
    this.tempEl = this.byId("tempValue");
    this.popEl = this.byId("popValue");
    this.statusEl = this.byId("netStatus");
    this.statusTextEl = this.byId("netStatusText");
    this.roomInput = this.byId("roomInput") as HTMLInputElement;
    this.roomBtn = this.byId("roomBtn") as HTMLButtonElement;
    this.hostBtn = this.byId("hostBtn") as HTMLButtonElement;
    this.shareRow = this.byId("shareRow");
    this.shareLink = this.byId("shareLink") as HTMLInputElement;
    this.copyBtn = this.byId("copyBtn") as HTMLButtonElement;
    this.copyBtn.addEventListener("click", () => {
      this.shareLink.select();
      void navigator.clipboard?.writeText(this.shareLink.value).then(() => this.toast("lien copié"));
    });
    this.rendererTag = this.byId("rendererTag");
    this.toastEl = this.byId("toast");
    this.debugEl = this.byId("debugOverlay");
    this.settingsEl = this.byId("settings");
    this.settingsResumeBtn = this.byId("settingsResume") as HTMLButtonElement;
    this.volMaster = this.byId("volMaster") as HTMLInputElement;
    this.volMusic = this.byId("volMusic") as HTMLInputElement;
    this.volSfx = this.byId("volSfx") as HTMLInputElement;
    this.volMasterVal = this.byId("volMasterVal");
    this.volMusicVal = this.byId("volMusicVal");
    this.volSfxVal = this.byId("volSfxVal");
    this.muteBtn = this.byId("muteBtn") as HTMLButtonElement;
    this.sfxTogglesEl = this.byId("sfxToggles");
    this.promptEl = this.byId("interactPrompt");
    this.promptVerbEl = this.byId("promptVerb");
    this.dialogueEl = this.byId("dialogue");
    this.dlgSpeakerEl = this.byId("dlgSpeaker");
    this.dlgTextEl = this.byId("dlgText");
    this.dlgSteppersEl = this.byId("dlgSteppers");
    this.dlgChoicesEl = this.byId("dlgChoices");
  }

  private byId(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Élément HUD introuvable : #${id}`);
    return el;
  }

  /** Contenu du SAC porté + capacité. */
  setBag(total: number, capacity: number, entries: Array<{ label: string; value: number }>): void {
    this.bagCapEl.textContent = `${total}/${capacity}`;
    if (entries.length === 0) {
      const row = document.createElement("div");
      row.className = "rrow empty";
      row.textContent = "(vide)";
      this.bagList.replaceChildren(row);
      return;
    }
    this.bagList.replaceChildren(
      ...entries.map(({ label, value }) => {
        const row = document.createElement("div");
        row.className = "rrow";
        const name = document.createElement("span");
        name.className = "rname";
        name.textContent = label;
        const val = document.createElement("span");
        val.className = "rval";
        val.textContent = String(value);
        row.append(name, val);
        return row;
      }),
    );
  }

  setFire(label: string): void {
    this.fireEl.textContent = label;
  }

  setTemp(label: string): void {
    this.tempEl.textContent = label;
  }

  setPopulation(text: string): void {
    this.popEl.textContent = text;
  }

  setRenderer(label: string): void {
    this.rendererTag.textContent = `rendu : ${label.toUpperCase()}`;
  }

  /** Met à jour l'overlay debug à partir de paires (libellé, valeur). */
  setDebug(rows: Array<[string, string]>): void {
    this.lastDebugRows = rows;
    this.renderDebug();
  }

  /** Ajoute un SWITCH on/off au bas de l'overlay debug (outil de dev). */
  addDebugToggle(label: string, initial: boolean, onToggle: (on: boolean) => void): void {
    this.debugToggles.push({ label, on: initial, onToggle });
    this.renderDebug();
  }

  /** Ajoute un STEPPER (−/+) au bas de l'overlay debug (outil de dev). */
  addDebugStepper(
    label: string,
    initial: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
    format: (v: number) => string = String,
  ): void {
    this.debugSteppers.push({ label, value: initial, min, max, step, onChange, format });
    this.renderDebug();
  }

  /** Met à jour la valeur AFFICHÉE d'un stepper sans déclencher son onChange (sync auto -> HUD). */
  setDebugStepperValue(label: string, value: number): void {
    const st = this.debugSteppers.find((s) => s.label === label);
    if (!st || st.value === value) return;
    st.value = value;
    this.renderDebug();
  }

  private renderDebug(): void {
    const title = document.createElement("div");
    title.className = "dtitle";
    const t = document.createElement("span");
    t.textContent = "debug";
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "F3";
    title.append(t, hint);

    const rows = this.lastDebugRows.map(([k, v]) => {
      const row = document.createElement("div");
      row.className = "drow";
      const kel = document.createElement("span");
      kel.className = "dk";
      kel.textContent = k;
      const vel = document.createElement("span");
      vel.className = "dv";
      vel.textContent = v;
      row.append(kel, vel);
      return row;
    });

    const toggles = this.debugToggles.map((tg) => {
      const row = document.createElement("div");
      row.className = "drow";
      const kel = document.createElement("span");
      kel.className = "dk";
      kel.textContent = tg.label;
      const sw = document.createElement("button"); // switch cliquable
      sw.type = "button";
      sw.textContent = tg.on ? "ON" : "OFF";
      Object.assign(sw.style, {
        pointerEvents: "auto",
        cursor: "pointer",
        border: "none",
        borderRadius: "999px",
        padding: "1px 9px",
        font: "inherit",
        fontWeight: "700",
        color: tg.on ? "#0c1416" : "#cfe3df",
        background: tg.on ? "#ffd78a" : "rgba(255,255,255,0.14)",
      } as CSSStyleDeclaration);
      sw.addEventListener("click", (e) => {
        e.stopPropagation();
        tg.on = !tg.on;
        tg.onToggle(tg.on);
        this.renderDebug(); // retour visuel immédiat
      });
      row.append(kel, sw);
      return row;
    });

    const steppers = this.debugSteppers.map((st) => {
      const row = document.createElement("div");
      row.className = "drow";
      const kel = document.createElement("span");
      kel.className = "dk";
      kel.textContent = st.label;
      const ctrl = document.createElement("span");
      Object.assign(ctrl.style, { display: "inline-flex", alignItems: "center", gap: "6px" } as CSSStyleDeclaration);
      const mkBtn = (txt: string, dir: number): HTMLButtonElement => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = txt;
        Object.assign(b.style, {
          pointerEvents: "auto", cursor: "pointer", border: "none", borderRadius: "4px",
          width: "20px", font: "inherit", fontWeight: "700", color: "#0c1416", background: "#ffd78a",
        } as CSSStyleDeclaration);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          st.value = Math.max(st.min, Math.min(st.max, st.value + dir * st.step));
          st.onChange(st.value);
          this.renderDebug();
        });
        return b;
      };
      const val = document.createElement("span");
      val.className = "dv";
      val.textContent = st.format(st.value);
      ctrl.append(mkBtn("−", -1), val, mkBtn("+", 1));
      row.append(kel, ctrl);
      return row;
    });

    this.debugEl.replaceChildren(title, ...rows, ...toggles, ...steppers);
  }

  /** Affiche/masque l'overlay debug (F3). Renvoie le nouvel état. */
  toggleDebug(): boolean {
    this.debugVisible = !this.debugVisible;
    this.debugEl.classList.toggle("hidden", !this.debugVisible);
    return this.debugVisible;
  }

  get debugShown(): boolean {
    return this.debugVisible;
  }

  setNetStatus(text: string, online: boolean): void {
    this.statusTextEl.textContent = text;
    this.statusEl.classList.toggle("online", online);
  }

  setRoomCode(code: string): void {
    this.roomInput.value = code;
  }

  /** Affiche le lien partageable (après « Ouvrir ma partie »). */
  showShareCode(code: string, link: string): void {
    this.shareLink.value = link;
    this.shareRow.style.display = "flex";
    this.hostBtn.textContent = `Partie ouverte · code ${code}`;
  }

  onJoin(cb: (code: string) => void): void {
    const fire = () => {
      const code = this.roomInput.value.trim();
      if (code) cb(code);
    };
    this.roomBtn.addEventListener("click", fire);
    this.roomInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") fire();
    });
  }

  /** Bouton « Ouvrir ma partie aux autres ». */
  onHostGame(cb: () => void): void {
    this.hostBtn.addEventListener("click", cb);
  }

  toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add("show");
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), 1600);
  }

  // ---- Étiquette d'interaction (diégétique) ----

  /** Affiche « E + verbe » à l'écran (x,y px) ; `verb` null pour masquer. */
  setPrompt(verb: string | null, x = 0, y = 0): void {
    if (!verb || this.dialogueIsOpen) {
      this.promptEl.style.display = "none";
      return;
    }
    this.promptVerbEl.textContent = verb;
    this.promptEl.style.left = `${x}px`;
    this.promptEl.style.top = `${y}px`;
    this.promptEl.style.display = "block";
  }

  // ---- Dialogue ----

  get dialogueOpen(): boolean {
    return this.dialogueIsOpen;
  }

  /**
   * Affiche un dialogue. `preserveSelection` conserve l'élément sélectionné lors d'un
   * rafraîchissement (ex. après un ±) pour ne pas faire « sauter » le surlignage.
   * Cliquable à la souris (si pointeur libre) ET navigable au clavier (pointeur capturé).
   */
  openDialogue(view: DialogueView, preserveSelection = false): void {
    this.hideTooltip(); // les anciens boutons disparaissent : pas de mouseleave -> on nettoie
    this.dlgSpeakerEl.textContent = view.speaker;
    this.dlgTextEl.textContent = view.text;
    this.navItems = [];

    this.dlgSteppersEl.replaceChildren(
      ...(view.steppers ?? []).map((st) => {
        const row = document.createElement("div");
        row.className = "dlgStepper";
        const name = document.createElement("span");
        name.className = "dsName";
        name.textContent = st.label;
        if (st.sublabel) {
          const sub = document.createElement("span");
          sub.className = "dsSub";
          sub.textContent = st.sublabel;
          name.appendChild(sub);
        }
        const right = document.createElement("div");
        right.className = "dsRight";
        const val = document.createElement("span");
        val.className = "dsVal";
        val.textContent = st.value;
        if (st.readOnly) {
          // Occupation par défaut (ex. bûcheron) : effectif affiché, sans boutons ni sélection.
          row.classList.add("readonly");
          right.append(val);
          row.append(name, right);
          return row;
        }
        const dec = document.createElement("button");
        dec.className = "dlgStepBtn";
        dec.textContent = "−";
        dec.disabled = !st.canDec;
        dec.addEventListener("click", () => { st.onDec(); dec.blur(); });
        const inc = document.createElement("button");
        inc.className = "dlgStepBtn";
        inc.textContent = "+";
        inc.disabled = !st.canInc;
        inc.addEventListener("click", () => { st.onInc(); inc.blur(); });
        right.append(dec, val, inc);
        row.append(name, right);
        this.navItems.push({ el: row, stepper: st });
        return row;
      }),
    );

    this.dlgChoicesEl.replaceChildren(
      ...view.choices.map((choice) => {
        const btn = document.createElement("button");
        btn.className = "dlgChoice";
        const name = document.createElement("span");
        name.className = "dcName";
        name.textContent = choice.label;
        btn.appendChild(name);
        if (choice.isNew) {
          const badge = document.createElement("span");
          badge.className = "dcNew";
          badge.textContent = "nouveau";
          btn.appendChild(badge);
        }
        if (choice.sublabel) {
          const cost = document.createElement("span");
          cost.className = "dcCost";
          cost.textContent = choice.sublabel;
          btn.appendChild(cost);
        }
        // Un bouton `disabled` ne reçoit pas les événements de survol : si on veut une
        // info-bulle (ex. « ce qui manque »), on le laisse actif mais grisé via la classe.
        if (choice.tooltip) {
          if (!choice.enabled) btn.classList.add("disabled");
          btn.addEventListener("mouseenter", () => this.showTooltip(choice.tooltip!, btn));
          btn.addEventListener("mouseleave", () => this.hideTooltip());
        } else {
          btn.disabled = !choice.enabled;
        }
        btn.addEventListener("click", () => { if (choice.enabled) choice.onSelect(); btn.blur(); });
        this.navItems.push({ el: btn, choice });
        return btn;
      }),
    );

    this.dialogueEl.style.display = "block";
    this.dialogueIsOpen = true;
    this.setPrompt(null);

    this.selectedIndex = preserveSelection
      ? Math.min(Math.max(this.selectedIndex, 0), Math.max(0, this.navItems.length - 1))
      : 0;
    this.applyHighlight();
  }

  private applyHighlight(): void {
    this.navItems.forEach((it, i) => it.el.classList.toggle("selected", i === this.selectedIndex));
  }

  /** Déplace la sélection (clavier). */
  dialogueNavigate(delta: number): void {
    if (!this.dialogueIsOpen || this.navItems.length === 0) return;
    const n = this.navItems.length;
    this.selectedIndex = (this.selectedIndex + delta + n) % n;
    this.applyHighlight();
  }

  /** Gauche/droite : ajuste un stepper sélectionné. */
  dialogueAdjust(delta: number): void {
    const it = this.navItems[this.selectedIndex];
    if (!it?.stepper) return;
    if (delta < 0 && it.stepper.canDec) it.stepper.onDec();
    else if (delta > 0 && it.stepper.canInc) it.stepper.onInc();
  }

  /** Entrée/E : valide le choix sélectionné (ou incrémente un stepper). */
  dialogueConfirm(): void {
    const it = this.navItems[this.selectedIndex];
    if (!it) return;
    if (it.choice) {
      if (it.choice.enabled) it.choice.onSelect();
    } else if (it.stepper?.canInc) {
      it.stepper.onInc();
    }
  }

  closeDialogue(): void {
    this.hideTooltip();
    this.dialogueEl.style.display = "none";
    this.dialogueIsOpen = false;
    this.navItems = [];
  }

  // ---- Info-bulle de survol (ressources manquantes, etc.) ----

  private showTooltip(text: string, anchor: HTMLElement): void {
    if (!this.tooltipEl) {
      this.tooltipEl = document.createElement("div");
      this.tooltipEl.className = "dlgTooltip";
      document.body.appendChild(this.tooltipEl);
    }
    const tip = this.tooltipEl;
    tip.textContent = text;
    tip.style.display = "block";
    // Ancrée à droite du choix ; repliée à gauche si ça dépasse l'écran.
    const r = anchor.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const x = r.right + 10 + tw > window.innerWidth ? r.left - 10 - tw : r.right + 10;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${r.top}px`;
  }

  private hideTooltip(): void {
    if (this.tooltipEl) this.tooltipEl.style.display = "none";
  }

  // ---- Menu Paramètres (centré) ----

  get settingsOpen(): boolean {
    return this.settingsIsOpen;
  }

  /** Une interface interactive est-elle ouverte ? (dialogue ou menu) -> souris libérée. */
  get interactiveOpen(): boolean {
    return this.dialogueIsOpen || this.settingsIsOpen;
  }

  openSettings(): void {
    this.settingsEl.style.display = "block";
    this.settingsIsOpen = true;
    this.setPrompt(null);
  }

  closeSettings(): void {
    this.settingsEl.style.display = "none";
    this.settingsIsOpen = false;
  }

  /** Bouton « Reprendre » du menu. */
  onSettingsResume(cb: () => void): void {
    this.settingsResumeBtn.addEventListener("click", cb);
  }

  // ---- Section « Son » (réglages audio) ----

  /** Initialise les curseurs + affichages depuis les réglages chargés (0..1). */
  setAudioValues(master: number, music: number, sfx: number, muted: boolean): void {
    const pct = (v: number) => String(Math.round(v * 100));
    this.volMaster.value = pct(master);
    this.volMusic.value = pct(music);
    this.volSfx.value = pct(sfx);
    this.volMasterVal.textContent = `${pct(master)}%`;
    this.volMusicVal.textContent = `${pct(music)}%`;
    this.volSfxVal.textContent = `${pct(sfx)}%`;
    this.setMuteVisual(muted);
  }

  private setMuteVisual(muted: boolean): void {
    this.audioMuted = muted;
    this.muteBtn.textContent = muted ? "Réactiver le son" : "Couper le son";
    this.muteBtn.classList.toggle("muted", muted);
  }

  /** Curseurs de volume -> callback (valeur 0..1) en direct pendant le glissement. */
  onAudioVolume(cb: (kind: "master" | "music" | "sfx", value: number) => void): void {
    const wire = (input: HTMLInputElement, label: HTMLElement, kind: "master" | "music" | "sfx") => {
      input.addEventListener("input", () => {
        const v = Number(input.value);
        label.textContent = `${v}%`;
        cb(kind, v / 100);
      });
    };
    wire(this.volMaster, this.volMasterVal, "master");
    wire(this.volMusic, this.volMusicVal, "music");
    wire(this.volSfx, this.volSfxVal, "sfx");
  }

  /** Bouton « couper/réactiver le son » -> callback (nouvel état mute). */
  onMuteToggle(cb: (muted: boolean) => void): void {
    this.muteBtn.addEventListener("click", () => {
      this.setMuteVisual(!this.audioMuted);
      cb(this.audioMuted);
    });
  }

  /** Construit la liste « Effets actifs » : une case à cocher par effet, câblée au callback. */
  buildSfxToggles(items: Array<{ key: string; label: string; enabled: boolean }>, onToggle: (key: string, enabled: boolean) => void): void {
    this.sfxTogglesEl.replaceChildren(
      ...items.map(({ key, label, enabled }) => {
        const row = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = enabled;
        cb.addEventListener("change", () => onToggle(key, cb.checked));
        const txt = document.createElement("span");
        txt.textContent = label;
        row.append(cb, txt);
        return row;
      }),
    );
  }
}
