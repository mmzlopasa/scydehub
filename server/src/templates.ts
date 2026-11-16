import { q, json } from './db.js';
import { randomId } from './lib/crypto.js';
import { getPlugin } from './plugins/registry.js';
import { InputError, createInstance, listInstances, type InstanceRow } from './instances.js';

/**
 * A board template: boards + widgets + positions, but no services and no secrets.
 * Widgets name the plugin they need; on import they are attached to your own service of that type.
 */
export interface TemplateWidget {
  kind: string;
  /** plugin this widget reads from (omit for clock, notes, status wall …) */
  plugin?: string;
  title?: string;
  size?: 'S' | 'M' | 'L' | 'XL';
  options?: Record<string, unknown>;
  /** position per device type on the 24-column grid: [x, y, w, h] */
  layout: Partial<Record<'desktop' | 'tv' | 'tablet' | 'mobile', [number, number, number, number]>>;
}
export interface TemplateBoard { name: string; icon?: string; inRotation?: boolean; widgets: TemplateWidget[] }
export interface Template {
  app: 'scydehub-template';
  version: 1;
  id?: string;
  name: string;
  description?: string;
  /** used only when a service of that type does not exist yet and "create missing" is on (always created in mock mode) */
  services?: { plugin: string; name: string; config?: Record<string, unknown> }[];
  boards: TemplateBoard[];
}

const W = (kind: string, plugin: string | undefined, x: number, y: number, w: number, h: number, extra: Partial<TemplateWidget> = {}): TemplateWidget =>
  ({ kind, ...(plugin ? { plugin } : {}), layout: { desktop: [x, y, w, h] }, ...extra });

/**
 * Every widget of every integration, arranged on a 24-column grid for a 1080p–1440p monitor.
 * Rows line up on shared heights so no board has ragged edges; TV, tablet and phone layouts are derived from it.
 */
