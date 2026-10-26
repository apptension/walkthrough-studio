import { useEffect, useRef } from 'react';

import { requestMake } from '@/desk/jobs';
import { showLeftTab } from '@/desk/panels';
import { useDesk } from '@/desk/store';

import { plateQcView } from './plateQc';

/** `#plateQcBanner` — plates whose encode failed QC. Clipped copy is reported on the plate itself. */
export function PlateQcBanner() {
  const plates = useDesk((s) => s.htmlPlates);
  const view = plateQcView(plates);
  // The fix button's listener was `{ once: true }`: one click per paint.
  const armed = useRef(true);
  useEffect(() => {
    armed.current = true;
  }, [plates]);

  return (
    <div id="plateQcBanner" className="plate-qc-banner" hidden={view.kind === 'none'}>
      {view.kind === 'bad' ? (
        <>
          <strong>Plate encode QC</strong> — {view.names} need a clean re-render (hold/frame gate).{' '}
          <button
            type="button"
            className="btn tiny"
            id="btnPlateQcFix"
            onClick={() => {
              if (!armed.current) return;
              armed.current = false;
              requestMake('plates');
              showLeftTab('render');
            }}
          >
            Re-render plates
          </button>
        </>
      ) : null}
    </div>
  );
}
