import type { FastifyInstance } from 'fastify';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetch } from 'undici';
import { db, q, json, setSetting } from '../db.js';
import { audit, actorOf, rateLimit, requireAdmin, requireAny, requireSudo } from '../auth.js';
import { bus } from '../lib/bus.js';
import { randomId } from '../lib/crypto.js';
import { querySeries, listSeries } from '../lib/history.js';
import { config } from '../config.js';
import { plugins, getPlugin, pluginMeta } from '../plugins/registry.js';
import { collectOnce, contextFor, getStates, isMock, reschedule, resetCollector } from '../collector.js';
import { InputError, createInstance, getInstance, listInstances, prepareConfig, publicConfig, updateInstance, upgradeInstanceSecrets, type InstanceRow } from '../instances.js';
import { getCheckStates, rescheduleCheck, resetChecks, runCheck, uptimeBars, type CheckRow } from '../monitoring/checks.js';
import { ackIncident, type Incident } from '../alerts/engine.js';
import { channelTypes, encodeChannelConfig, getChannelType, publicChannel, testChannel, upgradeChannelSecrets, type ChannelRow } from '../alerts/channels.js';
import { allSettings, kioskSettings, publicBranding, updateSettings, DEFAULT_SETTINGS } from '../settings.js';
import { seedDemo } from '../demo.js';
import { BUILT_IN, exportTemplate, importTemplate, parseTemplate, type Template } from '../templates.js';

type AnyBody = Record<string, any>;

// ------------------------------------------------------------------ input helpers
const bad = (msg: string): never => { throw new InputError(msg); };
const obj = (v: unknown): AnyBody => (v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyBody) : bad('Request body must be an object'));
const text = (v: unknown, max: number, fallback?: string): string =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback !== undefined ? fallback : bad('Missing text value');
const optText = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback?: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback !== undefined ? fallback : bad(`Value must be one of: ${allowed.join(', ')}`);
const int = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const smallJson = (v: unknown, maxBytes: number, what: string): string => {
  const s = JSON.stringify(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return s.length <= maxBytes ? s : bad(`${what} is too large`);
};
const ID = /^[a-f0-9]{16}$/;
const idOf = (v: unknown) => (typeof v === 'string' && ID.test(v) ? v : bad('Invalid id'));

const CHECK_TYPES = ['ping', 'tcp', 'http', 'ssl', 'dns'] as const;
const CHECK_OPTION_KEYS = ['mock', 'timeoutSec', 'timeoutMs', 'port', 'expectStatus', 'keyword', 'invertKeyword', 'insecure', 'method', 'warnDays', 'server', 'recordType', 'expect'];
const RULE_TYPES = ['instance_down', 'check_down', 'metric', 'cert_expiry', 'plugin_alert'] as const;
const SEVERITIES = ['info', 'warning', 'critical'] as const;
const PROFILES = ['desktop', 'tv', 'tablet', 'mobile'] as const;
const SIZES = ['S', 'M', 'L', 'XL'] as const;

function publicInstance(r: InstanceRow) {
  return { ...r, enabled: !!r.enabled, mock: !!r.mock, effectiveMock: isMock(r), config: publicConfig(r), display: json(r.display, {}) };
}

function openAndRecentIncidents() {
  return q.all<Incident>('SELECT * FROM incidents WHERE resolved_at IS NULL OR resolved_at > ? ORDER BY started_at DESC LIMIT 100', Date.now() - 7 * 86400_000);
}

function boardsWithWidgets() {
  const boards = q.all('SELECT * FROM boards ORDER BY sort, created_at');
  const widgets = q.all('SELECT * FROM widgets ORDER BY created_at');
  const layouts = q.all('SELECT * FROM layouts');
  return boards.map((b) => ({
    ...b,
    in_rotation: !!b.in_rotation,
    options: json(b.options, {}),
    widgets: widgets.filter((w) => w.board_id === b.id).map((w) => ({ ...w, options: json(w.options, {}) })),
    layouts: Object.fromEntries(layouts.filter((l) => l.board_id === b.id).map((l) => [l.profile, json(l.layout, [])])),
  }));
}

const changed = (scope: string) => bus.publish({ type: 'config', scope });

function checkArgs(b: AnyBody, prev?: CheckRow) {
  const type = oneOf(b.type ?? prev?.type, CHECK_TYPES);
  const options = b.options === undefined && prev ? json<AnyBody>(prev.options, {}) : obj(b.options ?? {});
  const clean = Object.fromEntries(Object.entries(options).filter(([k, v]) => CHECK_OPTION_KEYS.includes(k) && ['string', 'number', 'boolean'].includes(typeof v))
    .map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 500) : v]));
  const instanceId = b.instance_id === undefined ? prev?.instance_id ?? null : b.instance_id ? idOf(b.instance_id) : null;
  if (instanceId && !getInstance(instanceId)) bad('Unknown service');
  return [
    text(b.name ?? prev?.name, 80), type, text(b.target ?? prev?.target, 500), JSON.stringify(clean),
    int(b.interval_sec ?? prev?.interval_sec, 10, 86_400, 60), b.enabled === undefined ? prev?.enabled ?? 1 : b.enabled ? 1 : 0, instanceId,
  ] as const;
}

