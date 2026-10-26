import { describe, expect, it } from 'vitest';

import { cutToProgram, programToCut, type CutSpan, type ProgramSpan } from './programClock';

const spans: ProgramSpan[] = [
  { id: 'open', start: 0, end: 6 },
  { id: 'live-a', start: 6, end: 46 },
  { id: 'close', start: 46, end: 52 },
];

describe('programClock', () => {
  it('is the identity when the render matches the cut', () => {
    const cut: CutSpan[] = [{ id: 'open', at: 0, dur: 52 }];
    expect(programToCut(20, spans, cut, { programDur: 52, total: 52, fresh: true })).toBe(20);
    expect(cutToProgram(20, spans, cut, { programDur: 52, total: 52, fresh: true })).toBe(20);
  });

  it('maps through the section with the same id when edits moved things', () => {
    // The live section was trimmed to 20s and moved ahead of the opening.
    const cut: CutSpan[] = [
      { id: 'live-a', at: 0, dur: 20 },
      { id: 'open', at: 20, dur: 6 },
      { id: 'close', at: 26, dur: 6 },
    ];
    const f = { programDur: 52, total: 32, fresh: false };
    expect(programToCut(26, spans, cut, f)).toBeCloseTo(10);
    expect(programToCut(3, spans, cut, f)).toBeCloseTo(23);
    expect(cutToProgram(10, spans, cut, f)).toBeCloseTo(26);
    expect(cutToProgram(23, spans, cut, f)).toBeCloseTo(3);
  });

  it('plays a duplicate back through its source section', () => {
    const cut: CutSpan[] = [
      { id: 'open', at: 0, dur: 6 },
      { id: 'open~2', repeatOf: 'open', at: 6, dur: 6 },
    ];
    expect(cutToProgram(9, spans, cut, { programDur: 52, total: 12, fresh: false })).toBeCloseTo(3);
  });

  it('falls back to the whole length when a section has no counterpart', () => {
    const cut: CutSpan[] = [{ id: 'new', at: 0, dur: 26 }];
    const f = { programDur: 52, total: 26, fresh: false };
    expect(programToCut(26, spans, cut, f)).toBeCloseTo(13);
    expect(cutToProgram(13, spans, cut, f)).toBeCloseTo(26);
  });

  it('stays inside both clocks', () => {
    const cut: CutSpan[] = [{ id: 'open', at: 0, dur: 6 }];
    const f = { programDur: 52, total: 6, fresh: false };
    expect(programToCut(-4, spans, cut, f)).toBe(0);
    expect(programToCut(500, spans, cut, f)).toBeLessThanOrEqual(6);
    expect(cutToProgram(500, spans, cut, f)).toBeLessThanOrEqual(52);
    expect(programToCut(4, spans, cut, { programDur: 52, total: 0, fresh: false })).toBe(0);
  });
});
