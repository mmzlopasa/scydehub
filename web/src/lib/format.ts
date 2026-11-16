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
export const num = (n?: number | null) => (n == null ? '—' : n.toLocaleString('hr-HR'));

export function duration(sec?: number | null, parts = 2): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—';
  const units: [string, number][] = [['g', 31536000], ['d', 86400], ['h', 3600], ['m', 60], ['s', 1]];
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
  const d = (Date.now() - t) / 1000;
  if (d < 0) return 'za ' + duration(-d, 1);
  if (d < 10) return 'upravo';
  return `prije ${duration(d, 1)}`;
}
export function until(ts?: number | string | null): string {
  if (!ts) return '—';
  const t = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  const d = (t - Date.now()) / 1000;
  if (Math.abs(d) < 3600 * 12 && new Date(t).getDate() === new Date().getDate()) return 'danas ' + time(t);
  return d < 0 ? ago(t) : 'za ' + duration(d, 1);
}
export const time = (ts: number | string) => new Date(ts).toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' });
export const dateShort = (ts: number | string) => new Date(ts).toLocaleDateString('hr-HR', { day: 'numeric', month: 'short' });
export const dateTime = (ts: number | string) => new Date(ts).toLocaleString('hr-HR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export function dayLabel(ts: number | string) {
  const d = new Date(ts); const n = new Date();
  const diff = Math.round((new Date(d.toDateString()).getTime() - new Date(n.toDateString()).getTime()) / 86400_000);
  if (diff === 0) return 'Danas';
  if (diff === 1) return 'Sutra';
  if (diff === -1) return 'Jučer';
  return d.toLocaleDateString('hr-HR', { weekday: 'short', day: 'numeric', month: 'short' });
}
