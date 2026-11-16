import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { config } from './config.js';

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const migrations: string[] = [
  /* 1 */ `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE users (
    id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, user_agent TEXT, ip TEXT);
  CREATE TABLE kiosk_tokens (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, can_ack INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER);
  CREATE TABLE instances (
    id TEXT PRIMARY KEY, plugin TEXT NOT NULL, name TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}',
    interval_sec INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, mock INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
  CREATE TABLE instance_state (
    instance_id TEXT PRIMARY KEY REFERENCES instances(id) ON DELETE CASCADE,
    status TEXT NOT NULL, summary TEXT, data TEXT, error TEXT, updated_at INTEGER NOT NULL,
    last_ok_at INTEGER, status_since INTEGER NOT NULL, latency_ms INTEGER);
  CREATE TABLE checks (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, target TEXT NOT NULL, options TEXT NOT NULL DEFAULT '{}',
    interval_sec INTEGER NOT NULL DEFAULT 60, enabled INTEGER NOT NULL DEFAULT 1, instance_id TEXT REFERENCES instances(id) ON DELETE SET NULL,
    sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
  CREATE TABLE check_results (check_id TEXT NOT NULL, ts INTEGER NOT NULL, ok INTEGER NOT NULL, latency_ms REAL, message TEXT);
  CREATE INDEX idx_check_results ON check_results(check_id, ts);
  CREATE TABLE check_hourly (check_id TEXT NOT NULL, ts INTEGER NOT NULL, total INTEGER NOT NULL, ok INTEGER NOT NULL, latency_avg REAL,
    PRIMARY KEY (check_id, ts));
  CREATE TABLE metrics (series TEXT NOT NULL, ts INTEGER NOT NULL, value REAL NOT NULL);
  CREATE INDEX idx_metrics ON metrics(series, ts);
  CREATE TABLE metrics_5m (series TEXT NOT NULL, ts INTEGER NOT NULL, avg REAL, min REAL, max REAL, PRIMARY KEY(series, ts));
  CREATE TABLE metrics_1h (series TEXT NOT NULL, ts INTEGER NOT NULL, avg REAL, min REAL, max REAL, PRIMARY KEY(series, ts));
  CREATE TABLE boards (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, sort INTEGER NOT NULL DEFAULT 0,
    in_rotation INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
  CREATE TABLE widgets (
    id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, instance_id TEXT REFERENCES instances(id) ON DELETE CASCADE,
    title TEXT, size TEXT NOT NULL DEFAULT 'M', options TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
  CREATE TABLE layouts (board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, profile TEXT NOT NULL, layout TEXT NOT NULL,
    PRIMARY KEY (board_id, profile));
  CREATE TABLE alert_rules (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, target TEXT NOT NULL DEFAULT '{}', severity TEXT NOT NULL DEFAULT 'critical',
    duration_sec INTEGER NOT NULL DEFAULT 120, channels TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
  CREATE TABLE channels (id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
  CREATE TABLE incidents (
    id INTEGER PRIMARY KEY, rule_id TEXT, key TEXT NOT NULL, title TEXT NOT NULL, message TEXT, severity TEXT NOT NULL,
    started_at INTEGER NOT NULL, resolved_at INTEGER, acked_at INTEGER, acked_by TEXT);
  CREATE INDEX idx_incidents_open ON incidents(resolved_at, key);
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT,
    params TEXT, ok INTEGER NOT NULL, result TEXT, ip TEXT);
  `,
  /* 2 — security hardening + customization + fine 24-column grid */ `
  ALTER TABLE users ADD COLUMN totp_last_counter INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sessions ADD COLUMN sudo_until INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sessions ADD COLUMN last_seen INTEGER;
  CREATE TABLE recovery_codes (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL, used_at INTEGER);
  ALTER TABLE instances ADD COLUMN display TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE boards ADD COLUMN options TEXT NOT NULL DEFAULT '{}';
  `,
];

/** Data migrations that need code (run right after the SQL migration with the same number). */
const codeMigrations: Record<number, () => void> = {
  2: () => {
    // layouts were saved for a 12/8/4-column grid; the grid is now twice as fine in both directions
    const rows = db.prepare('SELECT board_id, profile, layout FROM layouts').all() as { board_id: string; profile: string; layout: string }[];
    const upd = db.prepare('UPDATE layouts SET layout = ? WHERE board_id = ? AND profile = ?');
    for (const r of rows) {
      try {
        const l = JSON.parse(r.layout) as { i: string; x: number; y: number; w: number; h: number }[];
        upd.run(JSON.stringify(l.map((it) => ({ i: it.i, x: it.x * 2, y: it.y * 2, w: it.w * 2, h: it.h * 2 }))), r.board_id, r.profile);
      } catch { /* leave unreadable layouts alone */ }
    }
    // the previous default accent was never a deliberate choice — let the new default theme apply
    const ap = db.prepare("SELECT value FROM settings WHERE key = 'appearance'").get() as { value: string } | undefined;
    if (ap) {
      try {
        const v = JSON.parse(ap.value);
        if (String(v.accent).toLowerCase() === '#7c5cff') { delete v.accent; db.prepare("UPDATE settings SET value = ? WHERE key = 'appearance'").run(JSON.stringify(v)); }
      } catch { /* ignore */ }
    }
  },
};

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM _migrations').get() as { v: number | null };
  const current = row?.v ?? 0;
  for (let i = current; i < migrations.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[i]);
      codeMigrations[i + 1]?.();
      db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(i + 1, Date.now());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
migrate();

export type Row = Record<string, any>;
export const q = {
  all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return db.prepare(sql).all(...params) as T[];
  },
  get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return db.prepare(sql).get(...params) as T | undefined;
  },
  run(sql: string, ...params: SQLInputValue[]) {
    return db.prepare(sql).run(...params);
  },
  tx<T>(fn: () => T): T {
    db.exec('BEGIN');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  },
};

export function getSetting<T>(key: string, fallback: T): T {
  const r = q.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  if (!r) return fallback;
  try {
    return JSON.parse(r.value) as T;
  } catch {
    return fallback;
  }
}
export function setSetting(key: string, value: unknown) {
  q.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

export function json<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
