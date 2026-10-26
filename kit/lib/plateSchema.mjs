/**
 * What a plate is made of, beyond its words: the content schema the Studio Inspector edits.
 *
 * Every plate type declares its scalar fields (a sub line, a hero quote, a headline number, a
 * screenshot) and at most a few *lists* (features, logos, stats, quotes, …) with their row shape
 * and the count the builder accepts. The Inspector's Content pane renders straight from this —
 * add/remove/reorder rows within limits, swap logos and screenshots, pick icons, set stars — so a
 * new plate type only needs a schema row here, not another editor.
 *
 * Field kinds:
 *   text      one line (label, author, value)         lines     several lines, one per row
 *   long      a sentence or two (quote, body, note)   asset     an image — brand asset, upload or frame grab
 *   icon      one of the plate icon set                number    a free number (progress 0–1, stars 0–5 …)
 *   toggle    boolean                                  choice    one of a short list (`options`)
 *   strings   list of plain strings (bullets, pills, tier lines) edited as one line per row
 *
 * Paths are relative to the plate row: `logos.2.asset`, `left.items`, `stars`.
 */
import { PLATE_CATALOG } from './plateTypes.mjs';
import { ICON_IDS } from './plateIcons.mjs';
import { layoutIds } from './plateLayouts.mjs';

const f = (key, label, kind = 'text', extra = {}) => ({ key, label, kind, ...extra });

/** Rows shared between list types. */
const LABEL = f('label', 'Label');
const NOTE = f('note', 'Note', 'long', { optional: true });
const ICON = f('icon', 'Icon', 'icon', { optional: true });
const ASSET = f('asset', 'Image', 'asset', { optional: true });
const LOGO_BG = f('bg', 'Tile', 'choice', { optional: true, options: ['auto', 'light', 'dark'], hint: 'Tile tone behind the mark' });

