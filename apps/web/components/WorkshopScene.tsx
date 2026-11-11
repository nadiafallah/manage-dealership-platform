'use client';
import Link from 'next/link';
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Bay, BayCarState } from '@manage/shared';
import { faNum } from '@/lib/format';
import { AppIcon, type IconName } from './AppIcon';
import { PlateText } from './Plate';

// Isometric workshop of the control room (owner reference «اتاق کنترل»). It is
// drawn from the live bays on every refresh, never a picture: SVG for the
// building, lifts and cars; every word is real HTML laid over the drawing.
// Oblique projection — x runs along the row of bays, y from the back wall to
// the driving lane, z up. Plain SVG, no WebGL: cheap on ordinary phones.

const UX = [1, 0.12] as const;
const UY = [-0.34, 0.58] as const;
const W = 132; // bay width along the row
const D = 136; // bay depth
const H = 104; // pillar and beam height
const LANE = 62; // driving lane in front of each row
const SLAB = 12;
const WALL = 6;
const LOW = 26; // low wall between two bays
const PER_ROW = 6;

type P3 = readonly [number, number, number];
const pr = ([x, y, z]: P3): [number, number] => [x * UX[0] + y * UY[0], x * UX[1] + y * UY[1] - z];
const pts = (list: P3[]) => list.map((p) => pr(p).map((n) => n.toFixed(1)).join(',')).join(' ');
/** Plane z = h, local (x, y). */
const floorM = (h = 0) => `matrix(${UX[0]} ${UX[1]} ${UY[0]} ${UY[1]} 0 ${-h})`;
/** Plane x = c, local (y, z). */
const sideM = (c: number) => `matrix(${UY[0]} ${UY[1]} 0 -1 ${c * UX[0]} ${c * UX[1]})`;
/** Plane y = c, local (x, z). */
const frontM = (c: number) => `matrix(${UX[0]} ${UX[1]} 0 -1 ${c * UY[0]} ${c * UY[1]})`;

export const STATE_TEXT: Record<BayCarState, string> = { ok: 'طبق برنامه', late: 'عقب‌تر از برنامه', stop: 'متوقف' };
const STATE_COLOR: Record<BayCarState | 'free', string> = { ok: '#3fd6c2', late: '#f2b45c', stop: '#f0605d', free: '#5b6875' };
const BODY = ['#e9ecef', '#b8c0c8', '#5d6670', '#33404b', '#8d99a6', '#d9d4c8'];

export type BayMood = BayCarState | 'free';
export function bayMood(b: Bay): BayMood {
  if (!b.cars.length) return 'free';
  if (b.cars.some((c) => c.state === 'stop')) return 'stop';
  if (b.cars.some((c) => c.state === 'late')) return 'late';
  return 'ok';
}

/** Icon of a bay from its trade; tenants rename departments, so match loosely. */
export function bayIcon(b: Bay): IconName {
  if (b.key === 'parts') return 'box';
  const t = `${b.department ?? ''} ${b.label}`;
  if (t.includes('صافکار')) return 'hammer';
  if (t.includes('نقاش')) return 'paint';
  if (t.includes('باتری') || t.includes('برق')) return 'battery';
  if (t.includes('جلوبند')) return 'suspension';
  if (t.includes('مکانیک')) return 'gear';
  if (t.includes('تنظیم موتور')) return 'gauge';
  if (t.includes('کیفیت')) return 'search';
  return 'wrench';
}

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

interface Slot { bay: Bay; index: number; x0: number; y0: number; mood: BayMood }

/** Pure layout: where each bay sits, the drawing bounds and the hit outline of each bay. */
export function sceneLayout(bays: readonly Bay[]) {
  const n = Math.max(1, bays.length);
  const rows = Math.ceil(n / PER_ROW);
  const per = Math.ceil(n / rows);
  // Right to left like the page: the first bay is the right-most of the back row.
  const slots: Slot[] = bays.map((bay, index) => ({ bay, index, x0: (per - 1 - (index % per)) * W, y0: Math.floor(index / per) * (D + LANE), mood: bayMood(bay) }));
  const X = per * W;
  const Y = rows * (D + LANE);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const x of [0, X]) for (const y of [-WALL, Y]) for (const z of [-SLAB, H + 30]) { const [sx, sy] = pr([x, y, z]); xs.push(sx); ys.push(sy); }
  const pad = 14;
  const box = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad };
  const pct = (p: P3) => { const [sx, sy] = pr(p); return { left: ((sx - box.x) / box.w) * 100, top: ((sy - box.y) / box.h) * 100 }; };
  return { slots, rows, per, X, Y, box, pct };
}

