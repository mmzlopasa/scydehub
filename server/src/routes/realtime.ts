import type { FastifyInstance, FastifyRequest } from 'fastify';
import { bus, type BusMessage } from '../lib/bus.js';
import { config } from '../config.js';
import { getStates } from '../collector.js';
import { getCheckStates } from '../monitoring/checks.js';
import { q } from '../db.js';
import { stillValid, type Auth } from '../auth.js';
import { addClient, removeClient, type LiveClient } from '../lib/live.js';

function snapshot() {
  return {
    type: 'snapshot',
    instances: getStates(),
    checks: getCheckStates(),
    incidents: q.all('SELECT * FROM incidents WHERE resolved_at IS NULL OR resolved_at > ? ORDER BY started_at DESC LIMIT 100', Date.now() - 7 * 86400_000),
  };
}
const hello = () => ({ type: 'hello', version: config.version, buildId: config.buildId, time: Date.now() });
const liveClient = (a: Auth, close: (reason: string) => void): LiveClient =>
  a.kind === 'admin' ? { kind: 'admin', key: a.sessionId, userId: a.userId, close } : { kind: 'kiosk', key: String(a.tokenId), close };

/** Cross-site WebSocket hijacking guard: a browser page on another origin must not open our socket with the user's cookie. */
export function sameOrigin(req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser client
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const MAX_BUFFERED = 8 * 1024 * 1024;

export default async function realtimeRoutes(app: FastifyInstance) {
  app.get('/api/ws', { websocket: true }, (socket, req) => {
    const auth = req.auth;
    if (!auth) return socket.close(4401, 'unauthorized');
    if (auth.kind === 'admin' && !sameOrigin(req)) return socket.close(4403, 'bad origin');
    const client = liveClient(auth, (reason) => socket.close(4401, reason));
    if (!addClient(client)) return socket.close(4429, 'too many connections');

    const send = (m: unknown) => {
      if (socket.readyState !== 1) return;
      // a client that cannot keep up is dropped instead of buffering without bound
      if (socket.bufferedAmount > MAX_BUFFERED) return socket.close(4408, 'too slow');
      socket.send(JSON.stringify(m));
    };
    send(hello());
    send(snapshot());
    const onMsg = (m: BusMessage) => send(m);
    bus.on('message', onMsg);
    const ping = setInterval(() => {
      if (!stillValid(auth)) return socket.close(4401, 'session ended');
      send({ type: 'ping', time: Date.now() });
    }, 25_000);
    let lastSnapshot = Date.now();
    socket.on('message', (raw: Buffer) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m?.type === 'snapshot' && Date.now() - lastSnapshot > 3000) {
          lastSnapshot = Date.now();
          send(snapshot());
        }
      } catch { /* ignore */ }
    });
    socket.on('close', () => {
      bus.off('message', onMsg);
      clearInterval(ping);
      removeClient(client);
    });
    socket.on('error', () => socket.terminate());
  });

  // Server-Sent Events fallback (proxies / clients without WebSocket) — cookie sessions only
  app.get('/api/events', async (req, reply) => {
    const auth = req.auth;
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    let closed = false;
    const end = () => {
      if (closed) return;
      closed = true;
      bus.off('message', onMsg);
      clearInterval(ping);
      removeClient(client);
      reply.raw.end();
    };
    const client = liveClient(auth, end);
    if (!addClient(client)) return reply.code(429).send({ error: 'too many connections' });
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (m: unknown) => {
      if (closed) return;
      if (reply.raw.writableLength > MAX_BUFFERED) return end();
      reply.raw.write(`data: ${JSON.stringify(m)}\n\n`);
    };
    const onMsg = (m: BusMessage) => send(m);
    const ping = setInterval(() => {
      if (!stillValid(auth)) return end();
      if (!closed) reply.raw.write(': ping\n\n');
    }, 20_000);
    send(hello());
    send(snapshot());
    bus.on('message', onMsg);
    req.raw.on('close', end);
    return reply;
  });
}
