import type { LayoutItem, WidgetRow } from './types';
import { SIZE_GRID } from '../widgets/types';
import type { Profile } from './device';
import { GRID } from './device';

/** Places widgets that have no saved position on this profile: first free spot, row by row. */
export function resolveLayout(widgets: WidgetRow[], saved: LayoutItem[] | undefined, profile: Profile, fallback?: LayoutItem[]): LayoutItem[] {
  const cols = GRID[profile].cols;
  const ids = new Set(widgets.map((w) => w.id));
  const out: LayoutItem[] = [];
  const src = saved ?? scaleLayout(fallback, cols);
  for (const l of src ?? []) if (ids.has(l.i)) out.push({ i: l.i, x: Math.min(l.x, cols - 1), y: l.y, w: Math.min(l.w, cols), h: l.h });
  const placed = new Set(out.map((l) => l.i));
  for (const w of widgets) {
    if (placed.has(w.id)) continue;
    const s = SIZE_GRID[w.size] ?? SIZE_GRID.M;
    const ww = profile === 'mobile' ? cols : Math.min(cols, Math.round((s.w / 12) * cols) || 1);
    const pos = findSpot(out, ww, s.h, cols);
    out.push({ i: w.id, ...pos, w: ww, h: s.h });
  }
  // nothing saved yet → widen auto-placed widgets into empty space on their right so rows look full
  if (!src) stretch(out, cols);
  return out;
}

function stretch(items: LayoutItem[], cols: number) {
  const sorted = [...items].sort((a, b) => a.y - b.y || b.x - a.x);
  for (const it of sorted) {
    const maxW = Math.min(cols, Math.ceil(it.w * 1.75));
    while (it.x + it.w < cols && it.w < maxW) {
      const col = it.x + it.w;
      const blocked = items.some((o) => o !== it && col >= o.x && col < o.x + o.w && it.y < o.y + o.h && it.y + it.h > o.y);
      if (blocked) break;
      it.w++;
    }
  }
}

function scaleLayout(l: LayoutItem[] | undefined, cols: number) {
  if (!l) return undefined;
  if (cols === 12) return l;
  if (cols <= 4) {
    // mobile: single column, keep visual order
    let y = 0;
    return [...l].sort((a, b) => a.y - b.y || a.x - b.x).map((it) => { const r = { ...it, x: 0, y, w: cols }; y += it.h; return r; });
  }
  return l.map((it) => ({ ...it, x: Math.round((it.x / 12) * cols), w: Math.max(2, Math.round((it.w / 12) * cols)) }));
}

function findSpot(items: LayoutItem[], w: number, h: number, cols: number) {
  for (let y = 0; y < 500; y++) {
    for (let x = 0; x + w <= cols; x++) {
      if (!items.some((it) => x < it.x + it.w && x + w > it.x && y < it.y + it.h && y + h > it.y)) return { x, y };
    }
  }
  return { x: 0, y: 1000 };
}
