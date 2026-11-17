import { useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, CloudRain, CloudSnow, CloudSun, Sun, CloudLightning, CloudFog, ExternalLink, AlertOctagon, CheckCircle2, BellOff } from 'lucide-react';
import type { WidgetProps } from '../types';
import { useStore } from '../../lib/store';
import { useHistory, useNow } from '../../lib/hooks';
import { get, post } from '../../lib/api';
import { Badge, Empty, ServiceIcon, StatusDot, Button, cx } from '../../components/ui';
import { AreaChart, UptimeBar, Sparkline } from '../../components/charts';
import { ago, dateLong, dateTime, duration, locale, time } from '../../lib/format';
import { List, Row } from '../common';
import { CalendarList } from '../services/arr';
import { toast } from '../../components/feedback';
import { metricFormat, metricLabel } from '../../lib/metrics';

export function Clock({ size, w }: WidgetProps) {
  const now = useNow(1000);
  const d = new Date(now);
  const seconds = w.options?.seconds !== false; // the digits scale with the card, so seconds fit at every size
  // the digits scale with the card itself (container units), so the clock fills any size without overflowing
  return (
    <div className="flex h-full flex-col justify-center [container-type:size]">
      <div className="dot whitespace-nowrap font-semibold leading-none tracking-tight" style={{ fontSize: `clamp(1.6rem, min(${seconds ? 19 : 25}cqw, 52cqh), 9rem)` }}>
        {time(now)}
        {seconds && <span className="text-accent" style={{ fontSize: '.42em' }}>:{String(d.getSeconds()).padStart(2, '0')}</span>}
      </div>
      <div className="mt-[.5em] truncate capitalize text-muted" style={{ fontSize: 'clamp(.75rem, 5cqw, 1.1rem)' }}>{dateLong(now)}</div>
    </div>
  );
}

const WMO = (c: number) =>
  c === 0 ? [Sun, 'Clear'] : c <= 2 ? [CloudSun, 'Partly cloudy'] : c === 3 ? [Cloud, 'Cloudy'] : c <= 48 ? [CloudFog, 'Fog'] : c <= 67 ? [CloudRain, 'Rain'] : c <= 77 ? [CloudSnow, 'Snow'] : c <= 82 ? [CloudRain, 'Showers'] : c <= 86 ? [CloudSnow, 'Snow'] : [CloudLightning, 'Thunderstorm'];
