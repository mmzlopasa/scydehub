import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { q } from '../db.js';
import { audit, clearSetupCode, createSession, destroySession, loginAllowed, loginFailed, loginSucceeded, needsSetup, requireAdmin, setupCode } from '../auth.js';
import { hashPassword, newTotpSecret, randomToken, sha256, verifyPassword, verifyTotp, encrypt, decrypt } from '../lib/crypto.js';
import { config } from '../config.js';

export default async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/me', async (req) => {
    const a = req.auth;
    const user = a?.kind === 'admin' ? q.get<{ totp_enabled: number }>('SELECT totp_enabled FROM users WHERE id = ?', a.userId) : undefined;
    return {
      setup: needsSetup(),
      auth: a ? (a.kind === 'admin' ? { kind: 'admin', username: a.username, totp: !!user?.totp_enabled } : { kind: 'kiosk', name: a.name, canAck: a.canAck }) : null,
      version: config.version,
      buildId: config.buildId,
      mockAll: config.mockAll,
    };
  });

  app.post<{ Body: { code: string; username: string; password: string } }>('/api/auth/setup', async (req, reply) => {
    if (!needsSetup()) return reply.code(409).send({ error: 'Već postavljeno' });
    const { code, username, password } = req.body ?? ({} as any);
    if (!setupCode || code !== setupCode) return reply.code(403).send({ error: 'Pogrešan kod za postavljanje (vidi logove servera)' });
    if (!username || !password || password.length < 10) return reply.code(400).send({ error: 'Lozinka mora imati barem 10 znakova' });
    const r = q.run('INSERT INTO users (username, password_hash, created_at) VALUES (?,?,?)', username, hashPassword(password), Date.now());
    clearSetupCode();
    createSession(Number(r.lastInsertRowid), req, reply);
    audit(req, 'auth.setup', username, undefined, true);
    return { ok: true };
  });

  app.post<{ Body: { username: string; password: string; code?: string } }>('/api/auth/login', async (req, reply) => {
    if (!loginAllowed(req.ip)) return reply.code(429).send({ error: 'Previše pokušaja, pokušaj za 15 minuta' });
    const { username, password, code } = req.body ?? ({} as any);
    const u = q.get<{ id: number; password_hash: string; totp_enabled: number; totp_secret: string | null }>('SELECT * FROM users WHERE username = ?', String(username ?? ''));
    if (!u || !verifyPassword(String(password ?? ''), u.password_hash)) {
      loginFailed(req.ip);
      audit(req, 'auth.login', String(username), undefined, false, 'bad credentials');
      return reply.code(401).send({ error: 'Pogrešno korisničko ime ili lozinka' });
    }
    if (u.totp_enabled && u.totp_secret) {
      if (!code) return reply.code(401).send({ error: 'Potreban 2FA kod', needTotp: true });
      if (!verifyTotp(decrypt(u.totp_secret), code)) {
        loginFailed(req.ip);
        return reply.code(401).send({ error: 'Pogrešan 2FA kod', needTotp: true });
      }
    }
    loginSucceeded(req.ip);
    createSession(u.id, req, reply);
    audit(req, 'auth.login', String(username), undefined, true);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    destroySession(req, reply);
    return { ok: true };
  });

  app.post<{ Body: { current: string; next: string } }>('/api/auth/password', { preHandler: requireAdmin }, async (req, reply) => {
    const a = req.auth as any;
    const u = q.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', a.userId)!;
    if (!verifyPassword(req.body.current ?? '', u.password_hash)) return reply.code(400).send({ error: 'Trenutna lozinka nije točna' });
    if ((req.body.next ?? '').length < 10) return reply.code(400).send({ error: 'Lozinka mora imati barem 10 znakova' });
    q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(req.body.next), a.userId);
    q.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', a.userId, a.sessionId);
    audit(req, 'auth.password', null, undefined, true);
    return { ok: true };
  });

  // ---- 2FA ----
  app.post('/api/auth/totp/begin', { preHandler: requireAdmin }, async (req) => {
    const a = req.auth as any;
    const secret = newTotpSecret();
    q.run('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?', encrypt(secret), a.userId);
    const uri = `otpauth://totp/SCYDE%20Hub:${encodeURIComponent(a.username)}?secret=${secret}&issuer=SCYDE%20Hub&algorithm=SHA1&digits=6&period=30`;
    return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) };
  });
  app.post<{ Body: { code: string } }>('/api/auth/totp/enable', { preHandler: requireAdmin }, async (req, reply) => {
    const a = req.auth as any;
    const u = q.get<{ totp_secret: string | null }>('SELECT totp_secret FROM users WHERE id = ?', a.userId)!;
    if (!u.totp_secret || !verifyTotp(decrypt(u.totp_secret), req.body.code ?? '')) return reply.code(400).send({ error: 'Kod nije ispravan' });
    q.run('UPDATE users SET totp_enabled = 1 WHERE id = ?', a.userId);
    audit(req, 'auth.totp.enable', null, undefined, true);
    return { ok: true };
  });
  app.post<{ Body: { password: string } }>('/api/auth/totp/disable', { preHandler: requireAdmin }, async (req, reply) => {
    const a = req.auth as any;
    const u = q.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', a.userId)!;
    if (!verifyPassword(req.body.password ?? '', u.password_hash)) return reply.code(400).send({ error: 'Lozinka nije točna' });
    q.run('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', a.userId);
    audit(req, 'auth.totp.disable', null, undefined, true);
    return { ok: true };
  });

  // ---- kiosk tokens ----
  app.get('/api/kiosk-tokens', { preHandler: requireAdmin }, async () =>
    q.all('SELECT id, name, can_ack, created_at, last_used_at, revoked_at FROM kiosk_tokens ORDER BY created_at DESC'));
  app.post<{ Body: { name: string; canAck?: boolean } }>('/api/kiosk-tokens', { preHandler: requireAdmin }, async (req) => {
    const token = 'sk_' + randomToken(24);
    q.run('INSERT INTO kiosk_tokens (name, token_hash, can_ack, created_at) VALUES (?,?,?,?)', req.body.name || 'Kiosk', sha256(token), req.body.canAck === false ? 0 : 1, Date.now());
    audit(req, 'kiosk.token.create', req.body.name, undefined, true);
    return { token };
  });
  app.delete<{ Params: { id: string } }>('/api/kiosk-tokens/:id', { preHandler: requireAdmin }, async (req) => {
    q.run('UPDATE kiosk_tokens SET revoked_at = ? WHERE id = ?', Date.now(), Number(req.params.id));
    audit(req, 'kiosk.token.revoke', req.params.id, undefined, true);
    return { ok: true };
  });
}
