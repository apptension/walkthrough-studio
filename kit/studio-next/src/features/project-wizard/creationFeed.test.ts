import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import type { ExploreFeed, ExploreScreen } from '@/api/types';
import { makeScript, makeScriptScene } from '@/test/factories';
import { endpoints } from '@/test/msw/endpoints';
import { server } from '@/test/msw/server';

import { agentPulse, creationFeed, firstSentences, screenFor, storyCards, storyTotals, useCreationFeed } from './creationFeed';

const screen = (id: string, label: string, extra: Partial<ExploreScreen> = {}): ExploreScreen => ({
  id,
  label,
  title: label,
  url: `https://acme.test/${label.toLowerCase()}`,
  path: `/${label.toLowerCase()}`,
  dialog: null,
  heading: '',
  reachedBy: null,
  controls: 3,
  tried: 0,
  shot: `/media/demo/browse/shots/${id}.jpg`,
  ...extra,
});

afterEach(() => creationFeed.reset());

describe('agentPulse', () => {
  it('keeps the newest thought and turns tool calls into readable moves, newest first', () => {
    const pulse = agentPulse([
      { kind: 'system', text: 'Launching Cursor agent…' },
      { kind: 'think', text: 'I have the brief. I will now explore the live product using the browse CLI.' },
      { kind: 'tool', id: 1, title: 'Read', text: '/x/videos/demo/brief.json', done: true },
      { kind: 'tool', id: 2, title: 'Get Mcp Tools', text: '', done: true },
      { kind: 'tool', id: 3, title: 'Shell', text: 'cli.mjs browse demo look --url https://acme.test/app', done: true },
      { kind: 'tool', id: 4, title: 'Shell', text: 'cli.mjs browse demo note "Hero: strongest promise"', done: true },
      { kind: 'say', text: "Home hero is up — checking the screenshot. Then I'll visit every destination." },
      { kind: 'tool', id: 5, title: 'Write', text: '/x/videos/demo/flow.mjs', done: false },
    ]);
    expect(pulse.thought).toBe("Home hero is up — checking the screenshot. Then I'll visit every destination.");
    expect(pulse.actions.map((a) => `${a.verb} ${a.object}`)).toEqual(['Writing flow.mjs', 'Noted Hero: strongest promise', 'Opened acme.test/app', 'Read brief.json']);
    expect(pulse.actions[0]?.done).toBe(false);
  });

  it('clips long thoughts at a sentence', () => {
    expect(firstSentences(`One short sentence. ${'word '.repeat(60)}`, 60)).toBe('One short sentence.');
    expect(firstSentences('')).toBe('');
  });
});

describe('storyCards', () => {
  it('drops the untouched scaffold and template copy', () => {
    expect(storyCards({ ...makeScript().script, scaffold: true })).toEqual([]);
    const cards = storyCards({
      scenes: [makeScriptScene({ kind: 'open', key: 'open', title: 'First line of the promise' }), makeScriptScene({ key: 'c1', title: 'First chapter' })],
    });
    expect(cards).toEqual([]);
  });

  it('numbers chapters, folds captions into beats and keeps plates and closers', () => {
    const cards = storyCards({
      scenes: [
        makeScriptScene({ kind: 'open', key: 'open', title: 'Plan your *team*', narration: 'Meet Acme.' }),
        makeScriptScene({ key: 'c1', title: 'Scheduling' }),
        makeScriptScene({ kind: 'step', key: 's1', title: 'Drag a booking' }),
        makeScriptScene({ kind: 'step', key: 's2', title: 'Resize it' }),
        makeScriptScene({ kind: 'plate', key: 'p1', title: '3× faster', plateType: 'stat' }),
        makeScriptScene({ key: 'c2', title: 'Reports' }),
        makeScriptScene({ kind: 'close', key: 'close', title: 'Start free' }),
      ],
    });
    expect(cards.map((c) => [c.kind, c.n, c.title, c.beats])).toEqual([
      ['open', 0, 'Plan your team', 0],
      ['chapter', 1, 'Scheduling', 2],
      ['plate', 0, '3× faster', 0],
      ['chapter', 2, 'Reports', 0],
      ['close', 0, 'Start free', 0],
    ]);
    expect(cards[2]?.plateType).toBe('stat');
    expect(storyTotals(cards)).toMatchObject({ chapters: 2, plates: 1, beats: 2 });
    expect(storyTotals([], makeScript().script)).toEqual({ chapters: 0, plates: 0, beats: 0, words: 0, estSec: 0 });
  });
});

describe('screenFor', () => {
  it('matches chapters to screens by words, then fills in exploration order', () => {
    const cards = storyCards({
      scenes: [makeScriptScene({ key: 'a', title: 'Reports that answer questions', narration: '' }), makeScriptScene({ key: 'b', title: 'Getting started', narration: '' })],
    });
    const shots = screenFor(cards, [screen('S1', 'Home'), screen('S2', 'Reports'), screen('S3', 'Missing', { shot: null })]);
    expect(shots.get('a')?.id).toBe('S2');
    expect(shots.get('b')?.id).toBe('S1');
  });
});

describe('creationFeed polling', () => {
  it('reads the explore feed and the live script for the bound project only', async () => {
    const feed: ExploreFeed = { startedAt: null, signedIn: true, current: 'S1', screens: [screen('S1', 'Home')], moves: [], notes: [], shots: 1, preview: null };
    server.use(
      http.get(endpoints.exploreFeed('demo'), () => HttpResponse.json(feed)),
      http.get('/api/video/demo/script', () => HttpResponse.json(makeScript())),
    );
    await creationFeed.pollExplore();
    expect(useCreationFeed.getState().explore).toBeNull();
    creationFeed.bind('demo', 'acme');
    await creationFeed.pollExplore();
    await creationFeed.pollScript();
    const s = useCreationFeed.getState();
    expect(s.explore?.screens[0]?.label).toBe('Home');
    expect(s.story.map((c) => c.title)).toEqual(['The feature']);
    expect(s.totals.words).toBe(8);
    creationFeed.pin('S1');
    expect(useCreationFeed.getState().pinned).toBe('S1');
    creationFeed.pin('S1');
    expect(useCreationFeed.getState().pinned).toBeNull();
  });
});
