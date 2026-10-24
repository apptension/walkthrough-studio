/**
 * The edit deck: everything the Studio Editor (and `cli.mjs edit`) can change about a cut
 * without touching the recording. Lives in video.config.json and the pipeline reads it back:
 *
 *   edit.speed        [{ from, to, rate }]       live-time ranges played faster/slower (prepareLive)
 *   edit.zooms        [{ id, t, dur, zoom, x, y }] manual push-ins in live time (planZooms)
 *   edit.zoomSkips    [{ from, to }]              windows where auto zoom must leave the frame whole
 *   edit.lenses       [{ id, t, dur, x, y, w, h, zoom? }] magnifier loupes on a target (centre x,y)
 *   edit.lensOff      [t]                         recorded `magnify` marks (by start time) left out
 *   edit.transitions  { "<prev>><next>": { style, duration } } per-join overrides (buildEditPlan)
 *   edit.audio        { music, voice, master }    the mix desk (delivery clock; see audio/desk.mjs)
 *   edit.cards        [{ key, t?, dur? }]         chapter/caption mark nudges (recording clock)
 *   edit.trims        [{ id, trimStart, trimEnd }] head/tail cut on a live section (recording sec)
 *   edit.cuts         [{ from, to }]              stretches removed from the recording (recording sec)
 *   open.style / close.style / interstitials[].style   { "--gold": "#e9b949", ... } CSS variables
 *                                                       injected after the plate's own :root
 *
 * All times are in the original recording's clock (live.mp4), so a ramp and a zoom describe the
 * same frames the Studio shows while scrubbing. `liveTimeMap` converts to the cleaned reel.
 */
import { compactAudio, describeAudio, isEmptyAudio, normalizeAudio } from './audio/desk.mjs';
import { CAPTURE_PRESETS, DEFAULT_CAPTURE } from './capturePresets.mjs';
import { normalizeLayouts } from './layout.mjs';

/** Size the deck validates against when the caller has no take yet. */
const CAPTURE = CAPTURE_PRESETS[DEFAULT_CAPTURE];

export const SPEED_RANGE = Object.freeze([0.25, 4]);
export const ZOOM_RANGE = Object.freeze([1.1, 2.2]);
export const MIN_RAMP_SEC = 0.4;
export const MIN_ZOOM_SEC = 1.75;
export const TRANSITION_DUR_RANGE = Object.freeze([0.2, 1.2]);
export const LENS_ZOOM_RANGE = Object.freeze([1.2, 2.4]);
export const MIN_LENS_SEC = 1;

const r3 = (v) => Math.round(Number(v) * 1000) / 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * CSS variables a plate exposes to the editor. Each entry says how to edit it (control type,
 * range, unit) so the Studio renders the right control and the pipeline accepts only sane values.
 * `only` restricts a group to plate ids (open/close). `onlyTypes` restricts to interstitial
 * types (features/quote/…) — brand mark geometry means nothing on a stats plate.
 */
