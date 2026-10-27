import { desk } from '@/desk/store';
import { toast } from '@/desk/toast';
import { cardEditLandingEd, cardMarkInClip, cardMarkKey } from '@/logic/liveCardStage';
import { plateClockMs } from '@/logic/plateTiming';
import { neonFxHtml } from '@/ui/neonFx';

import { select, showInspectorTab } from './edits';
import { renderInspector, section } from './inspector';
import { refreshPlatePreview } from './look';
import { P } from './plateCtl';
import { flushEditorContentPending } from './plateContentPane';
import { contentFieldFocused, editOrigin, paintInspectorUnlessContentTyping } from './plateContentSave';
import { plateEditPeakSec } from './plateCss';
import { curClip, recToEd } from './seq';
import { ensureLiveCards, liveCardAtPlayhead, liveHitAtPlayhead, paintClipChip, plateReady, renderFrame, requestPlate, resolveLiveCard } from './stage';
import { ed, htmlPlates, timers, type PlateFieldState } from './state';
import { COLLAPSE_ICON, PANEL_MOVE_HELP, layoutPanels, panelHelpHtml, schedulePanelLayout, setTextPrefersTop, showPanel, type HelpRow } from './stagePanels';
import { flashHint } from './timeline';
import { pause, seek } from './transport';
import type { Clip, FieldDetail } from './types';
import { copyClipCallout, copyClipFieldNote, parseCopyClips, type CopyClip } from './copyFit';
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

