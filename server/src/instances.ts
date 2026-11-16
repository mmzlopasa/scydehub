import { q, json } from './db.js';
import { decrypt, encrypt, isEncrypted, randomId } from './lib/crypto.js';
import { getPlugin } from './plugins/registry.js';

export interface InstanceRow {
  id: string; plugin: string; name: string; config: string; interval_sec: number;
  enabled: number; mock: number; sort: number; created_at: number;
}
export const SECRET_PLACEHOLDER = '__unchanged__';

export function listInstances(): InstanceRow[] {
  return q.all<InstanceRow>('SELECT * FROM instances ORDER BY sort, name');
}
export function getInstance(id: string) {
  return q.get<InstanceRow>('SELECT * FROM instances WHERE id = ?', id);
}

function secretKeys(pluginId: string): Set<string> {
  const p = getPlugin(pluginId);
  return new Set((p?.fields ?? []).filter((f) => f.type === 'secret').map((f) => f.key));
}

/** Full config with secrets decrypted — backend only. */
export function decryptedConfig(row: InstanceRow): Record<string, any> {
  const c = json<Record<string, any>>(row.config, {});
  for (const k of Object.keys(c)) if (isEncrypted(c[k])) c[k] = decrypt(c[k]);
  return c;
}

/** Config safe for the browser: secrets replaced by a placeholder flag. */
export function publicConfig(row: InstanceRow): Record<string, any> {
  const c = json<Record<string, any>>(row.config, {});
  const secrets = secretKeys(row.plugin);
  for (const k of Object.keys(c)) if (secrets.has(k) || isEncrypted(c[k])) c[k] = c[k] ? SECRET_PLACEHOLDER : '';
  return c;
}

/** Merge incoming config, encrypting secret fields and keeping unchanged secrets. */
export function prepareConfig(pluginId: string, incoming: Record<string, any>, existing?: InstanceRow): string {
  const secrets = secretKeys(pluginId);
  const prev = existing ? json<Record<string, any>>(existing.config, {}) : {};
  const out: Record<string, any> = {};
  const plugin = getPlugin(pluginId);
  const allowed = new Set((plugin?.fields ?? []).map((f) => f.key));
  for (const [k, v] of Object.entries(incoming ?? {})) {
    if (!allowed.has(k)) continue;
    if (secrets.has(k)) {
      if (v === SECRET_PLACEHOLDER) { if (prev[k]) out[k] = prev[k]; }
      else if (v) out[k] = encrypt(String(v));
    } else out[k] = v;
  }
  return JSON.stringify(out);
}

export function createInstance(input: { plugin: string; name: string; config: Record<string, any>; interval_sec?: number; enabled?: boolean; mock?: boolean }) {
  const p = getPlugin(input.plugin);
  if (!p) throw new Error('Unknown plugin ' + input.plugin);
  const id = randomId();
  const sort = (q.get<{ m: number }>('SELECT COALESCE(MAX(sort), 0) + 1 AS m FROM instances')?.m) ?? 0;
  q.run(
    'INSERT INTO instances (id, plugin, name, config, interval_sec, enabled, mock, sort, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    id, input.plugin, input.name, prepareConfig(input.plugin, input.config), Math.max(5, input.interval_sec ?? p.defaultInterval),
    input.enabled === false ? 0 : 1, input.mock ? 1 : 0, sort, Date.now(),
  );
  return getInstance(id)!;
}

export function updateInstance(id: string, input: Partial<{ name: string; config: Record<string, any>; interval_sec: number; enabled: boolean; mock: boolean; sort: number }>) {
  const row = getInstance(id);
  if (!row) throw new Error('not found');
  q.run(
    'UPDATE instances SET name = ?, config = ?, interval_sec = ?, enabled = ?, mock = ?, sort = ? WHERE id = ?',
    input.name ?? row.name,
    input.config ? prepareConfig(row.plugin, input.config, row) : row.config,
    Math.max(5, input.interval_sec ?? row.interval_sec),
    input.enabled === undefined ? row.enabled : input.enabled ? 1 : 0,
    input.mock === undefined ? row.mock : input.mock ? 1 : 0,
    input.sort ?? row.sort,
    id,
  );
  return getInstance(id)!;
}
