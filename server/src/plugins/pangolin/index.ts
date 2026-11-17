import type { Plugin } from '../types.js';
import { tlsFields } from '../types.js';

interface Cfg { url: string; apiKey: string; orgId: string }
export interface PangolinData {
  sites: { id: number; name: string; type: string; online: boolean | null; mbIn: number; mbOut: number; version?: string; resources?: number }[];
  resources: { id: number; name: string; domain?: string; enabled: boolean; ssl: boolean; health?: string; sitesOnline: number; sitesTotal: number }[];
}

function finish(d: PangolinData) {
  const remote = d.sites.filter((s) => s.online !== null);
  const off = remote.filter((s) => !s.online);
  return {
    status: off.length && off.length === remote.length ? ('down' as const) : off.length ? ('degraded' as const) : ('up' as const),
    summary: `${remote.length - off.length}/${remote.length} sites online · ${d.resources.length} resources`,
    data: d,
    metrics: { sites_online: remote.length - off.length, sites_offline: off.length, resources: d.resources.length },
    alerts: off.map((s) => ({ key: `site:${s.id}`, severity: 'critical' as const, message: `Pangolin site ${s.name} is offline` })),
  };
}

export const pangolin: Plugin<Cfg, PangolinData> = {
  id: 'pangolin', name: 'Pangolin', icon: 'pangolin', category: 'network',
  description: 'Sites online/offline, resources and tunnel status (Integration API).',
  docsUrl: 'https://docs.pangolin.net/manage/integration-api',
  defaultInterval: 30,
  fields: [
    { key: 'url', label: 'Integration API URL', type: 'url', required: true, placeholder: 'http://pangolin:3003', help: 'Not the dashboard address: the Integration API is a separate server on port 3003. Turn it on with flags.enable_integration_api: true in config/config.yml and give it its own hostname in Traefik (e.g. https://api.example.com → http://pangolin:3003). <URL>/v1/docs must open.' },
    { key: 'apiKey', label: 'API key (id.secret)', type: 'secret', required: true, help: 'Organization → API Keys. Permissions needed: Site → List Sites and Resource → List Resources.' },
    { key: 'orgId', label: 'Org ID', type: 'string', required: true },
    ...tlsFields,
  ],
  http: (c) => ({ headers: { Authorization: `Bearer ${c.apiKey}` } }),
  async collect({ http, config: c }) {
    const org = encodeURIComponent(c.orgId);
    const explain = (what: string) => (e: any) => {
      if (e?.status === 401) throw new Error('Pangolin rejected the API key (HTTP 401) — check the key (id.secret)');
      if (e?.status === 403) throw new Error(`The API key may not ${what} (HTTP 403) — add the permission "${what === 'list sites' ? 'List Sites' : 'List Resources'}" to the key and check the Org ID`);
      if (e?.status === 404 || /Expected JSON/.test(String(e?.message))) throw new Error('This address is not the Pangolin Integration API — it runs on its own port (3003) once flags.enable_integration_api is on; <URL>/v1/docs must open');
      throw e;
    };
    const [sites, resources] = await Promise.all([
      http.get<any>(`/v1/org/${org}/sites`, { query: { pageSize: 500 } }).catch(explain('list sites')),
      http.get<any>(`/v1/org/${org}/resources`, { query: { pageSize: 500 } }).catch(explain('list resources')),
    ]);
    if (!Array.isArray(sites?.data?.sites)) throw new Error('Unexpected answer from Pangolin — is this the Integration API URL?');
    return finish({
      sites: (sites.data?.sites ?? []).map((s: any) => ({
        id: s.siteId, name: s.name, type: s.type, online: s.type === 'local' || s.online === undefined ? null : !!s.online,
        mbIn: Number(s.megabytesIn) || 0, mbOut: Number(s.megabytesOut) || 0, version: s.newtVersion, resources: s.resourceCount,
      })),
      resources: (resources.data?.resources ?? []).map((r: any) => ({
        id: r.resourceId, name: r.name, domain: r.fullDomain, enabled: !!r.enabled, ssl: !!r.ssl, health: r.health,
        sitesOnline: (r.sites ?? []).filter((s: any) => s.online).length, sitesTotal: (r.sites ?? []).length,
      })),
    });
  },
  mock() {
    return finish({
      sites: [
        { id: 1, name: 'homelab', type: 'newt', online: true, mbIn: 182_331, mbOut: 921_004, version: '1.6.0', resources: 9 },
        { id: 2, name: 'vikendica', type: 'newt', online: true, mbIn: 1_220, mbOut: 4_310, version: '1.6.0', resources: 2 },
        { id: 3, name: 'vps-local', type: 'local', online: null, mbIn: 0, mbOut: 0, resources: 1 },
      ],
      resources: ['streamero', 'mediarr', 'seerr', 'vault', 'hub', 'immich'].map((n, i) => ({ id: i + 1, name: n, domain: `${n}.scyde.net`, enabled: true, ssl: true, health: 'healthy', sitesOnline: 1, sitesTotal: 1 })),
    });
  },
  widgets: [{ id: 'sites', name: 'Pangolin', description: 'Sites, tunnels and resources', sizes: ['S', 'M', 'L'], defaultSize: 'M' }],
};
