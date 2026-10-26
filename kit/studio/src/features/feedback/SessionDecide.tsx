import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useBusy } from '@/features/tools-panel/busy';
import { cn } from '@/lib/cn';
import { Icon } from '@/ui/icons';

import { approveDraft, approvePlate, discardDraft, reviewProposal } from './proposal';
import { useSession } from './session';

interface SessionDecideProps {
  railRef: RefObject<HTMLDivElement | null>;
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

interface DecideButtonProps {
  id: string;
  tone: 'review' | 'primary' | 'plate' | 'danger';
  icon: string;
  label: ReactNode;
  detail: ReactNode;
  busy?: boolean;
  hidden?: boolean;
  review?: string | undefined;
  onClick: () => void;
}

function DecideButton({ id, tone, icon, label, detail, busy, hidden, review, onClick }: DecideButtonProps) {
  return (
    <button
      type="button"
      id={id}
      className={cn('decide-btn', tone, busy && 'busy')}
      data-review={review}
      disabled={busy}
      hidden={hidden}
      onClick={onClick}
    >
      <span className="decide-ico" aria-hidden="true">
        <Icon name={icon} size={15} />
      </span>
      <span className="decide-copy">
        <strong>{label}</strong> <em>{detail}</em>
      </span>
      <span className="decide-go" aria-hidden="true">
        <Icon name="chevron" size={13} />
      </span>
    </button>
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
      <DecideButton
        id="btnReviewProposal"
        tone="review"
        icon={review === 'script' ? 'ui-story' : 'ui-eye'}
        label={reviewLabel}
        detail={reviewDetail}
        review={review ?? undefined}
        onClick={reviewProposal}
      />
      <DecideButton
        id="btnApproveDraft"
        tone="primary"
        icon="ui-render"
        label="Approve & render full"
        detail="Stitch plates + live into master"
        busy={approving}
        onClick={() => void approveDraft()}
      />
      <DecideButton
        id="btnApprovePlate"
        tone="plate"
        icon="ui-plate"
        label="Approve plate only"
        detail="Encode this plate without a full render"
        busy={platePending}
        hidden={!approvePlateShown}
        onClick={approvePlate}
      />
      <DecideButton
        id="btnDiscardDraft"
        tone="danger"
        icon="ui-restore"
        label="Discard changes"
        detail="Restore the previous sources"
        busy={discarding}
        onClick={() => void discardDraft()}
      />
    </div>
  );
}

/** `#sessionDecide`: the agent finished, the director picks a path. The run itself folds under the header chevron. */
export function SessionDecide({ railRef }: SessionDecideProps) {
  const { open, assertive, title, reason, seq } = useSession(
    useShallow((s) => ({
      open: s.decideOpen,
      assertive: s.decideAssertive,
      title: s.proposalTitle,
      reason: s.proposalReason,
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
          <Icon name="check" size={13} />
        </span>
        <div className="session-decide-copy">
          <span className="decision-eyebrow">Your decision</span>{' '}
          <strong id="proposalTitle">{title}</strong> <span id="proposalReason">{reason}</span>
        </div>
      </div>
      <ProposalSteps />
      <DecideActions />
    </div>
  );
}
