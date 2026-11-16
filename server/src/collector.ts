import { q, json } from './db.js';
import { bus } from './lib/bus.js';
import { recordMetrics } from './lib/history.js';
import { createHttpClient } from './lib/http.js';
import { config } from './config.js';
import { getPlugin } from './plugins/registry.js';
import { tlsFrom, type CollectResult, type PluginAlert, type PluginContext, type Status } from './plugins/types.js';
import { decryptedConfig, getInstance, listInstances, type InstanceRow } from './instances.js';

export interface InstanceState {
  id: string;
  plugin: string;
  name: string;
  status: Status;
  summary?: string;
  data?: unknown;
  error?: string;
  updatedAt: number;
  lastOkAt?: number;
  statusSince: number;
  latencyMs?: number;
  mock: boolean;
  alerts: PluginAlert[];
  /** latest numeric metrics (same keys as history) */
  metrics?: Record<string, number>;
  /** true when data is the last known good state and the latest poll failed */
  stale?: boolean;
}

const states = new Map<string, InstanceState>();
const timers = new Map<string, NodeJS.Timeout>();
const scratch = new Map<string, Record<string, any>>();
const ticks = new Map<string, number>();
const running = new Set<string>();
/** bumped on every (re)schedule; a poll loop exits as soon as its generation is stale */
const generation = new Map<string, number>();
const listeners: ((s: InstanceState, prev?: InstanceState) => void)[] = [];

export const onInstanceState = (fn: (s: InstanceState, prev?: InstanceState) => void) => listeners.push(fn);
export const getStates = () => [...states.values()];
export const getState = (id: string) => states.get(id);

export function isMock(row: InstanceRow) {
  return config.mockAll || row.mock === 1;
}

