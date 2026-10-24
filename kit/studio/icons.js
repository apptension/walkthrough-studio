/**
 * Studio icons — SVG files under icons/ are the source of truth.
 * Run `node icons/build.mjs` after adding/editing SVGs (writes icons.svg + icons.gen.js).
 *
 * Embed (prefer inline — external <use> drops stroke/currentColor on many icons):
 *   icon('play')                         → <svg>…inline body…</svg>
 *   <span data-icon="play" data-size="14"></span>  → filled by mountIcons()
 *   HTML chrome is inlined by icons/build.mjs from the same source files.
 */
import { ICON_BODY, ICON_META } from './icons.gen.js';

/** Short names → sprite ids (folder-name). */
const ALIAS = {
  // ui
  film: 'ui-film',
  plate: 'ui-plate',
  open: 'ui-open',
  close: 'ui-close',
  speed: 'ui-speed',
  zoom: 'ui-zoom',
  transition: 'ui-transition',
  palette: 'ui-palette',
  motion: 'ui-motion',
  depth: 'ui-depth',
  lockup: 'ui-lockup',
  cursor: 'ui-cursor',
  text: 'ui-text',
  reset: 'ui-reset',
  trash: 'ui-trash',
  plus: 'ui-plus',
  play: 'ui-play',
  pause: 'ui-pause',
  replay: 'ui-replay',
  toStart: 'ui-to-start',
  loop: 'ui-loop',
  eye: 'ui-eye',
  undo: 'ui-undo',
  redo: 'ui-redo',
  render: 'ui-render',
  keep: 'ui-keep',
  noZoom: 'ui-no-zoom',
  check: 'ui-check',
  warn: 'ui-warn',
  x: 'ui-x',
  fit: 'ui-fit',
  fullscreen: 'ui-fullscreen',
  target: 'ui-target',
  slow: 'ui-slow',
  sparkle: 'ui-sparkle',
  mic: 'ui-mic',
  upload: 'ui-upload',
  stop: 'ui-stop',
  music: 'ui-music',
  lens: 'ui-lens',
  lensOff: 'ui-lens-off',
  grip: 'ui-grip',
  chevron: 'ui-chevron',
  settings: 'ui-settings',
  branch: 'ui-branch',
  version: 'ui-version',
  snapshot: 'ui-version',
  download: 'ui-download',
  sound: 'ui-sound',
  chapters: 'ui-chapters',
  book: 'ui-book',
  history: 'ui-history',
  pencil: 'ui-pencil',
  bulb: 'ui-bulb',
  walk: 'ui-walk',
  skipBack: 'ui-skip-back',
  skipFwd: 'ui-skip-fwd',
  volume: 'ui-volume',
  mute: 'ui-mute',
  list: 'ui-list',
  queue: 'ui-queue',
  activity: 'ui-activity',
  pipeline: 'ui-pipeline',
  poster: 'ui-poster',
  note: 'ui-note',
  story: 'ui-story',
  loupe: 'ui-loupe',
  box: 'ui-box',
  formats: 'ui-formats',
  logo: 'ui-logo',
  focus: 'ui-focus',
  pace: 'ui-pace',
  camera: 'ui-camera',
  tag: 'ui-tag',
  ask: 'ui-ask',
  grid: 'ui-grid',
  record: 'ui-record',
  compare: 'ui-compare',
  restore: 'ui-restore',
  preview: 'ui-preview',
  // section icons (stroke-2 set)
  'sec-pipeline': 'ui-pipeline',
  'sec-activity': 'ui-activity',
  'sec-queue': 'ui-queue',
  'sec-poster': 'ui-poster',
  'sec-film': 'ui-film',
  'sec-note': 'ui-note',
  'sec-target': 'ui-target-sec',
  'sec-plates': 'ui-plate',
  'sec-story': 'ui-story',
  'sec-loupe': 'ui-loupe',
  'sec-check': 'ui-check-box',
  'sec-chapters': 'ui-bookmark',
  'sec-box': 'ui-box',
  'sec-formats': 'ui-formats',
  'sec-palette': 'ui-palette-sec',
  'sec-logo': 'ui-logo',
  'sec-focus': 'ui-focus',
  'sec-pace': 'ui-pace',
  'sec-camera': 'ui-camera',
  'sec-motion': 'ui-motion-sec',
  // queue
  'queue-render': 'ui-play-fill',
  'queue-record': 'ui-record',
  'queue-plates': 'ui-plates-queue',
  'queue-produce': 'ui-produce-queue',
  'queue-audio': 'ui-audio-queue',
  'queue-deliver': 'ui-download',
  'queue-ai': 'ui-sparkle',
  'queue-default': 'ui-plus',
  // pipeline marks
  'pip-done': 'ui-pip-done',
  'pip-fail': 'ui-pip-fail',
  'pip-run': 'ui-pip-run',
  'pip-todo': 'ui-pip-todo',
  // steps
  'step-record': 'ui-step-record',
  'step-plates': 'ui-step-plates',
  'step-produce': 'ui-step-produce',
  'step-audio': 'ui-step-audio',
  'step-deliver': 'ui-step-deliver',
  'step-preview': 'ui-play-fill',
  // ask
  'ask-tag': 'ui-tag',
  'ask-ask': 'ui-ask',
  'ask-warn': 'ui-warn-tri',
  'ask-grid': 'ui-grid',
  // chrome fill variants
  'play-fill': 'ui-play-fill',
  'pause-fill': 'ui-pause-fill',
  'plus-fill': 'ui-plus-fill',
  'download-fill': 'ui-download-fill',
  'fullscreen-fill': 'ui-fullscreen-fill',
  // focus / empty / agents / zen
  'focus-guided': 'focus-guided',
  'focus-spotlight': 'focus-spotlight',
  'focus-ring': 'focus-ring',
  'empty-play': 'empty-play',
  'empty-stale': 'empty-stale',
  'empty-capture': 'empty-capture',
  'agent-cursor': 'agents-cursor',
  'agent-claude': 'agents-claude',
  'zen-tumbleweed': 'zen-tumbleweed',
  'zen-sleep': 'zen-sleep',
  'zen-clapper': 'zen-clapper',
  'zen-frame': 'zen-frame',
  'zen-loupe': 'zen-loupe',
  'zen-checklist': 'zen-checklist',
  'zen-box': 'zen-box',
  'zen-pointer': 'zen-pointer',
  'zen-film': 'zen-film',
  'zen-dashes': 'zen-dashes',
  // transitions
  'tr-directed': 'ui-tr-directed',
  'tr-dissolve': 'ui-tr-dissolve',
  'tr-wipe': 'ui-tr-wipe',
  'tr-push': 'ui-tr-push',
  'tr-zoom': 'ui-tr-zoom',
  'tr-iris': 'ui-tr-iris',
  'tr-blur': 'ui-tr-blur',
  'tr-dip': 'ui-tr-dip',
  'tr-radial': 'ui-tr-radial',
  'tr-slice': 'ui-tr-slice',
  'tr-diagonal': 'ui-tr-diagonal',
};

