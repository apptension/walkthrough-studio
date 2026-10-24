/**
 * Per-section stage layouts: where the recording sits in the delivered frame for each stretch
 * between chapter marks, with an optional brand text panel beside it.
 *
 *   edit.layouts  [{ key, placement, size, text: { on, title?, body? } }]
 *
 * `key` is the chapter mark's `edit.cards` key (the section a chapter opens), or `lead` for the
 * recording before the first chapter. Sections without a row keep the video's camera default.
 *
 * One HTML template (templates/stage-backdrop.html) paints the backdrop, the window shadow and the
 * panel: the Studio stage shows it in an iframe and produce rasterises it to a PNG, so the editor
 * and the master come from the same pixels.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRAME_CORNERS } from './camera.mjs';
import { cardMarkKey } from './editDeck.mjs';
import { BT709_PARAMS, BT709_SCALE_OPTS, toBt709 } from './encode.mjs';
import { DELIVERY } from './format.mjs';
import { stageFor } from './stage.mjs';

const TEMPLATES = join(new URL('.', import.meta.url).pathname, '..', 'templates');

export const PLACEMENTS = Object.freeze(['fill', 'center', 'left', 'right', 'top', 'bottom']);
export const PLACEMENT_META = Object.freeze({
  fill: { label: 'Fill', hint: 'Edge to edge — the video default' },
  center: { label: 'Centre', hint: 'A window on the brand backdrop' },
  left: { label: 'Left', hint: 'Recording on the left, text on the right' },
  right: { label: 'Right', hint: 'Recording on the right, text on the left' },
  top: { label: 'Top', hint: 'Recording above, text below' },
  bottom: { label: 'Bottom', hint: 'Text above, recording below' },
});
export const SIZES = Object.freeze({ small: 0.74, medium: 0.86, large: 0.97 });
export const SIZE_IDS = Object.freeze(Object.keys(SIZES));
export const LEAD_KEY = 'lead';
export const TITLE_MAX = 80;
export const BODY_MAX = 240;

const even = (v) => Math.round(v / 2) * 2;
const floorEven = (v) => Math.floor(v / 2) * 2;
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** One layout row without its key, or null when nothing usable was given. */
export function normalizeLayout(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const placement = PLACEMENTS.includes(raw.placement) ? raw.placement : null;
  if (!placement) return null;
  const size = SIZE_IDS.includes(raw.size) ? raw.size : 'medium';
  const t = raw.text && typeof raw.text === 'object' ? raw.text : {};
  const text = { on: Boolean(t.on) };
  const title = clean(t.title, TITLE_MAX);
  const body = clean(t.body, BODY_MAX);
  if (title) text.title = title;
  if (body) text.body = body;
  return { placement, size, text };
}

/** `edit.layouts` as stored: one row per section key, unknown rows dropped. */
export function normalizeLayouts(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const key = String(raw?.key || '').trim();
    if (!key || key.length > 160 || seen.has(key)) continue;
    const layout = normalizeLayout(raw);
    if (!layout) continue;
    seen.add(key);
    out.push({ key, ...layout });
    if (out.length >= 80) break;
  }
  return out;
}

/**
 * Stage rect (output px) and text panel rect for a layout.
 * `fill` is the automatic placement (`stageFor`); every other placement keeps the recording inside
 * its region at the chosen size and leaves the rest of the frame to the panel.
 */
