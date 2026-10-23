/**
 * Title reveal templates.
 *
 * Type motion (CSS, stepped with the plate clock like every other animation):
 *   rise      masked lift — words on open / statement / close, the whole line elsewhere
 *   cascade   per-character flip (needs letter markup)
 *   wipe      left-to-right unmask
 *   focus     blur and scale resolve
 *   veil      soft haze settles into the line
 *
 * WebGL masks (same clock via `__plateRuntime.renderAt`, brand gold / amber):
 *   ink       noise bleed with a gold edge
 *   slit      a band of light wipes the line
 *   iris      radial open from the optical centre
 *   embers    upward dissolve with sparks on the front
 *
 * WebGL draws a mask and a glow for the title. The mask canvas stays hidden and
 * is applied as a CSS alpha mask, so the DOM type stays crisp and editable and
 * the plate behind it is never punched out. Progress is expo-out from `--t`
 * over `--motion-enter`.
 */
export const TITLE_REVEALS = Object.freeze(['rise', 'cascade', 'wipe', 'focus', 'veil', 'ink', 'slit', 'iris', 'embers']);

export const TITLE_REVEAL_LABELS = Object.freeze({
  rise: 'Rise · masked lift',
  cascade: 'Cascade · character flip',
  wipe: 'Wipe · line unmask',
  focus: 'Focus · blur resolve',
  veil: 'Veil · soft settle',
  ink: 'Ink · bleed reveal',
  slit: 'Slit · light band',
  iris: 'Iris · radial open',
  embers: 'Embers · spark dissolve',
});

/** WebGL reveals. The rest are CSS (cascade also needs per-character markup). */
export const WEBGL_REVEALS = Object.freeze(['ink', 'slit', 'iris', 'embers']);

/**
 * How a title is built.
 *   chars  per-character spans
 *   wipe   per-line clip shell (open, statement, close)
 *   words  masked words (open, statement) or a masked line (close)
 *   plain  emphasised text; CSS or WebGL on `[data-reveal]` owns the entrance
 */
export function revealMarkup(id) {
  if (id === 'cascade') return 'chars';
  if (id === 'wipe') return 'wipe';
  if (!id || id === 'rise') return 'words';
  return 'plain';
}

/**
 * Does switching reveal rebuild the plate HTML?
 * Open, close and statement bake the family into the title. Other plates only
 * bake cascade letters; rise, wipe and the plain templates share one title.
 */
export function revealNeedsMarkup(plateId, from, to, plateType) {
  if (from === to) return false;
  const shaped = plateId === 'open' || plateId === 'close' || plateType === 'statement';
  if (!shaped) return revealMarkup(from) === 'chars' || revealMarkup(to) === 'chars';
  return revealMarkup(from) !== revealMarkup(to);
}

const GLSL_PREAMBLE = `
precision highp float;
uniform vec2 uRes;
uniform float uP;
uniform vec3 uGold;
uniform vec3 uAmber;
uniform float uPass;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
`;

const GLSL = {
  ink: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float n = fbm(uv * vec2(3.6, 2.3) + vec2(1.7, 0.4));
  float v = n * 0.72 + uv.x * 0.28;
  float front = mix(-0.18, 1.08, uP);
  float a = 1.0 - smoothstep(front - 0.16, front + 0.02, v);
  float yWin = smoothstep(0.08, 0.22, uv.y) * (1.0 - smoothstep(0.78, 0.94, uv.y));
  float fringe = exp(-abs(v - front) * 26.0) * (1.0 - smoothstep(0.9, 1.0, uP)) * yWin;
  if (uPass < 0.5) gl_FragColor = vec4(1.0, 1.0, 1.0, a);
  else gl_FragColor = vec4(mix(uGold, uAmber, 0.35 + 0.4 * n), fringe * 0.85);
}`,
  slit: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float head = mix(-0.22, 1.16, uP) + sin(uv.y * 8.0) * 0.01;
  float a = 1.0 - smoothstep(head - 0.01, head + 0.028, uv.x);
  float yWin = smoothstep(0.16, 0.3, uv.y) * (1.0 - smoothstep(0.7, 0.84, uv.y));
  float band = exp(-pow((uv.x - head) * 62.0, 2.0)) * yWin;
  float live = 1.0 - smoothstep(0.93, 1.0, uP);
  if (uPass < 0.5) gl_FragColor = vec4(1.0, 1.0, 1.0, a);
  else gl_FragColor = vec4(mix(uGold, vec3(1.0), 0.42), band * live);
}`,
  iris: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = (uv - vec2(0.5, 0.46)) * vec2(aspect, 1.0);
  float r = length(p);
  float cover = length(vec2(aspect * 0.5, 0.62));
  float rad = mix(-0.12, cover, uP);
  float a = 1.0 - smoothstep(rad, rad + 0.045, r);
  float ring = exp(-abs(r - rad) * 26.0) * (1.0 - smoothstep(0.92, 1.0, uP));
  if (uPass < 0.5) gl_FragColor = vec4(1.0, 1.0, 1.0, a);
  else gl_FragColor = vec4(mix(uAmber, uGold, 0.55), ring * 0.85);
}`,
  embers: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float n = fbm(uv * vec2(4.8, 2.8) + vec2(0.2, 1.1));
  float v = uv.y * 0.74 + n * 0.26;
  float front = mix(-0.02, 1.12, uP);
  float a = 1.0 - smoothstep(front - 0.16, front + 0.02, v);
  float live = 1.0 - smoothstep(0.86, 1.0, uP);
  float fringe = exp(-abs(v - front) * 18.0);
  vec2 cell = vec2(uv.x * (uRes.x / max(uRes.y, 1.0)) * 16.0, uv.y * 9.0);
  vec2 gv = fract(cell) - 0.5;
  float spark = step(0.84, hash(floor(cell))) * smoothstep(0.46, 0.02, length(gv));
  float band = smoothstep(front + 0.04, front - 0.22, v) * smoothstep(front - 0.62, front - 0.08, v);
  if (uPass < 0.5) gl_FragColor = vec4(1.0, 1.0, 1.0, a);
  else gl_FragColor = vec4(mix(uAmber, uGold, 0.4 + 0.4 * spark), (fringe * 0.55 + spark * band * 1.15) * live);
}`,
};

