// ============================================================================
//  PHYSIQUE — chargement du plugin Havok (WASM) pour Babylon (§2).
//  Le .wasm est servi depuis public/ (voir scripts/copy-havok-wasm.mjs) et
//  localisé via `locateFile` : robuste en dev ET au build, sans dépendre de la
//  résolution interne de import.meta.url du package.
// ============================================================================

import HavokPhysics from "@babylonjs/havok";
import { HavokPlugin } from "@babylonjs/core";

export async function createHavokPlugin(): Promise<HavokPlugin> {
  const havok = await HavokPhysics({
    locateFile: () => "/HavokPhysics.wasm",
  });
  // 1er argument : utiliser le delta-time du moteur pour le pas physique.
  return new HavokPlugin(true, havok);
}
