import { useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import type { Status } from '../lib/types';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------- Button ----------
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'soft'; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode };
export function Button({ variant = 'soft', size = 'md', loading, icon, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm',
        variant === 'primary' && 'bg-accent text-white shadow-[0_8px_24px_-10px_var(--accent)] hover:brightness-110',
        variant === 'soft' && 'bg-panel-2 hover:bg-[color-mix(in_oklab,var(--fg)_9%,transparent)] border border-line',
        variant === 'ghost' && 'hover:bg-panel-2 text-muted hover:text-fg',
        variant === 'danger' && 'bg-bad/90 text-white hover:bg-bad',
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}
export function IconButton({ className, title, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} title={title} aria-label={title} className={cx('inline-flex size-9 items-center justify-center rounded-xl text-muted hover:text-fg hover:bg-panel-2 transition', className)}>
      {children}
    </button>
  );
}

// ---------- Status ----------
export const statusColor = (s?: Status | boolean | null) =>
  s === true || s === 'up' ? 'var(--color-ok)' : s === 'degraded' ? 'var(--color-warn)' : s === false || s === 'down' ? 'var(--color-bad)' : 'var(--muted)';
export const statusLabel: Record<string, string> = { up: 'Online', degraded: 'Upozorenje', down: 'Offline', unknown: 'Nepoznato', disabled: 'Isključeno' };

export function StatusDot({ status, size = 8, pulse }: { status?: Status | boolean | null; size?: number; pulse?: boolean }) {
  const c = statusColor(status);
  return <span className={cx('inline-block shrink-0 rounded-full', pulse && 'dot-pulse')} style={{ width: size, height: size, background: c, color: c, boxShadow: `0 0 ${size}px ${c}` }} />;
}

export function Badge({ children, tone = 'muted', className }: { children: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'info' | 'muted' | 'accent'; className?: string }) {
  const map = {
    ok: 'bg-ok/15 text-ok', warn: 'bg-warn/15 text-warn', bad: 'bg-bad/15 text-bad', info: 'bg-info/15 text-info',
    muted: 'bg-panel-2 text-muted', accent: 'bg-accent-soft text-accent',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap', map[tone], className)}>{children}</span>;
}

// ---------- Progress ----------
export function Progress({ value, tone, className, height = 6 }: { value: number; tone?: 'auto' | 'accent' | 'ok' | 'warn' | 'bad'; className?: string; height?: number }) {
  const v = Math.max(0, Math.min(100, value || 0));
  const t = tone ?? 'accent';
  const color = t === 'auto' ? (v >= 90 ? 'var(--color-bad)' : v >= 75 ? 'var(--color-warn)' : 'var(--accent)') : t === 'accent' ? 'var(--accent)' : `var(--color-${t})`;
  return (
    <div className={cx('w-full overflow-hidden rounded-full bg-panel-2', className)} style={{ height }}>
      <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${v}%`, background: color }} />
    </div>
  );
}

export function Ring({ value, size = 64, stroke = 7, label, sub, tone = 'auto' }: { value: number; size?: number; stroke?: number; label?: ReactNode; sub?: ReactNode; tone?: 'auto' | 'accent' }) {
  const v = Math.max(0, Math.min(100, value || 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = tone === 'auto' ? (v >= 90 ? 'var(--color-bad)' : v >= 75 ? 'var(--color-warn)' : 'var(--accent)') : 'var(--accent)';
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel-2)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} style={{ transition: 'stroke-dashoffset .8s cubic-bezier(.2,.7,.2,1)' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-tight">
        <div>
          <div className="num font-semibold" style={{ fontSize: size * 0.22 }}>{label}</div>
          {sub && <div className="text-muted" style={{ fontSize: Math.max(9, size * 0.13) }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}

// ---------- Animated number ----------
export function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString('hr-HR'), duration = 600 }: { value: number | null | undefined; format?: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value ?? 0);
  const from = useRef(value ?? 0);
  const raf = useRef(0);
  useEffect(() => {
    if (value == null || !Number.isFinite(value)) return;
    const start = performance.now();
    const a = from.current, b = value;
    if (a === b) return;
    cancelAnimationFrame(raf.current);
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
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

// ---------- Service icon (cached dashboard-icons via backend, monogram fallback) ----------
const failed = new Set<string>();
export function ServiceIcon({ slug, name, size = 22, className }: { slug?: string; name?: string; size?: number; className?: string }) {
  const [err, setErr] = useState(!slug || failed.has(slug));
  if (err || !slug) {
    const letters = (name ?? slug ?? '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
    return (
      <span className={cx('inline-grid shrink-0 place-items-center rounded-lg bg-accent-soft font-semibold text-accent', className)} style={{ width: size, height: size, fontSize: size * 0.42 }}>
        {letters}
      </span>
    );
  }
  return (
    <img src={`/api/icons/${slug}`} alt="" width={size} height={size} loading="lazy" className={cx('shrink-0 object-contain', className)} style={{ width: size, height: size }}
      onError={() => { failed.add(slug); setErr(true); }} />
  );
}

// ---------- Modal / Drawer ----------
export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('glass animate-pop flex max-h-[92vh] w-full flex-col rounded-t-3xl sm:rounded-3xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')} style={{ background: 'color-mix(in oklab, var(--bg) 88%, transparent)' }}>
        {title && (
          <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
            <div className="text-base font-semibold">{title}</div>
            <IconButton title="Zatvori" onClick={onClose}><X className="size-4" /></IconButton>
          </div>
        )}
        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, children, width = 640 }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass animate-slide-in flex h-full w-full flex-col border-y-0 border-r-0" style={{ maxWidth: width, background: 'color-mix(in oklab, var(--bg) 92%, transparent)' }}>
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">{title}</div>
          <IconButton title="Zatvori" onClick={onClose}><X className="size-5" /></IconButton>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ---------- Form controls ----------
export const inputCls = 'h-10 w-full rounded-xl border border-line bg-panel-2 px-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25 placeholder:text-muted/60';
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
      <span className={cx('relative h-6 w-10 rounded-full transition', checked ? 'bg-accent' : 'bg-panel-2 border border-line')}>
        <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
      {label && <span className="text-left">{label}</span>}
    </button>
  );
}
export function Segmented<T extends string>({ value, onChange, options, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-panel-2 p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cx('rounded-[10px] font-medium transition', size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs', value === o.value ? 'bg-accent text-white shadow' : 'text-muted hover:text-fg')}>
          {o.label}
        </button>
      ))}
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
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="num truncate text-xl font-semibold leading-tight">{value}</div>
      {sub && <div className="truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}
