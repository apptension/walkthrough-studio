/**
 * Quality-check triage in Review → hand-off to Feedback / improve.
 */

import { showRightTab } from '@/desk/panels';
import { desk } from '@/desk/store';
import { toast } from '@/desk/toast';
import { startImprove } from '@/features/feedback/improve';
import { allQcKeys, directorNoteForQc, listedQcFindings, selectedQcFindings } from '@/logic/qcFindings';

/** Open Review on Quality checks, optionally selecting every listed finding. */
export function openQcReview({ selectAll = true }: { selectAll?: boolean } = {}): void {
  const findings = listedQcFindings(desk.get().video?.qc?.findings);
  desk.set({
    qcKeys: selectAll ? allQcKeys(findings) : desk.get().qcKeys,
    qcFocus: Date.now(),
  });
  showRightTab('review');
  if (!findings.length) {
    toast('No QC findings', 'Render or Export once to refresh the quality report', 'warn');
  }
}

export function toggleQcKey(key: string, on?: boolean): void {
  desk.set((s) => {
    const has = s.qcKeys.includes(key);
    const next = on == null ? !has : on;
    if (next === has) return {};
    return { qcKeys: next ? [...s.qcKeys, key] : s.qcKeys.filter((k) => k !== key) };
  });
}

export function setAllQcKeys(on: boolean): void {
  const findings = listedQcFindings(desk.get().video?.qc?.findings);
  desk.set({ qcKeys: on ? allQcKeys(findings) : [] });
}

/**
 * Build a director note from the chosen findings, open Feedback, and queue improve.
 * `mode: 'all'` ignores the current selection and uses every listed finding.
 */
export function applyQcWithAi(mode: 'selected' | 'all' = 'selected'): void {
  const listed = listedQcFindings(desk.get().video?.qc?.findings);
  const findings = mode === 'all' ? listed : selectedQcFindings(listed, desk.get().qcKeys);
  if (!findings.length) {
    toast('Pick at least one finding', 'Select warnings to send to the agent, or use Apply all', 'warn');
    return;
  }
  const note = directorNoteForQc(findings);
  desk.set((s) => ({
    improve: {
      ...s.improve,
      note,
      goal: 'full',
      plateId: null,
      label: findings.length === 1 ? 'Apply QC fix' : `Apply ${findings.length} QC fixes`,
    },
    qcPending: findings.map((f) => ({ severity: f.severity, code: f.code, message: f.message })),
  }));
  showRightTab('feedback');
  startImprove('full');
}

/** Drop the QC chips once the note is cleared or a freeform edit replaces them. */
export function clearQcPending(): void {
  if (desk.get().qcPending.length) desk.set({ qcPending: [] });
}
