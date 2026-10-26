import { useRef } from 'react';

import { useDesk } from '@/desk/store';
import { EdStatus } from '@/features/editor/EdStatus';

import { selectEditor, selectLive, selectProgram, setCaptions, toggleCompare } from './actions';
import { useTransitionToggle } from './useTransitionToggle';

const LIVE_TAB_PROPS = ['max-width', 'opacity'] as const;

/** The tab `setMonitorMode` marks active: Compare lives under Program. */
function useActiveTab(): string {
  return useDesk((s) => (s.monitorMode === 'compare' ? 'program' : s.monitorMode));
}

/** `#modeLive` — `syncLiveTab()`: slides out from under Program while a capture runs. */
function LiveTab({ active }: { active: boolean }) {
  const show = useDesk((s) => s.live.tab);
  const onAir = useDesk((s) => s.live.onAir);
  const repairing = useDesk((s) => s.live.tab && !s.live.onAir && s.live.repairing);
  const ref = useRef<HTMLButtonElement>(null);
  const view = useTransitionToggle(show, ref, LIVE_TAB_PROPS);
  const cls = ['mode-tab', 'mode-tab-live'];
  if (active) cls.push('active');
  if (view.active) cls.push('is-in');
  if (show && onAir) cls.push('is-on-air');
  if (repairing) cls.push('is-repairing');
  return (
    <button
      ref={ref}
      type="button"
      className={cls.join(' ')}
      data-mode="live"
      id="modeLive"
      title="Watch the live page capture"
      hidden={view.hidden}
      aria-hidden={show ? 'false' : 'true'}
      onClick={selectLive}
    >
      <i className="live-dot" aria-hidden="true" />
      <span>
        Live
      </span>
    </button>
  );
}

function ModeTabs() {
  const tab = useActiveTab();
  return (
    <div className="monitor-modes" role="tablist" aria-label="Monitor mode">
      <button
        type="button"
        className={tab === 'program' ? 'mode-tab active' : 'mode-tab'}
        data-mode="program"
        id="modeProgram"
        title="Watch the rendered video"
        onClick={selectProgram}
      >
        Program
      </button>
      {' '}
      <LiveTab active={tab === 'live'} />
      {' '}
      <button
        type="button"
        className={tab === 'plate' ? 'mode-tab active' : 'mode-tab'}
        data-mode="plate"
        id="modePlate"
        title="Edit the cut: play it, change speed, zooms, transitions, plate text and colours"
        onClick={() => void selectEditor()}
      >
        Editor
      </button>
    </div>
  );
}

/** `#monitorLabel` and `#monitorModeHint` — `setMonitorLabel()`. */
function MonitorContext() {
  const text = useDesk((s) => s.monitorLabel.text);
  const hint = useDesk((s) => s.monitorLabel.hint);
  return (
    <div className="monitor-context">
      <span className="monitor-label" id="monitorLabel" hidden={text === 'Program' || text === 'Plate HTML' || text === 'Editor'}>
        {text}
      </span>
      {' '}
      <span className="monitor-mode-hint" id="monitorModeHint">
        {hint}
      </span>
    </div>
  );
}

function MonitorToggles() {
  const captionsOn = useDesk((s) => s.captionsOn);
  const compare = useDesk((s) => s.compare);
  // `renderVersions`: Compare needs a saved version and a master to compare against.
  const compareDisabled = useDesk((s) => (s.video ? !s.video.versions?.length || !s.video.deliveryUrl : false));
  return (
    <div className="monitor-toggles">
      <label className="tog" id="togCaptionsWrap">
        <input type="checkbox" id="togCaptions" checked={captionsOn} onChange={(e) => setCaptions(e.currentTarget.checked)} />
        <span>
          CC
        </span>
      </label>
      {' '}
      <label className="tog" id="togCompareWrap">
        <input
          type="checkbox"
          id="togCompare"
          checked={compare}
          disabled={compareDisabled}
          onChange={(e) => toggleCompare(e.currentTarget.checked)}
        />
        <span>
          Compare
        </span>
      </label>
    </div>
  );
}

export function MonitorHead() {
  return (
    <div className="monitor-head">
      <ModeTabs />
      <MonitorContext />
      <EdStatus />
      <MonitorToggles />
    </div>
  );
}