/** Per-type schema: scalar `fields` and `lists` (key, limits, row fields, a starter row). */
const SCHEMAS = {
  features: {
    lists: [{ key: 'items', label: 'Features', item: 'Feature', min: 3, max: 6, fields: [LABEL, NOTE, ICON], starter: { label: 'New feature', note: 'What it does for the viewer', icon: 'spark' } }],
  },
  journey: {
    lists: [{ key: 'steps', label: 'Steps', item: 'Step', min: 3, max: 6, fields: [LABEL, NOTE, ICON], starter: { label: 'Next step', note: 'What happens here', icon: 'spark' } }],
  },
  process: {
    fields: [f('sub', 'Sub line', 'long', { optional: true })],
    lists: [{ key: 'steps', label: 'Steps', item: 'Step', min: 3, max: 5, fields: [LABEL, NOTE], starter: { label: 'Next step', note: 'What happens here' } }],
  },
  timeline: {
    lists: [{ key: 'steps', label: 'Stops', item: 'Stop', min: 3, max: 6, fields: [LABEL, f('date', 'Date', 'text', { optional: true }), NOTE], starter: { label: 'Milestone', date: 'Soon', note: '' } }],
  },
  checklist: {
    lists: [{ key: 'items', label: 'Outcomes', item: 'Outcome', min: 3, max: 6, fields: [LABEL, NOTE], starter: { label: 'One more outcome', note: '' } }],
  },
  logos: {
    fields: [f('sub', 'Sub line', 'long', { optional: true })],
    lists: [{ key: 'logos', label: 'Logos', item: 'Logo', min: 3, max: 10, fields: [f('asset', 'Logo', 'asset'), f('label', 'Label', 'text', { optional: true }), LOGO_BG], starter: { asset: '', label: 'New tool' } }],
  },
  orbit: {
    fields: [f('sub', 'Sub line', 'long', { optional: true })],
    lists: [{ key: 'logos', label: 'Logos', item: 'Logo', min: 3, max: 8, fields: [f('asset', 'Logo', 'asset'), f('label', 'Label', 'text', { optional: true }), LOGO_BG], starter: { asset: '', label: 'New tool' } }],
  },
  testimonials: {
    lists: [{ key: 'quotes', label: 'Quotes', item: 'Quote', min: 3, max: 8, carouselMax: 16, fields: [f('quote', 'Quote', 'long'), f('author', 'Author'), f('role', 'Role', 'text', { optional: true })], starter: { quote: 'A short quote from a customer, in their words.', author: 'Customer', role: 'Role' } }],
  },
  quote: {
    fields: [
      f('quote', 'Quote', 'long', { min: 12, max: 260 }),
      f('author', 'Author'),
      f('role', 'Role', 'text', { optional: true }),
      f('company', 'Company', 'text', { optional: true }),
      f('stars', 'Stars', 'number', { optional: true, min: 0, max: 5, step: 1, hint: '0 hides the stars' }),
      f('logo', 'Logo', 'asset', { optional: true, hint: 'Replaces the initials badge' }),
    ],
  },
  stats: {
    lists: [{ key: 'stats', label: 'Numbers', item: 'Number', min: 2, max: 4, fields: [f('value', 'Value'), LABEL, NOTE, f('logo', 'Logo', 'asset', { optional: true })], starter: { value: '—', label: 'Metric', note: '' } }],
  },
  kpi: {
    lists: [{ key: 'stats', label: 'Tiles', item: 'Tile', min: 3, max: 6, fields: [f('value', 'Value'), LABEL, f('delta', 'Trend', 'text', { optional: true, hint: '+12% · −3' }), NOTE], starter: { value: '—', label: 'Metric', delta: '+0%', note: '' } }],
  },
  metric: {
    fields: [
      f('value', 'Value'),
      f('unit', 'Unit', 'text', { optional: true }),
      f('note', 'Note', 'long', { optional: true }),
      f('progress', 'Progress', 'number', { optional: true, min: 0, max: 1, step: 0.01, hint: 'Ring fill, 0–1' }),
    ],
    lists: [{ key: 'pills', label: 'Pills', item: 'Pill', min: 0, max: 4, strings: true, starter: 'New pill' }],
  },
  callout: {
    fields: [f('body', 'Body', 'long')],
    lists: [{ key: 'bullets', label: 'Bullets', item: 'Bullet', min: 2, max: 4, strings: true, starter: 'One more point' }],
  },
  statement: {
    fields: [f('sub', 'Sub line', 'long', { optional: true })],
  },
  compare: {
    fields: [
      f('left.label', 'Left label'),
      f('left.title', 'Left title', 'text', { optional: true }),
      f('right.label', 'Right label'),
      f('right.title', 'Right title', 'text', { optional: true }),
    ],
    lists: [
      { key: 'left.items', label: 'Before', item: 'Point', min: 2, max: 5, strings: true, starter: 'Old friction' },
      { key: 'right.items', label: 'After', item: 'Point', min: 2, max: 5, strings: true, starter: 'What settles' },
    ],
  },
  faq: {
    lists: [{ key: 'items', label: 'Questions', item: 'Question', min: 2, max: 4, fields: [f('label', 'Question'), f('note', 'Answer', 'long')], starter: { label: 'Another question?', note: 'The short answer.' } }],
  },
  pricing: {
    lists: [{
      key: 'tiers', label: 'Plans', item: 'Plan', min: 2, max: 3,
      fields: [LABEL, f('value', 'Price'), f('period', 'Period', 'text', { optional: true }), NOTE, f('badge', 'Badge', 'text', { optional: true }), f('featured', 'Featured', 'toggle', { optional: true }), f('items', 'Lines', 'lines', { optional: true, max: 5 })],
      starter: { label: 'Plan', value: '$0', period: '/mo', note: '', items: ['One thing included'] },
    }],
  },
  team: {
    lists: [{ key: 'items', label: 'People', item: 'Person', min: 3, max: 6, fields: [LABEL, NOTE, f('asset', 'Avatar', 'asset', { optional: true })], starter: { label: 'Role', note: 'What they need', asset: '' } }],
  },
  showcase: {
    fields: [
      f('shot', 'Screenshot', 'asset', { optional: true, hint: 'Grab a frame from the recording or upload an interface shot — a skeleton stands in until then' }),
      f('sub', 'Sub line', 'long', { optional: true }),
      f('caption', 'Caption', 'text', { optional: true, hint: 'Small line under the shot' }),
      f('focus', 'Focus', 'choice', { optional: true, options: ['center', 'top', 'left', 'right', 'bottom'], hint: 'Where the zoom-morph lands' }),
      f('url', 'Address bar', 'text', { optional: true, hint: 'Shown in the browser chrome' }),
    ],
    lists: [{ key: 'callouts', label: 'Callouts', item: 'Callout', min: 0, max: 4, fields: [LABEL, f('x', 'X %', 'number', { min: 0, max: 100, step: 1 }), f('y', 'Y %', 'number', { min: 0, max: 100, step: 1 })], starter: { label: 'Point this out', x: 50, y: 50 } }],
  },
  bento: {
    fields: [
      f('shot', 'Screenshot', 'asset', { optional: true, hint: 'The hero tile — grab a frame or upload' }),
      f('caption', 'Shot caption', 'text', { optional: true, hint: 'Pill over the shot' }),
      f('value', 'Number'),
      f('label', 'Number label'),
      f('quote', 'Quote', 'long', { optional: true }),
      f('author', 'Author', 'text', { optional: true }),
    ],
    lists: [{ key: 'logos', label: 'Logos', item: 'Logo', min: 0, max: 4, fields: [f('asset', 'Logo', 'asset'), f('label', 'Label', 'text', { optional: true })], starter: { asset: '', label: 'Tool' } }],
  },
};

