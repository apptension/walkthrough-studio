#!/usr/bin/env node
/**
 * Atmosphere lab previewer — candidate fields from kit/lib/atmosphereLab.mjs (plus every
 * field in production, for reference) rendered live over the real plate backdrop with
 * sample copy, so each one is judged the way a plate will show it.
 *
 * Usage: node scripts/atmosphere-lab.mjs [--open] [--out <file.html>]
 *
 * The page is self-contained (shaders + brand palettes inlined). Verdicts (accept / maybe /
 * reject) persist in localStorage; "Copy accepted" puts the accepted ids on the clipboard.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { ATMOSPHERES, fieldShaderSource } from '../kit/lib/atmosphere.mjs';
import { LAB_FIELDS, PROMOTED_FIELDS, labShaderSource } from '../kit/lib/atmosphereLab.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const OUT = resolve(opt('--out') || join(ROOT, 'kit', 'tmp', 'atmosphere-lab.html'));

/** Brand palettes: every pack under kit/brands plus the apptension.com site colours. */
function palettes() {
  const out = [];
  const dir = join(ROOT, 'kit', 'brands');
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, 'brand.json');
    if (!existsSync(file)) continue;
    try {
      const brand = JSON.parse(readFileSync(file, 'utf8'));
      const c = brand.colors || {};
      if (!c.ink || !c.gold) continue;
      out.push({
        id: name,
        label: brand.name || name,
        font: brand.font?.family || 'Inter',
        fontCss: brand.font?.css || '',
        colors: {
          ink: c.ink,
          surface: c.surface || c.ink,
          gold: c.gold,
          amber: c.amber || c.gold,
          teal: c.teal || c.gold,
          text: c.text || '#f4f6fa',
          muted: c.muted || '#8b94a7',
        },
      });
    } catch {
      /* skip unreadable pack */
    }
  }
  out.push({
    id: 'apptension-com',
    label: 'apptension.com (yellow → green)',
    font: 'Inter',
    fontCss: '',
    colors: { ink: '#0a0a0b', surface: '#141416', gold: '#f5d647', amber: '#d9b43a', teal: '#42f273', text: '#f4f4f2', muted: '#8d8f94' },
  });
  // The Studio pack first: it is the showcase brand.
  out.sort((a, b) => (a.id.startsWith('apptension-walkthrough') ? -1 : b.id.startsWith('apptension-walkthrough') ? 1 : 0));
  return out;
}

const promoted = new Set(PROMOTED_FIELDS.map((f) => f.id));
const candidates = LAB_FIELDS.filter((f) => !promoted.has(f.id)).map((f) => ({
  id: f.id,
  label: f.label,
  hint: f.hint,
  vibe: f.vibe,
  opacity: f.opacity,
  src: labShaderSource(f.id),
}));
const production = Object.entries(ATMOSPHERES)
  .filter(([id]) => id !== 'none')
  .map(([id, a]) => ({ id, label: a.label, hint: a.hint, vibe: 'production', opacity: a.opacity, src: fieldShaderSource(id) }));

