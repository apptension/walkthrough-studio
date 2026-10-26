import { describe, expect, it } from 'vitest';

import { fmtScrub, keySeek } from './model';

describe('fmtScrub', () => {
  it('reads m:ss.t', () => {
    expect(fmtScrub(0)).toBe('0:00.0');
    expect(fmtScrub(75.46)).toBe('1:15.4');
    expect(fmtScrub(Number.NaN)).toBe('0:00.0');
  });
});

describe('keySeek', () => {
  const chapters = [{ title: 'Intro', start: 0 }, { title: 'Tour', start: 10 }];
  it('steps, jumps chapters and clamps to the cut', () => {
    expect(keySeek('ArrowRight', 12, 20, chapters)).toBe(13);
    expect(keySeek('ArrowLeft', 12, 20, chapters, { big: true })).toBe(7);
    expect(keySeek('ArrowLeft', 0.5, 20, chapters)).toBe(0);
    expect(keySeek('PageUp', 12, 20, chapters)).toBe(10);
    expect(keySeek('PageUp', 10, 20, chapters)).toBe(0);
    expect(keySeek('PageDown', 2, 20, chapters)).toBe(10);
    expect(keySeek('PageDown', 12, 20, chapters)).toBe(20);
    expect(keySeek('Home', 12, 20, chapters)).toBe(0);
    expect(keySeek('End', 12, 20, chapters)).toBe(20);
    expect(keySeek('a', 12, 20, chapters)).toBeNull();
  });
});
