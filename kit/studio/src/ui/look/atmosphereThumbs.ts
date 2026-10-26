import { api } from '@/desk/api';

/**
 * Background thumbnails drawn by the plates' own WebGL fields (`GET /api/atmospheres/shaders`,
 * the same GLSL `kit/lib/atmosphere.mjs` injects into every plate). One offscreen context
 * compiles each field once, renders a settled frame in the slide's palette and copies it into
 * the tile; hovering a tile plays the field live. Without WebGL the tiles keep their CSS swatch.
 */

interface FieldSource {
  label: string;
  opacity: number;
  shader: string;
}

interface Program {
  prog: WebGLProgram;
  U: Record<string, WebGLUniformLocation | null>;
}

export interface ThumbPalette {
  ink: string;
  surface: string;
  gold: string;
  amber: string;
  teal: string;
}

const W = 160;
const H = 90;
const SETTLED_SEC = 7;
const UNIFORMS = ['uRes', 'uTime', 'uGold', 'uAmber', 'uTeal', 'uInk', 'uSurface', 'uOpacity', 'uDrift', 'uEnv'];

let fields: Record<string, FieldSource> | null = null;
let loading: Promise<Record<string, FieldSource> | null> | null = null;
let gl: WebGLRenderingContext | null = null;
let glCanvas: HTMLCanvasElement | null = null;
let glFailed = false;
const programs = new Map<string, Program | null>();
const stills = new Map<string, HTMLCanvasElement>();
/** Each panel fills its own queue; a repaint elsewhere must not cancel it. */
let queueGen = 0;
let rootGen = new WeakMap<HTMLElement, number>();
let live: { id: string; raf: number } | null = null;

function loadFields(): Promise<Record<string, FieldSource> | null> {
  if (fields) return Promise.resolve(fields);
  loading ||= api<{ fields?: Record<string, FieldSource> }>('/api/atmospheres/shaders')
    .then((r) => (fields = r.fields || {}))
    .catch(() => null);
  return loading;
}

function context(): WebGLRenderingContext | null {
  // Browsers drop the oldest contexts once the stage's plates open their own; start over then.
  if (gl?.isContextLost()) {
    gl = null;
    glCanvas = null;
    programs.clear();
  }
  if (gl || glFailed) return gl;
  try {
    glCanvas = document.createElement('canvas');
    glCanvas.width = W;
    glCanvas.height = H;
    gl = glCanvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: true });
  } catch {
    gl = null;
  }
  if (!gl) {
    glFailed = true;
    return null;
  }
  gl.getExtension('OES_standard_derivatives');
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  return gl;
}

function program(id: string): Program | null {
  const g = context();
  if (programs.has(id)) return programs.get(id) ?? null;
  const src = fields?.[id]?.shader;
  if (!g || !src) return null;
  const compile = (type: number, text: string) => {
    const s = g.createShader(type);
    if (!s) return null;
    g.shaderSource(s, text);
    g.compileShader(s);
    return g.getShaderParameter(s, g.COMPILE_STATUS) ? s : null;
  };
  const vs = compile(g.VERTEX_SHADER, 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }');
  const fs = compile(g.FRAGMENT_SHADER, src);
  const prog = vs && fs ? g.createProgram() : null;
  if (prog && vs && fs) {
    g.attachShader(prog, vs);
    g.attachShader(prog, fs);
    g.linkProgram(prog);
  }
  if (!prog || !g.getProgramParameter(prog, g.LINK_STATUS)) {
    if (!g.isContextLost()) programs.set(id, null);
    return null;
  }
  const U = Object.fromEntries(UNIFORMS.map((n) => [n, g.getUniformLocation(prog, n)]));
  const entry = { prog, U };
  programs.set(id, entry);
  return entry;
}

function rgb01(hex: string, fallback: [number, number, number]): [number, number, number] {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex || '').trim());
  if (!m) return fallback;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

/** Draw one field frame into the shared GL canvas; false when the field cannot render here. */
function drawField(id: string, sec: number, pal: ThumbPalette): boolean {
  const p = program(id);
  const g = gl;
  if (!p || !g) return false;
  g.useProgram(p.prog);
  const loc = g.getAttribLocation(p.prog, 'a');
  g.enableVertexAttribArray(loc);
  g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
  g.viewport(0, 0, W, H);
  g.clear(g.COLOR_BUFFER_BIT);
  g.uniform2f(p.U['uRes']!, W, H);
  g.uniform1f(p.U['uTime']!, sec);
  g.uniform3fv(p.U['uGold']!, rgb01(pal.gold, [0.96, 0.67, 0.12]));
  g.uniform3fv(p.U['uAmber']!, rgb01(pal.amber, [0.96, 0.45, 0.15]));
  g.uniform3fv(p.U['uTeal']!, rgb01(pal.teal, [0.18, 0.83, 0.75]));
  g.uniform3fv(p.U['uInk']!, rgb01(pal.ink, [0.02, 0.03, 0.05]));
  g.uniform3fv(p.U['uSurface']!, rgb01(pal.surface, [0.07, 0.1, 0.17]));
  // Thumbnails run the field a little hotter than the plate so it reads at tile size.
  g.uniform1f(p.U['uOpacity']!, Math.min(1, Math.max(0.55, (fields?.[id]?.opacity ?? 0.4) * 1.6)));
  g.uniform1f(p.U['uDrift']!, 1);
  g.uniform1f(p.U['uEnv']!, 1);
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  return true;
}

