import { useLayoutEffect, useRef } from 'react';

import type { Job } from '@/api/types';
import { paintAgentStream, type StreamVariant } from '@/features/project-panel/agentStream';

interface StreamHostProps {
  id: string;
  className: string;
  label: string;
  variant: StreamVariant;
  job: Job | null;
}

/** A `paintAgentStream` host: React owns the element, the stream controller owns its contents. */
export function StreamHost({ id, className, label, variant, job }: StreamHostProps) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    paintAgentStream(ref.current, job, { variant });
  }, [job, variant]);
  return <div ref={ref} id={id} className={className} aria-label={label} />;
}
