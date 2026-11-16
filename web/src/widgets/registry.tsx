import type { CoreWidgetDef, WidgetComponent } from './types';
import { ProxmoxGuests, ProxmoxStorage, ProxmoxSummary } from './services/proxmox';
import { ArrCalendar, ArrOverview, ArrQueue } from './services/arr';
import { BazarrSubtitles, ImmichLibrary, MediarrLibrary, ProwlarrIndexers, SeerrRequests, StreameroLibrary, StreameroStreams } from './services/media';
import { AdguardStats, AdguardTop, MikrotikClients, MikrotikInterfaces, MikrotikTraffic, PangolinSites, QbtTorrents, QbtTransfer } from './services/net';
import { CpanelAccounts, DockerContainers, GenericValues, VaultwardenStatus, WhmServer } from './services/hosting';
import { Bookmarks, Calendar, Checks, Clock, Iframe, Incidents, MetricChart, Notes, StatusWall, Summary, Weather } from './core/core';

/** kind "<plugin>.<widget>" → component */
export const SERVICE_WIDGETS: Record<string, WidgetComponent> = {
  'proxmox.summary': ProxmoxSummary,
  'proxmox.guests': ProxmoxGuests,
  'proxmox.storage': ProxmoxStorage,
  'radarr.queue': ArrQueue, 'radarr.overview': ArrOverview, 'radarr.calendar': ArrCalendar,
  'sonarr.queue': ArrQueue, 'sonarr.overview': ArrOverview, 'sonarr.calendar': ArrCalendar,
  'bazarr.subtitles': BazarrSubtitles,
  'prowlarr.indexers': ProwlarrIndexers,
  'seerr.requests': SeerrRequests,
  'qbittorrent.transfer': QbtTransfer,
  'qbittorrent.torrents': QbtTorrents,
  'adguard.stats': AdguardStats,
  'adguard.top': AdguardTop,
  'mikrotik.traffic': MikrotikTraffic,
  'mikrotik.interfaces': MikrotikInterfaces,
  'mikrotik.clients': MikrotikClients,
  'pangolin.sites': PangolinSites,
  'vaultwarden.status': VaultwardenStatus,
  'whm.server': WhmServer,
  'cpanel.accounts': CpanelAccounts,
  'immich.library': ImmichLibrary,
  'mediarr.library': MediarrLibrary,
  'streamero.streams': StreameroStreams,
  'streamero.library': StreameroLibrary,
  'http-json.values': GenericValues,
  'prometheus.values': GenericValues,
  'docker.containers': DockerContainers,
};

export const CORE_WIDGETS: (CoreWidgetDef & { comp: WidgetComponent })[] = [
  { kind: 'core.statuswall', name: 'Status wall', description: 'All services and checks as tiles — readable from across the room', icon: 'grid', defaultSize: 'L', comp: StatusWall,
    options: [{ key: 'showChecks', label: 'Also show standalone checks', type: 'boolean', default: true }] },
  { kind: 'core.summary', name: 'Summary', description: 'Services, alerts, streams, WAN', icon: 'gauge', defaultSize: 'M', comp: Summary },
  { kind: 'core.checks', name: 'Uptime checks', description: 'Ping, TCP, HTTP, SSL and DNS with latency and uptime', icon: 'activity', defaultSize: 'M', comp: Checks,
    options: [{ key: 'types', label: 'Only these types (comma-separated: ping,tcp,http,ssl,dns)', type: 'string' }] },
  { kind: 'core.incidents', name: 'Incidents', description: 'Active alerts and recent incidents', icon: 'siren', defaultSize: 'M', comp: Incidents },
  { kind: 'core.chart', name: 'Metric chart', description: 'Service metric history (CPU, RAM, queue, traffic…)', icon: 'chart', defaultSize: 'M', comp: MetricChart, instancePlugins: 'any',
    options: [{ key: 'metrics', label: 'Metrics (comma-separated)', type: 'string', placeholder: 'cpu,mem' }, { key: 'range', label: 'Range (hours)', type: 'select', default: '6', options: [{ value: '1', label: '1 h' }, { value: '6', label: '6 h' }, { value: '24', label: '24 h' }, { value: '168', label: '7 d' }, { value: '720', label: '30 d' }] }] },
  { kind: 'core.calendar', name: 'Release calendar', description: 'Merged calendar from Radarr and Sonarr', icon: 'calendar', defaultSize: 'L', comp: Calendar },
  { kind: 'core.clock', name: 'Clock', description: 'Time and date', icon: 'clock', defaultSize: 'S', comp: Clock,
    options: [{ key: 'seconds', label: 'Show seconds', type: 'boolean', default: true }] },
  { kind: 'core.weather', name: 'Weather', description: 'Current weather and forecast (Open-Meteo)', icon: 'cloud', defaultSize: 'S', comp: Weather,
    options: [{ key: 'name', label: 'Location (name)', type: 'string' }, { key: 'lat', label: 'Latitude', type: 'number' }, { key: 'lon', label: 'Longitude', type: 'number' }] },
  { kind: 'core.notes', name: 'Notes', description: 'Short notes (markdown)', icon: 'notes', defaultSize: 'S', comp: Notes,
    options: [{ key: 'text', label: 'Text', type: 'text' }] },
  { kind: 'core.bookmarks', name: 'Links', description: 'Quick links to services', icon: 'link', defaultSize: 'S', comp: Bookmarks,
    options: [{ key: 'linksText', label: 'Links (Name | URL | icon), one per line', type: 'text' }] },
  { kind: 'core.iframe', name: 'Iframe', description: 'Embed any page', icon: 'frame', defaultSize: 'L', comp: Iframe,
    options: [{ key: 'url', label: 'URL', type: 'url' }] },
];
export const coreDef = (kind: string) => CORE_WIDGETS.find((c) => c.kind === kind);
export function componentFor(kind: string): WidgetComponent | undefined {
  return SERVICE_WIDGETS[kind] ?? coreDef(kind)?.comp;
}
