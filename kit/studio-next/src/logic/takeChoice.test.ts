import { afterEach, describe, expect, it } from 'vitest';

import { preferredTakeChoice, rememberTakeChoice, rememberedTakeChoice, takeFacts } from './takeChoice';

afterEach(() => localStorage.clear());

describe('takeChoice', () => {
  it('remembers only own or bot, per sequence', () => {
    rememberTakeChoice('demo', 'again');
    expect(rememberedTakeChoice('demo')).toBeNull();
    rememberTakeChoice('demo', 'bot');
    expect(rememberedTakeChoice('demo')).toBe('bot');
    expect(rememberedTakeChoice('other')).toBeNull();
  });

  it('summarises a take like the legacy card', () => {
    expect(takeFacts(null)).toBe('');
    expect(
      takeFacts({ steps: 3, take: { url: '/t.mp4', seconds: 75, chapters: [{ t: 0, title: 'A' }], cuts: 2, cutSec: 4.4 } }),
    ).toBe('1:15 · 1 chapter · 3 steps · 2 pauses cut (4s)');
  });

  it('prefers own unless the bot is remembered, and bot when there is no take', () => {
    const take = { url: '/t.mp4', seconds: 10 };
    expect(preferredTakeChoice({ steps: 2 }, 'demo')).toBe('bot');
    expect(preferredTakeChoice({ take }, 'demo')).toBe('own');
    expect(preferredTakeChoice({ take, steps: 2 }, 'demo')).toBe('own');
    rememberTakeChoice('demo', 'bot');
    expect(preferredTakeChoice({ take, steps: 2 }, 'demo')).toBe('bot');
  });
});
