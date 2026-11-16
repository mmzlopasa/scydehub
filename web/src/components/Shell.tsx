import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Command, Pencil, Check, Settings, MonitorPlay, Plus, Wifi, WifiOff, Activity, Siren, Clapperboard, ArrowDown, Monitor, Tv, Tablet, Smartphone, LogOut, ExternalLink, Paintbrush } from 'lucide-react';
import { useStore, setState } from '../lib/store';
import { post } from '../lib/api';
import { setProfile, type Profile } from '../lib/device';
import { useSummary } from '../widgets/core/core';
import { CoreIcon } from './icons';
import { bits, speed, time } from '../lib/format';
import { useNow } from '../lib/hooks';
import { IconButton, cx } from './ui';
import { toast } from './feedback';
import { Brand } from './Brand';

/** kept for older imports */
export const Logo = Brand;

function Pill({ icon, children, tone, to }: { icon: ReactNode; children: ReactNode; tone?: 'ok' | 'bad' | 'warn'; to?: string }) {
  const cls = cx('flex items-center gap-1.5 rounded-full border border-line-2 bg-panel-2 px-2.5 py-1 text-xs font-medium num transition', tone === 'bad' && '!border-bad/40 !bg-bad/10 text-bad', tone === 'ok' && 'text-ok');
  return to ? <Link to={to} className={cls}>{icon}{children}</Link> : <div className={cls}>{icon}{children}</div>;
}

const PROFILES: { id: Profile; icon: ReactNode; label: string }[] = [
  { id: 'desktop', icon: <Monitor className="size-4" />, label: 'Monitor' },
  { id: 'tablet', icon: <Tablet className="size-4" />, label: 'Tablet' },
  { id: 'tv', icon: <Tv className="size-4" />, label: 'TV' },
  { id: 'mobile', icon: <Smartphone className="size-4" />, label: 'Phone' },
];

function HeaderClock() {
  const now = useNow(10_000);
  return <span className="dot px-1 text-sm font-semibold">{time(now)}</span>;
}

