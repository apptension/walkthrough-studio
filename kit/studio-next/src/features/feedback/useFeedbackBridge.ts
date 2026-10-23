import { useEffect } from 'react';

import { bridges } from '@/desk/bridge';
import { useDesk } from '@/desk/store';

import { runImproveJob, startImprove } from './improve';
import { hideProposal, paintSession, resetThinkSteps, sessionStopped, setSessionIdle, setThinkStep } from './session';

/**
 * Register `bridges.feedback` while the rail is mounted, and paint the rail from every job
 * `showActivityDock` hands to the session surface (`sessionJob`).
 */
export function useFeedbackBridge(): void {
  useEffect(() => {
    const bridge = {
      runImproveJob: (item: Parameters<typeof runImproveJob>[0], opts: { signal: AbortSignal }) => runImproveJob(item, opts),
      hideProposal,
      resetThinkSteps,
      setSessionIdle,
      startImprove,
      setThinkStep,
      sessionStopped,
    };
    bridges.feedback = bridge;
    const unsubscribe = useDesk.subscribe((s, prev) => {
      if (s.sessionJob && s.sessionJob !== prev.sessionJob) paintSession(s.sessionJob);
    });
    return () => {
      unsubscribe();
      if (bridges.feedback === bridge) bridges.feedback = null;
    };
  }, []);
}
