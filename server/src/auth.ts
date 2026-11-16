import type { FastifyReply, FastifyRequest } from 'fastify';
import { q } from './db.js';
import { config } from './config.js';
import { hashPassword, randomToken, sha256 } from './lib/crypto.js';

export type Auth =
  | { kind: 'admin'; userId: number; username: string; sessionId: string }
  | { kind: 'kiosk'; tokenId: number; name: string; canAck: boolean };

declare module 'fastify' {
  interface FastifyRequest { auth?: Auth | null }
}

export const SESSION_COOKIE = 'scyde_session';
const SESSION_TTL = 30 * 86400_000;

export let setupCode: string | null = null;

export function ensureAdmin() {
  const n = q.get<{ n: number }>('SELECT COUNT(*) n FROM users')!.n;
  if (n > 0) return;
  if (config.adminPassword) {
    q.run('INSERT INTO users (username, password_hash, created_at) VALUES (?,?,?)', config.adminUser, hashPassword(config.adminPassword), Date.now());
    console.log(`[auth] admin "${config.adminUser}" created from SCYDE_ADMIN_PASSWORD`);
    return;
  }
  setupCode = String(Math.floor(100000 + Math.random() * 900000));
  console.log('\n==============================================');
  console.log(`  SCYDE Hub — prvo pokretanje`);
  console.log(`  Otvori web sučelje i upiši kod: ${setupCode}`);
  console.log('==============================================\n');
}
export const needsSetup = () => q.get<{ n: number }>('SELECT COUNT(*) n FROM users')!.n === 0;
export const clearSetupCode = () => { setupCode = null; };

export function createSession(userId: number, req: FastifyRequest, reply: FastifyReply) {
  const token = randomToken();
  q.run('INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip) VALUES (?,?,?,?,?,?)',
    sha256(token), userId, Date.now(), Date.now() + SESSION_TTL, String(req.headers['user-agent'] ?? '').slice(0, 200), req.ip);
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: config.secureCookies || req.protocol === 'https', maxAge: SESSION_TTL / 1000,
  });
}

export function destroySession(req: FastifyRequest, reply: FastifyReply) {
  if (req.auth?.kind === 'admin') q.run('DELETE FROM sessions WHERE id = ?', req.auth.sessionId);
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

function tokenFromRequest(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith('Kiosk ')) return h.slice(6).trim();
  const qtok = (req.query as any)?.kiosk;
  if (typeof qtok === 'string' && req.url.startsWith('/api/ws')) return qtok;
  return undefined;
}

export function resolveAuth(req: FastifyRequest): Auth | null {
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (cookie) {
    const s = q.get<{ id: string; user_id: number; username: string; expires_at: number }>(
      'SELECT s.id, s.user_id, s.expires_at, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?', sha256(cookie),
    );
    if (s && s.expires_at > Date.now()) {
      // sliding expiry, refreshed at most once a day
      if (s.expires_at - Date.now() < SESSION_TTL - 86400_000) q.run('UPDATE sessions SET expires_at = ? WHERE id = ?', Date.now() + SESSION_TTL, s.id);
      return { kind: 'admin', userId: s.user_id, username: s.username, sessionId: s.id };
    }
  }
  const tok = tokenFromRequest(req);
  if (tok) {
    const k = q.get<{ id: number; name: string; can_ack: number }>('SELECT id, name, can_ack FROM kiosk_tokens WHERE token_hash = ? AND revoked_at IS NULL', sha256(tok));
    if (k) {
      q.run('UPDATE kiosk_tokens SET last_used_at = ? WHERE id = ?', Date.now(), k.id);
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

export const actorOf = (req: FastifyRequest) =>
  req.auth?.kind === 'admin' ? req.auth.username : req.auth?.kind === 'kiosk' ? `kiosk:${req.auth.name}` : 'anonymous';

// --- naive login rate limit (per IP) ---
const attempts = new Map<string, { n: number; until: number }>();
export function loginAllowed(ip: string) {
  const a = attempts.get(ip);
  return !a || a.until < Date.now() || a.n < 5;
}
export function loginFailed(ip: string) {
  const a = attempts.get(ip);
  const now = Date.now();
  if (!a || a.until < now) attempts.set(ip, { n: 1, until: now + 15 * 60_000 });
  else a.n++;
}
export const loginSucceeded = (ip: string) => attempts.delete(ip);

export function audit(req: FastifyRequest | null, action: string, target: string | null, params: unknown, ok: boolean, result?: string) {
  q.run('INSERT INTO audit_log (ts, actor, action, target, params, ok, result, ip) VALUES (?,?,?,?,?,?,?,?)',
    Date.now(), req ? actorOf(req) : 'system', action, target, params === undefined ? null : JSON.stringify(params), ok ? 1 : 0, result ?? null, req?.ip ?? null);
}
