import { useMemo } from 'react';

import { requestMake } from '@/desk/jobs';
import { useRenderStop } from '@/desk/renderStop';
import { desk, useDesk } from '@/desk/store';
import { NeonButton } from '@/ui/NeonButton';
import { Icon } from '@/ui/icons';

import { noVideoView } from './model';

const ICONS = ['empty-play', 'empty-stale', 'empty-capture'] as const;

/**
 * `#noVideo` — Program's empty state, `paintNoVideo()`. It repaints when a
 * summary lands (a new `action`), reading the busy flag and the bay headline as
 * they are at that moment, like `renderActionCard` did.
 */
export function NoVideo() {
  const action = useDesk((s) => s.action);
  const show = useDesk((s) => s.video != null && !s.programLoaded && !(s.monitorMode === 'live' && s.live.src));
  const { busy: busyPrimary, stopping: primaryStopping, stop } = useRenderStop('btnNoVideoPrimary');
  const busySecondary = useDesk((s) => Boolean(s.busy['btnNoVideoSecondary']));
  const view = useMemo(() => {
    if (!action) return null;
    const s = desk.get();
    return noVideoView(action, { busy: s.jobBusy, bay: s.bay });
  }, [action]);
  const icon = view?.icon || 'empty-play';
  const primary = view ? view.primary : { label: 'Render' };
  const secondary = view ? view.secondary : null;
  return (
    <div id="noVideo" className={show ? 'empty program-empty show' : 'empty program-empty'} data-tone={view?.tone || 'ready'}>
      <div className="program-empty-glow" aria-hidden="true" />
      <div className="program-empty-card">
        {ICONS.map((name) => (
          <div key={name} className="program-empty-icon" data-icon={name} data-width="64" data-height="64" aria-hidden="true" hidden={name !== icon}>
            <Icon name={name} width={64} height={64} />
          </div>
        ))}
        <p className="program-empty-kicker" id="noVideoKicker">
          {view?.kicker ?? 'Program'}
        </p>
        <strong id="noVideoTitle">
          {view?.title ?? 'Nothing to play yet'}
        </strong>
        <p id="noVideoReason">
          {view?.reason ?? 'Render a sequence to watch the cut here.'}
        </p>
        <div className="program-empty-actions">
          <NeonButton
            id="btnNoVideoPrimary"
            className={busyPrimary ? 'render-cta primary is-stop' : 'render-cta primary'}
            hidden={!primary}
            title={busyPrimary ? 'Stop the running job and clear the queue' : undefined}
            disabled={primaryStopping}
            {...(view?.primary ? { 'data-mode': view.primary.mode || 'quick' } : {})}
            onClick={() => (busyPrimary ? stop() : requestMake(view?.primary ? view.primary.mode || 'quick' : undefined))}
          >
            <Icon name={busyPrimary ? 'ui-stop' : 'ui-play-fill'} size={14} />
            {' '}
            <span className="cta-label">
              {busyPrimary ? (primaryStopping ? 'Stopping…' : 'Stop') : (primary?.label || 'Render')}
            </span>
          </NeonButton>
          {' '}
          <button
            type="button"
            id="btnNoVideoSecondary"
            className={busySecondary ? 'render-cta busy' : 'render-cta'}
            hidden={!secondary}
            disabled={busySecondary}
            {...(secondary ? { 'data-mode': secondary.mode || 'quick' } : {})}
            onClick={() => requestMake(secondary ? secondary.mode || 'quick' : undefined)}
          >
            <span className="cta-label">
              {secondary?.label || 'Other'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
