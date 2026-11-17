import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SCYDE_DATA_DIR = mkdtempSync(join(tmpdir(), 'scydehub-review-'));
process.env.SCYDE_SECRET_KEY = 'test-secret-key-0123456789';
const { parseFieldLines } = await import('../src/plugins/generic/index.js');
const { createHttpClient } = await import('../src/lib/http.js');
const { updateSettings, allSettings } = await import('../src/settings.js');
const { httpProbe, runProbe } = await import('../src/monitoring/probes.js');

test('field lines: PromQL with label matchers, regex alternation and comparisons survives', () => {
  const [a, b, c, d, e] = parseFieldLines([
    'Temp = node_hwmon_temp_celsius{chip="platform_coretemp_0"} | °C',
    'up{job=~"node|cadvisor"} == 1',
    'Ratio = a >= b',
    'Users = data.users | ',
    'stats.cpu | %',
  ].join('\n'));
  assert.deepEqual(a, { label: 'Temp', path: 'node_hwmon_temp_celsius{chip="platform_coretemp_0"}', unit: '°C' });
  assert.equal(b.path, 'up{job=~"node|cadvisor"} == 1');
  assert.deepEqual(c, { label: 'Ratio', path: 'a >= b', unit: '' });
  assert.deepEqual(d, { label: 'Users', path: 'data.users', unit: '' });
  assert.deepEqual(e, { label: 'stats.cpu', path: 'stats.cpu', unit: '%' });
});

test('settings: wrong types and out-of-range numbers are refused, enums are enforced', () => {
  const before = allSettings();
  updateSettings({
    appearance: { radius: [], blur: true, fontScale: ' ', cardOpacity: -99999, theme: '<x>', animations: 'off' },
    kiosk: { rotationSec: -5, nightDim: { level: '0x10' } }, weather: { lat: 99999 }, regional: { locale: 'en-a1' },
  } as any);
  const s = allSettings();
  assert.equal(s.appearance.radius, before.appearance.radius);
  assert.equal(s.appearance.blur, before.appearance.blur);
  assert.equal(s.appearance.fontScale, before.appearance.fontScale);
  assert.equal(s.appearance.cardOpacity, 0);
  assert.equal(s.appearance.theme, before.appearance.theme);
  assert.equal(s.appearance.animations, 'off');
  assert.equal(s.kiosk.rotationSec, 0);
  assert.equal(s.kiosk.nightDim.level, before.kiosk.nightDim.level);
  assert.equal(s.weather.lat, 90);
  assert.equal(s.regional.locale, before.regional.locale);
});

test('http client and probes: a page is not data, redirect loops fail, expected redirects pass', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/html') { res.setHeader('content-type', 'text/html'); return res.end('<!doctype html><title>Login</title>'); }
    if (req.url === '/ok') { res.setHeader('content-type', 'text/plain'); return res.end('OK\n'); }
    if (req.url === '/loop') { res.statusCode = 302; res.setHeader('location', '/loop'); return res.end(); }
    if (req.url === '/moved') { res.statusCode = 301; res.setHeader('location', '/json'); return res.end(); }
    res.setHeader('content-type', 'application/json'); res.end('{"a":1}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const http = createHttpClient(base);
    assert.deepEqual(await http.get('/json'), { a: 1 });
    await assert.rejects(http.get('/html'), /Expected JSON/);
    assert.equal(await http.post('/ok', {}), 'OK\n'); // a write answered with plain text is fine
    await assert.rejects(http.get('/moved'), /HTTP 301/); // never followed: credentials stay on the configured host
    assert.deepEqual(await httpProbe(`${base}/loop`, {}).then((r) => [r.ok, r.message]), [false, 'Too many redirects']);
    assert.equal((await httpProbe(`${base}/moved`, { expectStatus: '301' })).ok, true);
    assert.equal((await httpProbe(`${base}/moved`, {})).ok, true); // followed to /json
    assert.equal((await httpProbe(`${base}/html`, { method: 'HEAD', keyword: 'Login' })).ok, true);
    assert.equal((await runProbe('tcp', '127.0.0.1', {})).message, 'A port is required (host:port)');
    assert.equal((await runProbe('tcp', `tcp://127.0.0.1:${(server.address() as any).port}`, {})).ok, true);
  } finally {
    server.close();
  }
});
