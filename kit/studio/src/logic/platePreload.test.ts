import { describe, expect, it } from 'vitest';

import { nextStageSurface, type SurfaceClip } from './platePreload';

const live = (recFrom: number, recTo: number): SurfaceClip => ({ kind: 'live', plateId: null, recFrom, recTo });
const plate = (id: string): SurfaceClip => ({ kind: 'plate', plateId: id, recFrom: 0, recTo: 0 });
const marks = [
  { kind: 'caption', t: 4, dur: 2, key: 'a' },
  { kind: 'caption', t: 9, dur: 2, key: 'b' },
  { kind: 'caption', t: 21, dur: 2, key: 'c' },
];
const cardFor = (m: { key?: string }) => `overlay:${m.key}`;

describe('nextStageSurface', () => {
  it('preloads the next card inside the live clip first', () => {
    expect(nextStageSurface({ cur: live(0, 15), next: plate('p2'), recNow: 5, marks, cardFor })).toBe('overlay:b');
  });

  it('falls through to the next plate once the clip has no cards left', () => {
    expect(nextStageSurface({ cur: live(0, 15), next: plate('p2'), recNow: 10, marks, cardFor })).toBe('p2');
  });

  it('preloads the card that opens the next live clip', () => {
    expect(nextStageSurface({ cur: plate('p1'), next: live(21.5, 30), recNow: 0, marks, cardFor })).toBe('overlay:c');
    expect(nextStageSurface({ cur: plate('p1'), next: live(12, 20), recNow: 0, marks, cardFor })).toBeNull();
  });

  it('skips what the frame already holds and cards with no document', () => {
    expect(nextStageSurface({ cur: plate('p1'), next: plate('p1'), recNow: 0, marks, cardFor, holding: 'p1' })).toBeNull();
    const only = (m: { key?: string }) => (m.key === 'b' ? null : `overlay:${m.key}`);
    expect(nextStageSurface({ cur: live(0, 15), next: plate('p2'), recNow: 5, marks, cardFor: only })).toBe('p2');
  });

  it('ignores cards outside the clip window', () => {
    expect(nextStageSurface({ cur: live(0, 8), next: null, recNow: 5, marks, cardFor })).toBeNull();
  });
});
