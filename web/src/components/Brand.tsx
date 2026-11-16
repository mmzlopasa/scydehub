import { useStore } from '../lib/store';
import { cx } from './ui';

/** Built-in mark: four tiles, the "dashboard" glyph, drawn in the current accent colours. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="shrink-0" aria-hidden>
      <defs>
        <linearGradient id="mk-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--accent2-hi)" /><stop offset="1" stopColor="var(--accent2)" /></linearGradient>
        <radialGradient id="mk-b" cx=".3" cy=".2" r="1.2"><stop offset="0" stopColor="var(--accent-hi)" /><stop offset=".5" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent-lo)" /></radialGradient>
      </defs>
      <rect x="4" y="4" width="26" height="26" rx="8" fill="url(#mk-a)" />
      <rect x="34" y="4" width="26" height="16" rx="7" fill="var(--fg)" opacity=".92" />
      <rect x="34" y="24" width="26" height="36" rx="8" fill="url(#mk-b)" />
      <rect x="4" y="34" width="26" height="26" rx="8" fill="var(--fg)" opacity=".92" />
    </svg>
  );
}

/** Logo + name, both editable in Settings → Customize → Branding. */
export function Brand({ className, size = 28, withTagline }: { className?: string; size?: number; withTagline?: boolean }) {
  const b = useStore((s) => s.settings?.branding ?? s.branding?.branding);
  const name = b?.name || 'SCYDE Hub';
  const [first, ...rest] = name.split(' ');
  return (
    <div className={cx('flex min-w-0 items-center gap-2.5', className)}>
      {b?.showLogo !== false && (b?.logo ? <img src={b.logo} alt="" className="shrink-0 rounded-[28%] object-contain" style={{ width: size, height: size }} /> : <Mark size={size} />)}
      {b?.showName !== false && (
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[15px] font-semibold tracking-tight">{first}{rest.length > 0 && <span className="font-normal text-muted"> {rest.join(' ')}</span>}<span className="text-accent">.</span></div>
          {withTagline && b?.tagline && <div className="truncate text-xs text-muted">{b.tagline}</div>}
        </div>
      )}
    </div>
  );
}
