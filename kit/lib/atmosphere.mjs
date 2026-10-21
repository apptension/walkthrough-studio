/**
 * Brand atmosphere for every plate: a WebGL field behind the content plus the plate runtime
 * (shared clock + per-frame hooks) that keeps JS-driven effects frame-deterministic.
 *
 * Fields (brand.json → motion.atmosphere, video-local via direction.motion.atmosphere):
 *   none       CSS atmosphere only (bg, blobs, grid, grain)
 *   schedule   soft resource-calendar bars (the original schedule field)
 *   aurora     slow fbm ribbons in accent / secondary / support
 *   mesh       drifting mesh gradient — five colour nodes blending
 *   particles  three parallax layers of bokeh dust with twinkle
 *   grid       perspective floor with a travelling light pulse
 *   waves      topographic contour lines flowing across the frame
 *   …plus every field promoted out of the atmosphere lab (see PROMOTED_FIELDS)
 *
 * Every field reads the same uniforms (five-colour scale, time, drift, in/out envelope) so a
 * brand swap recolours it with no shader edits. Time comes from the plate clock, which the
 * encoder steps per frame (`__plateRuntime.renderAt(ms)`), so a render is deterministic within
 * one raster backend. Legacy `motion.scheduleField: true` maps to `atmosphere: "schedule"`.
 */
import { parseCssHex } from './text.mjs';
import { ATMOSPHERE_IDS, resolveMotion } from './plateMotion.mjs';
import { countUpRuntimeSource } from './countUp.mjs';
import { typeFitRuntimeSource } from './typeFit.mjs';
import { GLSL_PREAMBLE } from './atmosphereGlsl.mjs';
import { labShaderSource, PROMOTED_FIELDS } from './atmosphereLab.mjs';

export { GLSL_PREAMBLE };

const CORE_ATMOSPHERES = {
  none: { label: 'None', hint: 'CSS atmosphere only', opacity: 0 },
  schedule: { label: 'Schedule', hint: 'Soft resource-calendar bars', opacity: 0.34 },
  aurora: { label: 'Aurora', hint: 'Slow ribbons of brand light', opacity: 0.42 },
  mesh: { label: 'Mesh', hint: 'Drifting mesh gradient', opacity: 0.5 },
  particles: { label: 'Particles', hint: 'Parallax bokeh dust', opacity: 0.5 },
  grid: { label: 'Grid', hint: 'Perspective floor with a light pulse', opacity: 0.4 },
  waves: { label: 'Waves', hint: 'Topographic contour lines', opacity: 0.36 },
};

export const ATMOSPHERES = Object.freeze({
  ...CORE_ATMOSPHERES,
  ...Object.fromEntries(PROMOTED_FIELDS.map((f) => [f.id, { label: f.label, hint: f.hint, opacity: f.opacity }])),
});

export { ATMOSPHERE_IDS };

function rgb01(hex, fallback) {
  const rgb = parseCssHex(hex);
  if (!rgb) return fallback;
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}

/** JS array literal for a uniform3fv call (colours are 0–1 floats). */
const vec3 = (v) => `[${v.map((n) => n.toFixed(4)).join(', ')}]`;

/** Resolve the atmosphere choice + its tuning from brand motion (video-local overrides included). */
export function resolveAtmosphere(brand) {
  const m = resolveMotion(brand);
  const id = ATMOSPHERES[m.atmosphere] ? m.atmosphere : 'none';
  const base = ATMOSPHERES[id];
  const opacity = Number.isFinite(m.atmosphereOpacity) ? Math.max(0, Math.min(1, m.atmosphereOpacity)) : base.opacity;
  const speed = Number.isFinite(m.atmosphereSpeed) ? Math.max(0.2, Math.min(2.5, m.atmosphereSpeed)) : 1;
  return { id, label: base.label, hint: base.hint, opacity, speed, drift: m.blobDrift ?? 1 };
}

/* ———————————————————————————————————————————————————————————————————————————————————————————
   GLSL: shared preamble + one body per field. Fields write straight-alpha gl_FragColor; the
   blend over the cleared buffer premultiplies it for the page compositor.
   ——————————————————————————————————————————————————————————————————————————————————————————— */