export async function enterText(
  focusPath: string | null = null,
  { cardId = null, seekToPeak = false }: { cardId?: string | null; seekToPeak?: boolean } = {},
): Promise<void> {
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
  await flushEditorContentPending();
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
  // Clicking a field in place edits exactly what's on screen — the timeline never moves.
  // Only a generic "Edit text" entry (no specific field already in view) jumps to the plate's
  // best-populated frame first, so copy that's still mid-reveal (or not yet entered) isn't
  // what greets the editor.
  if (seekToPeak && c?.kind === 'plate' && c.plateId === plateId) {
    const peakDoc = $<HTMLIFrameElement>('plateFrame')?.contentDocument;
    if (peakDoc?.body) {
      const peakSec = plateEditPeakSec(peakDoc);
      const target = c.at + clamp(peakSec, 0.3, Math.max(0.5, c.dur - 0.2));
      if (Math.abs(target - ed.t) > 0.05) seek(target);
    }
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
  if (ed.sel?.type === 'clip' || ed.sel?.type === 'card') paintInspectorUnlessContentTyping(renderInspector);
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

/**
 * Click-to-edit from the motion stage: open text mode and land on that field.
 * `seekToPeak` defaults off — a click on a specific field edits exactly what's on screen, in
 * place, without moving the timeline. Pass it only for entries that aren't targeting something
 * already visible (e.g. a generic "Edit text" action), where jumping to the plate's
 * best-populated frame first is more useful than leaving the playhead wherever it was.
 */
export async function enterTextFor(path: string | null, { seekToPeak = false }: { seekToPeak?: boolean } = {}): Promise<void> {
  const c = curClip();
  if (c?.kind === 'live') {
    const card = liveCardAtPlayhead();
    if (card) {
      await enterText(path, { cardId: card.id, seekToPeak });
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
  await enterText(path, { seekToPeak });
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
    const ms = c?.kind === 'plate' && c.plateId === P.ready() ? plateClockMs(c, ed.t) : 0;
    P.restart?.(ms);
  }
  // Live cards: renderFrame re-composites and seeks the card under the playhead.
  if (wasLiveCard) {
    ed.compositeCardId = null;
    ed.compositeSeekMs = null;
  }
  renderFrame();
  paintClipChip();
  if (ed.sel?.type === 'clip') paintInspectorUnlessContentTyping(renderInspector);
}

type AccentInput = FieldDetail | PlateFieldState | string | null | undefined;

function accentOf(detail: AccentInput): string | null {
  if (detail == null) return null;
  if (typeof detail === 'object' && 'accent' in detail) return detail.accent ?? null;
  if (typeof detail === 'object') return detail as unknown as string;
  return detail;
}

/** The stage Accent button mirrors the selection in the plate: off, on, or mixed. */
function paintAccentButton(detail: AccentInput): void {
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
  const ta = document.querySelector<HTMLTextAreaElement>('#inspectorRoot [data-field-src]');
  const copyTyping = ta && document.activeElement === ta && d?.path === (ed.plateField?.path || prev);
  if (d?.path) {
    ed.plateField = {
      path: d.path,
      kind: d.kind || 'text',
      source: copyTyping ? ta.value : (d.source ?? ''),
      dirty: Boolean(d.dirty),
      accent: d.accent ?? null,
    };
  } else {
    ed.plateField = null;
  }
  paintAccentButton(d);
  paintFieldChips();
  // Inspector typing paints the stage; echoes must not remount or overwrite the caret line.
  if (editOrigin() === 'pane' || contentFieldFocused()) {
    if (ed.plateField && document.querySelector('#inspectorRoot [data-field-src]')) paintFieldPanelLive();
    return;
  }
  const copyHost = curClip()?.kind === 'plate' || Boolean(ed.liveCardId);
  if ((ed.plateField?.path || null) !== prev && ed.sel?.type === 'clip' && copyHost) {
    if (document.activeElement !== ta) paintInspectorUnlessContentTyping(renderInspector);
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

function paintFieldPanelLive(): void {
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
    paintCopyLong(null);
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
  paintCopyLong(f.path);
}

/** The line under the textarea follows whichever field is open. */
function paintCopyLong(path: string | null): void {
  const note = document.querySelector<HTMLElement>('#inspectorRoot [data-copy-long]');
  const paths = (note?.dataset['paths'] || '').split('|').filter(Boolean);
  const hit = Boolean(path && paths.includes(path));
  if (note) note.hidden = !hit;
  document.querySelector('#inspectorRoot [data-field-editor]')?.classList.toggle('is-long', hit);
  document.querySelectorAll<HTMLElement>('#inspectorRoot .copy-long-row[data-field]').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset['field'] === path);
  });
}

/** Copy the last render measured as clipping, for the plate this panel is about. */
function copyClipsFor(plateId: string | null | undefined): CopyClip[] {
  if (!plateId) return [];
  const row = htmlPlates().find((p) => p.id === plateId);
  return parseCopyClips(row?.encode?.notes);
}

export function renderPlateFields(plateId?: string | null): string {
  const fields = P.fields?.() || [];
  const active = ed.plateField;
  const editing = ed.textMode;
  const mod = hotkeyMod();
  const id = plateId || ed.liveCardId || (curClip()?.kind === 'plate' ? curClip()?.plateId : null);
  const clips = copyClipsFor(id);
  const long = new Set(clips.map((c) => c.path));
  const callout = copyClipCallout(clips, new Set(fields.map((f) => f.path)), active?.path || null);
  const chips = fields.length
    ? `<div class="ins-field-nav" role="tablist" aria-label="Plate fields">${fields
        .map((f) => {
          const clip = long.has(f.path);
          return `<button type="button" role="tab" class="ins-field-tab${active?.path === f.path ? ' on' : ''}${f.dirty ? ' dirty' : ''}${clip ? ' is-long' : ''}" data-field="${escapeHtml(f.path)}" aria-selected="${active?.path === f.path ? 'true' : 'false'}" title="${escapeHtml(f.path)}${clip ? ' · clips at the smallest size' : ''}"><span>${escapeHtml(fieldLabel(f.path))}</span></button>`;
        })
        .join('')}</div>`
    : `<p class="ins-note subtle">This plate has no editable fields yet.</p>`;
  const editor = active
    ? `<div class="ins-field-panel${long.has(active.path) ? ' is-long' : ''}" data-field-editor>
          <header class="ins-field-panel-head">
            <strong data-field-label>${escapeHtml(fieldLabel(active.path))}</strong>
            <em data-field-kind>${active.kind === 'lines' ? 'Multi-line' : 'Single line'}</em>
          </header>
          <code class="sr-only" data-field-path>${escapeHtml(active.path)}</code>
          <textarea class="ins-textarea" data-field-src rows="${active.kind === 'lines' ? 4 : 2}" spellcheck="true" aria-label="${escapeHtml(fieldLabel(active.path))} copy">${escapeHtml(active.source || '')}</textarea>
          ${copyClipFieldNote(clips, active.path)}
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
    `${callout}${chips}${editor}${keys}`,
    `<button type="button" class="ins-link${editing ? ' is-on' : ''}" data-act="text" aria-pressed="${editing ? 'true' : 'false'}">${
      editing ? 'Done editing' : 'Edit on stage'
    }</button>`,
  );
}

const TB_HIDE_KEY = 'wts.edTextBar.coachHidden';

function coachHidden(): boolean {
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

function cardKindAtPlayhead(): 'chapter' | 'caption' | null {
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
    // A zoom or magnifier on stage owns the frame; the copy tip would sit on top of its editor.
    const aiming = ed.sel?.type === 'zoom' || ed.sel?.type === 'lens';
    const coach = !editing && !dirty && !ed.playing && !hideCoach && !aiming && (plateClip || Boolean(liveCard) || cardSel);
    const show = editing || dirty || coach;
    bar.classList.toggle('is-dirty', dirty);
    bar.classList.toggle('is-editing', editing);
    bar.classList.toggle('is-coach', coach && !editing && !dirty);
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
    const grip = `<button type="button" class="sp-icon-btn is-grip" data-sp-grip title="Drag to move · edges dock · double-click to put it back" aria-label="Move text tools (arrow keys nudge, Home or End docks)">${icon('grip')}</button><span class="sp-ico" aria-hidden="true">${ICONS['text']}</span>`;
    const collapseBtn = `<button type="button" class="sp-icon-btn sp-collapse" data-sp-collapse aria-expanded="true" title="Collapse to a pill" aria-label="Collapse text tools to a pill">${COLLAPSE_ICON}</button>`;
    const state = dirty ? 'dirty' : editing ? 'editing' : 'tip';
    const stateLabel = dirty ? 'unsaved changes' : editing ? 'editing' : 'tip';
    const pillLabel = dirty ? 'Unsaved' : editing ? 'Editing' : 'Text';
    const pillAct = dirty
      ? `<button type="button" class="sp-pill-act is-save" data-text="save" title="Save the copy" aria-label="Save the copy">${ICONS['check']}</button>`
      : editing
        ? `<button type="button" class="sp-pill-act" data-text="done" title="Done (Esc)" aria-label="Done editing">${ICONS['check']}</button>`
        : '';
    const mini = `<div class="sp-mini"><button type="button" class="sp-pill" data-sp-expand aria-expanded="false" title="Expand text tools · drag to move" aria-label="Expand text tools (${stateLabel})"><span class="sp-ico" aria-hidden="true">${ICONS['text']}<i class="sp-pill-dot" data-state="${state}" aria-hidden="true"></i></span><span class="sp-pill-label">${pillLabel}</span></button>${pillAct}</div>`;
    const close =
      coach && !editing && !dirty
        ? `<button type="button" class="ed-tb-close sp-icon-btn" data-text="dismiss" title="Hide tip" aria-label="Hide tip">${ICONS['x']}</button>`
        : '';
    const editBtn =
      !editing && !dirty && onCard
        ? `<button type="button" class="ed-pill-btn primary" data-text="edit-card" title="Edit ${kindLabel} copy on stage">${neonFxHtml()}${ICONS['plate']}<span>Edit copy</span></button>`
        : '';
    const keys: HelpRow[] = editing
      ? [
          { keys: ['Tab'], label: 'next field' },
          { keys: ['⇧', 'Tab'], label: 'previous field' },
          { keys: [`${mod}B`], label: 'accent the selection' },
          { keys: ['Esc'], label: 'done' },
        ]
      : [{ keys: ['Click'], label: onCard ? `a word on the ${kindLabel} to edit it` : 'a word on the slide to edit it' }];
    const help = `<span class="sp-help">${panelHelpHtml('Text', [...keys, ...PANEL_MOVE_HELP])}</span>`;
    const html = `<div class="sp-full">${grip}<span class="ed-tb-badge">${badge}</span>${
      editing && fieldName ? `<span class="ed-tb-field">${escapeHtml(fieldName)}</span>` : ''
    }${msg ? `<span class="ed-tb-msg">${msg}</span>` : '<span class="ed-tb-spacer"></span>'}${
      editing
        ? `<button type="button" class="ed-pill-btn ed-accent-btn" data-text="accent" aria-pressed="false" disabled title="Accent the selected words (${mod}B)">${ICONS['sparkle']}<span>Accent</span></button>`
        : ''
    }${editBtn}${
      dirty
        ? `<span class="sp-sep" aria-hidden="true"></span><button type="button" class="ed-pill-btn" data-text="discard" title="Throw away unsaved copy">${ICONS['undo']}<span>Discard</span></button><button type="button" class="ed-pill-btn primary" data-text="save" title="Save the copy">${neonFxHtml()}${ICONS['check']}<span>Save</span></button>`
        : ''
    }${editing ? `<button type="button" class="ed-pill-btn primary" data-text="done" title="Done (Esc)">${neonFxHtml()}${ICONS['check']}<span>Done</span></button>` : ''}<span class="sp-sep" aria-hidden="true"></span>${help}${collapseBtn}${close}</div>${mini}`;
    // Avoid rewriting the tip on every paint (resize/scrub) — that flickers like a hide.
    // A leaving bar keeps its last copy so the exit doesn't flash the next state.
    if (show && bar.dataset['tbHtml'] !== html) {
      bar.dataset['tbHtml'] = html;
      bar.innerHTML = html;
    }
    const topChanged = setTextPrefersTop(onCard && cardKind === 'caption');
    const entering = showPanel('text', show);
    paintAccentButton(ed.plateField || P.selection?.() || P.accentState?.() || null);
    if (show && !entering) {
      if (topChanged) layoutPanels();
      else schedulePanelLayout();
    }
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
