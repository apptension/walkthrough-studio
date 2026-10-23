import type { VideoSummary } from '@/api/types';
import { describeRecordFailure, recordFailureAction } from '@/logic/recordFailure';

/**
 * What the Render bay, the header Render button and Program's empty state offer
 * next — `decideAction` from `kit/studio/app.js`.
 */

export interface ActionChoice {
  label: string;
  mode: string;
}

export interface RenderAction {
  kind: 'ok' | 'warn';
  status: string;
  title: string | null;
  reason: string | null;
  detail?: string;
  primary: ActionChoice | null;
  secondary: ActionChoice | null;
  makeLabel: string;
}

export function decideAction(v: VideoSummary): RenderAction {
  const f = v.freshness ?? ({} as Partial<VideoSummary['freshness']>);
  const hasLive = Boolean(f.liveAt);
  const hasDelivery = Boolean(v.hasDelivery || f.deliveryAt);
  const plateBad = Boolean(f.plateHealth?.bad);

  if (v.recordFailure) {
    const retry = recordFailureAction();
    const parsed = describeRecordFailure(v.recordFailure.reason);
    const failure = v.recordFailure.technical
      ? v.recordFailure
      : { ...v.recordFailure, reason: parsed.reason, technical: parsed.technical };
    return {
      kind: 'warn',
      status: 'Record failed',
      title: failure.reason,
      reason: failure.next || v.recordFailure.next,
      detail: [failure.technical, failure.url].filter(Boolean).join(' · '),
      primary: { label: retry.label, mode: retry.mode },
      secondary: null,
      makeLabel: retry.label,
    };
  }

  if (!hasLive && !hasDelivery) {
    return {
      kind: 'warn',
      status: 'Not rendered',
      title: 'Render your first sequence',
      reason: 'Records the app, cuts it with the plates, adds voice and music, and exports, in one pass.',
      primary: { label: 'Render', mode: 'full' },
      secondary: null,
      makeLabel: 'Render',
    };
  }
  if (f.needsRecord) {
    return {
      kind: 'warn',
      status: 'Needs re-record',
      title: 'Re-record the app',
      reason: 'The flow changed since the last recording, so the footage no longer matches the script.',
      detail: f.reason,
      primary: { label: 'Re-record & Render', mode: 'full' },
      secondary: { label: 'Render without re-record', mode: 'quick' },
      makeLabel: 'Re-record',
    };
  }
  if (plateBad) {
    return {
      kind: 'warn',
      status: 'Plate check failed',
      title: 'Re-render the brand plates',
      reason: 'A plate failed its frame check. Re-rendering makes its motion frame-accurate.',
      detail: f.reason,
      primary: { label: 'Re-render plates', mode: 'plates' },
      secondary: { label: 'Full Render', mode: 'quick' },
      makeLabel: 'Plates',
    };
  }
  if (!hasDelivery || f.stale) {
    return {
      kind: 'warn',
      status: 'Out of date',
      title: 'Render to see your changes',
      reason: 'Sources changed since the last render, so Program is behind.',
      detail: f.reason,
      primary: { label: 'Render', mode: 'quick' },
      secondary: { label: 'Re-record first', mode: 'full' },
      makeLabel: 'Render',
    };
  }
  return {
    kind: 'ok',
    status: 'Up to date',
    title: null,
    reason: null,
    primary: null,
    secondary: null,
    makeLabel: 'Render',
  };
}
