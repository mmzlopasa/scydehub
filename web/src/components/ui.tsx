import { useEffect, useId, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Upload, Trash2 } from 'lucide-react';
import type { Status } from '../lib/types';
import { locale } from '../lib/format';
import { kioskToken } from '../lib/api';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------- Button ----------
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'soft'; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode };
export function Button({ variant = 'soft', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition duration-200 active:scale-[.97] disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3.5 text-xs' : 'h-10 px-5 text-sm',
        variant === 'primary' && 'btn-primary',
        variant === 'soft' && 'btn-soft',
        variant === 'ghost' && 'hover:bg-panel-2 text-muted hover:text-fg',
        variant === 'danger' && 'bg-bad text-[#1B1530] shadow-[0_10px_30px_-10px_var(--bad)] hover:brightness-110',
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}
export function IconButton({ className, title, children, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} type={type} title={title} aria-label={title} className={cx('inline-flex size-9 items-center justify-center rounded-full text-muted hover:text-fg hover:bg-panel-2 transition active:scale-95', className)}>
      {children}
    </button>
  );
}

// ---------- Status ----------
export const statusColor = (s?: Status | boolean | null) =>
  s === true || s === 'up' ? 'var(--ok)' : s === 'degraded' ? 'var(--warn)' : s === false || s === 'down' ? 'var(--bad)' : 'var(--muted)';
export const statusLabel: Record<string, string> = { up: 'Online', degraded: 'Warning', down: 'Offline', unknown: 'Unknown', disabled: 'Disabled' };

export function StatusDot({ status, size = 8, pulse }: { status?: Status | boolean | null; size?: number; pulse?: boolean }) {
  const c = statusColor(status);
  return <span className={cx('inline-block shrink-0 rounded-full', pulse && 'dot-pulse')} style={{ width: size, height: size, background: c, color: c, boxShadow: `0 0 ${size * 1.4}px ${c}` }} />;
}

