// ============================================================================
//  MANIFESTE AUDIO (DONNÉES) — clés LOGIQUES -> noms de fichiers.
//
//  Calqué sur l'`audioLibrary.js` d'A Dark Room. Les fichiers vivent dans
//  `public/audio/` (récupérés de doublespeakgames/adarkroom) et sont servis par
//  Vite à `<base>audio/<nom>.<ext>`.
//
//  SWAPPABLE : changer d'asset = éditer CE fichier, sans toucher au moteur audio
//  (`src/render/audio.ts`). L'audio est de la PRÉSENTATION : ce manifeste n'entre
//  JAMAIS dans `sim/` et ne participe pas au déterminisme.
//
//  Détail & plan : docs/plan-audio.md.
// ============================================================================

export const audioManifest = {
  dir: "audio/", // servi depuis public/ -> <base>audio/
  ext: "flac", // FLAC : décodable par Web Audio dans tous les navigateurs modernes

  music: {
    // Indexé par `state.fire` (0..4) — mapping 1:1 avec l'original. (Lot A2)
    fire: ["fire-dead", "fire-smoldering", "fire-flickering", "fire-burning", "fire-roaring"],
    // Paliers de population (seuils décidés côté présentation) — réservé lot A6.
    village: ["lonely-hut", "tiny-village", "modest-village", "large-village", "raucous-village"],
    exploration: "world", // hors retranchement (M7) — réservé lot A6.
  },

  // Sons d'événements M5 (overlay + ducking) — réservé lot A5. Clés indicatives,
  // à aligner sur les ids réels de `data/world.ts` au moment du branchement.
  events: {
    noisesOutside: "event-noises-outside",
    noisesInside: "event-noises-inside",
    beggar: "event-beggar",
    nomad: "event-nomad",
    ruinedTrap: "event-ruined-trap",
    hutFire: "event-hut-fire",
    beastAttack: "event-beast-attack",
    mysteriousWanderer: "event-mysterious-wanderer",
    shadyBuilder: "event-shady-builder",
  } as Record<string, string>,

  // Effets sonores ponctuels. Une entrée tableau = variantes (tirage cosmétique au hasard).
  // Câblés dès ce lot : lightFire / stokeFire. Le reste (gatherWood, build, deposit,
  // checkTraps, footsteps) est prêt pour le lot A3.
  sfx: {
    lightFire: "light-fire",
    stokeFire: "stoke-fire",
    gatherWood: "gather-wood",
    build: "build",
    deposit: "craft",
    checkTraps: "check-traps",
    footsteps: ["footsteps-1", "footsteps-2", "footsteps-3", "footsteps-4", "footsteps-5", "footsteps-6"],
  },
} as const;

export type SfxKey = keyof typeof audioManifest.sfx;
