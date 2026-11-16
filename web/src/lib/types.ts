export type Status = 'up' | 'degraded' | 'down' | 'unknown' | 'disabled';
export type Size = 'S' | 'M' | 'L' | 'XL';
export type Severity = 'info' | 'warning' | 'critical';

export interface Field {
  key: string; label: string; type: 'string' | 'url' | 'secret' | 'number' | 'boolean' | 'select' | 'text';
  required?: boolean; default?: any; placeholder?: string; help?: string; options?: { value: string; label: string }[];
}
export interface WidgetDef { id: string; name: string; description: string; sizes: Size[]; defaultSize: Size }
export interface ActionMeta { id: string; label: string; description?: string; danger: boolean; params: Field[] }
export interface PluginMeta {
  id: string; name: string; icon: string; category: string; description: string; docsUrl?: string;
  defaultInterval: number; fields: Field[]; widgets: WidgetDef[]; actions: ActionMeta[];
}
export interface Instance {
  id: string; plugin: string; name: string; enabled: boolean; mock: boolean; effectiveMock?: boolean;
  config?: Record<string, any>; interval_sec?: number; sort?: number;
}
export interface PluginAlert { key: string; severity: Severity; message: string }
export interface InstanceState<D = any> {
  id: string; plugin: string; name: string; status: Status; summary?: string; data?: D; error?: string;
  updatedAt: number; lastOkAt?: number; statusSince: number; latencyMs?: number; mock: boolean; alerts: PluginAlert[];
  metrics?: Record<string, number>; stale?: boolean;
}
export interface CheckState {
  id: string; name: string; type: 'ping' | 'tcp' | 'http' | 'ssl' | 'dns'; target: string; ok: boolean | null; latencyMs?: number; message?: string;
  checkedAt?: number; statusSince: number; extra?: Record<string, any>; enabled: boolean; instanceId?: string | null;
  uptime?: { d1: number | null; d7: number | null; d30: number | null };
  recent?: { ts: number; ok: number; latency: number | null }[];
}
export interface Incident {
  id: number; rule_id: string | null; key: string; title: string; message: string | null; severity: Severity;
  started_at: number; resolved_at: number | null; acked_at: number | null; acked_by: string | null;
}
export interface WidgetRow {
  id: string; board_id: string; kind: string; instance_id: string | null; title: string | null; size: Size; options: Record<string, any>;
}
export interface LayoutItem { i: string; x: number; y: number; w: number; h: number }
export interface Board {
  id: string; name: string; icon: string; sort: number; in_rotation: boolean; widgets: WidgetRow[]; layouts: Record<string, LayoutItem[]>;
}
export interface Settings {
  appearance: { theme: 'dark' | 'light' | 'oled'; accent: string; glass: boolean; density: 'comfortable' | 'compact' };
  kiosk: { rotationSec: number; pauseOnInteractSec: number; pixelShift: boolean; nightDim: { enabled: boolean; start: string; end: string; level: number }; alertTakeover: boolean };
  publicUrl: string;
  heartbeat: { url: string; intervalSec: number };
  weather: { lat: number; lon: number; name: string };
  maintenanceUntil: number;
}
export type Auth = { kind: 'admin'; username: string; totp: boolean } | { kind: 'kiosk'; name: string; canAck: boolean };
export interface Me { setup: boolean; auth: Auth | null; version: string; buildId: string; mockAll: boolean }
