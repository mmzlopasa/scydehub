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

test('instances: secrets encrypted at rest, hidden from the browser, bound to instance and URL', () => {
  const row = createInstance({ plugin: 'radarr', name: 'Radarr', config: { url: 'http://r:7878', apiKey: 'abc123', bogus: 'x' } });
  const raw = JSON.parse(q.get<{ config: string }>('SELECT config FROM instances WHERE id = ?', row.id)!.config);
  assert.ok(raw.apiKey.startsWith('enc:v2:'), 'encrypted in DB, bound to the instance');
  assert.equal(raw.bogus, undefined, 'unknown fields dropped');
  assert.equal(publicConfig(row).apiKey, SECRET_PLACEHOLDER);
  assert.equal(decryptedConfig(row).apiKey, 'abc123');

  // same origin, placeholder → the stored secret is kept
  const same = updateInstance(row.id, { config: { url: 'http://r:7878/base', apiKey: SECRET_PLACEHOLDER } })!;
  assert.equal(decryptedConfig(same).apiKey, 'abc123');
  // different origin, placeholder → refused (a hijacked session must not be able to redirect a stored key)
  assert.throws(() => updateInstance(row.id, { config: { url: 'http://evil.example', apiKey: SECRET_PLACEHOLDER } }), /re-enter/);
  // different origin with the secret typed again → fine
  const moved = updateInstance(row.id, { config: { url: 'http://r2:7878', apiKey: 'new-key' } })!;
  assert.equal(decryptedConfig(moved).apiKey, 'new-key');

  // ciphertext copied into another instance does not decrypt there
  const other = createInstance({ plugin: 'sonarr', name: 'Sonarr', config: { url: 'http://s:8989', apiKey: 'zzz' } });
  const stolen = JSON.parse(q.get<{ config: string }>('SELECT config FROM instances WHERE id = ?', moved.id)!.config).apiKey;
  q.run('UPDATE instances SET config = ? WHERE id = ?', JSON.stringify({ url: 'http://s:8989', apiKey: stolen }), other.id);
  assert.equal(decryptedConfig({ ...other, config: JSON.stringify({ url: 'http://s:8989', apiKey: stolen }) }).apiKey, '');

  // ciphertext in a non-secret field is never decrypted
  assert.throws(() => updateInstance(row.id, { config: { url: stolen, apiKey: 'x' } }));
});

test('settings: unknown keys dropped, bad values ignored, kiosk view has no capability URLs', async () => {
  const { allSettings, updateSettings, kioskSettings } = await import('../src/settings.js');
  updateSettings({ appearance: { accent: 'javascript:alert(1)', radius: 12, evil: 1 }, heartbeat: null, branding: { name: 'My Lab', logo: 'http://insecure/logo.png' } } as any);
  const s = allSettings() as any;
  assert.equal(s.appearance.accent, '#FFD76A', 'invalid colour ignored');
  assert.equal(s.appearance.radius, 12);
  assert.equal(s.appearance.evil, undefined);
  assert.equal(s.heartbeat.url, '', 'null does not break the heartbeat');
  assert.equal(s.branding.name, 'My Lab');
  assert.equal(s.branding.logo, '', 'only https or data:image logos');
  updateSettings({ heartbeat: { url: 'https://hc-ping.com/secret-uuid' } });
  assert.equal((kioskSettings() as any).heartbeat, undefined);
  assert.equal((kioskSettings() as any).publicUrl, undefined);
});

test('http client refuses paths that leave the configured host', async () => {
  const { buildUrl } = await import('../src/lib/http.js');
  assert.equal(buildUrl('http://a:1/x', ''), 'http://a:1/x');
  assert.equal(buildUrl('http://a:1', '/api/v3/queue', { page: 1 }), 'http://a:1/api/v3/queue?page=1');
  assert.throws(() => buildUrl('http://a:1', 'http://evil/steal'));
  assert.throws(() => buildUrl('http://a:1', '//evil/steal'));
});

test('board templates: built-in template is valid, covers every widget, imports cleanly', async () => {
  const { COMPLETE, parseTemplate, importTemplate, exportTemplate } = await import('../src/templates.js');
  const tpl = parseTemplate(JSON.parse(JSON.stringify(COMPLETE)));
  // every widget of every integration appears at least once
  const kinds = new Set(tpl.boards.flatMap((b) => b.widgets.map((w) => w.kind)));
  for (const p of plugins) for (const w of p.widgets) assert.ok(kinds.has(`${p.id}.${w.id}`), `template is missing ${p.id}.${w.id}`);
  // widgets of a plugin kind name that plugin
  for (const b of tpl.boards) for (const w of b.widgets) {
    if (!w.kind.startsWith('core.')) assert.equal(w.plugin, w.kind.split('.')[0], `${w.kind} has the wrong plugin`);
    const [x, , ww] = w.layout.desktop!;
    assert.ok(x + ww <= 24, `${b.name}/${w.kind} sticks out of the 24-column grid`);
  }
  // no two widgets overlap on a board
  for (const b of tpl.boards) {
    const r = b.widgets.map((w) => w.layout.desktop!);
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      const [ax, ay, aw, ah] = r[i], [bx, by, bw, bh] = r[j];
      assert.ok(!(ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by), `${b.name}: ${b.widgets[i].kind} overlaps ${b.widgets[j].kind}`);
    }
  }
  const before = q.get<{ n: number }>('SELECT COUNT(*) n FROM instances')!.n;
  const skip = importTemplate(tpl, { createMissing: false, replace: false });
  assert.ok(skip.skipped > 0 && skip.missing.length > 0, 'without createMissing, widgets of absent services are skipped');
  assert.equal(q.get<{ n: number }>('SELECT COUNT(*) n FROM instances')!.n, before, 'no services created');
  const full = importTemplate(tpl, { createMissing: true, replace: true });
  assert.equal(full.skipped, 0);
  assert.equal(full.boards, tpl.boards.length);
  assert.equal(q.get<{ n: number }>('SELECT COUNT(*) n FROM boards')!.n, tpl.boards.length, 'replace removed the earlier boards');
  for (const c of full.created) assert.equal(q.get<{ mock: number }>('SELECT mock FROM instances WHERE id = ?', c.id)!.mock, 1, 'placeholders are mock');
  // round trip
  const again = parseTemplate(JSON.parse(JSON.stringify(exportTemplate())));
  assert.equal(again.boards.reduce((n, b) => n + b.widgets.length, 0), full.widgets);
  assert.throws(() => parseTemplate({ app: 'scydehub-template', boards: [{ name: 'x', widgets: [{ kind: 'DROP TABLE', layout: {} }] }] }));
});
