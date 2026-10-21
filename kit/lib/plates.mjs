/**
 * Brand plates: open, close, and interstitials.
 * Types: features | stats | callout | testimonials | logos | journey | compare | quote | metric | orbit
 * Deterministic frame render — CSS animations paused and stepped;
 * JPEG @2x (q95) → Full HD x264 CRF 4. Plates are intermediates (the master re-encodes them),
 * so they stay near-lossless and the delivery encode is the one lossy generation; they stay
 * High-profile 4:2:0 because Studio plays them in the browser.
 * Bump RENDER_PIPELINE when changing capture/encode defaults.
 */
import { chromium } from 'playwright';
import { cpus } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DELIVERY } from './format.mjs';
import { FPS } from './motion.mjs';
import { motionCssVars, resolveMotion, withMotion } from './plateMotion.mjs';
import { KIT, TEMPLATES, brandReadiness, isStale } from './project.mjs';
import { logoTileTone } from './logoTone.mjs';
import { injectAtmosphere } from './atmosphere.mjs';
import { assertX264Args, BT709_TAGS, lossyX264, plateJpegQ, QUALITY, toBt709 } from './encode.mjs';
import { brandCssVars, emphasize, esc } from './text.mjs';
import { injectStyle, patchStyle } from './editDeck.mjs';

/** Attribute-safe raw source for Studio inline edit (newlines → &#10;). */
const escAttr = (s) => esc(s).replace(/\n/g, '&#10;');

/** Title fill keys: rendered HTML + raw source for contenteditable round-trip. */
function titleEditFields(title, { asLines = false, reveal = 'rise' } = {}) {
  if (asLines) {
    const lines = (Array.isArray(title) ? title : [title || '']).filter((l) => l != null && String(l).length);
    return {
      TITLE_KIND: 'lines',
      TITLE_RAW: escAttr(lines.join('\n')),
    };
  }
  const raw = Array.isArray(title) ? title.join(' ') : String(title ?? '');
  return {
    TITLE: reveal === 'cascade' ? cascadeChars(raw).html : emphasize(raw),
    TITLE_KIND: 'text',
    TITLE_RAW: escAttr(raw),
  };
}

/**
 * Per-character markup for the `cascade` title reveal. Emphasis survives per character so the
 * accent gradient still paints the marked word. `--c` is the character index (stagger).
 */
function cascadeChars(line, { from = 0 } = {}) {
  const s = String(line ?? '');
  // Words stay unbreakable (`.cw`), separated by real spaces so the line wraps like plain text.
  const words = [];
  let word = '';
  let c = from;
  let inEm = false;
  const flush = () => {
    if (word) words.push(`<span class="cw">${word}</span>`);
    word = '';
  };
  for (const ch of s) {
    if (ch === '*') {
      inEm = !inEm;
      continue;
    }
    if (/\s/.test(ch)) {
      flush();
      c += 1;
      continue;
    }
    word += `<span class="char${inEm ? ' accent' : ''}" style="--c: ${c}">${esc(ch)}</span>`;
    c += 1;
  }
  flush();
  return { html: words.join(' '), next: c };
}

/** Bump when capture/encode/QC defaults change so content-hash cache rebuilds. */
const RENDER_PIPELINE = 15;
/**
 * Encoded plates drop the template's `.black` in/out: produce owns every join (xfade through
 * the plate's own brand background, head/tail fades on the master). HTML previews keep it.
 */
const RENDER_CSS = '.grain{animation:none!important}.black{display:none!important}';
/** Outside hold, this many identical consecutive frames = stuck capture (fail). */
const MAX_STUCK_FRAMES = Math.max(6, Math.round(FPS / 4));
/** Hold must survive animation+pixel probes or it is disabled. */
const HOLD_PROBE_STEP_SEC = 0.1;
const HOLD_MIN_SEC = 0.25;
/**
 * Chromium JPEG quality for plate frames. 95 keeps the plate grain; 100 costs ~35% more
 * render time (bigger CDP transfers) for no visible gain after the delivery encode.
 * Capture uses deviceScaleFactor 2 + screenshot scale:'css' — rasterize @2× for
 * crisp type, emit 1920×1080 JPEGs (same idea as Retina compositor downsample).
 * Measured ~15× faster than piping 4K PNG/JPEG into ffmpeg.
 */
const JPEG_Q = plateJpegQ();
/** Parallel plate encodes — leave headroom for concurrent ffmpeg procs. */
const PLATE_CONCURRENCY = Math.max(
  2,
  Math.min(4, Number(process.env.WALKTHROUGH_PLATE_JOBS) || Math.max(2, (cpus()?.length || 4) - 2))
);

const writeIfChanged = (path, content) => {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return false;
  writeFileSync(path, content);
  return true;
};

/**
 * Write plate HTML with the brand atmosphere + plate runtime injected and the editor's style
 * variables appended last so they win the cascade — templates stay pristine.
 */
const writePlateHtml = (path, html, brand, style) => writeIfChanged(path, injectStyle(injectAtmosphere(html, brand), style));

/** Validated per-plate CSS variables from video.config (open.style / close.style / interstitials[].style). */
function plateStyle(it, plateId) {
  if (!it?.style || typeof it.style !== 'object') return undefined;
  return patchStyle({}, it.style, plateId);
}

const contentHash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

const PLATE_TYPES = new Set([
  'features',
  'stats',
  'callout',
  'testimonials',
  'logos',
  'journey',
  'compare',
  'quote',
  'metric',
  'orbit',
]);
export const INTERSTITIAL_TYPES = Object.freeze([...PLATE_TYPES]);

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
};

/** Compact inline icons for feature / journey cards (stroke inherits currentColor). */
const ICONS = {
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="3"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a3 3 0 0 1 0 5.74"/></svg>`,
  leave: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3c-2.5 3-4 5.5-4 8a4 4 0 0 0 8 0c0-2.5-1.5-5-4-8z"/><path d="M8 20h8M10 20v1M14 20v1"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19V5M4 19h16"/><path d="M8 16v-5M12 16V8M16 16v-3"/></svg>`,
  spark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8L12 3z"/></svg>`,
  filter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16l-6 7v5l-4 2v-7L4 5z"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M4.9 6.5l1.4 1.4M17.7 16.1l1.4 1.4M3 12h2M19 12h2M4.9 17.5l1.4-1.4M17.7 7.9l1.4-1.4"/></svg>`,
  plug: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 7V3M15 7V3M8 7h8v4a4 4 0 0 1-4 4h0a4 4 0 0 1-4-4V7z"/><path d="M12 15v6"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M8 12l2.5 2.5L16 9"/></svg>`,
  dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/></svg>`,
  export: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>`,
};

const fill = (tpl, values) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');

/**
 * Per-interstitial motion override (video.config → interstitials[].motion).
 * Merges onto brand motion so one plate can run punchy, flat or with its own title reveal
 * without changing the pack. Returns the fill values plus the resolved motion for builders.
 */
function interstitialBrandVars(common, brand, it) {
  const overlay = it?.motion && typeof it.motion === 'object' ? it.motion : {};
  // Layout flags stay on the interstitial; only timing/energy tokens merge into brand motion.
  const { cascade: _cascade, carousel: _carousel, ...motionOverlay } = overlay;
  const merged = withMotion(brand, motionOverlay);
  const motion = resolveMotion(merged);
  return {
    ...common,
    BRAND_VARS: `${brandCssVars(brand)}\n      ${motionCssVars(merged)}`,
    TITLE_REVEAL: motion.titleReveal,
    motion,
    /** Brand with the plate's motion overlay applied — pass to writePlateHtml so the atmosphere follows it. */
    plateBrand: merged,
  };
}

const titleLines = (lines, start, step) =>
  (Array.isArray(lines) ? lines : [lines])
    .map(
      (line, i) =>
        `<span class="mask"><span class="rise" style="--t: ${(start + i * step).toFixed(2)}s">${emphasize(line)}</span></span>`
    )
    .join('\n        ');

/** Split a title line into words while keeping `*emphasis*` tokens intact. */
function splitWordsPreservingEmphasis(line) {
  const s = String(line ?? '');
  const tokens = [];
  let buf = '';
  let inEm = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '*') {
      buf += c;
      inEm = !inEm;
      continue;
    }
    if (!inEm && /\s/.test(c)) {
      if (buf) tokens.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf) tokens.push(buf);
  return tokens;
}

