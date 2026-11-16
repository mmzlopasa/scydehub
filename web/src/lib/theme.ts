import type { Settings } from './types';

export function applyTheme(s: Settings | null, profile?: string) {
  const root = document.documentElement;
  const a = s?.appearance;
  const theme = a?.theme ?? 'dark';
  root.classList.toggle('dark', theme !== 'light');
  root.classList.toggle('oled', theme === 'oled');
  root.classList.toggle('no-glass', a?.glass === false);
  root.classList.toggle('tv', profile === 'tv');
  if (a?.accent) root.style.setProperty('--accent', a.accent);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f5f8' : theme === 'oled' ? '#000000' : '#0a0a10');
}
