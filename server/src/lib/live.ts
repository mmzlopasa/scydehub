/** Registry of live (WebSocket / SSE) clients, so access can be cut the moment a session or token is revoked. */
export interface LiveClient {
  kind: 'admin' | 'kiosk';
  /** admin: session id, kiosk: token id */
  key: string;
  userId?: number;
  close: (reason: string) => void;
}
const clients = new Set<LiveClient>();
export const MAX_CLIENTS = 300;
export const MAX_PER_KEY = 25;

export function addClient(c: LiveClient): boolean {
  if (clients.size >= MAX_CLIENTS) return false;
  let same = 0;
  for (const x of clients) if (x.kind === c.kind && x.key === c.key) same++;
  if (same >= MAX_PER_KEY) return false;
  clients.add(c);
  return true;
}
export const removeClient = (c: LiveClient) => clients.delete(c);

function closeWhere(pred: (c: LiveClient) => boolean, reason: string) {
  for (const c of [...clients]) {
    if (!pred(c)) continue;
    clients.delete(c);
    try { c.close(reason); } catch { /* already gone */ }
  }
}
export const closeSession = (sessionId: string) => closeWhere((c) => c.kind === 'admin' && c.key === sessionId, 'session ended');
export const closeUserSessionsExcept = (userId: number, keepSessionId?: string) =>
  closeWhere((c) => c.kind === 'admin' && c.userId === userId && c.key !== keepSessionId, 'session ended');
export const closeKioskToken = (tokenId: number) => closeWhere((c) => c.kind === 'kiosk' && c.key === String(tokenId), 'token revoked');
