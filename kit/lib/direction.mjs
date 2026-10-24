/**
 * Per-video visual direction derived from a brand pack.
 *
 * Plates use five roles: ink, surface, accent (gold), secondary (amber) and support (teal).
 * Suggestions come from the saved brand colors, harvested site colors and the captured logo.
 * A choice is stored on the video. The shared brand pack is never rewritten.
 * Live product UI is never graded.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import {
  BACKGROUNDS,
  CAMERA_CURVES,
  CAMERA_MOTIONS,
  FRAME_CORNERS,
  FRAME_PADDING,
  FRAME_SHADOWS,
  FRAME_STYLES,
  ZOOM_LEVELS,
} from './camera.mjs';
import { DEFAULT_CURVE, DEFAULT_MOTION } from '../studio/easing.js';
import { CURSOR_SIZES, CURSOR_STYLES } from './cursor.mjs';
import { sampleColors } from './logoTone.mjs';
import { mergeMotion } from './plateMotion.mjs';

export const SCALE_ROLES = Object.freeze([
  { id: 'ink', label: 'Ink' },
  { id: 'surface', label: 'Surface' },
  { id: 'gold', label: 'Accent' },
  { id: 'amber', label: 'Secondary' },
  { id: 'teal', label: 'Support' },
]);

/** Older atmosphere choices. New videos choose a full five-color scale instead. */
export const PALETTE_PRESETS = Object.freeze({
  signature: { label: 'Signature', hint: 'Official brand balance' },
  luminous: { label: 'Luminous', hint: 'Richer accent atmosphere' },
  editorial: { label: 'Editorial', hint: 'Quiet surfaces, one accent' },
});

export const FOCUS_PRESETS = Object.freeze({
  guided: { label: 'Guided lens', hint: 'The lens and pointer travel together across related features' },
  spotlight: { label: 'Spotlight', hint: 'Magnify key evidence while keeping the pointer restrained' },
  ring: { label: 'Focus ring', hint: 'Minimal treatment for dense or motion-heavy interfaces' },
});

/**
 * Live pace — how fast the recorded tour moves. One tempo multiplies every authored hold
 * (`wait()`, focus/magnify/settle holds, caption and chapter minimums, pointer glide, slowMo).
 * Narration is never sped up: a step still waits for its line, so a narration-bound take reports
 * how much time the voice cost (see record output / pacing QC) instead of silently staying slow.
 */
export const PACE_PRESETS = Object.freeze({
  calm: { label: 'Calm', tempo: 0.85, hint: 'Longer holds — first-time viewers, dense screens' },
  steady: { label: 'Steady', tempo: 1, hint: 'Authored timing as written' },
  brisk: { label: 'Brisk', tempo: 1.25, hint: 'Shorter holds, quicker pointer — viewers who know the product' },
  quick: { label: 'Quick', tempo: 1.5, hint: 'Fast tour — teasers, launch posts, social cuts' },
});
export const PACE_IDS = Object.freeze(Object.keys(PACE_PRESETS));
export const PACE_RANGE = Object.freeze([0.6, 2]);

/** Accept a preset id or a bare multiplier (0.6–2); throws on anything else. */
export function normalizePace(value) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  if (PACE_PRESETS[value]) return value;
  const n = Number(value);
  if (!Number.isFinite(n) || n < PACE_RANGE[0] || n > PACE_RANGE[1]) {
    throw new Error(`pace must be one of ${PACE_IDS.join(', ')} or a multiplier between ${PACE_RANGE[0]} and ${PACE_RANGE[1]}`);
  }
  const preset = PACE_IDS.find((id) => Math.abs(PACE_PRESETS[id].tempo - n) < 0.005);
  return preset || Number(n.toFixed(2));
}

/** `{ id, tempo, label, hint, custom }` for a stored pace (preset id, multiplier or nothing). */
export function resolvePace(raw) {
  let value;
  try {
    value = normalizePace(raw);
  } catch {
    value = undefined;
  }
  if (value === undefined) value = 'steady';
  if (typeof value === 'string') return { id: value, tempo: PACE_PRESETS[value].tempo, ...PACE_PRESETS[value], custom: false };
  return { id: 'custom', tempo: value, label: `${value}×`, hint: 'Custom multiplier on every authored hold', custom: true };
}

