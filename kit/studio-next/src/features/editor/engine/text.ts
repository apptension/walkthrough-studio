import { desk } from '@/desk/store';
import { toast } from '@/desk/toast';
import { cardEditLandingEd, cardMarkInClip, cardMarkKey } from '@/logic/liveCardStage';

import { select, showInspectorTab } from './edits';
import { renderInspector, section } from './inspector';
import { refreshPlatePreview } from './look';
import { P } from './plateCtl';
import { curClip, recToEd } from './seq';
import { ensureLiveCards, liveCardAtPlayhead, liveHitAtPlayhead, paintClipChip, plateReady, renderFrame, requestPlate, resolveLiveCard } from './stage';
import { ed, htmlPlates, timers, type PlateFieldState } from './state';
import { flashHint } from './timeline';
import { pause, seek } from './transport';
import type { Clip, FieldDetail } from './types';
import { $, ICONS, clamp, escapeHtml, fieldLabel, hotkeyMod, icon } from './util';

/** Text editing on plates and live cards, plus the stage tip (#edTextBar), from `kit/studio/editor.js`. */

export function clearPlatePreviewTimers(): void {
  clearTimeout(timers.stylePreview);
  timers.stylePreview = 0;
}

export function markPlateResync(plateId?: string | null): void {
  ed.needsPlateResync = plateId || ed.needsPlateResync || desk.get().activePlateId || null;
}

export function flushPlateResync(): void {
  const id = ed.needsPlateResync;
  ed.needsPlateResync = null;
  // Keep the playhead — deferred look/style paints should not shove you back to the open.
  if (id) refreshPlatePreview(id, { fromStart: false });
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function enterText(focusPath: string | null = null, { cardId = null }: { cardId?: string | null } = {}): Promise<void> {
  const c = curClip();
  if (cardId || c?.kind === 'live') await ensureLiveCards(cardId || null);
  let card = cardId ? htmlPlates().find((p) => p.id === cardId) || null : null;
  if (!card && c?.kind === 'live') card = liveCardAtPlayhead();
  // Explicit live-card edits win even if the playhead still sits on a neighboring plate.
  const plateId = card?.id || cardId || (c?.kind === 'plate' ? c.plateId : null);
  if (!plateId) {
    if (c?.kind === 'live' || cardId) {
      toast('No card at the playhead', 'Click a chapter or caption block on the timeline, then Edit text', 'warn');
    }
    return;
  }
  if (ed.playing) pause();
  clearPlatePreviewTimers();
  const gen = ++ed.textGen;
  ed.liveCardId = String(plateId).startsWith('overlay:') ? plateId : card?.id || null;
  document.body.classList.add('is-live-card');
  if (!plateReady(plateId)) await requestPlate(plateId);
  if (gen !== ed.textGen) return;
  if (!plateReady(plateId)) {
    // Wait for iframe + inline-edit arm (overlays can take a beat on first open).
    for (let i = 0; i < 40 && !plateReady(plateId); i++) {
      await wait(50);
      if (gen !== ed.textGen) return;
      if (!ed.loadingPlate) await requestPlate(plateId);
    }
  }
  if (!plateReady(plateId) && String(plateId).startsWith('overlay:')) {
    await ensureLiveCards(plateId);
    if (gen !== ed.textGen) return;
    await requestPlate(plateId);
    for (let i = 0; i < 20 && !plateReady(plateId); i++) {
      await wait(50);
      if (gen !== ed.textGen) return;
    }
  }
  if (!plateReady(plateId)) {
    const wantedCard = Boolean(cardId || ed.liveCardId);
    ed.liveCardId = null;
    if (c?.kind === 'live' || wantedCard) {
      toast('Card not ready', 'Open Direction → Apply live cards, then try again', 'warn');
    }
    return;
  }
  P.composite?.(true);
  ed.textMode = true;
  paintTextMode();
  renderFrame();
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    P.text?.({ onReady: done });
    // Safety if onReady never fires (plate already composed / missing frame).
    setTimeout(done, 400);
  });
  // Done / play / leave / a newer enterText won while we waited.
  if (gen !== ed.textGen || !ed.textMode) return;
  P.composite?.(true);
  if (focusPath) {
    P.focus?.(focusPath);
    syncPlateField(P.selection?.() || { path: focusPath });
  } else {
    syncPlateField(P.selection?.() || null);
  }
  paintTextMode();
  paintClipChip();
  if (ed.sel?.type === 'clip' || ed.sel?.type === 'card') renderInspector();
}

