import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { drawLens } from './stage';
import { ed, resetEdForTests } from './state';
import type { Lens } from './types';

/**
 * Scrubbing away from a magnifier and back. Every path that once left a glass on stage that
 * was not this frame's: a seek dip keeping another slide's loupe, a mirror-glass disc kept with
 * the mirror gone, a selected lens "holding" over a surface it was never placed on.
 */

const lens = (over: Partial<Lens> = {}): Lens => ({
  key: 'lens-a',
  source: 'edit',
  clip: 'slide-a',
  t: 2,
  dur: 4,
  rect: { x: 900, y: 500, w: 120, h: 80 },
  path: null,
  zoom: 2,
  zoomExact: 2,
  diameter: 320,
  S: 400,
  ...over,
});

let clears = 0;
let draws = 0;

function stage(): { cv: HTMLCanvasElement; video: (readyState: number) => HTMLVideoElement } {
  const box = document.createElement('div');
  box.id = 'testBox';
  box.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540, x: 0, y: 0, toJSON: () => ({}) });
  const cv = document.createElement('canvas');
  cv.id = 'testLens';
  const recorder: object = new Proxy(function context() {}, {
    get: (_t, prop) => {
      if (prop === 'clearRect') return () => void clears++;
      if (prop === 'drawImage') return () => void draws++;
      return recorder;
    },
    apply: () => recorder,
  });
  cv.getContext = (() => recorder) as unknown as HTMLCanvasElement['getContext'];
  document.body.append(box, cv);
  const video = (readyState: number) => {
    const v = document.createElement('video');
    Object.defineProperty(v, 'readyState', { value: readyState });
    return v;
  };
  return { cv, video };
}

const paint = (rec: number | null, src: Parameters<typeof drawLens>[1]) =>
  drawLens(rec, { width: 1920, height: 1080, canvas: 'testLens', over: 'testBox', ...src });

beforeEach(() => {
  resetEdForTests();
  ed.fx = true;
  ed.deck = { lenses: [lens(), lens({ key: 'lens-b', clip: 'slide-b' })] };
  clears = 0;
  draws = 0;
});

afterEach(() => {
  document.getElementById('testBox')?.remove();
  document.getElementById('testLens')?.remove();
});

describe('the loupe across a scrub', () => {
  it('keeps its last frame through a seek dip on the same lens', () => {
    const { video } = stage();
    expect(paint(3, { el: video(4), clip: 'slide-a' })?.key).toBe('lens-a');
    clears = 0;
    // Mid-seek on the same slide: the decoder has no frame, the loupe holds.
    expect(paint(3.1, { el: video(1), clip: 'slide-a' })?.key).toBe('lens-a');
    expect(clears).toBe(0);
  });

  it('does not keep another slide\u2019s loupe while this slide\u2019s source loads', () => {
    const { video } = stage();
    paint(3, { el: video(4), clip: 'slide-b' });
    clears = 0;
    // Back on slide A, whose source is still loading: B's glass must not stand in for A's.
    expect(paint(3, { el: video(0), clip: 'slide-a' })).toBeNull();
    expect(clears).toBeGreaterThan(0);
  });

  it('does not keep a mirror glass once the mirror is not under it', () => {
    const { video } = stage();
    const placed: unknown[] = [];
    paint(3, { clip: 'slide-a', glass: (g) => placed.push(g) });
    expect(placed.at(-1)).toBeTruthy();
    clears = 0;
    // The mirror is reloading, so the frame falls back to a render that is not ready yet. The
    // punched-out disc the mirror sat in is not a loupe — it is the black ring.
    expect(paint(3, { el: video(1), clip: 'slide-a' })).toBeNull();
    expect(clears).toBeGreaterThan(0);
  });

  it('clears on a frame with no lens even while a decoder is seeking', () => {
    const { video } = stage();
    paint(3, { el: video(4), clip: 'slide-a' });
    clears = 0;
    expect(paint(9, { el: video(1), clip: 'slide-a' })).toBeNull();
    expect(clears).toBeGreaterThan(0);
  });

  it('clears when there is nothing to sample at all', () => {
    const { video } = stage();
    paint(3, { el: video(4), clip: 'slide-a' });
    clears = 0;
    // A slide with no render yet: no source and no mirror.
    expect(paint(3, { el: null, clip: 'slide-a' })).toBeNull();
    expect(clears).toBeGreaterThan(0);
  });
});