const GLSL = {
  schedule: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  p.y += 0.02;
  float t = uTime * 0.32 * uDrift;
  vec2 field = p * 1.12;
  field.x += sin(t * 0.28) * 0.028;
  field.y += cos(t * 0.22) * 0.018;
  float rows = 7.0; float cols = 11.0;
  float cellW = 0.118; float cellH = 0.078; float gapX = 0.014; float gapY = 0.028;
  float pitchX = cellW + gapX;
  float dMin = 1e3; float accent = 0.0; float barId = 0.0; float barAlpha = 0.0;
  for (float row = 0.0; row < 7.0; row += 1.0) {
    for (float col = 0.0; col < 11.0; col += 1.0) {
      float id = row * 17.0 + col * 3.0;
      float h = hash(vec2(id, 2.7)); float h2 = hash(vec2(id, 9.1)); float h3 = hash(vec2(id, 4.4));
      if (h < 0.34) continue;
      float phase = h3 * 6.28318; float speed = 0.55 + h2 * 0.65; float cycle = t * speed + phase;
      float presence = smoothstep(0.12, 0.42, 0.5 + 0.5 * sin(cycle * 0.55));
      if (presence < 0.04) continue;
      float lenA = mix(0.5, 1.15, h2); float lenB = mix(0.85, 1.85, h);
      if (h > 0.78) lenB += 0.45;
      float len = mix(lenA, lenB, easeInOut(0.5 + 0.5 * sin(cycle * 0.85)));
      float slideAmt = (h > 0.5 ? 1.0 : -1.0) * mix(0.55, 1.35, h3);
      float slide = sin(cycle * 0.7) * slideAmt * pitchX * 0.85 * uDrift;
      float rowNudge = sin(cycle * 0.38 + row) * gapY * 0.55 * uDrift;
      vec2 center = vec2((col - (cols - 1.0) * 0.5) * pitchX + slide, (row - (rows - 1.0) * 0.5) * (cellH + gapY) + rowNudge);
      float thick = mix(0.28, 0.38, 0.5 + 0.5 * sin(cycle * 1.1));
      float d = sdRoundBox(field - center, vec2(cellW * 0.5 * len, cellH * thick), 0.02);
      float dWeighted = d + (1.0 - presence) * 0.04;
      if (dWeighted < dMin) { dMin = dWeighted; accent = step(0.7, h); barId = id; barAlpha = presence; }
    }
  }
  float edge = 1.0 - smoothstep(-0.008, 0.032, dMin);
  float glow = exp(-max(dMin, 0.0) * 22.0) * 0.62;
  float fill = smoothstep(0.028, -0.014, dMin) * barAlpha;
  float lx = field.x * 0.8 - 0.35; float ly = field.y * 0.9 + 0.4;
  float key = clamp(0.55 - 0.45 * lx + 0.25 * ly, 0.2, 1.0);
  float rim = pow(clamp(1.0 - abs(dMin) * 32.0, 0.0, 1.0), 2.0) * 0.32;
  vec3 barCol = mix(uGold, uAmber, 0.35 + 0.35 * sin(barId));
  barCol = mix(barCol * 0.55, barCol, accent) * key + uAmber * rim * 0.5;
  float vign = smoothstep(1.25, 0.2, length(p * vec2(0.75, 0.95)));
  vec3 base = mix(uInk, uSurface, 0.32 + 0.22 * vign);
  float sweep = 0.5 + 0.5 * sin(field.x * 2.0 - t * 0.75 + field.y * 0.7);
  base += mix(uGold, uAmber, 0.4) * sweep * 0.03 * vign;
  vec3 col = mix(base, barCol, fill * 0.82) + barCol * glow * 0.4 * barAlpha + uGold * edge * 0.06 * barAlpha;
  float alpha = (fill * 0.58 + glow * 0.38 + 0.08) * uOpacity * contentDim(uv) * vign * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, uOpacity));
}`,

  aurora: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.11 * uDrift;
  vec3 acc = vec3(0.0); float a = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 q = p * vec2(0.85, 1.5) + vec2(t * (0.55 + fi * 0.22) + fi * 7.3, fi * 3.1);
    float warp = fbm(q * 0.6 + vec2(0.0, t * 0.35));
    float n = fbm(q + warp * 0.9);
    float yc = (n - 0.5) * 1.1 + (fi - 1.0) * 0.26 - 0.04;
    float band = exp(-pow((p.y - yc) * 3.0, 2.0));
    float streak = 0.55 + 0.45 * fbm(vec2(q.x * 2.2 - t * 0.6, fi));
    vec3 c = i == 0 ? uGold : (i == 1 ? uAmber : uTeal);
    acc += c * band * streak;
    a += band * streak * 0.55;
  }
  vec3 col = acc / max(a * 1.6, 0.25);
  col = mix(col, mix(uGold, uTeal, 0.5), 0.12);
  float alpha = clamp(a, 0.0, 1.0) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, alpha);
}`,

  mesh: `
vec3 nodeColor(int i){
  if (i == 0) return uGold;
  if (i == 1) return uAmber;
  if (i == 2) return uTeal;
  if (i == 3) return mix(uGold, uSurface, 0.45);
  return mix(uAmber, uTeal, 0.5);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.09 * uDrift;
  vec3 acc = vec3(0.0); float w = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float ph = fi * 1.7;
    vec2 c = vec2(sin(t * (0.7 + fi * 0.13) + ph) * 0.62 * aspect * 0.6, cos(t * (0.55 + fi * 0.17) + ph * 1.3) * 0.38);
    float d = length(p - c);
    float wi = exp(-d * d * 2.6);
    acc += nodeColor(i) * wi;
    w += wi;
  }
  vec3 col = acc / max(w, 1e-3);
  float n = fbm(p * 2.2 + t * 0.4);
  col = mix(col, col * (0.85 + 0.3 * n), 0.6);
  col += (hash(gl_FragCoord.xy * 0.5 + fract(t) * 13.0) - 0.5) * 0.025;
  float alpha = clamp(w * 0.85, 0.0, 1.0) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, alpha);
}`,

  particles: `
float layer(vec2 p, float scale, float t, float seed, float minR, float maxR, out float glow){
  vec2 g = p * scale + vec2(seed * 3.7, t);
  vec2 id = floor(g); vec2 f = fract(g) - 0.5;
  float s = 0.0; glow = 0.0;
  for (int dx = -1; dx <= 1; dx++) {
    for (int dy = -1; dy <= 1; dy++) {
      vec2 n = vec2(float(dx), float(dy));
      vec2 cid = id + n;
      float h = hash(cid + seed);
      if (h < 0.5) continue;
      vec2 off = (vec2(hash(cid + seed + 1.3), hash(cid + seed + 2.7)) - 0.5) * 0.7;
      off += 0.07 * vec2(sin(t * 1.4 + h * 6.28), cos(t * 1.1 + h * 6.28));
      float r = mix(minR, maxR, hash(cid + seed + 4.1));
      float d = length(f - n - off);
      float tw = 0.65 + 0.35 * sin(t * (1.5 + h * 2.0) + h * 20.0);
      s += smoothstep(r, r * 0.35, d) * tw;
      glow += exp(-d * d * 60.0) * tw * 0.35;
    }
  }
  return s;
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.07 * uDrift;
  float g0; float g1; float g2;
  float far = layer(p, 11.0, t * 0.5, 1.0, 0.03, 0.06, g0);
  float mid = layer(p, 6.5, t * 0.8, 2.0, 0.05, 0.1, g1);
  float near = layer(p + vec2(0.0, -0.02), 3.6, t * 1.2, 3.0, 0.08, 0.16, g2);
  vec3 col = uTeal * 0.5 * far + uGold * 0.9 * mid + uAmber * 0.8 * near;
  float a = far * 0.25 + mid * 0.45 + near * 0.55 + g0 * 0.15 + g1 * 0.3 + g2 * 0.4;
  vec3 haze = mix(uSurface, uGold, 0.25) * 0.12;
  col += haze;
  a += 0.1;
  col = col / max(a, 0.2);
  float alpha = clamp(a, 0.0, 1.0) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, alpha);
}`,

  grid: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.35 * uDrift;
  float horizon = 0.14;
  float yv = horizon - p.y;
  vec3 col = vec3(0.0); float alpha = 0.0;
  if (yv > 0.004) {
    float z = 0.42 / yv;
    float x = p.x * z;
    float zz = z + t * 1.4;
    vec2 cell = vec2(x * 1.15, zz);
    vec2 fw = fwidth(cell) * 1.4 + 0.004;
    vec2 g = abs(fract(cell - 0.5) - 0.5);
    vec2 l = 1.0 - smoothstep(vec2(0.0), fw, g);
    float line = max(l.x, l.y);
    float depth = exp(-z * 0.32);
    float pulse = exp(-pow(fract(zz * 0.06 - t * 0.09) - 0.5, 2.0) * 60.0);
    vec3 lineCol = mix(uGold, uTeal, smoothstep(0.2, 0.9, fract(zz * 0.06 - t * 0.09)));
    col = lineCol * (0.7 + 0.9 * pulse);
    alpha = line * depth * (0.85 + 0.55 * pulse);
    float floorGlow = exp(-yv * 9.0) * 0.5;
    col += uGold * floorGlow;
    alpha += floorGlow * 0.6;
  }
  float hz = exp(-abs(p.y - horizon) * 14.0);
  col += mix(uGold, uAmber, 0.5) * hz * 0.9;
  alpha += hz * 0.55;
  col = col / max(alpha, 0.3);
  alpha = clamp(alpha, 0.0, 1.0) * vignette(p * vec2(0.9, 1.0)) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, alpha);
}`,

  waves: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.08 * uDrift;
  float n = fbm(p * 1.5 + vec2(t * 0.9, -t * 0.6)) + 0.12 * sin(p.x * 2.6 + t * 2.0);
  float levels = n * 10.0 + t * 1.2;
  float d = abs(fract(levels) - 0.5);
  float fw = fwidth(levels) * 1.3 + 0.012;
  float line = 1.0 - smoothstep(0.0, fw, d);
  float major = 1.0 - smoothstep(0.0, fw * 1.8, abs(fract(levels / 4.0) - 0.5) * 4.0);
  vec3 col = mix(uTeal, uGold, smoothstep(0.25, 0.75, n));
  col = mix(col, uAmber, major * 0.5);
  float fill = smoothstep(0.35, 0.8, n) * 0.08;
  float alpha = (line * 0.75 + major * 0.35 + fill) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  alpha = clamp(alpha, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}`,
};