export function Weather({ w, size }: WidgetProps) {
  const settings = useStore((s) => s.settings);
  const coord = (v: unknown, max: number) => { const n = v === '' || v == null ? NaN : Number(v); return Number.isFinite(n) && Math.abs(n) <= max ? n : undefined; };
  const olat = coord(w.options?.lat, 90), olon = coord(w.options?.lon, 180);
  // the widget's own place only when both coordinates are usable; otherwise the one from Settings
  const loc = olat !== undefined && olon !== undefined ? { lat: olat, lon: olon, name: w.options?.name || settings?.weather?.name } : { ...settings?.weather };
  const [wx, setWx] = useState<any>(null);
  useEffect(() => {
    if (loc.lat == null || loc.lon == null) return;
    setWx(null);
    const load = () =>
      get(`/api/weather?lat=${loc.lat}&lon=${loc.lon}`).then(setWx).catch(() => {});
    load();
    const t = setInterval(load, 20 * 60_000);
    return () => clearInterval(t);
  }, [loc.lat, loc.lon]);
  if (!wx?.current) return <Empty icon={<Cloud />} title="Weather unavailable" />;
  const [Icon, label] = WMO(wx.current.weather_code) as [any, string];
  const fahrenheit = settings?.regional?.tempUnit === 'f';
  const deg = (c: number) => Math.round(fahrenheit ? (c * 9) / 5 + 32 : c);
  return (
    <div className="flex h-full flex-col justify-between gap-2">
      <div className="flex items-center gap-3">
        <Icon className="size-12 text-accent" strokeWidth={1.5} />
        <div>
          <div className="dot text-4xl font-semibold">{deg(wx.current.temperature_2m)}°</div>
          <div className="text-xs text-muted">{label} · {loc.name}</div>
        </div>
      </div>
      {size === 'S' ? (
        <div className="num text-xs text-muted">Feels like {deg(wx.current.apparent_temperature)}° · wind {Math.round(wx.current.wind_speed_10m)} km/h</div>
      ) : (
        <div className="grid grid-cols-5 gap-1 text-center text-xs">
          {wx.daily.time.map((t: string, i: number) => {
            const [I] = WMO(wx.daily.weather_code[i]) as [any];
            return (
              <div key={t} className="rounded-xl bg-panel-2 py-2">
                <div className="capitalize text-muted">{new Date(t + 'T12:00').toLocaleDateString(locale(), { weekday: 'short' })}</div>
                <I className="mx-auto my-1 size-4" />
                <div className="num">{deg(wx.daily.temperature_2m_max[i])}° <span className="text-muted">{deg(wx.daily.temperature_2m_min[i])}°</span></div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** All services + checks as big tiles — readable from across the room */
export function StatusWall({ size, tv, w }: WidgetProps) {
  const states = useStore((s) => s.states);
  const checks = useStore((s) => s.checks);
  const plugins = useStore((s) => s.plugins);
  const instances = useStore((s) => s.instances);
  const showChecks = w.options?.showChecks !== false;
  const tiles = [
    ...instances.filter((i) => i.enabled).map((i) => ({ id: i.id, name: i.name, icon: plugins.find((p) => p.id === i.plugin)?.icon, status: states[i.id]?.status ?? 'unknown', since: states[i.id]?.statusSince, sub: states[i.id]?.summary })),
    ...(showChecks ? Object.values(checks).filter((c) => c.enabled && !c.instanceId).map((c) => ({ id: c.id, name: c.name, icon: undefined, status: c.ok === null ? 'unknown' : c.ok ? 'up' : 'down', since: c.statusSince, sub: c.latencyMs != null ? `${Math.round(c.latencyMs)} ms` : c.message })) : []),
  ];
  const order = { down: 0, degraded: 1, unknown: 2, up: 3, disabled: 4 } as Record<string, number>;
  tiles.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  const min = size === 'S' ? 92 : tv ? 190 : 150;
  return (
    <div className="scroll-thin grid h-full content-start gap-2 overflow-y-auto" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gridAutoRows: 'min-content' }}>
      {tiles.map((t) => {
        const bad = t.status === 'down';
        const warn = t.status === 'degraded';
        return (
          <div key={t.id} className={cx('relative overflow-hidden rounded-2xl border p-3 transition-colors', bad ? 'border-bad/50 bg-bad/15' : warn ? 'border-warn/40 bg-warn/10' : 'border-line bg-panel-2')}>
            <div className="flex items-center gap-2">
              <ServiceIcon slug={t.icon} name={t.name} size={tv ? 26 : 20} />
              <div className={cx('min-w-0 flex-1 truncate font-semibold', tv ? 'text-base' : 'text-sm')}>{t.name}</div>
              <StatusDot status={t.status as any} pulse={bad} size={tv ? 12 : 9} />
            </div>
            {size !== 'S' && <div className="mt-1 truncate text-xs text-muted">{bad ? `Went down ${ago(t.since)}` : t.sub ?? '—'}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** Uptime list for checks: ping/tcp/http/ssl/dns with latency sparkline and history bar */
export function Checks({ size, w }: WidgetProps) {
  const checks = useStore((s) => s.checks);
  const types: string[] | undefined = w.options?.types;
  const list = Object.values(checks).filter((c) => c.enabled && (!types?.length || types.includes(c.type))).sort((a, b) => Number(a.ok) - Number(b.ok) || a.name.localeCompare(b.name));
  if (!list.length) return <Empty title="No checks">Add them in Settings → Checks</Empty>;
  return (
    <List>
      {list.map((c) => (
        <div key={c.id} className="rounded-xl px-2 py-1.5 hover:bg-panel-2">
          <div className="flex items-center gap-2">
            <StatusDot status={c.ok} pulse={c.ok === false} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{c.name}</div>
              <div className="truncate text-[11px] text-muted"><span className="uppercase">{c.type}</span> · {c.ok === false ? c.message : c.target}</div>
            </div>
            {size !== 'S' && c.recent && c.recent.length > 1 && (
              <div className="w-20 max-sm:hidden"><Sparkline data={c.recent.filter((r) => r.latency != null).map((r) => ({ ts: r.ts, v: r.latency! }))} height={22} fill={false} /></div>
            )}
            <div className="num w-16 text-right text-xs">
              {c.type === 'ssl' && c.extra?.daysLeft != null ? <span className={c.extra.daysLeft < (Number(c.extra.warnDays) || 14) ? 'text-warn' : ''}>{c.extra.daysLeft} d</span> : c.latencyMs != null ? `${Math.round(c.latencyMs)} ms` : '—'}
            </div>
            {size !== 'S' && <div className="num w-14 text-right text-xs text-muted">{c.uptime?.d1 != null ? `${c.uptime.d1}%` : '—'}</div>}
          </div>
          {(size === 'L' || size === 'XL') && c.recent && (
            <div className="mt-1.5"><UptimeBar buckets={c.recent.map((r) => ({ ts: r.ts, uptime: r.ok }))} height={8} /></div>
          )}
        </div>
      ))}
    </List>
  );
}

const COLORS = ['var(--accent)', 'var(--accent2-hi)', 'var(--ok)', '#38bdf8', '#ec4899', '#a3e635'];
export function MetricChart({ w, instance }: WidgetProps) {
  const metrics: string[] = Array.isArray(w.options?.metrics) && w.options.metrics.length ? w.options.metrics : ['_latency'];
  const range = Number(w.options?.range ?? 6);
  const series = metrics.map((m) => (m.startsWith('check:') || m.startsWith('inst:') ? m : `inst:${instance?.id}:${m}`));
  const data = useHistory(instance || series.every((s) => !s.includes('undefined')) ? series : [], range, 30);
  // the chart fills whatever space the card has
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(140);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(Math.max(60, Math.floor(el.clientHeight))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fmt = metricFormat(metrics[0]);
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {metrics.map((m, i) => {
          const last = data[series[i]]?.at(-1)?.v;
          return <span key={m} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />{metricLabel(m)}{last !== undefined && <b className="num font-medium text-fg">{metricFormat(m)(last)}</b>}</span>;
        })}
      </div>
      <div ref={box} className="min-h-0 flex-1">
        <AreaChart height={h} series={series.map((s, i) => ({ key: s, label: metricLabel(metrics[i]), color: COLORS[i % COLORS.length], data: data[s] ?? [], format: metricFormat(metrics[i]) }))} yFormat={fmt} />
      </div>
    </div>
  );
}

export function Notes({ w }: WidgetProps) {
  const text: string = w.options?.text ?? '';
  const html = useMemo(() => renderMd(text), [text]);
  return <div className="scroll-thin prose-sm h-full overflow-y-auto text-sm leading-relaxed [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_a]:text-accent" dangerouslySetInnerHTML={{ __html: html }} />;
}
function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function renderMd(src: string) {
  return src.split('\n').map((l) => {
    let s = esc(l).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
    if (/^#{1,3} /.test(l)) return `<h2>${s.replace(/^#{1,3} /, '')}</h2>`;
    if (/^[-*] /.test(l)) return `<li>${s.slice(2)}</li>`;
    return s ? `<p>${s}</p>` : '<br/>';
  }).join('');
}

/** http(s) URL on ANOTHER origin, or null. Same-origin pages are refused: inside an iframe they could act as the signed-in admin. */
export function externalUrl(u: unknown): string | null {
  try {
    const url = new URL(String(u));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.origin === location.origin) return null;
    return url.toString();
  } catch { return null; }
}
const safeLink = (u: unknown) => {
  try { const url = new URL(String(u)); return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null; } catch { return null; }
};

export function Iframe({ w }: WidgetProps) {
  if (!w.options?.url) return <Empty title="Set a URL in the widget settings" />;
  const url = externalUrl(w.options.url);
  if (!url) return <Empty title="This URL cannot be embedded">Only http(s) pages on another address than the Hub are allowed.</Empty>;
  // no allow-same-origin: the framed page gets an opaque origin and cannot touch the Hub, its cookies or storage
  return <iframe src={url} className="h-full w-full rounded-xl border-0 bg-white" sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer" loading="lazy" title={w.title ?? 'iframe'} />;
}

export function Bookmarks({ w, size }: WidgetProps) {
  const links: { name: string; url: string; icon?: string }[] = w.options?.links ?? [];
  if (!links.length) return <Empty title="Add links in the widget settings" />;
  return (
    <div className="scroll-thin grid h-full content-start gap-2 overflow-y-auto" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size === 'S' ? 100 : 130}px, 1fr))` }}>
      {links.filter((l) => safeLink(l.url)).map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} className="flex items-center gap-2 rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm hover:border-accent/50">
          <ServiceIcon slug={l.icon ?? l.name.toLowerCase().replace(/\s+/g, '-')} name={l.name} size={18} />
          <span className="truncate">{l.name}</span>
          <ExternalLink className="ml-auto size-3 shrink-0 text-muted" />
        </a>
      ))}
    </div>
  );
}

/** Merged Radarr + Sonarr release calendar */
export function Calendar({ size }: WidgetProps) {
  const states = useStore((s) => s.states);
  const items = Object.values(states)
    .filter((s) => (s.plugin === 'radarr' || s.plugin === 'sonarr') && s.data?.calendar)
    .flatMap((s) => (Array.isArray(s.data.calendar) ? s.data.calendar : []).map((c: any) => ({ ...c, source: s.plugin, instanceId: s.id })))
    .filter((c: any) => new Date(c.date).getTime() > Date.now() - 86400_000)
    .sort((a: any, b: any) => a.date.localeCompare(b.date));
  return <CalendarList items={items} size={size} />;
}

export function Incidents({ size }: WidgetProps) {
  const incidents = useStore((s) => s.incidents);
  const me = useStore((s) => s.me);
  const open = incidents.filter((i) => !i.resolved_at);
  const recent = incidents.filter((i) => i.resolved_at).slice(0, 5);
  const canAck = me?.auth?.kind === 'admin' || (me?.auth?.kind === 'kiosk' && me.auth.canAck);
  if (!open.length && !recent.length) return <Empty icon={<CheckCircle2 className="size-8 text-ok" />} title="All good">No incidents in the last 7 days</Empty>;
  return (
    <List>
      {open.map((i) => (
        <div key={i.id} className={cx('rounded-xl border px-3 py-2', i.severity === 'critical' ? 'border-bad/40 bg-bad/10' : 'border-warn/40 bg-warn/10')}>
          <div className="flex items-center gap-2">
            <AlertOctagon className={cx('size-4 shrink-0', i.severity === 'critical' ? 'text-bad' : 'text-warn')} />
            <div className="min-w-0 flex-1 truncate text-sm font-medium">{i.title}</div>
            {i.acked_at ? <Badge><BellOff className="size-3" />Acknowledged</Badge> : canAck && (
              <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); post(`/api/incidents/${i.id}/ack`).then(() => toast('Incident acknowledged')).catch((er) => toast(er.message, 'bad')); }}>Acknowledge</Button>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted">{i.message} · ongoing for {duration((Date.now() - i.started_at) / 1000, 2)}</div>
        </div>
      ))}
      {size !== 'S' && recent.map((i) => (
        <Row key={i.id} left={<CheckCircle2 className="size-4 text-ok" />} title={<span className="text-muted">{i.title}</span>} sub={`${dateTime(i.started_at)} · lasted ${duration((i.resolved_at! - i.started_at) / 1000, 2)}`} />
      ))}
    </List>
  );
}

/** Global summary (also used in the top bar) */
export function useSummary() {
  const states = useStore((s) => s.states);
  const checks = useStore((s) => s.checks);
  const incidents = useStore((s) => s.incidents);
  const inst = Object.values(states).filter((s) => s.status !== 'disabled');
  const chk = Object.values(checks).filter((c) => c.enabled && c.ok !== null);
  const total = inst.length + chk.length;
  const up = inst.filter((s) => s.status !== 'down').length + chk.filter((c) => c.ok).length;
  const streams = Object.values(states).filter((s) => s.plugin === 'streamero').reduce((a, s) => a + (s.data?.streams?.length ?? 0), 0);
  const wan = Object.values(states).find((s) => s.plugin === 'mikrotik' && s.data?.wan)?.data?.wan;
  const dl = Object.values(states).filter((s) => s.plugin === 'qbittorrent').reduce((a, s) => a + (s.data?.dlSpeed ?? 0), 0);
  const openInc = incidents.filter((i) => !i.resolved_at);
  return { total, up, down: total - up, streams, wan, dl, alerts: openInc.length, critical: openInc.filter((i) => i.severity === 'critical').length };
}
export function Summary() {
  const s = useSummary();
  return (
    <div className="grid h-full grid-cols-2 content-center gap-4 sm:grid-cols-4">
      <div><div className="text-[11px] uppercase tracking-wide text-muted">Services</div><div className="dot text-2xl font-semibold"><span className={s.down ? 'text-bad' : 'text-ok'}>{s.up}</span><span className="text-muted">/{s.total}</span></div></div>
      <div><div className="text-[11px] uppercase tracking-wide text-muted">Alerts</div><div className={cx('dot text-2xl font-semibold', s.alerts > 0 && 'text-bad')}>{s.alerts}</div></div>
      <div><div className="text-[11px] uppercase tracking-wide text-muted">Streams</div><div className="dot text-2xl font-semibold">{s.streams}</div></div>
      <div><div className="text-[11px] uppercase tracking-wide text-muted">WAN</div><div className="dot text-2xl font-semibold">{s.wan ? `${(s.wan.rxBps / 1e6).toFixed(0)}` : '—'}{s.wan && <span className="text-sm text-muted"> Mbps</span>}</div></div>
    </div>
  );
}