/** Convex outline of a box after projection (monotone chain). */
function hull(points: [number, number][]) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lower: [number, number][] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop(); lower.push(q); }
  const upper: [number, number][] = [];
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map((q) => q.map((n) => n.toFixed(1)).join(',')).join(' ');
}
function bayOutline(x0: number, y0: number) {
  const c: [number, number][] = [];
  for (const x of [x0, x0 + W]) for (const y of [y0, y0 + D + LANE * 0.8]) for (const z of [0, H]) c.push(pr([x, y, z]));
  return hull(c);
}

/** A box seen from the front-right: top, front (+y) and right (+x) faces. */
function Box({ x, y, z, w, d, h, top, front, right, extra }: { x: number; y: number; z: number; w: number; d: number; h: number; top: string; front: string; right: string; extra?: ReactNode }) {
  return (
    <g>
      <polygon points={pts([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]])} fill={right} />
      <polygon points={pts([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]])} fill={front} />
      <polygon points={pts([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]])} fill={top} />
      {extra}
    </g>
  );
}

/** A car facing the lane: body, cabin, glass and the wheels of the near side. */
function Car({ cx, cy, color, id }: { cx: number; cy: number; color: string; id: string }) {
  const cw = 25; // half width
  const cl = 44; // half length
  const zb = 7;
  const zt = 21;
  const zr = 35;
  return (
    <g>
      <ellipse transform={floorM(0)} cx={cx} cy={cy} rx={34} ry={54} fill="#000" opacity={0.42} filter={`url(#${id}-soft)`} />
      <g transform={sideM(cx + cw)}>
        <rect x={cy - cl} y={zb} width={cl * 2} height={zt - zb} rx={4} fill={shade(color, 0.72)} />
        <rect x={cy - cl + 4} y={zt - 6} width={cl * 2 - 8} height={1.4} fill="#fff" opacity={0.18} />
        <circle cx={cy - 28} cy={9} r={9} fill="#0b0f13" />
        <circle cx={cy + 28} cy={9} r={9} fill="#0b0f13" />
        <circle cx={cy - 28} cy={9} r={4} fill="#4a525c" />
        <circle cx={cy + 28} cy={9} r={4} fill="#4a525c" />
      </g>
      <g transform={frontM(cy + cl)}>
        <rect x={cx - cw} y={zb} width={cw * 2} height={zt - zb} rx={3} fill={shade(color, 0.58)} />
        <rect x={cx - cw + 4} y={zt - 7} width={10} height={4} rx={1.5} fill="#fff4cf" />
        <rect x={cx + cw - 14} y={zt - 7} width={10} height={4} rx={1.5} fill="#fff4cf" />
        <rect x={cx - 8} y={zb + 3} width={16} height={5} rx={1.5} fill="#11161b" />
      </g>
      <rect transform={floorM(zt)} x={cx - cw} y={cy - cl} width={cw * 2} height={cl * 2} rx={9} fill={color} />
      <polygon points={pts([[cx + cw - 4, cy - 26, zt], [cx + cw - 4, cy + 16, zt], [cx + cw - 7, cy + 8, zr], [cx + cw - 7, cy - 22, zr]])} fill="#1b2730" />
      <polygon points={pts([[cx - cw + 4, cy + 16, zt], [cx + cw - 4, cy + 16, zt], [cx + cw - 7, cy + 8, zr], [cx - cw + 7, cy + 8, zr]])} fill="#22323d" />
      <polygon points={pts([[cx - cw + 10, cy + 15, zt + 2], [cx - 2, cy + 15, zt + 2], [cx - 8, cy + 9, zr - 2], [cx - cw + 12, cy + 9, zr - 2]])} fill="#7fe3d3" opacity={0.16} />
      <rect transform={floorM(zr)} x={cx - cw + 7} y={cy - 22} width={(cw - 7) * 2} height={30} rx={5} fill={shade(color, 1.06)} />
    </g>
  );
}

