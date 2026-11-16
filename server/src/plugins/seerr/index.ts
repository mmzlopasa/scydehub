import type { Plugin, PluginContext } from '../types.js';
import { apiKeyField, tlsFields, urlField } from '../types.js';

interface Cfg { url: string; apiKey: string }
export interface SeerrRequest {
  id: number; type: 'movie' | 'tv'; status: number; statusLabel: string; title: string; year?: string; poster?: string | null;
  requestedBy: string; createdAt: string; seasons?: number[]; mediaStatus?: number;
}
export interface SeerrData { version?: string; counts: Record<string, number>; pending: SeerrRequest[]; recent: SeerrRequest[] }

const REQ_STATUS: Record<number, string> = { 1: 'Na čekanju', 2: 'Odobreno', 3: 'Odbijeno', 4: 'Neuspjelo', 5: 'Završeno' };

async function titleFor(ctx: PluginContext<Cfg>, type: string, tmdbId: number) {
  const cache: Record<string, any> = (ctx.scratch.titles ??= {});
  const k = `${type}:${tmdbId}`;
  if (!cache[k]) {
    const r = await ctx.http.get<any>(`/api/v1/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}`).catch(() => null);
    cache[k] = r
      ? { title: r.title ?? r.name ?? `#${tmdbId}`, year: String(r.releaseDate ?? r.firstAirDate ?? '').slice(0, 4), poster: r.posterPath ? `https://image.tmdb.org/t/p/w154${r.posterPath}` : null }
      : { title: `TMDB ${tmdbId}`, year: '', poster: null };
  }
  return cache[k];
}

async function mapReq(ctx: PluginContext<Cfg>, r: any): Promise<SeerrRequest> {
  const t = await titleFor(ctx, r.type, r.media?.tmdbId);
  return {
    id: r.id, type: r.type, status: r.status, statusLabel: REQ_STATUS[r.status] ?? String(r.status), title: t.title, year: t.year, poster: t.poster,
    requestedBy: r.requestedBy?.displayName ?? r.requestedBy?.username ?? r.requestedBy?.email ?? '?', createdAt: r.createdAt,
    seasons: r.seasons?.map((s: any) => s.seasonNumber), mediaStatus: r.media?.status,
  };
}

export const seerr: Plugin<Cfg, SeerrData> = {
  id: 'seerr', name: 'Seerr', icon: 'jellyseerr', category: 'media',
  description: 'Zahtjevi za filmove i serije: na čekanju, odobreni, u obradi, dostupni. Odobri/odbij iz dashboarda.',
  docsUrl: 'https://docs.seerr.dev/',
  defaultInterval: 60,
  fields: [urlField('http://192.168.1.20:5055'), apiKeyField(), ...tlsFields],
  http: (c) => ({ headers: { 'X-Api-Key': c.apiKey } }),
  async collect(ctx) {
    const { http } = ctx;
    const [status, counts, pending, recent] = await Promise.all([
      http.get('/api/v1/status').catch(() => ({})),
      http.get<Record<string, number>>('/api/v1/request/count'),
      http.get<any>('/api/v1/request', { query: { take: 20, skip: 0, filter: 'pending', sort: 'added' } }),
      http.get<any>('/api/v1/request', { query: { take: 10, skip: 0, filter: 'all', sort: 'added' } }),
    ]);
    const p = await Promise.all((pending.results ?? []).map((r: any) => mapReq(ctx, r)));
    const rc = await Promise.all((recent.results ?? []).map((r: any) => mapReq(ctx, r)));
    return {
      status: 'up', summary: `${counts.pending ?? 0} na čekanju`,
      data: { version: (status as any).version, counts, pending: p, recent: rc },
      metrics: { pending: counts.pending ?? 0, processing: counts.processing ?? 0, available: counts.available ?? 0 },
    };
  },
  mock(ctx) {
    const items: [string, 'movie' | 'tv', string, number][] = [
      ['Interstellar', 'movie', '2014', 1], ['The Bear', 'tv', '2022', 1], ['Arcane', 'tv', '2021', 2], ['Past Lives', 'movie', '2023', 5], ['Shōgun', 'tv', '2024', 2],
    ];
    const reqs = items.map(([title, type, year, status], i) => ({
      id: 40 + i, type, status, statusLabel: REQ_STATUS[status], title, year, poster: null, requestedBy: ['Mislav', 'Ana', 'Ivan'][i % 3],
      createdAt: new Date(Date.now() - (i + 1) * 3_600_000 * 5).toISOString(), seasons: type === 'tv' ? [1] : undefined,
    }));
    const pending = (ctx.scratch.mockHandled ? reqs.filter((r) => !ctx.scratch.mockHandled.includes(r.id)) : reqs).filter((r) => r.status === 1);
    return {
      status: 'up', summary: `${pending.length} na čekanju`,
      data: { version: '3.0.0', counts: { total: 312, movie: 201, tv: 111, pending: pending.length, approved: 290, declined: 6, processing: 4, available: 280 }, pending, recent: reqs },
      metrics: { pending: pending.length, processing: 4, available: 280 },
    };
  },
  actions: [
    {
      id: 'approve', label: 'Odobri zahtjev', params: [{ key: 'id', label: 'Request ID', type: 'number', required: true }],
      run: async ({ http }, p) => { await http.post(`/api/v1/request/${Number(p.id)}/approve`, {}); return `Zahtjev ${p.id} odobren`; },
      mock: (ctx, p) => { (ctx.scratch.mockHandled ??= []).push(Number(p.id)); return `Zahtjev ${p.id} odobren (mock)`; },
    },
    {
      id: 'decline', label: 'Odbij zahtjev', danger: true, params: [{ key: 'id', label: 'Request ID', type: 'number', required: true }],
      run: async ({ http }, p) => { await http.post(`/api/v1/request/${Number(p.id)}/decline`, {}); return `Zahtjev ${p.id} odbijen`; },
      mock: (ctx, p) => { (ctx.scratch.mockHandled ??= []).push(Number(p.id)); return `Zahtjev ${p.id} odbijen (mock)`; },
    },
  ],
  widgets: [
    { id: 'requests', name: 'Seerr zahtjevi', description: 'Zahtjevi na čekanju s odobri/odbij', sizes: ['S', 'M', 'L', 'XL'], defaultSize: 'M' },
  ],
};
