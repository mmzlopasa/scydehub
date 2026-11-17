import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../../lib/store';
import { del, patch, post } from '../../lib/api';
import { Button, Input, Toggle, inputCls } from '../../components/ui';
import { BOARD_ICONS, CoreIcon } from '../../components/icons';
import { confirmDialog } from '../../components/feedback';
import { PageHead, Card } from './Settings';
import { Templates } from './Templates';
import { fail } from '../../lib/fail';

export function Boards() {
  const boards = useStore((s) => s.boards);
  // moving renumbers the whole list, so it also works when several boards share a sort value (restored backups)
  const move = async (i: number, d: number) => {
    if (!boards[i] || !boards[i + d]) return;
    const order = boards.slice();
    [order[i], order[i + d]] = [order[i + d], order[i]];
    try {
      await Promise.all(order.map((x, n) => (x.sort !== n ? patch(`/api/boards/${x.id}`, { sort: n }) : null)));
    } catch (e) { fail(e); }
  };
  return (
    <>
      <PageHead title="Boards" desc="Boards and their order. Take a board out of the kiosk rotation if you don't want it on the TV."
        right={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => post('/api/boards', { name: 'New board', icon: 'layout-grid' }).catch(fail)}>New board</Button>} />
      <Templates />
      <div className="space-y-2">
        {boards.map((b, i) => (
          <Card key={b.id} className="!p-3">
            <div className="flex flex-wrap items-center gap-3">
              <CoreIcon name={b.icon} className="size-5 text-accent" />
              <Input key={b.id + b.name} className="max-w-xs" defaultValue={b.name} maxLength={60} onBlur={(e) => { const v = e.target.value.trim(); if (!v) { e.target.value = b.name; return; } if (v !== b.name) patch(`/api/boards/${b.id}`, { name: v }).catch(fail); }} />
              <select className={inputCls + ' max-w-[160px]'} value={b.icon} onChange={(e) => patch(`/api/boards/${b.id}`, { icon: e.target.value }).catch(fail)}>{BOARD_ICONS.map((n) => <option key={n}>{n}</option>)}</select>
              <Toggle checked={b.in_rotation} onChange={(v) => patch(`/api/boards/${b.id}`, { in_rotation: v }).catch(fail)} label="In kiosk rotation" />
              <span className="text-xs text-muted">{b.widgets.length} widgets</span>
              <div className="ml-auto flex">
                <Button size="sm" variant="ghost" icon={<ArrowUp className="size-3.5" />} onClick={() => move(i, -1)} disabled={i === 0} />
                <Button size="sm" variant="ghost" icon={<ArrowDown className="size-3.5" />} onClick={() => move(i, 1)} disabled={i === boards.length - 1} />
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={async () => { if (await confirmDialog({ title: `Delete board ${b.name}?`, body: 'All of its widgets will be deleted too.', danger: true, confirmLabel: 'Delete' })) await del(`/api/boards/${b.id}`).catch(fail); }} />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
