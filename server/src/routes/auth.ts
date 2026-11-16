import type { FastifyInstance, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { q } from '../db.js';
import {
  audit, checkPassword, clearSetupCode, createSession, destroySession, grantSudo, loginAllowed, loginFailed, loginSucceeded,
  needsSetup, rateLimit, requireAdmin, requireSudo, setupCode, setupCodeFailed, SUDO_TTL,
} from '../auth.js';
import { decrypt, encrypt, hashPassword, matchTotp, newRecoveryCode, newTotpSecret, normalizeRecoveryCode, randomToken, sha256 } from '../lib/crypto.js';
import { config } from '../config.js';
import { timingSafeEqual } from 'node:crypto';
import { closeKioskToken, closeUserSessionsExcept } from '../lib/live.js';

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const USERNAME = /^[\w.@-]{1,64}$/;

function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return 'Password must be at least 10 characters';
  if (pw.length > 256) return 'Password is too long';
  if (/^(.)\1+$/.test(pw) || ['password123', '1234567890', 'qwertyuiop'].includes(pw.toLowerCase())) return 'Password is too easy to guess';
  return null;
}

/** Verify the second factor: a TOTP code (never reusable) or a one-time recovery code. */
function secondFactorOk(userId: number, secretEnc: string, lastCounter: number, code: string): boolean {
  const counter = matchTotp(decrypt(secretEnc), code);
  if (counter !== null) {
    if (counter <= lastCounter) return false; // replay of an already used code
    q.run('UPDATE users SET totp_last_counter = ? WHERE id = ?', counter, userId);
    return true;
  }
  const norm = normalizeRecoveryCode(code);
  if (norm.length === 10) {
    const r = q.run('UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL', Date.now(), userId, sha256(norm));
    return Number(r.changes) > 0;
  }
  return false;
}

function issueRecoveryCodes(userId: number): string[] {
  q.run('DELETE FROM recovery_codes WHERE user_id = ?', userId);
  const codes = Array.from({ length: 10 }, newRecoveryCode);
  for (const c of codes) q.run('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)', userId, sha256(normalizeRecoveryCode(c)));
  return codes;
}