const LOCKUP_EXT = new Set(['.html', '.svg', '.png', '.jpg', '.jpeg', '.webp']);
const UPLOAD_EXT = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp']);
const UPLOAD_MAX = 1_500_000;
const KIT_TEAL = '#2dd4bf';

const clampByte = (n) => Math.max(0, Math.min(255, Math.round(n)));
const validHex = (value) => /^#[0-9a-f]{6}$/i.test(value || '');
const normHex = (value) => (validHex(value) ? value.toLowerCase() : null);

function rgb(hex) {
  const value = normHex(hex) || '#000000';
  return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
}

function hex(channels) {
  return `#${channels.map((n) => clampByte(n).toString(16).padStart(2, '0')).join('')}`;
}

function mix(a, b, amount) {
  const aa = rgb(a);
  const bb = rgb(b);
  return hex(aa.map((v, i) => v + (bb[i] - v) * amount));
}

function hexToHsl(value) {
  const [r0, g0, b0] = rgb(value).map((v) => v / 255);
  const max = Math.max(r0, g0, b0);
  const min = Math.min(r0, g0, b0);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r0 ? (g0 - b0) / d + (g0 < b0 ? 6 : 0) : max === g0 ? (b0 - r0) / d + 2 : (r0 - g0) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const f = (n) => {
    const k = (n + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function luma(value) {
  const [r, g, b] = rgb(value);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hueDistance(a, b) {
  const d = Math.abs(hexToHsl(a)[0] - hexToHsl(b)[0]);
  return Math.min(d, 360 - d);
}

function rgbToHex(value) {
  const match = String(value || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return normHex(value);
  return hex(match.slice(1, 4).map(Number));
}

function finishScale(colors, base = {}) {
  const accent = colors.gold;
  const [h, s] = hexToHsl(accent);
  // Light plate backdrops (white / near-white ink) need dark type and a dark on-accent;
  // dark plates keep the brand's light text tokens.
  const inkLight = luma(colors.ink) > 160;
  const text = inkLight ? '#0a0a0a' : base.text || '#f8fafc';
  const muted = inkLight
    ? hslToHex(h, Math.min(s, 0.1), 0.42)
    : base.muted || hslToHex(h, Math.min(s, 0.16), 0.68);
  const onAccent =
    luma(accent) > 165 ? (inkLight || luma(colors.ink) > 140 ? '#0a0a0a' : colors.ink) : '#ffffff';
  return {
    ink: colors.ink,
    surface: colors.surface,
    gold: colors.gold,
    amber: colors.amber,
    teal: colors.teal,
    text,
    muted,
    onAccent,
  };
}

function scaleFromAccents(accents, base) {
  const primary = accents[0];
  const [h, s] = hexToHsl(primary);
  const distinct = [primary];
  for (const candidate of accents.slice(1)) {
    if (!candidate || distinct.some((chosen) => hueDistance(chosen, candidate) < 12)) continue;
    distinct.push(candidate);
  }
  const secondary = distinct[1] || hslToHex((h + 24) % 360, Math.max(s, 0.45), 0.58);
  const support = distinct[2] || hslToHex((h + 152) % 360, Math.max(0.42, s * 0.7), 0.56);
  return finishScale(
    {
      ink: hslToHex(h, Math.min(s, 0.42), 0.06),
      surface: hslToHex(h, Math.min(s, 0.36), 0.11),
      gold: primary,
      amber: secondary,
      teal: support,
    },
    base
  );
}

function capturedAccents(brand) {
  const found = [];
  const add = (value, source, weight) => {
    const color = rgbToHex(value);
    if (!color) return;
    const [h, s, l] = hexToHsl(color);
    if (s < 0.18 || l < 0.08 || l > 0.92) return;
    if (source.startsWith('logo') && (s < 0.35 || l < 0.18 || l > 0.72)) return;
    if (color === KIT_TEAL && source.startsWith('brand.')) return;
    const near = found.find((item) => hueDistance(item.hex, color) < 14 && Math.abs(luma(item.hex) - luma(color)) < 28);
    if (near) {
      near.weight += weight;
      if (weight > near.bestWeight) {
        near.hex = color;
        near.source = source;
        near.bestWeight = weight;
      }
      return;
    }
    found.push({ hex: color, source, weight, bestWeight: weight, hue: h });
  };

  const colors = brand.foundationColors || brand.colors || {};
  add(colors.gold, 'brand accent', 12);
  add(colors.amber, 'brand secondary', 8);
  add(colors.teal, 'brand support', 5);

  if (brand.dir && existsSync(join(brand.dir, 'discover-report.json'))) {
    try {
      const report = JSON.parse(readFileSync(join(brand.dir, 'discover-report.json'), 'utf8'));
      for (const page of report.pages || []) {
        add(page.colors?.ctaBg, 'site button', 11);
        add(page.colors?.bodyColor, 'site text', 4);
      }
    } catch {
      /* a malformed harvest report simply contributes no site colors */
    }
  }

  if (brand.dir && existsSync(brand.dir)) {
    for (const name of readdirSync(brand.dir)) {
      if (!/^((source-)?logo|logo-source|mark)/i.test(name)) continue;
      if (!['.svg', '.png', '.jpg', '.jpeg', '.webp'].includes(extname(name).toLowerCase())) continue;
      for (const sample of sampleColors(join(brand.dir, name), 4)) {
        add(sample.hex, `logo · ${name}`, 7 + Math.min(4, sample.count));
      }
    }
  }
  return found.sort((a, b) => b.weight - a.weight);
}

export function suggestScales(brand = {}) {
  const base = brand.foundationColors || brand.colors || {};
  const official = finishScale(
    {
      ink: normHex(base.ink) || '#080a0f',
      surface: normHex(base.surface) || '#11141b',
      gold: normHex(base.gold) || '#3b82f6',
      amber: normHex(base.amber) || '#60a5fa',
      teal: normHex(base.teal) || KIT_TEAL,
    },
    base
  );
  const accents = capturedAccents(brand);
  const scales = [
    {
      id: 'official',
      label: 'Official',
      hint: 'The five colors saved in the brand pack',
      recommended: true,
      colors: official,
    },
  ];
  const logoLed = accents.filter((item) => item.source.startsWith('logo'));
  if (logoLed.length) {
    const colors = scaleFromAccents([logoLed[0].hex, accents[1]?.hex, accents[2]?.hex].filter(Boolean), base);
    if (colors.gold !== official.gold || colors.amber !== official.amber) {
      scales.push({
        id: 'logo',
        label: 'From logo',
        hint: logoLed.map((item) => item.source.replace('logo · ', '')).slice(0, 2).join(' · '),
        colors,
      });
    }
  }
  const site = accents.find((item) => item.source === 'site button');
  if (site && site.hex !== official.gold) {
    scales.push({
      id: 'site',
      label: 'From site',
      hint: 'Button color harvested from the live brand site',
      colors: scaleFromAccents([site.hex, official.amber, official.gold], base),
    });
  }
  const primary = accents[0]?.hex || official.gold;
  scales.push({
    id: 'harmony',
    label: 'Harmony',
    hint: 'Accent, a close partner, and a split-complement support',
    colors: scaleFromAccents([primary], base),
  });
  return scales.map((scale) => ({
    ...scale,
    swatches: SCALE_ROLES.map((role) => scale.colors[role.id]),
  }));
}

function lockupDirs(brand = {}) {
  return [brand.uploadDir, brand.dir].filter((dir) => dir && existsSync(dir));
}

/** A lockup file in this video's uploads, or in the shared brand pack. */
export function lockupPath(brand = {}, file) {
  const safe = file && file === basename(file) && LOCKUP_EXT.has(extname(file).toLowerCase()) ? file : null;
  if (!safe) return null;
  for (const dir of lockupDirs(brand)) {
    const path = join(dir, safe);
    if (existsSync(path)) return path;
  }
  return null;
}

export function listLockups(brand = {}) {
  const seen = new Set();
  const names = [];
  for (const dir of lockupDirs(brand)) {
    for (const name of readdirSync(dir)) {
      if (seen.has(name) || name.includes('..') || name !== basename(name)) continue;
      if (!LOCKUP_EXT.has(extname(name).toLowerCase())) continue;
      if (name !== 'logo.html' && !/logo|mark/i.test(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }
  const rank = (name) => (name.startsWith('logo-upload') ? 0 : name === (brand.logo || 'logo.html') ? 1 : name.endsWith('.svg') ? 2 : 3);
  return names
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .slice(0, 8)
    .map((file) => ({
      file,
      label: file.startsWith('logo-upload') ? 'Uploaded' : file === 'logo.html' ? 'Plate lockup' : file.replace(/\.[a-z]+$/i, '').replace(/[-_]/g, ' '),
      kind: extname(file).slice(1),
    }));
}

/**
 * Store one uploaded logo on this video (`brand.uploadDir`). Replaces the previous upload.
 * The shared brand pack is left alone. Returns the filename Direction can select.
 */
export function saveUploadedLockup(brand = {}, { name, bytes } = {}) {
  if (!brand.uploadDir) throw new Error('This video cannot store a logo yet');
  const ext = extname(String(name || '')).toLowerCase();
  if (!UPLOAD_EXT.has(ext)) throw new Error('Upload an SVG, PNG, JPEG, or WebP logo');
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!buf.length) throw new Error('That file is empty');
  if (buf.length > UPLOAD_MAX) throw new Error('Logo must be under 1.5 MB');
  const problem = uploadProblem(ext, buf);
  if (problem) throw new Error(problem);
  mkdirSync(brand.uploadDir, { recursive: true });
  const file = `logo-upload${ext}`;
  writeFileSync(join(brand.uploadDir, file), buf);
  for (const existing of readdirSync(brand.uploadDir)) {
    if (/^logo-upload\./i.test(existing) && existing !== file) unlinkSync(join(brand.uploadDir, existing));
  }
  return file;
}

function uploadProblem(ext, buf) {
  if (ext === '.png') {
    return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
      ? null
      : 'That file is not a PNG logo';
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? null : 'That file is not a JPEG logo';
  }
  if (ext === '.webp') {
    return buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
      ? null
      : 'That file is not a WebP logo';
  }
  const text = buf.toString('utf8');
  if (!/<svg[\s>]/i.test(text)) return 'That file is not an SVG logo';
  if (/<script\b|javascript:|on[a-z]+\s*=|<foreignObject/i.test(text)) return 'That SVG is not a plain logo';
  return null;
}

export function lockupHtml(brand, file) {
  const path = lockupPath(brand, file);
  if (!path) return brand.logoHtml;
  const safe = basename(path);
  const ext = extname(safe).toLowerCase();
  if (ext === '.html') return readFileSync(path, 'utf8');
  if (ext === '.svg') {
    return readFileSync(path, 'utf8').replace(/<svg\b/i, '<svg class="logo-svg" role="img"');
  }
  const bytes = readFileSync(path);
  if (bytes.length > 1_500_000) return brand.logoHtml;
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return `<img class="logo-img" alt="${brand.name || ''}" src="data:${mime};base64,${bytes.toString('base64')}" />`;
}

function legacyPalette(base, preset) {
  const colors = { ...base };
  const accent = normHex(colors.gold) || '#3b82f6';
  if (preset === 'luminous') {
    return finishScale(
      {
        ...colors,
        ink: mix(colors.ink || '#080a0f', accent, 0.08),
        surface: mix(colors.surface || '#11141b', accent, 0.14),
        gold: accent,
        amber: mix(colors.amber || accent, '#ffffff', 0.12),
        teal: colors.teal || KIT_TEAL,
      },
      colors
    );
  }
  if (preset === 'editorial') {
    return finishScale(
      {
        ...colors,
        ink: mix(colors.ink || '#080a0f', '#111318', 0.72),
        surface: mix(colors.surface || '#11141b', '#20232a', 0.68),
        gold: accent,
        amber: mix(accent, '#ffffff', 0.22),
        teal: mix(accent, '#ffffff', 0.38),
      },
      { ...colors, muted: mix(colors.muted || '#94a3b8', '#aab0bc', 0.7) }
    );
  }
  return finishScale(
    {
      ink: colors.ink,
      surface: colors.surface,
      gold: accent,
      amber: colors.amber || accent,
      teal: colors.teal || accent,
    },
    colors
  );
}

/**
 * Camera and cursor. Projects without these keep the take and cut they had: classic pointer,
 * full-bleed frame, no auto zoom. New projects opt in from the template.
 */
export const CAMERA_OPTIONS = Object.freeze({
  zoom: Object.keys(ZOOM_LEVELS),
  frame: FRAME_STYLES,
  background: BACKGROUNDS,
  padding: Object.keys(FRAME_PADDING),
  corners: Object.keys(FRAME_CORNERS),
  shadow: FRAME_SHADOWS,
  // Motion: the curve every camera move and the loupe follow, and how long they take.
  curve: CAMERA_CURVES,
  motion: CAMERA_MOTIONS,
});
export const CURSOR_OPTIONS = Object.freeze({
  style: CURSOR_STYLES,
  size: Object.keys(CURSOR_SIZES),
});
export const LOOK_PRESETS = Object.freeze({
  studio: {
    label: 'Studio',
    hint: 'Balanced and polished',
    camera: { zoom: 'subtle', frame: 'inset', background: 'brand', padding: 'balanced', corners: 'soft', shadow: 'soft', curve: 'glide', motion: 'natural' },
    cursor: { style: 'arrow', size: 'm', glide: true, hideIdle: true, loop: false },
    keys: true,
  },
  cinematic: {
    label: 'Cinematic',
    hint: 'Roomy frame, deep shadow',
    camera: { zoom: 'bold', frame: 'inset', background: 'ink', padding: 'roomy', corners: 'round', shadow: 'deep', curve: 'cinematic', motion: 'unhurried' },
    cursor: { style: 'dot', size: 'm', glide: true, hideIdle: true, loop: false },
    keys: true,
  },
  social: {
    label: 'Social',
    hint: 'Bold focus for small screens',
    camera: { zoom: 'bold', frame: 'inset', background: 'accent', padding: 'balanced', corners: 'round', shadow: 'soft', curve: 'snappy', motion: 'swift' },
    cursor: { style: 'arrow', size: 'l', glide: true, hideIdle: true, loop: true },
    keys: true,
  },
  minimal: {
    label: 'Minimal',
    hint: 'Full bleed, quiet pointer',
    camera: { zoom: 'off', frame: 'full', background: 'brand', padding: 'tight', corners: 'square', shadow: 'off', curve: 'smooth', motion: 'natural' },
    cursor: { style: 'classic', size: 'm', glide: false, hideIdle: false, loop: false },
    keys: false,
  },
});

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

export function resolveCamera(raw = {}) {
  return {
    zoom: pick(raw?.zoom, CAMERA_OPTIONS.zoom, 'off'),
    frame: pick(raw?.frame, CAMERA_OPTIONS.frame, 'full'),
    background: pick(raw?.background, CAMERA_OPTIONS.background, 'brand'),
    padding: pick(raw?.padding, CAMERA_OPTIONS.padding, 'balanced'),
    corners: pick(raw?.corners, CAMERA_OPTIONS.corners, 'soft'),
    shadow: pick(raw?.shadow, CAMERA_OPTIONS.shadow, 'soft'),
    curve: pick(raw?.curve, CAMERA_OPTIONS.curve, DEFAULT_CURVE),
    motion: pick(raw?.motion, CAMERA_OPTIONS.motion, DEFAULT_MOTION),
  };
}

export function resolveCursor(raw = {}) {
  const style = pick(raw?.style, CURSOR_OPTIONS.style, 'classic');
  return {
    style,
    size: pick(raw?.size, CURSOR_OPTIONS.size, 'm'),
    glide: typeof raw?.glide === 'boolean' ? raw.glide : style !== 'classic',
    hideIdle: typeof raw?.hideIdle === 'boolean' ? raw.hideIdle : style !== 'classic',
    // Pointing-hand morph on clicks: the arrow's default; the dot keeps its pulse unless asked.
    hand: typeof raw?.hand === 'boolean' ? raw.hand : style === 'arrow',
    loop: raw?.loop === true,
  };
}

export function resolveDirection(config = {}, brand = {}) {
  const raw = config.direction || {};
  const scales = suggestScales(brand);
  const lockups = listLockups(brand);
  const requested = raw.scale || raw.palette;
  const scale = scales.some((item) => item.id === requested) || PALETTE_PRESETS[requested] || requested === 'custom'
    ? requested
    : 'official';
  const focus = FOCUS_PRESETS[raw.focus] ? raw.focus : 'guided';
  const logo = lockups.some((item) => item.file === raw.logo) ? raw.logo : lockups[0]?.file || null;
  let colors;
  if (scale === 'custom') {
    const seed = scales[0].colors;
    const custom = {};
    for (const role of SCALE_ROLES) custom[role.id] = normHex(raw.colors?.[role.id]) || seed[role.id];
    colors = finishScale(custom, brand.colors || {});
  } else if (PALETTE_PRESETS[scale] && scale !== 'signature') {
    colors = legacyPalette(brand.colors || {}, scale);
  } else {
    colors = (scales.find((item) => item.id === scale) || scales[0]).colors;
  }
  return {
    palette: scale,
    scale,
    focus,
    logo,
    lockups,
    scales,
    roles: SCALE_ROLES,
    look: LOOK_PRESETS[raw.look] ? raw.look : null,
    looks: LOOK_PRESETS,
    camera: resolveCamera(raw.camera),
    cursor: resolveCursor(raw.cursor),
    keys: raw.keys === true,
    pace: resolvePace(raw.pace),
    paces: PACE_PRESETS,
    motion: { ...(raw.motion || {}) },
    // Live chapter/caption look (kit templates) — resolved further in liveCards.resolveOverlays.
    overlays: raw.overlays && typeof raw.overlays === 'object' ? { ...raw.overlays } : undefined,
    approvedAt: raw.approvedAt || null,
    colors,
    swatches: SCALE_ROLES.map((role) => colors[role.id]),
  };
}

/**
 * Apply a partial change to a video's stored direction (Studio and CLI share this). Throws on an
 * unknown value. Any change clears the approval unless `approve: true` is passed.
 */
export function patchDirection(current = {}, body = {}, brand = {}) {
  const direction = { ...current };
  const knownScale = ['official', 'logo', 'site', 'harmony', 'custom', ...Object.keys(PALETTE_PRESETS)];
  const requestedScale = body.scale || body.palette;
  if (requestedScale && !knownScale.includes(requestedScale)) throw new Error(`Unknown color scale: ${requestedScale}`);
  if (body.focus && !FOCUS_PRESETS[body.focus]) throw new Error(`Unknown focus treatment: ${body.focus}`);
  if (body.logo && (body.logo !== basename(body.logo) || !listLockups(brand).some((item) => item.file === body.logo))) {
    throw new Error('That logo is not in the captured brand pack');
  }
  if (body.look) {
    const preset = LOOK_PRESETS[body.look];
    if (!preset) throw new Error(`Unknown look preset: ${body.look}`);
    direction.look = body.look;
    direction.camera = { ...preset.camera };
    direction.cursor = { ...preset.cursor };
    direction.keys = preset.keys;
  }
  if (requestedScale) direction.scale = requestedScale;
  delete direction.palette;
  if (body.colors && typeof body.colors === 'object') {
    direction.colors = { ...(direction.colors || {}) };
    for (const role of SCALE_ROLES) {
      const value = normHex(body.colors[role.id]);
      if (value) direction.colors[role.id] = value;
    }
  }
  if (body.logo) direction.logo = body.logo;
  if (body.focus) direction.focus = body.focus;
  for (const [key, options] of [['camera', CAMERA_OPTIONS], ['cursor', CURSOR_OPTIONS]]) {
    if (!body[key] || typeof body[key] !== 'object') continue;
    const next = { ...(direction[key] || {}) };
    for (const [field, value] of Object.entries(body[key])) {
      if (key === 'cursor' && ['glide', 'hideIdle', 'hand', 'loop'].includes(field)) {
        if (typeof value !== 'boolean') throw new Error(`cursor.${field} must be true or false`);
        next[field] = value;
        continue;
      }
      if (!options[field]) throw new Error(`Unknown ${key} setting: ${field}`);
      if (!options[field].includes(value)) throw new Error(`Unknown ${key}.${field}: ${value}`);
      next[field] = value;
    }
    direction[key] = next;
    delete direction.look;
  }
  if (typeof body.keys === 'boolean') {
    direction.keys = body.keys;
    delete direction.look;
  }
  if (body.pace !== undefined) {
    const pace = normalizePace(body.pace);
    if (pace === undefined || pace === 'steady') delete direction.pace;
    else direction.pace = pace;
  }
  if (body.approve === true) direction.approvedAt = new Date().toISOString();
  else delete direction.approvedAt;
  return direction;
}

/** Return a video-local brand object; never mutate the shared brand pack. */
export function applyDirection(brand, config = {}) {
  const direction = resolveDirection(config, brand);
  return {
    ...brand,
    colors: direction.colors,
    foundationColors: brand.foundationColors || brand.colors,
    logoHtml: direction.logo ? lockupHtml(brand, direction.logo) : brand.logoHtml,
    motion: mergeMotion(brand.motion, direction.motion),
    direction,
  };
}
