import type { Plugin } from '../types.js';
import { apiKeyField, tlsFields, urlField } from '../types.js';

interface Cfg { url: string; apiKey: string }
export interface ImmichData {
  version?: string; photos: number; videos: number; usage: number; disk?: { size: number; used: number; pct: number } | null;
  users: { name: string; photos: number; videos: number; usage: number; quota?: number | null }[];
  queues: { name: string; active: number; waiting: number; failed: number; paused: boolean }[];
}

function finish(d: ImmichData) {
  const failed = d.queues.reduce((a, b) => a + b.failed, 0);
  const busy = d.queues.reduce((a, b) => a + b.active + b.waiting, 0);
  return {
    status: 'up' as const,
    summary: `${d.photos.toLocaleString('en-US')} photos · ${d.videos.toLocaleString('en-US')} videos`,
    data: d,
    metrics: { photos: d.photos, videos: d.videos, usage: d.usage, jobs_pending: busy, jobs_failed: failed, ...(d.disk ? { disk_pct: d.disk.pct } : {}) },
    alerts: d.disk && d.disk.pct > 90 ? [{ key: 'disk', severity: 'warning' as const, message: `Immich disk ${d.disk.pct}% full` }] : [],
  };
}

export const immich: Plugin<Cfg, ImmichData> = {
  id: 'immich', name: 'Immich', icon: 'immich', category: 'media',
  description: 'Photo and video counts, storage usage, users, job queue status.',
  docsUrl: 'https://api.immich.app/',
  defaultInterval: 60,
  fields: [urlField('http://192.168.1.20:2283'), apiKeyField('API key (admin; permissions server.statistics, queue.read)'), ...tlsFields],
  http: (c) => ({ headers: { 'x-api-key': c.apiKey } }),
  async collect({ http }) {
    const [ver, stats, storage] = await Promise.all([
      http.get<any>('/api/server/version').catch(() => null),
      http.get<any>('/api/server/statistics'),
      http.get<any>('/api/server/storage').catch(() => null),
    ]);
    // v2.4+: /api/queues; older: /api/jobs (deprecated)
    let queues: ImmichData['queues'] = [];
    const q = await http.get<any[]>('/api/queues').catch(() => null);
    if (Array.isArray(q)) {
      queues = q.map((x) => ({ name: x.name, active: x.statistics?.active ?? 0, waiting: (x.statistics?.waiting ?? 0) + (x.statistics?.delayed ?? 0), failed: x.statistics?.failed ?? 0, paused: !!x.isPaused }));
    } else {
      const j = await http.get<Record<string, any>>('/api/jobs').catch(() => ({}));
      queues = Object.entries(j).map(([name, x]) => ({ name, active: x.jobCounts?.active ?? 0, waiting: (x.jobCounts?.waiting ?? 0) + (x.jobCounts?.delayed ?? 0), failed: x.jobCounts?.failed ?? 0, paused: !!x.queueStatus?.isPaused }));
    }
    return finish({
      version: ver ? `${ver.major}.${ver.minor}.${ver.patch}` : undefined,
      photos: stats.photos ?? 0, videos: stats.videos ?? 0, usage: stats.usage ?? 0,
      disk: storage ? { size: storage.diskSizeRaw, used: storage.diskUseRaw, pct: Number(storage.diskUsagePercentage) || 0 } : null,
      users: (stats.usageByUser ?? []).map((u: any) => ({ name: u.userName, photos: u.photos, videos: u.videos, usage: u.usage, quota: u.quotaSizeInBytes })),
      queues,
    });
  },
  mock(ctx) {
    const busy = ctx.tick % 20 < 6;
    return finish({
      version: '3.4.1', photos: 48_219 + Math.floor(ctx.tick / 10), videos: 2_311, usage: 612e9, disk: { size: 4e12, used: 2.3e12, pct: 57.5 },
      users: [{ name: 'Mislav', photos: 39_002, videos: 1_802, usage: 510e9 }, { name: 'Ana', photos: 9_217, videos: 509, usage: 102e9 }],
      queues: [
        { name: 'thumbnailGeneration', active: busy ? 4 : 0, waiting: busy ? 120 : 0, failed: 0, paused: false },
        { name: 'metadataExtraction', active: busy ? 2 : 0, waiting: busy ? 40 : 0, failed: 0, paused: false },
        { name: 'smartSearch', active: busy ? 1 : 0, waiting: busy ? 310 : 0, failed: 2, paused: false },
        { name: 'facialRecognition', active: 0, waiting: 0, failed: 0, paused: false },
        { name: 'videoConversion', active: busy ? 1 : 0, waiting: busy ? 3 : 0, failed: 0, paused: false },
      ],
    });
  },
  widgets: [{ id: 'library', name: 'Immich', description: 'Library, storage usage and job queue', sizes: ['S', 'M', 'L'], defaultSize: 'M' }],
};
