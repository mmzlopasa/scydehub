import { Agent, buildConnector, request as undiciRequest, type Dispatcher } from 'undici';
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

const MAX_BODY = 64 * 1024 * 1024;
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

/** The small part of the Headers interface the integrations use. */
export interface HeaderBag { get(name: string): string | null; getSetCookie(): string[] }
export function headerBag(h: Record<string, string | string[] | undefined>): HeaderBag {
  return {
    get: (name) => { const v = h[name.toLowerCase()]; return v == null ? null : Array.isArray(v) ? v.join(', ') : String(v); },
    getSetCookie: () => { const v = h['set-cookie']; return v == null ? [] : Array.isArray(v) ? v : [v]; },
  };
}

export class TooLarge extends Error {}
/** Read a response body, giving up as soon as it exceeds `max` bytes (a chunked response has no content-length to check). */
export async function readCapped(res: { body: any }, max: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (typeof res.body.getReader !== 'function') {
    // Node stream (undici.request)
    for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > max) {
        res.body.destroy?.();
        throw new TooLarge('Response too large');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new TooLarge('Response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
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
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
    }
    // undici.request rather than fetch: fetch refuses a list of "bad ports" (6000, 6667, 10080, …) that homelab services do use.
    // It never follows redirects, which is what we want: credentials must not travel to another address.
    let res: { status: number; headers: HeaderBag; body: any };
    try {
      const r = await undiciRequest(url, {
        method: (opts.method ?? (body ? 'POST' : 'GET')) as Dispatcher.HttpMethod,
        headers,
        body,
        dispatcher,
        signal: AbortSignal.timeout(opts.timeoutMs ?? defaults.timeoutMs ?? 10_000),
      });
      res = { status: r.statusCode, headers: headerBag(r.headers), body: r.body };
    } catch (e: any) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new Error(`No answer within ${(opts.timeoutMs ?? defaults.timeoutMs ?? 10_000) / 1000} s`);
      // a TLS-only port answers plain HTTP by closing the connection or with garbage
      const why = String(e?.cause?.message ?? e?.message ?? '');
      if (url.startsWith('http://') && /other side closed|ECONNRESET|socket hang up|HPE_|Parse Error/i.test(why))
        throw new Error(`${why} — the service may only answer over HTTPS: try https:// in the URL`);
      throw e;
    }
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BODY) throw new HttpError(res.status, `Response too large (${len} bytes) ${path}`);
    const buf = await readCapped(res, MAX_BODY).catch((e) => { throw e instanceof TooLarge ? new HttpError(res.status, `Response too large ${path}`) : e; });
    return { status: res.status, headers: res.headers as unknown as Headers, text: buf.toString('utf8') };
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
      // A page instead of data (login screen, proxy error, wrong base path) must not be mistaken for "everything is zero".
      const type = String(r.headers.get('content-type') ?? '').split(';')[0].trim();
      const method = (opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET')).toUpperCase();
      if (method === 'GET' || /html/i.test(type) || /^\s*<(!doctype|html)/i.test(r.text))
        throw new HttpError(r.status, `Expected JSON from ${path.split('?')[0]} but got ${type || 'something else'} — check the URL and base path`, r.text);
      return r.text as T; // some APIs answer writes with a plain "OK"
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
