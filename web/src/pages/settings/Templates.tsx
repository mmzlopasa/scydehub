import { useEffect, useRef, useState } from 'react';
import { Download, LayoutTemplate, Upload, Wand2 } from 'lucide-react';
import { api, get, post } from '../../lib/api';
import { Badge, Button, Modal, Toggle } from '../../components/ui';
import { toast } from '../../components/feedback';
import { Card } from './Settings';

interface Info { id: string; name: string; description?: string; boards: number; widgets: number }
interface Result { boards: number; widgets: number; skipped: number; created: { name: string }[]; missing: string[] }

function save(name: string, data: unknown) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Ready-made boards: import a built-in template or a file, export your own boards to share or move them. */
export function Templates() {
  const [list, setList] = useState<Info[]>([]);
  const [pending, setPending] = useState<{ label: string; body: Record<string, unknown>; info?: Info } | null>(null);
  const [createMissing, setCreateMissing] = useState(true);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { get<Info[]>('/api/templates').then(setList).catch(() => {}); }, []);

  const pick = async (f: File) => {
    try {
      const template = JSON.parse(await f.text());
      if (template?.app !== 'scydehub-template') throw new Error('This file is not a SCYDE Hub board template');
      setPending({ label: template.name ?? f.name, body: { template } });
    } catch (e: any) { toast(e.message, 'bad'); }
  };
  const run = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await post<Result>('/api/templates/import', { ...pending.body, createMissing, replace });
      setPending(null);
      setResult(r);
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  return (
    <Card className="mb-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent"><LayoutTemplate className="size-4" /></div>
        <div><h2 className="font-semibold">Templates</h2><p className="text-sm text-muted">Ready-made boards with widgets already arranged. A template contains no services and no keys — its widgets attach to your own services.</p></div>
      </div>
      {list.map((t) => (
        <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 font-medium">{t.name}<Badge tone="accent">{t.boards} boards</Badge><Badge>{t.widgets} widgets</Badge></div>
            <div className="text-xs text-muted">{t.description}</div>
          </div>
          <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => get(`/api/templates/${t.id}`).then((d) => save(`${t.id}.json`, d)).catch((e) => toast(e.message, 'bad'))}>File</Button>
          <Button size="sm" variant="primary" icon={<Wand2 className="size-3.5" />} onClick={() => setPending({ label: t.name, body: { id: t.id }, info: t })}>Import</Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => file.current?.click()}>Import from file</Button>
        <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => api('/api/templates/export').then((d) => save(`scydehub-boards-${new Date().toISOString().slice(0, 10)}.json`, d)).catch((e) => toast(e.message, 'bad'))}>Export my boards as a template</Button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }} />
      </div>

      <Modal open={!!pending} onClose={() => setPending(null)} title={`Import “${pending?.label ?? ''}”`}
        footer={<><Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button><Button variant={replace ? 'danger' : 'primary'} loading={busy} onClick={run}>{replace ? 'Replace my boards' : 'Import'}</Button></>}>
        <div className="space-y-4 text-sm">
          {pending?.info && <p className="text-muted">Adds {pending.info.boards} boards with {pending.info.widgets} widgets.</p>}
          <div className="space-y-1">
            <Toggle checked={createMissing} onChange={setCreateMissing} label="Create services I don't have yet as placeholders" />
            <p className="pl-14 text-xs text-muted">Placeholders run in <b>mock mode</b> with sample data and contact nothing. Open one in Settings → Services, enter its real URL and key, and its widgets go live. Off: widgets of services you don't have are left out.</p>
          </div>
          <div className="space-y-1">
            <Toggle checked={replace} onChange={setReplace} label="Replace my existing boards" />
            <p className="pl-14 text-xs text-muted">Off (default): the new boards are added after yours. On: all current boards and their widgets are deleted first. Services are never deleted.</p>
          </div>
        </div>
      </Modal>

      <Modal open={!!result} onClose={() => setResult(null)} title="Template imported" footer={<Button variant="primary" onClick={() => { setResult(null); location.assign('/'); }}>Open the dashboard</Button>}>
        {result && (
          <div className="space-y-3 text-sm">
            <p>{result.boards} boards and {result.widgets} widgets were added.</p>
            {result.created.length > 0 && <p className="text-muted">Placeholder services created in mock mode: <b className="text-fg">{result.created.map((c) => c.name).join(', ')}</b>. Edit them in Settings → Services to connect the real ones.</p>}
            {result.skipped > 0 && <p className="text-muted">{result.skipped} widgets were left out because you have no service of this type: {result.missing.join(', ')}.</p>}
          </div>
        )}
      </Modal>
    </Card>
  );
}
