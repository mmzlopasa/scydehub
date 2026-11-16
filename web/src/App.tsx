import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { KeyRound, Loader2 } from 'lucide-react';
import { loadBranding, loadConfig, loadMe, useStore, setState } from './lib/store';
import { connect } from './lib/realtime';
import { kioskToken } from './lib/api';
import { detectProfile, type Profile } from './lib/device';
import { applyTheme } from './lib/theme';
import { Shell } from './components/Shell';
import { BoardView } from './pages/Board';
import { Login } from './pages/Login';
import { Kiosk } from './pages/Kiosk';
import { SettingsPage } from './pages/settings/Settings';
import { CommandPalette } from './components/CommandPalette';
import { DetailPanel } from './components/DetailPanel';
import { Toaster, ConfirmHost, SudoHost } from './components/feedback';
import { Backdrop } from './components/Backdrop';
import { Brand } from './components/Brand';
import { Button, Input } from './components/ui';

// accept ?token= on /kiosk (from the native shells or a bookmark) and keep it out of the URL bar
// Accept a kiosk token handed over by the native shells or a bookmark. Preferred form is the URL fragment
// (#token=…): fragments are never sent to the server or written to proxy logs. ?token= still works and is
// removed from the address bar straight away.
(() => {
  const u = new URL(location.href);
  const hash = new URLSearchParams(u.hash.replace(/^#/, ''));
  const t = hash.get('token') ?? u.searchParams.get('token');
  if (!t) return;
  kioskToken.set(t.slice(0, 200));
  hash.delete('token');
  u.searchParams.delete('token');
  const h = hash.toString();
  history.replaceState(null, '', u.pathname + u.search + (h ? '#' + h : ''));
})();

function BoardRoute({ profile }: { profile: Profile }) {
  const { id } = useParams();
  const boards = useStore((s) => s.boards);
  const editMode = useStore((s) => s.editMode);
  const board = boards.find((b) => b.id === id) ?? (id ? undefined : boards[0]);
  if (!board) return boards.length ? <Navigate to={`/b/${boards[0].id}`} replace /> : <div className="py-20 text-center text-muted">No boards. Turn on edit mode (pencil) and add a board, or load the demo in Settings → Backup & system.</div>;
  return <BoardView key={board.id} board={board} profile={profile} editing={editMode} />;
}

function KioskTokenEntry() {
  const [t, setT] = useState('');
  return (
    <div className="grid min-h-full place-items-center p-4">
      <form className="glass animate-fade-up w-full max-w-sm space-y-4 p-8" onSubmit={(e) => { e.preventDefault(); if (t.trim()) { kioskToken.set(t.trim()); location.reload(); } }}>
        <Brand size={34} withTagline />
        <h1 className="text-2xl font-semibold">Kiosk</h1>
        <p className="text-sm text-muted">Enter a kiosk token (Settings → Kiosk & devices) or <a className="text-accent" href="/login">sign in as admin</a>.</p>
        <Input className="font-mono" value={t} onChange={(e) => setT(e.target.value)} placeholder="sk_…" autoFocus autoComplete="off" spellCheck={false} />
        <Button type="submit" variant="primary" className="w-full" icon={<KeyRound className="size-4" />}>Connect</Button>
      </form>
    </div>
  );
}

function Authed({ profile, setProfile }: { profile: Profile; setProfile: (p: Profile) => void }) {
  const me = useStore((s) => s.me)!;
  const loaded = useStore((s) => s.loaded);
  const [palette, setPalette] = useState(false);
  const [openInstance, setOpenInstance] = useState<string | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((v) => !v); }
      if (e.key === 'Escape') setState({ editMode: false });
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  if (!loaded) return <div className="grid min-h-full place-items-center"><Loader2 className="size-6 animate-spin text-muted" /></div>;
  if (me.auth?.kind === 'kiosk') return <Routes><Route path="*" element={<Kiosk profile={profile} />} /></Routes>;
  return (
    <>
      <Routes>
        <Route path="/kiosk" element={<Kiosk profile={profile} />} />
        <Route path="/settings/*" element={<SettingsPage />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/b/:id" element={<Shell profile={profile} onProfile={setProfile} onPalette={() => setPalette(true)}><BoardRoute profile={profile} /></Shell>} />
        <Route path="*" element={<Shell profile={profile} onProfile={setProfile} onPalette={() => setPalette(true)}><BoardRoute profile={profile} /></Shell>} />
      </Routes>
      <CommandPalette open={palette} onClose={() => setPalette(false)} onOpenInstance={setOpenInstance} />
      <DetailPanel instanceId={openInstance} onClose={() => setOpenInstance(null)} />
    </>
  );
}

export default function App() {
  const me = useStore((s) => s.me);
  const settings = useStore((s) => s.settings);
  const branding = useStore((s) => s.branding);
  const [profile, setProfile] = useState<Profile>(detectProfile());
  const [err, setErr] = useState('');
  useEffect(() => {
    void loadBranding();
    loadMe()
      .then((m) => {
        if (m.auth) {
          connect();
          return loadConfig('all');
        }
        if (kioskToken.get()) kioskToken.clear(); // revoked/invalid token
      })
      .catch((e) => setErr(e.message));
  }, []);
  const look = settings ?? branding;
  useEffect(() => applyTheme(look, profile), [look, profile]);
  useEffect(() => {
    const r = () => {
      let stored: string | null = null;
      try { stored = localStorage.getItem('scyde.profile'); } catch { /* private mode */ }
      if (!stored) setProfile(detectProfile());
    };
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);

  const authed = !!me?.auth;
  return (
    <BrowserRouter>
      <Backdrop a={look?.appearance} strong={!authed} />
      {err ? (
        <div className="grid min-h-full place-items-center p-6 text-center text-muted"><div>The Hub is unreachable: {err}<br /><button className="mt-3 text-accent" onClick={() => location.reload()}>Try again</button></div></div>
      ) : !me ? (
        <div className="grid min-h-full place-items-center"><Loader2 className="size-6 animate-spin text-muted" /></div>
      ) : me.setup ? <Login setup /> : !me.auth ? (
        <Routes>
          <Route path="/kiosk" element={<KioskTokenEntry />} />
          <Route path="*" element={<Login setup={false} />} />
        </Routes>
      ) : <Authed profile={profile} setProfile={setProfile} />}
      <Toaster />
      <ConfirmHost />
      <SudoHost />
    </BrowserRouter>
  );
}
