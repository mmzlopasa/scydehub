import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { patch, put } from '../lib/api';
import type { Size, WidgetRow } from '../lib/types';
import { coreDef } from '../widgets/registry';
import { SIZE_GRID } from '../widgets/types';
import { GRID, type Profile } from '../lib/device';
import { Button, Input, Label, Modal, Segmented, Toggle, inputCls } from './ui';
import { FieldInput } from './FieldInput';
import { toast } from './feedback';

export function WidgetSettings({ widget, onClose }: { widget: WidgetRow | null; onClose: () => void }) {
  const boards = useStore((s) => s.boards);
  const instances = useStore((s) => s.instances);
  const [title, setTitle] = useState('');
  const [size, setSize] = useState<Size>('M');
  const [opts, setOpts] = useState<Record<string, any>>({});
  const [boardId, setBoardId] = useState('');
  const [instanceId, setInstanceId] = useState<string | null>(null);
  useEffect(() => {
    if (!widget) return;
    setTitle(widget.title ?? '');
    setSize(widget.size);
    const o = { ...widget.options };
    if (widget.kind === 'core.bookmarks') o.linksText = (o.links ?? []).map((l: any) => [l.name, l.url, l.icon].filter(Boolean).join(' | ')).join('\n');
    if (Array.isArray(o.metrics)) o.metrics = o.metrics.join(',');
    if (Array.isArray(o.types)) o.types = o.types.join(',');
    setOpts(o);
    setBoardId(widget.board_id);
    setInstanceId(widget.instance_id);
  }, [widget]);
  if (!widget) return null;
  const core = coreDef(widget.kind);
  const inst = instances.find((i) => i.id === widget.instance_id);
  const sameTypeInstances = instances.filter((i) => (core?.instancePlugins === 'any' ? true : i.plugin === inst?.plugin));

  const save = async () => {
    const o: Record<string, any> = { ...opts };
    if (widget.kind === 'core.bookmarks') {
      o.links = String(o.linksText ?? '').split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p[0] && p[1]).map(([name, url, icon]) => ({ name, url, icon: icon || undefined }));
      delete o.linksText;
    }
    if (typeof o.metrics === 'string') o.metrics = o.metrics.split(',').map((s: string) => s.trim()).filter(Boolean);
    if (typeof o.types === 'string') o.types = o.types.split(',').map((s: string) => s.trim()).filter(Boolean);
    try {
      await patch(`/api/widgets/${widget.id}`, { title: title || null, size, options: o, board_id: boardId, instance_id: instanceId });
      if (size !== widget.size) {
        // resize this widget on every saved device layout
        const b = boards.find((x) => x.id === widget.board_id);
        for (const [profile, l] of Object.entries(b?.layouts ?? {})) {
          const cols = GRID[profile as Profile]?.cols ?? 12;
          const next = l.map((it) => (it.i === widget.id ? { ...it, w: profile === 'mobile' ? cols : Math.max(2, Math.round((SIZE_GRID[size].w / 12) * cols)), h: SIZE_GRID[size].h } : it));
          await put(`/api/boards/${widget.board_id}/layout/${profile}`, { layout: next });
        }
      }
      toast('Widget spremljen');
      onClose();
    } catch (e: any) { toast(e.message, 'bad'); }
  };

  return (
    <Modal open onClose={onClose} title="Postavke widgeta" footer={<><Button variant="ghost" onClick={onClose}>Odustani</Button><Button variant="primary" onClick={save}>Spremi</Button></>}>
      <div className="space-y-4">
        <Label><span className="text-xs font-medium text-muted">Naslov</span><Input value={title} placeholder="Zadani naslov" onChange={(e) => setTitle(e.target.value)} /></Label>
        <div className="space-y-1.5"><div className="text-xs font-medium text-muted">Veličina (S, M, L, XL — više detalja na većim)</div>
          <Segmented value={size} onChange={setSize} options={(['S', 'M', 'L', 'XL'] as Size[]).map((s) => ({ value: s, label: s }))} />
        </div>
        {widget.instance_id && sameTypeInstances.length > 1 && (
          <Label><span className="text-xs font-medium text-muted">Servis</span>
            <select className={inputCls} value={instanceId ?? ''} onChange={(e) => setInstanceId(e.target.value)}>{sameTypeInstances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
          </Label>
        )}
        {(core?.options ?? []).map((f) => <FieldInput key={f.key} field={f} value={opts[f.key]} onChange={(v) => setOpts((s) => ({ ...s, [f.key]: v }))} />)}
        {widget.kind === 'core.chart' && <div className="text-xs text-muted">Dostupne metrike vidiš u detaljnom panelu servisa (npr. cpu, mem, queue, dl, wan_rx, _latency).</div>}
        <Toggle checked={!!opts.hideHeader} onChange={(v) => setOpts((s) => ({ ...s, hideHeader: v }))} label="Sakrij zaglavlje" />
        <Label><span className="text-xs font-medium text-muted">Stranica</span>
          <select className={inputCls} value={boardId} onChange={(e) => setBoardId(e.target.value)}>{boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </Label>
      </div>
    </Modal>
  );
}
