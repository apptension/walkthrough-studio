import type { Scene } from '@/api/types';
import type { EditorSelection } from '@/desk/bridge';
import { seekTo, setMonitorMode } from '@/desk/monitor';
import { showRightTab } from '@/desk/panels';
import { desk } from '@/desk/store';
import { planAfterSeeked } from '@/logic/livePreview';
import { canReloadPlateFrame, playheadOnPlate, plateClipFor, shouldBlacklistPlateLoad } from '@/logic/plateSync';
import { paintRange } from '@/ui/rangeFill';

import { stageAimKey, wireLensBox, wireZoomBox } from './aim';
import { previewState } from './audio';
import { requestAudio, requestMake } from './ctx';
import { postDeck, redo, refresh, resetForProject, undo, validateSelection } from './data';
import { duplicateSelected } from './duplicate';
import { addCut, addLensAt, addRamp, addZoomAt, paintStatus, removeSelected, select, showInspectorTab, toolCaption, toolCut, toolLens, toolSpeed, toolVoice, toolZoom } from './edits';
import { renderInspector } from './inspector';
import {
  contentSaveIdle,
  flushAllContentPending,
  hoverContentSlot,
  kickContentPending,
  moveContentSlot,
  openContentSlot,
  resetPlateContentPane,
  settlePlateContent,
  syncContentToField,
} from './plateContentPane';
import { beginEditOrigin, contentFieldFocused, endEditOrigin, flushQueuedInspectorRepaint, paintInspectorUnlessContentTyping } from './plateContentSave';
import { frameAtmosphereOnStage, invalidatePlates, paintLookVars, tuneAtmosphereLive } from './look';
import { updatePlateEditChrome } from './plate';
import { P } from './plateCtl';
import { closePacePop, onPaceModeChange, pacePopOpen } from './platePace';
import { closePlateLibrary, openAddLibrary, plateLibOpen } from './plateLibrary';
import { toCut, toProgram, undressOverview, wireOverview } from './overview';
import { curClip } from './seq';
import { ensureLiveCards, liveHitAtPlayhead, paintFrame, paintLoading, renderFrame, syncLiveSource } from './stage';
import { deckEdit, ed, preview, video } from './state';
import {
  clearPlatePreviewTimers,
  enterLiveCard,
  enterText,
  enterTextFor,
  exitText,
  markPlateResync,
  paintTextMode,
  setCoachHidden,
  syncPlateField,
} from './text';
import { wireStagePanels } from './stagePanels';
import { flashHint, invalidateTimeline, renderTimeline } from './timeline';
import { captureMorph, playMorph } from './timelineMorph';
import { wireTimeline } from './timelineWire';
import { paintHead, paintTransport, pause, replayClip, seek, toggle } from './transport';
import type { Clip, FieldDetail } from './types';
import { $, clamp } from './util';

/** Entry points, plate reloads and wiring from the tail of `kit/studio/editor.js`. */

