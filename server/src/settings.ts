import { getSetting, setSetting } from './db.js';

/**
 * Every customizable aspect of the Hub. `conform()` keeps stored values in exactly this shape,
 * so a bad or malicious PUT can never break the server or other clients.
 */
export const DEFAULT_SETTINGS = {
  branding: {
    name: 'SCYDE Hub',
    tagline: 'Homelab at a glance',
    /** '' = built-in mark · https URL · data:image/… (uploaded) */
    logo: '',
    favicon: '',
    showName: true,
    showLogo: true,
    loginTitle: 'Welcome back',
    loginSubtitle: 'Sign in to your dashboard.',
    footerText: '',
  },
  appearance: {
    theme: 'dark',            // dark | light | oled
    accent: '#FFD76A',        // primary (buttons, highlights)
    accent2: '#8B7CFF',       // secondary (charts, gradients)
    okColor: '#34D399',
    warnColor: '#FFC98A',
    badColor: '#FF7A8A',
    background: 'planet',     // planet | aurora | grid | solid | image
    backgroundImage: '',
    backgroundDim: 0.45,
    backgroundColor: '',
    glass: true,
    blur: 22,
    cardOpacity: 0.62,
    cardBorder: true,
    radius: 26,
    font: 'sora',             // sora | inter | geist | system
    numberFont: 'doto',       // doto | sans | mono
    fontScale: 1,
    density: 'comfortable',   // comfortable | compact
    animations: 'full',       // full | reduced | off
    tilt: true,
    glow: true,
    headerStyle: 'floating',  // floating | bar | hidden
    widgetHeaders: true,
    customCss: '',
  },
  layout: {
    mode: 'free',             // free (place anything anywhere) | pack (auto-compact upwards)
    allowOverlap: false,
    gap: 14,
    maxWidth: 1920,           // 0 = use the whole screen
    showGrid: true,
  },
  header: {
    showServices: true,
    showAlerts: true,
    showStreams: true,
    showTraffic: true,
    showClock: false,
    links: [] as { name: string; url: string }[],
  },
  regional: {
    locale: 'en-GB',
    hour12: false,
    tempUnit: 'c',            // c | f
  },
  kiosk: {
    rotationSec: 30, pauseOnInteractSec: 120, pixelShift: true, showHeader: true,
    nightDim: { enabled: true, start: '23:00', end: '07:00', level: 0.35 }, alertTakeover: true,
  },
  publicUrl: '',
  heartbeat: { url: '', intervalSec: 60 },
  weather: { lat: 45.815, lon: 15.982, name: 'Zagreb' },
  maintenanceUntil: 0,
};
export type Settings = typeof DEFAULT_SETTINGS;

const LIMITS: Record<string, number> = { logo: 500_000, favicon: 200_000, backgroundImage: 3_000_000, customCss: 30_000 };
const IMAGE_FIELDS = new Set(['logo', 'favicon', 'backgroundImage']);
const COLOR_FIELDS = new Set(['accent', 'accent2', 'okColor', 'warnColor', 'badColor', 'backgroundColor']);
const isImageRef = (v: string) => v === '' || /^https:\/\/[^\s"'<>]+$/.test(v) || /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v);

/** allowed range per numeric key (anything else: 0 … 1e13) */
const RANGES: Record<string, [number, number]> = {
  backgroundDim: [0, 1], blur: [0, 60], cardOpacity: [0, 1], radius: [0, 60], fontScale: [0.6, 1.8], gap: [0, 60], maxWidth: [0, 10_000],
  rotationSec: [0, 86_400], pauseOnInteractSec: [0, 86_400], level: [0, 1], intervalSec: [10, 86_400], lat: [-90, 90], lon: [-180, 180],
};
const ENUMS: Record<string, string[]> = {
  theme: ['dark', 'light', 'oled'], background: ['planet', 'aurora', 'grid', 'solid', 'image'], font: ['sora', 'inter', 'geist', 'system'],
  numberFont: ['doto', 'sans', 'mono'], density: ['comfortable', 'compact'], animations: ['full', 'reduced', 'off'],
  headerStyle: ['floating', 'bar', 'hidden'], mode: ['free', 'pack'], tempUnit: ['c', 'f'],
};
const validLocale = (l: string) => { try { new Intl.DateTimeFormat(l); return true; } catch { return false; } };

/** Coerce `input` into the shape of `def` (unknown keys dropped, wrong types replaced by the current value). */
function conform(def: any, input: any, current: any, key = ''): any {
  if (Array.isArray(def)) {
    if (!Array.isArray(input)) return current ?? def;
    if (key === 'links')
      return input.slice(0, 30).filter((l) => l && typeof l.name === 'string' && typeof l.url === 'string' && /^https?:\/\//i.test(l.url))
        .map((l) => ({ name: l.name.slice(0, 40), url: l.url.slice(0, 500) }));
    return current ?? def;
  }
  if (def !== null && typeof def === 'object') {
    const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const cur = current && typeof current === 'object' ? current : {};
    return Object.fromEntries(Object.keys(def).map((k) => [k, conform(def[k], k in src ? src[k] : cur[k], cur[k], k)]));
  }
  const fallback = current === undefined || typeof current !== typeof def ? def : current;
  if (typeof def === 'boolean') return typeof input === 'boolean' ? input : fallback;
  if (typeof def === 'number') {
    const n = typeof input === 'number' ? input : typeof input === 'string' && /^-?\d+(\.\d+)?$/.test(input.trim()) ? Number(input) : NaN;
    if (!Number.isFinite(n)) return fallback;
    const [min, max] = RANGES[key] ?? [0, 1e13];
    return Math.min(max, Math.max(min, n));
  }
  if (typeof input !== 'string') return fallback;
  const s = input.slice(0, LIMITS[key] ?? 300);
  if (IMAGE_FIELDS.has(key)) return isImageRef(s) && input.length <= (LIMITS[key] ?? 300) ? s : fallback;
  if (COLOR_FIELDS.has(key)) return s === '' || /^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
  if (key === 'url' || key === 'publicUrl') return s === '' || /^https?:\/\/[^\s]+$/i.test(s) ? s : fallback;
  if (key === 'start' || key === 'end') return /^\d{2}:\d{2}$/.test(s) ? s : fallback;
  if (key === 'locale') return /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(s) && validLocale(s) ? s : fallback;
  if (ENUMS[key]) return ENUMS[key].includes(s) ? s : fallback;
  return s;
}

export function allSettings(): Settings {
  const out: Record<string, any> = {};
  for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
    const stored = getSetting<any>(k, undefined);
    out[k] = conform(def, stored, undefined, k);
  }
  return out as Settings;
}

/** Apply a partial update; returns the names of the top-level keys that changed. */
export function updateSettings(patch: Record<string, unknown>): string[] {
  const cur = allSettings() as Record<string, any>;
  const changed: string[] = [];
  if (!patch || typeof patch !== 'object') return changed;
  for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(k in patch)) continue;
    const next = conform(def, (patch as any)[k], cur[k], k);
    if (JSON.stringify(next) !== JSON.stringify(cur[k])) {
      setSetting(k, next);
      changed.push(k);
    }
  }
  return changed;
}

/** What a read-only kiosk may see (no heartbeat capability URL, no public URL). */
export function kioskSettings(s = allSettings()) {
  const { heartbeat: _h, publicUrl: _p, ...rest } = s;
  return rest;
}
/** What the login page may see before anyone signed in. */
export function publicBranding(s = allSettings()) {
  const { branding, appearance, regional } = s;
  return { branding, appearance, regional };
}
