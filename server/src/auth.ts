import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomInt } from 'node:crypto';
import { q } from './db.js';
import { config } from './config.js';
import { hashPassword, randomToken, sha256, verifyPassword } from './lib/crypto.js';
import { closeSession } from './lib/live.js';

export type Auth =
  | { kind: 'admin'; userId: number; username: string; sessionId: string; sudoUntil: number }
  | { kind: 'kiosk'; tokenId: number; name: string; canAck: boolean };

declare module 'fastify' {
  interface FastifyRequest { auth?: Auth | null }
}

export const SESSION_COOKIE = 'scyde_session';
/** absolute lifetime of a session */
const SESSION_TTL = 30 * 86400_000;
/** a session that has not been used for this long is dropped */
const SESSION_IDLE = 7 * 86400_000;
/** how long a password re-confirmation ("sudo") lasts */
export const SUDO_TTL = 10 * 60_000;

// ---------------------------------------------------------------- first-run setup
export let setupCode: string | null = null;
let setupFailures = 0;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alikes

function newSetupCode() {
  setupCode = Array.from({ length: 10 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  setupFailures = 0;
  console.log('\n==============================================');
  console.log('  SCYDE Hub — first run');
  console.log(`  Open the web UI and enter this setup code: ${setupCode}`);
  console.log('==============================================\n');
}

export function ensureAdmin() {
  const n = q.get<{ n: number }>('SELECT COUNT(*) n FROM users')!.n;
  if (n > 0) return;
  if (config.adminPassword) {
    if (config.adminPassword.length < 10) throw new Error('SCYDE_ADMIN_PASSWORD must be at least 10 characters');
    q.run('INSERT INTO users (username, password_hash, created_at) VALUES (?,?,?)', config.adminUser, hashPassword(config.adminPassword), Date.now());
    console.log(`[auth] admin "${config.adminUser}" created from SCYDE_ADMIN_PASSWORD`);
    return;
  }
  newSetupCode();
}
export const needsSetup = () => q.get<{ n: number }>('SELECT COUNT(*) n FROM users')!.n === 0;
export const clearSetupCode = () => { setupCode = null; };
/** Wrong code: after 5 failures the code is thrown away and a new one is printed to the server log. */
export function setupCodeFailed() {
  if (++setupFailures >= 5) newSetupCode();
}

// ---------------------------------------------------------------- sessions
export function createSession(userId: number, req: FastifyRequest, reply: FastifyReply) {
  const token = randomToken();
  const now = Date.now();
  q.run('INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip, last_seen) VALUES (?,?,?,?,?,?,?)',
    sha256(token), userId, now, now + SESSION_TTL, String(req.headers['user-agent'] ?? '').slice(0, 200), req.ip, now);
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: config.secureCookies || req.protocol === 'https', maxAge: SESSION_TTL / 1000,
  });
}

export function destroySession(req: FastifyRequest, reply: FastifyReply) {
  if (req.auth?.kind === 'admin') {
    q.run('DELETE FROM sessions WHERE id = ?', req.auth.sessionId);
    closeSession(req.auth.sessionId);
  }
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Kiosk token: `Authorization: Kiosk <token>` for HTTP, WebSocket sub-protocol `kiosk.<token>` for the live socket.
 *  It is never accepted from the URL, so it does not end up in proxy logs or browser history. */
function kioskTokenFromRequest(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (typeof h === 'string' && h.startsWith('Kiosk ')) return h.slice(6).trim();
  const proto = req.headers['sec-websocket-protocol'];
  if (typeof proto === 'string') {
    const p = proto.split(',').map((x) => x.trim()).find((x) => x.startsWith('kiosk.'));
    if (p) return p.slice(6);
  }
  return undefined;
}

export function resolveAuth(req: FastifyRequest): Auth | null {
  const cookie = req.cookies?.[SESSION_COOKIE];
  const now = Date.now();
  if (cookie) {
    const s = q.get<{ id: string; user_id: number; username: string; expires_at: number; sudo_until: number; last_seen: number | null }>(
      'SELECT s.id, s.user_id, s.expires_at, s.sudo_until, s.last_seen, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?', sha256(cookie),
    );
    if (s) {
      if (s.expires_at <= now || (s.last_seen && now - s.last_seen > SESSION_IDLE)) q.run('DELETE FROM sessions WHERE id = ?', s.id);
      else {
        if (!s.last_seen || now - s.last_seen > 60_000) q.run('UPDATE sessions SET last_seen = ? WHERE id = ?', now, s.id);
        return { kind: 'admin', userId: s.user_id, username: s.username, sessionId: s.id, sudoUntil: s.sudo_until };
      }
    }
  }
  const tok = kioskTokenFromRequest(req);
  if (tok && tok.length <= 200) {
    const k = q.get<{ id: number; name: string; can_ack: number; last_used_at: number | null }>(
      'SELECT id, name, can_ack, last_used_at FROM kiosk_tokens WHERE token_hash = ? AND revoked_at IS NULL', sha256(tok));
    if (k) {
      if (!k.last_used_at || now - k.last_used_at > 60_000) q.run('UPDATE kiosk_tokens SET last_used_at = ? WHERE id = ?', now, k.id);
      return { kind: 'kiosk', tokenId: k.id, name: k.name, canAck: !!k.can_ack };
    }
  }
  return null;
}

export async function requireAny(req: FastifyRequest, reply: FastifyReply) {
  if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
}
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
  if (req.auth.kind !== 'admin') return reply.code(403).send({ error: 'forbidden' });
}
/** Sensitive operations need a recent password confirmation, so a stolen/unattended session cannot
 *  export secrets, repoint a service at another host, or stop a VM. */
