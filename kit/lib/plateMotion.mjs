/**
 * Brand motion language for plates — maps brand.json → motion + CSS timing tokens.
 * Motion guides attention (industry standard); it never decorates for its own sake.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROMOTED_FIELDS } from './atmosphereLab.mjs';

export const PROFILES = {
  calm: {
    enterMs: 1000,
    staggerMs: 140,
    pushScale: 1.02,
    exitMs: 700,
    cardPop: 0.94,
    blobDrift: 0.7,
  },
  clear: {
    enterMs: 900,
    staggerMs: 120,
    pushScale: 1.035,
    exitMs: 700,
    cardPop: 0.96,
    blobDrift: 1,
  },
  punchy: {
    enterMs: 720,
    staggerMs: 90,
    pushScale: 1.05,
    exitMs: 560,
    cardPop: 0.92,
    blobDrift: 1.15,
  },
};

/** Timing numbers a profile expands to; pinned copies in brand.json follow the energy that wrote them. */
const PROFILE_KEYS = ['enterMs', 'staggerMs', 'pushScale', 'exitMs', 'cardPop', 'blobDrift'];

/**
 * Lay an override (video direction, one plate) on brand motion. A new energy brings its own
 * profile numbers: pinned `enterMs`-style values in the base belong to the energy they were
 * written for, so they step aside unless the override pins them again.
 */
export function mergeMotion(base = {}, overlay = {}) {
  const b = base || {};
  const o = overlay || {};
  if (!o.energy || o.energy === b.energy) return { ...b, ...o };
  const kept = { ...b };
  for (const k of PROFILE_KEYS) delete kept[k];
  return { ...kept, ...o };
}

/** Brand with a motion overlay applied (see mergeMotion); returns the brand itself for an empty overlay. */
export function withMotion(brand, overlay = {}) {
  return Object.keys(overlay || {}).length ? { ...brand, motion: mergeMotion(brand.motion, overlay) } : brand;
}

/** Resolve motion profile from brand.json → motion, or motion-brief keywords. */
export function resolveMotion(brand) {
  const raw = brand.motion || {};
  let energy = raw.energy || 'clear';
  if (!raw.energy && brand.motionBrief) {
    const briefPath = join(brand.dir, brand.motionBrief);
    if (existsSync(briefPath)) {
      const text = readFileSync(briefPath, 'utf8').toLowerCase();
      if (/punchy|energetic|snappy|bold motion/.test(text)) energy = 'punchy';
      else if (/calm|restrained|quiet|slow/.test(text)) energy = 'calm';
    }
  }
  const base = PROFILES[energy] || PROFILES.clear;
  const atmosphere = ATMOSPHERE_IDS.includes(raw.atmosphere)
    ? raw.atmosphere
    : raw.scheduleField === true
      ? 'schedule'
      : 'none';
  return {
    energy,
    enterMs: raw.enterMs ?? base.enterMs,
    staggerMs: raw.staggerMs ?? base.staggerMs,
    pushScale: raw.pushScale ?? base.pushScale,
    exitMs: raw.exitMs ?? base.exitMs,
    cardPop: raw.cardPop ?? base.cardPop,
    blobDrift: raw.blobDrift ?? base.blobDrift,
    // Logo / wipe timing used by open + feature plates (shared defaults)
    tWipeL: raw.tWipeL ?? 2.35,
    tWipeR: raw.tWipeR ?? 2.55,
    tWord: raw.tWord ?? 3.15,
    tDraw: raw.tDraw ?? 2.8,
    tSweep: raw.tSweep ?? 4.2,
    tTrace: raw.tTrace ?? 2.9,
    tTravel: raw.tTravel ?? 0.08,
    // Open plate: settled lockup after the lift (scale + translateY %)
    openLiftScale: raw.openLiftScale ?? 0.58,
    openLiftY: raw.openLiftY ?? -210,
    // Open plate: initial lockup box (before lift) — % from top, width in px
    openLogoTop: raw.openLogoTop ?? 52,
    openLogoWidth: raw.openLogoWidth ?? 820,
    // WebGL atmosphere behind every plate (lib/atmosphere.mjs). `scheduleField: true` is the
    // legacy spelling of `atmosphere: "schedule"`.
    atmosphere,
    // The legacy opacity only tunes the schedule field; other fields keep their own default.
    atmosphereOpacity: raw.atmosphereOpacity ?? (atmosphere === 'schedule' ? raw.scheduleFieldOpacity : undefined),
    atmosphereSpeed: raw.atmosphereSpeed,
    scheduleField: raw.scheduleField === true || raw.atmosphere === 'schedule',
    scheduleFieldOpacity: raw.scheduleFieldOpacity ?? raw.atmosphereOpacity ?? 0.34,
    // Title reveal: rise (masked word rise) | cascade (per-character) | wipe (clip reveal)
    titleReveal: TITLE_REVEALS.includes(raw.titleReveal) ? raw.titleReveal : 'rise',
    // Card entrance depth: flat | soft | deep (perspective tilt as cards land)
    depth: DEPTHS.includes(raw.depth) ? raw.depth : 'soft',
    // Light sheen sweeping each card once it has landed
    sheen: raw.sheen !== false,
  };
}

