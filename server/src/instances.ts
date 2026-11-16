import { q, json } from './db.js';
import { decrypt, encrypt, isEncrypted, isLegacyCipher, randomId } from './lib/crypto.js';
import { getPlugin } from './plugins/registry.js';

export interface InstanceRow {
  id: string; plugin: string; name: string; config: string; interval_sec: number;
  enabled: number; mock: number; sort: number; created_at: number; display?: string;
}
export const SECRET_PLACEHOLDER = '__unchanged__';
export const MIN_INTERVAL = 5;
export const MAX_INTERVAL = 86_400;
export const clampInterval = (v: unknown, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, n)) : fallback;
};

export class InputError extends Error {}

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
const aad = (instanceId: string, field: string) => `inst:${instanceId}:${field}`;

/** Full config with secrets decrypted — backend only. Only fields the plugin declares as secret are ever
 *  decrypted, so ciphertext pasted into a plain field stays ciphertext. */
export function decryptedConfig(row: InstanceRow): Record<string, any> {
  const c = json<Record<string, any>>(row.config, {});
  const secrets = secretKeys(row.plugin);
  for (const k of Object.keys(c)) {
    if (!isEncrypted(c[k])) continue;
    if (!secrets.has(k)) { delete c[k]; continue; }
    try {
      c[k] = decrypt(c[k], aad(row.id, k));
    } catch {
      c[k] = ''; // wrong key or ciphertext that belongs to another instance/field
    }
  }
  return c;
}

/** Config safe for the browser: secrets replaced by a placeholder flag. */
export function publicConfig(row: InstanceRow): Record<string, any> {
  const c = json<Record<string, any>>(row.config, {});
  const secrets = secretKeys(row.plugin);
  for (const k of Object.keys(c)) if (secrets.has(k) || isEncrypted(c[k])) c[k] = c[k] ? SECRET_PLACEHOLDER : '';
  return c;
}

const originOf = (u: unknown) => {
  try { return new URL(String(u)).origin; } catch { return String(u ?? ''); }
};

/**
 * Merge incoming config, encrypting secret fields.
 * A stored secret is only kept (placeholder) while the service URL still points at the same origin —
 * otherwise an attacker with a session could repoint the service at their own host and collect the key.
 */
export function prepareConfig(pluginId: string, instanceId: string, incoming: Record<string, any>, existing?: InstanceRow): string {
  const plugin = getPlugin(pluginId);
  if (!plugin) throw new InputError('Unknown plugin');
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new InputError('config must be an object');
  const secrets = secretKeys(pluginId);
  const prev = existing ? json<Record<string, any>>(existing.config, {}) : {};
  const out: Record<string, any> = {};
  const originChanged = !!existing && 'url' in incoming && originOf(incoming.url) !== originOf(prev.url);
  for (const f of plugin.fields) {
    const v = incoming[f.key];
    if (v === undefined || v === null) continue;
    if (f.type === 'secret') {
      if (v === SECRET_PLACEHOLDER) {
        if (!prev[f.key]) continue;
        if (originChanged) throw new InputError(`The URL changed — re-enter "${f.label}" (stored secrets are never sent to a new address)`);
        out[f.key] = prev[f.key];
      } else if (v !== '') {
        if (typeof v !== 'string' || v.length > 8192) throw new InputError(`${f.label}: invalid value`);
        out[f.key] = encrypt(v, aad(instanceId, f.key));
      }
    } else if (f.type === 'boolean') out[f.key] = v === true || v === 'true' || v === 1;
    else if (f.type === 'number') { if (v !== '' && Number.isFinite(Number(v))) out[f.key] = Number(v); }
    else {
      if (typeof v !== 'string' && typeof v !== 'number') throw new InputError(`${f.label}: invalid value`);
      const sv = String(v);
      if (sv.length > (f.type === 'text' ? 20_000 : 2048)) throw new InputError(`${f.label}: too long`);
      if (isEncrypted(sv)) throw new InputError(`${f.label}: invalid value`);
      if (f.type === 'url' && sv && !/^https?:\/\/[^\s]+$/i.test(sv)) throw new InputError(`${f.label}: must start with http:// or https://`);
      if (f.type === 'select' && f.options && !f.options.some((o) => o.value === sv)) throw new InputError(`${f.label}: unknown option`);
      out[f.key] = sv;
    }
  }
  return JSON.stringify(out);
}

const cleanName = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : fallback);

/** per-instance look: custom icon (slug, https URL or data: image) and colour */
export function cleanDisplay(v: unknown): string {
  const d = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  if (typeof d.icon === 'string' && d.icon.length <= 400_000 && (/^[a-z0-9-]{1,64}$/.test(d.icon) || /^https:\/\/[^\s]+$/.test(d.icon) || /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(d.icon))) out.icon = d.icon;
  if (typeof d.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(d.color)) out.color = d.color;
  return JSON.stringify(out);
}

export function createInstance(input: { plugin: string; name: string; config: Record<string, any>; interval_sec?: number; enabled?: boolean; mock?: boolean; display?: unknown }) {
  const p = getPlugin(String(input?.plugin));
  if (!p) throw new InputError('Unknown plugin');
  const id = randomId();
  const sort = (q.get<{ m: number }>('SELECT COALESCE(MAX(sort), 0) + 1 AS m FROM instances')?.m) ?? 0;
  q.run(
    'INSERT INTO instances (id, plugin, name, config, interval_sec, enabled, mock, sort, created_at, display) VALUES (?,?,?,?,?,?,?,?,?,?)',
    id, p.id, cleanName(input.name, p.name), prepareConfig(p.id, id, input.config ?? {}), clampInterval(input.interval_sec, p.defaultInterval),
    input.enabled === false ? 0 : 1, input.mock ? 1 : 0, sort, Date.now(), cleanDisplay(input.display),
  );
  return getInstance(id)!;
}

export function updateInstance(id: string, input: Partial<{ name: string; config: Record<string, any>; interval_sec: number; enabled: boolean; mock: boolean; sort: number; display: unknown }>) {
  const row = getInstance(id);
  if (!row) return undefined;
  q.run(
    'UPDATE instances SET name = ?, config = ?, interval_sec = ?, enabled = ?, mock = ?, sort = ?, display = ? WHERE id = ?',
    cleanName(input.name, row.name),
    input.config ? prepareConfig(row.plugin, id, input.config, row) : row.config,
    clampInterval(input.interval_sec, row.interval_sec),
    input.enabled === undefined ? row.enabled : input.enabled ? 1 : 0,
    input.mock === undefined ? row.mock : input.mock ? 1 : 0,
    Number.isFinite(Number(input.sort)) ? Number(input.sort) : row.sort,
    input.display === undefined ? row.display ?? '{}' : cleanDisplay(input.display),
    id,
  );
  return getInstance(id)!;
}

/** One-time upgrade: bind legacy (v1) ciphertexts to their instance + field. */
export function upgradeInstanceSecrets() {
  for (const row of listInstances()) {
    const c = json<Record<string, any>>(row.config, {});
    const secrets = secretKeys(row.plugin);
    let changed = false;
    for (const k of Object.keys(c)) {
      if (!isLegacyCipher(c[k])) continue;
      if (!secrets.has(k)) { delete c[k]; changed = true; continue; }
      try {
        c[k] = encrypt(decrypt(c[k]), aad(row.id, k));
        changed = true;
      } catch { /* undecryptable (different SCYDE_SECRET_KEY) — leave as is */ }
    }
    if (changed) q.run('UPDATE instances SET config = ? WHERE id = ?', JSON.stringify(c), row.id);
  }
}
