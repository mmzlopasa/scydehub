import type { Plugin, PluginContext, PluginAlert } from '../types.js';
import { tlsFields, pct, wave, jitter, clamp } from '../types.js';
import { createHttpClient } from '../../lib/http.js';
import { tlsFrom } from '../types.js';

interface Cfg {
  url: string; tokenId: string; tokenSecret: string; node?: string;
  actionTokenId?: string; actionTokenSecret?: string; backupMaxAgeHours?: number;
  tlsInsecure?: boolean; tlsFingerprint?: string;
}

export interface PveGuest {
  vmid: number; name: string; node: string; type: 'qemu' | 'lxc'; status: string; template?: boolean;
  cpu: number; maxcpu: number; mem: number; maxmem: number; disk: number; maxdisk: number;
  netin: number; netout: number; uptime: number; tags?: string;
  lastBackup?: number | null; snapshots?: number;
}
export interface PveNode {
  node: string; online: boolean; cpu: number; cpus: number; cpuModel?: string; mem: number; maxmem: number;
  swap?: number; maxswap?: number; rootfsUsed?: number; rootfsTotal?: number;
  loadavg: number[]; uptime: number; version?: string; kernel?: string; updates: number;
  /** Proxmox API does not expose temperatures; filled only by the mock or a future sensor source */
  temperature?: number | null;
}
export interface PveStorage { node: string; storage: string; type: string; used: number; total: number; avail: number; active: boolean; shared: boolean; content: string }
export interface PveData {
  nodes: PveNode[]; guests: PveGuest[]; storage: PveStorage[];
  lastBackupTask?: { status: string; start: number; end?: number; node: string } | null;
}

const hdr = (id: string, secret: string) => ({ Authorization: `PVEAPIToken=${id}=${secret}` });