/** Common head fields every interstitial has; title and eyebrow are edited on the stage. */
const HEAD_FIELDS = [];

export const CONTENT_FIELD_KINDS = Object.freeze(['text', 'long', 'lines', 'asset', 'icon', 'number', 'toggle', 'choice']);

/** The schema for a plate type — or null for the opening and close, which only change composition. */
export function plateSchema(type, row = null) {
  const cat = PLATE_CATALOG.find((p) => p.type === type);
  const def = SCHEMAS[type];
  if (!cat || !def) return null;
  const lists = (def.lists || []).map((l) => {
    const max = l.carouselMax && row?.motion?.carousel === true ? l.carouselMax : l.max;
    const min = l.carouselMax && row?.motion?.carousel === true ? 6 : l.min;
    const { carouselMax: _c, ...rest } = l;
    return { ...rest, min, max, fields: l.strings ? [f('', l.item, 'text')] : l.fields };
  });
  return {
    type,
    label: cat.label,
    hint: cat.hint,
    fields: [...HEAD_FIELDS, ...(def.fields || [])],
    lists,
    icons: ICON_IDS,
    layouts: layoutIds(type),
  };
}

/** Types with a content schema (every interstitial type). */
export const CONTENT_TYPES = Object.freeze(Object.keys(SCHEMAS));

/* ———————————————————————————————————————————— paths */

const parts = (path) => String(path).split('.').filter(Boolean);

export function getPath(obj, path) {
  let cur = obj;
  for (const k of parts(path)) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

export function setPath(obj, path, value) {
  const ps = parts(path);
  if (!ps.length) throw new Error('Empty content path');
  let cur = obj;
  for (let i = 0; i < ps.length - 1; i++) {
    const key = ps[i];
    const wantArray = /^\d+$/.test(ps[i + 1]);
    if (cur[key] == null || typeof cur[key] !== 'object') cur[key] = wantArray ? [] : {};
    cur = cur[key];
  }
  cur[ps[ps.length - 1]] = value;
}

function listAt(root, key, { create = false } = {}) {
  let list = getPath(root, key);
  if (!Array.isArray(list)) {
    if (!create) return null;
    list = [];
    setPath(root, key, list);
  }
  return list;
}

/* ———————————————————————————————————————————— values */

/** Coerce an incoming value to the field's kind; strings are trimmed, numbers clamped. */
export function coerceValue(field, value) {
  switch (field?.kind) {
    case 'number': {
      const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
      if (!Number.isFinite(n)) return undefined;
      const lo = Number.isFinite(field.min) ? field.min : -Infinity;
      const hi = Number.isFinite(field.max) ? field.max : Infinity;
      return Math.max(lo, Math.min(hi, n));
    }
    case 'toggle':
      return value === true || value === 'true' || value === 1 || value === '1';
    case 'lines': {
      const lines = (Array.isArray(value) ? value : String(value ?? '').split('\n')).map((l) => String(l).trim()).filter(Boolean);
      return Number.isFinite(field.max) ? lines.slice(0, field.max) : lines;
    }
    case 'choice': {
      const v = String(value ?? '').trim();
      return field.options?.includes(v) ? (v === 'auto' ? undefined : v) : undefined;
    }
    default:
      return value == null ? '' : String(value).trim();
  }
}

/** Field definition for a path: list row fields resolve through `<list>.<index>.<key>`. */
export function fieldFor(schema, path) {
  if (!schema) return null;
  const scalar = schema.fields.find((x) => x.key === path);
  if (scalar) return scalar;
  for (const list of schema.lists) {
    const prefix = `${list.key}.`;
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length).split('.');
    if (!/^\d+$/.test(rest[0])) continue;
    if (list.strings) return rest.length === 1 ? list.fields[0] : null;
    return list.fields.find((x) => x.key === rest.slice(1).join('.')) || null;
  }
  return null;
}