function blit(target: HTMLCanvasElement, pal: ThumbPalette): void {
  const ctx = target.getContext('2d');
  if (!ctx || !glCanvas) return;
  ctx.fillStyle = pal.ink || '#05070b';
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.drawImage(glCanvas, 0, 0, target.width, target.height);
}

const paletteKey = (p: ThumbPalette) => `${p.ink}|${p.surface}|${p.gold}|${p.amber}|${p.teal}`;

function still(id: string, pal: ThumbPalette): HTMLCanvasElement | null {
  const key = `${id}@${paletteKey(pal)}`;
  const hit = stills.get(key);
  if (hit) return hit;
  if (!drawField(id, SETTLED_SEC, pal)) return null;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  blit(c, pal);
  stills.set(key, c);
  return c;
}

function stopLive(): void {
  if (live) cancelAnimationFrame(live.raf);
  live = null;
}

function playLive(canvas: HTMLCanvasElement, id: string, pal: ThumbPalette): void {
  stopLive();
  const t0 = performance.now();
  const step = () => {
    if (!canvas.isConnected) return stopLive();
    if (drawField(id, SETTLED_SEC + (performance.now() - t0) / 1000, pal)) blit(canvas, pal);
    if (live) live.raf = requestAnimationFrame(step);
  };
  live = { id, raf: requestAnimationFrame(step) };
}

/** A canvas a React panel keeps mounted is painted many times; it is wired once and reads its latest palette. */
const palettes = new WeakMap<HTMLCanvasElement, ThumbPalette>();

/**
 * Paint every `canvas[data-atm]` under `root` in `pal`. Stills are cached per palette, so a
 * re-render of the inspector repaints instantly; uncached fields compile one per tick.
 */
export function paintAtmosphereThumbs(root: HTMLElement, pal: ThumbPalette): void {
  // React can swap a tile's canvas while the catalogue loads, so the canvases are read again then.
  const canvasesIn = () => [...root.querySelectorAll<HTMLCanvasElement>('canvas[data-atm]')];
  const wire = (canvas: HTMLCanvasElement) => {
    const bound = palettes.has(canvas);
    palettes.set(canvas, pal);
    if (bound) return;
    const tileEl = canvas.closest<HTMLElement>('.lk-tile');
    const palOf = () => palettes.get(canvas) ?? pal;
    tileEl?.addEventListener('pointerenter', () => fields && playLive(canvas, canvas.dataset['atm'] || '', palOf()));
    tileEl?.addEventListener('pointerleave', () => {
      stopLive();
      const s = fields ? still(canvas.dataset['atm'] || '', palOf()) : null;
      if (s) canvas.getContext('2d')?.drawImage(s, 0, 0, canvas.width, canvas.height);
    });
  };
  const canvases = canvasesIn();
  if (!canvases.length) return;
  const gen = ++queueGen;
  rootGen.set(root, gen);
  const current = () => rootGen.get(root) === gen;
  stopLive();
  canvases.forEach(wire);
  void loadFields().then((f) => {
    if (!f || !current()) return;
    const todo = canvasesIn();
    todo.forEach(wire);
    const next = () => {
      if (!current()) return;
      const t0 = performance.now();
      // A few fields per frame keeps the inspector responsive while it fills in.
      while (todo.length && performance.now() - t0 < 12) {
        const canvas = todo.shift()!;
        if (!canvas.isConnected) continue;
        const s = still(canvas.dataset['atm'] || '', pal);
        if (s) {
          canvas.getContext('2d')?.drawImage(s, 0, 0, canvas.width, canvas.height);
          canvas.closest('.lk-atm')?.classList.add('is-drawn');
        }
      }
      if (todo.length) requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  });
}

/** Paint one canvas with a settled frame of `id` in `pal`, leaving the tile queue alone. */
export function paintAtmosphereStill(canvas: HTMLCanvasElement, id: string, pal: ThumbPalette): void {
  void loadFields().then((f) => {
    if (!f || !canvas.isConnected) return;
    const s = still(id, pal);
    if (!s) return;
    canvas.getContext('2d')?.drawImage(s, 0, 0, canvas.width, canvas.height);
    canvas.closest('.lk-atm')?.classList.add('is-drawn');
  });
}

/** Tests and project switches start from an empty cache. */
export function resetAtmosphereThumbs(): void {
  stopLive();
  stills.clear();
  rootGen = new WeakMap();
}
