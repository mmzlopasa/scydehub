import { Box, Monitor, Play, Power, RotateCw, Square, HardDrive, Archive, Camera } from 'lucide-react';
import type { WidgetProps } from '../types';
import { Badge, Empty, Progress, Ring, StatusDot, cx } from '../../components/ui';
import { Sparkline } from '../../components/charts';
import { bytes, duration, ago, pct, ratio } from '../../lib/format';
import { runAction, useMetricSeries } from '../../lib/hooks';
import { List, stop } from '../common';

export function ProxmoxSummary({ data, size, state }: WidgetProps) {
  const n = data?.nodes?.find((x: any) => x.online) ?? data?.nodes?.[0];
  const cpu = n ? n.cpu * 100 : 0;
  const mem = n ? ratio(n.mem, n.maxmem) : 0;
  const cpuSeries = useMetricSeries(state?.id, 'cpu', state?.metrics?.cpu);
  if (!n) return <Empty title="No node data yet" />;
  const running = data.guests.filter((g: any) => g.status === 'running').length;
  if (size === 'S')
    return (
      <div className="flex h-full items-center justify-around gap-2">
        <Ring value={cpu} label={`${Math.round(cpu)}%`} sub="CPU" size={70} />
        <Ring value={mem} label={`${Math.round(mem)}%`} sub="RAM" size={70} />
      </div>
    );
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-4">
        <Ring value={cpu} label={`${Math.round(cpu)}%`} sub="CPU" size={(size === 'L' || size === 'XL') ? 92 : 76} />
        <Ring value={mem} label={`${Math.round(mem)}%`} sub="RAM" size={(size === 'L' || size === 'XL') ? 92 : 76} />
        <div className="min-w-0 flex-1 space-y-1 text-xs">
          <div className="flex justify-between gap-2"><span className="text-muted">Load</span><span className="num">{(n.loadavg ?? []).map((l: number) => Number(l).toFixed(2)).join(' · ')}</span></div>
          <div className="flex justify-between gap-2"><span className="text-muted">Uptime</span><span className="num">{duration(n.uptime)}</span></div>
          <div className="flex justify-between gap-2"><span className="text-muted">Guests</span><span className="num">{running}/{data.guests.length}</span></div>
          {n.temperature != null && <div className="flex justify-between gap-2"><span className="text-muted">Temp</span><span className="num">{n.temperature}°C</span></div>}
        </div>
      </div>
      <div className="relative min-h-[34px] flex-1"><div className="absolute inset-0"><Sparkline data={cpuSeries} min={0} max={100} className="!h-full" /></div></div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
        <span className="truncate">{n.node} · {String(n.version ?? '').replace('pve-manager/', 'PVE ')}</span>
        <span className="num">· {bytes(n.mem)} / {bytes(n.maxmem)}</span>
        {n.updates > 0 && <Badge tone="info" className="ml-auto">{n.updates} updates</Badge>}
      </div>
    </div>
  );
}

function GuestActions({ g, instanceId }: { g: any; instanceId: string }) {
  const p = { node: g.node, type: g.type, vmid: g.vmid };
  const label = `${g.type === 'lxc' ? 'LXC' : 'VM'} ${g.vmid} ${g.name}`;
  const btn = 'inline-flex size-7 items-center justify-center rounded-lg text-muted hover:bg-panel-2 hover:text-fg';
  return (
    <div className="flex opacity-0 transition group-hover/row:opacity-100 focus-within:opacity-100">
      {g.status !== 'running' ? (
        <button className={btn} title="Start" onClick={stop(() => runAction(instanceId, 'start', p, label))}><Play className="size-3.5" /></button>
      ) : (
        <>
          <button className={btn} title="Reboot" onClick={stop(() => runAction(instanceId, 'reboot', p, label))}><RotateCw className="size-3.5" /></button>
          <button className={btn} title="Shut down" onClick={stop(() => runAction(instanceId, 'shutdown', p, label))}><Power className="size-3.5" /></button>
          <button className={btn} title="Force stop" onClick={stop(() => runAction(instanceId, 'stop', p, label))}><Square className="size-3.5" /></button>
        </>
      )}
    </div>
  );
}

