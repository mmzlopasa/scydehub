import { kioskToken } from './api';
import { handleMessage, setState } from './store';

let ws: WebSocket | null = null;
let es: EventSource | null = null;
let retry = 0;
let stopped = false;
let timer: number | undefined;
let wsFailures = 0;

function scheduleReconnect() {
  if (stopped) return;
  setState({ conn: 'offline' });
  const delay = Math.min(30_000, 1000 * 2 ** retry) * (0.7 + Math.random() * 0.6);
  retry++;
  clearTimeout(timer);
  timer = window.setTimeout(connect, delay);
}

function connectSse() {
  // EventSource can't send headers; cookie auth works, kiosk tokens fall back to polling via WS query param only
  es = new EventSource('/api/events', { withCredentials: true });
  es.onopen = () => { retry = 0; setState({ conn: 'online' }); };
  es.onmessage = (e) => { try { handleMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
  es.onerror = () => { es?.close(); es = null; scheduleReconnect(); };
}

export function connect() {
  stopped = false;
  ws?.close();
  es?.close();
  setState({ conn: 'connecting' });
  if (wsFailures >= 3 && !kioskToken.get()) return connectSse();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const tok = kioskToken.get();
  const url = `${proto}://${location.host}/api/ws${tok ? `?kiosk=${encodeURIComponent(tok)}` : ''}`;
  let opened = false;
  ws = new WebSocket(url);
  ws.onopen = () => { opened = true; retry = 0; wsFailures = 0; setState({ conn: 'online' }); };
  ws.onmessage = (e) => { try { handleMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
  ws.onclose = (e) => {
    if (!opened) wsFailures++;
    if (e.code === 4401) { setState({ conn: 'offline' }); return; }
    scheduleReconnect();
  };
}

export function disconnect() {
  stopped = true;
  clearTimeout(timer);
  ws?.close();
  es?.close();
}

// reconnect immediately when the device wakes up / network returns
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { retry = 0; connect(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!ws || ws.readyState > 1) && !es) { retry = 0; connect(); }
  });
}
