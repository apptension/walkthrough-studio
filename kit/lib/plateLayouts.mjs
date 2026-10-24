/**
 * Plate layouts: the composition a plate uses for the same copy. `open.layout`, `close.layout` and
 * `interstitials[].layout` pick one; a missing layout is the classic composition, so videos written
 * before layouts existed keep their look. Builder (`plates.mjs`), Studio, the CLI, the variety picker
 * and the agent prompts all read this catalog.
 *
 * `moods` say which energies a layout suits (calm | clear | punchy) — the variety picker keeps an
 * opener, closer and mid plates inside one mood so a video reads as one piece.
 */
export const OPEN_LAYOUTS = Object.freeze({
  classic: { label: 'Classic', hint: 'Lockup builds, lifts, title rises beneath', moods: ['calm', 'clear'] },
  split: { label: 'Split hero', hint: 'Lockup on a brand panel, title beside it', moods: ['calm', 'clear'] },
  kinetic: { label: 'Kinetic type', hint: 'Huge words slam in, lockup signs off', moods: ['clear', 'punchy'] },
  mesh: { label: 'Gradient mesh', hint: 'A brand mesh irises open behind the title', moods: ['calm', 'clear', 'punchy'] },
  device: { label: 'Device reveal', hint: 'Lockup on a screen that tilts up into place', moods: ['clear', 'punchy'] },
});

export const CLOSE_LAYOUTS = Object.freeze({
  classic: { label: 'Classic', hint: 'Numbered steps on a rail, lockup below', moods: ['calm', 'clear'] },
  split: { label: 'Split recap', hint: 'Title and lockup left, steps stacked right', moods: ['calm', 'clear'] },
  cards: { label: 'Dealt cards', hint: 'Steps dealt as a fanned hand of cards', moods: ['clear', 'punchy'] },
  finale: { label: 'Lockup finale', hint: 'Hero lockup on a light burst, steps as pills', moods: ['clear', 'punchy'] },
});

/** Interstitial types with more than one composition; the first key is the classic default. */
export const PLATE_LAYOUTS = Object.freeze({
  features: Object.freeze({
    grid: { label: 'Grid', hint: 'Count-aware card grid', moods: ['calm', 'clear'] },
    bento: { label: 'Bento', hint: 'One hero card, the rest tiled around it', moods: ['calm', 'clear', 'punchy'] },
    stack: { label: 'Stacked cards', hint: 'A fanned hand of cards dealt in', moods: ['clear', 'punchy'] },
    carousel: { label: '3D carousel', hint: 'Cards on a tilted ring that turns', moods: ['clear', 'punchy'] },
  }),
  stats: Object.freeze({
    row: { label: 'Row', hint: 'Figures side by side on cards', moods: ['calm', 'clear'] },
    burst: { label: 'Radial burst', hint: 'Each figure in a medallion on a ray burst', moods: ['clear', 'punchy'] },
  }),
  statement: Object.freeze({
    editorial: { label: 'Editorial', hint: 'Left-anchored lines beside an accent bar', moods: ['calm', 'clear'] },
    kinetic: { label: 'Kinetic', hint: 'Centred words slam in at full size', moods: ['clear', 'punchy'] },
    marquee: { label: 'Marquee', hint: 'Ghost ribbons scroll behind the line', moods: ['clear', 'punchy'] },
  }),
  callout: Object.freeze({
    classic: { label: 'Panel', hint: 'One panel: thesis, body, bullets', moods: ['calm', 'clear'] },
    split: { label: 'Split', hint: 'Thesis left, bullets as chips on the right', moods: ['calm', 'clear', 'punchy'] },
  }),
});

/** Layout table for `open`, `close` or an interstitial type; `null` when the kind has one composition. */
export function layoutsFor(kind) {
  if (kind === 'open') return OPEN_LAYOUTS;
  if (kind === 'close') return CLOSE_LAYOUTS;
  return PLATE_LAYOUTS[kind] || null;
}

export function layoutIds(kind) {
  return Object.keys(layoutsFor(kind) || {});
}

export function defaultLayout(kind) {
  return layoutIds(kind)[0] || null;
}

/** The layout a plate renders with: its own when valid, else the default. */
export function resolveLayout(kind, value) {
  const ids = layoutIds(kind);
  return ids.includes(value) ? value : ids[0] || null;
}

/**
 * Validate a requested layout. Empty / null clears it (returns undefined → follow the default);
 * an id the kind does not offer throws with the valid list.
 */
export function normalizeLayout(kind, value) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const ids = layoutIds(kind);
  if (!ids.length) throw new Error(`${kind} plates have one layout — remove "layout"`);
  const v = String(value).trim();
  if (!ids.includes(v)) throw new Error(`${kind} layout must be one of ${ids.join(', ')} (got "${v}")`);
  return v;
}

/** The kind a plate config resolves to: `open`, `close` or the interstitial type. */
export function plateKind(plateId, plate = {}) {
  return plateId === 'open' || plateId === 'close' ? plateId : plate?.type || null;
}

/** Problems with every layout in a config — `[]` when all are valid. */
export function layoutIssues(config = {}) {
  const issues = [];
  const check = (kind, value, where) => {
    try {
      normalizeLayout(kind, value);
    } catch (err) {
      issues.push(`${where}: ${err.message}`);
    }
  };
  if (config.open?.layout != null) check('open', config.open.layout, 'open.layout');
  if (config.close?.layout != null) check('close', config.close.layout, 'close.layout');
  for (const it of config.interstitials || []) {
    if (it?.layout != null) check(it.type, it.layout, `interstitials.${it.id}.layout`);
  }
  return issues;
}

/** `{ open: [{id,label,hint}], close: […], features: […], … }` for Studio pickers. */
export function layoutOptions() {
  const rows = (table) => Object.entries(table).map(([id, l]) => ({ id, label: l.label, hint: l.hint }));
  return {
    open: rows(OPEN_LAYOUTS),
    close: rows(CLOSE_LAYOUTS),
    ...Object.fromEntries(Object.entries(PLATE_LAYOUTS).map(([type, table]) => [type, rows(table)])),
  };
}

/** Agent-facing guide: one line per kind with every layout and when it reads best. */
export function layoutGuide() {
  const line = (kind, table) => `${kind}.layout — ${Object.entries(table).map(([id, l]) => `${id} (${l.hint.toLowerCase()})`).join(' · ')}`;
  return [
    line('open', OPEN_LAYOUTS),
    line('close', CLOSE_LAYOUTS),
    ...Object.entries(PLATE_LAYOUTS).map(([type, table]) => line(`${type} interstitial`, table)),
  ].join('\n');
}
