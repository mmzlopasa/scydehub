import { q } from './db.js';
import { randomId } from './lib/crypto.js';
import { createInstance, listInstances } from './instances.js';

/** Creates a complete mock homelab (all integrations in mock mode) + boards, for development and first impressions. */
export function seedDemo() {
  const existing = new Set(listInstances().map((i) => i.plugin));
  const mk = (plugin: string, name: string, config: Record<string, any> = {}) =>
    existing.has(plugin) ? listInstances().find((i) => i.plugin === plugin)! : createInstance({ plugin, name, config: { url: 'http://demo.local', ...config }, mock: true });

  const I = {
    pve: mk('proxmox', 'Proxmox', { tokenId: 'hub@pve!monitor', tokenSecret: 'demo', backupMaxAgeHours: 48 }),
    streamero: mk('streamero', 'Streamero'),
    mediarr: mk('mediarr', 'Mediarr'),
    immich: mk('immich', 'Immich', { apiKey: 'demo' }),
    radarr: mk('radarr', 'Radarr', { apiKey: 'demo' }),
    sonarr: mk('sonarr', 'Sonarr', { apiKey: 'demo' }),
    bazarr: mk('bazarr', 'Bazarr', { apiKey: 'demo' }),
    prowlarr: mk('prowlarr', 'Prowlarr', { apiKey: 'demo' }),
    seerr: mk('seerr', 'Seerr', { apiKey: 'demo' }),
    qbt: mk('qbittorrent', 'qBittorrent', { username: 'admin', password: 'demo' }),
    adguard: mk('adguard', 'AdGuard Home', { username: 'admin', password: 'demo' }),
    mikrotik: mk('mikrotik', 'MikroTik CHR', { username: 'hub', password: 'demo', wanInterface: 'ether1-wan' }),
    pangolin: mk('pangolin', 'Pangolin', { apiKey: 'demo', orgId: 'home' }),
    vault: mk('vaultwarden', 'Vaultwarden'),
    whm: mk('whm', 'WHM', { username: 'root', token: 'demo' }),
    cpanel: mk('cpanel', 'cPanel', { mode: 'whm', username: 'root', token: 'demo', accounts: 'scyde,klijent1' }),
    docker: mk('docker', 'Docker (hub LXC)', { url: 'unix:///var/run/docker.sock' }),
  };

  if (!q.get('SELECT 1 FROM checks LIMIT 1')) {
    const chk = (name: string, type: string, target: string, options: object = {}, instance?: string) =>
      q.run('INSERT INTO checks (id, name, type, target, options, interval_sec, enabled, instance_id, created_at) VALUES (?,?,?,?,?,60,1,?,?)',
        randomId(), name, type, target, JSON.stringify({ mock: true, ...options }), instance ?? null, Date.now());
    chk('Proxmox host', 'ping', '192.168.1.10', {}, I.pve.id);
    chk('MikroTik gateway', 'ping', '192.168.1.1', {}, I.mikrotik.id);
    chk('AdGuard DNS', 'dns', 'scyde.net', { server: '192.168.1.2' }, I.adguard.id);
    chk('Streamero web', 'http', 'https://streamero.scyde.net', { keyword: 'Streamero' }, I.streamero.id);
    chk('Vaultwarden', 'http', 'https://vault.scyde.net/alive', {}, I.vault.id);
    chk('Seerr', 'tcp', '192.168.1.20:5055', {}, I.seerr.id);
    chk('scyde.net SSL', 'ssl', 'scyde.net', { warnDays: 14 });
    chk('vault.scyde.net SSL', 'ssl', 'vault.scyde.net', { warnDays: 14 });
    chk('Google DNS', 'ping', '8.8.8.8');
  }

  if (!q.get('SELECT 1 FROM boards LIMIT 1')) {
    let sort = 0;
    const board = (name: string, icon: string) => {
      const id = randomId();
      q.run('INSERT INTO boards (id, name, icon, sort, in_rotation, created_at) VALUES (?,?,?,?,1,?)', id, name, icon, sort++, Date.now());
      return id;
    };
    let t = Date.now();
    const w = (board: string, kind: string, size: string, instance?: { id: string }, options: object = {}, title?: string) =>
      q.run('INSERT INTO widgets (id, board_id, kind, instance_id, title, size, options, created_at) VALUES (?,?,?,?,?,?,?,?)',
        randomId(), board, kind, instance?.id ?? null, title ?? null, size, JSON.stringify(options), t++);

    const ov = board('Overview', 'layout-dashboard');
    w(ov, 'core.clock', 'S');
    w(ov, 'core.weather', 'S');
    w(ov, 'proxmox.summary', 'M', I.pve);
    w(ov, 'core.statuswall', 'L');
    w(ov, 'streamero.streams', 'M', I.streamero);
    w(ov, 'qbittorrent.transfer', 'S', I.qbt);
    w(ov, 'mikrotik.traffic', 'M', I.mikrotik);
    w(ov, 'adguard.stats', 'M', I.adguard);
    w(ov, 'seerr.requests', 'M', I.seerr);
    w(ov, 'core.incidents', 'M');

    const media = board('Media', 'clapperboard');
    w(media, 'streamero.streams', 'M', I.streamero);
    w(media, 'streamero.library', 'M', I.streamero);
    w(media, 'radarr.queue', 'M', I.radarr);
    w(media, 'sonarr.queue', 'M', I.sonarr);
    w(media, 'qbittorrent.torrents', 'L', I.qbt);
    w(media, 'core.calendar', 'L');
    w(media, 'seerr.requests', 'M', I.seerr);
    w(media, 'radarr.overview', 'S', I.radarr);
    w(media, 'sonarr.overview', 'S', I.sonarr);
    w(media, 'bazarr.subtitles', 'S', I.bazarr);
    w(media, 'prowlarr.indexers', 'M', I.prowlarr);
    w(media, 'immich.library', 'M', I.immich);
    w(media, 'mediarr.library', 'S', I.mediarr);

    const infra = board('Infrastructure', 'server');
    w(infra, 'proxmox.summary', 'M', I.pve);
    w(infra, 'proxmox.storage', 'M', I.pve);
    w(infra, 'core.chart', 'M', I.pve, { metrics: ['cpu', 'mem'], range: 6 }, 'Proxmox CPU / RAM');
    w(infra, 'proxmox.guests', 'XL', I.pve);
    w(infra, 'docker.containers', 'M', I.docker);
    w(infra, 'vaultwarden.status', 'S', I.vault);
    w(infra, 'core.checks', 'L');

    const net = board('Network', 'network');
    w(net, 'mikrotik.traffic', 'L', I.mikrotik);
    w(net, 'mikrotik.interfaces', 'M', I.mikrotik);
    w(net, 'mikrotik.clients', 'M', I.mikrotik);
    w(net, 'adguard.stats', 'M', I.adguard);
    w(net, 'adguard.top', 'L', I.adguard);
    w(net, 'pangolin.sites', 'M', I.pangolin);

    const host = board('Hosting', 'globe');
    w(host, 'whm.server', 'M', I.whm);
    w(host, 'cpanel.accounts', 'L', I.cpanel);
    w(host, 'core.checks', 'M', undefined, { types: ['ssl', 'http'] }, 'Web and certificates');
    w(host, 'core.bookmarks', 'S', undefined, { links: [{ name: 'WHM', url: 'https://server.example.com:2087' }, { name: 'Proxmox', url: 'https://192.168.1.10:8006' }, { name: 'AdGuard', url: 'http://192.168.1.2' }] });
    w(host, 'core.notes', 'S', undefined, { text: '## Notes\n- Renew the scyde.net domain in March\n- Check PBS retention' });
  }
  return { instances: Object.keys(I).length };
}
