/**
 * Swapping a plate for another one in the same slot — a Callout for Stats, a Classic opening for
 * Kinetic type — and coming back to the plate the script chose.
 *
 * A row's *slot* (id, chapter, colours, motion, style) survives every swap; its *design* (type,
 * layout and copy) is what changes. The first change records the original design under
 * `row.swap.from`; each design left behind is kept under `row.swap.kept[type]`, so flicking
 * Callout → Stats → Callout brings the callout's words back exactly. Landing on the original
 * type and layout again drops the record — nothing to revert.
 */
import { PLATE_CATALOG, PLATE_TYPE_SET } from './plateTypes.mjs';
import { layoutIds } from './plateLayouts.mjs';
import { scaffoldPlate } from './script.mjs';

/** Keys that belong to the slot, not the plate: they stay put whatever the plate becomes. */
const SLOT_KEYS = new Set(['id', 'before', 'style', 'colors', 'motion', 'chapter', 'chapterLabel', 'swap']);

/** Designs kept per row besides the original — enough to flick around, small enough for the config. */
const KEPT_MAX = 6;

const isEnd = (plateId) => plateId === 'open' || plateId === 'close';

/** How many rows each list type takes: [min, max]. */
const LIST_RANGE = {
  features: [3, 6],
  journey: [3, 6],
  process: [3, 5],
  timeline: [3, 6],
  checklist: [3, 6],
  faq: [2, 4],
  team: [3, 6],
  callout: [2, 4],
  stats: [2, 4],
  kpi: [3, 6],
  testimonials: [3, 8],
  logos: [3, 10],
  orbit: [3, 8],
  pricing: [2, 3],
};

const text = (v) => (v == null ? '' : String(v).trim());
const titleText = (title) => (Array.isArray(title) ? title.map(text).filter(Boolean).join(' ') : text(title)).replace(/\*/g, '');