export const COMPLETE: Template = {
  app: 'scydehub-template',
  version: 1,
  id: 'complete-homelab',
  name: 'Complete homelab',
  description: 'Seven boards with every widget of every integration: Overview, Media, Infrastructure, Network, Hosting, Wall and Tools.',
  services: [
    { plugin: 'proxmox', name: 'Proxmox' }, { plugin: 'streamero', name: 'Streamero' }, { plugin: 'mediarr', name: 'Mediarr' }, { plugin: 'immich', name: 'Immich' },
    { plugin: 'radarr', name: 'Radarr' }, { plugin: 'sonarr', name: 'Sonarr' }, { plugin: 'bazarr', name: 'Bazarr' }, { plugin: 'prowlarr', name: 'Prowlarr' },
    { plugin: 'seerr', name: 'Seerr' }, { plugin: 'qbittorrent', name: 'qBittorrent' }, { plugin: 'adguard', name: 'AdGuard Home' },
    { plugin: 'mikrotik', name: 'MikroTik', config: { wanInterface: 'ether1-wan' } }, { plugin: 'pangolin', name: 'Pangolin' }, { plugin: 'vaultwarden', name: 'Vaultwarden' },
    { plugin: 'whm', name: 'WHM' }, { plugin: 'cpanel', name: 'cPanel', config: { mode: 'whm', accounts: 'account1,account2' } },
    { plugin: 'docker', name: 'Docker', config: { url: 'http://docker-socket-proxy:2375' } },
    { plugin: 'prometheus', name: 'Prometheus', config: { queries: 'CPU temp = max(node_hwmon_temp_celsius) | °C\nLoad = node_load1 | \nDisk used = 100 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"} * 100) | %\nUPS load = ups_load | %' } },
    { plugin: 'http-json', name: 'Custom API', config: { fields: 'Users = stats.users | \nRequests = stats.requests | /min\nErrors = stats.errors | \nQueue = stats.queue | ' } },
  ],
  boards: [
    {
      name: 'Overview', icon: 'layout-dashboard',
      widgets: [
        W('core.clock', undefined, 0, 0, 5, 6),
        W('core.weather', undefined, 5, 0, 5, 6),
        W('core.summary', undefined, 10, 0, 7, 6, { title: 'At a glance' }),
        W('core.incidents', undefined, 17, 0, 7, 6),
        W('core.statuswall', undefined, 0, 6, 10, 16),
        W('proxmox.summary', 'proxmox', 10, 6, 7, 8),
        W('streamero.streams', 'streamero', 17, 6, 7, 8, { title: 'Now playing' }),
        W('qbittorrent.transfer', 'qbittorrent', 10, 14, 7, 8),
        W('mikrotik.traffic', 'mikrotik', 17, 14, 7, 8, { title: 'Internet' }),
        W('adguard.stats', 'adguard', 0, 22, 8, 9),
        W('seerr.requests', 'seerr', 8, 22, 8, 9),
        W('core.checks', undefined, 16, 22, 8, 9, { title: 'Uptime' }),
      ],
    },
    {
      name: 'Media', icon: 'clapperboard',
      widgets: [
        W('streamero.streams', 'streamero', 0, 0, 8, 9, { title: 'Now playing' }),
        W('streamero.library', 'streamero', 8, 0, 8, 9, { title: 'Library' }),
        W('seerr.requests', 'seerr', 16, 0, 8, 9),
        W('radarr.queue', 'radarr', 0, 9, 8, 10, { title: 'Movies — downloading' }),
        W('sonarr.queue', 'sonarr', 8, 9, 8, 10, { title: 'Series — downloading' }),
        W('qbittorrent.torrents', 'qbittorrent', 16, 9, 8, 10, { title: 'Torrents' }),
        W('core.calendar', undefined, 0, 19, 8, 10, { title: 'Release calendar' }),
        W('radarr.calendar', 'radarr', 8, 19, 8, 10, { title: 'Upcoming movies' }),
        W('sonarr.calendar', 'sonarr', 16, 19, 8, 10, { title: 'Upcoming episodes' }),
        W('radarr.overview', 'radarr', 0, 29, 5, 8),
        W('sonarr.overview', 'sonarr', 5, 29, 5, 8),
        W('bazarr.subtitles', 'bazarr', 10, 29, 7, 8),
        W('prowlarr.indexers', 'prowlarr', 17, 29, 7, 8),
        W('immich.library', 'immich', 0, 37, 10, 9),
        W('mediarr.library', 'mediarr', 10, 37, 6, 9),
        W('qbittorrent.transfer', 'qbittorrent', 16, 37, 8, 9, { title: 'Transfer speed' }),
      ],
    },
    {
      name: 'Infrastructure', icon: 'server',
      widgets: [
        W('proxmox.summary', 'proxmox', 0, 0, 8, 8, { title: 'Proxmox host' }),
        W('proxmox.storage', 'proxmox', 8, 0, 8, 8, { title: 'Storage' }),
        W('core.chart', 'proxmox', 16, 0, 8, 8, { title: 'CPU / RAM — 24 h', options: { metrics: ['cpu', 'mem'], range: 24 } }),
        W('proxmox.guests', 'proxmox', 0, 8, 24, 14, { title: 'Containers & virtual machines' }),
        W('docker.containers', 'docker', 0, 22, 8, 9),
        W('prometheus.values', 'prometheus', 8, 22, 5, 9, { title: 'Sensors' }),
        W('http-json.values', 'http-json', 13, 22, 5, 9),
        W('vaultwarden.status', 'vaultwarden', 18, 22, 6, 9),
        W('core.checks', undefined, 0, 31, 14, 10, { title: 'Uptime checks' }),
        W('core.incidents', undefined, 14, 31, 10, 10),
      ],
    },
    {
      name: 'Network', icon: 'network',
      widgets: [
        W('mikrotik.traffic', 'mikrotik', 0, 0, 11, 9, { title: 'WAN traffic' }),
        W('mikrotik.interfaces', 'mikrotik', 11, 0, 6, 9, { title: 'Interfaces' }),
        W('pangolin.sites', 'pangolin', 17, 0, 7, 9),
        W('adguard.stats', 'adguard', 0, 9, 8, 9),
        W('adguard.top', 'adguard', 8, 9, 16, 9, { title: 'DNS — top lists' }),
        W('mikrotik.clients', 'mikrotik', 0, 18, 12, 10, { title: 'VPN peers & DHCP leases' }),
        W('core.checks', undefined, 12, 18, 12, 10, { title: 'Network checks', options: { types: ['ping', 'tcp', 'dns'] } }),
        W('core.chart', 'mikrotik', 0, 28, 12, 8, { title: 'WAN — 24 h', options: { metrics: ['wan_rx', 'wan_tx'], range: 24 } }),
        W('core.chart', 'adguard', 12, 28, 12, 8, { title: 'Blocked share — 7 days', options: { metrics: ['blocked_pct'], range: 168 } }),
      ],
    },
    {
      name: 'Hosting', icon: 'globe',
      widgets: [
        W('whm.server', 'whm', 0, 0, 11, 10, { title: 'WHM server' }),
        W('cpanel.accounts', 'cpanel', 11, 0, 13, 10, { title: 'cPanel accounts' }),
        W('core.checks', undefined, 0, 10, 10, 8, { title: 'Websites & certificates', options: { types: ['http', 'ssl'] } }),
        W('core.chart', 'whm', 10, 10, 8, 8, { title: 'Server load — 24 h', options: { metrics: ['load1', 'load5'], range: 24 } }),
        W('vaultwarden.status', 'vaultwarden', 18, 10, 6, 8),
      ],
    },
    {
      name: 'Wall', icon: 'tv',
      widgets: [
        W('core.clock', undefined, 0, 0, 7, 7, { options: { seconds: false } }),
        W('core.summary', undefined, 7, 0, 10, 7, { title: 'At a glance' }),
        W('core.weather', undefined, 17, 0, 7, 7),
        W('core.statuswall', undefined, 0, 7, 24, 10, { title: 'All services' }),
        W('core.incidents', undefined, 0, 17, 10, 9),
        W('core.checks', undefined, 10, 17, 14, 9, { title: 'Uptime' }),
      ],
    },
    {
      name: 'Tools', icon: 'box', inRotation: false,
      widgets: [
        W('core.bookmarks', undefined, 0, 0, 8, 7, { title: 'Quick links', options: { links: [
          { name: 'Proxmox', url: 'https://192.168.1.10:8006', icon: 'proxmox' }, { name: 'AdGuard Home', url: 'http://192.168.1.2', icon: 'adguard-home' },
          { name: 'Radarr', url: 'http://192.168.1.20:7878', icon: 'radarr' }, { name: 'Sonarr', url: 'http://192.168.1.20:8989', icon: 'sonarr' },
          { name: 'qBittorrent', url: 'http://192.168.1.20:8080', icon: 'qbittorrent' }, { name: 'Cloudflare', url: 'https://one.dash.cloudflare.com', icon: 'cloudflare' },
        ] } }),
        W('core.notes', undefined, 8, 0, 8, 7, { options: { text: '## Notes\n- Replace the links on the left with your own addresses\n- Every widget here can be moved, resized or removed in **Edit** mode\n- Services created by the template run in **mock mode** until you enter their real URL and key in Settings → Services' } }),
        W('core.chart', 'qbittorrent', 16, 0, 8, 7, { title: 'Download speed — 6 h', options: { metrics: ['dl', 'up'], range: 6 } }),
        W('core.iframe', undefined, 0, 7, 24, 12, { title: 'Embedded page (set a URL in the widget settings)' }),
      ],
    },
  ],
};

