import { showLeftTab } from '@/desk/panels';
import { useDesk, type LeftTab } from '@/desk/store';

import { DeliverBody } from './MediaTab';
import { usePanelSwap } from './panelSwap';
import { RenderBayBody } from './RenderBay';
import { VersionsBody } from './VersionsTab';

const LEFT_TABS = ['render', 'versions', 'deliver'] as const satisfies readonly LeftTab[];

const TAB_LABEL: Record<LeftTab, string> = { render: 'Render', versions: 'Versions', deliver: 'Deliver' };

/** The left rail, `<aside id="projectPanel">`: Render / Versions / Deliver (`showLeftTab`). */
export function ProjectPanel() {
  const active = useDesk((s) => s.leftTab);
  const bodies = usePanelSwap(active, LEFT_TABS);
  const cls = (base: string, phase: string) => (phase ? `${base} ${phase}` : base);

  return (
    <aside className={active === 'render' ? 'panel project-panel is-render-focus' : 'panel project-panel'} id="projectPanel" aria-label="Project">
      <div className="panel-tabs" role="tablist">
        {LEFT_TABS.map((id, i) => (
          <PanelTab key={id} id={id} active={active === id} spaced={i > 0} />
        ))}
      </div>
      <div id="leftRender" className={cls('panel-body render-bay', bodies.render.phase)} hidden={bodies.render.hidden}>
        <RenderBayBody />
      </div>
      <div id="leftVersions" className={cls('panel-body versions-bay', bodies.versions.phase)} hidden={bodies.versions.hidden}>
        <VersionsBody />
      </div>
      <div id="leftDeliver" className={cls('panel-body', bodies.deliver.phase)} hidden={bodies.deliver.hidden}>
        <DeliverBody />
      </div>
    </aside>
  );
}

function PanelTab({ id, active, spaced }: { id: LeftTab; active: boolean; spaced: boolean }) {
  return (
    <>
      {spaced ? ' ' : null}
      <button
        type="button"
        className={active ? 'ptab active' : 'ptab'}
        data-left={id}
        role="tab"
        aria-selected={active ? 'true' : 'false'}
        onClick={() => showLeftTab(id)}
      >
        {TAB_LABEL[id]}
      </button>
    </>
  );
}
