/**
 * Plate background colours — what the brand plates (open, close, interstitials, chapter plates)
 * paint behind their copy, independent of the brand pack.
 *
 *   video.config.plateColors                       the video default (every plate)
 *   open.colors / close.colors / interstitials[].colors   one plate (wins key by key)
 *
 * Shape: { background?, accent?, accent2?, text? }. A value is a brand role
 * (ink · surface · gold · amber · teal · text) or a #rrggbb colour. A missing key follows the
 * level above (plate → video → brand); on a plate, `brand` pins the pack's own colour even when
 * the video default says otherwise. `text` left alone flips light/dark to stay readable.
 *
 * The result is a brand.colors overlay, so it reaches the plate CSS (`--ink`, `--surface`, …)
 * and the atmosphere shader's uniforms through the same path the pack's colours take.
 */
import { parseCssHex } from './text.mjs';

export const PLATE_COLOR_KEYS = Object.freeze(['background', 'accent', 'accent2', 'text']);
export const PLATE_COLOR_ROLES = Object.freeze(['ink', 'surface', 'gold', 'amber', 'teal', 'text']);

export const PLATE_COLOR_SLOTS = Object.freeze([
  { id: 'background', label: 'Background', hint: 'The backdrop the atmosphere glows over' },
  { id: 'accent', label: 'Glow', hint: 'The atmosphere’s main light, highlights and emphasised words' },
  { id: 'accent2', label: 'Second glow', hint: 'The atmosphere’s second and third colour' },
  { id: 'text', label: 'Text', hint: 'Auto keeps copy readable on any background' },
]);

export const PLATE_COLOR_ROLE_LABELS = Object.freeze({
  ink: 'Ink',
  surface: 'Surface',
  gold: 'Accent',
  amber: 'Secondary',
  teal: 'Support',
  text: 'Light',
});

/** Curated looks that set the colours together. `brand` clears them. */
export const PLATE_COLOR_PRESETS = Object.freeze({
  brand: { label: 'Brand', hint: 'The brand pack’s own colours', colors: {} },
  midnight: { label: 'Midnight', hint: 'Deep navy with the brand glow', colors: { background: '#070b14', accent: 'gold', accent2: 'teal' } },
  paper: { label: 'Paper', hint: 'Warm off-white, dark copy', colors: { background: '#f5f1e8', accent: 'gold', accent2: 'amber' } },
  inverted: { label: 'Inverted', hint: 'The accent becomes the backdrop', colors: { background: 'gold', accent: 'ink', accent2: 'surface' } },
  mono: { label: 'Mono', hint: 'Black and silver, no brand hue', colors: { background: '#0c0c0d', accent: '#f2f2f2', accent2: '#8b8f98' } },
});

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** One stored value: a role, `brand`, or #rrggbb; null for unset / auto / invalid. */
export function normalizePlateColor(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s || s === 'auto' || s === 'inherit' || s === 'video') return null;
  if (s === 'brand' || PLATE_COLOR_ROLES.includes(s)) return s;
  if (HEX.test(s)) return s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s;
  return null;
}

