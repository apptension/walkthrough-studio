/**
 * Walkthrough Studio mark: one animation engine for the favicon, the header logo and every busy
 * indicator. The mark is the isometric Rams deck from logo.svg: a display, one LED, one slot, one
 * knob and a speaker grille on a three-face chassis.
 *
 * Every visual parameter (glyph vertices, colors, ring, float, lift, LEDs, caption bars) is a
 * critically damped spring. A mode change only retargets springs, so any state morphs into any
 * other from wherever it is mid-flight, with continuous position and velocity. Looping motion is
 * always multiplied by a presence spring, so loops fade in and out instead of switching.
 *
 * The accent is a two-stop gradient (`accentA → accentB`): the Apptension gradient at rest, the
 * state hue while busy. The ring is a comet along the deck's mid plane, head in A, tail in B.
 *
 * Glyphs share one vertex count (GLYPH_N), resampled with their corners kept, clockwise from the
 * top. Vertex i of the play triangle travels to vertex i of the check, the cross or the arrow.
 *
 * The geometry lives in a 64-unit grid. `markSvg()` emits the idle frame, which is what
 * logo.svg holds, so the static icon and frame 0 of the canvas are identical.
 */

type Pt = [number, number];
type Rgb = [number, number, number];

export type MarkModeName = 'idle' | 'loading' | 'draft' | 'render' | 'record' | 'export' | 'ok' | 'err';
export type MarkGlyph = 'play' | 'rec' | 'cursor' | 'arrow' | 'check' | 'cross';
export type MarkTier = 'mini' | 'compact' | 'full';
export type MarkVariant = 'auto' | MarkTier;

export type MarkMode = {
  accent: readonly [string, string];
  tintHi: string;
  tintLo: string;
  ink: string;
  glyph: MarkGlyph;
  at: Pt;
  ring: number;
  float: number;
  leds: number;
  ledSync: number;
  type: number;
  scan: number;
  pulse: number;
  lift: number;
  wash: number;
  bars: 'hide' | 'type';
};

const at = (a: ArrayLike<number>, i: number): number => a[i] as number;

const GRID = 64;
const GLYPH_N = 48;

/** Apptension gradient: neon yellow → neon green. */
const BRAND = ['#FFFE25', '#42F272'] as const;

const COLORS = {
  red: ['#ff8577', '#e5534b'],
  amber: ['#f2c75c', '#c9922a'],
  ok: ['#c4ff6a', '#42F272'],
  ink: '#23272c',
} as const;

/* —— Chassis ———————————————————————————————————————————————— */

const TOP: Pt[] = [[14, 22], [32, 12], [50, 22], [32, 32]];
const FACE: Pt[] = [[14, 22], [32, 32], [32, 50], [14, 40]];
const SIDE: Pt[] = [[32, 32], [50, 22], [50, 40], [32, 50]];
/** Iso rise per unit across a face (the 2:1-ish 18 × 10 projection). */
const K = 10 / 18;
/** Points on the screen face and on the side face: `u` across from the shared edge, `v` down. */
const facePt = (u: number, v: number): Pt => [14 + u, 22 + u * K + v];
const sidePt = (u: number, v: number): Pt => [32 + u, 32 - u * K + v];
const faceRect = (u0: number, v0: number, u1: number, v1: number): Pt[] => [facePt(u0, v0), facePt(u1, v0), facePt(u1, v1), facePt(u0, v1)];

/** Display bezel, LED strip aligned to the display, then a slot and a knob on one control row. */
const BEZEL = faceRect(2, 2, 16, 13);
const STRIP = faceRect(0.5, 2.9, 1.3, 12.1);
const STRIP_AXIS: [Pt, Pt] = [facePt(0.9, 2.9), facePt(0.9, 12.1)];
const SLOT = faceRect(2.9, 15.25, 9.3, 15.95);
const KNOB = { u: 14.2, v: 15.6, r: 0.95 };
/** 3 × 3 grille on the side face, rows then columns so `i % 3` is the column. */
const GRILLE: Pt[] = [5.3, 7.5, 9.7].flatMap((v) => [8, 10.2, 12.4].map((u): Pt => [u, v]));

/** Screen plane: 14 × 9.2 plane units, mapped affinely into the bezel on the iso face. */
const PLANE_W = 14;
const PLANE_H = 9.2;
const SCREEN_U = 2.9;
const SCREEN_V = 2.9;
const SCREEN_S = 12.2 / PLANE_W;
const toIso = (x: number, y: number): Pt => facePt(SCREEN_U + x * SCREEN_S, SCREEN_V + y);
const SCREEN: Pt[] = [[0, 0], [PLANE_W, 0], [PLANE_W, PLANE_H], [0, PLANE_H]];

/** Iso ring: an ellipse on the deck's mid plane. Its back half passes behind the chassis. */
const RING = { cx: 32, cy: 36, rx: 27.5, ry: 13.6 };
/** Soft contact shadow under the bottom vertex. */
const SHADOW = { cx: 32, cy: 52.8, rx: 15, ry: 2.6 };

/* —— Glyph shapes (plane units, centred on 0,0, y down) ————————————— */

function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i] as Pt;
    const [x2, y2] = pts[(i + 1) % pts.length] as Pt;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Resample a closed polygon to `n` points, keeping every corner, clockwise, starting at the top. */
function resample(poly: Pt[], n = GLYPH_N): Pt[] {
  let pts = signedArea(poly) < 0 ? [...poly].reverse() : [...poly];
  const next = (i: number): Pt => pts[(i + 1) % pts.length] as Pt;
  const lens = pts.map((p, i) => Math.hypot(next(i)[0] - p[0], next(i)[1] - p[1]));
  const total = lens.reduce((a, b) => a + b, 0);
  const counts = lens.map((l) => Math.max(1, Math.round((n * l) / total)));
  let sum = counts.reduce((a, b) => a + b, 0);
  while (sum !== n) {
    const order = lens.map((l, i): Pt => [l / at(counts, i), i]).sort((a, b) => (sum < n ? b[0] - a[0] : a[0] - b[0]));
    const i = (order.find(([, j]) => sum < n || at(counts, j) > 1) as Pt)[1];
    counts[i] = at(counts, i) + (sum < n ? 1 : -1);
    sum += sum < n ? 1 : -1;
  }
  const out: Pt[] = [];
  pts.forEach((p, i) => {
    const q = next(i);
    for (let k = 0; k < at(counts, i); k++) {
      const f = k / at(counts, i);
      out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]);
    }
  });
  const cx = out.reduce((s, p) => s + p[0], 0) / n;
  const cy = out.reduce((s, p) => s + p[1], 0) / n;
  const fromUp = ([x, y]: Pt): number => Math.abs(Math.atan2(x - cx, -(y - cy)));
  let start = 0;
  out.forEach((p, i) => {
    if (fromUp(p) < fromUp(out[start] as Pt) - 1e-9) start = i;
  });
  pts = out.slice(start).concat(out.slice(0, start));
  return pts;
}

