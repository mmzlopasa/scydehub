import { q, json, getSetting } from '../db.js';
import { bus } from '../lib/bus.js';
import { randomId } from '../lib/crypto.js';
import { getStates } from '../collector.js';
import { getCheckStates } from '../monitoring/checks.js';
import { sendTo } from './channels.js';
import type { Severity } from '../plugins/types.js';

export type RuleType = 'instance_down' | 'check_down' | 'metric' | 'cert_expiry' | 'plugin_alert';
export interface RuleRow {
  id: string; name: string; type: RuleType; target: string; severity: Severity; duration_sec: number;
  channels: string; enabled: number; created_at: number;
}
export interface Incident {
  id: number; rule_id: string | null; key: string; title: string; message: string | null; severity: Severity;
  started_at: number; resolved_at: number | null; acked_at: number | null; acked_by: string | null;
}

interface Condition { key: string; rule: RuleRow; title: string; message: string; severity: Severity; since: number }

const pending = new Map<string, number>();
const SEV: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

function evaluate(rules: RuleRow[]): Condition[] {
  const now = Date.now();
  const out: Condition[] = [];
  const instances = getStates();
  const checks = getCheckStates();
  for (const rule of rules) {
    const t = json<Record<string, any>>(rule.target, {});
    switch (rule.type) {
      case 'instance_down':
        for (const s of instances) {
          if (t.instanceId && t.instanceId !== s.id) continue;
          if (s.status === 'down')
            out.push({ key: `${rule.id}:${s.id}`, rule, severity: rule.severity, since: s.statusSince, title: `${s.name} is unreachable`, message: s.error ?? 'Service is not responding' });
        }
        break;
      case 'check_down':
        for (const c of checks) {
          if (t.checkId && t.checkId !== c.id) continue;
          if (c.type === 'ssl' && !t.checkId) continue; // cert problems handled by cert_expiry
          if (c.enabled && c.ok === false)
            out.push({ key: `${rule.id}:${c.id}`, rule, severity: rule.severity, since: c.statusSince, title: `${c.name} is failing its check`, message: c.message ?? `${c.type.toUpperCase()} ${c.target}` });
        }
        break;
      case 'cert_expiry':
        for (const c of checks) {
          if (c.type !== 'ssl' || (t.checkId && t.checkId !== c.id)) continue;
          const days = Number((c.extra as any)?.daysLeft);
          const limit = Number(t.days ?? 14);
          if (Number.isFinite(days) && days < limit)
            out.push({ key: `${rule.id}:${c.id}`, rule, severity: days < 3 ? 'critical' : rule.severity, since: now - rule.duration_sec * 1000, title: `Certificate for ${c.target} is expiring`, message: days < 0 ? 'Certificate has expired' : `Expires in ${days} days` });
        }
        break;
      case 'metric':
        for (const s of instances) {
          if (t.instanceId && t.instanceId !== s.id) continue;
          const v = s.metrics?.[t.metric];
          if (v === undefined || s.status === 'down') continue;
          const hit = t.op === '<' ? v < Number(t.value) : v > Number(t.value);
          const key = `${rule.id}:${s.id}:${t.metric}`;
          if (hit) {
            if (!pending.has(key)) pending.set(key, now);
            out.push({ key, rule, severity: rule.severity, since: pending.get(key)!, title: `${s.name}: ${t.label || t.metric} ${t.op ?? '>'} ${t.value}`, message: `Current: ${Math.round(v * 10) / 10}` });
          } else pending.delete(key);
        }
        break;
      case 'plugin_alert': {
        const min = SEV[(t.minSeverity as Severity) ?? 'warning'] ?? 1;
        for (const s of instances) {
          if (t.instanceId && t.instanceId !== s.id) continue;
          if (s.status === 'down' || s.status === 'disabled') continue;
          for (const a of s.alerts ?? []) {
            if (SEV[a.severity] < min) continue;
            const key = `${rule.id}:${s.id}:${a.key}`;
            if (!pending.has(key)) pending.set(key, now);
            out.push({ key, rule, severity: a.severity, since: pending.get(key)!, title: `${s.name}: ${a.message}`, message: a.message });
          }
        }
        break;
      }
    }
  }
  // forget pending keys that are no longer active
  const active = new Set(out.map((c) => c.key));
  for (const k of [...pending.keys()]) if (!active.has(k)) pending.delete(k);
  return out;
}

