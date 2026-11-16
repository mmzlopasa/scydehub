import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fetch } from 'undici';
import { config } from './config.js';
import { q, getSetting } from './db.js';
import { ensureAdmin, resolveAuth } from './auth.js';
import { startCollector, stopCollector } from './collector.js';
import { startChecks } from './monitoring/checks.js';
import { startAlerts, stopAlerts } from './alerts/engine.js';
import { rollup } from './lib/history.js';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/api.js';
import realtimeRoutes from './routes/realtime.js';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info', transport: undefined },
  trustProxy: config.trustProxy,
  bodyLimit: 2 * 1024 * 1024,
  disableRequestLogging: true,
});

await app.register(cookie);
await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

app.addHook('onRequest', async (req) => {
  if (req.url.startsWith('/api/')) req.auth = resolveAuth(req);
});
app.addHook('onSend', async (_req, reply, payload) => {
  reply.header('x-content-type-options', 'nosniff');
  reply.header('referrer-policy', 'same-origin');
  reply.header('x-frame-options', 'SAMEORIGIN');
  return payload;
});

// health endpoint for the external heartbeat / docker healthcheck — no auth, no data
app.get('/healthz', async () => ({ ok: true, time: Date.now() }));

await app.register(authRoutes);
await app.register(apiRoutes);
await app.register(realtimeRoutes);

if (existsSync(config.webDir)) {
  await app.register(fastifyStatic, {
    root: config.webDir,
    wildcard: false,
    setHeaders(res, path) {
      if (path.endsWith('index.html') || path.endsWith('sw.js') || path.endsWith('.webmanifest')) (res as any).setHeader('cache-control', 'no-cache');
      else if (path.includes('/assets/')) (res as any).setHeader('cache-control', 'public, max-age=31536000, immutable');
    },
  });
  // SPA fallback
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.method !== 'GET') return reply.code(404).send({ error: 'not found' });
    return reply.type('text/html').header('cache-control', 'no-cache').sendFile('index.html');
  });
} else {
  app.log.warn(`web build not found at ${config.webDir} — API only (use the Vite dev server)`);
}

ensureAdmin();
startCollector();
startChecks();
startAlerts();
rollup();
const rollupTimer = setInterval(() => {
  try { rollup(); } catch (e) { app.log.error(e); }
}, 5 * 60_000);

// outbound heartbeat (dead-man's switch, e.g. healthchecks.io / Uptime Kuma push / ntfy on another host)
let hbTimer: NodeJS.Timeout | undefined;
const heartbeat = async () => {
  const hb = getSetting<{ url: string; intervalSec: number }>('heartbeat', { url: '', intervalSec: 60 });
  if (hb.url) {
    try {
      await fetch(hb.url, { signal: AbortSignal.timeout(8000) });
    } catch (e: any) {
      app.log.warn(`heartbeat failed: ${e?.message}`);
    }
  }
  hbTimer = setTimeout(heartbeat, Math.max(30, hb.intervalSec || 60) * 1000);
};
void heartbeat();

await app.listen({ port: config.port, host: config.host });
app.log.info(`SCYDE Hub ${config.version} listening on :${config.port}${config.mockAll ? ' (MOCK MODE)' : ''}`);

const shutdown = async () => {
  stopCollector();
  stopAlerts();
  clearInterval(rollupTimer);
  if (hbTimer) clearTimeout(hbTimer);
  await app.close();
  q.run('PRAGMA wal_checkpoint(TRUNCATE)');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