export const BUILT_IN: Template[] = [COMPLETE];

// ------------------------------------------------------------------ validation
const KIND = /^[a-z0-9-]{1,40}\.[a-z0-9-]{1,40}$/;
const PROFILES = ['desktop', 'tv', 'tablet', 'mobile'] as const;
const SIZES = ['S', 'M', 'L', 'XL'];
const str = (v: unknown, max: number, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);
const num = (v: unknown, min: number, max: number) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) throw new InputError('Template: a widget position is not a number');
  return Math.min(max, Math.max(min, n));
};

/** Returns a cleaned copy or throws InputError. Nothing from the file is trusted. */
export function parseTemplate(raw: unknown): Template {
  const t = raw as any;
  if (!t || typeof t !== 'object' || t.app !== 'scydehub-template' || !Array.isArray(t.boards)) throw new InputError('This is not a SCYDE Hub board template');
  if (t.boards.length < 1 || t.boards.length > 40) throw new InputError('Template: between 1 and 40 boards are allowed');
  const boards: TemplateBoard[] = t.boards.map((b: any) => {
    if (!b || typeof b !== 'object' || !Array.isArray(b.widgets)) throw new InputError('Template: a board has no widget list');
    if (b.widgets.length > 300) throw new InputError('Template: too many widgets on one board');
    return {
      name: str(b.name, 60, 'Board'), icon: str(b.icon, 40, 'layout-grid'), inRotation: b.inRotation !== false,
      widgets: b.widgets.map((w: any): TemplateWidget => {
        if (!w || typeof w.kind !== 'string' || !KIND.test(w.kind)) throw new InputError('Template: a widget has an invalid kind');
        if (w.plugin !== undefined && (typeof w.plugin !== 'string' || !getPlugin(w.plugin))) throw new InputError(`Template: unknown integration "${String(w.plugin).slice(0, 40)}"`);
        const options = w.options && typeof w.options === 'object' && !Array.isArray(w.options) ? w.options : {};
        if (JSON.stringify(options).length > 64_000) throw new InputError('Template: widget options are too large');
        const layout: TemplateWidget['layout'] = {};
        for (const p of PROFILES) {
          const l = w.layout?.[p];
          if (Array.isArray(l) && l.length === 4) layout[p] = [num(l[0], 0, 200), num(l[1], 0, 100_000), num(l[2], 1, 200), num(l[3], 1, 1000)];
        }
        return { kind: w.kind, plugin: w.plugin, title: typeof w.title === 'string' ? w.title.slice(0, 100) : undefined, size: SIZES.includes(w.size) ? w.size : 'M', options, layout };
      }),
    };
  });
  const services = (Array.isArray(t.services) ? t.services : []).slice(0, 100)
    .filter((s: any) => s && typeof s.plugin === 'string' && getPlugin(s.plugin))
    .map((s: any) => ({ plugin: s.plugin as string, name: str(s.name, 80, getPlugin(s.plugin)!.name), config: s.config && typeof s.config === 'object' && !Array.isArray(s.config) ? s.config : {} }));
  return { app: 'scydehub-template', version: 1, name: str(t.name, 80, 'Template'), description: str(t.description, 300, ''), services, boards };
}

