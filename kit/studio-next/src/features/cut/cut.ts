import { create } from 'zustand';

import type { VideoSummary } from '@/api/types';
import { api } from '@/desk/api';
import { desk, openDialog } from '@/desk/store';
import { toast } from '@/desk/toast';
import { refreshSummary } from '@/desk/video';
import { onStageAction } from '@/features/stages/actions';
import { STATUS_LABEL, stageWhen } from '@/features/stages/model';

/** The cut sheet (`openCut` / `cutDecision` in `kit/studio/workflow.js`). */

export type CutStatus = 'approved' | 'changes-requested';

interface CutSheetState {
  note: string;
  /** The button whose request is in flight (`btn.disabled = true`). */
  pending: CutStatus | null;
  /** Bumped when the note field should take focus. */
  focusNote: number;
}

export const useCutSheet = create<CutSheetState>()(() => ({ note: '', pending: null, focusNote: 0 }));

export interface CutView {
  facts: Array<[string, string]>;
  warn: string[];
  history: Array<{ action: string; label: string; when: string; note: string }>;
  approved: boolean;
  effective: string;
}

/** Everything `openCut()` painted, from the summary. */
export function cutView(v: VideoSummary, now = Date.now()): CutView {
  const cut = v.review?.cut || { effective: 'none', history: [] };
  const scriptR = v.review?.script || { effective: 'draft' };
  const latest = (v.versions || [])[0];
  const facts: Array<[string, string]> = [
    ['Duration', v.durationSec ? `${Math.floor(v.durationSec / 60)}:${String(Math.round(v.durationSec % 60)).padStart(2, '0')}` : '—'],
    ['Chapter markers', String((v.chapters || []).length)],
    ['Transitions', v.transitions ? `${v.transitions.style} · ${v.transitions.duration}s` : '—'],
    ['QC', v.qc?.status ? (v.qc.status[0] ?? '').toUpperCase() + v.qc.status.slice(1) : 'Not run'],
    ['Latest version', latest ? latest.displayName || latest.name : '—'],
    ['Script', STATUS_LABEL[scriptR.effective] || scriptR.effective],
  ];
  if (cut.effective === 'approved') {
    facts.push(['Approved', `${cut.versionName || cut.version} · ${stageWhen(cut.approvedAt, now)}`]);
  }
  const warn: string[] = [];
  if (scriptR.effective !== 'approved') warn.push('The script is not approved — approving the cut also signs off its copy.');
  if (v.freshness?.stale) warn.push(`Delivery is out of date: ${v.freshness.reason}.`);
  if (v.qc?.status === 'fail') warn.push('QC failed — check the Review tab before approving.');
  const history = (cut.history || [])
    .slice()
    .reverse()
    .map((h) => {
      const action = String(h.action ?? h.status);
      return { action, label: STATUS_LABEL[action] || action, when: stageWhen(h.at, now), note: h.note || '' };
    });
  return { facts, warn, history, approved: cut.effective === 'approved', effective: cut.effective };
}

export function openCut(): void {
  const v = desk.get().video;
  if (!v?.hasDelivery) {
    toast('Nothing to review yet', 'Render the video first', 'warn');
    return;
  }
  openDialog('cut', true);
}

export async function cutDecision(status: CutStatus): Promise<void> {
  const note = useCutSheet.getState().note.trim();
  if (status === 'changes-requested' && !note) {
    useCutSheet.setState((s) => ({ focusNote: s.focusNote + 1 }));
    toast('Add a note', 'What should change before approval?', 'warn');
    return;
  }
  useCutSheet.setState({ pending: status });
  try {
    await api(`/api/video/${desk.get().slug ?? ''}/cut/review`, { method: 'POST', body: { status, note } });
    useCutSheet.setState({ note: '' });
    openDialog('cut', false);
    toast(
      status === 'approved' ? 'Cut approved' : 'Changes requested',
      status === 'approved' ? 'Saved as a release version — export when ready' : 'Use Feedback to have the agent apply them',
      status === 'approved' ? 'ok' : 'warn',
    );
    if (status === 'changes-requested') void onStageAction('feedback', { note });
    await refreshSummary();
  } catch (err) {
    toast('Review failed', err instanceof Error ? err.message : String(err), 'err');
  } finally {
    useCutSheet.setState({ pending: null });
  }
}
