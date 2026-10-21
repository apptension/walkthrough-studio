/** After a successful approve, show what was signed off and close the scenario. */

export function scriptApproveLabel(effective) {
  return effective === 'changed' ? 'Re-approve and close' : 'Approve and close';
}

export function planScriptApproval({ ok = false, chapters = 0, plates = 0, approvedAt = '', error = '' } = {}) {
  if (!ok) return { close: false, proof: '', error: error || 'Not approved' };
  const when = approvedAt ? new Date(approvedAt).toLocaleString() : 'just now';
  return {
    close: true,
    proof: `${chapters} chapters · ${plates} plates · Approved ${when}`,
    error: '',
  };
}

export function finishScriptApproval(dialog, plan) {
  if (!plan?.close) return false;
  dialog?.close?.();
  return true;
}