async function collect(ctx: PluginContext<Cfg>) {
  const { http, config: c, scratch } = ctx;
  const nodesRaw = await http.get<{ data: any[] }>('/api2/json/nodes');
  if (!Array.isArray(nodesRaw?.data)) throw new Error('Unexpected answer from Proxmox — the URL must be https://host:8006');
  const nodeNames = nodesRaw.data.map((n) => n.node).filter((n) => !c.node || n === c.node);
  const nodes: PveNode[] = [];
  const storage: PveStorage[] = [];
  let lastBackupTask: PveData['lastBackupTask'] = null;
  const backups = new Map<number, number>();
  const slow = ctx.tick % 10 === 1; // heavier calls every ~10 polls

  for (const name of nodeNames) {
    const base = nodesRaw.data.find((n) => n.node === name);
    if (base?.status !== 'online') {
      nodes.push({ node: name, online: false, cpu: 0, cpus: 0, mem: 0, maxmem: 0, loadavg: [], uptime: 0, updates: 0 });
      continue;
    }
    const st = (await http.get<{ data: any }>(`/api2/json/nodes/${name}/status`)).data;
    if (slow || scratch.updates?.[name] === undefined) {
      scratch.updates ??= {};
      scratch.updates[name] = await http.get<{ data: any[] }>(`/api2/json/nodes/${name}/apt/update`).then((r) => r.data.length).catch(() => 0);
    }
    nodes.push({
      node: name, online: true, cpu: st.cpu, cpus: st.cpuinfo?.cpus ?? base.maxcpu, cpuModel: st.cpuinfo?.model,
      mem: st.memory?.used, maxmem: st.memory?.total, swap: st.swap?.used, maxswap: st.swap?.total,
      rootfsUsed: st.rootfs?.used, rootfsTotal: st.rootfs?.total, loadavg: (st.loadavg ?? []).map(Number),
      uptime: st.uptime, version: st.pveversion, kernel: st['current-kernel']?.release ?? st.kversion, updates: scratch.updates[name] ?? 0, temperature: null,
    });
    const stor = (await http.get<{ data: any[] }>(`/api2/json/nodes/${name}/storage`)).data;
    for (const s of stor) {
      storage.push({ node: name, storage: s.storage, type: s.type, used: s.used ?? 0, total: s.total ?? 0, avail: s.avail ?? 0, active: !!s.active, shared: !!s.shared, content: s.content ?? '' });
    }
    if (slow || !scratch.backups) {
      for (const s of stor.filter((s) => s.active && String(s.content).includes('backup'))) {
        if (s.shared && storage.some((x) => x.storage === s.storage && x.node !== name)) continue;
        const items = await http.get<{ data: any[] }>(`/api2/json/nodes/${name}/storage/${s.storage}/content`, { query: { content: 'backup' } }).catch(() => ({ data: [] }));
        for (const b of items.data) if (b.vmid) backups.set(Number(b.vmid), Math.max(backups.get(Number(b.vmid)) ?? 0, Number(b.ctime) * 1000));
      }
      const tasks = await http.get<{ data: any[] }>(`/api2/json/nodes/${name}/tasks`, { query: { typefilter: 'vzdump', limit: 5 } }).catch(() => ({ data: [] }));
      const t = tasks.data.find((x) => x.endtime); // finished
      if (t && (!lastBackupTask || t.starttime * 1000 > lastBackupTask.start))
        lastBackupTask = { status: t.status, start: t.starttime * 1000, end: t.endtime * 1000, node: name };
    }
  }
  if (slow || !scratch.backups) {
    scratch.backups = Object.fromEntries(backups);
    scratch.lastBackupTask = lastBackupTask;
  }
  lastBackupTask = scratch.lastBackupTask ?? null;

  const res = (await http.get<{ data: any[] }>('/api2/json/cluster/resources', { query: { type: 'vm' } })).data;
  const guests: PveGuest[] = res
    .filter((g) => !c.node || g.node === c.node)
    .map((g) => ({
      vmid: g.vmid, name: g.name ?? `${g.type}-${g.vmid}`, node: g.node, type: g.type, status: g.status, template: !!g.template,
      cpu: g.cpu ?? 0, maxcpu: g.maxcpu ?? 0, mem: g.mem ?? 0, maxmem: g.maxmem ?? 0, disk: g.disk ?? 0, maxdisk: g.maxdisk ?? 0,
      netin: g.netin ?? 0, netout: g.netout ?? 0, uptime: g.uptime ?? 0, tags: g.tags,
      lastBackup: scratch.backups?.[g.vmid] ?? null,
    }));

  // snapshot counts (one call per guest) — refreshed rarely
  if (slow || !scratch.snaps) {
    // guests on an offline node cannot answer (each call would hang until its timeout); the rest are asked in
    // small parallel batches with a short timeout so one slow guest never pushes the whole poll over its limit
    const offline = new Set(nodes.filter((n) => !n.online).map((n) => n.node));
    const todo = guests.filter((g) => !g.template && !offline.has(g.node));
    const snaps: Record<number, number> = { ...(scratch.snaps ?? {}) };
    for (let i = 0; i < todo.length; i += 8) {
      await Promise.all(todo.slice(i, i + 8).map(async (g) => {
        const r = await http.get<{ data: any[] }>(`/api2/json/nodes/${g.node}/${g.type}/${g.vmid}/snapshot`, { timeoutMs: 4000 }).catch(() => null);
        if (Array.isArray(r?.data)) snaps[g.vmid] = r.data.filter((s) => s.name !== 'current').length;
      }));
    }
    scratch.snaps = snaps;
  }
  for (const g of guests) g.snapshots = scratch.snaps?.[g.vmid];

  return build({ nodes, guests, storage, lastBackupTask }, c);
}

function build(data: PveData, c: Cfg) {
  const alerts: PluginAlert[] = [];
  for (const n of data.nodes) if (!n.online) alerts.push({ key: `node:${n.node}`, severity: 'critical', message: `Node ${n.node} is offline` });
  for (const s of data.storage) {
    const p = pct(s.used, s.total);
    if (s.active && p >= 90) alerts.push({ key: `storage:${s.node}:${s.storage}`, severity: p >= 95 ? 'critical' : 'warning', message: `Storage ${s.storage} is ${p}% full` });
  }
  if (data.lastBackupTask && data.lastBackupTask.status !== 'OK') {
    // "WARNINGS: 1" means the backup exists but something was skipped — worth a look, not an emergency
    const st = String(data.lastBackupTask.status);
    const warn = /^WARNINGS/i.test(st);
    alerts.push({ key: 'backup:task', severity: warn ? 'warning' : 'critical', message: warn ? `Last backup finished with ${st.toLowerCase()}` : `Last backup failed: ${st}` });
  }
  const maxAge = Number(c.backupMaxAgeHours) || 0;
  if (maxAge > 0) {
    for (const g of data.guests) {
      if (g.template) continue;
      if (!g.lastBackup || Date.now() - g.lastBackup > maxAge * 3600_000)
        alerts.push({ key: `backup:${g.vmid}`, severity: 'warning', message: `${g.name} has no backup in the last ${maxAge} h` });
    }
  }
  const online = data.nodes.filter((n) => n.online);
  const running = data.guests.filter((g) => g.status === 'running').length;
  const node = online[0];
  const metrics: Record<string, number> = {};
  if (node) {
    metrics.cpu = Math.round(node.cpu * 1000) / 10;
    metrics.mem = pct(node.mem, node.maxmem);
    metrics.load1 = node.loadavg[0] ?? 0;
    if (node.temperature) metrics.temp = node.temperature;
  }
  metrics.guests_running = running;
  for (const g of data.guests) {
    if (g.status !== 'running') continue;
    metrics[`g${g.vmid}_cpu`] = Math.round(g.cpu * 1000) / 10;
    metrics[`g${g.vmid}_mem`] = pct(g.mem, g.maxmem);
  }
  const anyOffline = data.nodes.some((n) => !n.online);
  return {
    status: anyOffline ? ('degraded' as const) : ('up' as const),
    summary: node ? `CPU ${metrics.cpu}% · RAM ${metrics.mem}% · ${running}/${data.guests.length} guests` : 'No nodes online',
    data, metrics, alerts,
  };
}

