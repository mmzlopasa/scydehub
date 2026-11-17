import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SCYDE_DATA_DIR = mkdtempSync(join(tmpdir(), 'scydehub-tls-'));
process.env.SCYDE_SECRET_KEY = 'test-secret-key-0123456789';
const { createHttpClient } = await import('../src/lib/http.js');

/** A real HTTPS server with a self-signed certificate, like a Proxmox host on the LAN. */
function selfSigned() {
  const dir = mkdtempSync(join(tmpdir(), 'scydehub-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=pve.local',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  const cert = readFileSync(join(dir, 'cert.pem'));
  const fingerprint = createHash('sha256').update(new X509Certificate(cert).raw).digest('hex');
  return { key: readFileSync(join(dir, 'key.pem')), cert, fingerprint };
}

test('per-service TLS: self-signed refused by default, accepted when allowed, pin enforced', async () => {
  const { key, cert, fingerprint } = selfSigned();
  const server = createServer({ key, cert }, (_req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"data":[{"node":"pve"}]}'); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `https://127.0.0.1:${(server.address() as any).port}`;
  try {
    // default: an untrusted certificate is refused
    await assert.rejects(createHttpClient(base).get('/api2/json/nodes'));

    // "Accept self-signed certificate" on, no pin (this used to throw: checkServerIdentity must be a function)
    const loose = await createHttpClient(base, { tls: { insecure: true } }).get('/api2/json/nodes');
    assert.equal(loose.data[0].node, 'pve');

    // correct pin (with and without colons / upper case) → accepted
    const pinned = await createHttpClient(base, { tls: { fingerprint } }).get('/api2/json/nodes');
    assert.equal(pinned.data[0].node, 'pve');
    const colons = fingerprint.toUpperCase().match(/.{2}/g)!.join(':');
    assert.equal((await createHttpClient(base, { tls: { fingerprint: colons } }).get('/api2/json/nodes')).data[0].node, 'pve');

    // wrong pin → refused, even together with "accept self-signed"
    const wrong = 'ab'.repeat(32);
    await assert.rejects(createHttpClient(base, { tls: { fingerprint: wrong } }).get('/api2/json/nodes'), (e: any) => /fingerprint/i.test(String(e?.cause?.message ?? e?.message)));
    await assert.rejects(createHttpClient(base, { tls: { fingerprint: wrong, insecure: true } }).get('/api2/json/nodes'));
  } finally {
    server.close();
  }
});