/** Full fragment shader for a WebGL reveal (preamble + body). */
export function titleRevealShader(id) {
  if (!GLSL[id]) throw new Error(`Unknown WebGL title reveal "${id}"`);
  return GLSL_PREAMBLE + GLSL[id];
}

/**
 * Page runtime. Registers a plate-clock hook that masks `.title[data-reveal]`
 * for the WebGL templates and drops the mask while the title is being edited.
 */
export function titleRevealRuntimeSource() {
  const shaders = Object.fromEntries(WEBGL_REVEALS.map((id) => [id, titleRevealShader(id)]));
  return `(() => {
  const SHADERS = ${JSON.stringify(shaders)};
  const fx = new WeakMap();
  const VS = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }';

  function seconds(el, name, fallback) {
    const v = parseFloat(getComputedStyle(el).getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
  }
  function ease(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return 1 - Math.pow(2, -10 * t);
  }
  function progress(el, ms) {
    const delay = seconds(el, '--t', 0.32) * 1000;
    const dur = Math.max(0.45, seconds(document.documentElement, '--motion-enter', 1.05)) * 1000;
    return ease((ms - delay) / dur);
  }
  function parseColor(input, fallback) {
    const s = String(input || '').trim();
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (hex) {
      let h = hex[1];
      if (h.length === 3) h = h.split('').map((c) => c + c).join('');
      const n = parseInt(h, 16);
      return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
    const rgb = /^rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)/i.exec(s);
    if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
    return fallback;
  }
  function brandColor(name, fallback) {
    return parseColor(getComputedStyle(document.documentElement).getPropertyValue(name), fallback);
  }
  function compile(canvas, id) {
    const gl = canvas.getContext('webgl', {
      alpha: true, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: true,
    });
    if (!gl) return null;
    const compileShader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn('[title-reveal]', gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = compileShader(gl.VERTEX_SHADER, VS);
    const fs = compileShader(gl.FRAGMENT_SHADER, SHADERS[id]);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[title-reveal]', gl.getProgramInfoLog(prog));
      return null;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    for (const n of ['uRes', 'uP', 'uGold', 'uAmber', 'uPass']) U[n] = gl.getUniformLocation(prog, n);
    return { gl, prog, U, canvas };
  }
  function release(el) {
    const state = fx.get(el);
    el.classList.remove('title-fx', 'title-fx-fallback');
    el.style.isolation = '';
    el.style.animation = '';
    el.style.opacity = '';
    if (el.dataset.fxPos) {
      el.style.position = '';
      delete el.dataset.fxPos;
    }
    for (const built of [state && state.maskGl, state && state.glowGl]) {
      const ext = built && built.gl && built.gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
    for (const prop of ['webkitMaskImage', 'maskImage', 'webkitMaskPosition', 'maskPosition', 'webkitMaskSize', 'maskSize', 'webkitMaskRepeat', 'maskRepeat', 'maskMode']) {
      el.style[prop] = '';
    }
    el.querySelectorAll('.title-mask, .title-glow').forEach((c) => c.remove());
    fx.delete(el);
  }
  function layer(className, css) {
    const c = document.createElement('canvas');
    c.className = className;
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = css;
    return c;
  }
  function textBox(el) {
    const nodes = [...el.childNodes].filter((n) => !(n.nodeType === 1 && (n.classList.contains('title-mask') || n.classList.contains('title-glow'))));
    const host = el.getBoundingClientRect();
    if (!nodes.length) return { left: 0, top: 0, width: host.width, height: host.height };
    const range = document.createRange();
    range.setStartBefore(nodes[0]);
    range.setEndAfter(nodes[nodes.length - 1]);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    if (!rects.length) return { left: 0, top: 0, width: host.width, height: host.height };
    const pad = 8;
    const left = Math.min(...rects.map((r) => r.left)) - host.left - pad;
    const top = Math.min(...rects.map((r) => r.top)) - host.top - pad;
    const right = Math.max(...rects.map((r) => r.right)) - host.left + pad;
    const bottom = Math.max(...rects.map((r) => r.bottom)) - host.top + pad;
    return { left, top, width: Math.max(2, right - left), height: Math.max(2, bottom - top) };
  }
  function ensure(el, id) {
    const prev = fx.get(el);
    if (prev && prev.id === id) return prev.failed ? null : prev;
    if (prev) release(el);
    const mask = layer('title-mask', 'position:absolute;left:0;top:0;width:2px;height:2px;opacity:0;visibility:hidden;pointer-events:none');
    const glow = layer('title-glow', 'position:absolute;pointer-events:none;display:block;mix-blend-mode:plus-lighter;z-index:2');
    el.classList.add('title-fx');
    if (getComputedStyle(el).position === 'static') {
      el.style.position = 'relative';
      el.dataset.fxPos = '1';
    }
    el.style.isolation = 'isolate';
    el.style.animation = 'none';
    el.style.opacity = '1';
    el.appendChild(glow);
    el.appendChild(mask);
    const maskGl = compile(mask, id);
    const glowGl = compile(glow, id);
    if (!maskGl || !glowGl) {
      el.classList.remove('title-fx');
      el.classList.add('title-fx-fallback');
      mask.remove();
      glow.remove();
      fx.set(el, { id, failed: true });
      return null;
    }
    const state = { id, mask, glow, maskGl, glowGl, failed: false };
    fx.set(el, state);
    return state;
  }
  function fit(canvas, el, place) {
    const box = textBox(el);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(box.width * dpr));
    const h = Math.max(2, Math.round(box.height * dpr));
    if (place) {
      canvas.style.left = box.left + 'px';
      canvas.style.top = box.top + 'px';
      canvas.style.width = box.width + 'px';
      canvas.style.height = box.height + 'px';
    }
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    return box;
  }
  function paint(built, p, pass, gold, amber) {
    const gl = built.gl;
    const canvas = built.canvas;
    gl.useProgram(built.prog);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(built.U.uRes, canvas.width, canvas.height);
    gl.uniform1f(built.U.uP, p);
    gl.uniform3fv(built.U.uGold, gold);
    gl.uniform3fv(built.U.uAmber, amber);
    gl.uniform1f(built.U.uPass, pass);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function applyMask(el, canvas, box) {
    const image = 'url("' + canvas.toDataURL() + '")';
    const pos = box.left + 'px ' + box.top + 'px';
    const size = box.width + 'px ' + box.height + 'px';
    el.style.webkitMaskImage = image;
    el.style.maskImage = image;
    el.style.webkitMaskPosition = pos;
    el.style.maskPosition = pos;
    el.style.webkitMaskSize = size;
    el.style.maskSize = size;
    el.style.webkitMaskRepeat = 'no-repeat';
    el.style.maskRepeat = 'no-repeat';
    el.style.maskMode = 'alpha';
  }
  function draw(state, el, ms) {
    const box = fit(state.mask, el, false);
    if (!box || !fit(state.glow, el, true)) return;
    const p = progress(el, ms);
    const gold = brandColor('--gold', [0.91, 0.72, 0.29]);
    const amber = brandColor('--amber', [1, 0.48, 0.2]);
    paint(state.maskGl, p, 0, gold, amber);
    const key = box.width + 'x' + box.height + '@' + Math.round(p * 800);
    if (state.maskKey !== key) {
      applyMask(el, state.mask, box);
      state.maskKey = key;
    }
    paint(state.glowGl, p, 1, gold, amber);
  }
  function clockMs() {
    const clock = document.querySelector('.plate-clock');
    const a = clock && clock.getAnimations()[0];
    return a && a.currentTime != null ? Number(a.currentTime) : 0;
  }
  function sync(ms) {
    const editing = document.body && document.body.classList.contains('studio-edit');
    const keep = new Set();
    document.querySelectorAll('.title[data-reveal]').forEach((el) => {
      const id = el.getAttribute('data-reveal');
      if (editing || !SHADERS[id]) {
        release(el);
        return;
      }
      keep.add(el);
      const state = ensure(el, id);
      if (state) draw(state, el, ms);
    });
    document.querySelectorAll('.title-fx, .title-fx-fallback').forEach((el) => {
      if (!keep.has(el)) release(el);
    });
  }
  function boot() {
    const rt = window.__plateRuntime;
    if (!rt || rt.syncTitles) return;
    rt.syncTitles = () => sync(clockMs());
    if (typeof rt.hook === 'function') rt.hook(sync);
    else sync(0);
    const root = document.body;
    if (root && typeof MutationObserver === 'function') {
      new MutationObserver(() => sync(clockMs())).observe(root, { attributes: true, attributeFilter: ['class'] });
    }
  }
  boot();
})();`;
}
