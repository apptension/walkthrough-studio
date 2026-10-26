import { describe, expect, it } from 'vitest';

import { dragFrame, releaseDrag, sideRange, timelineRange } from './panelSize';

const range = { min: 180, max: 600, collapseAt: 110, closed: 0 };

describe('dragFrame', () => {
  it('follows the pointer between min and max', () => {
    expect(dragFrame(320, range)).toEqual({ size: 320, armed: false });
  });

  it('stops at max', () => {
    expect(dragFrame(900, range)).toEqual({ size: 600, armed: false });
  });

  it('follows the pointer below min so the panel visibly slides shut', () => {
    expect(dragFrame(140, range)).toEqual({ size: 140, armed: false });
  });

  it('arms the close once the pointer passes the collapse line, never below closed size', () => {
    expect(dragFrame(90, range)).toEqual({ size: 90, armed: true });
    expect(dragFrame(-40, range)).toEqual({ size: 0, armed: true });
    expect(dragFrame(10, { ...range, closed: 42 })).toEqual({ size: 42, armed: true });
  });
});

describe('releaseDrag', () => {
  it('closes when released past the collapse line', () => {
    expect(releaseDrag(90, range)).toEqual({ collapse: true, size: null });
  });

  it('snaps up to min when released between the collapse line and min', () => {
    expect(releaseDrag(150, range)).toEqual({ collapse: false, size: 180 });
  });

  it('keeps the dragged size, clamped to max', () => {
    expect(releaseDrag(420, range)).toEqual({ collapse: false, size: 420 });
    expect(releaseDrag(5000, range)).toEqual({ collapse: false, size: 600 });
  });
});

describe('sideRange', () => {
  it('lets a side panel grow until the monitor keeps its minimum width', () => {
    const r = sideRange('left', { workspace: 1600, other: 300 });
    expect(r.min).toBe(180);
    expect(r.max).toBe(1600 - 300 - 360 - 10);
    expect(r.collapseAt).toBeLessThan(r.min);
    expect(r.closed).toBe(0);
  });

  it('never reports a max below min on a cramped window', () => {
    const r = sideRange('right', { workspace: 700, other: 400 });
    expect(r.max).toBe(r.min);
  });

  it('gives the right panel a wider floor than the left', () => {
    expect(sideRange('right', { workspace: 1600, other: 0 }).min).toBeGreaterThan(sideRange('left', { workspace: 1600, other: 0 }).min);
  });
});

describe('timelineRange', () => {
  it('lets the timeline grow until the stage keeps its minimum height', () => {
    const r = timelineRange(1000);
    expect(r.min).toBe(180);
    expect(r.max).toBe(1000 - 300);
    expect(r.closed).toBe(42);
    expect(r.collapseAt).toBeGreaterThan(r.closed);
    expect(r.collapseAt).toBeLessThan(r.min);
  });

  it('never reports a max below min on a short window', () => {
    expect(timelineRange(400).max).toBe(180);
  });
});