/** Jump to a chapter/caption mark and open its editable template (even from a plate playhead). */
export async function enterLiveCard(cardId: string | null, markT: number | string | null = null, markKey: string | null = null): Promise<void> {
  const markNum = markT != null ? Number(markT) : NaN;
  const marks = ed.deck?.marks || [];
  const mark =
    (markKey && marks.find((m) => (m.key || cardMarkKey(m)) === markKey)) ||
    (Number.isFinite(markNum) && marks.find((m) => (m.kind === 'chapter' || m.kind === 'caption') && Math.abs(m.t - markNum) < 0.08)) ||
    null;
  let c = curClip();
  const owns = (x: Clip) =>
    mark ? cardMarkInClip(mark, x) : Number.isFinite(markNum) && markNum >= x.recFrom - 0.05 && markNum < x.recTo;
  const owner = ed.seq.find((x) => x.kind === 'live' && owns(x));
  if (owner) c = owner;
  if (c?.kind === 'live' && (mark || Number.isFinite(markNum))) {
    if (ed.playing) pause();
    const live = c;
    const prev = ed.seq[ed.seq.indexOf(live) - 1];
    // Past the plate's half of a plate→live join — landing on the card's first frames
    // hands the iframe to the outgoing plate and flashes it before the card returns.
    const edT = mark
      ? cardEditLandingEd(mark, live, { prevKind: prev?.kind || null, overlap: live.overlap || 0, toEd: (rec: number) => recToEd(live, rec) })
      : recToEd(live, markNum + 0.12);
    if (edT != null) seek(edT);
    select({ type: 'clip', id: live.id });
  }
  await ensureLiveCards(cardId || null);
  let id = cardId || null;
  if (!id) id = resolveLiveCard(mark || null)?.id || liveCardAtPlayhead()?.id || null;
  await enterText(null, { cardId: id || null });
  if (!ed.textMode) return;
  // Land on the main title field so chapter/caption edits start typing immediately.
  const first = (P.fields?.() || []).find((f) => f.path === 'title') || (P.fields?.() || [])[0];
  if (first?.path) {
    P.focus?.(first.path);
    syncPlateField(P.selection?.() || { path: first.path });
    paintTextMode();
  }
  showInspectorTab();
  flashHint('Editing card copy — Save, then Produce to bake into the master');
}

/** Click-to-edit from the motion stage: open text mode and land on that field. */
export async function enterTextFor(path: string | null): Promise<void> {
  const c = curClip();
  if (c?.kind === 'live') {
    const card = liveCardAtPlayhead();
    if (card) {
      await enterText(path, { cardId: card.id });
      if (!ed.textMode) return;
      showInspectorTab();
      flashHint(path ? `Editing “${path}”` : 'Editing card copy');
      return;
    }
  }
  if (c?.kind !== 'plate' && !ed.liveCardId) {
    const plate = ed.seq.find((x) => x.kind === 'plate' && plateReady(x.plateId));
    if (plate) {
      select({ type: 'clip', id: plate.id });
      seek(plate.at + Math.min(plate.dur * 0.55, Math.max(0.5, plate.dur - 1.6)));
    }
  }
  await enterText(path);
  if (!ed.textMode) return;
  showInspectorTab();
  flashHint(path ? `Editing “${path}”` : ed.liveCardId ? 'Editing card copy' : 'Editing text');
}

