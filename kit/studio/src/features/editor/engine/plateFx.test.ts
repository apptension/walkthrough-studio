import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { desk } from '@/desk/store';
import { server } from '@/test/msw/server';

import { aimSpace, lensPatchFor, markClock } from './aim';
import { addLensAt, addZoomAt } from './edits';
import { placePlateGlass, resetPlateGlassForTests } from './plateGlass';
import { buildSeq, fxClipId, shotByKey } from './seq';
import { drawPlate } from './stage';
import { ed, resetEdForTests } from './state';
import { fxSegments } from './timeline';
import type { Deck, DeckEdit, Lens } from './types';

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

function baseDeck(edit: Partial<DeckEdit> = {}, over: Partial<Deck> = {}): Deck {
  return {
    deck: { ...emptyEdit(), ...edit },
    live: { exists: true, durationSec: 40, pieces: [] },
    space: { cssW: 440, cssH: 950 },
    plateFrame: { width: 1920, height: 1080 },
    naturalIds: ['ch1-ask-hn', 'live-0.00'],
    scenes: [
      { id: 'ch1-ask-hn', kind: 'plate', title: 'Ask HN', plateId: 'ch1-ask-hn', type: 'statement', dur: 6 },
      { id: 'live-0.00', kind: 'live', title: 'Feed', recFrom: 0, recTo: 40, dur: 40 },
    ],
    joins: [],
    marks: [],
    zoomShots: [],
    lenses: [],
    ...over,
  };
}

function captureEdits(): Array<Record<string, unknown>> {
  const posts: Array<Record<string, unknown>> = [];
  server.use(
    http.post('/api/video/:slug/edit', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      posts.push(body);
      return HttpResponse.json(baseDeck({ ...(ed.deck?.deck || {}), ...body }));
    }),
  );
  return posts;
}

beforeEach(() => {
  desk.reset();
  desk.set({ slug: 'demo' });
  resetEdForTests();
  ed.deck = baseDeck();
  buildSeq();
});

describe('fxClipId', () => {
  it('names the plate a mark belongs to, and follows a replay back to its source', () => {
    expect(fxClipId(ed.seq[0])).toBe('ch1-ask-hn');
    expect(fxClipId(ed.seq[1])).toBeNull();
    expect(fxClipId({ ...ed.seq[0]!, id: 'ch1-ask-hn+2', repeatOf: 'ch1-ask-hn' })).toBe('ch1-ask-hn');
  });
});

describe('a zoom on a plate', () => {
  it('is written on the plate\u2019s own clock, aimed as a fraction of the delivered frame', async () => {
    const posts = captureEdits();
    ed.t = 2;
    await addZoomAt(0, 3, 1.8, ed.seq[0]);
    expect(posts[0]!['zooms']).toEqual([{ id: 'z-ch1-ask-hn-20', clip: 'ch1-ask-hn', t: 2, dur: 3, zoom: 1.8, nx: 0.5, ny: 0.5 }]);
  });

  it('reads back as a shot the stage and the aim box can drive', () => {
    ed.deck = baseDeck({}, { plateZooms: [{ id: 'pz1', clip: 'ch1-ask-hn', t: 1.2, dur: 3, zoom: 1.8, nx: 0.25, ny: 0.5 }] });
    buildSeq();
    expect(shotByKey('pz1')).toMatchObject({ id: 'pz1', clip: 'ch1-ask-hn', start: 1.2, end: 4.2, zoom: 1.8 });
    expect(shotByKey('nope')).toBeNull();
  });
});

describe('a magnifier on a plate', () => {
  it('starts centred at the playhead and lands in the deck with fractional size', async () => {
    const posts = captureEdits();
    ed.t = 1.5;
    await addLensAt(0, 2.6, ed.seq[0]);
    expect(posts[0]!['lenses']).toEqual([
      { id: 'm-ch1-ask-hn-15', clip: 'ch1-ask-hn', t: 1.5, dur: 2.6, nx: 0.5, ny: 0.5, nw: 0.13, nh: 0.055 },
    ]);
  });

  it('converts a drag in stage pixels back into fractions of the frame', () => {
    const plate = { clip: 'ch1-ask-hn' } as Lens;
    expect(lensPatchFor(plate, { x: 960, y: 270, w: 192, h: 54 })).toEqual({ nx: 0.5, ny: 0.25, nw: 0.1, nh: 0.05 });
    expect(lensPatchFor(plate, { zoom: 2 })).toEqual({ zoom: 2 });
    expect(lensPatchFor({} as Lens, { x: 100, y: 40 })).toEqual({ x: 100, y: 40 });
  });

  it('still lands on the timeline when the video has no recording at all', () => {
    ed.deck = baseDeck({}, {
      live: { exists: false, durationSec: 0, pieces: [] },
      scenes: [{ id: 'ch1-ask-hn', kind: 'plate', title: 'Ask HN', plateId: 'ch1-ask-hn', type: 'statement', dur: 6 }],
      naturalIds: ['ch1-ask-hn'],
    });
    buildSeq();
    expect(fxSegments(1, 3, 'ch1-ask-hn')).toMatchObject([{ a: 1, b: 3 }]);
  });
});

describe('plate and recording clocks', () => {
  it('maps a stretch of the plate onto the timeline, stretched by its retiming', () => {
    const slow = baseDeck({ plateTimes: [{ id: 'ch1-ask-hn', rate: 0.5 }] });
    slow.scenes![0] = { ...slow.scenes![0]!, naturalDur: 6, dur: 12, timing: { trimStart: 0, trimEnd: 0, hold: 0, rate: 0.5 } };
    ed.deck = slow;
    buildSeq();
    const [seg] = fxSegments(1, 3, 'ch1-ask-hn');
    expect(seg).toBeTruthy();
    expect(seg!.a).toBeCloseTo(2, 2);
    expect(seg!.b).toBeCloseTo(6, 2);
    expect(fxSegments(1, 3, 'other')).toEqual([]);
  });

  it('puts the playhead on the clock the mark is written in', () => {
    ed.t = 2;
    expect(markClock('ch1-ask-hn', ed.seq[0]!)).toBeCloseTo(2, 2);
    expect(markClock('ch1-ask-hn', ed.seq[1]!)).toBeNull();
    ed.t = 8;
    expect(markClock(null, ed.seq[1]!)).toBeCloseTo(2, 2);
  });

  it('aims plate marks against the delivered frame, recording marks against the capture', () => {
    expect(aimSpace('ch1-ask-hn')).toEqual({ width: 1920, height: 1080 });
    expect(aimSpace(null)).toEqual({ width: 440, height: 950 });
  });
});

describe('the magnifier\u2019s live mirror', () => {
  it('is tucked away on a frame that does not draw through it', () => {
    resetPlateGlassForTests();
    const glass = document.createElement('div');
    glass.id = 'plateLoupeGlass';
    const frame = document.createElement('iframe');
    frame.id = 'plateLoupeFrame';
    glass.appendChild(frame);
    document.body.appendChild(glass);
    // A glass left over from the previous slide.
    placePlateGlass({ left: 100, top: 100, r: 50, cx: 10, cy: 10, scale: 2, alpha: 1 });
    expect(glass.hidden).toBe(false);
    // The slide the playhead moved to has no document yet, so nothing paints through the glass.
    expect(drawPlate(ed.seq[0]!)).toBe(false);
    expect(glass.hidden).toBe(true);
    glass.remove();
  });
});
