import { useEffect, useState } from 'react';
import { Plus, Trash2, Send, Pencil, BellRing } from 'lucide-react';
import { useStore } from '../../lib/store';
import { del, get, patch, post } from '../../lib/api';
import { Badge, Button, Input, Label, Modal, Toggle, inputCls } from '../../components/ui';
import { FieldInput } from '../../components/FieldInput';
import { confirmDialog, toast } from '../../components/feedback';
import { PageHead, Card } from './Settings';

const RULE_TYPES: Record<string, string> = {
  instance_down: 'Service offline', check_down: 'Check failing', metric: 'Metric above/below threshold', cert_expiry: 'Certificate expiring', plugin_alert: 'Service warnings (health, backup, indexer, disk…)',
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
    if (!r.name) return toast('Name is required', 'bad');
    try { if (rule) await patch(`/api/alert-rules/${rule.id}`, r); else await post('/api/alert-rules', r); onClose(); } catch (e: any) { toast(e.message, 'bad'); }
  };
  return (
    <Modal open onClose={onClose} title={rule ? 'Edit rule' : 'New rule'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <Label><span className="text-xs font-medium text-muted">Name</span><Input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} /></Label>
        <Label><span className="text-xs font-medium text-muted">Type</span><select className={inputCls} value={r.type} onChange={(e) => setR({ ...r, type: e.target.value, target: {} })}>{Object.entries(RULE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Label>
        {['instance_down', 'metric', 'plugin_alert'].includes(r.type) && (
          <Label><span className="text-xs font-medium text-muted">Service</span>
            <select className={inputCls} value={t.instanceId ?? ''} onChange={(e) => setT('instanceId', e.target.value || undefined)}><option value="">{r.type === 'metric' ? '— select —' : 'All services'}</option>{instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
          </Label>
        )}
        {['check_down', 'cert_expiry'].includes(r.type) && (
          <Label><span className="text-xs font-medium text-muted">Check</span>
            <select className={inputCls} value={t.checkId ?? ''} onChange={(e) => setT('checkId', e.target.value || undefined)}><option value="">All checks</option>{Object.values(checks).filter((c) => r.type !== 'cert_expiry' || c.type === 'ssl').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Label>
        )}
        {r.type === 'cert_expiry' && <Label><span className="text-xs font-medium text-muted">Days before expiry</span><Input type="number" value={t.days ?? 14} onChange={(e) => setT('days', Number(e.target.value))} /></Label>}
        {r.type === 'plugin_alert' && (
          <Label><span className="text-xs font-medium text-muted">Minimum severity</span><select className={inputCls} value={t.minSeverity ?? 'warning'} onChange={(e) => setT('minSeverity', e.target.value)}><option value="info">info</option><option value="warning">warning</option><option value="critical">critical</option></select></Label>
        )}
        {r.type === 'metric' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Label><span className="text-xs font-medium text-muted">Metric</span><select className={inputCls} value={t.metric ?? ''} onChange={(e) => setT('metric', e.target.value)}><option value="">—</option>{metricKeys.map((m) => <option key={m}>{m}</option>)}</select></Label>
            <Label><span className="text-xs font-medium text-muted">Condition</span><select className={inputCls} value={t.op ?? '>'} onChange={(e) => setT('op', e.target.value)}><option value=">">greater than</option><option value="<">less than</option></select></Label>
            <Label><span className="text-xs font-medium text-muted">Threshold</span><Input type="number" value={t.value ?? ''} onChange={(e) => setT('value', Number(e.target.value))} /></Label>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Label><span className="text-xs font-medium text-muted">Severity</span><select className={inputCls} value={r.severity} onChange={(e) => setR({ ...r, severity: e.target.value })}><option value="critical">critical (takes over the kiosk)</option><option value="warning">warning</option><option value="info">info</option></select></Label>
          <Label help="How long the condition must hold"><span className="text-xs font-medium text-muted">Duration (s)</span><Input type="number" value={r.duration_sec} onChange={(e) => setR({ ...r, duration_sec: Number(e.target.value) })} /></Label>
        </div>
        <div className="space-y-1.5"><div className="text-xs font-medium text-muted">Channels (none selected = all)</div>
          <div className="flex flex-wrap gap-3">{channels.map((c) => <Toggle key={c.id} checked={r.channels.includes(c.id)} onChange={(v) => setR({ ...r, channels: v ? [...r.channels, c.id] : r.channels.filter((x: string) => x !== c.id) })} label={c.name} />)}</div>
        </div>
        <Toggle checked={r.enabled} onChange={(v) => setR({ ...r, enabled: v })} label="Enabled" />
      </div>
    </Modal>
  );
}

function ChannelForm({ channel, types, onClose }: { channel?: any; types: any[]; onClose: () => void }) {
  const defaultsFor = (typeId: string) => Object.fromEntries((types.find((t) => t.id === typeId)?.fields ?? []).filter((f: any) => f.default !== undefined).map((f: any) => [f.key, f.default]));
  const [c, setC] = useState<any>(channel ?? { type: types[0]?.id, name: '', config: defaultsFor(types[0]?.id), enabled: true });
  const type = types.find((t) => t.id === c.type);
  const save = async () => {
    try { if (channel) await patch(`/api/channels/${channel.id}`, c); else await post('/api/channels', c); onClose(); } catch (e: any) { if (e.message !== 'Cancelled') toast(e.message, 'bad'); }
  };
  return (
    <Modal open onClose={onClose} title={channel ? 'Edit channel' : 'New channel'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        {!channel && <Label><span className="text-xs font-medium text-muted">Type</span><select className={inputCls} value={c.type} onChange={(e) => setC({ ...c, type: e.target.value, config: defaultsFor(e.target.value) })}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Label>}
        <Label><span className="text-xs font-medium text-muted">Name</span><Input value={c.name} placeholder={type?.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Label>
        {type?.fields.map((f: any) => <FieldInput key={f.key} field={f} value={c.config[f.key] ?? f.default} onChange={(v) => setC({ ...c, config: { ...c.config, [f.key]: v } })} />)}
        <Toggle checked={c.enabled} onChange={(v) => setC({ ...c, enabled: v })} label="Enabled" />
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
      <PageHead title="Alerts & channels" desc="Rules open an incident when a condition holds long enough and notify the channels. When things recover, the incident is closed and a recovery notification is sent." />
      <Card className="mb-6">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Channels</h2><Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditCh(null)}>Add channel</Button></div>
        <div className="space-y-2">
          {channels.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-2xl bg-panel-2 px-3 py-2">
              <BellRing className="size-4 text-accent" />
              <div className="flex-1"><div className="text-sm font-medium">{c.name}</div><div className="text-xs text-muted">{types.find((t) => t.id === c.type)?.name}</div></div>
              {!c.enabled && <Badge>disabled</Badge>}
              <Button size="sm" variant="ghost" icon={<Send className="size-3.5" />} onClick={() => post(`/api/channels/${c.id}/test`).then(() => toast('Test notification sent')).catch((e) => toast(e.message, 'bad'))}>Test</Button>
              <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditCh(c)} />
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={async () => { if (await confirmDialog({ title: `Delete ${c.name}?`, danger: true })) { await del(`/api/channels/${c.id}`); load(); } }} />
            </div>
          ))}
          {!channels.length && <div className="text-sm text-muted">No channels yet. Recommended: ntfy (push to your phone) or Telegram.</div>}
        </div>
      </Card>
      <Card>
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Rules</h2><Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditRule(null)}>New rule</Button></div>
        <div className="space-y-2">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-2xl bg-panel-2 px-3 py-2">
              <Badge tone={r.severity === 'critical' ? 'bad' : r.severity === 'warning' ? 'warn' : 'info'}>{r.severity}</Badge>
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{r.name}</div><div className="truncate text-xs text-muted">{RULE_TYPES[r.type]} · after {r.duration_sec}s · {r.channels.length ? `${r.channels.length} channels` : 'all channels'}</div></div>
              <Toggle checked={r.enabled} onChange={(v) => patch(`/api/alert-rules/${r.id}`, { ...r, enabled: v }).then(load)} />
              <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditRule(r)} />
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={async () => { if (await confirmDialog({ title: `Delete rule?`, danger: true })) { await del(`/api/alert-rules/${r.id}`); load(); } }} />
            </div>
          ))}
        </div>
      </Card>
      {editRule !== undefined && <RuleForm rule={editRule ?? undefined} channels={channels} onClose={() => { setEditRule(undefined); load(); }} />}
      {editCh !== undefined && <ChannelForm channel={editCh ?? undefined} types={types} onClose={() => { setEditCh(undefined); load(); }} />}
    </>
  );
}