export interface ImportResult { boards: number; widgets: number; skipped: number; created: { id: string; name: string; plugin: string }[]; missing: string[] }

/**
 * Create the template's boards. Widgets attach to the first existing service of their type; for types you
 * do not have yet either a mock placeholder service is created (createMissing) or the widget is skipped.
 */
export function importTemplate(tpl: Template, opts: { createMissing: boolean; replace: boolean }): ImportResult {
  const res: ImportResult = { boards: 0, widgets: 0, skipped: 0, created: [], missing: [] };
  const byPlugin = new Map<string, InstanceRow>();
  for (const i of listInstances()) if (!byPlugin.has(i.plugin)) byPlugin.set(i.plugin, i);
  const need = new Set(tpl.boards.flatMap((b) => b.widgets.map((w) => w.plugin).filter((p): p is string => !!p)));
  for (const plugin of need) {
    if (byPlugin.has(plugin)) continue;
    if (!opts.createMissing) { res.missing.push(getPlugin(plugin)?.name ?? plugin); continue; }
    const def = tpl.services?.find((s) => s.plugin === plugin);
    // placeholders never carry secrets and never contact anything: they run in mock mode until edited
    const safeConfig = Object.fromEntries(Object.entries(def?.config ?? {}).filter(([k]) => getPlugin(plugin)!.fields.some((f) => f.key === k && f.type !== 'secret')));
    const row = createInstance({ plugin, name: def?.name ?? getPlugin(plugin)!.name, config: { url: 'http://example.invalid', ...safeConfig }, mock: true });
    byPlugin.set(plugin, row);
    res.created.push({ id: row.id, name: row.name, plugin });
  }
  q.tx(() => {
    if (opts.replace) q.run('DELETE FROM boards');
    let sort = q.get<{ m: number }>('SELECT COALESCE(MAX(sort), -1) + 1 m FROM boards')!.m;
    let t = Date.now();
    for (const b of tpl.boards) {
      const boardId = randomId();
      q.run('INSERT INTO boards (id, name, icon, sort, in_rotation, created_at, options) VALUES (?,?,?,?,?,?,?)', boardId, b.name, b.icon ?? 'layout-grid', sort++, b.inRotation === false ? 0 : 1, t, '{}');
      const layouts: Record<string, { i: string; x: number; y: number; w: number; h: number }[]> = {};
      for (const w of b.widgets) {
        const inst = w.plugin ? byPlugin.get(w.plugin) : undefined;
        if (w.plugin && !inst) { res.skipped++; continue; }
        const id = randomId();
        q.run('INSERT INTO widgets (id, board_id, kind, instance_id, title, size, options, created_at) VALUES (?,?,?,?,?,?,?,?)',
          id, boardId, w.kind, inst?.id ?? null, w.title ?? null, w.size ?? 'M', JSON.stringify(w.options ?? {}), t++);
        for (const [profile, l] of Object.entries(w.layout)) (layouts[profile] ??= []).push({ i: id, x: l![0], y: l![1], w: l![2], h: l![3] });
        res.widgets++;
      }
      for (const [profile, l] of Object.entries(layouts)) q.run('INSERT INTO layouts (board_id, profile, layout) VALUES (?,?,?)', boardId, profile, JSON.stringify(l));
      res.boards++;
    }
  });
  return res;
}

