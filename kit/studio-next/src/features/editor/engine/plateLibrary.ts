import { api } from '@/desk/api';
import { desk } from '@/desk/store';
import { toast } from '@/desk/toast';
import { layoutWire } from '@/ui/look/previews';

import { refresh } from './data';
import { paintStatus, select } from './edits';
import { renderInspector } from './inspector';
import { reloadPlate } from './lifecycle';
import { plateApi } from './look';
import { dropPlateContent } from './plateContentPane';
import { ed, setHtmlPlates, slug } from './state';
import { clearClipFresh, flashHint, markClipFresh, plateInfo } from './timeline';
import { seek } from './transport';
import type { Clip, Deck, DeckPlate, PlateLibrary, PlateRow } from './types';
import { ICONS, errMessage, escapeHtml } from './util';

/**
 * The plate library — one sheet for both jobs: add a plate to the cut (it joins the script and
 * lands on the timeline right where you are) and swap a plate for another in the same slot,
 * with the plate the script chose always one click away. Every type shows as a still painted
 * in this video's brand, so the pick is the plate you will get, not a wireframe of it.
 */

export const SWAP_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13l-3.5-3.5"/><path d="M20 16H7l3.5 3.5"/></svg>`;

type Mode = { kind: 'add'; after: string | null } | { kind: 'swap'; plateId: string };

interface Option {
  id: string;
  label: string;
  hint: string;
  shelf: string;
  thumb: string;
}

const FALLBACK: PlateLibrary = { shelves: [], types: [] };
const isEnd = (id: string | null | undefined): id is 'open' | 'close' => id === 'open' || id === 'close';
const library = (): PlateLibrary => ed.deck?.plateLibrary || FALLBACK;
const base = (): string => `/api/video/${encodeURIComponent(slug() || '')}`;

export function plateStill(type: string): string {
  const brand = desk.get().video?.brand;
  return brand ? `/api/plate-stills/${encodeURIComponent(brand)}/${encodeURIComponent(type)}.jpg` : '';
}

/** A still that fades in once decoded; a shimmer holds its place while the server paints it. */
export function stillThumb(type: string, cls = 'plib-thumb'): string {
  const src = plateStill(type);
  return `<span class="${cls}"><i class="plib-shimmer" aria-hidden="true"></i>${src ? `<img src="${escapeHtml(src)}" alt="" decoding="async" onload="this.parentNode.classList.add('is-ready')" onerror="this.parentNode.classList.add('is-failed')" />` : ''}</span>`;
}

export function plateTypeLabel(type: string | null | undefined): string {
  if (!type) return 'Plate';
  return library().types.find((t) => t.type === type)?.label || type[0]!.toUpperCase() + type.slice(1);
}

export function plateTypeHint(type: string | null | undefined): string {
  return library().types.find((t) => t.type === type)?.hint || '';
}

type Layouts = Record<string, Array<{ id: string; label: string; hint: string }>>;
export const layoutsOf = (kind: string): Array<{ id: string; label: string; hint: string }> => ((desk.get().video?.motionOptions as { layouts?: Layouts } | undefined)?.layouts?.[kind] || []);

/** Swappable at all: the ends change composition; interstitials change type; chapter plates neither. */
export function canSwap(c: Clip | null): boolean {
  if (!c || c.kind !== 'plate' || !c.plateId) return false;
  if (isEnd(c.plateId)) return layoutsOf(c.plateId).length > 1;
  const info = plateInfo(c.plateId);
  return info?.['swappable'] === true && library().types.some((t) => t.type === info.type);
}

// ─── Actions ───────────────────────────────────────────────────────────────────────────────
/** The change landed, but another plate in the video stops the full rebuild — say which. */
function warnElsewhere(r: { warning?: string | null }): void {
  if (r.warning) toast('Saved — another plate needs a look', r.warning, 'warn');
}

async function landPlates(): Promise<void> {
  const listed = await api<{ plates?: PlateRow[] }>(`${base()}/plates`).catch(() => null);
  if (listed?.plates) setHtmlPlates(listed.plates);
}

function focusClip(id: string): void {
  const c = ed.seq.find((x) => x.plateId === id || x.id === id);
  if (!c) return;
  seek(c.at + Math.min(0.4, c.dur * 0.2), { follow: true });
  select({ type: 'clip', id: c.id });
}