export const STYLE_GROUPS = Object.freeze([
  {
    id: 'palette',
    label: 'Palette',
    icon: 'palette',
    vars: [
      { name: '--ink', label: 'Backdrop', type: 'color' },
      { name: '--surface', label: 'Surface', type: 'color' },
      { name: '--gold', label: 'Accent', type: 'color' },
      { name: '--amber', label: 'Accent 2', type: 'color' },
      { name: '--teal', label: 'Accent 3', type: 'color' },
      { name: '--text', label: 'Text', type: 'color' },
      { name: '--muted', label: 'Muted text', type: 'color' },
      { name: '--on-accent', label: 'Text on accent', type: 'color' },
    ],
  },
  {
    id: 'motion',
    label: 'Motion',
    icon: 'motion',
    vars: [
      { name: '--motion-enter', label: 'Enter', type: 'number', unit: 's', min: 0.3, max: 2, step: 0.05 },
      { name: '--motion-stagger', label: 'Stagger', type: 'number', unit: 's', min: 0.02, max: 0.4, step: 0.01 },
      { name: '--motion-exit', label: 'Exit', type: 'number', unit: 's', min: 0.3, max: 1.6, step: 0.05 },
      { name: '--motion-push', label: 'Push scale', type: 'number', unit: '', min: 1, max: 1.12, step: 0.005 },
      { name: '--motion-pop', label: 'Card pop', type: 'number', unit: '', min: 0.8, max: 1, step: 0.01 },
      { name: '--motion-drift', label: 'Drift', type: 'number', unit: '', min: 0, max: 2, step: 0.1 },
    ],
  },
  {
    id: 'depth',
    label: 'Depth & light',
    icon: 'depth',
    vars: [
      { name: '--card-tilt', label: 'Card tilt', type: 'number', unit: 'deg', min: 0, max: 24, step: 1 },
      { name: '--card-lift', label: 'Card lift', type: 'number', unit: 'px', min: 0, max: 60, step: 2 },
      { name: '--sheen', label: 'Sheen', type: 'toggle' },
    ],
  },
  {
    id: 'open',
    label: 'Open lockup',
    icon: 'lockup',
    only: ['open'],
    vars: [
      { name: '--open-logo', label: 'Show logo', type: 'toggle' },
      { name: '--open-logo-top', label: 'Logo top', type: 'number', unit: '%', min: 20, max: 70, step: 1 },
      { name: '--open-logo-width', label: 'Logo width', type: 'number', unit: 'px', min: 320, max: 1200, step: 10 },
      { name: '--open-lift-scale', label: 'Settled scale', type: 'number', unit: '', min: 0.35, max: 0.9, step: 0.01 },
      { name: '--open-lift-y', label: 'Settled lift', type: 'number', unit: '%', min: -320, max: 0, step: 5 },
    ],
  },
  {
    id: 'close',
    label: 'Close lockup',
    icon: 'lockup',
    only: ['close'],
    vars: [
      { name: '--close-logo', label: 'Show logo', type: 'toggle' },
      { name: '--close-logo-top', label: 'Logo top', type: 'number', unit: '%', min: 50, max: 92, step: 1 },
      { name: '--close-logo-width', label: 'Logo width', type: 'number', unit: 'px', min: 160, max: 720, step: 10 },
      { name: '--close-lift-scale', label: 'Settled scale', type: 'number', unit: '', min: 0.5, max: 1.4, step: 0.01 },
      { name: '--close-lift-y', label: 'Settled lift', type: 'number', unit: '%', min: -40, max: 40, step: 1 },
    ],
  },
  {
    id: 'mark',
    label: 'Brand mark',
    icon: 'lockup',
    /** Corner / footer brand lockup on these interstitial types. */
    onlyTypes: ['features', 'quote', 'statement'],
    vars: [
      { name: '--mark-logo', label: 'Show logo', type: 'toggle' },
      { name: '--mark-logo-size', label: 'Logo size', type: 'number', unit: 'px', min: 16, max: 72, step: 1 },
      { name: '--mark-logo-width', label: 'Logo width', type: 'number', unit: 'px', min: 80, max: 320, step: 4 },
      { name: '--mark-logo-x', label: 'Inset X', type: 'number', unit: 'px', min: 0, max: 240, step: 4 },
      { name: '--mark-logo-y', label: 'Inset Y', type: 'number', unit: 'px', min: 0, max: 200, step: 4 },
    ],
  },
  {
    id: 'orbit',
    label: 'Orbit lockup',
    icon: 'lockup',
    onlyTypes: ['orbit'],
    vars: [
      { name: '--orbit-logo', label: 'Show logo', type: 'toggle' },
      { name: '--orbit-logo-size', label: 'Logo size', type: 'number', unit: 'px', min: 28, max: 120, step: 2 },
      { name: '--orbit-center-scale', label: 'Centre scale', type: 'number', unit: '', min: 0.7, max: 1.4, step: 0.01 },
    ],
  },
]);

/** Plate types that expose a brand-mark / orbit lockup style group. */
export const LOCKUP_STYLE_TYPES = Object.freeze(['open', 'close', 'features', 'quote', 'statement', 'orbit']);

export const STYLE_VARS = Object.freeze(
  Object.fromEntries(
    STYLE_GROUPS.flatMap((g) =>
      g.vars.map((v) => [v.name, { ...v, group: g.id, only: g.only || null, onlyTypes: g.onlyTypes || null }])
    )
  )
);

/**
 * Groups that apply to a plate. `only` matches fixed ids (open/close); `onlyTypes` matches
 * interstitial `type` (and open/close when those ids are passed as the type).
 */
export function styleGroupsFor(plateId, plateType = null) {
  const type = plateType || plateId;
  return STYLE_GROUPS.filter((g) => {
    if (g.only?.length && !g.only.includes(plateId)) return false;
    if (g.onlyTypes?.length && !g.onlyTypes.includes(type)) return false;
    return true;
  });
}

/** Normalize the plateId / plateType argument accepted by patchStyle / normalizeStyleValue. */
export function styleCtx(plateIdOrCtx, plateType = null) {
  if (plateIdOrCtx && typeof plateIdOrCtx === 'object') {
    return {
      plateId: plateIdOrCtx.plateId ?? null,
      plateType: plateIdOrCtx.plateType ?? plateIdOrCtx.plateId ?? null,
    };
  }
  const plateId = plateIdOrCtx ?? null;
  return { plateId, plateType: plateType ?? plateId };
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([^()]*\)|[a-z]{3,20})$/i;

/** One CSS value, validated against the catalog. Returns the string to store, or throws. */
export function normalizeStyleValue(name, value, plateIdOrCtx = null) {
  const def = STYLE_VARS[name];
  if (!def) throw new Error(`Unknown plate variable ${name}`);
  const { plateId, plateType } = styleCtx(plateIdOrCtx);
  if (def.only?.length && plateId && !def.only.includes(plateId)) {
    throw new Error(`${name} only applies to the ${def.only.join('/')} plate`);
  }
  if (def.onlyTypes?.length && plateType && !def.onlyTypes.includes(plateType)) {
    throw new Error(`${name} only applies to ${def.onlyTypes.join('/')} plates`);
  }
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error(`${name} needs a value`);
  if (def.type === 'color') {
    if (!COLOR_RE.test(raw)) throw new Error(`${name} must be a CSS colour (hex, rgb() or hsl())`);
    return raw.toLowerCase();
  }
  if (def.type === 'toggle') {
    if (['1', 'on', 'true', 'yes'].includes(raw.toLowerCase())) return '1';
    if (['0', 'off', 'false', 'no'].includes(raw.toLowerCase())) return '0';
    throw new Error(`${name} must be on or off`);
  }
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  const v = clamp(n, def.min, def.max);
  const digits = String(def.step).includes('.') ? String(def.step).split('.')[1].length : 0;
  return `${Number(v.toFixed(digits))}${def.unit || ''}`;
}

