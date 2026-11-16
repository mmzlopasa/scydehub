import { useId, useMemo, useRef, useState } from 'react';
import { cx } from './ui';
import { locale } from '../lib/format';

export interface Pt { ts: number; v: number }

function path(points: Pt[], w: number, h: number, min: number, max: number, pad = 2) {
  if (points.length < 2) return { line: '', area: '' };
  const t0 = points[0].ts, t1 = points[points.length - 1].ts || t0 + 1;
  const span = t1 - t0 || 1;
  const range = max - min || 1;
  const xy = points.map((p) => [((p.ts - t0) / span) * w, pad + (1 - (p.v - min) / range) * (h - pad * 2)] as const);
  // smooth monotone-ish curve via cubic segments
  let d = `M${xy[0][0].toFixed(1)},${xy[0][1].toFixed(1)}`;
  for (let i = 1; i < xy.length; i++) {
    const [x0, y0] = xy[i - 1], [x1, y1] = xy[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx.toFixed(1)},${y0.toFixed(1)} ${cx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return { line: d, area: `${d} L${w},${h} L0,${h} Z` };
}

export function Sparkline({ data, color = 'var(--accent)', height = 36, min, max, className, fill = true }: { data: Pt[]; color?: string; height?: number; min?: number; max?: number; className?: string; fill?: boolean }) {
  const id = useId().replace(/:/g, '');
  const w = 200;
  const vs = data.map((d) => d.v);
  const lo = min ?? Math.min(...vs, 0);
  const hi = max ?? Math.max(...vs, lo + 1);
  const { line, area } = useMemo(() => path(data, w, height, lo, hi), [data, height, lo, hi]);
  if (data.length < 2) return <div className={cx('w-full', className)} style={{ height }} />;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={cx('w-full overflow-visible', className)} style={{ height }}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#g${id})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export interface Series { key: string; label: string; color: string; data: Pt[]; format?: (v: number) => string }

export function AreaChart({ series, height = 180, min: fixedMin, max: fixedMax, yFormat = (v) => String(Math.round(v)) }: { series: Series[]; height?: number; min?: number; max?: number; yFormat?: (v: number) => string }) {
  const id = useId().replace(/:/g, '');
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const w = 600;
  const all = series.flatMap((s) => s.data);
  const t0 = Math.min(...all.map((p) => p.ts));
  const t1 = Math.max(...all.map((p) => p.ts));
  const lo = fixedMin ?? Math.min(0, ...all.map((p) => p.v));
  const hi = fixedMax ?? Math.max(...all.map((p) => p.v), lo + 1) * 1.08;
  if (all.length < 2) return <div className="grid place-items-center text-xs text-muted" style={{ height }}>Not enough data yet</div>;
  const norm = (s: Series) => (s.data.length ? [{ ts: t0, v: s.data[0].v }, ...s.data, { ts: t1, v: s.data[s.data.length - 1].v }] : []);
  const hx = hover === null ? null : t0 + (t1 - t0) * hover;
  const nearest = (s: Series) => {
    if (hx === null || !s.data.length) return null;
    let best = s.data[0];
    for (const p of s.data) if (Math.abs(p.ts - hx) < Math.abs(best.ts - hx)) best = p;
    return best;
  };
  const ticks = [0, 0.5, 1].map((f) => lo + (hi - lo) * f);
  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}
        onMouseMove={(e) => { const r = ref.current!.getBoundingClientRect(); setHover(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); }}
        onMouseLeave={() => setHover(null)}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`a${id}${s.key.replace(/\W/g, '')}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={s.color} stopOpacity=".28" />
              <stop offset="1" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t, i) => {
          const y = (1 - (t - lo) / (hi - lo || 1)) * height;
          return <line key={i} x1="0" x2={w} y1={y} y2={y} stroke="var(--line)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />;
        })}
        {series.map((s) => {
          const { line, area } = path(norm(s), w, height, lo, hi, 0);
          return (
            <g key={s.key}>
              <path d={area} fill={`url(#a${id}${s.key.replace(/\W/g, '')})`} />
              <path d={line} fill="none" stroke={s.color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {hover !== null && <line x1={hover * w} x2={hover * w} y1="0" y2={height} stroke="var(--muted)" strokeOpacity=".5" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="pointer-events-none absolute left-1 top-0 flex h-full flex-col justify-between py-0.5 text-[10px] text-muted num">
        <span>{yFormat(hi)}</span><span>{yFormat(lo)}</span>
      </div>
      {hover !== null && hx !== null && (
        <div className="glass pointer-events-none absolute top-2 z-10 rounded-xl px-3 py-2 text-xs" style={{ left: `clamp(8px, calc(${hover * 100}% + 12px), calc(100% - 180px))` }}>
          <div className="mb-1 text-muted">{new Date(hx).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
          {series.map((s) => {
            const p = nearest(s);
            return p ? (
              <div key={s.key} className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: s.color }} />
                <span className="text-muted">{s.label}</span>
                <span className="num ml-auto font-medium">{(s.format ?? yFormat)(p.v)}</span>
              </div>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

export function Bars({ values, values2, height = 48, color = 'var(--accent)', color2 = 'var(--color-bad)' }: { values: number[]; values2?: number[]; height?: number; color?: string; color2?: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex w-full items-end gap-[2px]" style={{ height }}>
      {values.map((v, i) => (
        <div key={i} className="relative flex-1 overflow-hidden rounded-t-[3px]" style={{ height: `${(v / max) * 100}%`, background: color, opacity: 0.55 }}>
          {values2 && <div className="absolute bottom-0 left-0 right-0" style={{ height: `${v ? Math.min(100, (values2[i] / v) * 100) : 0}%`, background: color2 }} />}
        </div>
      ))}
    </div>
  );
}

/** Uptime history: one bar per bucket, green → red by availability */
export function UptimeBar({ buckets, height = 22 }: { buckets: { ts: number; uptime: number | null }[]; height?: number }) {
  return (
    <div className="flex w-full gap-[2px]" style={{ height }}>
      {buckets.map((b) => (
        <div key={b.ts} title={`${new Date(b.ts).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit' })}: ${b.uptime === null ? 'no data' : (b.uptime * 100).toFixed(1) + '%'}`}
          className="flex-1 rounded-[2px]"
          style={{ background: b.uptime === null ? 'var(--panel-2)' : b.uptime >= 0.999 ? 'var(--color-ok)' : b.uptime >= 0.95 ? 'var(--color-warn)' : 'var(--color-bad)', opacity: b.uptime === null ? 1 : 0.85 }} />
      ))}
    </div>
  );
}
