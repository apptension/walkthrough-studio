/**
 * Mutable handles the engine needs but React never renders from: the media
 * elements the monitor mounts, the abort controller for the running job and the
 * timers that tick the elapsed clocks. The legacy desk reached these through
 * `document.getElementById`; here the owning component registers them.
 */
export interface Runtime {
  player: HTMLVideoElement | null;
  playerA: HTMLVideoElement | null;
  playerB: HTMLVideoElement | null;
  stage: HTMLElement | null;
  plateFrame: HTMLIFrameElement | null;
  workAbort: AbortController | null;
  elapsedTimer: ReturnType<typeof setInterval> | null;
  chapterTimer: ReturnType<typeof setTimeout> | null;
  /** Bumps cancel overlapping Program play() handshakes (post-render double-start). */
  programPlayGen: number;
  jobAsk: string | null;
  /** Last job id we auto-switched to Feedback for — avoids stealing the right tab on every poll. */
  activityJobId: string | null;
}

export const runtime: Runtime = {
  player: null,
  playerA: null,
  playerB: null,
  stage: null,
  plateFrame: null,
  workAbort: null,
  elapsedTimer: null,
  chapterTimer: null,
  programPlayGen: 0,
  jobAsk: null,
  activityJobId: null,
};