export function layoutStage(capture, output, layout, camera = {}) {
  if (!layout || layout.placement === 'fill') return { stage: stageFor(capture, output, camera), panel: null };
  const W = output.width;
  const H = output.height;
  const m = Math.round(Math.min(W, H) * 0.045);
  const p = layout.placement;
  let win;
  let panel = null;
  if (p === 'center') {
    win = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
  } else if (p === 'left' || p === 'right') {
    const ww = Math.round(W * 0.6);
    const pw = W - ww;
    // Both sides use the left window; `right` mirrors the result below.
    win = { x: m, y: m, w: ww - m, h: H - 2 * m };
    panel = p === 'left' ? { x: ww, y: m, w: pw - m, h: H - 2 * m, side: 'right' } : { x: m, y: m, w: pw - m, h: H - 2 * m, side: 'left' };
  } else {
    const wh = Math.round(H * 0.62);
    const ph = H - wh;
    win = p === 'top' ? { x: m, y: m, w: W - 2 * m, h: wh - m } : { x: m, y: ph, w: W - 2 * m, h: wh - m };
    panel = p === 'top' ? { x: m, y: wh, w: W - 2 * m, h: ph - m, side: 'bottom' } : { x: m, y: m, w: W - 2 * m, h: ph - m, side: 'top' };
  }
  const k = SIZES[layout.size] ?? SIZES.medium;
  const a = capture.width / capture.height;
  const w = even(Math.min(win.w * k, win.h * k * a));
  const h = even(w / a);
  const device = Boolean(capture.mobile) && a < 1;
  // Mirror placements share one x so left and right are exact reflections of each other.
  const x0 = floorEven(win.x + (win.w - w) / 2);
  const x = p === 'right' ? W - x0 - w : x0;
  return {
    stage: {
      mode: device ? 'device' : 'inset',
      x,
      y: floorEven(win.y + (win.h - h) / 2),
      w,
      h,
      radius: device ? Math.round(w * (capture.width < 600 ? 0.11 : 0.04)) : (FRAME_CORNERS[camera.corners] ?? FRAME_CORNERS.soft),
    },
    panel,
  };
}

const byT = (a, b) => (Number(a.t) || 0) - (Number(b.t) || 0);

/**
 * The recording cut into sections at its chapter marks (recording clock), each with its layout
 * row (or null for the video default) and the words the panel shows: the row's own copy, else the
 * chapter's title and the body of its card.
 */
export function layoutSections({ marks = [], liveDur = 0, layouts = [], cards = [], title = '' } = {}) {
  const chapters = (marks || []).filter((m) => m?.kind === 'chapter' && Number.isFinite(Number(m.t))).slice().sort(byT);
  const rows = new Map((layouts || []).map((l) => [l.key, l]));
  const bodies = new Map((cards || []).filter((c) => c?.markKey).map((c) => [c.markKey, String(c.body || '')]));
  const end = Number.isFinite(liveDur) && liveDur > 0 ? liveDur : (chapters[chapters.length - 1]?.t ?? 0) + 1;
  const out = [];
  const first = chapters[0];
  const hasLead = !first || Number(first.t) > 0.35;
  if (hasLead) out.push({ key: LEAD_KEY, from: 0, to: first ? Number(first.t) : end, no: 0, title: String(title || ''), body: '' });
  chapters.forEach((ch, i) => {
    const key = ch.key || cardMarkKey(ch);
    const next = chapters[i + 1];
    out.push({
      key,
      from: i === 0 && !hasLead ? 0 : Number(ch.t),
      to: next ? Number(next.t) : end,
      no: i + 1,
      title: String(ch.label || ''),
      body: bodies.get(key) || '',
    });
  });
  return out
    .filter((s) => s.to - s.from > 0.05)
    .map((s) => {
      const row = rows.get(s.key) || null;
      const layout = row ? { placement: row.placement, size: row.size, text: { ...row.text } } : null;
      return {
        key: s.key,
        from: s.from,
        to: s.to,
        no: s.no,
        custom: Boolean(row),
        layout,
        source: { title: s.title, body: s.body },
        copy: { title: layout?.text?.title ?? s.title, body: layout?.text?.body ?? s.body },
      };
    });
}

/** The section covering recording time `rec`, if any. */
export const sectionAt = (sections, rec) => (sections || []).find((s) => rec >= s.from - 1e-6 && rec < s.to) || null;

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fill = (tpl, tokens) => tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, k) => (tokens[k] == null ? '' : String(tokens[k])));