const CORE_ATMOSPHERE_IDS = ['none', 'schedule', 'aurora', 'mesh', 'particles', 'grid', 'waves'];

/** Short second line for Studio buttons and the CLI. Hints on the field stay the long form. */
const PROMOTED_BLURBS = {
  contour: 'simplex contours',
  signal: 'warped isobars',
  halftone: 'dotted isobars',
  iridescent: 'spectral bands',
  silk: 'flowing threads',
  ridgelines: 'stacked ridges',
  interference: 'crossing ripples',
  warpstripes: 'bent stripes',
  bend: 'bowed hairlines',
  traces: 'phosphor traces',
  isometric: 'iso lattice',
  sonar: 'sweep rings',
  constellation: 'linked points',
  cells: 'cell walls',
  dunes: 'lit crests',
  caustics: 'water light',
  smoke: 'cinematic haze',
  marble: 'stone veins',
  tide: 'rolling swells',
  rain: 'falling strands',
  embers: 'rising sparks',
  orbit: 'tilted ellipses',
  circuit: 'board traces',
  horizon: 'low glow + stars',
  shaft: 'light shaft',
  eclipse: 'drifting corona',
  tunnel: 'forward tunnel',
  meters: 'level meters',
  hex: 'hex lattice',
  spiral: 'unwinding arm',
  frost: 'crystal branches',
  braid: 'woven ribbons',
};

export const ATMOSPHERE_IDS = [...CORE_ATMOSPHERE_IDS, ...PROMOTED_FIELDS.map((f) => f.id)];
export const TITLE_REVEALS = ['rise', 'cascade', 'wipe'];
export const DEPTHS = ['flat', 'soft', 'deep'];
export const ENERGIES = Object.keys(PROFILES);

/** Human labels for the Studio and the CLI — one place so both read the same words. */
export const ATMOSPHERE_LABELS = {
  none: 'None · flat vignette',
  schedule: 'Schedule · timeline bars',
  aurora: 'Aurora · colour ribbons',
  mesh: 'Mesh · gradient mesh',
  particles: 'Particles · bokeh dust',
  grid: 'Grid · perspective floor',
  waves: 'Waves · flow lines',
  ...Object.fromEntries(PROMOTED_FIELDS.map((f) => [f.id, `${f.label} · ${PROMOTED_BLURBS[f.id] || f.hint}`])),
};

const MOTION_NUMBER_KEYS = ['enterMs', 'staggerMs', 'pushScale', 'exitMs', 'openLiftScale', 'openLiftY', 'openLogoTop', 'openLogoWidth'];
const MOTION_ENUM_KEYS = { energy: ENERGIES, atmosphere: ATMOSPHERE_IDS, titleReveal: TITLE_REVEALS, depth: DEPTHS };
const MOTION_RANGE_KEYS = { atmosphereOpacity: [0, 1], atmosphereSpeed: [0.3, 3] };

/**
 * Validate and merge a motion patch (Studio `/motion`, per-plate overrides, CLI `motion`).
 * Unknown keys are ignored; `null` clears a key so a plate can fall back to the video.
 * Throws on a value outside its enum or range.
 */
export function patchMotion(current = {}, patch = {}) {
  const next = { ...current };
  const unset = (k) => {
    delete next[k];
  };
  for (const [key, allowed] of Object.entries(MOTION_ENUM_KEYS)) {
    if (!(key in patch)) continue;
    const v = patch[key];
    if (v == null || v === '') {
      if (v === null) unset(key);
      continue;
    }
    if (!allowed.includes(v)) throw new Error(`${key} must be one of ${allowed.join(', ')}`);
    next[key] = v;
  }
  if ('sheen' in patch) {
    if (patch.sheen === null) unset('sheen');
    else if (typeof patch.sheen === 'boolean') next.sheen = patch.sheen;
    else if (['on', 'off', 'true', 'false'].includes(String(patch.sheen))) next.sheen = ['on', 'true'].includes(String(patch.sheen));
    else throw new Error('sheen must be on or off');
  }
  for (const [key, [lo, hi]] of Object.entries(MOTION_RANGE_KEYS)) {
    if (!(key in patch)) continue;
    if (patch[key] === null) {
      unset(key);
      continue;
    }
    if (patch[key] === '' || patch[key] === undefined) continue;
    const n = Number(patch[key]);
    if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
    next[key] = Math.min(hi, Math.max(lo, n));
  }
  for (const key of MOTION_NUMBER_KEYS) {
    if (!(key in patch)) continue;
    if (patch[key] === null) {
      unset(key);
      continue;
    }
    if (patch[key] === '' || patch[key] === undefined) continue;
    const n = Number(patch[key]);
    if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
    next[key] = n;
  }
  return next;
}

