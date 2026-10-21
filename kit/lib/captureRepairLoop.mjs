const DEFAULT_REPAIRS = 3;
const MAX_REPAIRS = 5;

export function captureRepairLimit(env = process.env) {
  const value = Number.parseInt(env?.WALKTHROUGH_CAPTURE_REPAIRS, 10);
  if (!Number.isFinite(value)) return DEFAULT_REPAIRS;
  return Math.max(0, Math.min(MAX_REPAIRS, value));
}

export function captureRepairDecision({ captureAttempt = 1, maxRepairs = DEFAULT_REPAIRS, repairable = false } = {}) {
  const repairs = Math.max(0, captureAttempt - 1);
  if (!repairable) return { action: 'fail', reason: 'not-repairable', repairs };
  if (repairs >= maxRepairs) return { action: 'fail', reason: 'exhausted', repairs };
  return {
    action: 'repair',
    repairAttempt: captureAttempt,
    nextCaptureAttempt: captureAttempt + 1,
    remaining: maxRepairs - captureAttempt,
  };
}