export function exitText(): void {
  if (!ed.textMode) return;
  ed.textGen += 1;
  ed.textMode = false;
  ed.plateField = null;
  const wasLiveCard = ed.liveCardId;
  ed.liveCardId = null;
  if (P.ready()) P.motion();
  paintTextMode();
  // Look/style may have painted CSS while we were editing — rebuild motion honestly.
  if (ed.needsPlateResync) flushPlateResync();
  else if (P.ready() && !wasLiveCard) {
    const c = curClip();
    const ms = c?.kind === 'plate' && c.plateId === P.ready() ? Math.max(0, (ed.t - c.at) * 1000) : 0;
    P.restart?.(ms);
  }
  // Live cards: renderFrame re-composites and seeks the card under the playhead.
  if (wasLiveCard) {
    ed.compositeCardId = null;
    ed.compositeSeekMs = null;
  }
  renderFrame();
  paintClipChip();
  if (ed.sel?.type === 'clip') renderInspector();
}

type AccentInput = FieldDetail | PlateFieldState | string | null | undefined;

export function accentOf(detail: AccentInput): string | null {
  if (detail == null) return null;
  if (typeof detail === 'object' && 'accent' in detail) return detail.accent ?? null;
  if (typeof detail === 'object') return detail as unknown as string;
  return detail;
}

/** The stage Accent button mirrors the selection in the plate: off, on, or mixed. */
export function paintAccentButton(detail: AccentInput): void {
  const accent = accentOf(detail);
  const btn = $('edTextBar')?.querySelector<HTMLButtonElement>('[data-text="accent"]');
  if (!btn) return;
  btn.disabled = accent == null;
  btn.setAttribute('aria-pressed', accent === 'on' ? 'true' : accent === 'mixed' ? 'mixed' : 'false');
  btn.title =
    accent == null
      ? 'Click into a text field, then select the words to accent'
      : accent === 'on'
        ? 'Remove the accent from the selected words'
        : 'Accent the selected words';
}

export function syncPlateField(detail: FieldDetail | null | undefined): void {
  const d = detail && typeof detail === 'object' ? detail : null;
  const prev = ed.plateField?.path || null;
  ed.plateField = d?.path
    ? { path: d.path, kind: d.kind || 'text', source: d.source ?? '', dirty: Boolean(d.dirty), accent: d.accent ?? null }
    : null;
  paintAccentButton(d);
  paintFieldChips();
  const copyHost = curClip()?.kind === 'plate' || Boolean(ed.liveCardId);
  if ((ed.plateField?.path || null) !== prev && ed.sel?.type === 'clip' && copyHost) {
    const ta = document.querySelector('#inspectorRoot [data-field-src]');
    if (document.activeElement !== ta) renderInspector();
    else paintFieldPanelLive();
  } else if (ed.plateField && document.querySelector('#inspectorRoot [data-field-src]')) {
    paintFieldPanelLive();
  }
}

export function paintFieldChips(): void {
  const path = ed.plateField?.path;
  document.querySelectorAll<HTMLElement>('#inspectorRoot [data-field]').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset['field'] === path);
  });
}

export function paintFieldPanelLive(): void {
  const f = ed.plateField;
  const pathEl = document.querySelector('#inspectorRoot [data-field-path]');
  const labelEl = document.querySelector('#inspectorRoot [data-field-label]');
  const kindEl = document.querySelector('#inspectorRoot [data-field-kind]');
  const ta = document.querySelector<HTMLTextAreaElement>('#inspectorRoot [data-field-src]');
  const empty = document.querySelector<HTMLElement>('#inspectorRoot [data-field-empty]');
  const editor = document.querySelector<HTMLElement>('#inspectorRoot [data-field-editor]');
  if (!f) {
    if (empty) empty.hidden = false;
    if (editor) editor.hidden = true;
    return;
  }
  if (empty) empty.hidden = true;
  if (editor) editor.hidden = false;
  if (pathEl) pathEl.textContent = f.path;
  if (labelEl) labelEl.textContent = fieldLabel(f.path);
  if (kindEl) kindEl.textContent = f.kind === 'lines' ? 'Multi-line' : 'Single line';
  if (ta && document.activeElement !== ta) {
    ta.value = f.source ?? '';
    ta.rows = f.kind === 'lines' ? 4 : 2;
  }
}

