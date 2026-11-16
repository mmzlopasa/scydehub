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
export const SIZE_GRID: Record<Size, { w: number; h: number }> = {
  S: { w: 3, h: 3 },
  M: { w: 4, h: 4 },
  L: { w: 6, h: 5 },
  XL: { w: 12, h: 5 },
};
export function sizeFromGrid(w: number, h: number, cols: number): Size {
  const rel = (w / cols) * 12;
  if (rel >= 9 && h >= 4) return 'XL';
  if (rel >= 6 && h >= 4) return 'L';
  if (rel <= 3 || h <= 2) return 'S';
  return 'M';
}
