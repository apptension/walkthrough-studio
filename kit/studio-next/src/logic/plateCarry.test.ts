import { describe, expect, it } from 'vitest';

import { CARRY_STYLE, carryBgMs, carryBlackOut, carryEdges, isCarryJoin } from './plateCarry';

const carry = { type: CARRY_STYLE };
const seq = [
  { id: 'open', kind: 'plate', at: 0, dur: 6, join: null },
  { id: 'a', kind: 'plate', at: 5.4, dur: 6, join: carry },
  { id: 'b', kind: 'plate', at: 10.8, dur: 5, join: carry },
  { id: 'live-1', kind: 'live', at: 15.2, dur: 20, join: { type: 'dissolve' } },
  { id: 'c', kind: 'plate', at: 34.6, dur: 6, join: { type: 'wipe' } },
];

describe('isCarryJoin', () => {
  it('needs two slides joined continuously', () => {
    expect(isCarryJoin(seq[0], seq[1])).toBe(true);
    expect(isCarryJoin(seq[2], seq[3])).toBe(false);
    expect(isCarryJoin(seq[3], { ...seq[4]!, join: carry })).toBe(false);
    expect(isCarryJoin(null, seq[1])).toBe(false);
  });
});

describe('carryEdges', () => {
  it('places every slide of a run on the clock of its first slide', () => {
    expect(carryEdges(seq, 0)).toEqual({ in: false, out: true, runAt: 0, runKey: 'open@0.000' });
    expect(carryEdges(seq, 1)).toEqual({ in: true, out: true, runAt: 0, runKey: 'open@0.000' });
    expect(carryEdges(seq, 2)).toEqual({ in: true, out: false, runAt: 0, runKey: 'open@0.000' });
  });

  it('leaves live slices and lone slides alone', () => {
    expect(carryEdges(seq, 3)).toBeNull();
    expect(carryEdges(seq, 4)).toBeNull();
    expect(carryEdges(seq, 9)).toBeNull();
  });
});

describe('carryBgMs', () => {
  it('runs straight through the run, whatever each slide does to its own clock', () => {
    expect(carryBgMs({ runAt: 5.4 }, 12)).toBe(6600);
    expect(carryBgMs({ runAt: 5.4 }, 5)).toBe(0);
  });
});

describe('carryBlackOut', () => {
  it('sits a beat after the settled frame, or before the natural end', () => {
    expect(carryBlackOut({ kind: 'plate', at: 0, dur: 6, holdAt: 5.2 })).toBeCloseTo(5.3);
    expect(carryBlackOut({ kind: 'plate', at: 0, dur: 6.6, padOut: 0.6 })).toBeCloseTo(5.3);
  });
});
