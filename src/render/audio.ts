// ============================================================================
//  AUDIO — moteur de PRÉSENTATION (Babylon AudioV2 / Web Audio).
//
//  Rôle (cf. docs/plan-audio.md) : jouer musique + effets sonores. C'est de la
//  PRÉSENTATION, au même titre que les villageois cosmétiques, la fumée ou le
//  brouillard :
//    - ne touche JAMAIS le GameState, n'émet aucune action, n'ajoute rien au réseau ;
//    - n'utilise JAMAIS state.rng (réservé au déterministe) ; Math.random est admis
//      ici (variation cosmétique des SFX) ;
//    - lit l'état et joue LOCALEMENT -> en P2P chaque pair joue son propre audio
//      d'après l'état qu'il a adopté (cohérence gratuite, zéro trafic ajouté).
//
//  Graphe (AudioV2) :
//      sons SFX  ─────────────────► sfxBus  ──┐
//      pistes musique (crossfade) ─► musicBus ─┤► (engine = MASTER) ► destination
//  Le MASTER est le volume de l'engine ; musicBus/sfxBus ont leur propre volume.
//  Le crossfade de musique = un SEUL ramp Web Audio par transition (setVolume(target,
//  {duration})) : pas de réglage de volume par frame -> aucun artefact de re-planification.
//  Le bus musique porte un gain de compensation (MUSIC_MAKEUP) car les pistes d'ADR sont
//  masterisées très bas (sinon on pousse le volume système et on entend le bruit matériel).
//
//  Lots livrés ici : A1 (socle : engine, bus, volumes, mute, déverrouillage, SFX)
//  + A2 (musique de l'état du feu). Le reste (A3 SFX d'action, A4 feu spatial,
//  A5 musique d'événement, A6 village/exploration) se branche sans refonte.
// ============================================================================

import {
  CreateAudioEngineAsync,
  CreateAudioBusAsync,
  CreateSoundAsync,
  Vector3,
  type Node,
  type AudioEngineV2,
  type AudioBus,
  type StaticSound,
} from "@babylonjs/core";

import { audioManifest, type SfxKey } from "../../data/audio";

const FADE = 1.0; // secondes — durée du fondu enchaîné musical (cf. FADE_TIME d'ADR)
// PAS de gain de compensation : l'ambiance de feu d'A Dark Room (un crépitement en boucle)
// est jugée désagréable quand elle est trop présente. On la laisse au niveau natif (faible),
// réglable via le curseur Musique. (Un essai à ×5 avait amplifié exactement ce qui dérange.)
const MUSIC_MAKEUP = 1;
const DUCK = 0.25; // A5 : le fond baisse à 25 % pendant une musique d'événement
// A4 — feu SPATIALISÉ : les pistes `fire-*` sont positionnées au foyer (origine) et
// s'atténuent avec la distance (plein jusqu'à FIRE_MIN, silence au-delà de FIRE_MAX ≈ bord du
// camp). C'est l'atout 3D : le feu se tait quand on s'éloigne (corrige « je l'entends partout »).
const FIRE_MIN_DIST = 6;
const FIRE_MAX_DIST = 42;

/** URL d'un fichier audio (servi depuis public/audio/ par Vite, respecte la base). */
function audioUrl(name: string): string {
  return `${import.meta.env.BASE_URL}${audioManifest.dir}${name}.${audioManifest.ext}`;
}

interface MusicTrack {
  sound: StaticSound;
  playing: boolean;
  stopAt: number | null; // compte à rebours (s) avant stop après un fondu sortant ; null = actif
}

export class AudioManager {
  private engine: AudioEngineV2 | null = null;
  private musicBus: AudioBus | null = null;
  private eventBus: AudioBus | null = null; // A5 : musique d'événement (par-dessus le fond)
  private sfxBus: AudioBus | null = null;
  private ready = false;
  private ducked = false; // A5 : le fond est-il abaissé (un événement joue) ?
  private eventTrackName: string | null = null; // A5 : musique d'événement voulue
  private listenerNode: Node | null = null; // A4 : « oreille » (caméra) pour le spatial

  // Réglages joueur (persistés hors GameState par main.ts). Défauts raisonnables.
  private _master = 0.7;
  private _music = 0.6; // un peu sous les SFX pour qu'ils ressortent
  private _sfx = 0.85;
  private _muted = false;

  // MUSIQUE : pistes mises en cache (chargées paresseusement), crossfade manuel.
  private musicTracks = new Map<string, MusicTrack>(); // clé = nom de fichier
  private currentMusicKey: string | null = null; // nom de fichier de la piste voulue

