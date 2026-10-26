import { cardMarkInClip, liveMarksAtRecTime, type CardMark } from './liveCardStage';

export interface SurfaceClip {
  kind: 'live' | 'plate';
  plateId: string | null;
  recFrom: number;
  recTo: number;
}

export interface NextSurfaceInput<M extends CardMark> {
  /** Clip under the playhead. */
  cur: SurfaceClip | null | undefined;
  /** The clip after it in the cut. */
  next: SurfaceClip | null | undefined;
  /** Recording clock at the playhead (live clips only). */
  recNow: number;
  marks: M[] | null | undefined;
  /** Card document a mark composites, or null when it has none on stage (carried, unbuilt). */
  cardFor: (mark: M) => string | null;
  /** Document the stage frame already shows — preloading it again is wasted work. */
  holding?: string | null;
}

/**
 * The next document the stage frame will need, in play order: the next caption or chapter card
 * inside the live clip, else whatever opens the next clip (its plate, or the card already up at
 * its first recorded frame). Preloading it off-stage turns the cut into a swap instead of a load.
 */
export function nextStageSurface<M extends CardMark>({ cur, next, recNow, marks, cardFor, holding = null }: NextSurfaceInput<M>): string | null {
  const usable = (id: string | null | undefined): string | null => (id && id !== holding ? id : null);
  if (cur?.kind === 'live') {
    const ahead = (marks || []).filter((m) => cardMarkInClip(m, cur) && Number(m.t) > recNow + 0.05).sort((a, b) => a.t - b.t);
    for (const m of ahead) {
      const id = usable(cardFor(m));
      if (id) return id;
    }
  }
  if (!next) return null;
  if (next.kind === 'plate') return usable(next.plateId);
  const opening = liveMarksAtRecTime(marks, next.recFrom, next)[0];
  return opening ? usable(cardFor(opening)) : null;
}