export default async function authRoutes(app: FastifyInstance) {
  const limited = (req: FastifyRequest, group: string, max = 20) => rateLimit(`${group}:${req.ip}`, max, 60_000);

  app.get('/api/auth/me', async (req) => {
    const a = req.auth;
    const user = a?.kind === 'admin' ? q.get<{ totp_enabled: number }>('SELECT totp_enabled FROM users WHERE id = ?', a.userId) : undefined;
    return {
      setup: needsSetup(),
      auth: a
        ? a.kind === 'admin'
          ? { kind: 'admin', username: a.username, totp: !!user?.totp_enabled, sudo: a.sudoUntil > Date.now() }
          : { kind: 'kiosk', name: a.name, canAck: a.canAck }
        : null,
      // version details only for signed-in clients
      ...(a ? { version: config.version, buildId: config.buildId, mockAll: config.mockAll } : {}),
    };
  });

  app.post<{ Body: { code: string; username: string; password: string } }>('/api/auth/setup', async (req, reply) => {
    if (!needsSetup()) return reply.code(409).send({ error: 'Already set up' });
    if (!limited(req, 'setup', 10)) return reply.code(429).send({ error: 'Too many attempts, slow down' });
    const code = str(req.body?.code, 32).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const username = str(req.body?.username, 64);
    const password = str(req.body?.password, 300);
    const expected = setupCode ?? '';
    if (!expected || code.length !== expected.length || !timingSafeEqual(Buffer.from(code), Buffer.from(expected))) {
      setupCodeFailed();
      return reply.code(403).send({ error: 'Wrong setup code (see the server log: docker compose logs hub)' });
    }
    if (!USERNAME.test(username)) return reply.code(400).send({ error: 'Username may contain letters, digits, . _ - @' });
    const problem = passwordProblem(password);
    if (problem) return reply.code(400).send({ error: problem });
    const r = q.run('INSERT INTO users (username, password_hash, created_at) VALUES (?,?,?)', username, hashPassword(password), Date.now());
    clearSetupCode();
    createSession(Number(r.lastInsertRowid), req, reply);
    audit(req, 'auth.setup', username, undefined, true);
    return { ok: true };
  });

  app.post<{ Body: { username: string; password: string; code?: string } }>('/api/auth/login', async (req, reply) => {
    const username = str(req.body?.username, 64);
    const password = str(req.body?.password, 300);
    const code = str(req.body?.code, 32);
    if (!loginAllowed(req.ip, username)) {
      audit(req, 'auth.login', username, undefined, false, 'rate limited');
      return reply.code(429).send({ error: 'Too many failed attempts. Try again in 15 minutes.' });
    }
    const u = q.get<{ id: number; password_hash: string; totp_enabled: number; totp_secret: string | null; totp_last_counter: number }>('SELECT * FROM users WHERE username = ?', username);
    if (!checkPassword(password, u?.password_hash) || !u) {
      loginFailed(req.ip, username);
      audit(req, 'auth.login', username, undefined, false, 'bad credentials');
      return reply.code(401).send({ error: 'Wrong username or password' });
    }
    if (u.totp_enabled && u.totp_secret) {
      if (!code) return reply.code(401).send({ error: 'Enter your 2FA code', needTotp: true });
      if (!secondFactorOk(u.id, u.totp_secret, u.totp_last_counter, code)) {
        loginFailed(req.ip, username);
        audit(req, 'auth.login', username, undefined, false, 'bad 2FA code');
        return reply.code(401).send({ error: 'Wrong 2FA code', needTotp: true });
      }
    }
    loginSucceeded(req.ip, username);
    createSession(u.id, req, reply);
    audit(req, 'auth.login', username, undefined, true);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    destroySession(req, reply);
    return { ok: true };
  });

  /** Re-confirm the password for sensitive operations ("sudo mode", 10 minutes). */
  app.post<{ Body: { password: string } }>('/api/auth/sudo', { preHandler: requireAdmin }, async (req, reply) => {
    const a = req.auth as Extract<typeof req.auth, { kind: 'admin' }>;
    if (!loginAllowed(req.ip, a.username)) return reply.code(429).send({ error: 'Too many failed attempts. Try again in 15 minutes.' });
    const u = q.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', a.userId);
    if (!checkPassword(str(req.body?.password, 300), u?.password_hash)) {
      loginFailed(req.ip, a.username);
      audit(req, 'auth.sudo', null, undefined, false, 'bad password');
      return reply.code(401).send({ error: 'Wrong password' });
    }
    grantSudo(a.sessionId);
    audit(req, 'auth.sudo', null, undefined, true);
    return { ok: true, until: Date.now() + SUDO_TTL };
  });

  app.post<{ Body: { current: string; next: string } }>('/api/auth/password', { preHandler: requireAdmin }, async (req, reply) => {
    const a = req.auth as any;
    if (!limited(req, 'pw', 10)) return reply.code(429).send({ error: 'Too many attempts' });
    const u = q.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', a.userId)!;
    if (!checkPassword(str(req.body?.current, 300), u.password_hash)) {
      audit(req, 'auth.password', null, undefined, false, 'bad current password');
      return reply.code(400).send({ error: 'Current password is not correct' });
    }
    const problem = passwordProblem(str(req.body?.next, 300));
    if (problem) return reply.code(400).send({ error: problem });
    q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(req.body.next), a.userId);
    q.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', a.userId, a.sessionId);
    closeUserSessionsExcept(a.userId, a.sessionId);
    audit(req, 'auth.password', null, undefined, true);
    return { ok: true };
  });

  // ---- sessions ----
  app.get('/api/auth/sessions', { preHandler: requireAdmin }, async (req) => {
    const a = req.auth as any;
    return q.all('SELECT id, created_at, last_seen, expires_at, user_agent, ip FROM sessions WHERE user_id = ? ORDER BY last_seen DESC', a.userId)
      .map((s) => ({ ...s, id: String(s.id).slice(0, 12), current: s.id === a.sessionId }));
  });
  app.delete<{ Params: { id: string } }>('/api/auth/sessions/:id', { preHandler: requireAdmin }, async (req) => {
    const a = req.auth as any;
    const prefix = str(req.params.id, 12).replace(/[^a-f0-9]/g, '');
    if (prefix.length === 12) {
      q.run("DELETE FROM sessions WHERE user_id = ? AND id LIKE ? AND id != ?", a.userId, prefix + '%', a.sessionId);
      // live sockets of other sessions are closed; the ones that are still valid simply reconnect
      closeUserSessionsExcept(a.userId, a.sessionId);
    }
    audit(req, 'auth.session.revoke', prefix, undefined, true);
    return { ok: true };
  });
  app.post('/api/auth/sessions/revoke-others', { preHandler: requireAdmin }, async (req) => {
    const a = req.auth as any;
    const r = q.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', a.userId, a.sessionId);
    closeUserSessionsExcept(a.userId, a.sessionId);
    audit(req, 'auth.session.revoke-others', null, undefined, true);
    return { ok: true, revoked: Number(r.changes) };
  });

  // ---- 2FA ----
  app.post('/api/auth/totp/begin', { preHandler: requireSudo }, async (req, reply) => {
    const a = req.auth as any;
    const cur = q.get<{ totp_enabled: number }>('SELECT totp_enabled FROM users WHERE id = ?', a.userId)!;
    if (cur.totp_enabled) return reply.code(409).send({ error: '2FA is already enabled' });
    const secret = newTotpSecret();
    q.run('UPDATE users SET totp_secret = ?, totp_enabled = 0, totp_last_counter = 0 WHERE id = ?', encrypt(secret), a.userId);
    const uri = `otpauth://totp/SCYDE%20Hub:${encodeURIComponent(a.username)}?secret=${secret}&issuer=SCYDE%20Hub&algorithm=SHA1&digits=6&period=30`;
    return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) };
  });
  app.post<{ Body: { code: string } }>('/api/auth/totp/enable', { preHandler: requireAdmin }, async (req, reply) => {
    const a = req.auth as any;
    if (!limited(req, 'totp', 10)) return reply.code(429).send({ error: 'Too many attempts' });
    const u = q.get<{ totp_secret: string | null; totp_enabled: number }>('SELECT totp_secret, totp_enabled FROM users WHERE id = ?', a.userId)!;
    if (u.totp_enabled) return reply.code(409).send({ error: '2FA is already enabled' });
    const counter = u.totp_secret ? matchTotp(decrypt(u.totp_secret), str(req.body?.code, 16)) : null;
    if (counter === null) return reply.code(400).send({ error: 'That code is not valid' });
    q.run('UPDATE users SET totp_enabled = 1, totp_last_counter = ? WHERE id = ?', counter, a.userId);
    const recoveryCodes = issueRecoveryCodes(a.userId);
    q.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', a.userId, a.sessionId);
    closeUserSessionsExcept(a.userId, a.sessionId);
    audit(req, 'auth.totp.enable', null, undefined, true);
    return { ok: true, recoveryCodes };
  });
  app.post('/api/auth/totp/recovery-codes', { preHandler: requireSudo }, async (req, reply) => {
    const a = req.auth as any;
    const u = q.get<{ totp_enabled: number }>('SELECT totp_enabled FROM users WHERE id = ?', a.userId)!;
    if (!u.totp_enabled) return reply.code(400).send({ error: 'Enable 2FA first' });
    audit(req, 'auth.totp.recovery-codes', null, undefined, true);
    return { recoveryCodes: issueRecoveryCodes(a.userId) };
  });
  app.post<{ Body: { password: string; code: string } }>('/api/auth/totp/disable', { preHandler: requireAdmin }, async (req, reply) => {
    const a = req.auth as any;
    if (!limited(req, 'totp', 10)) return reply.code(429).send({ error: 'Too many attempts' });
    const u = q.get<{ password_hash: string; totp_secret: string | null; totp_last_counter: number; totp_enabled: number }>('SELECT * FROM users WHERE id = ?', a.userId)!;
    if (!checkPassword(str(req.body?.password, 300), u.password_hash)) return reply.code(400).send({ error: 'Wrong password' });
    if (u.totp_enabled && u.totp_secret && !secondFactorOk(a.userId, u.totp_secret, u.totp_last_counter, str(req.body?.code, 32)))
      return reply.code(400).send({ error: 'Enter a current 2FA or recovery code' });
    q.run('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_counter = 0 WHERE id = ?', a.userId);
    q.run('DELETE FROM recovery_codes WHERE user_id = ?', a.userId);
    audit(req, 'auth.totp.disable', null, undefined, true);
    return { ok: true };
  });

  // ---- kiosk tokens ----
  app.get('/api/kiosk-tokens', { preHandler: requireAdmin }, async () =>
    q.all('SELECT id, name, can_ack, created_at, last_used_at, revoked_at FROM kiosk_tokens ORDER BY created_at DESC'));
  app.post<{ Body: { name: string; canAck?: boolean } }>('/api/kiosk-tokens', { preHandler: requireSudo }, async (req) => {
    const token = 'sk_' + randomToken(32);
    const name = str(req.body?.name, 80) || 'Kiosk';
    q.run('INSERT INTO kiosk_tokens (name, token_hash, can_ack, created_at) VALUES (?,?,?,?)', name, sha256(token), req.body?.canAck === false ? 0 : 1, Date.now());
    audit(req, 'kiosk.token.create', name, undefined, true);
    return { token };
  });
  app.delete<{ Params: { id: string } }>('/api/kiosk-tokens/:id', { preHandler: requireAdmin }, async (req) => {
    q.run('UPDATE kiosk_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', Date.now(), Number(req.params.id) || 0);
    closeKioskToken(Number(req.params.id) || 0);
    audit(req, 'kiosk.token.revoke', req.params.id, undefined, true);
    return { ok: true };
  });
}