export function renderPlateFields(): string {
  const fields = P.fields?.() || [];
  const active = ed.plateField;
  const editing = ed.textMode;
  const mod = hotkeyMod();
  const chips = fields.length
    ? `<div class="ins-field-nav" role="tablist" aria-label="Plate fields">${fields
        .map(
          (f) =>
            `<button type="button" role="tab" class="ins-field-tab${active?.path === f.path ? ' on' : ''}${f.dirty ? ' dirty' : ''}" data-field="${escapeHtml(f.path)}" aria-selected="${active?.path === f.path ? 'true' : 'false'}" title="${escapeHtml(f.path)}"><span>${escapeHtml(fieldLabel(f.path))}</span></button>`,
        )
        .join('')}</div>`
    : `<p class="ins-note subtle">This plate has no editable fields yet.</p>`;
  const editor = active
    ? `<div class="ins-field-panel" data-field-editor>
          <header class="ins-field-panel-head">
            <strong data-field-label>${escapeHtml(fieldLabel(active.path))}</strong>
            <em data-field-kind>${active.kind === 'lines' ? 'Multi-line' : 'Single line'}</em>
          </header>
          <code class="sr-only" data-field-path>${escapeHtml(active.path)}</code>
          <textarea class="ins-textarea" data-field-src rows="${active.kind === 'lines' ? 4 : 2}" spellcheck="true" aria-label="${escapeHtml(fieldLabel(active.path))} copy">${escapeHtml(active.source || '')}</textarea>
          <div class="ins-field-tools">
            <button type="button" class="ins-btn" data-act="field-accent" title="Accent selected words (${mod}B)">${ICONS['sparkle']}Accent</button>
            <button type="button" class="ins-btn ghost" data-act="field-focus">${ICONS['target']}Show on stage</button>
          </div>
        </div>`
    : `<div class="ins-field-panel" data-field-editor hidden></div>
         <div class="ins-field-empty" data-field-empty>
           <strong>Edit on the plate</strong>
           <span>Click any word on the stage, or pick a field above.</span>
         </div>`;
  const keys = editing
    ? `<ul class="ins-hotkeys" aria-label="Shortcuts while editing">
          <li><kbd>Tab</kbd><span>Next field</span></li>
          <li><kbd>${mod}B</kbd><span>Accent</span></li>
          <li><kbd>Esc</kbd><span>Done</span></li>
        </ul>`
    : '';
  return section(
    'text',
    'Plate copy',
    `${chips}${editor}${keys}`,
    `<button type="button" class="ins-link${editing ? ' is-on' : ''}" data-act="text" aria-pressed="${editing ? 'true' : 'false'}">${
      editing ? 'Done editing' : 'Edit on stage'
    }</button>`,
  );
}

export const TB_POS_KEY = 'wts.edTextBar.pos';
export const TB_HIDE_KEY = 'wts.edTextBar.coachHidden';
let textBarDrag: { dx: number; dy: number; host: HTMLElement } | null = null;

export function textBarPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(TB_POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { x?: unknown; y?: unknown } | null;
    if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) return { x: p?.x as number, y: p?.y as number };
  } catch {
    /* ignore */
  }
  return null;
}

export function saveTextBarPos(x: number, y: number): void {
  try {
    localStorage.setItem(TB_POS_KEY, JSON.stringify({ x: Math.round(x), y: Math.round(y) }));
  } catch {
    /* ignore */
  }
}

