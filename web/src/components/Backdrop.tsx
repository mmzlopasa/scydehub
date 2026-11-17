import { useEffect, useRef } from 'react';
import type { Settings } from '../lib/types';

type Appearance = Settings['appearance'];

const hexRgb = (hex: string, fallback: [number, number, number]): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** deterministic pseudo-random (the planet looks the same on every device) */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Height map of the planet surface: smooth noise + impact craters, equirectangular. */
function makeSurface(W: number, H: number) {
  const r = rng(7);
  const h = new Float32Array(W * H);
  // value noise, 4 octaves, wrapping horizontally
  for (let o = 0; o < 4; o++) {
    const gw = 8 << o, gh = 4 << o, amp = 0.5 / (1 << o);
    const g = new Float32Array(gw * (gh + 1));
    for (let i = 0; i < g.length; i++) g[i] = r();
    for (let y = 0; y < H; y++) {
      const fy = (y / H) * gh, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < W; x++) {
        const fx = (x / W) * gw, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx), x1 = (x0 + 1) % gw;
        const a = g[y0 * gw + x0], b = g[y0 * gw + x1], c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x1];
        h[y * W + x] += (a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sy) * amp;
      }
    }
  }
  // craters: dark bowl with a bright rim
  for (let i = 0; i < 46; i++) {
    const cx = r() * W, cy = H * (0.12 + r() * 0.76), rad = 3 + r() * r() * 22;
    for (let y = Math.max(0, Math.floor(cy - rad * 1.3)); y < Math.min(H, cy + rad * 1.3); y++) {
      const stretch = 1 / Math.max(0.35, Math.cos((y / H - 0.5) * Math.PI)); // wider near the poles
      for (let dx = -Math.ceil(rad * 1.3 * stretch); dx <= rad * 1.3 * stretch; dx++) {
        const x = ((Math.round(cx + dx) % W) + W) % W;
        const d = Math.hypot(dx / stretch, y - cy) / rad;
        if (d < 1) h[y * W + x] -= 0.2 * (1 - d * d);
        else if (d < 1.25) h[y * W + x] += 0.1 * (1 - (d - 1) / 0.25);
      }
    }
  }
  return h;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

