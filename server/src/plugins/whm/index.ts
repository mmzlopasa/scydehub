import type { Plugin, PluginAlert } from '../types.js';
import { tlsFields, wave } from '../types.js';

interface Cfg { url: string; username: string; token: string }
export interface WhmData {
  load: { one: number; five: number; fifteen: number };
  services: { name: string; display: string; running: boolean | null; enabled: boolean }[];
  accounts: { total: number; suspended: number; list: { user: string; domain: string; suspended: boolean; diskUsed: string; diskLimit: string; plan?: string }[] };
  backup: { enabled: boolean | null; lastDate?: string | null; maxAgeDays?: number };
  version?: string;
}

/** WHM API 1 envelope: {metadata:{result, reason}, data} */
function unwrap<T>(r: any): T {
  if (r?.metadata && r.metadata.result === 0) throw new Error(r.metadata.reason ?? 'WHM API error');
  return r?.data as T;
}

function finish(d: WhmData) {
  const alerts: PluginAlert[] = d.services.filter((s) => s.enabled && s.running === false).map((s) => ({ key: `svc:${s.name}`, severity: 'critical', message: `Service ${s.display} is not running` }));
  if (d.backup.enabled === false) alerts.push({ key: 'backup:disabled', severity: 'warning', message: 'WHM backup is disabled' });
  if (d.backup.lastDate) {
    const age = (Date.now() - new Date(d.backup.lastDate).getTime()) / 86400_000;
    const limit = d.backup.maxAgeDays ?? 2; // 0 = never warn (weekly or monthly schedules set their own limit)
    if (limit > 0 && age > limit) alerts.push({ key: 'backup:age', severity: 'warning', message: `Last WHM backup is ${Math.floor(age)} d old` });
  }
  return {
    status: alerts.some((a) => a.severity === 'critical') ? ('degraded' as const) : ('up' as const),
    summary: `Load ${d.load.one} · ${d.accounts.total} accounts${d.accounts.suspended ? ` (${d.accounts.suspended} susp.)` : ''}`,
    data: d, alerts,
    metrics: { load1: d.load.one, load5: d.load.five, accounts: d.accounts.total, suspended: d.accounts.suspended },
  };
}

export const whm: Plugin<Cfg, WhmData> = {
  id: 'whm', name: 'WHM', icon: 'cpanel', category: 'hosting',
  description: 'Load, services, account count, suspended accounts, backup status.',
  docsUrl: 'https://api.docs.cpanel.net/whm/introduction',
  defaultInterval: 60,
  fields: [
    { key: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://server.example.com:2087' },
    { key: 'username', label: 'Username', type: 'string', default: 'root', required: true },
    { key: 'token', label: 'API token', type: 'secret', required: true, help: 'WHM → Manage API Tokens. Privileges: Basic System Information (load, services) and List Accounts. Backup status is only available to a root token; without it that part stays empty.' },
    { key: 'backupMaxAgeDays', label: 'Warn when the last backup is older than (days)', type: 'number', default: 2, help: 'Use 8 for a weekly schedule; 0 turns the warning off' },
    ...tlsFields,
  ],
  http: (c) => ({ headers: { Authorization: `whm ${c.username}:${c.token}` } }),
  async collect({ http, scratch, tick, config: c }) {
    const v1 = { 'api.version': 1 };
    // Each part needs its own privilege on the token. A token (or reseller) that lacks one still shows the rest;
    // only when nothing at all is allowed is the service reported as failing, with WHM's own explanation.
    const errors: string[] = [];
    const part = <T>(p: Promise<T>) => p.catch((e: any) => { errors.push(String(e?.message ?? e)); return null; });
    const [load, svc, accts] = await Promise.all([
      part(http.get('/json-api/systemloadavg', { query: v1 }).then((r) => unwrap<any>(r))),
      part(http.get('/json-api/servicestatus', { query: v1 }).then((r) => unwrap<any>(r))),
      part(http.get('/json-api/listaccts', { query: { ...v1, want: 'user,domain,suspended,diskused,disklimit,plan' } }).then((r) => unwrap<any>(r))),
    ]);
    if (errors.length === 3) throw new Error(`${errors[0]} — give the API token the privileges "Basic System Information" and "List Accounts" (WHM → Manage API Tokens)`);
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
      load: { one: Number(load?.one) || 0, five: Number(load?.five) || 0, fifteen: Number(load?.fifteen) || 0 },
      services: (svc?.service ?? []).filter((s: any) => s.installed !== 0).map((s: any) => ({ name: s.name, display: s.display_name ?? s.name, enabled: !!Number(s.enabled), running: s.running === undefined ? null : !!Number(s.running) })),
      accounts: { total: acct.length, suspended: acct.filter((a) => Number(a.suspended)).length, list: acct.map((a) => ({ user: a.user, domain: a.domain, suspended: !!Number(a.suspended), diskUsed: a.diskused, diskLimit: a.disklimit, plan: a.plan })) },
      backup: { ...scratch.backup, maxAgeDays: (c as any).backupMaxAgeDays === '' || (c as any).backupMaxAgeDays == null ? 2 : Math.max(0, Number((c as any).backupMaxAgeDays) || 0) }, version: scratch.version,
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
  widgets: [{ id: 'server', name: 'WHM server', description: 'Load, services, accounts, backup', sizes: ['S', 'M', 'L'], defaultSize: 'M' }],
};