export function ProxmoxGuests({ data, size, instance }: WidgetProps) {
  const guests = [...(data?.guests ?? [])].filter((g: any) => !g.template).sort((a: any, b: any) => Number(b.status === 'running') - Number(a.status === 'running') || String(a.status).localeCompare(String(b.status)) || a.vmid - b.vmid);
  const wide = size === 'L' || size === 'XL';
  return (
    <List>
      {wide && (
        <div className="grid grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] gap-3 px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted max-sm:hidden">
          <span>Guest</span><span>CPU</span><span>RAM</span><span>{size === 'XL' ? 'Backup / snap.' : 'Disk'}</span><span className="w-[84px]" />
        </div>
      )}
      {guests.map((g: any) => (
        <div key={g.vmid} className="group/row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-panel-2 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]"
          style={wide ? undefined : { gridTemplateColumns: 'minmax(0,1fr) auto' }}>
          <div className="flex min-w-0 items-center gap-2.5">
            <StatusDot status={g.status === 'running' ? 'up' : 'disabled'} />
            {g.type === 'lxc' ? <Box className="size-4 shrink-0 text-muted" /> : <Monitor className="size-4 shrink-0 text-muted" />}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{g.name}</div>
              <div className="num truncate text-[11px] text-muted">{g.vmid} · {g.status === 'running' ? duration(g.uptime, 1) : 'stopped'}</div>
            </div>
          </div>
          {wide ? (
            <>
              <div className="max-sm:hidden"><div className="num text-xs">{pct(g.cpu * 100, 1)}</div><Progress value={g.cpu * 100} tone="auto" height={4} /></div>
              <div className="max-sm:hidden"><div className="num text-xs">{bytes(g.mem)}</div><Progress value={ratio(g.mem, g.maxmem)} tone="auto" height={4} /></div>
              <div className="num text-xs text-muted max-sm:hidden">
                {size === 'XL' ? (
                  <span className="flex items-center gap-2">
                    <span className={cx('inline-flex items-center gap-1', g.lastBackup && Date.now() - g.lastBackup > 2 * 86400_000 && 'text-warn')}><Archive className="size-3" />{g.lastBackup ? ago(g.lastBackup) : '—'}</span>
                    <span className="inline-flex items-center gap-1"><Camera className="size-3" />{g.snapshots ?? '—'}</span>
                  </span>
                ) : g.maxdisk ? `${bytes(g.disk)} / ${bytes(g.maxdisk)}` : '—'}
              </div>
            </>
          ) : (
            <div className="num text-right text-xs text-muted">{g.status === 'running' ? `${pct(g.cpu * 100, 0)} · ${bytes(g.mem)}` : ''}</div>
          )}
          {wide && instance && <GuestActions g={g} instanceId={instance.id} />}
        </div>
      ))}
    </List>
  );
}

export function ProxmoxStorage({ data, size }: WidgetProps) {
  // shared storage is reported by every node: show it once
  const seen = new Set<string>();
  const st = (data?.storage ?? []).filter((s: any) => s.total > 0 && !(s.shared && seen.has(s.storage)) && (s.shared ? !!seen.add(s.storage) : true));
  return (
    <div className="flex h-full flex-col gap-3">
      <List>
        {st.map((s: any) => {
          const p = ratio(s.used, s.total);
          return (
            <div key={s.node + s.storage} className="space-y-1.5 px-1 py-1">
              <div className="flex items-center gap-2 text-sm">
                <HardDrive className="size-4 text-muted" />
                <span className="font-medium">{s.storage}</span>
                {size !== 'S' && <Badge>{s.type}</Badge>}
                <span className="num ml-auto text-xs text-muted">{bytes(s.used)} / {bytes(s.total)}</span>
              </div>
              <Progress value={p} tone="auto" />
            </div>
          );
        })}
      </List>
      {size !== 'S' && data?.lastBackupTask && (
        <div className="flex items-center gap-2 border-t border-line pt-2 text-xs text-muted">
          <Archive className="size-3.5" /> Last backup {ago(data.lastBackupTask.end ?? data.lastBackupTask.start)}
          <Badge tone={data.lastBackupTask.status === 'OK' ? 'ok' : 'bad'} className="ml-auto">{data.lastBackupTask.status}</Badge>
        </div>
      )}
    </div>
  );
}
