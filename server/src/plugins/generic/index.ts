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
    const [left, unit] = l.split('|').map((x) => x.trim());
    const [label, path] = left.includes('=') ? left.split('=').map((x) => x.trim()) : [left, left];
    return { label, path, unit: unit || '' };
  });
}

interface HttpCfg { url: string; method?: string; headers?: string; body?: string; fields: string }
export interface GenericValue { label: string; value: number | string | null; unit: string }

export const httpJson: Plugin<HttpCfg, { values: GenericValue[] }> = {
  id: 'http-json', name: 'HTTP / JSON', icon: 'json', category: 'generic',
  description: 'Bilo koji JSON API: odaberi polja (dot path) i prikaži ih kao statistiku. Brojevi idu u povijest.',
  defaultInterval: 60,
  fields: [
    { key: 'url', label: 'URL', type: 'url', required: true },
    { key: 'method', label: 'Metoda', type: 'select', default: 'GET', options: [{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }] },
    { key: 'headers', label: 'Headeri (JSON, šifrirano)', type: 'secret', placeholder: '{"Authorization":"Bearer …"}' },
    { key: 'body', label: 'Body (za POST)', type: 'text' },
    { key: 'fields', label: 'Polja', type: 'text', required: true, placeholder: 'Korisnici = data.users | \nCPU = stats.cpu | %', help: 'Jedno po retku: Naziv = putanja.do.vrijednosti | jedinica' },
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
    const metrics = Object.fromEntries(values.filter((v) => typeof v.value === 'number').map((v) => [slug(v.label), v.value as number]));
    return { status: 'up', summary: values.slice(0, 2).map((v) => `${v.label}: ${v.value}${v.unit}`).join(' · '), data: { values }, metrics };
  },
  mock(ctx) {
    const values = parseFieldLines(ctx.config.fields || 'Vrijednost = value').map((f, i) => ({ label: f.label, unit: f.unit, value: Math.round(wave(ctx.tick + i * 5, 50, 20)) }));
    return { status: 'up', data: { values }, metrics: Object.fromEntries(values.map((v) => [slug(v.label), v.value])) };
  },
  widgets: [{ id: 'values', name: 'HTTP/JSON vrijednosti', description: 'Proizvoljne vrijednosti iz JSON API-ja', sizes: ['S', 'M', 'L'], defaultSize: 'S' }],
};
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');

// ---------------- Prometheus ----------------
interface PromCfg { url: string; bearer?: string; queries: string }
export const prometheus: Plugin<PromCfg, { values: GenericValue[] }> = {
  id: 'prometheus', name: 'Prometheus', icon: 'prometheus', category: 'generic',
  description: 'PromQL upiti kao statistika (npr. temperatura s node_exportera: node_hwmon_temp_celsius).',
  defaultInterval: 30,
  fields: [
    { key: 'url', label: 'Prometheus URL', type: 'url', required: true, placeholder: 'http://prometheus:9090' },
    { key: 'bearer', label: 'Bearer token (opcionalno)', type: 'secret' },
    { key: 'queries', label: 'Upiti', type: 'text', required: true, placeholder: 'Temp CPU = max(node_hwmon_temp_celsius) | °C', help: 'Jedan po retku: Naziv = PromQL | jedinica' },
    ...tlsFields,
  ],
  http: (c) => ({ headers: c.bearer ? { Authorization: `Bearer ${c.bearer}` } : ({} as Record<string, string>) }),
  async collect({ http, config: c }) {
    const values: GenericValue[] = [];
    for (const f of parseFieldLines(c.queries)) {
      const r = await http.get<any>('/api/v1/query', { query: { query: f.path } });
      const v = r?.data?.result?.[0]?.value?.[1];
      values.push({ label: f.label, unit: f.unit, value: v === undefined ? null : Math.round(Number(v) * 100) / 100 });
    }
    const metrics = Object.fromEntries(values.filter((v) => typeof v.value === 'number').map((v) => [slug(v.label), v.value as number]));
    return { status: 'up', summary: values.slice(0, 2).map((v) => `${v.label}: ${v.value}${v.unit}`).join(' · '), data: { values }, metrics };
  },
  mock(ctx) {
    const values = parseFieldLines(ctx.config.queries || 'Temp CPU = x | °C').map((f, i) => ({ label: f.label, unit: f.unit, value: Math.round(wave(ctx.tick + i * 3, 48, 8) * 10) / 10 }));
    return { status: 'up', data: { values }, metrics: Object.fromEntries(values.map((v) => [slug(v.label), v.value])) };
  },
  widgets: [{ id: 'values', name: 'Prometheus vrijednosti', description: 'Rezultati PromQL upita', sizes: ['S', 'M', 'L'], defaultSize: 'S' }],
};

// ---------------- Docker ----------------
interface DockerCfg { url: string }
export interface DockerData { containers: { id: string; name: string; image: string; state: string; status: string; health?: string }[] }

const dockerAgents = new Map<string, Agent>();
async function dockerGet(base: string, path: string, method = 'GET') {
  let url = base, dispatcher: Agent | undefined;
  if (base.startsWith('unix://')) {
    const socketPath = base.slice(7);
    if (!dockerAgents.has(socketPath)) dockerAgents.set(socketPath, new Agent({ connect: { socketPath } }));
    dispatcher = dockerAgents.get(socketPath);
    url = 'http://docker';
  }
  const r = await fetch(url.replace(/\/+$/, '') + path, { method, dispatcher, signal: AbortSignal.timeout(10_000) } as any);
  if (r.status >= 400) throw new Error(`Docker HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

function dockerFinish(d: DockerData) {
  const bad = d.containers.filter((c) => c.state !== 'running' || c.health === 'unhealthy');
  return {
    status: bad.some((c) => c.health === 'unhealthy' || c.state === 'restarting' || c.state === 'dead') ? ('degraded' as const) : ('up' as const),
    summary: `${d.containers.filter((c) => c.state === 'running').length}/${d.containers.length} kontejnera radi`,
    data: d,
    metrics: { running: d.containers.filter((c) => c.state === 'running').length, total: d.containers.length },
    alerts: d.containers.filter((c) => c.health === 'unhealthy').map((c) => ({ key: `unhealthy:${c.name}`, severity: 'warning' as const, message: `Kontejner ${c.name} je unhealthy` })),
  };
}
export const docker: Plugin<DockerCfg, DockerData> = {
  id: 'docker', name: 'Docker', icon: 'docker', category: 'generic',
  description: 'Kontejneri preko Docker API-ja (preporuka: docker-socket-proxy samo za čitanje + POST za restart).',
  defaultInterval: 30,
  fields: [{ key: 'url', label: 'Docker endpoint', type: 'string', required: true, default: 'http://docker-socket-proxy:2375', placeholder: 'unix:///var/run/docker.sock ili http://host:2375' }],
  async collect({ config: c }) {
    const list = await dockerGet(c.url, '/containers/json?all=1');
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
      id: 'restart', label: 'Restartaj kontejner', danger: true, params: [{ key: 'id', label: 'Container ID', type: 'string', required: true }],
      run: async ({ config: c }, p) => { if (!/^[\w.-]+$/.test(String(p.id))) throw new Error('Neispravan ID'); await dockerGet(c.url, `/containers/${p.id}/restart`, 'POST'); return 'Kontejner restartan'; },
    },
  ],
  widgets: [{ id: 'containers', name: 'Docker kontejneri', description: 'Status svih kontejnera', sizes: ['S', 'M', 'L'], defaultSize: 'M' }],
};
