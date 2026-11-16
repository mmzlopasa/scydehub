import { Check, X, Clapperboard, Users, Captions, Image as ImageIcon, Zap, Inbox } from 'lucide-react';
import type { WidgetProps } from '../types';
import { Badge, Progress, Stat, Empty, AnimatedNumber, StatusDot, cx } from '../../components/ui';
import { bytes, ago, num, ratio } from '../../lib/format';
import { runAction } from '../../lib/hooks';
import { List, Row, Section, stop } from '../common';

export function StreameroStreams({ data, size }: WidgetProps) {
  const s = data?.streams ?? [];
  if (size === 'S')
    return (
      <div className="flex h-full flex-col justify-between">
        <Stat label="Active" value={<AnimatedNumber value={s.length} />} sub={`${s.filter((x: any) => x.transcoding).length} transcoding`} />
        <div className="flex -space-x-2">{s.slice(0, 5).map((x: any, i: number) => <Avatar key={i} name={x.user} />)}</div>
      </div>
    );
  if (!s.length) return <Empty icon={<Clapperboard />} title="Nobody is watching right now" />;
  return (
    <List>
      {s.map((x: any, i: number) => (
        <div key={i} className="rounded-xl px-2 py-2 hover:bg-panel-2">
          <div className="flex items-center gap-3">
            <Avatar name={x.user} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{x.title}</div>
              <div className="truncate text-xs text-muted">{x.user}{x.subtitle ? ` · ${x.subtitle}` : ''}{x.device ? ` · ${x.device}` : ''}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              {x.transcoding ? <Badge tone="warn"><Zap className="size-3" />Transcode</Badge> : <Badge tone="ok">Direct</Badge>}
              {size !== 'M' && x.quality && <span className="text-[11px] text-muted">{x.quality}</span>}
            </div>
          </div>
          {x.progress != null && <Progress value={x.progress} height={3} className="mt-2" />}
        </div>
      ))}
    </List>
  );
}
function Avatar({ name }: { name: string }) {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return <span className="grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-white ring-2 ring-[var(--bg)]" style={{ background: `hsl(${hue} 60% 45%)` }}>{name.slice(0, 1).toUpperCase()}</span>;
}

export function StreameroLibrary({ data, size }: WidgetProps) {
  const l = data?.library ?? {};
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Movies" value={<AnimatedNumber value={l.movies} />} />
        <Stat label="Series" value={<AnimatedNumber value={l.shows} />} />
        {size !== 'S' && <Stat label="Episodes" value={<AnimatedNumber value={l.episodes} />} />}
        {size !== 'S' && <Stat label="Size" value={bytes(l.sizeBytes)} />}
      </div>
      <Section title="Recently added">
        <List>
          {(data?.recentlyAdded ?? []).map((r: any, i: number) => <Row key={i} title={r.title} sub={r.subtitle} right={<span className="text-xs text-muted">{ago(r.addedAt)}</span>} />)}
        </List>
      </Section>
    </div>
  );
}

export function SeerrRequests({ data, size, instance }: WidgetProps) {
  const p = data?.pending ?? [];
  const c = data?.counts ?? {};
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Pending" value={<span className={cx(c.pending > 0 && 'text-warn')}><AnimatedNumber value={c.pending} /></span>} />
        <Stat label="Processing" value={<AnimatedNumber value={c.processing} />} />
        <Stat label="Available" value={<AnimatedNumber value={c.available} />} />
      </div>
      {size !== 'S' && (
        p.length ? (
          <List>
            {p.map((r: any) => (
              <Row key={r.id}
                left={r.poster ? <img src={r.poster} alt="" className="h-10 w-7 rounded object-cover" /> : <div className="grid h-10 w-7 place-items-center rounded bg-panel-2"><Inbox className="size-3.5 text-muted" /></div>}
                title={<>{r.title} <span className="text-muted font-normal">{r.year}</span></>}
                sub={`${r.type === 'tv' ? 'Series' : 'Movie'} · ${r.requestedBy} · ${ago(r.createdAt)}`}
                right={instance && (
                  <div className="flex gap-1">
                    <button className="grid size-8 place-items-center rounded-lg bg-ok/15 text-ok hover:bg-ok/25" title="Approve" onClick={stop(() => runAction(instance.id, 'approve', { id: r.id }, r.title))}><Check className="size-4" /></button>
                    <button className="grid size-8 place-items-center rounded-lg bg-bad/10 text-bad hover:bg-bad/20" title="Decline" onClick={stop(() => runAction(instance.id, 'decline', { id: r.id }, r.title))}><X className="size-4" /></button>
                  </div>
                )} />
            ))}
          </List>
        ) : <Empty icon={<Check />} title="No pending requests" />
      )}
    </div>
  );
}

