export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: any) { super(message); }
}

const KIOSK_KEY = 'scyde.kioskToken';
export const kioskToken = {
  get: () => { try { return localStorage.getItem(KIOSK_KEY); } catch { return null; } },
  set: (t: string) => { try { localStorage.setItem(KIOSK_KEY, t); } catch { /* ignore */ } },
  clear: () => { try { localStorage.removeItem(KIOSK_KEY); } catch { /* ignore */ } },
};

/** Hook for the password re-confirmation dialog ("sudo"); set by <SudoHost/>. Resolves true once confirmed. */
let sudoPrompt: (() => Promise<boolean>) | null = null;
export const setSudoPrompt = (fn: (() => Promise<boolean>) | null) => { sudoPrompt = fn; };

async function raw(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal }) {
  const headers: Record<string, string> = { 'x-scyde': '1' };
  const tok = kioskToken.get();
  if (tok) headers.authorization = `Kiosk ${tok}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers, credentials: 'same-origin', signal: opts.signal, cache: 'no-store',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: any = undefined;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  return { res, data };
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let { res, data } = await raw(path, opts);
  // sensitive operation → ask for the password once, then retry the same request
  if (res.status === 403 && data?.sudo && sudoPrompt) {
    if (!(await sudoPrompt())) throw new ApiError(403, 'Cancelled', data);
    ({ res, data } = await raw(path, opts));
  }
  if (!res.ok) throw new ApiError(res.status, (typeof data === 'object' && data?.error) || `HTTP ${res.status}`, data);
  return data as T;
}
export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: 'POST', body });
export const patch = <T = any>(p: string, body: unknown) => api<T>(p, { method: 'PATCH', body });
export const put = <T = any>(p: string, body: unknown) => api<T>(p, { method: 'PUT', body });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });
