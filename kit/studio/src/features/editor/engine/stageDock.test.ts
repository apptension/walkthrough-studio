import { describe, expect, it } from 'vitest';

import { ATTACH_SNAP, DOCK_GAP, dropPanelPlace, layoutStagePanels, nudgePanelPlace, panelDragFrame, parsePanelPlace, serializePanelPlace, type Box, type PanelInput } from './stageDock';

const host = { w: 1000, h: 600 };
const bar = (id: string, w: number, place: PanelInput['place'], order: number, extra: Partial<PanelInput> = {}): PanelInput => ({
  id,
  size: { w, h: 44 },
  place,
  order,
  ...extra,
});
const hits = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('stage dock placement', () => {
  it('round-trips every placement, including attach, and rejects junk', () => {
    expect(parsePanelPlace(serializePanelPlace({ dock: 'attach' }))).toEqual({ dock: 'attach' });
    expect(parsePanelPlace(serializePanelPlace({ dock: 'top' }))).toEqual({ dock: 'top' });
    expect(parsePanelPlace(serializePanelPlace({ dock: 'free', fx: 0.25, fy: 0.75 }))).toEqual({ dock: 'free', fx: 0.25, fy: 0.75 });
    expect(parsePanelPlace('{nope')).toBeNull();
    expect(parsePanelPlace(null)).toBeNull();
  });

  it('lines panels on one rail up side by side, centred, in order', () => {
    const out = layoutStagePanels(host, [bar('zoom', 300, { dock: 'bottom' }, 1), bar('text', 400, { dock: 'bottom' }, 0)]);
    const left = (1000 - (400 + DOCK_GAP + 300)) / 2;
    expect(out['text']).toMatchObject({ x: left, y: 600 - 10 - 44, mode: 'bottom' });
    expect(out['zoom']).toMatchObject({ x: left + 400 + DOCK_GAP, y: 546, mode: 'bottom' });
  });

  it('wraps a crowded rail into a second row that stacks inward', () => {
    const out = layoutStagePanels(host, [bar('a', 600, { dock: 'top' }, 0), bar('b', 600, { dock: 'top' }, 1)]);
    expect(out['a']!.y).toBe(10);
    expect(out['b']!.y).toBe(10 + 44 + DOCK_GAP);
    expect(hits(out['a']!, out['b']!)).toBe(false);
  });

  it('pushes a free panel off a docked one by the shortest way', () => {
    const out = layoutStagePanels(host, [bar('text', 400, { dock: 'bottom' }, 0), bar('zoom', 300, { dock: 'free', fx: 0.5, fy: 0.95 }, 1)]);
    expect(hits(out['text']!, out['zoom']!)).toBe(false);
    expect(out['zoom']!.y + 44).toBeLessThanOrEqual(out['text']!.y);
  });

  it('attaches to the best spot that covers neither its owner nor another panel', () => {
    const ring: Box = { x: 450, y: 250, w: 100, h: 100 };
    const spots = [
      { cx: 500, cy: 572, weight: 5 }, // below — taken by the docked copy bar
      { cx: 500, cy: 200, weight: 1 }, // above
    ];
    const out = layoutStagePanels(host, [bar('text', 400, { dock: 'bottom' }, 0), bar('lens', 300, { dock: 'attach' }, 2, { spots, avoid: [ring] })]);
    expect(out['lens']).toMatchObject({ mode: 'attach' });
    expect(out['lens']!.y + 22).toBe(200);
    expect(hits(out['lens']!, ring)).toBe(false);
  });

  it('keeps a held spot while its owner is dragged, and falls back to a rail with no spots', () => {
    const held = layoutStagePanels(host, [bar('lens', 300, { dock: 'attach' }, 2, { spots: [{ cx: 300, cy: 300, hold: true }, { cx: 800, cy: 100, weight: 9 }] })]);
    expect(held['lens']).toMatchObject({ x: 150, y: 278 });
    const none = layoutStagePanels(host, [bar('zoom', 300, { dock: 'attach' }, 1)]);
    expect(none['zoom']!.mode).toBe('bottom');
  });

  it('drags toward rails and owners, and drops onto what it hovers', () => {
    const size = { w: 300, h: 44 };
    const spots = [{ cx: 500, cy: 300 }];
    expect(panelDragFrame(500, 20, host, size, spots).zone).toBe('top');
    const near = panelDragFrame(500 + ATTACH_SNAP - 2, 300, host, size, spots);
    expect(near.zone).toBe('attach');
    expect(near.cx).toBeLessThan(500 + ATTACH_SNAP - 2);
    expect(dropPanelPlace(500 + 10, 300, host, size, spots)).toEqual({ dock: 'attach' });
    expect(dropPanelPlace(500, 590, host, size, spots)).toEqual({ dock: 'bottom' });
    expect(dropPanelPlace(250, 150, host, size, spots)).toEqual({ dock: 'free', fx: 0.25, fy: 0.25 });
  });

  it('nudges from where the panel is drawn and docks when pushed into an edge', () => {
    const size = { w: 300, h: 44 };
    expect(nudgePanelPlace({ dock: 'attach' }, { cx: 500, cy: 300 }, 12, 0, host, size)).toEqual({ dock: 'free', fx: 0.512, fy: 0.5 });
    expect(nudgePanelPlace({ dock: 'free', fx: 0.5, fy: 0.05 }, { cx: 500, cy: 33 }, 0, -48, host, size)).toEqual({ dock: 'top' });
    expect(nudgePanelPlace({ dock: 'bottom' }, { cx: 500, cy: 568 }, 0, 12, host, size)).toEqual({ dock: 'bottom' });
    expect(nudgePanelPlace({ dock: 'top' }, { cx: 500, cy: 32 }, 0, 12, host, size).dock).toBe('free');
  });
});
