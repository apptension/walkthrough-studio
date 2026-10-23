import { useEffect, useMemo, useState } from 'react';

import { fmt } from '@/desk/format';
import { requestMake } from '@/desk/jobs';
import { useDesk } from '@/desk/store';
import { Icon } from '@/ui/icons';
import { firstShortHold } from '@/logic/voiceHold';

import { briefView } from './bayView';
import { CaptureBar } from './CaptureBar';
import { GuideCard } from './GuideCard';
import { PlateQcBanner } from './PlateQcBanner';
import { RecordChoice } from './RecordChoice';
import { TakeChoiceCard } from './TakeChoiceCard';

/** `#renderBrief` — the bay's status pill, headline and start actions (`renderActionCard`). */
export function RenderBrief() {
  return (
    <div className="render-brief" id="renderBrief">
      <BriefHead />
      <VoiceHoldWarn />
      <CaptureBar />
      <StartActions />
      <RecordChoice />
      <GuideCard />
      <TakeChoiceCard />
      <PlateQcBanner />
    </div>
  );
}

function useBrief() {
  const action = useDesk((s) => s.action);
  const jobBusy = useDesk((s) => s.jobBusy);
  const bay = useDesk((s) => s.bay);
  return useMemo(() => briefView(action, { jobBusy, bay }), [action, jobBusy, bay]);
}

function BriefHead() {
  const view = useBrief();
  return (
    <>
      <div className="render-brief-top">
        <span id="renderStatusPill" className={view.pillClass}>
          {view.pillText}
        </span>{' '}
        <RenderElapsed />
      </div>
      <h2 id="renderHeadline" className="render-headline">
        {view.headline}
      </h2>
      <p id="renderReason" className="render-reason" title={view.reasonTitle}>
        {view.reason}
      </p>
    </>
  );
}

/**
 * `#renderElapsed` — the pipeline clock. It appears when a make pipeline starts,
 * ticks while it runs, keeps its last reading after the run, and hides on Stop.
 */
export function RenderElapsed() {
  const startedAt = useDesk((s) => s.pipelineStartedAt);
  const stopRequested = useDesk((s) => s.stopRequested);
  const renderJob = useDesk((s) => s.renderJob);
  const [shown, setShown] = useState(false);
  const [text, setText] = useState('0:00');

  useEffect(() => {
    if (stopRequested) setShown(false);
  }, [stopRequested]);

  useEffect(() => {
    if (!startedAt) return;
    const paint = () => {
      setShown(true);
      setText(fmt(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))));
    };
    paint();
    const timer = setInterval(paint, 1000);
    return () => clearInterval(timer);
  }, [startedAt, renderJob]);

  return (
    <span id="renderElapsed" className="activity-elapsed" hidden={!shown}>
      {text}
    </span>
  );
}

function VoiceHoldWarn() {
  const scenes = useDesk((s) => s.video?.script?.scenes);
  const message = firstShortHold(scenes);
  return (
    <p id="voiceHoldWarn" className="voice-hold-warn" hidden={!message}>
      {message}
    </p>
  );
}

function StartActions() {
  const view = useBrief();
  const primaryBusy = useDesk((s) => Boolean(s.busy['btnActionPrimary']));
  const secondaryBusy = useDesk((s) => Boolean(s.busy['btnActionSecondary']));
  return (
    <div className="render-start-actions">
      <button
        type="button"
        id="btnActionPrimary"
        className={primaryBusy ? 'render-cta primary busy' : 'render-cta primary'}
        hidden={view.primary.hidden}
        data-mode={view.primary.mode}
        disabled={primaryBusy}
        onClick={() => requestMake(view.primary.mode)}
      >
        <Icon name="ui-play-fill" size={14} /> <span className="cta-label">{view.primary.label}</span>
      </button>{' '}
      <button
        type="button"
        id="btnActionSecondary"
        className={secondaryBusy ? 'render-cta busy' : 'render-cta'}
        hidden={view.secondary.hidden}
        data-mode={view.secondary.mode}
        disabled={secondaryBusy}
        onClick={() => requestMake(view.secondary.mode)}
      >
        <span className="cta-label">{view.secondary.label}</span>
      </button>
    </div>
  );
}