/**
 * Validate a style map. Unknown variables throw (a typo would silently do nothing in the plate),
 * `null`/'' removes a variable. Returns a fresh object or `undefined` when nothing is left.
 * Third arg: plate id string, or `{ plateId, plateType }` when type-gated groups must be checked.
 */
export function patchStyle(current = {}, patch = {}, plateIdOrCtx = null) {
  const next = { ...(current || {}) };
  const ctx = styleCtx(plateIdOrCtx);
  for (const [name, value] of Object.entries(patch || {})) {
    if (value === null || value === '' || value === undefined) {
      delete next[name];
      continue;
    }
    next[name] = normalizeStyleValue(name, value, ctx);
  }
  return Object.keys(next).length ? next : undefined;
}

/** `<style>` block appended after the template's own rules so the editor's values win the cascade. */
export function styleTag(style) {
  const entries = Object.entries(style || {}).filter(([name]) => STYLE_VARS[name]);
  if (!entries.length) return '';
  return `<style data-plate-style>:root{${entries.map(([k, v]) => `${k}:${v}`).join(';')}}</style>`;
}

/** Inject the plate style into built HTML (before </head>; idempotent). */
export function injectStyle(html, style) {
  const tag = styleTag(style);
  const stripped = html.replace(/<style data-plate-style>[\s\S]*?<\/style>\n?/g, '');
  if (!tag) return stripped;
  if (stripped.includes('</head>')) return stripped.replace('</head>', `${tag}\n</head>`);
  return `${tag}\n${stripped}`;
}

/** Where a plate's editable copy/motion/style live in video.config.json. */
export function plateTarget(config, plateId, { create = false } = {}) {
  if (plateId === 'open' || plateId === 'close') {
    if (!config[plateId] && create) config[plateId] = {};
    return config[plateId] || null;
  }
  return (config.interstitials || []).find((i) => i.id === plateId) || null;
}

/** The key the deck uses for a join; live slices collapse to `live` so the key survives re-records. */
export function joinKey(prev, next) {
  const id = (s) => (s.kind === 'live' ? 'live' : s.id);
  return `${id(prev)}>${id(next)}`;
}

function normalizeRamps(list = [], { liveDur = Infinity } = {}) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const from = r3(clamp(Number(raw.from), 0, liveDur));
    const to = r3(clamp(Number(raw.to), 0, liveDur));
    const rate = Number(raw.rate);
    if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(rate)) {
      throw new Error('speed ramp needs numeric from, to and rate');
    }
    if (to - from < MIN_RAMP_SEC) throw new Error(`speed ramp ${from}–${to}s is shorter than ${MIN_RAMP_SEC}s`);
    if (rate < SPEED_RANGE[0] || rate > SPEED_RANGE[1]) {
      throw new Error(`speed rate must be between ${SPEED_RANGE[0]}× and ${SPEED_RANGE[1]}×`);
    }
    if (Math.abs(rate - 1) < 0.005) continue;
    out.push({ from, to, rate: Math.round(rate * 100) / 100, ...(raw.label ? { label: String(raw.label).slice(0, 60) } : {}) });
  }
  out.sort((a, b) => a.from - b.from);
  for (let i = 1; i < out.length; i++) {
    if (out[i].from < out[i - 1].to - 0.001) {
      throw new Error(`speed ramps overlap at ${out[i].from}s — ramps must not overlap`);
    }
  }
  return out;
}

