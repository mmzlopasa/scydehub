import { useStore } from '../../lib/store';
import { put } from '../../lib/api';
import { Segmented, Toggle, Input, Label, cx } from '../../components/ui';
import { PageHead, Card } from './Settings';

const ACCENTS = ['#7c5cff', '#3b82f6', '#06b6d4', '#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7'];

export function Appearance() {
  const s = useStore((x) => x.settings);
  if (!s) return null;
  const a = s.appearance;
  const save = (p: any) => put('/api/settings', { appearance: { ...a, ...p } });
  return (
    <>
      <PageHead title="Izgled" desc="Tema i akcentna boja vrijede za sve uređaje, uključujući kiosk." />
      <Card className="space-y-6">
        <div className="space-y-2"><div className="text-sm font-medium">Tema</div>
          <Segmented value={a.theme} onChange={(v) => save({ theme: v })} options={[{ value: 'dark', label: 'Tamna' }, { value: 'oled', label: 'OLED crna' }, { value: 'light', label: 'Svijetla' }]} />
        </div>
        <div className="space-y-2"><div className="text-sm font-medium">Akcentna boja</div>
          <div className="flex flex-wrap items-center gap-2">
            {ACCENTS.map((c) => <button key={c} onClick={() => save({ accent: c })} className={cx('size-9 rounded-full ring-offset-2 ring-offset-[var(--bg)] transition', a.accent === c && 'ring-2 ring-[var(--fg)]')} style={{ background: c }} />)}
            <input type="color" value={a.accent} onChange={(e) => save({ accent: e.target.value })} className="size-9 cursor-pointer rounded-full border-0 bg-transparent" />
          </div>
        </div>
        <Toggle checked={a.glass} onChange={(v) => save({ glass: v })} label="Stakleni paneli (blur) — isključi na slabim TV uređajima" />
      </Card>
      <Card className="mt-6 space-y-3">
        <div className="text-sm font-medium">Lokacija za vrijeme</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Label><span className="text-xs text-muted">Naziv</span><Input defaultValue={s.weather.name} onBlur={(e) => put('/api/settings', { weather: { ...s.weather, name: e.target.value } })} /></Label>
          <Label><span className="text-xs text-muted">Latitude</span><Input type="number" step="0.001" defaultValue={s.weather.lat} onBlur={(e) => put('/api/settings', { weather: { ...s.weather, lat: Number(e.target.value) } })} /></Label>
          <Label><span className="text-xs text-muted">Longitude</span><Input type="number" step="0.001" defaultValue={s.weather.lon} onBlur={(e) => put('/api/settings', { weather: { ...s.weather, lon: Number(e.target.value) } })} /></Label>
        </div>
      </Card>
    </>
  );
}
