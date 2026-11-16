import type { FastifyInstance } from 'fastify';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetch } from 'undici';
import { q, json, getSetting, setSetting } from '../db.js';
import { audit, actorOf, requireAdmin, requireAny } from '../auth.js';
import { bus } from '../lib/bus.js';
import { randomId } from '../lib/crypto.js';
import { querySeries, listSeries } from '../lib/history.js';
import { config } from '../config.js';
import { plugins, getPlugin, pluginMeta } from '../plugins/registry.js';
import { collectOnce, contextFor, getStates, isMock, reschedule } from '../collector.js';
import { createInstance, getInstance, listInstances, publicConfig, updateInstance } from '../instances.js';
import { getCheckStates, rescheduleCheck, runCheck, uptimeBars, type CheckRow } from '../monitoring/checks.js';
import { ackIncident, type Incident } from '../alerts/engine.js';
import { channelTypes, encodeChannelConfig, publicChannel, testChannel, type ChannelRow } from '../alerts/channels.js';
import { seedDemo } from '../demo.js';

type AnyBody = Record<string, any>;

export const DEFAULT_SETTINGS = {
  appearance: { theme: 'dark', accent: '#7c5cff', glass: true, density: 'comfortable' },
  kiosk: { rotationSec: 30, pauseOnInteractSec: 120, pixelShift: true, nightDim: { enabled: true, start: '23:00', end: '07:00', level: 0.35 }, alertTakeover: true },
  publicUrl: '',
  heartbeat: { url: '', intervalSec: 60 },
  weather: { lat: 45.815, lon: 15.982, name: 'Zagreb' },
  maintenanceUntil: 0,
};
export function allSettings() {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    const stored = getSetting<any>(k, v);
    out[k] = typeof v === 'object' && v !== null ? { ...v, ...stored } : stored;
  }
  return out;
}

function publicInstance(r: ReturnType<typeof getInstance> & {}) {
  return { ...r, enabled: !!r.enabled, mock: !!r.mock, effectiveMock: isMock(r), config: publicConfig(r) };
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
    widgets: widgets.filter((w) => w.board_id === b.id).map((w) => ({ ...w, options: json(w.options, {}) })),
    layouts: Object.fromEntries(layouts.filter((l) => l.board_id === b.id).map((l) => [l.profile, json(l.layout, [])])),
  }));
}

const changed = (scope: string) => bus.publish({ type: 'config', scope });