function normalizeZooms(list = [], { liveDur = Infinity, width = CAPTURE.width, height = CAPTURE.height } = {}) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const t = r3(clamp(Number(raw.t), 0, liveDur));
    const dur = r3(Number(raw.dur));
    if (!Number.isFinite(t) || !Number.isFinite(dur)) throw new Error('zoom needs numeric t and dur');
    if (dur < MIN_ZOOM_SEC) throw new Error(`zoom at ${t}s must last at least ${MIN_ZOOM_SEC}s`);
    const zoom = Math.round(clamp(Number(raw.zoom) || 1.6, ZOOM_RANGE[0], ZOOM_RANGE[1]) * 100) / 100;
    const x = Math.round(clamp(Number(raw.x ?? width / 2), 0, width));
    const y = Math.round(clamp(Number(raw.y ?? height / 2), 0, height));
    let id = String(raw.id || '').trim() || `z${Math.round(t * 10)}`;
    while (seen.has(id)) id = `${id}b`;
    seen.add(id);
    out.push({ id, t, dur: r3(Math.min(dur, Math.max(MIN_ZOOM_SEC, liveDur - t))), zoom, x, y });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function normalizeLenses(list = [], { liveDur = Infinity, width = CAPTURE.width, height = CAPTURE.height } = {}) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const t = r3(clamp(Number(raw.t), 0, liveDur));
    const dur = r3(Number(raw.dur));
    if (!Number.isFinite(t) || !Number.isFinite(dur)) throw new Error('magnifier needs numeric t and dur');
    if (dur < MIN_LENS_SEC) throw new Error(`magnifier at ${t}s must last at least ${MIN_LENS_SEC}s`);
    const w = Math.round(clamp(Number(raw.w) || 160, 16, width));
    const h = Math.round(clamp(Number(raw.h) || 48, 12, height));
    const x = Math.round(clamp(Number(raw.x ?? width / 2), 0, width));
    const y = Math.round(clamp(Number(raw.y ?? height / 2), 0, height));
    let id = String(raw.id || '').trim() || `m${Math.round(t * 10)}`;
    while (seen.has(id)) id = `${id}b`;
    seen.add(id);
    const lens = { id, t, dur: r3(Math.min(dur, Math.max(MIN_LENS_SEC, liveDur - t))), x, y, w, h };
    if (raw.zoom != null && raw.zoom !== '') {
      lens.zoom = Math.round(clamp(Number(raw.zoom) || 1.8, LENS_ZOOM_RANGE[0], LENS_ZOOM_RANGE[1]) * 100) / 100;
    }
    if (raw.label) lens.label = String(raw.label).slice(0, 60);
    out.push(lens);
  }
  return out.sort((a, b) => a.t - b.t);
}

function normalizeLensOff(list = []) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const t = r3(Number(raw?.t ?? raw));
    if (!Number.isFinite(t)) throw new Error('lensOff entries are recording times in seconds');
    if (!out.includes(t)) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

function normalizeSkips(list = [], { liveDur = Infinity } = {}) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const rawFrom = Number(raw.from);
    const rawTo = Number(raw.to);
    if (!Number.isFinite(rawFrom) || !Number.isFinite(rawTo) || rawTo <= rawFrom) {
      throw new Error('zoom skip needs from < to');
    }
    // Clamp to the recording; windows that collapse past the end (shorter re-take) drop quietly.
    const from = r3(clamp(rawFrom, 0, liveDur));
    const to = r3(clamp(rawTo, 0, liveDur));
    if (to <= from) continue;
    out.push({ from, to });
  }
  return out.sort((a, b) => a.from - b.from);
}

function normalizeTransitions(map = {}, styles) {
  const out = {};
  for (const [key, raw] of Object.entries(map && typeof map === 'object' ? map : {})) {
    if (!/^[a-z0-9-]+>[a-z0-9-]+$/.test(key)) throw new Error(`transition key "${key}" must look like prev>next`);
    if (raw === null) continue;
    const entry = {};
    if (raw.style) {
      if (styles && !styles[raw.style]) throw new Error(`Unknown transition style: ${raw.style}`);
      entry.style = raw.style;
    }
    if (raw.duration != null && raw.duration !== '') {
      const d = Number(raw.duration);
      if (!Number.isFinite(d)) throw new Error('transition duration must be a number');
      entry.duration = Math.round(clamp(d, TRANSITION_DUR_RANGE[0], TRANSITION_DUR_RANGE[1]) * 100) / 100;
    }
    if (Object.keys(entry).length) out[key] = entry;
  }
  return out;
}

/**
 * Validate the whole deck. `styles` is TRANSITION_STYLES (passed in to avoid a cycle with edit.mjs).
 * Returns a normalized deck; empty lists stay empty so callers can `isEmptyDeck()`.
 */
/** Segment ids in the order the cut should play. Unknown ids drop; duplicates collapse. */
export function normalizeOrder(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const id = String(raw ?? '').trim();
    if (!id || id.length > 80 || seen.has(id) || !/^[\w.:@+-]+$/.test(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 80) break;
  }
  return out;
}

export const MIN_LIVE_TRIM_KEEP = 0.4;
/** A cut shorter than this is ignored. A leftover sliver shorter than this is absorbed into the cut. */
export const MIN_CUT_SEC = 0.2;
export const MIN_CUT_KEEP = 0.35;

/**
 * Recording-clock ranges to remove. Overlaps merge. Times are seconds in live.mp4.
 * @param {{ from?: number, to?: number }[]} [list]
 */
