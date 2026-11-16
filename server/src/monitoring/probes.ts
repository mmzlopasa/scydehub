import { execFile } from 'node:child_process';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { Resolver } from 'node:dns/promises';
import { fetch } from 'undici';
import { agentFor } from '../lib/http.js';

export interface ProbeResult { ok: boolean; latencyMs?: number; message?: string; extra?: Record<string, unknown> }
export type CheckType = 'ping' | 'tcp' | 'http' | 'ssl' | 'dns';

export async function pingProbe(host: string, timeoutSec = 2): Promise<ProbeResult> {
  return new Promise((resolve) => {
    execFile('ping', ['-c', '1', '-W', String(timeoutSec), host], { timeout: (timeoutSec + 2) * 1000 }, (err, stdout) => {
      const m = /time[=<]([\d.]+)\s*ms/.exec(stdout ?? '');
      if (!err && m) return resolve({ ok: true, latencyMs: Number(m[1]) });
      if (err && (err as any).code === 'ENOENT') {
        // no ping binary / no NET_RAW → fall back to TCP 443/80
        return tcpProbe(host, 443, timeoutSec * 1000).then((r) => (r.ok ? r : tcpProbe(host, 80, timeoutSec * 1000))).then((r) =>
          resolve({ ...r, message: (r.message ? r.message + ' ' : '') + '(ping nedostupan, korišten TCP)' }),
        );
      }
      resolve({ ok: false, message: 'Host ne odgovara na ping' });
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

export async function httpProbe(
  url: string,
  opts: { method?: string; expectStatus?: string; keyword?: string; invertKeyword?: boolean; insecure?: boolean; timeoutMs?: number; headers?: Record<string, string> },
): Promise<ProbeResult> {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'user-agent': 'SCYDE-Hub/1 (uptime check)', ...(opts.headers ?? {}) },
      dispatcher: agentFor({ insecure: !!opts.insecure }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      redirect: 'follow',
    } as any);
    const body = opts.keyword ? await res.text() : (await res.arrayBuffer(), '');
    const latencyMs = Math.round(performance.now() - start);
    const expected = opts.expectStatus?.trim() || '200-399';
    const statusOk = expected.split(',').some((part) => {
      const [a, b] = part.trim().split('-').map(Number);
      return b ? res.status >= a && res.status <= b : res.status === a;
    });
    if (!statusOk) return { ok: false, latencyMs, message: `HTTP ${res.status} (očekivano ${expected})` };
    if (opts.keyword) {
      const found = body.includes(opts.keyword);
      if (found === !!opts.invertKeyword) return { ok: false, latencyMs, message: opts.invertKeyword ? `Pronađena riječ "${opts.keyword}"` : `Nema riječi "${opts.keyword}"` };
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
      if (!cert?.valid_to) return done({ ok: false, latencyMs, message: 'Nema certifikata' });
      const expires = new Date(cert.valid_to).getTime();
      const daysLeft = Math.floor((expires - Date.now()) / 86400_000);
      const authorized = sock.authorized;
      const extra = { expiresAt: expires, daysLeft, issuer: cert.issuer?.O ?? cert.issuer?.CN, subject: cert.subject?.CN, authorized, authError: sock.authorizationError?.toString() };
      if (daysLeft < 0) return done({ ok: false, latencyMs, message: `Certifikat istekao prije ${-daysLeft} d`, extra });
      if (daysLeft < warnDays) return done({ ok: false, latencyMs, message: `Certifikat ističe za ${daysLeft} d`, extra });
      done({ ok: true, latencyMs, message: `Vrijedi još ${daysLeft} d${authorized ? '' : ' (nije pouzdan: ' + sock.authorizationError + ')'}`, extra });
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
    if (opts.expect && !flat.some((x) => x.includes(opts.expect!))) return { ok: false, latencyMs, message: `Odgovor ${flat.join(', ')} ne sadrži ${opts.expect}` };
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
      return tcpProbe(h, p, Number(o.timeoutMs) || 5000);
    }
    case 'http': return httpProbe(target, o);
    case 'ssl': {
      const [h, p] = splitHostPort(target.replace(/^https?:\/\//, '').replace(/\/.*$/, ''), 443);
      return sslProbe(h, p, Number(o.warnDays) || 14);
    }
    case 'dns': return dnsProbe(target, o);
  }
}

function splitHostPort(s: string, defPort: number): [string, number] {
  const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(s.trim());
  if (!m) return [s, defPort];
  return [m[1], m[2] ? Number(m[2]) : defPort];
}
