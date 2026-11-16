import { db, q } from '../db.js';

const insert = db.prepare('INSERT INTO metrics (series, ts, value) VALUES (?, ?, ?)');

export function recordMetrics(prefix: string, values: Record<string, number>, ts = Date.now()) {
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'number' && Number.isFinite(v)) insert.run(`${prefix}:${k}`, ts, v);
  }
}

export interface Point { ts: number; v: number; min?: number; max?: number }

/** Choose the resolution automatically: raw ≤ 6h, 5-minute ≤ 7d, hourly beyond. */
export function querySeries(series: string, from: number, to = Date.now(), maxPoints = 300): Point[] {
  const span = to - from;
  let rows: Point[];
  if (span <= 6 * 3600_000) {
    rows = q.all<Point>('SELECT ts, value AS v FROM metrics WHERE series = ? AND ts BETWEEN ? AND ? ORDER BY ts', series, from, to);
    // raw may already be pruned for older ranges — fall back to 5m
    if (rows.length === 0) rows = q.all<Point>('SELECT ts, avg AS v, min, max FROM metrics_5m WHERE series = ? AND ts BETWEEN ? AND ? ORDER BY ts', series, from, to);
  } else if (span <= 7 * 86400_000) {
    rows = q.all<Point>('SELECT ts, avg AS v, min, max FROM metrics_5m WHERE series = ? AND ts BETWEEN ? AND ? ORDER BY ts', series, from, to);
    const lastTs = rows.at(-1)?.ts ?? from;
    rows = rows.concat(q.all<Point>('SELECT ts, value AS v FROM metrics WHERE series = ? AND ts > ? AND ts <= ? ORDER BY ts', series, lastTs + 300_000, to));
  } else {
    rows = q.all<Point>('SELECT ts, avg AS v, min, max FROM metrics_1h WHERE series = ? AND ts BETWEEN ? AND ? ORDER BY ts', series, from, to);
    const lastTs = rows.at(-1)?.ts ?? from;
    rows = rows.concat(q.all<Point>('SELECT ts, avg AS v, min, max FROM metrics_5m WHERE series = ? AND ts > ? AND ts <= ? ORDER BY ts', series, lastTs + 3600_000, to));
  }
  return downsample(rows, maxPoints);
}

export function downsample(rows: Point[], maxPoints: number): Point[] {
  if (rows.length <= maxPoints) return rows;
  const bucket = Math.ceil(rows.length / maxPoints);
  const out: Point[] = [];
  for (let i = 0; i < rows.length; i += bucket) {
    const slice = rows.slice(i, i + bucket);
    const vs = slice.map((r) => r.v);
    out.push({
      ts: slice[0].ts,
      v: vs.reduce((a, b) => a + b, 0) / vs.length,
      min: Math.min(...slice.map((r) => r.min ?? r.v)),
      max: Math.max(...slice.map((r) => r.max ?? r.v)),
    });
  }
  return out;
}

export function listSeries(prefix: string): string[] {
  return q.all<{ series: string }>(
    `SELECT DISTINCT series FROM metrics WHERE series LIKE ? AND ts > ?`, prefix + '%', Date.now() - 86400_000,
  ).map((r) => r.series);
}

/**
 * Downsampling / retention:
 *  raw metrics 48h → 5-minute buckets 30d → 1-hour buckets 400d.
 *  raw check results 7d → hourly uptime buckets 400d.
 */
export function rollup(now = Date.now()) {
  const fiveMin = 300_000, hour = 3600_000;
  const done5 = Math.floor(now / fiveMin) * fiveMin; // only completed buckets
  const doneH = Math.floor(now / hour) * hour;
  q.tx(() => {
    q.run(
      `INSERT OR REPLACE INTO metrics_5m (series, ts, avg, min, max)
       SELECT series, (ts / ${fiveMin}) * ${fiveMin} AS b, AVG(value), MIN(value), MAX(value)
       FROM metrics WHERE ts >= ? AND ts < ? GROUP BY series, b`,
      done5 - 2 * hour, done5,
    );
    q.run(
      `INSERT OR REPLACE INTO metrics_1h (series, ts, avg, min, max)
       SELECT series, (ts / ${hour}) * ${hour} AS b, AVG(avg), MIN(min), MAX(max)
       FROM metrics_5m WHERE ts >= ? AND ts < ? GROUP BY series, b`,
      doneH - 3 * hour, doneH,
    );
    q.run(
      `INSERT OR REPLACE INTO check_hourly (check_id, ts, total, ok, latency_avg)
       SELECT check_id, (ts / ${hour}) * ${hour} AS b, COUNT(*), SUM(ok), AVG(CASE WHEN ok = 1 THEN latency_ms END)
       FROM check_results WHERE ts >= ? AND ts < ? GROUP BY check_id, b`,
      doneH - 3 * hour, doneH,
    );
    q.run('DELETE FROM metrics WHERE ts < ?', now - 48 * hour);
    q.run('DELETE FROM metrics_5m WHERE ts < ?', now - 30 * 86400_000);
    q.run('DELETE FROM metrics_1h WHERE ts < ?', now - 400 * 86400_000);
    q.run('DELETE FROM check_results WHERE ts < ?', now - 7 * 86400_000);
    q.run('DELETE FROM check_hourly WHERE ts < ?', now - 400 * 86400_000);
    q.run('DELETE FROM sessions WHERE expires_at < ?', now);
    q.run('DELETE FROM audit_log WHERE ts < ?', now - 365 * 86400_000);
  });
}
