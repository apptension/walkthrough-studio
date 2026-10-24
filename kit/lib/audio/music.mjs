/**
 * Music bed composed to the exact length of the delivery master (edit plan total),
 * including every interstitial plate — not open+live alone.
 *
 * Beds also land via upload: `installCustomMusic` writes `music/music.mp3` from an
 * MP3/WAV/etc the Editor attaches, the same way voice lines take a custom take.
 */
import { createHash, randomInt } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensurePlates, platePaths } from '../plates.mjs';
import { duration, run } from '../produce.mjs';
import { livePath } from '../record.mjs';
import { audioMode, composeMusic, ensureDir } from './elevenlabs.mjs';

// Eleven Music limits per request: chunks 3–120 s, ≤ 30 chunks, ≤ 10 min in total.
const MAX_CHUNK_MS = 110000;
const MIN_CHUNK_SEC = 3;
const MAX_REQUEST_SEC = 600;
const MAX_REQUEST_CHUNKS = 30;
const TAIL_SEC = 1.0;
/** The outro starts this long before the close plate; the mix keeps it there. */
export const OUTRO_LEAD_SEC = 1.5;
const HEADROOM_RATIO = 0.1;
const HEADROOM_MIN_SEC = 4;
const HEADROOM_MAX_SEC = 15;
const BUCKET_SEC = 5;
/** Equal-power crossfade between the sections of a bed composed in several requests. */
export const JOIN_XFADE_SEC = 4;
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

/**
 * Composed length for a picture: +10 % headroom (4–15 s), rounded up to a 5 s bucket, so a
 * slightly longer re-take is still covered by a mid-bed trim instead of a repeat.
 */
export function musicTargetSec(totalSec) {
  const t = Math.max(0, Number(totalSec) || 0);
  const headroom = Math.min(HEADROOM_MAX_SEC, Math.max(HEADROOM_MIN_SEC, t * HEADROOM_RATIO));
  return Math.ceil((t + headroom) / BUCKET_SEC) * BUCKET_SEC;
}

/** One 4/4 bar in seconds from a "118 BPM" style or prompt phrase; 0 when the tempo is not stated. */
export function musicBarSec(music = {}) {
  const text = [...(music.styles || []), ...(music.bed || []), music.prompt || ''].join(' ');
  const bpm = Number(/(\d{2,3})\s*bpm/i.exec(text)?.[1]);
  return bpm >= 40 && bpm <= 240 ? (4 * 60) / bpm : 0;
}

/** Where the outro chunk starts on the composed track (seconds). */
export function planOutroAtSec(plan) {
  const chunks = plan?.chunks || [];
  return chunks.slice(0, -1).reduce((s, c) => s + c.duration_ms, 0) / 1000;
}

/** Compose intro + bed + outro = musicTargetSec(totalSec); the headroom lives in the bed, where the mix trims it. */
export function compositionPlan(music, { totalSec, openSec, closeSec, interstitialSec = 0 }) {
  const total = musicTargetSec(totalSec);
  const cap = MAX_CHUNK_MS / 1000;
  // Intro covers open + interstitial plates (plate-level music); outro covers close.
  const intro = Math.min(cap, Math.max(MIN_CHUNK_SEC, openSec + interstitialSec + 1.5));
  const outro = Math.min(cap, Math.max(MIN_CHUNK_SEC, closeSec + OUTRO_LEAD_SEC + TAIL_SEC));
  const bed = Math.max(MIN_CHUNK_SEC, total - intro - outro);
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
  // A long bed cycles through `music.sections` cues so it evolves instead of repeating one loop.
  const sections = Array.isArray(music.sections) ? music.sections.filter((s) => Array.isArray(s) && s.length) : [];
  for (let i = 0; i < parts; i++) {
    const cue = parts > 1 && sections.length ? sections[i % sections.length] : [];
    chunks.push(chunk(`[Section ${i + 1}]`, bed / parts, [...(music.bed || []), ...cue]));
  }
  chunks.push(chunk('[Outro]', outro, music.outro));
  return { chunks };
}

/**
 * Split a plan into API-sized requests (≤ 10 min, ≤ 30 chunks). Every request after the first
 * opens `overlapSec` longer, so joining them with that crossfade keeps the planned total.
 */
export function planRequests(plan, { overlapSec = JOIN_XFADE_SEC } = {}) {
  const sec = (c) => c.duration_ms / 1000;
  const total = plan.chunks.reduce((s, c) => s + sec(c), 0);
  if (total <= MAX_REQUEST_SEC && plan.chunks.length <= MAX_REQUEST_CHUNKS) return [plan];
  const groups = [];
  let group = null;
  let acc = 0;
  for (const c of plan.chunks) {
    if (group && acc + sec(c) <= MAX_REQUEST_SEC && group.length < MAX_REQUEST_CHUNKS) {
      group.push(c);
      acc += sec(c);
      continue;
    }
    const opening = groups.length ? { ...c, duration_ms: Math.min(120000, c.duration_ms + Math.round(overlapSec * 1000)) } : c;
    group = [opening];
    groups.push(group);
    acc = sec(opening);
  }
  return groups.map((chunks) => ({ chunks }));
}

/** Join request sections with an equal-power crossfade into one bed. */
export function joinSections(files, outFile, { xfadeSec = JOIN_XFADE_SEC } = {}) {
  const filters = [];
  let prev = '[0:a]';
  for (let i = 1; i < files.length; i++) {
    const label = i === files.length - 1 ? '[out]' : `[j${i}]`;
    filters.push(`${prev}[${i}:a]acrossfade=d=${xfadeSec}:c1=qsin:c2=qsin${label}`);
    prev = label;
  }
  const map = files.length > 1 ? ['-filter_complex', filters.join(';'), '-map', '[out]'] : [];
  run(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', ...files.flatMap((f) => ['-i', f]), ...map, '-ar', '44100', '-ac', '2', '-b:a', '192k', outFile],
    null
  );
}

