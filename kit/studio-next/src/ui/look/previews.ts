import { escapeHtml } from '@/lib/escapeHtml';

/**
 * Visual pickers for the slide inspector and the Direction panel. Every option is a small live drawing of what it does:
 * a wireframe of the composition, the title reveal playing on a word, the transition wiping A
 * into B, the easing curve with a dot riding it. Tiles animate on hover and loop while selected,
 * so a choice reads before it is made. Backgrounds are painted by `atmosphereThumbs` from the
 * real shaders; here they get a canvas and a brand-coloured fallback.
 */

export interface TileOpts {
  attr: string;
  value: string;
  label: string;
  on: boolean;
  hint?: string | undefined;
  badge?: string | undefined;
  extra?: string | undefined;
}

/** One picker tile: a preview over a caption. `attr` is the data attribute the wire listens to. */
export function tile(preview: string, o: TileOpts): string {
  const badge = o.badge ? `<em class="lk-badge">${escapeHtml(o.badge.split(' · ')[0])}</em>` : '';
  // Catalogue labels read "Aurora · colour ribbons": the name fits the tile, the gloss goes to the tooltip.
  const [name, gloss] = o.label.split(' · ');
  const title = o.hint || (gloss ? `${name} — ${gloss}` : o.label);
  return `<button type="button" class="lk-tile${o.on ? ' on' : ''}" ${o.attr}="${escapeHtml(o.value)}" ${o.extra || ''} aria-pressed="${o.on}" title="${escapeHtml(title)}"><span class="lk-prev">${preview}</span><span class="lk-name">${escapeHtml(name)}</span>${badge}</button>`;
}

const CARRY_GLYPH = `<svg viewBox="0 0 30 20" aria-hidden="true"><rect class="cw-frame" x="1" y="1" width="28" height="18" rx="4"/><path class="cw-wave" d="M4 13.5c3.6-2.6 7.2 2.6 11 0s7.4-2.6 11 0"/><rect class="cw-card" x="9" y="5" width="12" height="3" rx="1.5"/></svg>`;
const BREAK_GLYPH = `<svg viewBox="0 0 30 20" aria-hidden="true"><rect class="cw-frame" x="1" y="1" width="28" height="18" rx="4"/><path class="cw-wave" d="M4 13.5c3.6-2.6 7.2 2.6 9.5 .6"/><path class="cw-wave" d="M17 12.8c2.6 1.6 6 .8 9-.6"/><rect class="cw-card" x="9" y="5" width="12" height="3" rx="1.5"/></svg>`;

/**
 * Between two slides: does the background run straight through? Only the copy changes when it
 * does; otherwise the note names what breaks it, so the fix (match the background) is obvious.
 */
