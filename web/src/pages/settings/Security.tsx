import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff, Copy, Monitor, LogOut, KeyRound, RefreshCw } from 'lucide-react';
import { useStore, loadMe } from '../../lib/store';
import { del, get, post } from '../../lib/api';
import { Button, Input, Label, Badge, Modal } from '../../components/ui';
import { confirmDialog, toast } from '../../components/feedback';
import { ago, dateTime } from '../../lib/format';
import { PageHead, Card } from './Settings';

interface Session { id: string; created_at: number; last_seen: number | null; expires_at: number; user_agent: string; ip: string; current: boolean }

function device(ua: string) {
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${br} on ${os}`;
}

export function Security() {
  const me = useStore((s) => s.me);
  const totp = me?.auth?.kind === 'admin' && me.auth.totp;
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [offCode, setOffCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const loadSessions = () => get<Session[]>('/api/auth/sessions').then(setSessions).catch(() => {});
  useEffect(() => { void loadSessions(); }, []);
  const fail = (e: any) => { if (e.message !== 'Cancelled') toast(e.message, 'bad'); };

  return (
    <>
      <PageHead title="Security" desc="The Hub holds the keys to your whole homelab. Turn on two-factor sign-in, use read-only tokens wherever a service offers them, and keep the Hub behind your LAN, VPN or an access proxy." />

      {!totp && (
        <div className="mb-6 flex items-center gap-3 rounded-[22px] border border-warn/40 bg-warn/10 px-5 py-4 text-sm">
          <ShieldOff className="size-5 shrink-0 text-warn" />
          <div><b>Two-factor sign-in is off.</b> Anyone who learns your password gets every stored API key. It takes one minute to enable.</div>
        </div>
      )}

      <Card className="mb-6 space-y-4">
        <div className="flex items-center gap-2"><h2 className="font-semibold">Two-factor sign-in (TOTP)</h2>{totp ? <Badge tone="ok">enabled</Badge> : <Badge tone="warn">disabled</Badge>}</div>
        {!totp && !setup && <Button variant="primary" icon={<ShieldCheck className="size-4" />} onClick={() => post('/api/auth/totp/begin').then(setSetup).catch(fail)}>Enable 2FA</Button>}
        {setup && (
          <div className="flex flex-wrap items-start gap-6">
            <img src={setup.qr} alt="QR code" className="rounded-2xl bg-white p-2" width={180} height={180} />
            <div className="space-y-3">
              <p className="max-w-sm text-sm text-muted">Scan with an authenticator app (Aegis, 2FAS, Google Authenticator, 1Password…) or enter the key by hand: <code className="break-all text-fg">{setup.secret}</code></p>
              <div className="flex gap-2"><Input className="w-36 font-mono tracking-widest" inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
                <Button variant="primary" onClick={() => post('/api/auth/totp/enable', { code }).then((r) => { toast('2FA enabled — other sessions were signed out'); setSetup(null); setCode(''); setRecovery(r.recoveryCodes); void loadMe(); void loadSessions(); }).catch(fail)}>Confirm</Button></div>
            </div>
          </div>
        )}
        {totp && (
          <div className="space-y-4">
            <Button icon={<RefreshCw className="size-4" />} onClick={async () => { if (await confirmDialog({ title: 'Generate new recovery codes?', body: 'The old codes stop working.', confirmLabel: 'Generate' })) post('/api/auth/totp/recovery-codes').then((r) => setRecovery(r.recoveryCodes)).catch(fail); }}>New recovery codes</Button>
            <div className="rounded-2xl border border-line p-4">
              <div className="mb-2 text-sm font-medium">Turn off 2FA</div>
              <div className="flex flex-wrap gap-2">
                <Input type="password" autoComplete="current-password" className="max-w-[200px]" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
                <Input className="max-w-[200px] font-mono" placeholder="2FA or recovery code" value={offCode} onChange={(e) => setOffCode(e.target.value)} />
                <Button variant="danger" icon={<ShieldOff className="size-4" />} onClick={() => post('/api/auth/totp/disable', { password: pw, code: offCode }).then(() => { toast('2FA disabled'); setPw(''); setOffCode(''); void loadMe(); }).catch(fail)}>Disable</Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Signed-in devices</h2>
          <Button size="sm" icon={<LogOut className="size-3.5" />} onClick={() => post('/api/auth/sessions/revoke-others').then((r) => { toast(`${r.revoked} other session(s) signed out`); void loadSessions(); }).catch(fail)}>Sign out everywhere else</Button>
        </div>
        <p className="text-sm text-muted">Sessions end after 7 days without use and at most 30 days after sign-in.</p>
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-2xl bg-panel-2 px-4 py-2.5 text-sm">
              <Monitor className="size-4 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">{device(s.user_agent ?? '')}{s.current && <Badge tone="accent">this device</Badge>}</div>
                <div className="truncate text-xs text-muted">{s.ip} · signed in {dateTime(s.created_at)} · last active {ago(s.last_seen)}</div>
              </div>
              {!s.current && <Button size="sm" variant="ghost" onClick={() => del(`/api/auth/sessions/${s.id}`).then(loadSessions).catch(fail)}>Sign out</Button>}
            </div>
          ))}
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="size-4" />Change password</h2>
        <div className="grid max-w-md gap-3">
          <Label><span className="text-xs text-muted">Current password</span><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Label>
          <Label help="At least 10 characters. Every other session is signed out."><span className="text-xs text-muted">New password</span><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Label>
          <Button variant="primary" className="w-fit" onClick={() => post('/api/auth/password', { current: cur, next }).then(() => { toast('Password changed'); setCur(''); setNext(''); void loadSessions(); }).catch(fail)}>Change password</Button>
        </div>
      </Card>

      <Modal open={!!recovery} onClose={() => setRecovery(null)} title="Recovery codes" footer={<Button variant="primary" onClick={() => setRecovery(null)}>I saved them</Button>}>
        <p className="mb-3 text-sm text-muted">Each code works once if you lose your authenticator. They are shown only now — store them in your password manager.</p>
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-panel-2 p-4 font-mono text-sm">{recovery?.map((c) => <div key={c}>{c}</div>)}</div>
        <Button className="mt-3" size="sm" icon={<Copy className="size-3.5" />} onClick={() => { void navigator.clipboard?.writeText((recovery ?? []).join('\n')); toast('Copied'); }}>Copy all</Button>
      </Modal>
    </>
  );
}
