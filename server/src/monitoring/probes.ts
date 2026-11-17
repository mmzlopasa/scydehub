import { execFile } from 'node:child_process';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { Resolver } from 'node:dns/promises';
import { request } from 'undici';
import { agentFor, headerBag } from '../lib/http.js';

export interface ProbeResult { ok: boolean; latencyMs?: number; message?: string; extra?: Record<string, unknown> }
export type CheckType = 'ping' | 'tcp' | 'http' | 'ssl' | 'dns';

export async function pingProbe(host: string, timeoutSec = 2): Promise<ProbeResult> {
  // hostnames / IPs only — nothing that could be read as a ping option
  if (!/^[A-Za-z0-9]([A-Za-z0-9.:_-]{0,253})$/.test(host)) return { ok: false, message: 'Invalid host' };
  timeoutSec = Math.min(30, Math.max(1, Math.round(timeoutSec) || 2));
  return new Promise((resolve) => {
    execFile('ping', ['-c', '1', '-W', String(timeoutSec), '--', host], { timeout: (timeoutSec + 2) * 1000 }, (err, stdout, stderr) => {
      const m = /time[=<]([\d.]+)\s*ms/.exec(stdout ?? '');
      if (!err && m) return resolve({ ok: true, latencyMs: Number(m[1]) });
      if (err && ((err as any).code === 'ENOENT' || /not permitted|permission denied|socket:/i.test(String(stderr)))) {
        // no ping binary / no permission for ICMP → fall back to TCP 443/80. A refused connection is still an answer
        // from the host (it sent a reset), so the host is alive.
        const alive = (r: ProbeResult): ProbeResult => (!r.ok && /ECONNREFUSED/.test(r.message ?? '') ? { ok: true, message: 'Host answered (port closed)' } : r);
        return tcpProbe(host, 443, timeoutSec * 1000).then(alive).then((r) => (r.ok ? r : tcpProbe(host, 80, timeoutSec * 1000).then(alive))).then((r) =>
          resolve({ ...r, message: (r.message ? r.message + ' ' : '') + '(ping unavailable, used TCP)' }),
        );
      }
      resolve({ ok: false, message: 'Host is not responding to ping' });
    });
  });
}

export function tcpProbe(host: string, port: number, timeoutMs = 5000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    const sock = netConnect({ host, port });
    const done = (r: ProbeResult) => { sock.destroy(); resolve(r); };
    sock.setTimeout(timeoutMs, () => done({ ok: false, message: `Timeout (${timeoutMs} ms)` }));
    sock.once('connect', () => done({ ok: true, latencyMs: Math.round((performance.now() - start) * 10) / 10 }));
    sock.once('error', (e) => done({ ok: false, message: e.message }));
  });
}

const MAX_PROBE_BODY = 1024 * 1024;

export async function httpProbe(
  url: string,
  opts: { method?: string; expectStatus?: string; keyword?: string; invertKeyword?: boolean; insecure?: boolean; timeoutMs?: number; headers?: Record<string, string> },
): Promise<ProbeResult> {
  const start = performance.now();
  try {
    if (!/^https?:\/\//i.test(url)) return { ok: false, message: 'URL must start with http:// or https://' };
    let method = ['GET', 'HEAD', 'POST'].includes(String(opts.method).toUpperCase()) ? String(opts.method).toUpperCase() : 'GET';
    if (opts.keyword && method === 'HEAD') method = 'GET'; // a HEAD answer has no body to search
    const expected = opts.expectStatus?.trim() || '200-399';
    const matches = (status: number) => expected.split(',').some((part) => {
      const [a, b] = part.trim().split('-').map(Number);
      return b ? status >= a && status <= b : status === a;
    });
    // "expect 301": the redirect itself is the answer, do not follow it
    const wantsRedirect = !!opts.expectStatus?.trim() && [301, 302, 303, 307, 308].some(matches) && !matches(200);
    const dispatcher = agentFor({ insecure: !!opts.insecure });
    const signal = AbortSignal.timeout(Math.min(60_000, Number(opts.timeoutMs) || 10_000));
    let current = url;
    let res: { status: number; headers: ReturnType<typeof headerBag>; body: any } | undefined;
    let looped = false;
    // follow redirects by hand so custom headers (which may carry credentials) never leave the original origin
    for (let hop = 0; hop < 6; hop++) {
      const sameOrigin = new URL(current).origin === new URL(url).origin;
      // undici.request, not fetch: fetch refuses "bad ports" such as 6000 or 10080
      const r = await request(current, {
        method: method as any,
        headers: { 'user-agent': 'SCYDE-Hub/1 (uptime check)', ...(sameOrigin && opts.headers && typeof opts.headers === 'object' ? opts.headers : {}) },
        dispatcher, signal,
      });
      res = { status: r.statusCode, headers: headerBag(r.headers), body: r.body };
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc && !wantsRedirect) {
        await res.body.dump().catch(() => {});
        looped = hop === 5;
        current = new URL(loc, current).toString();
        if (!/^https?:/i.test(current)) return { ok: false, message: 'Redirect to an unsupported URL' };
        continue;
      }
      break;
    }
    if (!res) return { ok: false, message: 'No response' };
    if (looped) return { ok: false, message: 'Too many redirects' };
    let body = '';
    if (opts.keyword && res.body) {
      // read at most 1 MB — enough to find a keyword, never enough to exhaust memory
      const dec = new TextDecoder();
      let size = 0;
      for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        body += dec.decode(chunk, { stream: true });
        if (size >= MAX_PROBE_BODY) { res.body.destroy(); break; }
      }
    } else await res.body.dump().catch(() => {});
    const latencyMs = Math.round(performance.now() - start);
    if (!matches(res.status)) return { ok: false, latencyMs, message: `HTTP ${res.status} (expected ${expected})` };
    if (opts.keyword) {
      const found = body.includes(opts.keyword);
      if (found === !!opts.invertKeyword) return { ok: false, latencyMs, message: opts.invertKeyword ? `Keyword "${opts.keyword}" found` : `Keyword "${opts.keyword}" not found` };
    }
    return { ok: true, latencyMs, message: `HTTP ${res.status}` };
  } catch (e: any) {
    return { ok: false, message: e?.cause?.message ?? e?.message ?? String(e) };
  }
}

