import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertOctagon, Pause, Play, Wifi, WifiOff } from 'lucide-react';
import { useStore } from '../lib/store';
import { kioskToken, post } from '../lib/api';
import type { Profile } from '../lib/device';
import { BoardView } from './Board';
import { Button, cx } from '../components/ui';
import { CoreIcon } from '../components/icons';
import { useNow } from '../lib/hooks';
import { duration, time } from '../lib/format';
import { useSummary } from '../widgets/core/core';
import { toast } from '../components/feedback';

function inWindow(start: string, end: string, d = new Date()) {
  const m = d.getHours() * 60 + d.getMinutes();
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const s = sh * 60 + sm, e = eh * 60 + em;
  return s <= e ? m >= s && m < e : m >= s || m < e;
}

/** Wake Lock API — keeps the screen on in browsers that support it (native shells also keep it on). */
function useWakeLock() {
  useEffect(() => {
    let lock: any = null;
    const req = async () => { try { lock = await (navigator as any).wakeLock?.request('screen'); } catch { /* not allowed */ } };
    void req();
    const vis = () => document.visibilityState === 'visible' && void req();
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); lock?.release?.(); };
  }, []);
}

export function Kiosk({ profile }: { profile: Profile }) {
  const boards = useStore((s) => s.boards);
  const settings = useStore((s) => s.settings);
  const incidents = useStore((s) => s.incidents);
  const conn = useStore((s) => s.conn);
  const me = useStore((s) => s.me);
  const k = settings?.kiosk;
  const rotation = boards.filter((b) => b.in_rotation);
  const list = rotation.length ? rotation : boards;
  const [idx, setIdx] = useState(0);
  const [pausedUntil, setPausedUntil] = useState(0);
  const [cursor, setCursor] = useState(false);
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const now = useNow(1000);
  const sum = useSummary();
  const cursorTimer = useRef<number>();
  useWakeLock();

  const paused = pausedUntil > now;
  const interact = useCallback(() => {
    setPausedUntil(Date.now() + (k?.pauseOnInteractSec ?? 120) * 1000);
    setCursor(true);
    clearTimeout(cursorTimer.current);
    cursorTimer.current = window.setTimeout(() => setCursor(false), 3000);
  }, [k?.pauseOnInteractSec]);

  // rotation
  useEffect(() => {
    const sec = Number(k?.rotationSec ?? 30);
    if (paused || list.length < 2 || !(sec > 0)) return; // 0 = stay on the first board
    const t = setTimeout(() => setIdx((i) => (i + 1) % list.length), Math.max(3, sec) * 1000);
    return () => clearTimeout(t);
  }, [idx, paused, list.length, k?.rotationSec]);

  // burn-in protection: move the whole canvas by a few pixels every 2 minutes
  useEffect(() => {
    if (k?.pixelShift === false) return;
    const t = setInterval(() => setShift({ x: Math.round(Math.random() * 6 - 3), y: Math.round(Math.random() * 6 - 3) }), 120_000);
    return () => clearInterval(t);
  }, [k?.pixelShift]);

  // D-pad / keyboard: ←/→ boards, OK/space pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { setIdx((i) => (i + 1) % list.length); interact(); }
      else if (e.key === 'ArrowLeft') { setIdx((i) => (i - 1 + list.length) % list.length); interact(); }
      else if (e.key === ' ' || e.key === 'MediaPlayPause') { setPausedUntil((p) => (p > Date.now() ? 0 : Date.now() + 3600_000)); }
      else if (e.key === 'ArrowDown') window.scrollBy({ top: 300, behavior: 'smooth' });
      else if (e.key === 'ArrowUp') window.scrollBy({ top: -300, behavior: 'smooth' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [list.length, interact]);

  useEffect(() => { if (idx >= list.length) setIdx(0); }, [idx, list.length]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [idx]);

  // 5 quick taps on the clock: back to the native shell's setup screen (iOS app) or the token screen (browser)
  const taps = useRef<number[]>([]);
  const secretTap = () => {
    const t = Date.now();
    taps.current = [...taps.current.filter((x) => t - x < 2500), t];
    if (taps.current.length < 5) return;
    taps.current = [];
    if (window.parent !== window) window.parent.postMessage({ scyde: 'setup' }, '*'); // iOS shell: back to its setup screen
    else if (me?.auth?.kind === 'kiosk' && confirm('Disconnect this device (forget the kiosk token)?')) { kioskToken.clear(); location.assign('/kiosk'); }
  };

  const board = list[idx];
  const dim = k?.nightDim?.enabled && inWindow(k.nightDim.start, k.nightDim.end, new Date(now)) ? k.nightDim.level : 0;
  const takeover = k?.alertTakeover !== false ? incidents.filter((i) => !i.resolved_at && !i.acked_at && i.severity === 'critical') : [];
  const canAck = me?.auth?.kind === 'admin' || (me?.auth?.kind === 'kiosk' && me.auth.canAck);

  return (
    <div className={cx('kiosk min-h-full', cursor && 'cursor-ok')} onMouseMove={interact} onTouchStart={interact} onClick={interact}>
      <div style={{ transform: `translate(${shift.x}px, ${shift.y}px)`, transition: 'transform 2s ease' }} className={cx('mx-auto max-w-[2400px]', profile === 'tv' ? 'px-8 py-6' : 'px-4 py-4 sm:px-6')}>
        <div className={cx('mb-4 flex items-center gap-4', k?.showHeader === false && 'hidden')}>
          <div className="flex items-center gap-2 text-lg font-semibold">{board && <CoreIcon name={board.icon} className="size-5 text-accent" />}{board?.name}</div>
          <div className="flex gap-1.5">{list.map((b, i) => <span key={b.id} className={cx('h-1.5 rounded-full transition-all', i === idx ? 'w-6 bg-accent' : 'w-1.5 bg-line')} />)}</div>
          {paused && <span className="flex items-center gap-1 text-xs text-muted"><Pause className="size-3" />paused</span>}
          <div className="ml-auto flex items-center gap-4 text-sm">
            <span className={cx('num font-medium', sum.down ? 'text-bad' : 'text-ok')}>{sum.up}/{sum.total} online</span>
            {conn !== 'online' ? <WifiOff className="size-4 text-bad" /> : <Wifi className="size-4 text-muted" />}
            <span className="dot select-none text-2xl font-semibold" onClick={secretTap}>{time(now)}</span>
          </div>
        </div>
        {board ? <div key={board.id} className="animate-fade-up"><BoardView board={board} profile={profile} editing={false} kiosk /></div> : <div className="py-20 text-center text-muted">No boards.</div>}
      </div>

      {conn === 'offline' && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full bg-bad/90 px-4 py-2 text-sm text-white shadow-lg">Connection to the Hub lost — reconnecting…</div>
      )}

      {takeover.length > 0 && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[radial-gradient(circle_at_center,rgba(239,68,68,.35),rgba(0,0,0,.92))] p-6">
          <div className="w-full max-w-3xl space-y-4 text-center">
            <AlertOctagon className="mx-auto size-20 animate-pulse text-bad" />
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-bad">{takeover.length > 1 ? `${takeover.length} active incidents` : 'Incident'}</div>
            {takeover.slice(0, 3).map((i) => (
              <div key={i.id} className="rounded-3xl border border-bad/40 bg-black/40 p-6 text-left">
                <div className="text-3xl font-semibold text-white">{i.title}</div>
                <div className="mt-1 text-lg text-white/70">{i.message}</div>
                <div className="num mt-2 text-sm text-white/50">Ongoing for {duration((now - i.started_at) / 1000, 2)}</div>
                {canAck && (
                  <Button autoFocus className="tv-focus mt-4 !h-12 !px-6 !text-base" variant="danger" onClick={() => post(`/api/incidents/${i.id}/ack`).catch((e) => toast(e.message, 'bad'))}>Acknowledge incident</Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {dim > 0 && <div className="pointer-events-none fixed inset-0 z-[45] bg-black transition-opacity duration-[3000ms]" style={{ opacity: dim }} />}
      {!paused && list.length > 1 && cursor && (
        <button className="fixed bottom-4 right-4 z-40 grid size-10 place-items-center rounded-full bg-panel-2 text-muted" onClick={() => setPausedUntil(Date.now() + 3600_000)}><Pause className="size-4" /></button>
      )}
      {paused && cursor && (
        <button className="fixed bottom-4 right-4 z-40 grid size-10 place-items-center rounded-full bg-accent text-white" onClick={() => setPausedUntil(0)}><Play className="size-4" /></button>
      )}
    </div>
  );
}
