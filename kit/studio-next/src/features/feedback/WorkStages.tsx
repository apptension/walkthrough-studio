import { useLayoutEffect, useRef } from 'react';

import type { JobStage } from '@/logic/progress';
import { statusMark } from '@/logic/pipelineUi';

interface WorkStagesProps {
  id: string;
  hidden: boolean;
  stages: JobStage[];
}

/**
 * `patchStageList(ol, stages)`: rows keyed by stage id, so a row's mark is only replaced when
 * its state changes and the running ring keeps spinning. The active row stays in view.
 */
export function WorkStages({ id, hidden, stages }: WorkStagesProps) {
  const ref = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    const ol = ref.current;
    const active = ol?.querySelector<HTMLElement>('li.run, li.fail');
    if (!ol || !active) return;
    const top = active.offsetTop;
    const bottom = top + active.offsetHeight;
    if (top < ol.scrollTop) ol.scrollTop = top;
    else if (bottom > ol.scrollTop + ol.clientHeight) ol.scrollTop = bottom - ol.clientHeight;
  }, [stages]);
  return (
    <ol ref={ref} id={id} className="work-stages" hidden={hidden}>
      {stages.map((s) => {
        const key = String(s.id ?? s.label);
        return (
          <li key={key} data-stage-id={key} data-state={s.state} className={s.state}>
            <span className="work-mark" dangerouslySetInnerHTML={{ __html: statusMark(s.state) }} />
            <span className="work-copy">
              <strong>{s.label}</strong>
              <em>{s.detail || ''}</em>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
