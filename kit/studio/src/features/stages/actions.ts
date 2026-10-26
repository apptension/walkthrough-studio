import { ask } from '@/desk/ask';
import { exportPack, requestMake } from '@/desk/jobs';
import { showRightTab } from '@/desk/panels';
import { desk } from '@/desk/store';
import { openCut } from '@/features/cut/cut';
import { openScript } from '@/features/script/sheet';

/**
 * `onStageAction(key, opts)` — the callback `initStages` in `kit/studio/app.js`
 * handed to the workflow: what a stage without a sheet of its own does.
 */
export async function onStageAction(key: string, opts: { note?: string } = {}): Promise<void> {
  const v = desk.get().video;
  if (key === 'record') {
    const r = v?.review?.script;
    if (
      r?.effective !== 'approved' &&
      !(await ask({
        title: 'Record before the script is approved?',
        detail: 'Recording follows the script line by line. Approving first keeps the capture and the narration in step.',
        ok: 'Record anyway',
        tone: 'warn',
      }))
    )
      return;
    if (
      !desk.get().video?.direction?.approvedAt &&
      !(await ask({
        title: 'Record before direction is approved?',
        detail: 'Palette, camera and cursor settings shape the capture. Approve direction first to avoid a re-record.',
        ok: 'Record anyway',
        tone: 'warn',
      }))
    )
      return;
    requestMake('full');
  } else if (key === 'direction') {
    showRightTab('motion');
  } else if (key === 'deliver') {
    const c = v?.review?.cut;
    if (
      c?.effective !== 'approved' &&
      !(await ask({
        title: 'Export before the cut is approved?',
        detail: 'The handoff pack is built from the current render. Approving the cut first marks it as the version you stand behind.',
        ok: 'Export anyway',
        tone: 'warn',
      }))
    )
      return;
    exportPack();
  } else if (key === 'feedback') {
    showRightTab('feedback');
    const note = opts.note;
    if (note) desk.set((s) => ({ improve: { ...s.improve, note } }));
  }
}

/** A click on `#stageBar .pstage[data-stage]`. */
export function onStageClick(key: string): void {
  if (key === 'brief' || key === 'script') void openScript();
  else if (key === 'cut') openCut();
  else void onStageAction(key);
}
