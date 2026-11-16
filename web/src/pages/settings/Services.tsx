import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, FlaskConical, Plug, CheckCircle2, XCircle, ExternalLink, Search } from 'lucide-react';
import { useStore } from '../../lib/store';
import { del, patch, post } from '../../lib/api';
import type { Instance, PluginMeta } from '../../lib/types';
import { Badge, Button, Input, Label, Modal, ServiceIcon, StatusDot, Toggle, cx } from '../../components/ui';
import { FieldInput } from '../../components/FieldInput';
import { confirmDialog, toast } from '../../components/feedback';
import { ago } from '../../lib/format';
import { PageHead, Card } from './Settings';

function InstanceForm({ plugin, instance, onClose }: { plugin: PluginMeta; instance?: Instance; onClose: () => void }) {
  const [name, setName] = useState(instance?.name ?? plugin.name);
  const [cfg, setCfg] = useState<Record<string, any>>(() => ({ ...Object.fromEntries(plugin.fields.filter((f) => f.default !== undefined).map((f) => [f.key, f.default])), ...(instance?.config ?? {}) }));
  const [interval, setIntervalSec] = useState(instance?.interval_sec ?? plugin.defaultInterval);
  const [mock, setMock] = useState(instance?.mock ?? false);
  const [enabled, setEnabled] = useState(instance?.enabled ?? true);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const runTest = async () => {
    setBusy(true); setTest(null);
    try {
      const r = await post('/api/instances/test', { plugin: plugin.id, config: cfg, id: instance?.id });
      setTest(r.ok ? { ok: true, text: `Radi (${r.ms} ms) — ${r.summary ?? r.status}` } : { ok: false, text: r.error });
    } catch (e: any) { setTest({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  const save = async () => {
    const missing = plugin.fields.filter((f) => f.required && !mock && (cfg[f.key] === undefined || cfg[f.key] === ''));
    if (missing.length) return toast(`Nedostaje: ${missing.map((m) => m.label).join(', ')}`, 'bad');
    try {
      if (instance) await patch(`/api/instances/${instance.id}`, { name, config: cfg, interval_sec: interval, mock, enabled });
      else await post('/api/instances', { plugin: plugin.id, name, config: cfg, interval_sec: interval, mock, enabled });
      toast('Spremljeno');
      onClose();
    } catch (e: any) { toast(e.message, 'bad'); }
  };

  return (
    <Modal open onClose={onClose} wide title={<span className="flex items-center gap-2"><ServiceIcon slug={plugin.icon} name={plugin.name} size={22} />{instance ? `Uredi: ${instance.name}` : `Novi servis: ${plugin.name}`}</span>}
      footer={<>
        <Button variant="ghost" icon={<Plug className="size-4" />} loading={busy} onClick={runTest} className="mr-auto">Testiraj vezu</Button>
        <Button variant="ghost" onClick={onClose}>Odustani</Button>
        <Button variant="primary" onClick={save}>Spremi</Button>
      </>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">{plugin.description} {plugin.docsUrl && <a className="inline-flex items-center gap-0.5 text-accent" href={plugin.docsUrl} target="_blank" rel="noreferrer">API docs<ExternalLink className="size-3" /></a>}</p>
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <Label><span className="text-xs font-medium text-muted">Naziv</span><Input value={name} onChange={(e) => setName(e.target.value)} /></Label>
          <Label><span className="text-xs font-medium text-muted">Interval (s)</span><Input type="number" min={5} value={interval} onChange={(e) => setIntervalSec(Number(e.target.value))} /></Label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {plugin.fields.map((f) => <div key={f.key} className={cx(f.type === 'text' && 'sm:col-span-2')}><FieldInput field={f} value={cfg[f.key]} onChange={(v) => setCfg((s) => ({ ...s, [f.key]: v }))} /></div>)}
        </div>
        <div className="flex flex-wrap gap-6 border-t border-line pt-4">
          <Toggle checked={enabled} onChange={setEnabled} label="Uključen" />
          <Toggle checked={mock} onChange={setMock} label={<span className="flex items-center gap-1"><FlaskConical className="size-3.5" />Mock način (lažni podaci, bez spajanja)</span>} />
        </div>
        {test && <div className={cx('flex items-start gap-2 rounded-xl px-3 py-2 text-sm', test.ok ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad')}>{test.ok ? <CheckCircle2 className="mt-0.5 size-4" /> : <XCircle className="mt-0.5 size-4" />}<span className="break-all">{test.text}</span></div>}
        <p className="text-xs text-muted">Tajne (API ključevi, lozinke) spremaju se šifrirano na serveru i nikad se ne šalju natrag u preglednik.</p>
      </div>
    </Modal>
  );
}

export function Services() {
  const plugins = useStore((s) => s.plugins);
  const instances = useStore((s) => s.instances);
  const states = useStore((s) => s.states);
  const [picker, setPicker] = useState(false);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ plugin: PluginMeta; instance?: Instance } | null>(null);
  const byCat = useMemo(() => plugins.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(q.toLowerCase())), [plugins, q]);

  const remove = async (i: Instance) => {
    if (!(await confirmDialog({ title: `Obriši ${i.name}?`, body: 'Briše se servis, njegovi widgeti i povijest stanja.', danger: true, confirmLabel: 'Obriši' }))) return;
    await del(`/api/instances/${i.id}`);
    toast('Obrisano');
  };

  return (
    <>
      <PageHead title="Servisi" desc="Svaki servis je plugin koji Hub periodički čita. Pad jednog servisa ne utječe na ostale — widget tada pokazuje grešku i zadnje poznato stanje."
        right={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setPicker(true)}>Dodaj servis</Button>} />
      <div className="space-y-2">
        {instances.map((i) => {
          const p = plugins.find((x) => x.id === i.plugin);
          const s = states[i.id];
          return (
            <Card key={i.id} className="!p-4">
              <div className="flex items-center gap-3">
                <ServiceIcon slug={p?.icon} name={i.name} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium">{i.name} <StatusDot status={s?.status} />{i.effectiveMock && <Badge><FlaskConical className="size-3" />mock</Badge>}{!i.enabled && <Badge>isključen</Badge>}</div>
                  <div className="truncate text-xs text-muted">{p?.name} · {i.config?.url ?? ''} · svakih {i.interval_sec}s · {s?.error ? <span className="text-bad">{s.error}</span> : `ažurirano ${ago(s?.updatedAt)}`}</div>
                </div>
                <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => p && setEditing({ plugin: p, instance: i })}>Uredi</Button>
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => remove(i)} />
              </div>
            </Card>
          );
        })}
        {!instances.length && <Card><div className="py-6 text-center text-sm text-muted">Još nema servisa. Dodaj prvi ili u <b>Backup i sustav</b> učitaj demo homelab.</div></Card>}
      </div>

      <Modal open={picker} onClose={() => setPicker(false)} title="Odaberi integraciju" wide>
        <div className="relative mb-3"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input autoFocus className="pl-9" placeholder="Pretraži…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="grid gap-2 sm:grid-cols-2">
          {byCat.map((p) => (
            <button key={p.id} onClick={() => { setPicker(false); setEditing({ plugin: p }); }} className="flex items-start gap-3 rounded-2xl border border-line bg-panel-2 p-3 text-left transition hover:border-accent/50">
              <ServiceIcon slug={p.icon} name={p.name} size={30} />
              <div className="min-w-0"><div className="text-sm font-semibold">{p.name}</div><div className="line-clamp-2 text-xs text-muted">{p.description}</div></div>
            </button>
          ))}
        </div>
      </Modal>
      {editing && <InstanceForm plugin={editing.plugin} instance={editing.instance} onClose={() => setEditing(null)} />}
    </>
  );
}
