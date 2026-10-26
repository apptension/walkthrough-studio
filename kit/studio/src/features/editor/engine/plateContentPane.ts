import { api } from '@/desk/api';
import { toast } from '@/desk/toast';
import { escapeHtml } from '@/lib/escapeHtml';
import { paintStatus } from './edits';
import { renderInspector, section } from './inspector';
import { reloadPlate } from './lifecycle';
import { plateDoc } from './look';
import { ed, setHtmlPlates, slug } from './state';
import { flashHint, plateInfo } from './timeline';
import type { Clip, PlateRow } from './types';
import { ICONS, errMessage } from './util';

/**
 * The Inspector's Content pane: what a plate is made of beyond its words. The server's
 * `plateSchema` says which lists (features, logos, stats, quotes…) and scalar fields (a hero
 * quote's stars, a metric's progress, a showcase screenshot) the plate has; this pane renders
 * them as records the user can add, remove, reorder and fill — and swaps logos, avatars and
 * screenshots from the brand shelf, an upload or a frame grabbed from the recording.
 *
 * Stage ↔ pane: tiles on the plate carry `data-slot="logos.2"`. Hovering one glows its record
 * here; clicking one opens it (and the reverse — hovering a record peeks the tile on stage).
 */

export interface ContentField {
  key: string;
  label: string;
  kind: 'text' | 'long' | 'lines' | 'asset' | 'icon' | 'number' | 'toggle' | 'choice';
  optional?: boolean;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}
export interface ContentList {
  key: string;
  label: string;
  item: string;
  min: number;
  max: number;
  strings?: boolean;
  fields: ContentField[];
  starter: unknown;
}
export interface ContentSchema {
  type: string;
  label: string;
  hint: string;
  fields: ContentField[];
  lists: ContentList[];
  icons: string[];
  layouts: string[];
}
export interface PlateAsset {
  asset: string;
  label: string;
  origin: 'brand' | 'video';
  kind: 'image' | 'grab';
  mtime: number;
}
type Row = Record<string, unknown>;
export interface PlateContentData {
  plateId: string;
  type: string;
  schema: ContentSchema | null;
  fields: Record<string, unknown>;
  lists: Record<string, Array<Row | string>>;
  assets?: PlateAsset[];
  plates?: PlateRow[];
}
type ContentOp =
  | { op: 'set'; path: string; value: unknown }
  | { op: 'add'; list: string; index?: number; item?: unknown }
  | { op: 'remove'; list: string; index: number }
  | { op: 'move'; list: string; from: number; to: number }
  | { op: 'duplicate'; list: string; index: number };

// ─── State ─────────────────────────────────────────────────────────────────────────────────
const cache = new Map<string, PlateContentData>();
const loading = new Set<string>();
let assetsCache: PlateAsset[] = [];
/** Which record is open (`logos.2`) and which asset field has its shelf open (`logos.2.asset`). */
let openSlot: string | null = null;
let shelfFor: string | null = null;
let iconFor: string | null = null;
let hoverSlot: string | null = null;
let saveGen = 0;
const pending = new Map<string, ReturnType<typeof setTimeout>>();

const base = () => `/api/video/${encodeURIComponent(slug() || '')}`;
const platePath = (id: string, tail: string) => `${base()}/plates/${encodeURIComponent(id)}/${tail}`;

export const contentFor = (plateId: string | null | undefined): PlateContentData | null => (plateId ? cache.get(plateId) || null : null);

/** Fetch the schema and values for a plate; repaints the inspector when they land. */
export function loadPlateContent(plateId: string, { force = false } = {}): void {
  if (!plateId || loading.has(plateId)) return;
  const info = plateInfo(plateId);
  const have = cache.get(plateId);
  if (!force && have && have.type === (info?.type || have.type)) return;
  loading.add(plateId);
  void api<PlateContentData>(platePath(plateId, 'content'))
    .then((r) => {
      cache.set(plateId, r);
      if (r.assets) assetsCache = r.assets;
      if (ed.sel?.type === 'clip' && ed.seq.find((c) => c.id === ed.sel?.id)?.plateId === plateId) renderInspector();
    })
    .catch((err) => toast('Content not loaded', errMessage(err), 'err'))
    .finally(() => loading.delete(plateId));
}

/** Forget what we know about a plate (after a swap or a revert the type and lists change). */
export function dropPlateContent(plateId?: string | null): void {
  if (plateId) cache.delete(plateId);
  else cache.clear();
}

// ─── Paths ─────────────────────────────────────────────────────────────────────────────────
/** `items.2.label` → `items.2`; `logo` → `logo`; `left.items.1` → `left.items.1`. */
export function slotOfPath(schema: ContentSchema | null, path: string): string | null {
  if (!schema) return null;
  for (const list of schema.lists) {
    const m = path.match(new RegExp(`^${list.key.replace(/\./g, '\\.')}\\.(\\d+)`));
    if (m) return `${list.key}.${m[1]}`;
  }
  // Inline copy on stats/logos/quotes plates still says `items.N` — the builder's generic key.
  const generic = path.match(/^items\.(\d+)/);
  if (generic && schema.lists[0] && schema.lists[0].key !== 'items') return `${schema.lists[0].key}.${generic[1]}`;
  return schema.fields.some((f) => f.key === path) ? path : null;
}