export function carryNote(carry: { ok: boolean; why: string } | undefined, continuous: boolean): string {
  if (!carry) return '';
  if (carry.ok && continuous)
    return `<div class="tr-carry" role="note">${CARRY_GLYPH}<span><b>Background carries through</b><em>Same background — it keeps moving and only the copy changes.</em></span></div>`;
  if (carry.ok)
    return `<div class="tr-carry is-off" role="note">${BREAK_GLYPH}<span><b>Background restarts</b><em>Both slides share it — pick Continuous to carry it through.</em></span></div>`;
  return `<div class="tr-carry is-off" role="note">${BREAK_GLYPH}<span><b>Background restarts</b><em>${escapeHtml(cap(carry.why))} — match the backgrounds to carry it through.</em></span></div>`;
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export const tileGrid = (tiles: string[], cls = ''): string => `<div class="lk-grid${cls ? ` ${cls}` : ''}" role="group">${tiles.join('')}</div>`;

const chars = (word: string, cls = 'c') =>
  [...word].map((ch, i) => `<i class="${cls}" style="--i:${i}">${ch === ' ' ? '&nbsp;' : escapeHtml(ch)}</i>`).join('');

// ─── Layout wireframes ─────────────────────────────────────────────────────────────────────
// 64×36 drawings of each composition in kit/lib/plateLayouts.mjs. `a` is the accent fill.
const W = (body: string) => `<svg class="lk-wire" viewBox="0 0 64 36" aria-hidden="true">${body}</svg>`;
const bar = (x: number, y: number, w: number, h = 2.4, a = false) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(1.2, h / 2)}" class="${a ? 'a' : 't'}"/>`;
const box = (x: number, y: number, w: number, h: number, cls = 'p', r = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" class="${cls}"/>`;

const WIRES: Record<string, string> = {
  'open:classic': W(`<circle cx="32" cy="12" r="4" class="a"/>${bar(18, 19, 28, 3.4)}${bar(24, 25, 16, 2)}`),
  'open:split': W(`${bar(6, 12, 22, 3.4)}${bar(6, 18, 18)}${bar(6, 23, 12, 2, true)}${box(36, 6, 22, 24, 'p')}`),
  'open:kinetic': W(`${bar(6, 7, 40, 6)}${bar(14, 15, 44, 6, true)}${bar(6, 23, 30, 6)}`),
  'open:mesh': W(`<circle cx="18" cy="12" r="11" class="m1"/><circle cx="46" cy="24" r="12" class="m2"/><circle cx="40" cy="8" r="7" class="m3"/>${bar(20, 16, 24, 3.4)}`),
  'open:device': W(`${bar(18, 4, 28, 2.6)}${box(14, 10, 36, 19, 'p', 1.6)}${box(16, 12, 32, 15, 's', 1)}<rect x="10" y="29" width="44" height="2" rx="1" class="t"/>`),
  'close:classic': W(`${bar(16, 11, 32, 3.4)}${bar(22, 17, 20)}<rect x="24" y="23" width="16" height="5" rx="2.5" class="a"/>`),
  'close:split': W(`${bar(6, 12, 24, 3.4)}${bar(6, 18, 18)}<rect x="6" y="23" width="12" height="4" rx="2" class="a"/><circle cx="46" cy="18" r="8" class="p"/><circle cx="46" cy="18" r="3.5" class="a"/>`),
  'close:cards': W(`${bar(18, 5, 28, 3)}${box(6, 12, 15, 18)}${box(24.5, 12, 15, 18, 's')}${box(43, 12, 15, 18)}`),
  'close:finale': W(`${[0, 30, 60, 90, 120, 150].map((d) => `<rect x="31" y="2" width="2" height="32" rx="1" class="r" transform="rotate(${d} 32 18)"/>`).join('')}<circle cx="32" cy="18" r="6" class="a"/>`),
  'features:grid': W(`${box(8, 5, 22, 12)}${box(34, 5, 22, 12)}${box(8, 19, 22, 12)}${box(34, 19, 22, 12, 's')}`),
  'features:bento': W(`${box(6, 5, 30, 26, 's')}${box(39, 5, 19, 12)}${box(39, 19, 19, 12)}`),
  'features:stack': W(`${box(20, 4, 28, 18, 'p')}${box(16, 9, 32, 18, 'p')}${box(12, 14, 36, 18, 's')}`),
  'features:carousel': W(`${box(-6, 9, 16, 18, 'p')}${box(16, 5, 32, 26, 's')}${box(54, 9, 16, 18, 'p')}`),
  'stats:row': W(`${[8, 26, 44].map((x) => `${bar(x, 12, 12, 6, true)}${bar(x, 21, 12, 2)}`).join('')}`),
  'stats:burst': W(`${bar(18, 10, 28, 10, true)}${bar(24, 23, 16, 2)}<circle cx="8" cy="8" r="2.5" class="t"/><circle cx="56" cy="28" r="3" class="t"/><circle cx="54" cy="7" r="1.8" class="t"/>`),
  'statement:editorial': W(`<text x="6" y="14" class="q">“</text>${bar(14, 10, 40, 3)}${bar(14, 16, 36, 3)}${bar(14, 22, 26, 3)}${bar(14, 28, 10, 1.8, true)}`),
  'statement:kinetic': W(`${bar(8, 6, 20, 7)}${bar(30, 6, 26, 7, true)}${bar(14, 16, 36, 7)}${bar(8, 26, 28, 5)}`),
  'statement:marquee': W(`${bar(-4, 8, 72, 6)}${bar(-12, 16, 80, 6, true)}${bar(-2, 24, 70, 6)}`),
  'callout:classic': W(`${box(8, 6, 40, 24, 's', 1.6)}<circle cx="34" cy="16" r="5" class="ring"/><rect x="40" y="20" width="18" height="9" rx="2" class="a"/>`),
  'callout:split': W(`${bar(4, 12, 20, 3)}${bar(4, 18, 16)}${box(28, 6, 32, 24, 's', 1.6)}<circle cx="44" cy="18" r="4.5" class="ring"/>`),
};

export function layoutWire(kind: string, id: string): string {
  return WIRES[`${kind}:${id}`] || W(`${bar(14, 13, 36, 3.4)}${bar(20, 19, 24)}`);
}

// ─── Look previews ─────────────────────────────────────────────────────────────────────────
/** The backgrounds every picker shows up front; the rest of the catalogue folds under "More". */
export const CORE_ATMOSPHERES = ['none', 'schedule', 'aurora', 'mesh', 'particles', 'grid', 'waves'];

export function atmospherePreview(id: string): string {
  if (id === 'none') return `<span class="lk-atm is-none" aria-hidden="true"><i></i></span>`;
  return `<span class="lk-atm" data-atm-tile="${escapeHtml(id)}" aria-hidden="true"><canvas width="160" height="90" data-atm="${escapeHtml(id)}"></canvas></span>`;
}

export const DEPTH_HINT: Record<string, string> = { flat: 'No shadow, no tilt — clean and graphic', soft: 'A gentle lift off the background', deep: 'Tilted cards and long shadows' };
export const ENERGY_HINT: Record<string, string> = { calm: 'Slower unfold, long settles', clear: 'Balanced, every beat reads', punchy: 'Snappy reveals with a kick' };

export function revealPreview(id: string): string {
  return `<span class="lk-stage lk-rv rv-${escapeHtml(id)}" aria-hidden="true"><span class="w">${chars('Launch')}</span></span>`;
}

export function depthPreview(id: string): string {
  return `<span class="lk-stage lk-depth d-${escapeHtml(id)}" aria-hidden="true"><i class="k k1"></i><i class="k k2"></i><i class="k k3"></i></span>`;
}

export function energyPreview(id: string): string {
  return `<span class="lk-stage lk-energy e-${escapeHtml(id)}" aria-hidden="true"><i style="--i:0"></i><i style="--i:1"></i><i style="--i:2"></i></span>`;
}

export function sheenPreview(on: boolean): string {
  return `<span class="lk-stage lk-sheen${on ? ' is-on' : ''}" aria-hidden="true"><b>Aa</b></span>`;
}

// ─── Transitions ───────────────────────────────────────────────────────────────────────────
export function transitionPreview(id: string): string {
  const slices = id === 'slice' ? '<i class="s"></i><i class="s"></i><i class="s"></i><i class="s"></i>' : '';
  return `<span class="lk-stage lk-tr tr-${escapeHtml(id)}" aria-hidden="true"><i class="pa">A</i><i class="pb">B${slices}</i></span>`;
}

// ─── Camera ────────────────────────────────────────────────────────────────────────────────
const UI = `<i class="ui-bar"></i><i class="ui-side"></i><i class="ui-card c1"></i><i class="ui-card c2"></i><i class="ui-btn"></i>`;

export function zoomPreview(id: string): string {
  return `<span class="lk-stage lk-zoom z-${escapeHtml(id)}" aria-hidden="true"><span class="scr">${UI}</span></span>`;
}

/** The easing curve plotted, with a dot that rides it on hover. `css` is a cubic-bezier(). */
export function curvePreview(css: string | undefined): string {
  const m = /cubic-bezier\(([^)]+)\)/.exec(css || '');
  const [x1, y1, x2, y2] = (m?.[1] || '.25,1,.5,1').split(',').map((n) => Number(n.trim()));
  const P = (x: number, y: number) => `${(6 + x * 52).toFixed(2)} ${(31 - y * 26).toFixed(2)}`;
  const d = `M${P(0, 0)} C${P(x1 ?? 0.25, y1 ?? 1)} ${P(x2 ?? 0.5, y2 ?? 1)} ${P(1, 1)}`;
  return `<span class="lk-stage lk-curve" style="--ease:${escapeHtml(css || 'ease')}" aria-hidden="true"><svg viewBox="0 0 64 36"><path d="M6 31H58M6 31V5" class="ax"/><path d="${d}" class="cv"/></svg><i class="dot"></i></span>`;
}