export async function requireSudo(req: FastifyRequest, reply: FastifyReply) {
  if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
  if (req.auth.kind !== 'admin') return reply.code(403).send({ error: 'forbidden' });
  if (req.auth.sudoUntil < Date.now()) return reply.code(403).send({ error: 'Confirm your password to continue', sudo: true });
}
export function grantSudo(sessionId: string) {
  q.run('UPDATE sessions SET sudo_until = ? WHERE id = ?', Date.now() + SUDO_TTL, sessionId);
}

export const actorOf = (req: FastifyRequest) =>
  req.auth?.kind === 'admin' ? req.auth.username : req.auth?.kind === 'kiosk' ? `kiosk:${req.auth.name}` : 'anonymous';

// ---------------------------------------------------------------- brute-force protection
interface Bucket { n: number; until: number }
const WINDOW = 15 * 60_000;
const byIp = new Map<string, Bucket>();
const byUser = new Map<string, Bucket>();
const hit = (m: Map<string, Bucket>, k: string) => {
  const now = Date.now();
  const b = m.get(k);
  if (!b || b.until < now) m.set(k, { n: 1, until: now + WINDOW });
  else b.n++;
  if (m.size > 10_000) for (const [key, v] of m) if (v.until < now) m.delete(key);
};
const blocked = (m: Map<string, Bucket>, k: string, limit: number) => {
  const b = m.get(k);
  return !!b && b.until > Date.now() && b.n >= limit;
};
/** 5 failures per IP or 10 per account in 15 minutes. The per-account limit also holds when the
 *  attacker rotates IPs (or spoofs them behind a misconfigured proxy). */
export function loginAllowed(ip: string, username = '') {
  if (blocked(byIp, ip, 5)) return false;
  if (!blocked(byUser, username.toLowerCase(), 10)) return true;
  // The account-wide block stops guessing from rotating addresses, but it must not let a stranger lock the
  // owner out: an address that already holds a live session of this account is only subject to its own limit.
  return !!q.get(
    'SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.ip = ? AND lower(u.username) = ? AND s.expires_at > ? LIMIT 1',
    ip, username.toLowerCase(), Date.now(),
  );
}
/** Password re-checks inside a session (sudo, change password, disable 2FA): 5 failures per address or session. */
const bySession = new Map<string, Bucket>();
export const confirmAllowed = (ip: string, sessionId: string) => !blocked(byIp, ip, 5) && !blocked(bySession, sessionId, 5);
export function confirmFailed(ip: string, sessionId: string) {
  hit(byIp, ip);
  hit(bySession, sessionId);
}
export function loginFailed(ip: string, username = '') {
  hit(byIp, ip);
  if (username) hit(byUser, username.toLowerCase());
}
export function loginSucceeded(ip: string, username = '') {
  byIp.delete(ip);
  byUser.delete(username.toLowerCase());
}

/** Generic sliding-window limiter for other endpoints (per IP + route group). */
const windows = new Map<string, number[]>();
export function rateLimit(key: string, max: number, perMs: number): boolean {
  const now = Date.now();
  const arr = (windows.get(key) ?? []).filter((t) => now - t < perMs);
  if (arr.length >= max) { windows.set(key, arr); return false; }
  arr.push(now);
  windows.set(key, arr);
  if (windows.size > 20_000) for (const [k, v] of windows) if (!v.length || now - v[v.length - 1] > perMs) windows.delete(k);
  return true;
}

/** Constant-ish time: always run one scrypt verification, even for unknown users. */
const DUMMY_HASH = hashPassword(randomToken());
export function checkPassword(password: string, stored?: string | null) {
  const ok = verifyPassword(password, stored ?? DUMMY_HASH);
  return !!stored && ok;
}

const REDACT = /pass|secret|token|key|code|authorization|cookie/i;
function redact(v: unknown, depth = 0): unknown {
  if (v === null || typeof v !== 'object' || depth > 4) return typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, REDACT.test(k) ? '•••' : redact(x, depth + 1)]));
}

export function audit(req: FastifyRequest | null, action: string, target: string | null, params: unknown, ok: boolean, result?: string) {
  q.run('INSERT INTO audit_log (ts, actor, action, target, params, ok, result, ip) VALUES (?,?,?,?,?,?,?,?)',
    Date.now(), req ? actorOf(req) : 'system', action, target ? String(target).slice(0, 200) : null,
    params === undefined ? null : JSON.stringify(redact(params)).slice(0, 2000), ok ? 1 : 0, result ? String(result).slice(0, 500) : null, req?.ip ?? null);
}

/** Is a previously authenticated live connection still allowed? (checked periodically on open sockets) */
export function stillValid(a: Auth): boolean {
  if (a.kind === 'admin') {
    const s = q.get<{ expires_at: number }>('SELECT expires_at FROM sessions WHERE id = ?', a.sessionId);
    return !!s && s.expires_at > Date.now();
  }
  return !!q.get('SELECT 1 FROM kiosk_tokens WHERE id = ? AND revoked_at IS NULL', a.tokenId);
}
