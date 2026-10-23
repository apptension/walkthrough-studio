import { bridges } from '@/desk/bridge';
import { exportPack, requestMake } from '@/desk/jobs';
import { useDesk } from '@/desk/store';
import { snapshotVersion } from '@/features/project-panel/versionActions';
import { Icon } from '@/ui/icons';

import { AgentChrome } from './AgentChrome';

/** `buttonBusy(btn, on)` as class + disabled, from the store's `busy` map. */
function useBusy(id: string): boolean {
  return useDesk((s) => Boolean(s.busy[id]));
}

function busyClass(base: string, busy: boolean): string {
  return busy ? `${base} busy` : base;
}

/** `#btnMake` — the label `renderActionCard` sets and the `updateQueueBadge` count. */
function MakeButton() {
  const busy = useBusy('btnMake');
  const label = useDesk((s) => s.action?.makeLabel ?? 'Render');
  const queued = useDesk((s) => s.queue.length);
  return (
    <button
      type="button"
      id="btnMake"
      className={busyClass('btn primary icon-text', busy)}
      title="Render / rebuild delivery"
      disabled={busy}
      onClick={() => requestMake()}
    >
      <Icon name="ui-play-fill" size={14} />
      {' '}
      <span id="btnMakeLabel">
        {label}
      </span>
      {' '}
      <span id="queueBadge" className="queue-badge" hidden={queued === 0}>
        {String(queued)}
      </span>
    </button>
  );
}

function ExportButton() {
  const busy = useBusy('btnExport');
  return (
    <button
      type="button"
      id="btnExport"
      className={busyClass('btn icon-text', busy)}
      title="Export handoff package"
      disabled={busy}
      onClick={exportPack}
    >
      <Icon name="ui-step-deliver" size={14} />
      {' '}Export
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
      disabled={busy}
      onClick={() => void snapshotVersion()}
    >
      <Icon name="ui-plus-fill" size={14} />
      {' '}Save version
    </button>
  );
}

export function ChromeActions() {
  return (
    <div className="chrome-actions">
      <MakeButton />
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
        <span>
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
        title="Studio guide and shortcuts (?)"
        aria-label="Studio guide"
        onClick={() => bridges.workflow?.openHelp()}
      >
        ?
      </button>
      <AgentChrome />
    </div>
  );
}