export function normalizeCuts(list = [], { liveDur = Infinity } = {}) {
  const raw = [];
  const cap = Number.isFinite(liveDur) ? liveDur : Infinity;
  for (const item of Array.isArray(list) ? list : []) {
    let from = Number(item?.from);
    let to = Number(item?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    if (to < from) [from, to] = [to, from];
    from = Math.max(0, from);
    to = Math.min(cap, to);
    if (to - from < MIN_CUT_SEC - 1e-6) continue;
    raw.push({ from: r3(from), to: r3(to) });
  }
  raw.sort((a, b) => a.from - b.from || a.to - b.to);
  const out = [];
  for (const cut of raw) {
    const prev = out[out.length - 1];
    if (prev && cut.from <= prev.to + 0.02) prev.to = r3(Math.max(prev.to, cut.to));
    else out.push({ ...cut });
    if (out.length >= 40) break;
  }
  return out;
}

/** Subtract cut ranges from [from, to]. Slivers under MIN_CUT_KEEP are absorbed into the cut. */
function subtractCuts(from, to, cuts) {
  let spans = [[from, to]];
  for (const cut of cuts) {
    const next = [];
    for (const [a, b] of spans) {
      const lo = Math.max(a, cut.from);
      const hi = Math.min(b, cut.to);
      if (hi - lo < 0.01) {
        next.push([a, b]);
        continue;
      }
      if (lo - a >= MIN_CUT_KEEP) next.push([a, r3(lo)]);
      if (b - hi >= MIN_CUT_KEEP) next.push([r3(hi), b]);
    }
    spans = next;
  }
  return spans;
}

/**
 * Punch `cuts` out of live segments (editor scenes with recFrom/recTo, or produce slices
 * with start/end on the cleaned clock). A cut in the middle becomes two slices joined by a
 * hard cut (`hardCut`); a cut that covers a slice drops it. Never returns an empty list.
 * @param {object[]|null|undefined} segments
 * @param {{ from: number, to: number }[]} cuts
 * @param {{ fromClean?: (n: number) => number, toClean?: (n: number) => number }|null} [map]
 */
export function applySegmentCuts(segments, cuts, map = null) {
  const list = normalizeCuts(cuts);
  if (!list.length || !Array.isArray(segments) || !segments.length) return segments;
  const toRec = (t) => (map?.fromClean ? map.fromClean(t) : t);
  const toClean = (t) => (map?.toClean ? map.toClean(t) : t);
  const out = [];
  for (const seg of segments) {
    if (seg.kind !== 'live') {
      out.push(seg);
      continue;
    }
    const recFrom = seg.recFrom != null ? Number(seg.recFrom) : toRec(Number(seg.start));
    const recTo = seg.recTo != null ? Number(seg.recTo) : toRec(Number(seg.end));
    if (!Number.isFinite(recFrom) || !Number.isFinite(recTo) || recTo - recFrom < 0.05) {
      out.push(seg);
      continue;
    }
    const kept = subtractCuts(recFrom, recTo, list);
    if (!kept.length) continue;
    const same = kept.length === 1 && Math.abs(kept[0][0] - recFrom) < 0.001 && Math.abs(kept[0][1] - recTo) < 0.001;
    if (same) {
      out.push(seg);
      continue;
    }
    kept.forEach(([a, b], i) => {
      const start = r3(toClean(a));
      const end = r3(toClean(b));
      const piece = {
        ...seg,
        id: `live-${a.toFixed(2)}`,
        recFrom: r3(a),
        recTo: r3(b),
        start,
        end,
        cleanFrom: start,
        cleanTo: end,
        dur: r3(Math.max(0.05, end - start)),
      };
      if (i > 0) {
        piece.hardCut = true;
        delete piece.transitionIn;
        delete piece.opensOnCard;
      } else if (a > recFrom + 0.05) {
        delete piece.opensOnCard;
      }
      out.push(piece);
    });
  }
  return out.length ? out : segments;
}

/** Head/tail trims on live sections, keyed by segment id (recording-clock seconds). */
export function normalizeTrims(list = []) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const id = String(raw?.id ?? '').trim();
    if (!id || id.length > 80 || seen.has(id) || !/^[\w.:@+-]+$/.test(id)) continue;
    const trimStart = r3(Math.max(0, Number(raw.trimStart) || 0));
    const trimEnd = r3(Math.max(0, Number(raw.trimEnd) || 0));
    if (!trimStart && !trimEnd) continue;
    seen.add(id);
    out.push({ id, ...(trimStart ? { trimStart } : {}), ...(trimEnd ? { trimEnd } : {}) });
    if (out.length >= 80) break;
  }
  return out;
}

/**
 * Apply edit.trims to live segments. Works on produce plan slices (`start`/`end`) and
 * editor scenes (`recFrom`/`recTo`). Keeps at least MIN_LIVE_TRIM_KEEP seconds.
 */
