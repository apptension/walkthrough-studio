import { Fragment, useRef } from 'react';

import { showRightTab } from '@/desk/panels';
import { useDesk, type RightTab } from '@/desk/store';
import { DirectionDock } from '@/features/direction/DirectionDock';
import { DirectionTab } from '@/features/direction/DirectionTab';
import { InspectorTab } from '@/features/editor/InspectorTab';
import { FeedbackTab } from '@/features/feedback/FeedbackTab';
import { SessionRail } from '@/features/feedback/SessionRail';
import { ReviewTab } from '@/features/review/ReviewTab';

import { useRightPanelSwap } from './panelSwap';

const TABS: { id: RightTab; label: string; title?: string }[] = [
  { id: 'feedback', label: 'Feedback' },
  { id: 'inspector', label: 'Inspector', title: 'Edit the selected clip' },
  { id: 'motion', label: 'Direction' },
  { id: 'review', label: 'Review' },
];

function PanelTabs() {
  const active = useDesk((s) => s.rightTab);
  return (
    <div className="panel-tabs" role="tablist">
      {TABS.map((t, i) => (
        <Fragment key={t.id}>
          {i > 0 ? ' ' : null}
          <button
            type="button"
            className={t.id === active ? 'ptab active' : 'ptab'}
            data-right={t.id}
            role="tab"
            aria-selected={t.id === active ? 'true' : 'false'}
            title={t.title}
            onClick={() => showRightTab(t.id)}
          >
            {t.label}
          </button>
        </Fragment>
      ))}
    </div>
  );
}

/** `<aside id="toolsPanel">`: Feedback / Inspector / Direction / Review, the dock and the session rail. */
export function ToolsPanel() {
  const ref = useRef<HTMLElement>(null);
  const tab = useDesk((s) => s.rightTab);
  const picked = useDesk((s) => s.rightTabPicked);
  const seq = useDesk((s) => s.rightTabSeq);
  useRightPanelSwap(ref, tab, seq);
  return (
    <aside ref={ref} className="panel tools-panel" id="toolsPanel" aria-label="Tools" data-tab={picked ? tab : undefined}>
      <PanelTabs />
      <div className="tools-scroll">
        <FeedbackTab />
        <InspectorTab />
        <DirectionTab />
        <ReviewTab />
      </div>
      <DirectionDock />
      {/* Fixed bottom: live agent/job + decide actions */}
      <SessionRail />
    </aside>
  );
}
