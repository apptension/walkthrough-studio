/**
 * Voice lines placed past the delivery master (usually stale desk `at` after a shorter re-produce).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPlayable } from '../media.mjs';
import { finalPath } from '../produce.mjs';
import { resolveVoice, voiceShape } from './desk.mjs';
import { mixEndSec } from '../shared/voiceHold.js';

const r3 = (v) => Math.round(v * 1000) / 1000;

export const VOICE_PICTURE_OVERRUN_RE =
  /narration runs ([\d.]+)s past the picture — too long to freeze automatically/i;

export function isVoicePictureOverrunError(error) {
  return VOICE_PICTURE_OVERRUN_RE.test(String(error || ''));
}

export function voiceMetaPathFor(video) {
  return join(video.out, 'voice', 'voice.json');
}

/** Picture length + resolved voice end, with per-line offenders. */
export function analyzeVoicePictureGap(video, { pictureSec = null, voiceMeta = null, voiceEdits = null } = {}) {
  const FINAL = finalPath(video);
  const SILENT = FINAL.replace(/\.mp4$/, '.silent.mp4');
  const source = existsSync(SILENT) ? SILENT : FINAL;
  const picture = pictureSec ?? (existsSync(source) ? assertPlayable(source, { label: 'delivery master' }) : 0);
  const metaPath = voiceMetaPathFor(video);
  const meta =
    voiceMeta ||
    (existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : { clips: [] });
  const edits = voiceEdits ?? video.config?.edit?.audio?.voice ?? [];
  const clips = resolveVoice(meta.clips || [], edits).filter((c) => c.file && existsSync(c.file));
  const voiceEnd = mixEndSec(picture, clips);
  const overrunSec = r3(Math.max(0, voiceEnd - picture));
  const offenders = [];
  for (const clip of clips) {
    const end = r3(clip.start + clip.duration);
    if (end <= picture + 0.05) continue;
    const planned = (meta.clips || []).find((c) => c.key === clip.key);
    const edit = edits.find((e) => e.key === clip.key) || {};
    let reason = 'runs past the end of the picture';
    if (edit.at != null && planned && edit.at > planned.start + 0.5) {
      reason = `moved to ${edit.at.toFixed(1)}s on the timeline — the cut is only ${picture.toFixed(1)}s`;
    } else if ((clip.notes || []).some((n) => String(n).startsWith('long by'))) {
      reason = 'line is longer than its window — shorten the wording or lengthen the hold';
    }
    offenders.push({
      key: clip.key,
      start: clip.start,
      end,
      plannedStart: planned?.start ?? null,
      reason,
      staleAt: edit.at != null && end > picture + 0.05,
    });
  }
  offenders.sort((a, b) => b.end - a.end);
  const staleAtKeys = offenders.filter((o) => o.staleAt).map((o) => o.key);
  return {
    pictureSec: r3(picture),
    voiceEndSec: r3(voiceEnd),
    overrunSec,
    offenders,
    canAutoRefit: staleAtKeys.length > 0 && staleAtKeys.length === offenders.length,
    staleAtKeys,
  };
}

/**
 * Drop desk `at` (and nudge) when a manual timeline position pushes speech past the master.
 * Returns a new voice edit array; does not write config.
 */
export function autoRefitVoiceEdits(voiceEdits = [], voiceClips = [], pictureSec) {
  const byKey = new Map((voiceClips || []).map((c) => [c.key, c]));
  const cleared = [];
  const next = (voiceEdits || []).map((edit) => {
    const clip = byKey.get(edit.key);
    if (!clip || edit.mute) return edit;
    const start = edit.at != null ? edit.at : clip.start + (edit.nudge || 0);
    const shape = voiceShape(clip.full ?? clip.duration, edit);
    const end = start + shape.duration;
    if (edit.at == null || end <= pictureSec + 0.05) return edit;
    cleared.push(edit.key);
    const { at, nudge, ...rest } = edit;
    return rest;
  });
  return { voice: next, cleared, changed: cleared.length > 0 };
}

export function voicePictureManualFixNote(gap) {
  const lines = [
    'Narration runs past the end of the rendered video. Fix the lines below in the script or on the voice timeline, then re-run Add voice & music.',
  ];
  if (gap?.overrunSec > 0) lines.push('', `Overrun: ~${gap.overrunSec.toFixed(1)}s (picture ${gap.pictureSec.toFixed(1)}s, voice ends ~${gap.voiceEndSec.toFixed(1)}s).`);
  for (const o of gap?.offenders || []) {
    lines.push(`- "${o.key}": ${o.reason}`);
  }
  return lines.join('\n');
}
