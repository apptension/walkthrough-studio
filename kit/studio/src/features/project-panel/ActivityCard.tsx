import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Job } from '@/api/types';
import { elapsedSec, fmt } from '@/desk/format';
import { stopAllWork } from '@/desk/jobs';
import { desk, useDesk } from '@/desk/store';
import { HelpTip } from '@/ui/HelpTip';
import { SecIcon, ZenArt } from '@/ui/icons';
import { statusMark } from '@/logic/pipelineUi';
import { describeJob, type JobStage } from '@/logic/progress';

import { paintAgentStream } from './agentStream';
import { useWorkPending } from './useWorkPending';

const HELP = 'Live progress of the current job. Expand log shows raw output if something fails.';

const RUNNING = new Set(['running', 'queued', 'cancelling', 'waiting']);

/**
 * The bay's Activity section: Stop / log toggle and `#renderLiveCard`, painted from
 * `renderJob` (`paintWork('renderLive', job)` + `updateRenderLive`; idle is `setRenderIdle`).
 */
export function ActivitySection() {
  const job = useDesk((s) => s.renderJob);
  const expanded = useDesk((s) => s.renderLogExpanded);
  const pending = useWorkPending();
  // The toggle's copy: a click says Collapse/Expand; the next job paint says Hide/Show.
  const [clicked, setClicked] = useState<{ job: Job | null; text: string } | null>(null);
  const toggleText = clicked && clicked.job === job ? clicked.text : expanded ? 'Hide log' : 'Show log';

  return (
    <div className="render-section render-live-block">
      <div className="render-section-label">
        <span data-ico="activity" data-help={HELP} className="has-help">
          <SecIcon name="activity" />
          Activity
          <HelpTip text={HELP} label="Activity" />
        </span>
        <div className="render-section-actions">
          <button
            type="button"
            id="btnStopRender"
            className="btn tiny danger"
            hidden={!pending}
            title="Stop running job and clear queue"
            onClick={() => void stopAllWork({ reason: 'Stopped' })}
          >
            Stop
          </button>{' '}
          <button
            type="button"
            id="btnRenderLogToggle"
            className="btn tiny"
            hidden={!job?.log?.length}
            onClick={() => {
              const next = !desk.get().renderLogExpanded;
              desk.set({ renderLogExpanded: next });
              setClicked({ job, text: next ? 'Collapse log' : 'Expand log' });
            }}
          >
            {job ? toggleText : 'Expand log'}
          </button>
        </div>
      </div>
      <ActivityCard job={job} expanded={expanded} />
    </div>
  );
}

function ActivityCard({ job, expanded }: { job: Job | null; expanded: boolean }) {
  const view = useMemo(() => (job ? describeJob(job) : null), [job]);
  const live = useDesk((s) => s.live);
  const warmingUp = useDesk((s) => s.liveWarmingUp);
  const streamRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useLayoutEffect(() => {
    paintAgentStream(streamRef.current, job, { variant: 'bay' });
  }, [job]);

  const logText = useMemo(() => (job?.log || []).map((l) => (typeof l === 'string' ? l : l.line)).join('\n').slice(-8000), [job]);

  useEffect(() => {
    const log = logRef.current;
    if (expanded && log) log.scrollTop = log.scrollHeight;
  }, [expanded, logText]);

  const running = job ? RUNNING.has(job.status) : false;
  const failed = job?.status === 'failed' || job?.status === 'needs-agent';
  const streamed = job?.kind === 'improve' && (job.stream?.entries || []).length > 0;
  const stages = view?.stages ?? [];
  const nowHidden = !view || !view.now || streamed || (stages.length > 0 && !failed);
  const pct = Math.round((view?.progress ?? 0) * 100);
  const thumbOn = Boolean(job && live.thumb && live.src);

  return (
    <div className={job ? 'render-live-card' : 'render-live-card is-idle'} id="renderLiveCard">
      <div className="work-head">
        <div className="work-kicker">
          <span className="activity-spinner" id="renderSpinner" hidden={!running} />
          <span id="renderLiveElapsed" className="activity-elapsed" hidden={!job}>
            {job ? fmt(elapsedSec(job)) : '0:00'}
          </span>
          <span id="renderLivePhase" className={view ? `badge ${view.badge}`.trim() : 'badge'} hidden={!view}>
            {view ? view.statusLabel : '—'}
          </span>
        </div>
        <div id="renderLiveArt" className="zen-slot" data-art="tumbleweed" aria-hidden="true" hidden={Boolean(job)}>
          <ZenArt art="tumbleweed" />
        </div>
        <img
          id="activityLive"
          className={thumbOn && warmingUp && live.recording ? 'activity-live is-warming' : 'activity-live'}
          alt="Live page"
          hidden={!thumbOn}
          src={thumbOn ? (live.src ?? undefined) : undefined}
        />{' '}
        <strong id="renderLiveTitle" className="work-title">
          {view ? view.title : 'All quiet on set'}
        </strong>
        <p id="renderLiveMeta" className="work-summary">
          {view ? view.summary : 'Render above, or queue a single step below.'}
        </p>
      </div>
      <div className="work-bar" id="renderLiveBar" hidden={!stages.length} aria-valuenow={view ? pct : undefined}>
        <span style={view ? { width: `${pct}%` } : undefined} />
      </div>
      <p id="renderLiveNow" className="session-now" hidden={nowHidden}>
        {view?.now ?? ''}
      </p>
      <WorkStages stages={stages} />
      <div ref={streamRef} id="renderLiveStream" className="agent-stream agent-stream--bay is-empty" aria-label="Live output" />
      <pre ref={logRef} id="renderLiveLog" className="activity-log render-log" hidden={!job || !expanded}>
        {job ? logText : ''}
      </pre>
    </div>
  );
}

/** `#renderStages` (`patchStageList`): keyed rows, so a running ring keeps spinning. */
function WorkStages({ stages }: { stages: JobStage[] }) {
  const olRef = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    const ol = olRef.current;
    const active = ol?.querySelector<HTMLElement>('li.run, li.fail');
    if (!ol || !active) return;
    const top = active.offsetTop;
    const bottom = top + active.offsetHeight;
    if (top < ol.scrollTop) ol.scrollTop = top;
    else if (bottom > ol.scrollTop + ol.clientHeight) ol.scrollTop = bottom - ol.clientHeight;
  }, [stages]);
  return (
    <ol ref={olRef} id="renderStages" className="work-stages" hidden={!stages.length}>
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