function circle(r: number, n = GLYPH_N): Pt[] {
  return Array.from({ length: n }, (_, k): Pt => {
    const t = -Math.PI / 2 + (Math.PI * 2 * k) / n;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
}

function rotate(pts: Pt[], a: number): Pt[] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return pts.map(([x, y]): Pt => [x * c - y * s, x * s + y * c]);
}

const plus = (w: number, l: number): Pt[] => [
  [w, -l], [w, -w], [l, -w], [l, w], [w, w], [w, l],
  [-w, l], [-w, w], [-l, w], [-l, -w], [-w, -w], [-w, -l],
];

/** Play sits 0.3 right of its bounding centre so the triangle reads optically centred. */
const PLAY: Pt[] = [[-1.85, -2.6], [2.85, 0], [-1.85, 2.6]];

const SHAPES: Record<MarkGlyph, Pt[]> = {
  play: resample(PLAY),
  rec: circle(2.45),
  cursor: resample([[-0.35, -0.95], [0.35, -0.95], [0.35, 0.95], [-0.35, 0.95]]),
  arrow: resample([[0, -3.1], [2.9, -0.1], [1.05, -0.1], [1.05, 3.0], [-1.05, 3.0], [-1.05, -0.1], [-2.9, -0.1]]),
  check: resample([[-3.0, -0.9], [-1.0, 1.1], [3.0, -2.9], [3.9, -2.0], [-1.0, 2.9], [-3.9, 0.0]]),
  cross: resample(rotate(plus(0.8, 3.1), Math.PI / 4)),
};

/* —— Modes ——————————————————————————————————————————————————— */

const TYPE_LINES = [
  { x: 1.3, w: 10.6, y: 2.2 },
  { x: 1.3, w: 8.4, y: 4.6 },
  { x: 1.3, w: 5.8, y: 7.0 },
];

const BASE: MarkMode = {
  accent: BRAND,
  tintHi: '#eef0eb',
  tintLo: '#c5cac2',
  ink: COLORS.ink,
  glyph: 'play',
  at: [PLANE_W / 2, PLANE_H / 2],
  ring: 0,
  float: 0,
  leds: 0,
  ledSync: 0,
  type: 0,
  scan: 0,
  pulse: 0,
  lift: 0,
  wash: 0,
  bars: 'hide',
};

export const MODES: Record<MarkModeName, MarkMode> = {
  idle: { ...BASE },
  loading: { ...BASE, ring: 1, float: 1 },
  draft: { ...BASE, glyph: 'cursor', ring: 1, type: 1, bars: 'type' },
  render: { ...BASE, tintHi: '#f3f6e6', tintLo: '#d5e0c8', ring: 1, scan: 1, leds: 1, pulse: 1 },
  record: { ...BASE, accent: COLORS.red, tintHi: '#f6e6e4', tintLo: '#e0c6c2', ink: '#c9413a', glyph: 'rec', ring: 1, leds: 1, ledSync: 1, pulse: 1 },
  export: { ...BASE, accent: COLORS.amber, tintHi: '#f5efe0', tintLo: '#ddd1b4', ink: '#7a5d14', glyph: 'arrow', ring: 1, lift: 1 },
  ok: { ...BASE, accent: COLORS.ok, tintHi: '#e6f6e9', tintLo: '#bfe0c8', ink: '#1f7a43', glyph: 'check', ring: 1, wash: 1 },
  err: { ...BASE, accent: COLORS.red, tintHi: '#f7e3e1', tintLo: '#e2bfbb', ink: '#b8352f', glyph: 'cross', wash: 1 },
};

const modeTable: Partial<Record<string, MarkMode>> = MODES;

const BUSY = new Set<string>(['loading', 'draft', 'render', 'record', 'export']);

/* —— Math ———————————————————————————————————————————————————— */

const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeOutQuint = (t: number): number => 1 - Math.pow(1 - t, 5);
const hump = (t: number): number => 0.5 - 0.5 * Math.cos(Math.PI * 2 * t);

function hexRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = ([r, g, b]: Rgb, a = 1): string => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Critically damped by default; `zeta` < 1 overshoots (used for the success bounce). */
class Springs {
  x: Float64Array;
  t: Float64Array;
  v: Float64Array;
  omega: number;
  zeta: number;

  constructor(values: ArrayLike<number>, { omega = 15, zeta = 1 }: { omega?: number; zeta?: number } = {}) {
    this.x = Float64Array.from(values);
    this.t = Float64Array.from(values);
    this.v = new Float64Array(values.length);
    this.omega = omega;
    this.zeta = zeta;
  }
  step(dt: number): void {
    const { x, v, t, omega: w, zeta: z } = this;
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < x.length; i++) {
        v[i] = at(v, i) + (w * w * (at(t, i) - at(x, i)) - 2 * z * w * at(v, i)) * h;
        x[i] = at(x, i) + at(v, i) * h;
      }
    }
  }
  settled(eps = 2e-3): boolean {
    for (let i = 0; i < this.x.length; i++) {
      if (Math.abs(at(this.t, i) - at(this.x, i)) > eps || Math.abs(at(this.v, i)) > eps * 10) return false;
    }
    return true;
  }
  snap(): void {
    this.x.set(this.t);
    this.v.fill(0);
  }
}

type Scalar = 'ring' | 'float' | 'leds' | 'ledSync' | 'type' | 'scan' | 'pulse' | 'lift' | 'wash' | 'full' | 'cursorBlink' | 'gscale';

