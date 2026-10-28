import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildSeq,
  joinBeforeScene,
  timelineScenes,
  visibleLenses,
  visibleVoiceClips,
  visibleZoomShots,
  visibleZoomSkips,
  zoomSkipCovers,
  zoomSkipOnTimeline,
} from './seq';
import { ed, resetEdForTests } from './state';
import type { DeckEdit } from './types';

const emptyEdit = (): DeckEdit => ({
  speed: [],
  zooms: [],
  zoomSkips: [],
  lenses: [],
  lensOff: [],
  transitions: {},
  audio: null,
  cards: [],
  layouts: [],
  order: [],
  omit: [],
  repeats: [],
  trims: [],
  cuts: [],
});

beforeEach(() => {
  resetEdForTests();
  ed.deck = {
    deck: emptyEdit(),
    live: { exists: true, durationSec: 20, pieces: [] },
    space: { cssW: 1280, cssH: 800 },
    naturalIds: ['open', 'new-proof', 'live-0.00', 'close'],
    scenes: [
      { id: 'open', kind: 'plate', title: 'Opening', plateId: 'open', type: 'open', dur: 4 },
      { id: 'new-proof', kind: 'plate', title: 'Proof', plateId: 'new-proof', type: 'stats', dur: 0 },
      { id: 'live-0.00', kind: 'live', title: 'Recording', recFrom: 0, recTo: 20, dur: 20 },
      { id: 'close', kind: 'plate', title: 'Close', plateId: 'close', type: 'close', dur: 4 },
    ],
    joins: [],
    marks: [],
    zoomShots: [],
    lenses: [],
  };
});

describe('timelineScenes', () => {
  it('keeps zero-duration plates and drops empty live slices', () => {
    const deck = ed.deck!;
    expect(timelineScenes(deck).map((s) => s.id)).toEqual(['open', 'new-proof', 'live-0.00', 'close']);
    deck.scenes = [...(deck.scenes || []), { id: 'dead', kind: 'live', title: 'Gap', dur: 0 }];
    expect(timelineScenes(deck).some((s) => s.id === 'dead')).toBe(false);
  });
});

describe('fx visibility', () => {
  it('hides auto zoom shots covered by a zoom skip', () => {
    ed.deck!.deck!.zoomSkips = [{ from: 4, to: 9 }];
    ed.deck!.zoomShots = [
      { start: 3, end: 10, zoom: 1.3, source: 'auto', points: [] },
      { id: 'mine', start: 12, end: 15, zoom: 1.5, source: 'edit', points: [] },
    ];
    expect(zoomSkipCovers(3, 10, ed.deck!.deck!.zoomSkips)).toBe(true);
    expect(visibleZoomShots().map((s) => s.source)).toEqual(['edit']);
  });

  it('shows no-auto-zoom zones on the row but hides suppress-only entries', () => {
    ed.deck!.deck!.zoomSkips = [
      { from: 4, to: 9, suppress: true },
      { from: 12, to: 14, zone: true },
      { from: 20, to: 25 },
    ];
    ed.deck!.zoomShots = [{ start: 20, end: 25, zoom: 1.3, source: 'auto', points: [] }];
    expect(zoomSkipOnTimeline({ from: 4, to: 9, suppress: true }, [])).toBe(false);
    expect(zoomSkipOnTimeline({ from: 12, to: 14, zone: true }, [])).toBe(true);
    expect(zoomSkipOnTimeline({ from: 20, to: 25 }, ed.deck!.zoomShots)).toBe(true);
    expect(visibleZoomSkips().map((x) => x.i)).toEqual([1, 2]);
  });

  it('drops muted voice lines from the timeline list', () => {
    ed.deck!.audio = {
      voiceClips: [
        { key: 'a', kind: 'line', start: 1, dur: 2, full: 2, trimStart: 0, trimEnd: 0, writtenStart: 1, text: 'A' },
        { key: 'b', kind: 'line', start: 4, dur: 2, full: 2, trimStart: 0, trimEnd: 0, writtenStart: 4, text: 'B', mute: true },
      ],
    };
    expect(visibleVoiceClips().map((c) => c.key)).toEqual(['a']);
  });

  it('drops switched-off recorded magnifiers from the timeline list', () => {
    ed.deck!.lenses = [{ id: 'l1', t: 2, dur: 2, x: 0, y: 0, w: 10, h: 10, key: 'l1', source: 'edit' } as never];
    ed.deck!.recordedLenses = [{ t: 5, dur: 2, label: 'Loupe', rect: { x: 0, y: 0, w: 10, h: 10 }, off: true }];
    expect(visibleLenses().every((l) => l.source !== 'off')).toBe(true);
    expect(visibleLenses()).toHaveLength(1);
  });
});

describe('joinBeforeScene', () => {
  it('uses server segment index when a zero-length live slice is omitted from the timeline', () => {
    ed.deck!.scenes = [
      { index: 0, id: 'open', kind: 'plate', title: 'Opening', plateId: 'open', type: 'open', dur: 4 },
      { index: 1, id: 'dead', kind: 'live', title: 'Gap', dur: 0 },
      { index: 2, id: 'live-0.00', kind: 'live', title: 'Recording', recFrom: 0, recTo: 20, dur: 20 },
    ];
    ed.deck!.joins = [
      {
        key: 'a',
        prev: { id: 'open', kind: 'plate', title: 'Opening' },
        next: { id: 'dead', kind: 'live', title: 'Gap' },
        pinned: { duration: 0.5 },
      },
      {
        key: 'b',
        prev: { id: 'dead', kind: 'live', title: 'Gap' },
        next: { id: 'live-0.00', kind: 'live', title: 'Recording' },
        pinned: { duration: 0.8 },
      },
    ];
    buildSeq();
    const live = ed.seq.find((c) => c.id === 'live-0.00');
    expect(live?.join?.pinned?.duration).toBe(0.8);
    expect(joinBeforeScene(ed.deck, 2)?.pinned?.duration).toBe(0.8);
  });
});

describe('buildSeq', () => {
  it('floors zero-length plate scenes so the scrubber can land on a newly added slide', () => {
    buildSeq();
    const plate = ed.seq.find((c) => c.plateId === 'new-proof');
    expect(plate).toBeTruthy();
    expect(plate!.dur).toBeGreaterThanOrEqual(0.5);
    const next = ed.seq[ed.seq.indexOf(plate!) + 1];
    expect(next!.at).toBeGreaterThan(plate!.at);
  });
});
