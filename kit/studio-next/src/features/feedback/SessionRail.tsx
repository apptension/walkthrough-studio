import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { cn } from '@/lib/cn';

import { readRailCollapsed, writeRailCollapsed } from './railCollapse';
import { SessionDecide } from './SessionDecide';
import { SessionProgress } from './SessionProgress';
import { useSession } from './session';
import { useFeedbackBridge } from './useFeedbackBridge';

/**
 * `#sessionRail`: fixed at the bottom of the tools panel — the live agent/job and the decide
 * actions. Collapses like the right-rail `PanelSection`s (remembered in localStorage), but the
 * Log toggle and raw log stay reachable either way — collapsing only folds the status card, not
 * your way back to the last logs.
 */
export function SessionRail() {
  useFeedbackBridge();
  const railRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(readRailCollapsed);
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      writeRailCollapsed(next);
      return next;
    });
  };
  const { running, done, failed, decisionMode, showWork } = useSession(
    useShallow((s) => ({
      running: s.running,
      done: s.done,
      failed: s.failed,
      decisionMode: s.decisionMode,
      showWork: s.showWork,
    })),
  );
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
        collapsed && 'is-collapsed',
      )}
      aria-live="polite"
    >
      <SessionDecide railRef={railRef} progressRef={progressRef} />
      <SessionProgress ref={progressRef} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
    </div>
  );
}
