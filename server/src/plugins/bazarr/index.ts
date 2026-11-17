import type { Plugin } from '../types.js';
import { apiKeyField, tlsFields, urlField } from '../types.js';

interface Cfg { url: string; apiKey: string }
export interface BazarrData {
  version?: string; wantedEpisodes: number; wantedMovies: number; throttledProviders: number;
  providers: { name: string; status: string; retry?: string }[]; health: { object: string; issue: string }[];
  history: { title: string; subtitle?: string; language?: string; provider?: string; timestamp?: string; action?: number }[];
}

function finish(d: BazarrData) {
  const alerts = [
    ...d.health.map((h) => ({ key: `health:${h.object}`, severity: 'warning' as const, message: `${h.object}: ${h.issue}` })),
    ...d.providers.filter((p) => p.status && p.status !== 'Good').map((p) => ({ key: `provider:${p.name}`, severity: 'info' as const, message: `Provider ${p.name}: ${p.status}` })),
  ];
  return {
    status: d.health.length ? ('degraded' as const) : ('up' as const),
    summary: `${d.wantedEpisodes + d.wantedMovies} subtitles missing`,
    data: d, alerts,
    metrics: { wanted_episodes: d.wantedEpisodes, wanted_movies: d.wantedMovies, throttled: d.throttledProviders },
  };
}

export const bazarr: Plugin<Cfg, BazarrData> = {
  id: 'bazarr', name: 'Bazarr', icon: 'bazarr', category: 'media',
  description: 'Missing subtitles, recent downloads, provider status.',
  docsUrl: 'https://wiki.bazarr.media/',
  defaultInterval: 120,
  fields: [urlField('http://192.168.1.20:6767'), apiKeyField(), ...tlsFields],
  http: (c) => ({ headers: { 'X-API-KEY': c.apiKey } }),
  async collect({ http }) {
    const [badges, status, providers, health, eh, mh] = await Promise.all([
      http.get<any>('/api/badges'),
      http.get<any>('/api/system/status').catch(() => ({ data: {} })),
      http.get<any>('/api/providers').catch(() => ({ data: [] })),
      http.get<any>('/api/system/health').catch(() => ({ data: [] })),
      http.get<any>('/api/episodes/history', { query: { start: 0, length: 8 } }).catch(() => ({ data: [] })),
      http.get<any>('/api/movies/history', { query: { start: 0, length: 8 } }).catch(() => ({ data: [] })),
    ]);
    if (!badges || typeof badges !== 'object' || !('episodes' in badges || 'movies' in badges)) throw new Error('Unexpected answer from Bazarr — check the URL, base path and API key');
    const history = [
      ...(eh.data ?? []).map((h: any) => ({ title: h.seriesTitle, subtitle: `${h.episode_number ?? ''} ${h.episodeTitle ?? ''}`.trim(), language: h.language?.name ?? h.language, provider: h.provider, timestamp: h.parsed_timestamp ?? h.timestamp, action: h.action })),
      ...(mh.data ?? []).map((h: any) => ({ title: h.title, language: h.language?.name ?? h.language, provider: h.provider, timestamp: h.parsed_timestamp ?? h.timestamp, action: h.action })),
    ].sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0)).slice(0, 12); // newest first across episodes and movies
    return finish({
      version: status.data?.bazarr_version, wantedEpisodes: Number(badges.episodes) || 0, wantedMovies: Number(badges.movies) || 0,
      throttledProviders: Number(badges.providers) || 0, providers: (providers.data ?? []).map((p: any) => ({ name: p.name, status: p.status, retry: p.retry })),
      health: health.data ?? [], history,
    });
  },
  mock() {
    return finish({
      version: '1.5.3', wantedEpisodes: 23, wantedMovies: 7, throttledProviders: 1,
      providers: [{ name: 'opensubtitlescom', status: 'Good' }, { name: 'podnapisi', status: 'Good' }, { name: 'titlovi', status: 'TooManyRequests', retry: 'in 2 h' }],
      health: [],
      history: [
        { title: 'Severance', subtitle: '2x07 Chikhai Bardo', language: 'Croatian', provider: 'opensubtitlescom', timestamp: '2 h' },
        { title: 'Dune: Part Two', language: 'English', provider: 'podnapisi', timestamp: '5 h' },
        { title: 'Andor', subtitle: '2x05 Make It Stop', language: 'Croatian', provider: 'titlovi', timestamp: '1 d' },
      ],
    });
  },
  actions: [
    { id: 'resetProviders', label: 'Reset provider throttling', run: async ({ http }) => { await http.request('/api/providers', { method: 'POST', form: { action: 'reset' } }); return 'Providers reset'; } },
  ],
  widgets: [{ id: 'subtitles', name: 'Bazarr subtitles', description: 'Missing, providers, recent downloads', sizes: ['S', 'M', 'L'], defaultSize: 'S' }],
};
