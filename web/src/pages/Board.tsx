import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout';
import { Plus, LayoutGrid } from 'lucide-react';
import { useStore } from '../lib/store';
import { del, put } from '../lib/api';
import { GRID, type Profile } from '../lib/device';
import { resolveLayout } from '../lib/layout';
import type { Board as BoardT, WidgetRow } from '../lib/types';
import { WidgetFrame } from '../components/WidgetFrame';
import { DetailPanel } from '../components/DetailPanel';
import { WidgetGallery } from '../components/WidgetGallery';
import { WidgetSettings } from '../components/WidgetSettings';
import { Button, Empty, cx } from '../components/ui';
import { confirmDialog, toast } from '../components/feedback';

const RGL = WidthProvider(GridLayout);

export function BoardView({ board, profile, editing, kiosk }: { board: BoardT; profile: Profile; editing: boolean; kiosk?: boolean }) {
  const g = GRID[profile];
  const tv = profile === 'tv';
  const [openInstance, setOpenInstance] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [editWidget, setEditWidget] = useState<WidgetRow | null>(null);
  const isAdmin = useStore((s) => s.me?.auth?.kind === 'admin');
  const layout = useMemo(
    () => resolveLayout(board.widgets, board.layouts[profile], profile, board.layouts.desktop ?? board.layouts.tv ?? board.layouts.tablet),
    [board, profile],
  );
  const [local, setLocal] = useState(layout);
  useEffect(() => setLocal(layout), [layout]);
  const saveTimer = useRef<number>();

  const persist = useCallback((l: Layout[]) => {
    const clean = l.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
    setLocal(clean);
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      put(`/api/boards/${board.id}/layout/${profile}`, { layout: clean }).catch((e) => toast(e.message, 'bad'));
    }, 400);
  }, [board.id, profile]);

  // persist auto-placed layout once in edit mode so positions become stable
  useEffect(() => {
    if (editing && isAdmin && !board.layouts[profile] && layout.length) persist(layout as Layout[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const remove = async (w: WidgetRow) => {
    if (!(await confirmDialog({ title: 'Makni widget?', body: 'Widget nestaje sa svih uređaja na ovoj stranici.', danger: true, confirmLabel: 'Makni' }))) return;
    await del(`/api/widgets/${w.id}`);
  };

  const byId = useMemo(() => new Map(board.widgets.map((w) => [w.id, w])), [board.widgets]);
  const open = (w: WidgetRow) => {
    if (kiosk) return;
    if (w.instance_id) setOpenInstance(w.instance_id);
  };

  return (
    <div className={cx(editing && 'editing', 'pb-10')}>
      {board.widgets.length === 0 ? (
        <div className="glass mx-auto mt-10 max-w-md rounded-3xl p-10">
          <Empty icon={<LayoutGrid className="size-10" />} title="Prazna stranica">
            {isAdmin ? <Button className="mt-3" variant="primary" icon={<Plus className="size-4" />} onClick={() => setGalleryOpen(true)}>Dodaj widget</Button> : 'Admin još nije dodao widgete.'}
          </Empty>
        </div>
      ) : (
        <RGL
          className="layout"
          layout={local}
          cols={g.cols}
          rowHeight={g.rowHeight}
          margin={[g.margin, g.margin]}
          containerPadding={[0, 0]}
          isDraggable={editing}
          isResizable={editing}
          draggableHandle=".drag-handle"
          compactType="vertical"
          onDragStop={persist}
          onResizeStop={persist}
          useCSSTransforms
          resizeHandles={['se']}
        >
          {local.map((l) => {
            const w = byId.get(l.i);
            if (!w) return <div key={l.i} />;
            return (
              <div key={l.i}>
                <WidgetFrame w={w} cols={l.w} rows={l.h} gridCols={g.cols} tv={tv} editing={editing}
                  onOpen={w.instance_id && !kiosk ? () => open(w) : undefined} onEdit={() => setEditWidget(w)} onRemove={() => remove(w)} />
              </div>
            );
          })}
        </RGL>
      )}
      {editing && isAdmin && board.widgets.length > 0 && (
        <button onClick={() => setGalleryOpen(true)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-line py-6 text-sm text-muted transition hover:border-accent hover:text-accent">
          <Plus className="size-4" /> Dodaj widget
        </button>
      )}
      <DetailPanel instanceId={openInstance} onClose={() => setOpenInstance(null)} />
      <WidgetGallery open={galleryOpen} onClose={() => setGalleryOpen(false)} boardId={board.id} />
      <WidgetSettings widget={editWidget} onClose={() => setEditWidget(null)} />
    </div>
  );
}