function BayDrawing({ s, id, selected }: { s: Slot; id: string; selected: boolean }) {
  const { x0, y0, mood, bay } = s;
  const color = STATE_COLOR[mood];
  const cx = x0 + W / 2;
  const cy = y0 + D / 2 + 4;
  const waiting = bay.key === 'parts';
  const cars = waiting ? bay.cars.slice(0, 2) : bay.cars.slice(0, 1);
  const lead = (k: number) => bay.cars[k]!;
  const postTop = '#6b7782';
  return (
    <g>
      {/* floor of the bay, its light pool and the lift plate */}
      <g transform={floorM(0)}>
        <rect x={x0 + 3} y={y0 + 3} width={W - 6} height={D - 6} fill={`url(#${id}-bayfloor)`} />
        {selected && <rect className="cr-sel" x={x0 + 5} y={y0 + 5} width={W - 10} height={D + LANE * 0.62} rx={6} />}
        <ellipse cx={cx} cy={cy} rx={W * 0.46} ry={D * 0.42} fill={`url(#${id}-pool)`} />
        <rect x={x0 + 6} y={y0 + D - 5} width={W - 12} height={3} fill="#e1b448" opacity={0.75} />
        {waiting ? (
          <rect x={x0 + 14} y={y0 + 16} width={W - 28} height={D - 32} rx={6} fill={`url(#${id}-hatch)`} stroke={color} strokeWidth={2.4} strokeDasharray="9 6" opacity={0.9} />
        ) : (
          <rect className={`cr-ring ${mood}`} x={cx - 40} y={y0 + 18} width={80} height={D - 36} rx={12} fill={color} fillOpacity={0.1} stroke={color} strokeWidth={3} filter={`url(#${id}-glow)`} />
        )}
      </g>
      {/* parts shelf at the back of the waiting zone, behind the parked cars */}
      {waiting && (
        <Box x={x0 + 8} y={y0 + 6} z={0} w={W - 16} d={14} h={46} top="#46525d" front="#2a333b" right="#353f48"
          extra={<g transform={frontM(y0 + 20)}>{[12, 28].map((z) => <rect key={z} x={x0 + 10} y={z} width={W - 20} height={2} fill="#7a8794" />)}{[0, 1, 2, 3].map((k) => <rect key={k} x={x0 + 16 + k * 30} y={30} width={18} height={12} rx={2} fill="#9c7a4c" />)}</g>} />
      )}
      {/* lift posts (left first, the right one passes in front of the car) */}
      {!waiting && <Box x={cx - 47} y={cy - 6} z={0} w={6} d={12} h={44} top={postTop} front="#3d4852" right="#4b5762" />}
      {cars.map((c, k) => (
        <Car key={c.caseId} id={id} cx={waiting ? x0 + W * (cars.length > 1 ? (k ? 0.72 : 0.3) : 0.5) : cx} cy={cy} color={BODY[hash(lead(k).caseId) % BODY.length]!} />
      ))}
      {!waiting && <Box x={cx + 41} y={cy - 6} z={0} w={6} d={12} h={44} top={postTop} front="#3d4852" right="#4b5762" />}
    </g>
  );
}

function Partition({ x, y0, id }: { x: number; y0: number; id: string }) {
  return (
    <g>
      <Box x={x - WALL / 2} y={y0} z={0} w={WALL} d={D - 12} h={LOW} top="#53606b" front="#2c353d" right="#3a4651" />
      <Box x={x - 6} y={y0 + D - 12} z={0} w={12} d={12} h={H} top="#5a6670" front="#2b343c" right="#3b4651"
        extra={<rect transform={frontM(y0 + D)} x={x - 6} y={0} width={12} height={26} fill={`url(#${id}-hazard)`} />} />
    </g>
  );
}

