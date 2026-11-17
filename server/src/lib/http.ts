import { Agent, buildConnector, fetch, type Dispatcher } from 'undici';
import { createHash } from 'node:crypto';
import type { TLSSocket } from 'node:tls';

export interface TlsOptions {
  /** Accept self-signed / invalid certificates for THIS service only. */
  insecure?: boolean;
  /** Optional SHA-256 fingerprint pin (hex, colons optional). Safer than `insecure`. */
  fingerprint?: string;
  /** Optional custom CA (PEM). */
  ca?: string;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public body?: string) {
    super(message);
  }
}

const MAX_BODY = 32 * 1024 * 1024;
const agents = new Map<string, Dispatcher>();
const defaultAgent = new Agent({ connect: { timeout: 8000 }, keepAliveTimeout: 10_000 });

function normFp(fp: string) {
  return fp.replace(/[^a-f0-9]/gi, '').toLowerCase();
}

export function agentFor(tls?: TlsOptions): Dispatcher {
  if (!tls || (!tls.insecure && !tls.fingerprint && !tls.ca)) return defaultAgent;
  const k = JSON.stringify([!!tls.insecure, tls.fingerprint ?? '', tls.ca ?? '']);
  let a = agents.get(k);
  if (!a) {
    const pin = tls.fingerprint ? normFp(tls.fingerprint) : null;
    // With a pin the CA chain is not consulted at all: the certificate must be exactly the pinned one.
    const connector = buildConnector({ timeout: 8000, ...(tls.ca ? { ca: tls.ca } : {}), rejectUnauthorized: !(tls.insecure || pin) });
    a = new Agent({
      keepAliveTimeout: 10_000,
      connect: pin
        ? (opts: any, cb: (err: Error | null, socket: any) => void) =>
            connector(opts, (err, socket) => {
              if (err || !socket) return cb(err ?? new Error('connect failed'), null);
              // Node skips the identity callback for untrusted chains, so the fingerprint is compared here,
              // right after the handshake and before a single byte of the request (or a credential) is sent.
              const raw = opts.protocol === 'https:' ? (socket as TLSSocket).getPeerCertificate()?.raw : undefined;
              const got = raw ? createHash('sha256').update(raw).digest('hex') : '';
              if (got !== pin) {
                socket.destroy();
                return cb(new Error(raw ? `TLS fingerprint mismatch (got ${got})` : 'TLS fingerprint pin set, but the connection is not HTTPS'), null);
              }
              cb(null, socket);
            })
        : connector,
    });
    agents.set(k, a);
  }
  return a;
}

export interface RequestOpts {
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  form?: Record<string, string>;
  timeoutMs?: number;
  /** return raw text instead of parsing JSON */
  text?: boolean;
}

export interface HttpClient {
  baseUrl: string;
  request<T = any>(path: string, opts?: RequestOpts): Promise<T>;
  get<T = any>(path: string, opts?: Omit<RequestOpts, 'method'>): Promise<T>;
  post<T = any>(path: string, body?: unknown, opts?: Omit<RequestOpts, 'method' | 'body'>): Promise<T>;
  raw(path: string, opts?: RequestOpts): Promise<{ status: number; headers: Headers; text: string }>;
}

export function buildUrl(base: string, path: string, query?: RequestOpts['query']) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) throw new Error('Absolute URLs are not allowed as a path');
  const u = new URL(path === '' ? base : base.replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path));
  if (u.origin !== new URL(base).origin) throw new Error('Path must stay on the configured host');
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, String(v));
  return u.toString();
}

export function createHttpClient(baseUrl: string, defaults: { headers?: Record<string, string>; tls?: TlsOptions; timeoutMs?: number } = {}): HttpClient {
  const dispatcher = agentFor(defaults.tls);
  async function raw(path: string, opts: RequestOpts = {}) {
    const url = buildUrl(baseUrl, path, opts.query);
    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'SCYDE-Hub/1', ...defaults.headers, ...opts.headers };
    let body: string | undefined;
    if (opts.form) {
      body = new URLSearchParams(opts.form).toString();
      headers['content-type'] = 'application/x-www-form-urlencoded';
    } else if (opts.body !== undefined) {
      body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      headers['content-type'] ??= 'application/json';
    }
    const res = await fetch(url, {
      method: opts.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      dispatcher,
      signal: AbortSignal.timeout(opts.timeoutMs ?? defaults.timeoutMs ?? 10_000),
      redirect: 'manual',
    } as any);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BODY) throw new HttpError(res.status, `Response too large (${len} bytes) ${path}`);
    const text = await res.text();
    if (text.length > MAX_BODY) throw new HttpError(res.status, `Response too large ${path}`);
    return { status: res.status, headers: res.headers as unknown as Headers, text };
  }
  async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
    const r = await raw(path, opts);
    if (r.status >= 400 || (r.status >= 300 && r.status < 400)) {
      // The message ends up in widget state (visible to read-only kiosks) and logs: never include the
      // response body or the query string (both may carry credentials). The body stays on the error object.
      let hint = '';
      if (r.status >= 300 && r.status < 400) {
        // redirects are never followed (credentials must not travel to another address) — say what to change instead
        const loc = String(r.headers.get('location') ?? '');
        const url = buildUrl(baseUrl, path);
        if (url.startsWith('http://') && loc.startsWith('https://')) hint = ' — this service only answers over HTTPS: change the URL to start with https://';
        else if (loc) {
          let where = '';
          try { where = new URL(loc, url).origin; } catch { /* ignore */ }
          hint = where && where !== new URL(url).origin ? ` — the service redirects to ${where}: use that address as the URL` : ' — the service redirects (often to a login page): check the URL and base path';
        }
      }
      throw new HttpError(r.status, `HTTP ${r.status} ${path.split('?')[0]}${hint}`, r.text);
    }
    if (opts.text) return r.text as T;
    if (!r.text) return undefined as T;
    try {
      return JSON.parse(r.text) as T;
    } catch {
      return r.text as T;
    }
  }
  return {
    baseUrl,
    raw,
    request,
    get: (p, o) => request(p, { ...o, method: 'GET' }),
    post: (p, b, o) => request(p, { ...o, method: 'POST', body: b }),
  };
}