// ─── Plate reloads (server rebuilt the HTML) ─────────────────────────────────────────────
export async function reloadPlate(id: string, { paint = true }: { paint?: boolean } = {}): Promise<void> {
  ed.missing.delete(id);
  const c = curClip();
  const clip = plateClipFor(ed.seq, id, c);
  const onPlate = playheadOnPlate(c, id);
  const ms = onPlate && clip ? Math.max(0, Math.round((ed.t - clip.at) * 1000)) : 0;
  if (contentFieldFocused()) {
    ed.stalePlates.add(id);
    markPlateResync(id);
    return;
  }
  if (
    !canReloadPlateFrame({
      dirty: P.dirty(),
      activePlateId: desk.get().activePlateId,
      plateId: id,
      playheadPlateId: c?.plateId || null,
    })
  ) {
    // Unsaved copy on stage, or the iframe is showing something else: pick up on the next visit.
    ed.stalePlates.add(id);
    markPlateResync(id);
    return;
  }
  if (ed.loadingPlate === id) {
    markPlateResync(id);
    return;
  }
  ed.stalePlates.delete(id);
  ed.loadingPlate = id;
  paintLoading();
  clearPlatePreviewTimers();
  // force: true — the ready-cache must not keep a frame built before this look/palette change.
  // motionAt parks the hidden frame on the playhead before the swap, so the stage never shows the open.
  const ok = await P.load(id, { force: true, motionAt: ed.textMode ? undefined : ms });
  ed.loadingPlate = null;
  paintLoading();
  if (shouldBlacklistPlateLoad(ok, { activePlateId: desk.get().activePlateId, requestedId: id })) {
    ed.missing.add(id);
    return;
  }
  if (ok !== true) return;
  if (ed.textMode) {
    // Load arms studio-edit; stay in text mode and resync motion when Done lands.
    markPlateResync(id);
    paintTextMode();
  } else {
    // The back buffer already stepped into motion before the swap. Restarting here would blank
    // the animations for a frame — the flash. The single-frame fallback still needs it.
    const parked = frameElMotion();
    if (!parked) {
      P.motion();
      P.restart(ms);
    }
    if (ed.needsPlateResync === id) ed.needsPlateResync = null;
  }
  if (playheadOnPlate(curClip(), id)) renderFrame();
  if (paint && ed.sel?.type === 'clip' && ed.seq.find((x) => x.id === ed.sel?.id)?.plateId === id) {
    paintInspectorUnlessContentTyping(renderInspector);
  }
}

function frameElMotion(): boolean {
  try {
    const frame = document.getElementById('plateFrame') as HTMLIFrameElement | null;
    return frame?.contentDocument?.body?.dataset['motion'] === '1';
  } catch {
    return false;
  }
}

// ─── Entry points ────────────────────────────────────────────────────────────────────────
export async function onEnter({ programT }: { programT?: number | null } = {}): Promise<void> {
  ed.active = true;
  document.body.classList.add('is-editor');
  undressOverview();
  const focus = ed.focus;
  ed.focus = null;
  const land = () => {
    if (focus) {
      ed.t = clamp(focus.t, 0, ed.total);
      if (focus.sel) ed.sel = focus.sel;
    } else if (programT != null && ed.seq.length) {
      ed.t = toCut(programT);
    }
    validateSelection();
    if (!ed.sel) {
      const c = curClip();
      if (c) ed.sel = { type: 'clip', id: c.id };
    }
    syncLiveSource();
    paintFrame();
    renderTimeline();
    renderFrame();
    paintInspectorUnlessContentTyping(renderInspector);
    paintStatus();
    paintTransport();
    paintTextMode();
    showInspectorTab();
    playMorph();
  };
  // The overview already drew this cut: unfold it now, and let the re-fetch catch up behind.
  const drawn = Boolean(ed.deck && ed.deck.slug === desk.get().slug && ed.seq.length);
  if (drawn) land();
  // Always re-fetch: desk, takes and voice meta can change on disk or via API while Program is open.
  await refresh();
  if (!ed.active) return;
  // Warm live-card HTML so chapter/caption clicks don't race a first rebuild.
  await ensureLiveCards();
  if (!ed.active) return;
  if (!drawn) land();
  void preview.load(previewState());
  requestAnimationFrame(() => {
    renderTimeline();
    P.fit();
  });
}

export function onLeave(): void {
  if (!ed.active) return;
  const leavingPlate = curClip()?.kind === 'plate' ? curClip()?.plateId : null;
  kickContentPending();
  void settlePlateContent(leavingPlate);
  // Program picks up where the Editor was looking.
  const programT = ed.seq.length ? toProgram(ed.t) : null;
  captureMorph();
  pause();
  preview.pause();
  closePlateLibrary({ instant: true });
  clearPlatePreviewTimers();
  ed.textGen += 1;
  if (ed.textMode) exitText();
  ed.needsPlateResync = null;
  ed.active = false;
  document.body.classList.remove('is-editor');
  if (desk.get().rightTab === 'inspector') showRightTab('feedback');
  if (programT != null && desk.get().monitorMode === 'program' && !desk.get().previewingPlate) seekTo(programT);
  renderTimeline();
  playMorph();
}