interface Crystal { x: number; y: number; z: number; s: number; rx: number; ry: number; vx: number; vy: number; bob: number }
const OCTA_V: [number, number, number][] = [[0, 1.25, 0], [0, -1.25, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
const OCTA_F = [[0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2], [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5]];

/**
 * Ambient 3D scene behind the dashboard: a slowly rotating, pixel-shaded planet with orbit rings,
 * satellites and floating low-poly crystals. Pure canvas, ~24 fps, paused when the tab is hidden.
 */
function PlanetScene({ a, strong }: { a: Appearance; strong?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const light = a.theme === 'light';
    const acc = hexRgb(a.accent, [255, 215, 106]);
    const acc2 = hexRgb(a.accent2, [139, 124, 255]);
    const SW = 256, SH = 128;
    const surface = makeSurface(SW, SH);
    const P = 150; // planet is rendered tiny and scaled up → crisp pixel look that matches the dot-matrix numerals
    const pc = document.createElement('canvas');
    pc.width = pc.height = P;
    const pctx = pc.getContext('2d')!;
    const img = pctx.createImageData(P, P);
    const r = rng(21);
    const stars = Array.from({ length: 110 }, () => ({ x: r(), y: r(), s: 0.4 + r() * 1.3, p: r() * 6.28, v: 0.4 + r() * 1.4 }));
    const crystals: Crystal[] = Array.from({ length: 6 }, (_, i) => ({
      x: [0.08, 0.3, 0.52, 0.93, 0.66, 0.18][i], y: [0.2, 0.86, 0.12, 0.72, 0.9, 0.55][i], z: 0.5 + r() * 0.9, s: 10 + r() * 22,
      rx: r() * 6, ry: r() * 6, vx: 0.15 + r() * 0.3, vy: 0.2 + r() * 0.35, bob: r() * 6,
    }));
    const rings = [
      { rx: 1.55, ry: 0.42, rot: -0.38, w: 1.4, sat: 0.0, sv: 0.11, dash: [] as number[] },
      { rx: 1.95, ry: 0.6, rot: -0.3, w: 1, sat: 2.2, sv: -0.07, dash: [3, 9] },
      { rx: 2.4, ry: 0.8, rot: -0.46, w: 0.8, sat: 4.1, sv: 0.045, dash: [1, 14] },
    ];
    let W = -1, H = -1, dpr = 1, raf = 0, last = 0, mx = 0, my = 0, tmx = 0, tmy = 0, running = true;
    // decided from the setting itself: the data-motion attribute is written by a parent effect that runs after this one
    const animated = a.animations === 'full' && !matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      const nw = canvas.clientWidth, nh = canvas.clientHeight, nd = Math.min(1.5, window.devicePixelRatio || 1);
      if (nw === W && nh === H && nd === dpr) return;
      W = nw; H = nh; dpr = nd;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); // this clears the bitmap…
      if (!running && document.visibilityState === 'visible') { running = true; last = 0; raf = requestAnimationFrame(frame); } // …so a still scene is drawn again
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const onMove = (e: PointerEvent) => { tmx = e.clientX / window.innerWidth - 0.5; tmy = e.clientY / window.innerHeight - 0.5; };
    window.addEventListener('pointermove', onMove, { passive: true });

    function drawPlanet(t: number) {
      const rot = t * 0.05, tilt = 0.35;
      const ct = Math.cos(tilt), st = Math.sin(tilt);
      // light from the upper left, slightly towards the viewer
      const lx = -0.62, ly = -0.5, lz = 0.6;
      const d = img.data;
      const R = P / 2;
      for (let py = 0; py < P; py++) {
        for (let px = 0; px < P; px++) {
          const i = (py * P + px) * 4;
          const nx = (px + 0.5 - R) / R, ny = (py + 0.5 - R) / R;
          const rr = nx * nx + ny * ny;
          if (rr > 1) { d[i + 3] = 0; continue; }
          const nz = Math.sqrt(1 - rr);
          // rotate the surface point: tilt around X, spin around Y
          const y1 = ny * ct - nz * st, z1 = ny * st + nz * ct;
          const lon = Math.atan2(nx, z1) + rot, lat = Math.asin(Math.max(-1, Math.min(1, y1)));
          const u = (((lon / (Math.PI * 2)) % 1) + 1) % 1, v = lat / Math.PI + 0.5;
          const hgt = surface[Math.min(SH - 1, Math.floor(v * SH)) * SW + Math.floor(u * SW)];
          let lum = Math.max(0, nx * lx + ny * ly + nz * lz);
          lum = lum * (0.55 + hgt * 0.9) + 0.035;
          // ordered dithering into 5 tones
          const q = Math.max(0, Math.min(4, Math.floor(lum * 4.6 + BAYER[(py & 3) * 4 + (px & 3)] * 0.9 + 0.5)));
          const k = q / 4;
          const warm = hgt > 0.52 ? 1 : hgt > 0.4 ? 0.5 : 0.15; // highlands take the primary accent, maria the secondary
          const cr = acc2[0] + (acc[0] - acc2[0]) * warm, cg = acc2[1] + (acc[1] - acc2[1]) * warm, cb = acc2[2] + (acc[2] - acc2[2]) * warm;
          const base = light ? 150 : 18;
          d[i] = base + (cr * 0.92 - base) * k + 14 * k;
          d[i + 1] = base + (cg * 0.88 - base) * k + 10 * k;
          d[i + 2] = (light ? 175 : 34) + (cb * 0.92 - (light ? 175 : 34)) * k + 18 * k;
          // soft anti-aliased limb
          d[i + 3] = rr > 0.94 ? Math.round(255 * Math.min(1, (1 - rr) / 0.06)) : 255;
        }
      }
      pctx.putImageData(img, 0, 0);
    }

    function ringPath(cx: number, cy: number, R: number, ring: (typeof rings)[number], from: number, to: number) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, R * ring.rx, R * ring.ry, ring.rot, from, to);
    }

    function frame(now: number) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (now - last < 40) return; // ~24 fps is plenty for an ambient scene
      last = now;
      const t = animated ? now / 1000 : 12;
      mx += (tmx - mx) * 0.05; my += (tmy - my) * 0.05;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // stars
      if (!light) {
        for (const s of stars) {
          const tw = 0.35 + 0.65 * Math.abs(Math.sin(s.p + t * s.v * 0.5));
          ctx.fillStyle = `rgba(220,215,255,${0.5 * tw})`;
          ctx.fillRect(Math.round(s.x * W - mx * 12 * s.s), Math.round(s.y * H - my * 12 * s.s), s.s, s.s);
        }
      }

      const R = Math.min(W, H) * (strong ? 0.36 : 0.3) * (W < 700 ? 0.8 : 1);
      const cx = W * (strong ? 0.86 : 0.84) - mx * 26, cy = H * (strong ? 0.62 : 0.34) - my * 20;
      const grad = ctx.createLinearGradient(cx - R * 2, cy, cx + R * 2, cy);
      grad.addColorStop(0, `rgba(${acc2.join(',')},${light ? 0.5 : 0.75})`);
      grad.addColorStop(0.55, `rgba(${acc2.map((c) => Math.round(c + (255 - c) * 0.5)).join(',')},${light ? 0.45 : 0.6})`);
      grad.addColorStop(1, `rgba(${acc.join(',')},${light ? 0.7 : 0.85})`);

      // far halves of the rings (behind the planet)
      ctx.lineCap = 'round';
      for (const ring of rings) {
        ctx.strokeStyle = grad; ctx.lineWidth = ring.w; ctx.setLineDash(ring.dash); ctx.globalAlpha = 0.5;
        ringPath(cx, cy, R, ring, Math.PI, Math.PI * 2); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;

      // atmosphere glow
      const glow = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.5);
      glow.addColorStop(0, `rgba(${acc2.join(',')},${light ? 0.2 : 0.3})`);
      glow.addColorStop(1, `rgba(${acc2.join(',')},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.5, 0, 6.2832); ctx.fill();

      drawPlanet(t);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(pc, cx - R, cy - R, R * 2, R * 2);
      ctx.imageSmoothingEnabled = true;

      // near halves of the rings + satellites
      for (const ring of rings) {
        ctx.strokeStyle = grad; ctx.lineWidth = ring.w + 0.4; ctx.setLineDash(ring.dash); ctx.globalAlpha = 0.9;
        ringPath(cx, cy, R, ring, 0, Math.PI); ctx.stroke();
        ctx.setLineDash([]);
        const ang = ring.sat + t * ring.sv;
        const ex = Math.cos(ang) * R * ring.rx, ey = Math.sin(ang) * R * ring.ry;
        const sx = cx + ex * Math.cos(ring.rot) - ey * Math.sin(ring.rot), sy = cy + ex * Math.sin(ring.rot) + ey * Math.cos(ring.rot);
        const behind = Math.sin(ang) < 0 && Math.hypot(sx - cx, sy - cy) < R;
        if (!behind) {
          ctx.globalAlpha = 1;
          const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 12);
          sg.addColorStop(0, `rgba(${acc.join(',')},.95)`); sg.addColorStop(1, `rgba(${acc.join(',')},0)`);
          ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, 12, 0, 6.2832); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, sy, 2.2, 0, 6.2832); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // floating crystals (flat-shaded octahedra)
      for (const c of crystals) {
        const ax = c.rx + t * c.vx * 0.5, ay = c.ry + t * c.vy * 0.5;
        const cax = Math.cos(ax), sax = Math.sin(ax), cay = Math.cos(ay), say = Math.sin(ay);
        const px = c.x * W - mx * 60 * c.z, py = c.y * H - my * 50 * c.z + Math.sin(t * 0.5 + c.bob) * 10;
        const pts = OCTA_V.map(([x, y, z]) => {
          const x1 = x * cay + z * say, z1 = -x * say + z * cay;
          const y2 = y * cax - z1 * sax, z2 = y * sax + z1 * cax;
          return [x1, y2, z2] as const;
        });
        const faces = OCTA_F.map((f) => {
          const [A, B, C] = f.map((i) => pts[i]);
          const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
          const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
          const len = Math.hypot(n[0], n[1], n[2]) || 1;
          return { f, nz: n[2] / len, shade: Math.max(0, (-0.5 * n[0] - 0.6 * n[1] + 0.62 * n[2]) / len), z: (A[2] + B[2] + C[2]) / 3 };
        }).filter((f) => f.nz > 0).sort((p, q2) => p.z - q2.z);
        for (const face of faces) {
          const k = 0.18 + face.shade * 0.82;
          const col = acc2.map((v, i) => Math.round((light ? 235 : 30) + ((v + (acc[i] - v) * 0.25) - (light ? 235 : 30)) * k));
          ctx.fillStyle = `rgba(${col.join(',')},${light ? 0.55 : 0.5 * c.z})`;
          ctx.strokeStyle = `rgba(255,255,255,${light ? 0.7 : 0.12})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          face.f.forEach((i, n) => { const X = px + pts[i][0] * c.s, Y = py + pts[i][1] * c.s; n ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      }
      if (!animated) { running = false; cancelAnimationFrame(raf); }
    }

    const vis = () => {
      const want = document.visibilityState === 'visible';
      if (want && !running && animated) { running = true; raf = requestAnimationFrame(frame); }
      if (!want) { running = false; cancelAnimationFrame(raf); }
    };
    document.addEventListener('visibilitychange', vis);
    raf = requestAnimationFrame(frame);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [a.accent, a.accent2, a.theme, a.animations, strong]);
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />;
}

