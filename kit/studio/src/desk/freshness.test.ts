import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { request } from '@/api/client';
import { makeFreshness, makeVideo } from '@/test/factories';
import { server } from '@/test/msw/server';

import { decideAction } from './action';
import { FRESHNESS_DEBOUNCE_MS, refreshFreshness, watchFreshness } from './freshness';
import { desk } from './store';

const staleState = () => ({
  freshness: makeFreshness({ stale: true, reason: 'config newer than delivery' }),
  hasDelivery: true,
  recordFailure: null,
});

let hits = 0;
beforeEach(() => {
  hits = 0;
  desk.reset();
  const v = makeVideo({ slug: 'demo' });
  desk.set({ slug: 'demo', video: v, action: decideAction(v) });
  server.use(
    http.get('/api/video/demo/freshness', () => {
      hits += 1;
      return HttpResponse.json(staleState());
    }),
    http.post('/api/video/:slug/edit', () => HttpResponse.json({ ok: true })),
  );
});
afterEach(() => {
  vi.useRealTimers();
});

describe('refreshFreshness', () => {
  it('patches freshness and re-decides the action', async () => {
    expect(desk.get().action?.status).toBe('Up to date');
    await refreshFreshness();
    expect(desk.get().video?.freshness.stale).toBe(true);
    expect(desk.get().action?.status).toBe('Out of date');
  });

  it('drops an answer for a sequence the desk already left', async () => {
    const pending = refreshFreshness();
    desk.set({ slug: 'other', video: makeVideo({ slug: 'other' }) });
    await pending;
    expect(desk.get().video?.freshness.stale).toBe(false);
  });
});

describe('watchFreshness', () => {
  it('re-reads once, debounced, after writes to the open video only', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const stop = watchFreshness();
    await request('/api/video/demo/edit', { method: 'POST', body: {} });
    await request('/api/video/demo/edit', { method: 'POST', body: {} });
    await request('/api/video/elsewhere/edit', { method: 'POST', body: {} });
    await vi.advanceTimersByTimeAsync(FRESHNESS_DEBOUNCE_MS + 10);
    await vi.waitFor(() => expect(desk.get().action?.status).toBe('Out of date'));
    expect(hits).toBe(1);
    stop();
  });

  it('re-reads when the tab comes back (sources edited outside Studio)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const stop = watchFreshness();
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(10);
    await vi.waitFor(() => expect(hits).toBe(1));
    stop();
  });
});