/** A stored colour map, validated; `brand` survives only on a plate. Undefined when empty. */
export function sanitizePlateColors(raw, { plate = true } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out = {};
  for (const k of PLATE_COLOR_KEYS) {
    const v = normalizePlateColor(raw[k]);
    if (v && (plate || v !== 'brand')) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A preset as stored colours. On a plate the keys it leaves out pin the brand, so the plate shows exactly that look. */
export function presetPlateColors(colors, { plate = true } = {}) {
  const all = plate ? { ...Object.fromEntries(PLATE_COLOR_KEYS.map((k) => [k, 'brand'])), ...colors } : colors;
  return sanitizePlateColors(all, { plate });
}

/**
 * Lay a patch on stored colours. `null` / '' / `auto` clears a key; unknown keys and values throw
 * so a typo never silently does nothing. `{ preset }` replaces the whole map with that look.
 */
export function patchPlateColors(current, patch = {}, { plate = true } = {}) {
  if (patch && patch.preset != null) {
    const p = PLATE_COLOR_PRESETS[patch.preset];
    if (!p) throw new Error(`Unknown colour preset "${patch.preset}" (use ${Object.keys(PLATE_COLOR_PRESETS).join(', ')})`);
    return presetPlateColors(p.colors, { plate });
  }
  const next = { ...(sanitizePlateColors(current, { plate }) || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!PLATE_COLOR_KEYS.includes(k)) throw new Error(`Unknown plate colour "${k}" (use ${PLATE_COLOR_KEYS.join(', ')})`);
    if (v == null || String(v).trim() === '' || ['auto', 'inherit', 'video'].includes(String(v).trim().toLowerCase())) {
      delete next[k];
      continue;
    }
    const n = normalizePlateColor(v);
    if (!n || (!plate && n === 'brand')) {
      throw new Error(`${k} must be ${plate ? 'brand, ' : ''}one of ${PLATE_COLOR_ROLES.join(', ')} or a #rrggbb colour`);
    }
    next[k] = n;
  }
  return Object.keys(next).length ? next : undefined;
}

// ─── Colour maths ──────────────────────────────────────────────────────────────────────────
const toHex = (rgb) => `#${rgb.map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('')}`;

function rgbOf(c) {
  const rgb = parseCssHex(c);
  return rgb ? rgb.slice(0, 3) : null;
}

/** WCAG relative luminance (0–1); unknown colours read as dark. */
export function luminance(c) {
  const rgb = rgbOf(c);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((n) => {
    const s = n / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `a` moved toward `b` by `t` (0–1), as #rrggbb. */
export function mixHex(a, b, t) {
  const x = rgbOf(a);
  const y = rgbOf(b);
  if (!x || !y) return x ? toHex(x) : a;
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

const LIGHT_TEXT = '#f8fafc';
const DARK_TEXT = '#11141a';
const isLight = (c) => luminance(c) > 0.4;
const readableOn = (bg) => (contrast(LIGHT_TEXT, bg) >= contrast(DARK_TEXT, bg) ? LIGHT_TEXT : DARK_TEXT);

function brandBase(c = {}) {
  const ink = c.ink || '#080a0f';
  return {
    ink,
    surface: c.surface || ink,
    gold: c.gold,
    amber: c.amber,
    teal: c.teal || c.gold,
    text: c.text || LIGHT_TEXT,
    muted: c.muted || '#94a3b8',
    onAccent: c.onAccent || '#111',
  };
}

/** The picks that apply to one plate: plate keys over video keys, `brand` meaning "no override". */
export function mergePlateColors(videoColors, plateColors) {
  const merged = { ...(sanitizePlateColors(videoColors, { plate: false }) || {}), ...(sanitizePlateColors(plateColors) || {}) };
  for (const k of Object.keys(merged)) if (merged[k] === 'brand') delete merged[k];
  return merged;
}

/**
 * Resolve the colours one plate paints with. `colors` is a full brand.colors overlay,
 * `vars` the CSS variables it becomes; `set` is false when the plate shows the pack untouched.
 */
export function resolvePlateColors(brandColors, videoColors, plateColors) {
  const base = brandBase(brandColors || {});
  const picks = mergePlateColors(videoColors, plateColors);
  const hexOf = (v) => (String(v).startsWith('#') ? v : base[v]);
  const out = { ...base };
  const set = Object.keys(picks).length > 0;
  if (picks.background && picks.background !== 'ink') {
    out.ink = hexOf(picks.background) || base.ink;
    // A lifted surface keeps the plate's soft radial depth in the new hue.
    out.surface = isLight(out.ink) ? mixHex(out.ink, '#000000', 0.06) : mixHex(out.ink, '#ffffff', 0.09);
  }
  if (picks.accent) out.gold = hexOf(picks.accent) || base.gold;
  if (picks.accent2) {
    out.amber = hexOf(picks.accent2) || base.amber;
    out.teal = out.amber;
  }
  if (picks.text) {
    out.text = hexOf(picks.text) || base.text;
    out.muted = mixHex(out.text, out.ink, 0.38);
  } else if (set) {
    if (contrast(base.text, out.ink) < 4.5) {
      out.text = readableOn(out.ink);
      out.muted = mixHex(out.text, out.ink, 0.38);
    } else if (contrast(base.muted, out.ink) < 3) out.muted = mixHex(out.text, out.ink, 0.38);
  }
  if (set && out.gold && contrast(out.onAccent, out.gold) < 4.5) out.onAccent = readableOn(out.gold);
  const shade = isLight(out.ink) ? '#0a0a0a' : out.ink;
  return {
    set,
    picks,
    colors: out,
    vars: {
      '--ink': out.ink,
      '--surface': out.surface,
      '--gold': out.gold,
      '--amber': out.amber,
      '--teal': out.teal,
      '--text': out.text,
      '--muted': out.muted,
      '--on-accent': out.onAccent,
      '--shade': shade,
    },
  };
}

/** Brand pack with one plate's colours laid over it (the same object when nothing is set). */
export function withPlateColors(brand, videoColors, plateColors) {
  const r = resolvePlateColors(brand?.colors, videoColors, plateColors);
  if (!r.set) return brand;
  return { ...brand, colors: { ...(brand.colors || {}), ...r.colors } };
}

/** What the Studio needs to draw the colour picker. */
export function plateColorOptions() {
  return {
    slots: PLATE_COLOR_SLOTS,
    roles: PLATE_COLOR_ROLES.map((id) => ({ id, label: PLATE_COLOR_ROLE_LABELS[id] })),
    presets: Object.entries(PLATE_COLOR_PRESETS).map(([id, p]) => ({ id, label: p.label, hint: p.hint, colors: p.colors })),
  };
}
