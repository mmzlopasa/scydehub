import { useEffect, useState } from 'react';
import { Plus, Copy, Ban, Tv, Tablet, Monitor } from 'lucide-react';
import { useStore } from '../../lib/store';
import { del, get, post, put } from '../../lib/api';
import { Badge, Button, Input, Label, Modal, Toggle } from '../../components/ui';
import { confirmDialog, toast } from '../../components/feedback';
import { ago } from '../../lib/format';
import { PageHead, Card } from './Settings';

export function KioskSettings() {
  const settings = useStore((s) => s.settings);
  const [tokens, setTokens] = useState<any[]>([]);
  const [newTok, setNewTok] = useState<string | null>(null);
  const [name, setName] = useState('Dnevni boravak TV');
  const k = settings?.kiosk;
  const load = () => get('/api/kiosk-tokens').then(setTokens);
  useEffect(() => { load(); }, []);
  if (!k) return null;
  const save = (patch: any) => put('/api/settings', { kiosk: { ...k, ...patch } });
  const hub = settings?.publicUrl || location.origin;

  return (
    <>
      <PageHead title="Kiosk i uređaji" desc="Kiosk prikazuje samo sadržaj — bez navigacije, kursora i edit kontrola. Svaki uređaj dobiva vlastiti token (samo čitanje) koji možeš opozvati jednim klikom." />
      <Card className="mb-6">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Kiosk tokeni</h2></div>
        <div className="mb-4 flex flex-wrap gap-2">
          <Input className="max-w-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="Naziv uređaja" />
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => post('/api/kiosk-tokens', { name }).then((r) => { setNewTok(r.token); load(); })}>Novi token</Button>
        </div>
        <div className="space-y-2">
          {tokens.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-2xl bg-panel-2 px-3 py-2 text-sm">
              <div className="flex-1"><div className="font-medium">{t.name}</div><div className="text-xs text-muted">Napravljen {ago(t.created_at)} · zadnje korišten {ago(t.last_used_at)}</div></div>
              {t.revoked_at ? <Badge tone="bad">opozvan</Badge> : (
                <Button size="sm" variant="ghost" icon={<Ban className="size-3.5" />} onClick={async () => { if (await confirmDialog({ title: `Opozovi token „${t.name}"?`, body: 'Uređaj odmah gubi pristup.', danger: true, confirmLabel: 'Opozovi' })) { await del(`/api/kiosk-tokens/${t.id}`); load(); } }}>Opozovi</Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-6 space-y-4">
        <h2 className="font-semibold">Ponašanje kioska</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Label help="0 = bez rotacije"><span className="text-xs font-medium text-muted">Rotacija stranica (s)</span><Input type="number" defaultValue={k.rotationSec} onBlur={(e) => save({ rotationSec: Number(e.target.value) })} /></Label>
          <Label><span className="text-xs font-medium text-muted">Pauza nakon dodira/tipke (s)</span><Input type="number" defaultValue={k.pauseOnInteractSec} onBlur={(e) => save({ pauseOnInteractSec: Number(e.target.value) })} /></Label>
        </div>
        <Toggle checked={k.alertTakeover} onChange={(v) => save({ alertTakeover: v })} label="Kritični incident preuzima ekran dok ga ne potvrdiš" />
        <Toggle checked={k.pixelShift} onChange={(v) => save({ pixelShift: v })} label="Zaštita od burn-ina (lagani pomak piksela)" />
        <div className="grid items-end gap-4 sm:grid-cols-4">
          <Toggle checked={k.nightDim.enabled} onChange={(v) => save({ nightDim: { ...k.nightDim, enabled: v } })} label="Noćno zatamnjenje" />
          <Label><span className="text-xs font-medium text-muted">Od</span><Input type="time" defaultValue={k.nightDim.start} onBlur={(e) => save({ nightDim: { ...k.nightDim, start: e.target.value } })} /></Label>
          <Label><span className="text-xs font-medium text-muted">Do</span><Input type="time" defaultValue={k.nightDim.end} onBlur={(e) => save({ nightDim: { ...k.nightDim, end: e.target.value } })} /></Label>
          <Label><span className="text-xs font-medium text-muted">Jačina (0–0.9)</span><Input type="number" step="0.05" min="0" max="0.9" defaultValue={k.nightDim.level} onBlur={(e) => save({ nightDim: { ...k.nightDim, level: Number(e.target.value) } })} /></Label>
        </div>
      </Card>

      <Card className="space-y-3 text-sm">
        <h2 className="font-semibold">Postavljanje uređaja</h2>
        <div className="flex gap-3"><Tv className="mt-0.5 size-5 shrink-0 text-accent" /><div><b>Android TV</b> — instaliraj <code>scydehub-tv.apk</code> (GitHub Actions → Releases). Pri prvom pokretanju upiši URL Huba (<code>{hub}</code>) i kiosk token. Strelice lijevo/desno mijenjaju stranice, OK pauzira rotaciju.</div></div>
        <div className="flex gap-3"><Tablet className="mt-0.5 size-5 shrink-0 text-accent" /><div><b>iPad / iPhone</b> — potpiši <code>scydehub.ipa</code> kroz Feather i instaliraj. Upiši URL i token. Uključi <i>Guided Access</i> (Postavke → Pristupačnost) da se aplikacija ne može napustiti.</div></div>
        <div className="flex gap-3"><Monitor className="mt-0.5 size-5 shrink-0 text-accent" /><div><b>Monitor / mini PC</b> — otvori <code>{hub}/kiosk?token=…&profile=desktop</code> ili pokreni <code>chromium --kiosk --noerrdialogs --disable-session-crashed-bubble "{hub}/kiosk?token=…"</code>.</div></div>
      </Card>

      <Modal open={!!newTok} onClose={() => setNewTok(null)} title="Novi kiosk token" footer={<Button variant="primary" onClick={() => setNewTok(null)}>Gotovo</Button>}>
        <p className="mb-3 text-sm text-muted">Token se prikazuje samo sada. Spremi ga u aplikaciju na uređaju.</p>
        <div className="flex gap-2"><Input readOnly value={newTok ?? ''} className="font-mono text-xs" /><Button icon={<Copy className="size-4" />} onClick={() => { navigator.clipboard?.writeText(newTok ?? ''); toast('Kopirano'); }} /></div>
        <p className="mt-4 text-xs text-muted">Direktni link za preglednik:</p>
        <div className="mt-1 break-all rounded-xl bg-panel-2 p-2 font-mono text-xs">{hub}/kiosk?token={newTok}</div>
      </Modal>
    </>
  );
}
