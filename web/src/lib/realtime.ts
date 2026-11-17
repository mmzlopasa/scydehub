import { kioskToken } from './api';
import { get, ApiError } from './api';
import { getState, handleMessage, setState } from './store';

let ws: WebSocket | null = null;
let es: EventSource | null = null;
let retry = 0;
let stopped = true;
let timer: number | undefined;
let wsFailures = 0;
let sseRounds = 0;

function teardown() {
  clearTimeout(timer);
  if (ws) {
    // detach first: a late close event of an old socket must never schedule another reconnect
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try { ws.close(); } catch { /* ignore */ }
    ws = null;
  }
  if (es) {
    es.onopen = es.onmessage = es.onerror = null;
    es.close();
    es = null;
  }
}

function scheduleReconnect() {
  if (stopped) return;
  setState({ conn: 'offline' });
  const delay = Math.min(30_000, 1000 * 2 ** retry) * (0.7 + Math.random() * 0.6);
  retry++;
  clearTimeout(timer);
  timer = window.setTimeout(connect, delay);
}

function connectSse() {
  const source = new EventSource('/api/events', { withCredentials: true });
  es = source;
  source.onopen = () => { retry = 0; setState({ conn: 'online', lastMessageAt: Date.now() }); };
  source.onmessage = (e) => { try { handleMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
  source.onerror = () => {
    if (es !== source) return;
    teardown();
    // EventSource cannot see status codes: ask whether the session is still there, otherwise we would retry forever
    get('/api/auth/me').then((me) => { if (!me?.auth) sessionEnded(false); }).catch((e) => { if (e instanceof ApiError && e.status === 401) sessionEnded(false); });
    // SSE is only the fallback: give WebSocket another chance now and then
    if (++sseRounds % 3 === 0) wsFailures = 0;
    scheduleReconnect();
  };
}

function sessionEnded(forgetToken: boolean) {
  if (stopped) return;
  stopped = true;
  teardown();
  setState({ conn: 'offline' });
  if (forgetToken) kioskToken.clear();
  setTimeout(() => location.reload(), 800);
}

export function connect() {
  stopped = false;
  teardown();
  setState({ conn: 'connecting' });
  const tok = kioskToken.get();
  if (wsFailures >= 3 && !tok) return connectSse();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // the kiosk token rides in the WebSocket sub-protocol, never in the URL (URLs end up in logs)
  let socket: WebSocket;
  try {
    socket = new WebSocket(`${proto}://${location.host}/api/ws`, tok ? ['scyde', `kiosk.${tok}`] : ['scyde']);
  } catch {
    // a token with characters a sub-protocol cannot carry: it can never work
    if (tok) return sessionEnded(true);
    wsFailures = 3;
    return connectSse();
  }
  ws = socket;
  let opened = false;
  socket.onopen = () => { opened = true; retry = 0; wsFailures = 0; setState({ conn: 'online', lastMessageAt: Date.now() }); };
  socket.onmessage = (e) => { try { handleMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
  socket.onclose = (e) => {
    if (ws !== socket) return;
    ws = null;
    if (!opened) wsFailures++;
    if (e.code === 4403 && !kioskToken.get()) {
      // origin check failed (a proxy that rewrites Host): the session itself is fine, plain HTTP streaming still works
      wsFailures = 3;
      return scheduleReconnect();
    }
    // session ended / token revoked → back to the sign-in (or token) screen
    if (e.code === 4401) return sessionEnded(!!kioskToken.get());
    scheduleReconnect();
  };
}

export function disconnect() {
  stopped = true;
  teardown();
}

const alive = () => (ws && ws.readyState <= 1) || !!es;

// A half-open connection (hub lost power, router rebooted) never fires a close event: the server pings every
// 20–25 s, so prolonged silence means the link is dead even though it still looks open.
if (typeof window !== 'undefined')
  setInterval(() => {
    if (!stopped && getState().conn === 'online' && Date.now() - getState().lastMessageAt > 70_000) { retry = 0; connect(); }
  }, 15_000);

// reconnect immediately when the device wakes up / network returns — but only if we are not connected already
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { if (!stopped && !alive()) { retry = 0; connect(); } });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !stopped && !alive()) { retry = 0; connect(); }
  });
}
