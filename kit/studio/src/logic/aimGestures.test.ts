import { describe, expect, it } from 'vitest';

import { clampLensZoom, framePointAt, lensSizeBy, nudgeStep, scaleArea, wheelFactor, zoomFromCorner, zoomFromWheel } from './aimGestures';

describe('zoomFromCorner', () => {
  it('keeps the zoom where it was when the corner is grabbed', () => {
    expect(zoomFromCorner(1.8, 0.46, 0.46, [1, 3])).toBe(1.8);
  });
  it('pushes in when pulled toward the centre and out when pushed away', () => {
    expect(zoomFromCorner(1.5, 0.4, 0.2, [1, 3])).toBe(3);
    expect(zoomFromCorner(2, 0.4, 0.5, [1, 3])).toBe(1.6);
  });
  it('stays inside the range', () => {
    expect(zoomFromCorner(2, 0.4, 0.001, [1, 3])).toBe(3);
    expect(zoomFromCorner(1.2, 0.1, 0.5, [1, 3])).toBe(1);
  });
});

describe('wheel', () => {
  it('scrolling up zooms in, down zooms out', () => {
    expect(wheelFactor(-50)).toBeGreaterThan(1);
    expect(wheelFactor(50)).toBeLessThan(1);
  });
  it('line-mode wheels move as far as a pixel trackpad flick, not 16× further', () => {
    expect(wheelFactor(3, 1)).toBeCloseTo(wheelFactor(48), 6);
    expect(wheelFactor(100, 2)).toBe(wheelFactor(120));
  });
  it('clamps zoom to the range', () => {
    expect(zoomFromWheel(2.95, -500, [1, 3])).toBe(3);
    expect(zoomFromWheel(1.02, 500, [1, 3])).toBe(1);
  });
});

describe('nudgeStep', () => {
  it('is 1% normally and 5% with Shift, never below a pixel', () => {
    expect(nudgeStep(1920, false)).toBe(19);
    expect(nudgeStep(1920, true)).toBe(96);
    expect(nudgeStep(20, false)).toBe(1);
  });
});

describe('framePointAt', () => {
  it('maps a click on the zoomed stage to the frame point underneath', () => {
    // 2× on a 1000×500 frame centred → the stage shows x 250–750, y 125–375.
    expect(framePointAt({ cx: 500, cy: 250, zoom: 2, width: 1000, height: 500 }, 0, 0)).toEqual({ x: 250, y: 125 });
    expect(framePointAt({ cx: 500, cy: 250, zoom: 2, width: 1000, height: 500 }, 1, 1)).toEqual({ x: 750, y: 375 });
  });
  it('uses the clamped crop when the aim sits at an edge', () => {
    expect(framePointAt({ cx: 0, cy: 0, zoom: 2, width: 1000, height: 500 }, 0.5, 0.5)).toEqual({ x: 250, y: 125 });
  });
});

describe('lens area', () => {
  it('scales the long side and keeps the aspect', () => {
    expect(scaleArea(200, 50, 400)).toEqual({ w: 400, h: 100 });
    expect(scaleArea(50, 200, 100)).toEqual({ w: 25, h: 100 });
  });
  it('sizes inside the editor range', () => {
    expect(lensSizeBy(500, 2)).toBe(540);
    expect(lensSizeBy(30, 0.1)).toBe(24);
  });
  it('caps strength at what the loupe can draw', () => {
    expect(clampLensZoom(2.4, 1.6, [1.2, 2.4])).toBe(1.6);
    expect(clampLensZoom(undefined, 1.6, [1.2, 2.4])).toBeUndefined();
    expect(clampLensZoom(1.3, 1, [1.2, 2.4])).toBe(1.2);
  });
});