export function Badge({ children, tone = 'muted', className }: { children: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'info' | 'muted' | 'accent'; className?: string }) {
  const map = {
    ok: 'bg-ok/15 text-ok', warn: 'bg-warn/15 text-warn', bad: 'bg-bad/15 text-bad', info: 'bg-accent2/20 text-info',
    muted: 'bg-panel-2 text-muted', accent: 'bg-accent-soft text-accent',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap', map[tone], className)}>{children}</span>;
}

// ---------- Progress ----------
export function Progress({ value, tone, className, height = 6 }: { value: number; tone?: 'auto' | 'accent' | 'ok' | 'warn' | 'bad'; className?: string; height?: number }) {
  const v = Math.max(0, Math.min(100, value || 0));
  const t = tone ?? 'accent';
  const resolved = t === 'auto' ? (v >= 90 ? 'bad' : v >= 75 ? 'warn' : 'accent') : t;
  const bg = resolved === 'accent' ? 'var(--aurora)' : `var(--${resolved})`;
  return (
    <div className={cx('w-full overflow-hidden rounded-full bg-panel-2', className)} style={{ height }}>
      <div className={cx('h-full rounded-full transition-[width] duration-700 ease-out', v > 0 && v < 100 && 'progress-fill')} style={{ width: `${v}%`, background: bg, backgroundSize: `${v ? 10000 / v : 100}% 100%` }} />
    </div>
  );
}

export function Ring({ value, size = 64, stroke = 7, label, sub, tone = 'auto' }: { value: number; size?: number; stroke?: number; label?: ReactNode; sub?: ReactNode; tone?: 'auto' | 'accent' }) {
  const id = useId().replace(/:/g, '');
  const v = Math.max(0, Math.min(100, value || 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const alarm = tone === 'auto' && v >= 75;
  const color = v >= 90 ? 'var(--bad)' : 'var(--warn)';
  return (
    <div className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 overflow-visible">
        <defs>
          <linearGradient id={`rg${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent2)" /><stop offset=".5" stopColor="var(--accent2-hi)" /><stop offset="1" stopColor="var(--accent)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel-2)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={alarm ? color : `url(#rg${id})`} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)}
          style={{ transition: 'stroke-dashoffset .9s cubic-bezier(.22,1,.36,1)', filter: `drop-shadow(0 0 6px ${alarm ? color : 'rgba(var(--accent2-rgb), .55)'})` }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-tight">
        <div>
          <div className="dot font-semibold" style={{ fontSize: size * 0.23 }}>{label}</div>
          {sub && <div className="text-muted" style={{ fontSize: Math.max(9, size * 0.13) }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}

// ---------- Animated number ----------
export function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString(locale()), duration = 700 }: { value: number | null | undefined; format?: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value ?? 0);
  const from = useRef(value ?? 0);
  const raf = useRef(0);
  useEffect(() => {
    if (value == null || !Number.isFinite(value)) return;
    const a = from.current, b = value;
    if (a === b) { setShown(b); return; }
    if (document.documentElement.dataset.motion !== 'full') { from.current = b; setShown(b); return; }
    const start = performance.now();
    cancelAnimationFrame(raf.current);
    const step = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - start) / duration)); // the frame timestamp can predate `start`
      const e = 1 - Math.pow(1 - p, 3);
      const v = a + (b - a) * e;
      setShown(v);
      from.current = v;
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);
  if (value == null || !Number.isFinite(value)) return <span className="num">—</span>;
  return <span className="num">{format(shown)}</span>;
}

// ---------- Skeleton ----------
export const Skeleton = ({ className }: { className?: string }) => <div className={cx('skeleton', className)} />;
export function WidgetSkeleton() {
  return (
    <div className="flex h-full flex-col gap-3 p-1">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="flex-1 w-full" />
    </div>
  );
}

// ---------- Service icon ----------
/** `slug` may be a dashboard-icons name (cached by the Hub), an https URL or an uploaded data: image. Falls back to a monogram. */
const failed = new Set<string>();
/** Kiosk devices authenticate with a header, which <img> cannot send: fetch those icons and show them as blob URLs. */
const blobs = new Map<string, Promise<string>>();
const kioskIcon = (slug: string, tok: string) => {
  let p = blobs.get(slug);
  if (!p) {
    p = fetch(`/api/icons/${encodeURIComponent(slug)}`, { headers: { authorization: `Kiosk ${tok}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('no icon')))).then((b) => URL.createObjectURL(b));
    blobs.set(slug, p);
  }
  return p;
};
export function ServiceIcon({ slug, name, size = 22, className, color }: { slug?: string; name?: string; size?: number; className?: string; color?: string }) {
  const [err, setErr] = useState(!slug || failed.has(slug));
  const direct = !!slug && /^(https:|data:image\/)/.test(slug);
  const tok = direct ? null : kioskToken.get();
  const [blob, setBlob] = useState('');
  useEffect(() => {
    setErr(!slug || failed.has(slug));
    setBlob('');
    if (!slug || !tok || failed.has(slug)) return;
    let live = true;
    kioskIcon(slug, tok).then((u) => { if (live) setBlob(u); }).catch(() => { failed.add(slug); if (live) setErr(true); });
    return () => { live = false; };
  }, [slug, tok]);
  if (err || !slug || (tok && !blob)) {
    const letters = (name ?? slug ?? '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
    return (
      <span className={cx('inline-grid shrink-0 place-items-center rounded-[30%] font-semibold', className)}
        style={{ width: size, height: size, fontSize: size * 0.42, color: color ?? 'var(--accent-ink)', background: color ? `${color}26` : 'var(--accent-soft)' }}>
        {letters}
      </span>
    );
  }
  const src = direct ? slug : tok ? blob : `/api/icons/${encodeURIComponent(slug)}`;
  return (
    <img src={src} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" className={cx('shrink-0 object-contain', className)} style={{ width: size, height: size }}
      onError={() => { failed.add(slug); setErr(true); }} />
  );
}

// ---------- Modal / Drawer ----------
/** Open layers, bottom to top. Escape closes only the top one and goes no further (not to the page, not to the layer below). */
const layers: { current: () => void }[] = [];
if (typeof window !== 'undefined')
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !layers.length) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    layers[layers.length - 1].current();
  }, true);
export function useEscape(open: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!open) return;
    layers.push(ref);
    return () => { const i = layers.indexOf(ref); if (i >= 0) layers.splice(i, 1); };
  }, [open]);
}
export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 backdrop-blur-md sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={cx('pop animate-pop flex max-h-[92vh] w-full flex-col rounded-t-[28px] sm:rounded-[28px]', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        {title && (
          <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
            <div className="text-base font-semibold">{title}</div>
            <IconButton title="Close" onClick={onClose}><X className="size-4" /></IconButton>
          </div>
        )}
        <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, children, width = 640 }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: number }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-black/45 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="pop animate-slide-in m-0 flex h-full w-full flex-col sm:m-3 sm:h-[calc(100%-1.5rem)] sm:rounded-[28px]" style={{ maxWidth: width }}>
        <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0 flex-1">{title}</div>
          <IconButton title="Close" onClick={onClose}><X className="size-5" /></IconButton>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ---------- Form controls ----------
export const inputCls = 'h-10 w-full rounded-[14px] border border-line-2 bg-panel-2 px-3.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25 placeholder:text-muted/60';
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}
export function Label({ children, help, className }: { children: ReactNode; help?: ReactNode; className?: string }) {
  return (
    <label className={cx('block space-y-1.5', className)}>
      {children}
      {help && <div className="text-xs text-muted">{help}</div>}
    </label>
  );
}
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className="inline-flex items-center gap-3 text-sm disabled:opacity-50" role="switch" aria-checked={checked}>
      <span className={cx('relative h-6 w-11 shrink-0 rounded-full transition', checked ? 'btn-primary' : 'bg-panel-2 border border-line-2')}>
        <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow-md transition-all duration-300', checked ? 'left-[22px]' : 'left-0.5')} />
      </span>
      {label && <span className="text-left">{label}</span>}
    </button>
  );
}
export function Segmented<T extends string>({ value, onChange, options, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex flex-wrap rounded-full border border-line-2 bg-panel-2 p-1">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cx('rounded-full font-medium transition', size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-xs', value === o.value ? 'bg-fg text-bg shadow' : 'text-muted hover:text-fg')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
export function Slider({ value, onChange, min, max, step = 1, suffix = '' }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-panel-2 accent-[var(--accent)]" />
      <span className="num w-14 text-right text-xs text-muted">{Number.isInteger(step) ? value : value.toFixed(2)}{suffix}</span>
    </div>
  );
}
export function ColorInput({ value, onChange, presets }: { value: string; onChange: (v: string) => void; presets?: string[] }) {
  // what is being typed lives here; only a complete colour (or nothing) reaches the caller
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const type = (raw: string) => {
    const v = raw.trim().replace(/^([0-9a-fA-F])/, '#$1');
    if (!/^(#[0-9a-fA-F]{0,6})?$/.test(v)) return;
    setDraft(v);
    if (v === '' || v.length === 7) onChange(v);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets?.map((c) => (
        <button key={c} type="button" title={c} onClick={() => onChange(c)} className={cx('size-8 rounded-full ring-offset-2 ring-offset-[var(--bg)] transition hover:scale-110', value.toLowerCase() === c.toLowerCase() && 'ring-2 ring-[var(--fg)]')} style={{ background: c }} />
      ))}
      <label className="relative grid size-8 cursor-pointer place-items-center overflow-hidden rounded-full border border-line-2" style={{ background: value || 'transparent' }} title="Custom colour">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
      <Input value={draft} placeholder="#RRGGBB" onChange={(e) => type(e.target.value)} onBlur={() => setDraft(value)} className="!h-8 w-24 font-mono text-xs" />
    </div>
  );
}
/** Pick an image: upload (stored inline as a data: URL), paste an https URL, or clear. */
export function ImagePicker({ value, onChange, maxKb = 300, hint }: { value: string; onChange: (v: string) => void; maxKb?: number; hint?: string }) {
  const file = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  const shown = value.startsWith('data:') ? '' : value;
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const pick = (f: File) => {
    setErr('');
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(f.type)) return setErr('Use a PNG, JPG, WebP, GIF or SVG image');
    if (f.size > maxKb * 1024) return setErr(`Image is larger than ${maxKb} KB`);
    const r = new FileReader();
    r.onload = () => onChange(String(r.result));
    r.readAsDataURL(f);
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {value ? <img src={value} alt="" className="size-10 rounded-xl border border-line-2 bg-panel-2 object-contain" /> : <div className="size-10 rounded-xl border border-dashed border-line-2" />}
        <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => file.current?.click()}>Upload</Button>
        {value && <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => onChange('')}>Remove</Button>}
        <Input className="!h-8 min-w-40 flex-1 text-xs" placeholder="…or https:// image URL" value={draft}
          onChange={(e) => { const v = e.target.value.trim(); setDraft(v); if (v === '' || /^https:\/\/[^\s"'<>]+$/.test(v)) { setErr(''); onChange(v); } }}
          onBlur={() => { if (draft !== shown) { setErr(draft ? 'The address must start with https://' : ''); setDraft(shown); } }} />
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }} />
      </div>
      {(err || hint) && <div className={cx('text-xs', err ? 'text-bad' : 'text-muted')}>{err || hint}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-6 text-center text-muted">
      {icon && <div className="opacity-60">{icon}</div>}
      <div className="text-sm font-medium text-fg/80">{title}</div>
      {children && <div className="text-xs">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="truncate text-[11px] font-medium uppercase tracking-[.08em] text-muted">{label}</div>
      <div className="dot truncate text-[1.35rem] font-semibold leading-tight">{value}</div>
      {sub && <div className="truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}
