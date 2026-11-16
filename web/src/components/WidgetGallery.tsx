import { useMemo, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { post } from '../lib/api';
import type { Size } from '../lib/types';
import { CORE_WIDGETS, SERVICE_WIDGETS } from '../widgets/registry';
import { Badge, Input, Modal, ServiceIcon, cx } from './ui';
import { CoreIcon } from './icons';
import { toast } from './feedback';

interface Item { key: string; kind: string; name: string; description: string; category: string; icon?: string; coreIcon?: string; instanceId?: string; instanceName?: string; size: Size; sizes: Size[] }
const CATS: Record<string, string> = { all: 'Sve', core: 'Općenito', infrastructure: 'Infrastruktura', media: 'Media', downloads: 'Preuzimanja', network: 'Mreža', hosting: 'Hosting', security: 'Sigurnost', generic: 'Generičko' };

export function WidgetGallery({ open, onClose, boardId }: { open: boolean; onClose: () => void; boardId: string }) {
  const plugins = useStore((s) => s.plugins);
  const instances = useStore((s) => s.instances);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const items = useMemo<Item[]>(() => {
    const out: Item[] = CORE_WIDGETS.filter((c) => !c.instancePlugins).map((c) => ({ key: c.kind, kind: c.kind, name: c.name, description: c.description, category: 'core', coreIcon: c.icon, size: c.defaultSize, sizes: ['S', 'M', 'L', 'XL'] }));
    for (const inst of instances) {
      const p = plugins.find((x) => x.id === inst.plugin);
      if (!p) continue;
      for (const w of p.widgets) {
        const kind = `${p.id}.${w.id}`;
        if (!SERVICE_WIDGETS[kind]) continue;
        out.push({ key: `${kind}:${inst.id}`, kind, name: w.name, description: w.description, category: p.category, icon: p.icon, instanceId: inst.id, instanceName: inst.name, size: w.defaultSize, sizes: w.sizes });
      }
      out.push({ key: `core.chart:${inst.id}`, kind: 'core.chart', name: `${inst.name}: graf`, description: 'Povijest metrika ovog servisa', category: p.category, icon: p.icon, instanceId: inst.id, instanceName: inst.name, size: 'M', sizes: ['S', 'M', 'L', 'XL'] });
    }
    return out;
  }, [plugins, instances]);
  const filtered = items.filter((i) => (cat === 'all' || i.category === cat) && `${i.name} ${i.description} ${i.instanceName ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const cats = ['all', ...new Set(items.map((i) => i.category))];

  const add = async (it: Item, size: Size) => {
    try {
      await post(`/api/boards/${boardId}/widgets`, { kind: it.kind, instance_id: it.instanceId, size, options: it.kind === 'core.chart' ? { metrics: ['_latency'], range: 6 } : {} });
      toast(`Dodano: ${it.name}`);
      onClose();
    } catch (e: any) { toast(e.message, 'bad'); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Galerija widgeta" wide>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input autoFocus placeholder="Pretraži widgete i servise…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {cats.map((c) => (
          <button key={c} onClick={() => setCat(c)} className={cx('rounded-full px-3 py-1 text-xs font-medium transition', cat === c ? 'bg-accent text-white' : 'bg-panel-2 text-muted hover:text-fg')}>{CATS[c] ?? c}</button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {filtered.map((it) => (
          <div key={it.key} className="group rounded-2xl border border-line bg-panel-2 p-3 transition hover:border-accent/50">
            <div className="flex items-start gap-3">
              {it.icon ? <ServiceIcon slug={it.icon} name={it.name} size={28} /> : <div className="grid size-7 place-items-center rounded-lg bg-accent-soft text-accent"><CoreIcon name={it.coreIcon ?? 'grid'} className="size-4" /></div>}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{it.name}</div>
                {it.instanceName && <div className="truncate text-[11px] text-accent">{it.instanceName}</div>}
                <div className="line-clamp-2 text-xs text-muted">{it.description}</div>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1">
              {(['S', 'M', 'L', 'XL'] as Size[]).filter((s) => it.sizes.includes(s)).map((s) => (
                <button key={s} onClick={() => add(it, s)} className={cx('rounded-lg px-2.5 py-1 text-xs font-medium transition', s === it.size ? 'bg-accent text-white' : 'bg-[var(--bg)] text-muted hover:text-fg')}>{s}</button>
              ))}
              <Plus className="ml-auto size-4 text-muted opacity-0 transition group-hover:opacity-100" />
            </div>
          </div>
        ))}
      </div>
      {instances.length === 0 && (
        <div className="mt-4 rounded-2xl border border-dashed border-line p-4 text-center text-sm text-muted">
          Još nema servisa. <Link className="text-accent" to="/settings/services" onClick={onClose}>Dodaj servis</Link> ili učitaj demo podatke.
        </div>
      )}
      {filtered.length === 0 && <div className="py-8 text-center text-sm text-muted">Ništa ne odgovara pretrazi. <Badge>{q}</Badge></div>}
    </Modal>
  );
}
