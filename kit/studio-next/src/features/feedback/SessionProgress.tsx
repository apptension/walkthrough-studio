import { useLayoutEffect, useRef, type Ref } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { stopAllWork } from '@/desk/jobs';
import { useDesk } from '@/desk/store';
import { cn } from '@/lib/cn';
import { Icon, ZenArt } from '@/ui/icons';

import { THINK_ORDER, thinkClass, toggleSessionLog, useSession } from './session';
import { StreamHost } from './StreamHost';
import { WorkStages } from './WorkStages';

const PIPE_LABELS: Record<(typeof THINK_ORDER)[number], string> = {
  think: 'Think',
  edit: 'Edit',
  html: 'HTML',
  preview: 'Preview',
  approve: 'Decide',
};

function WorkKicker() {
  const { spinner, elapsed, phase, logButton } = useSession(
    useShallow((s) => ({ spinner: s.spinner, elapsed: s.elapsed, phase: s.phase, logButton: s.logButton })),
  );
  const stopHidden = useDesk((s) => !(s.jobBusy || s.queue.length > 0));
  const expanded = useDesk((s) => s.activityExpanded);
  return (
    <div className="work-kicker">
      <span className="activity-spinner" id="sessionSpinner" hidden={!spinner} />
      <span id="sessionElapsed" className="activity-elapsed" hidden={elapsed.hidden}>
        {elapsed.text}
      </span>
      <span id="sessionPhase" className={phase.className} hidden={phase.hidden}>
        {phase.text}
      </span>
      <button
        type="button"
        id="btnStopSession"
        className="btn tiny danger"
        hidden={stopHidden}
        title="Stop agent and clear queue"
        onClick={() => void stopAllWork({ reason: 'Stopped' })}
      >
        Stop
      </button>
      <button type="button" id="btnSessionLog" className="btn tiny" hidden={!logButton} onClick={toggleSessionLog}>
        {expanded ? 'Hide log' : 'Log'}
      </button>
    </div>
  );
}

function SessionPipe() {
  const { hidden, step, allDone } = useSession(
    useShallow((s) => ({ hidden: s.pipeHidden, step: s.thinkStep, allDone: s.thinkAllDone })),
  );
  return (
    <ol id="sessionPipe" className="session-pipe" aria-label="Pipeline status" hidden={hidden}>
      {THINK_ORDER.map((id) => (
        <li key={id} data-step={id} className={thinkClass(id, step, allDone)}>
          {PIPE_LABELS[id]}
        </li>
      ))}
    </ol>
  );
}

function SessionLog() {
  const log = useSession((s) => s.log);
  const ref = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    if (!log.hidden && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [log]);
  return (
    <pre ref={ref} id="sessionLog" className="activity-log" hidden={log.hidden}>
      {log.text}
    </pre>
  );
}

/** `#sessionProgress`: the live agent/job card under the decision. */
export function SessionProgress({
  ref,
  collapsed,
  onToggleCollapsed,
}: {
  ref?: Ref<HTMLDivElement>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const { idle, art, title, meta, bar, now, stages, streamJob } = useSession(
    useShallow((s) => ({
      idle: s.idle,
      art: s.art,
      title: s.title,
      meta: s.meta,
      bar: s.bar,
      now: s.now,
      stages: s.stages,
      streamJob: s.streamJob,
    })),
  );
  return (
    <div ref={ref} className={cn('session-progress', idle && 'is-idle')} id="sessionProgress">
      <div className="session-rail-chrome">
        <WorkKicker />
        <strong id="sessionTitle" className="work-title">
          {title}
        </strong>
        <button
          type="button"
          id="btnSessionCollapse"
          className="session-rail-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand agent panel' : 'Collapse agent panel'}
          title={collapsed ? 'Expand' : 'Collapse'}
          onClick={onToggleCollapsed}
        >
          {/* Same `plus` glyph either way — CSS clips it to a minus when expanded. */}
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="session-rail-fold" aria-hidden={collapsed}>
        <div className="session-rail-fold-inner">
          <div id="sessionArt" className="zen-slot" data-art="sleep" aria-hidden="true" hidden={!art}>
            <ZenArt art="sleep" />
          </div>
          <p id="sessionMeta" className="work-summary">
            {meta}
          </p>
          <div
            className="work-bar"
            id="sessionBar"
            hidden={bar.hidden}
            aria-valuenow={bar.pct ?? undefined}
          >
            <span style={bar.pct == null ? undefined : { width: `${bar.pct}%` }} />
          </div>
          <p id="sessionNow" className="session-now" hidden={now.hidden}>
            {now.text}
          </p>
          <WorkStages id="sessionStages" hidden={stages.hidden} stages={stages.list} />
          <SessionPipe />
          <StreamHost
            id="sessionStream"
            className="agent-stream agent-stream--rail is-empty"
            label="Agent output"
            variant="rail"
            job={streamJob}
          />
        </div>
      </div>
      <SessionLog />
    </div>
  );
}
