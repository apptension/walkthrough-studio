import type { HtmlPlate } from '@/api/types';
import { api } from '@/desk/api';
import { bridges } from '@/desk/bridge';
import { requestMake } from '@/desk/jobs';
import { setMonitorMode } from '@/desk/monitor';
import { showRightTab } from '@/desk/panels';
import { runtime } from '@/desk/runtime';
import { desk, setButtonBusy, setStatus } from '@/desk/store';
import { toast } from '@/desk/toast';
import { loadVideo } from '@/desk/video';

import { hideProposal, markThinkStepsDone, resetThinkSteps, session, setApprovePlateVisible, setThinkStep } from './session';

/** The decision buttons under a proposal: `#btnDiscardDraft`, `#btnApproveDraft`, `#btnApprovePlate`, `#btnReviewProposal`. */

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `renderHtmlPlatePicker(plates)`: the Editor's clip strip lists plates from the store. */
export function renderHtmlPlatePicker(plates: HtmlPlate[]): void {
  desk.set({ htmlPlates: plates });
  bridges.editor?.renderClips();
}

export async function discardDraft(): Promise<void> {
  setButtonBusy('btnDiscardDraft', true);
  try {
    const r = await api<{ plates?: HtmlPlate[] }>(`/api/video/${desk.get().slug}/draft/discard`, { method: 'POST', body: {} });
    renderHtmlPlatePicker(r.plates || []);
    const slug = desk.get().slug;
    if (slug) await loadVideo(slug);
    hideProposal();
    resetThinkSteps();
    desk.set({ editingPlateId: null });
    setApprovePlateVisible(false);
    setMonitorMode('program');
    toast('Discarded', 'Restored previous sources');
    setStatus('ok', 'Draft discarded');
  } catch (err) {
    toast('Discard failed', errorMessage(err), 'err');
  } finally {
    setButtonBusy('btnDiscardDraft', false);
  }
}

export async function approveDraft(): Promise<void> {
  setButtonBusy('btnApproveDraft', true);
  try {
    await api(`/api/video/${desk.get().slug}/draft/approve`, { method: 'POST', body: {} });
    hideProposal();
    setThinkStep('approve');
    markThinkStepsDone();
    toast('Approved', 'Rendering full sequence…');
    setMonitorMode('program');
    desk.set({ editingPlateId: null });
    setApprovePlateVisible(false);
    requestMake(desk.get().video?.freshness?.needsRecord ? 'full' : 'quick');
    resetThinkSteps();
  } catch (err) {
    toast('Approve failed', errorMessage(err), 'err');
  } finally {
    setButtonBusy('btnApproveDraft', false);
  }
}

export function approvePlate(): void {
  void bridges.plate?.approvePlateOnly();
}

/** Pulse the monitor so the eye lands on the proposed result. */
function focusStage(): void {
  const stage = runtime.stage ?? document.getElementById('stage');
  stage?.classList.remove('review-focus');
  requestAnimationFrame(() => stage?.classList.add('review-focus'));
  setTimeout(() => stage?.classList.remove('review-focus'), 900);
  stage?.focus({ preventScroll: true });
}

export function reviewProposal(): void {
  const review = session.get().review || 'preview';
  if (review === 'script') {
    bridges.workflow?.openScript();
    toast('Review changes', 'Script and narration are open — approve only after they read and sound right');
    return;
  }
  if (review === 'direction') {
    showRightTab('motion');
    toast('Review direction', 'Check the video-local brand, motion and camera settings');
    return;
  }
  const s = desk.get();
  const plate = s.htmlPlates.find((item) => item.id === s.activePlateId) || s.htmlPlates[0];
  if (plate) {
    bridges.plate?.showPlateHtml(plate.id);
    setMonitorMode('plate');
  } else {
    setMonitorMode('program');
  }
  focusStage();
  toast('Preview in focus', plate ? `Reviewing ${plate.label || plate.id}` : 'Review the proposed result in Program');
}

/** `#btnApproveMotion` clicks `#btnApproveDraft` — a no-op while that button is busy (disabled). */
export function approveMotion(): void {
  if (!desk.get().busy['btnApproveDraft']) void approveDraft();
}