const hex6 = (c, fallback) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : fallback);
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** The frame's backdrop colours for a camera background, as camera.frameAssets picks them. */
export function backdropColors(brand, background = 'brand') {
  const c = brand?.colors || {};
  const ink = hex6(c.ink, '#0b1020');
  const surface = hex6(c.surface, ink);
  const accent = hex6(c.gold, '#7c5cff');
  const secondary = hex6(c.amber, accent);
  const [c0, c1] = background === 'accent' ? [accent, secondary] : background === 'ink' ? [ink, ink] : [surface, ink];
  const glow = background === 'ink' ? 0 : background === 'accent' ? 0.25 : 0.33;
  return { c0, c1, accent, glow: rgba(accent, glow), onAccent: background === 'accent' };
}

/** The HTML the stage shows and produce rasterises for one section. */
export function backdropHtml(brand, { output, stage, panel, copy = {}, no = 0, textOn = false, camera = {}, label = 'Stage' }) {
  const colors = backdropColors(brand, camera.background || 'brand');
  const c = brand?.colors || {};
  const text = colors.onAccent ? hex6(c.onAccent, '#111111') : hex6(c.text, '#f8fafc');
  const muted = colors.onAccent ? rgba(text, 0.72) : hex6(c.muted, '#94a3b8');
  const accent = colors.onAccent ? rgba(text, 0.78) : colors.accent;
  const shadow =
    camera.shadow === 'off' ? 'none' : camera.shadow === 'deep' ? '0 24px 88px rgba(0,0,0,.8)' : '0 18px 68px rgba(0,0,0,.62)';
  // Type scale follows the frame: 1 when the short side is the 1080p delivery height.
  const u = Math.min(output.width, output.height) / DELIVERY.height;
  const wide = panel && (panel.side === 'top' || panel.side === 'bottom');
  const pad = Math.round(40 * u);
  const panelHtml =
    textOn && panel
      ? `<div class="panel">${
          no > 0 ? `<p class="eyebrow"><i></i>${String(no).padStart(2, '0')}</p>` : ''
        }<h1 class="title">${esc(copy.title)}</h1>${copy.body ? `<p class="body">${esc(copy.body)}</p>` : ''}</div>`
      : '';
  const tpl = readFileSync(join(TEMPLATES, 'stage-backdrop.html'), 'utf8');
  return fill(tpl, {
    LABEL: esc(label),
    FONT_CSS: brand?.font?.css || '',
    FONT: brand?.font?.family || 'Inter',
    FRAME_W: output.width,
    FRAME_H: output.height,
    C0: colors.c0,
    C1: colors.c1,
    GLOW: colors.glow,
    WIN_X: stage.x,
    WIN_Y: stage.y,
    WIN_W: stage.w,
    WIN_H: stage.h,
    WIN_R: stage.radius,
    WIN_SHADOW: shadow,
    PANEL_X: panel?.x ?? 0,
    PANEL_Y: panel?.y ?? 0,
    PANEL_W: panel?.w ?? 0,
    PANEL_H: panel?.h ?? 0,
    PANEL_ALIGN: wide ? 'center' : 'flex-start',
    PANEL_TEXT_ALIGN: wide ? 'center' : 'left',
    PANEL_PAD: pad,
    TEXT: text,
    MUTED: muted,
    ACCENT: accent,
    EYEBROW_SIZE: Math.round((wide ? 14 : 15) * u),
    EYEBROW_GAP: Math.round(12 * u),
    EYEBROW_MB: Math.round(18 * u),
    EYEBROW_RULE: Math.round(28 * u),
    TITLE_SIZE: Math.round((wide ? 50 : 58) * u),
    TITLE_MAX: Math.round(wide ? Math.min((panel?.w ?? 0) - 2 * pad, 1100 * u) : (panel?.w ?? 0) - 2 * pad),
    BODY_SIZE: Math.round((wide ? 23 : 25) * u),
    BODY_MT: Math.round(18 * u),
    BODY_MAX: Math.round(wide ? Math.min((panel?.w ?? 0) - 2 * pad, 900 * u) : (panel?.w ?? 0) - 2 * pad),
    PANEL: panelHtml,
  });
}