export function motionLengthPreview(scale: number): string {
  return `<span class="lk-stage lk-len" style="--dur:${(1.1 * scale).toFixed(2)}s" aria-hidden="true"><i class="trk"></i><i class="dot"></i></span>`;
}

// ─── Cursor & pace ─────────────────────────────────────────────────────────────────────────
const CURSOR_SVG: Record<string, string> = {
  classic: `<svg viewBox="0 0 16 20"><path d="M1.5 1.5v14.2l3.6-3.4 2.4 5.6 2.5-1.1-2.4-5.5h5z" fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
  arrow: `<svg viewBox="0 0 16 20"><path d="M2 2l11 6.2-4.6 1.4L6.6 14z" fill="#111" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
  dot: `<svg viewBox="0 0 16 20"><circle cx="8" cy="10" r="5.2" fill="rgba(255,255,255,.92)" stroke="rgba(0,0,0,.55)" stroke-width="1"/></svg>`,
};

/**
 * Feature focus on the same screen the camera tiles use, so each treatment reads before it is picked.
 * Guided: the pointer and the loupe travel together from one feature to the next.
 * Spotlight: the loupe stays on the proof and the rest of the screen falls dark.
 * Ring: no loupe — a ring settles on the feature.
 */
export function focusPreview(id: string): string {
  const screen = `<span class="scr">${UI}</span>`;
  if (id === 'spotlight') {
    return `<span class="lk-stage lk-focus f-spotlight" aria-hidden="true">${screen}<i class="spot"></i><i class="cur">${CURSOR_SVG['classic']}</i></span>`;
  }
  if (id === 'ring') {
    return `<span class="lk-stage lk-focus f-ring" aria-hidden="true">${screen}<i class="ring"></i></span>`;
  }
  return `<span class="lk-stage lk-focus f-guided" aria-hidden="true">${screen}<svg class="trail" viewBox="0 0 64 36"><path d="M23 13C34 9 40 18 44 23"/></svg><i class="lens"></i><i class="cur">${CURSOR_SVG['classic']}</i></span>`;
}