const SCALARS: Scalar[] = ['ring', 'float', 'leds', 'ledSync', 'type', 'scan', 'pulse', 'lift', 'wash', 'full', 'cursorBlink', 'gscale'];
/** Driven per frame in step(), not by the mode table. */
const DERIVED = new Set<Scalar>(['full', 'cursorBlink', 'gscale']);
/** Glyphs that grow on small icons so the state reads at 16 px. */
const BIG_GLYPHS = new Set<MarkGlyph>(['play', 'rec', 'arrow', 'check', 'cross']);

const scalarOf = (m: MarkMode, k: Scalar): number => (m as Partial<Record<Scalar, number>>)[k] ?? 0;

/** full ≥ 40 px · compact 17–39 px and the favicon · mini ≤ 16 px. */
function tierFor(variant: MarkVariant, size: number): MarkTier {
  if (variant !== 'auto') return variant;
  return size <= 16 ? 'mini' : size < 40 ? 'compact' : 'full';
}

/**
 * Entrance choreography (seconds): the deck rises and settles, the display lights, the LED ignites
 * with a flash, then the ring sweeps in. Only the boot mark plays it; everything else starts settled.
 */
const ENTER = { rise: 0.7, fade: 0.4, screenAt: 0.32, screenLen: 0.4, ledAt: 0.6, ledLen: 0.22, flashLen: 0.45, ringAt: 0.72, end: 1.5 };
const SCREEN_OFF_HI = '#3a3f46';
const SCREEN_OFF_LO = '#2b2f35';

function colorVec(m: MarkMode): number[] {
  return [...hexRgb(m.accent[0]), ...hexRgb(m.accent[1]), ...hexRgb(m.tintHi), ...hexRgb(m.tintLo), ...hexRgb(m.ink)];
}

interface EnterState {
  rise: number;
  fade: number;
  screenOn: number;
  ledOn: number;
  flash: number;
}

interface RingArcs {
  start: number;
  end: number;
  grow: number;
}

type Fill = string | CanvasGradient | ((g: CanvasRenderingContext2D) => CanvasGradient);

export interface MarkRendererOptions {
  mode?: string;
  variant?: MarkVariant;
  reducedMotion?: boolean;
  enter?: boolean;
}

/* —— Renderer ———————————————————————————————————————————————— */

/**
 * One animated mark. Pure state + drawing: `setMode`, `step(dt)`, `draw(ctx, cssSize)`.
 * The scheduler below owns timing; tests drive `step` with a fixed dt for frame-exact output.
 */
export class MarkRenderer {
  variant: MarkVariant;
  reduced: boolean;
  time: number;
  modeTime: number;
  shakeAt: number;
  enterT: number;
  mode: string;
  tier: MarkTier;
  scal: Springs;
  color: Springs;
  glyph: Springs;
  bars: Springs;
  bob: Springs;

  constructor({ mode = 'idle', variant = 'auto', reducedMotion = false, enter = false }: MarkRendererOptions = {}) {
    this.variant = variant;
    this.reduced = reducedMotion;
    this.time = 0;
    this.modeTime = 0;
    this.shakeAt = -10;
    this.enterT = enter && !reducedMotion ? 0 : ENTER.end;
    const m = modeTable[mode] || MODES.idle;
    this.mode = mode;
    this.tier = variant === 'auto' ? 'full' : variant;
    this.scal = new Springs(SCALARS.map((k) => (k === 'gscale' ? 1 : DERIVED.has(k) ? 0 : scalarOf(m, k))), { omega: 11 });
    this.color = new Springs(colorVec(m), { omega: 10 });
    this.glyph = new Springs(this.glyphTarget(m).flat(), { omega: 16 });
    this.bars = new Springs(this.barTargets(m).flat(), { omega: 18 });
    this.bob = new Springs([0], { omega: 20, zeta: 0.32 });
    this.applyTargets(m);
    this.scal.snap();
    this.color.snap();
    this.glyph.snap();
    this.bars.snap();
    if (this.enterT < ENTER.ringAt) {
      this.setS('ring', 0);
      this.scal.snap();
    }
  }

  glyphTarget(m: MarkMode, center: Pt = m.at): Pt[] {
    return SHAPES[m.glyph].map(([x, y]): Pt => [x + center[0], y + center[1]]);
  }

  barTargets(m: MarkMode): number[][] {
    if (m.bars === 'type') return TYPE_LINES.map((l) => [l.x, 0, l.y, 0.8]);
    return TYPE_LINES.map((l) => [l.x, 0, l.y, 0]);
  }

  applyTargets(m: MarkMode): void {
    SCALARS.forEach((k, i) => {
      if (DERIVED.has(k)) return;
      this.scal.t[i] = this.reduced && k !== 'ring' && k !== 'wash' ? 0 : scalarOf(m, k);
    });
    this.color.t.set(colorVec(m));
    this.glyph.t.set(this.glyphTarget(m).flat());
    this.bars.t.set(this.barTargets(m).flat());
  }

  setMode(mode: string): void {
    if (!modeTable[mode]) mode = 'idle';
    if (mode === this.mode && mode !== 'ok' && mode !== 'err') return;
    this.mode = mode;
    this.modeTime = 0;
    this.applyTargets(modeTable[mode] as MarkMode);
    if (mode === 'ok' && !this.reduced) this.bob.v[0] = at(this.bob.v, 0) - 70;
    if (mode === 'err' && !this.reduced) this.shakeAt = this.time;
  }

  s(name: Scalar): number {
    return at(this.scal.x, SCALARS.indexOf(name));
  }

  setS(name: Scalar, value: number): void {
    this.scal.t[SCALARS.indexOf(name)] = value;
  }

  entering(): boolean {
    return this.enterT < ENTER.end;
  }

