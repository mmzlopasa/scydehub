import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SCYDE_DATA_DIR = mkdtempSync(join(tmpdir(), 'scydehub-hosting-'));
process.env.SCYDE_SECRET_KEY = 'test-secret-key-0123456789';
const { createHttpClient } = await import('../src/lib/http.js');
const { whm } = await import('../src/plugins/whm/index.js');
const { cpanel } = await import('../src/plugins/cpanel/index.js');

/** A WHM that answers like it does for a reseller token: no server load, only the reseller's own accounts. */
async function fakeWhm() {
  const dir = mkdtempSync(join(tmpdir(), 'scydehub-whm-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=whm.local', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')], { stdio: 'ignore' });
  const deny = (fn: string) => ({ metadata: { result: 0, reason: `Permission denied: You do not have the required privileges to run “${fn}”.` } });
  const ok = (data: unknown) => ({ metadata: { result: 1 }, data });
  const server = createServer({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }, (req, res) => {
    const u = new URL(req.url!, 'https://x');
    const send = (b: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(b)); };
    switch (u.pathname) {
      case '/json-api/systemloadavg': return send(deny('systemloadavg'));
      case '/json-api/servicestatus': return send(deny('servicestatus'));
      case '/json-api/listaccts': return send(ok({ acct: [
        { user: 'alpha', domain: 'alpha.hr', suspended: 0, owner: 'shadm', diskused: '10M', disklimit: 'unlimited' },
        { user: 'beta', domain: 'beta.hr', suspended: 1, owner: 'shadm', diskused: '5M', disklimit: '1000M' },
      ] }));
      case '/json-api/uapi_cpanel': {
        const user = u.searchParams.get('cpanel.user');
        if (user !== 'alpha' && user !== 'beta') return send(ok({ uapi: { status: 0, errors: [`The user “${user}” does not exist.`] } }));
        const fn = u.searchParams.get('cpanel.function');
        const data = fn === 'list_domains' ? { main_domain: `${user}.hr`, addon_domains: ['x.hr'], sub_domains: [], parked_domains: [] }
          : fn === 'get_quota_info' ? { megabytes_used: 10, megabyte_limit: 0 } : [];
        return send(ok({ uapi: { status: 1, data } }));
      }
      default: return send(deny(u.pathname));
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `https://127.0.0.1:${(server.address() as any).port}` };
}

const ctxFor = (plugin: any, config: Record<string, any>) => {
  const h = plugin.http?.(config) ?? {};
  return { instanceId: 'x', instanceName: 'x', config, scratch: {}, tick: 1, log: () => {},
    http: createHttpClient(config.url, { headers: h.headers, tls: { insecure: true } }) };
};

test('WHM with a reseller token: shows its accounts, says what it cannot read, no fake zero load', async () => {
  const { server, url } = await fakeWhm();
  try {
    const r = await whm.collect(ctxFor(whm, { url, username: 'shadm', token: 't' }) as any);
    assert.equal((r.data as any).load, null);
    assert.equal((r.data as any).scope, 'reseller');
    assert.deepEqual((r.data as any).unavailable, ['server load', 'services']);
    assert.equal((r.data as any).accounts.total, 2);
    assert.match(r.summary!, /^2 accounts \(reseller only\) · 1 suspended$/);
  } finally { server.close(); }
});

test('cPanel via WHM: empty list = every account; unknown names fail with WHM\'s reason; http:// is refused', async () => {
  const { server, url } = await fakeWhm();
  try {
    const all = await cpanel.collect(ctxFor(cpanel, { mode: 'whm', url, username: 'shadm', token: 't', accounts: '' }) as any);
    assert.deepEqual((all.data as any).accounts.map((a: any) => a.user), ['alpha', 'beta']);
    assert.equal(all.summary, '2 accounts · 4 domains');
    await assert.rejects(cpanel.collect(ctxFor(cpanel, { mode: 'whm', url, username: 'shadm', token: 't', accounts: 'account1,account2' }) as any), /account1: The user “account1” does not exist/);
    await assert.rejects(cpanel.collect(ctxFor(cpanel, { mode: 'whm', url: 'http://cpanel.example.com', username: 'shadm', token: 't' }) as any), /Use https:\/\//);
    await assert.rejects(whm.collect(ctxFor(whm, { url: 'http://whm.example.com', username: 'root', token: 't' }) as any), /Use https:\/\//);
  } finally { server.close(); }
});
