import type { Plugin } from '../types.js';
import { tlsFields, urlField } from '../types.js';
import { sslProbe } from '../../monitoring/probes.js';

interface Cfg { url: string }
export interface VwData { alive: boolean; responseMs: number; version?: string; serverTime?: string; cert?: { daysLeft: number; expiresAt: number; issuer?: string } | null }

export const vaultwarden: Plugin<Cfg, VwData> = {
  id: 'vaultwarden', name: 'Vaultwarden', icon: 'vaultwarden', category: 'security',
  description: 'Online/offline (/alive provjerava i bazu), vrijeme odziva, verzija i istek certifikata.',
  docsUrl: 'https://github.com/dani-garcia/vaultwarden/wiki',
  defaultInterval: 60,
  fields: [urlField('https://vault.example.com'), ...tlsFields],
  async collect({ http, scratch, tick }) {
    const t0 = performance.now();
    const alive = await http.get<string>('/alive');
    const responseMs = Math.round(performance.now() - t0);
    if (tick % 30 === 1 || !scratch.version) scratch.version = await http.get<string>('/api/version').catch(() => undefined);
    const u = new URL(http.baseUrl);
    if (u.protocol === 'https:' && (tick % 60 === 1 || scratch.cert === undefined)) {
      const r = await sslProbe(u.hostname, Number(u.port) || 443, 0);
      scratch.cert = r.extra ? { daysLeft: Number(r.extra.daysLeft), expiresAt: Number(r.extra.expiresAt), issuer: r.extra.issuer as string } : null;
    }
    const d: VwData = { alive: true, responseMs, version: scratch.version, serverTime: String(alive), cert: scratch.cert ?? null };
    const alerts = d.cert && d.cert.daysLeft < 14 ? [{ key: 'cert', severity: (d.cert.daysLeft < 3 ? 'critical' : 'warning') as 'critical' | 'warning', message: `Certifikat ističe za ${d.cert.daysLeft} d` }] : [];
    return { status: 'up', summary: `${responseMs} ms${d.version ? ' · v' + d.version : ''}`, data: d, metrics: { response_ms: responseMs }, alerts };
  },
  mock() {
    const ms = Math.round(18 + Math.random() * 20);
    return { status: 'up', summary: `${ms} ms · v1.34.3`, data: { alive: true, responseMs: ms, version: '1.34.3', serverTime: new Date().toISOString(), cert: { daysLeft: 61, expiresAt: Date.now() + 61 * 86400_000, issuer: "Let's Encrypt" } }, metrics: { response_ms: ms } };
  },
  widgets: [{ id: 'status', name: 'Vaultwarden', description: 'Stanje, odziv, verzija, certifikat', sizes: ['S', 'M'], defaultSize: 'S' }],
};