/** Fixed full-screen background. Mode, image, dim and colours come from Settings → Customize → Background. */
export function Backdrop({ a, strong }: { a: Appearance | undefined; strong?: boolean }) {
  if (!a) return null;
  const mode = a.background;
  const dim = Math.min(0.95, Math.max(0, a.backgroundDim));
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" style={{ background: 'var(--bg)' }} aria-hidden>
      {mode !== 'solid' && mode !== 'image' && <div className="absolute inset-0" style={{ background: 'var(--sky)' }} />}
      {mode === 'planet' && <PlanetScene a={a} strong={strong} />}
      {mode === 'aurora' && (
        <>
          <div className="absolute -left-[20%] -top-[30%] h-[90vh] w-[70vw] rounded-full opacity-50 blur-[110px]" style={{ background: 'var(--accent2)', animation: 'aurora-move 26s ease-in-out infinite' }} />
          <div className="absolute -right-[15%] top-[20%] h-[80vh] w-[55vw] rounded-full opacity-30 blur-[120px]" style={{ background: 'var(--accent)', animation: 'aurora-move 34s ease-in-out infinite reverse' }} />
          <div className="absolute bottom-[-35%] left-[25%] h-[70vh] w-[60vw] rounded-full opacity-35 blur-[130px]" style={{ background: 'var(--accent2-hi)', animation: 'aurora-move 42s ease-in-out infinite' }} />
        </>
      )}
      {mode === 'grid' && (
        <div className="absolute inset-0" style={{
          backgroundImage: 'linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)',
          backgroundSize: '44px 44px', maskImage: 'radial-gradient(ellipse at 50% 30%, #000 20%, transparent 78%)', WebkitMaskImage: 'radial-gradient(ellipse at 50% 30%, #000 20%, transparent 78%)',
        }} />
      )}
      {mode === 'image' && a.backgroundImage && <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${a.backgroundImage.replace(/"/g, '%22')}")` }} />}
      {/* dim so widgets stay readable on top of any background */}
      {mode !== 'solid' && <div className="absolute inset-0" style={{ background: 'var(--bg)', opacity: mode === 'image' ? dim : dim * (strong ? 0.3 : 1) }} />}
    </div>
  );
}
