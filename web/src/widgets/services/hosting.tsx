import { KeyRound, Lock, Server, Mail, Globe, RotateCw } from 'lucide-react';
import type { WidgetProps } from '../types';
import { Badge, Progress, Stat, StatusDot, AnimatedNumber, Empty } from '../../components/ui';
import { ratio, num, locale } from '../../lib/format';
import { runAction } from '../../lib/hooks';
import { List, Row, Section, stop } from '../common';

export function VaultwardenStatus({ data, state, size }: WidgetProps) {
  return (
    <div className="flex h-full flex-col justify-between gap-2">
      <div className="flex items-center gap-3">
        <div className="grid size-11 place-items-center rounded-2xl bg-accent-soft text-accent"><KeyRound className="size-5" /></div>
        <div>
          <div className="text-lg font-semibold">{state?.status === 'down' ? 'Unavailable' : 'Online'}</div>
          <div className="num text-xs text-muted">{data?.responseMs ?? '—'} ms · v{data?.version ?? '?'}</div>
        </div>
      </div>
      {data?.cert && (
        <div className="flex items-center gap-2 text-xs">
          <Lock className="size-3.5 text-muted" />
          <span className="text-muted">Certificate</span>
          <Badge className="ml-auto" tone={data.cert.daysLeft < 7 ? 'bad' : data.cert.daysLeft < 21 ? 'warn' : 'ok'}>{data.cert.daysLeft} d</Badge>
        </div>
      )}
      {size !== 'S' && data?.cert?.issuer && <div className="text-xs text-muted">{data.cert.issuer}</div>}
    </div>
  );
}

export function WhmServer({ data, size }: WidgetProps) {
  const svc = data?.services ?? [];
  const down = svc.filter((s: any) => s.enabled && s.running === false);
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Load" value={data?.load ? <AnimatedNumber value={data.load.one} format={(n) => n.toFixed(2)} /> : '—'} sub={data?.load ? `${data.load.five} · ${data.load.fifteen}` : 'not allowed'} />
        <Stat label={data?.scope === 'reseller' ? 'Accounts (reseller)' : 'Accounts'} value={<AnimatedNumber value={data?.accounts?.total} />} sub={data?.accounts?.suspended ? `${data.accounts.suspended} suspended` : 'all active'} />
        <Stat label="Backup" value={<span className="text-sm">{data?.backup?.enabled === false ? 'Disabled' : data?.backup?.lastDate ?? '—'}</span>} />
      </div>
      <div className="flex flex-wrap gap-1">
        {svc.map((s: any) => <Badge key={s.name} tone={s.running === false ? 'bad' : s.running ? 'ok' : 'muted'}>{s.display}</Badge>)}
      </div>
      {down.length > 0 && <div className="text-xs text-bad">Not running: {down.map((d: any) => d.display).join(', ')}</div>}
      {data?.unavailable?.length > 0 && <div className="text-xs text-muted">This token may not read: {data.unavailable.join(', ')}.{data?.fullAccess === false ? ' It lacks the "all" privilege (root-level access).' : ''}</div>}
      {(size === 'L' || size === 'XL') && (
        <Section title="Accounts">
          <List>{(data?.accounts?.list ?? []).map((a: any) => <Row key={a.user} left={<StatusDot status={!a.suspended} />} title={a.domain} sub={`${a.user} · ${a.plan ?? ''}`} right={<span className="num text-xs text-muted">{a.diskUsed} / {a.diskLimit}</span>} />)}</List>
        </Section>
      )}
    </div>
  );
}

export function CpanelAccounts({ data, size }: WidgetProps) {
  const accts = data?.accounts ?? [];
  if (!accts.length) return <Empty icon={<Server />} title="No accounts" />;
  return (
    <List>
      {accts.map((a: any) => (
        <div key={a.user} className="rounded-xl border border-line p-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{a.user}</span>
            {a.error && <Badge tone="bad">error</Badge>}
            <span className="num ml-auto text-xs text-muted">{num(a.diskUsedMb)} MB{a.diskLimitMb ? ` / ${num(a.diskLimitMb)} MB` : ''}</span>
          </div>
          {a.diskLimitMb && <Progress value={ratio(a.diskUsedMb, a.diskLimitMb)} tone="auto" height={4} className="mt-2" />}
          {a.error && <div className="mt-1 text-xs text-bad">{a.error}</div>}
          <div className="mt-2 flex flex-wrap gap-1">
            {a.ssl.map((s: any) => <Badge key={s.host} tone={s.daysLeft < 7 ? 'bad' : s.daysLeft < 21 ? 'warn' : 'ok'}><Lock className="size-3" />{s.host} · {s.daysLeft} d</Badge>)}
          </div>
          {size !== 'M' && (
            <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
              <div className="space-y-0.5 text-muted"><div className="flex items-center gap-1 font-medium text-fg/80"><Globe className="size-3" />Domains</div>{a.domains.slice(0, 6).map((d: string) => <div key={d} className="truncate">{d}</div>)}</div>
              <div className="space-y-1"><div className="flex items-center gap-1 font-medium text-fg/80"><Mail className="size-3" />Mailboxes</div>
                {a.mailboxes.slice(0, 6).map((m: any) => (
                  <div key={m.email}><div className="flex justify-between text-muted"><span className="truncate">{m.email}</span><span className="num">{num(m.usedMb)} MB</span></div>{m.quotaMb ? <Progress value={ratio(m.usedMb, m.quotaMb)} tone="auto" height={3} /> : null}</div>
                ))}
              </div>
            </div>
          )}
          {a.bandwidthMb != null && <div className="num mt-2 text-[11px] text-muted">Bandwidth {num(a.bandwidthMb)} MB{a.bandwidthLimitMb ? ` / ${num(a.bandwidthLimitMb)} MB` : ''}</div>}
        </div>
      ))}
    </List>
  );
}

// ---------- generic ----------
export function GenericValues({ data, size }: WidgetProps) {
  const v = data?.values ?? [];
  return (
    <div className="grid h-full content-start gap-3" style={{ gridTemplateColumns: `repeat(${size === 'S' ? 1 : 2}, minmax(0,1fr))` }}>
      {v.map((x: any, i: number) => <Stat key={i} label={x.label} value={typeof x.value === 'number'
        ? <><AnimatedNumber value={x.value} format={(n) => (Math.abs(n) < 100 ? n.toFixed(1).replace(/\.0$/, '') : Math.round(n).toLocaleString(locale()))} /><span className="ml-1 text-sm text-muted">{x.unit}</span></>
        : x.value == null || x.value === '' ? '—' : <>{String(x.value).slice(0, 80)}{x.unit && <span className="ml-1 text-sm text-muted">{x.unit}</span>}</>} />)}
      {v.length === 0 && <Empty title="No values configured" />}
    </div>
  );
}
export function DockerContainers({ data, size, instance }: WidgetProps) {
  const c = data?.containers ?? [];
  return (
    <List>
      {c.map((x: any) => (
        <Row key={x.id} left={<StatusDot status={x.state === 'running' ? (x.health === 'unhealthy' ? 'degraded' : 'up') : x.state === 'exited' ? 'disabled' : 'down'} />}
          title={x.name} sub={size !== 'S' ? x.status : undefined}
          right={instance && size !== 'S' && (
            <button className="text-muted opacity-0 transition hover:text-fg group-hover/row:opacity-100" title="Restart" onClick={stop(() => runAction(instance.id, 'restart', { id: x.id }, x.name))}><RotateCw className="size-3.5" /></button>
          )} />
      ))}
    </List>
  );
}
