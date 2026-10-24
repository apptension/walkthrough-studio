/**
 * Deterministic variety for a first draft. Every video gets a coherent but distinctive combination —
 * opener, closer, mid-plate layouts, atmosphere, title reveal, depth, live-card preset and a
 * transition palette — seeded by its slug and title, so the same video always draws the same pick
 * and two videos for one brand rarely draw the same one. Only fills what the config leaves open:
 * an explicit choice (agent, Studio, CLI) always wins.
 */
import { ATMOSPHERE_IDS, ENERGIES, TITLE_REVEALS } from './plateMotion.mjs';
import { CLOSE_LAYOUTS, OPEN_LAYOUTS, PLATE_LAYOUTS, defaultLayout, layoutsFor } from './plateLayouts.mjs';
import { OVERLAY_PRESET_IDS } from './liveCards.mjs';
import { TRANSITION_STYLES } from './edit.mjs';

/** FNV-1a over the joined parts — stable across runs and platforms. */
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  for (const ch of parts.map((p) => String(p ?? '')).join('\u241f')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: a small seeded generator → floats in [0, 1). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Weighted pick from `[value, weight]` pairs (weights ≤ 0 drop out). */
function weighted(rand, pairs) {
  const live = pairs.filter(([, w]) => w > 0);
  const total = live.reduce((s, [, w]) => s + w, 0);
  if (!total) return pairs[0]?.[0];
  let x = rand() * total;
  for (const [v, w] of live) {
    x -= w;
    if (x < 0) return v;
  }
  return live.at(-1)[0];
}

const only = (list, allowed) => list.filter((v) => allowed.includes(v));

const MOOD_BY_PURPOSE = {
  overview: ['clear', 'calm', 'clear', 'punchy'],
  feature: ['clear', 'punchy', 'clear'],
  onboarding: ['calm', 'calm', 'clear'],
  launch: ['punchy', 'clear', 'punchy'],
  sales: ['punchy', 'clear', 'clear'],
};

export const ATMOSPHERE_MOODS = Object.freeze({
  calm: only(['aurora', 'silk', 'smoke', 'tide', 'horizon', 'caustics', 'dunes', 'marble', 'waves'], ATMOSPHERE_IDS),
  clear: only(['mesh', 'waves', 'contour', 'constellation', 'grid', 'isometric', 'orbit', 'signal', 'ridgelines', 'hex'], ATMOSPHERE_IDS),
  punchy: only(['particles', 'tunnel', 'embers', 'warpstripes', 'sonar', 'spiral', 'circuit', 'interference', 'traces'], ATMOSPHERE_IDS),
});

export const REVEAL_MOODS = Object.freeze({
  calm: only(['veil', 'focus', 'rise', 'wipe'], TITLE_REVEALS),
  clear: only(['rise', 'wipe', 'cascade', 'focus', 'iris'], TITLE_REVEALS),
  punchy: only(['cascade', 'slit', 'iris', 'ink', 'embers', 'wipe'], TITLE_REVEALS),
});

/** Transitions a live → proof-plate join may take, by energy. Chapter-card joins stay calm (edit.mjs). */
export const TRANSITION_PALETTES = Object.freeze({
  calm: only(['dissolve', 'blur', 'wipe'], Object.keys(TRANSITION_STYLES)),
  clear: only(['wipe', 'push', 'zoom', 'blur', 'iris'], Object.keys(TRANSITION_STYLES)),
  punchy: only(['push', 'zoom', 'diagonal', 'slice', 'radial', 'iris'], Object.keys(TRANSITION_STYLES)),
});
export const TRANSITION_DURATION = Object.freeze({ calm: 0.8, clear: 0.6, punchy: 0.45 });

const OVERLAY_MOODS = {
  calm: only(['editorial', 'plateMatch', 'minimal'], OVERLAY_PRESET_IDS),
  clear: only(['plateMatch', 'spotlight', 'editorial'], OVERLAY_PRESET_IDS),
  punchy: only(['punchy', 'spotlight', 'plateMatch'], OVERLAY_PRESET_IDS),
};
const DEPTH_MOODS = { calm: ['soft', 'flat'], clear: ['soft', 'deep'], punchy: ['deep', 'soft'] };

/** Closers that answer each opener: a split opens and closes as a pair, type-led openers end on the lockup. */
const RHYME = {
  classic: ['classic', 'split'],
  split: ['split', 'classic'],
  kinetic: ['finale', 'cards'],
  mesh: ['finale', 'split', 'cards'],
  device: ['cards', 'finale'],
};

/** Compositions that read alike across kinds — never placed back to back. */
const FAMILY = {
  'open:kinetic': 'kinetic',
  'statement:kinetic': 'kinetic',
  'statement:marquee': 'kinetic',
  'open:split': 'split',
  'callout:split': 'split',
  'close:split': 'split',
  'features:stack': 'deck',
  'close:cards': 'deck',
  'features:carousel': 'deck',
  'stats:burst': 'burst',
  'close:finale': 'burst',
  'open:device': 'device',
};
export const layoutFamily = (kind, layout) => FAMILY[`${kind}:${layout}`] || `${kind}:${layout}`;

function moodFor(rand, { purpose, energy, brandEnergy }) {
  if (ENERGIES.includes(energy)) return energy;
  const list = MOOD_BY_PURPOSE[purpose] || MOOD_BY_PURPOSE.overview;
  const fromPurpose = list[Math.floor(rand() * list.length)];
  if (ENERGIES.includes(brandEnergy) && rand() < 0.6) return brandEnergy;
  return fromPurpose;
}

function pickLayout(rand, kind, mood, { avoidFamily = null, prefer = null } = {}) {
  const table = layoutsFor(kind);
  const def = defaultLayout(kind);
  const pairs = Object.entries(table).map(([id, l]) => {
    let w = l.moods.includes(mood) ? 1 : 0.06;
    if (id === def) w *= 0.55;
    if (prefer?.includes(id)) w *= 2.4;
    if (avoidFamily && layoutFamily(kind, id) === avoidFamily) w = 0;
    return [id, w];
  });
  return weighted(rand, pairs) || def;
}

/**
 * The combination for one video. `interstitials` are the config entries in story order (their own
 * layouts are kept and only steer the neighbours). Pure: same input → same pick.
 */
export function pickVariety({ slug = '', title = '', purpose = 'overview', energy, brandEnergy, brandAtmosphere, interstitials = [], open, close } = {}) {
  const seed = hashSeed(slug, title);
  const rand = seededRandom(seed);
  const mood = moodFor(rand, { purpose, energy, brandEnergy });

  const openLayout = OPEN_LAYOUTS[open] ? open : pickLayout(rand, 'open', mood);
  let prevFamily = layoutFamily('open', openLayout);
  const layouts = {};
  for (const it of interstitials) {
    if (!PLATE_LAYOUTS[it.type]) {
      prevFamily = `type:${it.type}`;
      continue;
    }
    const own = layoutsFor(it.type)[it.layout] ? it.layout : null;
    const layout = own || pickLayout(rand, it.type, mood, { avoidFamily: prevFamily });
    layouts[it.id] = layout;
    prevFamily = layoutFamily(it.type, layout);
  }
  const closeLayout = CLOSE_LAYOUTS[close]
    ? close
    : pickLayout(rand, 'close', mood, { avoidFamily: prevFamily, prefer: RHYME[openLayout] });

  const atmospheres = ATMOSPHERE_MOODS[mood].filter((a) => !(openLayout === 'mesh' && a === 'mesh'));
  const brandAtm = ATMOSPHERE_IDS.includes(brandAtmosphere) && brandAtmosphere !== 'none' ? brandAtmosphere : null;
  const atmosphere = weighted(rand, [
    ...(brandAtm ? [[brandAtm, atmospheres.length * 0.45]] : []),
    ...atmospheres.filter((a) => a !== brandAtm).map((a) => [a, 1]),
  ]);
  const kineticType = openLayout === 'kinetic' || Object.values(layouts).includes('kinetic');
  const reveals = kineticType ? only(['rise', 'cascade'], REVEAL_MOODS[mood].concat(['rise'])) : REVEAL_MOODS[mood];
  const titleReveal = reveals[Math.floor(rand() * reveals.length)];
  const depth = DEPTH_MOODS[mood][Math.floor(rand() * DEPTH_MOODS[mood].length)];
  const overlayPreset = OVERLAY_MOODS[mood][Math.floor(rand() * OVERLAY_MOODS[mood].length)];

  const palette = TRANSITION_PALETTES[mood];
  const joins = {};
  let at = Math.floor(rand() * palette.length);
  let last = null;
  for (const it of interstitials) {
    let style = palette[at % palette.length];
    if (style === last) style = palette[++at % palette.length];
    joins[`live>${it.id}`] = { style };
    last = style;
    at += 1 + Math.floor(rand() * 2);
  }

  return {
    seed,
    mood,
    open: openLayout,
    close: closeLayout,
    layouts,
    motion: { energy: mood, atmosphere, titleReveal, depth },
    overlays: { preset: overlayPreset },
    transitions: { style: 'directed', duration: TRANSITION_DURATION[mood] },
    joins,
  };
}

/** One line for logs and reports. */
export function describeVariety(pick) {
  const mids = Object.entries(pick.layouts).map(([id, l]) => `${id}:${l}`).join(' ');
  return `${pick.mood} · open ${pick.open} → close ${pick.close}${mids ? ` · ${mids}` : ''} · ${pick.motion.atmosphere} · reveal ${pick.motion.titleReveal} · depth ${pick.motion.depth} · cards ${pick.overlays.preset} · joins ${[...new Set(Object.values(pick.joins).map((j) => j.style))].join('/') || 'directed'}`;
}

/**
 * Fill the open choices of a config with the video's pick. Never overwrites a value that is set;
 * returns a new config plus the list of keys it filled.
 */
export function applyVariety(config = {}, { slug = '', brand = {} } = {}) {
  const next = structuredClone(config);
  const direction = (next.direction = next.direction || {});
  const motion = direction.motion || {};
  const pick = pickVariety({
    slug,
    title: next.title,
    purpose: next.purpose,
    energy: motion.energy,
    brandEnergy: brand?.motion?.energy,
    brandAtmosphere: brand?.motion?.atmosphere,
    interstitials: next.interstitials || [],
    open: next.open?.layout,
    close: next.close?.layout,
  });
  const applied = [];
  const set = (label, done) => {
    done();
    applied.push(label);
  };

  if (next.open?.layout == null) set(`open.layout=${pick.open}`, () => (next.open = { ...(next.open || {}), layout: pick.open }));
  if (next.close?.layout == null) set(`close.layout=${pick.close}`, () => (next.close = { ...(next.close || {}), layout: pick.close }));
  for (const it of next.interstitials || []) {
    if (it.layout == null && pick.layouts[it.id]) set(`${it.id}.layout=${pick.layouts[it.id]}`, () => (it.layout = pick.layouts[it.id]));
  }

  const nextMotion = { ...motion };
  if (motion.energy == null && pick.motion.energy !== (brand?.motion?.energy || 'clear')) {
    set(`motion.energy=${pick.motion.energy}`, () => (nextMotion.energy = pick.motion.energy));
  }
  for (const key of ['atmosphere', 'titleReveal', 'depth']) {
    if (motion[key] == null) set(`motion.${key}=${pick.motion[key]}`, () => (nextMotion[key] = pick.motion[key]));
  }
  if (Object.keys(nextMotion).length) direction.motion = nextMotion;

  if (!direction.overlays?.preset) {
    set(`overlays.preset=${pick.overlays.preset}`, () => (direction.overlays = { ...(direction.overlays || {}), preset: pick.overlays.preset }));
  }
  if (!next.transitions) set(`transitions=${pick.transitions.style}:${pick.transitions.duration}`, () => (next.transitions = { ...pick.transitions }));
  if (Object.keys(pick.joins).length && !Object.keys(next.edit?.transitions || {}).length && (next.transitions?.style || 'directed') === 'directed') {
    set(`joins=${Object.values(pick.joins).map((j) => j.style).join('/')}`, () => {
      next.edit = { ...(next.edit || {}), transitions: { ...pick.joins } };
    });
  }
  if (applied.some((a) => /^(motion|overlays|transitions|joins)/.test(a))) delete direction.approvedAt;
  if (!Object.keys(direction).length) delete next.direction;
  return { config: next, applied, pick };
}