/** Which motion keys a plate overrides versus the video (for the Studio accent badge). */
export function motionOverrides(plateMotion = {}) {
  return Object.keys(plateMotion).filter((k) => k in MOTION_ENUM_KEYS || k === 'sheen' || k in MOTION_RANGE_KEYS);
}
const DEPTH_TILT = { flat: 0, soft: 9, deep: 17 };
const DEPTH_LIFT = { flat: 0, soft: 26, deep: 44 };

/** Which plate CSS variables each Look control drives — the Studio applies these live, before the rebuild lands. */
export const LOOK_VAR_KEYS = Object.freeze({
  energy: ['--motion-energy', '--motion-enter', '--motion-stagger', '--motion-exit', '--motion-push', '--motion-pop', '--motion-drift'],
  depth: ['--card-tilt', '--card-lift'],
  sheen: ['--sheen'],
  titleReveal: ['--title-reveal'],
});

/** Look tokens as a `{ '--var': 'value' }` object for a resolved motion (the live subset of motionCssVars). */
export function lookVars(m) {
  return {
    '--motion-energy': m.energy,
    '--motion-enter': `${(m.enterMs / 1000).toFixed(2)}s`,
    '--motion-stagger': `${(m.staggerMs / 1000).toFixed(3)}s`,
    '--motion-exit': `${(m.exitMs / 1000).toFixed(2)}s`,
    '--motion-push': String(m.pushScale),
    '--motion-pop': String(m.cardPop),
    '--motion-drift': String(m.blobDrift),
    '--card-tilt': `${DEPTH_TILT[m.depth]}deg`,
    '--card-lift': `${DEPTH_LIFT[m.depth]}px`,
    '--sheen': m.sheen ? '1' : '0',
    '--title-reveal': m.titleReveal,
  };
}

/**
 * Every Look choice → the variables it sets, resolved against this brand (so brand-level timing
 * tweaks survive an energy switch). `lookVarTable(brand).depth.deep` → `{ '--card-tilt': '17deg', … }`.
 */
export function lookVarTable(brand) {
  const pick = (vars, keys) => Object.fromEntries(keys.map((k) => [k, vars[k]]));
  const withKey = (key, value) => lookVars(resolveMotion(withMotion(brand, { [key]: value })));
  const table = {};
  for (const [key, values] of Object.entries({ energy: ENERGIES, depth: DEPTHS, titleReveal: TITLE_REVEALS })) {
    table[key] = Object.fromEntries(values.map((v) => [v, pick(withKey(key, v), LOOK_VAR_KEYS[key])]));
  }
  table.sheen = { on: pick(withKey('sheen', true), LOOK_VAR_KEYS.sheen), off: pick(withKey('sheen', false), LOOK_VAR_KEYS.sheen) };
  return table;
}

/** What a plate's look resolves to once its overrides sit on the video motion — the Studio syncs the live frame to this. */
export function plateLook(brand, plateMotion = {}) {
  const { cascade: _cascade, carousel: _carousel, ...overlay } = plateMotion || {};
  const m = resolveMotion(withMotion(brand, overlay));
  return { vars: lookVars(m), atmosphere: m.atmosphere, titleReveal: m.titleReveal, depth: m.depth, energy: m.energy, sheen: m.sheen };
}

/** CSS custom properties injected into every plate :root via BRAND_VARS. */
export function motionCssVars(brand) {
  const m = resolveMotion(brand);
  const look = lookVars(m);
  return [
    `--motion-energy: ${look['--motion-energy']};`,
    `--motion-enter: ${look['--motion-enter']};`,
    `--motion-stagger: ${look['--motion-stagger']};`,
    `--motion-exit: ${look['--motion-exit']};`,
    `--motion-push: ${look['--motion-push']};`,
    `--motion-pop: ${look['--motion-pop']};`,
    `--motion-drift: ${look['--motion-drift']};`,
    `--t-wipe-l: ${m.tWipeL}s;`,
    `--t-wipe-r: ${m.tWipeR}s;`,
    `--t-word: ${m.tWord}s;`,
    `--t-draw: ${m.tDraw}s;`,
    `--t-sweep: ${m.tSweep}s;`,
    `--t-trace: ${m.tTrace}s;`,
    `--t-travel: ${m.tTravel}s;`,
    `--open-lift-scale: ${m.openLiftScale};`,
    `--open-lift-y: ${m.openLiftY}%;`,
    `--open-logo-top: ${m.openLogoTop}%;`,
    `--open-logo-width: ${m.openLogoWidth}px;`,
    `--schedule-field-opacity: ${m.scheduleField ? m.scheduleFieldOpacity : 0};`,
    `--card-tilt: ${look['--card-tilt']};`,
    `--card-lift: ${look['--card-lift']};`,
    `--sheen: ${look['--sheen']};`,
    `--title-reveal: ${look['--title-reveal']};`,
  ].join('\n      ');
}