/**
 * Open-plate title: word-level masked rises, line shells for reverse-stagger exit.
 * Exit order: last title line first (sub exits earlier via --xe: 0).
 */
function openTitleLines(lines, { reveal = 'rise', start = 3.42, lineStep = 0.16, wordStep = 0.05 } = {}) {
  const list = (Array.isArray(lines) ? lines : [lines]).filter((l) => l != null && String(l).length);
  const n = list.length;
  let charIndex = 0;
  return list
    .map((line, i) => {
      const lineStart = start + i * lineStep;
      const exitOrder = n - 1 - i;
      const xe = (0.1 + exitOrder * 0.08).toFixed(2);
      let inner;
      if (reveal === 'cascade') {
        // Characters stagger across the whole title; each line starts a beat later.
        const chars = cascadeChars(line, { from: charIndex });
        charIndex = chars.next;
        inner = `<span class="title-cascade" style="--t: ${lineStart.toFixed(2)}s">${chars.html}</span>`;
      } else if (reveal === 'wipe') {
        inner = `<span class="line-wipe" style="--t: ${lineStart.toFixed(2)}s">${emphasize(line)}</span>`;
      } else {
        const words = splitWordsPreservingEmphasis(line);
        inner = words
          .map(
            (w, wi) =>
              `<span class="mask word"><span class="rise" style="--t: ${(lineStart + wi * wordStep).toFixed(2)}s">${emphasize(w)}</span></span>`
          )
          .join('');
      }
      return `<span class="line-exit title-line" style="--xe: ${xe}s">${inner}</span>`;
    })
    .join('\n        ');
}

/** Open-plate sub: phrase beats split on · with soft staggered reveals. */
function openSub(text, start = 3.95, step = 0.11) {
  const raw = String(text ?? '').trim();
  if (!raw) return '';
  const parts = raw.split(/\s*·\s*/).map((p) => p.trim()).filter(Boolean);
  return parts
    .map((part, i) => {
      const t = (start + i * step).toFixed(2);
      const body = emphasize(part, '<b>', '</b>');
      const sep =
        i < parts.length - 1
          ? `<span class="sep" style="--t: ${(start + i * step + step * 0.45).toFixed(2)}s">·</span>`
          : '';
      return `<span class="word" style="--t: ${t}s">${body}</span>${sep}`;
    })
    .join('');
}

function stepsHtml(steps) {
  const n = steps.length;
  const span = n > 1 ? 0.8 / (n - 1) : 0;
  return steps
    .map(
      (s, i) => `<div class="step" style="--s: ${(1.2 + i * span).toFixed(2)}s">
          <div class="dot">${i + 1}</div>
          <div class="step-label" data-edit="steps.${i}.label" data-edit-raw="${escAttr(s.label)}">${emphasize(s.label)}</div>
          ${s.note ? `<div class="step-note" data-edit="steps.${i}.note" data-edit-raw="${escAttr(s.note)}">${emphasize(s.note)}</div>` : ''}
        </div>`
    )
    .join('\n        ');
}

