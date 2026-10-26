import { describe, expect, it } from 'vitest';

import { clockShort, elapsedSec, fmt, fmtShort, formatBytes } from './format';

describe('format helpers', () => {
  it('fmt is a zero-padded clock and treats junk as zero', () => {
    expect(fmt(Number.NaN)).toBe('00:00:00');
    expect(fmt(Number.POSITIVE_INFINITY)).toBe('00:00:00');
    expect(fmt(-5)).toBe('00:00:00');
    expect(fmt(0.4)).toBe('00:00:00');
    expect(fmt(61)).toBe('00:01:01');
    expect(fmt(3661)).toBe('01:01:01');
    expect(fmt(86399)).toBe('23:59:59');
  });

  it('fmtShort and clockShort', () => {
    expect(fmtShort(Number.NaN)).toBe('0:00');
    expect(fmtShort(61)).toBe('1:01');
    expect(fmtShort(3661)).toBe('61:01');
    expect(clockShort(null)).toBe('—');
    expect(clockShort(undefined)).toBe('—');
    expect(clockShort(61)).toBe('1:01');
  });

  it('formatBytes', () => {
    expect(formatBytes(undefined)).toBe('0 B');
    expect(formatBytes('x')).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(5000)).toBe('4.9 KB');
    expect(formatBytes(10 * 1024)).toBe('10 KB');
    expect(formatBytes(1024 ** 2)).toBe('1.0 MB');
    expect(formatBytes(5.5 * 1024 ** 2)).toBe('5.5 MB');
    expect(formatBytes(1024 ** 3)).toBe('1.00 GB');
    expect(formatBytes(3.3 * 1024 ** 3)).toBe('3.30 GB');
  });

  it('elapsedSec uses the job timestamps', () => {
    expect(elapsedSec(null)).toBe(0);
    expect(elapsedSec({})).toBe(0);
    expect(
      elapsedSec({ createdAt: '2026-10-01T10:00:00Z', finishedAt: '2026-10-01T10:01:05Z' }),
    ).toBe(65);
    expect(
      elapsedSec({
        startedAt: '2026-10-01T10:00:30Z',
        createdAt: '2026-10-01T10:00:00Z',
        finishedAt: '2026-10-01T10:01:05Z',
      }),
    ).toBe(35);
  });
});