/**
 * Resolve every section's geometry for a take and write the backdrop HTML of the ones that need a
 * backdrop (a window on the frame). Returns the sections with `stage`, `panel`, `html`, `htmlPath`
 * and `htmlUrl` attached. Cheap: files are rewritten only when their content changed.
 */
export function buildLayoutBackdrops(video, sections, { capture, output, camera = {} }) {
  const dir = join(video.out, 'layout');
  let made = false;
  // Backdrops exist only once a section leaves the video default. Until then the render keeps
  // the single camera frame, and the editor paints that with CSS.
  const anyCustom = sections.some((s) => s.custom);
  return sections.map((s) => {
    const geo = layoutStage(capture, output, s.layout, camera);
    const textOn = Boolean(s.layout?.text?.on && geo.panel);
    if (!anyCustom || geo.stage.mode === 'fill') return { ...s, stage: geo.stage, panel: geo.panel, textOn: false, html: null, htmlPath: null, htmlUrl: null };
    const html = backdropHtml(video.brand, {
      output,
      stage: geo.stage,
      panel: geo.panel,
      copy: s.copy,
      no: s.no,
      textOn,
      camera,
      label: `${video.slug} · ${s.copy.title || s.key}`,
    });
    const hash = createHash('sha1').update(html).digest('hex').slice(0, 12);
    const name = `${s.key.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 48)}-${hash}`;
    const htmlPath = join(dir, `${name}.html`);
    if (!existsSync(htmlPath)) {
      if (!made) {
        mkdirSync(dir, { recursive: true });
        made = true;
      }
      writeFileSync(htmlPath, html);
    }
    return { ...s, stage: geo.stage, panel: geo.panel, textOn, html, hash, htmlPath, htmlUrl: `/media/${video.slug}/layout/${name}.html` };
  });
}

/** The recording as `layoutStage` wants it, from a `videoSpace()` result. */
export const takeCapture = (space) => ({
  width: space.cssW,
  height: space.cssH,
  mobile: Boolean(space.take ? space.take.mobile : space.capture?.mobile),
});

/**
 * The bodies chapter cards would show, keyed by their mark, read from flow.mjs without rendering
 * any card HTML. Used so a section's panel can default to the chapter's own words.
 */
export async function chapterBodies(video, marks) {
  const flowPath = join(video.dir, 'flow.mjs');
  if (!existsSync(flowPath)) return [];
  const [{ parseFlowCalls }, { pairCallsToMarks }] = await Promise.all([import('./script.mjs'), import('./cardMarks.mjs')]);
  const calls = parseFlowCalls(readFileSync(flowPath, 'utf8'));
  const paired = pairCallsToMarks(calls, marks);
  return calls
    .filter((c) => c.kind === 'chapter' && paired.has(c.index))
    .map((c) => ({ markKey: paired.get(c.index).key || cardMarkKey(paired.get(c.index)), body: String(c.body || '') }));
}

/**
 * Every section of a take with its stage resolved and its backdrop HTML written: the one call the
 * Studio deck and produce both make, so they cannot disagree about where the recording sits.
 */
export async function videoLayout(video, { marks, liveDur, layouts, output, capture, camera }) {
  const cards = await chapterBodies(video, marks);
  const sections = layoutSections({ marks, liveDur, layouts, cards, title: video.config?.title || video.slug });
  const resolved = buildLayoutBackdrops(video, sections, { capture, output, camera });
  return { sections: resolved, custom: resolved.some((s) => s.custom), carried: [...carriedChapterKeys(resolved)] };
}

/**
 * Raster each section backdrop to a PNG the render can overlay. Files are named from the HTML's
 * content hash, so a changed title or placement writes a new picture and leaves the old one.
 */
