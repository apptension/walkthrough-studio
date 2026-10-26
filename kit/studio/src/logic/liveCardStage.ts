/**
 * Pure helpers for compositing chapter/caption live cards over a recording in Studio.
 * Kept free of DOM so unit tests can pin mark→card resolve and playhead timing.
 * lib/liveCardBake.mjs imports `cardMarkDuration` from here so bake and preview share one rule.
 */
import { defaultCardHoldMs } from './cardMotion';

export interface CardMark {
  kind?: string;
  t: number;
  dur?: number | null;
  label?: string;
  key?: string;
  /** A duplicated card shows the card with this key. */
  copyOf?: string;
}

export interface RecWindow {
  recFrom?: number;
  recTo?: number;
}

export interface LiveClip {
  kind?: string;
  at: number;
  recFrom: number;
  recTo: number;
  overlap?: number;
}

export interface LiveCardPlate {
  id: string;
  label?: string;
  kind?: string;
  type?: string;
  liveCard?: boolean;
  flowIndex?: number;
  markKey?: string | null;
}

/** Seconds a chapter/caption mark stays on screen (recorded `dur`, else the record default). */
export function cardMarkDuration(mark: Partial<CardMark> | null | undefined): number {
  const d = Number(mark?.dur);
  if (Number.isFinite(d) && d > 0) return d;
  return defaultCardHoldMs(mark?.kind === 'chapter' ? 'chapter' : 'caption') / 1000;
}

/** Stable id for edit.cards (must match kit/lib/editDeck.cardMarkKey). */
export function cardMarkKey(mark: Partial<CardMark> | null | undefined): string {
  if (!mark) return '';
  return `${mark.kind || 'card'}:${Number(mark.t).toFixed(3)}:${String(mark.label || '')}`;
}

/**
 * Does the card window [t, t+dur) share screen time with the live slice [recFrom, recTo)?
 * A slice that opens on a chapter deliberately starts after the mark (edit.mjs CARD_COVER), so
 * the card is mid-animation at the cut — it still belongs to that slice, exactly as produce bakes it.
 */
export function cardMarkInClip(
  mark: CardMark | null | undefined,
  { recFrom = -Infinity, recTo = Infinity }: RecWindow = {},
): boolean {
  if (!mark || (mark.kind !== 'chapter' && mark.kind !== 'caption')) return false;
  const t = Number(mark.t);
  if (!Number.isFinite(t)) return false;
  return t < recTo && t + cardMarkDuration(mark) > recFrom + 0.05;
}

/**
 * Editor time to open copy-edit on a chapter/caption.
 * A beat into the card, clamped to the slice. A plate→live join hands the shared iframe to the
 * outgoing plate for its first half — landing there flashes that plate, then the card loads
 * back. Step past the handoff so the card keeps the frame.
 * @param toEd recording clock → editor clock for `clip`
 */
export function cardEditLandingEd(
  mark: CardMark | null | undefined,
  clip: Partial<LiveClip> | null | undefined,
  {
    prevKind = null,
    overlap = 0,
    toEd,
  }: { prevKind?: string | null; overlap?: number; toEd?: ((rec: number) => number) | null } = {},
): number | null {
  if (!mark || clip?.kind !== 'live' || typeof toEd !== 'function') return null;
  const t = Number(mark.t);
  if (!Number.isFinite(t) || !Number.isFinite(clip.at)) return null;
  const { at = NaN, recFrom = NaN, recTo = NaN } = clip;
  const dur = cardMarkDuration(mark);
  const recHi = Math.min(t + dur - 0.05, recTo - 0.02);
  let rec = Math.max(t + 0.12, recFrom + 0.02);
  if (rec > recHi) rec = Math.max(recFrom + 0.02, recHi);
  let edT = toEd(rec);
  if (prevKind === 'plate' && overlap > 0) {
    const handoff = at + overlap * 0.5 + 0.02;
    if (edT < handoff) edT = handoff;
  }
  const cardEndEd = toEd(recHi);
  if (Number.isFinite(cardEndEd) && edT > cardEndEd) edT = Math.max(at + 0.02, cardEndEd);
  return edT;
}

/** Chapter/caption marks covering recording time `recT` inside clip [recFrom, recTo), newest first. */
export function liveMarksAtRecTime<M extends CardMark>(marks: M[] | null | undefined, recT: number, clip: RecWindow = {}): M[] {
  const hits = (marks || []).filter((m) => {
    if (!cardMarkInClip(m, clip)) return false;
    return recT >= m.t - 0.05 && recT < m.t + cardMarkDuration(m);
  });
  hits.sort((a, b) => b.t - a.t);
  return hits;
}

/**
 * Map a timeline mark onto a Program live-card plate row.
 * Server-built rows carry `markKey` (the pairing decided once in lib/cardMarks.mjs); that wins.
 * Label / order heuristics remain for rows without a key.
 * @param allMarks full deck marks (for index fallback)
 */
export function resolveLiveCardFromPlates<P extends LiveCardPlate>(
  mark: CardMark | null | undefined,
  plates: P[] | null | undefined,
  allMarks: CardMark[] | null = [],
): P | null {
  if (!mark || (mark.kind !== 'chapter' && mark.kind !== 'caption')) return null;
  const kind = mark.kind === 'chapter' ? 'chapter' : 'caption';
  const list = (plates || []).filter((p) => p.liveCard && (p.kind === kind || p.type === kind));
  if (!list.length) return null;
  const key = mark.copyOf || mark.key || cardMarkKey(mark);
  const byKey = list.find((p) => p.markKey && p.markKey === key);
  if (byKey) return byKey;
  // A keyed row that belongs to another mark must not be stolen by a label collision below.
  const keyed = list.some((p) => p.markKey);
  if (keyed && list.every((p) => p.markKey)) return null;
  const label = String(mark.label || '');
  const byLabel =
    list.find((p) => p.label === label) ||
    list.find((p) => String(p.label || '').endsWith(` · ${label}`)) ||
    list.find((p) => label && String(p.label || '').includes(label));
  if (byLabel) return byLabel;
  const ordered = (allMarks || []).filter((m) => m.kind === mark.kind);
  const idx = ordered.findIndex((m) => m.t === mark.t && m.label === mark.label);
  const sorted = [...list].sort((a, b) => (a.flowIndex ?? 0) - (b.flowIndex ?? 0));
  return idx >= 0 ? sorted[idx] || null : null;
}

/** Milliseconds into the card animation for motion seek (clamped). */
export function cardElapsedMs(mark: CardMark | null | undefined, recT: number): number {
  if (!mark) return 0;
  const dur = cardMarkDuration(mark);
  const elapsed = Math.max(0, recT - mark.t);
  return Math.round(Math.min(elapsed, dur) * 1000);
}
