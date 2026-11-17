import { toast } from '../components/feedback';

/** Standard `.catch` for user actions: show the error, stay quiet when the user cancelled the password prompt. */
export const fail = (e: any) => {
  if (e?.message === 'Cancelled') return;
  toast(e?.message ? String(e.message) : 'Something went wrong', 'bad');
};
/** Number typed into an input, or undefined when it is empty / not a number (so a cleared field never saves 0). */
export const numOr = (v: string, min = -Infinity, max = Infinity): number | undefined => {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};
