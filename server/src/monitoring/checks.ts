import { q, json } from '../db.js';
import { bus } from '../lib/bus.js';
import { recordMetrics } from '../lib/history.js';
import { config } from '../config.js';
import { runProbe, type CheckType } from './probes.js';

export interface CheckRow {
  id: string; name: string; type: CheckType; target: string; options: string; interval_sec: number;
  enabled: number; instance_id: string | null; sort: number; created_at: number;
}
export interface CheckState {
  id: string; name: string; type: CheckType; target: string; ok: boolean | null; latencyMs?: number; message?: string;
  checkedAt?: number; statusSince: number; extra?: Record<string, unknown>; enabled: boolean; instanceId?: string | null;
  uptime?: { d1: number | null; d7: number | null; d30: number | null };
  /** last 60 results, oldest first: 1 ok, 0 fail */
  recent?: { ts: number; ok: number; latency: number | null }[];
}

const states = new Map<string, CheckState>();
const timers = new Map<string, NodeJS.Timeout>();
const listeners: ((s: CheckState, prev?: CheckState) => void)[] = [];
export const onCheckState = (fn: (s: CheckState, prev?: CheckState) => void) => listeners.push(fn);
export const getCheckStates = () => [...states.values()];
export const getCheckState = (id: string) => states.get(id);

export function uptime(checkId: string) {
  const now = Date.now();
  const hour = 3600_000;
  const curHour = Math.floor(now / hour) * hour;
  const calc = (days: number) => {
    const from = now - days * 86400_000;
    const h = q.get<{ t: number; o: number }>('SELECT SUM(total) t, SUM(ok) o FROM check_hourly WHERE check_id = ? AND ts >= ? AND ts < ?', checkId, from, curHour);
    const r = q.get<{ t: number; o: number }>('SELECT COUNT(*) t, SUM(ok) o FROM check_results WHERE check_id = ? AND ts >= ?', checkId, Math.max(curHour, from));
    // check_hourly covers only completed hours that were rolled up; use raw results for anything newer than the last bucket
    const lastBucket = q.get<{ ts: number }>('SELECT MAX(ts) ts FROM check_hourly WHERE check_id = ?', checkId)?.ts ?? 0;
    const gap = q.get<{ t: number; o: number }>('SELECT COUNT(*) t, SUM(ok) o FROM check_results WHERE check_id = ? AND ts >= ? AND ts < ?', checkId, Math.max(from, lastBucket + hour), curHour);
    const total = (h?.t ?? 0) + (r?.t ?? 0) + (gap?.t ?? 0);
    const ok = (h?.o ?? 0) + (r?.o ?? 0) + (gap?.o ?? 0);
    return total ? Math.round((ok / total) * 10000) / 100 : null;
  };
  return { d1: calc(1), d7: calc(7), d30: calc(30) };
}

/** hourly uptime buckets for the outage history bar */
export function uptimeBars(checkId: string, hours = 48) {
  const hour = 3600_000;
  const now = Date.now();
  const from = Math.floor(now / hour) * hour - (hours - 1) * hour;
  const rows = q.all<{ b: number; t: number; o: number }>(
    `SELECT (ts / ${hour}) * ${hour} b, COUNT(*) t, SUM(ok) o FROM check_results WHERE check_id = ? AND ts >= ? GROUP BY b`, checkId, from,
  );
  const hourly = q.all<{ b: number; t: number; o: number }>('SELECT ts b, total t, ok o FROM check_hourly WHERE check_id = ? AND ts >= ?', checkId, from);
  const map = new Map<number, { t: number; o: number }>();
  for (const r of [...hourly, ...rows]) map.set(r.b, r); // raw wins when present
  return Array.from({ length: hours }, (_, i) => {
    const b = from + i * hour;
    const r = map.get(b);
    return { ts: b, uptime: r && r.t ? r.o / r.t : null };
  });
}

function recent(checkId: string) {
  return q.all<{ ts: number; ok: number; latency: number | null }>(
    'SELECT ts, ok, latency_ms latency FROM (SELECT * FROM check_results WHERE check_id = ? ORDER BY ts DESC LIMIT 60) ORDER BY ts', checkId,
  );
}

export async function runCheck(row: CheckRow) {
  const opts = json<Record<string, any>>(row.options, {});
  const prev = states.get(row.id);
  let r;
  if (config.mockAll || opts.mock) {
    const ok = Math.random() > 0.02;
    r = { ok, latencyMs: ok ? Math.round(5 + Math.random() * 40) : undefined, message: ok ? 'OK (mock)' : 'Timeout (mock)' };
  } else {
    r = await runProbe(row.type, row.target, opts).catch((e): import('./probes.js').ProbeResult => ({ ok: false, message: String(e?.message ?? e) }));
  }
  const now = Date.now();
  q.run('INSERT INTO check_results (check_id, ts, ok, latency_ms, message) VALUES (?,?,?,?,?)', row.id, now, r.ok ? 1 : 0, r.latencyMs ?? null, r.message ?? null);
  if (r.latencyMs !== undefined) recordMetrics(`check:${row.id}`, { latency: r.latencyMs }, now);
  const next: CheckState = {
    id: row.id, name: row.name, type: row.type, target: row.target, ok: r.ok, latencyMs: r.latencyMs, message: r.message,
    checkedAt: now, statusSince: prev && prev.ok === r.ok ? prev.statusSince : now, extra: (r as any).extra,
    enabled: true, instanceId: row.instance_id, uptime: uptime(row.id), recent: recent(row.id),
  };
  states.set(row.id, next);
  bus.publish({ type: 'check', id: row.id, state: next });
  for (const l of listeners) {
    try { l(next, prev); } catch (e) { console.error('[checks] listener', e); }
  }
  return next;
}

function schedule(row: CheckRow) {
  const t = timers.get(row.id);
  if (t) clearTimeout(t);
  if (!row.enabled) {
    states.set(row.id, { id: row.id, name: row.name, type: row.type, target: row.target, ok: null, statusSince: Date.now(), enabled: false });
    return;
  }
  const loop = async () => {
    const fresh = q.get<CheckRow>('SELECT * FROM checks WHERE id = ?', row.id);
    if (!fresh || !fresh.enabled) return;
    await runCheck(fresh);
    timers.set(row.id, setTimeout(loop, Math.max(10, fresh.interval_sec) * 1000));
  };
  timers.set(row.id, setTimeout(loop, Math.random() * 3000));
}

export function rescheduleCheck(id: string) {
  const row = q.get<CheckRow>('SELECT * FROM checks WHERE id = ?', id);
  if (!row) {
    const t = timers.get(id);
    if (t) clearTimeout(t);
    timers.delete(id);
    states.delete(id);
    return;
  }
  schedule(row);
}

export function startChecks() {
  for (const row of q.all<CheckRow>('SELECT * FROM checks')) {
    const last = q.get<{ ts: number; ok: number; latency_ms: number; message: string }>('SELECT * FROM check_results WHERE check_id = ? ORDER BY ts DESC LIMIT 1', row.id);
    states.set(row.id, {
      id: row.id, name: row.name, type: row.type, target: row.target, ok: last ? !!last.ok : null, latencyMs: last?.latency_ms,
      message: last?.message, checkedAt: last?.ts, statusSince: last?.ts ?? Date.now(), enabled: !!row.enabled, instanceId: row.instance_id,
      uptime: uptime(row.id), recent: recent(row.id),
    });
    schedule(row);
  }
}
