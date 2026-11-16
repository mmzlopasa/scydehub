import { useEffect, useState } from 'react';
import { Plus, Trash2, Send, Pencil, BellRing } from 'lucide-react';
import { useStore } from '../../lib/store';
import { del, get, patch, post } from '../../lib/api';
import { Badge, Button, Input, Label, Modal, Toggle, inputCls } from '../../components/ui';
import { FieldInput } from '../../components/FieldInput';
import { confirmDialog, toast } from '../../components/feedback';
import { PageHead, Card } from './Settings';

const RULE_TYPES: Record<string, string> = {
  instance_down: 'Servis offline', check_down: 'Provjera ne prolazi', metric: 'Metrika iznad/ispod praga', cert_expiry: 'Certifikat ističe', plugin_alert: 'Upozorenja servisa (health, backup, indexer, disk…)',
};

function RuleForm({ rule, channels, onClose }: { rule?: any; channels: any[]; onClose: () => void }) {
  const instances = useStore((s) => s.instances);
  const checks = useStore((s) => s.checks);
  const states = useStore((s) => s.states);
  const [r, setR] = useState<any>(rule ?? { name: '', type: 'instance_down', target: {}, severity: 'critical', duration_sec: 120, channels: [], enabled: true });
  const t = r.target ?? {};
  const setT = (k: string, v: any) => setR((s: any) => ({ ...s, target: { ...s.target, [k]: v } }));
  const metricKeys = Object.keys(states[t.instanceId]?.metrics ?? {});
  const save = async () => {
    if (!r.name) return toast('Naziv je obavezan', 'bad');
    try { if (rule) await patch(`/api/alert-rules/${rule.id}`, r); else await post('/api/alert-rules', r); onClose(); } catch (e: any) { toast(e.message, 'bad'); }
  };
  return (
    <Modal open onClose={onClose} title={rule ? 'Uredi pravilo' : 'Novo pravilo'} footer={<><Button variant="ghost" onClick={onClose}>Odustani</Button><Button variant="primary" onClick={save}>Spremi</Button></>}>
      <div className="space-y-3">
        <Label><span className="text-xs font-medium text-muted">Naziv</span><Input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} /></Label>
        <Label><span className="text-xs font-medium text-muted">Tip</span><select className={inputCls} value={r.type} onChange={(e) => setR({ ...r, type: e.target.value, target: {} })}>{Object.entries(RULE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Label>
        {['instance_down', 'metric', 'plugin_alert'].includes(r.type) && (
          <Label><span className="text-xs font-medium text-muted">Servis</span>
            <select className={inputCls} value={t.instanceId ?? ''} onChange={(e) => setT('instanceId', e.target.value || undefined)}><option value="">{r.type === 'metric' ? '— odaberi —' : 'Svi servisi'}</option>{instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
          </Label>
        )}
        {['check_down', 'cert_expiry'].includes(r.type) && (
          <Label><span className="text-xs font-medium text-muted">Provjera</span>
            <select className={inputCls} value={t.checkId ?? ''} onChange={(e) => setT('checkId', e.target.value || undefined)}><option value="">Sve provjere</option>{Object.values(checks).filter((c) => r.type !== 'cert_expiry' || c.type === 'ssl').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Label>
        )}
        {r.type === 'cert_expiry' && <Label><span className="text-xs font-medium text-muted">Dana prije isteka</span><Input type="number" value={t.days ?? 14} onChange={(e) => setT('days', Number(e.target.value))} /></Label>}
        {r.type === 'plugin_alert' && (
          <Label><span className="text-xs font-medium text-muted">Minimalna ozbiljnost</span><select className={inputCls} value={t.minSeverity ?? 'warning'} onChange={(e) => setT('minSeverity', e.target.value)}><option value="info">info</option><option value="warning">warning</option><option value="critical">critical</option></select></Label>
        )}
        {r.type === 'metric' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Label><span className="text-xs font-medium text-muted">Metrika</span><select className={inputCls} value={t.metric ?? ''} onChange={(e) => setT('metric', e.target.value)}><option value="">—</option>{metricKeys.map((m) => <option key={m}>{m}</option>)}</select></Label>
            <Label><span className="text-xs font-medium text-muted">Uvjet</span><select className={inputCls} value={t.op ?? '>'} onChange={(e) => setT('op', e.target.value)}><option value=">">veće od</option><option value="<">manje od</option></select></Label>
            <Label><span className="text-xs font-medium text-muted">Prag</span><Input type="number" value={t.value ?? ''} onChange={(e) => setT('value', Number(e.target.value))} /></Label>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Label><span className="text-xs font-medium text-muted">Ozbiljnost</span><select className={inputCls} value={r.severity} onChange={(e) => setR({ ...r, severity: e.target.value })}><option value="critical">critical (preuzima kiosk)</option><option value="warning">warning</option><option value="info">info</option></select></Label>
          <Label help="Koliko dugo uvjet mora trajati"><span className="text-xs font-medium text-muted">Trajanje (s)</span><Input type="number" value={r.duration_sec} onChange={(e) => setR({ ...r, duration_sec: Number(e.target.value) })} /></Label>
        </div>
        <div className="space-y-1.5"><div className="text-xs font-medium text-muted">Kanali (ništa odabrano = svi)</div>
          <div className="flex flex-wrap gap-3">{channels.map((c) => <Toggle key={c.id} checked={r.channels.includes(c.id)} onChange={(v) => setR({ ...r, channels: v ? [...r.channels, c.id] : r.channels.filter((x: string) => x !== c.id) })} label={c.name} />)}</div>
        </div>
        <Toggle checked={r.enabled} onChange={(v) => setR({ ...r, enabled: v })} label="Uključeno" />
      </div>
    </Modal>
  );
}

function ChannelForm({ channel, types, onClose }: { channel?: any; types: any[]; onClose: () => void }) {
  const [c, setC] = useState<any>(channel ?? { type: types[0]?.id, name: '', config: {}, enabled: true });
  const type = types.find((t) => t.id === c.type);
  const save = async () => {
    try { if (channel) await patch(`/api/channels/${channel.id}`, c); else await post('/api/channels', c); onClose(); } catch (e: any) { toast(e.message, 'bad'); }
  };
  return (
    <Modal open onClose={onClose} title={channel ? 'Uredi kanal' : 'Novi kanal'} footer={<><Button variant="ghost" onClick={onClose}>Odustani</Button><Button variant="primary" onClick={save}>Spremi</Button></>}>
      <div className="space-y-3">
        {!channel && <Label><span className="text-xs font-medium text-muted">Tip</span><select className={inputCls} value={c.type} onChange={(e) => setC({ ...c, type: e.target.value, config: {} })}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Label>}
        <Label><span className="text-xs font-medium text-muted">Naziv</span><Input value={c.name} placeholder={type?.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Label>
        {type?.fields.map((f: any) => <FieldInput key={f.key} field={f} value={c.config[f.key] ?? f.default} onChange={(v) => setC({ ...c, config: { ...c.config, [f.key]: v } })} />)}
        <Toggle checked={c.enabled} onChange={(v) => setC({ ...c, enabled: v })} label="Uključen" />
      </div>
    </Modal>
  );
}

export function Alerts() {
  const [rules, setRules] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [editRule, setEditRule] = useState<any | null | undefined>(undefined);
  const [editCh, setEditCh] = useState<any | null | undefined>(undefined);
  const load = () => Promise.all([get('/api/alert-rules').then(setRules), get('/api/channels').then(setChannels), get('/api/channel-types').then(setTypes)]);
  useEffect(() => { load(); }, []);
  return (
    <>
      <PageHead title="Alerti i kanali" desc="Pravila otvaraju incident kad uvjet traje dovoljno dugo i šalju obavijest na kanale. Kad se stanje vrati, incident se zatvara i stiže obavijest o oporavku." />
      <Card className="mb-6">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Kanali</h2><Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditCh(null)}>Dodaj kanal</Button></div>
        <div className="space-y-2">
          {channels.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-2xl bg-panel-2 px-3 py-2">
              <BellRing className="size-4 text-accent" />
              <div className="flex-1"><div className="text-sm font-medium">{c.name}</div><div className="text-xs text-muted">{types.find((t) => t.id === c.type)?.name}</div></div>
              {!c.enabled && <Badge>isključen</Badge>}
              <Button size="sm" variant="ghost" icon={<Send className="size-3.5" />} onClick={() => post(`/api/channels/${c.id}/test`).then(() => toast('Testna obavijest poslana')).catch((e) => toast(e.message, 'bad'))}>Test</Button>
              <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditCh(c)} />
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={async () => { if (await confirmDialog({ title: `Obriši ${c.name}?`, danger: true })) { await del(`/api/channels/${c.id}`); load(); } }} />
            </div>
          ))}
          {!channels.length && <div className="text-sm text-muted">Nema kanala. Preporuka: ntfy (push na mobitel) ili Telegram.</div>}
        </div>
      </Card>
      <Card>
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Pravila</h2><Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditRule(null)}>Novo pravilo</Button></div>
        <div className="space-y-2">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-2xl bg-panel-2 px-3 py-2">
              <Badge tone={r.severity === 'critical' ? 'bad' : r.severity === 'warning' ? 'warn' : 'info'}>{r.severity}</Badge>
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{r.name}</div><div className="truncate text-xs text-muted">{RULE_TYPES[r.type]} · nakon {r.duration_sec}s · {r.channels.length ? `${r.channels.length} kanala` : 'svi kanali'}</div></div>
              <Toggle checked={r.enabled} onChange={(v) => patch(`/api/alert-rules/${r.id}`, { ...r, enabled: v }).then(load)} />
              <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditRule(r)} />
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={async () => { if (await confirmDialog({ title: `Obriši pravilo?`, danger: true })) { await del(`/api/alert-rules/${r.id}`); load(); } }} />
            </div>
          ))}
        </div>
      </Card>
      {editRule !== undefined && <RuleForm rule={editRule ?? undefined} channels={channels} onClose={() => { setEditRule(undefined); load(); }} />}
      {editCh !== undefined && <ChannelForm channel={editCh ?? undefined} types={types} onClose={() => { setEditCh(undefined); load(); }} />}
    </>
  );
}
