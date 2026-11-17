import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout';
import { Plus, LayoutGrid, Magnet, Layers, RotateCcw, Move } from 'lucide-react';
import { useStore } from '../lib/store';
import { del, post, put } from '../lib/api';
import { GRID, type Profile } from '../lib/device';
import { findSpot, resolveLayout } from '../lib/layout';
import type { Board as BoardT, WidgetRow } from '../lib/types';
import { WidgetFrame } from '../components/WidgetFrame';
import { DetailPanel } from '../components/DetailPanel';
import { WidgetGallery } from '../components/WidgetGallery';
import { WidgetSettings } from '../components/WidgetSettings';
import { Button, Empty, cx } from '../components/ui';
import { confirmDialog, toast } from '../components/feedback';

const RGL = WidthProvider(GridLayout);
const HANDLES: ('s' | 'w' | 'e' | 'n' | 'sw' | 'nw' | 'se' | 'ne')[] = ['se', 'sw', 'ne', 'nw', 'e', 'w', 's', 'n'];

export function BoardView({ board, profile, editing, kiosk }: { board: BoardT; profile: Profile; editing: boolean; kiosk?: boolean }) {
  const g = GRID[profile];
  const tv = profile === 'tv';
  const [openInstance, setOpenInstance] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [editWidget, setEditWidget] = useState<WidgetRow | null>(null);
  const [dragging, setDragging] = useState(false);
  const isAdmin = useStore((s) => s.me?.auth?.kind === 'admin');
  const lay = useStore((s) => s.settings?.layout);
  const gap = Math.min(40, Math.max(0, lay?.gap ?? 14));
  // phones always stack; everywhere else the user decides
  const free = (lay?.mode ?? 'free') === 'free' && profile !== 'mobile';
  const overlap = free && !!lay?.allowOverlap;
  const layout = useMemo(() => {
    // no layout for this device yet: start from another device's, scaled from that device's column count
    const from = (['desktop', 'tv', 'tablet'] as Profile[]).find((p) => Array.isArray(board.layouts[p]));
    return resolveLayout(board.widgets, board.layouts[profile], profile, from ? board.layouts[from] : undefined, from ? GRID[from].cols : 24);
  }, [board, profile]);
  const [local, setLocal] = useState(layout);
  useEffect(() => setLocal(layout), [layout]);
  const saveTimer = useRef<number>();
  const pending = useRef<(() => void) | null>(null);
  const localRef = useRef(local);
  localRef.current = local;
  // leaving the board right after a drop must not lose the move: send what is still waiting
  useEffect(() => () => { clearTimeout(saveTimer.current); pending.current?.(); }, []);

  const persist = useCallback((l: Layout[], force = false) => {
    const clean = l.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
    // a plain click also ends a "drag": nothing moved, nothing to save
    const cur = localRef.current;
    if (!force && clean.length === cur.length && clean.every((c) => { const o = cur.find((x) => x.i === c.i); return o && o.x === c.x && o.y === c.y && o.w === c.w && o.h === c.h; })) return;
    setLocal(clean);
    clearTimeout(saveTimer.current);
    const send = () => { pending.current = null; put(`/api/boards/${board.id}/layout/${profile}`, { layout: clean }).catch((e) => toast(e.message, 'bad')); };
    pending.current = send;
    saveTimer.current = window.setTimeout(send, 350);
  }, [board.id, profile]);
  const coarse = useMemo(() => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches, []);

  // first time a device is arranged: store the auto-placed layout so positions become stable
  useEffect(() => {
    if (editing && isAdmin && !board.layouts[profile] && layout.length) persist(layout as Layout[], true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const remove = async (w: WidgetRow) => {
    if (!(await confirmDialog({ title: 'Remove widget?', body: 'The widget disappears from this board on every device.', danger: true, confirmLabel: 'Remove' }))) return;
    await del(`/api/widgets/${w.id}`).catch((e) => toast(e.message, 'bad'));
  };
  const duplicate = async (w: WidgetRow) => {
    try {
      const r = await post<{ id: string }>(`/api/boards/${board.id}/widgets`, { kind: w.kind, instance_id: w.instance_id, title: w.title, size: w.size, options: w.options });
      const src = local.find((l) => l.i === w.id);
      if (src) {
        const pos = findSpot(local, src.w, src.h, g.cols);
        await put(`/api/boards/${board.id}/layout/${profile}`, { layout: [...local, { i: r.id, ...pos, w: src.w, h: src.h }] });
      }
      toast('Widget duplicated');
    } catch (e: any) { toast(e.message, 'bad'); }
  };
  const resetLayout = async () => {
    if (!(await confirmDialog({ title: 'Reset this layout?', body: `Widgets on "${board.name}" are re-arranged automatically for this device (${profile}). Other devices keep their layout.`, confirmLabel: 'Reset' }))) return;
    await del(`/api/boards/${board.id}/layout/${profile}`).catch((e) => toast(e.message, 'bad'));
  };
  const setLayoutOpt = (patch: Record<string, unknown>) => put('/api/settings', { layout: { ...lay, ...patch } }).catch((e) => toast(e.message, 'bad'));

  const byId = useMemo(() => new Map(board.widgets.map((w) => [w.id, w])), [board.widgets]);
  const rows = Math.max(0, ...local.map((l) => l.y + l.h));

  return (
    <div className={cx(editing && 'editing', 'pb-10')}>
      {editing && isAdmin && (
        <div className="pop animate-pop sticky top-[4.6rem] z-20 mx-auto mb-4 flex w-fit max-w-full flex-wrap items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-xs">
          <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setGalleryOpen(true)}>Add widget</Button>
          <span className="mx-1 h-5 w-px bg-line-2" />
          <button title="Free placement: widgets stay exactly where you drop them" onClick={() => setLayoutOpt({ mode: 'free' })}
            className={cx('inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-medium transition', free ? 'bg-fg text-bg' : 'text-muted hover:text-fg')}><Move className="size-3.5" />Free</button>
          <button title="Auto-pack: widgets float up to close gaps" onClick={() => setLayoutOpt({ mode: 'pack' })}
            className={cx('inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-medium transition', !free ? 'bg-fg text-bg' : 'text-muted hover:text-fg')}><Magnet className="size-3.5" />Auto-pack</button>
          <button title="Let widgets overlap each other (layers)" disabled={!free} onClick={() => setLayoutOpt({ allowOverlap: !lay?.allowOverlap })}
            className={cx('inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-medium transition disabled:opacity-40', overlap ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg')}><Layers className="size-3.5" />Overlap</button>
          <span className="mx-1 h-5 w-px bg-line-2" />
          <button title="Re-arrange automatically on this device" onClick={resetLayout} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-medium text-muted transition hover:text-fg"><RotateCcw className="size-3.5" />Reset</button>
          <span className="px-2 text-muted max-sm:hidden">{coarse ? 'Drag by the grip' : 'Drag anywhere'} · resize from any edge · layout saved for: <b className="text-fg">{profile}</b></span>
        </div>
      )}
      {board.widgets.length === 0 ? (
        <div className="glass mx-auto mt-10 max-w-md p-10">
          <Empty icon={<LayoutGrid className="size-10" />} title="Empty board">
            {isAdmin ? <Button className="mt-3" variant="primary" icon={<Plus className="size-4" />} onClick={() => setGalleryOpen(true)}>Add widget</Button> : 'No widgets have been added yet.'}
          </Empty>
        </div>
      ) : (
        <div className={cx('relative', editing && lay?.showGrid !== false && 'grid-guide')}
          style={editing ? ({ '--gy': `${g.rowHeight + gap}px`, '--gx': `calc((100% + ${gap}px) / ${g.cols})`, minHeight: (rows + 12) * (g.rowHeight + gap) } as React.CSSProperties) : undefined}>
          <RGL
            className={cx('layout', !editing && !kiosk && 'stagger')}
            layout={local}
            cols={g.cols}
            rowHeight={g.rowHeight}
            margin={[gap, gap]}
            containerPadding={[0, 0]}
            isDraggable={editing}
            isResizable={editing}
            compactType={free ? null : 'vertical'}
            allowOverlap={overlap}
            preventCollision={false}
            onDragStart={() => setDragging(true)}
            onDragStop={(l) => { setDragging(false); persist(l); }}
            onResizeStart={() => setDragging(true)}
            onResizeStop={(l) => { setDragging(false); persist(l); }}
            useCSSTransforms
            resizeHandles={HANDLES}
            draggableCancel=".no-drag"
            draggableHandle={coarse ? '.drag-handle' : undefined}
          >
            {local.map((l, idx) => {
              const w = byId.get(l.i);
              if (!w) return <div key={l.i} />;
              return (
                <div key={l.i} style={{ ['--i' as any]: Math.min(idx, 14) }}>
                  <WidgetFrame w={w} cols={l.w} rows={l.h} gridCols={g.cols} tv={tv} editing={editing} still={dragging}
                    onOpen={w.instance_id && !kiosk ? () => setOpenInstance(w.instance_id) : undefined}
                    onEdit={() => setEditWidget(w)} onRemove={() => remove(w)} onDuplicate={() => duplicate(w)} />
                </div>
              );
            })}
          </RGL>
        </div>
      )}
      <DetailPanel instanceId={openInstance} onClose={() => setOpenInstance(null)} />
      <WidgetGallery open={galleryOpen} onClose={() => setGalleryOpen(false)} boardId={board.id} />
      <WidgetSettings widget={editWidget} onClose={() => setEditWidget(null)} />
    </div>
  );
}
