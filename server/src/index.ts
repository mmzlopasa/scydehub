import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fetch } from 'undici';
import sjson from 'secure-json-parse';
import { config } from './config.js';
import { q } from './db.js';
import { ensureAdmin, rateLimit, resolveAuth } from './auth.js';
import { startCollector, stopCollector } from './collector.js';
import { startChecks } from './monitoring/checks.js';
import { startAlerts, stopAlerts } from './alerts/engine.js';
import { upgradeChannelSecrets } from './alerts/channels.js';
import { InputError, upgradeInstanceSecrets } from './instances.js';
import { allSettings } from './settings.js';
import { rollup } from './lib/history.js';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/api.js';
import realtimeRoutes from './routes/realtime.js';

// A bug in one integration must never take the whole Hub down.
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  trustProxy: config.trustProxy,
  bodyLimit: 4 * 1024 * 1024,
  disableRequestLogging: true,
  // the kiosk token travels as a WebSocket sub-protocol / Authorization header — keep both out of error logs
  requestIdHeader: false,
});

// an empty body with a JSON content-type is simply "no body" (some clients always send the header)
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  const text = String(body ?? '').trim();
  if (!text) return done(null, {});
  try {
    // rejects __proto__ / constructor.prototype keys (prototype poisoning)
    done(null, sjson.parse(text, undefined, { protoAction: 'error', constructorAction: 'error' }));
  } catch {
    const err: any = new Error('Body is not valid JSON');
    err.statusCode = 400;
    done(err, undefined);
  }
});

await app.register(cookie);
await app.register(websocket, {
  options: {
    maxPayload: 16 * 1024,
    // clients offer ["scyde", "kiosk.<token>"]; we only ever echo the fixed name back
    handleProtocols: (protocols: Set<string>) => (protocols.has('scyde') ? 'scyde' : false),
  },
});

const HOST_OK = /^[A-Za-z0-9.\-:[\]]{1,255}$/;

app.addHook('onRequest', async (req, reply) => {
  if (req.url.startsWith('/api/')) {
    // coarse flood guard for everything under /api (per client IP)
    if (!rateLimit(`api:${req.ip}`, 1200, 60_000)) return reply.code(429).send({ error: 'Too many requests' });
    req.auth = resolveAuth(req);
  }
});

// CSRF: every state-changing API call must carry a custom header. Browsers cannot add it cross-site
// without a CORS preflight, and this server never answers one.
app.addHook('preHandler', async (req, reply) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.url.startsWith('/api/') && req.headers['x-scyde'] !== '1')
    return reply.code(400).send({ error: 'missing x-scyde header' });
});

app.addHook('onSend', async (req, reply, payload) => {
  const host = typeof req.headers.host === 'string' && HOST_OK.test(req.headers.host) ? req.headers.host : '';
  reply.header('x-content-type-options', 'nosniff');
  reply.header('referrer-policy', 'no-referrer');
  reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  reply.header('cross-origin-opener-policy', 'same-origin');
  if (!reply.hasHeader('content-security-policy'))
    reply.header('content-security-policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",            // inline styles only (theme variables, custom CSS); no inline scripts
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      `connect-src 'self'${host ? ` ws://${host} wss://${host}` : ''}`,
      'frame-src https: http:',                       // the iframe widget
      "frame-ancestors 'self' capacitor://localhost", // only ourselves and the iOS shell may embed the Hub
      "base-uri 'self'", "form-action 'self'", "object-src 'none'", "worker-src 'self'", "manifest-src 'self'",
    ].join('; '));
  if (req.protocol === 'https') reply.header('strict-transport-security', 'max-age=31536000');
  if (req.url.startsWith('/api/') && !reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  return payload;
});

app.setErrorHandler((err: any, req, reply) => {
  if (err instanceof InputError) return reply.code(400).send({ error: err.message });
  const status = Number(err?.statusCode) >= 400 && Number(err?.statusCode) < 500 ? Number(err.statusCode) : 500;
  if (status === 500) req.log.error({ err: { message: err?.message, stack: err?.stack }, url: req.url.split('?')[0] }, 'request failed');
  // never leak internals (SQL, paths, stack traces) to the client
  return reply.code(status).send({ error: status === 500 ? 'Internal error' : String(err?.message ?? 'Bad request').slice(0, 200) });
});

// health endpoint for the external heartbeat / docker healthcheck / native shells — no auth, no data
app.get('/healthz', async (_req, reply) => {
  reply.header('access-control-allow-origin', '*'); // the iOS shell checks reachability from capacitor://localhost
  return { ok: true, time: Date.now() };
});

await app.register(authRoutes);
await app.register(apiRoutes);
await app.register(realtimeRoutes);

if (existsSync(config.webDir)) {
  await app.register(fastifyStatic, {
    root: config.webDir,
    wildcard: true,
    setHeaders(res, path) {
      if (path.endsWith('index.html') || path.endsWith('sw.js') || path.endsWith('.webmanifest')) res.header('cache-control', 'no-cache');
      else if (path.includes('/assets/')) res.header('cache-control', 'public, max-age=31536000, immutable');
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
upgradeInstanceSecrets();
upgradeChannelSecrets();
startCollector();
startChecks();
startAlerts();
try { rollup(); } catch (e) { app.log.error(e); }
const rollupTimer = setInterval(() => {
  try { rollup(); } catch (e) { app.log.error(e); }
}, 5 * 60_000);

// outbound heartbeat (dead-man's switch, e.g. healthchecks.io / Uptime Kuma push)
let hbTimer: NodeJS.Timeout | undefined;
const heartbeat = async () => {
  let interval = 60;
  try {
    const hb = allSettings().heartbeat;
    interval = hb.intervalSec;
    if (hb.url) await fetch(hb.url, { signal: AbortSignal.timeout(8000), redirect: 'manual' }).then((r) => r.body?.cancel());
  } catch (e: any) {
    app.log.warn(`heartbeat failed: ${e?.message}`);
  }
  hbTimer = setTimeout(heartbeat, Math.min(3600, Math.max(30, Number(interval) || 60)) * 1000);
};
void heartbeat();

await app.listen({ port: config.port, host: config.host });
app.log.info(`SCYDE Hub ${config.version} listening on :${config.port}${config.mockAll ? ' (MOCK MODE)' : ''}`);

const shutdown = async () => {
  stopCollector();
  stopAlerts();
  clearInterval(rollupTimer);
  if (hbTimer) clearTimeout(hbTimer);
  await app.close().catch(() => {});
  try { q.run('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
