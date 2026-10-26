import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { desk } from '@/desk/store';
import { server } from '@/test/msw/server';

import { canDuplicate, duplicateSelected, freeSlot, naturalLive } from './duplicate';
import { omitClip } from './edits';
import { buildSeq } from './seq';
import { ed, resetEdForTests } from './state';
import type { Deck, DeckEdit } from './types';

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

function baseDeck(edit: Partial<DeckEdit> = {}): Deck {
  return {
    deck: { ...emptyEdit(), ...edit },
    live: { exists: true, durationSec: 40, pieces: [] },
    space: { cssW: 1280, cssH: 800 },
    naturalIds: ['open', 'live-0.00', 'features', 'live-20.00', 'close'],
    scenes: [
      { id: 'open', kind: 'plate', title: 'Opening', plateId: 'open', type: 'open', dur: 4 },
      { id: 'live-0.00', kind: 'live', title: 'Feed', recFrom: 0, recTo: 20, dur: 20 },
      { id: 'features', kind: 'plate', title: 'Features', plateId: 'features', type: 'features', dur: 5 },
      { id: 'live-20.00', kind: 'live', title: 'Ask', recFrom: 20, recTo: 40, dur: 20 },
      { id: 'close', kind: 'plate', title: 'Summary', plateId: 'close', type: 'close', dur: 4 },
    ],
    joins: [],
    marks: [{ kind: 'caption', t: 4, dur: 2, label: 'Open the thread', key: 'caption:4.000:Open the thread' }],
    zoomShots: [{ start: 5, end: 8, zoom: 1.6, source: 'edit', id: 'z50', points: [{ t: 5, cx: 300, cy: 200 }] }],
    lenses: [],
  };
}

/** Captures what the Editor posts to /edit and answers with the deck it would get back. */
function captureEdits(): Array<Record<string, unknown>> {
  const posts: Array<Record<string, unknown>> = [];
  server.use(
    http.post('/api/video/:slug/edit', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      posts.push(body);
      const next = baseDeck({ ...(ed.deck?.deck || {}), ...body });
      return HttpResponse.json(next);
    }),
  );
  return posts;
}

beforeEach(() => {
  desk.reset();
  desk.set({ slug: 'demo' });
  resetEdForTests();
  ed.deck = baseDeck({ zooms: [{ id: 'z50', t: 5, dur: 3, zoom: 1.6, x: 300, y: 200 }] });
  buildSeq();
});

describe('freeSlot', () => {
  it('lands right after the original, skipping anything in the way', () => {
    expect(freeSlot(2, { after: 4, before: 2, busy: [{ from: 2, to: 4 }], lo: 0, hi: 20 })).toBe(4.25);
    expect(freeSlot(2, { after: 4, before: 2, busy: [{ from: 2, to: 4 }, { from: 5, to: 9 }], lo: 0, hi: 20 })).toBe(9.25);
  });

  it('falls back to before the original when the tail is full, and gives up when both are', () => {
    expect(freeSlot(2, { after: 18, before: 16, busy: [{ from: 16, to: 18 }], lo: 0, hi: 19 })).toBe(13.75);
    expect(freeSlot(5, { after: 4, before: 0, busy: [{ from: 0, to: 4 }], lo: 0, hi: 6 })).toBeNull();
  });

  it('honours a fit test (a stretch that is cut away does not count)', () => {
    const fits = (a: number) => a >= 10;
    const t = freeSlot(1, { after: 2, before: 1, busy: [], lo: 0, hi: 20, fits }) ?? 0;
    expect(t).toBeGreaterThanOrEqual(10);
    expect(t).toBeLessThan(10.2);
  });
});

describe('canDuplicate', () => {
  it('names what will be copied, and says why the music bed cannot be', () => {
    expect(canDuplicate(null).ok).toBe(false);
    expect(canDuplicate({ type: 'clip', id: 'features' })).toMatchObject({ ok: true, label: 'Duplicate plate' });
    expect(canDuplicate({ type: 'clip', id: 'live-0.00' })).toMatchObject({ ok: true, label: 'Duplicate section' });
    expect(canDuplicate({ type: 'zoom', key: 'z50' })).toMatchObject({ ok: true, label: 'Duplicate zoom' });
    expect(canDuplicate({ type: 'range', from: 1, to: 1.2 }).ok).toBe(false);
    expect(canDuplicate({ type: 'music' })).toMatchObject({ ok: false, why: expect.stringMatching(/loops/) });
  });
});