const listOfSlot = (schema: ContentSchema, slot: string): { list: ContentList; index: number } | null => {
  for (const list of schema.lists) {
    const m = slot.match(new RegExp(`^${list.key.replace(/\./g, '\\.')}\\.(\\d+)$`));
    if (m) return { list, index: Number(m[1]) };
  }
  return null;
};

// ─── Render ────────────────────────────────────────────────────────────────────────────────
const assetUrl = (asset: string) => (asset ? `${base()}/plate-asset?path=${encodeURIComponent(asset)}` : '');
const PLATE_ICON_URL = (name: string) => `${base()}/plate-icon/${encodeURIComponent(name)}.svg`;

function recordTitle(list: ContentList, row: Row | string, index: number): string {
  if (typeof row === 'string') return row || `${list.item} ${index + 1}`;
  const first = list.fields.find((f) => f.kind === 'text' && typeof row[f.key] === 'string' && String(row[f.key]).trim());
  const value = first ? String(row[first.key]) : '';
  return value || `${list.item} ${index + 1}`;
}

function thumb(asset: unknown, { size = 'sm' } = {}): string {
  const src = typeof asset === 'string' ? asset : '';
  if (!src) return `<span class="pcnt-thumb ${size} is-empty" aria-hidden="true">${ICONS['upload']}</span>`;
  const url = /^(data:|https?:)/i.test(src) ? src : assetUrl(src);
  return `<span class="pcnt-thumb ${size}" aria-hidden="true"><img src="${escapeHtml(url)}" alt="" loading="lazy" /></span>`;
}

