import { useEffect, useRef } from 'react';

import { useDesk } from '@/desk/store';
import { getMarkMode, mountMark } from '@/logic/mark';

/** `.chrome-brand` with the animated `#brandMark`; the tooltip names the running build. */
export function BrandMark() {
  const version = useDesk((s) => s.version);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // `boot()` → `initMarks()` mounts `#brandMark` right after this effect; mount here
    // only when nothing has claimed the canvas by the next frame (a remount, or no boot).
    const frame = requestAnimationFrame(() => {
      const canvas = ref.current;
      if (!canvas || '__mark' in canvas) return;
      mountMark(canvas, { size: canvas.clientWidth || 22, resolve: getMarkMode });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="chrome-brand" title={version ? `Walkthrough Studio ${version}` : 'Walkthrough Studio'}>
      <canvas ref={ref} className="logo" id="brandMark" width="48" height="48" aria-hidden="true" />
      {' '}
      <span className="chrome-title">
        Walkthrough Studio
      </span>
    </div>
  );
}
