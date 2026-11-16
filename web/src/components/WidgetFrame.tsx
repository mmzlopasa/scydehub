import { memo, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { AlertTriangle, Copy, Settings2, Trash2, FlaskConical } from 'lucide-react';
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
  /** true while any widget is being dragged/resized → no tilt */
  still?: boolean;
  onOpen?: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
  onDuplicate?: () => void;
}

/** 3D tilt: the card leans towards the pointer and a soft light follows it. Mouse only, off in edit mode. */
function useTilt(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const onMove = (e: React.PointerEvent) => {
    if (!enabled || e.pointerType !== 'mouse') return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      // smaller cards may lean more; large ones barely move so text stays calm
      const max = Math.min(5, 900 / Math.max(r.width, r.height));
      el.style.transform = `perspective(1100px) rotateX(${(0.5 - py) * max}deg) rotateY(${(px - 0.5) * max}deg) translateZ(0)`;
      el.style.setProperty('--mx', `${px * 100}%`);
      el.style.setProperty('--my', `${py * 100}%`);
      el.classList.add('is-hover');
    });
  };
  const onLeave = () => {
    cancelAnimationFrame(raf.current);
    const el = ref.current;
    if (!el) return;
    el.style.transform = '';
    el.classList.remove('is-hover');
  };
  return { ref, onPointerMove: onMove, onPointerLeave: onLeave };
}

function WidgetFrameInner({ w, cols, rows, gridCols, tv, editing, still, onOpen, onEdit, onRemove, onDuplicate }: Props) {
  const state = useStore((s) => (w.instance_id ? s.states[w.instance_id] : undefined));
  const instance = useStore((s) => (w.instance_id ? s.instances.find((i) => i.id === w.instance_id) : undefined));
  const plugin = useStore((s) => (instance ? s.plugins.find((p) => p.id === instance.plugin) : undefined));
  const ap = useStore((s) => s.settings?.appearance);
  const Comp = componentFor(w.kind);
  const core = coreDef(w.kind);
  const size = sizeFromGrid(cols, rows, gridCols);
  const widgetDef = plugin?.widgets.find((d) => `${plugin.id}.${d.id}` === w.kind);
  const o = w.options ?? {};
  const title = w.title || (core ? core.name : instance?.name ?? widgetDef?.name ?? w.kind);
  const needsInstance = !core || core.instancePlugins;
  const headerless = core && ['core.clock', 'core.weather'].includes(w.kind) && o.hideHeader !== false;
  const showHeader = o.hideHeader !== true && !headerless && ap?.widgetHeaders !== false;
  const tilt = useTilt(!editing && !still && !tv && ap?.tilt !== false && ap?.animations !== 'off');
  const accent = typeof o.accent === 'string' && /^#[0-9a-f]{6}$/i.test(o.accent) ? o.accent : instance?.display?.color;
  const icon = (typeof o.icon === 'string' && o.icon) || instance?.display?.icon || plugin?.icon;

  const body: ReactNode = useMemo(() => {
    if (!Comp) return <Empty title="Unknown widget" />;
    if (needsInstance && w.instance_id && !instance) return <Empty title="This service was deleted" />;
    if (!core && !state) return <WidgetSkeleton />;
    if (!core && state && state.data === undefined) {
      return state.status === 'disabled' ? <Empty title="Service is disabled" /> : state.error ? <Empty icon={<AlertTriangle className="text-bad" />} title="No data">{state.error}</Empty> : <WidgetSkeleton />;
    }
    return <Comp w={w} size={size} state={state} data={state?.data} instance={instance} plugin={plugin} cols={cols} rows={rows} tv={tv} />;
  }, [Comp, w, size, state, instance, plugin, cols, rows, tv, core, needsInstance]);

  const down = state?.status === 'down';
  const style: CSSProperties | undefined = accent
    ? ({ '--accent': accent, '--accent-rgb': `${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}`, '--accent-ink': accent } as CSSProperties)
    : undefined;
  const btn = 'no-drag grid size-7 place-items-center rounded-full text-muted transition hover:bg-panel-2 hover:text-fg';
  return (
    <div
      {...tilt}
      style={style}
      className={cx('group/w relative flex h-full flex-col overflow-hidden', o.transparent ? 'card-r' : 'glass tilt', !editing && onOpen && 'cursor-pointer', editing && 'cursor-grab active:cursor-grabbing',
        down && '!border-bad/50 shadow-[0_0_0_1px_rgba(255,122,138,.25),0_0_40px_-12px_var(--bad)]', tv && 'tv-focus')}
      tabIndex={tv || onOpen ? 0 : -1}
      onClick={() => !editing && onOpen?.()}
      onKeyDown={(e) => { if (e.key === 'Enter' && !editing) onOpen?.(); }}
    >
      {showHeader && (
        <div className={cx('flex items-center gap-2.5 px-5', tv ? 'pb-2 pt-4' : 'pb-1.5 pt-4')}>
          {icon && (plugin || o.icon) ? <ServiceIcon slug={icon} name={plugin?.name ?? title} size={tv ? 24 : 20} color={accent} /> : core && <CoreIcon name={core.icon} className="size-4 text-accent" />}
          <div className={cx('min-w-0 flex-1 truncate font-semibold tracking-tight', tv ? 'text-base' : 'text-[13.5px]')}>{title}</div>
          {state?.mock && !editing && <span title="Mock data"><FlaskConical className="size-3.5 text-muted/70" /></span>}
          {state && !editing && down && <span className="text-[11px] text-bad max-sm:hidden" title={`Last status change ${ago(state.statusSince)}`}>down {ago(state.statusSince)}</span>}
          {state && <StatusDot status={state.status} pulse={down} />}
        </div>
      )}
      {editing && (
        <div className="pop absolute right-2 top-2 z-10 flex gap-0.5 rounded-full p-0.5" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
          <button className={btn} title="Widget settings" onClick={(e) => { e.stopPropagation(); onEdit?.(); }}><Settings2 className="size-4" /></button>
          <button className={btn} title="Duplicate" onClick={(e) => { e.stopPropagation(); onDuplicate?.(); }}><Copy className="size-3.5" /></button>
          <button className={cx(btn, 'hover:!bg-bad/15 hover:!text-bad')} title="Remove widget" onClick={(e) => { e.stopPropagation(); onRemove?.(); }}><Trash2 className="size-4" /></button>
        </div>
      )}
      {state?.stale && state.error && (
        <div className="mx-4 mb-1 flex items-center gap-2 rounded-full bg-bad/10 px-3 py-1 text-[11px] text-bad" title={state.error}>
          <AlertTriangle className="size-3 shrink-0" /><span className="truncate">Last known state ({ago(state.lastOkAt)}) · {state.error}</span>
        </div>
      )}
      <div className={cx('min-h-0 flex-1 overflow-hidden', o.noPadding ? '' : 'px-5 pb-5', !showHeader && !o.noPadding && 'pt-5', editing && 'pointer-events-none select-none')}>
        <ErrorBoundary>{body}</ErrorBoundary>
      </div>
    </div>
  );
}
export const WidgetFrame = memo(WidgetFrameInner);