export async function openClip(match: (c: Clip) => boolean): Promise<boolean> {
  if (!ed.deck) await refresh();
  const c = ed.seq.find(match);
  if (!c) return false;
  if (desk.get().monitorMode !== 'plate') setMonitorMode('plate');
  else if (!ed.active) await onEnter();
  ed.t = c.kind === 'plate' ? c.at + Math.min(c.dur * 0.55, Math.max(0.5, c.dur - 1.6)) : c.at + c.overlap + 0.05;
  select({ type: 'clip', id: c.id });
  renderFrame();
  paintHead();
  const scroll = $('etlScroll');
  if (scroll) scroll.scrollLeft = Math.max(0, c.at * ed.pps - 40);
  return true;
}

export const openPlate = (plateId: string): Promise<boolean> => openClip((c) => c.plateId === plateId);

/** `openClip(id) || openClip(live)` — the first call's promise is always truthy, as in the legacy. */
export const selectLive = (scene: Pick<Scene, 'id'> | null | undefined): Promise<boolean> => openClip((c) => c.id === scene?.id);

export function setScale(v: number): void {
  ed.zoomScale = clamp(v, 1, 24);
  const input = $<HTMLInputElement>('etlScale');
  if (input) {
    input.value = String(Math.log2(ed.zoomScale));
    paintRange(input);
  }
  renderTimeline();
}

// ─── Wiring ──────────────────────────────────────────────────────────────────────────────
// The legacy `wire()` bound everything once at init; each region binds its part on mount.

const on = (id: string, ev: string, fn: (e: Event) => void, signal: AbortSignal) => $(id)?.addEventListener(ev, fn, { signal });

/** `#livePlayer`, the stage aim boxes, the text tip and the plate iframe's events (`#playerPlate`). */
export function wireStage(signal: AbortSignal): void {
  const v = video();
  if (v) {
    v.muted = true;
    v.addEventListener(
      'seeked',
      () => {
        if (!ed.active) return;
        const next = planAfterSeeked({
          currentTime: v.currentTime || 0,
          wantRec: ed.wantRec ?? undefined,
          playing: ed.playing,
        });
        if (next.action === 'seek') {
          try {
            if (typeof v.fastSeek === 'function') v.fastSeek(next.wantRec);
            else v.currentTime = next.wantRec;
          } catch {
            /* ignore */
          }
          return;
        }
        if (next.action === 'paint') renderFrame();
      },
      { signal },
    );
    v.addEventListener('loadeddata', () => ed.active && renderFrame(), { signal });
  }
  // The Accent button must not steal focus from the plate, or the selection it acts on is gone.
  on(
    'edTextBar',
    'mousedown',
    (e) => {
      if ((e.target as Element).closest('[data-text="accent"]')) e.preventDefault();
    },
    signal,
  );
  wireStagePanels(signal);
  window.addEventListener(
    'plate-selection',
    (e) => {
      const detail = (e as CustomEvent<FieldDetail>).detail;
      // Stage → pane. beginEditOrigin('stage') so sync patches Content inputs instead of remounting
      // when the same record is already open (and pane→stage echoes are ignored via origin 'pane').
      beginEditOrigin('stage');
      try {
        syncPlateField(detail);
        const c = curClip();
        if (c?.kind === 'plate' && c.plateId) {
          syncContentToField(c.plateId, detail?.path || null, detail?.source ?? null);
        }
      } finally {
        endEditOrigin();
      }
    },
    { signal },
  );
  // A logo, avatar, screenshot or whole tile on the stage: open its record in the Inspector.
  window.addEventListener(
    'plate-canvas-slot',
    (e) => {
      const slot = (e as CustomEvent<{ slot?: string } | null>).detail?.slot;
      const c = curClip();
      if (!slot || c?.kind !== 'plate' || !c.plateId) return;
      showInspectorTab();
      if (ed.insTab !== 'design') {
        ed.insTab = 'design';
        paintInspectorUnlessContentTyping(renderInspector);
      }
      openContentSlot(c.plateId, slot);
    },
    { signal },
  );
  // A pin dragged across the shot: its percentages land in the plate's config.
  window.addEventListener(
    'plate-canvas-slot-move',
    (e) => {
      const d = (e as CustomEvent<{ slot?: string; x?: number; y?: number } | null>).detail;
      const c = curClip();
      if (!d?.slot || c?.kind !== 'plate' || !c.plateId) return;
      moveContentSlot(c.plateId, d.slot, { x: Number(d.x), y: Number(d.y) });
    },
    { signal },
  );
  window.addEventListener(
    'plate-canvas-slot-hover',
    (e) => {
      const slot = (e as CustomEvent<{ slot?: string | null } | null>).detail?.slot ?? null;
      const c = curClip();
      if (c?.kind === 'plate' && c.plateId) hoverContentSlot(c.plateId, slot);
    },
    { signal },
  );
  window.addEventListener(
    'plate-canvas-edit',
    (e) => {
      const path = (e as CustomEvent<{ path?: string } | null>).detail?.path;
      if (path) void enterTextFor(path);
      else void enterText();
    },
    { signal },
  );
  window.addEventListener(
    'plate-canvas-done',
    () => {
      if (ed.textMode) exitText();
    },
    { signal },
  );
  on(
    'edTextBar',
    'click',
    (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-text]');
      if (!b) return;
      void textBarAction(b.dataset['text'] || '');
    },
    signal,
  );
  wireZoomBox(signal);
  wireLensBox(signal);
  document.addEventListener(
    'focusout',
    () => {
      queueMicrotask(() => {
        if (!ed.active) return;
        flushQueuedInspectorRepaint(renderInspector);
      });
    },
    { signal, capture: true },
  );
}

