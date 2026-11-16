import { useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { useStore, loadMe } from '../../lib/store';
import { post } from '../../lib/api';
import { Button, Input, Label, Badge } from '../../components/ui';
import { toast } from '../../components/feedback';
import { PageHead, Card } from './Settings';

export function Security() {
  const me = useStore((s) => s.me);
  const totp = me?.auth?.kind === 'admin' && me.auth.totp;
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  return (
    <>
      <PageHead title="Sigurnost" desc="Hub drži ključeve cijelog homelaba. Uključi 2FA, koristi read-only tokene gdje god servis to podržava i ne izlaži Hub direktno na internet." />
      <Card className="mb-6 space-y-4">
        <div className="flex items-center gap-2"><h2 className="font-semibold">Dvofaktorska prijava (TOTP)</h2>{totp ? <Badge tone="ok">uključena</Badge> : <Badge tone="warn">isključena</Badge>}</div>
        {!totp && !setup && <Button variant="primary" icon={<ShieldCheck className="size-4" />} onClick={() => post('/api/auth/totp/begin').then(setSetup)}>Uključi 2FA</Button>}
        {setup && (
          <div className="flex flex-wrap items-start gap-6">
            <img src={setup.qr} alt="QR" className="rounded-2xl bg-white p-2" width={180} height={180} />
            <div className="space-y-3">
              <p className="max-w-sm text-sm text-muted">Skeniraj u aplikaciji (Aegis, 2FAS, Google Authenticator, 1Password…) ili ručno upiši: <code className="break-all text-fg">{setup.secret}</code></p>
              <div className="flex gap-2"><Input className="w-36" inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
                <Button variant="primary" onClick={() => post('/api/auth/totp/enable', { code }).then(() => { toast('2FA uključena'); setSetup(null); loadMe(); }).catch((e) => toast(e.message, 'bad'))}>Potvrdi</Button></div>
            </div>
          </div>
        )}
        {totp && (
          <div className="flex flex-wrap gap-2"><Input type="password" className="max-w-xs" placeholder="Lozinka za isključivanje" value={pw} onChange={(e) => setPw(e.target.value)} />
            <Button icon={<ShieldOff className="size-4" />} onClick={() => post('/api/auth/totp/disable', { password: pw }).then(() => { toast('2FA isključena'); loadMe(); }).catch((e) => toast(e.message, 'bad'))}>Isključi 2FA</Button></div>
        )}
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">Promjena lozinke</h2>
        <div className="grid max-w-md gap-3">
          <Label><span className="text-xs text-muted">Trenutna lozinka</span><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Label>
          <Label help="Barem 10 znakova. Ostale sesije se odjavljuju."><span className="text-xs text-muted">Nova lozinka</span><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Label>
          <Button variant="primary" className="w-fit" onClick={() => post('/api/auth/password', { current: cur, next }).then(() => { toast('Lozinka promijenjena'); setCur(''); setNext(''); }).catch((e) => toast(e.message, 'bad'))}>Promijeni</Button>
        </div>
      </Card>
    </>
  );
}
