/**
 * Music bed composed to the exact length of the delivery master (edit plan total),
 * including every interstitial plate — not open+live alone.
 *
 * Beds also land via upload: `installCustomMusic` writes `music/music.mp3` from an
 * MP3/WAV/etc the Editor attaches, the same way voice lines take a custom take.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensurePlates, platePaths } from '../plates.mjs';
import { duration, run } from '../produce.mjs';
import { livePath } from '../record.mjs';
import { audioMode, composeMusic, ensureDir } from './elevenlabs.mjs';

const MAX_CHUNK_MS = 110000;
const TAIL_SEC = 1.0;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export function musicDir(video) {
  return ensureDir(join(video.out, 'music'));
}

export function musicPath(video) {
  return join(musicDir(video), 'music.mp3');
}

export function musicPlanPath(video) {
  return join(musicDir(video), 'plan.json');
}

/**
 * Install an uploaded music bed. Converts any ffmpeg-readable audio to stereo mp3,
 * writes plan.json with source: 'upload', and leaves the desk (slip/fades/loop) alone.
 */
export async function installCustomMusic(video, { buffer, mime = 'audio/mpeg' } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Audio data required');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error('Audio file too large (max 50 MB)');
  const dir = musicDir(video);
  const out = musicPath(video);
  const ext =
    /webm/i.test(mime) ? 'webm' : /wav/i.test(mime) ? 'wav' : /ogg|opus/i.test(mime) ? 'ogg' : /m4a|mp4|aac/i.test(mime) ? 'm4a' : 'mp3';
  const tmpIn = join(dir, `upload-in.${ext}`);
  writeFileSync(tmpIn, buffer);
  try {
    run(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmpIn, '-vn', '-ar', '44100', '-ac', '2', '-b:a', '192k', out],
      null
    );
  } finally {
    rmSync(tmpIn, { force: true });
  }
  const durationSec = duration(out);
  const meta = {
    source: 'upload',
    mode: 'upload',
    model: null,
    plan: null,
    style: null,
    segments: null,
    durationSec: Number(durationSec.toFixed(3)),
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(musicPlanPath(video), JSON.stringify(meta, null, 2));
  console.log(`» music · Uploaded · ${meta.durationSec.toFixed(0)}s`);
  return meta;
}

/** Max length for a free-form Studio / CLI music prompt. */
export const MUSIC_PROMPT_MAX = 500;

/**
 * Turn a free-form prompt into ElevenLabs `positive_styles` phrases.
 * Splits on newlines / semicolons; otherwise keeps one phrase.
 */