function fieldControl(path: string, field: ContentField, value: unknown, schema: ContentSchema): string {
  const id = `pcnt-${path.replace(/[^a-z0-9]+/gi, '-')}`;
  const label = `<label class="pcnt-label" for="${id}">${escapeHtml(field.label)}${field.optional ? '' : '<i aria-hidden="true">·</i>'}</label>`;
  const hint = field.hint ? `<small class="pcnt-hint">${escapeHtml(field.hint)}</small>` : '';
  switch (field.kind) {
    case 'long':
      return `<div class="pcnt-field" data-kind="long">${label}<textarea id="${id}" class="pcnt-input pcnt-area" rows="2" data-cnt-path="${escapeHtml(path)}" data-cnt-kind="long" spellcheck="true">${escapeHtml(text(value))}</textarea>${hint}</div>`;
    case 'lines':
      return `<div class="pcnt-field" data-kind="lines">${label}<textarea id="${id}" class="pcnt-input pcnt-area" rows="3" data-cnt-path="${escapeHtml(path)}" data-cnt-kind="lines" placeholder="One per line">${escapeHtml(Array.isArray(value) ? value.map(text).join('\n') : text(value))}</textarea>${hint}</div>`;
    case 'number': {
      const n = Number(value);
      const stars = field.max === 5 && field.step === 1;
      if (stars) {
        const on = Number.isFinite(n) ? n : 0;
        return `<div class="pcnt-field" data-kind="stars">${label}<div class="pcnt-stars" role="radiogroup" aria-label="${escapeHtml(field.label)}">${[1, 2, 3, 4, 5]
          .map((k) => `<button type="button" role="radio" aria-checked="${k <= on}" class="pcnt-star${k <= on ? ' on' : ''}" data-cnt-star="${k}" data-cnt-path="${escapeHtml(path)}" title="${k} star${k > 1 ? 's' : ''}">★</button>`)
          .join('')}<button type="button" class="pcnt-star-off${on ? '' : ' on'}" data-cnt-star="0" data-cnt-path="${escapeHtml(path)}" title="No stars">${ICONS['x']}</button></div>${hint}</div>`;
      }
      const min = field.min ?? 0;
      const max = field.max ?? 100;
      const step = field.step ?? 1;
      const v = Number.isFinite(n) ? n : min;
      const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
      const out = step < 1 ? (max <= 1 ? `${Math.round(v * 100)}%` : v.toFixed(2)) : String(Math.round(v));
      return `<div class="pcnt-field" data-kind="number">${label}<div class="pcnt-range"><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-cnt-path="${escapeHtml(path)}" data-cnt-kind="number" style="--p:${pct.toFixed(1)}%" aria-label="${escapeHtml(field.label)}" /><output>${out}</output></div>${hint}</div>`;
    }
    case 'toggle':
      return `<div class="pcnt-field pcnt-row" data-kind="toggle">${label}<button type="button" role="switch" aria-checked="${value === true}" class="pcnt-switch${value === true ? ' on' : ''}" data-cnt-path="${escapeHtml(path)}" data-cnt-toggle><i></i></button>${hint}</div>`;
    case 'choice': {
      const cur = typeof value === 'string' && value ? value : field.options?.[0] || '';
      return `<div class="pcnt-field" data-kind="choice">${label}<div class="ins-seg pcnt-seg">${(field.options || [])
        .map((o) => `<button type="button" class="${o === cur ? 'on' : ''}" data-cnt-path="${escapeHtml(path)}" data-cnt-choice="${escapeHtml(o)}">${escapeHtml(o[0]!.toUpperCase() + o.slice(1))}</button>`)
        .join('')}</div>${hint}</div>`;
    }
    case 'icon': {
      const cur = typeof value === 'string' && value ? value : '';
      const open = iconFor === path;
      return `<div class="pcnt-field" data-kind="icon">${label}<button type="button" class="pcnt-icon-btn${open ? ' on' : ''}" data-cnt-icon-open="${escapeHtml(path)}" aria-expanded="${open}" title="Pick an icon">${
        cur ? `<img src="${PLATE_ICON_URL(cur)}" alt="" width="18" height="18" />` : ICONS['sparkle']
      }<span>${escapeHtml(cur || 'Auto')}</span><em>${ICONS['motion']}</em></button>${
        open
          ? `<div class="pcnt-icon-grid" role="listbox" aria-label="Icons">${schema.icons
              .map((name) => `<button type="button" role="option" aria-selected="${name === cur}" class="pcnt-icon${name === cur ? ' on' : ''}" data-cnt-path="${escapeHtml(path)}" data-cnt-icon="${escapeHtml(name)}" title="${escapeHtml(name)}"><img src="${PLATE_ICON_URL(name)}" alt="" width="20" height="20" /></button>`)
              .join('')}</div>`
          : ''
      }</div>`;
    }
    case 'asset': {
      const cur = typeof value === 'string' ? value : '';
      const open = shelfFor === path;
      const name = cur ? cur.split('/').pop() || cur : 'No image yet';
      const canGrab = ed.seq.some((c) => c.kind === 'live');
      return `<div class="pcnt-field" data-kind="asset" data-cnt-asset-field="${escapeHtml(path)}">${label}
        <div class="pcnt-asset${cur ? '' : ' is-empty'}${open ? ' is-open' : ''}" data-cnt-drop="${escapeHtml(path)}">
          <button type="button" class="pcnt-asset-face" data-cnt-shelf-open="${escapeHtml(path)}" aria-expanded="${open}" title="${cur ? 'Swap this image' : 'Pick an image'}">
            ${thumb(cur, { size: 'lg' })}
            <span class="pcnt-asset-meta"><b>${escapeHtml(name)}</b><span>${cur ? 'Click to swap · drop a file to replace' : 'Click to pick · drop a file here'}</span></span>
          </button>
          <div class="pcnt-asset-tools">
            <label class="ins-btn pcnt-upload" title="Upload PNG, JPEG, WebP or SVG">${ICONS['upload']}Upload<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" data-cnt-upload="${escapeHtml(path)}" hidden /></label>
            ${canGrab ? `<button type="button" class="ins-btn" data-cnt-grab="${escapeHtml(path)}" title="Grab the interface at the playhead">${ICONS['film']}Grab frame</button>` : ''}
            ${cur ? `<button type="button" class="ins-btn ghost pcnt-clear" data-cnt-clear="${escapeHtml(path)}" title="Remove the image">${ICONS['x']}</button>` : ''}
          </div>
          ${open ? renderShelf(path, cur) : ''}
        </div>${hint}</div>`;
    }
    default:
      return `<div class="pcnt-field" data-kind="text">${label}<input id="${id}" type="text" class="pcnt-input" value="${escapeHtml(text(value))}" data-cnt-path="${escapeHtml(path)}" data-cnt-kind="text" />${hint}</div>`;
  }
}

function renderShelf(path: string, cur: string): string {
  const groups: Array<[string, PlateAsset[]]> = [
    ['From the recording', assetsCache.filter((a) => a.kind === 'grab')],
    ['This video', assetsCache.filter((a) => a.origin === 'video' && a.kind !== 'grab')],
    ['Brand', assetsCache.filter((a) => a.origin === 'brand')],
  ];
  const body = groups
    .filter(([, rows]) => rows.length)
    .map(
      ([title, rows]) => `<div class="pcnt-shelf-group"><em>${title}</em><div class="pcnt-shelf-grid">${rows
        .map(
          (a) => `<button type="button" class="pcnt-shelf-item${a.asset === cur ? ' on' : ''}" data-cnt-path="${escapeHtml(path)}" data-cnt-pick="${escapeHtml(a.asset)}" title="${escapeHtml(a.label)}">${thumb(a.asset)}<span>${escapeHtml(a.label)}</span></button>`,
        )
        .join('')}</div></div>`,
    )
    .join('');
  return `<div class="pcnt-shelf" data-cnt-shelf>${body || `<p class="ins-note subtle">No images yet — upload one or grab a frame from the recording.</p>`}</div>`;
}

