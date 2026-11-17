import { useEffect, useState } from 'react';
import { get, post } from './api';
import { confirmDialog, toast } from '../components/feedback';
import { getState, useStore } from './store';
import type { Pt } from '../components/charts';

/** Load history series; refresh every `refreshSec`. */
export function useHistory(series: string[], hours: number, refreshSec = 30, points = 240) {
  const [data, setData] = useState<Record<string, Pt[]>>({});
  const key = series.join(',');
  useEffect(() => {
    if (!series.length) return;
    let alive = true;
    const load = () =>
      get<Record<string, { ts: number; v: number }[]>>(`/api/history?series=${encodeURIComponent(key)}&from=${Date.now() - hours * 3600_000}&points=${points}`)
        .then((d) => alive && setData(d))
        .catch(() => {});
    load();
    const t = setInterval(load, refreshSec * 1000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hours, refreshSec, points]);
  return data;
}

/** Keeps a rolling in-memory buffer of a live value (for sparklines that update every poll). */
export function useLiveSeries(value: number | undefined, max = 60, seed?: Pt[], tick?: number) {
  const [buf, setBuf] = useState<Pt[]>(seed ?? []);
  useEffect(() => {
    if (!seed || !seed.length) return;
    const last = seed[seed.length - 1].ts;
    setBuf((b) => [...seed, ...b.filter((p) => p.ts > last)].slice(-max));
  }, [seed, max]);
  useEffect(() => {
    if (value === undefined || !Number.isFinite(value)) return;
    setBuf((b) => [...b.slice(-(max - 1)), { ts: Date.now(), v: value }]);
    // `tick` = time of the poll: a value that stays the same still gets a point, otherwise a steady line never appears
  }, [value, max, tick]);
  return buf;
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Shared confirm + audit framework on the client: every action asks first. */
export async function runAction(instanceId: string, actionId: string, params: Record<string, any> = {}, describe?: string): Promise<boolean> {
  const st = getState();
  if (st.me?.auth?.kind !== 'admin') { toast('Actions are available to admins only (not in kiosk mode)', 'info'); return false; }
  const inst = st.instances.find((i) => i.id === instanceId);
  const plugin = st.plugins.find((p) => p.id === inst?.plugin);
  const action = plugin?.actions.find((a) => a.id === actionId);
  if (!action) return false;
  const ok = await confirmDialog({
    title: `${action.label}?`,
    body: <>{describe ? <b className="text-fg">{describe}</b> : null}{describe ? ' — ' : ''}{inst?.name}. {action.description ?? ''} This action is recorded in the audit log.</>,
    danger: action.danger,
    confirmLabel: action.label,
  });
  if (!ok) return false;
  try {
    const r = await post<{ message: string }>(`/api/instances/${instanceId}/actions/${actionId}`, { params, confirm: true });
    toast(r.message);
    return true;
  } catch (e: any) {
    if (e?.message !== 'Cancelled') toast(e.message ?? 'Action failed', 'bad'); // password prompt dismissed: not an error
    return false;
  }
}

/** History of one instance metric (last `minutes`) that keeps appending live values from WebSocket updates. */
export function useMetricSeries(instanceId: string | undefined, metric: string, value: number | undefined, minutes = 30, max = 120) {
  const [seed, setSeed] = useState<Pt[] | undefined>(undefined);
  useEffect(() => {
    if (!instanceId) return;
    let live = true; // a late answer for the previous service/metric must not overwrite this one
    const key = `inst:${instanceId}:${metric}`;
    get<Record<string, Pt[]>>(`/api/history?series=${encodeURIComponent(key)}&from=${Date.now() - minutes * 60_000}&points=${max}`)
      .then((d) => { if (live) setSeed(d[key] ?? []); })
      .catch(() => { if (live) setSeed([]); });
    return () => { live = false; };
  }, [instanceId, metric, minutes, max]);
  const tick = useStore((s) => (instanceId ? s.states[instanceId]?.updatedAt : undefined));
  return useLiveSeries(value, max, seed, tick);
}
