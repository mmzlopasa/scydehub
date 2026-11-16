import type { Plugin, PluginAlert, PluginContext } from '../types.js';
import { apiKeyField, tlsFields, urlField, jitter } from '../types.js';

interface Cfg { url: string; apiKey: string; calendarDays?: number; tlsInsecure?: boolean; tlsFingerprint?: string }

export interface ArrQueueItem {
  id: number; title: string; subtitle?: string; size: number; sizeleft: number; progress: number; status: string;
  state?: string; trackedStatus?: string; timeleft?: string; eta?: string; client?: string; protocol?: string; downloadId?: string;
}
export interface ArrCalendarItem { id: number; title: string; subtitle?: string; date: string; hasFile: boolean; kind?: string }
export interface ArrData {
  version?: string; queue: ArrQueueItem[]; queueTotal: number; calendar: ArrCalendarItem[];
  missing: number; library: number; health: { type: string; message: string; source: string }[];
  disks: { path: string; label?: string; free: number; total: number }[];
}

type Kind = 'radarr' | 'sonarr';

function mapQueue(kind: Kind, r: any): ArrQueueItem {
  const size = Number(r.size) || 0;
  const left = Number(r.sizeleft) || 0;
  let title = r.title, subtitle: string | undefined;
  if (kind === 'radarr' && r.movie) { title = `${r.movie.title}${r.movie.year ? ` (${r.movie.year})` : ''}`; subtitle = r.quality?.quality?.name; }
  if (kind === 'sonarr' && r.series) {
    title = r.series.title;
    subtitle = r.episode ? `S${String(r.episode.seasonNumber).padStart(2, '0')}E${String(r.episode.episodeNumber).padStart(2, '0')} · ${r.episode.title ?? ''}` : r.title;
  }
  return {
    id: r.id, title, subtitle, size, sizeleft: left, progress: size ? Math.round(((size - left) / size) * 1000) / 10 : 0,
    status: r.status, state: r.trackedDownloadState, trackedStatus: r.trackedDownloadStatus, timeleft: r.timeleft,
    eta: r.estimatedCompletionTime, client: r.downloadClient, protocol: r.protocol, downloadId: r.downloadId,
  };
}

function mapCalendar(kind: Kind, r: any): ArrCalendarItem {
  if (kind === 'radarr') {
    const date = r.digitalRelease ?? r.physicalRelease ?? r.inCinemas ?? r.releaseDate;
    const kindLabel = r.digitalRelease ? 'Digitalno' : r.physicalRelease ? 'Fizičko' : 'Kino';
    return { id: r.id, title: r.title, subtitle: r.year ? String(r.year) : undefined, date, hasFile: !!r.hasFile, kind: kindLabel };
  }
  return {
    id: r.id, title: r.series?.title ?? r.title,
    subtitle: `S${String(r.seasonNumber).padStart(2, '0')}E${String(r.episodeNumber).padStart(2, '0')} · ${r.title ?? ''}`,
    date: r.airDateUtc ?? r.airDate, hasFile: !!r.hasFile,
  };
}

function finish(d: ArrData) {
  const alerts: PluginAlert[] = d.health
    .filter((h) => h.type === 'error' || h.type === 'warning')
    .map((h) => ({ key: `health:${h.source}`, severity: h.type === 'error' ? 'critical' : 'warning', message: h.message }));
  const errorsInQueue = d.queue.filter((q) => q.trackedStatus === 'warning' || q.trackedStatus === 'error').length;
  return {
    status: alerts.some((a) => a.severity === 'critical') ? ('degraded' as const) : ('up' as const),
    summary: `${d.queueTotal} u redu · ${d.missing} nedostaje`,
    data: d,
    metrics: { queue: d.queueTotal, missing: d.missing, library: d.library, queue_errors: errorsInQueue },
    alerts,
  };
}

