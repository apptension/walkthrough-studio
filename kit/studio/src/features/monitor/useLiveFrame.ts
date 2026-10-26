import { useEffect } from 'react';

import { requestBlob } from '@/api/client';
import { bust } from '@/desk/format';
import { desk, useDesk } from '@/desk/store';
import { createPreviewPump } from '@/logic/liveFrame';

/** Matches the capture feed (`PREVIEW_INTERVAL_MS`): ask for a frame ten times a second. */
const PUMP_MS = 100;
/** A hung proxy response must not pin the pump on the last good frame. */
const FETCH_MS = 2500;

/**
 * While a take is capturing, pull the newest preview JPEG without aborting the
 * one already in flight, and swap it in only after it decodes.
 */
export function useLiveFramePump(): void {
  const url = useDesk((s) => (s.live.recording || s.live.repairing ? s.live.url : null));

  useEffect(() => {
    if (!url) return undefined;
    const pump = createPreviewPump();
    let cancelled = false;
    let shown: string | null = null;

    const commit = (objectUrl: string) => {
      const prev = shown;
      shown = objectUrl;
      desk.set((s) => (s.live.url === url ? { live: { ...s.live, src: objectUrl } } : {}));
      if (prev?.startsWith('blob:')) {
        const drop = prev;
        requestAnimationFrame(() => {
          if (drop !== shown) URL.revokeObjectURL(drop);
        });
      }
    };

    const load = async (next: string) => {
      try {
        const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(FETCH_MS) : undefined;
        const blob = await requestBlob(next, signal);
        if (cancelled) return;
        if (typeof createImageBitmap === 'function') {
          const bitmap = await createImageBitmap(blob);
          bitmap.close();
        }
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        commit(objectUrl);
      } catch {
        /* keep the last good frame; the next dirty mark tries again */
      } finally {
        if (!cancelled && pump.finish()) {
          const again = pump.take((stamp) => bust(url, stamp));
          if (again) void load(again);
        }
      }
    };

    const kick = () => {
      pump.markDirty();
      const next = pump.take((stamp) => bust(url, stamp));
      if (next) void load(next);
    };

    kick();
    const timer = setInterval(kick, PUMP_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [url]);
}
