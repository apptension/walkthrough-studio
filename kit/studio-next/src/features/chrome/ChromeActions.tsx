import { bridges } from '@/desk/bridge';
import { exportPack } from '@/desk/jobs';
import { useDesk } from '@/desk/store';
import { snapshotVersion } from '@/features/project-panel/versionActions';
import { Icon } from '@/ui/icons';

import { AgentChrome } from './AgentChrome';
import { RenderCluster } from './RenderCluster';

/** `buttonBusy(btn, on)` as class + disabled, from the store's `busy` map. */
function useBusy(id: string): boolean {
  return useDesk((s) => Boolean(s.busy[id]));
}

function busyClass(base: string, busy: boolean): string {
  return busy ? `${base} busy` : base;
}

function ExportButton() {
  const busy = useBusy('btnExport');
  return (
    <button
      type="button"
      id="btnExport"
      className={busyClass('btn icon-text', busy)}
      title="Export handoff package"
      aria-label="Export"
      disabled={busy}
      onClick={exportPack}
    >
      <Icon name="ui-step-deliver" size={14} />
      {' '}
      <span className="btn-label">
        Export
      </span>
    </button>
  );
}

function SnapshotButton() {
  const busy = useBusy('btnSnapshot');
  return (
    <button
      type="button"
      id="btnSnapshot"
      className={busyClass('btn icon-text', busy)}
      title="Save a named version"
      aria-label="Save version"
      disabled={busy}
      onClick={() => void snapshotVersion()}
    >
      <Icon name="ui-version" size={14} />
      {' '}
      <span className="btn-label">
        Save version
      </span>
    </button>
  );
}

export function ChromeActions() {
  return (
    <div className="chrome-actions">
      <RenderCluster />
      {' '}
      <ExportButton />
      {' '}
      <SnapshotButton />
      {' '}
      <button
        type="button"
        id="btnCommand"
        className="btn command-trigger"
        title="Open command menu (⌘K)"
        aria-label="Open command menu"
        onClick={() => bridges.workflow?.openCommandMenu()}
      >
        <Icon name="ui-loupe" size={14} className="command-loupe" />
        <span className="btn-label">
          Search
        </span>
        <kbd>
          ⌘K
        </kbd>
      </button>
      {' '}
      <button
        type="button"
        id="btnHelp"
        className="btn icon"
        title="Help"
        aria-label="Help"
        onClick={() => bridges.workflow?.openHelp()}
      >
        ?
      </button>
      <AgentChrome />
    </div>
  );
}
