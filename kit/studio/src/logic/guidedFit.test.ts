import assert from 'node:assert/strict';

import { beforeEach, describe, test, vi } from 'vitest';

import { ask } from './ask';
import { confirmGuidedFits, type GuidedFitApi } from './guidedFit';

vi.mock('./ask', () => ({ ask: vi.fn() }));

const askMock = vi.mocked(ask as (opts: unknown) => Promise<string | boolean | null>);

const desktop = { id: 'desktop-fhd', label: 'Desktop · 1920×1080', width: 1920, height: 1080, dpr: 2, fits: false };
const laptop = { id: 'laptop-13', label: 'Laptop · 1366×768', width: 1366, height: 768, dpr: 2, fits: true };
const tooBig = { guidedFit: { scale: 0.72, fits: false }, current: desktop, options: [desktop, laptop], screen: { width: 1512 } };

function apiReturning(settings: unknown) {
  const calls: [string, unknown][] = [];
  const api: GuidedFitApi = (path, init) => {
    calls.push([path, init]);
    return Promise.resolve(settings);
  };
  return { api, calls };
}

describe('confirmGuidedFits', () => {
  beforeEach(() => {
    askMock.mockReset();
  });

  test('no slug, a failed check, or a size that fits never asks', async () => {
    assert.equal(await confirmGuidedFits(apiReturning(tooBig).api, ''), true);
    assert.equal(await confirmGuidedFits(() => Promise.reject(new Error('offline')), 'demo'), true);
    assert.equal(await confirmGuidedFits(apiReturning({ guidedFit: { scale: 1, fits: true } }).api, 'demo'), true);
    assert.equal(askMock.mock.calls.length, 0);
  });

  test('a size that would shrink asks, offering fitting sizes plus continue', async () => {
    askMock.mockResolvedValue('__keep__');
    const { api, calls } = apiReturning(tooBig);
    assert.equal(await confirmGuidedFits(api, 'demo'), true);
    const opts = askMock.mock.calls[0]![0] as { kind: string; title: string; options: { value: string; hint: string }[] };
    assert.equal(opts.kind, 'choice');
    assert.equal(opts.title, "This recording size won't fit your screen");
    assert.deepEqual(opts.options.map((o) => o.value), ['laptop-13', '__keep__']);
    assert.equal(opts.options[1]!.hint, 'The recording window will show at 72% to fit your screen.');
    assert.equal(calls.length, 1);
    assert.match(calls[0]![0], /^\/api\/video\/demo\/capture/);
  });

  test('picking a size saves it; cancelling stops the session', async () => {
    askMock.mockResolvedValueOnce('laptop-13');
    const picked = apiReturning(tooBig);
    assert.equal(await confirmGuidedFits(picked.api, 'demo'), true);
    assert.deepEqual(picked.calls[1], [
      '/api/video/demo/capture',
      { method: 'POST', body: { preset: 'laptop-13', screen: { width: 1512 } } },
    ]);

    askMock.mockResolvedValueOnce(null);
    assert.equal(await confirmGuidedFits(apiReturning(tooBig).api, 'demo'), false);
  });
});
