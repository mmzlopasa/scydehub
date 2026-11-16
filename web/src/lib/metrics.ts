import { bits, bytes } from './format';

/** Human names and units for the metric keys integrations store in history. */
const M: Record<string, [string, 'pct' | 'bits' | 'bytes' | 'bps' | 'ms' | 'num']> = {
  _latency: ['Response time', 'ms'], _up: ['Availability', 'num'], cpu: ['CPU', 'pct'], mem: ['RAM', 'pct'], load1: ['Load (1 min)', 'num'], load5: ['Load (5 min)', 'num'],
  temp: ['Temperature', 'num'], queue: ['Queue', 'num'], missing: ['Missing', 'num'], library: ['Library', 'num'], dl: ['Download', 'bps'], up: ['Upload', 'bps'],
  wan_rx: ['WAN down', 'bits'], wan_tx: ['WAN up', 'bits'], queries: ['DNS queries', 'num'], blocked: ['Blocked', 'num'], blocked_pct: ['Blocked', 'pct'], avg_ms: ['DNS response', 'ms'],
  streams: ['Streams', 'num'], transcodes: ['Transcodes', 'num'], bandwidth: ['Bandwidth', 'bits'], pending: ['Pending', 'num'], processing: ['Processing', 'num'], available: ['Available', 'num'],
  guests_running: ['Running guests', 'num'], indexers_ok: ['Indexers OK', 'num'], indexers_failing: ['Indexers failing', 'num'], grabs: ['Grabs', 'num'],
  photos: ['Photos', 'num'], videos: ['Videos', 'num'], usage: ['Usage', 'bytes'], response_ms: ['Response time', 'ms'], free: ['Free space', 'bytes'],
  downloading: ['Downloading', 'num'], seeding: ['Seeding', 'num'], accounts: ['Accounts', 'num'], suspended: ['Suspended', 'num'], leases: ['DHCP leases', 'num'],
  sites_online: ['Sites online', 'num'], sites_offline: ['Sites offline', 'num'], running: ['Running', 'num'], total: ['Total', 'num'], jobs_pending: ['Jobs pending', 'num'], jobs_failed: ['Jobs failed', 'num'],
  wanted_episodes: ['Episodes without subtitles', 'num'], wanted_movies: ['Movies without subtitles', 'num'], disk_pct: ['Disk', 'pct'], latency: ['Latency', 'ms'],
};
const short = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 10_000 ? `${(v / 1000).toFixed(0)}k` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(Math.abs(v) < 10 ? 1 : 0));

export const metricLabel = (key: string) => M[key.split(':').pop() ?? key]?.[0] ?? key.split(':').pop()!.replace(/_/g, ' ');
export function metricFormat(key: string): (v: number) => string {
  const kind = M[key.split(':').pop() ?? key]?.[1] ?? 'num';
  switch (kind) {
    case 'pct': return (v) => `${v.toFixed(v < 10 ? 1 : 0)}%`;
    case 'bits': return (v) => bits(v);
    case 'bps': return (v) => `${bytes(v)}/s`;
    case 'bytes': return (v) => bytes(v);
    case 'ms': return (v) => `${Math.round(v)} ms`;
    default: return short;
  }
}
