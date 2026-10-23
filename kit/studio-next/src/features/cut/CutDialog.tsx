import { useEffect, useMemo, useRef } from 'react';

import { useDesk } from '@/desk/store';
import { Icon } from '@/ui/icons';
import { reviewPill } from '@/features/stages/model';
import { closeSheet, useSheetDialog } from '@/features/stages/sheetDialog';

import { cutDecision, cutView, useCutSheet, type CutView } from './cut';

function CutFacts({ facts }: { facts: CutView['facts'] }) {
  return (
    <dl id="cutFacts" className="cut-facts">
      {facts.map(([k, val]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{val}</dd>
        </div>
      ))}
    </dl>
  );
}

function CutHistory({ history }: { history: CutView['history'] }) {
  return (
    <ol id="cutHistory" className="review-history">
      {history.length ? (
        history.map((h, i) => (
          <li key={i} data-action={h.action}>
            <strong>{h.label}</strong>
            <em>{h.when}</em>
            {h.note ? <p>{h.note}</p> : null}
          </li>
        ))
      ) : (
        <li className="is-empty">No reviews yet — approve or request changes below.</li>
      )}
    </ol>
  );
}

function CutFoot({ approved }: { approved: boolean }) {
  const note = useCutSheet((s) => s.note);
  const pending = useCutSheet((s) => s.pending);
  const focusNote = useCutSheet((s) => s.focusNote);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusNote) noteRef.current?.focus();
  }, [focusNote]);

  return (
    <footer className="sheet-foot">
      <label className="note-field">
        <span className="field-label">
          Note <i>required when requesting changes</i>
        </span>
        <textarea
          ref={noteRef}
          id="cutNote"
          rows={2}
          placeholder="For the record — or what to fix before approval"
          value={note}
          onChange={(e) => useCutSheet.setState({ note: e.target.value })}
        />
      </label>
      <div className="sheet-actions">
        <button
          type="button"
          id="btnCutRequest"
          className="btn"
          disabled={pending === 'changes-requested'}
          onClick={() => void cutDecision('changes-requested')}
        >
          Request changes
        </button>{' '}
        <button
          type="button"
          id="btnCutApprove"
          className="btn primary"
          disabled={approved || pending === 'approved'}
          onClick={() => void cutDecision('approved')}
        >
          Approve cut
        </button>
      </div>
    </footer>
  );
}

/** `#cutDialog` — the cut review sheet. */
export function CutDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const open = useSheetDialog('cut', ref);
  const video = useDesk((s) => s.video);
  // `open` re-reads the relative times each time the sheet comes up, as `openCut()` did.
  const view = useMemo(() => (video ? cutView(video) : null), [open, video]); // eslint-disable-line react-hooks/exhaustive-deps
  const pill = view ? reviewPill(view.effective) : null;

  return (
    <dialog ref={ref} id="cutDialog" className="sheet-dialog narrow" aria-labelledby="cutDialogTitle">
      <header className="sheet-head">
        <span className="sheet-icon" aria-hidden="true">
          <Icon name="ui-video" size={16} />
        </span>
        <div className="sheet-titles">
          <div className="sheet-title-row">
            <h2 id="cutDialogTitle">Review cut</h2>
            <span id="cutStatus" className="review-pill" data-tone={pill?.tone}>
              {pill ? pill.text : 'Not reviewed'}
            </span>
          </div>
          <p className="sheet-sub">Approving saves this exact file as a release version.</p>
        </div>
        <button type="button" className="sheet-close" data-close="" aria-label="Close" onClick={() => closeSheet('cut')}>
          <Icon name="ui-x" size={14} />
        </button>
      </header>
      <div className="sheet-body">
        <CutFacts facts={view?.facts ?? []} />
        <p id="cutWarn" className="cut-warn" hidden={!view?.warn.length}>
          {view?.warn.join(' ')}
        </p>
        <h3 className="sheet-section">History</h3>
        {view ? <CutHistory history={view.history} /> : <ol id="cutHistory" className="review-history" />}
      </div>
      <CutFoot approved={Boolean(view?.approved)} />
    </dialog>
  );
}
