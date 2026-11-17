/** Locale / formatting preferences (set from Settings → Customization → Regional). */
let _locale = 'en-GB';
let _hour12 = false;
export const locale = () => _locale;
export function setLocale(l?: string, hour12?: boolean) {
  if (l) try { new Intl.DateTimeFormat(l); _locale = l; } catch { /* not a locale this browser knows: keep the old one */ }
  if (hour12 !== undefined) _hour12 = hour12;
}
const hc = () => ({ hour12: _hour12 });

export function bytes(n?: number | null, digits = 1): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0, v = Math.abs(n);
  while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return `${(n < 0 ? -v : v).toFixed(v >= 100 || i === 0 ? 0 : digits)} ${u[i]}`;
}
export function bits(bps?: number | null): string {
  if (bps === undefined || bps === null) return '—';
  const u = ['bps', 'Kbps', 'Mbps', 'Gbps'];
  let i = 0, v = bps;
  while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
export const speed = (bps?: number | null) => (bps == null ? '—' : `${bytes(bps)}/s`);
export const pct = (v?: number | null, d = 0) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}%`);
export const ratio = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
export const num = (n?: number | null) => (n == null ? '—' : n.toLocaleString(_locale));

export function duration(sec?: number | null, parts = 2): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—';
  const units: [string, number][] = [['y', 31536000], ['d', 86400], ['h', 3600], ['m', 60], ['s', 1]];
  const out: string[] = [];
  let s = Math.floor(sec);
  for (const [l, v] of units) {
    if (s >= v || (l === 's' && out.length === 0)) { out.push(`${Math.floor(s / v)}${l}`); s %= v; }
    if (out.length >= parts) break;
  }
  return out.join(' ');
}
export function ago(ts?: number | string | null): string {
  if (!ts) return '—';
  const t = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  if (!Number.isFinite(t)) return '—';
  const d = (Date.now() - t) / 1000;
  if (d < 0) return 'in ' + duration(-d, 1);
  if (d < 10) return 'just now';
  return `${duration(d, 1)} ago`;
}
export function until(ts?: number | string | null): string {
  if (!ts) return '—';
  const t = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  const d = (t - Date.now()) / 1000;
  if (Math.abs(d) < 3600 * 12 && new Date(t).getDate() === new Date().getDate()) return 'today ' + time(t);
  return d < 0 ? ago(t) : 'in ' + duration(d, 1);
}
export const time = (ts: number | string) => new Date(ts).toLocaleTimeString(_locale, { hour: '2-digit', minute: '2-digit', ...hc() });
export const timeSec = (ts: number | string) => new Date(ts).toLocaleTimeString(_locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', ...hc() });
export const dateShort = (ts: number | string) => new Date(ts).toLocaleDateString(_locale, { day: 'numeric', month: 'short' });
export const dateLong = (ts: number | string) => new Date(ts).toLocaleDateString(_locale, { weekday: 'long', day: 'numeric', month: 'long' });
export const weekday = (ts: number | string) => new Date(ts).toLocaleDateString(_locale, { weekday: 'short' });
export const dateTime = (ts: number | string) => new Date(ts).toLocaleString(_locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...hc() });
export function dayLabel(ts: number | string) {
  // a bare date ("2026-11-20") would be read as midnight UTC and land on the previous day west of Greenwich
  const d = new Date(typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ts) ? ts + 'T12:00' : ts); const n = new Date();
  const diff = Math.round((new Date(d.toDateString()).getTime() - new Date(n.toDateString()).getTime()) / 86400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString(_locale, { weekday: 'short', day: 'numeric', month: 'short' });
}