function renderRecord(list: ContentList, row: Row | string, index: number, schema: ContentSchema, count: number): string {
  const slot = `${list.key}.${index}`;
  const open = openSlot === slot;
  const title = recordTitle(list, row, index);
  const assetField = list.fields.find((f) => f.kind === 'asset');
  const assetValue = assetField && typeof row !== 'string' ? row[assetField.key] : null;
  const iconField = list.fields.find((f) => f.kind === 'icon');
  const iconValue = iconField && typeof row !== 'string' && typeof row[iconField.key] === 'string' ? String(row[iconField.key]) : '';
  const lead = assetField
    ? thumb(assetValue)
    : iconValue
      ? `<span class="pcnt-thumb sm is-icon" aria-hidden="true"><img src="${PLATE_ICON_URL(iconValue)}" alt="" width="16" height="16" /></span>`
      : `<span class="pcnt-num" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>`;
  const fields = list.strings
    ? fieldControl(slot, { key: '', label: list.item, kind: 'text' }, row, schema)
    : list.fields.map((f) => fieldControl(`${slot}.${f.key}`, f, (row as Row)[f.key], schema)).join('');
  const canRemove = count > list.min;
  const canAdd = count < list.max;
  return `<article class="pcnt-rec${open ? ' is-open' : ''}${hoverSlot === slot ? ' is-hover' : ''}" data-cnt-slot="${escapeHtml(slot)}" draggable="true">
      <header class="pcnt-rec-head">
        <span class="pcnt-grip" data-cnt-grip title="Drag to reorder" aria-hidden="true">${GRIP}</span>
        <button type="button" class="pcnt-rec-open" data-cnt-open="${escapeHtml(slot)}" aria-expanded="${open}">${lead}<b>${escapeHtml(title)}</b></button>
        <span class="pcnt-rec-tools">
          <button type="button" class="pcnt-mini" data-cnt-move="${escapeHtml(list.key)}" data-from="${index}" data-to="${index - 1}" title="Move up" ${index === 0 ? 'disabled' : ''}>${ARROW_UP}</button>
          <button type="button" class="pcnt-mini" data-cnt-move="${escapeHtml(list.key)}" data-from="${index}" data-to="${index + 1}" title="Move down" ${index === count - 1 ? 'disabled' : ''}>${ARROW_DOWN}</button>
          <button type="button" class="pcnt-mini" data-cnt-dup="${escapeHtml(list.key)}" data-index="${index}" title="${canAdd ? 'Duplicate' : `At most ${list.max}`}" ${canAdd ? '' : 'disabled'}>${ICONS['plus']}</button>
          <button type="button" class="pcnt-mini danger" data-cnt-remove="${escapeHtml(list.key)}" data-index="${index}" title="${canRemove ? 'Remove' : `At least ${list.min}`}" ${canRemove ? '' : 'disabled'}>${ICONS['trash']}</button>
        </span>
      </header>
      ${open ? `<div class="pcnt-rec-body">${fields}</div>` : ''}
    </article>`;
}

const GRIP = `<svg viewBox="0 0 10 16" width="8" height="12" fill="currentColor" aria-hidden="true"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/></svg>`;
const ARROW_UP = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>`;
const ARROW_DOWN = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>`;

/** The Content section for the Design tab — or nothing for plates without a schema. */
export function renderPlateContent(c: Clip): string {
  const id = c.plateId || '';
  if (!id || id === 'open' || id === 'close' || c.kind !== 'plate') return '';
  const data = cache.get(id);
  if (!data) {
    loadPlateContent(id);
    return section('plate', 'Content', `<div class="pcnt-loading" aria-busy="true"><i></i><i></i><i></i></div>`);
  }
  const schema = data.schema;
  if (!schema || (!schema.fields.length && !schema.lists.length)) return '';
  const scalars = schema.fields.map((f) => fieldControl(f.key, f, data.fields[f.key], schema)).join('');
  const lists = schema.lists
    .map((list) => {
      const rows = data.lists[list.key] || [];
      const canAdd = rows.length < list.max;
      return `<div class="pcnt-list" data-cnt-list="${escapeHtml(list.key)}">
          <header class="pcnt-list-head">
            <strong>${escapeHtml(list.label)}</strong>
            <em class="pcnt-count${rows.length >= list.max ? ' is-max' : rows.length <= list.min ? ' is-min' : ''}" title="${list.min}–${list.max} on a ${escapeHtml(schema.label)} plate">${rows.length}<span>/ ${list.max}</span></em>
            <button type="button" class="pcnt-add" data-cnt-add="${escapeHtml(list.key)}" ${canAdd ? '' : 'disabled'} title="${canAdd ? `Add a ${list.item.toLowerCase()}` : `At most ${list.max}`}">${ICONS['plus']}<span>Add</span></button>
          </header>
          <div class="pcnt-recs">${rows.map((row, i) => renderRecord(list, row, i, schema, rows.length)).join('')}</div>
        </div>`;
    })
    .join('');
  const hint = `<p class="ins-note subtle pcnt-note">Hover a tile on the stage to find it here · click one to open it.</p>`;
  return section('plate', 'Content', `${scalars ? `<div class="pcnt-scalars">${scalars}</div>` : ''}${lists}${hint}`);
}

