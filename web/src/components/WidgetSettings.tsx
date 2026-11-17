import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { patch, put } from '../lib/api';
import type { Size, WidgetRow } from '../lib/types';
import { coreDef } from '../widgets/registry';
import { SIZE_GRID } from '../widgets/types';
import { GRID, type Profile } from '../lib/device';
import { Button, ColorInput, ImagePicker, Input, Label, Modal, Segmented, Toggle, inputCls } from './ui';
import { FieldInput } from './FieldInput';
import { toast } from './feedback';

export function WidgetSettings({ widget, onClose }: { widget: WidgetRow | null; onClose: () => void }) {
  const boards = useStore((s) => s.boards);
  const instances = useStore((s) => s.instances);
  const [title, setTitle] = useState('');
  const [size, setSize] = useState<Size>('M');
  const [sizePicked, setSizePicked] = useState(false);
  const [opts, setOpts] = useState<Record<string, any>>({});
  const [boardId, setBoardId] = useState('');
  const [instanceId, setInstanceId] = useState<string | null>(null);
  useEffect(() => {
    if (!widget) return;
    setTitle(widget.title ?? '');
    setSize(widget.size);
    setSizePicked(false);
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
      // picking a size (even the stored one, after a manual resize) applies it on every saved device layout;
      // a widget that moves to another board is placed afresh there
      if (sizePicked && boardId === widget.board_id) {
        const b = boards.find((x) => x.id === widget.board_id);
        for (const [profile, l] of Object.entries(b?.layouts ?? {})) {
          if (!l.some((it) => it.i === widget.id)) continue;
          const cols = GRID[profile as Profile]?.cols ?? 24;
          const nw = profile === 'mobile' ? cols : Math.min(cols, Math.max(2, Math.round((SIZE_GRID[size].w / 24) * cols)));
          const next = l.map((it) => (it.i === widget.id ? { ...it, x: Math.max(0, Math.min(it.x, cols - nw)), w: nw, h: SIZE_GRID[size].h } : it));
          await put(`/api/boards/${widget.board_id}/layout/${profile}`, { layout: next });
        }
      }
      toast('Widget saved');
      onClose();
    } catch (e: any) { toast(e.message, 'bad'); }
  };

  return (
    <Modal open wide onClose={onClose} title="Widget settings" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <Label><span className="text-xs font-medium text-muted">Title</span><Input value={title} placeholder="Default title" onChange={(e) => setTitle(e.target.value)} /></Label>
        <div className="space-y-1.5"><div className="text-xs font-medium text-muted">Size (S, M, L, XL — larger sizes show more detail)</div>
          <Segmented value={size} onChange={(v) => { setSize(v); setSizePicked(true); }} options={(['S', 'M', 'L', 'XL'] as Size[]).map((s) => ({ value: s, label: s }))} />
        </div>
        {widget.instance_id && sameTypeInstances.length > 1 && (
          <Label><span className="text-xs font-medium text-muted">Service</span>
            <select className={inputCls} value={instanceId ?? ''} onChange={(e) => setInstanceId(e.target.value)}>{sameTypeInstances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
          </Label>
        )}
        {(core?.options ?? []).map((f) => <FieldInput key={f.key} field={f} value={opts[f.key]} onChange={(v) => setOpts((s) => ({ ...s, [f.key]: v }))} />)}
        {widget.kind === 'core.chart' && <div className="text-xs text-muted">Available metrics are listed in the service detail panel (e.g. cpu, mem, queue, dl, wan_rx, _latency).</div>}
        <div className="space-y-3 rounded-2xl border border-line p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Look of this widget</div>
          <div className="space-y-1.5"><div className="text-xs font-medium text-muted">Icon (dashboard-icons name, image URL or upload)</div>
            <div className="flex flex-wrap items-center gap-2">
              <Input className="max-w-[220px]" placeholder="e.g. proxmox, plex, home-assistant" value={typeof opts.icon === 'string' && !opts.icon.startsWith('data:') ? opts.icon : ''} onChange={(e) => setOpts((s) => ({ ...s, icon: e.target.value.trim() }))} />
              <ImagePicker value={typeof opts.icon === 'string' && /^(data:|https:)/.test(opts.icon) ? opts.icon : ''} onChange={(v) => setOpts((s) => ({ ...s, icon: v }))} maxKb={40} hint="Up to 40 KB" />
            </div>
          </div>
          <div className="space-y-1.5"><div className="text-xs font-medium text-muted">Accent colour (empty = theme colour)</div>
            <div className="flex items-center gap-2">
              <ColorInput value={opts.accent ?? ''} onChange={(v) => setOpts((s) => ({ ...s, accent: v }))} presets={['#FFD76A', '#8B7CFF', '#34D399', '#38BDF8', '#FF7A8A', '#F472B6']} />
              {opts.accent && <Button size="sm" variant="ghost" onClick={() => setOpts((s) => ({ ...s, accent: '' }))}>Clear</Button>}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <Toggle checked={opts.hideHeader ?? ['core.clock', 'core.weather'].includes(widget.kind)} onChange={(v) => setOpts((s) => ({ ...s, hideHeader: v }))} label="Hide header" />
            <Toggle checked={!!opts.transparent} onChange={(v) => setOpts((s) => ({ ...s, transparent: v }))} label="No card (transparent)" />
            <Toggle checked={!!opts.noPadding} onChange={(v) => setOpts((s) => ({ ...s, noPadding: v }))} label="Edge to edge (no padding)" />
          </div>
        </div>
        <Label><span className="text-xs font-medium text-muted">Board</span>
          <select className={inputCls} value={boardId} onChange={(e) => setBoardId(e.target.value)}>{boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </Label>
      </div>
    </Modal>
  );
}