/* ———————————————————————————————————————————— ops */

/**
 * Apply content operations to the plate row inside a config (mutates and returns the row).
 *   { op:'set', path, value }
 *   { op:'add', list, index?, item? }          starter row when `item` is missing
 *   { op:'remove', list, index }
 *   { op:'move', list, from, to }
 *   { op:'duplicate', list, index }
 * Limits are enforced here so the Inspector never has to guess; the builder validates the rest.
 */
export function applyPlateContent(row, ops) {
  if (!row || typeof row !== 'object') throw new Error('No plate row to edit');
  const schema = plateSchema(row.type, row);
  if (!schema) throw new Error(`Plate type "${row.type}" has no editable content`);
  let changed = 0;
  for (const op of Array.isArray(ops) ? ops : []) {
    if (!op || typeof op !== 'object') continue;
    if (op.op === 'set') {
      const field = fieldFor(schema, op.path);
      if (!field) throw new Error(`Unknown content field "${op.path}" on a ${row.type} plate`);
      const value = coerceValue(field, op.value);
      if (field.kind === 'text' && !field.optional && !String(value).length && !/\.\d+$/.test(op.path)) {
        throw new Error(`${field.label} cannot be empty`);
      }
      if (field.kind === 'long' && Number.isFinite(field.min) && String(value).length < field.min) {
        throw new Error(`${field.label} needs at least ${field.min} characters`);
      }
      if (field.kind === 'long' && Number.isFinite(field.max) && String(value).length > field.max) {
        throw new Error(`${field.label} takes at most ${field.max} characters`);
      }
      if (value === undefined) {
        const ps = parts(op.path);
        const parent = getPath(row, ps.slice(0, -1).join('.'));
        if (parent && typeof parent === 'object') delete parent[ps[ps.length - 1]];
      } else {
        setPath(row, op.path, value);
      }
      changed += 1;
      continue;
    }
    const list = schema.lists.find((l) => l.key === op.list);
    if (!list) throw new Error(`Unknown list "${op.list}" on a ${row.type} plate`);
    const arr = listAt(row, list.key, { create: true });
    if (op.op === 'add') {
      if (arr.length >= list.max) throw new Error(`${list.label}: at most ${list.max} on a ${schema.label} plate`);
      const item = op.item != null ? op.item : structuredClone(list.starter);
      const at = Number.isInteger(op.index) ? Math.max(0, Math.min(arr.length, op.index)) : arr.length;
      arr.splice(at, 0, item);
      changed += 1;
    } else if (op.op === 'remove') {
      if (arr.length <= list.min) throw new Error(`${list.label}: at least ${list.min} on a ${schema.label} plate`);
      if (!Number.isInteger(op.index) || op.index < 0 || op.index >= arr.length) throw new Error(`No ${list.item.toLowerCase()} at ${op.index}`);
      arr.splice(op.index, 1);
      changed += 1;
    } else if (op.op === 'move') {
      const { from, to } = op;
      if (![from, to].every((n) => Number.isInteger(n) && n >= 0 && n < arr.length)) throw new Error(`Cannot move ${from} → ${to}`);
      if (from !== to) {
        const [item] = arr.splice(from, 1);
        arr.splice(to, 0, item);
        changed += 1;
      }
    } else if (op.op === 'duplicate') {
      if (arr.length >= list.max) throw new Error(`${list.label}: at most ${list.max} on a ${schema.label} plate`);
      if (!Number.isInteger(op.index) || op.index < 0 || op.index >= arr.length) throw new Error(`No ${list.item.toLowerCase()} at ${op.index}`);
      arr.splice(op.index + 1, 0, structuredClone(arr[op.index]));
      changed += 1;
    } else {
      throw new Error(`Unknown content op "${op.op}"`);
    }
  }
  return { row, changed };
}

/** The content the Inspector shows: the row's scalar values and lists, in schema shape. */
export function plateContent(row) {
  const schema = plateSchema(row?.type, row);
  if (!schema) return null;
  const fields = Object.fromEntries(schema.fields.map((x) => [x.key, getPath(row, x.key) ?? (x.kind === 'toggle' ? false : '')]));
  const lists = Object.fromEntries(
    schema.lists.map((l) => {
      const arr = listAt(row, l.key) || [];
      return [l.key, arr.map((item) => (l.strings ? (typeof item === 'string' ? item : item?.label || '') : item))];
    })
  );
  return { schema, fields, lists };
}