// ─── Save ──────────────────────────────────────────────────────────────────────────────────
async function send(id: string, ops: ContentOp[], hint: string | null, { repaint = true } = {}): Promise<boolean> {
  const gen = ++saveGen;
  try {
    const r = await api<PlateContentData>(platePath(id, 'content'), { method: 'POST', body: { ops } });
    const prev = cache.get(id);
    cache.set(id, { ...(prev || ({} as PlateContentData)), ...r, assets: r.assets || prev?.assets });
    if (r.plates) setHtmlPlates(r.plates, { video: false });
    ed.dirtyRender = true;
    paintStatus();
    await reloadPlate(id);
    if (hint) flashHint(hint);
    if (repaint && gen === saveGen) renderInspector();
    return true;
  } catch (err) {
    toast('Content not saved', errMessage(err), 'err');
    loadPlateContent(id, { force: true });
    return false;
  }
}

/** Typed edits land locally at once and post after a short pause, so typing never fights the stage. */
function setSoon(id: string, path: string, value: unknown, kind: string): void {
  const data = cache.get(id);
  if (data) setLocal(data, path, value);
  clearTimeout(pending.get(path));
  pending.set(
    path,
    setTimeout(() => {
      pending.delete(path);
      void send(id, [{ op: 'set', path, value }], null, { repaint: kind === 'lines' });
    }, 420),
  );
}

function setLocal(data: PlateContentData, path: string, value: unknown): void {
  const schema = data.schema;
  if (!schema) return;
  const slot = listOfSlot(schema, path) ? path : null;
  for (const list of schema.lists) {
    const m = path.match(new RegExp(`^${list.key.replace(/\./g, '\\.')}\\.(\\d+)(?:\\.(.+))?$`));
    if (!m) continue;
    const rows = data.lists[list.key] || (data.lists[list.key] = []);
    const i = Number(m[1]);
    if (list.strings || !m[2]) rows[i] = value as string;
    else {
      const row = (rows[i] as Row) || (rows[i] = {});
      row[m[2]] = value;
    }
    return;
  }
  if (!slot) data.fields[path] = value;
}

/** Flush a pending typed edit before a structural op so order never races. */
async function flush(): Promise<void> {
  const timers = [...pending.values()];
  pending.clear();
  for (const t of timers) clearTimeout(t);
  if (!timers.length) return;
  await new Promise((r) => setTimeout(r, 0));
}

/** A field value as the text an input shows — objects never leak as "[object Object]". */
const text = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return v.toString();
  return JSON.stringify(v);
};

// ─── Assets ────────────────────────────────────────────────────────────────────────────────
const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });

async function uploadAsset(id: string, path: string, file: File): Promise<void> {
  if (!/^image\//.test(file.type) && !/\.svg$/i.test(file.name)) {
    toast('Not an image', 'Use PNG, JPEG, WebP, SVG or GIF', 'warn');
    return;
  }
  try {
    const data = await fileToBase64(file);
    const r = await api<{ asset: string; assets?: PlateAsset[] }>(platePath(id, 'asset'), { method: 'POST', body: { name: file.name, mime: file.type, data } });
    if (r.assets) assetsCache = r.assets;
    shelfFor = null;
    await send(id, [{ op: 'set', path, value: r.asset }], `${file.name} on the plate`);
  } catch (err) {
    toast('Upload failed', errMessage(err), 'err');
  }
}

/** Where the playhead sits in the recording — the frame a Showcase plate would grab. */
function recordingTimeAtPlayhead(): number | null {
  const live = ed.seq.filter((c) => c.kind === 'live');
  if (!live.length) return null;
  const on = live.find((c) => ed.t >= c.at && ed.t < c.at + c.dur);
  if (on) return on.recFrom + (ed.t - on.at);
  const nearest = live.reduce((best, c) => (Math.abs(c.at - ed.t) < Math.abs(best.at - ed.t) ? c : best), live[0]!);
  return nearest.recFrom;
}

