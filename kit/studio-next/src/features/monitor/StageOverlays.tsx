import { useRef } from 'react';

import { useDesk } from '@/desk/store';
import { Icon } from '@/ui/icons';

import { closeProgramBuild, continueSignIn, dismissRecordFailure, fixRecordFailure, openBuildLog, openBuildShot } from './actions';
import { recordFailureInfo, recordFailureKey } from './model';
import { useTransitionToggle } from './useTransitionToggle';

/** Keep the last non-null value, the way the legacy painters left text in place when hiding. */
function useLast<T>(value: T | null | undefined): T | null {
  const last = useRef<T | null>(null);
  if (value != null) last.current = value;
  return last.current;
}

/** `#livePreview` — the latest capture frame, shown on the Live pane. */
function LivePreview() {
  const src = useDesk((s) => s.live.src);
  const onLive = useDesk((s) => s.monitorMode === 'live');
  const warming = useDesk((s) => s.live.warming);
  const shown = useLast(src);
  return (
    <img
      id="livePreview"
      className={warming ? 'live-preview is-warming' : 'live-preview'}
      alt="Live recording"
      hidden={!onLive || !src}
      {...(shown ? { src: shown } : {})}
    />
  );
}

/** `#liveBadge` — Live / Repairing on the Live pane while a capture runs. */
function LiveBadge() {
  const badge = useDesk((s) => s.live.badge);
  const recording = useDesk((s) => s.live.recording);
  const repairing = useDesk((s) => s.live.repairing);
  const onLive = useDesk((s) => s.monitorMode === 'live');
  const show = onLive && (recording || repairing) && Boolean(badge);
  const cls = ['live-badge'];
  if (badge === 'Live' || recording) cls.push('is-live');
  if (badge === 'Repairing' && !recording) cls.push('is-repairing');
  return (
    <div id="liveBadge" className={cls.join(' ')} hidden={!show}>
      <i />
      <span id="liveBadgeText">
        {badge || 'Live'}
      </span>
    </div>
  );
}

const WARMUP_PROPS = ['opacity'] as const;

/** `#liveWarmup` — `setLiveWarmup()`: blur veil until the first fresh frame of a take. */
function LiveWarmup() {
  const warming = useDesk((s) => s.live.warming);
  const ref = useRef<HTMLDivElement>(null);
  const view = useTransitionToggle(warming, ref, WARMUP_PROPS);
  return (
    <div ref={ref} id="liveWarmup" className={view.active ? 'live-warmup is-on' : 'live-warmup'} hidden={view.hidden} aria-hidden="true">
      <div className="live-warmup-sweep" />
      <div className="live-warmup-card">
        <i className="live-warmup-spin" />
        <span>
          Warming up…
        </span>
      </div>
    </div>
  );
}

/** `#signInWait` — `paintSignInWait()`. */
function SignInWait() {
  const wait = useDesk((s) => s.signInWait);
  const shown = useLast(wait);
  return (
    <div id="signInWait" className="sign-in-wait" hidden={!wait}>
      <strong id="signInWaitTitle">
        {shown?.title}
      </strong>
      <p id="signInWaitNext">
        {shown?.next}
      </p>
      <button type="button" id="signInContinue" className="btn primary" onClick={() => void continueSignIn()}>
        Continue
      </button>
    </div>
  );
}

/** `#recordFailure` — the failure panel `renderActionCard` paints from `v.recordFailure`. */
function RecordFailurePanel() {
  const video = useDesk((s) => s.video);
  const slug = useDesk((s) => s.slug);
  const dismissedKey = useDesk((s) => s.recordFailureDismissed);
  const capturing = useDesk((s) => s.live.recording || s.live.repairing);
  const info = recordFailureInfo(video);
  const key = recordFailureKey(slug, info);
  const dismissed = Boolean(key && dismissedKey === key);
  const shot = useLast(info ? info.screenshot || '' : null);
  const painted = video != null;
  return (
    <figure id="recordFailure" className="record-failure" hidden={!info || dismissed || capturing} role="status" aria-live="polite">
      <img id="recordFailureShot" alt="Page when the recording failed" {...(shot ? { src: shot } : {})} />
      <figcaption>
        <span className="record-failure-label">
          Recording failed
        </span>
        {' '}
        <strong id="recordFailureReason" {...(painted ? { title: info?.technical || '' } : {})}>
          {info?.reason || ''}
        </strong>
        {' '}
        <span id="recordFailureUrl" className="record-failure-url">
          {info?.url || ''}
        </span>
        {' '}
        <span id="recordFailureNext" className="record-failure-next">
          {info?.next || ''}
        </span>
      </figcaption>
      <div className="record-failure-actions">
        <button type="button" id="recordFailureFix" className="btn primary compact" onClick={fixRecordFailure}>
          Fix with AI
        </button>
        {' '}
        <button
          type="button"
          id="recordFailureDismiss"
          className="record-failure-dismiss"
          title="Dismiss"
          aria-label="Dismiss recording failure"
          onClick={dismissRecordFailure}
        >
          <Icon name="ui-x" size={14} />
        </button>
      </div>
    </figure>
  );
}

/** `#programBuild` — `paintProgramBuild()`: the pipeline's progress / failure over Program. */
function ProgramBuild() {
  const overlay = useDesk((s) => s.programBuild);
  const shown = useLast(overlay);
  const fail = shown?.tone === 'fail';
  const cls = ['program-build', fail ? 'is-fail' : 'is-run'];
  return (
    <div
      id="programBuild"
      className={cls.join(' ')}
      hidden={!overlay}
      role={fail ? 'alert' : 'status'}
      aria-live={fail ? 'assertive' : 'polite'}
    >
      <span className="program-build-icon" aria-hidden="true">
        {fail ? <Icon name="ui-x" size={16} /> : <i className="program-build-spin" />}
      </span>
      <div className="program-build-text">
        <strong id="programBuildTitle">
          {shown?.title || ''}
        </strong>
        <p id="programBuildDetail">
          {shown?.detail || ''}
        </p>
      </div>
      <div className="program-build-actions">
        <button type="button" id="programBuildShot" className="btn compact" hidden={!shown?.screenshot} onClick={() => openBuildShot(shown?.screenshot)}>
          Open screenshot
        </button>
        <button type="button" id="programBuildLog" className="btn compact" hidden={!shown?.log} onClick={() => openBuildLog(shown?.log)}>
          Open log
        </button>
        <button
          type="button"
          id="programBuildClose"
          className="program-build-close"
          title="Close"
          aria-label="Close this message"
          onClick={closeProgramBuild}
        >
          <Icon name="ui-x" size={14} />
        </button>
      </div>
    </div>
  );
}

export function StageOverlays() {
  return (
    <>
      <LivePreview />
      <LiveBadge />
      <LiveWarmup />
      <SignInWait />
      <RecordFailurePanel />
      <ProgramBuild />
    </>
  );
}