function publicUrl() {
  return getSetting<string>('publicUrl', '');
}

export async function tick() {
  const rules = q.all<RuleRow>('SELECT * FROM alert_rules WHERE enabled = 1');
  const conds = evaluate(rules);
  const now = Date.now();
  const open = q.all<Incident>('SELECT * FROM incidents WHERE resolved_at IS NULL');
  const openByKey = new Map(open.map((i) => [i.key, i]));
  const activeKeys = new Set<string>();
  const maintenance = getSetting<number>('maintenanceUntil', 0) > now;

  for (const c of conds) {
    activeKeys.add(c.key);
    if (openByKey.has(c.key)) continue;
    if (now - c.since < c.rule.duration_sec * 1000) continue;
    const r = q.run(
      'INSERT INTO incidents (rule_id, key, title, message, severity, started_at) VALUES (?,?,?,?,?,?)',
      c.rule.id, c.key, c.title, c.message, c.severity, c.since,
    );
    const inc = q.get<Incident>('SELECT * FROM incidents WHERE id = ?', Number(r.lastInsertRowid))!;
    bus.publish({ type: 'incident', incident: inc });
    if (!maintenance) {
      const ch = json<string[]>(c.rule.channels, []);
      void sendTo(ch.length ? ch : 'all', { title: c.title, message: c.message, severity: c.severity, url: publicUrl() || undefined });
    }
  }
  for (const inc of open) {
    if (activeKeys.has(inc.key)) continue;
    // rule removed/disabled or condition cleared → resolve
    q.run('UPDATE incidents SET resolved_at = ? WHERE id = ?', now, inc.id);
    const resolved = { ...inc, resolved_at: now };
    bus.publish({ type: 'incident', incident: resolved });
    const rule = inc.rule_id ? q.get<RuleRow>('SELECT * FROM alert_rules WHERE id = ?', inc.rule_id) : undefined;
    if (!maintenance && rule) {
      const ch = json<string[]>(rule.channels, []);
      const mins = Math.max(1, Math.round((now - inc.started_at) / 60000));
      void sendTo(ch.length ? ch : 'all', { title: `Resolved: ${inc.title}`, message: `Lasted ${mins} min`, severity: inc.severity, resolved: true });
    }
  }
}

export function ackIncident(id: number, by: string) {
  q.run('UPDATE incidents SET acked_at = ?, acked_by = ? WHERE id = ? AND acked_at IS NULL', Date.now(), by, id);
  const inc = q.get<Incident>('SELECT * FROM incidents WHERE id = ?', id);
  if (inc) bus.publish({ type: 'incident', incident: inc });
  return inc;
}

export function seedDefaultRules() {
  const n = q.get<{ n: number }>('SELECT COUNT(*) n FROM alert_rules')!.n;
  if (n > 0) return;
  const add = (name: string, type: RuleType, target: object, severity: Severity, duration: number) =>
    q.run('INSERT INTO alert_rules (id, name, type, target, severity, duration_sec, channels, enabled, created_at) VALUES (?,?,?,?,?,?,?,1,?)',
      randomId(), name, type, JSON.stringify(target), severity, duration, '[]', Date.now());
  add('Service unreachable', 'instance_down', {}, 'critical', 120);
  add('Check failing', 'check_down', {}, 'critical', 120);
  add('Certificate expiring', 'cert_expiry', { days: 14 }, 'warning', 0);
  add('Service warnings (health, backup, indexers)', 'plugin_alert', { minSeverity: 'warning' }, 'warning', 300);
}

let timer: NodeJS.Timeout | undefined;
export function startAlerts() {
  seedDefaultRules();
  timer = setInterval(() => void tick().catch((e) => console.error('[alerts]', e)), 15_000);
}
export function stopAlerts() {
  if (timer) clearInterval(timer);
}