/** The building, bays, lifts and cars: decorative SVG content shared by the control room and the sign-in art. */
function Drawing({ L, id, selectedKey }: { L: ReturnType<typeof sceneLayout>; id: string; selectedKey: string | null }) {
  const byRow = Array.from({ length: L.rows }, (_, r) => L.slots.filter((s) => s.y0 === r * (D + LANE)).sort((a, b) => a.x0 - b.x0));
  return (
    <>
      <defs aria-hidden="true">
        <linearGradient id={`${id}-wall`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#24313a" /><stop offset="1" stopColor="#151d23" /></linearGradient>
        <linearGradient id={`${id}-bayfloor`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2a353d" /><stop offset="1" stopColor="#222c33" /></linearGradient>
        <radialGradient id={`${id}-pool`}><stop offset="0" stopColor="#fff6dc" stopOpacity="0.16" /><stop offset="1" stopColor="#fff6dc" stopOpacity="0" /></radialGradient>
        <pattern id={`${id}-tiles`} width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="#ffffff" strokeOpacity="0.045" /></pattern>
        <pattern id={`${id}-hatch`} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="#1f282f" /><rect width="5" height="12" fill="#e1b448" fillOpacity="0.16" /></pattern>
        <pattern id={`${id}-hazard`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#1c2125" /><rect width="4" height="8" fill="#e1b448" /></pattern>
        <filter id={`${id}-glow`} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3.2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <filter id={`${id}-soft`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" /></filter>
      </defs>
      <g aria-hidden="true">
        {/* slab: floor, front edge and the right end */}
        <polygon points={pts([[L.X, -WALL, 0], [L.X, L.Y, 0], [L.X, L.Y, -SLAB], [L.X, -WALL, -SLAB]])} fill="#11181d" />
        <polygon points={pts([[0, L.Y, 0], [L.X, L.Y, 0], [L.X, L.Y, -SLAB], [0, L.Y, -SLAB]])} fill="#0d1317" />
        <g transform={floorM(0)}>
          <rect x={0} y={-WALL} width={L.X} height={L.Y + WALL} fill="#1d262d" />
          <rect x={0} y={-WALL} width={L.X} height={L.Y + WALL} fill={`url(#${id}-tiles)`} />
          {byRow.map((_, r) => {
            const y = r * (D + LANE) + D;
            return (
              <g key={r}>
                <rect x={0} y={y} width={L.X} height={LANE} fill="#161e24" />
                <rect x={8} y={y + LANE / 2 - 1} width={L.X - 16} height={2} fill="#ffffff" opacity={0.08} />
                {Array.from({ length: Math.max(1, Math.floor(L.X / (2 * W))) }, (_, k) => {
                  const ax = W * 0.9 + k * 2 * W;
                  return <polygon key={k} points={`${ax},${y + LANE / 2 - 7} ${ax - 16},${y + LANE / 2} ${ax},${y + LANE / 2 + 7} ${ax},${y + LANE / 2 + 3} ${ax + 22},${y + LANE / 2 + 3} ${ax + 22},${y + LANE / 2 - 3} ${ax},${y + LANE / 2 - 3}`} fill="#ffffff" opacity={0.16} />;
                })}
              </g>
            );
          })}
        </g>
        {byRow.map((row, r) => {
          const y0 = r * (D + LANE);
          return (
            <g key={r}>
              {r === 0 ? (
                <g>
                  <polygon points={pts([[L.X, -WALL, 0], [L.X, 0, 0], [L.X, 0, H], [L.X, -WALL, H]])} fill="#1a232a" />
                  <rect transform={frontM(0)} x={0} y={0} width={L.X} height={H} fill={`url(#${id}-wall)`} />
                  <polygon points={pts([[0, -WALL, H], [L.X, -WALL, H], [L.X, 0, H], [0, 0, H]])} fill="#3a4651" />
                  <g transform={frontM(0)}>
                    {row.map((s) => (
                      <g key={s.bay.key}>
                        <rect x={s.x0 + 34} y={H - 22} width={W - 68} height={5} rx={2} fill="#fff6dc" filter={`url(#${id}-glow)`} />
                        <rect x={s.x0 + 16} y={30} width={34} height={30} rx={2} fill="#2f3c46" />
                        <rect x={s.x0 + W - 46} y={0} width={30} height={34} rx={2} fill="#3a2f2f" />
                        <rect x={s.x0 + W - 46} y={14} width={30} height={2} fill="#1b1414" />
                      </g>
                    ))}
                  </g>
                </g>
              ) : (
                <Box x={0} y={y0 - 5} z={0} w={L.X} d={5} h={8} top="#4a5661" front="#2a333b" right="#333d46" />
              )}
              {row[0] && <Partition x={0} y0={y0} id={id} />}
              {row.map((s) => (
                <g key={s.bay.key}>
                  <BayDrawing s={s} id={id} selected={s.bay.key === selectedKey} />
                  <Partition x={s.x0 + W} y0={y0} id={id} />
                </g>
              ))}
              <Box x={0} y={y0 + D - 12} z={H - 12} w={L.X} d={12} h={12} top="#56626c" front="#27313a" right="#323d47"
                extra={<g transform={frontM(y0 + D)}>{row.map((s) => <rect key={s.bay.key} x={s.x0 + 22} y={H - 13} width={W - 44} height={3} rx={1.5} fill={STATE_COLOR[s.mood]} filter={`url(#${id}-glow)`} />)}</g>} />
            </g>
          );
        })}
      </g>
    </>
  );
}

export function WorkshopScene({ bays }: { bays: readonly Bay[] }) {
  const id = `ws${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const L = useMemo(() => sceneLayout(bays), [bays]);
  const defaultKey = useMemo(() => {
    const pick = (m: BayMood) => bays.find((b) => bayMood(b) === m)?.key;
    return pick('stop') ?? pick('late') ?? [...bays].sort((a, b) => b.cars.length - a.cars.length)[0]?.key ?? null;
  }, [bays]);
  const [chosen, setChosen] = useState<string | null>(null);
  const selectedKey = chosen && bays.some((b) => b.key === chosen) ? chosen : defaultKey;
  const selected = bays.find((b) => b.key === selectedKey) ?? null;

  if (!bays.length) return <p className="cr-empty">هنوز جایگاهی برای تعمیرگاه تعریف نشده است؛ جایگاه‌ها را مدیر سیستم در تنظیمات تعمیرگاه می‌سازد.</p>;

  const press = (key: string) => (e: KeyboardEvent<SVGPolygonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setChosen(key); }
  };
  const label = (b: Bay) => {
    const stop = b.cars.filter((c) => c.state === 'stop').length;
    const late = b.cars.filter((c) => c.state === 'late').length;
    return `${b.label}: ${b.cars.length ? `${faNum(b.cars.length)} خودرو` : 'آزاد'}${stop ? `، ${faNum(stop)} متوقف` : ''}${late ? `، ${faNum(late)} عقب‌تر` : ''}`;
  };

  return (
    <div className="cr-scene-wrap">
      <div className="cr-scene-scroll">
        <div className="cr-scene" style={{ aspectRatio: `${L.box.w} / ${L.box.h}` }} data-testid="workshop-scene">
          <svg viewBox={`${L.box.x.toFixed(1)} ${L.box.y.toFixed(1)} ${L.box.w.toFixed(1)} ${L.box.h.toFixed(1)}`} role="group" aria-label="نقشهٔ سه‌بعدی کارگاه؛ هر جایگاه را برای دیدن خودروهایش انتخاب کنید">
            <Drawing L={L} id={id} selectedKey={selectedKey} />
            <g className="cr-hits">
              {L.slots.map((s) => (
                <polygon key={s.bay.key} points={bayOutline(s.x0, s.y0)} className={`cr-hit${s.bay.key === selectedKey ? ' on' : ''}`} role="button" tabIndex={0}
                  aria-pressed={s.bay.key === selectedKey} aria-label={label(s.bay)} onClick={() => setChosen(s.bay.key)} onKeyDown={press(s.bay.key)} />
              ))}
            </g>
          </svg>
          <div className="cr-scene-labels" aria-hidden="true">
            {L.slots.map((s) => {
              const board = L.pct([s.x0 + W / 2, s.y0 + D - 6, H + 15]);
              const pill = L.pct([s.x0 + W / 2, s.y0 + D + LANE * 0.48, 0]);
              return (
                <span key={s.bay.key} className="cr-scene-bay">
                  <span className={`cr-board ${s.mood}${s.bay.key === selectedKey ? ' on' : ''}`} style={{ left: `${board.left}%`, top: `${board.top}%` }}>
                    <AppIcon name={bayIcon(s.bay)} />{s.bay.label}
                  </span>
                  <span className={`cr-pill ${s.mood}`} style={{ left: `${pill.left}%`, top: `${pill.top}%` }}>{s.bay.cars.length ? `${faNum(s.bay.cars.length)} خودرو` : 'آزاد'}</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>
      {/* Printed control room: the drawing is replaced by a plain list of bays (print only). */}
      <ul className="cr-bay-print" aria-hidden="true">
        {bays.map((b) => (
          <li key={b.key}><b>{b.label}</b>: {b.cars.length ? b.cars.map((c) => `${c.vehicle}${c.plate ? ` (${c.plate})` : ''} — ${STATE_TEXT[c.state]}`).join('، ') : 'آزاد'}</li>
        ))}
      </ul>
      <p className="cr-scroll-hint" aria-hidden="true">برای دیدن همهٔ جایگاه‌ها، نقشه را به چپ بکشید.</p>
      <ul className="cr-legend" aria-label="راهنمای رنگ‌ها">
        <li><i className="dot ok" />طبق برنامه</li>
        <li><i className="dot late" />عقب‌تر</li>
        <li><i className="dot stop" />متوقف</li>
        <li><i className="dot free" />آزاد</li>
      </ul>
      {selected && (
        <div className="cr-bay-detail" aria-live="polite" data-testid="bay-detail">
          <p className="cr-bay-head">
            <AppIcon name={bayIcon(selected)} />
            <b>{selected.label}</b>
            <span>{selected.cars.length ? `${faNum(selected.cars.length)} خودرو` : 'آزاد'}</span>
          </p>
          {selected.cars.length ? (
            <ul className="cr-bay-cars">
              {selected.cars.map((c) => (
                <li key={c.caseId}>
                  <Link href={`/cases/${c.caseId}`} className={`cr-car-chip ${c.state}`}>
                    <i className={`dot ${c.state}`} aria-hidden="true" />
                    <span>{c.vehicle}</span>{c.plate && <PlateText value={c.plate} />}
                    <small>{STATE_TEXT[c.state]} · {c.step}</small>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cr-muted">{selected.key === 'parts' ? 'خودرویی منتظر قطعه نیست.' : 'این جایگاه الان خالی است.'}</p>
          )}
        </div>
      )}
    </div>
  );
}

// A plausible workshop for the sign-in art: decoration only, no data and no text.
const ART_BAYS: Bay[] = [
  { key: 'a1', label: '', department: null, tone: 'ok', cars: [{ caseId: 'art-1', plate: null, vehicle: '', state: 'ok', step: '' }] },
  { key: 'a2', label: '', department: null, tone: 'ok', cars: [{ caseId: 'art-22', plate: null, vehicle: '', state: 'ok', step: '' }] },
  { key: 'a3', label: '', department: null, tone: 'warn', cars: [{ caseId: 'art-3', plate: null, vehicle: '', state: 'late', step: '' }] },
  { key: 'a4', label: '', department: null, tone: 'ok', cars: [{ caseId: 'art-41', plate: null, vehicle: '', state: 'ok', step: '' }] },
  { key: 'a5', label: '', department: null, tone: 'free', cars: [] },
  { key: 'a6', label: '', department: null, tone: 'ok', cars: [{ caseId: 'art-6', plate: null, vehicle: '', state: 'ok', step: '' }] },
];

/** Decorative workshop behind the sign-in folder (aria-hidden; same drawing as the control room). */
export function WorkshopBackdrop({ className }: { className?: string }) {
  const id = `wb${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const L = useMemo(() => sceneLayout(ART_BAYS), []);
  return (
    <svg className={className} viewBox={`${L.box.x.toFixed(1)} ${L.box.y.toFixed(1)} ${L.box.w.toFixed(1)} ${L.box.h.toFixed(1)}`} aria-hidden="true" focusable="false">
      <Drawing L={L} id={id} selectedKey={null} />
    </svg>
  );
}