/** `ephemeral`: one-off context (connection test) that leaves no scratch state behind. */
export function contextFor(row: InstanceRow, ephemeral = false): PluginContext {
  const plugin = getPlugin(row.plugin)!;
  const cfg = decryptedConfig(row);
  const httpDefaults = plugin.http?.(cfg) ?? {};
  const baseUrl = (httpDefaults.baseUrl ?? cfg.url ?? 'http://localhost').replace(/\/+$/, '');
  if (!ephemeral && !scratch.has(row.id)) scratch.set(row.id, {});
  const tick = ephemeral ? 1 : (ticks.get(row.id) ?? 0) + 1;
  if (!ephemeral) ticks.set(row.id, tick);
  return {
    instanceId: row.id,
    instanceName: row.name,
    config: cfg,
    http: createHttpClient(baseUrl, { headers: httpDefaults.headers, tls: tlsFrom(cfg), timeoutMs: Number(cfg.timeoutMs) || 10_000 }),
    scratch: ephemeral ? {} : scratch.get(row.id)!,
    tick,
    log: (m) => console.log(`[${row.plugin}:${row.name}] ${m}`),
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms / 1000}s`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

const persist = (s: InstanceState) =>
  q.run(
    `INSERT INTO instance_state (instance_id, status, summary, data, error, updated_at, last_ok_at, status_since, latency_ms)
     VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(instance_id) DO UPDATE SET status=excluded.status, summary=excluded.summary,
     data=excluded.data, error=excluded.error, updated_at=excluded.updated_at, last_ok_at=excluded.last_ok_at,
     status_since=excluded.status_since, latency_ms=excluded.latency_ms`,
    s.id, s.status, s.summary ?? null, JSON.stringify({ data: s.data, alerts: s.alerts }), s.error ?? null, s.updatedAt,
    s.lastOkAt ?? null, s.statusSince, s.latencyMs ?? null,
  );

/** Run one collection for an instance. Never throws: a failing integration only marks itself as down. */
export async function collectOnce(id: string): Promise<InstanceState | undefined> {
  const row = getInstance(id);
  if (!row) return;
  const plugin = getPlugin(row.plugin);
  if (!plugin) return;
  if (running.has(id)) return states.get(id);
  running.add(id);
  const prev = states.get(id);
  const now = Date.now();
  const started = performance.now();
  let next: InstanceState;
  try {
    const ctx = contextFor(row);
    const mock = isMock(row);
    const res: CollectResult = mock ? plugin.mock(ctx) : await withTimeout(plugin.collect(ctx), 25_000);
    const latency = Math.round(performance.now() - started);
    next = {
      id, plugin: row.plugin, name: row.name, status: res.status, summary: res.summary, data: res.data,
      updatedAt: now, lastOkAt: now, statusSince: prev && prev.status === res.status ? prev.statusSince : now,
      latencyMs: mock ? Math.round(20 + Math.random() * 30) : latency, mock, alerts: res.alerts ?? [], metrics: res.metrics,
    };
    const metrics = { ...(res.metrics ?? {}), _latency: next.latencyMs!, _up: res.status === 'down' ? 0 : 1 };
    recordMetrics(`inst:${id}`, metrics, now);
  } catch (e: any) {
    const msg = e?.cause?.message ? `${e.message}: ${e.cause.message}` : String(e?.message ?? e);
    next = {
      id, plugin: row.plugin, name: row.name, status: 'down', summary: prev?.summary,
      data: prev?.data, // last known state stays visible
      stale: prev?.data !== undefined,
      error: msg, updatedAt: now, lastOkAt: prev?.lastOkAt, metrics: prev?.metrics,
      statusSince: prev && prev.status === 'down' ? prev.statusSince : now, mock: isMock(row), alerts: [],
    };
    recordMetrics(`inst:${id}`, { _up: 0 }, now);
  } finally {
    running.delete(id);
  }
  // the instance may have been deleted (or the whole config restored) while the poll was in flight
  if (!getInstance(id)) return undefined;
  states.set(id, next);
  try {
    persist(next);
  } catch (e) {
    console.error(`[collector] could not persist state of ${id}:`, (e as Error).message);
  }
  bus.publish({ type: 'instance', id, state: next });
  for (const l of listeners) {
    try { l(next, prev); } catch (e) { console.error('[collector] listener error', e); }
  }
  return next;
}

function schedule(row: InstanceRow) {
  unschedule(row.id);
  const gen = (generation.get(row.id) ?? 0) + 1;
  generation.set(row.id, gen);
  if (!row.enabled) {
    const s: InstanceState = {
      id: row.id, plugin: row.plugin, name: row.name, status: 'disabled', updatedAt: Date.now(), statusSince: Date.now(),
      mock: isMock(row), alerts: [],
    };
    states.set(row.id, s);
    bus.publish({ type: 'instance', id: row.id, state: s });
    return;
  }
  const loop = async () => {
    try {
      await collectOnce(row.id);
    } catch (e) {
      console.error(`[collector] ${row.id}:`, (e as Error).message);
    }
    if (generation.get(row.id) !== gen) return; // rescheduled or removed meanwhile
    const fresh = getInstance(row.id);
    if (fresh?.enabled) timers.set(row.id, setTimeout(loop, Math.min(86_400, Math.max(5, fresh.interval_sec)) * 1000));
  };
  // stagger start-up so we don't hit everything in the same millisecond
  timers.set(row.id, setTimeout(loop, Math.random() * 1500));
}
function unschedule(id: string) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
}

export function reschedule(id: string) {
  const row = getInstance(id);
  if (!row) {
    unschedule(id);
    generation.set(id, (generation.get(id) ?? 0) + 1);
    states.delete(id);
    scratch.delete(id);
    ticks.delete(id);
    return;
  }
  scratch.delete(id); // config may have changed (new credentials)
  schedule(row);
}

export function startCollector() {
  // restore last known state so the UI isn't empty right after a restart
  for (const r of q.all('SELECT s.*, i.plugin, i.name, i.mock FROM instance_state s JOIN instances i ON i.id = s.instance_id')) {
    const blob = json<{ data?: unknown; alerts?: PluginAlert[] }>(r.data, {});
    states.set(r.instance_id, {
      id: r.instance_id, plugin: r.plugin, name: r.name, status: r.status, summary: r.summary ?? undefined, data: blob.data,
      alerts: blob.alerts ?? [], error: r.error ?? undefined, updatedAt: r.updated_at, lastOkAt: r.last_ok_at ?? undefined,
      statusSince: r.status_since, latencyMs: r.latency_ms ?? undefined, mock: !!r.mock, stale: true,
    });
  }
  for (const row of listInstances()) schedule(row);
}

/** After a restore: forget everything in memory and start again from the database. */
export function resetCollector() {
  for (const id of [...timers.keys()]) unschedule(id);
  for (const id of [...generation.keys()]) generation.set(id, (generation.get(id) ?? 0) + 1);
  states.clear();
  scratch.clear();
  ticks.clear();
  for (const row of listInstances()) schedule(row);
}

export function stopCollector() {
  for (const id of [...timers.keys()]) unschedule(id);
}
