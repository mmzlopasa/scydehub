import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SCYDE_DATA_DIR = mkdtempSync(join(tmpdir(), 'scydehub-test-'));
process.env.SCYDE_SECRET_KEY = 'test-secret-key-0123456789';

const crypto = await import('../src/lib/crypto.js');
const { downsample } = await import('../src/lib/history.js');
const { rosDuration } = await import('../src/plugins/mikrotik/index.js');
const { pick, parseFieldLines } = await import('../src/plugins/generic/index.js');
const { plugins } = await import('../src/plugins/registry.js');
const { createInstance, decryptedConfig, publicConfig, updateInstance, SECRET_PLACEHOLDER } = await import('../src/instances.js');
const { q } = await import('../src/db.js');

test('secrets: AES-GCM round trip, tamper detection', () => {
  const enc = crypto.encrypt('super-secret');
  assert.ok(enc.startsWith('enc:v1:'));
  assert.notEqual(enc, crypto.encrypt('super-secret'), 'random IV');
  assert.equal(crypto.decrypt(enc), 'super-secret');
  const bad = enc.slice(0, -4) + (enc.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  assert.throws(() => crypto.decrypt(bad));
});

test('passwords: scrypt hash verifies only the right password', () => {
  const h = crypto.hashPassword('correct horse battery');
  assert.ok(crypto.verifyPassword('correct horse battery', h));
  assert.ok(!crypto.verifyPassword('wrong', h));
});

test('TOTP matches RFC 6238 SHA1 test vectors', () => {
  const secret = crypto.base32Encode(Buffer.from('12345678901234567890'));
  // RFC 6238 Appendix B (8 digits) → last 6 digits
  assert.equal(crypto.totpCode(secret, 59_000), '287082');
  assert.equal(crypto.totpCode(secret, 1111111109_000), '081804');
  assert.equal(crypto.totpCode(secret, 1234567890_000), '005924');
  assert.ok(crypto.verifyTotp(secret, crypto.totpCode(secret)));
  assert.ok(!crypto.verifyTotp(secret, '000000') || crypto.totpCode(secret) === '000000');
});

test('base32 round trip', () => {
  const b = Buffer.from([0, 1, 2, 250, 251, 252, 253]);
  assert.deepEqual(crypto.base32Decode(crypto.base32Encode(b)), b);
});

test('history downsampling keeps min/max envelope', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ ts: i, v: i % 10 }));
  const d = downsample(rows, 100);
  assert.equal(d.length, 100);
  assert.equal(Math.min(...d.map((x) => x.min!)), 0);
  assert.equal(Math.max(...d.map((x) => x.max!)), 9);
});

test('RouterOS durations', () => {
  assert.equal(rosDuration('1w2d3h4m5s'), 604800 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  assert.equal(rosDuration('42s'), 42);
  assert.equal(rosDuration('00:01:10'), 70);
  assert.equal(rosDuration(''), null);
});

test('generic JSON field picking', () => {
  const o = { data: { users: [{ n: 3 }, { n: 7 }] }, cpu: 12.5 };
  assert.equal(pick(o, 'data.users[1].n'), 7);
  assert.equal(pick(o, 'nope.x'), undefined);
  assert.deepEqual(parseFieldLines('CPU = cpu | %\n# comment\nUsers = data.users[0].n'), [
    { label: 'CPU', path: 'cpu', unit: '%' },
    { label: 'Users', path: 'data.users[0].n', unit: '' },
  ]);
});

test('every plugin: valid metadata, mock data and widget ids', () => {
  const ids = new Set<string>();
  for (const p of plugins) {
    assert.ok(!ids.has(p.id), `duplicate plugin ${p.id}`);
    ids.add(p.id);
    assert.ok(p.widgets.length > 0, `${p.id} has widgets`);
    const ctx = { instanceId: 'x', instanceName: 'x', config: { url: 'http://x', fields: 'A = a', queries: 'A = up' }, http: {} as any, scratch: {}, tick: 3, log: () => {} };
    const r = p.mock(ctx as any);
    assert.ok(['up', 'degraded', 'down'].includes(r.status), `${p.id} status`);
    assert.ok(r.data !== undefined, `${p.id} data`);
    for (const v of Object.values(r.metrics ?? {})) assert.ok(Number.isFinite(v), `${p.id} metric finite`);
    for (const w of p.widgets) assert.ok(w.sizes.includes(w.defaultSize), `${p.id}.${w.id} default size`);
  }
});

test('instances: secrets encrypted at rest, hidden from the browser, kept when unchanged', () => {
  const row = createInstance({ plugin: 'radarr', name: 'Radarr', config: { url: 'http://r', apiKey: 'abc123', bogus: 'x' } });
  const raw = JSON.parse(q.get<{ config: string }>('SELECT config FROM instances WHERE id = ?', row.id)!.config);
  assert.ok(raw.apiKey.startsWith('enc:v1:'), 'encrypted in DB');
  assert.equal(raw.bogus, undefined, 'unknown fields dropped');
  assert.equal(publicConfig(row).apiKey, SECRET_PLACEHOLDER);
  assert.equal(decryptedConfig(row).apiKey, 'abc123');
  const updated = updateInstance(row.id, { config: { url: 'http://r2', apiKey: SECRET_PLACEHOLDER } });
  assert.equal(decryptedConfig(updated).apiKey, 'abc123', 'placeholder keeps the old secret');
  assert.equal(decryptedConfig(updated).url, 'http://r2');
});
