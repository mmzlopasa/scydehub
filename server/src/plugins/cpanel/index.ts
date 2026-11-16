import type { Plugin, PluginContext, PluginAlert } from '../types.js';
import { tlsFields } from '../types.js';

interface Cfg { mode: 'cpanel' | 'whm'; url: string; username: string; token: string; accounts?: string; sslWarnDays?: number }
export interface CpanelAccount {
  user: string; diskUsedMb: number; diskLimitMb: number | null; bandwidthMb?: number; bandwidthLimitMb?: number | null;
  domains: string[]; ssl: { host: string; expiresAt: number; daysLeft: number }[];
  mailboxes: { email: string; usedMb: number; quotaMb: number | null }[]; error?: string;
}
export interface CpanelData { accounts: CpanelAccount[] }

async function uapi(ctx: PluginContext<Cfg>, user: string, module: string, fn: string, params: Record<string, string> = {}) {
  const c = ctx.config;
  if (c.mode === 'whm') {
    const r = await ctx.http.get<any>('/json-api/uapi_cpanel', { query: { 'api.version': 1, 'cpanel.user': user, 'cpanel.module': module, 'cpanel.function': fn, ...params } });
    if (r?.metadata?.result === 0) throw new Error(r.metadata.reason);
    const res = r?.data?.uapi ?? r?.data;
    if (res?.status === 0) throw new Error((res.errors ?? []).join('; ') || `${module}::${fn} failed`);
    return res?.data;
  }
  const r = await ctx.http.get<any>(`/execute/${module}/${fn}`, { query: params });
  const res = r?.result ?? r;
  if (res?.status === 0) throw new Error((res.errors ?? []).join('; ') || `${module}::${fn} failed`);
  return res?.data;
}

const mb = (v: any) => (v === null || v === undefined || v === 'unlimited' ? null : Number(String(v).replace(/[^\d.]/g, '')) || 0);

async function account(ctx: PluginContext<Cfg>, user: string): Promise<CpanelAccount> {
  try {
    const [quota, stats, domains, ssl, pops] = await Promise.all([
      uapi(ctx, user, 'Quota', 'get_quota_info'),
      uapi(ctx, user, 'StatsBar', 'get_stats', { display: 'bandwidthusage' }).catch(() => []),
      uapi(ctx, user, 'DomainInfo', 'list_domains'),
      uapi(ctx, user, 'SSL', 'installed_hosts').catch(() => []),
      uapi(ctx, user, 'Email', 'list_pops_with_disk').catch(() => []),
    ]);
    const bw = (stats ?? []).find((s: any) => s.name === 'bandwidthusage');
    return {
      user,
      diskUsedMb: Number(quota?.megabytes_used) || 0,
      diskLimitMb: Number(quota?.megabyte_limit) ? Number(quota.megabyte_limit) : null,
      bandwidthMb: bw ? mb(bw._count) ?? undefined : undefined,
      bandwidthLimitMb: bw ? mb(bw._max) : undefined,
      domains: [domains?.main_domain, ...(domains?.addon_domains ?? []), ...(domains?.sub_domains ?? []), ...(domains?.parked_domains ?? [])].filter(Boolean),
      ssl: (ssl ?? []).map((h: any) => {
        const exp = Number(h.certificate?.not_after) * 1000;
        return { host: h.servername ?? h.certificate?.domains?.[0], expiresAt: exp, daysLeft: Math.floor((exp - Date.now()) / 86400_000) };
      }).filter((s: any) => s.expiresAt > 0),
      mailboxes: (pops ?? []).map((p: any) => ({ email: p.email, usedMb: Number(p.diskused) || 0, quotaMb: mb(p.diskquota) })),
    };
  } catch (e: any) {
    return { user, diskUsedMb: 0, diskLimitMb: null, domains: [], ssl: [], mailboxes: [], error: String(e?.message ?? e) };
  }
}