/** Fragment shader source for a field id (preamble + body). */
export function fieldShaderSource(id) {
  if (GLSL[id]) return GLSL_PREAMBLE + GLSL[id];
  if (PROMOTED_FIELDS.some((f) => f.id === id)) return labShaderSource(id);
  throw new Error(`Unknown atmosphere "${id}"`);
}

/**
 * Inline runtime: plate clock, per-frame hooks and (when enabled) the WebGL field.
 * The encoder calls `__plateRuntime.renderAt(ms)` after pausing CSS animations; Studio's live
 * preview follows the clock while animations run. `__plateField` is kept as an alias.
 */
export function atmosphereSnippet(brand) {
  const atmo = resolveAtmosphere(brand);
  const enabled = atmo.id !== 'none';
  const c = brand.colors || {};
  const gold = rgb01(c.gold, [0.96, 0.67, 0.12]);
  const amber = rgb01(c.amber, [0.96, 0.45, 0.15]);
  const teal = rgb01(c.teal || c.gold, [0.18, 0.83, 0.75]);
  const ink = rgb01(c.ink, [0.02, 0.03, 0.05]);
  const surface = rgb01(c.surface || c.ink, [0.07, 0.1, 0.17]);

  const markup = enabled
    ? `<canvas class="plate-field" data-field="${atmo.id}" width="1920" height="1080" aria-hidden="true"></canvas>
      <div class="plate-clock" aria-hidden="true"></div>`
    : `<div class="plate-clock" aria-hidden="true"></div>`;

  const shader = enabled ? fieldShaderSource(atmo.id) : '';

  const script = `<script>
(function () {
  const clock = document.querySelector('.plate-clock');
  if (!clock) return;
  const hooks = (window.__plateHooks = window.__plateHooks || []);
  const cssSec = (name, fallback) => {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
  };
  function durMs() {
    const d = parseFloat(document.body.dataset.duration || '6');
    return (Number.isFinite(d) ? d : 6) * 1000;
  }
  function ensureClock() {
    const existing = clock.getAnimations()[0];
    if (existing) return existing;
    return clock.animate([{ opacity: 0 }, { opacity: 1 }], { duration: durMs(), fill: 'both', easing: 'linear' });
  }
  function clockMs() {
    const a = ensureClock();
    return Math.max(0, a.currentTime == null ? 0 : Number(a.currentTime));
  }
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function envelope(sec) {
    const blackOut = cssSec('--black-out', durMs() / 1000 - 0.7);
    return smooth(0, 0.9, sec) * (1 - 0.6 * smooth(blackOut - 0.15, blackOut + 0.55, sec));
  }

  let drawField = null;
  ${
    enabled
      ? `
  (function initField() {
    const canvas = document.querySelector('.plate-field');
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!gl) { canvas.style.display = 'none'; return; }
    gl.getExtension('OES_standard_derivatives');
    const vsSrc = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }';
    const fsSrc = ${JSON.stringify(shader)};
    function compile(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[plate-field]', gl.getShaderInfoLog(s)); return null; }
      return s;
    }
    const vs = compile(gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) { canvas.style.display = 'none'; return; }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.style.display = 'none'; return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    for (const n of ['uRes', 'uTime', 'uGold', 'uAmber', 'uTeal', 'uInk', 'uSurface', 'uOpacity', 'uDrift', 'uEnv']) U[n] = gl.getUniformLocation(prog, n);
    // Straight alpha in, premultiplied out: blending over the cleared buffer multiplies col by
    // alpha while the alpha channel itself is written as-is (plain SRC_ALPHA would square it).
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    drawField = function (sec) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uTime, sec * ${atmo.speed.toFixed(3)});
      gl.uniform3fv(U.uGold, ${vec3(gold)});
      gl.uniform3fv(U.uAmber, ${vec3(amber)});
      gl.uniform3fv(U.uTeal, ${vec3(teal)});
      gl.uniform3fv(U.uInk, ${vec3(ink)});
      gl.uniform3fv(U.uSurface, ${vec3(surface)});
      gl.uniform1f(U.uOpacity, ${atmo.opacity.toFixed(3)});
      gl.uniform1f(U.uDrift, ${Number(atmo.drift).toFixed(3)});
      gl.uniform1f(U.uEnv, envelope(sec));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
  })();`
      : ''
  }

  function render(ms) {
    const sec = Math.max(0, ms) / 1000;
    if (drawField) drawField(sec);
    for (const h of hooks) { try { h(ms); } catch (e) { console.warn('[plate-hook]', e); } }
  }

  window.__plateRuntime = {
    field: ${JSON.stringify(atmo.id)},
    renderAt(ms) {
      const a = ensureClock();
      a.pause();
      a.currentTime = Math.max(0, ms);
      render(ms);
    },
    /** Register a per-frame hook; it runs once at the current clock so static previews are correct. */
    hook(fn) {
      hooks.push(fn);
      try { fn(clockMs()); } catch (e) { console.warn('[plate-hook]', e); }
    },
  };
  window.__plateField = window.__plateRuntime;

  // Live Studio preview: follow the shared clock while CSS animations run.
  let raf = 0;
  function loop() {
    const playing = document.getAnimations().some((a) => a.playState === 'running');
    if (playing) render(clockMs());
    raf = requestAnimationFrame(loop);
  }
  ensureClock();
  render(0);
  raf = requestAnimationFrame(loop);
  window.addEventListener('beforeunload', () => cancelAnimationFrame(raf));
})();
</script>
<script>
${countUpRuntimeSource()}
</script>
<script>
${typeFitRuntimeSource()}
</script>`;

  return { markup, script, enabled, atmosphere: atmo };
}

/** Inject runtime (and field canvas) into filled plate HTML — templates stay untouched. */
export function injectAtmosphere(html, brand) {
  const { markup, script } = atmosphereSnippet(brand);
  if (!html.includes('<div class="bg"></div>')) return html;
  let out = html.replace('<div class="bg"></div>', `<div class="bg"></div>\n      ${markup}`);
  if (out.includes('</body>')) out = out.replace('</body>', `${script}\n</body>`);
  return out;
}
