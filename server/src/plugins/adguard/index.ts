import type { Plugin } from '../types.js';
import { tlsFields, urlField, wave } from '../types.js';

interface Cfg { url: string; username: string; password: string }
export interface AdguardData {
  version?: string; protection: boolean; running: boolean; protectionDisabledUntil?: number | null;
  queries: number; blocked: number; blockedPct: number; avgMs: number;
  topDomains: [string, number][]; topBlocked: [string, number][]; topClients: [string, number][];
  hourly: { queries: number[]; blocked: number[]; unit?: 'hours' | 'days' };
}

const pairs = (arr: any[] | undefined, n = 8): [string, number][] =>
  (arr ?? []).slice(0, n).map((o) => { const [k, v] = Object.entries(o)[0] as [string, number]; return [k, Number(v)]; });

function finish(d: AdguardData) {
  return {
    status: d.protection ? ('up' as const) : ('degraded' as const),
    summary: `${d.blockedPct}% blocked · ${d.queries.toLocaleString('en-US')} queries`,
    data: d,
    metrics: { queries: d.queries, blocked: d.blocked, blocked_pct: d.blockedPct, avg_ms: d.avgMs },
    alerts: d.protection ? [] : [{ key: 'protection', severity: 'warning' as const, message: 'AdGuard protection is disabled' }],
  };
}

export const adguard: Plugin<Cfg, AdguardData> = {
  id: 'adguard', name: 'AdGuard Home', icon: 'adguard-home', category: 'network',
  description: 'DNS queries, blocked percentage, top domains and clients, protection on/off.',
  docsUrl: 'https://github.com/AdguardTeam/AdGuardHome/tree/master/openapi',
  defaultInterval: 30,
  fields: [urlField('http://192.168.1.2'), { key: 'username', label: 'Username', type: 'string', required: true }, { key: 'password', label: 'Password', type: 'secret', required: true }, ...tlsFields],
  http: (c) => ({ headers: { Authorization: 'Basic ' + Buffer.from(`${c.username}:${c.password}`).toString('base64') } }),
  async collect({ http }) {
    const [status, stats] = await Promise.all([http.get<any>('/control/status'), http.get<any>('/control/stats')]);
    if (typeof status?.protection_enabled !== 'boolean' || !stats || typeof stats !== 'object') throw new Error('Unexpected answer from AdGuard Home — check the URL');
    const queries = Number(stats.num_dns_queries) || 0;
    // with a 7/30/90-day statistics interval the series are per day, not per hour
    const perHour = (stats.time_units ?? 'hours') === 'hours';
    const pausedMs = Number(status.protection_disabled_duration) || 0;
    const blocked = (Number(stats.num_blocked_filtering) || 0) + (Number(stats.num_replaced_safebrowsing) || 0) + (Number(stats.num_replaced_parental) || 0);
    return finish({
      version: status.version, protection: !!status.protection_enabled, running: !!status.running,
      protectionDisabledUntil: pausedMs > 0 ? Date.now() + pausedMs : status.protection_disabled_until ? new Date(status.protection_disabled_until).getTime() : null,
      queries, blocked, blockedPct: queries ? Math.round((blocked / queries) * 1000) / 10 : 0,
      avgMs: Math.round((Number(stats.avg_processing_time) || 0) * 10000) / 10,
      topDomains: pairs(stats.top_queried_domains), topBlocked: pairs(stats.top_blocked_domains), topClients: pairs(stats.top_clients),
      hourly: { queries: (stats.dns_queries ?? []).slice(perHour ? -24 : -30), blocked: (stats.blocked_filtering ?? []).slice(perHour ? -24 : -30), unit: perHour ? 'hours' : 'days' },
    });
  },
  mock(ctx) {
    const off = !!ctx.scratch.mockOff && ctx.scratch.mockOff > Date.now();
    const queries = 48_211 + ctx.tick * 23;
    const blocked = Math.round(queries * (off ? 0.02 : 0.187));
    return finish({
      version: 'v0.107.69', protection: !off, running: true, protectionDisabledUntil: off ? ctx.scratch.mockOff : null,
      queries, blocked, blockedPct: Math.round((blocked / queries) * 1000) / 10, avgMs: Math.round(wave(ctx.tick, 6, 2) * 10) / 10,
      topDomains: [['i.instagram.com', 4211], ['graph.facebook.com', 2980], ['www.google.com', 2541], ['api.themoviedb.org', 1990], ['github.com', 1412]],
      topBlocked: [['doubleclick.net', 3120], ['app-measurement.com', 1882], ['googleads.g.doubleclick.net', 1203], ['telemetry.microsoft.com', 640]],
      topClients: [['192.168.1.41', 14211], ['192.168.1.20', 9820], ['192.168.1.55', 7102], ['192.168.1.12', 5120]],
      hourly: {
        queries: Array.from({ length: 24 }, (_, i) => Math.round(1500 + 900 * Math.sin((i / 24) * Math.PI * 2 - 2) + Math.random() * 200)),
        blocked: Array.from({ length: 24 }, (_, i) => Math.round(280 + 160 * Math.sin((i / 24) * Math.PI * 2 - 2) + Math.random() * 40)),
      },
    });
  },
  actions: [
    {
      id: 'pause', label: 'Pause protection', danger: true,
      params: [{ key: 'minutes', label: 'Minutes', type: 'select', options: [{ value: '1', label: '1 min' }, { value: '10', label: '10 min' }, { value: '60', label: '1 h' }, { value: '0', label: 'Until re-enabled' }], default: '10' }],
      run: async ({ http }, p) => {
        const m = Number(p.minutes ?? 10);
        await http.post('/control/protection', m > 0 ? { enabled: false, duration: m * 60_000 } : { enabled: false });
        return m > 0 ? `Protection paused for ${m} min` : 'Protection disabled';
      },
      mock: (ctx, p) => { ctx.scratch.mockOff = Date.now() + (Number(p.minutes) || 600) * 60_000; return 'Protection paused (mock)'; },
    },
    {
      id: 'resume', label: 'Enable protection',
      run: async ({ http }) => { await http.post('/control/protection', { enabled: true }); return 'Protection enabled'; },
      mock: (ctx) => { ctx.scratch.mockOff = 0; return 'Protection enabled (mock)'; },
    },
  ],
  widgets: [
    { id: 'stats', name: 'AdGuard statistics', description: 'Queries, blocked, hourly chart', sizes: ['S', 'M', 'L'], defaultSize: 'M' },
    { id: 'top', name: 'AdGuard top lists', description: 'Top domains, blocked domains and clients', sizes: ['M', 'L', 'XL'], defaultSize: 'L' },
  ],
};
