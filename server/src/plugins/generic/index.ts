import { Agent, fetch } from 'undici';
import type { Plugin } from '../types.js';
import { tlsFields, wave } from '../types.js';

// ---------------- HTTP / JSON ----------------
/** "a.b[0].c" → value */
export function pick(obj: any, path: string): any {
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
/** lines like "Label = path.to.value | unit" */
export function parseFieldLines(s: string) {
  return (s ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    // unit = after the LAST "|" and only if it cannot be part of an expression (PromQL uses | inside regexes);
    // label = before the FIRST "=" unless that "=" belongs to a matcher or comparison ({job="x"}, ==, >=, =~)
    const u = /^(.*)\|\s*([^|"'{}()[\]]*)$/.exec(l);
    const left = (u ? u[1] : l).trim();
    const i = left.indexOf('=');
    const hasLabel = i > 0 && !/[{(\[<>!=~]/.test(left.slice(0, i)) && !/^[=~]/.test(left.slice(i + 1));
    return { label: (hasLabel ? left.slice(0, i) : left).trim(), path: (hasLabel ? left.slice(i + 1) : left).trim(), unit: u ? u[2].trim() : '' };
  });
}

interface HttpCfg { url: string; method?: string; headers?: string; body?: string; fields: string }
export interface GenericValue { label: string; value: number | string | null; unit: string }

export const httpJson: Plugin<HttpCfg, { values: GenericValue[] }> = {
  id: 'http-json', name: 'HTTP / JSON', icon: 'json', category: 'generic',
  description: 'Any JSON API: pick fields (dot path) and show them as stats. Numbers are stored in history.',
  defaultInterval: 60,
  fields: [
    { key: 'url', label: 'URL', type: 'url', required: true },
    { key: 'method', label: 'Method', type: 'select', default: 'GET', options: [{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }] },
    { key: 'headers', label: 'Headers (JSON, encrypted)', type: 'secret', placeholder: '{"Authorization":"Bearer …"}' },
    { key: 'body', label: 'Body (for POST)', type: 'text' },
    { key: 'fields', label: 'Fields', type: 'text', required: true, placeholder: 'Users = data.users | \nCPU = stats.cpu | %', help: 'One per line: Label = path.to.value | unit' },
    ...tlsFields,
  ],
  http: (c) => {
    let headers: Record<string, string> = {};
    try { headers = c.headers ? JSON.parse(c.headers) : {}; } catch { /* invalid JSON → ignored */ }
    return { baseUrl: c.url, headers };
  },
  async collect({ http, config: c }) {
    const r = await http.request<any>('', { method: c.method || 'GET', body: c.method === 'POST' && c.body ? c.body : undefined });
    const values = parseFieldLines(c.fields).map((f) => {
      const v = pick(r, f.path);
      return { label: f.label, unit: f.unit, value: typeof v === 'number' || typeof v === 'string' ? v : v == null ? null : JSON.stringify(v) };
    });
    const metrics = metricsOf(values);
    return { status: 'up', summary: values.slice(0, 2).map((v) => `${v.label}: ${v.value ?? '—'}${v.unit}`).join(' · '), data: { values }, metrics };
  },
  mock(ctx) {
    const values = parseFieldLines(ctx.config.fields || 'Value = value').map((f, i) => ({ label: f.label, unit: f.unit, value: Math.round(wave(ctx.tick + i * 5, 50, 20)) }));
    return { status: 'up', data: { values }, metrics: metricsOf(values) };
  },
  widgets: [{ id: 'values', name: 'HTTP/JSON values', description: 'Arbitrary values from a JSON API', sizes: ['S', 'M', 'L'], defaultSize: 'S' }],
};
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');
/** numeric values as history metrics; labels that reduce to the same (or an empty) key get a suffix instead of overwriting each other */
function metricsOf(values: GenericValue[]) {
  const out: Record<string, number> = {};
  for (const v of values) {
    if (typeof v.value !== 'number' || !Number.isFinite(v.value)) continue;
    const base = slug(v.label) || 'value';
    let key = base;
    for (let n = 2; key in out; n++) key = `${base}_${n}`;
    out[key] = v.value;
  }
  return out;
}

// ---------------- Prometheus ----------------
interface PromCfg { url: string; bearer?: string; queries: string }
export const prometheus: Plugin<PromCfg, { values: GenericValue[] }> = {
  id: 'prometheus', name: 'Prometheus', icon: 'prometheus', category: 'generic',
  description: 'PromQL queries as stats (e.g. temperature from node_exporter: node_hwmon_temp_celsius).',
  defaultInterval: 30,
  fields: [
    { key: 'url', label: 'Prometheus URL', type: 'url', required: true, placeholder: 'http://prometheus:9090' },
    { key: 'bearer', label: 'Bearer token (optional)', type: 'secret' },
    { key: 'queries', label: 'Queries', type: 'text', required: true, placeholder: 'Temp CPU = max(node_hwmon_temp_celsius) | °C', help: 'One per line: Label = PromQL | unit' },
    ...tlsFields,
  ],
  http: (c) => ({ headers: c.bearer ? { Authorization: `Bearer ${c.bearer}` } : ({} as Record<string, string>) }),
  async collect({ http, config: c }) {
    const values: GenericValue[] = [];
    const failed: string[] = [];
    let lastError: unknown;
    for (const f of parseFieldLines(c.queries)) {
      try {
        const r = await http.get<any>('/api/v1/query', { query: { query: f.path } });
        const d = r?.data;
        // scalar results are [ts, "42"], vectors are [{ value: [ts, "42"] }]
        const raw = d?.resultType === 'scalar' || d?.resultType === 'string' ? d.result?.[1] : d?.result?.[0]?.value?.[1];
        const num = Number(raw);
        values.push({ label: f.label, unit: f.unit, value: raw === undefined || !Number.isFinite(num) ? null : Math.round(num * 100) / 100 });
      } catch (e) {
        // one mistyped query must not take the other values down with it
        lastError = e;
        failed.push(f.label);
        values.push({ label: f.label, unit: f.unit, value: null });
      }
    }
    if (failed.length && failed.length === values.length) throw lastError;
    return {
      status: failed.length ? 'degraded' : 'up', summary: values.slice(0, 2).map((v) => `${v.label}: ${v.value ?? '—'}${v.unit}`).join(' · '), data: { values }, metrics: metricsOf(values),
      alerts: failed.map((l) => ({ key: `query:${l}`, severity: 'warning' as const, message: `Prometheus query "${l}" failed` })),
    };
  },
  mock(ctx) {
    const values = parseFieldLines(ctx.config.queries || 'Temp CPU = x | °C').map((f, i) => ({ label: f.label, unit: f.unit, value: Math.round(wave(ctx.tick + i * 3, 48, 8) * 10) / 10 }));
    return { status: 'up', data: { values }, metrics: metricsOf(values) };
  },
  widgets: [{ id: 'values', name: 'Prometheus values', description: 'PromQL query results', sizes: ['S', 'M', 'L'], defaultSize: 'S' }],
};

// ---------------- Docker ----------------
interface DockerCfg { url: string }
export interface DockerData { containers: { id: string; name: string; image: string; state: string; status: string; health?: string }[] }

const dockerAgents = new Map<string, Agent>();
async function dockerGet(base: string, path: string, method = 'GET', timeoutMs = 10_000) {
  let url = base, dispatcher: Agent | undefined;
  if (base.startsWith('unix://')) {
    const socketPath = base.slice(7);
    if (!dockerAgents.has(socketPath)) dockerAgents.set(socketPath, new Agent({ connect: { socketPath } }));
    dispatcher = dockerAgents.get(socketPath);
    url = 'http://docker';
  }
  const r = await fetch(url.replace(/\/+$/, '') + path, { method, dispatcher, signal: AbortSignal.timeout(timeoutMs) } as any);
  if (r.status >= 400) throw new Error(`Docker HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

function dockerFinish(d: DockerData) {
  const bad = d.containers.filter((c) => c.state !== 'running' || c.health === 'unhealthy');
  return {
    status: bad.some((c) => c.health === 'unhealthy' || c.state === 'restarting' || c.state === 'dead') ? ('degraded' as const) : ('up' as const),
    summary: `${d.containers.filter((c) => c.state === 'running').length}/${d.containers.length} containers running`,
    data: d,
    metrics: { running: d.containers.filter((c) => c.state === 'running').length, total: d.containers.length },
    alerts: d.containers.filter((c) => c.health === 'unhealthy').map((c) => ({ key: `unhealthy:${c.name}`, severity: 'warning' as const, message: `Container ${c.name} is unhealthy` })),
  };
}
export const docker: Plugin<DockerCfg, DockerData> = {
  id: 'docker', name: 'Docker', icon: 'docker', category: 'generic',
  description: 'Containers via the Docker API (recommended: read-only docker-socket-proxy + POST for restart).',
  defaultInterval: 30,
  fields: [{ key: 'url', label: 'Docker endpoint', type: 'string', required: true, default: 'http://docker-socket-proxy:2375', placeholder: 'unix:///var/run/docker.sock or http://host:2375' }],
  async collect({ config: c }) {
    const list = await dockerGet(c.url, '/containers/json?all=1');
    if (!Array.isArray(list)) throw new Error('Unexpected answer from Docker — check the endpoint');
    return dockerFinish({
      containers: list.map((x: any) => ({
        id: x.Id.slice(0, 12), name: String(x.Names?.[0] ?? '').replace(/^\//, ''), image: x.Image, state: x.State, status: x.Status,
        health: /\((healthy|unhealthy|health: starting)\)/.exec(x.Status ?? '')?.[1],
      })),
    });
  },
  mock() {
    return dockerFinish({
      containers: [['scydehub', 'running', 'healthy'], ['streamero', 'running', 'healthy'], ['radarr', 'running'], ['sonarr', 'running'], ['qbittorrent', 'running'], ['watchtower', 'exited']].map(([name, state, health], i) => ({
        id: `abc${i}`, name, image: `lscr.io/linuxserver/${name}:latest`, state, status: state === 'running' ? `Up 3 days${health ? ` (${health})` : ''}` : 'Exited (0) 2 days ago', health,
      })) as any,
    });
  },
  actions: [
    {
      id: 'restart', label: 'Restart container', danger: true, params: [{ key: 'id', label: 'Container ID', type: 'string', required: true }],
      run: async ({ config: c }, p) => { if (!/^[\w.-]+$/.test(String(p.id))) throw new Error('Invalid ID'); await dockerGet(c.url, `/containers/${p.id}/restart?t=10`, 'POST', 40_000); return 'Container restarted'; },
    },
  ],
  widgets: [{ id: 'containers', name: 'Docker containers', description: 'Status of all containers', sizes: ['S', 'M', 'L'], defaultSize: 'M' }],
};