describe('duplicateSelected', () => {
  it('copies a zoom to the next free stretch with the same level and aim', async () => {
    const posts = captureEdits();
    ed.sel = { type: 'zoom', key: 'z50' };
    await duplicateSelected();
    expect(posts).toHaveLength(1);
    const zooms = posts[0]!['zooms'] as Array<Record<string, number | string>>;
    expect(zooms).toHaveLength(2);
    expect(zooms[1]).toMatchObject({ t: 8.25, dur: 3, zoom: 1.6, x: 300, y: 200, id: 'z83' });
    expect(ed.sel).toEqual({ type: 'zoom', key: 'z83' });
  });

  it('plays a section again right after itself, keeping its trims', async () => {
    ed.deck = baseDeck({ trims: [{ id: 'live-0.00', trimStart: 1 }] });
    ed.deck.scenes![1] = { ...ed.deck.scenes![1]!, recFrom: 1 };
    buildSeq();
    const posts = captureEdits();
    ed.sel = { type: 'clip', id: 'live-0.00' };
    await duplicateSelected();
    expect(posts[0]).toMatchObject({ repeats: ['live-0.00+2'], trims: [{ id: 'live-0.00', trimStart: 1 }, { id: 'live-0.00+2', trimStart: 1 }] });
  });

  it('turns a picked stretch into a replay trimmed to that stretch', async () => {
    const posts = captureEdits();
    expect(naturalLive(ed.seq[1]!)).toEqual({ id: 'live-0.00', from: 0, to: 20 });
    ed.sel = { type: 'range', clipId: 'live-0.00', from: 6, to: 9 };
    await duplicateSelected();
    expect(posts[0]).toMatchObject({ repeats: ['live-0.00+2'], trims: [{ id: 'live-0.00+2', trimStart: 6, trimEnd: 11 }] });
  });

  it('puts a duplicated plate after its source when the cut has its own order', async () => {
    ed.deck = baseDeck({ order: ['open', 'features', 'live-0.00', 'live-20.00', 'close'] });
    buildSeq();
    const posts = captureEdits();
    ed.sel = { type: 'clip', id: 'features' };
    await duplicateSelected();
    expect(posts[0]).toMatchObject({ repeats: ['features+2'], order: ['open', 'features', 'features+2', 'live-0.00', 'live-20.00', 'close'] });
  });

  it('a duplicated plate keeps its retiming, and loses it with the copy', async () => {
    ed.deck = baseDeck({ plateTimes: [{ id: 'features', hold: 1.5, rate: 1.25 }] });
    buildSeq();
    const posts = captureEdits();
    ed.sel = { type: 'clip', id: 'features' };
    await duplicateSelected();
    expect(posts[0]).toMatchObject({ repeats: ['features+2'], plateTimes: [{ id: 'features', hold: 1.5, rate: 1.25 }, { id: 'features+2', hold: 1.5, rate: 1.25 }] });

    ed.deck = baseDeck({ repeats: ['features+2'], plateTimes: [{ id: 'features', hold: 1.5 }, { id: 'features+2', hold: 1.5 }] });
    ed.deck.scenes!.splice(3, 0, { id: 'features+2', kind: 'plate', title: 'Features', plateId: 'features', type: 'features', dur: 5, repeatOf: 'features' });
    buildSeq();
    await omitClip('features+2');
    expect(posts[1]).toMatchObject({ repeats: [], plateTimes: [{ id: 'features', hold: 1.5 }] });
  });

  it('shows a card again after the original with the same copy', async () => {
    const posts = captureEdits();
    ed.sel = { type: 'card', key: 'caption:4.000:Open the thread', cardId: 'overlay:caption:1' };
    await duplicateSelected();
    expect(posts[0]!['cards']).toEqual([{ key: 'caption:4.000:Open the thread#2', copyOf: 'caption:4.000:Open the thread', t: 6.25, dur: 2 }]);
  });

  it('copies a voice line through the server so its audio comes along', async () => {
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.post('/api/video/:slug/voice/line/add', async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...baseDeck(), key: 'adlib-1' });
      }),
    );
    ed.deck = { ...baseDeck(), audio: { voiceClips: [{ key: 'intro', kind: 'intro', start: 1, dur: 3, full: 3, trimStart: 0, trimEnd: 0, writtenStart: 1 }] } };
    buildSeq();
    const start = ed.deck.audio!.voiceClips![0]!.start;
    ed.sel = { type: 'voice', key: 'intro' };
    await duplicateSelected();
    expect(sent).toEqual({ copyFrom: 'intro', at: Math.round((start + 3.25) * 1000) / 1000 });
  });

  it('a duplicated section is removed from the replays, not omitted', async () => {
    ed.deck = baseDeck({ repeats: ['features+2'] });
    ed.deck.scenes!.splice(3, 0, { id: 'features+2', kind: 'plate', title: 'Features', plateId: 'features', type: 'features', dur: 5, repeatOf: 'features' });
    buildSeq();
    expect(ed.seq.find((c) => c.id === 'features+2')?.repeatOf).toBe('features');
    const posts = captureEdits();
    await omitClip('features+2');
    expect(posts[0]).toMatchObject({ repeats: [], order: [] });
    expect(posts[0]).not.toHaveProperty('omit');
  });
});
