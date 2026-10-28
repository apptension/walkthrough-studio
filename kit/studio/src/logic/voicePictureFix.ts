/** Client-side helpers for voice/picture overrun pipeline failures (mirrors kit/lib/audio/voicePictureFix.mjs). */

import { asText } from './text';

export const VOICE_PICTURE_OVERRUN_RE =
  /narration runs ([\d.]+)s past the picture — too long to freeze automatically/i;

export function isVoicePictureOverrunError(error: unknown): boolean {
  return VOICE_PICTURE_OVERRUN_RE.test(asText(error));
}

export function voicePictureOverrunSec(error: unknown): number | null {
  const m = VOICE_PICTURE_OVERRUN_RE.exec(asText(error));
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export interface VoicePictureGapOffender {
  key: string;
  start: number;
  end: number;
  plannedStart: number | null;
  reason: string;
  staleAt: boolean;
}

export interface VoicePictureGap {
  pictureSec: number;
  voiceEndSec: number;
  overrunSec: number;
  offenders: VoicePictureGapOffender[];
  canAutoRefit: boolean;
  staleAtKeys: string[];
}
