export type Profile = 'desktop' | 'tablet' | 'tv' | 'mobile';
const KEY = 'scyde.profile';

export function detectProfile(): Profile {
  const qp = new URLSearchParams(location.search).get('profile');
  if (qp === 'tv' || qp === 'tablet' || qp === 'desktop' || qp === 'mobile') {
    try { localStorage.setItem(KEY, qp); } catch { /* ignore */ }
    return qp;
  }
  try {
    const stored = localStorage.getItem(KEY) as Profile | null;
    if (stored) return stored;
  } catch { /* ignore */ }
  const ua = navigator.userAgent;
  if (/SCYDEHubTV|Android TV|AFT|BRAVIA|GoogleTV|SmartTV|Tizen|Web0S/i.test(ua)) return 'tv';
  if (window.innerWidth < 640) return 'mobile';
  if (/iPad|Tablet/i.test(ua) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1400)) return 'tablet';
  return 'desktop';
}
export function setProfile(p: Profile | null) {
  try { p ? localStorage.setItem(KEY, p) : localStorage.removeItem(KEY); } catch { /* ignore */ }
}
/** Fine grid: twice the old resolution in both directions, so widgets can sit (almost) anywhere. */
export const GRID: Record<Profile, { cols: number; rowHeight: number }> = {
  desktop: { cols: 24, rowHeight: 25 },
  tablet: { cols: 16, rowHeight: 25 },
  tv: { cols: 24, rowHeight: 30 },
  mobile: { cols: 8, rowHeight: 23 },
};
