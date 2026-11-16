import type { Plugin, PluginAlert } from '../types.js';
import { tlsFields, wave } from '../types.js';

interface Cfg { url: string; username: string; token: string }
export interface WhmData {
  load: { one: number; five: number; fifteen: number };
  services: { name: string; display: string; running: boolean | null; enabled: boolean }[];
  accounts: { total: number; suspended: number; list: { user: string; domain: string; suspended: boolean; diskUsed: string; diskLimit: string; plan?: string }[] };
  backup: { enabled: boolean | null; lastDate?: string | null };
  version?: string;
}

/** WHM API 1 envelope: {metadata:{result, reason}, data} */
function unwrap<T>(r: any): T {
  if (r?.metadata && r.metadata.result === 0) throw new Error(r.metadata.reason ?? 'WHM API error');
  return r?.data as T;
}

function finish(d: WhmData) {
  const alerts: PluginAlert[] = d.services.filter((s) => s.enabled && s.running === false).map((s) => ({ key: `svc:${s.name}`, severity: 'critical', message: `Servis ${s.display} ne radi` }));
  if (d.backup.enabled === false) alerts.push({ key: 'backup:disabled', severity: 'warning', message: 'Backup na WHM-u je isključen' });
  if (d.backup.lastDate) {
    const age = (Date.now() - new Date(d.backup.lastDate).getTime()) / 86400_000;
    if (age > 2) alerts.push({ key: 'backup:age', severity: 'warning', message: `Zadnji WHM backup je star ${Math.floor(age)} d` });
  }
  return {
    status: alerts.some((a) => a.severity === 'critical') ? ('degraded' as const) : ('up' as const),
    summary: `Load ${d.load.one} · ${d.accounts.total} računa${d.accounts.suspended ? ` (${d.accounts.suspended} susp.)` : ''}`,
    data: d, alerts,
    metrics: { load1: d.load.one, load5: d.load.five, accounts: d.accounts.total, suspended: d.accounts.suspended },
  };
}

export const whm: Plugin<Cfg, WhmData> = {
  id: 'whm', name: 'WHM', icon: 'cpanel', category: 'hosting',
  description: 'Load, servisi, broj računa, suspendirani računi, backup status.',
  docsUrl: 'https://api.docs.cpanel.net/whm/introduction',
  defaultInterval: 60,
  fields: [
    { key: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://server.example.com:2087' },
    { key: 'username', label: 'Korisnik', type: 'string', default: 'root', required: true },
    { key: 'token', label: 'API token', type: 'secret', required: true, help: 'Zaseban token s minimalnim ACL-ovima (list-accts, status, backup)' },
    ...tlsFields,
  ],
  http: (c) => ({ headers: { Authorization: `whm ${c.username}:${c.token}` } }),
  async collect({ http, scratch, tick }) {
    const v1 = { 'api.version': 1 };
    const [load, svc, accts] = await Promise.all([
      http.get('/json-api/systemloadavg', { query: v1 }).then((r) => unwrap<any>(r)),
      http.get('/json-api/servicestatus', { query: v1 }).then((r) => unwrap<any>(r)),
      http.get('/json-api/listaccts', { query: { ...v1, want: 'user,domain,suspended,diskused,disklimit,plan' } }).then((r) => unwrap<any>(r)),
    ]);
    if (tick % 30 === 1 || !scratch.backup) {
      const cfg = await http.get('/json-api/backup_config_get', { query: v1 }).then((r) => unwrap<any>(r)).catch(() => null);
      const dates = await http.get('/json-api/backup_date_list', { query: v1 }).then((r) => unwrap<any>(r)).catch(() => null);
      const list: string[] = (dates?.backup_set ?? []).map(String).sort();
      const be = cfg?.backup_config?.backupenable;
      scratch.backup = { enabled: be === undefined ? null : be === 1 || be === '1' || be === true, lastDate: list.at(-1) ?? null };
      scratch.version = await http.get('/json-api/version', { query: v1 }).then((r) => unwrap<any>(r)?.version).catch(() => undefined);
    }
    const acct = (accts?.acct ?? []) as any[];
    return finish({
      load: { one: Number(load.one), five: Number(load.five), fifteen: Number(load.fifteen) },
      services: (svc?.service ?? []).filter((s: any) => s.installed !== 0).map((s: any) => ({ name: s.name, display: s.display_name ?? s.name, enabled: !!Number(s.enabled), running: s.running === undefined ? null : !!Number(s.running) })),
      accounts: { total: acct.length, suspended: acct.filter((a) => Number(a.suspended)).length, list: acct.map((a) => ({ user: a.user, domain: a.domain, suspended: !!Number(a.suspended), diskUsed: a.diskused, diskLimit: a.disklimit, plan: a.plan })) },
      backup: scratch.backup, version: scratch.version,
    });
  },
  mock(ctx) {
    return finish({
      load: { one: Math.round(wave(ctx.tick, 0.9, 0.4) * 100) / 100, five: 0.84, fifteen: 0.77 },
      services: ['httpd', 'mysql', 'exim', 'dovecot', 'named', 'cpsrvd', 'sshd', 'ftpd'].map((n) => ({ name: n, display: n, enabled: true, running: true })),
      accounts: { total: 23, suspended: 1, list: [
        { user: 'scyde', domain: 'scyde.net', suspended: false, diskUsed: '4120M', diskLimit: 'unlimited', plan: 'pro' },
        { user: 'klijent1', domain: 'klijent1.hr', suspended: false, diskUsed: '880M', diskLimit: '5000M', plan: 'basic' },
        { user: 'staro', domain: 'staro.com', suspended: true, diskUsed: '210M', diskLimit: '2000M', plan: 'basic' },
      ] },
      backup: { enabled: true, lastDate: new Date(Date.now() - 20 * 3600_000).toISOString().slice(0, 10) }, version: '11.130.0.9',
    });
  },
  widgets: [{ id: 'server', name: 'WHM server', description: 'Load, servisi, računi, backup', sizes: ['S', 'M', 'L'], defaultSize: 'M' }],
};