export function BazarrSubtitles({ data, size }: WidgetProps) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Episodes" value={<AnimatedNumber value={data?.wantedEpisodes} />} sub="missing subtitles" />
        <Stat label="Movies" value={<AnimatedNumber value={data?.wantedMovies} />} sub="missing subtitles" />
      </div>
      <div className="flex flex-wrap gap-1">
        {(data?.providers ?? []).map((p: any) => <Badge key={p.name} tone={p.status === 'Good' ? 'ok' : 'warn'}>{p.name}</Badge>)}
      </div>
      {size !== 'S' && (
        <Section title="Recent downloads">
          <List>{(data?.history ?? []).map((h: any, i: number) => <Row key={i} left={<Captions className="size-4 text-muted" />} title={h.title} sub={[h.subtitle, h.language, h.provider].filter(Boolean).join(' · ')} />)}</List>
        </Section>
      )}
    </div>
  );
}

export function ProwlarrIndexers({ data, size, instance }: WidgetProps) {
  const ix = data?.indexers ?? [];
  const enabled = ix.filter((i: any) => i.enabled);
  const failing = enabled.filter((i: any) => i.failing);
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Indexers" value={<span>{enabled.length - failing.length}<span className="text-muted">/{enabled.length}</span></span>} />
        <Stat label="Queries" value={<AnimatedNumber value={data?.totals?.queries} />} />
        <Stat label="Grabs" value={<AnimatedNumber value={data?.totals?.grabs} />} />
      </div>
      {size !== 'S' ? (
        <List>
          {[...enabled].sort((a: any, b: any) => Number(b.failing) - Number(a.failing) || b.grabs - a.grabs).map((i: any) => (
            <Row key={i.id} left={<StatusDot status={!i.failing} />} title={i.name} sub={`${num(i.queries)} queries · ${num(i.grabs)} grabs`}
              right={<span className="num text-xs text-muted">{i.avgResponse} ms</span>} />
          ))}
        </List>
      ) : failing.length > 0 && <div className="text-xs text-bad">Failing: {failing.map((f: any) => f.name).join(', ')}</div>}
      {size === 'L' && instance && <button className="text-xs text-accent" onClick={stop(() => runAction(instance.id, 'testAll'))}>Test all indexers</button>}
    </div>
  );
}

export function ImmichLibrary({ data, size }: WidgetProps) {
  const queues = (data?.queues ?? []).filter((q: any) => q.active || q.waiting || q.failed);
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Photos" value={<AnimatedNumber value={data?.photos} />} />
        <Stat label="Videos" value={<AnimatedNumber value={data?.videos} />} />
        <Stat label="Usage" value={bytes(data?.usage)} />
      </div>
      {data?.disk && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted"><span>Disk</span><span className="num">{bytes(data.disk.used)} / {bytes(data.disk.size)}</span></div>
          <Progress value={data.disk.pct} tone="auto" height={5} />
        </div>
      )}
      {size !== 'S' && (
        <Section title="Job queue">
          {queues.length ? (
            <List>
              {queues.map((q: any) => (
                <Row key={q.name} left={<ImageIcon className="size-4 text-muted" />} title={q.name}
                  right={<div className="num flex gap-2 text-xs">{q.active > 0 && <Badge tone="info">{q.active} active</Badge>}{q.waiting > 0 && <Badge>{num(q.waiting)} waiting</Badge>}{q.failed > 0 && <Badge tone="bad">{q.failed} failed</Badge>}</div>} />
              ))}
            </List>
          ) : <div className="text-xs text-muted">All jobs are done</div>}
        </Section>
      )}
      {size === 'L' && data?.users?.length > 0 && (
        <Section title={<span className="flex items-center gap-1"><Users className="size-3" />Users</span>}>
          {data.users.map((u: any) => <Row key={u.name} title={u.name} sub={`${num(u.photos)} photos · ${num(u.videos)} videos`} right={<span className="num text-xs">{bytes(u.usage)}</span>} />)}
        </Section>
      )}
    </div>
  );
}

export function MediarrLibrary({ data, size }: WidgetProps) {
  const busy = (data?.jobs ?? []).reduce((a: number, j: any) => a + j.active + j.waiting, 0);
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Photos" value={<AnimatedNumber value={data?.photos} />} />
        <Stat label="Videos" value={<AnimatedNumber value={data?.videos} />} />
      </div>
      {data?.diskTotalBytes ? (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted"><span>Usage</span><span className="num">{bytes(data.usageBytes)} / {bytes(data.diskTotalBytes)}</span></div>
          <Progress value={ratio(data.usageBytes, data.diskTotalBytes)} tone="auto" height={5} />
        </div>
      ) : <Stat label="Usage" value={bytes(data?.usageBytes)} />}
      <div className="mt-auto flex items-center justify-between text-xs text-muted">
        <span>Last upload {ago(data?.lastUploadAt)}</span>
        {size !== 'S' && <Badge tone={busy ? 'info' : 'muted'}>{busy ? `${busy} jobs` : 'Idle'}</Badge>}
      </div>
    </div>
  );
}
