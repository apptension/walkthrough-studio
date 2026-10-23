import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { enqueueJob } from '@/desk/jobs';
import { setMonitorMode } from '@/desk/monitor';
import { runtime } from '@/desk/runtime';
import { desk } from '@/desk/store';
import { toast } from '@/desk/toast';
import { loadVideo } from '@/desk/video';
import { makeFreshness, makeVideo } from '@/test/factories';
import { server } from '@/test/msw/server';

import { posterView, setPosterFromCurrentFrame } from './poster';
import { enqueueFromMenu } from './queueActions';
import { saveRecordTarget } from './recordTarget';

vi.mock('@/desk/toast', () => ({ toast: vi.fn() }));
vi.mock('@/desk/video', () => ({ loadVideo: vi.fn(() => Promise.resolve()) }));
vi.mock('@/desk/jobs', () => ({ enqueueJob: vi.fn() }));
vi.mock('@/desk/monitor', () => ({ setMonitorMode: vi.fn(), activePlayer: () => runtime.player }));

beforeEach(() => {
  vi.clearAllMocks();
  desk.reset();
  desk.set({ slug: 'demo', video: makeVideo() });
});

describe('enqueueFromMenu', () => {
  it('maps menu picks onto queue items', () => {
    enqueueFromMenu('make-quick');
    enqueueFromMenu('make-full');
    enqueueFromMenu('plates');
    enqueueFromMenu('audio');
    enqueueFromMenu('weird');
    expect(vi.mocked(enqueueJob).mock.calls.map((c) => c[0])).toEqual([
      { kind: 'make', mode: 'quick', label: 'Render sequence' },
      { kind: 'make', mode: 'full', label: 'Re-record & render full' },
      { kind: 'step', step: 'plates', force: true, label: 'Render brand plates' },
      { kind: 'step', step: 'audio', force: false, label: 'Add voice & music' },
      { kind: 'step', step: 'weird', force: false, label: 'weird' },
    ]);
  });
});

describe('saveRecordTarget', () => {
  it('hides the status when nothing changed', async () => {
    await expect(saveRecordTarget({ startUrl: 'https://example.test/app', loginRequired: false })).resolves.toBeNull();
  });

  it('rejects a non-http URL', async () => {
    await expect(saveRecordTarget({ startUrl: 'example.test', loginRequired: false })).resolves.toBe('Use a full http(s) URL.');
  });

  it('saves, reloads and says whether the next render re-records', async () => {
    let body: unknown;
    server.use(
      http.put('/api/video/:slug/record-target', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    vi.mocked(loadVideo).mockImplementationOnce(() => {
      desk.set({ video: makeVideo({ freshness: makeFreshness({ needsRecord: true }) }) });
      return Promise.resolve();
    });
    await expect(saveRecordTarget({ startUrl: ' https://new.test ', loginRequired: true })).resolves.toBe('Saved. The next render re-records.');
    expect(body).toEqual({ startUrl: 'https://new.test', loginRequired: true });
    expect(loadVideo).toHaveBeenCalledWith('demo');
    desk.set({ video: makeVideo() });
    await expect(saveRecordTarget({ startUrl: 'https://other.test', loginRequired: false })).resolves.toBe('Saved.');
  });

  it('shows the server error and skips without a sequence', async () => {
    server.use(http.put('/api/video/:slug/record-target', () => HttpResponse.json({ error: 'Bad URL' }, { status: 400 })));
    await expect(saveRecordTarget({ startUrl: 'https://x.test', loginRequired: false })).resolves.toBe('Bad URL');
    desk.set({ slug: null });
    await expect(saveRecordTarget({ startUrl: 'https://x.test', loginRequired: false })).resolves.toBeUndefined();
  });
});

describe('poster', () => {
  it('needs a delivery and Program', async () => {
    desk.set({ video: makeVideo({ hasDelivery: false }) });
    await setPosterFromCurrentFrame();
    expect(toast).toHaveBeenCalledWith('No delivery yet', 'Render the sequence first', 'warn');
    desk.set({ video: makeVideo(), monitorMode: 'plate' });
    await setPosterFromCurrentFrame();
    expect(toast).toHaveBeenCalledWith('Switch to Program', 'Scrub to the frame you want, then Set poster', 'warn');
    expect(setMonitorMode).toHaveBeenCalledWith('program');
  });

  it('grabs the current frame and merges the new poster', async () => {
    const player = document.createElement('video');
    Object.defineProperty(player, 'currentTime', { value: 12.4, configurable: true });
    runtime.player = player;
    let body: unknown;
    let busyDuring = false;
    server.use(
      http.post('/api/video/:slug/poster', async ({ request }) => {
        body = await request.json();
        busyDuring = Boolean(desk.get().busy['btnSetPoster']);
        return HttpResponse.json({ posterUrl: '/media/demo/poster.jpg', meta: { atSec: 12.4, source: 'manual', setAt: '' } });
      }),
    );
    await setPosterFromCurrentFrame();
    runtime.player = null;
    expect(body).toEqual({ atSec: 12.4 });
    expect(busyDuring).toBe(true);
    expect(desk.get().busy['btnSetPoster']).toBe(false);
    expect(desk.get().video?.posterMeta?.source).toBe('manual');
    expect(toast).toHaveBeenCalledWith('Poster set', 'Frame at 0:12');
    expect(desk.get().status).toEqual({ kind: 'ok', text: 'Poster @ 0:12' });
  });

  it('builds the poster view', () => {
    expect(posterView(null, 1)).toEqual({ src: null, metaLine: null });
    const v = makeVideo({ posterMeta: { atSec: 75, source: 'manual', setAt: '' } });
    expect(posterView(v, 5)).toEqual({ src: '/media/demo/poster.jpg?t=5', metaLine: 'Frame 1:15 · set in Studio' });
    expect(posterView(makeVideo(), 5).metaLine).toBe('Frame 0:03 · auto on Export');
  });
});
