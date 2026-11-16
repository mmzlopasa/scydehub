import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus, RotateCcw, Trash2, Sparkles, Type, LayoutGrid, Image as ImageIcon, PanelTop, Globe, Code2, Palette, Tag } from 'lucide-react';
import { useStore, setState, holdSettingsReload } from '../../lib/store';
import { post, put } from '../../lib/api';
import type { Settings } from '../../lib/types';
import { Button, ColorInput, ImagePicker, Input, Label, Segmented, Slider, Toggle, inputCls, cx } from '../../components/ui';
import { confirmDialog, toast } from '../../components/feedback';
import { PageHead, Card } from './Settings';

type Section = 'branding' | 'appearance' | 'layout' | 'header' | 'regional';

/** Edits apply instantly (live preview on every open device) and are saved a moment later. */
function useLiveSettings() {
  const settings = useStore((s) => s.settings);
  const pending = useRef<Record<string, any>>({});
  const timer = useRef<number>();
  useEffect(() => () => { clearTimeout(timer.current); if (Object.keys(pending.current).length) void put('/api/settings', pending.current).catch(() => {}); }, []);
  function update<K extends Section>(section: K, patch: Partial<Settings[K]>) {
    if (!settings) return;
    const next = { ...settings[section], ...patch };
    holdSettingsReload(2500);
    setState({ settings: { ...settings, [section]: next } });
    pending.current[section] = { ...(pending.current[section] ?? {}), ...patch };
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const body = pending.current;
      pending.current = {};
      put('/api/settings', body).catch((e) => toast(e.message, 'bad'));
    }, 500);
  }
  return { settings, update };
}

