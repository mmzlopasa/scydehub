import type { Plugin, PluginContext } from '../types.js';
import { tlsFields, urlField, wave } from '../types.js';

interface Cfg { url: string; username?: string; password?: string; apiKey?: string }
export interface QbtTorrent { hash: string; name: string; progress: number; dlspeed: number; upspeed: number; eta: number; state: string; size: number; ratio: number; category?: string }
export interface QbtData {
  version?: string; dlSpeed: number; upSpeed: number; dlTotal: number; upTotal: number; freeSpace?: number; connection: string;
  downloading: number; seeding: number; stopped: number; errored: number; total: number; active: QbtTorrent[]; legacy: boolean;
}

const DL = new Set(['downloading', 'metaDL', 'forcedMetaDL', 'stalledDL', 'queuedDL', 'checkingDL', 'forcedDL']);
const UP = new Set(['uploading', 'stalledUP', 'queuedUP', 'checkingUP', 'forcedUP']);
const STOP = new Set(['stoppedUP', 'stoppedDL', 'pausedUP', 'pausedDL']);

async function login(ctx: PluginContext<Cfg>) {
  const { http, config: c, scratch } = ctx;
  if (c.apiKey) return; // 5.2+ API key: sent as header, no session
  const origin = new URL(http.baseUrl).origin;
  const r = await http.raw('/api/v2/auth/login', { method: 'POST', form: { username: c.username ?? '', password: c.password ?? '' }, headers: { Referer: origin, Origin: origin } });
  if (r.status === 403) throw new Error('qBittorrent banned this IP (too many failed logins)');
  if (r.status >= 400 || /Fails/i.test(r.text)) throw new Error('qBittorrent login failed');
  // cookie name is SID (<5.2) or QBT_SID_<port> (5.2+) — keep whatever we got
  const cookies = (r.headers as any).getSetCookie?.() as string[] | undefined;
  const list = cookies?.length ? cookies : [r.headers.get('set-cookie') ?? ''];
  scratch.cookie = list.map((x) => x.split(';')[0]).filter(Boolean).join('; ');
  if (!scratch.cookie) throw new Error('qBittorrent did not return a session cookie');
}

async function api<T>(ctx: PluginContext<Cfg>, path: string, opts: { method?: string; form?: Record<string, string>; text?: boolean; query?: Record<string, string> } = {}): Promise<T> {
  const { http, config: c, scratch } = ctx;
  const origin = new URL(http.baseUrl).origin;
  const call = () => http.request<T>(path, {
    ...opts,
    headers: c.apiKey ? { 'X-API-Key': c.apiKey } : { Cookie: scratch.cookie ?? '', Referer: origin, Origin: origin },
  });
  if (!c.apiKey && !scratch.cookie) await login(ctx);
  try {
    return await call();
  } catch (e: any) {
    if (!c.apiKey && (e.status === 403 || e.status === 401)) {
      await login(ctx);
      return call();
    }
    throw e;
  }
}

function finish(d: QbtData) {
  return {
    status: d.connection === 'disconnected' ? ('degraded' as const) : ('up' as const),
    summary: `↓ ${fmt(d.dlSpeed)}/s · ↑ ${fmt(d.upSpeed)}/s · ${d.downloading} active`,
    data: d,
    metrics: { dl: d.dlSpeed, up: d.upSpeed, downloading: d.downloading, seeding: d.seeding, ...(d.freeSpace !== undefined ? { free: d.freeSpace } : {}) },
    alerts: d.errored ? [{ key: 'errored', severity: 'warning' as const, message: `Torrents with errors: ${d.errored}` }] : [],
  };
}
const fmt = (b: number) => (b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : (b / 1e3).toFixed(0) + ' kB');

async function legacy(ctx: PluginContext<Cfg>) {
  if (ctx.scratch.legacy === undefined) {
    const v = await api<string>(ctx, '/api/v2/app/webapiVersion', { text: true });
    const [a, b] = String(v).trim().split('.').map(Number);
    ctx.scratch.legacy = a < 2 || (a === 2 && b < 11);
  }
  return ctx.scratch.legacy as boolean;
}

