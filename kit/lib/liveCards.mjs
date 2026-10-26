/**
 * Live chapter cards + caption panels — kit templates filled like plates.
 * Recording injects the fragment; Studio writes full HTML previews under out/overlays/.
 *
 * Config: video.config.json → direction.overlays
 *   preset?: plateMatch | editorial | punchy | minimal | spotlight
 *   chapter?: { atmosphere, energy, sheen, ghost, blobs, rail, backdrop, backdropOpacity }
 *   caption?: { atmosphere, energy, sheen, seat, maxWidth, bottom, inset, align, backdrop, backdropOpacity }
 *
 *   chapters?: { [chapterNo]: { chapter?: { atmosphere, backdrop, backdropOpacity },
 *                               caption?: { atmosphere, backdrop, backdropOpacity } } }
 *
 * `backdrop` is the solid fill painted *behind* the atmosphere: `auto` picks black or white from
 * the brand (white when the ink is light, black when it is dark) so the card stays opaque and
 * the take never shows through, `none` is fully transparent, a brand role (ink · surface · gold ·
 * amber · teal) or a #hex picks a colour; `backdropOpacity` (0–100) is how solid that colour is.
 *
 * `chapters` holds a chapter's own background (atmosphere + backdrop) for its chapter card and the
 * captions inside it; keys not listed there follow the video-wide slot. Studio's Look & reveal
 * writes here by default and "Apply to all chapters" promotes a chapter's trio to the video.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  captionMotionTiming,
  chapterMotionTiming,
  clampCardHoldMs,
  defaultCardHoldMs,
} from './shared/cardMotion.js';
import { loadCardMarks, pairCallsToMarks } from './cardMarks.mjs';
import { atmosphereSnippet } from './atmosphere.mjs';
import { ATMOSPHERE_IDS, ATMOSPHERE_LABELS, resolveMotion } from './plateMotion.mjs';
import { DELIVERY, outputFrame } from './format.mjs';
import { TEMPLATES } from './project.mjs';
import { parseFlowCalls } from './script.mjs';
import { esc } from './text.mjs';
import { copyContext, copyContextFor, copyCorpus, normalizeCopy } from './copyCase.mjs';

/** Plate WebGL fields, plus the CSS-only blob wash. `none` is a flat brand field. */
export const OVERLAY_ATMOSPHERES = Object.freeze([...ATMOSPHERE_IDS, 'blobs']);
export const OVERLAY_ATMOSPHERE_CHOICES = Object.freeze(
  OVERLAY_ATMOSPHERES.map((id) => ({
    id,
    label: id === 'blobs' ? 'Blobs · soft wash' : ATMOSPHERE_LABELS[id] || id,
  }))
);
export const OVERLAY_SEATS = Object.freeze(['bottom-center', 'bottom-left', 'bottom-right']);
export const OVERLAY_ALIGNS = Object.freeze(['left', 'center']);
export const OVERLAY_ENERGIES = Object.freeze(['calm', 'clear', 'punchy']);
/** Brand roles a card backdrop can name (resolved against brand.colors at fill time). */
export const OVERLAY_BACKDROP_ROLES = Object.freeze(['ink', 'surface', 'gold', 'amber', 'teal']);
/** Fixed backdrop choices; a `#rrggbb` custom colour is also accepted. */
export const OVERLAY_BACKDROPS = Object.freeze(['auto', 'none', ...OVERLAY_BACKDROP_ROLES]);
export const OVERLAY_BACKDROP_CHOICES = Object.freeze([
  { id: 'auto', label: 'Auto', hint: 'Black or white from the brand ink, solid behind the card so the take never shows through' },
  { id: 'none', label: 'None', hint: 'Transparent — only the atmosphere and copy sit over the take' },
  { id: 'ink', label: 'Ink' },
  { id: 'surface', label: 'Surface' },
  { id: 'gold', label: 'Accent' },
  { id: 'amber', label: 'Secondary' },
  { id: 'teal', label: 'Support' },
  { id: 'custom', label: 'Custom…', hint: 'Pick any colour with the swatch' },
]);
const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
/** The look keys a single chapter may own (its background); everything else is video-wide. */
export const PER_CHAPTER_LOOK_KEYS = Object.freeze(['atmosphere', 'backdrop', 'backdropOpacity']);
const CARD_SLOTS = Object.freeze(['chapter', 'caption']);

/** Positive chapter number from Studio / CLI input, or null. */
function chapterKey(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 999 ? String(n) : null;
}

/** One chapter's own look for one slot, validated; null when nothing survives. */
function sanitizeChapterSlot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  if (OVERLAY_ATMOSPHERES.includes(raw.atmosphere)) out.atmosphere = raw.atmosphere;
  const bd = normalizeBackdrop(raw.backdrop);
  if (bd) out.backdrop = bd;
  if (raw.backdropOpacity != null && Number.isFinite(Number(raw.backdropOpacity))) {
    out.backdropOpacity = clampNum(raw.backdropOpacity, 100, 0, 100);
  }
  return Object.keys(out).length ? out : null;
}

