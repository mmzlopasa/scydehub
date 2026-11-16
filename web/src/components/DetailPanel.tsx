import { useEffect, useState } from 'react';
import { RefreshCw, Zap, AlertTriangle, ExternalLink } from 'lucide-react';
import { useStore } from '../lib/store';
import { useHistory, runAction } from '../lib/hooks';
import { get, post } from '../lib/api';
import { ago, dateTime, duration } from '../lib/format';
import type { CheckState, Field } from '../lib/types';
import { AreaChart, UptimeBar } from './charts';
import { Badge, Button, Drawer, Segmented, ServiceIcon, StatusDot, statusLabel, cx } from './ui';
import { FieldInput } from './FieldInput';
import { metricFormat, metricLabel } from '../lib/metrics';

const RANGES = [
  { value: '1', label: '1 h' }, { value: '6', label: '6 h' }, { value: '24', label: '24 h' }, { value: '168', label: '7 d' }, { value: '720', label: '30 d' },
] as const;
const COLORS = ['var(--accent)', '#22c55e', '#f59e0b', '#38bdf8', '#ec4899'];

function MetricCharts({ instanceId, metrics, hours }: { instanceId: string; metrics: string[]; hours: number }) {
  const series = metrics.map((m) => `inst:${instanceId}:${m}`);
  const data = useHistory(series, hours, 30, 300);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {metrics.map((m, i) => (
        <div key={m} className="rounded-2xl border border-line bg-panel-2 p-3">
          <div className="mb-2 text-xs font-medium text-muted">{metricLabel(m)}</div>
          <AreaChart height={120} series={[{ key: m, label: metricLabel(m), color: COLORS[i % COLORS.length], data: data[series[i]] ?? [] }]}
            yFormat={metricFormat(m)} />
        </div>
      ))}
    </div>
  );
}

function ActionForm({ instanceId, action }: { instanceId: string; action: { id: string; label: string; description?: string; danger: boolean; params: Field[] } }) {
  const [vals, setVals] = useState<Record<string, any>>(Object.fromEntries(action.params.map((p) => [p.key, p.default ?? ''])));
  return (
    <div className="rounded-2xl border border-line p-3">
      <div className="flex items-center gap-2">
        <Zap className={cx('size-4', action.danger ? 'text-bad' : 'text-accent')} />
        <div className="flex-1"><div className="text-sm font-medium">{action.label}</div>{action.description && <div className="text-xs text-muted">{action.description}</div>}</div>
        <Button size="sm" variant={action.danger ? 'danger' : 'soft'} onClick={() => runAction(instanceId, action.id, vals)}>Run</Button>
      </div>
      {action.params.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">{action.params.map((f) => <FieldInput key={f.key} field={f} value={vals[f.key]} onChange={(v) => setVals((s) => ({ ...s, [f.key]: v }))} compact />)}</div>
      )}
    </div>
  );
}

export function CheckDetails({ c }: { c: CheckState }) {
  const [bars, setBars] = useState<{ ts: number; uptime: number | null }[]>([]);
  useEffect(() => { get(`/api/checks/${c.id}/bars?hours=48`).then(setBars).catch(() => {}); }, [c.id, c.checkedAt]);
  const lat = useHistory([`check:${c.id}:latency`], 24, 60);
  return (
    <div className="space-y-3 rounded-2xl border border-line p-3">
      <div className="flex items-center gap-2">
        <StatusDot status={c.ok} />
        <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{c.name}</div><div className="truncate text-xs text-muted">{c.type.toUpperCase()} · {c.target}</div></div>
        <div className="num text-right text-xs">{c.latencyMs != null ? `${Math.round(c.latencyMs)} ms` : '—'}</div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        {(['d1', 'd7', 'd30'] as const).map((k) => <div key={k} className="rounded-xl bg-panel-2 py-2"><div className="text-muted">{k === 'd1' ? '24 h' : k === 'd7' ? '7 d' : '30 d'}</div><div className="num font-semibold">{c.uptime?.[k] != null ? `${c.uptime[k]}%` : '—'}</div></div>)}
      </div>
      <div><div className="mb-1 text-[11px] text-muted">Last 48 h</div><UptimeBar buckets={bars} /></div>
      <AreaChart height={90} series={[{ key: 'l', label: 'Latency', color: 'var(--accent)', data: lat[`check:${c.id}:latency`] ?? [] }]} yFormat={(v) => `${Math.round(v)} ms`} />
      {c.message && <div className="text-xs text-muted">{c.message} · checked {ago(c.checkedAt)}</div>}
    </div>
  );
}

