import { useRef, useSyncExternalStore } from 'react';
import { get } from './api';
import type { Board, Branding, CheckState, Incident, Instance, InstanceState, Me, PluginMeta, Settings } from './types';

export interface AppState {
  me: Me | null;
  plugins: PluginMeta[];
  instances: Instance[];
  boards: Board[];
  settings: Settings | null;
  /** public look & name, available before sign-in */
  branding: Branding | null;
  states: Record<string, InstanceState>;
  checks: Record<string, CheckState>;
  incidents: Incident[];
  conn: 'connecting' | 'online' | 'offline';
  lastMessageAt: number;
  editMode: boolean;
  loaded: boolean;
}

let state: AppState = {
  me: null, plugins: [], instances: [], boards: [], settings: null, branding: null, states: {}, checks: {}, incidents: [],
  conn: 'connecting', lastMessageAt: 0, editMode: false, loaded: false,
};
const subs = new Set<() => void>();
export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  subs.forEach((f) => f());
}
export const getState = () => state;
function shallowEqual(a: any, b: any) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}
const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
/** Selector hook; derived arrays/objects are shallow-compared so they don't re-render (or loop) needlessly. */
export function useStore<T>(sel: (s: AppState) => T): T {
  const last = useRef<{ v: T } | null>(null);
  const get = () => {
    const v = sel(state);
    if (last.current && shallowEqual(last.current.v, v)) return last.current.v;
    last.current = { v };
    return v;
  };
  return useSyncExternalStore(subscribe, get, get);
}

export async function loadMe() {
  const me = await get<Me>('/api/auth/me');
  setState({ me });
  return me;
}
export async function loadBranding() {
  try { setState({ branding: await get<Branding>('/api/branding') }); } catch { /* keep defaults */ }
}
export async function loadConfig(scope: string = 'all') {
  const tasks: Promise<void>[] = [];
  if (scope === 'all' || scope === 'boards' || scope === 'layouts') tasks.push(get<Board[]>('/api/boards').then((boards) => setState({ boards })));
  if (scope === 'all' || scope === 'instances') tasks.push(get<Instance[]>('/api/instances').then((instances) => setState({ instances })));
  if (scope === 'all' || scope === 'settings') tasks.push(get<Settings>('/api/settings').then((settings) => setState({ settings })));
  if (scope === 'all') tasks.push(get<PluginMeta[]>('/api/plugins').then((plugins) => setState({ plugins })));
  await Promise.all(tasks);
  if (scope === 'all') setState({ loaded: true });
}

let settingsHold = 0;
export const holdSettingsReload = (ms: number) => { settingsHold = Date.now() + ms; };

function upsertIncident(list: Incident[], inc: Incident) {
  const i = list.findIndex((x) => x.id === inc.id);
  if (i < 0) return [inc, ...list];
  const next = list.slice();
  next[i] = inc;
  return next;
}

/** Messages from WebSocket or SSE */
export function handleMessage(m: any) {
  switch (m.type) {
    case 'hello': {
      const me = state.me;
      // a new server build → reload once (kiosk devices update themselves)
      if (me && m.buildId && me.buildId && m.buildId !== me.buildId) {
        // never throw away an edit in progress: wait until nothing is being arranged and no dialog is open
        const tryReload = () => {
          if (state.editMode || document.querySelector('[role="dialog"]') || /^\/settings/.test(location.pathname)) setTimeout(tryReload, 5000);
          else location.reload();
        };
        setTimeout(tryReload, 1500 + Math.random() * 3000);
      }
      break;
    }
    case 'snapshot':
      setState({
        states: Object.fromEntries((m.instances as InstanceState[]).map((s) => [s.id, s])),
        checks: Object.fromEntries((m.checks as CheckState[]).map((s) => [s.id, s])),
        incidents: m.incidents,
      });
      break;
    case 'instance':
      setState((s) => ({ states: { ...s.states, [m.id]: m.state } }));
      break;
    case 'check':
      setState((s) => ({ checks: { ...s.checks, [m.id]: m.state } }));
      break;
    case 'incident':
      setState((s) => ({ incidents: upsertIncident(s.incidents, m.incident) }));
      break;
    case 'config':
      // while the user is dragging a slider in Customize, a refetch would snap the value back
      if (m.scope === 'settings' && Date.now() < settingsHold) break;
      loadConfig(m.scope === 'checks' ? 'none' : m.scope).catch(() => {});
      // a deleted service or check has to leave the live state too
      if (['checks', 'instances', 'all'].includes(m.scope)) get('/api/state').then((st) => handleMessage({ type: 'snapshot', ...st })).catch(() => {});
      break;
  }
  setState({ lastMessageAt: Date.now() });
}
