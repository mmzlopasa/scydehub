import type { Plugin } from '../types.js';
import { tlsFields, urlField } from '../types.js';

/** Mediarr is a custom app; contract documented in docs/integrations/mediarr.md */
interface Cfg { url: string; apiKey?: string; apiKeyHeader?: string; statsPath?: string }
export interface MediarrData {
  version?: string; photos: number; videos: number; usageBytes: number; diskTotalBytes?: number;
  jobs: { name: string; active: number; waiting: number; failed: number }[]; lastUploadAt?: string | null;
}

function finish(d: MediarrData) {
  const failed = d.jobs.reduce((a, j) => a + j.failed, 0);
  return {
    status: 'up' as const,
    summary: `${d.photos.toLocaleString('en-US')} photos · ${d.videos.toLocaleString('en-US')} videos`,
    data: d,
    metrics: { photos: d.photos, videos: d.videos, usage: d.usageBytes, jobs_pending: d.jobs.reduce((a, j) => a + j.active + j.waiting, 0), jobs_failed: failed },
    alerts: failed ? [{ key: 'jobs', severity: 'warning' as const, message: `Failed jobs: ${failed}` }] : [],
  };
}

export const mediarr: Plugin<Cfg, MediarrData> = {
  id: 'mediarr', name: 'Mediarr', icon: 'photoprism', category: 'media',
  description: 'Photos and videos, storage usage, job queue, last upload (custom /api/stats endpoint).',
  defaultInterval: 60,
  fields: [
    urlField('http://192.168.1.22:3000'),
    { key: 'apiKey', label: 'API key', type: 'secret' },
    { key: 'apiKeyHeader', label: 'API key header', type: 'string', default: 'X-Api-Key' },
    { key: 'statsPath', label: 'Stats endpoint', type: 'string', default: '/api/stats' },
    ...tlsFields,
  ],
  http: (c) => ({ headers: c.apiKey ? { [c.apiKeyHeader || 'X-Api-Key']: c.apiKey } : {} }),
  async collect({ http, config: c }) {
    const r = await http.get<any>(c.statsPath || '/api/stats');
    return finish({
      version: r.version, photos: Number(r.photos) || 0, videos: Number(r.videos) || 0, usageBytes: Number(r.usageBytes) || 0,
      diskTotalBytes: r.diskTotalBytes, jobs: r.jobs ?? [], lastUploadAt: r.lastUploadAt ?? null,
    });
  },
  mock(ctx) {
    return finish({
      version: '1.3.0', photos: 48_219 + Math.floor(ctx.tick / 8), videos: 2_311, usageBytes: 612e9, diskTotalBytes: 4e12,
      jobs: [{ name: 'thumbnails', active: ctx.tick % 15 < 4 ? 3 : 0, waiting: ctx.tick % 15 < 4 ? 48 : 0, failed: 0 }, { name: 'faces', active: 0, waiting: 0, failed: 0 }],
      lastUploadAt: new Date(Date.now() - 42 * 60_000).toISOString(),
    });
  },
  widgets: [{ id: 'library', name: 'Mediarr', description: 'Library, storage usage, jobs, last upload', sizes: ['S', 'M', 'L'], defaultSize: 'M' }],
};