export function sslProbe(host: string, port = 443, warnDays = 14, timeoutMs = 8000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    const sock = tlsConnect({ host, port, servername: host, rejectUnauthorized: false });
    const done = (r: ProbeResult) => { sock.destroy(); resolve(r); };
    sock.setTimeout(timeoutMs, () => done({ ok: false, message: 'Timeout' }));
    sock.once('error', (e) => done({ ok: false, message: e.message }));
    sock.once('secureConnect', () => {
      const cert = sock.getPeerCertificate();
      const latencyMs = Math.round(performance.now() - start);
      if (!cert?.valid_to) return done({ ok: false, latencyMs, message: 'No certificate' });
      const expires = new Date(cert.valid_to).getTime();
      const daysLeft = Math.floor((expires - Date.now()) / 86400_000);
      const authorized = sock.authorized;
      const extra = { expiresAt: expires, daysLeft, warnDays, issuer: cert.issuer?.O ?? cert.issuer?.CN, subject: cert.subject?.CN, authorized, authError: sock.authorizationError?.toString() };
      if (daysLeft < 0) return done({ ok: false, latencyMs, message: `Certificate expired ${-daysLeft} d ago`, extra });
      // close to expiry is a warning (the "certificate expiring" rule announces it), not downtime: the site still works
      if (daysLeft < warnDays) return done({ ok: true, latencyMs, message: `Certificate expires in ${daysLeft} d`, extra });
      done({ ok: true, latencyMs, message: `Valid for ${daysLeft} more d${authorized ? '' : ' (not trusted: ' + sock.authorizationError + ')'}`, extra });
    });
  });
}

export async function dnsProbe(name: string, opts: { server?: string; recordType?: string; expect?: string }): Promise<ProbeResult> {
  const r = new Resolver({ timeout: 4000, tries: 2 });
  if (opts.server) r.setServers([opts.server]);
  const start = performance.now();
  try {
    const type = (opts.recordType ?? 'A').toUpperCase();
    const ans = (await r.resolve(name, type as any)) as unknown[];
    const flat = ans.map((a) => (typeof a === 'string' ? a : JSON.stringify(a)));
    const latencyMs = Math.round(performance.now() - start);
    if (opts.expect && !flat.some((x) => x.includes(opts.expect!))) return { ok: false, latencyMs, message: `Answer ${flat.join(', ')} does not contain ${opts.expect}` };
    return { ok: true, latencyMs, message: flat.slice(0, 3).join(', ') };
  } catch (e: any) {
    return { ok: false, message: e?.code ?? e?.message };
  }
}

export async function runProbe(type: CheckType, target: string, o: Record<string, any>): Promise<ProbeResult> {
  switch (type) {
    case 'ping': return pingProbe(target, Number(o.timeoutSec) || 2);
    case 'tcp': {
      const [h, p] = splitHostPort(target, Number(o.port) || 0);
      if (!p) return { ok: false, message: 'A port is required (host:port)' };
      return tcpProbe(h, p, Number(o.timeoutMs) || 5000);
    }
    case 'http': return httpProbe(target, o);
    case 'ssl': {
      const [h, p] = splitHostPort(target.replace(/^https?:\/\//, '').replace(/\/.*$/, ''), 443);
      return sslProbe(h, p, Number(o.warnDays) || 14);
    }
    case 'dns': return dnsProbe(target, o);
    default: return { ok: false, message: `Unknown check type "${String(type)}"` };
  }
}

function splitHostPort(s: string, defPort: number): [string, number] {
  s = s.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/.*$/, '');
  // a bare IPv6 address ("::1", "fe80::1") has several colons and no port; with a port it must be written [addr]:port
  if ((s.match(/:/g) ?? []).length > 1 && !s.startsWith('[')) return [s, defPort];
  const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(s);
  if (!m) return [s, defPort];
  return [m[1], m[2] ? Number(m[2]) : defPort];
}