function guestParams() {
  return [
    { key: 'node', label: 'Node', type: 'string' as const, required: true },
    { key: 'type', label: 'Type', type: 'select' as const, options: [{ value: 'qemu', label: 'VM' }, { value: 'lxc', label: 'LXC' }], required: true },
    { key: 'vmid', label: 'VMID', type: 'number' as const, required: true },
  ];
}

function actionClient(ctx: PluginContext<Cfg>) {
  const c = ctx.config;
  if (c.actionTokenId && c.actionTokenSecret)
    return createHttpClient(c.url, { headers: hdr(c.actionTokenId, c.actionTokenSecret), tls: tlsFrom(c) });
  return ctx.http;
}
const power = (action: string, label: string, danger = false) => ({
  id: action, label, danger, params: guestParams(),
  async run(ctx: PluginContext<Cfg>, p: Record<string, any>) {
    if (!/^\d+$/.test(String(p.vmid)) || !['qemu', 'lxc'].includes(p.type) || !/^[\w.-]+$/.test(String(p.node))) throw new Error('Invalid parameters');
    const r = await actionClient(ctx).post<{ data: string }>(`/api2/json/nodes/${p.node}/${p.type}/${p.vmid}/status/${action}`, {});
    return `${label}: ${p.type} ${p.vmid} (task ${String(r?.data ?? '').split(':')[5] || 'started'})`;
  },
  mock(_ctx: PluginContext<Cfg>, p: Record<string, any>) {
    const g = mockState.guests.find((x) => x.vmid === Number(p.vmid));
    if (g) g.status = action === 'start' || action === 'reboot' ? 'running' : 'stopped';
    return `${label}: ${p.type} ${p.vmid} (mock)`;
  },
});

const mockState = {
  guests: [
    { vmid: 100, name: 'streamero', type: 'lxc', status: 'running', cpu: 0.12, mem: 2.1e9, maxmem: 4e9, disk: 18e9, maxdisk: 32e9 },
    { vmid: 101, name: 'arr-stack', type: 'lxc', status: 'running', cpu: 0.05, mem: 1.6e9, maxmem: 4e9, disk: 9e9, maxdisk: 20e9 },
    { vmid: 102, name: 'mediarr', type: 'lxc', status: 'running', cpu: 0.09, mem: 3.2e9, maxmem: 6e9, disk: 22e9, maxdisk: 40e9 },
    { vmid: 103, name: 'adguard', type: 'lxc', status: 'running', cpu: 0.01, mem: 0.2e9, maxmem: 0.5e9, disk: 1.2e9, maxdisk: 4e9 },
    { vmid: 104, name: 'vaultwarden', type: 'lxc', status: 'running', cpu: 0.005, mem: 0.15e9, maxmem: 0.5e9, disk: 0.8e9, maxdisk: 4e9 },
    { vmid: 105, name: 'scydehub', type: 'lxc', status: 'running', cpu: 0.02, mem: 0.3e9, maxmem: 1e9, disk: 2e9, maxdisk: 8e9 },
    { vmid: 106, name: 'pangolin', type: 'lxc', status: 'running', cpu: 0.01, mem: 0.25e9, maxmem: 1e9, disk: 2e9, maxdisk: 8e9 },
    { vmid: 200, name: 'mikrotik-chr', type: 'qemu', status: 'running', cpu: 0.03, mem: 0.5e9, maxmem: 1e9, disk: 0, maxdisk: 1e9 },
    { vmid: 201, name: 'win11-test', type: 'qemu', status: 'stopped', cpu: 0, mem: 0, maxmem: 8e9, disk: 0, maxdisk: 64e9 },
  ] as any[],
};