export const qbittorrent: Plugin<Cfg, QbtData> = {
  id: 'qbittorrent', name: 'qBittorrent', icon: 'qbittorrent', category: 'downloads',
  description: 'Live speeds, active torrents with progress and ETA, seeding, free disk space; pause/resume.',
  docsUrl: 'https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)',
  defaultInterval: 5,
  fields: [
    urlField('http://192.168.1.20:8080'),
    { key: 'username', label: 'Username', type: 'string' },
    { key: 'password', label: 'Password', type: 'secret' },
    { key: 'apiKey', label: 'API key (qBittorrent 5.2+, instead of password)', type: 'secret' },
    ...tlsFields,
  ],
  async collect(ctx) {
    const isLegacy = await legacy(ctx);
    const [info, torrents, main, version] = await Promise.all([
      api<any>(ctx, '/api/v2/transfer/info'),
      api<any[]>(ctx, '/api/v2/torrents/info', { query: { filter: 'all' } }),
      ctx.tick % 6 === 1 || ctx.scratch.free === undefined ? api<any>(ctx, '/api/v2/sync/maindata', { query: { rid: '0' } }).catch(() => null) : Promise.resolve(null),
      ctx.scratch.version ? Promise.resolve(ctx.scratch.version) : api<string>(ctx, '/api/v2/app/version', { text: true }),
    ]);
    ctx.scratch.version = version;
    if (main?.server_state) ctx.scratch.free = main.server_state.free_space_on_disk;
    const map = (t: any): QbtTorrent => ({ hash: t.hash, name: t.name, progress: Math.round(t.progress * 1000) / 10, dlspeed: t.dlspeed, upspeed: t.upspeed, eta: t.eta, state: t.state, size: t.size, ratio: Math.round(t.ratio * 100) / 100, category: t.category });
    const active = torrents.filter((t) => DL.has(t.state) || t.dlspeed > 0 || t.upspeed > 0).sort((a, b) => b.dlspeed - a.dlspeed || a.progress - b.progress).slice(0, 25).map(map);
    return finish({
      version: String(version).trim(), dlSpeed: info.dl_info_speed, upSpeed: info.up_info_speed, dlTotal: info.dl_info_data, upTotal: info.up_info_data,
      freeSpace: ctx.scratch.free, connection: info.connection_status, legacy: isLegacy,
      downloading: torrents.filter((t) => DL.has(t.state)).length, seeding: torrents.filter((t) => UP.has(t.state)).length,
      stopped: torrents.filter((t) => STOP.has(t.state)).length, errored: torrents.filter((t) => t.state === 'error' || t.state === 'missingFiles').length,
      total: torrents.length, active,
    });
  },
  mock(ctx) {
    const t = ctx.tick;
    const paused = !!ctx.scratch.mockPaused;
    const names = ['Dune.Part.Two.2024.2160p.UHD.BluRay.x265', 'Severance.S02E07.1080p.WEB.h264', 'The.Last.of.Us.S02E03.2160p.WEB', 'Conclave.2024.1080p.BluRay.x264', 'ubuntu-24.04.3-desktop-amd64.iso'];
    const active: QbtTorrent[] = names.map((name, i) => {
      const progress = Math.min(100, ((t * (1.5 + i)) % 110) + i * 7);
      const done = progress >= 100;
      return {
        hash: `mock${i}`, name, progress: Math.round(progress * 10) / 10, dlspeed: paused || done ? 0 : Math.round(wave(t + i * 3, 4.2e6, 2e6, 8)), upspeed: paused ? 0 : Math.round(wave(t + i, 3e5, 2e5, 6)),
        eta: done ? 8640000 : Math.round((100 - progress) * 12), state: paused ? 'stoppedDL' : done ? 'uploading' : 'downloading', size: (i === 0 ? 62 : 3 + i * 2) * 1e9, ratio: done ? 1.2 : 0.1,
      };
    });
    return finish({
      version: 'v5.3.0', dlSpeed: active.reduce((a, b) => a + b.dlspeed, 0), upSpeed: active.reduce((a, b) => a + b.upspeed, 0), dlTotal: 412e9, upTotal: 980e9,
      freeSpace: 2.9e12, connection: 'connected', downloading: active.filter((a) => DL.has(a.state)).length, seeding: 143, stopped: paused ? 5 : 2, errored: 0, total: 150, active, legacy: false,
    });
  },
  actions: [
    {
      id: 'pauseAll', label: 'Pause all',
      run: async (ctx) => { const l = await legacy(ctx); await api(ctx, `/api/v2/torrents/${l ? 'pause' : 'stop'}`, { method: 'POST', form: { hashes: 'all' } }); return 'All torrents paused'; },
      mock: (ctx) => { ctx.scratch.mockPaused = true; return 'Paused (mock)'; },
    },
    {
      id: 'resumeAll', label: 'Resume all',
      run: async (ctx) => { const l = await legacy(ctx); await api(ctx, `/api/v2/torrents/${l ? 'resume' : 'start'}`, { method: 'POST', form: { hashes: 'all' } }); return 'All torrents resumed'; },
      mock: (ctx) => { ctx.scratch.mockPaused = false; return 'Resumed (mock)'; },
    },
    {
      id: 'pause', label: 'Pause torrent', params: [{ key: 'hash', label: 'Hash', type: 'string', required: true }],
      run: async (ctx, p) => { const l = await legacy(ctx); await api(ctx, `/api/v2/torrents/${l ? 'pause' : 'stop'}`, { method: 'POST', form: { hashes: String(p.hash) } }); return 'Paused'; },
    },
    {
      id: 'resume', label: 'Resume torrent', params: [{ key: 'hash', label: 'Hash', type: 'string', required: true }],
      run: async (ctx, p) => { const l = await legacy(ctx); await api(ctx, `/api/v2/torrents/${l ? 'resume' : 'start'}`, { method: 'POST', form: { hashes: String(p.hash) } }); return 'Resumed'; },
    },
  ],
  widgets: [
    { id: 'transfer', name: 'qBittorrent speeds', description: 'Live download/upload with chart', sizes: ['S', 'M', 'L'], defaultSize: 'S' },
    { id: 'torrents', name: 'qBittorrent torrents', description: 'Active torrents with progress and ETA', sizes: ['M', 'L', 'XL'], defaultSize: 'L' },
  ],
};
