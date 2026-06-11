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

/**
 * Réaction à un état reçu en tenant compte de l'ÉPOQUE (terme d'autorité, façon Raft-lite).
 * L'époque la plus HAUTE fait toujours autorité ; à époque ÉGALE, on retombe sur la règle historique
 * `resolveHostOnSync` (hôte fixé / split-brain par id). Évite qu'un ancien hôte revenu après un
 * silence (époque plus basse) n'écrase l'autorité reprise par failover (`shouldTakeOver`).
 */
export function resolveSync(
  selfId: string,
  selfForced: boolean,
  selfEpoch: number,
  senderId: string,
  senderForced: boolean,
  senderEpoch: number,
): HostDecision {
  if (senderEpoch > selfEpoch) return selfForced ? "yield" : "defer"; // terme plus récent : il gagne
  if (senderEpoch < selfEpoch) return "ignore"; // autorité périmée (avant notre reprise)
  return resolveHostOnSync(selfId, selfForced, senderId, senderForced); // égalité -> règle historique
}

/**
 * Doit-on PRENDRE LA MAIN comme autorité parce que l'hôte annoncé s'est tu (onglet en arrière-plan,
 * réseau coupé sans `onPeerLeave`) ? Déclenché après `timeoutMs` sans état reçu. Le plus petit id
 * parmi les pairs VIVANTS — l'hôte silencieux EXCLU — reprend, décision IDENTIQUE chez tous (pas de
 * coordination). N'agit que si l'on connaît déjà un hôte (sinon : bootstrap par id, pas failover). PURE.
 */
export function shouldTakeOver(
  selfId: string,
  livePeers: readonly string[],
  silentHostId: string | null,
  msSinceHostSync: number,
  timeoutMs: number,
): boolean {
  if (silentHostId === null) return false; // jamais entendu d'hôte établi -> pas de failover
  if (msSinceHostSync < timeoutMs) return false;
  const candidates = [selfId, ...livePeers].filter((id) => id !== silentHostId);
  if (candidates.length === 0) return false;
  candidates.sort();
  return candidates[0] === selfId; // le plus petit id vivant reprend
}
