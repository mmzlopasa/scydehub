export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: any) { super(message); }
}

const KIOSK_KEY = 'scyde.kioskToken';
export const kioskToken = {
  get: () => { try { return localStorage.getItem(KIOSK_KEY); } catch { return null; } },
  set: (t: string) => { try { localStorage.setItem(KIOSK_KEY, t); } catch { /* ignore */ } },
  clear: () => { try { localStorage.removeItem(KIOSK_KEY); } catch { /* ignore */ } },
};

/** When the app is wrapped in a native shell, the hub URL may differ from the page origin. */
export const apiBase = '';

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-scyde': '1' };
  const tok = kioskToken.get();
  if (tok) headers.authorization = `Kiosk ${tok}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(apiBase + path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers, credentials: 'same-origin', signal: opts.signal,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: any = undefined;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `HTTP ${res.status}`, data);
  return data as T;
}
export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: 'POST', body });
export const patch = <T = any>(p: string, body: unknown) => api<T>(p, { method: 'PATCH', body });
export const put = <T = any>(p: string, body: unknown) => api<T>(p, { method: 'PUT', body });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });
