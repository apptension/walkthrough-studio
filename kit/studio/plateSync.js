/**
 * Pure helpers for Studio plate preview sync. Look/style/Direction paints and text-mode
 * transitions collide easily — keep the rules here so they stay testable.
 */

/** Timeline clip for a plate id, falling back to the playhead clip when it is that plate. */
export function plateClipFor(seq, plateId, playheadClip) {
  if (plateId) {
    const hit = (seq || []).find((x) => x.kind === 'plate' && x.plateId === plateId);
    if (hit) return hit;
  }
  return playheadClip?.kind === 'plate' ? playheadClip : null;
}

/** True when the playhead is currently inside this plate clip. */
export function playheadOnPlate(playheadClip, plateId) {
  return Boolean(plateId && playheadClip?.kind === 'plate' && playheadClip.plateId === plateId);
}

/**
 * After a look/style paint, where should the plate clock land?
 * - Default: playhead offset into the clip — live edits keep your place in the plate
 * - fromStart (or playhead elsewhere): 0 — only when an explicit reset-from-start is requested
 */
export function previewClockMs(clip, playheadT, { fromStart = false, onPlate = true } = {}) {
  if (!clip) return 0;
  if (fromStart || !onPlate) return 0;
  return Math.max(0, Math.round((Number(playheadT) - clip.at) * 1000));
}

/** Move the editor playhead only when an explicit from-start reset is requested on that plate. */
export function shouldParkPlayheadAtClipStart(fromStart, onPlate) {
  return Boolean(fromStart && onPlate);
}

/**
 * Can we force-reload the iframe for this plate right now?
 * Dirty copy must not be wiped; otherwise reload when the iframe holds it or the playhead is on it.
 */
export function canReloadPlateFrame({ dirty, activePlateId, plateId, playheadPlateId }) {
  if (dirty) return false;
  if (!plateId) return false;
  return activePlateId === plateId || playheadPlateId === plateId;
}

function clipIndexAt(seq, t) {
  for (let i = (seq || []).length - 1; i >= 0; i--) if (seq[i].at <= t + 1e-4) return i;
  return 0;
}

/**
 * Snapshot where the playhead sits before a cut rebuild (omit / undo / reorder),
 * so we can land on the same section instead of a clamped absolute time.
 */
export function capturePlayheadAnchor(seq, t) {
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
export function restorePlayheadAnchor(seq, total, anchor, fallbackT = 0) {
  const hi = Math.max(0, Number(total) || 0);
  const clampT = (v) => Math.min(hi, Math.max(0, Number(v) || 0));
  if (!seq?.length) return 0;
  if (!anchor) return clampT(fallbackT);

  const place = (c, offset) => {
    if (!c) return null;
    const dur = Math.max(0, Number(c.dur) || 0);
    return clampT(c.at + Math.min(Math.max(0, offset), dur));
  };

  const byId = seq.find((c) => c.id === anchor.id);
  if (byId) return place(byId, anchor.offset);

  if (anchor.plateId) {
    const byPlate = seq.find((c) => c.kind === 'plate' && c.plateId === anchor.plateId);
    if (byPlate) return place(byPlate, anchor.frac * byPlate.dur);
  }

  if (anchor.kind === 'live') {
    const live = seq.find((c) => c.kind === 'live');
    if (live) return place(live, Math.min(anchor.offset, live.dur));
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
export function soloJoinFocus(prev, cur, progress) {
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
export function stagePointerOwner({ textMode = false, playing = false, aimBoxUp = false } = {}) {
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
export function joinFrameOwner(prev, cur, progress, { curNeedsCard = false, lockCard = false } = {}) {
  if (!curNeedsCard || prev?.kind !== 'plate' || cur?.kind !== 'live') return null;
  if (lockCard) return 'card';
  const p = Number(progress);
  return (Number.isFinite(p) ? p : 0) < 0.5 ? 'plate' : 'card';
}

/** True when two live slices are not contiguous on the recording clock (omit left a hole). */
export function liveRecDiscontinuous(prev, cur, epsilon = 0.35) {
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
export function shouldBlacklistPlateLoad(result, { activePlateId, requestedId } = {}) {
  if (result === true) return false;
  if (result === 'cancelled') return false;
  if (result === false && requestedId && activePlateId && activePlateId !== requestedId) return false;
  return result !== true;
}