async function textBarAction(act: string): Promise<void> {
  if (act === 'dismiss') {
    setCoachHidden(true);
    paintTextMode();
    return;
  }
  if (act === 'edit-card') {
    const hit = liveHitAtPlayhead();
    const sel = ed.sel?.type === 'card' ? ed.sel : null;
    // A caption just added is selected by key before its card id is known. The playhead hit
    // fills in whichever of those the selection doesn't have yet.
    const cardId = ed.liveCardId || sel?.cardId || hit?.card?.id || null;
    const markT = sel?.markT ?? hit?.mark?.t ?? null;
    const markKey = sel?.key || hit?.mark?.key || null;
    await enterLiveCard(cardId, markT, markKey);
    return;
  }
  if (act === 'accent') {
    P.accent();
    return;
  }
  if (act === 'save') await P.save();
  else if (act === 'discard') await P.discard();
  if (act !== 'done' && act !== 'save' && act !== 'discard') return;
  if (ed.textMode) exitText();
  else paintTextMode();
}

/** `#edTransport`. */
export function wireTransport(signal: AbortSignal): void {
  on('edPlay', 'click', toggle, signal);
  on(
    'edToStart',
    'click',
    () => {
      if (ed.playing) pause();
      seek(0);
      const scroll = $('etlScroll');
      if (scroll) scroll.scrollLeft = 0;
    },
    signal,
  );
  on('edReplay', 'click', replayClip, signal);
  on(
    'edLoop',
    'click',
    () => {
      ed.loop = !ed.loop;
      ed.loopClip = ed.loop && ed.playing ? curClip() : null;
      paintTransport();
      flashHint(ed.loop ? 'Looping this clip' : 'Loop off');
    },
    signal,
  );
  on(
    'edSound',
    'click',
    () => {
      ed.sound = !ed.sound;
      preview.setEnabled(ed.sound);
      if (ed.sound && ed.playing) preview.play(previewState(), ed.t);
      else if (!ed.sound) preview.pause();
      paintTransport();
      flashHint(ed.sound ? 'Sound on' : 'Sound off');
    },
    signal,
  );
  on(
    'edFx',
    'click',
    () => {
      ed.fx = !ed.fx;
      paintTransport();
      renderFrame();
      flashHint(ed.fx ? 'Showing zoom and transitions' : 'Showing the plain recording');
    },
    signal,
  );
  // Generic entry (not a click on a specific field already in view) — jump to the plate's
  // best-populated frame first so the editor doesn't land on a mid-reveal or empty one.
  on('edEditText', 'click', () => (ed.textMode ? exitText() : void enterText(ed.plateField?.path || null, { seekToPeak: true })), signal);
  on(
    'edFullscreen',
    'click',
    () => {
      void (async () => {
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await $('stage')?.requestFullscreen();
        } catch {
          /* unsupported */
        }
      })();
    },
    signal,
  );
}

