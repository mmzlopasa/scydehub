import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertTriangle, Info, ShieldCheck } from 'lucide-react';
import { Button, Input, Modal, cx } from './ui';
import { setSudoPrompt } from '../lib/api';

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
        <div key={t.id} className="pop animate-pop pointer-events-auto flex items-start gap-3 rounded-2xl px-4 py-3 text-sm">
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
    current?.resolve(false); // a second dialog replaces the first: settle it instead of leaving its caller hanging
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
        <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
        <Button autoFocus variant={c?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{c?.confirmLabel ?? 'Confirm'}</Button>
      </>}>
      <div className={cx('text-sm text-muted')}>{c?.body ?? 'Are you sure?'}</div>
    </Modal>
  );
}

// ---------- password re-confirmation ("sudo") ----------
let sudoResolve: ((v: boolean) => void) | null = null;
let sudoPending: Promise<boolean> | null = null;
/** Sensitive requests answer 403 {sudo:true}; lib/api.ts calls this, shows the dialog and retries. */
export function SudoHost() {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // several requests may need confirmation at once: they all wait for the same dialog
    setSudoPrompt(() => (sudoPending ??= new Promise<boolean>((resolve) => {
      sudoResolve = resolve;
      setPw(''); setErr(''); setOpen(true);
    }).finally(() => { sudoPending = null; })));
    return () => setSudoPrompt(null);
  }, []);
  const done = (v: boolean) => { setOpen(false); setPw(''); sudoResolve?.(v); sudoResolve = null; };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/auth/sudo', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-scyde': '1' }, body: JSON.stringify({ password: pw }) });
      if (r.ok) done(true); else setErr((await r.json().catch(() => ({}))).error ?? 'Wrong password');
    } catch { setErr('Network error'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={() => done(false)} title={<span className="flex items-center gap-2"><ShieldCheck className="size-4 text-accent" />Confirm it's you</span>}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">This action can expose or redirect stored credentials, or change something that is hard to undo. Enter your password to continue — you won't be asked again for 10 minutes.</p>
        <Input type="password" autoFocus autoComplete="current-password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <div className="rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => done(false)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Continue</Button>
        </div>
      </form>
    </Modal>
  );
}