function finish(d: CpanelData, warnDays: number) {
  const alerts: PluginAlert[] = [];
  for (const a of d.accounts) {
    if (a.error) alerts.push({ key: `acct:${a.user}`, severity: 'warning', message: `${a.user}: ${a.error}` });
    for (const s of a.ssl) if (s.daysLeft < warnDays) alerts.push({ key: `ssl:${s.host}`, severity: s.daysLeft < 3 ? 'critical' : 'warning', message: `SSL ${s.host} expires in ${s.daysLeft} d` });
    if (a.diskLimitMb && a.diskUsedMb / a.diskLimitMb > 0.9) alerts.push({ key: `disk:${a.user}`, severity: 'warning', message: `${a.user} is using ${Math.round((a.diskUsedMb / a.diskLimitMb) * 100)}% of quota` });
  }
  const failing = d.accounts.filter((a) => a.error).length;
  return {
    status: failing === d.accounts.length && failing > 0 ? ('down' as const) : failing ? ('degraded' as const) : ('up' as const),
    summary: `${d.accounts.length} accounts · ${d.accounts.reduce((n, a) => n + a.domains.length, 0)} domains`,
    data: d, alerts,
    metrics: Object.fromEntries(d.accounts.map((a) => [`disk_${a.user}`, a.diskUsedMb])),
  };
}

export const cpanel: Plugin<Cfg, CpanelData> = {
  id: 'cpanel', name: 'cPanel accounts', icon: 'cpanel', category: 'hosting',
  description: 'Per account: disk, bandwidth, domains, SSL expiry, e-mail quotas. Directly (cPanel token) or via a WHM token for multiple accounts.',
  docsUrl: 'https://api.docs.cpanel.net/cpanel/introduction',
  defaultInterval: 600,
  fields: [
    { key: 'mode', label: 'Mode', type: 'select', default: 'cpanel', options: [{ value: 'cpanel', label: 'cPanel token (single account, port 2083)' }, { value: 'whm', label: 'WHM token (multiple accounts, port 2087)' }] },
    { key: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://server.example.com:2083' },
    { key: 'username', label: 'Username (cPanel user or root)', type: 'string', required: true },
    { key: 'token', label: 'API token', type: 'secret', required: true },
    { key: 'accounts', label: 'Accounts (WHM mode only, comma-separated)', type: 'string', placeholder: 'scyde,klijent1' },
    { key: 'sslWarnDays', label: 'Warn when SSL expires within (days)', type: 'number', default: 14 },
    ...tlsFields,
  ],
  http: (c) => ({ headers: { Authorization: `${c.mode === 'whm' ? 'whm' : 'cpanel'} ${c.username}:${c.token}` } }),
  async collect(ctx) {
    const c = ctx.config;
    const users = c.mode === 'whm' ? (c.accounts ?? '').split(',').map((s) => s.trim()).filter(Boolean) : [c.username];
    if (!users.length) throw new Error('Specify at least one account');
    const accounts = [];
    for (const u of users) accounts.push(await account(ctx, u));
    return finish({ accounts }, Number(c.sslWarnDays) || 14);
  },
  mock(ctx) {
    const day = 86400_000;
    return finish({
      accounts: [
        { user: 'scyde', diskUsedMb: 4120, diskLimitMb: null, bandwidthMb: 18_220, bandwidthLimitMb: null, domains: ['scyde.net', 'hub.scyde.net', 'mail.scyde.net'],
          ssl: [{ host: 'scyde.net', expiresAt: Date.now() + 54 * day, daysLeft: 54 }, { host: 'hub.scyde.net', expiresAt: Date.now() + 11 * day, daysLeft: 11 }],
          mailboxes: [{ email: 'info@scyde.net', usedMb: 812, quotaMb: 2048 }, { email: 'mislav@scyde.net', usedMb: 1730, quotaMb: 2048 }] },
        { user: 'klijent1', diskUsedMb: 880, diskLimitMb: 5000, bandwidthMb: 3_100, bandwidthLimitMb: 50_000, domains: ['klijent1.hr'],
          ssl: [{ host: 'klijent1.hr', expiresAt: Date.now() + 70 * day, daysLeft: 70 }], mailboxes: [{ email: 'info@klijent1.hr', usedMb: 120, quotaMb: 1024 }] },
      ],
    }, Number(ctx.config.sslWarnDays) || 14);
  },
  widgets: [{ id: 'accounts', name: 'cPanel accounts', description: 'Disk, bandwidth, domains, SSL, mailboxes', sizes: ['M', 'L', 'XL'], defaultSize: 'L' }],
};
