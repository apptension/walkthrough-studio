import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { cn } from '@/lib/cn';

import { readRailCollapsed, writeRailCollapsed } from './railCollapse';
import { SessionDecide } from './SessionDecide';
import { SessionProgress } from './SessionProgress';
import { toggleProposalWork, useSession } from './session';
import { useFeedbackBridge } from './useFeedbackBridge';

/**
 * `#sessionRail`: fixed at the bottom of the tools panel — the live agent/job and the decide
 * actions. One chevron folds the run: outside a decision it collapses the card (remembered in
 * localStorage); while deciding it reveals the run under the decision, closed by default.
 */
export function SessionRail() {
  useFeedbackBridge();
  const railRef = useRef<HTMLDivElement>(null);
  const foldRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(readRailCollapsed);
  const { running, done, failed, decisionMode, showWork } = useSession(
    useShallow((s) => ({
      running: s.running,
      done: s.done,
      failed: s.failed,
      decisionMode: s.decisionMode,
      showWork: s.showWork,
    })),
  );
  const open = decisionMode ? showWork : !collapsed;

  const toggle = () => {
    if (decisionMode) {
      if (toggleProposalWork()) {
        requestAnimationFrame(() => foldRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
      }
      return;
    }
    setCollapsed((prev) => {
      writeRailCollapsed(!prev);
      return !prev;
    });
  };

  return (
    <div
      ref={railRef}
      id="sessionRail"
      className={cn(
        'session-rail',
        running && 'is-running',
        done && 'is-done',
        failed && 'is-failed',
        decisionMode && 'decision-mode',
        showWork && 'show-work',
        !open && 'is-collapsed',
      )}
      aria-live="polite"
    >
      <SessionProgress foldRef={foldRef} open={open} onToggle={toggle}>
        <SessionDecide railRef={railRef} />
      </SessionProgress>
    </div>
  );
}
