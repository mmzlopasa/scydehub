import { ArrowDown, ArrowUp, Pause, Play, Shield, ShieldOff, Wifi, Network, Router, Globe } from 'lucide-react';
import type { WidgetProps } from '../types';
import { Badge, Progress, Stat, Empty, AnimatedNumber, StatusDot, Button, Ring } from '../../components/ui';
import { Sparkline, Bars } from '../../components/charts';
import { bits, bytes, num, ratio, speed, duration, until } from '../../lib/format';
import { runAction, useMetricSeries } from '../../lib/hooks';
import { List, Row, Section, stop } from '../common';

// ---------- qBittorrent ----------
export function QbtTransfer({ data, state, size, instance }: WidgetProps) {
  const dl = useMetricSeries(state?.id, 'dl', state?.metrics?.dl, 15);
  const up = useMetricSeries(state?.id, 'up', state?.metrics?.up, 15);
  // "Resume all" only when nothing is running at all; an idle client with finished torrents still offers Pause
  const paused = !!data && data.stopped > 0 && data.downloading === 0 && data.seeding === 0;
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted"><ArrowDown className="size-3 text-accent" />Download</div>
          <div className="dot text-xl font-semibold"><AnimatedNumber value={data?.dlSpeed} format={(n) => speed(n)} /></div>
        </div>
        <div>
          <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted"><ArrowUp className="size-3 text-ok" />Upload</div>
          <div className="dot text-xl font-semibold"><AnimatedNumber value={data?.upSpeed} format={(n) => speed(n)} /></div>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0"><Sparkline data={dl} height={size === 'S' ? 40 : 70} min={0} className="!h-full" /></div>
        <div className="absolute inset-0 opacity-80"><Sparkline data={up} color="var(--color-ok)" height={size === 'S' ? 40 : 70} min={0} fill={false} className="!h-full" /></div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="num">{data?.downloading ?? 0} ↓ · {data?.seeding ?? 0} ↑</span>
        {data?.freeSpace != null && size !== 'S' && <span className="num">· {bytes(data.freeSpace)} free</span>}
        {instance && (
          <button className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-panel-2 hover:text-fg" onClick={stop(() => runAction(instance.id, paused ? 'resumeAll' : 'pauseAll'))}>
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}{size !== 'S' && (paused ? 'Resume' : 'Pause')}
          </button>
        )}
      </div>
    </div>
  );
}

