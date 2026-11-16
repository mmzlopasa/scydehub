import { memo, useMemo, type ReactNode } from 'react';
import { AlertTriangle, GripVertical, Settings2, Trash2, FlaskConical } from 'lucide-react';
import { useStore } from '../lib/store';
import { ago } from '../lib/format';
import { componentFor, coreDef } from '../widgets/registry';
import { sizeFromGrid } from '../widgets/types';
import type { WidgetRow } from '../lib/types';
import { ServiceIcon, StatusDot, WidgetSkeleton, cx, Empty } from './ui';
import { ErrorBoundary } from './ErrorBoundary';
import { CoreIcon } from './icons';

interface Props {
  w: WidgetRow;
  cols: number;
  rows: number;
  gridCols: number;
  tv: boolean;
  editing: boolean;
  onOpen?: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
}

function WidgetFrameInner({ w, cols, rows, gridCols, tv, editing, onOpen, onEdit, onRemove }: Props) {
  const state = useStore((s) => (w.instance_id ? s.states[w.instance_id] : undefined));
  const instance = useStore((s) => (w.instance_id ? s.instances.find((i) => i.id === w.instance_id) : undefined));
  const plugin = useStore((s) => (instance ? s.plugins.find((p) => p.id === instance.plugin) : undefined));
  const Comp = componentFor(w.kind);
  const core = coreDef(w.kind);
  const size = sizeFromGrid(cols, rows, gridCols);
  const widgetDef = plugin?.widgets.find((d) => `${plugin.id}.${d.id}` === w.kind);
  const title = w.title || (core ? core.name : instance?.name ?? widgetDef?.name ?? w.kind);
  const needsInstance = !core || core.instancePlugins;
  const showHeader = w.options?.hideHeader !== true && !(core && ['core.clock', 'core.weather'].includes(w.kind));

  const body: ReactNode = useMemo(() => {
    if (!Comp) return <Empty title="Nepoznat widget" />;
    if (needsInstance && w.instance_id && !instance) return <Empty title="Servis je obrisan" />;
    if (!core && !state) return <WidgetSkeleton />;
    if (!core && state && state.data === undefined) {
      return state.status === 'disabled' ? <Empty title="Servis je isključen" /> : state.error ? <Empty icon={<AlertTriangle className="text-bad" />} title="Nema podataka">{state.error}</Empty> : <WidgetSkeleton />;
    }
    return <Comp w={w} size={size} state={state} data={state?.data} instance={instance} plugin={plugin} cols={cols} rows={rows} tv={tv} />;
  }, [Comp, w, size, state, instance, plugin, cols, rows, tv, core, needsInstance]);

  const down = state?.status === 'down';
  return (
    <div
      className={cx('glass group/w relative flex h-full flex-col overflow-hidden rounded-[20px] transition-shadow', !editing && onOpen && 'cursor-pointer hover:border-[color-mix(in_oklab,var(--accent)_35%,var(--line))]', down && 'border-bad/40', tv && 'tv-focus')}
      tabIndex={tv || onOpen ? 0 : -1}
      onClick={() => !editing && onOpen?.()}
      onKeyDown={(e) => { if (e.key === 'Enter' && !editing) onOpen?.(); }}
    >
      {showHeader && (
        <div className={cx('flex items-center gap-2 px-4 pt-3', tv ? 'pb-2' : 'pb-1.5')}>
          {editing && <GripVertical className="drag-handle size-4 shrink-0 cursor-grab text-muted active:cursor-grabbing" />}
          {plugin ? <ServiceIcon slug={plugin.icon} name={plugin.name} size={tv ? 22 : 18} /> : core && <CoreIcon name={core.icon} className="size-4 text-muted" />}
          <div className={cx('min-w-0 flex-1 truncate font-semibold', tv ? 'text-base' : 'text-[13px]')}>{title}</div>
          {state?.mock && !editing && <span title="Mock podaci"><FlaskConical className="size-3.5 text-muted/70" /></span>}
          {state && !editing && <span className="text-[11px] text-muted max-sm:hidden" title={`Zadnja promjena stanja ${ago(state.statusSince)}`}>{state.status === 'down' ? `pao ${ago(state.statusSince)}` : ''}</span>}
          {state && <StatusDot status={state.status} pulse={down} />}
          {editing && (
            <div className="flex items-center gap-0.5" onMouseDown={(e) => e.stopPropagation()}>
              <button className="grid size-7 place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-fg" title="Postavke widgeta" onClick={(e) => { e.stopPropagation(); onEdit?.(); }}><Settings2 className="size-4" /></button>
              <button className="grid size-7 place-items-center rounded-lg text-muted hover:bg-bad/15 hover:text-bad" title="Makni widget" onClick={(e) => { e.stopPropagation(); onRemove?.(); }}><Trash2 className="size-4" /></button>
            </div>
          )}
        </div>
      )}
      {editing && !showHeader && (
        <div className="absolute right-2 top-2 z-10 flex gap-0.5 rounded-xl bg-[var(--bg)]/80 p-0.5" onMouseDown={(e) => e.stopPropagation()}>
          <GripVertical className="drag-handle size-7 cursor-grab p-1.5 text-muted" />
          <button className="grid size-7 place-items-center rounded-lg text-muted hover:text-fg" onClick={(e) => { e.stopPropagation(); onEdit?.(); }}><Settings2 className="size-4" /></button>
          <button className="grid size-7 place-items-center rounded-lg text-muted hover:text-bad" onClick={(e) => { e.stopPropagation(); onRemove?.(); }}><Trash2 className="size-4" /></button>
        </div>
      )}
      {state?.stale && state.error && (
        <div className="mx-3 mb-1 flex items-center gap-2 rounded-lg bg-bad/10 px-2 py-1 text-[11px] text-bad" title={state.error}>
          <AlertTriangle className="size-3 shrink-0" /><span className="truncate">Zadnje poznato stanje ({ago(state.lastOkAt)}) · {state.error}</span>
        </div>
      )}
      <div className={cx('min-h-0 flex-1 overflow-hidden px-4 pb-4', !showHeader && 'pt-4', editing && 'pointer-events-none select-none')}>
        <ErrorBoundary>{body}</ErrorBoundary>
      </div>
    </div>
  );
}
export const WidgetFrame = memo(WidgetFrameInner);