export async function addPlate(type: string, after: string | null): Promise<boolean> {
  try {
    const r = await api<Deck & { id: string; warning?: string | null }>(`${base()}/plates/add`, { method: 'POST', body: { type, after } });
    warnElsewhere(r);
    await landPlates();
    await refresh();
    ed.dirtyRender = true;
    paintStatus();
    focusClip(r.id);
    markClipFresh(r.id, 'is-landing', 1300);
    flashHint(`${plateTypeLabel(type)} added — write it on the stage`);
    return true;
  } catch (err) {
    toast('Plate not added', errMessage(err), 'err');
    return false;
  }
}

async function swapCall(plateId: string, body: Record<string, unknown>, hint: string): Promise<boolean> {
  markClipFresh(plateId, 'is-swapping');
  try {
    const r = await api<Omit<Deck, 'plates'> & { plates?: PlateRow[]; warning?: string | null }>(`${base()}/plates/${encodeURIComponent(plateId)}/swap`, { method: 'POST', body });
    warnElsewhere(r);
    if (r.plates) setHtmlPlates(r.plates, { video: false });
    dropPlateContent(plateId);
    await refresh();
    ed.dirtyRender = true;
    paintStatus();
    await reloadPlate(plateId);
    markClipFresh(plateId, 'is-swapped', 1000);
    renderInspector();
    flashHint(hint);
    return true;
  } catch (err) {
    clearClipFresh(plateId);
    toast('Plate not swapped', errMessage(err), 'err');
    return false;
  }
}

export function swapPlate(plateId: string, type: string): Promise<boolean> {
  return swapCall(plateId, { type }, `Now a ${plateTypeLabel(type)} plate — the original is one click away`);
}

export function revertPlate(plateId: string): Promise<boolean> {
  const from = plateInfo(plateId)?.swap;
  const what = isEnd(plateId) ? (layoutsOf(plateId).find((l) => l.id === from?.layout)?.label || 'original') : from?.label || 'original';
  return swapCall(plateId, { revert: true }, `Back to the ${what} plate`);
}

async function recompose(plateId: string, layout: string): Promise<boolean> {
  markClipFresh(plateId, 'is-swapping');
  const r = await plateApi(plateId, 'layout', { layout }, null);
  if (!r) {
    clearClipFresh(plateId);
    return false;
  }
  const info = plateInfo(plateId);
  if (info) info.swap = (r as { swap?: DeckPlate['swap'] }).swap ?? null;
  markClipFresh(plateId, 'is-swapped', 1000);
  renderInspector();
  flashHint(`${plateId === 'open' ? 'Opening' : 'Close'} · ${layoutsOf(plateId).find((l) => l.id === layout)?.label || layout}`);
  return true;
}

// ─── Sheet ─────────────────────────────────────────────────────────────────────────────────
let host: HTMLElement | null = null;
let mode: Mode | null = null;
let picked: string | null = null;
let shelf = 'all';
let query = '';
let opener: HTMLElement | null = null;
let busy = false;
let teardown: (() => void) | null = null;

export const plateLibOpen = (): boolean => Boolean(host);

function options(): Option[] {
  if (mode?.kind === 'swap' && isEnd(mode.plateId)) {
    const kind = mode.plateId;
    return layoutsOf(kind).map((l) => ({ id: l.id, label: l.label, hint: l.hint, shelf: 'all', thumb: `<span class="plib-thumb is-wire is-ready">${layoutWire(kind, l.id)}</span>` }));
  }
  return library().types.map((t) => ({ id: t.type, label: t.label, hint: t.hint, shelf: t.shelf, thumb: stillThumb(t.type) }));
}

function current(): { now: string | null; original: string | null } {
  if (mode?.kind !== 'swap') return { now: null, original: null };
  const info = plateInfo(mode.plateId);
  if (isEnd(mode.plateId)) {
    const ids = layoutsOf(mode.plateId).map((l) => l.id);
    return { now: info?.layout || ids[0] || null, original: info?.swap ? info.swap.layout || ids[0] || null : null };
  }
  return { now: info?.type || null, original: info?.swap?.type || null };
}

function anchorClip(): Clip | null {
  if (mode?.kind === 'add') return ed.seq.find((x) => x.id === mode!.after) || null;
  if (mode?.kind === 'swap') return ed.seq.find((x) => x.plateId === mode!.plateId) || null;
  return null;
}