export function Shell({ children, profile, onProfile, onPalette }: { children: ReactNode; profile: Profile; onProfile: (p: Profile) => void; onPalette: () => void }) {
  const boards = useStore((s) => s.boards);
  const editMode = useStore((s) => s.editMode);
  const conn = useStore((s) => s.conn);
  const me = useStore((s) => s.me);
  const settings = useStore((s) => s.settings);
  const isAdmin = me?.auth?.kind === 'admin';
  const sum = useSummary();
  const nav = useNavigate();
  const [profMenu, setProfMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const h = settings?.header;
  const style = settings?.appearance.headerStyle ?? 'floating';
  const maxW = settings?.layout.maxWidth ? `${settings.layout.maxWidth}px` : 'none';

  useEffect(() => {
    if (!profMenu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setProfMenu(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [profMenu]);

  const addBoard = async () => {
    const name = prompt('New board name', 'New board');
    if (!name) return;
    try {
      const r = await post<{ id: string }>('/api/boards', { name, icon: 'layout-grid' });
      nav(`/b/${r.id}`);
      setState({ editMode: true });
    } catch (e: any) { toast(e.message, 'bad'); }
  };

  const floating = style === 'floating';
  return (
    <div className="min-h-full">
      {style !== 'hidden' && (
        <header className={cx('sticky z-30', floating ? 'top-3 px-3 sm:px-6' : 'top-0 border-b border-line')} style={floating ? undefined : { background: 'var(--nav-bg)', backdropFilter: 'blur(22px) saturate(1.7)' }}>
          <div className={cx('mx-auto flex flex-wrap items-center gap-x-3 gap-y-1 md:flex-nowrap', floating ? 'rounded-[28px] border border-line-2 px-3 py-2 shadow-[var(--sh-1)] sm:rounded-full sm:px-4' : 'px-4 py-2.5 sm:px-6')}
            style={{ maxWidth: maxW, ...(floating ? { background: 'var(--nav-bg)', backdropFilter: 'blur(22px) saturate(1.7)', WebkitBackdropFilter: 'blur(22px) saturate(1.7)' } : {}) }}>
            <Link to="/" className="shrink-0 pl-1"><Brand /></Link>
            <nav className="scroll-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto max-md:order-last max-md:basis-full md:px-3">
              {boards.map((b, i) => (
                <NavLink key={b.id} to={`/b/${b.id}`} end
                  className={({ isActive }) => cx('flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition duration-200',
                    isActive || (i === 0 && location.pathname === '/') ? 'bg-fg text-bg shadow-[0_6px_20px_-8px_var(--fg)]' : 'text-muted hover:bg-panel-2 hover:text-fg')}>
                  <CoreIcon name={b.icon} className="size-4" />{b.name}
                </NavLink>
              ))}
              {isAdmin && editMode && <IconButton title="New board" onClick={addBoard}><Plus className="size-4" /></IconButton>}
              {h?.links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer noopener" className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm text-muted hover:bg-panel-2 hover:text-fg">{l.name}<ExternalLink className="size-3" /></a>
              ))}
            </nav>
            <div className="hidden items-center gap-1.5 lg:flex">
              {h?.showServices !== false && <Pill icon={<Activity className="size-3.5" />} tone={sum.down ? 'bad' : 'ok'}>{sum.up}/{sum.total}</Pill>}
              {h?.showAlerts !== false && sum.alerts > 0 && <Pill icon={<Siren className="size-3.5" />} tone="bad" to="/settings/incidents">{sum.alerts}</Pill>}
              {h?.showStreams !== false && sum.streams > 0 && <Pill icon={<Clapperboard className="size-3.5" />}>{sum.streams}</Pill>}
              {h?.showTraffic !== false && sum.wan && <Pill icon={<ArrowDown className="size-3.5 text-accent" />}>{bits(sum.wan.rxBps)}</Pill>}
              {h?.showTraffic !== false && !sum.wan && sum.dl > 0 && <Pill icon={<ArrowDown className="size-3.5 text-accent" />}>{speed(sum.dl)}</Pill>}
              {h?.showClock && <HeaderClock />}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <span title={conn === 'online' ? 'Connected (live)' : conn === 'connecting' ? 'Connecting…' : 'Connection lost — reconnecting'} className="px-1.5">
                {conn === 'online' ? <Wifi className="size-4 text-ok" /> : <WifiOff className={cx('size-4', conn === 'offline' ? 'text-bad' : 'text-muted animate-pulse')} />}
              </span>
              <IconButton title="Command palette (Ctrl+K)" onClick={onPalette}><Command className="size-4" /></IconButton>
              <div className="relative max-sm:hidden" ref={menuRef}>
                <IconButton title="Device layout" onClick={() => setProfMenu((v) => !v)}>{PROFILES.find((p) => p.id === profile)?.icon}</IconButton>
                {profMenu && (
                  <div className="pop animate-pop absolute right-0 top-11 z-40 w-52 rounded-2xl p-1.5">
                    <div className="px-2 py-1 text-[11px] text-muted">Each device keeps its own layout</div>
                    {PROFILES.map((p) => (
                      <button key={p.id} onClick={() => { setProfile(p.id); onProfile(p.id); setProfMenu(false); }} className={cx('flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-panel-2', p.id === profile && 'text-accent')}>{p.icon}{p.label}</button>
                    ))}
                  </div>
                )}
              </div>
              {isAdmin && <IconButton className="max-sm:hidden" title="Customize look" onClick={() => nav('/settings/customize')}><Paintbrush className="size-4" /></IconButton>}
              <IconButton className="max-sm:hidden" title="Kiosk mode" onClick={() => nav('/kiosk')}><MonitorPlay className="size-4" /></IconButton>
              {isAdmin && <IconButton title="Settings" onClick={() => nav('/settings')}><Settings className="size-4" /></IconButton>}
              {isAdmin && <IconButton className="max-sm:hidden" title="Sign out" onClick={() => post('/api/auth/logout').then(() => location.assign('/login')).catch((e) => toast(e.message, 'bad'))}><LogOut className="size-4" /></IconButton>}
              {isAdmin && (
                <button onClick={() => setState({ editMode: !editMode })} title={editMode ? 'Done editing' : 'Edit layout'}
                  className={cx('ml-1 inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition active:scale-95', editMode ? 'btn-primary' : 'btn-soft')}>
                  {editMode ? <Check className="size-4" /> : <Pencil className="size-3.5" />}<span className="max-sm:hidden">{editMode ? 'Done' : 'Edit'}</span>
                </button>
              )}
            </div>
          </div>
        </header>
      )}
      {style === 'hidden' && isAdmin && (
        <div className="fixed bottom-4 right-4 z-30 flex gap-2">
          <button onClick={onPalette} className="btn-soft pop grid size-11 place-items-center rounded-full" title="Command palette (Ctrl+K)"><Command className="size-4" /></button>
          <button onClick={() => setState({ editMode: !editMode })} className={cx('grid size-11 place-items-center rounded-full', editMode ? 'btn-primary' : 'btn-soft pop')} title="Edit layout">{editMode ? <Check className="size-4" /> : <Pencil className="size-4" />}</button>
        </div>
      )}
      <main className={cx('mx-auto px-3 pb-6 sm:px-6', floating ? 'pt-6 sm:pt-8' : 'pt-4 sm:pt-6')} style={{ maxWidth: maxW }}>{children}</main>
      {settings?.branding.footerText && <footer className="pb-6 text-center text-xs text-muted">{settings.branding.footerText}</footer>}
    </div>
  );
}
