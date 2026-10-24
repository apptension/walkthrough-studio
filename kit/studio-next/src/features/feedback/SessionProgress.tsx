import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { stopAllWork } from '@/desk/jobs';
import { useDesk } from '@/desk/store';
import { cn } from '@/lib/cn';
import { Icon, ZenArt } from '@/ui/icons';

import { Barrel } from './Barrel';
import { THINK_ORDER, thinkClass, useSession } from './session';
import { StreamHost } from './StreamHost';
import { WorkStages } from './WorkStages';

const PIPE_LABELS: Record<(typeof THINK_ORDER)[number], string> = {
  think: 'Think',
  edit: 'Edit',
  html: 'HTML',
  preview: 'Preview',
  approve: 'Decide',
};

/** Matches `.session-status-spin`'s collapse transition. */
const SPIN_EXIT_MS = 420;

/** `badge ok` / `badge bad` / `badge run` → the label's tone. */
function toneOf(className: string, text: string): string {
  if (/\bok\b/.test(className)) return 'ok';
  if (/\b(bad|err)\b/.test(className)) return 'bad';
  if (/^idle$/i.test(text.trim())) return 'idle';
  return 'neutral';
}

/** Left of the title: the loader while the agent works, morphing into the result once it stops. */
function StatusSlot() {
  const { spinner, phase } = useSession(useShallow((s) => ({ spinner: s.spinner, phase: s.phase })));
  const labelShown = !spinner && !phase.hidden;
  // The loader stays mounted while it shrinks away, then stops so its canvas idles.
  const [spinMounted, setSpinMounted] = useState(spinner);
  useEffect(() => {
    if (spinner) {
      setSpinMounted(true);
      return;
    }
    const timer = setTimeout(() => setSpinMounted(false), SPIN_EXIT_MS);
    return () => clearTimeout(timer);
  }, [spinner]);
  return (
    <span className="session-status" data-show={spinner ? 'spinner' : labelShown ? 'label' : 'none'}>
      <span className="session-status-spin" aria-hidden={!spinner}>
        <span className="activity-spinner" id="sessionSpinner" hidden={!spinMounted} />
      </span>
      <span
        id="sessionPhase"
        className="session-status-label"
        data-tone={toneOf(phase.className, phase.text)}
        hidden={!labelShown}
      >
        {phase.text}
      </span>
    </span>
  );
}

function StopButton() {
  const hidden = useDesk((s) => !(s.jobBusy || s.queue.length > 0));
  return (
    <button
      type="button"
      id="btnStopSession"
      className="session-stop"
      hidden={hidden}
      title="Stop agent and clear queue"
      aria-label="Stop"
      onClick={() => void stopAllWork({ reason: 'Stopped' })}
    >
      <Icon name="ui-stop" size={10} />
    </button>
  );
}

function SessionHeader({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { title, ticker, spinner, elapsed, decisionMode } = useSession(
    useShallow((s) => ({
      title: s.title,
      ticker: s.ticker,
      spinner: s.spinner,
      elapsed: s.elapsed,
      decisionMode: s.decisionMode,
    })),
  );
  const what = decisionMode ? 'agent run' : 'agent panel';
  return (
    <div className="session-rail-chrome">
      <StatusSlot />
      <div className="session-headline" onClick={onToggle}>
        <strong id="sessionTitle" className="work-title" title={title}>
          {title}
        </strong>
        <Barrel id="sessionTicker" lines={ticker} live={spinner} />
      </div>
      <span id="sessionElapsed" className={cn('activity-elapsed', spinner && 'is-live')} hidden={elapsed.hidden}>
        {elapsed.text}
      </span>
      <StopButton />
      <button
        type="button"
        id="btnSessionCollapse"
        className="session-rail-collapse"
        aria-expanded={open}
        aria-controls="sessionFold"
        aria-label={open ? `Collapse ${what}` : `Expand ${what}`}
        title={open ? 'Collapse' : decisionMode ? 'Show every step of the run' : 'Expand'}
        onClick={onToggle}
      >
        <Icon name="chevron" size={14} />
      </button>
      <WorkBar />
    </div>
  );
}

/** Hairline under the header: real progress when stages report it, a sweep while the agent works. */
function WorkBar() {
  const { bar, spinner } = useSession(useShallow((s) => ({ bar: s.bar, spinner: s.spinner })));
  const indeterminate = bar.hidden && spinner;
  return (
    <div
      className={cn('work-bar', indeterminate && 'is-indeterminate')}
      id="sessionBar"
      hidden={bar.hidden && !indeterminate}
      aria-valuenow={indeterminate ? undefined : (bar.pct ?? undefined)}
    >
      <span style={indeterminate || bar.pct == null ? undefined : { width: `${bar.pct}%` }} />
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

/** Raw output — only for jobs that tell their story no other way. */
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

/**
 * `#sessionProgress`: the header strip (status, title + rolling activity, elapsed, Stop, chevron),
 * the decision card when one is open, and the fold with the whole run underneath.
 */
export function SessionProgress({
  ref,
  foldRef,
  open,
  onToggle,
  children,
}: {
  ref?: Ref<HTMLDivElement>;
  foldRef?: Ref<HTMLDivElement>;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  const { idle, art, meta, now, stages, streamJob } = useSession(
    useShallow((s) => ({
      idle: s.idle,
      art: s.art,
      meta: s.meta,
      now: s.now,
      stages: s.stages,
      streamJob: s.streamJob,
    })),
  );
  return (
    <div ref={ref} className={cn('session-progress', idle && 'is-idle')} id="sessionProgress">
      <SessionHeader open={open} onToggle={onToggle} />
      {children}
      <div ref={foldRef} id="sessionFold" className="session-rail-fold" aria-hidden={!open}>
        <div className="session-rail-fold-inner">
          <div id="sessionArt" className="zen-slot" data-art="sleep" aria-hidden="true" hidden={!art}>
            <ZenArt art="sleep" />
          </div>
          <p id="sessionMeta" className="work-summary">
            {meta}
          </p>
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
          <SessionLog />
        </div>
      </div>
    </div>
  );
}
