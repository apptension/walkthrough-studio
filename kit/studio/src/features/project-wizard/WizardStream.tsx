import { useLayoutEffect, useRef } from 'react';

import type { Job } from '@/api/types';
import { paintAgentStream } from '@/features/project-panel/agentStream';

/** A wizard `.agent-stream` host; `paintAgentStream` owns its children and live classes. */
export function WizardStream({ id, job, label }: { id: string; job: Job | null; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    paintAgentStream(ref.current, job, { variant: 'wizard' });
  }, [job]);
  return <div ref={ref} id={id} className="agent-stream agent-stream--wizard is-empty" aria-label={label} />;
}
