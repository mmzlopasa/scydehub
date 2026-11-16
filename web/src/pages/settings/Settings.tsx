import { NavLink, Navigate, Route, Routes, Link } from 'react-router-dom';
import { Server, Activity, Bell, Siren, LayoutGrid, MonitorPlay, Palette, Shield, ScrollText, HardDrive, ArrowLeft } from 'lucide-react';
import { cx } from '../../components/ui';
import { Brand as Logo } from '../../components/Brand';
import { Services } from './Services';
import { Checks } from './Checks';
import { Alerts } from './Alerts';
import { Incidents } from './Incidents';
import { Boards } from './Boards';
import { KioskSettings } from './KioskSettings';
import { Customize } from './Customize';
import { Security } from './Security';
import { Audit } from './Audit';
import { System } from './System';

const NAV = [
  ['services', 'Services', Server], ['checks', 'Checks', Activity], ['alerts', 'Alerts & channels', Bell], ['incidents', 'Incidents', Siren],
  ['boards', 'Boards', LayoutGrid], ['kiosk', 'Kiosk & devices', MonitorPlay], ['customize', 'Customize', Palette], ['security', 'Security', Shield],
  ['audit', 'Audit log', ScrollText], ['system', 'Backup & system', HardDrive],
] as const;

export function SettingsPage() {
  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row">
      <aside className="shrink-0 md:w-56">
        <Link to="/" className="mb-6 flex items-center gap-2 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" />Dashboard</Link>
        <Logo className="mb-4 hidden md:flex" />
        <nav className="scroll-thin flex gap-1 overflow-x-auto md:flex-col">
          {NAV.map(([k, label, Icon]) => (
            <NavLink key={k} to={`/settings/${k}`} className={({ isActive }) => cx('flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition', isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-panel-2 hover:text-fg')}>
              <Icon className="size-4" />{label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <section className="min-w-0 flex-1 animate-fade-up">
        <Routes>
          <Route index element={<Navigate to="services" replace />} />
          <Route path="services" element={<Services />} />
          <Route path="checks" element={<Checks />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="incidents" element={<Incidents />} />
          <Route path="boards" element={<Boards />} />
          <Route path="kiosk" element={<KioskSettings />} />
          <Route path="customize" element={<Customize />} />
          <Route path="appearance" element={<Navigate to="/settings/customize" replace />} />
          <Route path="security" element={<Security />} />
          <Route path="audit" element={<Audit />} />
          <Route path="system" element={<System />} />
        </Routes>
      </section>
    </div>
  );
}

export function PageHead({ title, desc, right }: { title: string; desc?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{desc && <p className="mt-1 max-w-2xl text-sm text-muted">{desc}</p>}</div>
      {right}
    </div>
  );
}
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('glass rounded-3xl p-5', className)}>{children}</div>;
}
