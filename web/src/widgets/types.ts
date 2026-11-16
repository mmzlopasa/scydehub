import type { ComponentType } from 'react';
import type { Field, Instance, InstanceState, PluginMeta, Size, WidgetRow } from '../lib/types';

export interface WidgetProps<D = any> {
  w: WidgetRow;
  size: Size;
  state?: InstanceState<D>;
  data?: D;
  instance?: Instance;
  plugin?: PluginMeta;
  /** grid units actually allocated (for fine-grained density decisions) */
  cols: number;
  rows: number;
  tv: boolean;
}

export interface CoreWidgetDef {
  kind: string;
  name: string;
  description: string;
  icon: string; // lucide icon name key in CORE_ICONS
  defaultSize: Size;
  /** option fields shown in the widget settings */
  options?: Field[];
  /** needs an instance of one of these plugins (core.chart needs any instance) */
  instancePlugins?: string[] | 'any';
}

export type WidgetComponent = ComponentType<WidgetProps>;
/** default footprint per size on the 24-column grid */
export const SIZE_GRID: Record<Size, { w: number; h: number }> = {
  S: { w: 6, h: 6 },
  M: { w: 8, h: 8 },
  L: { w: 12, h: 10 },
  XL: { w: 24, h: 10 },
};
/** How much detail a widget shows follows the space it actually has. */
export function sizeFromGrid(w: number, h: number, cols: number): Size {
  const rel = (w / cols) * 24;
  if (rel >= 18 && h >= 8) return 'XL';
  if (rel >= 11 && h >= 8) return 'L';
  if (rel <= 6 || h <= 5) return 'S';
  return 'M';
}
