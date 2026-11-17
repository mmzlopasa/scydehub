import type { Plugin } from '../types.js';
import { tlsFields, urlField } from '../types.js';

/**
 * Streamero is a custom app. SCYDE Hub expects GET {statsPath} (default /api/stats) to return
 * the contract below — see docs/integrations/streamero.md.
 */
interface Cfg { url: string; apiKey?: string; apiKeyHeader?: string; statsPath?: string }
export interface StreameroData {
  version?: string;
  streams: { user: string; title: string; subtitle?: string; progress?: number; transcoding?: boolean; device?: string; quality?: string; bandwidth?: number }[];
  library: { movies?: number; shows?: number; episodes?: number; sizeBytes?: number };
  recentlyAdded: { title: string; subtitle?: string; addedAt?: string; poster?: string }[];
}

function finish(d: StreameroData) {
  const tc = d.streams.filter((s) => s.transcoding).length;
  return {
    status: 'up' as const,
    summary: d.streams.length ? `Active streams: ${d.streams.length}${tc ? ` (${tc} transcoding)` : ''}` : 'Nobody is watching',
    data: d,
    metrics: { streams: d.streams.length, transcodes: tc, bandwidth: d.streams.reduce((a, s) => a + (s.bandwidth ?? 0), 0) },
  };
}

export const streamero: Plugin<Cfg, StreameroData> = {
  id: 'streamero', name: 'Streamero', icon: 'jellyfin', category: 'media',
  description: 'Active streams, who is watching what, transcodes, library size, recently added.',
  defaultInterval: 10,
  fields: [
    urlField('http://192.168.1.21:3000'),
    { key: 'apiKey', label: 'API key', type: 'secret' },
    { key: 'apiKeyHeader', label: 'API key header', type: 'string', default: 'X-Api-Key' },
    { key: 'statsPath', label: 'Stats endpoint', type: 'string', default: '/api/stats' },
    ...tlsFields,
  ],
  http: (c) => ({ headers: c.apiKey ? { [c.apiKeyHeader || 'X-Api-Key']: c.apiKey } : {} }),
  async collect({ http, config: c }) {
    const r = await http.get<any>(c.statsPath || '/api/stats');
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('The stats endpoint did not return a JSON object');
    const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
    return finish({
      version: r.version == null ? undefined : String(r.version).slice(0, 40),
      streams: arr(r.streams).map((s: any) => ({ ...s, user: String(s.user ?? '?'), title: String(s.title ?? '?'), progress: Number(s.progress) || 0, transcoding: !!s.transcoding, bandwidth: Number(s.bandwidth) || 0 })),
      library: r.library && typeof r.library === 'object' ? r.library : {}, recentlyAdded: arr(r.recentlyAdded).slice(0, 12),
    });
  },
  mock(ctx) {
    const t = ctx.tick;
    const streams = [
      { user: 'Mislav', title: 'Dune: Part Two', progress: (t * 0.4) % 100, transcoding: false, device: 'Android TV', quality: '4K HDR', bandwidth: 42e6 },
      { user: 'Ana', title: 'Severance', subtitle: 'S02E05 · Trojan’s Horse', progress: (t * 0.9 + 30) % 100, transcoding: true, device: 'iPad', quality: '1080p → 720p', bandwidth: 6e6 },
      { user: 'Ivan', title: 'The Bear', subtitle: 'S03E02 · Next', progress: (t * 0.7 + 60) % 100, transcoding: false, device: 'Chrome', quality: '1080p', bandwidth: 9e6 },
    ].slice(0, t % 30 < 10 ? 1 : t % 30 < 20 ? 2 : 3).map((s) => ({ ...s, progress: Math.round(s.progress) }));
    return finish({
      version: '2.4.0', streams, library: { movies: 1184, shows: 214, episodes: 9_842, sizeBytes: 14.2e12 },
      recentlyAdded: [
        { title: 'Conclave', subtitle: '2024', addedAt: new Date(Date.now() - 3 * 3600_000).toISOString() },
        { title: 'Severance', subtitle: 'S02E07', addedAt: new Date(Date.now() - 9 * 3600_000).toISOString() },
        { title: 'The Wild Robot', subtitle: '2024', addedAt: new Date(Date.now() - 26 * 3600_000).toISOString() },
        { title: 'Andor', subtitle: 'S02E05', addedAt: new Date(Date.now() - 50 * 3600_000).toISOString() },
      ],
    });
  },
  widgets: [
    { id: 'streams', name: 'Streamero streams', description: 'Who is watching what, live', sizes: ['S', 'M', 'L'], defaultSize: 'M' },
    { id: 'library', name: 'Streamero library', description: 'Library size and recently added', sizes: ['M', 'L', 'XL'], defaultSize: 'M' },
  ],
};
