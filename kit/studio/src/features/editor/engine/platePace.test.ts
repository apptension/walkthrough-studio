import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { desk } from '@/desk/store';
import { server } from '@/test/msw/server';

import { toolSpeed } from './edits';
import { closePacePop, lengthRange, openPacePop, paceLabel, pacePopOpen, rateFrac, rateFromFrac, setPaceMode, timingForLength } from './platePace';
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
    space: { cssW: 440, cssH: 950 },
    naturalIds: ['features', 'live-0.00'],
    scenes: [
      { id: 'features', kind: 'plate', title: 'Features', plateId: 'features', type: 'features', dur: 6 },
      { id: 'live-0.00', kind: 'live', title: 'Feed', recFrom: 0, recTo: 40, dur: 40 },
    ],
    joins: [],
    marks: [],
    zoomShots: [],
    lenses: [],
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

const plate = () => ed.seq.find((c) => c.kind === 'plate')!;

beforeEach(() => {
  desk.reset();
  desk.set({ slug: 'demo' });
  resetEdForTests();
  localStorage.clear();
  ed.deck = baseDeck();
  buildSeq();
  document.body.innerHTML = '<button id="etlAddSpeed"></button>';
});

afterEach(() => closePacePop());

describe('speed dial', () => {
  it('puts 1× a third of the way along, slow and fast equally far from it', () => {
    expect(rateFrac(0.5)).toBeCloseTo(0);
    expect(rateFrac(3)).toBeCloseTo(1);
    expect(rateFrac(2) - rateFrac(1)).toBeCloseTo(rateFrac(1) - rateFrac(0.5));
  });

  it('snaps onto presets near them and keeps two decimals elsewhere', () => {
    expect(rateFromFrac(rateFrac(1.48))).toBe(1.5);
    expect(rateFromFrac(rateFrac(1.37))).toBe(1.37);
  });
});

describe('plate length', () => {
  it('holds by default and retimes in stretch mode', () => {
    const c = plate();
    expect(timingForLength(c, 8, 'hold')).toMatchObject({ hold: expect.any(Number) });
    expect(timingForLength(c, 8, 'hold').rate ?? 1).toBe(1);
    expect(timingForLength(c, 3, 'stretch').rate).toBe(2);
  });

  it('reaches further when stretching than when holding', () => {
    const c = plate();
    expect(lengthRange(c, 'stretch').max).toBeGreaterThan(lengthRange(c, 'hold').max);
    expect(lengthRange(c, 'hold').min).toBeGreaterThan(0);
  });

  it('sums up its pace on one chip', () => {
    const deck = baseDeck({ plateTimes: [{ id: 'features', rate: 1.5 }] });
    const [features, ...rest] = deck.scenes || [];
    deck.scenes = [{ ...features!, dur: 4, naturalDur: 6, timing: { trimStart: 0, trimEnd: 0, hold: 0, rate: 1.5 } }, ...rest];
    ed.deck = deck;
    buildSeq();
    expect(paceLabel(plate())).toBe('4.0s · 1.5×');
  });
});

describe('Speed on a plate', () => {
  it('opens the speed & length popover instead of dropping a ramp', async () => {
    const posts = captureEdits();
    ed.t = 1;
    await toolSpeed();
    expect(posts).toHaveLength(0);
    expect(pacePopOpen()).toBe(true);
    const pop = document.querySelector('.pace-pop')!;
    expect(pop.getAttribute('role')).toBe('dialog');
    expect(pop.querySelectorAll('[data-pace-rate]').length).toBeGreaterThan(4);
    expect(document.getElementById('etlAddSpeed')!.classList.contains('is-pace-open')).toBe(true);
  });

  it('saves a speed preset as the plate row the render reads', async () => {
    const posts = captureEdits();
    openPacePop(document.getElementById('etlAddSpeed')!, plate());
    document.querySelector<HTMLButtonElement>('[data-pace-rate="2"]')!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(posts[0]!['plateTimes']).toEqual([{ id: 'features', rate: 2 }]);
  });

  it('retimes to a typed length in stretch mode', async () => {
    setPaceMode('stretch');
    const posts = captureEdits();
    openPacePop(document.getElementById('etlAddSpeed')!, plate());
    const input = document.querySelector<HTMLInputElement>('[data-pace-len]')!;
    input.value = '3';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(posts[0]!['plateTimes']).toEqual([expect.objectContaining({ id: 'features', rate: 2 })]);
  });

  it('closes on a second press of the same button', () => {
    const btn = document.getElementById('etlAddSpeed')!;
    openPacePop(btn, plate());
    openPacePop(btn, plate());
    expect(pacePopOpen()).toBe(false);
    expect(btn.classList.contains('is-pace-open')).toBe(false);
  });
});