async function grabFrame(id: string, path: string, btn: HTMLElement): Promise<void> {
  const t = recordingTimeAtPlayhead();
  if (t == null) {
    toast('No recording', 'Record the walkthrough first, then grab a frame', 'warn');
    return;
  }
  btn.classList.add('is-busy');
  try {
    const r = await api<{ asset: string; t: number; assets?: PlateAsset[] }>(platePath(id, 'grab'), { method: 'POST', body: { t } });
    if (r.assets) assetsCache = r.assets;
    shelfFor = null;
    await send(id, [{ op: 'set', path, value: r.asset }], `Frame at ${r.t.toFixed(1)}s on the plate`);
  } catch (err) {
    toast('Grab failed', errMessage(err), 'err');
  } finally {
    btn.classList.remove('is-busy');
  }
}

// ─── Stage ↔ pane ──────────────────────────────────────────────────────────────────────────
function peekOnStage(id: string, slot: string | null): void {
  const doc = plateDoc(id);
  if (!doc) return;
  doc.querySelectorAll('[data-slot].is-peek').forEach((n) => n.classList.remove('is-peek'));
  if (!slot) return;
  doc.querySelectorAll<HTMLElement>('[data-slot]').forEach((n) => {
    if (n.dataset['slot'] === slot) n.classList.add('is-peek');
  });
}