const data = { candidates, production, palettes: palettes(), generatedAt: new Date().toISOString() };
const fontLinks = [...new Set(data.palettes.map((p) => p.fontCss).filter(Boolean))]
  .map((href) => `<link rel="stylesheet" href="${href}" />`)
  .join('\n    ');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Atmosphere lab · ${candidates.length} candidates</title>
    ${fontLinks}
    <style>
      :root {
        --ui-bg: #0b0c0f; --ui-panel: #13151a; --ui-line: #23262e; --ui-text: #e8eaf0; --ui-muted: #8a90a0;
        --ok: #3dd68c; --maybe: #f2b23d; --no: #ff5c6c;
        --ink: #0e0f12; --surface: #15171c; --gold: #4da3ff; --amber: #2b7de9; --teal: #3dd68c; --text: #f2f4f8; --muted: #7d8698;
        --plate-font: 'Plus Jakarta Sans', Inter, system-ui, sans-serif;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; background: var(--ui-bg); color: var(--ui-text); font: 14px/1.45 Inter, system-ui, -apple-system, sans-serif; }
      header { position: sticky; top: 0; z-index: 20; display: flex; flex-wrap: wrap; gap: 14px 22px; align-items: center; padding: 14px 24px; background: color-mix(in srgb, var(--ui-bg) 88%, transparent); backdrop-filter: blur(14px); border-bottom: 1px solid var(--ui-line); }
      header h1 { font-size: 15px; font-weight: 600; margin: 0 14px 0 0; letter-spacing: 0.01em; }
      header h1 small { color: var(--ui-muted); font-weight: 400; margin-left: 8px; }
      .ctl { display: flex; align-items: center; gap: 8px; color: var(--ui-muted); font-size: 12px; }
      .ctl select, .ctl button { font: inherit; color: var(--ui-text); background: var(--ui-panel); border: 1px solid var(--ui-line); border-radius: 8px; padding: 6px 10px; }
      .ctl button { cursor: pointer; }
      .ctl button:hover { border-color: #3a3f4c; }
      .ctl input[type=range] { width: 120px; accent-color: var(--ok); }
      .ctl output { min-width: 34px; color: var(--ui-text); font-variant-numeric: tabular-nums; }
      .tally { margin-left: auto; display: flex; gap: 14px; font-size: 12px; color: var(--ui-muted); }
      .tally b { color: var(--ui-text); font-weight: 600; }
      .tally .ok b { color: var(--ok); } .tally .maybe b { color: var(--maybe); } .tally .no b { color: var(--no); }
      main { padding: 10px 24px 80px; }
      section { margin-top: 26px; }
      section > h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ui-muted); font-weight: 600; margin: 0 0 12px; display: flex; align-items: baseline; gap: 10px; }
      section > h2 span { text-transform: none; letter-spacing: 0; font-weight: 400; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(440px, 1fr)); gap: 18px; }
      .tile { background: var(--ui-panel); border: 1px solid var(--ui-line); border-radius: 14px; overflow: hidden; transition: border-color 0.2s, opacity 0.2s; }
      .tile[data-verdict=accept] { border-color: color-mix(in srgb, var(--ok) 55%, var(--ui-line)); }
      .tile[data-verdict=maybe] { border-color: color-mix(in srgb, var(--maybe) 55%, var(--ui-line)); }
      .tile[data-verdict=reject] { border-color: color-mix(in srgb, var(--no) 45%, var(--ui-line)); opacity: 0.55; }
      .tile[data-verdict=reject]:hover { opacity: 1; }
      body[data-filter=accept] .tile:not([data-verdict=accept]), body[data-filter=maybe] .tile:not([data-verdict=maybe]), body[data-filter=open] .tile[data-verdict] { display: none; }
      /* ——— the plate stage: mirrors kit/templates/plates.css (.stage:has(.plate-field)) ——— */
      .stage { position: relative; aspect-ratio: 16 / 9; overflow: hidden; background: var(--ink); container-type: size; cursor: zoom-in; font-family: var(--plate-font); }
      .stage .bg { position: absolute; inset: -10%; background: radial-gradient(ellipse 95% 80% at 50% 48%, color-mix(in srgb, var(--surface) 70%, var(--ink)) 0%, color-mix(in srgb, var(--surface) 25%, var(--ink)) 55%, var(--ink) 100%); }
      .stage .blob { position: absolute; border-radius: 50%; filter: blur(5.7cqw); }
      .stage .blob.warm { width: 39.6cqw; height: 29.2cqw; left: 8%; top: 52%; background: color-mix(in srgb, var(--amber) 12%, transparent); }
      .stage .blob.cool { width: 35.4cqw; height: 27cqw; right: 4%; top: -6%; background: color-mix(in srgb, var(--teal) 6%, transparent); }
      .stage canvas.field { position: absolute; inset: 0; width: 100%; height: 100%; }
      .stage .bloom { position: absolute; left: 50%; top: 50%; width: 73cqw; height: 37.5cqw; margin: -18.75cqw 0 0 -36.5cqw; filter: blur(2.5cqw); opacity: 0.55; background: radial-gradient(ellipse 70% 55% at 50% 50%, color-mix(in srgb, var(--gold) 7%, transparent), transparent 78%); pointer-events: none; }
      .stage .vignette { position: absolute; inset: 0; background: radial-gradient(ellipse 80% 70% at 50% 50%, transparent 55%, color-mix(in srgb, var(--ink) 75%, transparent) 100%); pointer-events: none; }
      .stage .grain { position: absolute; inset: 0; opacity: 0.07; pointer-events: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
      .stage .copy { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: var(--text); pointer-events: none; padding: 0 10%; }
      body[data-copy=off] .stage .copy { display: none; }
      .stage .eyebrow { font-size: 1.25cqw; letter-spacing: 0.22em; text-transform: uppercase; color: var(--gold); font-weight: 600; margin-bottom: 1.6cqw; }
      .stage .title { font-size: 4.6cqw; line-height: 1.08; font-weight: 700; letter-spacing: -0.02em; max-width: 70%; text-wrap: balance; }
      .stage .title em { font-style: normal; background: linear-gradient(90deg, var(--gold), var(--teal)); -webkit-background-clip: text; background-clip: text; color: transparent; }
      .stage .sub { margin-top: 1.8cqw; font-size: 1.55cqw; color: var(--muted); }
      .stage .err { position: absolute; left: 10px; right: 10px; bottom: 10px; font: 11px/1.4 ui-monospace, monospace; color: #ffb3bb; background: rgba(60, 0, 8, 0.85); border: 1px solid var(--no); border-radius: 8px; padding: 8px 10px; white-space: pre-wrap; max-height: 45%; overflow: auto; }
      .meta { display: flex; align-items: center; gap: 10px; padding: 10px 12px 10px 14px; }
      .meta .name { font-weight: 600; font-size: 13px; }
      .meta .name code { font: 11px ui-monospace, monospace; color: var(--ui-muted); margin-left: 6px; }
      .meta .hint { color: var(--ui-muted); font-size: 12px; flex: 1; min-width: 0; }
      .verdict { display: flex; gap: 4px; }
      .verdict button { font: 600 11px/1 Inter, system-ui, sans-serif; letter-spacing: 0.02em; border: 1px solid var(--ui-line); background: transparent; color: var(--ui-muted); border-radius: 999px; padding: 6px 10px; cursor: pointer; }
      .verdict button:hover { color: var(--ui-text); border-color: #3a3f4c; }
      .verdict button[data-v=accept].on { background: var(--ok); border-color: var(--ok); color: #06251a; }
      .verdict button[data-v=maybe].on { background: var(--maybe); border-color: var(--maybe); color: #2a1d02; }
      .verdict button[data-v=reject].on { background: var(--no); border-color: var(--no); color: #2b040a; }
      /* ——— focus view ——— */
      #focus { position: fixed; inset: 0; z-index: 50; display: none; background: rgba(5, 6, 8, 0.92); backdrop-filter: blur(8px); }
      #focus.open { display: grid; grid-template-rows: 1fr auto; }
      #focus .stage { cursor: default; width: min(94vw, calc((100vh - 110px) * 16 / 9)); margin: 24px auto 0; border-radius: 12px; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6); }
      #focus .bar { display: flex; align-items: center; gap: 16px; padding: 14px 24px 22px; width: min(94vw, calc((100vh - 110px) * 16 / 9)); margin: 0 auto; }
      #focus .bar .name { font-weight: 600; font-size: 15px; }
      #focus .bar .hint { color: var(--ui-muted); flex: 1; }
      #focus .bar .keys { color: var(--ui-muted); font-size: 11px; }
      #focus .bar .keys kbd { font: 11px ui-monospace, monospace; border: 1px solid var(--ui-line); border-radius: 4px; padding: 1px 5px; margin: 0 2px; }
      .toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%) translateY(20px); opacity: 0; background: var(--ui-text); color: #0b0c0f; padding: 10px 16px; border-radius: 10px; font-weight: 600; font-size: 13px; transition: 0.25s; pointer-events: none; z-index: 60; }
      .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    </style>
  </head>
  <body data-copy="on" data-filter="all">
    <header>
      <h1>Atmosphere lab <small>${candidates.length} candidates · generated ${new Date().toLocaleString('en-GB')}</small></h1>
      <label class="ctl">Brand <select id="palette"></select></label>
      <label class="ctl">Speed <input id="speed" type="range" min="0.3" max="2.5" step="0.1" value="1" /><output id="speedOut">1.0×</output></label>
      <label class="ctl">Presence <input id="presence" type="range" min="0.4" max="2" step="0.05" value="1" /><output id="presenceOut">1.00×</output></label>
      <label class="ctl">Show <select id="filter"><option value="all">everything</option><option value="open">undecided</option><option value="accept">accepted</option><option value="maybe">maybe</option></select></label>
      <span class="ctl"><button id="copyToggle" type="button">Hide copy</button><button id="copyAccepted" type="button">Copy accepted ids</button><button id="copyReport" type="button">Copy report</button><button id="resetVerdicts" type="button">Reset</button></span>
      <div class="tally"><span class="ok"><b id="nAccept">0</b> accepted</span><span class="maybe"><b id="nMaybe">0</b> maybe</span><span class="no"><b id="nReject">0</b> rejected</span><span><b id="nOpen">0</b> undecided</span></div>
    </header>
    <main id="main"></main>
    <div id="focus" aria-modal="true" role="dialog"></div>
    <div class="toast" id="toast"></div>
    <script id="lab-data" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
    <script>
(() => {
  const DATA = JSON.parse(document.getElementById('lab-data').textContent);
  const VIBES = [
    ['apptension.com', 'Ports of the apptension.com shaders'],
    ['lines', 'Line work'],
    ['structure', 'Structure'],
    ['organic', 'Organic'],
    ['motion', 'Motion'],
    ['light', 'Light'],
  ];
  const STORE = 'atmosphere-lab-verdicts';
  const verdicts = JSON.parse(localStorage.getItem(STORE) || '{}');
  const saveVerdicts = () => localStorage.setItem(STORE, JSON.stringify(verdicts));
  const $ = (id) => document.getElementById(id);
  const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1600); };

  const SAMPLE = { eyebrow: 'At a glance', title: 'Plan the <em>week</em> before it starts', sub: 'Brand plates · live capture · one client-ready master' };
  const hexTo01 = (hex) => { const h = hex.replace('#', ''); const f = h.length === 3 ? [...h].map((c) => c + c).join('') : h; const n = parseInt(f.slice(0, 6), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

  /* ——— one WebGL context, blitted into every tile ——— */
  const TILE_W = 640, TILE_H = 360, FOCUS_W = 1600, FOCUS_H = 900;
  const glCanvas = document.createElement('canvas');
  glCanvas.width = TILE_W; glCanvas.height = TILE_H;
  const gl = glCanvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: true });
  if (!gl) { document.body.innerHTML = '<p style="padding:40px">WebGL is unavailable in this browser.</p>'; return; }
  gl.getExtension('OES_standard_derivatives');
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  const VS = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }';
  const UNIFORMS = ['uRes', 'uTime', 'uGold', 'uAmber', 'uTeal', 'uInk', 'uSurface', 'uOpacity', 'uDrift', 'uEnv'];
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(log || 'compile failed'); }
    return s;
  }
  const programs = new Map();
  function program(field) {
    if (programs.has(field.id)) return programs.get(field.id);
    let entry;
    try {
      const vs = compile(gl.VERTEX_SHADER, VS);
      const fs = compile(gl.FRAGMENT_SHADER, field.src);
      const prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link failed');
      const loc = gl.getAttribLocation(prog, 'a');
      const U = {}; for (const n of UNIFORMS) U[n] = gl.getUniformLocation(prog, n);
      entry = { prog, loc, U };
    } catch (err) {
      entry = { error: String(err.message || err) };
    }
    programs.set(field.id, entry);
    return entry;
  }

  const state = { speed: 1, presence: 1, palette: DATA.palettes[0], t0: performance.now(), focus: null };
  const colors = () => { const c = state.palette.colors; return { gold: hexTo01(c.gold), amber: hexTo01(c.amber), teal: hexTo01(c.teal), ink: hexTo01(c.ink), surface: hexTo01(c.surface) }; };
  let col = colors();

  function draw(field, target, w, h, timeSec) {
    const e = program(field);
    if (e.error) return e.error;
    if (glCanvas.width !== w || glCanvas.height !== h) { glCanvas.width = w; glCanvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(e.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(e.loc);
    gl.vertexAttribPointer(e.loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(e.U.uRes, w, h);
    gl.uniform1f(e.U.uTime, timeSec);
    gl.uniform3fv(e.U.uGold, col.gold); gl.uniform3fv(e.U.uAmber, col.amber); gl.uniform3fv(e.U.uTeal, col.teal);
    gl.uniform3fv(e.U.uInk, col.ink); gl.uniform3fv(e.U.uSurface, col.surface);
    gl.uniform1f(e.U.uOpacity, Math.min(1, field.opacity * state.presence));
    gl.uniform1f(e.U.uDrift, 1.0);
    gl.uniform1f(e.U.uEnv, 1.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const ctx = target.getContext('2d');
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(glCanvas, 0, 0, target.width, target.height);
    return null;
  }

  /* ——— DOM ——— */
  const stageHtml = (field) => \`
    <div class="stage" data-id="\${field.id}">
      <div class="bg"></div>
      <canvas class="field" width="\${TILE_W}" height="\${TILE_H}"></canvas>
      <div class="blob warm"></div><div class="blob cool"></div>
      <div class="bloom"></div>
      <div class="copy"><div class="eyebrow">\${SAMPLE.eyebrow}</div><div class="title">\${SAMPLE.title}</div><div class="sub">\${SAMPLE.sub}</div></div>
      <div class="vignette"></div><div class="grain"></div>
    </div>\`;
  const verdictHtml = (id) => \`<div class="verdict" data-id="\${id}"><button type="button" data-v="accept">✓ Accept</button><button type="button" data-v="maybe">~ Maybe</button><button type="button" data-v="reject">✕ Reject</button></div>\`;
  const tileHtml = (field) => \`
    <article class="tile" data-id="\${field.id}" data-verdict="\${verdicts[field.id] || ''}">
      \${stageHtml(field)}
      <div class="meta"><div><div class="name">\${field.label}<code>\${field.id}</code></div><div class="hint">\${field.hint}</div></div><span style="flex:1"></span>\${field.vibe === 'production' ? '<span class="hint">in production</span>' : verdictHtml(field.id)}</div>
    </article>\`;

  const all = [...DATA.candidates, ...DATA.production];
  const byId = Object.fromEntries(all.map((f) => [f.id, f]));
  const main = $('main');
  let html = '';
  for (const [vibe, title] of VIBES) {
    const list = DATA.candidates.filter((f) => f.vibe === vibe);
    if (!list.length) continue;
    html += \`<section><h2>\${title} <span>· \${list.length}</span></h2><div class="grid">\${list.map(tileHtml).join('')}</div></section>\`;
  }
  html += \`<section><h2>In production today <span>· for reference, not up for a verdict</span></h2><div class="grid">\${DATA.production.map(tileHtml).join('')}</div></section>\`;
  main.innerHTML = html;

  const tiles = [...main.querySelectorAll('.tile')].map((el) => ({ el, id: el.dataset.id, field: byId[el.dataset.id], canvas: el.querySelector('canvas.field'), stage: el.querySelector('.stage'), visible: false, errored: false }));
  const io = new IntersectionObserver((entries) => { for (const en of entries) { const t = tiles.find((x) => x.el === en.target); if (t) t.visible = en.isIntersecting; } }, { rootMargin: '200px' });
  for (const t of tiles) io.observe(t.el);

  function showError(stage, msg) {
    if (stage.querySelector('.err')) return;
    const d = document.createElement('div'); d.className = 'err'; d.textContent = msg; stage.appendChild(d);
  }

  /* ——— palette ——— */
  const paletteSel = $('palette');
  for (const p of DATA.palettes) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.label; paletteSel.appendChild(o); }
  function applyPalette(id) {
    state.palette = DATA.palettes.find((p) => p.id === id) || DATA.palettes[0];
    paletteSel.value = state.palette.id;
    const r = document.documentElement.style; const c = state.palette.colors;
    for (const k of ['ink', 'surface', 'gold', 'amber', 'teal', 'text', 'muted']) r.setProperty('--' + k, c[k]);
    r.setProperty('--plate-font', "'" + state.palette.font + "', Inter, system-ui, sans-serif");
    col = colors();
    localStorage.setItem('atmosphere-lab-palette', state.palette.id);
  }
  applyPalette(localStorage.getItem('atmosphere-lab-palette') || DATA.palettes[0].id);
  paletteSel.addEventListener('change', () => applyPalette(paletteSel.value));

  /* ——— controls ——— */
  $('speed').addEventListener('input', (e) => { state.speed = Number(e.target.value); $('speedOut').textContent = state.speed.toFixed(1) + '×'; });
  $('presence').addEventListener('input', (e) => { state.presence = Number(e.target.value); $('presenceOut').textContent = state.presence.toFixed(2) + '×'; });
  $('filter').addEventListener('change', (e) => { document.body.dataset.filter = e.target.value; });
  $('copyToggle').addEventListener('click', (e) => { const off = document.body.dataset.copy === 'on'; document.body.dataset.copy = off ? 'off' : 'on'; e.target.textContent = off ? 'Show copy' : 'Hide copy'; });
  $('resetVerdicts').addEventListener('click', () => { if (!confirm('Clear every verdict?')) return; for (const k of Object.keys(verdicts)) delete verdicts[k]; saveVerdicts(); syncVerdicts(); });
  const copyText = async (text, msg) => { try { await navigator.clipboard.writeText(text); toast(msg); } catch { prompt('Copy:', text); } };
  $('copyAccepted').addEventListener('click', () => { const ids = DATA.candidates.filter((f) => verdicts[f.id] === 'accept').map((f) => f.id); copyText(JSON.stringify(ids), ids.length + ' accepted id(s) copied'); });
  $('copyReport').addEventListener('click', () => {
    const report = { palette: state.palette.id, accept: [], maybe: [], reject: [], undecided: [] };
    for (const f of DATA.candidates) (report[verdicts[f.id] || 'undecided']).push(f.id);
    copyText(JSON.stringify(report, null, 2), 'Report copied');
  });

  function setVerdict(id, v) {
    if (!byId[id] || byId[id].vibe === 'production') return;
    if (verdicts[id] === v) delete verdicts[id]; else verdicts[id] = v;
    saveVerdicts(); syncVerdicts();
  }
  function syncVerdicts() {
    const n = { accept: 0, maybe: 0, reject: 0, open: 0 };
    for (const f of DATA.candidates) n[verdicts[f.id] || 'open'] += 1;
    $('nAccept').textContent = n.accept; $('nMaybe').textContent = n.maybe; $('nReject').textContent = n.reject; $('nOpen').textContent = n.open;
    for (const t of tiles) t.el.dataset.verdict = verdicts[t.id] || '';
    for (const wrap of document.querySelectorAll('.verdict')) {
      const v = verdicts[wrap.dataset.id];
      for (const b of wrap.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === v);
    }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.verdict button');
    if (b) { setVerdict(b.closest('.verdict').dataset.id, b.dataset.v); return; }
    const stage = e.target.closest('main .stage');
    if (stage) openFocus(stage.dataset.id);
  });
  syncVerdicts();

  /* ——— focus view ——— */
  const focus = $('focus');
  let focusCanvas = null;
  function openFocus(id) {
    const field = byId[id]; if (!field) return;
    state.focus = id;
    focus.innerHTML = stageHtml(field) + \`<div class="bar"><div class="name">\${field.label} <code style="color:var(--ui-muted);font:12px ui-monospace,monospace">\${field.id}</code></div><div class="hint">\${field.hint}</div>\${field.vibe === 'production' ? '' : verdictHtml(field.id)}<div class="keys"><kbd>A</kbd>accept <kbd>M</kbd>maybe <kbd>R</kbd>reject <kbd>←</kbd><kbd>→</kbd>next <kbd>Esc</kbd>close</div></div>\`;
    focusCanvas = focus.querySelector('canvas.field'); focusCanvas.width = FOCUS_W; focusCanvas.height = FOCUS_H;
    focus.classList.add('open');
    syncVerdicts();
  }
  function closeFocus() { state.focus = null; focus.classList.remove('open'); focus.innerHTML = ''; focusCanvas = null; }
  focus.addEventListener('click', (e) => { if (e.target === focus) closeFocus(); });
  document.addEventListener('keydown', (e) => {
    if (!state.focus) return;
    const order = all.map((f) => f.id); const i = order.indexOf(state.focus);
    if (e.key === 'Escape') closeFocus();
    else if (e.key === 'ArrowRight') openFocus(order[(i + 1) % order.length]);
    else if (e.key === 'ArrowLeft') openFocus(order[(i - 1 + order.length) % order.length]);
    else if (e.key === 'a' || e.key === 'A') setVerdict(state.focus, 'accept');
    else if (e.key === 'm' || e.key === 'M') setVerdict(state.focus, 'maybe');
    else if (e.key === 'r' || e.key === 'R') setVerdict(state.focus, 'reject');
  });

  /* ——— loop ——— */
  let simTime = 0, last = performance.now();
  function frame(now) {
    simTime += ((now - last) / 1000) * state.speed; last = now;
    if (state.focus && focusCanvas) {
      const field = byId[state.focus];
      const err = draw(field, focusCanvas, FOCUS_W, FOCUS_H, simTime);
      if (err) showError(focus.querySelector('.stage'), err);
    } else {
      for (const t of tiles) {
        if (!t.visible || t.errored) continue;
        const err = draw(t.field, t.canvas, TILE_W, TILE_H, simTime);
        if (err) { t.errored = true; showError(t.stage, err); }
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__lab = { tiles, programs, verdicts, draw, byId };
})();
    </script>
  </body>
</html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`atmosphere lab · ${candidates.length} candidates + ${production.length} production fields → ${OUT}`);
if (flag('--open')) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [OUT], { stdio: 'ignore', detached: true }).unref();
}