export function applySegmentTrims(segments, trims) {
  const byId = new Map(normalizeTrims(trims).map((t) => [t.id, t]));
  if (!byId.size || !Array.isArray(segments)) return segments;
  return segments.map((seg) => {
    if (seg.kind !== 'live') return seg;
    const t = byId.get(seg.id);
    if (!t) return seg;
    const trimStart = t.trimStart || 0;
    const trimEnd = t.trimEnd || 0;
    if (seg.recFrom != null && seg.recTo != null) {
      const span = seg.recTo - seg.recFrom;
      const keep = Math.max(MIN_LIVE_TRIM_KEEP, span - trimStart - trimEnd);
      const head = Math.min(trimStart, Math.max(0, span - MIN_LIVE_TRIM_KEEP));
      const tail = Math.min(trimEnd, Math.max(0, span - head - MIN_LIVE_TRIM_KEEP));
      const recFrom = r3(seg.recFrom + head);
      const recTo = r3(seg.recFrom + head + keep);
      const next = { ...seg, recFrom, recTo, dur: r3(recTo - recFrom), trimStart: head, trimEnd: tail };
      if (seg.start != null && seg.end != null) {
        const ratio = span > 0 ? (seg.end - seg.start) / span : 1;
        next.start = r3(seg.start + head * ratio);
        next.end = r3(next.start + keep * ratio);
        next.dur = r3(next.end - next.start);
      }
      if (seg.cleanFrom != null && seg.cleanTo != null) {
        const ratio = span > 0 ? (seg.cleanTo - seg.cleanFrom) / span : 1;
        next.cleanFrom = r3(seg.cleanFrom + head * ratio);
        next.cleanTo = r3(next.cleanFrom + keep * ratio);
      }
      return next;
    }
    if (seg.start == null || seg.end == null) return seg;
    const span = seg.end - seg.start;
    const keep = Math.max(MIN_LIVE_TRIM_KEEP, span - trimStart - trimEnd);
    const head = Math.min(trimStart, Math.max(0, span - MIN_LIVE_TRIM_KEEP));
    const tail = Math.min(trimEnd, Math.max(0, span - head - MIN_LIVE_TRIM_KEEP));
    const start = r3(seg.start + head);
    const end = r3(seg.start + head + keep);
    return { ...seg, start, end, dur: r3(end - start), trimStart: head, trimEnd: tail };
  });
}

/**
 * Permute segments by `order`. Ids the plan no longer has are skipped. A segment the order
 * doesn't mention (a plate added since) keeps its place after the nearest listed predecessor.
 */
export function applySegmentOrder(segments, order) {
  const ids = normalizeOrder(order);
  if (!ids.length || !Array.isArray(segments) || !segments.length) return segments;
  const byId = new Map(segments.map((s) => [s.id, s]));
  const used = new Set();
  const out = [];
  for (const id of ids) {
    const seg = byId.get(id);
    if (!seg || used.has(id)) continue;
    out.push(seg);
    used.add(id);
  }
  if (!out.length) return segments;
  for (const seg of segments) {
    if (used.has(seg.id)) continue;
    let at = 0;
    const idx = segments.indexOf(seg);
    for (let i = idx - 1; i >= 0; i--) {
      const pos = out.indexOf(segments[i]);
      if (pos >= 0) {
        at = pos + 1;
        break;
      }
    }
    out.splice(at, 0, seg);
    used.add(seg.id);
  }
  return out;
}

/**
 * Drop omitted segment ids from the cut. Never empties the list — if every id is omitted,
 * the original order is kept so produce still has something to encode.
 */
export function applySegmentOmit(segments, omit) {
  const drop = new Set(normalizeOrder(omit));
  if (!drop.size || !Array.isArray(segments) || !segments.length) return segments;
  const kept = segments.filter((s) => !drop.has(s.id));
  return kept.length ? kept : segments;
}

/** Stable id for a recording chapter/caption mark (matches Studio timeline). */
export function cardMarkKey(mark) {
  if (!mark) return '';
  return `${mark.kind || 'card'}:${Number(mark.t).toFixed(3)}:${String(mark.label || '')}`;
}

/** Apply `edit.cards` overrides onto timeline marks (recording clock). Preserves `key` when set. */
export function applyCardEdits(marks, cards = []) {
  if (!Array.isArray(marks)) return [];
  if (!cards?.length) return marks;
  const byKey = new Map(cards.map((c) => [c.key, c]));
  return marks.map((m) => {
    if (m.kind !== 'chapter' && m.kind !== 'caption') return m;
    const key = m.key || cardMarkKey(m);
    const edit = byKey.get(key);
    if (!edit) return m.key ? m : { ...m, key };
    const next = { ...m, key };
    if (edit.t != null && Number.isFinite(Number(edit.t))) next.t = Number(edit.t);
    if (edit.dur != null && Number.isFinite(Number(edit.dur)) && Number(edit.dur) > 0) next.dur = Number(edit.dur);
    return next;
  });
}

/** Chapter/caption placement overrides from the Editor timeline (recording clock). */
export function normalizeCards(list, { liveDur = Infinity } = {}) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const key = String(raw?.key || '').trim();
    if (!key || key.length > 160 || seen.has(key)) continue;
    const row = { key };
    if (raw.t != null && Number.isFinite(Number(raw.t))) {
      row.t = r3(clamp(Number(raw.t), 0, Number.isFinite(liveDur) ? liveDur : Number(raw.t)));
    }
    if (raw.dur != null && Number.isFinite(Number(raw.dur)) && Number(raw.dur) > 0) {
      row.dur = r3(clamp(Number(raw.dur), 0.4, 30));
    }
    if (row.t == null && row.dur == null) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= 80) break;
  }
  return out;
}

export function normalizeEdit(edit = {}, { liveDur = Infinity, width = CAPTURE.width, height = CAPTURE.height, styles = null } = {}) {
  const src = edit && typeof edit === 'object' ? edit : {};
  return {
    speed: normalizeRamps(src.speed, { liveDur }),
    zooms: normalizeZooms(src.zooms, { liveDur, width, height }),
    zoomSkips: normalizeSkips(src.zoomSkips, { liveDur }),
    lenses: normalizeLenses(src.lenses, { liveDur, width, height }),
    lensOff: normalizeLensOff(src.lensOff),
    transitions: normalizeTransitions(src.transitions, styles),
    audio: normalizeAudio(src.audio),
    cards: normalizeCards(src.cards, { liveDur }),
    layouts: normalizeLayouts(src.layouts),
    order: normalizeOrder(src.order),
    omit: normalizeOrder(src.omit),
    trims: normalizeTrims(src.trims),
    cuts: normalizeCuts(src.cuts, { liveDur }),
  };
}

