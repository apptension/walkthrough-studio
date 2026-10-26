/**
 * Background continuity on the Editor stage — the twin of `kit/lib/plateCarry.mjs`.
 *
 * Two slides that paint the same background join as one: the server marks the join
 * `continue`, the stage keeps one backdrop running on the run's clock under the slides, and only
 * the copy changes. These helpers find a clip's place in its run so the stage and the render
 * agree on where the backdrop is at every playhead.
 */

export const CARRY_STYLE = 'continue';

export interface CarryClip {
  id?: string;
  kind: string;
  at: number;
  dur: number;
  holdAt?: number | undefined;
  naturalDur?: number | undefined;
  padOut?: number | undefined;
  join?: { type?: string | undefined } | null;
}

export interface CarryEdges {
  /** The backdrop carries in from the slide before / on into the slide after. */
  in: boolean;
  out: boolean;
  /** Where the run's backdrop clock starts on the cut, and the run's first clip (its identity). */
  runAt: number;
  runKey: string;
}

/** A join whose background carries through: two slides the server marked continuous. */
export function isCarryJoin(prev: CarryClip | null | undefined, cur: CarryClip | null | undefined): boolean {
  return Boolean(prev && cur && prev.kind === 'plate' && cur.kind === 'plate' && cur.join?.type === CARRY_STYLE);
}

/** The clip's edges in its continuous run, or null when it carries nothing. */
export function carryEdges(seq: readonly CarryClip[], i: number): CarryEdges | null {
  const c = seq[i];
  if (!c || c.kind !== 'plate') return null;
  const into = isCarryJoin(seq[i - 1], c);
  const onward = isCarryJoin(c, seq[i + 1]);
  if (!into && !onward) return null;
  let s = i;
  while (s > 0 && isCarryJoin(seq[s - 1], seq[s])) s -= 1;
  const first = seq[s] as CarryClip;
  return { in: into, out: onward, runAt: first.at, runKey: `${first.id ?? s}@${first.at.toFixed(3)}` };
}

/** The run's backdrop clock at playhead `t`, in ms. */
export function carryBgMs(edges: Pick<CarryEdges, 'runAt'>, t: number): number {
  return Math.max(0, Math.round((Number(t) - edges.runAt) * 1000));
}

/** Source second the slide's exits start (`--black-out`): a beat after its settled frame. */
export function carryBlackOut(clip: CarryClip): number {
  if (Number.isFinite(clip.holdAt)) return (clip.holdAt as number) + 0.1;
  const natural = clip.naturalDur ?? Math.max(0, clip.dur - (clip.padOut || 0));
  return Math.max(0, natural - 0.7);
}
