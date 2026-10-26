import { useDesk } from '@/desk/store';

export interface PerfSnapshot {
  deskPerSec: number;
  deskTopKeys: Array<{ key: string; count: number }>;
  longTasks: number;
  longTaskMaxMs: number;
  neonGlowMoves: number;
  neonButtons: number;
  markCanvases: number;
  fps: number;
}

type DeskListener = (keys: string[]) => void;

const deskListeners = new Set<DeskListener>();
let deskWrapped = false;

const keyCounts = new Map<string, number>();
let deskEvents = 0;
let windowStart = performance.now();

function flushDeskWindow(): void {
  const now = performance.now();
  if (now - windowStart < 1000) return;
  deskEvents = 0;
  keyCounts.clear();
  windowStart = now;
}

function recordDeskPatch(patch: unknown): void {
  deskEvents++;
  const keys = patchKeys(patch);
  for (const k of keys) keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
  deskListeners.forEach((fn) => fn(keys));
  flushDeskWindow();
}

function patchKeys(patch: unknown): string[] {
  if (typeof patch === 'function') return ['(fn)'];
  if (!patch || typeof patch !== 'object') return ['?'];
  return Object.keys(patch);
}

/** Wrap `desk.set` / zustand to count store writes and which top-level keys changed. */
export function wrapDeskSet(): void {
  if (deskWrapped) return;
  deskWrapped = true;
  const store = useDesk;
  const original = store.setState;
  store.setState = (partial, replace) => {
    recordDeskPatch(partial);
    if (replace) return original(partial as Parameters<typeof original>[0] & object, true);
    return original(partial);
  };
}

let longTasks = 0;
let longTaskMaxMs = 0;
let longObserver: PerformanceObserver | null = null;

function watchLongTasks(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    longObserver = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        longTasks++;
        longTaskMaxMs = Math.max(longTaskMaxMs, e.duration);
      }
    });
    longObserver.observe({ type: 'longtask', buffered: true });
  } catch {
    /* unsupported */
  }
}

let neonGlowMoves = 0;
let neonWindowStart = performance.now();
let neonMovesPerSec = 0;

/** Called from `bindNeonGlow` once per coalesced pointermove while over a neon fill. */
export function recordNeonGlowMove(): void {
  neonGlowMoves++;
  const now = performance.now();
  if (now - neonWindowStart >= 1000) {
    neonMovesPerSec = neonGlowMoves;
    neonGlowMoves = 0;
    neonWindowStart = now;
  }
}

let fps = 0;
let fpsRaf = 0;
let fpsFrames = 0;
let fpsStart = performance.now();

function trackFps(): void {
  const step = (now: number) => {
    fpsFrames++;
    if (now - fpsStart >= 1000) {
      fps = fpsFrames;
      fpsFrames = 0;
      fpsStart = now;
    }
    fpsRaf = requestAnimationFrame(step);
  };
  fpsRaf = requestAnimationFrame(step);
}

export function countNeonButtons(): number {
  return document.querySelectorAll(
    '.btn.primary, .render-cta.primary, .ed-pill-btn.primary, .ins-btn.primary, .ed-render, .neon-btn',
  ).length;
}

export function countMarkCanvases(): number {
  return document.querySelectorAll('.mark-canvas').length;
}

export function getPerfSnapshot(): PerfSnapshot {
  const elapsed = Math.max(1, performance.now() - windowStart);
  const deskPerSec = Math.round((deskEvents * 1000) / elapsed);
  const deskTopKeys = [...keyCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([key, count]) => ({ key, count }));
  return {
    deskPerSec,
    deskTopKeys,
    longTasks,
    longTaskMaxMs: Math.round(longTaskMaxMs),
    neonGlowMoves: neonMovesPerSec,
    neonButtons: countNeonButtons(),
    markCanvases: countMarkCanvases(),
    fps,
  };
}

export function subscribeDeskPerf(fn: DeskListener): () => void {
  deskListeners.add(fn);
  return () => deskListeners.delete(fn);
}

export function installPerfMonitor(): () => void {
  wrapDeskSet();
  watchLongTasks();
  trackFps();

  const api = {
    getPerfSnapshot,
    recordNeonGlowMove,
    resetLongTasks: () => {
      longTasks = 0;
      longTaskMaxMs = 0;
    },
  };
  (window as Window & { __studioPerf?: typeof api }).__studioPerf = api;

  return () => {
    if (fpsRaf) cancelAnimationFrame(fpsRaf);
    longObserver?.disconnect();
    delete (window as Window & { __studioPerf?: typeof api }).__studioPerf;
  };
}
