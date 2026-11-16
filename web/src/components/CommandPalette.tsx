import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, Zap, Settings, MonitorPlay, Pencil, CornerDownLeft } from 'lucide-react';
import { useStore, setState, getState } from '../lib/store';
import { runAction } from '../lib/hooks';
import { CoreIcon } from './icons';
import { ServiceIcon, StatusDot, cx } from './ui';

interface Cmd { id: string; group: string; label: string; hint?: string; icon: ReactNode; run: () => void; keywords?: string }

export function CommandPalette({ open, onClose, onOpenInstance }: { open: boolean; onClose: () => void; onOpenInstance: (id: string) => void }) {
  const nav = useNavigate();
  const boards = useStore((s) => s.boards);
  const instances = useStore((s) => s.instances);
  const plugins = useStore((s) => s.plugins);
  const states = useStore((s) => s.states);
  const isAdmin = useStore((s) => s.me?.auth?.kind === 'admin');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) { setQ(''); setSel(0); } }, [open]);

  const cmds = useMemo<Cmd[]>(() => {
    const out: Cmd[] = [];
    for (const b of boards) out.push({ id: `b:${b.id}`, group: 'Stranice', label: b.name, icon: <CoreIcon name={b.icon} className="size-4" />, run: () => nav(`/b/${b.id}`) });
    for (const i of instances) {
      const p = plugins.find((x) => x.id === i.plugin);
      out.push({ id: `i:${i.id}`, group: 'Servisi', label: i.name, hint: states[i.id]?.summary, keywords: p?.name, icon: <span className="relative"><ServiceIcon slug={p?.icon} name={i.name} size={18} /><span className="absolute -bottom-0.5 -right-0.5"><StatusDot status={states[i.id]?.status} size={6} /></span></span>, run: () => onOpenInstance(i.id) });
      if (isAdmin)
        for (const a of p?.actions ?? []) {
          if (a.params.some((f) => f.required)) continue; // actions needing params are run from the detail panel
          out.push({ id: `a:${i.id}:${a.id}`, group: 'Akcije', label: `${i.name}: ${a.label}`, icon: <Zap className={cx('size-4', a.danger ? 'text-bad' : 'text-accent')} />, run: () => void runAction(i.id, a.id) });
        }
    }
    if (isAdmin) {
      out.push({ id: 'edit', group: 'Općenito', label: getState().editMode ? 'Završi uređivanje' : 'Uredi raspored', icon: <Pencil className="size-4" />, run: () => setState({ editMode: !getState().editMode }) });
      const pages: [string, string][] = [['services', 'Servisi'], ['checks', 'Provjere'], ['alerts', 'Alerti i kanali'], ['incidents', 'Incidenti'], ['boards', 'Stranice'], ['kiosk', 'Kiosk i uređaji'], ['appearance', 'Izgled'], ['security', 'Sigurnost'], ['audit', 'Audit log'], ['system', 'Backup i sustav']];
      for (const [k, l] of pages) out.push({ id: `s:${k}`, group: 'Postavke', label: l, icon: <Settings className="size-4" />, run: () => nav(`/settings/${k}`) });
    }
    out.push({ id: 'kiosk', group: 'Općenito', label: 'Otvori kiosk način', icon: <MonitorPlay className="size-4" />, run: () => nav('/kiosk') });
    return out;
  }, [boards, instances, plugins, states, isAdmin, nav, onOpenInstance]);

  const filtered = useMemo(() => {
    const t = q.toLowerCase().trim();
    if (!t) return cmds.filter((c) => c.group !== 'Akcije').slice(0, 40);
    return cmds
      .map((c) => {
        const hay = `${c.label} ${c.keywords ?? ''} ${c.group}`.toLowerCase();
        const idx = hay.indexOf(t);
        const fuzzy = idx < 0 && t.split('').every((ch, i, arr) => hay.indexOf(ch, i ? hay.indexOf(arr[i - 1]) : 0) >= 0);
        return { c, score: idx === 0 ? 3 : idx > 0 ? 2 : fuzzy ? 1 : 0 };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c)
      .slice(0, 50);
  }, [cmds, q]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  if (!open) return null;
  const exec = (c?: Cmd) => { if (!c) return; onClose(); setTimeout(c.run, 0); };
  let lastGroup = '';
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass animate-pop w-full max-w-xl overflow-hidden rounded-3xl" style={{ background: 'color-mix(in oklab, var(--bg) 90%, transparent)' }}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-5 text-muted" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Skoči na servis, akciju ili stranicu…" className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(filtered.length - 1, s + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === 'Enter') exec(filtered[sel]);
              else if (e.key === 'Escape') onClose();
            }} />
          <kbd className="rounded-md border border-line px-1.5 py-0.5 text-[10px] text-muted">ESC</kbd>
        </div>
        <div ref={listRef} className="scroll-thin max-h-[55vh] overflow-y-auto p-2">
          {filtered.map((c, i) => {
            const header = c.group !== lastGroup ? (lastGroup = c.group) : null;
            return (
              <div key={c.id}>
                {header && <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{header}</div>}
                <button data-i={i} onMouseEnter={() => setSel(i)} onClick={() => exec(c)}
                  className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm', i === sel ? 'bg-accent-soft text-fg' : 'text-fg/90')}>
                  <span className="grid size-6 place-items-center text-muted">{c.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.hint && <span className="max-w-[40%] truncate text-xs text-muted">{c.hint}</span>}
                  {i === sel && <CornerDownLeft className="size-3.5 text-muted" />}
                </button>
              </div>
            );
          })}
          {!filtered.length && <div className="py-10 text-center text-sm text-muted">Nema rezultata</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
