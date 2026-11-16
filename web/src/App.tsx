import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { KeyRound, Loader2 } from 'lucide-react';
import { loadConfig, loadMe, useStore, setState } from './lib/store';
import { connect } from './lib/realtime';
import { kioskToken } from './lib/api';
import { detectProfile, type Profile } from './lib/device';
import { applyTheme } from './lib/theme';
import { Shell, Logo } from './components/Shell';
import { BoardView } from './pages/Board';
import { Login } from './pages/Login';
import { Kiosk } from './pages/Kiosk';
import { SettingsPage } from './pages/settings/Settings';
import { CommandPalette } from './components/CommandPalette';
import { DetailPanel } from './components/DetailPanel';
import { Toaster, ConfirmHost } from './components/feedback';
import { Button, Input } from './components/ui';

// accept ?token= on /kiosk (from the native shells or a bookmark) and keep it out of the URL bar
(() => {
  const u = new URL(location.href);
  const t = u.searchParams.get('token');
  if (t) {
    kioskToken.set(t);
    u.searchParams.delete('token');
    history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);
  }
})();

function BoardRoute({ profile }: { profile: Profile }) {
  const { id } = useParams();
  const boards = useStore((s) => s.boards);
  const editMode = useStore((s) => s.editMode);
  const board = boards.find((b) => b.id === id) ?? (id ? undefined : boards[0]);
  if (!board) return boards.length ? <Navigate to={`/b/${boards[0].id}`} replace /> : <div className="py-20 text-center text-muted">Nema stranica. Uključi uređivanje (olovka) i dodaj stranicu, ili učitaj demo u Postavke → Backup i sustav.</div>;
  return <BoardView key={board.id} board={board} profile={profile} editing={editMode} />;
}

function KioskTokenEntry() {
  const [t, setT] = useState('');
  return (
    <div className="grid min-h-full place-items-center p-4">
      <div className="glass w-full max-w-sm space-y-4 rounded-3xl p-7">
        <Logo />
        <h1 className="text-xl font-semibold">Kiosk</h1>
        <p className="text-sm text-muted">Upiši kiosk token (Postavke → Kiosk i uređaji) ili se <a className="text-accent" href="/login">prijavi kao admin</a>.</p>
        <Input className="font-mono" value={t} onChange={(e) => setT(e.target.value)} placeholder="sk_…" autoFocus />
        <Button variant="primary" className="w-full" icon={<KeyRound className="size-4" />} onClick={() => { kioskToken.set(t.trim()); location.reload(); }}>Spremi</Button>
      </div>
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
  const [profile, setProfile] = useState<Profile>(detectProfile());
  const [err, setErr] = useState('');
  useEffect(() => {
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
  useEffect(() => applyTheme(settings, profile), [settings, profile]);
  useEffect(() => {
    const r = () => { if (profile === 'mobile' && window.innerWidth >= 640 && !localStorage.getItem('scyde.profile')) setProfile(detectProfile()); };
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, [profile]);

  if (err) return <div className="grid min-h-full place-items-center p-6 text-center text-muted">Hub nije dostupan: {err}<br /><button className="mt-3 text-accent" onClick={() => location.reload()}>Pokušaj ponovno</button></div>;
  if (!me) return <div className="grid min-h-full place-items-center"><Loader2 className="size-6 animate-spin text-muted" /></div>;
  return (
    <BrowserRouter>
      {me.setup ? <Login setup /> : !me.auth ? (
        <Routes>
          <Route path="/kiosk" element={<KioskTokenEntry />} />
          <Route path="*" element={<Login setup={false} />} />
        </Routes>
      ) : <Authed profile={profile} setProfile={setProfile} />}
      <Toaster />
      <ConfirmHost />
    </BrowserRouter>
  );
}