export function isEmptyDeck(deck) {
  return (
    !deck ||
    (!deck.speed?.length &&
      !deck.zooms?.length &&
      !deck.zoomSkips?.length &&
      !deck.lenses?.length &&
      !deck.lensOff?.length &&
      !Object.keys(deck.transitions || {}).length &&
      !deck.cards?.length &&
      !deck.layouts?.length &&
      !deck.order?.length &&
      !deck.omit?.length &&
      !deck.trims?.length &&
      !deck.cuts?.length &&
      isEmptyAudio(deck.audio))
  );
}

/** Apply a partial update: each present key replaces that list/map wholesale (`reset` clears everything). */
export function patchEdit(current = {}, patch = {}, opts = {}) {
  if (patch.reset) return normalizeEdit({}, opts);
  const merged = { ...(current || {}) };
  for (const key of ['speed', 'zooms', 'zoomSkips', 'lenses', 'lensOff', 'transitions', 'audio', 'cards', 'layouts', 'order', 'omit', 'trims', 'cuts']) {
    if (key in patch) merged[key] = patch[key] ?? (key === 'transitions' ? {} : []);
  }
  return normalizeEdit(merged, opts);
}

/** The deck as stored: drop empty keys so an untouched config stays short. */
export function compactEdit(deck) {
  const out = {};
  if (deck?.speed?.length) out.speed = deck.speed;
  if (deck?.zooms?.length) out.zooms = deck.zooms;
  if (deck?.zoomSkips?.length) out.zoomSkips = deck.zoomSkips;
  if (deck?.lenses?.length) out.lenses = deck.lenses;
  if (deck?.lensOff?.length) out.lensOff = deck.lensOff;
  if (deck?.transitions && Object.keys(deck.transitions).length) out.transitions = deck.transitions;
  if (deck?.cards?.length) out.cards = deck.cards;
  if (deck?.layouts?.length) out.layouts = deck.layouts;
  if (deck?.order?.length) out.order = deck.order;
  if (deck?.omit?.length) out.omit = deck.omit;
  if (deck?.trims?.length) out.trims = deck.trims;
  if (deck?.cuts?.length) out.cuts = deck.cuts;
  const audio = compactAudio(deck?.audio);
  if (audio) out.audio = audio;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Piecewise-linear clock between the recording (live.mp4) and the cleaned reel after speed ramps.
 * Gaps between ramps run at 1×. `pieces` always covers [0, liveDur].
 */
export function liveTimeMap(ramps = [], liveDur = 0) {
  const sorted = normalizeRamps(ramps, { liveDur });
  const pieces = [];
  let cursor = 0;
  let clean = 0;
  const push = (from, to, rate) => {
    if (to - from <= 0) return;
    pieces.push({ from, to, rate, cleanFrom: r3(clean), cleanTo: r3(clean + (to - from) / rate) });
    clean += (to - from) / rate;
  };
  for (const ramp of sorted) {
    push(cursor, ramp.from, 1);
    push(ramp.from, ramp.to, ramp.rate);
    cursor = ramp.to;
  }
  push(cursor, Math.max(cursor, liveDur), 1);
  const cleanDur = r3(clean);
  const toClean = (t) => {
    if (!pieces.length) return t;
    if (t <= 0) return 0;
    for (const p of pieces) {
      if (t <= p.to) return r3(p.cleanFrom + (t - p.from) / p.rate);
    }
    const last = pieces.at(-1);
    return r3(last.cleanTo + (t - last.to));
  };
  const fromClean = (c) => {
    if (!pieces.length) return c;
    if (c <= 0) return 0;
    for (const p of pieces) {
      if (c <= p.cleanTo) return r3(p.from + (c - p.cleanFrom) * p.rate);
    }
    const last = pieces.at(-1);
    return r3(last.to + (c - last.cleanTo));
  };
  const rateAt = (t) => pieces.find((p) => t >= p.from && t < p.to)?.rate ?? 1;
  return { pieces, ramps: sorted, liveDur: r3(liveDur), cleanDur, toClean, fromClean, rateAt, identity: !sorted.length };
}

/**
 * ffmpeg `setpts` expression for the map — a nested `if` over T so no frame is buffered beyond
 * the decoder (a split/trim/concat graph would hold whole segments in memory). Followed by `fps`
 * so the sped-up stretch is decimated and the slowed one duplicated on the output grid.
 */
export function speedFilter(map, fps) {
  if (!map || map.identity) return null;
  const f3 = (v) => Number(v).toFixed(3);
  let expr = null;
  for (let i = map.pieces.length - 1; i >= 0; i--) {
    const p = map.pieces[i];
    const value = `${f3(p.cleanFrom)}+(T-${f3(p.from)})/${f3(p.rate)}`;
    expr = expr === null ? value : `if(lt(T,${f3(p.to)}),${value},${expr})`;
  }
  return `setpts='(${expr})/TB',fps=${fps}`;
}

/** Timeline marks moved onto the cleaned clock (durations scale with the ramp they sit in). */
export function remapTimeline(timeline = [], map) {
  if (!map || map.identity) return timeline;
  return timeline.map((m) => {
    if (!Number.isFinite(m.t)) return m;
    const next = { ...m, t: map.toClean(m.t), liveT: m.t };
    if (Number.isFinite(m.dur) && m.dur > 0) next.dur = r3(Math.max(0.05, map.toClean(m.t + m.dur) - next.t));
    return next;
  });
}

/** Synthetic timeline marks that feed the deck's zooms and skips into planZooms. */
export function editCameraMarks(deck) {
  const marks = [];
  for (const z of deck?.zooms || []) {
    marks.push({ kind: 'zoom', id: z.id, t: z.t, dur: z.dur, zoom: z.zoom, x: z.x, y: z.y, source: 'edit' });
  }
  for (const s of deck?.zoomSkips || []) marks.push({ kind: 'nozoom', t: s.from, dur: r3(s.to - s.from) });
  return marks;
}

/**
 * The magnifiers the cut renders: recorded `magnify` marks the deck has not switched off, plus the
 * deck's own lenses as marks of the same shape (`rect` in live-frame pixels). `source` says which.
 */
export function resolveLenses(timeline = [], deck) {
  const off = new Set((deck?.lensOff || []).map(r3));
  const recorded = timeline
    .filter((m) => m.kind === 'magnify' && m.rect && m.dur && !off.has(r3(m.t)))
    .map((m) => ({ ...m, source: 'auto' }));
  const own = (deck?.lenses || []).map((l) => ({
    kind: 'magnify',
    id: l.id,
    label: l.label || 'Magnifier',
    t: l.t,
    dur: l.dur,
    rect: { x: Math.round(l.x - l.w / 2), y: Math.round(l.y - l.h / 2), w: l.w, h: l.h },
    ...(l.zoom ? { zoom: l.zoom } : {}),
    source: 'edit',
  }));
  return [...recorded, ...own].sort((a, b) => a.t - b.t);
}

/** The recording's timeline with the deck's magnifier choices applied (zoom planning keeps clear of them). */
export function withEditLenses(timeline = [], deck) {
  return [...timeline.filter((m) => m.kind !== 'magnify'), ...resolveLenses(timeline, deck)].sort((a, b) => a.t - b.t);
}

/** Marks a ramp would stretch or squash — surfaced in the Studio so a card is not sped through by accident. */
export function rampConflicts(deck, timeline = []) {
  const out = [];
  for (const ramp of deck?.speed || []) {
    const hits = timeline.filter(
      (m) => ['chapter', 'caption', 'magnify'].includes(m.kind) && m.t < ramp.to && m.t + (m.dur || 2.4) > ramp.from
    );
    if (hits.length) {
      out.push({
        from: ramp.from,
        to: ramp.to,
        marks: hits.map((m) => ({ kind: m.kind, t: m.t, label: m.label || m.body || '' })),
      });
    }
  }
  return out;
}

/** One-line human summary for the CLI and the Studio badges. */
export function describeDeck(deck) {
  const bits = [];
  if (deck?.speed?.length) bits.push(`${deck.speed.length} speed ramp${deck.speed.length === 1 ? '' : 's'}`);
  if (deck?.zooms?.length) bits.push(`${deck.zooms.length} manual zoom${deck.zooms.length === 1 ? '' : 's'}`);
  if (deck?.zoomSkips?.length) bits.push(`${deck.zoomSkips.length} zoom-free window${deck.zoomSkips.length === 1 ? '' : 's'}`);
  if (deck?.lenses?.length) bits.push(`${deck.lenses.length} magnifier${deck.lenses.length === 1 ? '' : 's'}`);
  if (deck?.lensOff?.length) bits.push(`${deck.lensOff.length} magnifier${deck.lensOff.length === 1 ? '' : 's'} off`);
  const joins = Object.keys(deck?.transitions || {}).length;
  if (joins) bits.push(`${joins} join override${joins === 1 ? '' : 's'}`);
  if (deck?.layouts?.length) bits.push(`${deck.layouts.length} section layout${deck.layouts.length === 1 ? '' : 's'}`);
  if (deck?.order?.length) bits.push('sequence reordered');
  if (deck?.omit?.length) bits.push(`${deck.omit.length} section${deck.omit.length === 1 ? '' : 's'} omitted`);
  if (deck?.trims?.length) bits.push(`${deck.trims.length} live trim${deck.trims.length === 1 ? '' : 's'}`);
  if (deck?.cuts?.length) {
    const sec = deck.cuts.reduce((sum, cut) => sum + (cut.to - cut.from), 0);
    bits.push(`${deck.cuts.length} cut${deck.cuts.length === 1 ? '' : 's'} · ${sec.toFixed(1)}s removed`);
  }
  const audio = describeAudio(deck?.audio);
  if (audio) bits.push(audio);
  return bits.length ? bits.join(' · ') : 'no edits';
}