  // SFX : sons mis en cache par nom de fichier (chargement paresseux).
  private sfxCache = new Map<string, StaticSound>();
  private sfxLoading = new Set<string>();
  // Effets DÉSACTIVÉS par le joueur (par clé logique, ex. "footsteps") — réglage local persisté.
  private sfxDisabled = new Set<string>();

  // ---- Cycle de vie ----------------------------------------------------------

  /** Crée le moteur AudioV2 + les bus. Sans danger d'échec : on log et on n'a juste pas de son. */
  async init(): Promise<void> {
    try {
      this.engine = await CreateAudioEngineAsync({
        volume: this._muted ? 0 : this._master,
        // On a NOTRE propre UI de volume (menu Paramètres) -> pas le bouton mute par défaut.
        disableDefaultUI: true,
        // Reprend le contexte au 1er geste utilisateur (politique d'autoplay navigateur).
        resumeOnInteraction: true,
      });
      this.musicBus = await CreateAudioBusAsync("music", {}, this.engine);
      this.eventBus = await CreateAudioBusAsync("event", {}, this.engine);
      this.sfxBus = await CreateAudioBusAsync("sfx", { volume: this._sfx }, this.engine);
      this.applyMusicVolumes();
      if (this.listenerNode) this.engine.listener.attach(this.listenerNode); // A4 : oreille = caméra
      this.ready = true;
      // Si une musique a été demandée avant la fin de l'init, on la lance maintenant.
      const pending = this.currentMusicKey;
      if (pending) void this.startTrack(pending, () => this.currentMusicKey === pending);
    } catch (e) {
      console.warn("[audio] init impossible (pas de son) :", e);
    }
  }

  /** Débloque le contexte audio (à appeler dans un geste utilisateur — ex. 1er clic). */
  resumeOnGesture(): void {
    void this.engine?.resumeAsync().catch(() => {});
  }

  /** A4 — attache l'« oreille » (le listener spatial) à un nœud de scène (la caméra). */
  attachListener(node: Node): void {
    this.listenerNode = node;
    if (this.engine) this.engine.listener.attach(node);
  }

  /** Le contexte tourne-t-il (son audible) ? Sinon : en attente d'un geste utilisateur. */
  get unlocked(): boolean {
    return this.engine?.state === "running";
  }

  /** Nom de fichier de la musique de fond voulue (null = silence) — pour le debug/e2e. */
  get currentMusic(): string | null {
    return this.currentMusicKey;
  }

  /** Nom de fichier de la musique d'événement en cours (null = aucune) — debug/e2e. */
  get currentEventMusic(): string | null {
    return this.eventTrackName;
  }

  // ---- Volumes (réglages joueur) --------------------------------------------

  get master(): number { return this._master; }
  get musicVolume(): number { return this._music; }
  get sfxVolume(): number { return this._sfx; }
  get muted(): boolean { return this._muted; }

  setMaster(v: number): void {
    this._master = clamp01(v);
    if (this.engine) this.engine.volume = this._muted ? 0 : this._master;
  }
  setMusicVolume(v: number): void {
    this._music = clamp01(v);
    this.applyMusicVolumes();
  }

  /** Applique le volume musique aux deux bus : le fond (abaissé si un événement joue) et l'événement. */
  private applyMusicVolumes(): void {
    const g = this._music * MUSIC_MAKEUP;
    if (this.musicBus) this.musicBus.volume = g * (this.ducked ? DUCK : 1);
    if (this.eventBus) this.eventBus.volume = g;
  }
  setSfxVolume(v: number): void {
    this._sfx = clamp01(v);
    if (this.sfxBus) this.sfxBus.volume = this._sfx;
  }
  setMuted(on: boolean): void {
    this._muted = on;
    if (this.engine) this.engine.volume = on ? 0 : this._master;
  }

  // ---- MUSIQUE (A2) : une piste de fond, fondu enchaîné -----------------------

  /**
   * Musique de fond voulue, par NOM DE FICHIER (ou null = silence). Idempotent :
   * ne recharge pas si c'est déjà la piste courante. La piste sortante fond vers 0,
   * la nouvelle fond vers 1 (géré dans update()).
   */
  setBackgroundMusic(name: string | null): void {
    if (name === this.currentMusicKey) return;
    this.fadeOutTrack(this.currentMusicKey); // piste sortante -> 0 sur FADE, stop différé
    this.currentMusicKey = name;
    if (name) void this.startTrack(name, () => this.currentMusicKey === name);
  }

