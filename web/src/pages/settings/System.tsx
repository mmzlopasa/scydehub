import { useRef } from 'react';
import { Download, Upload, FlaskConical, Wrench } from 'lucide-react';
import { useStore, setState } from '../../lib/store';
import { fail } from '../../lib/fail';
import { useNow } from '../../lib/hooks';
import { api, post, put } from '../../lib/api';
import { Button, Input, Label } from '../../components/ui';
import { confirmDialog, toast } from '../../components/feedback';
import { dateTime } from '../../lib/format';
import { PageHead, Card } from './Settings';

export function System() {
  const s = useStore((x) => x.settings);
  const me = useStore((x) => x.me);
  const file = useRef<HTMLInputElement>(null);
  const now = useNow(15_000); // so the maintenance banner disappears when the window ends
  if (!s) return null;
  /** save a URL setting only when it changed and is valid; these two ask for the password */
  const saveUrl = (el: HTMLInputElement, current: string, body: (v: string) => object) => {
    const v = el.value.trim();
    if (v === current) return;
    if (v && !/^https?:\/\/\S+$/i.test(v)) { toast('The address must start with http:// or https://', 'bad'); el.value = current; return; }
    put('/api/settings', body(v)).then((st) => { setState({ settings: st }); toast('Saved'); }).catch((e) => { el.value = current; fail(e); });
  };
  const maint = s.maintenanceUntil > now;
  const download = async () => {
    let data;
    try { data = await api('/api/backup'); } catch (e: any) { if (e.message !== 'Cancelled') toast(e.message, 'bad'); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `scydehub-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  const restore = async (f: File) => {
    if (!(await confirmDialog({ title: 'Restore backup?', body: 'The current configuration (services, checks, boards, alerts, settings) will be replaced. Secrets can only be decrypted with the same SCYDE_SECRET_KEY.', danger: true, confirmLabel: 'Restore' }))) return;
    let parsed: unknown;
    try { parsed = JSON.parse(await f.text()); } catch { toast('That file is not valid JSON', 'bad'); return; }
    try { await post('/api/restore', parsed); toast('Backup restored'); } catch (e: any) { fail(e); }
  };
  return (
    <>
      <PageHead title="Backup & system" desc={`SCYDE Hub ${me?.version ?? ''}${me?.mockAll ? ' · the whole Hub is in MOCK mode (SCYDE_MOCK=1)' : ''}`} />
      <Card className="mb-6 space-y-3">
        <h2 className="font-semibold">Configuration backup</h2>
        <p className="text-sm text-muted">The export contains services, checks, boards, layouts, alerts, channels and settings. Secrets stay encrypted. For a full backup (with history), copy the <code>data/</code> volume.</p>
        <div className="flex flex-wrap gap-2">
          <Button icon={<Download className="size-4" />} onClick={download}>Download backup</Button>
          <Button icon={<Upload className="size-4" />} onClick={() => file.current?.click()}>Restore from file</Button>
          <input ref={file} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void restore(f); }} />
        </div>
      </Card>
      <Card className="mb-6 space-y-3">
        <h2 className="font-semibold">Public URL &amp; heartbeat</h2>
        <Label help="Used in notifications and device setup instructions"><span className="text-xs text-muted">Hub public URL</span><Input key={`p${s.publicUrl}`} defaultValue={s.publicUrl ?? ''} placeholder="https://hub.example.com" onBlur={(e) => saveUrl(e.target, s.publicUrl ?? '', (v) => ({ publicUrl: v }))} /></Label>
        <Label help="The Hub periodically sends a GET to this URL (e.g. healthchecks.io or Uptime Kuma push). If the Hub goes down together with Proxmox, the external service reports that the heartbeat has stopped."><span className="text-xs text-muted">Heartbeat URL (dead man's switch)</span>
          <Input key={`h${s.heartbeat?.url}`} defaultValue={s.heartbeat?.url ?? ''} placeholder="https://hc-ping.com/uuid" onBlur={(e) => saveUrl(e.target, s.heartbeat?.url ?? '', (v) => ({ heartbeat: { url: v } }))} /></Label>
      </Card>
      <Card className="mb-6 space-y-3">
        <h2 className="flex items-center gap-2 font-semibold"><Wrench className="size-4" />Maintenance</h2>
        <p className="text-sm text-muted">{maint ? `Notifications are muted until ${dateTime(s.maintenanceUntil)}.` : 'Mute notifications while you work on the homelab (incidents are still recorded).'}</p>
        <div className="flex flex-wrap gap-2">
          {[30, 60, 240].map((m) => <Button key={m} size="sm" onClick={() => post('/api/maintenance', { minutes: m }).then(() => toast('Notifications muted')).catch(fail)}>{m < 60 ? `${m} min` : `${m / 60} h`}</Button>)}
          {maint && <Button size="sm" variant="danger" onClick={() => post('/api/maintenance', { minutes: 0 }).then(() => toast('Notifications back on')).catch(fail)}>End</Button>}
        </div>
      </Card>
      <Card className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold"><FlaskConical className="size-4" />Demo homelab</h2>
        <p className="text-sm text-muted">Adds all integrations in mock mode, checks and five boards (Overview, Media, Infrastructure, Network, Hosting). Existing services of the same type are not duplicated.</p>
        <Button onClick={() => post('/api/demo').then(() => toast('Demo loaded')).catch(fail)}>Load demo</Button>
      </Card>
    </>
  );
}
