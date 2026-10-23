import { fmtShort } from '@/desk/format';
import { toggleTl } from '@/desk/layout';
import { useDesk } from '@/desk/store';
import { EdTimeline } from '@/features/editor/EdTimeline';
import { TlLockHint } from '@/features/editor/TlLockHint';
import { Icon } from '@/ui/icons';

import { Timeline } from './Timeline';

/** `#tlLabel` — folds the timeline; reads "Editor" while the plate editor locks scrubbing. */
function TlLabel() {
  const collapsed = useDesk((s) => s.tlCollapsed);
  const locked = useDesk((s) => s.monitorMode === 'plate');
  return (
    <button
      type="button"
      className="tl-label"
      id="tlLabel"
      aria-expanded={collapsed ? 'false' : 'true'}
      aria-controls="timeline"
      title={collapsed ? 'Expand the timeline' : 'Collapse the timeline'}
      onClick={toggleTl}
    >
      <Icon name="ui-chevron" size={13} className="etl-toggle-chevron" />
      {' '}
      <span>
        {locked ? 'Editor' : 'Timeline'}
      </span>
    </button>
  );
}

/** `#tlDuration` — `renderTimeline` prints the master's length once a sequence loads. */
function TlDuration() {
  const label = useDesk((s) => (s.video ? fmtShort(s.duration || 1) : '—'));
  return (
    <span id="tlDuration" className="meta">
      {label}
    </span>
  );
}

export function TimelineShell() {
  const locked = useDesk((s) => s.monitorMode === 'plate');
  return (
    <footer className={locked ? 'timeline-shell is-plate-locked' : 'timeline-shell'} aria-label="Timeline">
      <div className="tl-toolbar">
        <TlLabel />
        {' '}
        <TlLockHint />
        {' '}
        <TlDuration />
      </div>
      <EdTimeline />
      <Timeline />
    </footer>
  );
}