export function promptStyles(prompt) {
  const raw = String(prompt || '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, MUSIC_PROMPT_MAX);
  if (!raw) return [];
  const parts = raw
    .split(/[\n;]+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((s) => s.slice(0, 160));
  return parts.length ? parts : [raw.replace(/\s+/g, ' ').slice(0, 160)];
}

export function normalizeMusicPrompt(prompt) {
  const raw = String(prompt ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MUSIC_PROMPT_MAX);
  return raw || '';
}

/** Compose so intro+bed+outro ≈ totalSec + TAIL (covers the full delivery master). */
export function compositionPlan(music, { totalSec, openSec, closeSec, interstitialSec = 0 }) {
  const total = totalSec + TAIL_SEC;
  // Intro covers open + interstitial plates (plate-level music); outro covers close.
  const intro = Math.max(3, openSec + interstitialSec + 1.5);
  const outro = Math.max(3, closeSec + 1.5);
  const bed = Math.max(3, total - intro - outro);
  const cue = promptStyles(music.prompt);
  const base = [...(music.styles || []), ...cue];
  const negative = music.negativeStyles || [];
  const chunk = (text, seconds, extra) => ({
    text,
    duration_ms: Math.round(seconds * 1000),
    positive_styles: [...base, ...(extra || [])],
    negative_styles: negative,
    context_adherence: 'high',
  });
  const chunks = [chunk('[Intro]', intro, music.intro)];
  const parts = Math.ceil((bed * 1000) / MAX_CHUNK_MS);
  for (let i = 0; i < parts; i++) chunks.push(chunk(`[Section ${i + 1}]`, bed / parts, music.bed));
  chunks.push(chunk('[Outro]', outro, music.outro));
  return { chunks };
}

const MAX_EDIT_RATIO = 0.5;

function styleKey(music, mode) {
  const { styles, negativeStyles, intro, bed, outro, model, prompt } = music;
  return createHash('sha1')
    .update(JSON.stringify({ styles, negativeStyles, intro, bed, outro, model, prompt: normalizeMusicPrompt(prompt), mode }))
    .digest('hex')
    .slice(0, 8);
}

function sameStyleAsLegacy(current, plan, music, mode) {
  const styles = (c) => JSON.stringify([c.positive_styles, c.negative_styles]);
  return (
    current.mode === mode &&
    current.model === music.model &&
    styles(current.plan.chunks[0]) === styles(plan.chunks[0]) &&
    styles(current.plan.chunks.at(-1)) === styles(plan.chunks.at(-1))
  );
}

export async function buildMusic(video, { force = false, prompt = null } = {}) {
  const baseMusic = video.audio.music;
  if (!baseMusic) {
    console.log('· no music settings for this brand — skipping music');
    return null;
  }
  const music = {
    ...baseMusic,
    prompt: prompt != null ? normalizeMusicPrompt(prompt) : normalizeMusicPrompt(baseMusic.prompt),
  };
  const mode = audioMode();
  if (mode === 'missing-key') {
    throw new Error('ELEVENLABS_API_KEY is not set (kit/.env). For a plumbing check without credits: WALKTHROUGH_AUDIO_STUB=1');
  }
  const LIVE = livePath(video);
  const plates = platePaths(video);
  if (!existsSync(LIVE)) throw new Error(`Record first: node cli.mjs record ${video.slug}`);
  await ensurePlates(video);
  if (!existsSync(plates.open.mp4) || !existsSync(plates.close.mp4)) throw new Error(`Render plates first: node cli.mjs plates ${video.slug}`);

  let segments = {
    openSec: duration(plates.open.mp4),
    liveSec: duration(LIVE),
    closeSec: duration(plates.close.mp4),
    interstitialSec: 0,
    totalSec: 0,
  };
  segments.totalSec = segments.openSec + segments.liveSec + segments.closeSec;
  try {
    const { buildEditPlan } = await import('../edit.mjs');
    const edit = buildEditPlan(video);
    const interstitialSec = edit.interstitials.reduce((s, i) => s + i.dur, 0);
    segments = {
      openSec: edit.dOpen,
      liveSec: edit.dLive,
      closeSec: edit.dClose,
      interstitialSec,
      totalSec: edit.total,
    };
  } catch {
    /* plates/timeline not ready — fall back to open+live+close */
  }

  const plan = compositionPlan(music, segments);
  const stamp = JSON.stringify({ plan, model: music.model, mode, totalSec: segments.totalSec });
  const hash = createHash('sha1').update(stamp).digest('hex').slice(0, 8);
  const style = styleKey(music, mode);
  const out = musicPath(video);
  const planPath = musicPlanPath(video);
  const current = existsSync(planPath) ? JSON.parse(readFileSync(planPath, 'utf8')) : null;
  const totalSec = plan.chunks.reduce((s, c) => s + c.duration_ms, 0) / 1000;
  // An uploaded bed stays until Compose to fit (force) replaces it.
  if (!force && existsSync(out) && current?.source === 'upload') {
    console.log(`» music · Reused upload · ${current.durationSec.toFixed(0)}s`);
    console.log(`· music reused upload (${current.durationSec.toFixed(0)}s) — --force to compose with ElevenLabs`);
    return current;
  }
  const sameStyle = current && (current.style ? current.style === style : sameStyleAsLegacy(current, plan, music, mode));
  // Fit edits against delivery total (includes interstitials), never open+live alone.
  const prevTotal = current?.segments?.totalSec ?? (current ? current.segments.openSec + current.segments.liveSec + current.segments.closeSec : 0);
  const delta = current ? segments.totalSec - prevTotal : 0;
  if (!force && existsSync(out) && sameStyle && Math.abs(delta) <= MAX_EDIT_RATIO * Math.max(prevTotal, 1)) {
    if (!current.style) {
      current.style = style;
      writeFileSync(planPath, JSON.stringify(current, null, 2));
    }
    const note = Math.abs(delta) > 0.05 ? ` · bed edited ${delta > 0 ? '+' : ''}${delta.toFixed(1)}s to fit this take` : '';
    console.log(`» music · Reused · ${current.durationSec.toFixed(0)}s`);
    console.log(`· music reused (${current.durationSec.toFixed(0)}s, composed ${current.generatedAt.slice(0, 10)})${note} — --force to recompose`);
    return current;
  }
  if (process.env.WALKTHROUGH_AUDIO_OFFLINE === '1') throw new Error('WALKTHROUGH_AUDIO_OFFLINE=1 and the music needs composing');
  console.log(`» music · Composing · ${totalSec.toFixed(0)}s`);
  console.log(
    `· music: ${music.model} · ${plan.chunks.length} sections · ${totalSec.toFixed(0)}s · ${mode}${mode === 'stub' ? ' (synthesized pad — plumbing only)' : ''}${music.prompt ? ` · prompt “${music.prompt.slice(0, 60)}${music.prompt.length > 60 ? '…' : ''}”` : ''}`
  );
  await composeMusic({ plan, model: music.model, outFile: out });
  const source = mode === 'stub' ? 'stub' : 'eleven';
  const meta = {
    hash,
    style,
    mode,
    source,
    model: music.model,
    prompt: music.prompt || null,
    plan,
    segments,
    durationSec: duration(out),
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(planPath, JSON.stringify(meta, null, 2));
  console.log(`» music · Ready · ${meta.durationSec.toFixed(0)}s`);
  console.log(`✓ ${out} (${meta.durationSec.toFixed(1)}s)`);
  return meta;
}
