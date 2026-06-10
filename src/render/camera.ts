// ============================================================================
//  CAMÉRA — suivi 3e personne (§6). ArcRotateCamera : orbite autour du joueur.
//  L'orientation/zoom sont pilotés par la CAPTURE DE POINTEUR (input/pointerLook.ts) :
//  on règle alpha/beta/radius directement, sans attachControl (pas de clic-glisser).
//  Le suivi mute `target` EN PLACE dans la boucle (main.ts), ce qui préserve l'orbite.
// ============================================================================

import { Scene, ArcRotateCamera, Vector3 } from "@babylonjs/core";

export function createCamera(scene: Scene, _canvas: HTMLCanvasElement): ArcRotateCamera {
  const camera = new ArcRotateCamera(
    "thirdPerson",
    -Math.PI / 2, // alpha : derrière le joueur
    1.05, // beta : légèrement en hauteur
    9, // radius : distance
    new Vector3(0, 1, 0),
    scene,
  );

  camera.lowerRadiusLimit = 5;
  camera.upperRadiusLimit = 14;
  camera.lowerBetaLimit = 0.35;
  camera.upperBetaLimit = 1.45; // ne pas passer sous le sol

  // Pas d'attachControl : l'orbite vient du pointer lock (alpha/beta) et la molette (radius).
  return camera;
}

/** Yaw horizontal du regard de la caméra (repère "avant" pour le déplacement). */
export function cameraYaw(camera: ArcRotateCamera): number {
  const dir = camera.getDirection(Vector3.Forward());
  return Math.atan2(dir.x, dir.z);
}
