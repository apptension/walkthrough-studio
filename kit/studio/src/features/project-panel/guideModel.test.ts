import { describe, expect, it } from 'vitest';

import { ACTIONS, guideJourney, guideLive, guideStates, guideStatusLine } from './guideModel';

describe('guide card model', () => {
  it('summarises the session counts', () => {
    expect(guideStatusLine(null)).toBe('');
    expect(guideStatusLine({ steps: 1 })).toBe('1 step');
    expect(guideStatusLine({ steps: 4, marks: 2, cuts: 1 })).toBe('4 steps · 2 chapters · 1 pause cut');
  });

  it('walks the journey with the session state', () => {
    const ready = guideJourney({ state: 'ready' });
    expect(ready.map((s) => s.state)).toEqual(['now', 'next', 'next', 'next', 'next']);
    const signin = guideJourney({ state: 'ready', needsSignIn: true });
    expect(signin[0]).toMatchObject({ id: 'signin', state: 'now' });
    const capturing = guideJourney({ state: 'capturing' });
    expect(capturing.find((s) => s.state === 'now')?.id).toBe('show');
    expect(guideJourney({ state: 'done' }).find((s) => s.state === 'now')?.id).toBe('choose');
    expect(guideJourney({ state: 'countdown' }).find((s) => s.state === 'now')?.id).toBe('start');
  });

  it('reads finishing while a finish is pending, and sign-in while ready', () => {
    expect(guideStates({ state: 'capturing' }, 'finish')).toEqual({ raw: 'finishing', state: 'finishing' });
    expect(guideStates({ state: 'done' }, 'finish')).toEqual({ raw: 'done', state: 'done' });
    expect(guideStates({ state: 'ready', needsSignIn: true }, '')).toEqual({ raw: 'ready', state: 'signin' });
    expect(guideStates(null, '')).toEqual({ raw: 'connecting', state: 'connecting' });
  });

  it('extrapolates the REC clock and countdown', () => {
    const at = Date.parse('2026-10-20T09:00:00.000Z');
    const status = { state: 'capturing', recSec: 10, countdownMs: 3000, updatedAt: '2026-10-20T09:00:00.000Z' };
    expect(guideLive(status, at + 2000)).toEqual({ rec: 12, count: 1 });
    expect(guideLive({ ...status, state: 'countdown', recSec: 0 }, at + 1000)).toEqual({ rec: 0, count: 2 });
    expect(guideLive(null)).toEqual({ rec: 0, count: 0 });
  });

  it('offers the legacy buttons per state', () => {
    expect(ACTIONS['capturing']?.map(([a]) => a)).toEqual(['mark', 'pause', 'finish']);
    expect(ACTIONS['done']).toBeUndefined();
  });
});