export async function rasterLayoutPngs(sections, output) {
  const pending = [];
  for (const s of sections) {
    if (!s.htmlPath) continue;
    const png = s.htmlPath.replace(/\.html$/, '.png');
    s.bg = png;
    if (!existsSync(png)) pending.push({ html: s.htmlPath, png });
  }
  if (!pending.length) return sections;
  const [{ chromium }, { plateBrowserArgs }, { pathToFileURL }] = await Promise.all([
    import('playwright'),
    import('./plates.mjs'),
    import('node:url'),
  ]);
  const browser = await chromium.launch({ headless: true, args: plateBrowserArgs() });
  try {
    const page = await browser.newPage({ viewport: { width: output.width, height: output.height }, deviceScaleFactor: 1 });
    for (const job of pending) {
      await page.goto(pathToFileURL(job.html).href, { waitUntil: 'networkidle', timeout: 30000 });
      await page.evaluate(() => (document.fonts ? document.fonts.ready : null));
      await page.screenshot({ path: job.png, type: 'png' });
    }
  } finally {
    await browser.close();
  }
  return sections;
}

/** Chapter mark keys whose section carries its title as side text (the chapter card is not baked). */
export const carriedChapterKeys = (sections) => new Set((sections || []).filter((s) => s.textOn || (s.custom && s.layout?.text?.on)).map((s) => s.key));

/**
 * ffmpeg: trim `src` into one slice per section, place each on its backdrop (or scale it to the
 * frame) and concatenate them back on the recording's clock. Placed sections need `bg` and `mask`
 * PNGs (output-size backdrop, window-size alpha). Inputs are `-loop 1` stills, in section order.
 */
export function sectionStageGraph({ src, out, sections, startInputIndex, output, reel, fps }) {
  const inputs = [];
  const filter = [];
  const labels = [];
  let idx = startInputIndex;
  filter.push(`${src}split=${sections.length}${sections.map((_, i) => `[ls${i}]`).join('')}`);
  sections.forEach((s, i) => {
    const a = Math.round(s.from * fps);
    const b = Math.round(s.to * fps);
    const cut = `[ls${i}]trim=start_frame=${a}:end_frame=${b},setpts=PTS-STARTPTS`;
    const done = `[lst${i}]`;
    labels.push(done);
    if (s.stage.mode === 'fill' || !s.bg || !s.mask) {
      const atOutput = reel.width === output.width && reel.height === output.height;
      filter.push(`${cut},${atOutput ? `format=yuv420p,${BT709_PARAMS}` : toBt709(output.width, output.height)}${done}`);
      return;
    }
    const dur = ((b - a) / fps + 0.5).toFixed(3);
    const loop = ['-loop', '1', '-framerate', String(fps), '-t', dur, '-i'];
    inputs.push(...loop, s.bg, ...loop, s.mask);
    const bgIdx = idx;
    const maskIdx = idx + 1;
    idx += 2;
    const g = s.stage;
    filter.push(
      `${cut},scale=${g.w}:${g.h}:flags=lanczos+accurate_rnd+full_chroma_int:in_color_matrix=bt709:out_color_matrix=bt709:in_range=tv:out_range=tv,format=yuva420p[lsw${i}]`,
      `[${maskIdx}:v]format=gray[lsm${i}]`,
      `[lsw${i}][lsm${i}]alphamerge[lsa${i}]`,
      `[${bgIdx}:v]scale=${output.width}:${output.height}:${BT709_SCALE_OPTS},format=yuv420p,${BT709_PARAMS}[lsb${i}]`,
      `[lsb${i}][lsa${i}]overlay=x=${g.x}:y=${g.y}:format=auto:shortest=1,format=yuv420p,${BT709_PARAMS}${done}`,
    );
  });
  filter.push(`${labels.join('')}concat=n=${sections.length}:v=1:a=0,format=yuv420p,${BT709_PARAMS}${out}`);
  return { inputs, filter, inputCount: idx - startInputIndex };
}
