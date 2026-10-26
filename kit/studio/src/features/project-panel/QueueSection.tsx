import { useCallback, useRef, useState, type MouseEvent } from 'react';

import { clearQueue, removeQueued, stopAllWork } from '@/desk/jobs';
import { useDesk } from '@/desk/store';
import { toast } from '@/desk/toast';
import { HelpTip } from '@/ui/HelpTip';
import { Icon, SecIcon } from '@/ui/icons';
import { queueIconId, queueIconSvg } from '@/logic/queueUx';

import { QueueMenu } from './QueueMenu';
import { useWorkPending } from './useWorkPending';

const HELP = 'Jobs waiting behind the current one. Add a full render or a single step — Plates, Audio, Export, and more.';

/** `#queueSection` — the Add menu, Stop all / Clear, and the job list (`renderQueue`). */
export function QueueSection() {
  const queued = useDesk((s) => s.queue.length);
  const pending = useWorkPending();
  const [menuOpen, setMenuOpen] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);

  const closeMenu = useCallback((opts: { focusButton?: boolean } = {}) => {
    setMenuOpen(false);
    if (opts.focusButton) addRef.current?.focus({ preventScroll: true });
  }, []);

  const onAdd = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setMenuOpen((open) => !open);
  };

  return (
    <div className="render-section queue-section" id="queueSection">
      <div className="render-section-label">
        <span data-ico="queue" data-help={HELP} className="has-help">
          <SecIcon name="queue" />
          Queue
          <HelpTip text={HELP} label="Queue" />
        </span>
        <div className="render-section-actions">
          <div className="queue-add-wrap" id="queueAddWrap">
            <button
              ref={addRef}
              type="button"
              id="btnQueueAdd"
              className="queue-add-btn"
              aria-haspopup="menu"
              aria-expanded={menuOpen ? 'true' : 'false'}
              aria-controls="queueMenu"
              title="Add a step to the queue"
              onClick={onAdd}
            >
              <Icon name="ui-plus" size={13} className="queue-add-plus" /> <span className="queue-add-label">Add</span>{' '}
              <Icon name="ui-chevron" size={11} className="queue-add-caret" />
            </button>
            <QueueMenu open={menuOpen} onClose={closeMenu} buttonRef={addRef} />
          </div>
          <button
            type="button"
            id="btnStopWork"
            className="btn tiny danger"
            hidden={!pending}
            title="Stop running job and clear queue"
            onClick={() => void stopAllWork({ reason: 'Stopped' })}
          >
            Stop all
          </button>{' '}
          <button
            type="button"
            id="btnClearQueue"
            className="btn tiny"
            hidden={queued === 0}
            title="Clear waiting steps. The running job keeps going."
            onClick={() => {
              clearQueue();
              toast('Queue cleared', 'Running job (if any) keeps going — use Stop to kill it');
            }}
          >
            Clear
          </button>
        </div>
      </div>
      <JobQueue />
      <QueueEmpty />
    </div>
  );
}

function QIco({ id }: { id: string }) {
  return <span className="q-ico" dangerouslySetInnerHTML={{ __html: queueIconSvg(id) }} />;
}

function JobQueue() {
  const running = useDesk((s) => s.running);
  const queue = useDesk((s) => s.queue);
  return (
    <ol id="jobQueue" className="queue-list" hidden={!running && !queue.length}>
      {running ? (
        <li className="is-now">
          <QIco id={queueIconId(running)} />{' '}
          <span className="q-body">
            <span className="q-label">{running.label || 'Working'}</span> <span className="q-meta">Running now</span>
          </span>
        </li>
      ) : null}
      {queue.map((q, i) => (
        <li key={q.qid} className="q-wait" data-qid={q.qid}>
          <QIco id={queueIconId(q)} />{' '}
          <span className="q-body">
            <span className="q-label">{q.label}</span> <span className="q-meta">Waiting · {i + 1}</span>
          </span>{' '}
          <button
            type="button"
            className="queue-remove"
            data-remove-qid={q.qid}
            title="Remove"
            aria-label={`Remove ${q.label}`}
            onClick={() => removeQueued(q.qid)}
          >
            <Icon name="x" size={14} />
          </button>
        </li>
      ))}
    </ol>
  );
}

function QueueEmpty() {
  const hidden = useDesk((s) => Boolean(s.running) || s.queue.length > 0);
  return (
    <div id="queueEmpty" className="queue-empty" hidden={hidden}>
      <span className="queue-empty-ico" aria-hidden="true">
        <Icon name="ui-list" size={18} />
      </span>
      <div className="queue-empty-copy">
        <strong>Nothing waiting</strong>
        <p>
          Add a step, or use <em>Render</em> above for the full pass.
        </p>
      </div>
    </div>
  );
}
