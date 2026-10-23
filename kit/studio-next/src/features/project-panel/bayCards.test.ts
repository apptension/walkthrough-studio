import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { server } from '@/test/msw/server';

import { askTake, bayBridge, chooseTake, hideGuide, resetBayCards, showGuide, useBayCards } from './bayCards';
import { rememberedTakeChoice } from '@/logic/takeChoice';

afterEach(() => {
  resetBayCards();
  localStorage.clear();
});

describe('bay cards', () => {
  it('shows and hides the guide card, bumping the generation on every show', () => {
    showGuide('demo');
    expect(useBayCards.getState()).toMatchObject({ guideSlug: 'demo', guideGen: 1 });
    showGuide('demo');
    expect(useBayCards.getState().guideGen).toBe(2);
    hideGuide();
    expect(useBayCards.getState().guideSlug).toBeNull();
  });

  it('asks for a take, remembers the choice and resolves', async () => {
    server.use(http.get('/api/video/:slug/guide', () => HttpResponse.json({ tour: { steps: 3, take: null } })));
    const pending = askTake('demo');
    await expect.poll(() => useBayCards.getState().take).toEqual({ slug: 'demo', tour: { steps: 3, take: null } });
    chooseTake('bot');
    await expect(pending).resolves.toBe('bot');
    expect(useBayCards.getState().take).toBeNull();
    expect(rememberedTakeChoice('demo')).toBe('bot');
  });

  it('rejects with a cancel error when the run aborts', async () => {
    server.use(http.get('/api/video/:slug/guide', () => HttpResponse.json({ error: 'nope' }, { status: 500 })));
    const ctl = new AbortController();
    const pending = askTake('demo', { signal: ctl.signal });
    await expect.poll(() => useBayCards.getState().take).toEqual({ slug: 'demo', tour: null });
    ctl.abort();
    await expect(pending).rejects.toThrow('cancelled');
    expect(useBayCards.getState().take).toBeNull();
  });

  it('exposes the BayBridge seam', () => {
    expect(bayBridge).toEqual({ showGuide, hideGuide, askTake });
  });
});
