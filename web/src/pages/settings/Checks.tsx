import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Play } from 'lucide-react';
import { useStore } from '../../lib/store';
import { del, get, patch, post } from '../../lib/api';
import { Badge, Button, Input, Label, Modal, StatusDot, Toggle, inputCls } from '../../components/ui';
import { confirmDialog, toast } from '../../components/feedback';
import { CheckDetails } from '../../components/DetailPanel';
import { PageHead, Card } from './Settings';
import { fail } from '../../lib/fail';

const TYPES = [
  { v: 'ping', l: 'Ping (ICMP)', target: 'Host or IP', ph: '192.168.1.10' },
  { v: 'tcp', l: 'TCP port', target: 'host:port', ph: '192.168.1.20:5055' },
  { v: 'http', l: 'HTTP(S) status / keyword', target: 'URL', ph: 'https://streamero.example.com' },
  { v: 'ssl', l: 'SSL certificate', target: 'Domain[:port]', ph: 'vault.example.com' },
  { v: 'dns', l: 'DNS', target: 'Name to resolve', ph: 'example.com' },
];

function CheckForm({ check, onClose }: { check?: any; onClose: () => void }) {
  const instances = useStore((s) => s.instances);
  const [f, setF] = useState<any>(check ?? { name: '', type: 'http', target: '', interval_sec: 60, enabled: true, options: {}, instance_id: null });
  const o = f.options ?? {};
  const setO = (k: string, v: any) => setF((s: any) => ({ ...s, options: { ...s.options, [k]: v } }));
  const t = TYPES.find((x) => x.v === f.type)!;
  const save = async () => {
    if (!f.name.trim() || !f.target.trim()) return toast('Name and target are required', 'bad');
    const interval = Number(f.interval_sec);
    if (!Number.isFinite(interval) || interval < 10) return toast('The interval must be at least 10 seconds', 'bad');
    // empty option fields are left out so the probe uses its defaults (an empty DNS record type would never resolve)
    const options = Object.fromEntries(Object.entries(f.options ?? {}).filter(([, v]) => v !== '' && v !== undefined && v !== null));
    try {
      if (check) await patch(`/api/checks/${check.id}`, { ...f, options }); else await post('/api/checks', { ...f, options });
      toast('Saved'); onClose();
    } catch (e: any) { fail(e); }
  };
  return (
    <Modal open onClose={onClose} title={check ? 'Edit check' : 'New check'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <Label><span className="text-xs font-medium text-muted">Name</span><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Label>
        <Label><span className="text-xs font-medium text-muted">Type</span><select className={inputCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{TYPES.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</select></Label>
        <Label><span className="text-xs font-medium text-muted">{t.target}</span><Input value={f.target} placeholder={t.ph} onChange={(e) => setF({ ...f, target: e.target.value })} /></Label>
        {f.type === 'http' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Label><span className="text-xs font-medium text-muted">Expected status</span><Input value={o.expectStatus ?? ''} placeholder="200-399" onChange={(e) => setO('expectStatus', e.target.value)} /></Label>
            <Label><span className="text-xs font-medium text-muted">Keyword</span><Input value={o.keyword ?? ''} onChange={(e) => setO('keyword', e.target.value)} /></Label>
            <Toggle checked={!!o.invertKeyword} onChange={(v) => setO('invertKeyword', v)} label="Fail if the keyword IS present" />
            <Toggle checked={!!o.insecure} onChange={(v) => setO('insecure', v)} label="Accept self-signed (this check only)" />
          </div>
        )}
        {f.type === 'ssl' && <Label><span className="text-xs font-medium text-muted">Warn when expiring within (days)</span><Input type="number" value={o.warnDays ?? 14} onChange={(e) => setO('warnDays', e.target.value === '' ? '' : Number(e.target.value))} /></Label>}
        {f.type === 'dns' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Label><span className="text-xs font-medium text-muted">DNS server</span><Input value={o.server ?? ''} placeholder="192.168.1.2" onChange={(e) => setO('server', e.target.value)} /></Label>
            <Label><span className="text-xs font-medium text-muted">Record</span><Input value={o.recordType ?? 'A'} onChange={(e) => setO('recordType', e.target.value)} /></Label>
            <Label><span className="text-xs font-medium text-muted">Expect</span><Input value={o.expect ?? ''} onChange={(e) => setO('expect', e.target.value)} /></Label>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Label><span className="text-xs font-medium text-muted">Interval (s)</span><Input type="number" min={10} value={f.interval_sec} onChange={(e) => setF({ ...f, interval_sec: e.target.value === '' ? '' : Number(e.target.value) })} /></Label>
          <Label><span className="text-xs font-medium text-muted">Link to service</span>
            <select className={inputCls} value={f.instance_id ?? ''} onChange={(e) => setF({ ...f, instance_id: e.target.value || null })}><option value="">— standalone —</option>{instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
          </Label>
        </div>
        <div className="flex gap-6"><Toggle checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="Enabled" /><Toggle checked={!!o.mock} onChange={(v) => setO('mock', v)} label="Mock" /></div>
      </div>
    </Modal>
  );
}

export function Checks() {
  const states = useStore((s) => s.checks);
  const [rows, setRows] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => get('/api/checks').then(setRows).catch(fail);
  const idsKey = Object.keys(states).sort().join(',');
  useEffect(() => { void load(); }, [idsKey]);
  return (
    <>
      <PageHead title="Checks" desc="Built-in uptime monitoring: ping, TCP, HTTP with keyword, SSL expiry and DNS. Latency is kept in history; uptime is calculated for 24 h, 7 and 30 days."
        right={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit(null)}>New check</Button>} />
      <div className="space-y-2">
        {rows.map((c) => {
          const s = states[c.id];
          return (
            <Card key={c.id} className="!p-4">
              <div className="flex items-center gap-3">
                <StatusDot status={s?.ok ?? null} />
                <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === c.id ? null : c.id)}>
                  <div className="flex items-center gap-2 font-medium">{c.name}<Badge>{c.type.toUpperCase()}</Badge>{!c.enabled && <Badge>disabled</Badge>}</div>
                  <div className="truncate text-xs text-muted">{c.target} · {s?.message ?? '—'} · 24 h: {s?.uptime?.d1 != null ? `${s.uptime.d1}%` : '—'}</div>
                </button>
                <span className="num text-sm">{s?.latencyMs != null ? `${Math.round(s.latencyMs)} ms` : ''}</span>
                {c.enabled && <Button size="sm" variant="ghost" title="Run now" icon={<Play className="size-3.5" />} onClick={() => post(`/api/checks/${c.id}/run`).then((r) => toast(r?.ok ? `Passed${r.latencyMs != null ? ` (${Math.round(r.latencyMs)} ms)` : ''}` : `Failed: ${r?.message ?? 'no answer'}`, r?.ok ? 'ok' : 'bad')).catch(fail)} />}
                <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(c)} />
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={async () => { if (await confirmDialog({ title: `Delete ${c.name}?`, danger: true, confirmLabel: 'Delete' })) { await del(`/api/checks/${c.id}`).catch(fail); load(); } }} />
              </div>
              {open === c.id && s && <div className="mt-3"><CheckDetails c={s} /></div>}
            </Card>
          );
        })}
        {!rows.length && <Card><div className="py-6 text-center text-sm text-muted">No checks.</div></Card>}
      </div>
      {edit !== undefined && <CheckForm check={edit ?? undefined} onClose={() => { setEdit(undefined); load(); }} />}
    </>
  );
}
