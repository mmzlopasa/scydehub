import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Play } from 'lucide-react';
import { useStore } from '../../lib/store';
import { del, get, patch, post } from '../../lib/api';
import { Badge, Button, Input, Label, Modal, StatusDot, Toggle, inputCls } from '../../components/ui';
import { confirmDialog, toast } from '../../components/feedback';
import { CheckDetails } from '../../components/DetailPanel';
import { PageHead, Card } from './Settings';

const TYPES = [
  { v: 'ping', l: 'Ping (ICMP)', target: 'Host ili IP', ph: '192.168.1.10' },
  { v: 'tcp', l: 'TCP port', target: 'host:port', ph: '192.168.1.20:5055' },
  { v: 'http', l: 'HTTP(S) status / ključna riječ', target: 'URL', ph: 'https://streamero.example.com' },
  { v: 'ssl', l: 'SSL certifikat', target: 'Domena[:port]', ph: 'vault.example.com' },
  { v: 'dns', l: 'DNS', target: 'Ime za resolve', ph: 'example.com' },
];

function CheckForm({ check, onClose }: { check?: any; onClose: () => void }) {
  const instances = useStore((s) => s.instances);
  const [f, setF] = useState<any>(check ?? { name: '', type: 'http', target: '', interval_sec: 60, enabled: true, options: {}, instance_id: null });
  const o = f.options ?? {};
  const setO = (k: string, v: any) => setF((s: any) => ({ ...s, options: { ...s.options, [k]: v } }));
  const t = TYPES.find((x) => x.v === f.type)!;
  const save = async () => {
    if (!f.name || !f.target) return toast('Naziv i cilj su obavezni', 'bad');
    try {
      if (check) await patch(`/api/checks/${check.id}`, f); else await post('/api/checks', f);
      toast('Spremljeno'); onClose();
    } catch (e: any) { toast(e.message, 'bad'); }
  };
  return (
    <Modal open onClose={onClose} title={check ? 'Uredi provjeru' : 'Nova provjera'} footer={<><Button variant="ghost" onClick={onClose}>Odustani</Button><Button variant="primary" onClick={save}>Spremi</Button></>}>
      <div className="space-y-3">
        <Label><span className="text-xs font-medium text-muted">Naziv</span><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Label>
        <Label><span className="text-xs font-medium text-muted">Tip</span><select className={inputCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{TYPES.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</select></Label>
        <Label><span className="text-xs font-medium text-muted">{t.target}</span><Input value={f.target} placeholder={t.ph} onChange={(e) => setF({ ...f, target: e.target.value })} /></Label>
        {f.type === 'http' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Label><span className="text-xs font-medium text-muted">Očekivani status</span><Input value={o.expectStatus ?? ''} placeholder="200-399" onChange={(e) => setO('expectStatus', e.target.value)} /></Label>
            <Label><span className="text-xs font-medium text-muted">Ključna riječ</span><Input value={o.keyword ?? ''} onChange={(e) => setO('keyword', e.target.value)} /></Label>
            <Toggle checked={!!o.invertKeyword} onChange={(v) => setO('invertKeyword', v)} label="Greška ako riječ POSTOJI" />
            <Toggle checked={!!o.insecure} onChange={(v) => setO('insecure', v)} label="Prihvati self-signed (samo ova provjera)" />
          </div>
        )}
        {f.type === 'ssl' && <Label><span className="text-xs font-medium text-muted">Upozori kad ističe za (dana)</span><Input type="number" value={o.warnDays ?? 14} onChange={(e) => setO('warnDays', Number(e.target.value))} /></Label>}
        {f.type === 'dns' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Label><span className="text-xs font-medium text-muted">DNS server</span><Input value={o.server ?? ''} placeholder="192.168.1.2" onChange={(e) => setO('server', e.target.value)} /></Label>
            <Label><span className="text-xs font-medium text-muted">Zapis</span><Input value={o.recordType ?? 'A'} onChange={(e) => setO('recordType', e.target.value)} /></Label>
            <Label><span className="text-xs font-medium text-muted">Očekuj</span><Input value={o.expect ?? ''} onChange={(e) => setO('expect', e.target.value)} /></Label>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Label><span className="text-xs font-medium text-muted">Interval (s)</span><Input type="number" min={10} value={f.interval_sec} onChange={(e) => setF({ ...f, interval_sec: Number(e.target.value) })} /></Label>
          <Label><span className="text-xs font-medium text-muted">Veži uz servis</span>
            <select className={inputCls} value={f.instance_id ?? ''} onChange={(e) => setF({ ...f, instance_id: e.target.value || null })}><option value="">— samostalna —</option>{instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
          </Label>
        </div>
        <div className="flex gap-6"><Toggle checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="Uključena" /><Toggle checked={!!o.mock} onChange={(v) => setO('mock', v)} label="Mock" /></div>
      </div>
    </Modal>
  );
}

export function Checks() {
  const states = useStore((s) => s.checks);
  const [rows, setRows] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => get('/api/checks').then(setRows);
  useEffect(() => { load(); }, [states]);
  return (
    <>
      <PageHead title="Provjere" desc="Vlastiti uptime monitoring: ping, TCP, HTTP s ključnom riječi, istek SSL-a i DNS. Latencija ide u povijest, uptime se računa za 24 h, 7 i 30 dana."
        right={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit(null)}>Nova provjera</Button>} />
      <div className="space-y-2">
        {rows.map((c) => {
          const s = states[c.id];
          return (
            <Card key={c.id} className="!p-4">
              <div className="flex items-center gap-3">
                <StatusDot status={s?.ok ?? null} />
                <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === c.id ? null : c.id)}>
                  <div className="flex items-center gap-2 font-medium">{c.name}<Badge>{c.type.toUpperCase()}</Badge>{!c.enabled && <Badge>isključena</Badge>}</div>
                  <div className="truncate text-xs text-muted">{c.target} · {s?.message ?? '—'} · 24 h: {s?.uptime?.d1 ?? '—'}%</div>
                </button>
                <span className="num text-sm">{s?.latencyMs != null ? `${Math.round(s.latencyMs)} ms` : ''}</span>
                <Button size="sm" variant="ghost" icon={<Play className="size-3.5" />} onClick={() => post(`/api/checks/${c.id}/run`).then(() => toast('Provjera pokrenuta'))} />
                <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(c)} />
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={async () => { if (await confirmDialog({ title: `Obriši ${c.name}?`, danger: true, confirmLabel: 'Obriši' })) { await del(`/api/checks/${c.id}`); load(); } }} />
              </div>
              {open === c.id && s && <div className="mt-3"><CheckDetails c={s} /></div>}
            </Card>
          );
        })}
        {!rows.length && <Card><div className="py-6 text-center text-sm text-muted">Nema provjera.</div></Card>}
      </div>
      {edit !== undefined && <CheckForm check={edit ?? undefined} onClose={() => { setEdit(undefined); load(); }} />}
    </>
  );
}
