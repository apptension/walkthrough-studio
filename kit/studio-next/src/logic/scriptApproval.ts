/** After a successful approve, show what was signed off and close the scenario. */

export interface ScriptApprovalInput {
  ok?: boolean;
  chapters?: number;
  plates?: number;
  approvedAt?: string;
  error?: string;
}

export interface ScriptApprovalPlan {
  close: boolean;
  proof: string;
  error: string;
}

export interface ClosableDialog {
  close?: () => void;
}

export function scriptApproveLabel(effective: string | null | undefined): string {
  return effective === 'changed' ? 'Re-approve and close' : 'Approve and close';
}

export function planScriptApproval({
  ok = false,
  chapters = 0,
  plates = 0,
  approvedAt = '',
  error = '',
}: ScriptApprovalInput = {}): ScriptApprovalPlan {
  if (!ok) return { close: false, proof: '', error: error || 'Not approved' };
  const when = approvedAt ? new Date(approvedAt).toLocaleString() : 'just now';
  return {
    close: true,
    proof: `${chapters} chapters · ${plates} plates · Approved ${when}`,
    error: '',
  };
}

export function finishScriptApproval(
  dialog: ClosableDialog | null | undefined,
  plan: ScriptApprovalPlan | null | undefined,
): boolean {
  if (!plan?.close) return false;
  dialog?.close?.();
  return true;
}
