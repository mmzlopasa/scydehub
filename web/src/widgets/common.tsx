import type { ReactNode } from 'react';
import { cx } from '../components/ui';

export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('scroll-thin -mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1', className)}>{children}</div>;
}
export function Row({ left, title, sub, right, onClick, className }: { left?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode; onClick?: (e: React.MouseEvent) => void; className?: string }) {
  return (
    <div onClick={onClick} className={cx('group/row flex items-center gap-3 rounded-xl px-2 py-1.5 transition', onClick && 'cursor-pointer hover:bg-panel-2', className)}>
      {left}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        {sub && <div className="truncate text-xs text-muted">{sub}</div>}
      </div>
      {right && <div className="shrink-0 text-right">{right}</div>}
    </div>
  );
}
export function Grid({ children, cols = 2, className }: { children: ReactNode; cols?: number; className?: string }) {
  return <div className={cx('grid gap-x-4 gap-y-3', className)} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{children}</div>;
}
export function Section({ title, children, right }: { title: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted">{title}{right}</div>
      {children}
    </div>
  );
}
/** stop click from bubbling to the widget (which opens the detail panel) */
export const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