function ruleArgs(b: AnyBody, prev?: AnyBody) {
  const channels = Array.isArray(b.channels) ? b.channels.filter((c: unknown) => typeof c === 'string' && ID.test(c)).slice(0, 50) : json(prev?.channels, []);
  return [
    text(b.name ?? prev?.name, 100), oneOf(b.type ?? prev?.type, RULE_TYPES),
    b.target === undefined && prev ? prev.target : smallJson(b.target, 4000, 'target'),
    oneOf(b.severity ?? prev?.severity, SEVERITIES, 'critical'), int(b.duration_sec ?? prev?.duration_sec, 0, 86_400, 120),
    JSON.stringify(channels), b.enabled === undefined ? prev?.enabled ?? 1 : b.enabled ? 1 : 0,
  ] as const;
}

function cleanLayout(v: unknown) {
  if (!Array.isArray(v) || v.length > 1000) return bad('layout must be an array');
  return v.map((it) => {
    const o = obj(it);
    if (typeof o.i !== 'string' || !ID.test(o.i)) bad('layout item without a valid id');
    return { i: o.i as string, x: int(o.x, 0, 200, 0), y: int(o.y, 0, 100_000, 0), w: int(o.w, 1, 200, 4), h: int(o.h, 1, 1000, 4) };
  });
}

const weatherCache = new Map<string, { at: number; body: unknown }>();

