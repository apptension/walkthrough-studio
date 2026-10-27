/**
 * Pure helpers for Studio plate preview sync. Look/style/Direction paints and text-mode
 * transitions collide easily — keep the rules here so they stay testable.
 */

export interface TimelineClip {
  id?: string;
  kind?: string;
  plateId?: string | null;
  at: number;
  dur?: number;
  recFrom?: number;
  recTo?: number;
}

/** A clip as seen across a join — position on the timeline is not needed. */
export type JoinClip = Partial<TimelineClip>;

export interface PlayheadAnchor {
  id: string | undefined;
  kind: string | undefined;
  plateId: string | null;
  offset: number;
  frac: number;
  at: number;
}

export type StagePointerOwner = 'card' | 'take';

/** Timeline clip for a plate id, falling back to the playhead clip when it is that plate. */
export function plateClipFor<C extends TimelineClip>(
  seq: C[] | null | undefined,
  plateId: string | null | undefined,
  playheadClip: C | null | undefined,
): C | null {
  if (plateId) {
    const hit = (seq || []).find((x) => x.kind === 'plate' && x.plateId === plateId);
    if (hit) return hit;
  }
  return playheadClip?.kind === 'plate' ? playheadClip : null;
}

/** True when the playhead is currently inside this plate clip. */
export function playheadOnPlate(playheadClip: JoinClip | null | undefined, plateId: string | null | undefined): boolean {
  return Boolean(plateId && playheadClip?.kind === 'plate' && playheadClip.plateId === plateId);
}

/**
 * Can the stage paint this plate without kicking a reload?
 *
 * A held iframe is always paint-ready. Content-pane live typing writes config and paints
 * in place, then marks the plate `stale` (disk HTML lags) without setting stage `dirty`.
 * Treating stale+!dirty as "not ready" used to force-reload every frame and wipe the typed
 * copy. Bake / force-reload belongs on the next *visit* after the frame no longer holds.
 */
export function plateStageReady({ holds }: { holds: boolean }): boolean {
  return holds;
}

/**
 * When returning to a plate whose disk HTML lags config, rebuild before loading the iframe.
 * Force loads alone only refetch the last baked file and would show pre-type copy.
 */
export function shouldBakeBeforePlateLoad({ stale }: { stale: boolean }): boolean {
  return stale;
}

/**
 * After a look/style paint, where should the plate clock land?
 * - Default: playhead offset into the clip — live edits keep your place in the plate
 * - fromStart (or playhead elsewhere): 0 — only when an explicit reset-from-start is requested
 */
export function previewClockMs(
  clip: Pick<TimelineClip, 'at'> | null | undefined,
  playheadT: unknown,
  { fromStart = false, onPlate = true }: { fromStart?: boolean; onPlate?: boolean } = {},
): number {
  if (!clip) return 0;
  if (fromStart || !onPlate) return 0;
  return Math.max(0, Math.round((Number(playheadT) - clip.at) * 1000));
}

/** Move the editor playhead only when an explicit from-start reset is requested on that plate. */
export function shouldParkPlayheadAtClipStart(fromStart: unknown, onPlate: unknown): boolean {
  return Boolean(fromStart && onPlate);
}

/**
 * Can we force-reload the iframe for this plate right now?
 * Dirty copy must not be wiped; otherwise reload when the iframe holds it or the playhead is on it.
 */
export function canReloadPlateFrame({
  dirty,
  activePlateId,
  plateId,
  playheadPlateId,
}: {
  dirty?: boolean;
  activePlateId?: string | null;
  plateId?: string | null;
  playheadPlateId?: string | null;
}): boolean {
  if (dirty) return false;
  if (!plateId) return false;
  return activePlateId === plateId || playheadPlateId === plateId;
}

/**
 * A look or background rebuild of the plate already on stage. The new HTML arms off-screen
 * and swaps in, so the corner loader (a wait with nothing to show) would only flash.
 */
export function stageReloadIsQuiet(
  activePlateId: string | null | undefined,
  readyId: string | null | undefined,
  loadingId: string | null | undefined,
): boolean {
  return Boolean(loadingId && activePlateId === loadingId && readyId === loadingId);
}

function clipIndexAt(seq: TimelineClip[] | null | undefined, t: number): number {
  const list = seq || [];
  for (let i = list.length - 1; i >= 0; i--) if ((list[i] as TimelineClip).at <= t + 1e-4) return i;
  return 0;
}

/**
 * Snapshot where the playhead sits before a cut rebuild (omit / undo / reorder),
 * so we can land on the same section instead of a clamped absolute time.
 */
export function capturePlayheadAnchor(seq: TimelineClip[] | null | undefined, t: number): PlayheadAnchor | null {
  if (!seq?.length) return null;
  const i = clipIndexAt(seq, t);
  const c = seq[i];
  if (!c) return null;
  const dur = Math.max(0.001, Number(c.dur) || 0);
  const offset = Math.max(0, Number(t) - c.at);
  return {
    id: c.id,
    kind: c.kind,
    plateId: c.plateId || null,
    offset,
    frac: Math.min(1, offset / dur),
    at: c.at,
  };
}

