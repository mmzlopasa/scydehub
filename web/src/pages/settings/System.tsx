import { useRef } from 'react';
import { Download, Upload, FlaskConical, Wrench } from 'lucide-react';
import { useStore } from '../../lib/store';
import { api, post, put } from '../../lib/api';
import { Button, Input, Label } from '../../components/ui';
import { confirmDialog, toast } from '../../components/feedback';
import { dateTime } from '../../lib/format';
import { PageHead, Card } from './Settings';

export function System() {
  const s = useStore((x) => x.settings);
  const me = useStore((x) => x.me);
  const file = useRef<HTMLInputElement>(null);
  if (!s) return null;
  const maint = s.maintenanceUntil > Date.now();
  const download = async () => {
    const data = await api('/api/backup');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `scydehub-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  const restore = async (f: File) => {
    if (!(await confirmDialog({ title: 'Vratiti backup?', body: 'Trenutna konfiguracija (servisi, provjere, stranice, alerti, postavke) bit će zamijenjena. Tajne se mogu dešifrirati samo s istim SCYDE_SECRET_KEY.', danger: true, confirmLabel: 'Vrati' }))) return;
    try { await post('/api/restore', JSON.parse(await f.text())); toast('Backup vraćen'); } catch (e: any) { toast(e.message, 'bad'); }
  };
  return (
    <>
      <PageHead title="Backup i sustav" desc={`SCYDE Hub ${me?.version ?? ''}${me?.mockAll ? ' · cijeli Hub je u MOCK načinu (SCYDE_MOCK=1)' : ''}`} />
      <Card className="mb-6 space-y-3">
        <h2 className="font-semibold">Backup konfiguracije</h2>
        <p className="text-sm text-muted">Izvoz sadrži servise, provjere, stranice, layoute, alerte, kanale i postavke. Tajne ostaju šifrirane. Za puni backup (s poviješću) kopiraj <code>data/</code> volume.</p>
        <div className="flex flex-wrap gap-2">
          <Button icon={<Download className="size-4" />} onClick={download}>Preuzmi backup</Button>
          <Button icon={<Upload className="size-4" />} onClick={() => file.current?.click()}>Vrati iz datoteke</Button>
          <input ref={file} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
        </div>
      </Card>
      <Card className="mb-6 space-y-3">
        <h2 className="font-semibold">Javni URL i heartbeat</h2>
        <Label help="Koristi se u obavijestima i uputama za uređaje"><span className="text-xs text-muted">Javni URL Huba</span><Input defaultValue={s.publicUrl} placeholder="https://hub.example.com" onBlur={(e) => put('/api/settings', { publicUrl: e.target.value })} /></Label>
        <Label help="Hub periodički šalje GET na ovaj URL (npr. healthchecks.io ili Uptime Kuma push). Ako Hub padne zajedno s Proxmoxom, vanjski servis javlja da heartbeat ne stiže."><span className="text-xs text-muted">Heartbeat URL (dead man's switch)</span>
          <Input defaultValue={s.heartbeat.url} placeholder="https://hc-ping.com/uuid" onBlur={(e) => put('/api/settings', { heartbeat: { ...s.heartbeat, url: e.target.value } })} /></Label>
      </Card>
      <Card className="mb-6 space-y-3">
        <h2 className="flex items-center gap-2 font-semibold"><Wrench className="size-4" />Održavanje</h2>
        <p className="text-sm text-muted">{maint ? `Obavijesti su utišane do ${dateTime(s.maintenanceUntil)}.` : 'Utišaj obavijesti dok radiš na homelabu (incidenti se i dalje bilježe).'}</p>
        <div className="flex flex-wrap gap-2">
          {[30, 60, 240].map((m) => <Button key={m} size="sm" onClick={() => post('/api/maintenance', { minutes: m }).then(() => toast('Održavanje uključeno'))}>{m < 60 ? `${m} min` : `${m / 60} h`}</Button>)}
          {maint && <Button size="sm" variant="danger" onClick={() => post('/api/maintenance', { minutes: 0 })}>Završi</Button>}
        </div>
      </Card>
      <Card className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold"><FlaskConical className="size-4" />Demo homelab</h2>
        <p className="text-sm text-muted">Dodaje sve integracije u mock načinu, provjere i pet stranica (Pregled, Media, Infrastruktura, Mreža, Hosting). Postojeći servisi istog tipa se ne dupliciraju.</p>
        <Button onClick={() => post('/api/demo').then(() => toast('Demo učitan'))}>Učitaj demo</Button>
      </Card>
    </>
  );
}
