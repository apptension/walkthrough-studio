import { enqueueJob } from '@/desk/jobs';

const STEP_LABELS: Partial<Record<string, string>> = {
  plates: 'Render brand plates',
  audio: 'Add voice & music',
  deliver: 'Export handoff pack',
  produce: 'Produce master video',
  record: 'Record walkthrough',
};

/** `enqueueFromMenu(kind)` from `kit/studio/app.js` — one Add-menu pick into the queue. */
export function enqueueFromMenu(kind: string): void {
  if (kind === 'make-quick') {
    enqueueJob({ kind: 'make', mode: 'quick', label: 'Render sequence' });
    return;
  }
  if (kind === 'make-full') {
    enqueueJob({ kind: 'make', mode: 'full', label: 'Re-record & render full' });
    return;
  }
  enqueueJob({
    kind: 'step',
    step: kind,
    force: kind === 'plates',
    label: STEP_LABELS[kind] || kind,
  });
}