const QSTATE: Record<string, [string, 'ok' | 'info' | 'warn' | 'bad' | 'muted']> = {
  downloading: ['Downloading', 'info'], forcedDL: ['Downloading', 'info'], metaDL: ['Metadata', 'info'], forcedMetaDL: ['Metadata', 'info'], stalledDL: ['Stalled', 'warn'],
  queuedDL: ['Queued', 'muted'], checkingDL: ['Checking', 'muted'], allocating: ['Allocating', 'muted'], checkingResumeData: ['Checking', 'muted'], moving: ['Moving', 'info'],
  uploading: ['Seeding', 'ok'], stalledUP: ['Seeding', 'ok'], forcedUP: ['Seeding', 'ok'], queuedUP: ['Queued', 'muted'], checkingUP: ['Checking', 'muted'],
  stoppedDL: ['Paused', 'muted'], pausedDL: ['Paused', 'muted'], stoppedUP: ['Done', 'ok'], pausedUP: ['Done', 'ok'],
  error: ['Error', 'bad'], missingFiles: ['Missing files', 'bad'], unknown: ['Unknown', 'muted'],
};
export function QbtTorrents({ data, size, instance }: WidgetProps) {
  const list = data?.active ?? [];
  if (!list.length) return <Empty title="No active torrents" />;
  return (
    <List>
      {list.map((t: any) => {
        const [label, tone] = QSTATE[t.state] ?? [t.state, 'muted'];
        const paused = t.state.startsWith('stopped') || t.state.startsWith('paused');
        return (
          <div key={t.hash} className="group/row rounded-xl px-2 py-1.5 hover:bg-panel-2">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</div>
              <Badge tone={tone}>{label}</Badge>
              {instance && size !== 'M' && (
                <button className="text-muted opacity-0 transition hover:text-fg group-hover/row:opacity-100" title={paused ? 'Resume' : 'Pause'}
                  onClick={stop(() => runAction(instance.id, paused ? 'resume' : 'pause', { hash: t.hash }, t.name))}>{paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}</button>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <Progress value={t.progress} height={5} tone={t.progress >= 100 ? 'ok' : 'accent'} />
              <span className="num w-12 shrink-0 text-right text-[11px] text-muted">{t.progress.toFixed(1)}%</span>
            </div>
            <div className="num mt-1 flex gap-3 text-[11px] text-muted">
              <span>{bytes(t.size)}</span>
              {t.dlspeed > 0 && <span className="text-accent">↓ {speed(t.dlspeed)}</span>}
              {t.upspeed > 0 && <span className="text-ok">↑ {speed(t.upspeed)}</span>}
              {t.eta > 0 && t.eta < 8640000 && <span className="ml-auto">ETA {duration(t.eta)}</span>}
            </div>
          </div>
        );
      })}
    </List>
  );
}

// ---------- AdGuard ----------
export function AdguardStats({ data, size, instance }: WidgetProps) {
  const protectedOn = data?.protection;
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-4">
        <Ring value={data?.blockedPct ?? 0} tone="accent" label={`${(data?.blockedPct ?? 0).toFixed(1)}%`} sub="blocked" size={size === 'S' ? 64 : 76} />
        <div className="grid flex-1 grid-cols-2 gap-3">
          <Stat label="Queries" value={<AnimatedNumber value={data?.queries} />} />
          <Stat label="Blocked" value={<AnimatedNumber value={data?.blocked} />} />
          {size !== 'S' && <Stat label="Response" value={`${data?.avgMs ?? '—'} ms`} />}
          {size !== 'S' && (
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Protection</div>
              <div className={protectedOn ? 'flex items-center gap-1 text-sm font-semibold text-ok' : 'flex items-center gap-1 text-sm font-semibold text-warn'}>
                {protectedOn ? <Shield className="size-4" /> : <ShieldOff className="size-4" />}{protectedOn ? 'Enabled' : data?.protectionDisabledUntil ? until(data.protectionDisabledUntil) : 'Disabled'}
              </div>
            </div>
          )}
        </div>
      </div>
      {size !== 'S' && data?.hourly?.queries?.length > 0 && <div className="mt-auto"><Bars values={data.hourly.queries} values2={data.hourly.blocked} height={(size === 'L' || size === 'XL') ? 70 : 44} /></div>}
      {size !== 'S' && instance && (
        <Button size="sm" variant={protectedOn ? 'soft' : 'primary'} icon={protectedOn ? <ShieldOff className="size-3.5" /> : <Shield className="size-3.5" />}
          onClick={stop(() => runAction(instance.id, protectedOn ? 'pause' : 'resume', protectedOn ? { minutes: '10' } : {}, protectedOn ? '10 minutes' : undefined))}>
          {protectedOn ? 'Pause for 10 min' : 'Enable protection'}
        </Button>
      )}
    </div>
  );
}
export function AdguardTop({ data, size, rows }: WidgetProps) {
  const fit = Math.max(3, Math.floor((rows * 39 - 95) / (size === 'M' ? 95 : 30)));
  const block = (title: string, list: [string, number][]) => (
    <Section title={title}>
      <div className="space-y-1">
        {(list ?? []).slice(0, Math.min(fit, 10)).map(([k, v]) => {
          const max = list[0]?.[1] || 1;
          return (
            <div key={k} className="relative overflow-hidden rounded-lg px-2 py-1 text-xs">
              <div className="absolute inset-y-0 left-0 bg-accent-soft" style={{ width: `${(v / max) * 100}%` }} />
              <div className="relative flex justify-between gap-2"><span className="truncate">{k}</span><span className="num text-muted">{num(v)}</span></div>
            </div>
          );
        })}
      </div>
    </Section>
  );
  return (
    <div className={size === 'M' ? 'scroll-thin flex h-full flex-col gap-3 overflow-y-auto' : 'grid h-full gap-4 overflow-hidden sm:grid-cols-3'}>
      {block('Top domains', data?.topDomains)}
      {block('Top blocked', data?.topBlocked)}
      {block('Top clients', data?.topClients)}
    </div>
  );
}

// ---------- MikroTik ----------
export function MikrotikTraffic({ data, state, size }: WidgetProps) {
  const rx = useMetricSeries(state?.id, 'wan_rx', state?.metrics?.wan_rx, 15);
  const tx = useMetricSeries(state?.id, 'wan_tx', state?.metrics?.wan_tx, 15);
  const wan = data?.wan;
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-4">
        <div>
          <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted"><ArrowDown className="size-3 text-accent" />WAN ↓</div>
          <div className="dot text-xl font-semibold"><AnimatedNumber value={wan?.rxBps} format={(n) => bits(n)} /></div>
        </div>
        <div>
          <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted"><ArrowUp className="size-3 text-ok" />WAN ↑</div>
          <div className="dot text-xl font-semibold"><AnimatedNumber value={wan?.txBps} format={(n) => bits(n)} /></div>
        </div>
        {size !== 'S' && (
          <div className="ml-auto grid gap-1 text-right text-xs text-muted">
            <span className="num">CPU {data?.cpu ?? '—'}%</span>
            <span className="num">RAM {ratio(data?.memUsed ?? 0, data?.memTotal ?? 1).toFixed(0)}%</span>
          </div>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0"><Sparkline data={rx} min={0} className="!h-full" /></div>
        <div className="absolute inset-0"><Sparkline data={tx} min={0} color="var(--color-ok)" fill={false} className="!h-full" /></div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <StatusDot status={wan ? wan.running : null} size={6} /><span>{wan?.name ?? 'WAN not configured'}</span>
        {size !== 'S' && <span className="ml-auto truncate">{data?.version} · up {data?.uptime}</span>}
      </div>
    </div>
  );
}
export function MikrotikInterfaces({ data }: WidgetProps) {
  return (
    <List>
      {(data?.interfaces ?? []).map((i: any) => (
        <Row key={i.name} left={<StatusDot status={i.running} />} title={i.name} sub={i.type}
          right={<div className="num text-xs"><div className="text-accent">↓ {bits(i.rxBps)}</div><div className="text-ok">↑ {bits(i.txBps)}</div></div>} />
      ))}
    </List>
  );
}
export function MikrotikClients({ data, size }: WidgetProps) {
  return (
    <div className={size === 'M' ? 'flex h-full flex-col gap-3' : 'grid h-full gap-4 sm:grid-cols-2'}>
      <Section title={<span className="flex items-center gap-1"><Wifi className="size-3" />WireGuard</span>}>
        <List>{(data?.peers ?? []).map((p: any, i: number) => <Row key={i} left={<StatusDot status={p.online} />} title={p.name} sub={p.endpoint ?? 'no endpoint'} right={<span className="text-xs text-muted">{p.lastHandshake ?? '—'}</span>} />)}</List>
      </Section>
      <Section title={<span className="flex items-center gap-1"><Network className="size-3" />DHCP ({data?.leaseCount ?? 0})</span>}>
        <List>{(data?.leases ?? []).slice(0, 40).map((l: any) => <Row key={l.address} title={l.host || l.mac} sub={l.mac} right={<span className="num text-xs text-muted">{l.address}</span>} />)}</List>
      </Section>
    </div>
  );
}

// ---------- Pangolin ----------
export function PangolinSites({ data, size }: WidgetProps) {
  const sites = data?.sites ?? [];
  return (
    <div className="flex h-full flex-col gap-3">
      <List className="!flex-none">
        {sites.map((s: any) => (
          <Row key={s.id} left={s.online === null ? <Router className="size-4 text-muted" /> : <StatusDot status={s.online} />} title={s.name}
            sub={`${s.type}${s.version ? ' · newt ' + s.version : ''} · ${s.resources ?? 0} resources`}
            right={size !== 'S' && <span className="num text-xs text-muted">↓{bytes(s.mbIn * 1e6)} ↑{bytes(s.mbOut * 1e6)}</span>} />
        ))}
      </List>
      {size !== 'S' && (
        <Section title="Resources">
          <div className="flex flex-wrap gap-1.5">
            {(data?.resources ?? []).map((r: any) => (
              <Badge key={r.id} tone={!r.enabled ? 'muted' : r.sitesOnline === r.sitesTotal ? 'ok' : 'bad'}><Globe className="size-3" />{r.domain ?? r.name}</Badge>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