function makeArr(kind: Kind): Plugin<Cfg, ArrData> {
  const isRadarr = kind === 'radarr';
  async function collect(ctx: PluginContext<Cfg>) {
    const { http, scratch } = ctx;
    const days = Number(ctx.config.calendarDays) || 14;
    const start = new Date(Date.now() - 86400_000).toISOString();
    const end = new Date(Date.now() + days * 86400_000).toISOString();
    const [status, queue, calendar, health, disks] = await Promise.all([
      http.get('/api/v3/system/status'),
      http.get('/api/v3/queue', { query: { page: 1, pageSize: 50, ...(isRadarr ? { includeMovie: true } : { includeSeries: true, includeEpisode: true }) } }),
      http.get<any[]>('/api/v3/calendar', { query: { start, end, ...(isRadarr ? {} : { includeSeries: true }) } }),
      http.get<any[]>('/api/v3/health'),
      http.get<any[]>('/api/v3/diskspace'),
    ]);
    // library & missing counts are heavier — refresh every 10 polls
    if (ctx.tick % 10 === 1 || scratch.library === undefined) {
      const missing = await http.get<any>('/api/v3/wanted/missing', { query: { page: 1, pageSize: 1, monitored: true } }).then((r) => Number(r.totalRecords) || 0).catch(() => undefined);
      const items = await http.get<any[]>(isRadarr ? '/api/v3/movie' : '/api/v3/series');
      scratch.library = items.length;
      scratch.missing = missing ?? (isRadarr ? items.filter((m) => m.monitored && !m.hasFile && m.isAvailable).length : 0);
    }
    return finish({
      version: status.version,
      queue: (queue.records ?? []).map((r: any) => mapQueue(kind, r)),
      queueTotal: Number(queue.totalRecords) || 0,
      calendar: calendar.map((r) => mapCalendar(kind, r)).filter((x) => x.date).sort((a, b) => a.date.localeCompare(b.date)),
      missing: scratch.missing, library: scratch.library,
      health: health.map((h) => ({ type: h.type, message: h.message, source: h.source })),
      disks: disks.map((d) => ({ path: d.path, label: d.label, free: d.freeSpace, total: d.totalSpace })),
    });
  }

  const mockTitles = isRadarr
    ? [['Dune: Part Two (2024)', 'Bluray-2160p'], ['Oppenheimer (2023)', 'WEBDL-1080p'], ['The Wild Robot (2024)', 'WEBDL-2160p'], ['Conclave (2024)', 'Bluray-1080p']]
    : [['Severance', 'S02E07 · Chikhai Bardo'], ['The Last of Us', 'S02E03 · The Path'], ['Andor', 'S02E05 · Make It Stop'], ['Slow Horses', 'S05E02 · Tall Tales']];

  return {
    id: kind, name: isRadarr ? 'Radarr' : 'Sonarr', icon: kind, category: 'media',
    description: isRadarr ? 'Filmovi: queue s progresom, kalendar izlazaka, missing, health, disk.' : 'Serije: queue s progresom, kalendar epizoda, missing, health, disk.',
    docsUrl: isRadarr ? 'https://radarr.video/docs/api/' : 'https://sonarr.tv/docs/api/',
    defaultInterval: 30,
    fields: [urlField(isRadarr ? 'http://192.168.1.20:7878' : 'http://192.168.1.20:8989'), apiKeyField(), { key: 'calendarDays', label: 'Kalendar: dana unaprijed', type: 'number', default: 14 }, ...tlsFields],
    http: (c) => ({ headers: { 'X-Api-Key': c.apiKey } }),
    collect,
    mock(ctx) {
      const t = ctx.tick;
      const queue: ArrQueueItem[] = mockTitles.map(([title, sub], i) => {
        const size = (isRadarr ? 18e9 : 2.4e9) * (1 + i * 0.3);
        const progress = Math.min(100, ((t * (3 + i * 2)) % 120) + i * 5);
        return {
          id: i + 1, title, subtitle: sub, size, sizeleft: size * (1 - Math.min(progress, 100) / 100), progress: Math.round(Math.min(progress, 100) * 10) / 10,
          status: progress >= 100 ? 'completed' : i === 3 ? 'queued' : 'downloading', state: progress >= 100 ? 'importPending' : 'downloading',
          trackedStatus: 'ok', timeleft: progress >= 100 ? '00:00:00' : `00:${String(30 - (t % 30)).padStart(2, '0')}:00`, client: 'qBittorrent', protocol: 'torrent',
        };
      });
      const day = 86400_000;
      const cal: ArrCalendarItem[] = (isRadarr
        ? [['Mickey 17', '2025', 1, 'Digitalno'], ['Sinners', '2025', 3, 'Digitalno'], ['Thunderbolts*', '2025', 6, 'Fizičko'], ['Superman', '2025', 10, 'Kino']]
        : [['Severance', 'S02E08 · Sweet Vitriol', 0], ['The Last of Us', 'S02E04 · Day One', 2], ['Andor', 'S02E06 · What a Festive Evening', 4], ['Slow Horses', 'S05E03 · Hard Lines', 7]]
      ).map((x: any, i) => ({ id: 100 + i, title: x[0], subtitle: x[1], date: new Date(Date.now() + x[2] * day).toISOString(), hasFile: x[2] === 0, kind: x[3] }));
      return finish({
        version: isRadarr ? '6.0.4.10291' : '4.0.16.2944',
        queue, queueTotal: queue.length, calendar: cal, missing: isRadarr ? 12 : 37, library: isRadarr ? 1184 : 214,
        health: t % 40 < 8 ? [{ type: 'warning', message: 'Indexers unavailable due to failures for more than 6 hours: 1337x', source: 'IndexerLongTermStatusCheck' }] : [],
        disks: [{ path: '/data', label: 'tank', free: jitter(2.9e12, 0.001), total: 18e12 }],
      });
    },
    actions: [
      isRadarr
        ? { id: 'searchMissing', label: 'Pretraži sve nedostajuće', description: 'Pokreće MissingMoviesSearch', run: async (ctx) => { await ctx.http.post('/api/v3/command', { name: 'MissingMoviesSearch' }); return 'Pretraga pokrenuta'; } }
        : { id: 'searchMissing', label: 'Pretraži sve nedostajuće', description: 'Pokreće MissingEpisodeSearch', run: async (ctx) => { await ctx.http.post('/api/v3/command', { name: 'MissingEpisodeSearch', monitored: true }); return 'Pretraga pokrenuta'; } },
      { id: 'rssSync', label: 'RSS sync', run: async (ctx) => { await ctx.http.post('/api/v3/command', { name: 'RssSync' }); return 'RSS sync pokrenut'; } },
      { id: 'refreshDownloads', label: 'Osvježi preuzimanja', run: async (ctx) => { await ctx.http.post('/api/v3/command', { name: 'RefreshMonitoredDownloads' }); return 'Osvježavanje pokrenuto'; } },
      {
        id: 'removeQueueItem', label: 'Makni iz reda', danger: true,
        params: [{ key: 'id', label: 'Queue ID', type: 'number', required: true }, { key: 'blocklist', label: 'Dodaj na blocklist', type: 'boolean', default: false }],
        run: async (ctx, p) => {
          await ctx.http.request(`/api/v3/queue/${Number(p.id)}`, { method: 'DELETE', query: { removeFromClient: true, blocklist: !!p.blocklist } });
          return 'Maknuto iz reda';
        },
      },
    ],
    widgets: [
      { id: 'queue', name: `${isRadarr ? 'Radarr' : 'Sonarr'} queue`, description: 'Preuzimanja u tijeku s progresom i ETA', sizes: ['S', 'M', 'L', 'XL'], defaultSize: 'M' },
      { id: 'overview', name: `${isRadarr ? 'Radarr' : 'Sonarr'} pregled`, description: 'Biblioteka, missing, health i disk', sizes: ['S', 'M', 'L'], defaultSize: 'S' },
      { id: 'calendar', name: `${isRadarr ? 'Radarr' : 'Sonarr'} kalendar`, description: 'Nadolazeći izlasci', sizes: ['M', 'L', 'XL'], defaultSize: 'M' },
    ],
  };
}

export const radarr = makeArr('radarr');
export const sonarr = makeArr('sonarr');
