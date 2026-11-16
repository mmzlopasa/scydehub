import { Search, Trash2, AlertTriangle, CalendarDays, Film, Tv, HardDrive } from 'lucide-react';
import type { WidgetProps } from '../types';
import { Badge, Progress, Stat, Empty, Button, AnimatedNumber } from '../../components/ui';
import { bytes, dayLabel, ratio, time } from '../../lib/format';
import { runAction } from '../../lib/hooks';
import { useStore } from '../../lib/store';
import { List, Row, stop } from '../common';

function stateTone(q: any): 'ok' | 'warn' | 'bad' | 'info' | 'muted' {
  if (q.trackedStatus === 'error') return 'bad';
  if (q.trackedStatus === 'warning') return 'warn';
  if (q.status === 'completed' || q.state === 'importPending') return 'ok';
  if (q.status === 'downloading') return 'info';
  return 'muted';
}
const stateLabel = (q: any) => (q.state === 'importPending' ? 'Importing' : q.status === 'downloading' ? 'Downloading' : q.status === 'queued' ? 'Queued' : q.status === 'completed' ? 'Done' : q.status);

/** Matches *arr queue items with qBittorrent torrents by downloadId (= torrent hash). */
function useTorrentMap() {
  const states = useStore((s) => s.states);
  const map = new Map<string, any>();
  for (const st of Object.values(states)) if (st.plugin === 'qbittorrent') for (const t of st.data?.active ?? []) map.set(String(t.hash).toLowerCase(), t);
  return map;
}

export function ArrQueue({ data, size, instance, plugin }: WidgetProps) {
  const torrents = useTorrentMap();
  const q = data?.queue ?? [];
  if (!q.length) return <Empty icon={plugin?.id === 'radarr' ? <Film /> : <Tv />} title="Queue is empty">Nothing is downloading</Empty>;
  if (size === 'S')
    return (
      <div className="flex h-full flex-col justify-between">
        <Stat label="Queued" value={<AnimatedNumber value={data.queueTotal} />} sub={`${q.filter((x: any) => x.status === 'downloading').length} downloading`} />
        <div className="space-y-1.5">{q.slice(0, 2).map((x: any) => <div key={x.id}><div className="truncate text-xs">{x.title}</div><Progress value={x.progress} height={4} /></div>)}</div>
      </div>
    );
  return (
    <List>
      {q.map((x: any) => {
        const t = x.downloadId ? torrents.get(String(x.downloadId).toLowerCase()) : undefined;
        const progress = t ? t.progress : x.progress;
        return (
          <div key={x.id} className="group/row rounded-xl px-2 py-1.5 hover:bg-panel-2">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{x.title}</div>
                <div className="truncate text-xs text-muted">{x.subtitle}</div>
              </div>
              <Badge tone={stateTone(x)}>{stateLabel(x)}</Badge>
              {instance && size !== 'M' && (
                <button className="opacity-0 transition group-hover/row:opacity-100 text-muted hover:text-bad" title="Remove from queue"
                  onClick={stop(() => runAction(instance.id, 'removeQueueItem', { id: x.id }, x.title))}><Trash2 className="size-3.5" /></button>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <Progress value={progress} height={5} tone={x.trackedStatus === 'warning' ? 'warn' : 'accent'} />
              <span className="num w-12 shrink-0 text-right text-[11px] text-muted">{progress.toFixed(0)}%</span>
            </div>
            <div className="num mt-1 flex gap-3 text-[11px] text-muted">
              <span>{bytes(x.size - x.sizeleft)} / {bytes(x.size)}</span>
              {t && t.dlspeed > 0 && <span className="text-accent">↓ {bytes(t.dlspeed)}/s</span>}
              {x.timeleft && x.status === 'downloading' && <span className="ml-auto">ETA {x.timeleft}</span>}
              {t && <span className="ml-auto">qBit: {t.state}</span>}
            </div>
          </div>
        );
      })}
    </List>
  );
}

export function ArrOverview({ data, size, instance, plugin }: WidgetProps) {
  const disk = data?.disks?.[0];
  const isRadarr = plugin?.id === 'radarr';
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Stat label={isRadarr ? 'Movies' : 'Series'} value={<AnimatedNumber value={data?.library} />} />
        <Stat label="Missing" value={<AnimatedNumber value={data?.missing} />} />
        {size !== 'S' && <Stat label="Queued" value={<AnimatedNumber value={data?.queueTotal} />} />}
        {size !== 'S' && <Stat label="Version" value={<span className="text-sm">{data?.version ?? '—'}</span>} />}
      </div>
      {data?.health?.length > 0 && (
        <div className="space-y-1">
          {data.health.slice(0, size === 'S' ? 1 : 3).map((h: any, i: number) => (
            <div key={i} className="flex items-start gap-2 rounded-lg bg-warn/10 px-2 py-1.5 text-xs text-warn"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><span className="line-clamp-2">{h.message}</span></div>
          ))}
        </div>
      )}
      {disk && (
        <div className="mt-auto space-y-1">
          <div className="flex justify-between text-xs text-muted"><span className="flex items-center gap-1"><HardDrive className="size-3" />{disk.label || disk.path}</span><span className="num">{bytes(disk.free)} free</span></div>
          <Progress value={ratio(disk.total - disk.free, disk.total)} tone="auto" height={4} />
        </div>
      )}
      {size !== 'S' && instance && (
        <Button size="sm" icon={<Search className="size-3.5" />} onClick={stop(() => runAction(instance.id, 'searchMissing'))}>Search missing</Button>
      )}
    </div>
  );
}

export function ArrCalendar({ data, size }: WidgetProps) {
  const items = (data?.calendar ?? []).filter((c: any) => new Date(c.date).getTime() > Date.now() - 86400_000);
  return <CalendarList items={items} size={size} />;
}

export function CalendarList({ items, size }: { items: any[]; size: string }) {
  if (!items.length) return <Empty icon={<CalendarDays />} title="Nothing in the calendar" />;
  const groups = new Map<string, any[]>();
  for (const c of items) {
    const k = dayLabel(c.date);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }
  return (
    <List>
      {[...groups.entries()].map(([day, list]) => (
        <div key={day} className="mb-1">
          <div className="sticky top-0 z-[1] bg-[color-mix(in_oklab,var(--panel)_92%,transparent)] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted backdrop-blur">{day}</div>
          {list.map((c: any) => (
            <Row key={`${c.source ?? ''}${c.id}`}
              left={c.source === 'radarr' ? <Film className="size-4 text-muted" /> : c.source === 'sonarr' ? <Tv className="size-4 text-muted" /> : undefined}
              title={c.title} sub={c.subtitle}
              right={<div className="flex items-center gap-2">{size !== 'M' && c.kind && <Badge>{c.kind}</Badge>}{c.hasFile ? <Badge tone="ok">Downloaded</Badge> : c.source !== 'radarr' && c.kind === undefined ? <span className="num text-xs text-muted">{time(c.date)}</span> : null}</div>} />
          ))}
        </div>
      ))}
    </List>
  );
}
