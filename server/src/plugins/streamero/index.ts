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

/** names a stats endpoint commonly uses for the playing sessions */
const STREAM_KEYS = ['streams', 'sessions', 'activeStreams', 'activeSessions', 'nowPlaying', 'playing', 'active'];
const str = (...v: unknown[]) => { for (const x of v) if (typeof x === 'string' && x.trim()) return x.trim().slice(0, 200); return undefined; };
const numOf = (...v: unknown[]) => { for (const x of v) { const n = Number(x); if (x !== null && x !== '' && Number.isFinite(n)) return n; } return undefined; };
function toStream(s: any): StreameroData['streams'][number] {
  const item = s.item ?? s.media ?? s.NowPlayingItem ?? {};
  let progress = numOf(s.progress, s.percent, s.percentage, s.progressPercent);
  if (progress === undefined) {
    const pos = numOf(s.position, s.positionSec, s.currentTime), dur = numOf(s.duration, s.durationSec, item.duration);
    if (pos !== undefined && dur) progress = (pos / dur) * 100;
  }
  if (progress !== undefined && progress > 0 && progress <= 1 && !Number.isInteger(progress)) progress *= 100; // 0–1 fraction
  return {
    user: str(s.user?.name, s.user, s.userName, s.username, s.UserName) ?? '?',
    title: str(s.title, s.name, item.title, item.name, item.Name, s.itemName) ?? '?',
    subtitle: str(s.subtitle, s.episode, item.subtitle, s.episodeTitle),
    progress: Math.max(0, Math.min(100, Math.round((progress ?? 0) * 10) / 10)),
    transcoding: !!(s.transcoding ?? s.isTranscoding ?? s.transcode ?? (String(s.playMethod ?? '').toLowerCase() === 'transcode')),
    device: str(s.device, s.deviceName, s.client, s.player, s.DeviceName),
    quality: str(s.quality, s.resolution),
    bandwidth: numOf(s.bandwidth, s.bitrate, s.bps) ?? 0,
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
    const raw = await http.get<any>(c.statsPath || '/api/stats');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The stats endpoint did not return a JSON object');
    // accept a { data: {...} } envelope and the usual names for the list of playing sessions
    const r = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? { ...raw, ...raw.data } : raw;
    const listKey = STREAM_KEYS.find((k) => Array.isArray(r[k]));
    const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
    const res = finish({
      version: r.version == null ? undefined : String(r.version).slice(0, 40),
      streams: listKey ? arr(r[listKey]).map(toStream) : [],
      library: r.library && typeof r.library === 'object' ? r.library : {},
      recentlyAdded: arr(r.recentlyAdded ?? r.recent ?? r.latest).slice(0, 12),
    });
    if (!listKey) {
      // a list that is missing is not the same as nobody watching: say what arrived (key names only, never values)
      const keys = Object.keys(r).filter((k) => k !== 'data').slice(0, 12).join(', ') || 'none';
      return {
        ...res, status: 'degraded' as const, summary: 'No list of streams in the answer',
        alerts: [{ key: 'contract', severity: 'warning' as const, message: `${c.statsPath || '/api/stats'} has no "streams" list (fields received: ${keys}) — see docs/integrations/streamero.md` }],
      };
    }
    return res;
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
