import type { Branding, Settings } from './types';
import { setLocale } from './format';

const FONTS: Record<string, string> = {
  sora: '"Sora Variable", "Sora", ui-sans-serif, system-ui, sans-serif',
  inter: '"Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif',
  geist: '"Geist Variable", "Geist", ui-sans-serif, system-ui, sans-serif',
  system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};
const NUM_FONTS: Record<string, string> = {
  doto: '"Doto Variable", "Doto", "Geist Mono Variable", ui-monospace, monospace',
  sans: 'inherit',
  mono: '"Geist Mono Variable", ui-monospace, "SF Mono", Menlo, monospace',
};

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = parseInt(m ? m[1] : 'FFD76A', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** readable text colour on top of an accent-coloured surface */
function onColor(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42 ? '#1B1530' : '#FFFFFF';
}
const mix = (hex: string, t: number, to: number) => { const [r, g, b] = rgb(hex).map((v) => Math.round(v + (to - v) * t)); return `rgb(${r}, ${g}, ${b})`; };

/** Push every appearance / branding setting into CSS variables, classes, the document title and the favicon. */
export function applyTheme(s: Pick<Settings, 'appearance' | 'branding' | 'regional'> | Branding | null, profile?: string) {
  const root = document.documentElement;
  const a = s?.appearance;
  const theme = a?.theme ?? 'dark';
  root.classList.toggle('dark', theme !== 'light');
  root.classList.toggle('light', theme === 'light');
  root.classList.toggle('oled', theme === 'oled');
  root.classList.toggle('no-glass', a?.glass === false);
  root.classList.toggle('no-border', a?.cardBorder === false);
  root.classList.toggle('no-glow', a?.glow === false);
  root.classList.toggle('compact', a?.density === 'compact');
  root.classList.toggle('tv', profile === 'tv');
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  root.dataset.motion = reduce && a?.animations !== 'off' ? 'reduced' : a?.animations ?? 'full';
  const set = (k: string, v: string) => root.style.setProperty(k, v);
  if (a) {
    const acc = a.accent || '#FFD76A', acc2 = a.accent2 || '#8B7CFF';
    set('--accent', acc);
    set('--accent-rgb', rgb(acc).join(','));
    set('--accent-hi', mix(acc, 0.55, 255));
    set('--accent-lo', mix(acc, 0.22, 0));
    set('--on-accent', onColor(acc));
    set('--accent2', acc2);
    set('--accent2-rgb', rgb(acc2).join(','));
    set('--accent2-hi', mix(acc2, 0.5, 255));
    set('--ok', a.okColor || '#34D399');
    set('--warn', a.warnColor || '#FFC98A');
    set('--bad', a.badColor || '#FF7A8A');
    set('--radius', `${Math.min(48, Math.max(0, a.radius))}px`);
    set('--blur', a.glass ? `${Math.min(60, Math.max(0, a.blur))}px` : '0px');
    set('--card-alpha', String(Math.min(1, Math.max(0.05, a.cardOpacity))));
    set('--font', FONTS[a.font] ?? FONTS.sora);
    set('--font-num', NUM_FONTS[a.numberFont] ?? NUM_FONTS.doto);
    set('--font-scale', String(Math.min(1.6, Math.max(0.7, a.fontScale || 1))));
    if (a.backgroundColor) set('--bg', a.backgroundColor); else root.style.removeProperty('--bg');
    root.dataset.numfont = a.numberFont;
    let el = document.getElementById('scyde-custom-css') as HTMLStyleElement | null;
    if (!el) { el = document.createElement('style'); el.id = 'scyde-custom-css'; document.head.appendChild(el); }
    if (el.textContent !== a.customCss) el.textContent = a.customCss ?? '';
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', a?.backgroundColor || (theme === 'light' ? '#EEF0F3' : theme === 'oled' ? '#000000' : '#0D0F14'));
  const b = s?.branding;
  if (b) {
    document.title = b.name || 'SCYDE Hub';
    const icon = b.favicon || b.logo;
    const link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
    if (link) { link.href = icon || '/favicon.svg'; if (icon) link.removeAttribute('type'); else link.type = 'image/svg+xml'; }
  }
  if (s?.regional) setLocale(s.regional.locale, s.regional.hour12);
}
