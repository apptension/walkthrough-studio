import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';

import { autoFixPipelineVoice, fixPipelineStep, manualFixPipelineVoice, retryPipelineFrom } from '@/desk/jobs';
import { useDesk } from '@/desk/store';
import { HelpTip } from '@/ui/HelpTip';
import { SecIcon } from '@/ui/icons';

import { patchRows, pipelineRows } from './pipelineRows';

const HELP =
  'The steps of the running render: record the app, produce the cut, mix voice and music, export. Each one turns green as it finishes.';

/**
 * The bay's pipeline (`renderSteps` / `patchRows`). The `<ol>` has no React
 * children: rows are patched in place so a running spinner never restarts.
 */
export function PipelineSection() {
  const pipeline = useDesk((s) => s.pipeline);
  const failure = useDesk((s) => s.pipelineFailure);
  const busy = useDesk((s) => s.jobBusy);
  const olRef = useRef<HTMLOListElement>(null);
  // `#pipelineIdle` only appears once a pipeline is cleared (Stop), as `renderSteps(null)` did.
  const [cleared, setCleared] = useState(false);
  const had = useRef(false);

  const steps = pipeline?.length ? pipeline : null;

  useLayoutEffect(() => {
    const ol = olRef.current;
    if (!ol) return;
    if (!steps) {
      ol.innerHTML = '';
      return;
    }
    patchRows(ol, pipelineRows(steps, { busy, failure: failure != null, failureError: failure?.error || '' }));
  }, [steps, busy, failure]);

  useEffect(() => {
    if (steps) {
      had.current = true;
      setCleared(false);
    } else if (had.current) {
      setCleared(true);
    }
  }, [steps]);

  const onClick = (e: MouseEvent<HTMLOListElement>) => {
    const target = e.target instanceof Element ? e.target : null;
    const retry = target?.closest<HTMLElement>('[data-pipe-retry]');
    if (retry) {
      e.preventDefault();
      retryPipelineFrom(retry.dataset['pipeRetry']);
      return;
    }
    const autofix = target?.closest<HTMLElement>('[data-pipe-autofix]');
    if (autofix) {
      e.preventDefault();
      void autoFixPipelineVoice(autofix.dataset['pipeAutofix']);
      return;
    }
    const manual = target?.closest<HTMLElement>('[data-pipe-manual]');
    if (manual) {
      e.preventDefault();
      void manualFixPipelineVoice(manual.dataset['pipeManual']);
      return;
    }
    const fix = target?.closest<HTMLElement>('[data-pipe-fix]');
    if (fix) {
      e.preventDefault();
      fixPipelineStep(fix.dataset['pipeFix']);
    }
  };

  return (
    <div className="render-section render-pipeline-block">
      <div className="render-section-label">
        <span data-ico="pipeline" data-help={HELP} className="has-help">
          <SecIcon name="pipeline" />
          Pipeline
          <HelpTip text={HELP} label="Pipeline" />
        </span>
      </div>
      <ol ref={olRef} id="actionSteps" className="render-pipeline" hidden={!steps} onClick={onClick} />
      <p id="pipelineIdle" className="meta render-idle-hint" hidden={Boolean(steps) || !cleared} />
    </div>
  );
}