/** Your current boards as a template (no services, no secrets) — to share, or to move a layout to another Hub. */
export function exportTemplate(): Template {
  const instances = new Map(listInstances().map((i) => [i.id, i]));
  const boards = q.all('SELECT * FROM boards ORDER BY sort, created_at').map((b): TemplateBoard => {
    const layouts = q.all('SELECT profile, layout FROM layouts WHERE board_id = ?', b.id);
    const pos = new Map<string, TemplateWidget['layout']>();
    for (const l of layouts) for (const it of json<any[]>(l.layout, [])) {
      if (!it || typeof it.i !== 'string') continue;
      const e = pos.get(it.i) ?? {};
      (e as any)[l.profile] = [it.x, it.y, it.w, it.h];
      pos.set(it.i, e);
    }
    return {
      name: b.name, icon: b.icon ?? 'layout-grid', inRotation: !!b.in_rotation,
      widgets: q.all('SELECT * FROM widgets WHERE board_id = ? ORDER BY created_at', b.id).map((w): TemplateWidget => ({
        kind: w.kind, plugin: w.instance_id ? instances.get(w.instance_id)?.plugin : undefined, title: w.title ?? undefined, size: w.size,
        options: json(w.options, {}), layout: pos.get(w.id) ?? {},
      })),
    };
  });
  const used = new Set(boards.flatMap((b) => b.widgets.map((w) => w.plugin)).filter(Boolean) as string[]);
  return {
    app: 'scydehub-template', version: 1, name: 'My boards', description: `Exported ${new Date().toISOString().slice(0, 10)}`,
    services: [...used].map((p) => ({ plugin: p, name: getPlugin(p)?.name ?? p })), boards,
  };
}