export function DetailPanel({ instanceId, onClose }: { instanceId: string | null; onClose: () => void }) {
  const state = useStore((s) => (instanceId ? s.states[instanceId] : undefined));
  const instance = useStore((s) => s.instances.find((i) => i.id === instanceId));
  const plugin = useStore((s) => s.plugins.find((p) => p.id === instance?.plugin));
  const checks = useStore((s) => Object.values(s.checks).filter((c) => c.instanceId === instanceId));
  const incidents = useStore((s) => s.incidents.filter((i) => instanceId && i.key.includes(instanceId)));
  const isAdmin = useStore((s) => s.me?.auth?.kind === 'admin');
  const [hours, setHours] = useState('6');
  const [tab, setTab] = useState<'overview' | 'actions' | 'alerts'>('overview');
  const [refreshing, setRefreshing] = useState(false);
  if (!instanceId) return null;
  const metricKeys = Object.keys(state?.metrics ?? {}).filter((k) => !/^g\d+_/.test(k) && !k.startsWith('disk_')).slice(0, 8);
  const allMetrics = ['_latency', ...metricKeys];
  return (
    <Drawer open={!!instanceId} onClose={onClose} width={760}
      title={
        <div className="flex items-center gap-3">
          {plugin && <ServiceIcon slug={plugin.icon} name={plugin.name} size={32} />}
          <div className="min-w-0">
            <div className="flex items-center gap-2 truncate text-lg font-semibold">{instance?.name}<StatusDot status={state?.status} /></div>
            <div className="truncate text-xs text-muted">{statusLabel[state?.status ?? 'unknown']} {ago(state?.statusSince)} · {state?.summary}</div>
          </div>
        </div>
      }>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented value={tab} onChange={setTab} options={[{ value: 'overview', label: 'History' }, ...(isAdmin && plugin?.actions.length ? [{ value: 'actions' as const, label: `Actions (${plugin.actions.length})` }] : []), { value: 'alerts', label: `Alerts${state?.alerts.length ? ` (${state.alerts.length})` : ''}` }]} />
        <div className="ml-auto flex items-center gap-2">
          {tab === 'overview' && <Segmented size="sm" value={hours} onChange={setHours} options={RANGES.map((r) => ({ ...r }))} />}
          {isAdmin && (
            <Button size="sm" variant="ghost" loading={refreshing} icon={<RefreshCw className="size-3.5" />}
              onClick={() => { setRefreshing(true); post(`/api/instances/${instanceId}/refresh`).finally(() => setRefreshing(false)); }}>Refresh</Button>
          )}
        </div>
      </div>

      {state?.error && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div><div className="font-medium">Last request failed</div><div className="text-xs opacity-90">{state.error}</div>{state.lastOkAt && <div className="mt-1 text-xs opacity-75">Last success: {dateTime(state.lastOkAt)}</div>}</div>
        </div>
      )}

      {tab === 'overview' && (
        <div className="space-y-4">
          <MetricCharts instanceId={instanceId} metrics={allMetrics} hours={Number(hours)} />
          {checks.length > 0 && <div className="space-y-2"><div className="text-sm font-semibold">Checks</div>{checks.map((c) => <CheckDetails key={c.id} c={c} />)}</div>}
          <div className="grid grid-cols-2 gap-2 text-xs text-muted sm:grid-cols-4">
            <div className="rounded-xl bg-panel-2 p-2">Updated<div className="text-fg">{ago(state?.updatedAt)}</div></div>
            <div className="rounded-xl bg-panel-2 p-2">Response<div className="num text-fg">{state?.latencyMs ?? '—'} ms</div></div>
            <div className="rounded-xl bg-panel-2 p-2">Interval<div className="num text-fg">{instance?.interval_sec ?? '—'} s</div></div>
            <div className="rounded-xl bg-panel-2 p-2">Mode<div className="text-fg">{state?.mock ? 'Mock' : 'Live'}</div></div>
          </div>
          {plugin?.docsUrl && <a href={plugin.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent">API docs <ExternalLink className="size-3" /></a>}
        </div>
      )}

      {tab === 'actions' && plugin && (
        <div className="space-y-2">
          <div className="text-xs text-muted">Every action asks for confirmation and is recorded in the audit log.</div>
          {plugin.actions.map((a) => <ActionForm key={a.id} instanceId={instanceId} action={a} />)}
        </div>
      )}

      {tab === 'alerts' && (
        <div className="space-y-2">
          {(state?.alerts ?? []).map((a) => (
            <div key={a.key} className={cx('rounded-xl border px-3 py-2 text-sm', a.severity === 'critical' ? 'border-bad/30 bg-bad/10' : a.severity === 'warning' ? 'border-warn/30 bg-warn/10' : 'border-line')}>
              <Badge tone={a.severity === 'critical' ? 'bad' : a.severity === 'warning' ? 'warn' : 'info'}>{a.severity}</Badge> {a.message}
            </div>
          ))}
          {!state?.alerts.length && <div className="text-sm text-muted">This service is not reporting any alerts right now.</div>}
          <div className="pt-3 text-sm font-semibold">Incidents</div>
          {incidents.length ? incidents.map((i) => (
            <div key={i.id} className="flex items-center gap-2 rounded-xl bg-panel-2 px-3 py-2 text-xs">
              <StatusDot status={i.resolved_at ? 'up' : 'down'} />
              <span className="flex-1 truncate">{i.title}</span>
              <span className="text-muted">{dateTime(i.started_at)} · {duration(((i.resolved_at ?? Date.now()) - i.started_at) / 1000)}</span>
            </div>
          )) : <div className="text-xs text-muted">No incidents in the last 7 days.</div>}
        </div>
      )}
    </Drawer>
  );
}
