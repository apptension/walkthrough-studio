import { api } from '@/desk/api';
import { bridges } from '@/desk/bridge';
import {
  activePlayer,
  ensureProgramMaster,
  paintSignInWait,
  seekTo,
  setCompare,
  setMonitorMode,
  startPlayback,
  syncCompare,
  updateTransport,
} from '@/desk/monitor';
import { showLeftTab, showRightTab } from '@/desk/panels';
import { runtime } from '@/desk/runtime';
import { desk } from '@/desk/store';
import { toast } from '@/desk/toast';
import { needsProgramRestore, normalizeMonitorMode } from '@/logic/monitorMode';
import { recordFailureNote } from '@/logic/recordFailure';

import { recordFailureDismissKey } from './model';

/**
 * The monitor's handlers from `wire()` in `kit/studio/app.js`: mode tabs,
 * transport buttons, the toggles and the stage overlays' buttons.
 */

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `#modeProgram` click. */
export function selectProgram(): void {
  if (desk.get().plateDirty) {
    toast('Unsaved plate edits', 'Save or Discard first', 'warn');
    return;
  }
  desk.set({ previewingPlate: null });
  setMonitorMode('program');
  // Always re-assert the delivery master after leaving Editor / Live / plate preview.
  ensureProgramMaster({ force: true });
}

/** `#modeLive` click. */
export function selectLive(): void {
  if (desk.get().plateDirty) {
    toast('Unsaved plate edits', 'Save or Discard first', 'warn');
    return;
  }
  desk.set({ previewingPlate: null });
  setMonitorMode('live');
}

/** `#modePlate` click (and any `[data-open-editor]` click). */
export async function selectEditor(): Promise<void> {
  const s = desk.get();
  if (!s.htmlPlates.length && !bridges.editor?.hasScenes) {
    try {
      await bridges.plate?.rebuildPlateHtmlPreview({ selectFirst: false });
    } catch (err) {
      toast('Nothing to edit yet', errorMessage(err), 'warn');
      return;
    }
  }
  setMonitorMode('plate');
}

/** `#btnPlay` click. */
export function togglePlay(): void {
  const s = desk.get();
  const mode = normalizeMonitorMode(s.monitorMode);
  if (mode !== s.monitorMode) setMonitorMode(mode);
  if (document.body.classList.contains('is-editor') || mode === 'plate') {
    const edPlay = document.getElementById('edPlay');
    if (edPlay) {
      edPlay.click();
      return;
    }
    if (mode === 'plate') {
      document.getElementById('btnPlateReplay')?.click();
      return;
    }
  }
  const p = activePlayer();
  if (p && !p.paused && !p.ended) {
    p.pause();
    if (desk.get().compare) runtime.playerB?.pause();
    updateTransport();
    return;
  }
  // Program (or compare A): if a plate preview is loaded, restore the master first.
  const deliveryUrl = desk.get().video?.deliveryUrl;
  if (mode === 'program' && deliveryUrl) {
    const src = p?.currentSrc || p?.getAttribute('src') || '';
    if (needsProgramRestore({ monitorMode: 'program', previewingPlate: desk.get().previewingPlate, playerSrc: src, deliveryUrl })) {
      ensureProgramMaster({ play: true, preserveTime: false });
      return;
    }
  }
  startPlayback(p);
  if (desk.get().compare) startPlayback(runtime.playerB);
}

/** `#btnSkipBack` / `#btnSkipFwd` click. */
export function skip(delta: number): void {
  const s = desk.get();
  const mode = normalizeMonitorMode(s.monitorMode);
  if (mode === 'plate') {
    toast('Timeline locked', 'Exit to Program to scrub', 'warn');
    return;
  }
  if (mode === 'program' && s.previewingPlate && s.video?.deliveryUrl) {
    ensureProgramMaster({ preserveTime: false });
  }
  seekTo((activePlayer()?.currentTime || 0) + delta);
}

/** `#togCaptions` change. */
export function setCaptions(on: boolean): void {
  desk.set({ captionsOn: on });
  updateTransport();
}

/** `#togCompare` change. */
export function toggleCompare(on: boolean): void {
  setCompare(on);
}

/** `#rateSelect` change. */
export function setRate(value: string): void {
  const rate = Number(value) || 1;
  for (const p of [runtime.player, runtime.playerA, runtime.playerB]) if (p) p.playbackRate = rate;
}

/** `#btnMute` click. Returns the new muted state of the active player. */
export function toggleMute(): boolean {
  const p = activePlayer();
  if (!p) return false;
  p.muted = !p.muted;
  return p.muted;
}

/** `#btnFs` click. */
export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await runtime.stage?.requestFullscreen();
  } catch {
    toast('Fullscreen unavailable', '', 'warn');
  }
}

/** `#compareSelect` change. */
export function chooseCompare(id: string): void {
  desk.set({ compareId: id });
  syncCompare();
}

/** `#recordFailureFix` click: the failure becomes the director note, then an agent pass. */
export function fixRecordFailure(): void {
  const note = recordFailureNote(desk.get().video?.recordFailure);
  desk.set((s) => ({ improve: { ...s.improve, note } }));
  showRightTab('feedback');
  bridges.feedback?.startImprove?.('full');
}

/** `#recordFailureDismiss` click. */
export function dismissRecordFailure(): void {
  const s = desk.get();
  const info = s.video?.recordFailure;
  if (info) desk.set({ recordFailureDismissed: recordFailureDismissKey(s.slug, info) });
}

/** `#signInContinue` click. */
export async function continueSignIn(): Promise<void> {
  const slug = desk.get().slug;
  if (!slug) return;
  try {
    await api(`/api/video/${slug}/sign-in-continue`, { method: 'POST', body: {} });
    paintSignInWait(null);
  } catch (err) {
    toast('Could not continue', errorMessage(err), 'err');
  }
}

/** `#programBuildShot` click. */
export function openBuildShot(screenshot: string | undefined): void {
  if (screenshot) window.open(screenshot, '_blank');
}

/** `#programBuildClose` click. The next pipeline event paints a fresh overlay. */
export function closeProgramBuild(): void {
  desk.set({ programBuild: null });
}

/** `#programBuildLog` click. */
export function openBuildLog(log: string | undefined): void {
  if (log === 'activity') showLeftTab('render');
  else if (log) window.open(log, '_blank');
}

/** `loadedmetadata` on `#player`. */
export function onProgramMetadata(): void {
  const player = runtime.player;
  desk.set((s) => ({ duration: player?.duration || s.duration }));
  updateTransport();
}
