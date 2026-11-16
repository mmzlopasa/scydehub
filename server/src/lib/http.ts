import { Agent, fetch, type Dispatcher } from 'undici';
import { createHash } from 'node:crypto';
import type { PeerCertificate } from 'node:tls';

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
    a = new Agent({
      keepAliveTimeout: 10_000,
      connect: {
        timeout: 8000,
        ca: tls.ca || undefined,
        // With a fingerprint pin we verify the leaf cert ourselves instead of the CA chain.
        rejectUnauthorized: !(tls.insecure || pin),
        checkServerIdentity: pin
          ? (_host: string, cert: PeerCertificate) => {
              const got = createHash('sha256').update(cert.raw).digest('hex');
              return got === pin ? undefined : new Error(`TLS fingerprint mismatch (got ${got})`);
            }
          : undefined,
      },
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
  const u = new URL(path.startsWith('http') ? path : base.replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path));
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
    const text = await res.text();
    return { status: res.status, headers: res.headers as unknown as Headers, text };
  }
  async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
    const r = await raw(path, opts);
    if (r.status >= 400 || (r.status >= 300 && r.status < 400)) {
      const short = r.text.slice(0, 200).replace(/\s+/g, ' ');
      throw new HttpError(r.status, `HTTP ${r.status} ${path}${short ? ' — ' + short : ''}`, r.text);
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