export function cursorPreview(style: string, size = 'm'): string {
  const scale = size === 's' ? 0.8 : size === 'l' ? 1.25 : 1;
  return `<span class="lk-stage lk-cursor" style="--cs:${scale}" aria-hidden="true"><span class="scr">${UI}</span><i class="ripple"></i><i class="cur">${CURSOR_SVG[style] || CURSOR_SVG['classic']}</i></span>`;
}

export function pacePreview(tempo: number): string {
  return `<span class="lk-stage lk-pace" style="--beat:${(2.6 / Math.max(0.4, tempo)).toFixed(2)}s" aria-hidden="true"><span class="scr">${UI}</span><i class="cur">${CURSOR_SVG['classic']}</i></span>`;
}

// ─── Brand ─────────────────────────────────────────────────────────────────────────────────
/** CSS colours only — a value that is not one never reaches a style attribute. */
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]+)$/i;
const colour = (v: string | undefined, fallback: string) => (v && COLOR.test(v.trim()) ? v.trim() : fallback);

const SCALE_FALLBACK: Record<string, string> = { ink: '#0b0e12', surface: '#1b2028', gold: '#42f272', amber: '#ffb648', teal: '#3cc8e8' };

const scaleVars = (colors: Record<string, string | undefined>) =>
  Object.entries(SCALE_FALLBACK)
    .map(([role, fb]) => `--${role}:${colour(colors[role], fb)}`)
    .join(';');

/**
 * A colour scale as the plate it paints: ink ground, a surface card, the accent headline and
 * button, secondary and support as glows. The roles run along the foot as swatches.
 */
export function scalePreview(colors: Record<string, string | undefined>, roles: Array<{ id: string; label: string }>): string {
  const swatches = roles
    .map((r) => `<i style="--swatch:${colour(colors[r.id], 'transparent')}" title="${escapeHtml(r.label)}"></i>`)
    .join('');
  return `<span class="lk-stage lk-scale" style="${scaleVars(colors)}" aria-hidden="true"><i class="sc-glow g1"></i><i class="sc-glow g2"></i><i class="sc-card"><i class="sc-h"></i><i class="sc-l"></i><i class="sc-btn"></i></i><span class="scale-swatches">${swatches}</span></span>`;
}

