import { Activity, CalendarDays, ChartLine, Clock, Cloud, Frame, Gauge, LayoutGrid, Link, NotebookPen, Siren, LayoutDashboard, Clapperboard, Server, Network, Globe, Home, Shield, Film, Tv, HardDrive, Cpu, Box } from 'lucide-react';
import type { LucideProps } from 'lucide-react';

const MAP: Record<string, React.ComponentType<LucideProps>> = {
  activity: Activity, calendar: CalendarDays, chart: ChartLine, clock: Clock, cloud: Cloud, frame: Frame, gauge: Gauge, grid: LayoutGrid,
  link: Link, notes: NotebookPen, siren: Siren, 'layout-dashboard': LayoutDashboard, 'layout-grid': LayoutGrid, clapperboard: Clapperboard,
  server: Server, network: Network, globe: Globe, home: Home, shield: Shield, film: Film, tv: Tv, 'hard-drive': HardDrive, cpu: Cpu, box: Box,
};
export const BOARD_ICONS = Object.keys(MAP);
export function CoreIcon({ name, ...p }: { name: string } & LucideProps) {
  const C = MAP[name] ?? LayoutGrid;
  return <C {...p} />;
}