function Block({ icon, title, desc, children }: { icon: ReactNode; title: string; desc?: string; children: ReactNode }) {
  return (
    <Card className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">{icon}</div>
        <div><h2 className="font-semibold">{title}</h2>{desc && <p className="text-sm text-muted">{desc}</p>}</div>
      </div>
      {children}
    </Card>
  );
}
function Row({ label, help, children, wide }: { label: string; help?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx('grid gap-2', wide ? '' : 'sm:grid-cols-[200px_minmax(0,1fr)] sm:items-center sm:gap-6')}>
      <div><div className="text-sm font-medium">{label}</div>{help && <div className="text-xs text-muted">{help}</div>}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const ACCENTS = ['#FFD76A', '#FF9F6B', '#FF7A8A', '#F472B6', '#C084FC', '#8B7CFF', '#60A5FA', '#22D3EE', '#34D399', '#A3E635', '#F3F5F7'];
const PRESETS: { name: string; a: Partial<Settings['appearance']> }[] = [
  { name: 'Lunar gold', a: { theme: 'dark', accent: '#FFD76A', accent2: '#8B7CFF', background: 'planet', radius: 26, font: 'sora', numberFont: 'doto' } },
  { name: 'Daylight', a: { theme: 'light', accent: '#FFD76A', accent2: '#5A49E6', background: 'planet', radius: 26, font: 'sora', numberFont: 'doto' } },
  { name: 'Aurora', a: { theme: 'dark', accent: '#34D399', accent2: '#22D3EE', background: 'aurora', radius: 22, font: 'geist', numberFont: 'mono' } },
  { name: 'Crimson', a: { theme: 'dark', accent: '#FF7A8A', accent2: '#C084FC', background: 'grid', radius: 18, font: 'inter', numberFont: 'sans' } },
  { name: 'OLED mono', a: { theme: 'oled', accent: '#F3F5F7', accent2: '#7C8391', background: 'solid', radius: 14, font: 'geist', numberFont: 'mono', glass: false } },
];

export function Customize() {
  const { settings: s, update } = useLiveSettings();
  const [tab, setTab] = useState<'brand' | 'theme' | 'background' | 'cards' | 'layout' | 'header' | 'regional' | 'css'>('brand');
  if (!s) return null;
  const a = s.appearance, b = s.branding, l = s.layout, h = s.header, r = s.regional;
  const A = (p: Partial<Settings['appearance']>) => update('appearance', p);
  const B = (p: Partial<Settings['branding']>) => update('branding', p);

  const reset = async () => {
    if (!(await confirmDialog({ title: 'Reset the look to defaults?', body: 'Name, logo, colours, background, fonts, layout options and header go back to the defaults. Boards, widgets and services are not touched.', danger: true, confirmLabel: 'Reset' }))) return;
    try { setState({ settings: await post('/api/settings/reset-appearance') }); toast('Look reset to defaults'); } catch (e: any) { toast(e.message, 'bad'); }
  };

  return (
    <>
      <PageHead title="Customize" desc="Everything about how the dashboard looks and what it is called. Changes apply live on every connected device."
        right={<Button icon={<RotateCcw className="size-4" />} onClick={reset}>Reset to defaults</Button>} />
      <div className="mb-5">
        <Segmented value={tab} onChange={setTab} options={[
          { value: 'brand', label: 'Branding' }, { value: 'theme', label: 'Theme & colours' }, { value: 'background', label: 'Background' }, { value: 'cards', label: 'Cards & type' },
          { value: 'layout', label: 'Layout' }, { value: 'header', label: 'Header' }, { value: 'regional', label: 'Regional' }, { value: 'css', label: 'Custom CSS' },
        ]} />
      </div>

      <div className="space-y-5">
        {tab === 'brand' && (
          <Block icon={<Tag className="size-4" />} title="Branding" desc="Name, logo and texts shown in the header, browser tab and on the sign-in page.">
            <Row label="Dashboard name"><Input value={b.name} maxLength={40} onChange={(e) => B({ name: e.target.value })} /></Row>
            <Row label="Tagline" help="Shown under the name on the sign-in page"><Input value={b.tagline} maxLength={80} onChange={(e) => B({ tagline: e.target.value })} /></Row>
            <Row label="Logo" help="Square image works best"><ImagePicker value={b.logo} onChange={(v) => B({ logo: v })} maxKb={350} hint="Empty = built-in mark in your accent colours" /></Row>
            <Row label="Browser tab icon" help="Empty = same as the logo"><ImagePicker value={b.favicon} onChange={(v) => B({ favicon: v })} maxKb={120} /></Row>
            <Row label="Show in header"><div className="flex flex-wrap gap-6"><Toggle checked={b.showLogo} onChange={(v) => B({ showLogo: v })} label="Logo" /><Toggle checked={b.showName} onChange={(v) => B({ showName: v })} label="Name" /></div></Row>
            <Row label="Sign-in title"><Input value={b.loginTitle} maxLength={60} onChange={(e) => B({ loginTitle: e.target.value })} /></Row>
            <Row label="Sign-in subtitle"><Input value={b.loginSubtitle} maxLength={120} onChange={(e) => B({ loginSubtitle: e.target.value })} /></Row>
            <Row label="Footer text" help="Optional line under every board"><Input value={b.footerText} maxLength={120} onChange={(e) => B({ footerText: e.target.value })} /></Row>
          </Block>
        )}

        {tab === 'theme' && (
          <>
            <Block icon={<Sparkles className="size-4" />} title="Presets" desc="A starting point — tweak anything afterwards.">
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button key={p.name} onClick={() => A({ glass: true, ...p.a })} className="btn-soft flex items-center gap-2 rounded-full px-3 py-1.5 text-sm">
                    <span className="flex -space-x-1"><span className="size-4 rounded-full ring-2 ring-[var(--bg)]" style={{ background: p.a.accent }} /><span className="size-4 rounded-full ring-2 ring-[var(--bg)]" style={{ background: p.a.accent2 }} /></span>{p.name}
                  </button>
                ))}
              </div>
            </Block>
            <Block icon={<Palette className="size-4" />} title="Theme & colours">
              <Row label="Mode"><Segmented value={a.theme} onChange={(v) => A({ theme: v })} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'oled', label: 'OLED black' }]} /></Row>
              <Row label="Primary colour" help="Buttons, highlights, active states"><ColorInput value={a.accent} onChange={(v) => A({ accent: v })} presets={ACCENTS} /></Row>
              <Row label="Secondary colour" help="Charts, gradients, the planet"><ColorInput value={a.accent2} onChange={(v) => A({ accent2: v })} presets={ACCENTS} /></Row>
              <Row label="Online colour"><ColorInput value={a.okColor} onChange={(v) => A({ okColor: v })} presets={['#34D399', '#22C55E', '#A3E635', '#FFD76A']} /></Row>
              <Row label="Warning colour"><ColorInput value={a.warnColor} onChange={(v) => A({ warnColor: v })} presets={['#FFC98A', '#F59E0B', '#FBBF24']} /></Row>
              <Row label="Offline colour"><ColorInput value={a.badColor} onChange={(v) => A({ badColor: v })} presets={['#FF7A8A', '#EF4444', '#F43F5E']} /></Row>
              <Row label="Page colour" help="Empty = theme default">
                <div className="flex items-center gap-2"><ColorInput value={a.backgroundColor} onChange={(v) => A({ backgroundColor: v })} presets={['#0D0F14', '#0B1020', '#111827', '#000000', '#EEF0F3']} />{a.backgroundColor && <Button size="sm" variant="ghost" onClick={() => A({ backgroundColor: '' })}>Clear</Button>}</div>
              </Row>
            </Block>
          </>
        )}

        {tab === 'background' && (
          <Block icon={<ImageIcon className="size-4" />} title="Background" desc="What lives behind the widgets.">
            <Row label="Style">
              <Segmented value={a.background} onChange={(v) => A({ background: v })} options={[{ value: 'planet', label: '3D planet' }, { value: 'aurora', label: 'Aurora' }, { value: 'grid', label: 'Grid' }, { value: 'image', label: 'Image' }, { value: 'solid', label: 'Solid' }]} />
            </Row>
            {a.background === 'image' && <Row label="Image" help="Up to ~2 MB, or an https URL"><ImagePicker value={a.backgroundImage} onChange={(v) => A({ backgroundImage: v })} maxKb={2000} /></Row>}
            <Row label="Dim" help="How much the background fades behind widgets"><Slider value={a.backgroundDim} onChange={(v) => A({ backgroundDim: v })} min={0} max={0.9} step={0.05} /></Row>
            <Row label="Motion" help="Reduced: no tilt or shimmer. Off: a still picture, no animation at all (best for weak TV boxes).">
              <Segmented value={a.animations} onChange={(v) => A({ animations: v })} options={[{ value: 'full', label: 'Full' }, { value: 'reduced', label: 'Reduced' }, { value: 'off', label: 'Off' }]} />
            </Row>
          </Block>
        )}

        {tab === 'cards' && (
          <>
            <Block icon={<LayoutGrid className="size-4" />} title="Cards" desc="The surface every widget sits on.">
              <Row label="Corner radius"><Slider value={a.radius} onChange={(v) => A({ radius: v })} min={0} max={44} suffix="px" /></Row>
              <Row label="Card opacity"><Slider value={a.cardOpacity} onChange={(v) => A({ cardOpacity: v })} min={0.1} max={1} step={0.02} /></Row>
              <Row label="Glass blur"><div className="space-y-3"><Toggle checked={a.glass} onChange={(v) => A({ glass: v })} label="Frosted glass (turn off on slow devices)" />{a.glass && <Slider value={a.blur} onChange={(v) => A({ blur: v })} min={0} max={50} suffix="px" />}</div></Row>
              <Row label="Details">
                <div className="flex flex-wrap gap-x-6 gap-y-3">
                  <Toggle checked={a.cardBorder} onChange={(v) => A({ cardBorder: v })} label="Borders" />
                  <Toggle checked={a.glow} onChange={(v) => A({ glow: v })} label="Glow on buttons" />
                  <Toggle checked={a.tilt} onChange={(v) => A({ tilt: v })} label="3D tilt on hover" />
                  <Toggle checked={a.widgetHeaders} onChange={(v) => A({ widgetHeaders: v })} label="Widget headers" />
                </div>
              </Row>
              <Row label="Density"><Segmented value={a.density} onChange={(v) => A({ density: v })} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} /></Row>
            </Block>
            <Block icon={<Type className="size-4" />} title="Typography">
              <Row label="Font"><Segmented value={a.font} onChange={(v) => A({ font: v })} options={[{ value: 'sora', label: 'Sora' }, { value: 'geist', label: 'Geist' }, { value: 'inter', label: 'Inter' }, { value: 'system', label: 'System' }]} /></Row>
              <Row label="Numbers" help="Big figures: CPU %, speeds, clock">
                <Segmented value={a.numberFont} onChange={(v) => A({ numberFont: v })} options={[{ value: 'doto', label: 'Dot-matrix' }, { value: 'sans', label: 'Same as text' }, { value: 'mono', label: 'Monospace' }]} />
              </Row>
              <Row label="Text size"><Slider value={a.fontScale} onChange={(v) => A({ fontScale: v })} min={0.8} max={1.4} step={0.05} suffix="×" /></Row>
              <div className="rounded-2xl border border-line p-4"><div className="text-xs text-muted">Preview</div><div className="mt-1 flex flex-wrap items-end gap-6"><span className="dot text-4xl font-semibold">42.7%</span><span className="dot text-2xl font-semibold">12:48</span><span className="text-lg font-semibold">The quick brown fox</span></div></div>
            </Block>
          </>
        )}

        {tab === 'layout' && (
          <Block icon={<LayoutGrid className="size-4" />} title="Layout & grid" desc="How widgets are placed. Positions are stored per board and per device type.">
            <Row label="Placement" help="Free: a widget stays exactly where you drop it, gaps included. Auto-pack: widgets float up.">
              <Segmented value={l.mode} onChange={(v) => update('layout', { mode: v })} options={[{ value: 'free', label: 'Free — anywhere' }, { value: 'pack', label: 'Auto-pack' }]} />
            </Row>
            <Row label="Overlap" help="Let widgets sit on top of each other (free placement only)"><Toggle checked={l.allowOverlap} onChange={(v) => update('layout', { allowOverlap: v })} /></Row>
            <Row label="Gap between widgets"><Slider value={l.gap} onChange={(v) => update('layout', { gap: v })} min={0} max={32} suffix="px" /></Row>
            <Row label="Page width" help="0 = use the whole screen"><Slider value={l.maxWidth} onChange={(v) => update('layout', { maxWidth: v })} min={0} max={3840} step={40} suffix="px" /></Row>
            <Row label="Guide dots while editing"><Toggle checked={l.showGrid} onChange={(v) => update('layout', { showGrid: v })} /></Row>
            <p className="text-xs text-muted">Tip: click <b>Edit</b> on a board, then drag a widget anywhere and resize it from any edge or corner. The grid has 24 columns, so half and third widths line up.</p>
          </Block>
        )}

        {tab === 'header' && (
          <Block icon={<PanelTop className="size-4" />} title="Header">
            <Row label="Style"><Segmented value={a.headerStyle} onChange={(v) => A({ headerStyle: v })} options={[{ value: 'floating', label: 'Floating pill' }, { value: 'bar', label: 'Full-width bar' }, { value: 'hidden', label: 'Hidden' }]} /></Row>
            <Row label="Live indicators">
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                <Toggle checked={h.showServices} onChange={(v) => update('header', { showServices: v })} label="Services online" />
                <Toggle checked={h.showAlerts} onChange={(v) => update('header', { showAlerts: v })} label="Active alerts" />
                <Toggle checked={h.showStreams} onChange={(v) => update('header', { showStreams: v })} label="Streams" />
                <Toggle checked={h.showTraffic} onChange={(v) => update('header', { showTraffic: v })} label="Traffic" />
                <Toggle checked={h.showClock} onChange={(v) => update('header', { showClock: v })} label="Clock" />
              </div>
            </Row>
            <Row label="Links" help="Extra links next to the boards" wide>
              <div className="space-y-2">
                {h.links.map((ln, i) => (
                  <div key={i} className="flex gap-2">
                    <Input className="max-w-[180px]" placeholder="Name" value={ln.name} onChange={(e) => update('header', { links: h.links.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                    <Input placeholder="https://…" value={ln.url} onChange={(e) => update('header', { links: h.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
                    <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => update('header', { links: h.links.filter((_, j) => j !== i) })} />
                  </div>
                ))}
                <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => update('header', { links: [...h.links, { name: 'Link', url: 'https://' }] })}>Add link</Button>
              </div>
            </Row>
          </Block>
        )}

        {tab === 'regional' && (
          <Block icon={<Globe className="size-4" />} title="Regional" desc="Formats for dates, times and numbers.">
            <Row label="Locale">
              <select className={inputCls + ' max-w-xs'} value={r.locale} onChange={(e) => update('regional', { locale: e.target.value })}>
                {[['en-GB', 'English (UK) — 16 Nov, 1,234.5'], ['en-US', 'English (US) — Nov 16, 1,234.5'], ['de-DE', 'Deutsch — 16. Nov., 1.234,5'], ['hr-HR', 'Hrvatski — 16. stu, 1.234,5'], ['fr-FR', 'Français — 16 nov., 1 234,5'], ['sv-SE', 'Svenska — ISO-like dates']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </Row>
            <Row label="Clock"><Segmented value={r.hour12 ? '12' : '24'} onChange={(v) => update('regional', { hour12: v === '12' })} options={[{ value: '24', label: '24-hour' }, { value: '12', label: '12-hour' }]} /></Row>
            <Row label="Temperature"><Segmented value={r.tempUnit} onChange={(v) => update('regional', { tempUnit: v })} options={[{ value: 'c', label: '°C' }, { value: 'f', label: '°F' }]} /></Row>
            <Row label="Weather location" wide>
              <div className="grid gap-3 sm:grid-cols-3">
                <Label><span className="text-xs text-muted">Name</span><Input defaultValue={s.weather.name} onBlur={(e) => put('/api/settings', { weather: { ...s.weather, name: e.target.value } })} /></Label>
                <Label><span className="text-xs text-muted">Latitude</span><Input type="number" step="0.001" defaultValue={s.weather.lat} onBlur={(e) => put('/api/settings', { weather: { ...s.weather, lat: Number(e.target.value) } })} /></Label>
                <Label><span className="text-xs text-muted">Longitude</span><Input type="number" step="0.001" defaultValue={s.weather.lon} onBlur={(e) => put('/api/settings', { weather: { ...s.weather, lon: Number(e.target.value) } })} /></Label>
              </div>
            </Row>
          </Block>
        )}

        {tab === 'css' && (
          <Block icon={<Code2 className="size-4" />} title="Custom CSS" desc="For anything the options above don't cover. Applied on every device, including kiosks and the sign-in page.">
            <textarea className={cx(inputCls, 'h-72 py-3 font-mono text-xs leading-relaxed')} spellCheck={false} value={a.customCss} placeholder={`/* examples */\n.glass { border-color: rgba(255,255,255,.2); }\n:root { --radius: 8px; }\n.dot { letter-spacing: .08em; }`} onChange={(e) => A({ customCss: e.target.value })} />
            <p className="text-xs text-muted">Useful hooks: <code>.glass</code> (cards), <code>.dot</code> (display numbers), <code>.btn-primary</code>, <code>.tv</code> / <code>.kiosk</code> (device modes), variables <code>--accent</code>, <code>--accent2</code>, <code>--radius</code>, <code>--bg</code>.</p>
          </Block>
        )}
      </div>
    </>
  );
}