  /** Advance time. Returns true while anything is still moving. */
  step(dt: number): boolean {
    dt = Math.min(dt, 1 / 15);
    this.time += dt;
    this.modeTime += dt;
    if (this.enterT < ENTER.end) this.enterT = Math.min(ENTER.end, this.enterT + dt);
    const m = modeTable[this.mode] as MarkMode;

    if (this.mode === 'ok') {
      this.setS('full', 1);
      this.setS('ring', this.modeTime < 0.75 ? 1 : 0);
      this.setS('wash', this.modeTime < 0.9 ? 1 : 0.35);
    } else {
      this.setS('full', 0);
      this.setS('ring', this.enterT < ENTER.ringAt ? 0 : m.ring);
      if (this.mode === 'err') this.setS('wash', this.modeTime < 0.9 ? 1 : 0.35);
    }

    const grow = this.tier !== 'full' && this.mode !== 'idle' && this.mode !== 'loading' && BIG_GLYPHS.has(m.glyph);
    this.setS('gscale', grow ? 1.4 : 1);

    if (m.bars === 'type' && !this.reduced) this.typeTargets();
    else this.setS('cursorBlink', 0);

    this.scal.step(dt);
    this.color.step(dt);
    this.glyph.step(dt);
    this.bars.step(dt);
    this.bob.step(dt);

    const loops = (['ring', 'float', 'leds', 'type', 'scan', 'pulse', 'lift'] as const).some((k) => this.s(k) > 0.002);
    const shaking = this.time - this.shakeAt < 1.2;
    return (
      (loops && !this.reduced) ||
      shaking ||
      this.entering() ||
      !this.scal.settled() ||
      !this.color.settled(0.4) ||
      !this.glyph.settled() ||
      !this.bars.settled() ||
      !this.bob.settled()
    );
  }

  /** Draft: three lines type out one after another; the cursor glyph rides the active line. */
  typeTargets(): void {
    const P = 2.6;
    const f = (this.modeTime / P) % 1;
    const fade = f > 0.86 ? 1 - easeInOut((f - 0.86) / 0.14) : 1;
    const progress = f * 3.6;
    const active = Math.min(TYPE_LINES.length - 1, Math.floor(progress));
    let cursor = null as Pt | null;
    TYPE_LINES.forEach((l, i) => {
      const len = l.w * easeOut(clamp01(progress - i));
      const k = i * 4;
      this.bars.t[k] = l.x;
      this.bars.t[k + 1] = len;
      this.bars.t[k + 2] = l.y;
      this.bars.t[k + 3] = 0.8 * fade;
      if (i === active) cursor = [l.x + len + 0.7, l.y];
    });
    this.setS('cursorBlink', progress < TYPE_LINES.length ? 0 : 1);
    const [ox, oy] = cursor as Pt;
    const target = SHAPES.cursor.map(([x, y]) => [x + ox, y + oy]).flat();
    this.glyph.t.set(target);
  }

  /** Entrance progress values for the current frame. */
  enterState(): EnterState {
    const e = this.enterT;
    return {
      rise: easeOutQuint(clamp01(e / ENTER.rise)),
      fade: easeOut(clamp01(e / ENTER.fade)),
      screenOn: easeInOut(clamp01((e - ENTER.screenAt) / ENTER.screenLen)),
      ledOn: easeOut(clamp01((e - ENTER.ledAt) / ENTER.ledLen)),
      flash: Math.sin(Math.PI * clamp01((e - ENTER.ledAt) / ENTER.flashLen)),
    };
  }

