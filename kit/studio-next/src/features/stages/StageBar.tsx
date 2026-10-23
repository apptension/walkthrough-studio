import { useMemo } from 'react';

import { useDesk } from '@/desk/store';

import { onStageClick } from './actions';
import { currentStage, STAGE_LABEL, STAGE_ORDER, stageHint, stageMetaText, stages, type StageKey, type StageState } from './model';
import { useWorkflowBridge } from './useWorkflowBridge';

interface StageButtonProps {
  stage: StageKey;
  state: StageState | null;
  current: boolean;
}

function StageButton({ stage, state, current }: StageButtonProps) {
  return (
    <li>
      <button
        type="button"
        className={`pstage${current ? ' current' : ''}`}
        data-stage={stage}
        data-tone={state?.tone}
        aria-current={state ? (current ? 'step' : 'false') : undefined}
        onClick={() => onStageClick(stage)}
      >
        <span className="stage-dot" aria-hidden="true" />
        <span className="stage-text">
          <strong>{STAGE_LABEL[stage]}</strong>
          <em data-stage-meta={stage}>{state ? stageMetaText(stage, state) : '—'}</em>
        </span>
      </button>
    </li>
  );
}

/** `#stageBar` — `renderStageBar(v)` from `kit/studio/workflow.js`. */
export function StageBar() {
  const video = useDesk((s) => s.video);
  useWorkflowBridge();
  const view = useMemo(() => {
    if (!video) return null;
    const map = stages(video);
    return { map, current: currentStage(map), hint: stageHint(map) };
  }, [video]);

  return (
    <nav id="stageBar" className="stage-bar" aria-label="Production stages">
      <ol className="stage-list">
        {STAGE_ORDER.map((key) => (
          <StageButton key={key} stage={key} state={view?.map[key] ?? null} current={view?.current === key} />
        ))}
      </ol>
      <p id="stageHint" className="stage-hint" aria-live="polite" data-tone={view?.hint.tone || undefined}>
        {view?.hint.text}
      </p>
    </nav>
  );
}