/** `#edStatus` — Mix and Render from the dirty strip. */
export function wireStatus(signal: AbortSignal): void {
  on(
    'edStatus',
    'click',
    (e) => {
      const target = e.target as Element;
      if (target.closest('[data-act="mix"]')) {
        requestAudio();
        return;
      }
      if (!target.closest('[data-act="render"]')) return;
      ed.dirtyRender = false;
      requestMake('quick');
    },
    signal,
  );
}

/** `#edTimeline` — tools, undo, scale, range context and the tracks. */
export function wireTimelineBar(signal: AbortSignal): void {
  on('etlMix', 'click', () => select({ type: 'mix' }), signal);
  on('etlAddSpeed', 'click', () => void toolSpeed(), signal);
  on('etlAddCut', 'click', () => void toolCut(), signal);
  on('etlAddZoom', 'click', () => void toolZoom(), signal);
  on('etlAddLens', 'click', () => void toolLens(), signal);
  on('etlAddCard', 'click', () => void toolCaption(), signal);
  on('etlAddPlate', 'click', (e) => openAddLibrary(e.currentTarget as HTMLElement), signal);
  on('etlAddVoice', 'click', () => void toolVoice(), signal);
  on('etlDuplicate', 'click', () => void duplicateSelected(), signal);
  on('etlUndo', 'click', () => void undo(), signal);
  on('etlRedo', 'click', () => void redo(), signal);
  on('etlFit', 'click', () => setScale(1), signal);
  on('etlScale', 'input', (e) => setScale(2 ** Number((e.target as HTMLInputElement).value)), signal);
  on(
    'etlContext',
    'click',
    (e) => {
      const s = ed.sel;
      const b = (e.target as Element).closest<HTMLButtonElement>('button');
      if (!b || s?.type !== 'range') return;
      const from = s.from ?? 0;
      const to = s.to ?? 0;
      if (b.dataset['rangeRate']) void addRamp(from, to, Number(b.dataset['rangeRate']));
      else if (b.dataset['rangeZoom'] != null) void addZoomAt(from, to - from);
      else if (b.dataset['rangeLens'] != null) void addLensAt(from, to - from);
      else if (b.dataset['rangeCut'] != null) void addCut(from, to);
      else if (b.dataset['rangeSkip'] != null)
        void postDeck({ zoomSkips: [...deckEdit().zoomSkips, { from, to }] }, { hint: 'No auto zoom in that stretch' }).then((r) => r && select(null));
      else if (b.dataset['rangeDup'] != null) void duplicateSelected();
      else if (b.dataset['rangeClear'] != null) select(null);
    },
    signal,
  );
  wireTimeline(signal);
  onPaceModeChange(() => {
    renderTimeline();
    paintInspectorUnlessContentTyping(renderInspector);
  });
  signal.addEventListener('abort', () => closePacePop());
  wireOverview(signal);
  const scroll = $('etlScroll');
  // The ruler is sticky; the playhead pin and clock read this so they stay on that bar.
  scroll?.addEventListener(
    'scroll',
    () => scroll.style.setProperty('--etl-scroll-y', `${scroll.scrollTop}px`),
    { passive: true, signal },
  );
  // A gesture restyles blocks in place; whatever it commits (or abandons), the next paint is whole.
  for (const type of ['pointerdown', 'pointerup', 'pointercancel'] as const)
    (type === 'pointerdown' ? scroll : window)?.addEventListener(type, invalidateTimeline, { capture: true, signal });
  // Only a new width moves the blocks; the shell growing or folding must not repaint mid-morph.
  // A dragged pane edge fires many sizes per frame — paint once, at the last one. A hidden or
  // throttled view may never hand out a frame, so a timer stands in rather than dropping resizes.
  let width = -1;
  let pending = false;
  const paint = (): void => {
    if (!pending || signal.aborted) return;
    pending = false;
    const w = scroll?.clientWidth ?? 0;
    if (w === width) return;
    width = w;
    renderTimeline();
  };
  const obs =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          if (pending) return;
          pending = true;
          requestAnimationFrame(paint);
          setTimeout(paint, 100);
        })
      : null;
  if (obs && scroll) {
    obs.observe(scroll);
    signal.addEventListener('abort', () => obs.disconnect());
  }
}