export function coachHidden(): boolean {
  try {
    return sessionStorage.getItem(TB_HIDE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setCoachHidden(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(TB_HIDE_KEY, '1');
    else sessionStorage.removeItem(TB_HIDE_KEY);
  } catch {
    /* ignore */
  }
}

/** Tip lives in #playerPlate (overflow clipped) — not inside .fhd-fit. */
export function textBarHost(bar: HTMLElement | null = $('edTextBar')): HTMLElement | null {
  return bar?.parentElement || null;
}

/** Keep a dragged tip inside the stage when the window / panels / timeline resize. */
export function clampTextBarIntoHost(bar: HTMLElement | null = $('edTextBar'), { persist = true }: { persist?: boolean } = {}): void {
  if (!bar || bar.hidden || textBarDrag || !bar.classList.contains('is-placed')) return;
  const host = textBarHost(bar);
  if (!host || host.clientWidth < 40 || host.clientHeight < 40) return;
  const w = bar.offsetWidth || 240;
  const h = bar.offsetHeight || 36;
  const saved = textBarPos();
  let x: number | undefined = parseFloat(bar.style.getPropertyValue('--ed-tb-x'));
  let y: number | undefined = parseFloat(bar.style.getPropertyValue('--ed-tb-y'));
  if (!Number.isFinite(x)) x = saved?.x;
  if (!Number.isFinite(y)) y = saved?.y;
  if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const nextX = clamp(x, 8, Math.max(8, host.clientWidth - w - 8));
  const nextY = clamp(y, 8, Math.max(8, host.clientHeight - h - 8));
  if (nextX === x && nextY === y) return;
  bar.style.setProperty('--ed-tb-x', `${nextX}px`);
  bar.style.setProperty('--ed-tb-y', `${nextY}px`);
  if (persist) saveTextBarPos(nextX, nextY);
}

export function applyTextBarPlacement(bar: HTMLElement | null, { preferTop = false }: { preferTop?: boolean } = {}): void {
  if (!bar) return;
  const placed = textBarPos();
  bar.classList.toggle('is-placed', Boolean(placed));
  bar.classList.toggle('is-dock-top', !placed && preferTop);
  if (placed) {
    bar.style.setProperty('--ed-tb-x', `${placed.x}px`);
    bar.style.setProperty('--ed-tb-y', `${placed.y}px`);
    requestAnimationFrame(() => clampTextBarIntoHost(bar));
  } else {
    bar.style.removeProperty('--ed-tb-x');
    bar.style.removeProperty('--ed-tb-y');
  }
}

/** Drag / double-click-reset for the stage tip. Unbinds through `signal` (the legacy wired once). */
export function wireTextBarChrome(signal: AbortSignal): void {
  const bar = $('edTextBar');
  if (!bar || bar.dataset['tbWired']) return;
  bar.dataset['tbWired'] = '1';
  signal.addEventListener('abort', () => {
    delete bar.dataset['tbWired'];
    textBarDrag = null;
  });
  const hostEl = () => textBarHost(bar);
  bar.addEventListener(
    'pointerdown',
    (e) => {
      const target = e.target as HTMLElement;
      const grip = target.closest('[data-tb-grip]');
      // Allow dragging from the grip, or from empty tip chrome (not buttons/fields).
      const fromChrome =
        grip ||
        target === bar ||
        target.classList?.contains('ed-tb-badge') ||
        target.classList?.contains('ed-tb-msg') ||
        target.classList?.contains('ed-tb-field');
      if (!fromChrome || target.closest('button:not([data-tb-grip])')) return;
      e.preventDefault();
      const host = hostEl();
      const hr = host?.getBoundingClientRect();
      const br = bar.getBoundingClientRect();
      if (!host || !hr) return;
      textBarDrag = {
        dx: e.clientX - br.left,
        dy: e.clientY - br.top,
        host,
      };
      bar.classList.add('is-dragging', 'is-placed');
      bar.classList.remove('is-dock-top');
      try {
        bar.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    { signal },
  );
  bar.addEventListener(
    'pointermove',
    (e) => {
      if (!textBarDrag) return;
      const hr = textBarDrag.host.getBoundingClientRect();
      const w = bar.offsetWidth;
      const h = bar.offsetHeight;
      const x = clamp(e.clientX - hr.left - textBarDrag.dx, 8, Math.max(8, hr.width - w - 8));
      const y = clamp(e.clientY - hr.top - textBarDrag.dy, 8, Math.max(8, hr.height - h - 8));
      bar.style.setProperty('--ed-tb-x', `${x}px`);
      bar.style.setProperty('--ed-tb-y', `${y}px`);
    },
    { signal },
  );
  const endDrag = (e: PointerEvent) => {
    if (!textBarDrag) return;
    const x = parseFloat(bar.style.getPropertyValue('--ed-tb-x'));
    const y = parseFloat(bar.style.getPropertyValue('--ed-tb-y'));
    if (Number.isFinite(x) && Number.isFinite(y)) saveTextBarPos(x, y);
    bar.classList.remove('is-dragging');
    textBarDrag = null;
    clampTextBarIntoHost(bar);
    try {
      bar.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  bar.addEventListener('pointerup', endDrag, { signal });
  bar.addEventListener('pointercancel', endDrag, { signal });
  bar.addEventListener(
    'dblclick',
    (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-tb-grip]') && target !== bar) return;
      try {
        localStorage.removeItem(TB_POS_KEY);
      } catch {
        /* ignore */
      }
      bar.classList.remove('is-placed');
      bar.style.removeProperty('--ed-tb-x');
      bar.style.removeProperty('--ed-tb-y');
      paintTextMode();
    },
    { signal },
  );
  const host = hostEl();
  if (host && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => clampTextBarIntoHost(bar));
    ro.observe(host);
    signal.addEventListener('abort', () => ro.disconnect());
  }
  window.addEventListener('resize', () => clampTextBarIntoHost(bar), { signal });
}

export function cardKindAtPlayhead(): 'chapter' | 'caption' | null {
  const hit = liveHitAtPlayhead();
  if (hit?.mark?.kind === 'chapter' || hit?.mark?.kind === 'caption') return hit.mark.kind;
  if (ed.sel?.type === 'card') {
    const mark = (ed.deck?.marks || []).find((m) => (m.key || cardMarkKey(m)) === ed.sel?.key);
    if (mark?.kind === 'chapter' || mark?.kind === 'caption') return mark.kind;
  }
  const id = ed.liveCardId || '';
  if (id.includes(':caption:')) return 'caption';
  if (id.includes(':chapter:')) return 'chapter';
  return null;
}

/** Every surface that says "editing text" reads ed.textMode from here. */
export function paintTextMode(): void {
  const editing = ed.textMode;
  const bar = $('edTextBar');
  if (bar) {
    const dirty = P.dirty();
    const c = curClip();
    const plateClip = c?.kind === 'plate' && !ed.missing.has(c?.plateId || '');
    const liveCard = c?.kind === 'live' ? liveCardAtPlayhead() : null;
    const cardSel = ed.sel?.type === 'card';
    const onCard = Boolean(ed.liveCardId || liveCard || cardSel);
    const cardKind = cardKindAtPlayhead();
    const hideCoach = coachHidden();
    const coach = !editing && !dirty && !ed.playing && !hideCoach && (plateClip || Boolean(liveCard) || cardSel);
    bar.hidden = !(editing || dirty || coach);
    bar.classList.toggle('is-dirty', dirty);
    bar.classList.toggle('is-editing', editing);
    bar.classList.toggle('is-coach', coach && !editing && !dirty);
    applyTextBarPlacement(bar, { preferTop: onCard && cardKind === 'caption' });
    const mod = hotkeyMod();
    const fieldName = ed.plateField?.path ? fieldLabel(ed.plateField.path) : '';
    const kindLabel = cardKind === 'chapter' ? 'chapter' : cardKind === 'caption' ? 'caption' : 'card';
    const badge = dirty ? 'Unsaved' : editing ? 'Editing' : 'Tip';
    const msg = dirty
      ? onCard
        ? 'Unsaved card copy — Save, then Produce to bake'
        : 'Plays with your changes'
      : editing
        ? fieldName
          ? ''
          : onCard
            ? `Click a field on the ${kindLabel}`
            : 'Click a field on the plate'
        : onCard
          ? `Edit the ${kindLabel} copy · drag this tip if it covers text`
          : 'Click text on the plate to edit';
    const grip = `<button type="button" class="ed-tb-grip sp-icon-btn is-grip" data-tb-grip title="Drag to move" aria-label="Drag tip">${icon('grip')}</button><span class="sp-ico" aria-hidden="true">${ICONS['text']}</span>`;
    const close =
      coach && !editing && !dirty
        ? `<button type="button" class="ed-tb-close sp-icon-btn" data-text="dismiss" title="Hide tip" aria-label="Hide tip">${ICONS['x']}</button>`
        : '';
    const editBtn =
      !editing && !dirty && onCard
        ? `<button type="button" class="ed-pill-btn primary" data-text="edit-card" title="Edit ${kindLabel} copy on stage">${ICONS['plate']}<span>Edit copy</span></button>`
        : '';
    const html = `${grip}<span class="ed-tb-badge">${badge}</span>${
      editing && fieldName ? `<span class="ed-tb-field">${escapeHtml(fieldName)}</span>` : ''
    }${msg ? `<span class="ed-tb-msg">${msg}</span>` : '<span class="ed-tb-spacer"></span>'}${
      editing
        ? `<span class="ed-tb-keys" aria-hidden="true"><i title="Next field"><kbd>Tab</kbd></i><i title="Accent selection"><kbd>${mod}B</kbd></i><i title="Done"><kbd>Esc</kbd></i></span>
             <button type="button" class="ed-pill-btn ed-accent-btn" data-text="accent" aria-pressed="false" disabled title="Accent the selected words (${mod}B)">${ICONS['sparkle']}<span>Accent</span></button>`
        : ''
    }${editBtn}${
      dirty
        ? `<span class="sp-sep" aria-hidden="true"></span><button type="button" class="ed-pill-btn" data-text="discard" title="Throw away unsaved copy">${ICONS['undo']}<span>Discard</span></button><button type="button" class="ed-pill-btn primary" data-text="save" title="Save the copy">${ICONS['check']}<span>Save</span></button>`
        : ''
    }${editing ? `<button type="button" class="ed-pill-btn primary" data-text="done" title="Done (Esc)">${ICONS['check']}<span>Done</span></button>` : ''}${close}`;
    // Avoid rewriting the tip on every paint (resize/scrub) — that flickers like a hide.
    if (bar.dataset['tbHtml'] !== html) {
      bar.dataset['tbHtml'] = html;
      bar.innerHTML = html;
    }
    paintAccentButton(ed.plateField || P.selection?.() || P.accentState?.() || null);
    if (!bar.hidden) requestAnimationFrame(() => clampTextBarIntoHost(bar));
  }
  const transport = $('edEditText');
  if (transport) {
    transport.classList.toggle('is-on', editing);
    transport.setAttribute('aria-pressed', editing ? 'true' : 'false');
    transport.title = editing
      ? 'Done editing (Esc)'
      : ed.liveCardId || liveCardAtPlayhead()
        ? 'Edit chapter/caption copy'
        : 'Edit the words on this plate';
    const label = transport.querySelector('span');
    if (label) label.textContent = editing ? 'Done' : 'Edit text';
  }
  const inspector = document.querySelector('#inspectorRoot [data-act="text"]');
  if (inspector) {
    inspector.classList.toggle('is-on', editing);
    inspector.classList.toggle('on', editing);
    inspector.setAttribute('aria-pressed', editing ? 'true' : 'false');
    inspector.textContent = editing ? 'Done editing' : 'Edit on stage';
  }
  document.body.classList.toggle('is-editing-text', editing);
}
