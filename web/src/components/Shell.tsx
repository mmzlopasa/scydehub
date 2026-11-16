import { useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Command, Pencil, Check, Settings, MonitorPlay, Plus, Wifi, WifiOff, Activity, Siren, Clapperboard, ArrowDown, Monitor, Tv, Tablet, Smartphone, LogOut } from 'lucide-react';
import { useStore, setState } from '../lib/store';
import { post } from '../lib/api';
import { setProfile, type Profile } from '../lib/device';
import { useSummary } from '../widgets/core/core';
import { CoreIcon } from './icons';
import { bits, speed } from '../lib/format';
import { IconButton, cx } from './ui';
import { toast } from './feedback';

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <img src="/favicon.svg" alt="" className="size-7" />
      <span className="text-[15px] font-semibold tracking-tight">SCYDE <span className="text-muted font-normal">Hub</span></span>
    </div>
  );
}

function Pill({ icon, children, tone, to }: { icon: ReactNode; children: ReactNode; tone?: 'ok' | 'bad' | 'warn'; to?: string }) {
  const cls = cx('flex items-center gap-1.5 rounded-full border border-line bg-panel-2 px-2.5 py-1 text-xs font-medium num', tone === 'bad' && 'border-bad/40 bg-bad/10 text-bad', tone === 'ok' && 'text-ok');
  return to ? <Link to={to} className={cls}>{icon}{children}</Link> : <div className={cls}>{icon}{children}</div>;
}

const PROFILES: { id: Profile; icon: ReactNode; label: string }[] = [
  { id: 'desktop', icon: <Monitor className="size-4" />, label: 'Monitor' },
  { id: 'tablet', icon: <Tablet className="size-4" />, label: 'Tablet' },
  { id: 'tv', icon: <Tv className="size-4" />, label: 'TV' },
  { id: 'mobile', icon: <Smartphone className="size-4" />, label: 'Mobitel' },
];

export function Shell({ children, profile, onProfile, onPalette, boardId }: { children: ReactNode; profile: Profile; onProfile: (p: Profile) => void; onPalette: () => void; boardId?: string }) {
  const boards = useStore((s) => s.boards);
  const editMode = useStore((s) => s.editMode);
  const conn = useStore((s) => s.conn);
  const me = useStore((s) => s.me);
  const isAdmin = me?.auth?.kind === 'admin';
  const sum = useSummary();
  const nav = useNavigate();
  const [profMenu, setProfMenu] = useState(false);

  const addBoard = async () => {
    const name = prompt('Naziv nove stranice', 'Nova stranica');
    if (!name) return;
    const r = await post<{ id: string }>('/api/boards', { name, icon: 'layout-grid' });
    nav(`/b/${r.id}`);
    setState({ editMode: true });
  };

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-line bg-[color-mix(in_oklab,var(--bg)_70%,transparent)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1920px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:px-6 md:flex-nowrap">
          <Link to="/" className="shrink-0"><Logo /></Link>
          <nav className="scroll-thin -mb-px flex min-w-0 flex-1 items-center gap-1 overflow-x-auto max-md:order-last max-md:basis-full md:px-2">
            {boards.map((b) => (
              <NavLink key={b.id} to={`/b/${b.id}`}
                className={({ isActive }) => cx('flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition', isActive || (!boardId && b === boards[0] && location.pathname === '/') ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-panel-2 hover:text-fg')}>
                <CoreIcon name={b.icon} className="size-4" />{b.name}
              </NavLink>
            ))}
            {isAdmin && editMode && <IconButton title="Nova stranica" onClick={addBoard}><Plus className="size-4" /></IconButton>}
          </nav>
          <div className="hidden items-center gap-1.5 lg:flex">
            <Pill icon={<Activity className="size-3.5" />} tone={sum.down ? 'bad' : 'ok'}>{sum.up}/{sum.total}</Pill>
            {sum.alerts > 0 && <Pill icon={<Siren className="size-3.5" />} tone="bad" to="/settings/incidents">{sum.alerts}</Pill>}
            {sum.streams > 0 && <Pill icon={<Clapperboard className="size-3.5" />}>{sum.streams}</Pill>}
            {sum.wan && <Pill icon={<ArrowDown className="size-3.5 text-accent" />}>{bits(sum.wan.rxBps)}</Pill>}
            {!sum.wan && sum.dl > 0 && <Pill icon={<ArrowDown className="size-3.5 text-accent" />}>{speed(sum.dl)}</Pill>}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <span title={conn === 'online' ? 'Povezano (uživo)' : conn === 'connecting' ? 'Spajanje…' : 'Veza prekinuta — ponovno spajanje'} className="px-1.5">
              {conn === 'online' ? <Wifi className="size-4 text-ok" /> : <WifiOff className={cx('size-4', conn === 'offline' ? 'text-bad' : 'text-muted animate-pulse')} />}
            </span>
            <IconButton title="Command palette (Ctrl+K)" onClick={onPalette}><Command className="size-4" /></IconButton>
            <div className="relative max-sm:hidden">
              <IconButton title="Layout uređaja" onClick={() => setProfMenu((v) => !v)}>{PROFILES.find((p) => p.id === profile)?.icon}</IconButton>
              {profMenu && (
                <div className="glass animate-pop absolute right-0 top-11 z-40 w-48 rounded-2xl p-1.5" style={{ background: 'color-mix(in oklab, var(--bg) 92%, transparent)' }} onMouseLeave={() => setProfMenu(false)}>
                  <div className="px-2 py-1 text-[11px] text-muted">Svaki uređaj pamti svoj raspored</div>
                  {PROFILES.map((p) => (
                    <button key={p.id} onClick={() => { setProfile(p.id); onProfile(p.id); setProfMenu(false); }} className={cx('flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-panel-2', p.id === profile && 'text-accent')}>{p.icon}{p.label}</button>
                  ))}
                </div>
              )}
            </div>
            {isAdmin && (
              <IconButton title={editMode ? 'Završi uređivanje' : 'Uredi raspored'} onClick={() => setState({ editMode: !editMode })} className={editMode ? '!bg-accent !text-white' : ''}>
                {editMode ? <Check className="size-4" /> : <Pencil className="size-4" />}
              </IconButton>
            )}
            <IconButton className="max-sm:hidden" title="Kiosk način" onClick={() => nav('/kiosk')}><MonitorPlay className="size-4" /></IconButton>
            {isAdmin && <IconButton title="Postavke" onClick={() => nav('/settings')}><Settings className="size-4" /></IconButton>}
            {isAdmin && <IconButton className="max-sm:hidden" title="Odjava" onClick={() => post('/api/auth/logout').then(() => location.assign('/login')).catch((e) => toast(e.message, 'bad'))}><LogOut className="size-4" /></IconButton>}
          </div>
        </div>
        {editMode && (
          <div className="border-t border-line bg-accent-soft py-1.5 text-center text-xs font-medium text-accent">
            Način uređivanja — povuci widgete za ručku, mijenjaj veličinu u kutu. Raspored se sprema za uređaj: <b>{PROFILES.find((p) => p.id === profile)?.label}</b>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-[1920px] px-3 py-4 sm:px-6 sm:py-6">{children}</main>
    </div>
  );
}
