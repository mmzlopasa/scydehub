import { useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { post } from '../lib/api';
import { Button, Input, Label } from '../components/ui';
import { Logo } from '../components/Shell';

export function Login({ setup }: { setup: boolean }) {
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
    <div className="grid min-h-full place-items-center p-4">
      <form onSubmit={submit} className="glass animate-fade-up w-full max-w-sm space-y-5 rounded-3xl p-7">
        <Logo />
        <div>
          <h1 className="text-xl font-semibold">{setup ? 'Prvo pokretanje' : 'Prijava'}</h1>
          <p className="text-sm text-muted">{setup ? 'Napravi admin račun. Kod za postavljanje je ispisan u logovima servera (docker compose logs).' : 'Dobro došao natrag.'}</p>
        </div>
        {setup && <Label><span className="text-xs font-medium text-muted">Kod iz logova</span><Input inputMode="numeric" value={setupCode} onChange={(e) => setSetupCode(e.target.value)} autoFocus /></Label>}
        <Label><span className="text-xs font-medium text-muted">Korisničko ime</span><Input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={!setup} /></Label>
        <Label help={setup ? 'Barem 10 znakova' : undefined}><span className="text-xs font-medium text-muted">Lozinka</span><Input type="password" autoComplete={setup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} /></Label>
        {needTotp && (
          <Label><span className="flex items-center gap-1 text-xs font-medium text-muted"><ShieldCheck className="size-3.5" />2FA kod</span>
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoFocus /></Label>
        )}
        {err && <div className="rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">{err}</div>}
        <Button type="submit" variant="primary" className="w-full" loading={busy} icon={<KeyRound className="size-4" />}>{setup ? 'Napravi račun' : 'Prijavi se'}</Button>
      </form>
    </div>
  );
}
