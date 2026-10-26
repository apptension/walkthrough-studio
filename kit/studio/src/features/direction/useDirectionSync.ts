import { useLayoutEffect } from 'react';

import { desk, useDesk } from '@/desk/store';

import { loadCaptureSize } from './actions';
import { renderDirection, renderEffects, renderOverlays, renderTransitions, setEnergy } from './view';

/**
 * What `loadVideo` painted into the Direction tab when a summary landed, plus the
 * idempotent repaints that follow the summary's direction, transitions and live-card look
 * wherever they change. `motionOptions` is only ever replaced by a fresh summary, so it
 * marks a landing; the motion draft (energy, effects) is reset only then.
 */
export function useDirectionSync(): void {
  const landed = useDesk((s) => s.video?.motionOptions);
  const direction = useDesk((s) => s.video?.direction);
  const transitions = useDesk((s) => s.video?.transitions);
  const overlays = useDesk((s) => s.video?.overlays);

  useLayoutEffect(() => {
    const v = desk.get().video;
    if (!v || !landed) return;
    setEnergy(v.motion?.energy || 'clear');
    renderEffects(v.motion);
    void loadCaptureSize(desk.get().slug ?? v.slug);
  }, [landed]);

  useLayoutEffect(() => {
    renderDirection(direction);
  }, [direction]);

  useLayoutEffect(() => {
    renderTransitions(transitions);
  }, [transitions]);

  useLayoutEffect(() => {
    if (overlays) renderOverlays(overlays);
  }, [overlays]);
}
