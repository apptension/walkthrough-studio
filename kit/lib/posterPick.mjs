/**
 * Where to grab poster.jpg on the delivery master: the opening plate once its reveal has
 * finished and every element is on screen (mid-hold), not mid-dissolve into live.
 */
import { platePlayback } from './editDeck.mjs';
import { FPS } from './motion.mjs';

const snap = (s) => Math.round(Number(s) * FPS) / FPS;

/** Seconds into the open *segment* (not delivery clock) for a fully composed frame. */
export function openPlatePosterOffset(openSeg) {
  if (!openSeg || openSeg.kind !== 'plate' || openSeg.id !== 'open') return null;
  const segDur = Number(openSeg.dur) || 0;
  const baseDur = Number(openSeg.naturalDur ?? openSeg.baseDur ?? openSeg.timing?.baseDur ?? segDur) || segDur;

  if (openSeg.timing) {
    const pb = platePlayback(
      openSeg.timing,
      openSeg.timing.baseDur ?? baseDur,
      openSeg.holdAt ?? openSeg.timing.holdAt,
    );
    const intoHold = pb.hold > 0.12 ? Math.min(0.4, pb.hold * 0.35) : 0.15;
    return pb.head + intoHold;
  }

  const hold = openSeg.holdAt;
  if (hold != null && Number.isFinite(hold)) {
    return Math.min(hold + 0.25, Math.max(hold + 0.1, segDur - 0.35));
  }
  if (openSeg.clearAt != null && Number.isFinite(openSeg.clearAt)) {
    return Math.max(0.8, openSeg.clearAt - 0.35);
  }
  return Math.min(Math.max(1.2, segDur * 0.55), Math.max(1.2, segDur - 0.4));
}

/** Delivery seconds for poster.jpg auto-pick. */
export function pickPosterTime(meta, totalSec = 0) {
  const total = Math.max(0, Number(totalSec) || 0);
  const segments = meta?.edit || meta?.segments || [];
  const open = segments.find((s) => s.kind === 'plate' && s.id === 'open');
  if (open) {
    const segStart = Number(open.at) || 0;
    const segDur = Number(open.dur) || 0;
    const offset = openPlatePosterOffset(open);
    const t = segStart + (offset ?? 1.5);
    const lo = segStart + 0.35;
    const hi = segStart + Math.max(0.5, segDur - 0.35);
    return snap(Math.max(lo, Math.min(t, hi, Math.max(0, total - 0.05))));
  }

  const chapters = meta?.chapters || [];
  const live = chapters.find((c) => c.start > 2 && !/intro|open|close|thank/i.test(c.title || ''));
  if (live) return snap(live.start + Math.min(4, Math.max(1.5, (total - live.start) * 0.05)));
  return snap(Math.min(total * 0.12, Math.max(3, total * 0.08)));
}
