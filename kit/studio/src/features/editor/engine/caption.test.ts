import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { desk } from '@/desk/store';
import { server } from '@/test/msw/server';

import { addCaptionAt, removeSelected, toolCaption } from './edits';
import { renderLiveCards } from './inspector';
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

function baseDeck(edit: Partial<DeckEdit> = {}, marks: Deck['marks'] = []): Deck {
  return {
    deck: { ...emptyEdit(), ...edit },
    live: { exists: true, durationSec: 40, pieces: [] },
    space: { cssW: 440, cssH: 950 },
    naturalIds: ['open', 'live-0.00'],
    scenes: [
      { id: 'open', kind: 'plate', title: 'Opening', plateId: 'open', type: 'open', dur: 4 },
      { id: 'live-0.00', kind: 'live', title: 'Feed', recFrom: 0, recTo: 40, dur: 40 },
    ],
    joins: [],
    marks,
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

beforeEach(() => {
  desk.reset();
  desk.set({ slug: 'demo' });
  resetEdForTests();
  ed.deck = baseDeck();
  buildSeq();
});

describe('a caption written in the Editor', () => {
  it('lands on the recording at the playhead, with copy of its own to edit', async () => {
    const posts = captureEdits();
    await addCaptionAt(12);
    expect(posts[0]!['cards']).toEqual([{ key: 'add:caption:12000', kind: 'caption', t: 12, dur: 2, label: 'New caption' }]);
    expect(ed.sel).toEqual({ type: 'card', key: 'add:caption:12000' });
  });

  it('selects the new caption’s card, so Edit copy has a template to open', async () => {
    const key = 'add:caption:12000';
    server.use(
      http.post('/api/video/:slug/edit', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          baseDeck(body, [{ kind: 'caption', t: 12, dur: 2, label: 'New caption', key, added: true }]),
        );
      }),
      http.get('/api/video/:slug/plates', () =>
        HttpResponse.json({
          plates: [
            {
              id: 'overlay:caption:100000',
              liveCard: true,
              kind: 'caption',
              markKey: key,
              htmlUrl: '/media/demo/overlays/overlay-caption-100000.html',
            },
          ],
        }),
      ),
    );
    await addCaptionAt(12);
    expect(ed.sel).toMatchObject({ type: 'card', key, cardId: 'overlay:caption:100000', markT: 12 });
  });

  it('will not sit on a plate — those carry their own copy', async () => {
    const posts = captureEdits();
    ed.t = 1;
    await toolCaption();
    expect(posts).toHaveLength(0);
  });

  it('refuses a second one at the same moment rather than silently replacing it', async () => {
    ed.deck = baseDeck({ cards: [{ key: 'add:caption:12000', kind: 'caption', t: 12, dur: 2, label: 'Mine' }] });
    buildSeq();
    const posts = captureEdits();
    await addCaptionAt(12);
    expect(posts).toHaveLength(0);
  });

  it('can be deleted again, while a card from the script stays put', async () => {
    const script = { key: 'caption:4.000:Open the thread', t: 4, dur: 2 };
    ed.deck = baseDeck({ cards: [script, { key: 'add:caption:12000', kind: 'caption', t: 12, dur: 2, label: 'Mine' }] });
    buildSeq();
    const posts = captureEdits();
    ed.sel = { type: 'card', key: 'caption:4.000:Open the thread' };
    await removeSelected();
    expect(posts).toHaveLength(0);
    ed.sel = { type: 'card', key: 'add:caption:12000' };
    await removeSelected();
    expect(posts[0]!['cards']).toEqual([script]);
  });

  it('is offered on a recording that has no cards at all, and is marked as yours once it is there', () => {
    const live = ed.seq[1]!;
    expect(renderLiveCards(live)).toContain('data-act="add-caption"');
    expect(renderLiveCards(live)).toContain('no re-record needed');

    ed.deck = baseDeck({ cards: [{ key: 'add:caption:12000', kind: 'caption', t: 12, dur: 2, label: 'Mine' }] }, [
      { kind: 'caption', t: 12, dur: 2, label: 'Mine', key: 'add:caption:12000' },
    ]);
    buildSeq();
    const html = renderLiveCards(ed.seq[1]!);
    expect(html).toContain('Mine');
    expect(html).toContain('Yours · at');
  });
});
