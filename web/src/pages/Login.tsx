import { useState } from 'react';
import { ArrowRight, KeyRound, ShieldCheck, Lock } from 'lucide-react';
import { post } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, Input, Label } from '../components/ui';
import { Brand } from '../components/Brand';

export function Login({ setup }: { setup: boolean }) {
  const b = useStore((s) => s.branding?.branding);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (setup) await post('/api/auth/setup', { code: setupCode, username, password });
      else await post('/api/auth/login', { username, password, code: code || undefined });
      location.assign('/');
    } catch (e: any) {
      if (e.body?.needTotp) setNeedTotp(true);
      setErr(e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-full items-center px-5 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:px-[8vw]">
      <div className="mx-auto w-full max-w-md">
        <form onSubmit={submit} className="glass fill-aurora animate-fade-up relative space-y-5 p-8 sm:p-10">
          <Brand size={36} withTagline />
          <div className="pt-2">
            <h1 className="text-[2rem] font-semibold leading-[1.05] tracking-tight">{setup ? 'Create your admin account' : b?.loginTitle || 'Welcome back'}</h1>
            <p className="mt-2 text-sm text-muted">{setup ? 'The setup code is printed in the server log (docker compose logs hub).' : b?.loginSubtitle || 'Sign in to your dashboard.'}</p>
          </div>
          {setup && <Label><span className="text-xs font-medium text-muted">Setup code from the log</span><Input className="font-mono uppercase tracking-widest" autoCapitalize="characters" autoComplete="off" spellCheck={false} value={setupCode} onChange={(e) => setSetupCode(e.target.value)} autoFocus /></Label>}
          <Label><span className="text-xs font-medium text-muted">Username</span><Input autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={!setup} /></Label>
          <Label help={setup ? 'At least 10 characters. Use a password manager.' : undefined}><span className="text-xs font-medium text-muted">Password</span><Input type="password" autoComplete={setup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} /></Label>
          {needTotp && (
            <Label help="6-digit code from your authenticator app, or a recovery code."><span className="flex items-center gap-1 text-xs font-medium text-muted"><ShieldCheck className="size-3.5" />Two-factor code</span>
              <Input className="font-mono tracking-widest" autoComplete="one-time-code" maxLength={11} value={code} onChange={(e) => setCode(e.target.value)} autoFocus /></Label>
          )}
          {err && <div className="rounded-2xl bg-bad/10 px-4 py-2.5 text-sm text-bad">{err}</div>}
          <Button type="submit" variant="primary" className="!h-12 w-full !text-[15px]" loading={busy} icon={setup ? <KeyRound className="size-4" /> : undefined}>
            {setup ? 'Create account' : 'Sign in'}{!setup && !busy && <ArrowRight className="size-4" />}
          </Button>
          <div className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-muted"><Lock className="size-3" />Secrets are encrypted at rest and never leave the server.</div>
        </form>
      </div>
      <div className="pointer-events-none hidden select-none pl-10 lg:block">
        <div className="animate-fade-up" style={{ animationDelay: '120ms', textShadow: '0 2px 30px var(--bg), 0 0 60px var(--bg)' }}>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-line-2 bg-panel-2 px-3 py-1 text-xs text-muted"><span className="size-1.5 rounded-full bg-accent" />self-hosted · private · yours</div>
          <div className="max-w-xl text-[clamp(2.4rem,4.4vw,4.2rem)] font-semibold leading-[1.02] tracking-[-0.035em]">Your whole homelab, <span className="grad-text">on one screen.</span></div>
          <p className="mt-5 max-w-md text-lg text-muted">Live status, history, alerts and actions for every service — on a monitor, a TV or a tablet.</p>
        </div>
      </div>
    </div>
  );
}