/**
 * Restore a playhead after the sequence changes.
 * Prefer the same clip id, then the same plate, then a live clip, else clamp.
 */
export function restorePlayheadAnchor(
  seq: TimelineClip[] | null | undefined,
  total: unknown,
  anchor: PlayheadAnchor | null | undefined,
  fallbackT: unknown = 0,
): number {
  const hi = Math.max(0, Number(total) || 0);
  const clampT = (v: unknown): number => Math.min(hi, Math.max(0, Number(v) || 0));
  if (!seq?.length) return 0;
  if (!anchor) return clampT(fallbackT);

  const place = (c: TimelineClip, offset: number): number => {
    const dur = Math.max(0, Number(c.dur) || 0);
    return clampT(c.at + Math.min(Math.max(0, offset), dur));
  };

  const byId = seq.find((c) => c.id === anchor.id);
  if (byId) return place(byId, anchor.offset);

  if (anchor.plateId) {
    const byPlate = seq.find((c) => c.kind === 'plate' && c.plateId === anchor.plateId);
    if (byPlate) return place(byPlate, anchor.frac * (byPlate.dur as number));
  }

  if (anchor.kind === 'live') {
    const live = seq.find((c) => c.kind === 'live');
    if (live) return place(live, Math.min(anchor.offset, live.dur as number));
  }

  // Omitted (or reordered away): land near the same absolute time on the new cut.
  return clampT(fallbackT);
}

/**
 * One surface can only show one clip. During plate→plate or live→live joins, pick which
 * clip owns the preview (outgoing for the first half, incoming after).
 * Returns null when dual layers can run (plate↔live).
 *
 * Critical after omit/reorder: seeking a single live.mp4 from the end of slice 1 to the
 * start of slice 3 would flash the omitted middle; holding one focused clip avoids that.
 */
export function soloJoinFocus<C extends JoinClip>(prev: C | null | undefined, cur: C | null | undefined, progress: unknown): C | null {
  if (!prev || !cur) return null;
  if (prev.kind !== cur.kind) return null;
  if (prev.kind !== 'plate' && prev.kind !== 'live') return null;
  const p = Number(progress);
  return (Number.isFinite(p) ? p : 0) < 0.5 ? prev : cur;
}

/**
 * Which stage layer should receive the pointer while a card is composited over the recording.
 * 'card' — the card iframe (editing its copy, or idle click-to-edit on the copy)
 * 'take' — the recording layer with the zoom / magnifier aim boxes
 * Pure so the precedence is pinned by tests: text mode > aim box > playback > idle card.
 */
export function stagePointerOwner({
  textMode = false,
  playing = false,
  aimBoxUp = false,
}: { textMode?: boolean; playing?: boolean; aimBoxUp?: boolean } = {}): StagePointerOwner {
  if (textMode) return 'card';
  if (aimBoxUp) return 'take';
  if (playing) return 'take';
  return 'card';
}

/**
 * Plate→live join where the incoming live slice opens on a chapter/caption card: the outgoing
 * plate and the card both need the single plate iframe. Returns which one owns it — the plate
 * for the first half of the join, the card after — or null when there is no conflict.
 * `lockCard` (text mode editing that card) always keeps the card: unloading it would drop edits.
 * Must be a pure function of its inputs so a parked playhead never ping-pongs loads.
 */
export function joinFrameOwner(
  prev: JoinClip | null | undefined,
  cur: JoinClip | null | undefined,
  progress: unknown,
  { curNeedsCard = false, lockCard = false }: { curNeedsCard?: boolean; lockCard?: boolean } = {},
): 'plate' | 'card' | null {
  if (!curNeedsCard || prev?.kind !== 'plate' || cur?.kind !== 'live') return null;
  if (lockCard) return 'card';
  const p = Number(progress);
  return (Number.isFinite(p) ? p : 0) < 0.5 ? 'plate' : 'card';
}

/** True when two live slices are not contiguous on the recording clock (omit left a hole). */
export function liveRecDiscontinuous(prev: JoinClip | null | undefined, cur: JoinClip | null | undefined, epsilon = 0.35): boolean {
  if (!prev || !cur || prev.kind !== 'live' || cur.kind !== 'live') return false;
  const a0 = Number(prev.recFrom);
  const a1 = Number(prev.recTo);
  const b0 = Number(cur.recFrom);
  const b1 = Number(cur.recTo);
  if (![a0, a1, b0, b1].every(Number.isFinite)) return false;
  const abut = Math.abs(a1 - b0) <= epsilon || Math.abs(b1 - a0) <= epsilon;
  return !abut;
}

/**
 * After omit/reorder, a newer plate load often cancels the previous iframe request.
 * Only hard failures should blacklist a plate — cancelled / superseded must not.
 * `result`: true | false | 'cancelled' (from loadPlateFrame).
 */
export function shouldBlacklistPlateLoad(
  result: unknown,
  { activePlateId, requestedId }: { activePlateId?: string | null; requestedId?: string | null } = {},
): boolean {
  if (result === true) return false;
  if (result === 'cancelled') return false;
  if (result === false && requestedId && activePlateId && activePlateId !== requestedId) return false;
  return result !== true;
}
