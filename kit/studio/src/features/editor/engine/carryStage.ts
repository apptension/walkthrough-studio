import { carryBgMs, carryBlackOut, carryEdges, type CarryEdges } from '@/logic/plateCarry';
import { plateClockMs } from '@/logic/plateTiming';

import { ed, htmlPlates } from './state';
import type { Clip } from './types';
import { $ } from './util';

/**
 * Background continuity on the stage. A slide inside a continuous run is split across two
 * frames: `#plateBackdrop` paints only the background on the run's clock (it stays loaded for the
 * whole run, so a slide change never restarts it) and `#plateFrame` paints the copy over
 * transparency on the slide's own clock. The render draws both on one page; the pixels agree.
 */

interface CarryApi {
  set: (opts: { in: boolean; out: boolean; layer: 'full' | 'backdrop' | 'content'; blackOut?: number } | null) => unknown;
  clear: () => unknown;
  seek: (contentMs: number, bgMs: number) => void;
  readonly state: { on: boolean; in: boolean; out: boolean; layer: string };
}

type CarryWindow = Window & { __plateCarry?: CarryApi };

export interface CarryFrame {
  edges: CarryEdges;
  bgMs: number;
  contentMs: number;
  /** The background frame holds this run and is painted for the playhead. */
  backdropUp: boolean;
}

const backdropEl = (): HTMLIFrameElement | null => $<HTMLIFrameElement>('plateBackdrop');
const contentEl = (): HTMLIFrameElement | null => $<HTMLIFrameElement>('plateFrame');

function carryApi(frame: HTMLIFrameElement | null): CarryApi | null {
  try {
    return (frame?.contentWindow as CarryWindow | null)?.__plateCarry ?? null;
  } catch {
    return null;
  }
}

/** The run the backdrop frame holds, and whether its document has armed. */
let held: { key: string; ready: boolean; sig?: string } | null = null;
let loadToken = 0;
let onReady: (() => void) | null = null;

/** The stage repaints once the background frame has armed. */
export function onCarryBackdropReady(fn: () => void): void {
  onReady = fn;
}

function loadBackdrop(edges: CarryEdges, url: string): void {
  const el = backdropEl();
  if (!el) return;
  const token = (loadToken += 1);
  held = { key: edges.runKey, ready: false };
  el.onload = () => {
    if (token !== loadToken || !held) return;
    // The runtime installs at the end of <body>; a plate built before it existed has none.
    if (!carryApi(el)) {
      held = null;
      return;
    }
    held.ready = true;
    onReady?.();
  };
  el.src = `${url.split('?')[0]}?carry=${Date.now()}`;
}

function same(api: CarryApi, edges: CarryEdges, layer: string): boolean {
  const s = api.state;
  return s.on && s.in === edges.in && s.out === edges.out && s.layer === layer;
}

/**
 * Bring both frames in line with clip `c` at the playhead. `contentReady` says the plate frame
 * holds this slide (it may still be loading the next one mid-join). Returns null when the clip
 * carries nothing — callers then drive the plate frame exactly as before.
 */
export function syncCarry(c: Clip | null | undefined, contentReady: boolean): CarryFrame | null {
  const back = backdropEl();
  const front = contentEl();
  const edges = c && c.kind === 'plate' ? carryEdges(ed.seq, c.i) : null;
  const canvas = $('fhdCanvas');
  if (!c || !edges) {
    if (back) back.hidden = true;
    canvas?.classList.remove('is-carry');
    const api = carryApi(front);
    if (api?.state.on) api.clear();
    return null;
  }
  const contentMs = plateClockMs(c, ed.t);
  const bgMs = carryBgMs(edges, ed.t);
  const blackOut = carryBlackOut(c);
  if (held?.key !== edges.runKey) {
    const url = (htmlPlates() || []).find((p) => p.id === c.plateId)?.htmlUrl;
    if (url) loadBackdrop(edges, url);
  }
  const backApi = held?.ready ? carryApi(back) : null;
  if (back && backApi) {
    // One background frame serves every slide of the run: the edges and the dim follow the slide on stage.
    const sig = `${edges.in}|${edges.out}|${blackOut.toFixed(3)}`;
    if (held && (held.sig !== sig || !same(backApi, edges, 'backdrop'))) {
      backApi.set({ in: edges.in, out: edges.out, layer: 'backdrop', blackOut });
      held.sig = sig;
    }
    backApi.seek(contentMs, bgMs);
    back.hidden = false;
  } else if (back) {
    back.hidden = true;
  }
  if (contentReady) {
    const api = carryApi(front);
    if (api && !same(api, edges, 'content')) api.set({ in: edges.in, out: edges.out, layer: 'content', blackOut });
  }
  canvas?.classList.toggle('is-carry', Boolean(backApi));
  return { edges, bgMs, contentMs, backdropUp: Boolean(backApi) };
}

/** Tests and unmount: forget the held run. */
export function resetCarryStage(): void {
  held = null;
  loadToken += 1;
  onReady = null;
}
