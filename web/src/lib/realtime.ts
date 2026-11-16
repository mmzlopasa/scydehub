import { kioskToken } from './api';
import { handleMessage, setState } from './store';

let ws: WebSocket | null = null;
let es: EventSource | null = null;
let retry = 0;
let stopped = true;
let timer: number | undefined;
let wsFailures = 0;

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
  source.onopen = () => { retry = 0; setState({ conn: 'online' }); };
  source.onmessage = (e) => { try { handleMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
  source.onerror = () => { if (es !== source) return; teardown(); scheduleReconnect(); };
}

export function connect() {
  stopped = false;
  teardown();
  setState({ conn: 'connecting' });
  const tok = kioskToken.get();
  if (wsFailures >= 3 && !tok) return connectSse();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // the kiosk token rides in the WebSocket sub-protocol, never in the URL (URLs end up in logs)
  const socket = new WebSocket(`${proto}://${location.host}/api/ws`, tok ? ['scyde', `kiosk.${tok}`] : ['scyde']);
  ws = socket;
  let opened = false;
  socket.onopen = () => { opened = true; retry = 0; wsFailures = 0; setState({ conn: 'online' }); };
  socket.onmessage = (e) => { try { handleMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
  socket.onclose = (e) => {
    if (ws !== socket) return;
    ws = null;
    if (!opened) wsFailures++;
    if (e.code === 4401 || e.code === 4403) {
      // session ended / token revoked → back to the sign-in (or token) screen
      stopped = true;
      setState({ conn: 'offline' });
      if (kioskToken.get() && e.code === 4401) kioskToken.clear();
      setTimeout(() => location.reload(), 800);
      return;
    }
    scheduleReconnect();
  };
}

export function disconnect() {
  stopped = true;
  teardown();
}

const alive = () => (ws && ws.readyState <= 1) || !!es;

// reconnect immediately when the device wakes up / network returns — but only if we are not connected already
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { if (!stopped && !alive()) { retry = 0; connect(); } });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !stopped && !alive()) { retry = 0; connect(); }
  });
}
