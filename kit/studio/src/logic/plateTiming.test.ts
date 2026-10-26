import { describe, expect, it } from 'vitest';

import { MIN_PLATE_KEEP, PLATE_HOLD_MAX, PLATE_RATE_RANGE, PLATE_RATE_STEPS, plateClockMs, platePlayback, plateTimeRow, timingForDuration, timingForStretch, withPlateTime } from './plateTiming';

describe('platePlayback', () => {
  it('maps the cut clock through trims, hold and rate like the render', () => {
    const pb = platePlayback({ trimStart: 1, hold: 2, rate: 2 }, 6, 5);
    expect(pb.dur).toBe(4.5);
    expect(pb.toSource(1)).toBe(3);
    expect(pb.toSource(3)).toBe(5);
    expect(pb.toSource(4.25)).toBe(5.5);
    expect(pb.toOutput(5.5)).toBe(4.25);
  });

  it('is identity without timing', () => {
    const pb = platePlayback(null, 6, 5);
    expect(pb.identity).toBe(true);
    expect(pb.dur).toBe(6);
    expect(pb.toSource(2.5)).toBe(2.5);
  });

  it('never keeps less than the minimum plate', () => {
    const pb = platePlayback({ trimStart: 10, trimEnd: 10 }, 6);
    expect(pb.to - pb.from).toBeGreaterThanOrEqual(MIN_PLATE_KEEP - 1e-9);
  });
});

describe('plateClockMs', () => {
  it('seeks the held frame while the hold plays', () => {
    const clip = { at: 10, dur: 8, naturalDur: 6, holdAt: 5, timing: { trimStart: 0, trimEnd: 0, hold: 2, rate: 1 } };
    expect(plateClockMs(clip, 12)).toBe(2000);
    expect(plateClockMs(clip, 16)).toBe(5000);
    expect(plateClockMs(clip, 17.5)).toBe(5500);
  });

  it('is the raw offset for an untimed plate', () => {
    expect(plateClockMs({ at: 2, dur: 6 }, 3.25)).toBe(1250);
  });
});

describe('plate time rows', () => {
  it('drops defaults and natural rows', () => {
    expect(plateTimeRow('open', { hold: 0, rate: 1 })).toBeNull();
    expect(plateTimeRow('open', { hold: 1.5, rate: 1.25 })).toEqual({ id: 'open', hold: 1.5, rate: 1.25 });
    expect(withPlateTime([{ id: 'open', hold: 2 }, { id: 'close', hold: 1 }], 'open', null)).toEqual([{ id: 'close', hold: 1 }]);
  });

  it('extends with a hold and shortens by eating the outro first', () => {
    expect(timingForDuration({}, 6, 5, 9)).toEqual({ hold: 3 });
    const short = timingForDuration({}, 6, 5, 5.5);
    expect(short.trimEnd).toBe(0.5);
    expect(platePlayback(short, 6, 5).dur).toBe(5.5);
    const shorter = timingForDuration({}, 6, 5, 4);
    expect(platePlayback(shorter, 6, 5).dur).toBe(4);
  });
});

describe('timingForStretch', () => {
  const len = (t: ReturnType<typeof timingForStretch>) => platePlayback(t, 6, 5).dur;

  it('retimes the whole animation to the length instead of holding', () => {
    expect(timingForStretch({}, 6, 5, 3)).toMatchObject({ rate: 2, hold: 0 });
    expect(timingForStretch({}, 6, 5, 12)).toMatchObject({ rate: 0.5, hold: 0 });
    expect(len(timingForStretch({}, 6, 5, 4))).toBeCloseTo(4, 2);
  });

  it('lands exactly on the length even when the speed rounds', () => {
    const t = timingForStretch({}, 6, 5, 7);
    expect(t.rate).toBe(0.86);
    expect(len(t)).toBeCloseTo(7, 2);
  });

  it('keeps a hold you set and retimes the motion around it', () => {
    const t = timingForStretch({ hold: 2 }, 6, 5, 5);
    expect(t).toMatchObject({ rate: 2, hold: 2 });
    expect(len(t)).toBeCloseTo(5, 2);
  });

  it('gives up hold before it passes the fastest speed', () => {
    const t = timingForStretch({ hold: 2 }, 6, 5, 2.5);
    expect(t.rate).toBe(PLATE_RATE_RANGE[1]);
    expect(len(t)).toBeCloseTo(2.5, 2);
  });

  it('holds the rest once the slowest speed is reached', () => {
    const t = timingForStretch({}, 6, 5, 15);
    expect(t.rate).toBe(PLATE_RATE_RANGE[0]);
    expect(t.hold).toBe(3);
    expect(timingForStretch({}, 6, 5, 60).hold).toBe(PLATE_HOLD_MAX);
  });

  it('respects trims', () => {
    const t = timingForStretch({ trimStart: 1, trimEnd: 1 }, 6, 5, 2);
    expect(t).toMatchObject({ trimStart: 1, trimEnd: 1, rate: 2 });
  });

  it('offers presets inside the range', () => {
    expect(PLATE_RATE_STEPS).toContain(1);
    expect(PLATE_RATE_STEPS.every((r) => r >= PLATE_RATE_RANGE[0] && r <= PLATE_RATE_RANGE[1])).toBe(true);
  });
});
