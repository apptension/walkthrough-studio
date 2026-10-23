import type { Scene } from '@/api/types';
import type { EditorSelection } from '@/desk/bridge';
import { setMonitorMode } from '@/desk/monitor';
import { showRightTab } from '@/desk/panels';
import { desk } from '@/desk/store';
import { planAfterSeeked } from '@/logic/livePreview';
import { canReloadPlateFrame, playheadOnPlate, plateClipFor, shouldBlacklistPlateLoad } from '@/logic/plateSync';
import { paintRange } from '@/ui/rangeFill';

import { wireLensBox, wireZoomBox } from './aim';
import { previewState } from './audio';
import { requestAudio, requestMake } from './ctx';
import { postDeck, redo, refresh, resetForProject, undo } from './data';
import { addCut, addLensAt, addRamp, addZoomAt, paintStatus, removeSelected, select, showInspectorTab, toolCut, toolLens, toolSpeed, toolVoice, toolZoom } from './edits';
import { renderInspector } from './inspector';
import { invalidatePlates, paintLookVars } from './look';
import { updatePlateEditChrome } from './plate';
import { P } from './plateCtl';
import { curClip } from './seq';
import { ensureLiveCards, liveHitAtPlayhead, paintLoading, renderFrame } from './stage';
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
  wireTextBarChrome,
} from './text';
import { flashHint, renderTimeline } from './timeline';
import { wireTimeline } from './timelineWire';
import { paintHead, paintTransport, pause, replayClip, seek, toggle } from './transport';
import type { Clip, FieldDetail } from './types';
import { $, clamp } from './util';

/** Entry points, plate reloads and wiring from the tail of `kit/studio/editor.js`. */

// ─── Plate reloads (server rebuilt the HTML) ─────────────────────────────────────────────
export async function reloadPlate(id: string): Promise<void> {
  ed.missing.delete(id);
  const c = curClip();
  const clip = plateClipFor(ed.seq, id, c);
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
  const ok = await P.load(id, { force: true });
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
    // Keep the playhead — a look/atmosphere reload should land on the same beat, not the open.
    const onPlate = playheadOnPlate(curClip(), id);
    const ms = onPlate && clip ? Math.max(0, Math.round((ed.t - clip.at) * 1000)) : 0;
    P.motion();
    P.restart(ms);
    if (ed.needsPlateResync === id) ed.needsPlateResync = null;
  }
  if (playheadOnPlate(curClip(), id)) renderFrame();
  if (ed.sel?.type === 'clip' && ed.seq.find((x) => x.id === ed.sel?.id)?.plateId === id) renderInspector();
}

// ─── Entry points ────────────────────────────────────────────────────────────────────────
export async function onEnter({ programT }: { programT?: number | null } = {}): Promise<void> {
  ed.active = true;
  document.body.classList.add('is-editor');
  // Always re-fetch: desk, takes and voice meta can change on disk or via API while Program is open.
  await refresh();
  // Warm live-card HTML so chapter/caption clicks don't race a first rebuild.
  await ensureLiveCards();
  const scenes = ed.deck?.scenes;
  if (programT != null && scenes?.length) {
    const i = scenes.findIndex((s) => s.start != null && s.end != null && programT >= s.start - 0.05 && programT < s.end);
    const c = ed.seq[i];
    const start = scenes[i]?.start;
    if (c && start != null) ed.t = c.at + clamp(programT - start, 0, c.dur);
  }
  if (!ed.sel) {
    const c = curClip();
    if (c) ed.sel = { type: 'clip', id: c.id };
  }
  renderTimeline();
  renderFrame();
  renderInspector();
  paintStatus();
  paintTransport();
  paintTextMode();
  showInspectorTab();
  requestAnimationFrame(() => {
    renderTimeline();
    P.fit();
  });
}

export function onLeave(): void {
  if (!ed.active) return;
  pause();
  preview.pause();
  clearPlatePreviewTimers();
  ed.textGen += 1;
  if (ed.textMode) exitText();
  ed.needsPlateResync = null;
  ed.active = false;
  document.body.classList.remove('is-editor');
  if (desk.get().rightTab === 'inspector') showRightTab('feedback');
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
  wireTextBarChrome(signal);
  window.addEventListener('plate-selection', (e) => syncPlateField((e as CustomEvent<FieldDetail>).detail), { signal });
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
    const cardId = ed.liveCardId || hit?.card?.id || sel?.cardId || null;
    const markT = sel ? (sel.markT ?? null) : (hit?.mark?.t ?? null);
    const markKey = sel ? sel.key || null : hit?.mark?.key || null;
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
  on('edEditText', 'click', () => (ed.textMode ? exitText() : void enterText(ed.plateField?.path || null)), signal);
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
  on('etlAddVoice', 'click', () => void toolVoice(), signal);
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
      else if (b.dataset['rangeClear'] != null) select(null);
    },
    signal,
  );
  wireTimeline(signal);
  const scroll = $('etlScroll');
  const obs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => ed.active && renderTimeline()) : null;
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
      if (document.querySelector('dialog[open]')) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      let handled = true;
      if (mod && k === 'z') void (e.shiftKey ? redo : undo)();
      else if (mod && k === 'y') void redo();
      else if (mod) handled = false;
      else if (e.code === 'Space') toggle();
      else if (k === 'r') replayClip();
      else if (k === 's') void toolSpeed();
      else if (k === 'c') void toolCut();
      else if (k === 'z') void toolZoom();
      else if (k === 'm') void toolLens();
      else if (k === 'l') $('edLoop')?.click();
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
  resetForProject,
  onEnter: (opts: { programT?: number | null } = {}): void => void onEnter(opts),
  onLeave,
  openPlate,
  selectLive: (scene: Scene): void => void selectLive(scene),
  reloadPlate,
  invalidatePlates,
  paintLookVars,
  renderClips: (): void => {
    if (ed.active) renderTimeline();
  },
  renderInspector,
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
