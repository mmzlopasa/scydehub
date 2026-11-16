import type { Plugin, PluginContext } from '../types.js';
import { tlsFields, urlField, wave, pct } from '../types.js';

interface Cfg { url: string; username: string; password: string; wanInterface?: string; interfaces?: string }
export interface MtIface { name: string; type: string; running: boolean; disabled: boolean; rxBps: number; txBps: number; rxBytes: number; txBytes: number }
export interface MtData {
  board?: string; version?: string; uptime?: string; cpu: number; memUsed: number; memTotal: number;
  wan?: { name: string; running: boolean; rxBps: number; txBps: number } | null;
  interfaces: MtIface[]; leases: { address: string; mac: string; host?: string; status?: string }[]; leaseCount: number;
  peers: { name: string; iface: string; endpoint?: string; lastHandshake?: string; online: boolean; rx: number; tx: number }[];
}

/** RouterOS durations: "1w2d3h4m5s" → seconds */
export function rosDuration(s?: string): number | null {
  if (!s) return null;
  let total = 0;
  const re = /(\d+)(w|d|h|ms|m|s)/g;
  let m: RegExpExecArray | null, any = false;
  while ((m = re.exec(s))) {
    any = true;
    const n = Number(m[1]);
    total += m[2] === 'w' ? n * 604800 : m[2] === 'd' ? n * 86400 : m[2] === 'h' ? n * 3600 : m[2] === 'm' ? n * 60 : m[2] === 's' ? n : 0;
  }
  if (!any && /^\d+:\d+:\d+$/.test(s)) { const [h, mi, se] = s.split(':').map(Number); return h * 3600 + mi * 60 + se; }
  return any ? total : null;
}

function finish(d: MtData) {
  const alerts = d.wan && !d.wan.running ? [{ key: 'wan', severity: 'critical' as const, message: `WAN ${d.wan.name} je pao` }] : [];
  return {
    status: alerts.length ? ('degraded' as const) : ('up' as const),
    summary: `CPU ${d.cpu}% · ${d.wan ? `WAN ↓${(d.wan.rxBps / 1e6).toFixed(1)} Mbps` : `${d.interfaces.filter((i) => i.running).length} sučelja`}`,
    data: d,
    metrics: { cpu: d.cpu, mem: pct(d.memUsed, d.memTotal), ...(d.wan ? { wan_rx: d.wan.rxBps, wan_tx: d.wan.txBps } : {}), leases: d.leaseCount },
    alerts,
  };
}