export function resolveIconId(name) {
  if (!name) return null;
  if (ICON_BODY[name]) return name;
  if (ALIAS[name]) return ALIAS[name];
  const ui = `ui-${name}`;
  if (ICON_BODY[ui]) return ui;
  return null;
}

function escAttr(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/**
 * @param {string} name short or sprite id
 * @param {{ size?: number, width?: number, height?: number, class?: string, className?: string, use?: boolean, label?: string }} [opts]
 */
export function icon(name, opts = {}) {
  const id = resolveIconId(name);
  if (!id || !ICON_BODY[id]) return '';
  const meta = ICON_META[id] || { viewBox: '0 0 24 24', present: {} };
  const present = meta.present || {};
  const cls = [present.class, opts.className ?? opts.class].filter(Boolean).join(' ');
  const w = opts.width ?? opts.size ?? 14;
  const h = opts.height ?? opts.size ?? 14;
  const label = opts.label;
  const aria = label ? ` role="img" aria-label="${escAttr(label)}"` : ' aria-hidden="true"';
  const classAttr = cls ? ` class="${escAttr(cls)}"` : '';
  const presentAttrs = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin']
    .filter((k) => present[k] != null)
    .map((k) => ` ${k}="${escAttr(present[k])}"`)
    .join('');
  // Always inline. External <use href="/icons.svg#…"> loses root stroke/fill on symbols
  // and currentColor inheritance is unreliable — that is what made the settings cog a black blob.
  return `<svg${classAttr} viewBox="${meta.viewBox}" width="${w}" height="${h}"${presentAttrs}${aria}>${ICON_BODY[id]}</svg>`;
}

/** Editor timeline icon set (same keys as before). */
export const ICONS = Object.fromEntries(
  [
    'film', 'plate', 'open', 'close', 'speed', 'zoom', 'transition', 'palette', 'motion', 'depth',
    'lockup', 'cursor', 'text', 'reset', 'trash', 'plus', 'play', 'pause', 'replay', 'toStart',
    'loop', 'eye', 'undo', 'redo', 'render', 'keep', 'noZoom', 'check', 'warn', 'x', 'fit',
    'fullscreen', 'target', 'slow', 'sparkle', 'mic', 'upload', 'stop', 'music', 'lens', 'lensOff',
  ].map((k) => [k, icon(k, { size: 14 })])
);

/** Transition glyphs for the join grid. */
export const T_GLYPH = Object.fromEntries(
  ['directed', 'dissolve', 'wipe', 'push', 'zoom', 'iris', 'blur', 'dip', 'radial', 'slice', 'diagonal'].map(
    (k) => [k, icon(`tr-${k}`, { size: 14 })]
  )
);

/** Section label icons (`data-ico`). */
export const SEC_ICONS = {
  pipeline: icon('sec-pipeline', { class: 'sec-ico', size: 14 }),
  activity: icon('sec-activity', { class: 'sec-ico', size: 14 }),
  queue: icon('sec-queue', { class: 'sec-ico', size: 14 }),
  poster: icon('sec-poster', { class: 'sec-ico', size: 14 }),
  film: icon('sec-film', { class: 'sec-ico', size: 14 }),
  note: icon('sec-note', { class: 'sec-ico', size: 14 }),
  target: icon('sec-target', { class: 'sec-ico', size: 14 }),
  plates: icon('sec-plates', { class: 'sec-ico', size: 14 }),
  story: icon('sec-story', { class: 'sec-ico', size: 14 }),
  loupe: icon('sec-loupe', { class: 'sec-ico', size: 14 }),
  check: icon('sec-check', { class: 'sec-ico', size: 14 }),
  chapters: icon('sec-chapters', { class: 'sec-ico', size: 14 }),
  box: icon('sec-box', { class: 'sec-ico', size: 14 }),
  formats: icon('sec-formats', { class: 'sec-ico', size: 14 }),
  palette: icon('sec-palette', { class: 'sec-ico', size: 14 }),
  logo: icon('sec-logo', { class: 'sec-ico', size: 14 }),
  focus: icon('sec-focus', { class: 'sec-ico', size: 14 }),
  pace: icon('sec-pace', { class: 'sec-ico', size: 14 }),
  camera: icon('sec-camera', { class: 'sec-ico', size: 14 }),
  motion: icon('sec-motion', { class: 'sec-ico', size: 14 }),
};

/** Zen empty-state art. */
export const ZEN_ART = Object.fromEntries(
  ['tumbleweed', 'sleep', 'clapper', 'frame', 'loupe', 'checklist', 'box', 'pointer', 'film', 'dashes'].map(
    (k) => [k, icon(`zen-${k}`, { class: 'zen-art', width: 96, height: 64 })]
  )
);

/** Hydrate `[data-icon]` hosts (and optional `[data-icon-src]` for raw file path). */
export function mountIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.querySelector(':scope > svg')) return;
    const name = el.dataset.icon;
    const size = Number(el.dataset.size) || undefined;
    const width = Number(el.dataset.width) || size;
    const height = Number(el.dataset.height) || size;
    const cls = el.dataset.iconClass || '';
    const html = icon(name, { size, width, height, class: cls });
    if (html) el.insertAdjacentHTML('beforeend', html);
  });
}

export { ICON_BODY, ICON_META, ALIAS };
