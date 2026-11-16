import type { HttpClient, TlsOptions } from '../lib/http.js';

export type Status = 'up' | 'degraded' | 'down' | 'unknown' | 'disabled';
export type Size = 'S' | 'M' | 'L' | 'XL';
export type Category = 'infrastructure' | 'media' | 'downloads' | 'network' | 'hosting' | 'security' | 'generic';
export type Severity = 'info' | 'warning' | 'critical';

export interface ConfigField {
  key: string;
  label: string;
  type: 'string' | 'url' | 'secret' | 'number' | 'boolean' | 'select' | 'text';
  required?: boolean;
  default?: string | number | boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
}

export interface WidgetDef {
  /** unique within the plugin */
  id: string;
  name: string;
  description: string;
  sizes: Size[];
  defaultSize: Size;
}

export interface PluginAlert {
  /** stable key inside this instance, e.g. "health:IndexerStatusCheck" */
  key: string;
  severity: Severity;
  message: string;
}

export interface CollectResult<D = unknown> {
  status: Exclude<Status, 'unknown' | 'disabled'>;
  /** short one-liner for status wall / summary */
  summary?: string;
  data: D;
  /** numeric values stored into history (CPU %, queue size, ...) */
  metrics?: Record<string, number>;
  /** conditions reported by the service itself (health warnings, failed backup, ...) */
  alerts?: PluginAlert[];
}

export interface PluginContext<C = Record<string, any>> {
  instanceId: string;
  instanceName: string;
  config: C;
  http: HttpClient;
  /** in-memory scratch space that survives between collect() calls (cookies, previous counters) */
  scratch: Record<string, any>;
  /** monotonically increasing counter — handy for mock data animation */
  tick: number;
  log: (msg: string) => void;
}

export interface ActionDef<C = Record<string, any>> {
  id: string;
  label: string;
  description?: string;
  /** destructive actions get a red confirm button */
  danger?: boolean;
  params?: ConfigField[];
  run(ctx: PluginContext<C>, params: Record<string, any>): Promise<string | void>;
  /** optional mock behaviour (defaults to a no-op success) */
  mock?(ctx: PluginContext<C>, params: Record<string, any>): string | void;
}

export interface Plugin<C = Record<string, any>, D = any> {
  id: string;
  name: string;
  /** dashboard-icons slug, e.g. "proxmox" */
  icon: string;
  category: Category;
  description: string;
  docsUrl?: string;
  /** fields shown in the instance form; type 'secret' is stored encrypted and never sent to the browser */
  fields: ConfigField[];
  /** default polling interval in seconds */
  defaultInterval: number;
  /** build default headers / base URL for the shared HTTP client */
  http?(config: C): { baseUrl?: string; headers?: Record<string, string> };
  collect(ctx: PluginContext<C>): Promise<CollectResult<D>>;
  mock(ctx: PluginContext<C>): CollectResult<D>;
  actions?: ActionDef<C>[];
  widgets: WidgetDef[];
}

export const tlsFields: ConfigField[] = [
  { key: 'tlsInsecure', label: 'Prihvati self-signed certifikat (samo ovaj servis)', type: 'boolean', default: false },
  { key: 'tlsFingerprint', label: 'SHA-256 pin certifikata (opcionalno)', type: 'string', placeholder: 'AB:CD:…', help: 'Sigurnije od isključivanja provjere: prihvaća samo točno ovaj certifikat.' },
];

export function tlsFrom(c: Record<string, any>): TlsOptions {
  return { insecure: !!c.tlsInsecure, fingerprint: c.tlsFingerprint || undefined };
}

export const urlField = (placeholder: string): ConfigField => ({ key: 'url', label: 'URL', type: 'url', required: true, placeholder });
export const apiKeyField = (label = 'API ključ'): ConfigField => ({ key: 'apiKey', label, type: 'secret', required: true });

/** helpers for mock data */
export const wave = (tick: number, base: number, amp: number, period = 20) => base + amp * Math.sin((tick / period) * Math.PI * 2);
export const jitter = (v: number, pct = 0.1) => v * (1 + (Math.random() * 2 - 1) * pct);
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const pct = (used: number, total: number) => (total > 0 ? Math.round((used / total) * 1000) / 10 : 0);