// ─── Frame ─────────────────────────────────────────────────────────────────────────────────
export interface FrameLook {
  frame?: string | undefined;
  background?: string | undefined;
  padding?: string | undefined;
  corners?: string | undefined;
  shadow?: string | undefined;
}

/** The recording as it sits in the video: full bleed, or an inset window on a brand ground. */
export function framePreview(look: FrameLook, colors: Record<string, string | undefined> = {}): string {
  const attrs = (['frame', 'background', 'padding', 'corners', 'shadow'] as const)
    .map((k) => `data-${k}="${escapeHtml(look[k] || '')}"`)
    .join(' ');
  return `<span class="lk-stage lk-frame" ${attrs} style="${scaleVars(colors)}" aria-hidden="true"><span class="scr">${UI}</span></span>`;
}

/** A background chip for the inset frame: brand glow, flat ink, or accent to secondary. */
export function groundPreview(id: string, colors: Record<string, string | undefined> = {}): string {
  return `<span class="lk-stage lk-ground" data-background="${escapeHtml(id)}" style="${scaleVars(colors)}" aria-hidden="true"><i></i></span>`;
}

// ─── Live cards ────────────────────────────────────────────────────────────────────────────
/** A chapter card in each preset's manner: type weight, the panel and how loud the accent is. */
export function cardPresetPreview(id: string): string {
  return `<span class="lk-stage lk-card p-${escapeHtml(id)}" aria-hidden="true"><span class="cd"><i class="cd-k"></i><i class="cd-t"></i><i class="cd-s"></i></span></span>`;
}

/** Where the caption sits over the take, and which way its text runs. */
export function seatPreview(seat: string, align = 'left'): string {
  return `<span class="lk-stage lk-seat s-${escapeHtml(seat)} a-${escapeHtml(align)}" aria-hidden="true"><span class="scr">${UI}</span><span class="cap"><i></i><i></i></span></span>`;
}

// ─── Recording ─────────────────────────────────────────────────────────────────────────────
/** A capture size as its screen: proportions to scale, a notch for phones. */
export function devicePreview(width: number, height: number, mobile = false): string {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const fit = Math.min(52 / w, 30 / h);
  const style = `--dw:${((w * fit) / 64) * 100}%;--dh:${((h * fit) / 36) * 100}%`;
  return `<span class="lk-stage lk-device${mobile || h > w ? ' is-phone' : ''}" style="${style}" aria-hidden="true"><span class="dv"><span class="scr">${UI}</span></span></span>`;
}

/** The finished video's shape: 16:9 or 9:16. */
export function shapePreview(format: string): string {
  return `<span class="lk-stage lk-shape ${format === 'portrait' ? 'is-portrait' : 'is-landscape'}" aria-hidden="true"><span class="sh"><i></i></span></span>`;
}

// ─── Timing ────────────────────────────────────────────────────────────────────────────────
export interface TimingBarModel {
  baseDur: number;
  from: number;
  to: number;
  holdAt: number;
  hold: number;
  rate: number;
  dur: number;
}

/**
 * The plate's own clock as a strip: the trimmed head and tail greyed out, the settled frame
 * marked, and the hold drawn as a hatched stretch spliced in. Widths are output seconds.
 */
export function timingBar(m: TimingBarModel): string {
  const head = (m.holdAt - m.from) / m.rate;
  const tail = (m.to - m.holdAt) / m.rate;
  const cutHead = m.from / m.rate;
  const cutTail = (m.baseDur - m.to) / m.rate;
  const total = Math.max(0.01, cutHead + head + m.hold + tail + cutTail);
  const pct = (s: number) => `${((s / total) * 100).toFixed(3)}%`;
  const seg = (cls: string, s: number, label = '') => (s > 0.001 ? `<i class="tb-${cls}" style="flex-basis:${pct(s)}">${label ? `<span>${label}</span>` : ''}</i>` : '');
  return `<div class="tb" aria-hidden="true">${seg('cut', cutHead)}${seg('play', head, 'Intro')}${seg('hold', m.hold, `Hold ${m.hold.toFixed(1)}s`)}${seg('play tail', tail, 'Exit')}${seg('cut', cutTail)}</div>`;
}
