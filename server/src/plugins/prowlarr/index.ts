import type { Plugin, PluginAlert } from '../types.js';
import { apiKeyField, tlsFields, urlField } from '../types.js';

interface Cfg { url: string; apiKey: string }
export interface ProwlarrIndexer {
  id: number; name: string; enabled: boolean; protocol: string; failing: boolean; disabledTill?: string | null;
  queries: number; grabs: number; failedQueries: number; avgResponse: number;
}
export interface ProwlarrData { version?: string; indexers: ProwlarrIndexer[]; totals: { queries: number; grabs: number; failed: number }; health: { type: string; message: string; source: string }[] }

function finish(d: ProwlarrData) {
  const alerts: PluginAlert[] = d.indexers.filter((i) => i.enabled && i.failing).map((i) => ({ key: `indexer:${i.id}`, severity: 'warning', message: `Indexer ${i.name} ne radi` }));
  for (const h of d.health.filter((h) => h.type === 'error')) alerts.push({ key: `health:${h.source}`, severity: 'critical', message: h.message });
  const enabled = d.indexers.filter((i) => i.enabled);
  const failing = enabled.filter((i) => i.failing).length;
  return {
    status: failing && failing === enabled.length ? ('degraded' as const) : ('up' as const),
    summary: `${enabled.length - failing}/${enabled.length} indexera radi`,
    data: d, alerts,
    metrics: { indexers_ok: enabled.length - failing, indexers_failing: failing, queries: d.totals.queries, grabs: d.totals.grabs },
  };
}

export const prowlarr: Plugin<Cfg, ProwlarrData> = {
  id: 'prowlarr', name: 'Prowlarr', icon: 'prowlarr', category: 'media',
  description: 'Stanje indexera, neuspjeli indexeri, broj upita i grabova.',
  docsUrl: 'https://prowlarr.com/docs/api/',
  defaultInterval: 60,
  fields: [urlField('http://192.168.1.20:9696'), apiKeyField(), ...tlsFields],
  http: (c) => ({ headers: { 'X-Api-Key': c.apiKey } }),
  async collect({ http }) {
    const [status, indexers, statuses, stats, health] = await Promise.all([
      http.get('/api/v1/system/status'),
      http.get<any[]>('/api/v1/indexer'),
      http.get<any[]>('/api/v1/indexerstatus'),
      http.get<any>('/api/v1/indexerstats').catch(() => ({ indexers: [] })),
      http.get<any[]>('/api/v1/health'),
    ]);
    const st = new Map(statuses.map((s) => [s.indexerId, s]));
    const sx = new Map((stats.indexers ?? []).map((s: any) => [s.indexerId, s]));
    const list: ProwlarrIndexer[] = indexers.map((i) => {
      const s: any = st.get(i.id);
      const x: any = sx.get(i.id) ?? {};
      const disabledTill = s?.disabledTill ?? null;
      return {
        id: i.id, name: i.name, enabled: !!i.enable, protocol: i.protocol,
        failing: !!(disabledTill && new Date(disabledTill).getTime() > Date.now()), disabledTill,
        queries: x.numberOfQueries ?? 0, grabs: x.numberOfGrabs ?? 0, failedQueries: x.numberOfFailedQueries ?? 0, avgResponse: x.averageResponseTime ?? 0,
      };
    });
    return finish({
      version: status.version, indexers: list,
      totals: { queries: list.reduce((a, b) => a + b.queries, 0), grabs: list.reduce((a, b) => a + b.grabs, 0), failed: list.reduce((a, b) => a + b.failedQueries, 0) },
      health: health.map((h) => ({ type: h.type, message: h.message, source: h.source })),
    });
  },
  mock(ctx) {
    const names = ['1337x', 'TorrentGalaxy', 'Nyaa', 'IPTorrents', 'EZTV', 'YTS', 'TheRARBG', 'LimeTorrents'];
    const indexers = names.map((name, i) => ({
      id: i + 1, name, enabled: i !== 7, protocol: 'torrent', failing: i === 0 && ctx.tick % 40 < 8, disabledTill: null,
      queries: 1200 + i * 310 + ctx.tick * 3, grabs: 80 + i * 17, failedQueries: 4 + i, avgResponse: 300 + i * 90,
    }));
    return finish({
      version: '2.1.5.5216', indexers,
      totals: { queries: indexers.reduce((a, b) => a + b.queries, 0), grabs: indexers.reduce((a, b) => a + b.grabs, 0), failed: indexers.reduce((a, b) => a + b.failedQueries, 0) },
      health: [],
    });
  },
  actions: [
    { id: 'testAll', label: 'Testiraj sve indexere', run: async ({ http }) => { await http.post('/api/v1/indexer/testall', {}); return 'Test pokrenut'; } },
  ],
  widgets: [
    { id: 'indexers', name: 'Prowlarr indexeri', description: 'Stanje i statistika indexera', sizes: ['S', 'M', 'L'], defaultSize: 'M' },
  ],
};