  /** Démarre une piste avec fondu entrant, si elle est toujours « voulue » à la fin du chargement. */
  private async startTrack(name: string, stillWanted: () => boolean): Promise<void> {
    const track = await this.ensureTrack(name);
    if (!track || !stillWanted()) return;
    track.stopAt = null; // on l'active (annule un éventuel stop différé)
    if (!track.playing) {
      track.sound.volume = 0;
      track.sound.play();
      track.playing = true;
    }
    this.rampVolume(track.sound, 1); // fondu entrant : un SEUL ramp 0->1 sur FADE
  }

  /** Fondu sortant d'une piste (par nom), puis stop différé après FADE. */
  private fadeOutTrack(name: string | null): void {
    if (!name) return;
    const t = this.musicTracks.get(name);
    if (t && t.playing) { this.rampVolume(t.sound, 0); t.stopAt = FADE; }
  }

  // ---- MUSIQUE D'ÉVÉNEMENT (A5) : par-dessus le fond, qui est abaissé (ducking) ---------------

  /** Joue une musique d'événement en boucle (sur le bus event) et abaisse le fond. Idempotent. */
  playEventMusic(name: string): void {
    if (name === this.eventTrackName) return;
    this.fadeOutTrack(this.eventTrackName);
    this.eventTrackName = name;
    this.ducked = true;
    this.applyMusicVolumes();
    void this.startTrack(name, () => this.eventTrackName === name);
  }

  /** Coupe la musique d'événement et restaure le fond. */
  stopEventMusic(): void {
    if (!this.eventTrackName && !this.ducked) return;
    this.fadeOutTrack(this.eventTrackName);
    this.eventTrackName = null;
    this.ducked = false;
    this.applyMusicVolumes();
  }

  /** Rampe douce du volume d'un son en un seul ramp Web Audio (repli : set immédiat). */
  private rampVolume(sound: StaticSound, to: number): void {
    try {
      sound.setVolume(to, { duration: FADE });
    } catch {
      sound.volume = to;
    }
  }

  private async ensureTrack(name: string): Promise<MusicTrack | null> {
    const existing = this.musicTracks.get(name);
    if (existing) return existing;
    if (!this.engine) return null;
    // Routage par préfixe : event-* -> bus event (A5) ; fire-* -> bus musique + SPATIAL (A4) ;
    // sinon (village/world) -> bus musique, non spatial.
    const isFire = name.startsWith("fire-");
    const bus = name.startsWith("event-") ? this.eventBus : this.musicBus;
    if (!bus) return null;
    try {
      const sound = await CreateSoundAsync(
        `music:${name}`,
        audioUrl(name),
        isFire
          ? { loop: true, autoplay: false, volume: 0, outBus: bus, spatialEnabled: true,
              spatialDistanceModel: "linear", spatialMinDistance: FIRE_MIN_DIST, spatialMaxDistance: FIRE_MAX_DIST }
          : { loop: true, autoplay: false, volume: 0, outBus: bus },
        this.engine,
      );
      if (isFire) sound.spatial.position = new Vector3(0, 1.2, 0); // au foyer (origine)
      // Course possible : si deux demandes chargent la même piste en parallèle.
      const again = this.musicTracks.get(name);
      if (again) { sound.dispose(); return again; }
      const track: MusicTrack = { sound, playing: false, stopAt: null };
      this.musicTracks.set(name, track);
      return track;
    } catch (e) {
      console.warn(`[audio] musique « ${name} » non chargée :`, e);
      return null;
    }
  }

  // ---- SFX (socle A1 ; câblage des sons par main.ts) -------------------------

  /** Active/désactive un effet ponctuel par clé logique (réglage joueur). */
  setSfxEnabled(key: string, on: boolean): void {
    if (on) this.sfxDisabled.delete(key);
    else this.sfxDisabled.add(key);
  }
  isSfxEnabled(key: string): boolean {
    return !this.sfxDisabled.has(key);
  }
  /** Liste des effets désactivés (pour la persistance). */
  getDisabledSfx(): string[] {
    return [...this.sfxDisabled];
  }

  /** Joue un effet sonore ponctuel (tire une variante au hasard si plusieurs — cosmétique). */
  playSfx(key: SfxKey): void {
    if (this.sfxDisabled.has(key)) return; // effet désactivé par le joueur
    const entry = audioManifest.sfx[key];
    const name = Array.isArray(entry) ? entry[Math.floor(Math.random() * entry.length)] : entry;
    const cached = this.sfxCache.get(name);
    if (cached) { cached.play(); return; }
    void this.loadSfx(name).then((s) => s?.play());
  }

