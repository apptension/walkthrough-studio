/** Spoken lines outlast short holds. Lengthen the close plate before encode, and never
 * let the audio mux cut the picture or the last word down to the shorter stream.
 */

import { asText } from './text';

const WORDS_PER_SEC = 2.4;

export interface HoldScene {
  holdSec?: unknown;
  narrationSec?: unknown;
}

export interface VoicePlanSegment {
  id?: string;
  dur?: number;
  padOut?: number;
  [key: string]: unknown;
}

export interface VoicePlan {
  segments?: VoicePlanSegment[];
  total?: number | null;
  dClose?: number;
  closeDur?: number;
  voiceExtended?: number;
  [key: string]: unknown;
}

export interface MixClip {
  start?: number;
  duration?: number;
}

export function narrationSeconds(text: unknown, wordsPerSec: number = WORDS_PER_SEC): number {
  const n = asText(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  if (!n || !(wordsPerSec > 0)) return 0;
  return n / wordsPerSec;
}

/** Pull a single-quoted, double-quoted, or template outro from narration.mjs. */
export function outroFromNarrationSource(source: unknown): string {
  const match = asText(source || '').match(/outro\s*:\s*(['"`])([\s\S]*?)\1/);
  return match ? (match[2] ?? '').replace(/\\n/g, ' ').trim() : '';
}

/** Same wording the script lint uses, so the editor and the encode path agree. */
export function shortHoldWarning(holdSec: unknown, narrationSec: unknown): string {
  const hold = Number(holdSec);
  const spoken = Number(narrationSec);
  if (!(hold > 0) || !(spoken > hold + 0.6)) return '';
  return `Voice needs ~${spoken.toFixed(1)}s but the card holds ${hold.toFixed(1)}s — lengthen the hold or shorten the line`;
}

export function firstShortHold(scenes: HoldScene[] | null | undefined): string {
  for (const scene of scenes || []) {
    const message = shortHoldWarning(scene.holdSec, scene.narrationSec);
    if (message) return message;
  }
  return '';
}

/**
 * Hold the close plate's last frame until the spoken line finishes.
 * No-op when the close is not the last shot, or the plate is already long enough.
 */
export function extendCloseForVoice<P extends VoicePlan | null | undefined>(plan: P, narrationSec: unknown): P {
  if (!plan?.segments?.length || !(Number(narrationSec) > 0)) return plan;
  const segments = plan.segments;
  const last = segments[segments.length - 1];
  const close = segments.find((segment) => segment.id === 'close') || last;
  if (!close || last !== close) return plan;
  // A short tail keeps the last word on the held frame when the read runs slightly past the estimate.
  const extra = Number(narrationSec) + 0.35 - Number(close.dur || 0);
  if (!(extra > 0.05)) return plan;
  const add = Math.round(extra * 1000) / 1000;
  close.dur = Math.round((Number(close.dur || 0) + add) * 1000) / 1000;
  close.padOut = Math.round((Number(close.padOut || 0) + add) * 1000) / 1000;
  if (plan.total != null) plan.total = Math.round((Number(plan.total) + add) * 1000) / 1000;
  plan.dClose = close.dur;
  plan.closeDur = close.dur;
  plan.voiceExtended = add;
  return plan;
}

/** How long the mix must run so a line that passes the picture estimate is not trimmed away. */
export function mixEndSec(totalSec: unknown, clips: (MixClip | null | undefined)[] | null | undefined): number {
  const total = Number(totalSec) || 0;
  const voiceEnd = (clips || []).reduce((max, clip) => {
    const end = Number(clip?.start || 0) + Number(clip?.duration || 0);
    return end > max ? end : max;
  }, 0);
  return Math.max(total, voiceEnd);
}

/** Audio mux flags. The picture is copied. `-shortest` is omitted so neither stream is clipped. */
export function deliveryMuxFlags({
  bitrate = '192k',
  sampleRate = 48000,
}: { bitrate?: string; sampleRate?: number } = {}): string[] {
  return ['-c:v', 'copy', '-c:a', 'aac', '-b:a', bitrate, '-ar', asText(sampleRate), '-movflags', '+faststart'];
}