function resolveAssetPath(brand, asset) {
  if (!asset) return null;
  if (/^(data:|https?:|file:)/i.test(asset)) return null;
  const rel = asset.replace(/^\.?\/?assets\//, '');
  const candidates = [
    join(brand.dir, 'assets', rel),
    join(brand.dir, rel),
    join(brand.dir, 'assets', basename(rel)),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (!path) throw new Error(`Plate asset not found: ${asset} (brand ${brand.name || brand.dir})`);
  return path;
}

function resolveAssetUri(brand, asset) {
  if (!asset) return '';
  if (/^(data:|https?:|file:)/i.test(asset)) return asset;
  const path = resolveAssetPath(brand, asset);
  const mime = MIME[extname(path).toLowerCase()] || 'application/octet-stream';
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

function resolveLogoPresentation(brand, it) {
  const asset = it.asset || it.logo || it.src;
  const path = resolveAssetPath(brand, asset);
  const tone = logoTileTone(path, it.bg || it.tone);
  return {
    src: path ? resolveAssetUri(brand, asset) : typeof asset === 'string' ? asset : '',
    tone: tone.tone,
    luma: tone.luma,
    source: tone.source,
    label: it.label || it.name || '',
  };
}

function iconHtml(name) {
  const svg = ICONS[name] || ICONS.spark;
  return `<div class="icon" aria-hidden="true">${svg}</div>`;
}

function featuresItems(items) {
  const n = items.length;
  // Row-aware stagger: top row lands as a wave, bottom row follows (3+2 / 3+3).
  const cols = n <= 3 ? n : n === 4 ? 2 : 3;
  return items
    .map((it, i) => {
      const icon = it.icon || ['calendar', 'clock', 'users', 'leave', 'chart'][i] || 'spark';
      const row = Math.floor(i / cols);
      const col = i % cols;
      const delay = 0.72 + row * 0.28 + col * 0.1;
      return `<div class="card" style="--s: ${delay.toFixed(2)}s">
          ${iconHtml(icon)}
          <div class="num">${String(i + 1).padStart(2, '0')}</div>
          <div class="label" data-edit="items.${i}.label" data-edit-raw="${escAttr(it.label)}">${emphasize(it.label)}</div>
          ${it.note ? `<div class="note" data-edit="items.${i}.note" data-edit-raw="${escAttr(it.note)}">${emphasize(it.note)}</div>` : ''}
        </div>`;
    })
    .join('\n        ');
}

function statsItems(items, brand) {
  const n = items.length;
  const span = n > 1 ? 0.5 / (n - 1) : 0;
  return items
    .map((it, i) => {
      const hasLogo = !!(it.logo || it.asset);
      const logo = hasLogo ? resolveLogoPresentation(brand, it) : null;
      const s = 0.75 + i * span;
      // Count-up (lib/countUp.mjs) runs on the plate clock; opt out per item with count: false.
      const count =
        it.count === false ? '' : ` data-count data-count-start="${(s + 0.25).toFixed(2)}" data-count-dur="1.3"`;
      return `<div class="stat" style="--s: ${s.toFixed(2)}s">
          ${
            logo
              ? `<div class="badge" data-tone="${logo.tone}"><img src="${logo.src}" alt="" /></div>`
              : ''
          }
          <div class="value" data-fit="1" data-fit-min="48" data-fit-group="stat-value"${count} data-edit="items.${i}.value" data-edit-raw="${escAttr(String(it.value))}">${emphasize(String(it.value))}</div>
          <div class="label" data-edit="items.${i}.label" data-edit-raw="${escAttr(it.label)}">${emphasize(it.label)}</div>
          ${it.note ? `<div class="note" data-edit="items.${i}.note" data-edit-raw="${escAttr(it.note)}">${emphasize(it.note)}</div>` : ''}
        </div>`;
    })
    .join('\n        ');
}

function calloutBullets(bullets = []) {
  return bullets
    .map((b, i) => {
      const text = typeof b === 'string' ? b : b.label;
      return `<div class="bullet" style="--s: ${(1.15 + i * 0.12).toFixed(2)}s" data-edit="bullets.${i}" data-edit-raw="${escAttr(text)}">${emphasize(text)}</div>`;
    })
    .join('\n          ');
}

/**
 * Build testimonial flood cards.
 * - `cascade`: 3 unique quotes → dual-wave of 6 slots (heroes dissolve, echoes rise).
 * - `carousel`: 6–16 unique quotes → 3-up waves that roll through (content-sized cards).
 */
function testimonialsItems(items, { cascade = false, carousel = false } = {}) {
  const base = items.map((it) => {
    const quote = typeof it === 'string' ? it : it.quote || it.text || '';
    const author = typeof it === 'string' ? '' : it.author || '';
    const role = typeof it === 'string' ? '' : it.role || it.company || '';
    const star = typeof it === 'string' ? true : it.stars !== false;
    return { quote, author, role, star };
  });

  if (carousel) {
    const perWave = 3;
    const waveHold = 2.55;
    const waveGap = 0.28;
    const enterBase = 0.38;
    return base
      .map((it, i) => {
        const { quote, author, role, star } = it;
        const wave = Math.floor(i / perWave);
        const col = i % perWave;
        const chars = String(quote).replace(/\s+/g, ' ').trim().length;
        const seed = chars < 70 ? 28 : chars < 100 ? 24 : chars < 140 ? 20 : chars < 180 ? 17 : 15;
        const enter = enterBase + wave * (waveHold + waveGap) + col * 0.1;
        const hold = waveHold;
        const rot = ((col % 3) - 1) * 0.55;
        const amp = -(5 + (col % 3) * 2);
        const dx = (col - 1) * 6;
        const starsHtml = star
          ? `<div class="stars" aria-hidden="true">${[0, 1, 2, 3, 4]
              .map((si) => `<span class="star" style="--si: ${(si * 0.045).toFixed(3)}s">★</span>`)
              .join('')}</div>`
          : '';
        return `<div class="t-slot" data-wave="${wave + 1}" data-col="${col}" style="--s: ${enter.toFixed(2)}s; --hold: ${hold.toFixed(2)}s; --col: ${col}; --z: ${wave + 1}; --rot: ${rot.toFixed(2)}deg; --amp: ${amp}px; --dx: ${dx}px">
          <div class="t-card">
            <div class="mark" aria-hidden="true">“</div>
            ${starsHtml}
            <div class="quote" style="--q: ${seed}px" data-edit="quotes.${i}.quote" data-edit-raw="${escAttr(quote)}">${emphasize(quote)}</div>
            ${
              author || role
                ? `<div class="meta"><div class="meta-accent" aria-hidden="true"></div>${
                    author
                      ? `<span class="author" data-edit="quotes.${i}.author" data-edit-raw="${escAttr(author)}">${emphasize(author)}</span>`
                      : ''
                  }${
                    role
                      ? `<span class="role" data-edit="quotes.${i}.role" data-edit-raw="${escAttr(role)}">${emphasize(role)}</span>`
                      : ''
                  }</div>`
                : ''
            }
          </div>
        </div>`;
      })
      .join('\n        ');
  }

  // Wave 2 rotates quote order so the lower row reads as a fresh pass, not a clone strip.
  // Only wave 1 gets data-edit — wave 2 is a visual echo of the same quotes.
  const waves = cascade
    ? [
        ...base.map((q, i) => ({ ...q, wave: 1, index: i, srcIndex: i })),
        ...base.map((q, i) => {
          const srcIndex = (i + 1) % base.length;
          return { ...base[srcIndex], wave: 2, index: i, srcIndex };
        }),
      ]
    : base.map((q, i) => ({ ...q, wave: 1, index: i, srcIndex: i }));

  const n = waves.length;
  const wave1Count = base.length;
  const span = wave1Count > 1 ? Math.min(0.2, 0.5 / (wave1Count - 1)) : 0;

  return waves
    .map((it) => {
      const { quote, author, role, star, wave, index, srcIndex } = it;
      const chars = String(quote).replace(/\s+/g, ' ').trim().length;
      const seed =
        cascade && wave === 1
          ? chars < 90
            ? 30
            : chars < 130
              ? 26
              : 22
          : cascade && wave === 2
            ? chars < 90
              ? 20
              : 16
            : n <= 3
              ? chars < 90
                ? 36
                : chars < 130
                  ? 30
                  : 26
              : chars < 70
                ? 26
                : chars < 100
                  ? 22
                  : chars < 130
                    ? 19
                    : chars < 160
                      ? 17
                      : 15;

      // Wave 1: hero row. Wave 2: lower row enters just after (dense flood from ~0.6s),
      // then heroes dissolve mid-plate while echoes keep floating — no empty half-frame.
      const enter =
        wave === 1
          ? 0.32 + index * span
          : 0.62 + index * Math.min(0.14, span * 0.75);
      const rot = ((index % 5) - 2) * (wave === 1 ? 0.45 : 0.7);
      const amp = wave === 1 ? -(6 + (index % 3) * 2) : -(5 + ((index + 1) % 3) * 2);
      const dx = (index - 1) * (wave === 1 ? 4 : -5);
      const xd = (wave1Count - 1 - index) * 0.07;
      const editable = wave === 1;

      const starsHtml = star
        ? `<div class="stars" aria-hidden="true">${[0, 1, 2, 3, 4]
            .map((si) => `<span class="star" style="--si: ${(si * 0.045).toFixed(3)}s">★</span>`)
            .join('')}</div>`
        : '';
      const quoteAttrs = editable
        ? ` data-edit="quotes.${srcIndex}.quote" data-edit-raw="${escAttr(quote)}"`
        : '';
      const meta =
        author || role
          ? `<div class="meta"><div class="meta-accent" aria-hidden="true"></div>${
              author
                ? `<span class="author"${
                    editable ? ` data-edit="quotes.${srcIndex}.author" data-edit-raw="${escAttr(author)}"` : ''
                  }>${emphasize(author)}</span>`
                : ''
            }${
              role
                ? `<span class="role"${
                    editable ? ` data-edit="quotes.${srcIndex}.role" data-edit-raw="${escAttr(role)}"` : ''
                  }>${emphasize(role)}</span>`
                : ''
            }</div>`
          : '';

      return `<div class="t-slot" data-wave="${wave}" style="--s: ${enter.toFixed(2)}s; --rot: ${rot.toFixed(2)}deg; --amp: ${amp}px; --dx: ${dx}px; --xd: ${xd.toFixed(2)}s">
          <div class="t-card">
            <div class="mark" aria-hidden="true">“</div>
            ${starsHtml}
            <div class="quote" style="--q: ${seed}px"${quoteAttrs}>${emphasize(quote)}</div>
            ${meta}
          </div>
        </div>`;
    })
    .join('\n        ');
}

/** Plate duration (seconds) for a testimonial carousel given quote count. */
function testimonialsCarouselDuration(count) {
  const perWave = 3;
  const waves = Math.max(1, Math.ceil(count / perWave));
  const waveHold = 2.55;
  const waveGap = 0.28;
  const enterBase = 0.38;
  const lastEnter = enterBase + (waves - 1) * (waveHold + waveGap) + 0.2;
  const blackOut = lastEnter + waveHold + 0.15;
  const dur = blackOut + 0.7;
  return {
    dur: Number(dur.toFixed(2)),
    blackOut: Number(blackOut.toFixed(2)),
    xCompose: Number((blackOut - 0.35).toFixed(2)),
    xCard: Number((blackOut - 0.55).toFixed(2)),
  };
}

function logosItems(items, brand) {
  const n = items.length;
  const span = n > 1 ? 0.55 / (n - 1) : 0;
  const rows = items.map((it, i) => {
    const { src, tone, luma, source, label } = resolveLogoPresentation(brand, it);
    return {
      html: `<div class="logo-tile" style="--s: ${(0.55 + i * span).toFixed(2)}s">
          <div class="logo-frame" data-tone="${tone}"><img src="${src}" alt="${esc(label)}" /></div>
          ${label ? `<div class="logo-label">${esc(label)}</div>` : ''}
        </div>`,
      label: label || basename(it.asset || it.logo || `logo-${i}`),
      tone,
      luma,
      source,
    };
  });
  console.log(
    `  logo tones: ${rows.map((r) => `${r.label}=${r.tone}(${Math.round(r.luma)},${r.source})`).join(' · ')}`
  );
  return rows.map((r) => r.html).join('\n        ');
}

function journeyItems(items) {
  const n = items.length;
  const span = n > 1 ? 0.55 / (n - 1) : 0;
  return items
    .map((it, i) => {
      const icon = it.icon || ['dashboard', 'calendar', 'clock', 'chart', 'settings'][i] || 'spark';
      return `<div class="j-step" style="--s: ${(0.7 + i * span).toFixed(2)}s">
          <div class="j-rail"><div class="j-dot">${i + 1}</div>${i < n - 1 ? '<div class="j-line"></div>' : ''}</div>
          <div class="j-body">
            ${iconHtml(icon)}
            <div class="j-label" data-edit="items.${i}.label" data-edit-raw="${escAttr(it.label)}">${emphasize(it.label)}</div>
            ${it.note ? `<div class="j-note" data-edit="items.${i}.note" data-edit-raw="${escAttr(it.note)}">${emphasize(it.note)}</div>` : ''}
          </div>
        </div>`;
    })
    .join('\n        ');
}

const CHECK_PATH = 'M5 12.5l4.2 4.2L19 7';
const CROSS_PATH = 'M7 7l10 10M17 7L7 17';

/** Before / after columns: items get a drawn ✕ (before) or ✓ (after) mark. */
function compareItems(items, side, startSec) {
  const path = side === 'before' ? CROSS_PATH : CHECK_PATH;
  return items
    .map((raw, i) => {
      const text = typeof raw === 'string' ? raw : raw.label;
      const t = (startSec + i * 0.13).toFixed(2);
      return `<div class="item" style="--i: ${t}s">
              <div class="mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${path}" pathLength="1"/></svg></div>
              <div data-edit="${side === 'before' ? 'left' : 'right'}.items.${i}" data-edit-raw="${escAttr(text)}">${emphasize(text)}</div>
            </div>`;
    })
    .join('\n            ');
}

/**
 * Hero quote: words stagger in; size follows length so one quote always fits the card.
 * `*accent*` may span several words: the accent state carries from word to word, and each word
 * closes its own span so the stagger stays per word.
 */
function quoteWords(quote, start = 0.85, step = 0.055) {
  const words = String(quote ?? '').trim().split(/\s+/).filter(Boolean);
  let inEm = false;
  const html = words.map((w, i) => {
    let out = '';
    let buf = '';
    const flush = () => {
      if (buf) out += inEm ? `<span class="accent">${esc(buf)}</span>` : esc(buf);
      buf = '';
    };
    for (const ch of w) {
      if (ch === '*') {
        flush();
        inEm = !inEm;
      } else buf += ch;
    }
    flush();
    return `<span class="qw" style="--t: ${(start + i * step).toFixed(3)}s">${out}</span>`;
  });
  const plain = words.join(' ').replace(/\*/g, '');
  return { html: html.join(''), end: start + words.length * step, chars: plain.length };
}

function quoteSize(chars) {
  if (chars < 32) return 76;
  if (chars < 70) return 60;
  if (chars < 110) return 52;
  if (chars < 150) return 46;
  if (chars < 200) return 40;
  return 34;
}

/** Line length for the hero quote: short lines for punchy quotes, a wider measure for long ones. */
function quoteMeasure(chars) {
  if (chars > 180) return 46;
  if (chars > 120) return 40;
  return 34;
}

/** Logo wall columns: one row up to 5, then two balanced rows (7 → 4 + 3, never 3 + 3 + 1). */
export function logoColumns(n) {
  return n <= 5 ? n : Math.ceil(n / 2);
}

/** Compare type steps with density: two short lines set large, five long ones step down. */
export function compareType(left, right) {
  const n = Math.max(left.length, right.length);
  const longest = Math.max(...[...left, ...right].map((t) => String(typeof t === 'string' ? t : t?.label ?? '').length));
  let item = n <= 2 ? 30 : n === 3 ? 26 : n === 4 ? 24 : 22;
  if (longest > 90) item -= 4;
  else if (longest > 64) item -= 2;
  return { ITEM_SIZE: Math.max(20, item), COL_TITLE_SIZE: n <= 3 ? 38 : 34 };
}

function initials(name) {
  const parts = String(name ?? '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '“';
  return parts
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

/** Metric ring ticks: 60 hairlines around the dial, fading in clockwise. */
function metricTicks() {
  const out = [];
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const r1 = 248;
    const r2 = i % 5 === 0 ? 236 : 242;
    const x1 = (260 + Math.cos(a) * r1).toFixed(1);
    const y1 = (260 + Math.sin(a) * r1).toFixed(1);
    const x2 = (260 + Math.cos(a) * r2).toFixed(1);
    const y2 = (260 + Math.sin(a) * r2).toFixed(1);
    out.push(`<line class="tick" style="--i: ${i}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`);
  }
  return out.join('');
}

function metricPills(pills = []) {
  return pills
    .map((raw, i) => {
      const text = typeof raw === 'string' ? raw : raw.label;
      return `<span class="pill" style="--s: ${(1.35 + i * 0.12).toFixed(2)}s" data-edit="pills.${i}" data-edit-raw="${escAttr(text)}">${emphasize(text)}</span>`;
    })
    .join('\n          ');
}

/** Guess a ring progress from the value when none is given: percentages map directly, else ¾. */
function metricProgress(it) {
  if (Number.isFinite(it.progress)) return Math.max(0.04, Math.min(1, it.progress));
  const m = String(it.value ?? '').match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (m) return Math.max(0.04, Math.min(1, Number(m[1].replace(',', '.')) / 100));
  return 0.76;
}

/**
 * Orbit seats: up to four marks on the inner ring, the rest on the outer ring, both evenly
 * spaced and offset so no tile sits straight above or below the lockup.
 */
function orbitItems(items, brand) {
  const inner = items.slice(0, Math.min(4, items.length));
  const outer = items.slice(inner.length);
  const seat = (it, i, ring) => {
    const count = ring === 'inner' ? inner.length : outer.length;
    const r = ring === 'inner' ? 260 : 400;
    const offset = ring === 'inner' ? -90 + 180 / count : -90 + 180 / count + 30;
    const a = offset + (360 / count) * i;
    const { src, tone, label } = resolveLogoPresentation(brand, it);
    const s = (ring === 'inner' ? 0.95 : 1.25) + i * 0.11;
    return `<div class="o-seat ${ring === 'inner' ? 'near' : 'far'}" style="--a: ${a.toFixed(1)}deg; --r: ${r}px; --s: ${s.toFixed(2)}s; --dir: ${ring === 'inner' ? 1 : -1}">
            <div class="o-spin">
              <div class="o-link"></div>
              <div class="o-arm"><div class="o-upright"><div class="o-counter">
                <div class="o-tile" data-tone="${tone}"><img src="${src}" alt="${esc(label)}" /></div>
              </div></div></div>
            </div>
          </div>`;
  };
  const legend = items
    .map((it, i) => {
      const label = it.label || it.name || '';
      return label
        ? `<span style="--s: ${(0.95 + i * 0.09).toFixed(2)}s" data-edit="logos.${i}.label" data-edit-raw="${escAttr(label)}">${emphasize(label)}</span>`
        : '';
    })
    .join('');
  return {
    html: [...inner.map((it, i) => seat(it, i, 'inner')), ...outer.map((it, i) => seat(it, i, 'outer'))].join(
      '\n          '
    ),
    legend,
  };
}

export function platePaths(video) {
  const dir = join(video.out, 'plates');
  const interstitial = {};
  for (const it of video.config.interstitials || []) {
    interstitial[it.id] = {
      html: join(dir, `${it.id}.html`),
      mp4: join(video.out, `plate-${it.id}.mp4`),
      type: it.type,
    };
  }
  return {
    dir,
    open: { html: join(dir, 'open.html'), mp4: join(video.out, 'brand-open.mp4') },
    close: { html: join(dir, 'close.html'), mp4: join(video.out, 'brand-close.mp4') },
    interstitial,
  };
}

function buildInterstitial(video, it, paths, common) {
  if (!PLATE_TYPES.has(it.type)) {
    throw new Error(`Unknown interstitial type "${it.type}" (use ${INTERSTITIAL_TYPES.join('|')})`);
  }
  const dest = paths.interstitial[it.id];
  const tpl = readFileSync(join(TEMPLATES, `${it.type}.html`), 'utf8');
  const brand = video.brand;
  // Per-plate motion overlay (energy, depth, sheen, title reveal, atmosphere tuning).
  const { motion, plateBrand, ...plateCommon } = interstitialBrandVars(common, brand, it);
  const title = (t) => titleEditFields(t || '', { reveal: motion.titleReveal });
  const eyebrow = (fallback) => ({
    EYEBROW: emphasize(it.eyebrow || fallback),
    EYEBROW_RAW: escAttr(it.eyebrow || fallback),
  });
  const write = (values) => writePlateHtml(dest.html, fill(tpl, { ...plateCommon, ...values }), plateBrand, plateStyle(it, it.id));

  if (it.type === 'features') {
    const items = it.items || [];
    if (items.length < 3 || items.length > 6) {
      throw new Error(`features plate "${it.id}" needs 3–6 items (got ${items.length})`);
    }
    write({ ...eyebrow('At a glance'), ...title(it.title), ITEM_COUNT: items.length, ITEMS: featuresItems(items) });
  } else if (it.type === 'stats') {
    const items = it.stats || it.items || [];
    if (items.length < 2 || items.length > 4) {
      throw new Error(`stats plate "${it.id}" needs 2–4 stats (got ${items.length})`);
    }
    write({ ...eyebrow('In numbers'), ...title(it.title), ITEM_COUNT: items.length, ITEMS: statsItems(items, brand) });
  } else if (it.type === 'callout') {
    write({
      ...eyebrow('Why it matters'),
      ...title(it.title),
      TITLE_MAX: plainTitle(it.title).length <= 24 ? 80 : '',
      BODY: emphasize(it.body || ''),
      BODY_RAW: escAttr(it.body || ''),
      BULLETS: calloutBullets(it.bullets || []),
    });
  } else if (it.type === 'testimonials') {
    const items = it.quotes || it.items || [];
    const carousel = it.motion?.carousel === true;
    if (carousel) {
      if (items.length < 6 || items.length > 16) {
        throw new Error(`testimonials carousel "${it.id}" needs 6–16 quotes (got ${items.length})`);
      }
    } else if (items.length < 3 || items.length > 8) {
      throw new Error(`testimonials plate "${it.id}" needs 3–8 quotes (got ${items.length})`);
    }
    // Dual-wave cascade: 3 real quotes → 6 slots (heroes dissolve, echoes rise below).
    // Opt out with motion.cascade === false; force with true when 4–5 quotes want denser feel.
    // Carousel wins over cascade when both are set.
    const cascade =
      !carousel &&
      (it.motion?.cascade === true || (it.motion?.cascade !== false && items.length === 3));
    const displayCount = cascade ? items.length * 2 : items.length;
    const timing = carousel
      ? testimonialsCarouselDuration(items.length)
      : { dur: 8.2, blackOut: 7.55, xCompose: 7.15, xCard: 6.55 };
    write({
      ...eyebrow('What teams say'),
      ...title(it.title),
      ITEM_COUNT: displayCount,
      FLOOD_MODE: carousel ? 'carousel' : cascade ? 'cascade' : 'grid',
      DUR: timing.dur.toFixed(2),
      BLACK_OUT: timing.blackOut.toFixed(2),
      X_COMPOSE: timing.xCompose.toFixed(2),
      X_CARD: timing.xCard.toFixed(2),
      ITEMS: testimonialsItems(items, { cascade, carousel }),
    });
  } else if (it.type === 'logos') {
    const items = it.logos || it.items || [];
    if (items.length < 3 || items.length > 10) {
      throw new Error(`logos plate "${it.id}" needs 3–10 logos (got ${items.length})`);
    }
    write({
      ...eyebrow('Trusted by'),
      ...title(it.title),
      SUB: emphasize(it.sub || ''),
      SUB_RAW: escAttr(it.sub || ''),
      ITEM_COUNT: items.length,
      LOGO_COLS: logoColumns(items.length),
      ITEMS: logosItems(items, brand),
    });
  } else if (it.type === 'journey') {
    const items = it.steps || it.items || [];
    if (items.length < 3 || items.length > 6) {
      throw new Error(`journey plate "${it.id}" needs 3–6 steps (got ${items.length})`);
    }
    write({ ...eyebrow('Your first week'), ...title(it.title), ITEM_COUNT: items.length, ITEMS: journeyItems(items) });
  } else if (it.type === 'compare') {
    const left = it.left || it.before || {};
    const right = it.right || it.after || {};
    const li = left.items || [];
    const ri = right.items || [];
    if (li.length < 2 || li.length > 5 || ri.length < 2 || ri.length > 5) {
      throw new Error(`compare plate "${it.id}" needs 2–5 items on each side (got ${li.length} / ${ri.length})`);
    }
    write({
      ...eyebrow('Before and after'),
      ...title(it.title),
      ITEM_COUNT: Math.max(li.length, ri.length),
      ...compareType(li, ri),
      LEFT_LABEL: emphasize(left.label || 'Before'),
      LEFT_LABEL_RAW: escAttr(left.label || 'Before'),
      LEFT_TITLE: emphasize(left.title || ''),
      LEFT_TITLE_RAW: escAttr(left.title || ''),
      LEFT_ITEMS: compareItems(li, 'before', 1.05),
      RIGHT_LABEL: emphasize(right.label || 'After'),
      RIGHT_LABEL_RAW: escAttr(right.label || 'After'),
      RIGHT_TITLE: emphasize(right.title || ''),
      RIGHT_TITLE_RAW: escAttr(right.title || ''),
      RIGHT_ITEMS: compareItems(ri, 'after', 1.35),
    });
  } else if (it.type === 'quote') {
    const text = String(it.quote || it.text || '').trim();
    if (text.length < 12 || text.length > 260) {
      throw new Error(`quote plate "${it.id}" needs one quote of 12–260 characters (got ${text.length})`);
    }
    const words = quoteWords(text);
    const hasLogo = !!(it.logo || it.asset);
    const logo = hasLogo ? resolveLogoPresentation(brand, it) : null;
    const stars = it.stars === true || Number.isFinite(it.stars);
    const starCount = Number.isFinite(it.stars) ? Math.max(1, Math.min(5, Math.round(it.stars))) : 5;
    write({
      ...eyebrow('In their words'),
      QUOTE: words.html,
      QUOTE_RAW: escAttr(text),
      QUOTE_SIZE: quoteSize(words.chars),
      QUOTE_MEASURE: quoteMeasure(words.chars),
      T_META: Math.min(3.4, words.end + 0.25).toFixed(2),
      STARS: stars
        ? `<div class="stars" aria-hidden="true">${Array.from({ length: starCount }, (_, i) => `<span class="star" style="--si: ${(i * 0.06).toFixed(2)}s">★</span>`).join('')}</div>`
        : '',
      WHO_MARK: logo
        ? `<div class="badge" data-tone="${logo.tone}"><img src="${logo.src}" alt="" /></div>`
        : `<div class="avatar" aria-hidden="true">${esc(initials(it.author))}</div>`,
      AUTHOR: emphasize(it.author || ''),
      AUTHOR_RAW: escAttr(it.author || ''),
      ROLE: emphasize([it.role, it.company].filter(Boolean).join(' · ')),
      ROLE_RAW: escAttr([it.role, it.company].filter(Boolean).join(' · ')),
    });
  } else if (it.type === 'metric') {
    const value = String(it.value ?? '').trim();
    if (!value) throw new Error(`metric plate "${it.id}" needs a value (e.g. "3×", "98%", "12,000")`);
    const pills = it.pills || it.bullets || [];
    if (pills.length > 4) throw new Error(`metric plate "${it.id}" takes at most 4 pills (got ${pills.length})`);
    write({
      ...eyebrow('The outcome'),
      ...title(it.title || it.label),
      VALUE: emphasize(value),
      VALUE_RAW: escAttr(value),
      VALUE_SIZE: value.length <= 3 ? 150 : value.length <= 5 ? 118 : value.length <= 7 ? 92 : 72,
      UNIT: emphasize(it.unit || it.label || ''),
      UNIT_RAW: escAttr(it.unit || it.label || ''),
      NOTE: emphasize(it.note || it.body || ''),
      NOTE_RAW: escAttr(it.note || it.body || ''),
      PROGRESS: metricProgress(it).toFixed(3),
      TICKS: metricTicks(),
      PILLS: metricPills(pills),
    });
  } else if (it.type === 'orbit') {
    const items = it.logos || it.items || [];
    if (items.length < 3 || items.length > 8) {
      throw new Error(`orbit plate "${it.id}" needs 3–8 logos (got ${items.length})`);
    }
    const orbit = orbitItems(items, brand);
    write({
      ...eyebrow('Works with'),
      ...title(it.title),
      SUB: emphasize(it.sub || ''),
      SUB_RAW: escAttr(it.sub || ''),
      ITEM_COUNT: items.length,
      ITEMS: orbit.html,
      LEGEND: orbit.legend,
    });
  }
}

/** Writes plate HTML for open, close, and every interstitial. */
export function buildPlates(video) {
  const { config, brand } = video;
  const readiness = brandReadiness(config.brand);
  if (!readiness.ready) {
    throw new Error(
      `Brand pack "${config.brand}" is not ready, so branded plates cannot be built: ${readiness.issues.join('; ')}`
    );
  }
  const paths = platePaths(video);
  mkdirSync(paths.dir, { recursive: true });
  copyFileSync(join(TEMPLATES, 'plates.css'), join(paths.dir, 'plates.css'));
  const brandMotion = resolveMotion(brand);
  const common = {
    FONT_CSS: brand.font.css,
    BRAND_VARS: `${brandCssVars(brand)}\n      ${motionCssVars(brand)}`,
    LOGO: brand.logoHtml,
    TITLE_REVEAL: brandMotion.titleReveal,
  };

  const open = config.open || {};
  const openLines = Array.isArray(open.title) ? open.title : [open.title || config.title];
  const openEyebrow = open.eyebrow || 'Product walkthrough';
  const openSubRaw = open.sub || '';
  const { motion: openMotion, plateBrand: openBrand, ...openCommon } = interstitialBrandVars(common, brand, open);
  writePlateHtml(
    paths.open.html,
    fill(readFileSync(join(TEMPLATES, 'open.html'), 'utf8'), {
      ...openCommon,
      EYEBROW: emphasize(openEyebrow),
      EYEBROW_RAW: escAttr(openEyebrow),
      TITLE: openTitleLines(openLines, { reveal: openMotion.titleReveal }),
      ...titleEditFields(openLines, { asLines: true }),
      TITLE_SIZE: openLines.length > 2 ? 78 : 96,
      TITLE_LINES: openLines.length,
      SUB: openSub(openSubRaw),
      SUB_RAW: escAttr(openSubRaw),
    }),
    openBrand,
    plateStyle(open, 'open')
  );

  const close = config.close || {};
  const steps = close.steps || [];
  if (steps.length < 2 || steps.length > 4) {
    throw new Error(`close.steps needs 2–4 entries (got ${steps.length}) — they summarise the video`);
  }
  const closeTitle = close.title || [];
  const platform = close.tagline ?? brand.platform ?? '';
  // Per-plate motion (energy / pushScale / timing) — same overlay path as interstitials.
  const { motion: _closeMotion, plateBrand: closeBrand, ...closeCommon } = interstitialBrandVars(common, brand, close);
  writePlateHtml(
    paths.close.html,
    fill(readFileSync(join(TEMPLATES, 'close.html'), 'utf8'), {
      ...closeCommon,
      TITLE: titleLines(closeTitle, 0.4, 0.14),
      TITLE_LINES: Array.isArray(closeTitle) ? closeTitle.length : 2,
      ...titleEditFields(closeTitle, { asLines: true }),
      STEPS: stepsHtml(steps),
      STEP_COUNT: steps.length,
      PLATFORM: emphasize(platform),
      PLATFORM_RAW: escAttr(platform),
    }),
    closeBrand,
    plateStyle(close, 'close')
  );

  for (const it of config.interstitials || []) {
    if (!it.id || !/^[a-z0-9-]+$/.test(it.id)) throw new Error(`interstitial id must be kebab-case (got ${it.id})`);
    buildInterstitial(video, it, paths, common);
  }
  return paths;
}

function encoder(outPath, { width, height }) {
  // JPEG pipe (same family as live capture) — decode is cheap. Near-lossless intermediate.
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', 'pipe:0',
    // Frames already 1920×1080 (css-scale); scale is a safety net if a plate differs
    '-vf', toBt709(width, height),
    ...lossyX264(QUALITY.plate),
    '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    ...BT709_TAGS,
    '-movflags', '+faststart', '-an',
    outPath,
  ];
  assertX264Args('plate', args);
  const ff = spawn('ffmpeg', args,
    { stdio: ['pipe', 'ignore', 'pipe'] }
  );
  let stderr = '';
  ff.stderr.on('data', (d) => (stderr += d));
  const done = new Promise((resolve, reject) =>
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg ${code}`))))
  );
  const write = (buf) =>
    new Promise((resolve, reject) => {
      const onError = (e) => {
        cleanup();
        reject(e);
      };
      const onDrain = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        ff.stdin.off('drain', onDrain);
        ff.stdin.off('error', onError);
      };
      ff.stdin.once('error', onError);
      if (ff.stdin.write(buf)) {
        cleanup();
        resolve();
      } else {
        ff.stdin.once('drain', onDrain);
      }
    });
  return {
    write,
    async end() {
      ff.stdin.end();
      await done;
    },
    abort() {
      try {
        ff.stdin.destroy();
      } catch {
        /* ignore */
      }
      try {
        ff.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Settle-hold window: only reuse frames when the plate is fully entered and not yet exiting.
 * Templates may set --hold-from / --hold-until; 0/0 disables. Otherwise a short pre-blackout hold.
 * Never trust CSS alone — probeHoldSafety must confirm the window is pixel-stable.
 */
function resolveHoldWindow({ blackOutSec, holdFromSec, holdUntilSec }) {
  if (
    Number.isFinite(holdFromSec) &&
    Number.isFinite(holdUntilSec) &&
    holdUntilSec > holdFromSec + 0.12
  ) {
    return { holdFrom: holdFromSec, holdUntil: holdUntilSec, source: 'css' };
  }
  // Explicit disable (--hold-from: 0; --hold-until: 0)
  if (holdFromSec === 0 && holdUntilSec === 0) {
    return { holdFrom: 0, holdUntil: 0, source: 'off' };
  }
  // Conservative default: only the last ~0.4s before black-out (ambient settle, not entrances)
  const holdUntil = Math.max(0.25, blackOutSec - 0.06);
  const holdFrom = Math.max(0, holdUntil - 0.4);
  if (holdUntil - holdFrom < HOLD_MIN_SEC) return { holdFrom: 0, holdUntil: 0, source: 'off' };
  return { holdFrom, holdUntil, source: 'default' };
}

const frameSig = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 20);

/**
 * Shrink or disable hold when CSS animations or pixels still change inside the window.
 * Hold is an optimization only — motion quality always wins.
 */
async function probeHoldSafety(page, setTime, snap, requested) {
  let { holdFrom, holdUntil, source } = requested;
  if (!(holdUntil > holdFrom + HOLD_MIN_SEC)) {
    return { holdFrom: 0, holdUntil: 0, source: 'off', note: 'no-hold' };
  }

  const times = [];
  for (let t = holdFrom; t <= holdUntil + 1e-9; t += HOLD_PROBE_STEP_SEC) {
    times.push(Math.min(holdUntil, Number(t.toFixed(3))));
  }
  if (times[times.length - 1] < holdUntil - 1e-6) times.push(holdUntil);

  const prints = [];
  for (const t of times) {
    prints.push(await setTime(t * 1000));
  }

  // Longest run where the animation fingerprint is constant
  let best = { from: 0, until: 0, len: 0 };
  let runStart = 0;
  for (let i = 1; i <= prints.length; i++) {
    if (i < prints.length && prints[i] === prints[runStart]) continue;
    const from = times[runStart];
    const until = times[i - 1];
    const len = until - from;
    if (len > best.len) best = { from, until, len };
    runStart = i;
  }

  if (best.len < HOLD_MIN_SEC) {
    console.log(
      `  · hold ${holdFrom.toFixed(2)}–${holdUntil.toFixed(2)}s (${source}) → off (motion in window)`
    );
    return {
      holdFrom: 0,
      holdUntil: 0,
      source: 'probed-off',
      note: 'animation-motion',
      requested: { holdFrom, holdUntil, source },
    };
  }

  holdFrom = best.from;
  holdUntil = best.until;

  // Pixel confirm at start / mid / end — must be byte-identical JPEGs
  const samples = [];
  for (const t of [holdFrom, (holdFrom + holdUntil) / 2, holdUntil]) {
    await setTime(t * 1000);
    samples.push(await snap());
  }
  if (frameSig(samples[0]) !== frameSig(samples[1]) || frameSig(samples[1]) !== frameSig(samples[2])) {
    console.log(
      `  · hold ${requested.holdFrom.toFixed(2)}–${requested.holdUntil.toFixed(2)}s → off (pixels differ)`
    );
    return {
      holdFrom: 0,
      holdUntil: 0,
      source: 'probed-off',
      note: 'pixel-motion',
      requested: { holdFrom: requested.holdFrom, holdUntil: requested.holdUntil, source },
    };
  }

  if (
    Math.abs(holdFrom - requested.holdFrom) > 0.05 ||
    Math.abs(holdUntil - requested.holdUntil) > 0.05
  ) {
    console.log(
      `  · hold ${requested.holdFrom.toFixed(2)}–${requested.holdUntil.toFixed(2)}s → ` +
        `${holdFrom.toFixed(2)}–${holdUntil.toFixed(2)}s (shrunk to stable)`
    );
  }

  return {
    holdFrom,
    holdUntil,
    source: 'probed',
    note: 'stable',
    requested: { holdFrom: requested.holdFrom, holdUntil: requested.holdUntil, source },
  };
}

function assessPlateQc({ frames, snapped, reused, holdFrom, holdUntil, maxStuckOutsideHold, jpegQ }) {
  const warnings = [];
  const holdOn = holdUntil > holdFrom;
  const holdFrames = holdOn ? Math.max(0, Math.round((holdUntil - holdFrom) * FPS)) : 0;
  const motionFrames = frames - holdFrames;
  // Unique captures should cover (almost) every non-hold frame + 1 hold snap
  const minSnaps = holdOn ? motionFrames + 1 : frames;
  if (snapped < minSnaps * 0.98) {
    warnings.push(`too-few-snaps:${snapped}<${minSnaps}`);
  }
  if (reused > holdFrames + 2) {
    warnings.push(`excess-reuse:${reused}>${holdFrames}`);
  }
  if (maxStuckOutsideHold >= MAX_STUCK_FRAMES) {
    warnings.push(`stuck-frames:${maxStuckOutsideHold}`);
  }
  if (jpegQ < 90) {
    warnings.push(`jpeg-q-low:${jpegQ}`);
  }
  return {
    ok: warnings.length === 0,
    warnings,
    frames,
    motionFrames,
    holdFrames,
    minSnaps,
    maxStuckOutsideHold,
  };
}

/**
 * Render one plate. 2× raster → 1080p JPEG q95 → x264 CRF 4 @ 30fps (near-lossless intermediate).
 * Every motion frame is captured unless inside a probed-stable settle-hold window.
 * Fails hard if capture looks stuck or under-snapped (Studio/CLI cannot cache a bad plate).
 */
async function renderOne(browser, htmlPath, mp4Path, brand, label = basename(mp4Path, '.mp4'), raster = '') {
  const viewport = { width: DELIVERY.width, height: DELIVERY.height };
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: 2,
    javaScriptEnabled: true,
  });
  let enc;
  let durationSec = 0;
  let snapped = 0;
  let reused = 0;
  let holdFrom = 0;
  let holdUntil = 0;
  let holdMeta = { source: 'off', note: 'init' };
  let maxStuckOutsideHold = 0;
  let frames = 0;
  let typeFit = { fitted: [], clipped: [] };
  const t0 = Date.now();
  try {
    enc = encoder(mp4Path, viewport);
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.addStyleTag({ content: RENDER_CSS });
    const meta = await page.evaluate(async (family) => {
      const cssSec = (name) => {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        if (!v) return null;
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : null;
      };
      await document.fonts.ready;
      await document.fonts.load(`600 72px "${family}"`);
      for (const a of document.getAnimations()) {
        a.pause();
        a.currentTime = 0;
      }
      if (typeof window.__fitType === 'function') await window.__fitType();
      if (typeof window.__fitPlate === 'function') await window.__fitPlate();
      const runtime = window.__plateRuntime || window.__plateField;
      const durationSec = parseFloat(document.body.dataset.duration);
      const blackOutSec = cssSec('--black-out') ?? durationSec - 0.7;
      // Type probe at the settled frame: fitted sizes plus any copy that still clips or leaves the
      // frame. Reported as a soft QC note (the plate renders; the copy is too long).
      const settledMs = Math.max(0, ((cssSec('--hold-from') ?? blackOutSec - 1.2) - 0.05) * 1000);
      for (const a of document.getAnimations()) {
        a.pause();
        a.currentTime = settledMs;
      }
      if (typeof runtime?.renderAt === 'function') runtime.renderAt(settledMs);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const typeFit = { fitted: [], clipped: [] };
      const nameOf = (el) =>
        `${el.dataset.edit || (typeof el.className === 'string' && el.className.split(' ')[0]) || el.tagName.toLowerCase()} "${(el.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 32)}"`;
      for (const el of document.querySelectorAll('[data-fit]')) {
        const px = parseFloat(el.dataset.fitPx);
        const base = parseFloat(el.dataset.fitBase);
        if (Number.isFinite(px)) typeFit.fitted.push({ el: nameOf(el), px, base, atFloor: px <= (parseFloat(el.dataset.fitMin) || base * 0.62) + 0.5 });
      }
      const W = innerWidth;
      const H = innerHeight;
      for (const el of document.querySelectorAll('body *')) {
        if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.05) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.left < -1 || r.right > W + 1 || r.top < -1 || r.bottom > H + 1) typeFit.clipped.push(`offscreen ${nameOf(el)}`);
        else if (cs.display !== 'inline' && el.scrollWidth > el.clientWidth + 2) typeFit.clipped.push(`overflow ${nameOf(el)}`);
      }
      typeFit.clipped = Array.from(new Set(typeFit.clipped)).slice(0, 8);
      for (const a of document.getAnimations()) {
        a.pause();
        a.currentTime = 0;
      }
      if (typeof runtime?.renderAt === 'function') runtime.renderAt(0);
      return {
        durationSec,
        blackOutSec,
        holdFromSec: cssSec('--hold-from'),
        holdUntilSec: cssSec('--hold-until'),
        typeFit,
      };
    }, brand.font.family);
    durationSec = meta.durationSec;
    typeFit = meta.typeFit || typeFit;
    const requested = resolveHoldWindow(meta);
    const snap = () =>
      page.screenshot({ type: 'jpeg', quality: JPEG_Q, animations: 'allow', scale: 'css' });
    /** Step CSS time, wait for paint, return Web Animations fingerprint. */
    const setTime = async (ms) =>
      page.evaluate(async (t) => {
        for (const a of document.getAnimations()) {
          a.pause();
          a.currentTime = t;
        }
        // The WebGL atmosphere and JS hooks (count-ups) are time-driven, not CSS — step them
        // with the plate clock so every frame is deterministic.
        const runtime = window.__plateRuntime || window.__plateField;
        if (typeof runtime?.renderAt === 'function') runtime.renderAt(t);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        // Progress only: a finished (fill: forwards) or not-yet-started animation reads constant,
        // so the fingerprint changes exactly when something on screen can change.
        return document
          .getAnimations()
          .map((a) => {
            const timing = a.effect?.getComputedTiming?.() || {};
            return `${Number(timing.progress ?? -1).toFixed(4)}:${timing.currentIteration ?? '-'}`;
          })
          .join('|');
      }, ms);

    holdMeta = await probeHoldSafety(page, setTime, snap, requested);
    holdFrom = holdMeta.holdFrom;
    holdUntil = holdMeta.holdUntil;

    frames = Math.round(durationSec * FPS);
    console.log(`» plate · ${label} · frame 0 of ${frames}`);
    let holdBuf = null;
    let prevSig = null;
    let prevFp = null;
    let stuckRun = 0;

    for (let f = 0; f < frames; f++) {
      const tSec = f / FPS;
      const inHold = holdUntil > holdFrom && tSec >= holdFrom && tSec < holdUntil;
      if (inHold) {
        if (!holdBuf) {
          prevFp = await setTime(((holdFrom + holdUntil) / 2) * 1000);
          holdBuf = await snap();
          snapped += 1;
          prevSig = frameSig(holdBuf);
          stuckRun = 0;
        }
        await enc.write(holdBuf);
        reused += 1;
      } else {
        let fp = await setTime((f * 1000) / FPS);
        let buf = await snap();
        let sig = frameSig(buf);
        // Paint stall: animations advanced but pixels did not — retry once
        const paintStall = prevSig && sig === prevSig && prevFp && fp !== prevFp;
        if (paintStall) {
          fp = await setTime((f * 1000) / FPS);
          buf = await snap();
          sig = frameSig(buf);
        }
        if (prevSig && sig === prevSig && prevFp && fp !== prevFp) {
          stuckRun += 1;
          maxStuckOutsideHold = Math.max(maxStuckOutsideHold, stuckRun);
        } else {
          stuckRun = 0;
        }
        prevSig = sig;
        prevFp = fp;
        await enc.write(buf);
        snapped += 1;
      }
      if (f === 1 || f % 15 === 0) {
        console.log(`» plate · ${label} · frame ${f} of ${frames}`);
      }
    }
    await enc.end();
  } catch (err) {
    enc?.abort();
    if (!err?.reported) {
      const why = String(err?.message || err).split('\n')[0];
      console.log(`» plate · ${label} · failed · ${why}`);
    }
    throw err;
  } finally {
    await page.close().catch(() => {});
  }

  const qc = assessPlateQc({
    frames,
    snapped,
    reused,
    holdFrom,
    holdUntil,
    maxStuckOutsideHold,
    jpegQ: JPEG_Q,
  });
  const metaPath = mp4Path.replace(/\.mp4$/, '.render.json');
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  const renderMeta = {
    pipeline: RENDER_PIPELINE,
    raster,
    jpegQ: JPEG_Q,
    htmlHash: contentHash(readFileSync(htmlPath)),
    durationSec,
    frames,
    holdFrom,
    holdUntil,
    hold: holdMeta,
    snapped,
    reused,
    renderSec: Number(sec),
    qc,
    typeFit,
    at: new Date().toISOString(),
  };
  writeFileSync(metaPath, JSON.stringify(renderMeta, null, 2));

  if (!qc.ok) {
    console.log(`» plate · ${label} · failed · ${qc.warnings.join(', ')}`);
    console.error(`✗ ${basename(mp4Path)} QC failed: ${qc.warnings.join(', ')}`);
    const err = new Error(
      `Plate render QC failed for ${basename(mp4Path)}: ${qc.warnings.join(', ')}. ` +
        `Hold/motion probe could not guarantee frame-accurate capture — fix the template or re-run.`
    );
    err.reported = true;
    throw err;
  }

  const sizeMB = (statSync(mp4Path).size / 1024 / 1024).toFixed(1);
  if (typeFit.clipped.length) {
    console.log(`» plate · ${label} · type · ${typeFit.clipped.length} element(s) clip — shorten the copy: ${typeFit.clipped.slice(0, 3).join('; ')}`);
  }
  const floored = typeFit.fitted.filter((f) => f.atFloor);
  if (floored.length) {
    console.log(`» plate · ${label} · type · at the floor: ${floored.map((f) => `${f.el} ${f.px}px`).slice(0, 3).join('; ')}`);
  }
  console.log(`» plate · ${label} · ready · ${durationSec.toFixed(1)}s clip · drawn in ${clock(Number(sec))}`);
  console.log(
    `✓ ${basename(mp4Path)} (${sizeMB} MB, ${durationSec}s · ` +
      `${snapped} snaps / ${reused} reuses · ${sec}s wall · qc ok)`
  );
}

/** Read plate encode sidecar (pipeline, hold, QC). */
export function readPlateRenderMeta(mp4Path) {
  const metaPath = mp4Path.replace(/\.mp4$/, '.render.json');
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch {
    return null;
  }
}

function plateCacheFresh(mp4Path, htmlPath, extraSources) {
  if (!existsSync(mp4Path) || !existsSync(htmlPath)) return false;
  const meta = readPlateRenderMeta(mp4Path);
  if (!meta) return false;
  if (meta.pipeline !== RENDER_PIPELINE) return false;
  if (meta.qc && meta.qc.ok === false) return false;
  // Pipeline 6+ requires a QC pass recorded on the sidecar
  if (RENDER_PIPELINE >= 6 && !meta.qc?.ok) return false;
  if (meta.htmlHash !== contentHash(readFileSync(htmlPath))) return false;
  return !isStale(mp4Path, [htmlPath, ...extraSources]);
}

/** Renders plates whose sources changed (or all with force). */
export async function renderPlates(video, { force = false, only } = {}) {
  const paths = buildPlates(video);
  try {
    const { buildLiveCards } = await import('./liveCards.mjs');
    const live = buildLiveCards(video);
    console.log(`· live cards ${live.cards.length} → ${live.dir}`);
  } catch (err) {
    console.warn(`· live cards skipped: ${err.message || err}`);
  }
  const sources = [
    video.configPath,
    ...video.brand.files,
    join(TEMPLATES, 'plates.css'),
    join(KIT, 'lib', 'plates.mjs'),
    join(KIT, 'lib', 'plateMotion.mjs'),
    join(KIT, 'lib', 'atmosphere.mjs'),
    join(KIT, 'lib', 'countUp.mjs'),
    join(KIT, 'lib', 'typeFit.mjs'),
    join(KIT, 'lib', 'logoTone.mjs'),
  ];
  const labelFor = (key) => {
    if (key === 'open') return plainTitle(video.config.open?.title) || 'Introduction';
    if (key === 'close') return plainTitle(video.config.close?.title) || 'Close';
    const id = key.slice('plate:'.length);
    const it = (video.config.interstitials || []).find((x) => x.id === id);
    return plainTitle(it?.title) || plainTitle(it?.eyebrow) || id;
  };
  const jobs = [];
  const saved = [];
  const want = (key) => !only || only === key || (only === 'interstitials' && key.startsWith('plate:'));
  const consider = (key, html, mp4, sourcesForPlate) => {
    if (!want(key)) return;
    const row = { key, label: labelFor(key), html, mp4 };
    if (force || !plateCacheFresh(mp4, html, sourcesForPlate)) jobs.push(row);
    else saved.push(row);
  };

  consider('open', paths.open.html, paths.open.mp4, [...sources, join(TEMPLATES, 'open.html')]);
  consider('close', paths.close.html, paths.close.mp4, [...sources, join(TEMPLATES, 'close.html')]);
  for (const it of video.config.interstitials || []) {
    const dest = paths.interstitial[it.id];
    consider(`plate:${it.id}`, dest.html, dest.mp4, [...sources, join(TEMPLATES, `${it.type}.html`)]);
  }

  if (!jobs.length) {
    console.log('» plates · Every plate already matches');
    for (const row of saved) console.log(`» plate · ${row.label} · already rendered`);
    console.log('· plates up to date (content-hash cache hit)');
    return paths;
  }
  const total = jobs.length + saved.length;
  console.log(
    `» plates · Drawing ${jobs.length} of ${total}${saved.length ? ` · ${saved.length} already match` : ''}`
  );
  // Every row exists from the first line, so the card's checklist and bar never jump.
  for (const row of saved) console.log(`» plate · ${row.label} · already rendered`);
  for (const row of jobs) console.log(`» plate · ${row.label} · waiting`);

  const browser = await chromium.launch({ headless: true, args: plateBrowserArgs() });
  try {
    const raster = await rasterBackend(browser);
    console.log(
      `· rendering ${jobs.length} plate(s) · ${raster} · jpeg q${JPEG_Q} · ${PLATE_CONCURRENCY} at a time · pipeline v${RENDER_PIPELINE}`
    );
    console.log(`  ${jobs.map((j) => j.key).join(', ')}`);
    // A pool, not fixed batches: the next plate starts the moment any one finishes.
    const queue = [...jobs];
    const worker = async () => {
      for (let j = queue.shift(); j; j = queue.shift()) {
        await renderOne(browser, j.html, j.mp4, video.brand, j.label, raster);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PLATE_CONCURRENCY, jobs.length) }, worker));
  } finally {
    await browser.close();
  }
  return paths;
}

/**
 * Chromium flags for plate capture. On macOS the schedule-field WebGL and CSS blur are drawn
 * through Metal with GPU rasterization — about 5× faster per frame than SwiftShader, with
 * identical type and layout. WALKTHROUGH_PLATE_GPU=0 forces the software path.
 */
function plateBrowserArgs() {
  const base = ['--disable-dev-shm-usage'];
  if (process.env.WALKTHROUGH_PLATE_GPU === '0') return [...base, '--disable-gpu'];
  if (process.platform === 'darwin') {
    return [...base, '--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'];
  }
  if (process.env.WALKTHROUGH_PLATE_GPU === '1') {
    return [...base, '--enable-gpu-rasterization', '--ignore-gpu-blocklist'];
  }
  return [...base, '--disable-gpu'];
}

/** Which WebGL renderer Chromium actually got, so a silent fallback to software shows in the log. */
async function rasterBackend(browser) {
  const page = await browser.newPage();
  try {
    const name = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    });
    if (/swiftshader|llvmpipe|software/i.test(name) || !name) return 'software raster';
    if (/metal/i.test(name)) return 'GPU raster (Metal)';
    return 'GPU raster';
  } catch {
    return 'software raster';
  } finally {
    await page.close().catch(() => {});
  }
}

/** Plate title as one readable line: array lines joined, `*emphasis*` markers dropped. */
function plainTitle(value) {
  const text = (Array.isArray(value) ? value.join(' ') : String(value ?? ''))
    .replace(/\*/g, '')
    .replace(/·/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

/** 186.9 → "3m 07s", 9.4 → "9s". */
function clock(sec) {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
