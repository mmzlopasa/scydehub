import { useEffect, useState } from 'react';
import { get } from '../../lib/api';
import { Badge } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { PageHead, Card } from './Settings';

export function Audit() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { get('/api/audit?limit=500').then(setRows); }, []);
  return (
    <>
      <PageHead title="Audit log" desc="Svaka akcija, prijava i promjena konfiguracije, s korisnikom, IP adresom i rezultatom." />
      <Card className="!p-0 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-4 py-2 font-medium">Vrijeme</th><th className="font-medium">Tko</th><th className="font-medium">Akcija</th><th className="font-medium">Cilj</th><th className="font-medium">Rezultat</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line/60 last:border-0">
                <td className="num whitespace-nowrap px-4 py-2 text-xs text-muted">{dateTime(r.ts)}</td>
                <td className="text-xs">{r.actor}<div className="text-muted">{r.ip}</div></td>
                <td className="font-mono text-xs">{r.action}{r.params && r.params !== '{}' && <div className="max-w-[260px] truncate text-muted" title={r.params}>{r.params}</div>}</td>
                <td className="max-w-[200px] truncate text-xs">{r.target}</td>
                <td className="pr-4 text-xs">{r.ok ? <Badge tone="ok">ok</Badge> : <Badge tone="bad">greška</Badge>} <span className="text-muted">{r.result}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="py-10 text-center text-sm text-muted">Prazno.</div>}
      </Card>
    </>
  );
}
