import { useEffect, useState } from 'react';
import { Plus, Copy, Ban, Tv, Tablet, Monitor } from 'lucide-react';
import { useStore, setState } from '../../lib/store';
import { fail, numOr } from '../../lib/fail';
import { del, get, post, put } from '../../lib/api';
import { Badge, Button, Input, Label, Modal, Toggle } from '../../components/ui';
import { confirmDialog, toast } from '../../components/feedback';
import { ago } from '../../lib/format';
import { PageHead, Card } from './Settings';

export function KioskSettings() {
  const settings = useStore((s) => s.settings);
  const [tokens, setTokens] = useState<any[]>([]);
  const [newTok, setNewTok] = useState<string | null>(null);
  const [name, setName] = useState('Living room TV');
  const k = settings?.kiosk;
  const [canAck, setCanAck] = useState(true);
  const load = () => get('/api/kiosk-tokens').then(setTokens).catch(fail);
  useEffect(() => { load(); }, []);
  if (!k) return null;
  // only the changed keys are sent (the server merges), and its answer becomes the new truth — two quick
  // toggles can no longer overwrite each other
  const save = (patch: any) => put('/api/settings', { kiosk: patch }).then((st) => setState({ settings: st })).catch(fail);
  const hub = settings?.publicUrl || location.origin;

  return (
    <>
      <PageHead title="Kiosk & devices" desc="The kiosk shows content only — no navigation, cursor or edit controls. Each device gets its own read-only token that you can revoke with one click." />
      <Card className="mb-6">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Kiosk tokens</h2></div>
        <div className="mb-4 flex flex-wrap gap-2">
          <Input className="max-w-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="Device name" />
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => post('/api/kiosk-tokens', { name, canAck }).then((r) => { setNewTok(r.token); load(); }).catch((e) => { if (e.message !== 'Cancelled') toast(e.message, 'bad'); })}>New token</Button>
        </div>
        <div className="mb-4"><Toggle checked={canAck} onChange={setCanAck} label="This device may acknowledge incidents (off = strictly read-only)" /></div>
        <div className="space-y-2">
          {tokens.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-2xl bg-panel-2 px-3 py-2 text-sm">
              <div className="flex-1"><div className="flex items-center gap-2 font-medium">{t.name}{!t.can_ack && <Badge>read-only</Badge>}</div><div className="text-xs text-muted">Created {ago(t.created_at)} · last used {ago(t.last_used_at)}</div></div>
              {t.revoked_at ? <Badge tone="bad">revoked</Badge> : (
                <Button size="sm" variant="ghost" icon={<Ban className="size-3.5" />} onClick={async () => { if (await confirmDialog({ title: `Revoke token "${t.name}"?`, body: 'The device loses access immediately.', danger: true, confirmLabel: 'Revoke' })) { await del(`/api/kiosk-tokens/${t.id}`).catch(fail); load(); } }}>Revoke</Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-6 space-y-4">
        <h2 className="font-semibold">Kiosk behavior</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Label help="0 = stay on the first board"><span className="text-xs font-medium text-muted">Board rotation (s)</span><Input type="number" defaultValue={k.rotationSec} onBlur={(e) => { const n = numOr(e.target.value, 0, 86400); if (n === undefined) e.target.value = String(k.rotationSec); else if (n !== k.rotationSec) save({ rotationSec: n }); }} /></Label>
          <Label><span className="text-xs font-medium text-muted">Pause after touch/key press (s)</span><Input type="number" defaultValue={k.pauseOnInteractSec} onBlur={(e) => { const n = numOr(e.target.value, 0, 86400); if (n === undefined) e.target.value = String(k.pauseOnInteractSec); else if (n !== k.pauseOnInteractSec) save({ pauseOnInteractSec: n }); }} /></Label>
        </div>
        <Toggle checked={k.showHeader !== false} onChange={(v) => save({ showHeader: v })} label="Show the top line (board name, status, clock)" />
        <Toggle checked={k.alertTakeover} onChange={(v) => save({ alertTakeover: v })} label="A critical incident takes over the screen until you acknowledge it" />
        <Toggle checked={k.pixelShift} onChange={(v) => save({ pixelShift: v })} label="Burn-in protection (slight pixel shift)" />
        <div className="grid items-end gap-4 sm:grid-cols-4">
          <Toggle checked={k.nightDim.enabled} onChange={(v) => save({ nightDim: { enabled: v } })} label="Night dimming" />
          <Label><span className="text-xs font-medium text-muted">From</span><Input type="time" defaultValue={k.nightDim.start} onBlur={(e) => e.target.value && e.target.value !== k.nightDim.start && save({ nightDim: { start: e.target.value } })} /></Label>
          <Label><span className="text-xs font-medium text-muted">To</span><Input type="time" defaultValue={k.nightDim.end} onBlur={(e) => e.target.value && e.target.value !== k.nightDim.end && save({ nightDim: { end: e.target.value } })} /></Label>
          <Label><span className="text-xs font-medium text-muted">Strength (0–0.9)</span><Input type="number" step="0.05" min="0" max="0.9" defaultValue={k.nightDim.level} onBlur={(e) => { const n = numOr(e.target.value, 0, 0.9); if (n === undefined) e.target.value = String(k.nightDim.level); else if (n !== k.nightDim.level) save({ nightDim: { level: n } }); }} /></Label>
        </div>
      </Card>

      <Card className="space-y-3 text-sm">
        <h2 className="font-semibold">Device setup</h2>
        <div className="flex gap-3"><Tv className="mt-0.5 size-5 shrink-0 text-accent" /><div><b>Android TV</b> — install <code>scydehub-tv.apk</code> (from the Releases page of the repository). On first launch, enter the Hub URL (<code>{hub}</code>) and a kiosk token. Left/right arrows switch boards, OK pauses the rotation.</div></div>
        <div className="flex gap-3"><Tablet className="mt-0.5 size-5 shrink-0 text-accent" /><div><b>iPad / iPhone</b> — sign <code>scydehub.ipa</code> with Feather and install it. Enter the URL and token. Turn on <i>Guided Access</i> (Settings → Accessibility) so the app can't be exited.</div></div>
        <div className="flex gap-3"><Monitor className="mt-0.5 size-5 shrink-0 text-accent" /><div><b>Monitor / mini PC</b> — open <code>{hub}/kiosk?profile=desktop#token=…</code> or run <code>chromium --kiosk --noerrdialogs --disable-session-crashed-bubble "{hub}/kiosk#token=…"</code>.</div></div>
      </Card>

      <Modal open={!!newTok} onClose={() => setNewTok(null)} title="New kiosk token" footer={<Button variant="primary" onClick={() => setNewTok(null)}>Done</Button>}>
        <p className="mb-3 text-sm text-muted">The token is shown only once. Save it in the app on the device.</p>
        <div className="flex gap-2"><Input readOnly value={newTok ?? ''} className="font-mono text-xs" /><Button icon={<Copy className="size-4" />} onClick={() => { navigator.clipboard?.writeText(newTok ?? ''); toast('Copied'); }} /></div>
        <p className="mt-4 text-xs text-muted">Direct link for a browser:</p>
        <div className="mt-1 break-all rounded-xl bg-panel-2 p-2 font-mono text-xs">{hub}/kiosk#token={newTok}</div>
      </Modal>
    </>
  );
}
