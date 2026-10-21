/**
 * Soft captions from fitted narration (voice/voice.json) → SRT + WebVTT + transcript.
 * Professional handoff expects human-proofed captions; these are the timed first pass.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const stripDirection = (text) =>
  String(text || '')
    .replace(/^\[[^\]]*\]\s*/, '')
    .replace(/\\"/g, '"')
    // Narration lines are often stored as "spoken line" — drop wrapper quotes for captions.
    .replace(/^"(.*)"$/s, '$1')
    .replace(/"/g, '')
    .trim();

function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

/** seconds → SRT timestamp 00:00:00,000 */
export function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

/** seconds → VTT timestamp 00:00:00.000 */
export function vttTime(sec) {
  return srtTime(sec).replace(',', '.');
}

export function loadVoiceClips(video) {
  const path = join(video.out, 'voice', 'voice.json');
  if (!existsSync(path)) return [];
  const voice = JSON.parse(readFileSync(path, 'utf8'));
  return (voice.clips || []).map((c) => ({
    key: c.key,
    start: c.start,
    end: c.start + c.duration,
    duration: c.duration,
    text: stripDirection(c.text),
    notes: c.notes || [],
  }));
}

export function buildSrt(clips) {
  return clips
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
    .join('\n');
}

export function buildVtt(clips, title = 'Walkthrough') {
  const body = clips
    .map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}\n`)
    .join('\n');
  return `WEBVTT - ${title}\n\n${body}`;
}

export function buildTranscript(clips) {
  return clips.map((c) => `[${srtTime(c.start).replace(',', '.')}]\t${c.key}\t${c.text}`).join('\n') + '\n';
}

/**
 * Write captions under <out>/captions/ and return paths + cue list for the studio player.
 */
export function writeCaptions(video) {
  const clips = loadVoiceClips(video);
  if (!clips.length) throw new Error(`No voice/voice.json for ${video.slug} — run audio first`);
  const dir = join(video.out, 'captions');
  mkdirSync(dir, { recursive: true });
  const srt = join(dir, `${video.slug}.srt`);
  const vtt = join(dir, `${video.slug}.vtt`);
  const txt = join(dir, `${video.slug}.transcript.txt`);
  writeFileSync(srt, buildSrt(clips));
  writeFileSync(vtt, buildVtt(clips, video.config.title || video.slug));
  writeFileSync(txt, buildTranscript(clips));
  const meta = {
    slug: video.slug,
    cueCount: clips.length,
    generatedAt: new Date().toISOString(),
    hash: createHash('sha1').update(buildSrt(clips)).digest('hex').slice(0, 12),
    files: { srt, vtt, transcript: txt },
  };
  writeFileSync(join(dir, 'captions-meta.json'), JSON.stringify(meta, null, 2));
  console.log(`✓ captions → ${dir} (${clips.length} cues · srt + vtt + transcript)`);
  return { ...meta, clips };
}
