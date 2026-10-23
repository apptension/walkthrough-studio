import { useEffect, useRef, type RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useBusy } from '@/features/tools-panel/busy';
import { cn } from '@/lib/cn';

import { approveDraft, approvePlate, discardDraft, reviewProposal } from './proposal';
import { toggleProposalWork, useSession } from './session';

interface SessionDecideProps {
  railRef: RefObject<HTMLDivElement | null>;
  progressRef: RefObject<HTMLDivElement | null>;
}

function ProposalSteps() {
  const steps = useSession((s) => s.proposalSteps);
  return (
    <ol id="proposalSteps" className="proposal-steps" hidden={!steps.length}>
      {steps.map((s, i) => (
        <li key={i} className={s.status || ''}>
          {s.label || ''}
        </li>
      ))}
    </ol>
  );
}

function DecideActions() {
  const { review, reviewLabel, reviewDetail, approvePlateShown } = useSession(
    useShallow((s) => ({
      review: s.review,
      reviewLabel: s.reviewLabel,
      reviewDetail: s.reviewDetail,
      approvePlateShown: s.approvePlate,
    })),
  );
  const approving = useBusy('btnApproveDraft');
  const platePending = useBusy('btnApprovePlate');
  const discarding = useBusy('btnDiscardDraft');
  return (
    <div className="session-decide-actions">
      <button
        type="button"
        id="btnReviewProposal"
        className="decide-btn review"
        data-review={review ?? undefined}
        onClick={reviewProposal}
      >
        <strong>{reviewLabel}</strong> <em>{reviewDetail}</em>
      </button>{' '}
      <button
        type="button"
        id="btnApproveDraft"
        className={cn('decide-btn primary', approving && 'busy')}
        disabled={approving}
        onClick={() => void approveDraft()}
      >
        <strong>Approve & render full</strong> <em>Stitch plates + live into master</em>
      </button>{' '}
      <button
        type="button"
        id="btnApprovePlate"
        className={cn('decide-btn', platePending && 'busy')}
        disabled={platePending}
        hidden={!approvePlateShown}
        onClick={approvePlate}
      >
        <strong>Approve plate only</strong> <em>Encode this plate without a full render</em>
      </button>{' '}
      <button
        type="button"
        id="btnDiscardDraft"
        className={cn('decide-btn danger', discarding && 'busy')}
        disabled={discarding}
        onClick={() => void discardDraft()}
      >
        <strong>Discard changes</strong> <em>Restore the previous sources</em>
      </button>
    </div>
  );
}

/** `#sessionDecide`: the agent finished, the director picks a path. */
export function SessionDecide({ railRef, progressRef }: SessionDecideProps) {
  const { open, assertive, title, reason, showWork, seq } = useSession(
    useShallow((s) => ({
      open: s.decideOpen,
      assertive: s.decideAssertive,
      title: s.proposalTitle,
      reason: s.proposalReason,
      showWork: s.showWork,
      seq: s.proposalSeq,
    })),
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!seq) return;
    const rail = railRef.current;
    if (rail) rail.scrollTop = 0;
    const frame = requestAnimationFrame(() => {
      if (rail) rail.scrollTop = 0;
      ref.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [seq, railRef]);

  const onWork = () => {
    const expanded = toggleProposalWork();
    if (expanded) progressRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    else if (railRef.current) railRef.current.scrollTop = 0;
  };

  return (
    <div
      ref={ref}
      id="sessionDecide"
      className="session-decide"
      tabIndex={-1}
      hidden={!open}
      aria-live={assertive ? 'assertive' : undefined}
    >
      <div className="session-decide-head">
        <span className="decision-check" aria-hidden="true">
          ✓
        </span>
        <div className="session-decide-copy">
          <span className="decision-eyebrow">Agent finished · your decision</span>{' '}
          <strong id="proposalTitle">{title}</strong> <span id="proposalReason">{reason}</span>
        </div>
      </div>
      <ProposalSteps />
      <DecideActions />
      <button
        type="button"
        id="btnProposalWork"
        className="proposal-work-toggle"
        aria-expanded={showWork ? 'true' : 'false'}
        onClick={onWork}
      >
        {showWork ? 'Hide agent work' : 'View agent work'}
      </button>
    </div>
  );
}
