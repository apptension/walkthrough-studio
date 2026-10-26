import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VideoSummary } from '@/api/types';
import { makeIndex, makeVideo } from '@/test/factories';

vi.mock('./api', () => ({ api: vi.fn(), enc: encodeURIComponent }));

const { api } = await import('./api');
const { desk } = await import('./store');
const { runtime } = await import('./runtime');
const video = await import('./video');

const mockedApi = vi.mocked(api);

function fakePlayer(): HTMLVideoElement {
  const el = document.createElement('video');
  el.pause = vi.fn();
  el.load = vi.fn();
  el.play = vi.fn(() => Promise.resolve());
  return el;
}

function serve(summary: VideoSummary) {
  mockedApi.mockImplementation((path: string) => {
    if (path === `/api/video/${summary.slug}`) return Promise.resolve(summary);
    if (path === `/api/video/${summary.slug}/captions`) return Promise.resolve({ clips: [{ start: 0, end: 1, text: 'Hi' }] });
    if (path === '/api/videos') return Promise.resolve(makeIndex());
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

beforeEach(() => {
  desk.reset();
  mockedApi.mockReset();
  runtime.player = fakePlayer();
  video.dismissBoot();
});
afterEach(() => {
  runtime.player = null;
});

describe('loadVideo', () => {
  it('lands the summary: action, status, captions and the program master', async () => {
    const v = makeVideo({
      slug: 'demo',
      deliveryUrl: '/media/demo/demo.mp4',
      youtubeChaptersUrl: undefined,
      recordFailure: null,
      freshness: { liveAt: Date.parse('2026-10-01T10:00:00Z') },
    });
    serve(v);
    desk.set({ slug: 'demo' });
    await video.loadVideo('demo');
    const s = desk.get();
    expect(s.video?.slug).toBe('demo');
    expect(s.action).not.toBeNull();
    // The render state lives on `action`; the status line only carries activity and notices.
    expect(s.status.text).not.toBe(s.action?.status);
    expect(s.cues).toEqual([{ start: 0, end: 1, text: 'Hi' }]);
    expect(s.programLoaded).toBe(true);
    expect(runtime.player?.getAttribute('src')).toMatch(/^\/media\/demo\/demo\.mp4\?t=\d+$/);
  });

  it('drops a summary that lands after the picker moved on', async () => {
    serve(makeVideo({ slug: 'demo' }));
    desk.set({ slug: 'other' });
    await video.loadVideo('demo');
    expect(desk.get().video).toBeNull();
  });

  it('toasts and rethrows when the summary cannot load', async () => {
    mockedApi.mockRejectedValue(new Error('404 Not Found'));
    desk.set({ slug: 'demo' });
    await expect(video.loadVideo('demo')).rejects.toThrow('404 Not Found');
    expect(desk.get().toasts.at(-1)).toMatchObject({ title: 'Could not open sequence', kind: 'err' });
  });

  it('clears plate and compare leftovers when switching sequences', async () => {
    serve(makeVideo({ slug: 'two' }));
    desk.set({ slug: 'two', video: makeVideo({ slug: 'one' }), plateDirty: true, compare: true, ytText: 'x' });
    await video.loadVideo('two');
    expect(desk.get()).toMatchObject({ plateDirty: false, compare: false });
  });
});

describe('applySummary', () => {
  it('prunes the version selection to versions that still exist', () => {
    const v = makeVideo({ slug: 'demo' });
    const keep = v.versions?.[0]?.id ?? 'none';
    desk.set({ versionSelection: [keep, 'gone'] });
    video.applySummary(v);
    expect(desk.get().versionSelection).toEqual(v.versions?.length ? [keep] : []);
  });

  it('keeps the pipeline headline while busy and only flips the pill', () => {
    desk.set({ jobBusy: true, bay: { pillClass: 'render-pill run', pillText: 'Step 2/5', headline: 'Recording', reason: 'r' } });
    video.applySummary(makeVideo({ slug: 'demo' }));
    expect(desk.get().bay).toEqual({ pillClass: 'render-pill run', pillText: 'Rendering', headline: 'Recording', reason: 'r' });
  });
});

describe('slug helpers', () => {
  it('writes the slug into the URL and names it from the index', async () => {
    mockedApi.mockResolvedValue(makeIndex());
    await video.refreshVideoIndex();
    const first = desk.get().index?.videos[0];
    video.setSlug(first?.slug ?? 'x');
    expect(new URLSearchParams(location.search).get('slug')).toBe(first?.slug);
    expect(video.sequenceName('nope')).toBe('nope');
  });

  it('treats error: null as a healthy video and a message as needs setup', () => {
    const index = makeIndex();
    const healthy = { ...(index.videos[0] ?? makeVideo()), error: null };
    desk.set({
      index: {
        ...index,
        folders: [],
        loose: [],
        videos: [healthy as never, { slug: 'broken', title: 'Broken', error: 'missing config' }],
      },
    });
    expect(video.sequenceName(healthy.slug)).toBe(healthy.title || healthy.slug);
    expect(video.sequenceName('broken')).toBe('broken (needs setup)');
  });

  it('names a branch the way its picker option reads, and falls back to the slug off the picker', () => {
    const root = makeVideo({ slug: 'root', title: 'Root' });
    const branch = makeVideo({ slug: 'feat', title: 'Feature', lineage: { role: 'branch' } });
    desk.set({
      index: {
        videos: [root, branch, makeVideo({ slug: 'stray', title: 'Stray' })],
        folders: [{ id: 'f', title: 'Folder', slugs: ['root', 'feat'], videos: [root, branch] }],
        loose: [],
      } as never,
    });
    expect(video.sequenceName('feat')).toBe('↳ Feature');
    expect(video.sequenceName('root')).toBe('Root');
    expect(video.sequenceName('stray')).toBe('stray');
  });

  it('openVideo refuses a slug that is not in the project list', async () => {
    mockedApi.mockResolvedValue(makeIndex());
    await expect(video.openVideo('missing-slug')).rejects.toThrow('Sequence "missing-slug" is not in the project list');
  });
});
