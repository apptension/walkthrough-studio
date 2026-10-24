import { onMutation, request } from '@/api/client';
import type { VideoSummary } from '@/api/types';

import { decideAction } from './action';
import { desk } from './store';

/**
 * Keeps `video.freshness` (and so `action`, and so the Render cluster) honest without every
 * feature remembering to reload: any successful write to the open video, returning to the tab
 * (sources edited in an IDE or the CLI) and a slow poll all re-read the server's verdict.
 */

type RenderState = Pick<VideoSummary, 'freshness' | 'hasDelivery' | 'recordFailure'>;

export const FRESHNESS_DEBOUNCE_MS = 400;
export const FRESHNESS_POLL_MS = 30_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

function videoPrefix(slug: string): string {
  return `/api/video/${encodeURIComponent(slug)}/`;
}

/** Re-read the render state now. Drops the answer if the sequence moved on meanwhile. */
export async function refreshFreshness(): Promise<void> {
  const slug = desk.get().slug;
  if (!slug) return;
  const mine = ++seq;
  let state: RenderState;
  try {
    state = await request<RenderState>(`${videoPrefix(slug)}freshness`);
  } catch {
    return;
  }
  const v = desk.get().video;
  if (mine !== seq || !v || v.slug !== slug || !state?.freshness) return;
  const next = { ...v, ...state };
  desk.set({ video: next, action: decideAction(next) });
}

export function scheduleFreshness(delay = FRESHNESS_DEBOUNCE_MS): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void refreshFreshness();
  }, delay);
}

/** Start watching; returns the teardown. */
export function watchFreshness(): () => void {
  const off = onMutation((url) => {
    const slug = desk.get().slug;
    if (!slug) return;
    const prefix = videoPrefix(slug);
    if (url.startsWith(prefix) || url.startsWith(`/api/video/${slug}/`)) scheduleFreshness();
  });
  const onVisible = () => {
    if (document.visibilityState === 'visible') scheduleFreshness(0);
  };
  const poll = setInterval(() => {
    if (document.visibilityState === 'visible' && !desk.get().jobBusy) void refreshFreshness();
  }, FRESHNESS_POLL_MS);
  window.addEventListener('focus', onVisible);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    off();
    clearInterval(poll);
    if (timer) clearTimeout(timer);
    timer = null;
    window.removeEventListener('focus', onVisible);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