/** Cut at a word boundary so a carried line still fits the type's limit. */
function clip(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:–—-]+$/, '')}…`;
}

/** A statement takes 1–3 lines and 4–140 characters in all; anything else keeps the starter line. */
function statementTitle(title, seed) {
  const lines = (Array.isArray(title) ? title : [title]).map(text).filter(Boolean).slice(0, 3);
  const chars = lines.join('').replace(/\*/g, '').length;
  if (!lines.length || chars < 4) return seed;
  if (chars <= 140) return lines.length === 1 ? lines[0] : lines;
  return clip(titleText(title), 140);
}

/** The part of a row a swap replaces. The opening and the close only ever change composition. */
export function designOf(row = {}, plateId = row.id) {
  if (isEnd(plateId)) return row.layout ? { layout: row.layout } : {};
  const out = {};
  for (const [k, v] of Object.entries(row)) if (!SLOT_KEYS.has(k)) out[k] = structuredClone(v);
  return out;
}

function slotOf(row = {}) {
  const out = {};
  for (const [k, v] of Object.entries(row)) if (SLOT_KEYS.has(k)) out[k] = v;
  return out;
}

/** Same plate as far as a viewer can tell: type and composition (a missing layout is the default). */
function sameLook(a = {}, b = {}, kind) {
  const typeA = a.type ?? null;
  const typeB = b.type ?? null;
  if (typeA !== typeB) return false;
  const ids = layoutIds(kind || typeA || '');
  const norm = (l) => (l && ids.includes(l) ? l : ids[0] || null);
  return norm(a.layout) === norm(b.layout);
}

/** Every row the plate lists, read as loose points another type can reuse. */
export function platePoints(row = {}) {
  const pts = [];
  const push = (p) => {
    const label = text(p.label);
    if (label) pts.push({ ...p, label });
  };
  for (const key of ['items', 'steps']) for (const it of row[key] || []) push({ label: it?.label, note: text(it?.note), icon: it?.icon, date: it?.date });
  for (const b of row.bullets || []) push({ label: typeof b === 'string' ? b : b?.text });
  for (const s of row.stats || []) push({ label: s?.label, note: text(s?.note), value: s?.value });
  for (const q of row.quotes || []) push({ label: q?.quote, note: text(q?.author) });
  for (const t of row.tiers || []) push({ label: t?.label, note: text(t?.note) });
  for (const l of row.logos || []) push({ label: l?.label });
  for (const side of ['left', 'right']) for (const it of row[side]?.items || []) push({ label: it });
  return pts;
}

function fill(points, seedRows, [min, max], map) {
  const rows = points.slice(0, max).map(map);
  for (let i = rows.length; i < min && i < seedRows.length; i++) rows.push(seedRows[i]);
  return rows;
}

/**
 * The row `row` becomes as a `toType` plate: the headline, eyebrow and sub carry over, listed
 * points become the new type's rows, and anything the source cannot supply comes from the
 * type's starter copy. Numbers are never invented from words — a stats plate built from a
 * callout keeps the starter's placeholders until someone types the real figures.
 */
export function convertPlate(row, toType) {
  if (!PLATE_TYPE_SET.has(toType)) throw new Error(`Unknown plate type: ${toType}`);
  const seed = scaffoldPlate(toType, { before: row.before || 'Preview' });
  const out = { ...seed };
  delete out.before;
  const headline = titleText(row.title);
  if (headline) out.title = toType === 'statement' ? statementTitle(row.title, seed.title) : headline;
  if (text(row.eyebrow)) out.eyebrow = text(row.eyebrow);
  const sub = text(row.sub) || (row.type === 'callout' ? text(row.body) : '');
  if (sub && ['statement', 'process', 'logos', 'orbit'].includes(toType)) out.sub = sub;
  const pts = platePoints(row);
  const range = LIST_RANGE[toType];
  const seedIcons = (seed.items || seed.steps || []).map((r) => r.icon).filter(Boolean);
  switch (toType) {
    case 'features':
    case 'journey':
      if (pts.length >= 2) {
        const key = toType === 'features' ? 'items' : 'steps';
        out[key] = fill(pts, seed[key], range, (p, i) => ({ label: p.label, note: p.note || '', icon: p.icon || seedIcons[i % seedIcons.length] }));
      }
      break;
    case 'process':
      if (pts.length >= 2) out.steps = fill(pts, seed.steps, range, (p) => ({ label: p.label, note: p.note || '' }));
      break;
    case 'timeline':
      if (pts.length >= 2) out.steps = fill(pts, seed.steps, range, (p) => ({ label: p.label, ...(p.date ? { date: p.date } : {}), note: p.note || '' }));
      break;
    case 'checklist':
    case 'team':
      if (pts.length >= 2) out.items = fill(pts, seed.items, range, (p) => ({ label: p.label, note: p.note || '' }));
      break;
    case 'faq':
      // Every question needs its answer: a point without a note borrows the starter's.
      if (pts.length >= 2) out.items = fill(pts, seed.items, range, (p, i) => ({ label: p.label, note: p.note || seed.items[i % seed.items.length].note }));
      break;
    case 'callout':
      if (pts.length >= 2) out.bullets = fill(pts, seed.bullets, range, (p) => p.label);
      out.body = text(row.body) || sub || pts[0]?.note || seed.body;
      break;
    case 'stats':
    case 'kpi':
      if (row.stats?.length) out.stats = fill(row.stats.map((s) => ({ ...s, value: text(s.value) || '—', label: text(s.label) || 'Metric' })), seed.stats, range, (s) => ({ ...s }));
      break;
    case 'metric': {
      const first = row.stats?.[0];
      if (first) Object.assign(out, { value: text(first.value) || seed.value, note: text(first.note) || text(first.label) || seed.note });
      break;
    }
    case 'quote': {
      const q = row.quotes?.[0];
      const words = text(q?.quote);
      if (words.length >= 12 && words.length <= 260) Object.assign(out, { quote: words, author: q.author || seed.author, role: q.role || seed.role });
      break;
    }
    case 'testimonials': {
      const own = row.quotes?.length ? row.quotes : text(row.quote) ? [{ quote: row.quote, author: row.author || 'Customer', role: row.role || '' }] : [];
      if (own.length) out.quotes = fill(own, seed.quotes, range, (q) => ({ ...q }));
      break;
    }
    case 'compare':
      if ((row.left?.items?.length || 0) >= 2 && (row.right?.items?.length || 0) >= 2) Object.assign(out, { left: structuredClone(row.left), right: structuredClone(row.right) });
      else if (pts.length >= 4) {
        const half = Math.ceil(pts.length / 2);
        out.left = { ...seed.left, items: pts.slice(0, Math.min(half, 5)).map((p) => p.label) };
        out.right = { ...seed.right, items: pts.slice(half, half + 5).map((p) => p.label) };
      }
      break;
    case 'logos':
    case 'orbit':
      if (row.logos?.length) out.logos = row.logos.slice(0, range[1]).map((l) => ({ ...l }));
      break;
    case 'pricing':
      if (row.tiers?.length) out.tiers = row.tiers.slice(0, range[1]).map((t) => structuredClone(t));
      break;
    case 'statement':
      if (!text(row.sub) && pts[0]) out.sub = pts[0].note || pts[0].label;
      break;
    default:
      break;
  }
  return out;
}

/**
 * `row` as a `toType` plate, keeping its slot and remembering where it came from. Returns the
 * row unchanged when it already is that type.
 */
export function swapPlate(row, toType) {
  if (!row?.id || isEnd(row.id)) throw new Error('The opening and the close change composition, not type — pick a layout');
  if (row.chapter) throw new Error('A chapter plate follows its chapter — restyle it instead');
  if (!PLATE_TYPE_SET.has(toType)) throw new Error(`Unknown plate type: ${toType}`);
  if (row.type === toType) return row;
  const from = row.swap?.from ?? designOf(row);
  const kept = { ...(row.swap?.kept || {}), [row.type]: designOf(row) };
  const design = kept[toType] ? structuredClone(kept[toType]) : convertPlate(row, toType);
  delete kept[toType];
  const types = Object.keys(kept);
  for (const t of types.slice(0, Math.max(0, types.length - KEPT_MAX))) delete kept[t];
  const next = { ...slotOf(row), ...design, type: toType };
  delete next.swap;
  if (sameLook(next, from)) return next;
  return { ...next, swap: { from, kept } };
}

/**
 * After a layout change: remember the composition the plate had, or forget it when the plate
 * is back on it. `prev` is the row before the change, `next` after.
 */
export function trackLayout(prev, next, plateId = next.id) {
  const kind = isEnd(plateId) ? plateId : next.type;
  const from = prev.swap?.from ?? designOf(prev, plateId);
  const out = { ...next };
  const look = isEnd(plateId) ? { layout: next.layout } : { type: next.type, layout: next.layout };
  const base = isEnd(plateId) ? { layout: from.layout } : { type: from.type, layout: from.layout };
  if (sameLook(look, base, kind) && !Object.keys(prev.swap?.kept || {}).length) delete out.swap;
  else out.swap = { from, kept: prev.swap?.kept || {} };
  return out;
}

/**
 * Back to the plate the script chose. A plate that only changed composition keeps the words
 * written since; one that changed type gets its original copy back too.
 */
export function revertPlate(row, plateId = row?.id) {
  if (!row?.swap?.from) return row;
  const from = row.swap.from;
  const next = { ...row };
  delete next.swap;
  if (isEnd(plateId) || !from.type || from.type === row.type) {
    if (from.layout) next.layout = from.layout;
    else delete next.layout;
    return next;
  }
  return { ...slotOf(next), ...structuredClone(from) };
}

/** What the Editor shows: the original plate's type and composition, and whether it differs. */
export function swapSummary(row, plateId = row?.id) {
  const from = row?.swap?.from;
  if (!from) return null;
  const kind = isEnd(plateId) ? plateId : from.type;
  return {
    type: isEnd(plateId) ? plateId : from.type || row.type,
    label: isEnd(plateId) ? null : PLATE_CATALOG.find((p) => p.type === from.type)?.label || from.type,
    layout: layoutIds(kind).includes(from.layout) ? from.layout : layoutIds(kind)[0] || null,
  };
}

/** The library, as the Editor shows it: every type with a shelf to sit on. */
export const PLATE_SHELVES = Object.freeze([
  { id: 'story', label: 'Story', types: ['statement', 'callout', 'quote', 'compare'] },
  { id: 'product', label: 'Product', types: ['features', 'journey', 'process', 'checklist', 'faq', 'team'] },
  { id: 'proof', label: 'Proof', types: ['stats', 'kpi', 'metric', 'testimonials', 'logos', 'orbit'] },
  { id: 'plans', label: 'Plans', types: ['timeline', 'pricing'] },
]);

export function plateLibrary() {
  const shelfOf = new Map(PLATE_SHELVES.flatMap((s) => s.types.map((t) => [t, s.id])));
  return {
    shelves: PLATE_SHELVES.map(({ id, label }) => ({ id, label })),
    types: PLATE_CATALOG.map((p) => ({ type: p.type, label: p.label, hint: p.hint, shelf: shelfOf.get(p.type) || 'story' })),
  };
}
