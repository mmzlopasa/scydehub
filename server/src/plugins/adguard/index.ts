import type { Plugin } from '../types.js';
import { tlsFields, urlField, wave } from '../types.js';

interface Cfg { url: string; username: string; password: string }
export interface AdguardData {
  version?: string; protection: boolean; running: boolean; protectionDisabledUntil?: number | null;
  queries: number; blocked: number; blockedPct: number; avgMs: number;
  topDomains: [string, number][]; topBlocked: [string, number][]; topClients: [string, number][];
  hourly: { queries: number[]; blocked: number[] };
}

const pairs = (arr: any[] | undefined, n = 8): [string, number][] =>
  (arr ?? []).slice(0, n).map((o) => { const [k, v] = Object.entries(o)[0] as [string, number]; return [k, Number(v)]; });

function finish(d: AdguardData) {
  return {
    status: d.protection ? ('up' as const) : ('degraded' as const),
    summary: `${d.blockedPct}% blokirano · ${d.queries.toLocaleString('hr')} upita`,
    data: d,
    metrics: { queries: d.queries, blocked: d.blocked, blocked_pct: d.blockedPct, avg_ms: d.avgMs },
    alerts: d.protection ? [] : [{ key: 'protection', severity: 'warning' as const, message: 'AdGuard zaštita je isključena' }],
  };
}

export const adguard: Plugin<Cfg, AdguardData> = {
  id: 'adguard', name: 'AdGuard Home', icon: 'adguard-home', category: 'network',
  description: 'DNS upiti, postotak blokiranih, top domene i klijenti, zaštita on/off.',
  docsUrl: 'https://github.com/AdguardTeam/AdGuardHome/tree/master/openapi',
  defaultInterval: 30,
  fields: [urlField('http://192.168.1.2'), { key: 'username', label: 'Korisnik', type: 'string', required: true }, { key: 'password', label: 'Lozinka', type: 'secret', required: true }, ...tlsFields],
  http: (c) => ({ headers: { Authorization: 'Basic ' + Buffer.from(`${c.username}:${c.password}`).toString('base64') } }),
  async collect({ http }) {
    const [status, stats] = await Promise.all([http.get<any>('/control/status'), http.get<any>('/control/stats')]);
    const queries = Number(stats.num_dns_queries) || 0;
    const blocked = (Number(stats.num_blocked_filtering) || 0) + (Number(stats.num_replaced_safebrowsing) || 0) + (Number(stats.num_replaced_parental) || 0);
    return finish({
      version: status.version, protection: !!status.protection_enabled, running: !!status.running,
      protectionDisabledUntil: status.protection_disabled_until ? new Date(status.protection_disabled_until).getTime() : null,
      queries, blocked, blockedPct: queries ? Math.round((blocked / queries) * 1000) / 10 : 0,
      avgMs: Math.round((Number(stats.avg_processing_time) || 0) * 10000) / 10,
      topDomains: pairs(stats.top_queried_domains), topBlocked: pairs(stats.top_blocked_domains), topClients: pairs(stats.top_clients),
      hourly: { queries: (stats.dns_queries ?? []).slice(-24), blocked: (stats.blocked_filtering ?? []).slice(-24) },
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
      id: 'pause', label: 'Pauziraj zaštitu', danger: true,
      params: [{ key: 'minutes', label: 'Minuta', type: 'select', options: [{ value: '1', label: '1 min' }, { value: '10', label: '10 min' }, { value: '60', label: '1 h' }, { value: '0', label: 'Do ponovnog uključenja' }], default: '10' }],
      run: async ({ http }, p) => {
        const m = Number(p.minutes ?? 10);
        await http.post('/control/protection', m > 0 ? { enabled: false, duration: m * 60_000 } : { enabled: false });
        return m > 0 ? `Zaštita pauzirana ${m} min` : 'Zaštita isključena';
      },
      mock: (ctx, p) => { ctx.scratch.mockOff = Date.now() + (Number(p.minutes) || 600) * 60_000; return 'Zaštita pauzirana (mock)'; },
    },
    {
      id: 'resume', label: 'Uključi zaštitu',
      run: async ({ http }) => { await http.post('/control/protection', { enabled: true }); return 'Zaštita uključena'; },
      mock: (ctx) => { ctx.scratch.mockOff = 0; return 'Zaštita uključena (mock)'; },
    },
  ],
  widgets: [
    { id: 'stats', name: 'AdGuard statistika', description: 'Upiti, blokirano, graf po satima', sizes: ['S', 'M', 'L'], defaultSize: 'M' },
    { id: 'top', name: 'AdGuard top liste', description: 'Top domene, blokirane domene i klijenti', sizes: ['M', 'L', 'XL'], defaultSize: 'L' },
  ],
};