function headHtml(): string {
  const c = anchorClip();
  if (mode?.kind === 'swap') {
    const end = isEnd(mode.plateId);
    return `<span class="plib-ico">${SWAP_ICON}</span><div class="plib-title"><b>${end ? `${mode.plateId === 'open' ? 'Opening' : 'Close'} style` : 'Swap plate'}</b><em>${escapeHtml(
      end ? 'Same words, another composition' : `Replaces “${c?.title || mode.plateId}” in place — its words carry over`,
    )}</em></div>`;
  }
  return `<span class="plib-ico">${ICONS['plus']}</span><div class="plib-title"><b>Add a plate</b><em>${escapeHtml(c ? `Lands after “${c.title}” · joins the script` : 'Lands before the close · joins the script')}</em></div>`;
}

function shelvesHtml(): string {
  if (mode?.kind === 'swap' && isEnd(mode.plateId)) return '';
  const shelves = [{ id: 'all', label: 'All' }, ...library().shelves];
  return `<div class="plib-shelves" role="tablist" aria-label="Plate shelves">${shelves
    .map((s) => `<button type="button" role="tab" class="plib-shelf${s.id === shelf ? ' on' : ''}" data-shelf="${s.id}" aria-selected="${s.id === shelf}">${escapeHtml(s.label)}</button>`)
    .join('')}<i class="plib-shelf-ink" aria-hidden="true"></i></div>`;
}

function gridHtml(): string {
  const { now, original } = current();
  return options()
    .map((o, i) => {
      const badge = o.id === now ? '<span class="plib-badge now">Current</span>' : o.id === original ? '<span class="plib-badge orig">Original</span>' : '';
      return `<button type="button" class="plib-card${o.id === picked ? ' is-picked' : ''}${o.id === now ? ' is-now' : ''}" data-opt="${escapeHtml(o.id)}" data-shelf="${o.shelf}" data-find="${escapeHtml(`${o.label} ${o.hint} ${o.id}`.toLowerCase())}" style="--i:${i}" role="option" aria-selected="${o.id === picked}" title="${escapeHtml(o.hint)}">${o.thumb}<span class="plib-meta"><b>${escapeHtml(o.label)}</b><em>${escapeHtml(o.hint)}</em></span>${badge}<i class="plib-check" aria-hidden="true">${ICONS['check']}</i></button>`;
    })
    .join('');
}

function footHtml(): string {
  const { now, original } = current();
  const label = options().find((o) => o.id === picked)?.label;
  const revert =
    mode?.kind === 'swap' && original && original !== now
      ? `<button type="button" class="plib-revert" data-plib="revert">${ICONS['reset']}<span>Back to the original · <b>${escapeHtml(
          isEnd(mode.plateId) ? layoutsOf(mode.plateId).find((l) => l.id === original)?.label || original : plateTypeLabel(original),
        )}</b></span></button>`
      : `<span class="plib-keys"><kbd>←</kbd><kbd>→</kbd> browse · <kbd>↵</kbd> ${mode?.kind === 'swap' ? 'swap' : 'add'} · <kbd>esc</kbd> close</span>`;
  const same = mode?.kind === 'swap' && picked === now;
  const verb = mode?.kind === 'swap' ? 'Swap to' : 'Add';
  return `${revert}<button type="button" class="plib-go" data-plib="go" ${!picked || same || busy ? 'disabled' : ''}>${busy ? '<i class="plib-spin" aria-hidden="true"></i>' : mode?.kind === 'swap' ? SWAP_ICON : ICONS['plus']}<span>${
    busy ? (mode?.kind === 'swap' ? 'Swapping…' : 'Adding…') : picked && !same ? `${verb} ${escapeHtml(label || picked)}` : mode?.kind === 'swap' ? 'Pick a plate' : 'Pick a plate to add'
  }</span></button>`;
}

function paintFoot(): void {
  const foot = host?.querySelector<HTMLElement>('.plib-foot');
  if (foot) foot.innerHTML = footHtml();
}

function moveInk(): void {
  const bar = host?.querySelector<HTMLElement>('.plib-shelves');
  const on = bar?.querySelector<HTMLElement>('.plib-shelf.on');
  if (!bar || !on) return;
  bar.style.setProperty('--ink-x', `${on.offsetLeft}px`);
  bar.style.setProperty('--ink-w', `${on.offsetWidth}px`);
}

