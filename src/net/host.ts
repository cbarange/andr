// ============================================================================
//  ÉLECTION D'HÔTE — décision PURE (testable, sans dépendance Trystero/DOM).
//  Appelée à chaque réception d'un état (`stateSync`) pour savoir comment réagir.
// ============================================================================

/** Que faire quand on reçoit un état diffusé par `senderId` ? */
export type HostDecision =
  | "defer" // je ne suis pas l'hôte fixé : je m'aligne sur l'émetteur (et j'adopte son état)
  | "ignore" // je suis l'hôte fixé et l'émetteur n'a pas priorité : je garde l'autorité, j'ignore
  | "yield"; // collision de deux hôtes « ouverts » : le plus petit id gagne -> je cède

/**
 * - Pas hôte fixé -> `defer` (comportement historique : l'émetteur qui diffuse fait foi).
 * - Hôte fixé + émetteur AUSSI fixé avec un id PLUS PETIT -> `yield` (split-brain résolu, plus petit gagne).
 * - Hôte fixé sinon -> `ignore` (un invité non-fixé ne me détrône pas, même au boot).
 */
export function resolveHostOnSync(
  selfId: string,
  forced: boolean,
  senderId: string,
  senderForced: boolean,
): HostDecision {
  if (!forced) return "defer";
  if (senderForced && senderId < selfId) return "yield";
  return "ignore";
}