/** The editor's keyboard map (capture phase, so it wins over the desk shortcuts). */
export function wireKeys(signal: AbortSignal): void {
  window.addEventListener(
    'keydown',
    (e) => {
      if (!ed.active || desk.get().monitorMode !== 'plate') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      if (target?.closest?.('[role="separator"]')) return;
      // A focused panel grip moves its panel with the arrows and docks it with Home / End.
      if (target?.closest?.('[data-sp-grip]') && /^(Arrow|Home$|End$)/.test(e.key)) return;
      if (document.querySelector('dialog[open]') || plateLibOpen()) return;
      if (pacePopOpen()) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          closePacePop();
          return;
        }
        if (target?.closest?.('.pace-pop')) return;
      }
      if (stageAimKey(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      let handled = true;
      if (mod && k === 'z') void (e.shiftKey ? redo : undo)();
      else if (mod && k === 'y') void redo();
      else if (mod && k === 'd') void duplicateSelected();
      else if (mod) handled = false;
      else if (e.code === 'Space') toggle();
      else if (k === 'r') replayClip();
      else if (k === 's') void toolSpeed();
      else if (k === 'c') void toolCut();
      else if (k === 'z') void toolZoom();
      else if (k === 'm') void toolLens();
      else if (k === 'l') $('edLoop')?.click();
      else if (k === 'p') openAddLibrary($('etlAddPlate'));
      else if (k === 'home') seek(0);
      else if (k === 'end') seek(ed.total);
      else if (k === 'arrowleft' || k === 'arrowright') {
        if (ed.playing) pause();
        seek(ed.t + (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / 30), { follow: true });
      } else if (k === 'backspace' || k === 'delete') void removeSelected();
      else if (k === 'escape') {
        if (ed.textMode) exitText();
        else select(null);
      } else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    { capture: true, signal },
  );
}

// ─── The object `initEditor()` returned ──────────────────────────────────────────────────

const selection = (): EditorSelection | null => (ed.sel ? { kind: ed.sel.type } : null);

export const editorApi = {
  refresh: async (): Promise<void> => {
    await refresh();
  },
  resetForProject: (): void => {
    resetForProject();
    resetPlateContentPane();
  },
  flushPendingContent: async (): Promise<void> => {
    await flushAllContentPending();
    await contentSaveIdle();
  },
  onEnter: (opts: { programT?: number | null } = {}): void => void onEnter(opts),
  onLeave,
  openPlate,
  selectLive: (scene: Scene): void => void selectLive(scene),
  reloadPlate,
  invalidatePlates,
  paintLookVars,
  renderClips: (): void => renderTimeline(),
  renderInspector,
  tuneAtmosphere: (opacity: number | undefined, speed: number | undefined): void => tuneAtmosphereLive(opacity, speed),
  frameAtmosphere: () => frameAtmosphereOnStage(),
  /** The desk calls this where the legacy called `updatePlateEditChrome()`. */
  onPlateDirty: (): void => updatePlateEditChrome(),
  get active(): boolean {
    return ed.active;
  },
  get deck() {
    return ed.deck;
  },
  get selection(): EditorSelection | null {
    return selection();
  },
  get hasScenes(): boolean {
    return Boolean(ed.deck?.scenes?.length);
  },
  markDirty(): void {
    ed.dirtyRender = true;
    paintStatus();
  },
};