const MAX_EDIT_RATIO = 0.5;

/**
 * Whether a composed bed can serve a take of `totalSec`: it must reach past the picture (the
 * mix trims the excess mid-bed) and not be so long that the trim reshapes it. A shorter bed is
 * recomposed instead of repeated — offline it is kept, with a warning, and the mix extends it.
 */
export function musicReuse({ current, sameStyle, totalSec, offline = false }) {
  if (!current || !sameStyle) return { reuse: false, reason: 'style' };
  const have = Number(current.durationSec) || 0;
  const need = totalSec + TAIL_SEC;
  if (have < need) {
    if (!offline) return { reuse: false, reason: 'short' };
    return {
      reuse: true,
      reason: 'offline-short',
      warning: `⚠ music is ${(need - have).toFixed(1)}s short of this take and WALKTHROUGH_AUDIO_OFFLINE=1 — the mix will repeat part of the bed; compose online to fit`,
    };
  }
  if (have > musicTargetSec(totalSec) * (1 + MAX_EDIT_RATIO)) return { reuse: false, reason: 'long' };
  return { reuse: true, reason: 'fits' };
}

function styleKey(music, mode) {
  const { styles, negativeStyles, intro, bed, outro, model, prompt, sections } = music;
  return createHash('sha1')
    .update(JSON.stringify({ styles, negativeStyles, intro, bed, outro, model, prompt: normalizeMusicPrompt(prompt), mode, ...(sections ? { sections } : {}) }))
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
  const targetSec = musicTargetSec(segments.totalSec);
  const stamp = JSON.stringify({ plan, model: music.model, mode, targetSec });
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
  const offline = process.env.WALKTHROUGH_AUDIO_OFFLINE === '1';
  const reuse = !force && existsSync(out) ? musicReuse({ current, sameStyle, totalSec: segments.totalSec, offline }) : { reuse: false };
  if (reuse.reuse) {
    if (!current.style) {
      current.style = style;
      writeFileSync(planPath, JSON.stringify(current, null, 2));
    }
    const note = Math.abs(delta) > 0.05 ? ` · bed edited ${delta > 0 ? '+' : ''}${delta.toFixed(1)}s to fit this take` : '';
    console.log(`» music · Reused · ${current.durationSec.toFixed(0)}s`);
    console.log(`· music reused (${current.durationSec.toFixed(0)}s, composed ${current.generatedAt.slice(0, 10)})${note} — --force to recompose`);
    if (reuse.warning) console.log(reuse.warning);
    return current;
  }
  if (offline) throw new Error('WALKTHROUGH_AUDIO_OFFLINE=1 and the music needs composing');
  if (reuse.reason === 'short') console.log(`· music: cached bed (${current.durationSec.toFixed(0)}s) is shorter than this take (${segments.totalSec.toFixed(0)}s) — recomposing instead of looping`);
  if (reuse.reason === 'long') console.log(`· music: cached bed (${current.durationSec.toFixed(0)}s) is far longer than this take — recomposing`);
  const requests = planRequests(plan);
  const seed = requests.length > 1 ? randomInt(1, 2 ** 31 - 1) : null;
  console.log(`» music · Composing · ${totalSec.toFixed(0)}s`);
  console.log(
    `· music: ${music.model} · ${plan.chunks.length} sections${requests.length > 1 ? ` in ${requests.length} requests` : ''} · ${totalSec.toFixed(0)}s for a ${segments.totalSec.toFixed(0)}s picture · ${mode}${mode === 'stub' ? ' (synthesized pad — plumbing only)' : ''}${music.prompt ? ` · prompt “${music.prompt.slice(0, 60)}${music.prompt.length > 60 ? '…' : ''}”` : ''}`
  );
  if (requests.length === 1) {
    await composeMusic({ plan, model: music.model, outFile: out });
  } else {
    const parts = [];
    try {
      for (const [i, part] of requests.entries()) {
        const file = join(musicDir(video), `part-${i + 1}.mp3`);
        console.log(`· music part ${i + 1}/${requests.length} · ${(part.chunks.reduce((s, c) => s + c.duration_ms, 0) / 1000).toFixed(0)}s`);
        await composeMusic({ plan: part, model: music.model, outFile: file, seed });
        parts.push(file);
      }
      joinSections(parts, out);
    } finally {
      for (const f of parts) rmSync(f, { force: true });
    }
  }
  const source = mode === 'stub' ? 'stub' : 'eleven';
  const durationSec = duration(out);
  const warnings = [];
  if (durationSec < segments.totalSec + TAIL_SEC) {
    warnings.push(`⚠ composed music is ${durationSec.toFixed(1)}s, short of the ${segments.totalSec.toFixed(1)}s picture — the mix will have to extend it`);
  }
  const meta = {
    hash,
    style,
    mode,
    source,
    model: music.model,
    prompt: music.prompt || null,
    plan,
    segments,
    targetSec,
    outroAtSec: planOutroAtSec(plan),
    requests: requests.length,
    seed,
    durationSec,
    warnings,
    generatedAt: new Date().toISOString(),
  };
  for (const w of warnings) console.log(w);
  writeFileSync(planPath, JSON.stringify(meta, null, 2));
  console.log(`» music · Ready · ${meta.durationSec.toFixed(0)}s`);
  console.log(`✓ ${out} (${meta.durationSec.toFixed(1)}s)`);
  return meta;
}
