import { api } from '@/desk/api';
import { toast } from '@/desk/toast';

import { previewState } from './audio';
import { paintStatus } from './edits';
import { renderInspector } from './inspector';
import { clearPlatePreviewTimers, exitText } from './text';
import { buildSeq, clipIndexAt, lensByKey, shotKey } from './seq';
import { liveCardAtPlayhead, paintFrame, plateReady, renderFrame, requestPlate, syncLiveSource } from './stage';
import { audioDesk, deckEdit, ed, htmlPlates, preview, slug } from './state';
import { flashHint, renderTimeline } from './timeline';
import { paintHead, paintTransport, pause } from './transport';
import type { Deck, DeckEdit } from './types';
import { clamp, errMessage } from './util';

/** Deck load / save / undo from `kit/studio/editor.js`. */

/**
 * Drop per-project editor state when the sequence changes. Keeps chrome (active / zoom scale)
 * but clears playhead, selection, undo, and in-flight voice/music work so the last video
 * cannot leak into the next.
 */
export function resetForProject(): void {
  pause();
  preview.pause();
  clearPlatePreviewTimers();
  if (ed.micRecord) {
    try {
      ed.micRecord.recorder?.stop?.();
      ed.micRecord.stream?.getTracks?.().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    ed.micRecord = null;
  }
  ed.textGen += 1;
  if (ed.textMode) {
    try {
      exitText();
    } catch {
      /* plate may already be gone */
    }
  }
  ed.t = 0;
  ed.total = 0;
  ed.seq = [];
  ed.sel = null;
  ed.undo = [];
  ed.redo = [];
  ed.hear = null;
  ed.deck = null;
  ed.regenerating = null;
  ed.loadingPlate = null;
  ed.missing = new Set();
  ed.stalePlates = new Set();
  ed.needsPlateResync = null;
  ed.dirtyRender = false;
  ed.voices = null;
  ed.drag = null;
  ed.preSeek = null;
  ed.wantRec = null;
  ed.stopAt = null;
  ed.loopClip = null;
  ed.cur = -1;
  ed.clock = null;
}

export async function refresh(): Promise<Deck | null> {
  if (!slug()) return null;
  const want = slug();
  try {
    const deck = await api<Deck>(`/api/video/${encodeURIComponent(want || '')}/edit`);
    // Sequence may have changed while the request was in flight.
    if (slug() !== want) return null;
    ed.deck = deck;
  } catch (err) {
    if (slug() !== want) return null;
    ed.deck = null;
    console.warn('editor deck', err);
  }
  syncLiveSource();
  buildSeq();
  ed.t = clamp(ed.t, 0, ed.total || 0);
  paintFrame();
  void preview.load(previewState());
  if (ed.active) {
    validateSelection();
    renderTimeline();
    renderFrame();
    renderInspector();
    paintStatus();
    paintTransport();
  }
  return ed.deck;
}

export const snapshotDeck = (): DeckEdit => {
  const d = deckEdit();
  return JSON.parse(
    JSON.stringify({
      speed: d.speed || [],
      zooms: d.zooms || [],
      zoomSkips: d.zoomSkips || [],
      lenses: d.lenses || [],
      lensOff: d.lensOff || [],
      transitions: d.transitions || {},
      audio: d.audio || null,
      cards: d.cards || [],
      layouts: d.layouts || [],
      order: d.order || [],
      omit: d.omit || [],
      repeats: d.repeats || [],
      trims: d.trims || [],
      cuts: d.cuts || [],
    }),
  ) as DeckEdit;
};

export async function postDeck(patch: Partial<DeckEdit> | Record<string, unknown>, { undoable = true, hint }: { undoable?: boolean; hint?: string | undefined } = {}): Promise<Deck | null> {
  const before = snapshotDeck();
  try {
    const r = await api<Deck>(`/api/video/${encodeURIComponent(slug() || '')}/edit`, { method: 'POST', body: patch });
    if (undoable) {
      ed.undo.push(before);
      if (ed.undo.length > 60) ed.undo.shift();
      ed.redo = [];
    }
    ed.deck = r;
    ed.hear = null;
    // Cut shape changed — drop composite preview so the next frame loads the true plate/HTML.
    ed.compositeCardId = null;
    ed.compositeHoldMs = null;
    ed.compositeSeekMs = null;
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'cards')) {
      for (const p of htmlPlates() || []) {
        if (p.liveCard || String(p.id || '').startsWith('overlay:')) ed.stalePlates.add(p.id);
      }
    }
    if (!ed.textMode) ed.liveCardId = null;
    buildSeq();
    ed.cur = -1;
    // Omit/reorder races often cancelled an in-flight iframe load and blacklisted Opening.
    for (const c of ed.seq) if (c.plateId) ed.missing.delete(c.plateId);
    if (ed.textMode && ed.liveCardId && String(ed.liveCardId).startsWith('overlay:')) {
      const still = liveCardAtPlayhead();
      if (!still || still.id !== ed.liveCardId) exitText();
    }
    void preview.load(previewState());
    if (ed.playing && ed.sound) preview.play(previewState(), ed.t);
    validateSelection();
    renderTimeline();
    const stage = ed.seq[clipIndexAt(ed.t)];
    if (stage?.kind === 'plate' && stage.plateId && !plateReady(stage.plateId)) {
      await requestPlate(stage.plateId, { reason: 'show', force: true });
    } else {
      renderFrame();
    }
    paintHead();
    renderInspector();
    paintStatus();
    if (hint) flashHint(hint);
    return r;
  } catch (err) {
    toast('Edit not saved', errMessage(err), 'err');
    renderTimeline();
    return null;
  }
}

export async function undo(): Promise<void> {
  const snap = ed.undo.pop();
  if (!snap) return;
  ed.redo.push(snapshotDeck());
  await postDeck(snap, { undoable: false, hint: 'Undone' });
}

export async function redo(): Promise<void> {
  const snap = ed.redo.pop();
  if (!snap) return;
  ed.undo.push(snapshotDeck());
  await postDeck(snap, { undoable: false, hint: 'Redone' });
}

export function validateSelection(): void {
  const s = ed.sel;
  if (!s) return;
  const d = deckEdit();
  if (s.type === 'ramp' && !d.speed[s.i ?? -1]) ed.sel = null;
  if (s.type === 'zoom' && !(ed.deck?.zoomShots || []).some((z) => shotKey(z) === s.key)) ed.sel = null;
  if (s.type === 'skip' && !d.zoomSkips[s.i ?? -1]) ed.sel = null;
  if (s.type === 'lens' && !lensByKey(s.key)) ed.sel = null;
  if (s.type === 'voice' && !(ed.deck?.audio?.voiceClips || []).some((c) => c.key === s.key)) ed.sel = null;
  if (s.type === 'ride' && !audioDesk().music.rides[s.i ?? -1]) ed.sel = null;
  if (s.type === 'clip' && !ed.seq.some((c) => c.id === s.id)) ed.sel = null;
  if (s.type === 'cut' && !d.cuts[s.i ?? -1]) ed.sel = null;
}
