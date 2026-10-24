import { useState } from 'react';

import type { Direction } from '@/api/types';
import { useDesk } from '@/desk/store';
import { approveMotion } from '@/features/feedback/proposal';
import { useBusy } from '@/features/tools-panel/busy';
import { cn } from '@/lib/cn';
import { NeonButton } from '@/ui/NeonButton';

import { applyMotion, approveDirection, previewPlates } from './actions';
import { useDirectionView } from './view';

function ApproveDirectionButton() {
  const direction = useDirectionView((s) => s.direction);
  const busy = useBusy('btnApproveDirection');
  // Legacy's `finally` re-enables the button after the reload painted it approved; the next
  // `renderDirection` disables it again.
  const [releasedFor, setReleasedFor] = useState<Direction | null>(null);
  const approved = Boolean(direction?.approvedAt);
  const disabled = busy || (approved && releasedFor !== direction);
  return (
    <NeonButton
      id="btnApproveDirection"
      className={cn('btn primary', busy && 'busy')}
      disabled={disabled}
      onClick={() => {
        void approveDirection()
          .catch(() => {})
          .finally(() => setReleasedFor(useDirectionView.getState().direction));
      }}
    >
      {approved ? 'Direction approved' : 'Approve direction'}
    </NeonButton>
  );
}

/** `.direction-dock`: Apply motion · Preview scenes · Approve direction. */
export function DirectionDock() {
  const motionBusy = useBusy('btnMotion');
  const previewBusy = useBusy('btnPreviewPlates');
  const loaded = useDesk((s) => s.video != null);
  const ready = useDesk((s) => s.motionApplied && s.platesPreviewed);
  return (
    <div className="direction-actions direction-dock" aria-label="Direction actions">
      <button
        type="button"
        id="btnMotion"
        className={cn('btn', motionBusy && 'busy')}
        disabled={motionBusy}
        onClick={() => void applyMotion()}
      >
        Apply motion
      </button>{' '}
      <button
        type="button"
        id="btnPreviewPlates"
        className={cn('btn', previewBusy && 'busy')}
        disabled={previewBusy}
        onClick={() => void previewPlates()}
      >
        Preview scenes
      </button>{' '}
      <ApproveDirectionButton />{' '}
      <button type="button" id="btnApproveMotion" hidden disabled={loaded ? !ready : undefined} onClick={approveMotion} />
    </div>
  );
}