export default async function apiRoutes(app: FastifyInstance) {
  // ---------- public (login page) ----------
  app.get('/api/branding', async () => publicBranding());

  // ---------- read-only (admin or kiosk) ----------
  app.get('/api/state', { preHandler: requireAny }, async () => ({
    instances: getStates(),
    checks: getCheckStates(),
    incidents: openAndRecentIncidents(),
    time: Date.now(),
  }));
  app.get('/api/plugins', { preHandler: requireAny }, async () => plugins.map(pluginMeta));
  app.get('/api/instances', { preHandler: requireAny }, async (req) =>
    listInstances().map((r) => (req.auth?.kind === 'admin' ? publicInstance(r)
      : { id: r.id, plugin: r.plugin, name: r.name, enabled: !!r.enabled, mock: !!r.mock, display: json(r.display, {}) })));
  app.get('/api/boards', { preHandler: requireAny }, async () => boardsWithWidgets());
  app.get('/api/settings', { preHandler: requireAny }, async (req) => (req.auth?.kind === 'admin' ? allSettings() : kioskSettings()));
  app.get<{ Params: { id: string }; Querystring: { hours?: string } }>('/api/checks/:id/bars', { preHandler: requireAny }, async (req) =>
    uptimeBars(idOf(req.params.id), int(req.query.hours, 1, 24 * 90, 48)));
  app.get<{ Querystring: { series: string; from?: string; to?: string; points?: string } }>('/api/history', { preHandler: requireAny }, async (req) => {
    const to = Number(req.query.to) || Date.now();
    const from = Number(req.query.from) || to - 6 * 3600_000;
    const series = String(req.query.series ?? '').split(',').filter((s) => /^[\w:.-]{1,120}$/.test(s)).slice(0, 12);
    return Object.fromEntries(series.map((s) => [s, querySeries(s, from, to, int(req.query.points, 10, 1000, 300))]));
  });
  app.get('/api/incidents', { preHandler: requireAny }, async () => q.all('SELECT * FROM incidents ORDER BY started_at DESC LIMIT 500'));
  app.post<{ Params: { id: string } }>('/api/incidents/:id/ack', { preHandler: requireAny }, async (req, reply) => {
    if (req.auth?.kind === 'kiosk' && !req.auth.canAck) return reply.code(403).send({ error: 'This kiosk token may not acknowledge incidents' });
    const inc = ackIncident(int(req.params.id, 0, 2 ** 31, 0), actorOf(req));
    if (!inc) return reply.code(404).send({ error: 'not found' });
    audit(req, 'incident.ack', req.params.id, undefined, true);
    return inc;
  });

  /** Weather through the Hub: clients never talk to a third party and the CSP can stay same-origin only. */
  app.get<{ Querystring: { lat?: string; lon?: string } }>('/api/weather', { preHandler: requireAny }, async (req, reply) => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return reply.code(400).send({ error: 'bad coordinates' });
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const hit = weatherCache.get(key);
    if (hit && Date.now() - hit.at < 15 * 60_000) return hit.body;
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=5`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = await r.json();
      if (weatherCache.size > 50) weatherCache.clear();
      weatherCache.set(key, { at: Date.now(), body });
      return body;
    } catch {
      return hit?.body ?? reply.code(502).send({ error: 'weather unavailable' });
    }
  });

  // ---------- icons (cached proxy of dashboard-icons) ----------
  const iconDir = join(config.dataDir, 'icons');
  if (!existsSync(iconDir)) mkdirSync(iconDir, { recursive: true });
  const misses = new Map<string, number>();
  app.get<{ Params: { slug: string } }>('/api/icons/:slug', { preHandler: requireAny }, async (req, reply) => {
    const slug = req.params.slug.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64);
    // SVGs come from a third-party CDN: serve them inert (no scripts, no network) even if opened directly
    reply.header('content-security-policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'").header('cache-control', 'private, max-age=604800');
    if (!slug) return reply.code(404).send();
    for (const [ext, type] of [['svg', 'image/svg+xml'], ['png', 'image/png']] as const) {
      const f = join(iconDir, `${slug}.${ext}`);
      if (existsSync(f)) return reply.type(type).send(readFileSync(f));
    }
    if ((misses.get(slug) ?? 0) > Date.now()) return reply.code(404).send();
    for (const [ext, type] of [['svg', 'image/svg+xml'], ['png', 'image/png']] as const) {
      try {
        const r = await fetch(`${config.iconCdn}/${ext}/${slug}.${ext}`, { signal: AbortSignal.timeout(6000) });
        if (r.ok && Number(r.headers.get('content-length') ?? 0) < 1_000_000) {
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length < 1_000_000) {
            writeFileSync(join(iconDir, `${slug}.${ext}`), buf);
            return reply.type(type).send(buf);
          }
        }
      } catch { /* offline */ }
    }
    if (misses.size > 5000) misses.clear();
    misses.set(slug, Date.now() + 3600_000);
    return reply.code(404).send();
  });

  // ---------- admin ----------
  app.get('/api/checks', { preHandler: requireAdmin }, async () =>
    q.all<CheckRow>('SELECT * FROM checks ORDER BY sort, name').map((c) => ({ ...c, enabled: !!c.enabled, options: json(c.options, {}) })));

  app.put<{ Body: AnyBody }>('/api/settings', { preHandler: requireAdmin }, async (req, reply) => {
    const body = obj(req.body);
    // where the Hub phones home / what it calls itself in notifications → confirm the password first
    if (('heartbeat' in body || 'publicUrl' in body) && (req.auth as any).sudoUntil < Date.now())
      return reply.code(403).send({ error: 'Confirm your password to continue', sudo: true });
    delete body.maintenanceUntil;
    const keys = updateSettings(body);
    if (keys.length) {
      audit(req, 'settings.update', null, keys, true);
      changed('settings');
    }
    return allSettings();
  });
  app.post('/api/settings/reset-appearance', { preHandler: requireAdmin }, async (req) => {
    for (const k of ['branding', 'appearance', 'layout', 'header', 'regional'] as const) setSetting(k, DEFAULT_SETTINGS[k]);
    audit(req, 'settings.reset-appearance', null, undefined, true);
    changed('settings');
    return allSettings();
  });

  // instances — anything that decides where stored credentials are sent needs a recent password confirmation
  app.post<{ Body: AnyBody }>('/api/instances', { preHandler: requireSudo }, async (req) => {
    const row = createInstance(obj(req.body) as any);
    reschedule(row.id);
    audit(req, 'instance.create', row.id, { plugin: row.plugin, name: row.name }, true);
    changed('instances');
    return publicInstance(row);
  });
  app.patch<{ Params: { id: string }; Body: AnyBody }>('/api/instances/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const body = obj(req.body);
    if (body.config !== undefined && (req.auth as any).sudoUntil < Date.now())
      return reply.code(403).send({ error: 'Confirm your password to continue', sudo: true });
    const row = updateInstance(idOf(req.params.id), body);
    if (!row) return reply.code(404).send({ error: 'not found' });
    reschedule(row.id);
    audit(req, 'instance.update', row.id, { name: row.name, fields: Object.keys(body) }, true);
    changed('instances');
    return publicInstance(row);
  });
  app.delete<{ Params: { id: string } }>('/api/instances/:id', { preHandler: requireAdmin }, async (req) => {
    const id = idOf(req.params.id);
    q.run('DELETE FROM instances WHERE id = ?', id);
    q.run("DELETE FROM metrics WHERE series LIKE ?", `inst:${id}:%`);
    reschedule(id);
    audit(req, 'instance.delete', id, undefined, true);
    changed('instances');
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/api/instances/:id/refresh', { preHandler: requireAdmin }, async (req, reply) => {
    if (!rateLimit(`refresh:${req.ip}`, 30, 60_000)) return reply.code(429).send({ error: 'Slow down' });
    return (await collectOnce(idOf(req.params.id))) ?? reply.code(404).send({ error: 'not found' });
  });
  /** Test a config without saving it */
  app.post<{ Body: { plugin: string; config: Record<string, any>; id?: string } }>('/api/instances/test', { preHandler: requireSudo }, async (req, reply) => {
    const body = obj(req.body);
    const p = getPlugin(String(body.plugin));
    if (!p) return reply.code(400).send({ error: 'Unknown plugin' });
    const existing = body.id ? getInstance(idOf(body.id)) : undefined;
    if (existing && existing.plugin !== p.id) return reply.code(400).send({ error: 'Plugin mismatch' });
    // same id as the stored instance so its (instance-bound) secrets can be decrypted; prepareConfig refuses
    // to reuse stored secrets when the URL points somewhere else
    const id = existing?.id ?? randomId();
    const fake: InstanceRow = { id, plugin: p.id, name: 'test', config: prepareConfig(p.id, id, obj(body.config), existing), interval_sec: 60, enabled: 1, mock: 0, sort: 0, created_at: 0 };
    const started = performance.now();
    try {
      const r = await Promise.race([p.collect(contextFor(fake, true)), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout after 25s')), 25_000))]);
      audit(req, 'instance.test', existing?.id ?? p.id, undefined, true);
      return { ok: true, status: r.status, summary: r.summary, ms: Math.round(performance.now() - started) };
    } catch (e: any) {
      return { ok: false, error: e?.cause?.message ? `${e.message}: ${e.cause.message}` : String(e?.message ?? e) };
    }
  });

  // actions (shared confirm + audit framework); destructive ones also need a recent password confirmation
  app.post<{ Params: { id: string; action: string }; Body: { params?: Record<string, any>; confirm?: boolean } }>(
    '/api/instances/:id/actions/:action', { preHandler: requireAdmin }, async (req, reply) => {
      const row = getInstance(idOf(req.params.id));
      if (!row) return reply.code(404).send({ error: 'not found' });
      const plugin = getPlugin(row.plugin)!;
      const action = plugin.actions?.find((a) => a.id === req.params.action);
      if (!action) return reply.code(404).send({ error: 'Unknown action' });
      if (req.body?.confirm !== true) return reply.code(400).send({ error: 'The action must be confirmed' });
      if (action.danger && (req.auth as any).sudoUntil < Date.now()) return reply.code(403).send({ error: 'Confirm your password to continue', sudo: true });
      if (!rateLimit(`action:${req.ip}`, 30, 60_000)) return reply.code(429).send({ error: 'Too many actions, slow down' });
      const raw = obj(req.body.params ?? {});
      // only declared parameters, scalars only
      const params = Object.fromEntries((action.params ?? []).filter((f) => raw[f.key] !== undefined && ['string', 'number', 'boolean'].includes(typeof raw[f.key]))
        .map((f) => [f.key, typeof raw[f.key] === 'string' ? String(raw[f.key]).slice(0, 300) : raw[f.key]]));
      const ctx = contextFor(row);
      try {
        const msg = isMock(row) ? (action.mock?.(ctx, params) ?? `${action.label} (mock) done`) : await action.run(ctx, params);
        audit(req, `action.${plugin.id}.${action.id}`, `${row.name} (${row.id})`, params, true, msg || 'ok');
        setTimeout(() => void collectOnce(row.id).catch(() => {}), 1500);
        return { ok: true, message: msg || `${action.label}: done` };
      } catch (e: any) {
        const m = String(e?.message ?? e).slice(0, 300);
        audit(req, `action.${plugin.id}.${action.id}`, `${row.name} (${row.id})`, params, false, m);
        return reply.code(502).send({ error: m });
      }
    });

  // checks
  app.post<{ Body: AnyBody }>('/api/checks', { preHandler: requireAdmin }, async (req) => {
    const id = randomId();
    q.run('INSERT INTO checks (name, type, target, options, interval_sec, enabled, instance_id, id, created_at) VALUES (?,?,?,?,?,?,?,?,?)', ...checkArgs(obj(req.body)), id, Date.now());
    rescheduleCheck(id);
    audit(req, 'check.create', id, { name: req.body.name }, true);
    changed('checks');
    return { id };
  });
  app.patch<{ Params: { id: string }; Body: AnyBody }>('/api/checks/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const prev = q.get<CheckRow>('SELECT * FROM checks WHERE id = ?', idOf(req.params.id));
    if (!prev) return reply.code(404).send({ error: 'not found' });
    q.run('UPDATE checks SET name=?, type=?, target=?, options=?, interval_sec=?, enabled=?, instance_id=? WHERE id = ?', ...checkArgs(obj(req.body), prev), prev.id);
    rescheduleCheck(prev.id);
    audit(req, 'check.update', prev.id, undefined, true);
    changed('checks');
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/api/checks/:id', { preHandler: requireAdmin }, async (req) => {
    const id = idOf(req.params.id);
    q.run('DELETE FROM checks WHERE id = ?', id);
    q.run('DELETE FROM check_results WHERE check_id = ?', id);
    q.run('DELETE FROM check_hourly WHERE check_id = ?', id);
    rescheduleCheck(id);
    audit(req, 'check.delete', id, undefined, true);
    changed('checks');
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/api/checks/:id/run', { preHandler: requireAdmin }, async (req, reply) => {
    if (!rateLimit(`checkrun:${req.ip}`, 30, 60_000)) return reply.code(429).send({ error: 'Slow down' });
    const row = q.get<CheckRow>('SELECT * FROM checks WHERE id = ?', idOf(req.params.id));
    if (!row) return reply.code(404).send({ error: 'not found' });
    return (await runCheck(row)) ?? reply.code(404).send({ error: 'not found' });
  });

  // boards / widgets / layouts
  app.post<{ Body: AnyBody }>('/api/boards', { preHandler: requireAdmin }, async (req) => {
    const b = obj(req.body);
    const id = randomId();
    const sort = q.get<{ m: number }>('SELECT COALESCE(MAX(sort),0)+1 m FROM boards')!.m;
    q.run('INSERT INTO boards (id, name, icon, sort, in_rotation, created_at, options) VALUES (?,?,?,?,1,?,?)',
      id, text(b.name, 60, 'New board'), text(b.icon, 40, 'layout-grid'), sort, Date.now(), smallJson(b.options, 4000, 'options'));
    changed('boards');
    return { id };
  });
  app.patch<{ Params: { id: string }; Body: AnyBody }>('/api/boards/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const prev = q.get('SELECT * FROM boards WHERE id = ?', idOf(req.params.id));
    if (!prev) return reply.code(404).send({ error: 'not found' });
    const b = obj(req.body);
    q.run('UPDATE boards SET name=?, icon=?, sort=?, in_rotation=?, options=? WHERE id=?', text(b.name, 60, prev.name), text(b.icon, 40, prev.icon ?? 'layout-grid'),
      int(b.sort, -1e6, 1e6, prev.sort), b.in_rotation === undefined ? prev.in_rotation : b.in_rotation ? 1 : 0,
      b.options === undefined ? prev.options : smallJson(b.options, 4000, 'options'), prev.id);
    changed('boards');
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/api/boards/:id', { preHandler: requireAdmin }, async (req) => {
    q.run('DELETE FROM boards WHERE id = ?', idOf(req.params.id));
    audit(req, 'board.delete', req.params.id, undefined, true);
    changed('boards');
    return { ok: true };
  });
  const KIND = /^[a-z0-9-]{1,40}\.[a-z0-9-]{1,40}$/;
  app.post<{ Params: { id: string }; Body: AnyBody }>('/api/boards/:id/widgets', { preHandler: requireAdmin }, async (req, reply) => {
    const b = obj(req.body);
    const boardId = idOf(req.params.id);
    if (!q.get('SELECT 1 FROM boards WHERE id = ?', boardId)) return reply.code(404).send({ error: 'Unknown board' });
    if (typeof b.kind !== 'string' || !KIND.test(b.kind)) return reply.code(400).send({ error: 'Invalid widget kind' });
    const instanceId = b.instance_id ? idOf(b.instance_id) : null;
    if (instanceId && !getInstance(instanceId)) return reply.code(400).send({ error: 'Unknown service' });
    const id = randomId();
    q.run('INSERT INTO widgets (id, board_id, kind, instance_id, title, size, options, created_at) VALUES (?,?,?,?,?,?,?,?)',
      id, boardId, b.kind, instanceId, optText(b.title, 100), oneOf(b.size, SIZES, 'M'), smallJson(b.options, 64_000, 'options'), Date.now());
    changed('boards');
    return { id };
  });
  app.patch<{ Params: { id: string }; Body: AnyBody }>('/api/widgets/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const w = q.get('SELECT * FROM widgets WHERE id = ?', idOf(req.params.id));
    if (!w) return reply.code(404).send({ error: 'not found' });
    const b = obj(req.body);
    const boardId = b.board_id ? idOf(b.board_id) : w.board_id;
    if (!q.get('SELECT 1 FROM boards WHERE id = ?', boardId)) return reply.code(400).send({ error: 'Unknown board' });
    const instanceId = b.instance_id === undefined ? w.instance_id : b.instance_id ? idOf(b.instance_id) : null;
    if (instanceId && !getInstance(instanceId)) return reply.code(400).send({ error: 'Unknown service' });
    q.run('UPDATE widgets SET title=?, size=?, options=?, instance_id=?, board_id=? WHERE id=?',
      b.title === undefined ? w.title : optText(b.title, 100), oneOf(b.size, SIZES, w.size),
      b.options === undefined ? w.options : smallJson(b.options, 64_000, 'options'), instanceId, boardId, w.id);
    changed('boards');
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/api/widgets/:id', { preHandler: requireAdmin }, async (req) => {
    q.run('DELETE FROM widgets WHERE id = ?', idOf(req.params.id));
    changed('boards');
    return { ok: true };
  });
  app.put<{ Params: { id: string; profile: string }; Body: { layout: unknown[] } }>('/api/boards/:id/layout/:profile', { preHandler: requireAdmin }, async (req, reply) => {
    const boardId = idOf(req.params.id);
    if (!q.get('SELECT 1 FROM boards WHERE id = ?', boardId)) return reply.code(404).send({ error: 'Unknown board' });
    q.run('INSERT INTO layouts (board_id, profile, layout) VALUES (?,?,?) ON CONFLICT(board_id, profile) DO UPDATE SET layout = excluded.layout',
      boardId, oneOf(req.params.profile, PROFILES), JSON.stringify(cleanLayout(obj(req.body).layout)));
    changed('layouts');
    return { ok: true };
  });
  app.delete<{ Params: { id: string; profile: string } }>('/api/boards/:id/layout/:profile', { preHandler: requireAdmin }, async (req) => {
    q.run('DELETE FROM layouts WHERE board_id = ? AND profile = ?', idOf(req.params.id), oneOf(req.params.profile, PROFILES));
    changed('layouts');
    return { ok: true };
  });

  // alert rules / channels
  app.get('/api/alert-rules', { preHandler: requireAdmin }, async () =>
    q.all('SELECT * FROM alert_rules ORDER BY created_at').map((r) => ({ ...r, target: json(r.target, {}), channels: json(r.channels, []), enabled: !!r.enabled })));
  app.post<{ Body: AnyBody }>('/api/alert-rules', { preHandler: requireAdmin }, async (req) => {
    const id = randomId();
    q.run('INSERT INTO alert_rules (name, type, target, severity, duration_sec, channels, enabled, id, created_at) VALUES (?,?,?,?,?,?,?,?,?)', ...ruleArgs(obj(req.body)), id, Date.now());
    audit(req, 'alert.rule.create', id, { name: req.body.name }, true);
    return { id };
  });
  app.patch<{ Params: { id: string }; Body: AnyBody }>('/api/alert-rules/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const prev = q.get('SELECT * FROM alert_rules WHERE id = ?', idOf(req.params.id));
    if (!prev) return reply.code(404).send({ error: 'not found' });
    q.run('UPDATE alert_rules SET name=?, type=?, target=?, severity=?, duration_sec=?, channels=?, enabled=? WHERE id=?', ...ruleArgs(obj(req.body), prev), prev.id);
    audit(req, 'alert.rule.update', prev.id, undefined, true);
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/api/alert-rules/:id', { preHandler: requireAdmin }, async (req) => {
    q.run('DELETE FROM alert_rules WHERE id = ?', idOf(req.params.id));
    audit(req, 'alert.rule.delete', req.params.id, undefined, true);
    return { ok: true };
  });
  app.get('/api/channel-types', { preHandler: requireAdmin }, async () => channelTypes.map(({ id, name, fields }) => ({ id, name, fields })));
  app.get('/api/channels', { preHandler: requireAdmin }, async () => q.all<ChannelRow>('SELECT * FROM channels ORDER BY created_at').map(publicChannel));
  app.post<{ Body: AnyBody }>('/api/channels', { preHandler: requireSudo }, async (req, reply) => {
    const b = obj(req.body);
    const t = getChannelType(String(b.type));
    if (!t) return reply.code(400).send({ error: 'Unknown channel type' });
    const id = randomId();
    q.run('INSERT INTO channels (id, type, name, config, enabled, created_at) VALUES (?,?,?,?,?,?)', id, t.id, text(b.name, 80, t.name),
      encodeChannelConfig(t.id, id, obj(b.config ?? {})), b.enabled === false ? 0 : 1, Date.now());
    audit(req, 'alert.channel.create', id, { type: t.id }, true);
    return { id };
  });
  app.patch<{ Params: { id: string }; Body: AnyBody }>('/api/channels/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const c = q.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', idOf(req.params.id));
    if (!c) return reply.code(404).send({ error: 'not found' });
    const b = obj(req.body);
    if (b.config !== undefined && (req.auth as any).sudoUntil < Date.now()) return reply.code(403).send({ error: 'Confirm your password to continue', sudo: true });
    q.run('UPDATE channels SET name=?, config=?, enabled=? WHERE id=?', text(b.name, 80, c.name),
      b.config !== undefined ? encodeChannelConfig(c.type, c.id, obj(b.config), c.config) : c.config, b.enabled === undefined ? c.enabled : b.enabled ? 1 : 0, c.id);
    audit(req, 'alert.channel.update', c.id, undefined, true);
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/api/channels/:id', { preHandler: requireAdmin }, async (req) => {
    q.run('DELETE FROM channels WHERE id = ?', idOf(req.params.id));
    audit(req, 'alert.channel.delete', req.params.id, undefined, true);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/api/channels/:id/test', { preHandler: requireAdmin }, async (req, reply) => {
    if (!rateLimit(`chtest:${req.ip}`, 10, 60_000)) return reply.code(429).send({ error: 'Slow down' });
    const c = q.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', idOf(req.params.id));
    if (!c) return reply.code(404).send({ error: 'not found' });
    try {
      await testChannel(c);
      return { ok: true };
    } catch (e: any) {
      return reply.code(502).send({ error: String(e?.message ?? e).slice(0, 300) });
    }
  });

  // audit log
  app.get<{ Querystring: { limit?: string } }>('/api/audit', { preHandler: requireAdmin }, async (req) =>
    q.all('SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?', int(req.query.limit, 1, 1000, 200)));

  // backup / restore (secrets stay encrypted and bound to their instance → restore needs the same SCYDE_SECRET_KEY)
  const BACKUP_TABLES = ['settings', 'instances', 'checks', 'boards', 'widgets', 'layouts', 'alert_rules', 'channels'];
  const columnsOf = (t: string) => new Set((db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
  app.get('/api/backup', { preHandler: requireSudo }, async (req, reply) => {
    const tables = Object.fromEntries(BACKUP_TABLES.map((t) => [t, q.all(`SELECT * FROM ${t}`)]));
    audit(req, 'backup.export', null, undefined, true);
    reply.header('content-disposition', `attachment; filename="scydehub-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    return { app: 'scydehub', format: 2, version: config.version, exportedAt: new Date().toISOString(), tables };
  });
  app.post<{ Body: AnyBody }>('/api/restore', { preHandler: requireSudo, bodyLimit: 30 * 1024 * 1024 }, async (req, reply) => {
    const b = obj(req.body);
    if (b.app !== 'scydehub' || !b.tables || typeof b.tables !== 'object') return reply.code(400).send({ error: 'This is not a SCYDE Hub backup' });
    // validate everything BEFORE touching the database: table names are fixed, column names must exist, values must be scalars
    const plan: { table: string; cols: string[]; rows: any[][] }[] = [];
    for (const t of BACKUP_TABLES) {
      const known = columnsOf(t);
      const rows = Array.isArray(b.tables[t]) ? b.tables[t] : [];
      if (rows.length > 50_000) return reply.code(400).send({ error: `Too many rows in ${t}` });
      for (const row of rows) {
        const o = obj(row);
        const cols = Object.keys(o).filter((c) => known.has(c));
        if (!cols.length) continue;
        const vals = cols.map((c) => (o[c] === null || ['string', 'number'].includes(typeof o[c]) ? o[c] : bad(`Invalid value in ${t}.${c}`)));
        plan.push({ table: t, cols, rows: [vals] });
      }
    }
    q.tx(() => {
      for (const t of [...BACKUP_TABLES].reverse()) q.run(`DELETE FROM ${t}`);
      for (const p of plan) q.run(`INSERT INTO ${p.table} (${p.cols.join(',')}) VALUES (${p.cols.map(() => '?').join(',')})`, ...p.rows[0]);
    });
    upgradeInstanceSecrets();
    upgradeChannelSecrets();
    audit(req, 'backup.restore', null, undefined, true);
    resetCollector();
    resetChecks();
    changed('all');
    return { ok: true };
  });

  // board templates: boards + widgets + positions, no services and no secrets
  const templateInfo = (t: Template) => ({ id: t.id, name: t.name, description: t.description, boards: t.boards.length, widgets: t.boards.reduce((n, b) => n + b.widgets.length, 0) });
  app.get('/api/templates', { preHandler: requireAdmin }, async () => BUILT_IN.map(templateInfo));
  app.get('/api/templates/export', { preHandler: requireAdmin }, async (_req, reply) => {
    reply.header('content-disposition', `attachment; filename="scydehub-boards-${new Date().toISOString().slice(0, 10)}.json"`);
    return exportTemplate();
  });
  app.get<{ Params: { id: string } }>('/api/templates/:id', { preHandler: requireAdmin }, async (req, reply) =>
    BUILT_IN.find((t) => t.id === req.params.id) ?? reply.code(404).send({ error: 'not found' }));
  app.post<{ Body: AnyBody }>('/api/templates/import', { preHandler: requireAdmin, bodyLimit: 4 * 1024 * 1024 }, async (req) => {
    const b = obj(req.body);
    const tpl = typeof b.id === 'string' ? BUILT_IN.find((t) => t.id === b.id) ?? bad('Unknown template') : parseTemplate(b.template);
    const r = importTemplate(parseTemplate(tpl), { createMissing: b.createMissing === true, replace: b.replace === true });
    for (const c of r.created) reschedule(c.id);
    audit(req, 'template.import', tpl.name, { createMissing: b.createMissing === true, replace: b.replace === true, boards: r.boards, widgets: r.widgets }, true);
    changed('all');
    return r;
  });

  // demo data
  app.post('/api/demo', { preHandler: requireAdmin }, async (req) => {
    const r = seedDemo();
    for (const row of listInstances()) reschedule(row.id);
    for (const c of q.all<{ id: string }>('SELECT id FROM checks')) rescheduleCheck(c.id);
    audit(req, 'demo.seed', null, undefined, true);
    changed('all');
    return r;
  });

  // maintenance window (mute notifications)
  app.post<{ Body: { minutes: number } }>('/api/maintenance', { preHandler: requireAdmin }, async (req) => {
    const minutes = int(req.body?.minutes, 0, 7 * 24 * 60, 0);
    const until = minutes > 0 ? Date.now() + minutes * 60_000 : 0;
    setSetting('maintenanceUntil', until);
    audit(req, 'maintenance', null, { minutes }, true);
    changed('settings');
    return { until };
  });

}