/** Filter by shelf and search; the cards that stay deal back in, the rest fold away. */
function filter(): void {
  const grid = host?.querySelector<HTMLElement>('.plib-grid');
  if (!grid) return;
  const q = query.trim().toLowerCase();
  let n = 0;
  for (const card of grid.querySelectorAll<HTMLElement>('.plib-card')) {
    const show = (shelf === 'all' || card.dataset['shelf'] === shelf) && (!q || (card.dataset['find'] || '').includes(q));
    card.hidden = !show;
    if (show) card.style.setProperty('--i', String(n++));
  }
  grid.classList.remove('is-dealing');
  void grid.offsetWidth;
  grid.classList.add('is-dealing');
  const empty = host?.querySelector<HTMLElement>('.plib-empty');
  if (empty) empty.hidden = n > 0;
}

function pick(id: string | null, { scroll = false } = {}): void {
  picked = id;
  host?.querySelectorAll<HTMLElement>('.plib-card').forEach((card) => {
    const on = card.dataset['opt'] === id;
    card.classList.toggle('is-picked', on);
    card.setAttribute('aria-selected', String(on));
    if (on && scroll) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  paintFoot();
}

async function commit(): Promise<void> {
  if (!mode || !picked || busy) return;
  const m = mode;
  const id = picked;
  if (m.kind === 'swap' && current().now === id) return;
  busy = true;
  paintFoot();
  host?.querySelector(`.plib-card[data-opt="${CSS.escape(id)}"]`)?.classList.add('is-going');
  closePlateLibrary({ keepFocus: true });
  if (m.kind === 'add') await addPlate(id, m.after);
  else if (isEnd(m.plateId)) await recompose(m.plateId, id);
  else await swapPlate(m.plateId, id);
  busy = false;
}

function step(dx: number, dy: number): void {
  const grid = host?.querySelector<HTMLElement>('.plib-grid');
  const cards = [...(grid?.querySelectorAll<HTMLElement>('.plib-card:not([hidden])') || [])];
  if (!cards.length) return;
  const cols = Math.max(1, Math.round((grid!.clientWidth || 1) / (cards[0]!.offsetWidth || 1)));
  const at = Math.max(0, cards.findIndex((c) => c.dataset['opt'] === picked));
  const next = cards[Math.min(cards.length - 1, Math.max(0, (picked ? at : -1) + dx + dy * cols))] || cards[0]!;
  pick(next.dataset['opt'] || null, { scroll: true });
  next.focus({ preventScroll: true });
}

function wire(): void {
  if (!host) return;
  const panel = host.querySelector<HTMLElement>('.plib')!;
  host.querySelector('.plib-scrim')?.addEventListener('pointerdown', () => closePlateLibrary());
  panel.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const card = t.closest<HTMLElement>('.plib-card');
    if (card) {
      pick(card.dataset['opt'] || null);
      return;
    }
    const s = t.closest<HTMLElement>('[data-shelf]');
    if (s && s.classList.contains('plib-shelf')) {
      shelf = s.dataset['shelf'] || 'all';
      host?.querySelectorAll<HTMLElement>('.plib-shelf').forEach((b) => {
        b.classList.toggle('on', b === s);
        b.setAttribute('aria-selected', String(b === s));
      });
      moveInk();
      filter();
      return;
    }
    const act = t.closest<HTMLElement>('[data-plib]')?.dataset['plib'];
    if (act === 'close') closePlateLibrary();
    else if (act === 'go') void commit();
    else if (act === 'revert' && mode?.kind === 'swap') {
      const id = mode.plateId;
      closePlateLibrary({ keepFocus: true });
      void revertPlate(id);
    }
  });
  panel.addEventListener('dblclick', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.plib-card');
    if (card) {
      pick(card.dataset['opt'] || null);
      void commit();
    }
  });
  const search = panel.querySelector<HTMLInputElement>('.plib-search input');
  search?.addEventListener('input', () => {
    query = search.value;
    filter();
  });
  const onKey = (e: KeyboardEvent) => {
    if (!host) return;
    const typing = (e.target as HTMLElement | null)?.tagName === 'INPUT';
    let handled = true;
    if (e.key === 'Escape') {
      if (typing && query) {
        query = '';
        search!.value = '';
        filter();
      } else closePlateLibrary();
    } else if (e.key === 'Enter') void commit();
    else if (e.key === 'ArrowRight') step(1, 0);
    else if (e.key === 'ArrowLeft' && !typing) step(-1, 0);
    else if (e.key === 'ArrowDown') step(0, 1);
    else if (e.key === 'ArrowUp') step(0, -1);
    else if (!typing && e.key.length === 1 && !e.metaKey && !e.ctrlKey && search) {
      search.focus();
      handled = false;
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    } else e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);
  const onResize = () => {
    place();
    moveInk();
  };
  window.addEventListener('resize', onResize);
  teardown = () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
  };
}