export default async function apiRoutes(app: FastifyInstance) {
  // ---------- read-only (admin or kiosk) ----------
  app.get('/api/state', { preHandler: requireAny }, async () => ({
    instances: getStates(),
    checks: getCheckStates(),
    incidents: openAndRecentIncidents(),
    time: Date.now(),
  }));
  app.get('/api/plugins', { preHandler: requireAny }, async () => plugins.map(pluginMeta));
  app.get('/api/instances', { preHandler: requireAny }, async (req) =>
    listInstances().map((r) => (req.auth?.kind === 'admin' ? publicInstance(r) : { id: r.id, plugin: r.plugin, name: r.name, enabled: !!r.enabled, mock: !!r.mock })));
  app.get('/api/boards', { preHandler: requireAny }, async () => boardsWithWidgets());
  app.get('/api/settings', { preHandler: requireAny }, async () => allSettings());
  app.get('/api/checks', { preHandler: requireAny }, async () =>
    q.all<CheckRow>('SELECT * FROM checks ORDER BY sort, name').map((c) => ({ ...c, enabled: !!c.enabled, options: json(c.options, {}) })));
  app.get<{ Params: { id: string }; Querystring: { hours?: string } }>('/api/checks/:id/bars', { preHandler: requireAny }, async (req) =>
    uptimeBars(req.params.id, Math.min(24 * 90, Number(req.query.hours) || 48)));
  app.get<{ Querystring: { series: string; from?: string; to?: string; points?: string } }>('/api/history', { preHandler: requireAny }, async (req) => {
    const to = Number(req.query.to) || Date.now();
    const from = Number(req.query.from) || to - 6 * 3600_000;
    const series = String(req.query.series ?? '').split(',').filter(Boolean).slice(0, 12);
    return Object.fromEntries(series.map((s) => [s, querySeries(s, from, to, Math.min(1000, Number(req.query.points) || 300))]));
  });
  app.get<{ Querystring: { prefix: string } }>('/api/history/series', { preHandler: requireAny }, async (req) => listSeries(String(req.query.prefix ?? '')));
  app.get('/api/incidents', { preHandler: requireAny }, async () => q.all('SELECT * FROM incidents ORDER BY started_at DESC LIMIT 500'));
  app.post<{ Params: { id: string } }>('/api/incidents/:id/ack', { preHandler: requireAny }, async (req, reply) => {
    if (req.auth?.kind === 'kiosk' && !req.auth.canAck) return reply.code(403).send({ error: 'Ovaj kiosk token ne može potvrđivati incidente' });
    const inc = ackIncident(Number(req.params.id), actorOf(req));
    audit(req, 'incident.ack', req.params.id, undefined, true);
    return inc;
  });

  // ---------- icons (cached proxy of dashboard-icons) ----------
  const iconDir = join(config.dataDir, 'icons');
  if (!existsSync(iconDir)) mkdirSync(iconDir, { recursive: true });
  const misses = new Map<string, number>();
  app.get<{ Params: { slug: string } }>('/api/icons/:slug', async (req, reply) => {
    const slug = req.params.slug.toLowerCase().replace(/[^a-z0-9-]/g, '');
    for (const [ext, type] of [['svg', 'image/svg+xml'], ['png', 'image/png']] as const) {
      const f = join(iconDir, `${slug}.${ext}`);
      if (existsSync(f)) return reply.header('cache-control', 'public, max-age=604800').type(type).send(readFileSync(f));
    }
    if ((misses.get(slug) ?? 0) > Date.now()) return reply.code(404).send();
    for (const [ext, type] of [['svg', 'image/svg+xml'], ['png', 'image/png']] as const) {
      try {
        const r = await fetch(`${config.iconCdn}/${ext}/${slug}.${ext}`, { signal: AbortSignal.timeout(6000) });
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          writeFileSync(join(iconDir, `${slug}.${ext}`), buf);
          return reply.header('cache-control', 'public, max-age=604800').type(type).send(buf);
        }
      } catch { /* offline */ }
    }
    misses.set(slug, Date.now() + 3600_000);
    return reply.code(404).send();
  });

  // ---------- admin ----------
  app.addHook('preHandler', async (req, reply) => {
    // CSRF guard for cookie-authenticated writes: require a custom header (not settable cross-site without CORS)
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.url.startsWith('/api/') && req.headers['x-scyde'] !== '1')
      return reply.code(400).send({ error: 'missing x-scyde header' });
  });

  app.put<{ Body: Record<string, any> }>('/api/settings', { preHandler: requireAdmin }, async (req) => {
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in req.body) setSetting(k, req.body[k]);
    audit(req, 'settings.update', null, Object.keys(req.body), true);
    changed('settings');
    return allSettings();
  });

  // instances
  app.post<{ Body: AnyBody }>('/api/instances', { preHandler: requireAdmin }, async (req) => {
    const row = createInstance(req.body as any);
    reschedule(row.id);
    audit(req, 'instance.create', row.id, { plugin: row.plugin, name: row.name }, true);
    changed('instances');
    return publicInstance(row);
  });
  app.patch<{ Params: { id: string }; Body: AnyBody }>('/api/instances/:id', { preHandler: requireAdmin }, async (req) => {
    const row = updateInstance(req.params.id, req.body);
    reschedule(row.id);
    audit(req, 'instance.update', row.id, { name: row.name }, true);
    changed('instances');
    return publicInstance(row);
  });
  app.delete<{ Params: { id: string } }>('/api/instances/:id', { preHandler: requireAdmin }, async (req) => {
    q.run('DELETE FROM instances WHERE id = ?', req.params.id);
    reschedule(req.params.id);
    audit(req, 'instance.delete', req.params.id, undefined, true);
    changed('instances');
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/api/instances/:id/refresh', { preHandler: requireAdmin }, async (req) => collectOnce(req.params.id));
  /** Test a config without saving it */
  app.post<{ Body: { plugin: string; config: Record<string, any>; id?: string } }>('/api/instances/test', { preHandler: requireAdmin }, async (req, reply) => {
    const p = getPlugin(req.body.plugin);
    if (!p) return reply.code(400).send({ error: 'nepoznat plugin' });
    const { prepareConfig } = await import('../instances.js');
    const existing = req.body.id ? getInstance(req.body.id) : undefined;
    const fake = { id: 'test-' + randomId(), plugin: p.id, name: 'test', config: prepareConfig(p.id, req.body.config, existing), interval_sec: 60, enabled: 1, mock: 0, sort: 0, created_at: 0 };
    const started = performance.now();
    try {
      const r = await p.collect(contextFor(fake));
      return { ok: true, status: r.status, summary: r.summary, ms: Math.round(performance.now() - started) };
    } catch (e: any) {
      return { ok: false, error: e?.cause?.message ? `${e.message}: ${e.cause.message}` : String(e?.message ?? e) };
    }
  });

  // actions (shared confirm + audit framework)
  app.post<{ Params: { id: string; action: string }; Body: { params?: Record<string, any>; confirm?: boolean } }>(
    '/api/instances/:id/actions/:action', { preHandler: requireAdmin }, async (req, reply) => {
      const row = getInstance(req.params.id);
      if (!row) return reply.code(404).send({ error: 'not found' });
      const plugin = getPlugin(row.plugin)!;
      const action = plugin.actions?.find((a) => a.id === req.params.action);
      if (!action) return reply.code(404).send({ error: 'nepoznata akcija' });
      if (req.body?.confirm !== true) return reply.code(400).send({ error: 'Akcija mora biti potvrđena' });
      const params = req.body.params ?? {};
      const ctx = contextFor(row);
      try {
        const msg = isMock(row) ? (action.mock?.(ctx, params) ?? `${action.label} (mock) izvršeno`) : await action.run(ctx, params);
        audit(req, `action.${plugin.id}.${action.id}`, `${row.name} (${row.id})`, params, true, msg || 'ok');
        setTimeout(() => void collectOnce(row.id), 1500);
        return { ok: true, message: msg || `${action.label}: izvršeno` };
      } catch (e: any) {
        const m = String(e?.message ?? e);
        audit(req, `action.${plugin.id}.${action.id}`, `${row.name} (${row.id})`, params, false, m);
        return reply.code(502).send({ error: m });
      }
    });

  // checks
  const checkBody = (b: any) => [b.name, b.type, b.target, JSON.stringify(b.options ?? {}), Math.max(10, Number(b.interval_sec) || 60), b.enabled === false ? 0 : 1, b.instance_id || null] as const;
  app.post<{ Body: AnyBody }>('/api/checks', { preHandler: requireAdmin }, async (req) => {
    const id = randomId();
    q.run('INSERT INTO checks (name, type, target, options, interval_sec, enabled, instance_id, id, created_at) VALUES (?,?,?,?,?,?,?,?,?)', ...checkBody(req.body), id, Date.now());
    rescheduleCheck(id);
    audit(req, 'check.create', id, { name: req.body.name }, true);
    changed('checks');
    return { id };
  });
  app.patch<{ Params: { id: string }; Body: AnyBody }>('/api/checks/:id', { preHandler: requireAdmin }, async (req) => {
    q.run('UPDATE checks SET name=?, type=?, target=?, options=?, interval_sec=?, enabled=?, instance_id=? WHERE id = ?', ...checkBody(req.body), req.params.id);
    rescheduleCheck(req.params.id);
    changed('checks');
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/api/checks/:id', { preHandler: requireAdmin }, async (req) => {
    q.run('DELETE FROM checks WHERE id = ?', req.params.id);
    q.run('DELETE FROM check_results WHERE check_id = ?', req.params.id);
    q.run('DELETE FROM check_hourly WHERE check_id = ?', req.params.id);
    rescheduleCheck(req.params.id);
    audit(req, 'check.delete', req.params.id, undefined, true);
    changed('checks');
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/api/checks/:id/run', { preHandler: requireAdmin }, async (req, reply) => {
    const row = q.get<CheckRow>('SELECT * FROM checks WHERE id = ?', req.params.id);
    if (!row) return reply.code(404).send();
    return runCheck(row);
  });

  // boards / widgets / layouts
  app.post<{ Body: { name: string; icon?: string } }>('/api/boards', { preHandler: requireAdmin }, async (req) => {
    const id = randomId();
    const sort = q.get<{ m: number }>('SELECT COALESCE(MAX(sort),0)+1 m FROM boards')!.m;
    q.run('INSERT INTO boards (id, name, icon, sort, in_rotation, created_at) VALUES (?,?,?,?,1,?)', id, req.body.name || 'Nova stranica', req.body.icon ?? 'layout-grid', sort, Date.now());
    changed('boards');
    return { id };
  });
  app.patch<{ Params: { id: string }; Body: AnyBody }>('/api/boards/:id', { preHandler: requireAdmin }, async (req) => {
    const b = q.get('SELECT * FROM boards WHERE id = ?', req.params.id);
    if (!b) return { ok: false };
    q.run('UPDATE boards SET name=?, icon=?, sort=?, in_rotation=? WHERE id=?', req.body.name ?? b.name, req.body.icon ?? b.icon, req.body.sort ?? b.sort,
      req.body.in_rotation === undefined ? b.in_rotation : req.body.in_rotation ? 1 : 0, req.params.id);
    changed('boards');
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/api/boards/:id', { preHandler: requireAdmin }, async (req) => {
    q.run('DELETE FROM boards WHERE id = ?', req.params.id);
    changed('boards');
    return { ok: true };
  });
  app.post<{ Params: { id: string }; Body: AnyBody }>('/api/boards/:id/widgets', { preHandler: requireAdmin }, async (req) => {
    const id = randomId();
    q.run('INSERT INTO widgets (id, board_id, kind, instance_id, title, size, options, created_at) VALUES (?,?,?,?,?,?,?,?)',
      id, req.params.id, req.body.kind, req.body.instance_id || null, req.body.title ?? null, req.body.size ?? 'M', JSON.stringify(req.body.options ?? {}), Date.now());
    changed('boards');
    return { id };
  });
  app.patch<{ Params: { id: string }; Body: AnyBody }>('/api/widgets/:id', { preHandler: requireAdmin }, async (req) => {
    const w = q.get('SELECT * FROM widgets WHERE id = ?', req.params.id);
    if (!w) return { ok: false };
    q.run('UPDATE widgets SET title=?, size=?, options=?, instance_id=?, board_id=? WHERE id=?',
      req.body.title === undefined ? w.title : req.body.title, req.body.size ?? w.size,
      req.body.options === undefined ? w.options : JSON.stringify(req.body.options), req.body.instance_id === undefined ? w.instance_id : req.body.instance_id,
      req.body.board_id ?? w.board_id, req.params.id);
    changed('boards');
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/api/widgets/:id', { preHandler: requireAdmin }, async (req) => {
    q.run('DELETE FROM widgets WHERE id = ?', req.params.id);
    changed('boards');
    return { ok: true };
  });
  app.put<{ Params: { id: string; profile: string }; Body: { layout: unknown[] } }>('/api/boards/:id/layout/:profile', { preHandler: requireAdmin }, async (req) => {
    const profile = ['desktop', 'tv', 'tablet', 'mobile'].includes(req.params.profile) ? req.params.profile : 'desktop';
    q.run('INSERT INTO layouts (board_id, profile, layout) VALUES (?,?,?) ON CONFLICT(board_id, profile) DO UPDATE SET layout = excluded.layout',
      req.params.id, profile, JSON.stringify(req.body.layout ?? []));
    changed('layouts');
    return { ok: true };
  });

  // alert rules / channels
  app.get('/api/alert-rules', { preHandler: requireAdmin }, async () =>
    q.all('SELECT * FROM alert_rules ORDER BY created_at').map((r) => ({ ...r, target: json(r.target, {}), channels: json(r.channels, []), enabled: !!r.enabled })));
  const ruleArgs = (b: any) => [b.name, b.type, JSON.stringify(b.target ?? {}), b.severity ?? 'critical', Number(b.duration_sec) || 0, JSON.stringify(b.channels ?? []), b.enabled === false ? 0 : 1] as const;
  app.post<{ Body: AnyBody }>('/api/alert-rules', { preHandler: requireAdmin }, async (req) => {
    const id = randomId();
    q.run('INSERT INTO alert_rules (name, type, target, severity, duration_sec, channels, enabled, id, created_at) VALUES (?,?,?,?,?,?,?,?,?)', ...ruleArgs(req.body), id, Date.now());
    audit(req, 'alert.rule.create', id, { name: req.body.name }, true);
    return { id };
  });
  app.patch<{ Params: { id: string }; Body: AnyBody }>('/api/alert-rules/:id', { preHandler: requireAdmin }, async (req) => {
    q.run('UPDATE alert_rules SET name=?, type=?, target=?, severity=?, duration_sec=?, channels=?, enabled=? WHERE id=?', ...ruleArgs(req.body), req.params.id);
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/api/alert-rules/:id', { preHandler: requireAdmin }, async (req) => {
    q.run('DELETE FROM alert_rules WHERE id = ?', req.params.id);
    return { ok: true };
  });
  app.get('/api/channel-types', { preHandler: requireAdmin }, async () => channelTypes.map(({ id, name, fields }) => ({ id, name, fields })));
  app.get('/api/channels', { preHandler: requireAdmin }, async () => q.all<ChannelRow>('SELECT * FROM channels ORDER BY created_at').map(publicChannel));
  app.post<{ Body: AnyBody }>('/api/channels', { preHandler: requireAdmin }, async (req) => {
    const id = randomId();
    q.run('INSERT INTO channels (id, type, name, config, enabled, created_at) VALUES (?,?,?,?,?,?)', id, req.body.type, req.body.name || req.body.type,
      encodeChannelConfig(req.body.type, req.body.config ?? {}), req.body.enabled === false ? 0 : 1, Date.now());
    audit(req, 'alert.channel.create', id, { type: req.body.type }, true);
    return { id };
  });
  app.patch<{ Params: { id: string }; Body: AnyBody }>('/api/channels/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const c = q.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', req.params.id);
    if (!c) return reply.code(404).send();
    q.run('UPDATE channels SET name=?, config=?, enabled=? WHERE id=?', req.body.name ?? c.name,
      req.body.config ? encodeChannelConfig(c.type, req.body.config, c.config) : c.config, req.body.enabled === undefined ? c.enabled : req.body.enabled ? 1 : 0, c.id);
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/api/channels/:id', { preHandler: requireAdmin }, async (req) => {
    q.run('DELETE FROM channels WHERE id = ?', req.params.id);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/api/channels/:id/test', { preHandler: requireAdmin }, async (req, reply) => {
    const c = q.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', req.params.id);
    if (!c) return reply.code(404).send();
    try {
      await testChannel(c);
      return { ok: true };
    } catch (e: any) {
      return reply.code(502).send({ error: String(e?.message ?? e) });
    }
  });

  // audit log
  app.get<{ Querystring: { limit?: string } }>('/api/audit', { preHandler: requireAdmin }, async (req) =>
    q.all('SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?', Math.min(1000, Number(req.query.limit) || 200)));

  // backup / restore (secrets stay encrypted → restore needs the same SCYDE_SECRET_KEY)
  const BACKUP_TABLES = ['settings', 'instances', 'checks', 'boards', 'widgets', 'layouts', 'alert_rules', 'channels'];
  app.get('/api/backup', { preHandler: requireAdmin }, async (req, reply) => {
    const tables = Object.fromEntries(BACKUP_TABLES.map((t) => [t, q.all(`SELECT * FROM ${t}`)]));
    audit(req, 'backup.export', null, undefined, true);
    reply.header('content-disposition', `attachment; filename="scydehub-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    return { app: 'scydehub', format: 1, version: config.version, exportedAt: new Date().toISOString(), tables };
  });
  app.post<{ Body: AnyBody }>('/api/restore', { preHandler: requireAdmin, bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    const b = req.body;
    if (b?.app !== 'scydehub' || !b.tables) return reply.code(400).send({ error: 'Nije SCYDE Hub backup' });
    q.tx(() => {
      for (const t of [...BACKUP_TABLES].reverse()) q.run(`DELETE FROM ${t}`);
      for (const t of BACKUP_TABLES) {
        for (const row of b.tables[t] ?? []) {
          const cols = Object.keys(row);
          q.run(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => row[c]));
        }
      }
    });
    audit(req, 'backup.restore', null, undefined, true);
    for (const r of listInstances()) reschedule(r.id);
    for (const c of q.all<{ id: string }>('SELECT id FROM checks')) rescheduleCheck(c.id);
    changed('all');
    return { ok: true };
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
    const until = req.body.minutes > 0 ? Date.now() + req.body.minutes * 60_000 : 0;
    setSetting('maintenanceUntil', until);
    audit(req, 'maintenance', null, { minutes: req.body.minutes }, true);
    changed('settings');
    return { until };
  });

}
