import type { LayoutItem, WidgetRow } from './types';
import { SIZE_GRID } from '../widgets/types';
import type { Profile } from './device';
import { GRID } from './device';

/** Places widgets that have no saved position on this profile: first free spot, row by row. */
export function resolveLayout(widgets: WidgetRow[], saved: LayoutItem[] | undefined, profile: Profile, fallback?: LayoutItem[]): LayoutItem[] {
  const cols = GRID[profile].cols;
  const ids = new Set(widgets.map((w) => w.id));
  const out: LayoutItem[] = [];
  const src = Array.isArray(saved) ? saved : scaleLayout(Array.isArray(fallback) ? fallback : undefined, cols);
  for (const l of src ?? []) {
    if (!l || !ids.has(l.i)) continue;
    const w = Math.max(1, Math.min(Number(l.w) || 1, cols));
    out.push({ i: l.i, x: Math.max(0, Math.min(Number(l.x) || 0, cols - w)), y: Math.max(0, Number(l.y) || 0), w, h: Math.max(1, Number(l.h) || 1) });
  }
  const placed = new Set(out.map((l) => l.i));
  const fresh: LayoutItem[] = [];
  for (const w of widgets) {
    if (placed.has(w.id)) continue;
    const s = SIZE_GRID[w.size] ?? SIZE_GRID.M;
    const ww = profile === 'mobile' ? cols : Math.min(cols, Math.max(2, Math.round((s.w / 24) * cols)));
    const pos = findSpot(out, ww, s.h, cols);
    const item = { i: w.id, ...pos, w: ww, h: s.h };
    out.push(item);
    fresh.push(item);
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
  if (cols === 24) return l;
  if (cols <= 8) {
    // phone: single column, keep the visual order
    let y = 0;
    return [...l].sort((a, b) => a.y - b.y || a.x - b.x).map((it) => { const r = { ...it, x: 0, y, w: cols }; y += it.h; return r; });
  }
  return l.map((it) => ({ ...it, x: Math.round((it.x / 24) * cols), w: Math.max(2, Math.round((it.w / 24) * cols)) }));
}

export function findSpot(items: LayoutItem[], w: number, h: number, cols: number) {
  for (let y = 0; y < 2000; y++) {
    for (let x = 0; x + w <= cols; x++) {
      if (!items.some((it) => x < it.x + it.w && x + w > it.x && y < it.y + it.h && y + h > it.y)) return { x, y };
    }
  }
  return { x: 0, y: 2000 };
}
