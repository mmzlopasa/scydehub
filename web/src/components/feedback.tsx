import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { Button, Modal, cx } from './ui';

// ---------- toasts ----------
type Toast = { id: number; tone: 'ok' | 'bad' | 'info'; text: string };
let toasts: Toast[] = [];
const tsubs = new Set<() => void>();
export function toast(text: string, tone: Toast['tone'] = 'ok') {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, tone, text }];
  tsubs.forEach((f) => f());
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); tsubs.forEach((f) => f()); }, tone === 'bad' ? 7000 : 3500);
}
export function Toaster() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((x) => x + 1); tsubs.add(f); return () => { tsubs.delete(f); }; }, []);
  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="glass animate-pop pointer-events-auto flex items-start gap-3 rounded-2xl px-4 py-3 text-sm" style={{ background: 'color-mix(in oklab, var(--bg) 85%, transparent)' }}>
          {t.tone === 'ok' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : t.tone === 'bad' ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad" /> : <Info className="mt-0.5 size-4 shrink-0 text-info" />}
          <div className="min-w-0 break-words">{t.text}</div>
        </div>
      ))}
    </div>,
    document.body,
  );
}

// ---------- confirm dialog (promise based) ----------
type ConfirmReq = { title: ReactNode; body?: ReactNode; danger?: boolean; confirmLabel?: string; resolve: (v: boolean) => void };
let current: ConfirmReq | null = null;
const csubs = new Set<() => void>();
export function confirmDialog(opts: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    current = { ...opts, resolve };
    csubs.forEach((f) => f());
  });
}
export function ConfirmHost() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((x) => x + 1); csubs.add(f); return () => { csubs.delete(f); }; }, []);
  const c = current;
  const close = (v: boolean) => { c?.resolve(v); current = null; force((x) => x + 1); };
  return (
    <Modal open={!!c} onClose={() => close(false)} title={c?.title}
      footer={<>
        <Button variant="ghost" onClick={() => close(false)}>Odustani</Button>
        <Button autoFocus variant={c?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{c?.confirmLabel ?? 'Potvrdi'}</Button>
      </>}>
      <div className={cx('text-sm text-muted')}>{c?.body ?? 'Jesi li siguran?'}</div>
    </Modal>
  );
}
