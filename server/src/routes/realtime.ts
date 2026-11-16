import type { FastifyInstance } from 'fastify';
import { bus, type BusMessage } from '../lib/bus.js';
import { config } from '../config.js';
import { getStates } from '../collector.js';
import { getCheckStates } from '../monitoring/checks.js';
import { q } from '../db.js';

function snapshot() {
  return {
    type: 'snapshot',
    instances: getStates(),
    checks: getCheckStates(),
    incidents: q.all('SELECT * FROM incidents WHERE resolved_at IS NULL OR resolved_at > ? ORDER BY started_at DESC LIMIT 100', Date.now() - 7 * 86400_000),
  };
}
const hello = () => ({ type: 'hello', version: config.version, buildId: config.buildId, time: Date.now() });

export default async function realtimeRoutes(app: FastifyInstance) {
  app.get('/api/ws', { websocket: true }, (socket, req) => {
    if (!req.auth) {
      socket.close(4401, 'unauthorized');
      return;
    }
    const send = (m: unknown) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(m));
    };
    send(hello());
    send(snapshot());
    const onMsg = (m: BusMessage) => send(m);
    bus.on('message', onMsg);
    const ping = setInterval(() => send({ type: 'ping', time: Date.now() }), 25_000);
    socket.on('message', (raw: Buffer) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.type === 'snapshot') send(snapshot());
      } catch { /* ignore */ }
    });
    socket.on('close', () => {
      bus.off('message', onMsg);
      clearInterval(ping);
    });
  });

  // Server-Sent Events fallback (proxies / clients without WebSocket)
  app.get('/api/events', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (m: unknown) => reply.raw.write(`data: ${JSON.stringify(m)}\n\n`);
    send(hello());
    send(snapshot());
    const onMsg = (m: BusMessage) => send(m);
    bus.on('message', onMsg);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 20_000);
    req.raw.on('close', () => {
      bus.off('message', onMsg);
      clearInterval(ping);
    });
    return reply;
  });
}