/** Sit the sheet over the stage — the plate it adds or swaps plays right there. */
function place(): void {
  const panel = host?.querySelector<HTMLElement>('.plib');
  const stage = document.querySelector<HTMLElement>('#playerPlate:not([hidden])');
  if (!panel) return;
  const r = stage?.getBoundingClientRect();
  if (!r || r.width < 320 || r.height < 240) {
    panel.style.removeProperty('--plib-x');
    panel.style.removeProperty('--plib-y');
    return;
  }
  // Centred on the stage, but never past the window's edge — the sheet is wider than most stages.
  const fit = (centre: number, size: number, room: number, pad: number) => Math.min(Math.max(centre, size / 2 + pad), room - size / 2 - pad);
  const w = Math.min(880, innerWidth - 48);
  const h = Math.min(620, innerHeight - 64);
  panel.style.setProperty('--plib-x', `${Math.round(fit(r.left + r.width / 2, w, innerWidth, 24))}px`);
  panel.style.setProperty('--plib-y', `${Math.round(fit(r.top + r.height / 2, h, innerHeight, 32))}px`);
}

export function openPlateLibrary(next: Mode, from: HTMLElement | null = null): void {
  if (host) closePlateLibrary({ instant: true });
  mode = next;
  query = '';
  shelf = 'all';
  opener = from || (document.activeElement as HTMLElement | null);
  const { now } = current();
  picked = next.kind === 'swap' ? now : null;
  host = document.createElement('div');
  host.className = 'plib-host is-entering';
  host.innerHTML = `<div class="plib-scrim"></div>
    <div class="plib" role="dialog" aria-modal="true" aria-label="${next.kind === 'swap' ? 'Swap plate' : 'Add a plate'}" data-mode="${next.kind}${next.kind === 'swap' && isEnd(next.plateId) ? '-end' : ''}">
      <header class="plib-head">${headHtml()}${
        next.kind === 'swap' && isEnd(next.plateId)
          ? ''
          : `<label class="plib-search"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg><input type="search" placeholder="Search plates" aria-label="Search plates" autocomplete="off" spellcheck="false" /></label>`
      }<button type="button" class="plib-x" data-plib="close" aria-label="Close">${ICONS['x']}</button></header>
      ${shelvesHtml()}
      <div class="plib-body"><div class="plib-grid is-dealing" role="listbox" aria-label="Plates">${gridHtml()}</div><p class="plib-empty" hidden>No plate matches — try “numbers”, “steps” or “quote”.</p></div>
      <footer class="plib-foot">${footHtml()}</footer>
    </div>`;
  document.body.appendChild(host);
  place();
  wire();
  requestAnimationFrame(() => {
    moveInk();
    const target =
      host?.querySelector<HTMLElement>('.plib-card.is-picked') ||
      host?.querySelector<HTMLInputElement>('.plib-search input') ||
      host?.querySelector<HTMLElement>('.plib-card');
    target?.focus({ preventScroll: true });
    host?.querySelector<HTMLElement>('.plib-card.is-picked')?.scrollIntoView({ block: 'nearest' });
  });
  const entering = host;
  window.setTimeout(() => entering.classList.remove('is-entering'), 700);
}

export function closePlateLibrary({ instant = false, keepFocus = false }: { instant?: boolean; keepFocus?: boolean } = {}): void {
  if (!host) return;
  const el = host;
  host = null;
  mode = null;
  teardown?.();
  teardown = null;
  if (!keepFocus) opener?.focus?.({ preventScroll: true });
  opener = null;
  if (instant) {
    el.remove();
    return;
  }
  el.classList.add('is-leaving');
  el.addEventListener('animationend', (e) => e.target === el.querySelector('.plib') && el.remove());
  window.setTimeout(() => el.remove(), 360);
}

/** The slide the playhead is on — where an added plate goes. */
export function openAddLibrary(from: HTMLElement | null = null, after: Clip | null = null): void {
  const c = after || (ed.sel?.type === 'clip' ? ed.seq.find((x) => x.id === ed.sel?.id) : null) || ed.seq[ed.cur] || null;
  const at = c?.id === 'close' ? ed.seq[c.i - 1] || null : c;
  openPlateLibrary({ kind: 'add', after: at?.id || null }, from);
}

export function openSwapLibrary(c: Clip, from: HTMLElement | null = null): void {
  if (!canSwap(c)) return;
  openPlateLibrary({ kind: 'swap', plateId: c.plateId || '' }, from);
}
