import { describe, expect, it } from 'vitest';

import {
  TB_MARGIN,
  clampCentre,
  dragFrame,
  dropPlacement,
  effectivePlacement,
  freeFromCentre,
  nudgePlacement,
  parsePlacement,
  placementCentre,
  placementCoords,
  serializePlacement,
  snapZoneFor,
} from './textBarPlace';

const host = { w: 1000, h: 600 };
const bar = { w: 400, h: 40 };

describe('text bar placement', () => {
  it('parses and round-trips docks and free spots, rejecting junk', () => {
    expect(parsePlacement(serializePlacement({ dock: 'top' }))).toEqual({ dock: 'top' });
    expect(parsePlacement(serializePlacement({ dock: 'bottom' }))).toEqual({ dock: 'bottom' });
    expect(parsePlacement(serializePlacement({ dock: 'free', fx: 0.123456, fy: 0.5 }))).toEqual({ dock: 'free', fx: 0.1235, fy: 0.5 });
    expect(parsePlacement('{"dock":"free","fx":3,"fy":-1}')).toEqual({ dock: 'free', fx: 1, fy: 0 });
    expect(parsePlacement('{"x":120,"y":40}')).toBeNull();
    expect(parsePlacement('{"dock":"left"}')).toBeNull();
    expect(parsePlacement('not json')).toBeNull();
    expect(parsePlacement(null)).toBeNull();
  });

  it('defaults to bottom-centre, or top-centre when a caption prefers it; a saved choice wins', () => {
    expect(effectivePlacement(null)).toEqual({ dock: 'bottom' });
    expect(effectivePlacement(null, true)).toEqual({ dock: 'top' });
    expect(effectivePlacement({ dock: 'bottom' }, true)).toEqual({ dock: 'bottom' });
  });

  it('anchors docks to the host edge centre and free spots to the bar centre', () => {
    expect(placementCoords({ dock: 'top' }, host, bar)).toEqual({ x: 500, y: TB_MARGIN, ax: 0.5, ay: 0 });
    expect(placementCoords({ dock: 'bottom' }, host, bar)).toEqual({ x: 500, y: 600 - TB_MARGIN, ax: 0.5, ay: 1 });
    expect(placementCoords({ dock: 'free', fx: 0.5, fy: 0.5 }, host, bar)).toEqual({ x: 500, y: 300, ax: 0.5, ay: 0.5 });
    expect(placementCentre({ dock: 'top' }, host, bar)).toEqual({ cx: 500, cy: TB_MARGIN + 20 });
    expect(placementCentre({ dock: 'bottom' }, host, bar)).toEqual({ cx: 500, cy: 600 - TB_MARGIN - 20 });
  });

  it('keeps free spots inside the host and survives a resize relatively', () => {
    const p = freeFromCentre(250, 150, host, bar);
    expect(p).toEqual({ dock: 'free', fx: 0.25, fy: 0.25 });
    // Same relative spot on a larger host.
    expect(placementCoords(p, { w: 2000, h: 1200 }, bar)).toMatchObject({ x: 500, y: 300 });
    // A shrunken host clamps the bar fully inside.
    const small = placementCoords({ dock: 'free', fx: 0.99, fy: 0.99 }, { w: 500, h: 300 }, bar);
    expect(small.x + bar.w / 2).toBeLessThanOrEqual(500 - TB_MARGIN);
    expect(small.y + bar.h / 2).toBeLessThanOrEqual(300 - TB_MARGIN);
    // A host narrower than the bar centres it instead of flipping the clamp.
    expect(clampCentre(0, 0, { w: 300, h: 600 }, bar).cx).toBe(150);
  });

  it('detects the top and bottom snap zones within the threshold', () => {
    expect(snapZoneFor(TB_MARGIN + 20 + 30, host, bar)).toBe('top');
    expect(snapZoneFor(300, host, bar)).toBeNull();
    expect(snapZoneFor(600 - TB_MARGIN - 20 - 47, host, bar)).toBe('bottom');
    expect(snapZoneFor(600 - TB_MARGIN - 20 - 60, host, bar)).toBeNull();
    // A host too short for a gap picks the nearer edge.
    expect(snapZoneFor(40, { w: 1000, h: 120 }, bar)).toBe('top');
    expect(snapZoneFor(90, { w: 1000, h: 120 }, bar)).toBe('bottom');
  });

  it('pulls a hovering drag toward the dock slot, and leaves open space alone', () => {
    const free = dragFrame(200, 300, host, bar);
    // Clamped so the bar's left edge sits at the margin.
    expect(free).toMatchObject({ zone: null, cx: TB_MARGIN + bar.w / 2, cy: 300 });
    const near = dragFrame(300, 60, host, bar);
    expect(near.zone).toBe('top');
    expect(near.cy).toBeLessThan(60);
    expect(near.cy).toBeGreaterThan(TB_MARGIN + 20);
    expect(near.cx).toBeGreaterThan(300);
    expect(near.raw).toEqual({ cx: 300, cy: 60 });
  });

  it('drops into a dock near an edge, else stores a relative free spot', () => {
    expect(dropPlacement(300, 50, host, bar)).toEqual({ dock: 'top' });
    expect(dropPlacement(800, 570, host, bar)).toEqual({ dock: 'bottom' });
    expect(dropPlacement(500, 300, host, bar)).toEqual({ dock: 'free', fx: 0.5, fy: 0.5 });
  });

  it('nudges with the keyboard and docks when pushed against an edge', () => {
    const fromTop = nudgePlacement({ dock: 'top' }, 0, 12, host, bar);
    expect(fromTop.dock).toBe('free');
    expect(nudgePlacement({ dock: 'top' }, 0, -12, host, bar)).toEqual({ dock: 'top' });
    expect(nudgePlacement({ dock: 'bottom' }, 48, 0, host, bar)).toMatchObject({ dock: 'free' });
    const nearTop = freeFromCentre(500, TB_MARGIN + 20 + 5, host, bar);
    expect(nudgePlacement(nearTop, 0, -12, host, bar)).toEqual({ dock: 'top' });
    const mid = nudgePlacement({ dock: 'free', fx: 0.5, fy: 0.5 }, 100, 60, host, bar);
    expect(mid).toEqual({ dock: 'free', fx: 0.6, fy: 0.6 });
  });
});