  /** Draw at `size` CSS px (the context is already scaled for device pixels by the caller). */
  draw(g: CanvasRenderingContext2D, size: number): void {
    const k = size / GRID;
    this.tier = tierFor(this.variant, size);
    const mini = this.tier === 'mini';
    const full = this.tier === 'full';
    g.save();
    g.clearRect(0, 0, size, size);
    g.scale(k, k);

    const c = this.color.x;
    const A: Rgb = [at(c, 0), at(c, 1), at(c, 2)];
    const B: Rgb = [at(c, 3), at(c, 4), at(c, 5)];
    const mid = mixRgb(A, B, 0.5);
    const en = this.enterState();
    const tintHi = mixRgb(hexRgb(SCREEN_OFF_HI), [at(c, 6), at(c, 7), at(c, 8)], en.screenOn);
    const tintLo = mixRgb(hexRgb(SCREEN_OFF_LO), [at(c, 9), at(c, 10), at(c, 11)], en.screenOn);
    const ink: Rgb = [at(c, 12), at(c, 13), at(c, 14)];
    const t = this.time;
    const ring = this.s('ring');
    const float = this.s('float');
    const lift = this.s('lift');
    const wash = this.s('wash');

    g.globalAlpha = en.fade;
    // Entrance: rise from below and settle, scaling in around the body's centre.
    const sc = 0.92 + 0.08 * en.rise;
    g.translate(32, 34 + (1 - en.rise) * 8);
    g.scale(sc, sc);
    g.translate(-32, -34);

    const glow = 0.1 * ring + 0.22 * wash;
    if (glow > 0.004 && !mini) {
      const grd = g.createRadialGradient(32, 34, 3, 32, 34, 31);
      grd.addColorStop(0, rgba(mid, glow));
      grd.addColorStop(1, rgba(mid, 0));
      g.fillStyle = grd;
      g.fillRect(0, 0, GRID, GRID);
    }

    const liftLoop = lift * 3.2 * easeInOut(hump((t / 1.5) % 1));
    const floatLoop = float * 1.1 * Math.sin((Math.PI * 2 * t) / 2.8);
    const dy = at(this.bob.x, 0) - liftLoop - floatLoop;
    const st = t - this.shakeAt;
    const dx = st >= 0 && st < 1.2 ? 2.2 * Math.sin(Math.PI * 2 * 9 * st) * Math.exp(-6 * st) : 0;

    if (!mini) {
      const up = clamp01(-dy / 6);
      const a = 0.38 * (0.35 + 0.65 * en.rise) * (1 - up * 0.5);
      const grd = g.createRadialGradient(SHADOW.cx + dx * 0.3, SHADOW.cy, 0, SHADOW.cx + dx * 0.3, SHADOW.cy, SHADOW.rx);
      grd.addColorStop(0, `rgba(0,0,0,${a})`);
      grd.addColorStop(0.55, `rgba(0,0,0,${a * 0.5})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.save();
      g.translate(0, SHADOW.cy);
      g.scale(1, SHADOW.ry / SHADOW.rx);
      g.translate(0, -SHADOW.cy);
      g.fillStyle = grd;
      const s = 1 - up * 0.14;
      g.beginPath();
      g.ellipse(SHADOW.cx + dx * 0.3, SHADOW.cy, SHADOW.rx * s, SHADOW.rx * s, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    const arcs = ring > 0.003 ? this.ringArcs(ring) : null;
    if (arcs) this.drawRing(g, arcs, 'back', A, B, ring);

    g.save();
    g.translate(dx, dy);

    this.fillPoly(g, TOP, (gg) => {
      const grd = gg.createLinearGradient(12, 8, 48, 22);
      grd.addColorStop(0, '#6c727a');
      grd.addColorStop(1, '#4a5058');
      return grd;
    });
    this.fillPoly(g, SIDE, (gg) => {
      const grd = gg.createLinearGradient(40, 18, 58, 52);
      grd.addColorStop(0, '#2f3338');
      grd.addColorStop(1, '#1c2024');
      return grd;
    });
    this.fillPoly(g, FACE, (gg) => {
      const grd = gg.createLinearGradient(8, 10, 56, 42);
      grd.addColorStop(0, '#5b6067');
      grd.addColorStop(0.55, '#454a51');
      grd.addColorStop(1, '#33373d');
      return grd;
    });

    if (!mini) {
      // Machined edges: lit rim on the top face, a soft ridge where the faces meet.
      g.lineWidth = 0.5;
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(255,255,255,0.13)';
      g.beginPath();
      g.moveTo(14, 22);
      g.lineTo(32, 12);
      g.lineTo(50, 22);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.beginPath();
      g.moveTo(14, 22);
      g.lineTo(32, 32);
      g.lineTo(50, 22);
      g.moveTo(32, 32);
      g.lineTo(32, 50);
      g.stroke();
    }

    if (!mini) this.fillPoly(g, BEZEL, 'rgba(22,25,29,0.78)');
    this.drawScreen(g, tintHi, tintLo, A, ink, mini, en.screenOn);
    this.drawStrip(g, A, B, mid, float, en, full);
    if (full) this.drawControls(g);
    if (!mini) this.drawGrille(g, mid);
    g.restore();

    if (arcs) this.drawRing(g, arcs, 'front', A, B, ring);
    g.restore();
  }

  fillPoly(g: CanvasRenderingContext2D, pts: Pt[], fill: Fill): void {
    g.fillStyle = typeof fill === 'function' ? fill(g) : fill;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
  }

  planePath(g: CanvasRenderingContext2D, pts: Pt[]): void {
    g.beginPath();
    pts.forEach(([x, y], i) => {
      const [ix, iy] = toIso(x, y);
      if (i) g.lineTo(ix, iy);
      else g.moveTo(ix, iy);
    });
    g.closePath();
  }

  drawScreen(g: CanvasRenderingContext2D, tintHi: Rgb, tintLo: Rgb, accent: Rgb, ink: Rgb, mini: boolean, screenOn: number): void {
    const [x0, y0] = toIso(0, 0);
    const [x1, y1] = toIso(PLANE_W, PLANE_H);
    const grd = g.createLinearGradient(x0, y0, x1, y1);
    grd.addColorStop(0, rgba(tintHi));
    grd.addColorStop(1, rgba(tintLo));
    g.fillStyle = grd;
    this.planePath(g, SCREEN);
    g.fill();

    g.save();
    this.planePath(g, SCREEN);
    g.clip();

    const scan = this.s('scan');
    if (scan > 0.003) {
      const f = (this.time / 1.7) % 1;
      const w = PLANE_W * easeInOut(clamp01(f / 0.82));
      const a = scan * 0.32 * (f > 0.82 ? 1 - (f - 0.82) / 0.18 : 1);
      g.fillStyle = rgba(accent, a);
      this.planePath(g, [[0, 0], [w, 0], [w, PLANE_H], [0, PLANE_H]]);
      g.fill();
      g.fillStyle = rgba(accent, a * 1.6);
      this.planePath(g, [[Math.max(0, w - 0.5), 0], [w, 0], [w, PLANE_H], [Math.max(0, w - 0.5), PLANE_H]]);
      g.fill();
    }

    if (!mini) {
      const b = this.bars.x;
      for (let i = 0; i < 3; i++) {
        const [x, len, y, a] = [at(b, i * 4), at(b, i * 4 + 1), at(b, i * 4 + 2), at(b, i * 4 + 3)];
        if (len < 0.05 || a < 0.01) continue;
        g.fillStyle = rgba(hexRgb(COLORS.ink), clamp01(a) * screenOn);
        this.planePath(g, [[x, y - 0.38], [x + len, y - 0.38], [x + len, y + 0.38], [x, y + 0.38]]);
        g.fill();
      }
    }

    const pts: Pt[] = [];
    const gx = this.glyph.x;
    for (let i = 0; i < gx.length; i += 2) pts.push([at(gx, i), at(gx, i + 1)]);
    const pulse = this.s('pulse');
    const scale = this.s('gscale') * (1 + pulse * 0.07 * Math.sin((Math.PI * 2 * this.time) / 1.1));
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    let glyphA = screenOn;
    const blink = this.s('cursorBlink');
    if (blink > 0.01) glyphA *= 1 - blink * (0.5 + 0.5 * Math.sign(Math.sin((Math.PI * 2 * this.time) / 0.9)));
    const exportBob = this.s('lift') * -0.9 * easeInOut(hump((this.time / 1.5) % 1));
    g.fillStyle = rgba(ink, clamp01(glyphA));
    this.planePath(g, pts.map(([x, y]): Pt => [cx + (x - cx) * scale, cy + (y - cy) * scale + exportBob]));
    g.fill();
    g.restore();
  }

  /** LED strip: the accent gradient top → bottom, breathing while busy, blooming on the full mark. */
  drawStrip(g: CanvasRenderingContext2D, A: Rgb, B: Rgb, mid: Rgb, float: number, en: EnterState, full: boolean): void {
    const t = this.time;
    const breathe = 0.2 * this.s('leds') * hump((t / 1.1) % 1) + 0.14 * float * (0.5 + 0.5 * Math.sin((Math.PI * 2 * t) / 2.8 + Math.PI / 2));
    const a = clamp01(0.82 + breathe) * en.ledOn;
    if (a < 0.004) return;
    const [[sx, sy], [ex, ey]] = STRIP_AXIS;
    const grd = g.createLinearGradient(sx, sy, ex, ey);
    grd.addColorStop(0, rgba(A, a));
    grd.addColorStop(1, rgba(B, a));
    g.save();
    if (full) {
      g.shadowColor = rgba(mid, 0.55 * a);
      g.shadowBlur = 2.5 + 1.5 * en.flash;
    }
    this.fillPoly(g, STRIP, grd);
    g.restore();
    if (en.flash > 0.01) this.fillPoly(g, STRIP, `rgba(255,255,255,${0.6 * en.flash})`);
  }

  /** One slot and one knob under the display. */
  drawControls(g: CanvasRenderingContext2D): void {
    this.fillPoly(g, SLOT, 'rgba(14,16,19,0.72)');
    g.save();
    g.transform(1, K, 0, 1, 14, 22);
    g.beginPath();
    g.arc(KNOB.u, KNOB.v, KNOB.r, 0, Math.PI * 2);
    g.restore();
    g.fillStyle = '#272b31';
    g.fill();
    g.save();
    g.transform(1, K, 0, 1, 14, 22);
    g.beginPath();
    g.arc(KNOB.u, KNOB.v, KNOB.r - 0.15, Math.PI * 1.05, Math.PI * 1.95);
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.lineWidth = 0.3;
    g.stroke();
  }

  drawGrille(g: CanvasRenderingContext2D, accent: Rgb): void {
    const leds = this.s('leds');
    const sync = this.s('ledSync');
    const t = this.time;
    const base = hexRgb('#858b93');
    GRILLE.forEach(([u, v], i) => {
      const col = i % 3;
      const seq = Math.pow(Math.max(0, Math.cos(Math.PI * 2 * (t / 1.2 - col / 6))), 4);
      const blink = hump((t / 1.1) % 1);
      const lit = leds * lerp(seq, blink, sync);
      const [x, y] = sidePt(u, v);
      g.fillStyle = rgba(mixRgb(base, accent, lit), lerp(0.5, 1, lit));
      g.beginPath();
      g.arc(x, y, 0.5 + 0.22 * lit, 0, Math.PI * 2);
      g.fill();
    });
  }

  /** Arc on the iso ring, in turns. Material-style head/tail chase; `full` closes it into a loop. */
  ringArcs(ring: number): RingArcs {
    const t = this.time;
    const P = 1.5;
    const cyc = Math.floor(t / P);
    const f = t / P - cyc;
    const base = cyc * 0.75 + t * 0.12;
    const head = base + 0.75 * easeInOut(Math.min(1, f / 0.5)) + 0.04;
    const tail = base + 0.75 * easeInOut(Math.max(0, (f - 0.5) / 0.5));
    const full = this.s('full');
    const end = lerp(head, tail + 1, full);
    const grow = 0.82 + 0.18 * easeOut(ring);
    return { start: tail, end, grow };
  }

  /**
   * Comet on the mid-plane ellipse: head in A, tail in B, tapering in width and alpha. One tapered
   * outline filled with a conic gradient (seamless), depth baked into the stops so the arc dims
   * smoothly as it passes behind the deck. `half` only decides draw order against the chassis.
   */
  drawRing(g: CanvasRenderingContext2D, { start, end, grow }: RingArcs, half: 'back' | 'front', A: Rgb, B: Rgb, ring: number): void {
    const mini = this.tier === 'mini';
    const { cx, cy, rx, ry } = RING;
    const RX = rx * grow;
    const RY = ry * grow;
    const TAU = Math.PI * 2;
    const ang = (u: number): number => TAU * u - Math.PI / 2;
    const pt = (a: number): Pt => [cx + RX * Math.cos(a), cy + RY * Math.sin(a)];
    const normal = (a: number): Pt => {
      const nx = RY * Math.cos(a);
      const ny = RX * Math.sin(a);
      const l = Math.hypot(nx, ny) || 1;
      return [nx / l, ny / l];
    };
    /** 1 in front (bottom of the ellipse), 0.42 behind (top). */
    const depth = (a: number): number => lerp(0.42, 1, (Math.sin(a) + 1) / 2);
    const width = { mini: 6.5, compact: 4.4, full: 2.4 }[this.tier];
    const mid = mixRgb(A, B, 0.5);
    const aS = ang(start);
    const aE = ang(end);
    const spanA = Math.min(TAU, aE - aS);

    g.save();
    g.beginPath();
    if (half === 'back') g.rect(-16, -16, GRID + 32, cy + 16);
    else g.rect(-16, cy, GRID + 32, GRID + 32);
    g.clip();

    if (!mini) {
      // Faint orbit so the plane reads even where the comet is not.
      g.strokeStyle = rgba(mid, 0.06 * ring);
      g.lineWidth = width * 0.6;
      g.beginPath();
      g.ellipse(cx, cy, RX, RY, 0, 0, TAU);
      g.stroke();
    }

    const n = Math.max(12, Math.ceil(spanA * 20));
    const outer: Pt[] = [];
    const inner: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const a = aS + spanA * f;
      const w = (width * (0.2 + 0.8 * f)) / 2;
      const [x, y] = pt(a);
      const [nx, ny] = normal(a);
      outer.push([x + nx * w, y + ny * w]);
      inner.push([x - nx * w, y - ny * w]);
    }
    g.beginPath();
    outer.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    for (let i = inner.length - 1; i >= 0; i--) {
      const [x, y] = inner[i] as Pt;
      g.lineTo(x, y);
    }
    g.closePath();

    if (typeof g.createConicGradient === 'function') {
      g.save();
      g.translate(cx, cy);
      g.scale(1, RY / RX);
      const grd = g.createConicGradient(aS, 0, 0);
      const stops = 24;
      for (let i = 0; i <= stops; i++) {
        const f = i / stops;
        const a = aS + spanA * f;
        grd.addColorStop(Math.min(1, (f * spanA) / TAU), rgba(mixRgb(B, A, f), ring * depth(a) * (0.08 + 0.92 * f * f)));
      }
      g.fillStyle = grd;
      g.fill();
      g.restore();
    } else {
      g.fillStyle = rgba(mid, 0.7 * ring * depth(aE));
      g.fill();
    }

    const [hx, hy] = pt(aE);
    const hd = depth(aE);
    g.fillStyle = rgba(A, ring * hd);
    g.beginPath();
    g.arc(hx, hy, width / 2, 0, TAU);
    g.fill();
    if (!mini) {
      const grd = g.createRadialGradient(hx, hy, 0, hx, hy, width * 2.4);
      grd.addColorStop(0, rgba(A, 0.42 * ring * hd));
      grd.addColorStop(1, rgba(A, 0));
      g.fillStyle = grd;
      g.beginPath();
      g.arc(hx, hy, width * 2.4, 0, TAU);
      g.fill();
    }
    g.restore();
  }
}

/* —— Static idle frame (logo.svg) ————————————————————————————— */

const f2 = (n: number): number => Number(n.toFixed(2));
const isoPath = (pts: Pt[]): string => `M${pts.map(([x, y]) => toIso(x, y).map(f2).join(' ')).join(' L')} Z`;
const rawPath = (pts: Pt[]): string => `M${pts.map(([x, y]) => `${f2(x)} ${f2(y)}`).join(' L')} Z`;

/** The idle mark as SVG. logo.svg is generated from this, so it matches frame 0 exactly. */
export function markSvg(): string {
  const m = MODES.idle;
  const play = PLAY.map(([x, y]): Pt => [x + m.at[0], y + m.at[1]]);
  const [[sx, sy], [ex, ey]] = STRIP_AXIS;
  const grille = GRILLE.map(([u, v]) => {
    const [x, y] = sidePt(u, v);
    return `<circle cx="${f2(x)}" cy="${f2(y)}" r="0.5" fill="#858b93" opacity="0.5"/>`;
  });
  const knobT = `matrix(1 ${K.toFixed(4)} 0 1 14 22)`;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Walkthrough Studio" fill="none">',
    '  <!-- Generated by studio/mark.js markSvg(): the idle frame of the animated mark. -->',
    '  <defs>',
    '    <linearGradient id="wsTop" x1="12" y1="8" x2="48" y2="22" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#6c727a"/><stop offset="1" stop-color="#4a5058"/></linearGradient>',
    '    <linearGradient id="wsSide" x1="40" y1="18" x2="58" y2="52" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2f3338"/><stop offset="1" stop-color="#1c2024"/></linearGradient>',
    '    <linearGradient id="wsFace" x1="8" y1="10" x2="56" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#5b6067"/><stop offset="0.55" stop-color="#454a51"/><stop offset="1" stop-color="#33373d"/></linearGradient>',
    `    <linearGradient id="wsScreen" x1="${f2(toIso(0, 0)[0])}" y1="${f2(toIso(0, 0)[1])}" x2="${f2(toIso(PLANE_W, PLANE_H)[0])}" y2="${f2(toIso(PLANE_W, PLANE_H)[1])}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${m.tintHi}"/><stop offset="1" stop-color="${m.tintLo}"/></linearGradient>`,
    `    <linearGradient id="wsLed" x1="${f2(sx)}" y1="${f2(sy)}" x2="${f2(ex)}" y2="${f2(ey)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${m.accent[0]}"/><stop offset="1" stop-color="${m.accent[1]}"/></linearGradient>`,
    '    <radialGradient id="wsShadow"><stop offset="0" stop-color="#000" stop-opacity="0.3"/><stop offset="0.55" stop-color="#000" stop-opacity="0.15"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>',
    '  </defs>',
    `  <ellipse cx="${SHADOW.cx}" cy="${SHADOW.cy}" rx="${SHADOW.rx}" ry="${SHADOW.ry}" fill="url(#wsShadow)"/>`,
    `  <path d="${rawPath(TOP)}" fill="url(#wsTop)"/>`,
    `  <path d="${rawPath(SIDE)}" fill="url(#wsSide)"/>`,
    `  <path d="${rawPath(FACE)}" fill="url(#wsFace)"/>`,
    '  <path d="M14 22 L32 12 L50 22" stroke="#fff" stroke-opacity="0.13" stroke-width="0.5" stroke-linejoin="round"/>',
    '  <path d="M14 22 L32 32 L50 22 M32 32 L32 50" stroke="#fff" stroke-opacity="0.08" stroke-width="0.5" stroke-linejoin="round"/>',
    `  <path d="${rawPath(BEZEL)}" fill="#16191d" opacity="0.78"/>`,
    `  <path d="${isoPath(SCREEN)}" fill="url(#wsScreen)"/>`,
    `  <path d="${isoPath(play)}" fill="${m.ink}"/>`,
    `  <path d="${rawPath(STRIP)}" fill="url(#wsLed)" opacity="0.82"/>`,
    `  <path d="${rawPath(SLOT)}" fill="#0e1013" opacity="0.72"/>`,
    `  <circle cx="${KNOB.u}" cy="${KNOB.v}" r="${KNOB.r}" fill="#272b31" transform="${knobT}"/>`,
    ...grille.map((c) => `  ${c}`),
    '</svg>',
    '',
  ].join('\n');
}

/* —— Scheduler + mounts (browser only) ———————————————————————— */

interface MarkInstance {
  canvas: HTMLCanvasElement | null;
  renderer: MarkRenderer;
  resolve: (() => string) | undefined;
  visible: boolean;
  background: boolean;
  fps: number;
  lastDraw: number;
  dirty: boolean;
  paint(): void;
}

export interface MountedMark extends MarkInstance {
  canvas: HTMLCanvasElement;
  setMode(m: string): void;
}

export interface MountMarkOptions {
  size?: number;
  mode?: string;
  resolve?: () => string;
  variant?: MarkVariant;
  enter?: boolean;
}

type MarkCanvas = HTMLCanvasElement & { __mark?: MarkInstance };

const instances = new Set<MarkInstance>();
let globalMode = 'idle';
let raf = 0;
let lastNow = 0;
let worker: Worker | null = null;
let okTimer: ReturnType<typeof setTimeout> | undefined;
let reducedQuery: MediaQueryList | null = null;

const reduced = (): boolean => !!reducedQuery?.matches;

function frame(now: number): void {
  raf = 0;
  const dt = lastNow ? (now - lastNow) / 1000 : 1 / 60;
  lastNow = now;
  const hidden = document.hidden;
  let any = false;
  for (const inst of instances) {
    if (inst.canvas && !inst.canvas.isConnected) {
      instances.delete(inst);
      continue;
    }
    if (hidden && !inst.background) continue;
    if (inst.resolve) inst.renderer.setMode(inst.resolve());
    const active = inst.renderer.step(dt);
    const due = !inst.fps || now - inst.lastDraw >= 1000 / inst.fps - 1;
    if ((inst.visible || inst.background) && (due || !active || inst.dirty)) {
      inst.paint();
      inst.lastDraw = now;
      inst.dirty = false;
    }
    if (active) any = true;
    else inst.dirty = false;
  }
  if (any) schedule();
  else lastNow = 0;
}

function schedule(): void {
  if (document.hidden) {
    if (!worker) {
      const src = 'let id;onmessage=(e)=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      worker.onmessage = () => frame(performance.now());
    }
    worker.postMessage(1000 / 12);
    return;
  }
  worker?.postMessage(0);
  if (!raf) raf = requestAnimationFrame(frame);
}

function wake(): void {
  schedule();
}

function sizeCanvas(canvas: HTMLCanvasElement, css: number): number {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const px = Math.max(1, Math.round(css * dpr));
  if (canvas.width !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  return dpr;
}

const io =
  typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
        for (const e of entries) {
          const inst = (e.target as MarkCanvas).__mark;
          if (!inst) continue;
          inst.visible = e.isIntersecting;
          if (inst.visible) {
            inst.dirty = true;
            wake();
          }
        }
      })
    : null;

/**
 * Animate a canvas element with the mark.
 * @param {HTMLCanvasElement} canvas
 * @param {{ size?: number, mode?: string, resolve?: () => string, variant?: string, enter?: boolean }} opts
 *   `resolve` is polled every frame (global mode followers, spinners that read their row state).
 *   `enter` plays the entrance choreography once (the boot mark).
 */
export function mountMark(canvas: HTMLCanvasElement, { size, mode, resolve, variant = 'auto', enter = false }: MountMarkOptions = {}): MountedMark {
  const renderer = new MarkRenderer({ mode: mode || resolve?.() || globalMode, variant, reducedMotion: reduced(), enter });
  const inst: MountedMark = {
    canvas,
    renderer,
    resolve,
    visible: !io,
    background: false,
    fps: 0,
    lastDraw: 0,
    dirty: true,
    paint() {
      const css = size || canvas.clientWidth || canvas.parentElement?.clientWidth || 16;
      const dpr = sizeCanvas(canvas, css);
      const g = canvas.getContext('2d') as CanvasRenderingContext2D;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderer.draw(g, css);
    },
    setMode(m) {
      renderer.setMode(m);
      wake();
    },
  };
  (canvas as MarkCanvas).__mark = inst;
  instances.add(inst);
  io?.observe(canvas);
  wake();
  return inst;
}

/* —— Favicon ————————————————————————————————————————————————— */

let favicon: MarkInstance | null = null;

function mountFavicon(): MarkInstance {
  if (favicon) return favicon;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  const iconLink = link;
  const renderer = new MarkRenderer({ mode: globalMode, variant: 'compact', reducedMotion: reduced() });
  let lastUrl = '';
  favicon = {
    canvas: null,
    renderer,
    resolve: () => globalMode,
    visible: true,
    background: true,
    fps: 15,
    lastDraw: 0,
    dirty: false,
    paint() {
      const g = canvas.getContext('2d') as CanvasRenderingContext2D;
      g.setTransform(1, 0, 0, 1, 0, 0);
      renderer.draw(g, 64);
      const url = canvas.toDataURL('image/png');
      if (url === lastUrl) return;
      lastUrl = url;
      iconLink.type = 'image/png';
      iconLink.href = url;
    },
  };
  instances.add(favicon);
  return favicon;
}

/* —— Global mode ————————————————————————————————————————————— */

let beatUntil = 0;

/**
 * Studio-wide state: favicon, header logo and any spinner without a row state follow it.
 * `ok` and `err` play their beat, then settle back to idle. An `idle` request during a beat waits
 * for it to finish (callers often reset right after reporting a result); busy modes interrupt.
 * @param {'idle'|'loading'|'draft'|'render'|'record'|'export'|'ok'|'err'} mode
 */
export function setMarkMode(mode: string): void {
  if (!modeTable[mode]) mode = 'idle';
  if (mode === 'idle' && performance.now() < beatUntil) return;
  clearTimeout(okTimer);
  beatUntil = 0;
  globalMode = mode;
  if (mode === 'ok' || mode === 'err') {
    for (const inst of instances) if (inst.resolve) inst.renderer.setMode(mode);
    const ms = mode === 'ok' ? 1900 : 2300;
    beatUntil = performance.now() + ms;
    okTimer = setTimeout(() => {
      beatUntil = 0;
      setMarkMode('idle');
    }, ms);
  }
  wake();
}

export function getMarkMode(): string {
  return globalMode;
}

/** Spinner state: its row (done / failed) wins, then the studio's busy mode, else a generic load. */
function spinnerMode(el: Element): string {
  if (el.closest('.is-failed')) return 'err';
  if (el.closest('.is-done')) return 'ok';
  return BUSY.has(globalMode) ? globalMode : 'loading';
}

function upgradeSpinner(el: HTMLElement): void {
  if (el.dataset.mark) return;
  el.dataset.mark = '1';
  const canvas = document.createElement('canvas');
  canvas.className = 'mark-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  el.appendChild(canvas);
  if (!el.hasAttribute('role')) {
    el.setAttribute('role', 'status');
    el.setAttribute('aria-label', 'Working');
  }
  mountMark(canvas, { resolve: () => spinnerMode(el) });
}

function upgradeAll(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.activity-spinner:not([data-mark]), .spinner:not([data-mark]), [data-mark-spinner]:not([data-mark])').forEach(upgradeSpinner);
}

let booted = false;

/** Favicon, header logo (`#brandMark`) and every spinner, now and when added later. */
export function initMarks(): void {
  if (booted) return;
  booted = true;
  reducedQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
  reducedQuery?.addEventListener?.('change', () => {
    for (const inst of instances) inst.renderer.reduced = reduced();
  });
  mountFavicon();
  const brand = document.getElementById('brandMark') as HTMLCanvasElement | null;
  if (brand) mountMark(brand, { size: brand.clientWidth || 22, resolve: () => globalMode });
  const boot = document.getElementById('bootMark') as HTMLCanvasElement | null;
  if (boot) mountMark(boot, { size: 96, resolve: () => globalMode, enter: true });
  upgradeAll(document);
  new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        const el = n as HTMLElement;
        if (el.matches('.activity-spinner, .spinner, [data-mark-spinner]')) upgradeSpinner(el);
        upgradeAll(el);
      });
    }
  }).observe(document.body, { childList: true, subtree: true });
  // Row state (is-done / is-failed) flips by class; poll lightly so a settled spinner re-wakes.
  setInterval(() => {
    for (const inst of instances) {
      if (!inst.resolve || !inst.canvas) continue;
      if (inst.resolve() !== inst.renderer.mode) wake();
    }
  }, 300);
  document.addEventListener('visibilitychange', () => {
    lastNow = 0;
    wake();
  });
  wake();
}
