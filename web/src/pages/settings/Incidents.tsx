import { useEffect, useState } from 'react';
import { get, post } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Badge, Button, StatusDot } from '../../components/ui';
import { dateTime, duration } from '../../lib/format';
import { PageHead, Card } from './Settings';
import { toast } from '../../components/feedback';

export function Incidents() {
  const live = useStore((s) => s.incidents);
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { get('/api/incidents').then(setRows); }, [live]);
  return (
    <>
      <PageHead title="Incidents" desc="Log of all incidents with start time, duration and acknowledgement." />
      <Card className="!p-2">
        <div className="divide-y divide-line">
          {rows.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <StatusDot status={i.resolved_at ? 'up' : 'down'} pulse={!i.resolved_at} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{i.title}</div>
                <div className="truncate text-xs text-muted">{i.message}</div>
              </div>
              <Badge tone={i.severity === 'critical' ? 'bad' : i.severity === 'warning' ? 'warn' : 'info'}>{i.severity}</Badge>
              <div className="num w-44 text-right text-xs text-muted">{dateTime(i.started_at)} · {duration(((i.resolved_at ?? Date.now()) - i.started_at) / 1000)}</div>
              <div className="w-36 text-right text-xs">
                {i.acked_at ? <span className="text-muted">acknowledged by {i.acked_by}</span> : !i.resolved_at ? <Button size="sm" onClick={() => post(`/api/incidents/${i.id}/ack`).then(() => toast('Acknowledged'))}>Acknowledge</Button> : <span className="text-ok">resolved</span>}
              </div>
            </div>
          ))}
          {!rows.length && <div className="py-10 text-center text-sm text-muted">No incidents yet.</div>}
        </div>
      </Card>
    </>
  );
}