/** A tile on the stage was clicked: open its record here and bring it into view. */
export function openContentSlot(plateId: string, slot: string): void {
  const data = cache.get(plateId);
  const target = data?.schema ? slotOfPath(data.schema, slot) : slot;
  if (!target) return;
  const isList = Boolean(data?.schema && listOfSlot(data.schema, target));
  openSlot = isList ? target : openSlot;
  if (!isList && data?.schema?.fields.find((f) => f.key === target)?.kind === 'asset') shelfFor = target;
  renderInspector();
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(isList ? `#inspectorRoot [data-cnt-slot="${CSS.escape(target)}"]` : `#inspectorRoot [data-cnt-asset-field="${CSS.escape(target)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('is-flash');
    setTimeout(() => el.classList.remove('is-flash'), 900);
    if (isList) el.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
  });
}

/** A tile on the stage is hovered (or left): light its record here. */
/** A record dragged on the stage (a callout pin): write its `x`/`y` and keep the pane in step. */
export function moveContentSlot(plateId: string, slot: string, at: { x: number; y: number }): void {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return;
  const data = cache.get(plateId);
  if (!data?.schema || !listOfSlot(data.schema, slot)) return;
  const x = Math.round(at.x);
  const y = Math.round(at.y);
  setLocal(data, `${slot}.x`, x);
  setLocal(data, `${slot}.y`, y);
  void send(
    plateId,
    [
      { op: 'set', path: `${slot}.x`, value: x },
      { op: 'set', path: `${slot}.y`, value: y },
    ],
    `Pin at ${x}%, ${y}%`,
  );
}

export function hoverContentSlot(plateId: string, slot: string | null): void {
  const data = cache.get(plateId);
  const target = slot && data?.schema ? slotOfPath(data.schema, slot) : null;
  if (hoverSlot === target) return;
  hoverSlot = target;
  document.querySelectorAll<HTMLElement>('#inspectorRoot .pcnt-rec').forEach((el) => el.classList.toggle('is-hover', el.dataset['cntSlot'] === target));
  if (target) document.querySelector<HTMLElement>(`#inspectorRoot .pcnt-rec[data-cnt-slot="${CSS.escape(target)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/** Text edit landed on a field: keep the matching record open. */
export function syncContentToField(plateId: string, path: string | null): void {
  if (!path) return;
  const data = cache.get(plateId);
  const target = data?.schema ? slotOfPath(data.schema, path) : null;
  if (!target || !data?.schema || !listOfSlot(data.schema, target) || openSlot === target) return;
  openSlot = target;
  const root = document.querySelector('#inspectorRoot .pcnt-list');
  if (root) renderInspector();
}

// ─── Wire ──────────────────────────────────────────────────────────────────────────────────
export function wirePlateContent(root: HTMLElement, c: Clip): void {
  const id = c.plateId || '';
  if (!id || c.kind !== 'plate') return;
  const box = root.querySelector<HTMLElement>('.pcnt-scalars, .pcnt-list')?.closest<HTMLElement>('.ins-sec');
  if (!box) return;
  const data = cache.get(id);
  const on = <E extends HTMLElement>(sel: string, ev: string, fn: (el: E, e: Event) => void | Promise<void>) =>
    box.querySelectorAll<E>(sel).forEach((el) =>
      el.addEventListener(ev, (e) => {
        void fn(el, e);
      }),
    );

  on<HTMLInputElement | HTMLTextAreaElement>('[data-cnt-path][data-cnt-kind]', 'input', (el) => {
    const kind = el.dataset['cntKind'] || 'text';
    const path = el.dataset['cntPath'] || '';
    if (kind === 'number') {
      const v = Number(el.value);
      const min = Number(el.getAttribute('min') || 0);
      const max = Number(el.getAttribute('max') || 100);
      const step = Number(el.getAttribute('step') || 1);
      el.style.setProperty('--p', `${(((v - min) / (max - min || 1)) * 100).toFixed(1)}%`);
      const out = el.parentElement?.querySelector('output');
      if (out) out.textContent = step < 1 ? (max <= 1 ? `${Math.round(v * 100)}%` : v.toFixed(2)) : String(Math.round(v));
      setSoon(id, path, v, kind);
      return;
    }
    setSoon(id, path, el.value, kind);
    // The record title follows its first text field as it is typed.
    if (kind === 'text') {
      const rec = el.closest<HTMLElement>('.pcnt-rec');
      const b = rec?.querySelector<HTMLElement>('.pcnt-rec-open b');
      const list = data?.schema?.lists.find((l) => rec?.dataset['cntSlot']?.startsWith(`${l.key}.`));
      const first = list?.strings ? '' : list?.fields.find((f) => f.kind === 'text')?.key;
      if (b && list && (list.strings || path.endsWith(`.${first}`))) b.textContent = el.value || b.textContent;
    }
  });
  on<HTMLInputElement | HTMLTextAreaElement>('[data-cnt-path][data-cnt-kind]', 'change', (el) => {
    const path = el.dataset['cntPath'] || '';
    const t = pending.get(path);
    if (!t) return;
    clearTimeout(t);
    pending.delete(path);
    const kind = el.dataset['cntKind'];
    void send(id, [{ op: 'set', path, value: kind === 'number' ? Number(el.value) : el.value }], null, { repaint: kind === 'lines' });
  });
  on('[data-cnt-star]', 'click', (el) => {
    const path = el.dataset['cntPath'] || '';
    const n = Number(el.dataset['cntStar']);
    void send(id, [{ op: 'set', path, value: n }], n ? `${n} star${n > 1 ? 's' : ''}` : 'Stars off');
  });
  on('[data-cnt-toggle]', 'click', (el) => {
    const path = el.dataset['cntPath'] || '';
    const next = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', String(next));
    el.classList.toggle('on', next);
    void send(id, [{ op: 'set', path, value: next }], null);
  });
  on('[data-cnt-choice]', 'click', (el) => {
    const path = el.dataset['cntPath'] || '';
    void send(id, [{ op: 'set', path, value: el.dataset['cntChoice'] }], null);
  });
  on('[data-cnt-icon-open]', 'click', (el) => {
    const path = el.dataset['cntIconOpen'] || '';
    iconFor = iconFor === path ? null : path;
    shelfFor = null;
    renderInspector();
  });
  on('[data-cnt-icon]', 'click', (el) => {
    const path = el.dataset['cntPath'] || '';
    iconFor = null;
    void send(id, [{ op: 'set', path, value: el.dataset['cntIcon'] }], `Icon · ${el.dataset['cntIcon']}`);
  });
  on('[data-cnt-shelf-open]', 'click', (el) => {
    const path = el.dataset['cntShelfOpen'] || '';
    shelfFor = shelfFor === path ? null : path;
    iconFor = null;
    if (shelfFor && !assetsCache.length) {
      void api<{ assets: PlateAsset[] }>(`${base()}/plate-assets`).then((r) => {
        assetsCache = r.assets || [];
        renderInspector();
      });
    }
    renderInspector();
  });
  on('[data-cnt-pick]', 'click', (el) => {
    const path = el.dataset['cntPath'] || '';
    shelfFor = null;
    void send(id, [{ op: 'set', path, value: el.dataset['cntPick'] }], 'Image swapped');
  });
  on('[data-cnt-clear]', 'click', (el) => {
    const path = el.dataset['cntClear'] || '';
    void send(id, [{ op: 'set', path, value: '' }], 'Image removed');
  });
  on<HTMLInputElement>('[data-cnt-upload]', 'change', (el) => {
    const file = el.files?.[0];
    if (file) void uploadAsset(id, el.dataset['cntUpload'] || '', file);
    el.value = '';
  });
  on('[data-cnt-grab]', 'click', (el) => void grabFrame(id, el.dataset['cntGrab'] || '', el));
  on('[data-cnt-drop]', 'dragover', (el, e) => {
    if (![...((e as DragEvent).dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    el.classList.add('is-over');
  });
  on('[data-cnt-drop]', 'dragleave', (el) => el.classList.remove('is-over'));
  on('[data-cnt-drop]', 'drop', (el, e) => {
    const file = (e as DragEvent).dataTransfer?.files?.[0];
    el.classList.remove('is-over');
    if (!file) return;
    e.preventDefault();
    void uploadAsset(id, el.dataset['cntDrop'] || '', file);
  });

  // Records
  on('[data-cnt-open]', 'click', (el) => {
    const slot = el.dataset['cntOpen'] || '';
    openSlot = openSlot === slot ? null : slot;
    shelfFor = null;
    iconFor = null;
    renderInspector();
    if (openSlot) requestAnimationFrame(() => document.querySelector<HTMLElement>(`#inspectorRoot [data-cnt-slot="${CSS.escape(slot)}"] input, #inspectorRoot [data-cnt-slot="${CSS.escape(slot)}"] textarea`)?.focus({ preventScroll: true }));
  });
  on('[data-cnt-add]', 'click', async (el) => {
    const list = el.dataset['cntAdd'] || '';
    const count = (data?.lists[list] || []).length;
    await flush();
    openSlot = `${list}.${count}`;
    const ok = await send(id, [{ op: 'add', list }], 'Added');
    if (ok) requestAnimationFrame(() => document.querySelector<HTMLElement>(`#inspectorRoot [data-cnt-slot="${CSS.escape(openSlot || '')}"] input, #inspectorRoot [data-cnt-slot="${CSS.escape(openSlot || '')}"] textarea`)?.focus({ preventScroll: true }));
  });
  on('[data-cnt-remove]', 'click', async (el) => {
    const list = el.dataset['cntRemove'] || '';
    const index = Number(el.dataset['index']);
    const rec = el.closest<HTMLElement>('.pcnt-rec');
    rec?.classList.add('is-leaving');
    await flush();
    if (openSlot === `${list}.${index}`) openSlot = null;
    await send(id, [{ op: 'remove', list, index }], 'Removed');
  });
  on('[data-cnt-dup]', 'click', async (el) => {
    const list = el.dataset['cntDup'] || '';
    const index = Number(el.dataset['index']);
    await flush();
    openSlot = `${list}.${index + 1}`;
    await send(id, [{ op: 'duplicate', list, index }], 'Duplicated');
  });
  on('[data-cnt-move]', 'click', async (el) => {
    const list = el.dataset['cntMove'] || '';
    const from = Number(el.dataset['from']);
    const to = Number(el.dataset['to']);
    await flush();
    if (openSlot === `${list}.${from}`) openSlot = `${list}.${to}`;
    await send(id, [{ op: 'move', list, from, to }], null);
  });

  // Drag to reorder (records within one list).
  let dragFrom: { list: string; index: number } | null = null;
  on('.pcnt-rec', 'dragstart', (el, e) => {
    const slot = el.dataset['cntSlot'] || '';
    const m = slot.match(/^(.*)\.(\d+)$/);
    if (!m || !(e.target as HTMLElement)?.closest?.('[data-cnt-grip]') && (e.target as HTMLElement) !== el) {
      // Only the grip (or the card itself) starts a drag — text selection in inputs must not.
      if (!(e.target as HTMLElement)?.closest?.('[data-cnt-grip]')) {
        e.preventDefault();
        return;
      }
    }
    if (!m) return;
    dragFrom = { list: m[1]!, index: Number(m[2]) };
    el.classList.add('is-dragging');
    (e as DragEvent).dataTransfer?.setData('text/plain', slot);
    if ((e as DragEvent).dataTransfer) (e as DragEvent).dataTransfer!.effectAllowed = 'move';
  });
  on('.pcnt-rec', 'dragend', (el) => {
    el.classList.remove('is-dragging');
    box.querySelectorAll('.pcnt-rec.is-before, .pcnt-rec.is-after').forEach((n) => n.classList.remove('is-before', 'is-after'));
    dragFrom = null;
  });
  on('.pcnt-rec', 'dragover', (el, e) => {
    if (!dragFrom) return;
    const slot = el.dataset['cntSlot'] || '';
    if (!slot.startsWith(`${dragFrom.list}.`)) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const after = (e as DragEvent).clientY > r.top + r.height / 2;
    el.classList.toggle('is-after', after);
    el.classList.toggle('is-before', !after);
  });
  on('.pcnt-rec', 'dragleave', (el) => el.classList.remove('is-before', 'is-after'));
  on('.pcnt-rec', 'drop', async (el, e) => {
    if (!dragFrom) return;
    e.preventDefault();
    const slot = el.dataset['cntSlot'] || '';
    const m = slot.match(/^(.*)\.(\d+)$/);
    const after = el.classList.contains('is-after');
    el.classList.remove('is-before', 'is-after');
    if (!m || m[1] !== dragFrom.list) return;
    let to = Number(m[2]) + (after ? 1 : 0);
    if (to > dragFrom.index) to -= 1;
    const from = dragFrom.index;
    dragFrom = null;
    if (to === from) return;
    await flush();
    if (openSlot === `${m[1]}.${from}`) openSlot = `${m[1]}.${to}`;
    await send(id, [{ op: 'move', list: m[1], from, to }], null);
  });

  // Hover a record → peek the tile on the stage.
  on('.pcnt-rec', 'pointerenter', (el) => peekOnStage(id, el.dataset['cntSlot'] || null));
  on('.pcnt-rec', 'pointerleave', () => peekOnStage(id, null));
  on('[data-cnt-asset-field]', 'pointerenter', (el) => peekOnStage(id, el.dataset['cntAssetField'] || null));
  on('[data-cnt-asset-field]', 'pointerleave', () => peekOnStage(id, null));
}