export const proxmox: Plugin<Cfg, PveData> = {
  id: 'proxmox', name: 'Proxmox VE', icon: 'proxmox', category: 'infrastructure',
  description: 'Host, LXC and VM: resources, storage, backups, snapshots, updates and guest management.',
  docsUrl: 'https://pve.proxmox.com/pve-docs/api-viewer/',
  defaultInterval: 15,
  fields: [
    { key: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://192.168.1.10:8006' },
    { key: 'tokenId', label: 'API token ID (read-only)', type: 'string', required: true, placeholder: 'hub@pve!monitor', help: 'Token with the PVEAuditor role on /. Listing updates needs Sys.Modify, and listing backups needs Datastore.AllocateSpace + VM.Backup (otherwise that data is not shown).' },
    { key: 'tokenSecret', label: 'API token secret', type: 'secret', required: true },
    { key: 'node', label: 'Only this node (optional)', type: 'string', placeholder: 'pve' },
    { key: 'actionTokenId', label: 'Action token ID (optional)', type: 'string', placeholder: 'hub@pve!actions', help: 'Separate token with VM.PowerMgmt. Without it, actions use the read-only token and will fail.' },
    { key: 'actionTokenSecret', label: 'Action token secret', type: 'secret' },
    { key: 'backupMaxAgeHours', label: 'Warn if a guest has no backup newer than (h)', type: 'number', default: 0, help: '0 = disabled' },
    ...tlsFields,
  ],
  http: (c) => ({ baseUrl: c.url, headers: hdr(c.tokenId, c.tokenSecret) }),
  collect,
  mock(ctx) {
    const t = ctx.tick;
    for (const g of mockState.guests) if (g.status === 'running') g.cpu = clamp(jitter(g.cpu || 0.02, 0.4), 0.001, 0.95);
    const now = Date.now();
    const data: PveData = {
      nodes: [{
        node: 'pve', online: true, cpu: clamp(wave(t, 0.18, 0.08) + Math.random() * 0.04, 0, 1), cpus: 16, cpuModel: 'AMD Ryzen 7 5700G',
        mem: wave(t, 41e9, 2e9, 40), maxmem: 64e9, swap: 0.2e9, maxswap: 8e9, rootfsUsed: 21e9, rootfsTotal: 94e9,
        loadavg: [wave(t, 1.4, 0.5), 1.3, 1.1].map((x) => Math.round(x * 100) / 100), uptime: 1_234_567 + t * 15,
        version: 'pve-manager/9.1.1', kernel: '6.17.2-1-pve', updates: 7, temperature: Math.round(wave(t, 52, 6)),
      }],
      guests: mockState.guests.map((g) => ({
        ...g, node: 'pve', maxcpu: g.type === 'qemu' ? 2 : 4, netin: 1e9 + t * 2e6, netout: 3e9 + t * 9e6,
        uptime: g.status === 'running' ? 864000 + t * 15 : 0, mem: g.status === 'running' ? jitter(g.mem, 0.03) : 0,
        lastBackup: now - (g.vmid === 201 ? 9 * 86400_000 : (6 + (g.vmid % 5)) * 3600_000), snapshots: g.vmid % 3,
      })),
      storage: [
        { node: 'pve', storage: 'local', type: 'dir', used: 21e9, total: 94e9, avail: 73e9, active: true, shared: false, content: 'iso,vztmpl,backup' },
        { node: 'pve', storage: 'local-zfs', type: 'zfspool', used: 412e9, total: 900e9, avail: 488e9, active: true, shared: false, content: 'images,rootdir' },
        { node: 'pve', storage: 'tank', type: 'zfspool', used: 15.1e12, total: 18e12, avail: 2.9e12, active: true, shared: false, content: 'images,rootdir' },
        { node: 'pve', storage: 'pbs', type: 'pbs', used: 2.2e12, total: 4e12, avail: 1.8e12, active: true, shared: true, content: 'backup' },
      ],
      lastBackupTask: { status: 'OK', start: now - 7 * 3600_000, end: now - 6.6 * 3600_000, node: 'pve' },
    };
    return build(data, ctx.config);
  },
  actions: [power('start', 'Start'), power('shutdown', 'Shut down (graceful)', true), power('reboot', 'Reboot', true), power('stop', 'Force stop', true)],
  widgets: [
    { id: 'summary', name: 'Proxmox host', description: 'CPU, RAM, load, temperature, uptime, version and updates', sizes: ['S', 'M', 'L'], defaultSize: 'M' },
    { id: 'guests', name: 'LXC and VM', description: 'All guests with status, resources, backup and actions', sizes: ['M', 'L', 'XL'], defaultSize: 'L' },
    { id: 'storage', name: 'Proxmox storage', description: 'Usage of all storages', sizes: ['S', 'M', 'L'], defaultSize: 'M' },
  ],
};
