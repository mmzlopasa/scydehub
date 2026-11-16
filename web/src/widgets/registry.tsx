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
  { kind: 'core.statuswall', name: 'Status wall', description: 'Svi servisi i provjere kao pločice — čitljivo s druge strane sobe', icon: 'grid', defaultSize: 'L', comp: StatusWall,
    options: [{ key: 'showChecks', label: 'Prikaži i samostalne provjere', type: 'boolean', default: true }] },
  { kind: 'core.summary', name: 'Sažetak', description: 'Servisi, alerti, streamovi, WAN', icon: 'gauge', defaultSize: 'M', comp: Summary },
  { kind: 'core.checks', name: 'Uptime provjere', description: 'Ping, TCP, HTTP, SSL i DNS s latencijom i uptimeom', icon: 'activity', defaultSize: 'M', comp: Checks,
    options: [{ key: 'types', label: 'Samo tipovi (zarezom: ping,tcp,http,ssl,dns)', type: 'string' }] },
  { kind: 'core.incidents', name: 'Incidenti', description: 'Aktivni alerti i nedavni incidenti', icon: 'siren', defaultSize: 'M', comp: Incidents },
  { kind: 'core.chart', name: 'Graf metrike', description: 'Povijest metrika servisa (CPU, RAM, queue, promet…)', icon: 'chart', defaultSize: 'M', comp: MetricChart, instancePlugins: 'any',
    options: [{ key: 'metrics', label: 'Metrike (zarezom)', type: 'string', placeholder: 'cpu,mem' }, { key: 'range', label: 'Raspon (sati)', type: 'select', default: '6', options: [{ value: '1', label: '1 h' }, { value: '6', label: '6 h' }, { value: '24', label: '24 h' }, { value: '168', label: '7 d' }, { value: '720', label: '30 d' }] }] },
  { kind: 'core.calendar', name: 'Kalendar izlazaka', description: 'Spojeni kalendar iz Radarra i Sonarra', icon: 'calendar', defaultSize: 'L', comp: Calendar },
  { kind: 'core.clock', name: 'Sat', description: 'Vrijeme i datum', icon: 'clock', defaultSize: 'S', comp: Clock },
  { kind: 'core.weather', name: 'Vrijeme', description: 'Trenutno vrijeme i prognoza (Open-Meteo)', icon: 'cloud', defaultSize: 'S', comp: Weather,
    options: [{ key: 'name', label: 'Lokacija (naziv)', type: 'string' }, { key: 'lat', label: 'Latitude', type: 'number' }, { key: 'lon', label: 'Longitude', type: 'number' }] },
  { kind: 'core.notes', name: 'Bilješke', description: 'Kratke bilješke (markdown)', icon: 'notes', defaultSize: 'S', comp: Notes,
    options: [{ key: 'text', label: 'Tekst', type: 'text' }] },
  { kind: 'core.bookmarks', name: 'Linkovi', description: 'Brzi linkovi na servise', icon: 'link', defaultSize: 'S', comp: Bookmarks,
    options: [{ key: 'linksText', label: 'Linkovi (Naziv | URL | ikona), jedan po retku', type: 'text' }] },
  { kind: 'core.iframe', name: 'Iframe', description: 'Ugradi bilo koju stranicu', icon: 'frame', defaultSize: 'L', comp: Iframe,
    options: [{ key: 'url', label: 'URL', type: 'url' }] },
];
export const coreDef = (kind: string) => CORE_WIDGETS.find((c) => c.kind === kind);
export function componentFor(kind: string): WidgetComponent | undefined {
  return SERVICE_WIDGETS[kind] ?? coreDef(kind)?.comp;
}
