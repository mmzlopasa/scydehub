import type { Plugin } from './types.js';
import { proxmox } from './proxmox/index.js';
import { radarr, sonarr } from './arr/index.js';
import { bazarr } from './bazarr/index.js';
import { prowlarr } from './prowlarr/index.js';
import { seerr } from './seerr/index.js';
import { qbittorrent } from './qbittorrent/index.js';
import { adguard } from './adguard/index.js';
import { mikrotik } from './mikrotik/index.js';
import { vaultwarden } from './vaultwarden/index.js';
import { pangolin } from './pangolin/index.js';
import { whm } from './whm/index.js';
import { cpanel } from './cpanel/index.js';
import { immich } from './immich/index.js';
import { streamero } from './streamero/index.js';
import { mediarr } from './mediarr/index.js';
import { httpJson, prometheus, docker } from './generic/index.js';

/** Adding a service = new folder + one line here. The core never changes. */
export const plugins: Plugin<any, any>[] = [
  proxmox, streamero, mediarr, immich, radarr, sonarr, bazarr, prowlarr, seerr, qbittorrent,
  adguard, mikrotik, pangolin, vaultwarden, whm, cpanel, httpJson, prometheus, docker,
];
const byId = new Map(plugins.map((p) => [p.id, p]));
export const getPlugin = (id: string) => byId.get(id);

export function pluginMeta(p: Plugin<any, any>) {
  return {
    id: p.id, name: p.name, icon: p.icon, category: p.category, description: p.description, docsUrl: p.docsUrl,
    defaultInterval: p.defaultInterval, fields: p.fields, widgets: p.widgets,
    actions: (p.actions ?? []).map((a) => ({ id: a.id, label: a.label, description: a.description, danger: !!a.danger, params: a.params ?? [] })),
  };
}