  private async loadSfx(name: string): Promise<StaticSound | null> {
    const cached = this.sfxCache.get(name);
    if (cached) return cached;
    if (!this.engine || !this.sfxBus || this.sfxLoading.has(name)) return null;
    this.sfxLoading.add(name);
    try {
      const sound = await CreateSoundAsync(
        `sfx:${name}`,
        audioUrl(name),
        { loop: false, autoplay: false, outBus: this.sfxBus },
        this.engine,
      );
      this.sfxCache.set(name, sound);
      return sound;
    } catch (e) {
      console.warn(`[audio] SFX « ${name} » non chargé :`, e);
      return null;
    } finally {
      this.sfxLoading.delete(name);
    }
  }

  /**
   * Joue un petit « toc » de porte SYNTHÉTISÉ (aucun fichier requis — A Dark Room n'a pas de son
   * de porte). `gain` 0..1 = atténuation par la distance (calculée par main.ts). Respecte le toggle
   * SFX « door » et le bus SFX. Échec silencieux. Cosmétique/local (cf. en-tête).
   */
  playDoor(gain = 1): void {
    if (this.sfxDisabled.has("door")) return;
    const g = clamp01(gain);
    if (g <= 0.001) return;
    const cached = this.sfxCache.get("__door");
    if (cached) { this.playOneShot(cached, g); return; }
    void this.loadDoor().then((s) => { if (s) this.playOneShot(s, g); });
  }

  private playOneShot(s: StaticSound, gain: number): void {
    try { s.volume = gain; } catch { /* ignore */ }
    s.play();
  }

  /** Charge (une fois) le son de porte synthétisé via une data-URL WAV. */
  private async loadDoor(): Promise<StaticSound | null> {
    if (!this.engine || !this.sfxBus || this.sfxLoading.has("__door")) return null;
    this.sfxLoading.add("__door");
    try {
      const sound = await CreateSoundAsync(
        "sfx:door",
        synthDoorWavUrl(),
        { loop: false, autoplay: false, outBus: this.sfxBus },
        this.engine,
      );
      this.sfxCache.set("__door", sound);
      return sound;
    } catch (e) {
      console.warn("[audio] porte (synth) non chargée :", e);
      return null;
    } finally {
      this.sfxLoading.delete("__door");
    }
  }

  // ---- Boucle : fondu enchaîné manuel (appelé chaque frame depuis main.ts) ----

  update(dtSec: number): void {
    if (!this.ready) return;
    // Plus aucun réglage de volume par frame (les fondus sont des ramps Web Audio uniques) :
    // on ne fait qu'arrêter les pistes dont le fondu sortant est terminé.
    for (const t of this.musicTracks.values()) {
      if (t.stopAt === null) continue;
      t.stopAt -= dtSec;
      if (t.stopAt <= 0) {
        if (t.playing) { t.sound.stop(); t.playing = false; }
        t.stopAt = null;
      }
    }
  }

  dispose(): void {
    for (const t of this.musicTracks.values()) t.sound.dispose();
    for (const s of this.sfxCache.values()) s.dispose();
    this.musicTracks.clear();
    this.sfxCache.clear();
    this.engine?.dispose();
    this.engine = null;
    this.ready = false;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// --- Son de porte SYNTHÉTISÉ (pas d'asset) : un « toc » de bois = thud grave + tonalité bois +
//     petit clic, enveloppe à décroissance rapide. Encodé une fois en data-URL WAV (mono 16-bit),
//     décodable par Web Audio. Math.random admis ici (cosmétique, et figé au premier appel).
let _doorWavUrl: string | null = null;
function synthDoorWavUrl(): string {
  if (_doorWavUrl) return _doorWavUrl;
  const sr = 22050, dur = 0.17, n = Math.floor(sr * dur);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const thud = Math.sin(2 * Math.PI * 128 * t) * Math.exp(-t * 26); // corps grave (bois épais)
    const wood = Math.sin(2 * Math.PI * 430 * t) * Math.exp(-t * 42) * 0.35; // résonance bois
    const click = (Math.random() * 2 - 1) * Math.exp(-t * 130) * 0.22; // clic de loquet
    data[i] = (thud * 0.7 + wood + click) * 0.8;
  }
  _doorWavUrl = floatToWavDataUrl(data, sr);
  return _doorWavUrl;
}

/** Encode des échantillons [-1,1] en data-URL WAV PCM 16-bit mono. */
function floatToWavDataUrl(samples: Float32Array, sampleRate: number): string {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const writeStr = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF"); view.setUint32(4, 36 + n * 2, true); writeStr(8, "WAVE");
  writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeStr(36, "data"); view.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const s = samples[i] < -1 ? -1 : samples[i] > 1 ? 1 : samples[i];
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(bin);
}