async function collect(ctx: PluginContext<Cfg>) {
  const { http, config: c, scratch } = ctx;
  const [res, ifaces, leases, peers] = await Promise.all([
    http.get<any>('/rest/system/resource'),
    http.get<any[]>('/rest/interface'),
    http.get<any[]>('/rest/ip/dhcp-server/lease').catch(() => []),
    http.get<any[]>('/rest/interface/wireguard/peers').catch(() => []),
  ]);
  const now = Date.now();
  const prev: Record<string, { rx: number; tx: number; t: number }> = scratch.prev ?? {};
  const next: typeof prev = {};
  const filter = (c.interfaces ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const list: MtIface[] = ifaces
    .filter((i) => !filter.length || filter.includes(i.name) || i.name === c.wanInterface)
    .map((i) => {
      const rx = Number(i['rx-byte']) || 0, tx = Number(i['tx-byte']) || 0;
      next[i.name] = { rx, tx, t: now };
      const p = prev[i.name];
      const dt = p ? (now - p.t) / 1000 : 0;
      return {
        name: i.name, type: i.type, running: i.running === 'true' || i.running === true, disabled: i.disabled === 'true' || i.disabled === true,
        rxBps: p && dt > 0 && rx >= p.rx ? Math.round(((rx - p.rx) * 8) / dt) : 0, txBps: p && dt > 0 && tx >= p.tx ? Math.round(((tx - p.tx) * 8) / dt) : 0,
        rxBytes: rx, txBytes: tx,
      };
    });
  scratch.prev = next;
  const wanI = c.wanInterface ? list.find((i) => i.name === c.wanInterface) : undefined;
  return finish({
    board: res['board-name'], version: res.version, uptime: res.uptime, cpu: Number(res['cpu-load']) || 0,
    memTotal: Number(res['total-memory']) || 0, memUsed: (Number(res['total-memory']) || 0) - (Number(res['free-memory']) || 0),
    wan: wanI ? { name: wanI.name, running: wanI.running, rxBps: wanI.rxBps, txBps: wanI.txBps } : null,
    interfaces: list.filter((i) => !i.disabled),
    leases: leases.filter((l) => l.status === 'bound').slice(0, 100).map((l) => ({ address: l.address, mac: l['mac-address'], host: l['host-name'], status: l.status })),
    leaseCount: leases.filter((l) => l.status === 'bound').length,
    peers: peers.map((p) => {
      const hs = rosDuration(p['last-handshake']);
      return {
        name: p.name || p.comment || p['public-key']?.slice(0, 8) || '?', iface: p.interface, endpoint: p['current-endpoint-address'] || undefined,
        lastHandshake: p['last-handshake'], online: hs !== null && hs < 180, rx: Number(p.rx) || 0, tx: Number(p.tx) || 0,
      };
    }),
  });
}

export const mikrotik: Plugin<Cfg, MtData> = {
  id: 'mikrotik', name: 'MikroTik', icon: 'mikrotik', category: 'network',
  description: 'RouterOS v7 REST: CPU, RAM, promet po sučeljima uživo, WAN, DHCP leaseovi, WireGuard peerovi.',
  docsUrl: 'https://help.mikrotik.com/docs/spaces/ROS/pages/47579162/REST+API',
  defaultInterval: 10,
  fields: [
    urlField('https://192.168.88.1'),
    { key: 'username', label: 'Korisnik (grupa read + rest-api)', type: 'string', required: true },
    { key: 'password', label: 'Lozinka', type: 'secret', required: true },
    { key: 'wanInterface', label: 'WAN sučelje', type: 'string', placeholder: 'ether1' },
    { key: 'interfaces', label: 'Prikaži samo sučelja (zarezom)', type: 'string', placeholder: 'ether1,bridge,wg0' },
    ...tlsFields,
  ],
  http: (c) => ({ headers: { Authorization: 'Basic ' + Buffer.from(`${c.username}:${c.password}`).toString('base64') } }),
  collect,
  mock(ctx) {
    const t = ctx.tick;
    const rx = Math.max(0, Math.round(wave(t, 180e6, 120e6, 12) + Math.random() * 30e6));
    const tx = Math.max(0, Math.round(wave(t + 4, 22e6, 15e6, 9) + Math.random() * 5e6));
    return finish({
      board: 'CHR QEMU Standard PC', version: '7.20.4 (stable)', uptime: '3w2d4h12m', cpu: Math.round(wave(t, 9, 6)),
      memUsed: 310e6, memTotal: 1024e6, wan: { name: 'ether1-wan', running: true, rxBps: rx, txBps: tx },
      interfaces: [
        { name: 'ether1-wan', type: 'ether', running: true, disabled: false, rxBps: rx, txBps: tx, rxBytes: 9e12, txBytes: 1.2e12 },
        { name: 'bridge-lan', type: 'bridge', running: true, disabled: false, rxBps: tx, txBps: rx, rxBytes: 1.2e12, txBytes: 9e12 },
        { name: 'wg-home', type: 'wg', running: true, disabled: false, rxBps: Math.round(rx * 0.05), txBps: Math.round(tx * 0.3), rxBytes: 4e10, txBytes: 9e10 },
        { name: 'vlan20-iot', type: 'vlan', running: true, disabled: false, rxBps: 120e3, txBps: 40e3, rxBytes: 1e9, txBytes: 3e8 },
      ],
      leases: [['192.168.1.41', 'iPhone-Mislav'], ['192.168.1.55', 'AndroidTV'], ['192.168.1.12', 'iPad'], ['192.168.1.30', 'desktop'], ['192.168.1.60', 'shelly-plug']].map(([a, h], i) => ({ address: a, mac: `AA:BB:CC:00:00:${10 + i}`, host: h, status: 'bound' })),
      leaseCount: 37,
      peers: [
        { name: 'phone', iface: 'wg-home', endpoint: '89.164.1.20', lastHandshake: '42s', online: true, rx: 2e9, tx: 9e9 },
        { name: 'laptop', iface: 'wg-home', endpoint: undefined, lastHandshake: '3d4h', online: false, rx: 1e9, tx: 3e9 },
        { name: 'hosting-srv', iface: 'wg-home', endpoint: '185.12.3.4', lastHandshake: '1m10s', online: true, rx: 6e9, tx: 4e9 },
      ],
    });
  },
  widgets: [
    { id: 'traffic', name: 'MikroTik promet', description: 'WAN promet uživo s grafom, CPU, RAM', sizes: ['S', 'M', 'L'], defaultSize: 'M' },
    { id: 'interfaces', name: 'MikroTik sučelja', description: 'Sva sučelja s prometom', sizes: ['M', 'L'], defaultSize: 'M' },
    { id: 'clients', name: 'MikroTik DHCP i VPN', description: 'DHCP leaseovi i WireGuard peerovi', sizes: ['M', 'L', 'XL'], defaultSize: 'M' },
  ],
};