/** `overlays.chapters` with every row validated and empty rows dropped; undefined when empty. */
export function sanitizeChapterLooks(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out = {};
  for (const [k, row] of Object.entries(raw)) {
    const key = chapterKey(k);
    if (!key || !row || typeof row !== 'object') continue;
    const entry = {};
    for (const slot of CARD_SLOTS) {
      const clean = sanitizeChapterSlot(row[slot]);
      if (clean) entry[slot] = clean;
    }
    if (Object.keys(entry).length) out[key] = entry;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Normalise a backdrop value: a known choice or a `#rrggbb` colour; null when invalid. */
export function normalizeBackdrop(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim().toLowerCase();
  if (OVERLAY_BACKDROPS.includes(s)) return s;
  if (HEX_COLOR.test(s)) return s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s;
  return null;
}

/** Named looks — expand into chapter + caption defaults (video may still override keys). */
export const OVERLAY_PRESETS = Object.freeze({
  plateMatch: {
    label: 'Match plates',
    hint: 'Inherit atmosphere, energy and sheen from direction.motion',
    chapter: { inheritMotion: true, ghost: true, blobs: true, rail: true },
    caption: { inheritMotion: true, seat: 'bottom-center', maxWidth: 560, bottom: 40, align: 'left' },
  },
  editorial: {
    label: 'Editorial',
    hint: 'Calm waves, centered captions, quiet chapter field',
    chapter: { atmosphere: 'waves', energy: 'calm', sheen: true, ghost: true, blobs: false, rail: true },
    caption: { atmosphere: 'waves', energy: 'calm', sheen: true, seat: 'bottom-center', maxWidth: 600, bottom: 48, align: 'left' },
  },
  punchy: {
    label: 'Punchy',
    hint: 'Snappy entrances, deep wave field, bright sheen',
    chapter: { atmosphere: 'waves', energy: 'punchy', sheen: true, ghost: true, blobs: true, rail: true },
    caption: { atmosphere: 'waves', energy: 'punchy', sheen: true, seat: 'bottom-center', maxWidth: 540, bottom: 36, align: 'left' },
  },
  minimal: {
    label: 'Minimal',
    hint: 'No atmosphere ornaments — solid brand field, classic lower-left caption',
    chapter: { atmosphere: 'none', energy: 'calm', sheen: false, ghost: false, blobs: false, rail: false },
    caption: { atmosphere: 'none', energy: 'calm', sheen: false, seat: 'bottom-left', maxWidth: 480, bottom: 40, align: 'left' },
  },
  spotlight: {
    label: 'Spotlight',
    hint: 'Mesh chapter wash, wide centered caption',
    chapter: { atmosphere: 'mesh', energy: 'clear', sheen: true, ghost: true, blobs: true, rail: true },
    caption: { atmosphere: 'waves', energy: 'clear', sheen: true, seat: 'bottom-center', maxWidth: 640, bottom: 44, align: 'center' },
  },
});

export const OVERLAY_PRESET_IDS = Object.freeze(Object.keys(OVERLAY_PRESETS));

const fill = (tpl, values) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (values[k] != null ? String(values[k]) : ''));

const escAttr = (s) => esc(s).replace(/\n/g, '&#10;');

/** Eyebrow line and the big ghost number for chapter `chapterNo` (1-based), plus saved overrides. */
export function chapterChrome(chapterNo, copy = {}) {
  const fallback = String(Math.max(1, Number(chapterNo) || 1)).padStart(2, '0');
  const num = String(copy?.num ?? '').trim().slice(0, 8) || fallback;
  const kicker = String(copy?.kicker ?? '').trim().slice(0, 48) || `Chapter ${fallback}`;
  return { num, kicker, fallback };
}

function cardCopyMap(video) {
  const raw = video?.config?.liveCardCopy;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

/** Saved eyebrow / ghost number for one flow call, or null when the card still uses the defaults. */
function cardCopyFor(video, flowIndex) {
  const row = cardCopyMap(video)[String(flowIndex)];
  return row && typeof row === 'object' ? row : null;
}

const onOff = (v, fallback = true) => {
  if (v === undefined || v === null || v === '') return fallback ? '1' : '0';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (['on', 'true', '1', 'yes'].includes(String(v).toLowerCase())) return '1';
  if (['off', 'false', '0', 'no'].includes(String(v).toLowerCase())) return '0';
  return fallback ? '1' : '0';
};

const boolFrom = (v, fallback = true) => onOff(v, fallback) === '1';

let cachedCss = null;
function overlayCss() {
  if (cachedCss == null) cachedCss = readFileSync(join(TEMPLATES, 'overlays.css'), 'utf8');
  return cachedCss;
}

function palette(brand) {
  const c = brand.colors || {};
  return {
    ink: c.ink,
    surface: c.surface || c.ink,
    gold: c.gold,
    amber: c.amber,
    teal: c.teal || c.amber,
    text: c.text || '#f8fafc',
    muted: c.muted || '#94a3b8',
    onAccent: c.onAccent || '#111',
    font: brand.font?.family || 'Inter',
    fontCss: brand.font?.css || '',
  };
}

function waveFieldMarkup(p, id, { rings = 9 } = {}) {
  const ellipses = Array.from({ length: rings }, (_, i) => {
    const t = i / Math.max(1, rings - 1);
    const rx = (14 + i * 7.2).toFixed(1);
    const ry = (8.5 + i * 4.4).toFixed(1);
    const op = (0.78 - t * 0.55).toFixed(2);
    const sw = (0.28 + (i % 4 === 0 ? 0.22 : 0)).toFixed(2);
    return `<ellipse cx="50" cy="52" rx="${rx}" ry="${ry}" fill="none" stroke="url(#${id})" stroke-width="${sw}" opacity="${op}"/>`;
  }).join('');
  return `<svg class="wave-field" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="${id}" x1="8%" y1="12%" x2="92%" y2="88%">
        <stop offset="0%" stop-color="${p.gold}"/>
        <stop offset="55%" stop-color="${p.amber}"/>
        <stop offset="100%" stop-color="${p.gold}"/>
      </linearGradient>
    </defs>
    <g class="wave-rings">${ellipses}</g>
  </svg>`;
}

/** WebGL plate field for a card, or empty strings when the slot stays a CSS wash (`none`, `blobs`). */
function cardField(brand, atmosphere, kind, frame = DELIVERY) {
  if (!atmosphere || atmosphere === 'none' || atmosphere === 'blobs' || !ATMOSPHERE_IDS.includes(atmosphere)) {
    return { FIELD: '', FIELD_SCRIPT: '' };
  }
  const motion = resolveMotion(brand);
  const same = motion.atmosphere === atmosphere;
  const tuned = same && Number.isFinite(motion.atmosphereOpacity) ? motion.atmosphereOpacity : 0;
  const snippet = atmosphereSnippet(brand, {
    id: atmosphere,
    // A caption is a small panel, so the field needs more presence than a full-frame plate.
    opacity: Math.max(kind === 'caption' ? 0.72 : 0, tuned) || undefined,
    speed: same && Number.isFinite(motion.atmosphereSpeed) ? motion.atmosphereSpeed : undefined,
    local: true,
    hooks: false,
    // A caption field is panel-sized; a chapter field covers the delivered frame.
    width: kind === 'caption' ? 1200 : frame.width,
    height: kind === 'caption' ? 420 : frame.height,
  });
  return { FIELD: snippet.markup, FIELD_SCRIPT: snippet.script };
}

/** Rec. 709 luma, 0–255. Same threshold the plate type uses for light ink. */
function channelLuma(hex) {
  const n = parseInt(String(hex || '').replace('#', ''), 16);
  if (!Number.isFinite(n)) return 0;
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

/**
 * Solid paper behind a card when the backdrop is Auto.
 * A light brand ink (white plates) gets white; a dark ink gets black.
 */
export function autoBackdropHex(ink) {
  return channelLuma(ink) > 160 ? '#ffffff' : '#000000';
}

/**
 * Resolve a slot's backdrop to template tokens.
 * `mode` drives the CSS (`data-backdrop`): `auto` paints black or white from the brand,
 * `none` clears it, `color` paints the chosen role or hex. `--wt-backdrop` is an rgba()
 * so the opacity bakes into the colour and never fights the reveal animations.
 */
export function resolveBackdrop(slot, p) {
  const choice = normalizeBackdrop(slot?.backdrop) || 'auto';
  const alpha = clampNum(slot?.backdropOpacity, 100, 0, 100) / 100;
  if (choice === 'none') return { mode: 'none', color: 'transparent', hex: null, alpha };
  const hex =
    choice === 'auto'
      ? autoBackdropHex(p?.ink)
      : OVERLAY_BACKDROP_ROLES.includes(choice)
        ? normalizeBackdrop(p?.[choice]) || autoBackdropHex(p?.ink)
        : choice;
  const n = parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return {
    mode: choice === 'auto' ? 'auto' : 'color',
    hex,
    alpha,
    color: `rgba(${rgb.join(', ')}, ${Number(alpha.toFixed(3))})`,
  };
}

function brandTokens(p) {
  return {
    FONT: p.font,
    INK: p.ink,
    SURFACE: p.surface,
    GOLD: p.gold,
    AMBER: p.amber,
    TEXT: p.text,
    MUTED: p.muted,
    ON_ACCENT: p.onAccent,
    OVERLAY_CSS: overlayCss(),
  };
}

/**
 * Resolve direction.overlays (+ optional preset) against plate motion inheritance.
 * Returns { preset, chapter, caption, chapters?, catalog } for Studio + fill. With `chapterNo`,
 * `chapter`/`caption` are that chapter's effective slots (its own background laid over the video
 * look) and `scope` lists which keys came from the chapter.
 */
export function resolveOverlays(brand, direction = {}, { chapterNo } = {}) {
  const raw = direction.overlays && typeof direction.overlays === 'object' ? direction.overlays : {};
  const presetId = OVERLAY_PRESET_IDS.includes(raw.preset) ? raw.preset : 'plateMatch';
  const preset = OVERLAY_PRESETS[presetId];
  const motion = resolveMotion(brand);

  const inherit = (slot) => {
    const base = { ...(preset[slot] || {}) };
    const overlay = raw[slot] && typeof raw[slot] === 'object' ? raw[slot] : {};
    const merged = { ...base, ...overlay };
    if (merged.inheritMotion || (!merged.atmosphere && base.inheritMotion)) {
      merged.atmosphere = OVERLAY_ATMOSPHERES.includes(overlay.atmosphere)
        ? overlay.atmosphere
        : OVERLAY_ATMOSPHERES.includes(motion.atmosphere)
          ? motion.atmosphere
          : 'waves';
      merged.energy = OVERLAY_ENERGIES.includes(overlay.energy)
        ? overlay.energy
        : OVERLAY_ENERGIES.includes(motion.energy)
          ? motion.energy
          : 'clear';
      if (overlay.sheen === undefined && base.sheen === undefined) merged.sheen = motion.sheen !== false;
    }
    if (!OVERLAY_ATMOSPHERES.includes(merged.atmosphere)) merged.atmosphere = 'waves';
    if (!OVERLAY_ENERGIES.includes(merged.energy)) merged.energy = 'clear';
    // Drop the inherit flag from the public look object.
    delete merged.inheritMotion;
    return merged;
  };

  const chapter = inherit('chapter');
  chapter.ghost = boolFrom(chapter.ghost, true);
  chapter.blobs = boolFrom(chapter.blobs, true);
  chapter.rail = boolFrom(chapter.rail, true);
  chapter.sheen = boolFrom(chapter.sheen, true);
  chapter.backdrop = normalizeBackdrop(chapter.backdrop) || 'auto';
  chapter.backdropOpacity = clampNum(chapter.backdropOpacity, 100, 0, 100);

  const caption = inherit('caption');
  caption.sheen = boolFrom(caption.sheen, true);
  caption.backdrop = normalizeBackdrop(caption.backdrop) || 'auto';
  caption.backdropOpacity = clampNum(caption.backdropOpacity, 100, 0, 100);
  caption.seat = OVERLAY_SEATS.includes(caption.seat) ? caption.seat : 'bottom-center';
  caption.align = OVERLAY_ALIGNS.includes(caption.align) ? caption.align : 'left';
  caption.maxWidth = clampNum(caption.maxWidth, 560, 360, 800);
  caption.bottom = clampNum(caption.bottom, 40, 16, 120);
  caption.inset = clampNum(caption.inset, 40, 16, 120);

  const chapters = sanitizeChapterLooks(raw.chapters);
  const key = chapterKey(chapterNo);
  const scope = { chapter: [], caption: [] };
  if (key) {
    const own = chapters?.[key] || {};
    for (const [slot, dest] of [['chapter', chapter], ['caption', caption]]) {
      for (const k of PER_CHAPTER_LOOK_KEYS) {
        if (own[slot]?.[k] === undefined) continue;
        dest[k] = own[slot][k];
        scope[slot].push(k);
      }
    }
  }

  return {
    preset: presetId,
    /** The colour Auto paints, so Studio can show the pick without re-deriving it. */
    paper: autoBackdropHex(palette(brand).ink),
    chapter,
    caption,
    ...(chapters ? { chapters } : {}),
    ...(key ? { chapterNo: Number(key), scope } : {}),
    catalog: {
      presets: OVERLAY_PRESET_IDS.map((id) => ({ id, ...OVERLAY_PRESETS[id] })),
      atmospheres: OVERLAY_ATMOSPHERE_CHOICES,
      seats: OVERLAY_SEATS,
      aligns: OVERLAY_ALIGNS,
      energies: OVERLAY_ENERGIES,
      backdrops: OVERLAY_BACKDROP_CHOICES,
    },
  };
}

function clampNum(v, fallback, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** Slots named by a patch: `slot: 'chapter'|'caption'`, or both when absent. */
function patchSlots(patch) {
  if (patch.slot == null) return CARD_SLOTS;
  if (!CARD_SLOTS.includes(patch.slot)) throw new Error(`overlays slot must be one of ${CARD_SLOTS.join(', ')}`);
  return [patch.slot];
}

/** Write `chapters` back without empty rows (undefined removes the key from the saved config). */
function setChapterLooks(next, chapters) {
  const clean = sanitizeChapterLooks(chapters);
  if (clean) next.chapters = clean;
  else delete next.chapters;
  return next;
}

/**
 * Per-chapter patch: `{ chapterNo, chapter?: {…}, caption?: {…} }` where each slot holds only the
 * background trio (null returns a key to the video look). Values are validated like the video's.
 */
function patchChapterLook(next, patch) {
  const key = chapterKey(patch.chapterNo);
  if (!key) throw new Error('overlays.chapterNo must be a chapter number (1-based)');
  const chapters = { ...(next.chapters || {}) };
  const row = { ...(chapters[key] || {}) };
  for (const slot of CARD_SLOTS) {
    if (!(slot in patch) || patch[slot] == null) continue;
    if (typeof patch[slot] !== 'object') throw new Error(`overlays.${slot} must be an object`);
    const dest = { ...(row[slot] || {}) };
    for (const [k, v] of Object.entries(patch[slot])) {
      if (!PER_CHAPTER_LOOK_KEYS.includes(k)) {
        throw new Error(`overlays.${slot}.${k} is a video-wide setting; only ${PER_CHAPTER_LOOK_KEYS.join(', ')} are saved per chapter`);
      }
      if (v === null || v === '') {
        delete dest[k];
        continue;
      }
      if (k === 'atmosphere') {
        if (!OVERLAY_ATMOSPHERES.includes(v)) throw new Error(`overlays.${slot}.atmosphere must be one of ${OVERLAY_ATMOSPHERES.join(', ')}`);
        dest.atmosphere = v;
      } else if (k === 'backdrop') {
        const b = normalizeBackdrop(v);
        if (!b) throw new Error(`overlays.${slot}.backdrop must be one of ${OVERLAY_BACKDROPS.join(', ')} or a #rrggbb colour`);
        dest.backdrop = b;
      } else dest.backdropOpacity = clampNum(v, 100, 0, 100);
    }
    if (Object.keys(dest).length) row[slot] = dest;
    else delete row[slot];
  }
  if (Object.keys(row).length) chapters[key] = row;
  else delete chapters[key];
  return setChapterLooks(next, chapters);
}

/** `{ applyToAll, chapterNo, slot? }`: the chapter's effective background becomes the video's. */
function applyChapterLookToAll(next, patch) {
  const key = chapterKey(patch.chapterNo);
  if (!key) throw new Error('overlays.chapterNo must be a chapter number (1-based)');
  const slots = patchSlots(patch);
  const chapters = { ...(next.chapters || {}) };
  const own = chapters[key] || {};
  for (const slot of slots) {
    const dest = { ...next[slot] };
    for (const k of PER_CHAPTER_LOOK_KEYS) {
      const v = own[slot]?.[k];
      if (v === undefined) continue; // the chapter already followed the video for this key
      // Same normalisation as a video-wide write: defaults are dropped, not stored.
      if (k === 'backdrop') {
        if (v === 'auto') delete dest.backdrop;
        else dest.backdrop = v;
      } else if (k === 'backdropOpacity') {
        if (v === 100) delete dest.backdropOpacity;
        else dest.backdropOpacity = v;
      } else dest[k] = v;
    }
    next[slot] = dest;
    // Every chapter follows the new video look for this slot's background.
    for (const [ck, row] of Object.entries(chapters)) {
      const rest = { ...row };
      delete rest[slot];
      if (Object.keys(rest).length) chapters[ck] = rest;
      else delete chapters[ck];
    }
  }
  return setChapterLooks(next, chapters);
}

/** `{ reset, chapterNo, slot? }`: the chapter follows the video look again. */
function resetChapterLook(next, patch) {
  const key = chapterKey(patch.chapterNo);
  if (!key) throw new Error('overlays.chapterNo must be a chapter number (1-based)');
  const chapters = { ...(next.chapters || {}) };
  const row = { ...(chapters[key] || {}) };
  for (const slot of patchSlots(patch)) delete row[slot];
  if (Object.keys(row).length) chapters[key] = row;
  else delete chapters[key];
  return setChapterLooks(next, chapters);
}

/**
 * Validate and merge a patch onto direction.overlays (Studio / CLI).
 * Video-wide: `{ preset?, chapter?: {…}, caption?: {…} }`.
 * One chapter: `{ chapterNo, chapter?: {…}, caption?: {…} }` (background trio only),
 * `{ chapterNo, slot?, reset: true }` or `{ chapterNo, slot?, applyToAll: true }`.
 */
export function patchOverlays(current = {}, patch = {}) {
  const next = {
    ...(current && typeof current === 'object' ? current : {}),
    chapter: { ...(current?.chapter || {}) },
    caption: { ...(current?.caption || {}) },
  };
  if (patch.applyToAll) return applyChapterLookToAll(next, patch);
  if (patch.reset && patch.chapterNo != null) return resetChapterLook(next, patch);
  if (patch.chapterNo != null) return patchChapterLook(next, patch);
  if ('preset' in patch) {
    if (patch.preset == null || patch.preset === '') delete next.preset;
    else if (!OVERLAY_PRESET_IDS.includes(patch.preset)) throw new Error(`overlays.preset must be one of ${OVERLAY_PRESET_IDS.join(', ')}`);
    else next.preset = patch.preset;
  }
  for (const slot of ['chapter', 'caption']) {
    if (!(slot in patch) || patch[slot] == null) continue;
    if (patch[slot] === null) {
      next[slot] = {};
      continue;
    }
    if (typeof patch[slot] !== 'object') throw new Error(`overlays.${slot} must be an object`);
    const src = patch[slot];
    const dest = { ...next[slot] };
    if ('atmosphere' in src) {
      if (src.atmosphere == null) delete dest.atmosphere;
      else if (!OVERLAY_ATMOSPHERES.includes(src.atmosphere)) {
        throw new Error(`overlays.${slot}.atmosphere must be one of ${OVERLAY_ATMOSPHERES.join(', ')}`);
      } else dest.atmosphere = src.atmosphere;
    }
    if ('energy' in src) {
      if (src.energy == null) delete dest.energy;
      else if (!OVERLAY_ENERGIES.includes(src.energy)) {
        throw new Error(`overlays.${slot}.energy must be one of ${OVERLAY_ENERGIES.join(', ')}`);
      } else dest.energy = src.energy;
    }
    for (const key of ['sheen', 'ghost', 'blobs', 'rail']) {
      if (!(key in src)) continue;
      if (src[key] === null) delete dest[key];
      else dest[key] = boolFrom(src[key], true);
    }
    if ('backdrop' in src) {
      if (src.backdrop == null || src.backdrop === '' || src.backdrop === 'auto') delete dest.backdrop;
      else {
        const b = normalizeBackdrop(src.backdrop);
        if (!b) throw new Error(`overlays.${slot}.backdrop must be one of ${OVERLAY_BACKDROPS.join(', ')} or a #rrggbb colour`);
        dest.backdrop = b;
      }
    }
    if ('backdropOpacity' in src) {
      if (src.backdropOpacity === null) delete dest.backdropOpacity;
      else {
        const n = clampNum(src.backdropOpacity, 100, 0, 100);
        if (n === 100) delete dest.backdropOpacity;
        else dest.backdropOpacity = n;
      }
    }
    if (slot === 'caption') {
      if ('seat' in src) {
        if (src.seat == null) delete dest.seat;
        else if (!OVERLAY_SEATS.includes(src.seat)) throw new Error(`overlays.caption.seat must be one of ${OVERLAY_SEATS.join(', ')}`);
        else dest.seat = src.seat;
      }
      if ('align' in src) {
        if (src.align == null) delete dest.align;
        else if (!OVERLAY_ALIGNS.includes(src.align)) throw new Error(`overlays.caption.align must be one of ${OVERLAY_ALIGNS.join(', ')}`);
        else dest.align = src.align;
      }
      for (const [key, lo, hi] of [
        ['maxWidth', 360, 800],
        ['bottom', 16, 120],
        ['inset', 16, 120],
      ]) {
        if (!(key in src)) continue;
        if (src[key] === null) {
          delete dest[key];
          continue;
        }
        dest[key] = clampNum(src[key], dest[key] ?? (key === 'maxWidth' ? 560 : 40), lo, hi);
      }
    }
    next[slot] = dest;
  }
  return next;
}

/**
 * Fill a chapter or caption fragment for live capture (shadow-DOM injection).
 * @param {'chapter'|'caption'} kind
 */
export function renderLiveCardHtml(brand, kind, props = {}) {
  const direction = brand.direction || {};
  const chapterNo = Math.max(1, Number(props.chapterNo) || 1);
  // The chapter's own background (if saved) overrides the video look for its chapter + captions.
  const look = resolveOverlays(brand, direction, { chapterNo });
  const slot = kind === 'caption' ? look.caption : look.chapter;
  const p = palette(brand);
  const ms = clampCardHoldMs(props.ms, kind === 'chapter' ? 'chapter' : 'caption');
  const chrome = chapterChrome(chapterNo, props);
  const title = String(props.title || '');
  const body = String(props.body || '');
  const flowIndex = props.flowIndex != null ? String(props.flowIndex) : '';
  const tpl = readFileSync(join(TEMPLATES, kind === 'caption' ? 'caption.html' : 'chapter.html'), 'utf8');
  // Raw fields keep the authored text: flow titles are narration keys.
  const copy = props.copy || copyContextFor({ brand });
  const show = (s, role) => esc(normalizeCopy(s, role, copy));

  const backdrop = resolveBackdrop(slot, p);
  const common = {
    ...brandTokens(p),
    ...cardField(brand, slot.atmosphere, kind, props.frame),
    DURATION: (ms / 1000).toFixed(2),
    ATMOSPHERE: slot.atmosphere,
    ENERGY: slot.energy,
    SHEEN: onOff(slot.sheen, true),
    BACKDROP_MODE: backdrop.mode,
    BACKDROP: backdrop.color,
    NUM: chrome.num,
    NUM_RAW: escAttr(chrome.num),
    KICKER: show(chrome.kicker, 'eyebrow'),
    KICKER_RAW: escAttr(chrome.kicker),
    TITLE: show(title, 'title'),
    TITLE_RAW: escAttr(title),
    FLOW_INDEX: flowIndex,
  };

  if (kind === 'chapter') {
    const bodyBlock = body
      ? `<p class="body" data-edit="body" data-edit-kind="text" data-edit-raw="${escAttr(body)}">${show(body, 'body')}</p>`
      : '';
    return fill(tpl, {
      ...common,
      ...chapterMotionTiming(ms),
      GHOST: onOff(slot.ghost, true),
      BLOBS: onOff(slot.blobs, true),
      RAIL: onOff(slot.rail, true),
      WAVE_FIELD: waveFieldMarkup(p, `wtChWave${chapterNo}${flowIndex}`, { rings: 10 }),
      BODY_BLOCK: bodyBlock,
    });
  }

  const chapterTitle = String(props.chapterTitle || 'Getting started');
  const bodyBlock = body
    ? `<div class="body" data-edit="body" data-edit-kind="text" data-edit-raw="${escAttr(body)}">${show(body, 'body')}</div>`
    : '';
  return fill(tpl, {
    ...common,
    ...captionMotionTiming(ms),
    SEAT: slot.seat,
    CAP_ALIGN: slot.align,
    CAP_MAX: slot.maxWidth,
    CAP_BOTTOM: slot.bottom,
    CAP_INSET: slot.inset,
    EYEBROW: show(chapterTitle, 'eyebrow'),
    EYEBROW_RAW: escAttr(chapterTitle),
    WAVE_FIELD: waveFieldMarkup(p, `wtCapWave${chapterNo}${flowIndex}`, { rings: 7 }),
    BODY_BLOCK: bodyBlock,
  });
}

/**
 * On-screen hold for a flow call: the recorded mark (with `edit.cards` applied) wins — that is
 * what the timeline shows and what produce bakes; the authored holdMs only covers unrecorded takes.
 */
export function cardHoldMs(call, mark) {
  const kind = call.kind === 'chapter' ? 'chapter' : 'caption';
  const fromMark = mark && Number(mark.dur) > 0 ? Math.round(Number(mark.dur) * 1000) : null;
  return clampCardHoldMs(fromMark || call.holdMs || defaultCardHoldMs(kind), kind);
}

export function liveCardPaths(video) {
  const dir = join(video.out, 'overlays');
  return { dir, css: join(dir, 'overlays.css') };
}

/**
 * Flow indices at or above this belong to cards the Editor wrote rather than the script. They
 * have no `chapter()`/`say()` call to point at, so they take indices the flow can never reach.
 */
export const ADDED_CARD_BASE = 100000;

export function cardId(kind, flowIndex) {
  return `overlay:${kind === 'step' ? 'caption' : kind}:${flowIndex}`;
}

export function parseCardId(id) {
  const m = String(id || '').match(/^overlay:(chapter|caption):(\d+)$/);
  if (!m) return null;
  return { kind: m[1], flowIndex: Number(m[2]) };
}

/** Build Studio preview HTML for every chapter()/say() in flow.mjs. */
export function buildLiveCards(video) {
  const paths = liveCardPaths(video);
  mkdirSync(paths.dir, { recursive: true });
  copyFileSync(join(TEMPLATES, 'overlays.css'), paths.css);

  const flowPath = join(video.dir, 'flow.mjs');
  const flowCalls = existsSync(flowPath) ? parseFlowCalls(readFileSync(flowPath, 'utf8')) : [];
  const marks = loadCardMarks(video);
  // One pairing for every consumer: the card carries its mark's key so bake and Studio match by id.
  const markByCall = pairCallsToMarks(flowCalls, marks);
  const calls = [...flowCalls];
  // Cards the Editor wrote. They have no flow call, so one is made up for them — above the
  // flow's own indices, which is how `addedCardIndex` tells them apart when the copy is edited.
  const chapterAt = (t) => marks.filter((m) => m.kind === 'chapter' && !m.copyOf && (Number(m.t) || 0) <= t).pop() || null;
  marks
    .filter((m) => m.added)
    .forEach((m, i) => {
      const at = chapterAt(Number(m.t) || 0);
      const call = {
        kind: m.kind === 'chapter' ? 'chapter' : 'say',
        index: ADDED_CARD_BASE + i,
        title: String(m.label || ''),
        body: String(m.body || ''),
        holdMs: Math.round((Number(m.dur) || 2) * 1000),
        chapterTitle: at ? String(at.label || '') : '',
        chapterNo: at ? marks.filter((x) => x.kind === 'chapter' && !x.copyOf && (Number(x.t) || 0) <= (Number(at.t) || 0)).length : 1,
      };
      calls.push(call);
      markByCall.set(call.index, m);
    });
  const shell = readFileSync(join(TEMPLATES, 'overlay-preview.html'), 'utf8');
  const frame = outputFrame(video.config);
  const p = palette(video.brand);
  const direction = video.brand.direction || video.config?.direction || {};
  const look = resolveOverlays(video.brand, direction);
  const lookFor = new Map();
  /** Effective look for chapter N (video look + the chapter's own background), memoised. */
  const chapterLook = (n) => {
    if (!lookFor.has(n)) lookFor.set(n, resolveOverlays(video.brand, direction, { chapterNo: n }));
    return lookFor.get(n);
  };
  const cards = [];
  let chapterNo = 0;
  let chapterTitle = '';
  const copy = copyContext({
    brand: video.brand,
    config: video.config,
    corpus: [...copyCorpus(video.config), ...calls.flatMap((c) => [c.title, c.body].filter(Boolean))],
  });

  for (const call of calls) {
    const isChapter = call.kind === 'chapter';
    const added = call.index >= ADDED_CARD_BASE;
    if (isChapter && !added) {
      chapterNo += 1;
      chapterTitle = call.title;
    }
    // An added card sits wherever the editor dropped it, so it takes the chapter it fell under
    // rather than the one the flow had reached.
    const underNo = added ? Math.max(1, call.chapterNo || 1) : Math.max(1, chapterNo);
    const underTitle = added ? call.chapterTitle || chapterTitle : chapterTitle;
    const kind = isChapter ? 'chapter' : 'caption';
    const id = cardId(kind, call.index);
    const mark = markByCall.get(call.index) || null;
    const ms = cardHoldMs(call, mark);
    const fragment = renderLiveCardHtml(video.brand, kind, {
      chapterNo: isChapter && !added ? chapterNo : underNo,
      chapterTitle: underTitle,
      title: call.title,
      body: call.body,
      ms,
      flowIndex: call.index,
      ...(isChapter ? cardCopyFor(video, call.index) || {} : {}),
      frame,
      copy,
    });
    const html = fill(shell, {
      LABEL: esc(call.title || id),
      FONT_CSS: p.fontCss,
      FONT: p.font,
      INK: p.ink,
      SURFACE: p.surface,
      DURATION: (ms / 1000).toFixed(2),
      KIND: kind,
      CARD_ID: id,
      FRAME_W: frame.width,
      FRAME_H: frame.height,
      FRAME_ATTR: frame.format === 'portrait' ? ' data-frame="portrait"' : '',
      OVERLAY: fragment,
    });
    const file = join(paths.dir, `${id.replace(/:/g, '-')}.html`);
    if (!existsSync(file) || readFileSync(file, 'utf8') !== html) writeFileSync(file, html);
    cards.push({
      id,
      kind,
      flowIndex: call.index,
      label: call.title,
      body: call.body || '',
      chapterNo: isChapter && !added ? chapterNo : underNo,
      holdMs: ms,
      markKey: mark?.key || null,
      ...(added ? { added: true } : {}),
      htmlPath: file,
      htmlUrl: `/media/${video.slug}/overlays/${id.replace(/:/g, '-')}.html`,
      type: kind,
      look: chapterLook(isChapter && !added ? chapterNo : underNo)[kind],
      // Which background keys this card takes from its chapter rather than the video.
      lookScope: chapterLook(isChapter && !added ? chapterNo : underNo).scope[kind],
    });
  }

  return { dir: paths.dir, cards, look };
}

/** List overlay previews for Program (rebuilds HTML only when content changed). */
export function listLiveCards(video) {
  const { cards } = buildLiveCards(video);
  return cards.map((c) => ({
    id: c.id,
    label: c.kind === 'chapter' ? `Ch ${c.chapterNo} · ${c.label}` : `Caption · ${c.label}`,
    type: c.kind,
    kind: c.kind,
    flowIndex: c.flowIndex,
    chapterNo: c.chapterNo,
    look: c.look,
    lookScope: c.lookScope,
    markKey: c.markKey,
    holdMs: c.holdMs,
    htmlUrl: `${c.htmlUrl}?t=${Date.now()}`,
    path: c.htmlPath,
    mp4Url: null,
    encode: null,
    liveCard: true,
  }));
}

/** The copy of a card the Editor wrote lives on the cut, so it is saved there, not in the script. */
function saveAddedCardCopy(video, flowIndex, fields) {
  const marks = loadCardMarks(video);
  const mark = marks.filter((m) => m.added)[flowIndex - ADDED_CARD_BASE];
  if (!mark) throw new Error(`No added card at index ${flowIndex}`);
  const raw = JSON.parse(readFileSync(video.configPath, 'utf8'));
  const edit = { ...(raw.edit || {}) };
  edit.cards = (edit.cards || []).map((c) =>
    c.key !== mark.key
      ? c
      : {
          ...c,
          ...(fields.title != null ? { label: String(fields.title).trim().slice(0, 120) } : {}),
          ...(fields.body != null ? { body: String(fields.body).trim().slice(0, 240) } : {}),
        },
  );
  raw.edit = edit;
  writeFileSync(video.configPath, JSON.stringify(raw, null, 2) + '\n');
  return { op: 'card-copy', index: flowIndex, key: mark.key };
}

/** Apply Studio inline edit onto flow.mjs (title/body) and video.config.json (chapter label, ghost number). */
export async function saveLiveCardCopy(video, cardIdStr, fields = {}) {
  const parsed = parseCardId(cardIdStr);
  if (!parsed) throw new Error(`Not a live card id: ${cardIdStr}`);
  if (parsed.flowIndex >= ADDED_CARD_BASE) {
    if (fields.title == null && fields.body == null) throw new Error('No text fields to save');
    return saveAddedCardCopy(video, parsed.flowIndex, fields);
  }
  const hasCopy = fields.title != null || fields.body != null;
  const hasChrome = parsed.kind === 'chapter' && (fields.chapter != null || fields.number != null);
  if (!hasCopy && !hasChrome) throw new Error('No text fields to save');
  let result = { op: 'card-copy', index: parsed.flowIndex };
  if (hasCopy) {
    const { applyScriptStructure } = await import('./script.mjs');
    const patch = { op: 'call-update', index: parsed.flowIndex };
    if (fields.title != null) patch.title = fields.title;
    if (fields.body != null) patch.body = fields.body;
    result = await applyScriptStructure(video, patch);
  }
  if (hasChrome) writeCardChrome(video, parsed.flowIndex, fields);
  return result;
}

function writeCardChrome(video, flowIndex, fields) {
  const calls = existsSync(join(video.dir, 'flow.mjs'))
    ? parseFlowCalls(readFileSync(join(video.dir, 'flow.mjs'), 'utf8'))
    : [];
  let chapterNo = 0;
  for (const call of calls) {
    if (call.kind !== 'chapter') continue;
    chapterNo += 1;
    if (call.index === flowIndex) break;
  }
  const { fallback } = chapterChrome(chapterNo || 1);
  const raw = JSON.parse(readFileSync(video.configPath, 'utf8'));
  const copy = { ...(raw.liveCardCopy || {}) };
  const key = String(flowIndex);
  const next = { ...(copy[key] || {}) };
  if (fields.chapter != null) {
    const v = String(fields.chapter).trim().slice(0, 48);
    if (!v || v === `Chapter ${fallback}`) delete next.kicker;
    else next.kicker = v;
  }
  if (fields.number != null) {
    const v = String(fields.number).trim().slice(0, 8);
    if (!v || v === fallback) delete next.num;
    else next.num = v;
  }
  if (Object.keys(next).length) copy[key] = next;
  else delete copy[key];
  if (Object.keys(copy).length) raw.liveCardCopy = copy;
  else delete raw.liveCardCopy;
  writeFileSync(video.configPath, JSON.stringify(raw, null, 2) + '\n');
  video.config.liveCardCopy = raw.liveCardCopy;
}
