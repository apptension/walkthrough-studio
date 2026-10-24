/**
 * Narration: videos/<slug>/narration.mjs lines keyed by the caption/chapter titles the flow already
 * shows, fitted into the on-screen windows of the recorded take (video leads, voice follows).
 *
 *   export default {
 *     intro: 'Spoken over the brand open.',
 *     outro: 'Spoken over the brand close.',
 *     lines: {
 *       'Create the lease': 'One click, and the lease lands in your pipeline.',
 *       'Sign': { text: 'A single tap sends it.', speed: 1.05 },
 *     },
 *   };
 *
 * Output: <out>/voice/voice.json with one placement per line (absolute seconds in the delivery
 * master) plus warnings for lines that overrun their window.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildEditPlan } from '../edit.mjs';
import { ensurePlates, platePaths } from '../plates.mjs';
import { duration, run } from '../produce.mjs';
import { livePath } from '../record.mjs';
import { resolveVideoLanguage } from '../languages.mjs';
import { audioMode, ensureDir, synthesize } from './elevenlabs.mjs';
import { normalizeTo } from './mix.mjs';
import { normalizeAudio, voiceLineSpec, voiceShape } from './desk.mjs';
// Window and spacing rules live with the Editor's projection so both lay lines out the same way.
import { INTRO_WINDOW, OUTRO_WINDOW, PLATE_TAIL, VOICE_GAP as GAP, VOICE_LEAD as LEAD, slotRoom, slotStart } from '../../studio/voicePlace.js';
// TTS clips carry ~0.3 s of silence at each end; keep 40 ms of attack and 120 ms of tail so words aren't clipped
const TRIM =
  'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.04,' +
  'areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.12,areverse';

export function voiceDir(video) {
  return ensureDir(join(video.out, 'voice'));
}

export function voiceMetaPath(video) {
  return join(voiceDir(video), 'voice.json');
}

export async function loadNarration(video) {
  const file = join(video.dir, 'narration.mjs');
  if (!existsSync(file)) return null;
  const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
  const narration = mod.default || mod;
  return {
    intro: narration.intro,
    outro: narration.outro,
    lines: narration.lines || {},
    plates: narration.plates || {},
  };
}

const asLine = (value) => (typeof value === 'string' ? { text: value } : { ...value });

function prepareText(line, voice) {
  let text = line.text.trim();
  for (const [word, ipa] of Object.entries(voice.pronunciations || {})) {
    text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), `"${ipa}"`);
  }
  const direction = line.direction ?? voice.direction;
  if (direction && !text.startsWith('[')) text = `${direction} ${text}`;
  return text;
}

/**
 * Synthesized clips live in a cache shared by every take and every video (<out root>/.cache/voice),
 * keyed by what ElevenLabs is asked for: text, voice, model, settings, language. A new take, a re-fit or a
 * deleted video folder never pays for the same line twice. Fitting is a local time-stretch.
 */
export function voiceCacheDir(video) {
  return ensureDir(join(dirname(video.out), '.cache', 'voice'));
}

export function clipKey(video, line) {
  const voice = video.audio.voice;
  const settings = { ...voice.settings, speed: Number((line.speed ?? voice.settings?.speed ?? 1).toFixed(2)) };
  const text = prepareText(line, voice);
  const language = resolveVideoLanguage(video.config?.language).code;
  // `take` > 1 asks ElevenLabs for the same line again; every take keeps its own cache entry so
  // the Editor can step back to an earlier one without paying for it twice.
  const stamp = JSON.stringify({ text, voiceId: voice.voiceId, model: voice.model, settings, language, mode: audioMode(), post: TRIM, ...(line.take > 1 ? { take: line.take } : {}) });
  return { text, settings, language, hash: createHash('sha1').update(stamp).digest('hex').slice(0, 8) };
}

/** The desk's per-line edits (`edit.audio.voice`), keyed by line. */
function voiceEditsOf(video) {
  return new Map(normalizeAudio(video.config?.edit?.audio || {}).voice.map((e) => [e.key, e]));
}

/** Where one take of a written line lives in the cache, and whether it is there already. */
export function takeClipFiles(video, written, edit, take = 1) {
  const { hash } = clipKey(video, voiceLineSpec(written, { ...edit, take }));
  const dir = voiceCacheDir(video);
  const mp3 = join(dir, `${hash}.mp3`);
  return { hash, mp3, wav: join(dir, `${hash}.norm.wav`), cached: existsSync(mp3) };
}

/** On-disk folder for uploaded / mic takes of one line (survives cache remints). */
export function customTakeDir(video, key) {
  const safe = String(key || 'line')
    .replace(/[^a-zA-Z0-9._+-]+/g, '_')
    .slice(0, 80);
  return ensureDir(join(voiceDir(video), 'custom', safe));
}

export function customTakePaths(video, key, take = 1) {
  const dir = customTakeDir(video, key);
  const n = Math.max(1, Math.round(Number(take) || 1));
  return { mp3: join(dir, `take-${n}.mp3`), wav: join(dir, `take-${n}.norm.wav`), take: n };
}

export function hasCustomTake(video, key, take = 1) {
  return existsSync(customTakePaths(video, key, take).mp3);
}

/** The takes of a line that already have a clip: switching to one of them costs nothing. */
export function cachedTakes(video, written, edit, takes, key = null) {
  const out = [];
  for (let take = 1; take <= takes; take++) {
    const custom = key && hasCustomTake(video, key, take);
    if (custom || (written && takeClipFiles(video, written, edit, take).cached)) out.push(take);
  }
  return out;
}

/** `takeClipFiles` for a placed line, by key (reads the mix, the narration and the desk). */
export async function lineTakeFiles(video, key, take = 1) {
  const metaPath = voiceMetaPath(video);
  const clip = existsSync(metaPath) ? (JSON.parse(readFileSync(metaPath, 'utf8')).clips || []).find((c) => c.key === key) : null;
  if (!clip) throw new Error(`No voice line "${key}" in this mix`);
  const written = narrationLineFor(await loadNarration(video), clip);
  if (!written) throw new Error(`"${key}" is no longer in narration.mjs`);
  return takeClipFiles(video, written, voiceEditsOf(video).get(key) || {}, take);
}

/** The narration entry a placed clip was spoken from, by its key and kind. */
export function narrationLineFor(narration, { key, kind }) {
  if (!narration) return null;
  if (kind === 'intro') return narration.intro != null ? asLine(narration.intro) : null;
  if (kind === 'outro') return narration.outro != null ? asLine(narration.outro) : null;
  const raw = kind === 'interstitial' ? (narration.plates?.[key] ?? narration.lines?.[key]) : narration.lines?.[key];
  return raw === undefined ? null : asLine(raw);
}

/** Earlier kit versions kept clips as voice/<line>-<hash>.mp3 in the video folder. */
function adoptLegacy(video, hash, mp3) {
  const dir = join(video.out, 'voice');
  if (!existsSync(dir)) return false;
  const old = readdirSync(dir).find((f) => f.endsWith(`-${hash}.mp3`));
  if (!old) return false;
  copyFileSync(join(dir, old), mp3);
  const align = join(dir, old.replace(/\.mp3$/, '.alignment.json'));
  if (existsSync(align)) copyFileSync(align, mp3.replace(/\.mp3$/, '.alignment.json'));
  return true;
}

async function baseClip(video, line, { force, stats }) {
  const voice = video.audio.voice;
  const { text, settings, hash } = clipKey(video, line);
  const dir = voiceCacheDir(video);
  const mp3 = join(dir, `${hash}.mp3`);
  const wav = join(dir, `${hash}.norm.wav`);
  if (force || !existsSync(mp3)) {
    if (!force && adoptLegacy(video, hash, mp3)) {
      stats.reused += 1;
    } else {
      if (process.env.WALKTHROUGH_AUDIO_OFFLINE === '1') {
        throw new Error(`WALKTHROUGH_AUDIO_OFFLINE=1 and no cached clip for: ${line.text}`);
      }
      const { alignment } = await synthesize({ text, voice: { ...voice, settings, languageCode: resolveVideoLanguage(video.config?.language).code }, outFile: mp3 });
      if (alignment) writeFileSync(mp3.replace(/\.mp3$/, '.alignment.json'), JSON.stringify(alignment));
      stats.synthesized += 1;
      stats.chars += text.length;
    }
  } else {
    stats.reused += 1;
  }
  if (force || !existsSync(wav) || statSync(wav).mtimeMs < statSync(mp3).mtimeMs) {
    const trimmed = join(dir, `${hash}.trim.wav`);
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp3, '-af', TRIM, trimmed], null);
    normalizeTo(trimmed, wav, { lufs: video.audio.mix.voiceLufs, tp: -2, sampleRate: video.audio.mix.sampleRate });
    rmSync(trimmed);
  }
  return { hash, wav, text, speed: settings.speed, duration: duration(wav) };
}

/** Pitch-preserving local time-stretch of a cached clip (WSOLA; transparent up to ~1.15×). */
function stretched(video, base, tempo) {
  if (tempo <= 1.001) return { file: base.wav, duration: base.duration };
  const file = join(voiceCacheDir(video), `${base.hash}.t${tempo.toFixed(2)}.wav`);
  if (!existsSync(file)) {
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', base.wav, '-af', `atempo=${tempo.toFixed(3)}`, file], null);
  }
  return { file, duration: duration(file) };
}

/**
 * Seconds each narration line takes to speak, keyed by the caption/chapter title it belongs to.
 * The recorder paces the take with this (a step holds until its line is spoken), so the cut does
 * not depend on how fast the machine ran. Lines not yet in the cache are synthesized now — the
 * audio step would pay for them anyway. Returns null without narration or credentials.
 */
export async function narrationDurations(video) {
  const narration = await loadNarration(video);
  if (!narration || audioMode() === 'missing-key') return null;
  const durations = new Map();
  const stats = { synthesized: 0, reused: 0, chars: 0 };
  for (const [key, raw] of Object.entries(narration.lines)) {
    try {
      const base = await baseClip(video, asLine(raw), { force: false, stats });
      durations.set(key, base.duration);
    } catch (err) {
      console.log(`⚠ narration "${key}" has no clip yet (${err.message.split('\n')[0]}); the step keeps its scripted time`);
    }
  }
  return { durations, lead: LEAD, gap: GAP, stats };
}

export async function buildVoice(video, { force = false } = {}) {
  const narration = await loadNarration(video);
  if (!narration) {
    console.log(`· no narration.mjs in ${video.dir} — skipping voice`);
    return null;
  }
  const mode = audioMode();
  if (mode === 'missing-key') {
    throw new Error('ELEVENLABS_API_KEY is not set (kit/.env). For a plumbing check without credits: WALKTHROUGH_AUDIO_STUB=1');
  }
  const LIVE = livePath(video);
  const timelinePath = join(video.out, 'timeline.json');
  if (!existsSync(LIVE) || !existsSync(timelinePath)) throw new Error(`Record first: node cli.mjs record ${video.slug}`);
  await ensurePlates(video);
  const plates = platePaths(video);
  if (!existsSync(plates.open.mp4) || !existsSync(plates.close.mp4)) throw new Error(`Render plates first: node cli.mjs plates ${video.slug}`);

  const plan = buildEditPlan(video);
  const { dLive, dClose, total, timeline, liveToDelivery, segments } = plan;
  const openAt = plan.openAt || 0;
  const openYield = plan.openYield ?? plan.dOpen ?? 0;
  const closeAt = plan.closeAt ?? total - dClose;
  const closeEnd = closeAt + (plan.closeDur || dClose);
  const voice = video.audio.voice;
  console.log(`· voice: ${voice.name || voice.voiceId} · ${voice.model} · ${mode}${mode === 'stub' ? ' (macOS say — plumbing only)' : ''}`);

  const plateLines = narration.plates || {};
  const slots = [];
  if (narration.intro) {
    slots.push({ key: 'intro', kind: 'intro', line: asLine(narration.intro), windowStart: openAt + INTRO_WINDOW.start, windowEnd: openYield + INTRO_WINDOW.pastOpen });
  }

  // Interstitial plate narration (keyed by plate id or on-screen title)
  for (const seg of segments) {
    if (seg.kind === 'plate' && seg.interstitial && !seg.repeatOf) {
      const raw = plateLines[seg.id] ?? narration.lines[seg.title] ?? narration.lines[seg.id];
      if (raw !== undefined) {
        const inDur = seg.transitionIn?.dur || 0;
        slots.push({
          key: seg.id,
          kind: 'interstitial',
          line: asLine(raw),
          markAt: seg.at + inDur / 2,
          windowStart: seg.at + inDur / 2 + LEAD.interstitial,
          windowEnd: seg.at + seg.dur - PLATE_TAIL,
        });
      }
    }
  }

  const used = new Set(slots.filter((s) => s.kind === 'interstitial').map((s) => s.key));
  timeline.forEach((mark, i) => {
    if ((mark.kind !== 'caption' && mark.kind !== 'chapter') || mark.copyOf) return;
    const raw = narration.lines[mark.label];
    if (raw === undefined) return;
    used.add(mark.label);
    const next = timeline
      .slice(i + 1)
      .find((m) => ((m.kind === 'caption' || m.kind === 'chapter') && !m.copyOf && narration.lines[m.label] !== undefined) || m.id === 'end');
    const markAt = liveToDelivery(mark.t);
    const windowEnd = liveToDelivery(next ? next.t : dLive);
    slots.push({
      key: mark.label,
      kind: mark.kind,
      line: asLine(raw),
      markAt,
      windowStart: markAt + LEAD[mark.kind],
      windowEnd,
    });
  });
  if (narration.outro) {
    slots.push({
      key: 'outro',
      kind: 'outro',
      line: asLine(narration.outro),
      windowStart: closeAt + OUTRO_WINDOW.lead,
      windowEnd: Math.max(closeAt + OUTRO_WINDOW.lead + 0.3, Math.min(total, closeEnd) - OUTRO_WINDOW.tail),
    });
  }

  slots.sort((a, b) => a.windowStart - b.windowStart);
  console.log(`» voice · Fitting ${slots.length} lines`);
  const unused = [
    ...Object.keys(narration.lines).filter((k) => !used.has(k)),
    ...Object.keys(plateLines).filter((k) => !used.has(k)),
  ];
  const warnings = unused.map((k) => `line "${k}" matches no caption, chapter, or interstitial plate in this take`);

  const clips = [];
  const stats = { synthesized: 0, reused: 0, chars: 0 };
  const edits = voiceEditsOf(video);
  let prevEnd = 0;
  for (const slot of slots) {
    // The desk may have rewritten the line, changed its delivery speed or picked another take.
    const edit = edits.get(slot.key) || {};
    const line = voiceLineSpec(slot.line, edit);
    const base = await baseClip(video, line, { force, stats });
    let clip = { file: base.wav, duration: base.duration, speed: base.speed, text: base.text };
    const start = slotStart(slot, prevEnd);
    // Nothing follows the outro, so it gets no spill: past the window it is cut off by the end of the video
    const room = slotRoom(slot, start);
    const notes = [];
    // A head or tail trim on the desk shortens what plays; the fit and the next line see that length.
    const trimmed = () => voiceShape(clip.duration, edit).duration;
    if (room > 0 && trimmed() > room && line.speed === undefined) {
      const tempo = Math.ceil((trimmed() / room) * 100) / 100;
      if (base.speed * tempo <= (voice.maxFitSpeed || 1.15)) {
        const fit = stretched(video, base, tempo);
        clip = { ...clip, ...fit, speed: Number((base.speed * tempo).toFixed(2)) };
        notes.push(`fitted at ${clip.speed.toFixed(2)}×`);
      }
    }
    const plays = trimmed();
    if (plays > room + 0.1) {
      notes.push(`long by ${(plays - room).toFixed(1)}s — shorten the line or give the step more time`);
    }
    if (start - slot.windowStart > 1.5) notes.push(`starts ${(start - slot.windowStart).toFixed(1)}s late (previous line ran over)`);
    const placement = {
      key: slot.key,
      kind: slot.kind,
      markAt: slot.markAt ?? null,
      start: Number(start.toFixed(3)),
      end: Number((start + plays).toFixed(3)),
      // `duration` is what plays after the desk's trims; `full` is the clip file's length.
      duration: Number(plays.toFixed(3)),
      full: Number(clip.duration.toFixed(3)),
      window: [Number(slot.windowStart.toFixed(3)), Number(slot.windowEnd.toFixed(3))],
      speed: clip.speed,
      take: line.take || 1,
      file: clip.file,
      text: clip.text,
      notes,
    };
    clips.push(placement);
    prevEnd = placement.end;
    for (const n of notes) if (!n.startsWith('fitted at')) warnings.push(`"${slot.key}": ${n}`);
    console.log(`» voice · ${clips.length} of ${slots.length} · ${slot.key}`);
    console.log(`  ${placement.start.toFixed(1).padStart(6)}s  ${plays.toFixed(1).padStart(4)}s  ${slot.key}${notes.length ? '  ⚠ ' + notes.join('; ') : ''}`);
  }

  const meta = {
    mode,
    voice: { name: voice.name, voiceId: voice.voiceId, model: voice.model, settings: voice.settings, direction: voice.direction },
    segments: { openSec: plan.dOpen, liveSec: dLive, closeSec: dClose },
    clips,
    warnings,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(voiceMetaPath(video), JSON.stringify(meta, null, 2));
  const spoken = clips.reduce((s, c) => s + c.duration, 0);
  console.log(`» voice · ${clips.length} lines · ${spoken.toFixed(0)}s of speech`);
  console.log(`✓ ${clips.length} lines · ${spoken.toFixed(0)}s of speech over ${total.toFixed(0)}s${warnings.length ? ` · ${warnings.length} warning(s)` : ''}`);
  console.log(`  ElevenLabs: ${stats.synthesized} new clip(s), ${stats.chars} characters · ${stats.reused} from cache`);
  meta.spend = stats;
  writeFileSync(voiceMetaPath(video), JSON.stringify(meta, null, 2));
  return meta;
}

/** Ensure a custom take's normalised wav exists next to its mp3. */
function ensureCustomWav(video, paths) {
  if (!existsSync(paths.mp3)) throw new Error('Custom take file missing');
  if (!existsSync(paths.wav) || statSync(paths.wav).mtimeMs < statSync(paths.mp3).mtimeMs) {
    const trimmed = paths.wav.replace(/\.norm\.wav$/, '.trim.wav');
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', paths.mp3, '-af', TRIM, trimmed], null);
    normalizeTo(trimmed, paths.wav, { lufs: video.audio.mix.voiceLufs, tp: -2, sampleRate: video.audio.mix.sampleRate });
    rmSync(trimmed, { force: true });
  }
  return { wav: paths.wav, duration: duration(paths.wav) };
}

/**
 * Install an uploaded or mic-recorded take for a line. Converts any ffmpeg-readable audio to mp3,
 * normalises it, bumps the desk take counter, and points `voice.json` at the new clip.
 */
export async function installCustomTake(video, key, { buffer, mime = 'audio/mpeg', source = 'upload', newTake = true, take: wantTake = null } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Audio data required');
  if (buffer.length > 25 * 1024 * 1024) throw new Error('Audio file too large (max 25 MB)');
  const metaPath = voiceMetaPath(video);
  if (!existsSync(metaPath)) throw new Error('Build the voice first (Mix), or add a voice line first');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const clip = (meta.clips || []).find((c) => c.key === key);
  if (!clip) throw new Error(`No voice line "${key}" in this mix`);

  const edit = voiceEditsOf(video).get(key) || { key };
  const prevTake = Math.max(1, edit.take || clip.take || 1);
  const prevTakes = Math.max(prevTake, edit.takes || clip.takes || 1);
  // An empty placeholder (fresh ad-lib) fills take 1 instead of jumping to take 2.
  const empty = !(clip.full > 0) && !clip.file && !hasCustomTake(video, key, prevTake);
  const take = newTake
    ? empty
      ? prevTake
      : prevTakes + 1
    : Math.max(1, Math.round(Number(wantTake) || prevTake));
  const paths = customTakePaths(video, key, take);
  const ext =
    /webm/i.test(mime) ? 'webm' : /wav/i.test(mime) ? 'wav' : /ogg|opus/i.test(mime) ? 'ogg' : /m4a|mp4|aac/i.test(mime) ? 'm4a' : 'mp3';
  const tmpIn = join(customTakeDir(video, key), `in-${take}.${ext}`);
  writeFileSync(tmpIn, buffer);
  try {
    run(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmpIn, '-vn', '-ar', '44100', '-ac', '1', '-b:a', '192k', paths.mp3],
      null
    );
  } finally {
    rmSync(tmpIn, { force: true });
  }
  const base = ensureCustomWav(video, paths);
  const plays = voiceShape(base.duration, edit).duration;
  Object.assign(clip, {
    end: Number((clip.start + plays).toFixed(3)),
    duration: Number(plays.toFixed(3)),
    full: Number(base.duration.toFixed(3)),
    speed: 1,
    take,
    takes: Math.max(prevTakes, take),
    file: base.wav,
    text: edit.text || clip.text || key,
    source: source === 'mic' ? 'mic' : 'upload',
    notes: (clip.notes || []).filter((n) => !/^fitted at|^custom take/.test(n)).concat([`custom take ${take} (${source})`]),
  });
  meta.generatedAt = new Date().toISOString();
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return { clip, take, source: source === 'mic' ? 'mic' : 'upload', duration: base.duration };
}

/**
 * Add a free-standing voice line at an absolute delivery time (ad-lib on the cut).
 * Does not require a narration.mjs entry — text lives on the desk for ElevenLabs regenerates.
 */
export async function addAdlibLine(video, { text = '', at = 0, key = null } = {}) {
  const metaPath = voiceMetaPath(video);
  const meta = existsSync(metaPath)
    ? JSON.parse(readFileSync(metaPath, 'utf8'))
    : { generatedAt: new Date().toISOString(), clips: [], voice: video.audio?.voice || {} };
  meta.clips = Array.isArray(meta.clips) ? meta.clips : [];
  const id =
    key ||
    `adlib-${createHash('sha1')
      .update(`${Date.now()}-${Math.random()}`)
      .digest('hex')
      .slice(0, 8)}`;
  if (meta.clips.some((c) => c.key === id)) throw new Error(`Voice line "${id}" already exists`);
  const start = Math.max(0, Number(at) || 0);
  const spoken = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  meta.clips.push({
    key: id,
    kind: 'adlib',
    start: Number(start.toFixed(3)),
    end: Number(start.toFixed(3)),
    duration: 0,
    full: 0,
    take: 1,
    text: spoken || id,
    file: '',
    notes: ['added in the Editor'],
  });
  meta.generatedAt = new Date().toISOString();
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return { key: id, start, text: spoken };
}

/**
 * A second copy of a spoken line at `at` (delivery seconds), as its own ad-lib. It plays the
 * source's audio as recorded, so it is heard straight away; Regenerate on it speaks it afresh.
 */
export async function duplicateVoiceLine(video, sourceKey, { at = 0 } = {}) {
  const metaPath = voiceMetaPath(video);
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : null;
  const src = (meta?.clips || []).find((c) => c.key === sourceKey);
  if (!src) throw new Error(`No voice line "${sourceKey}" to duplicate`);
  const created = await addAdlibLine(video, { text: src.text || '', at });
  const after = JSON.parse(readFileSync(metaPath, 'utf8'));
  const clip = after.clips.find((c) => c.key === created.key);
  const plays = Number(src.duration) || 0;
  Object.assign(clip, {
    end: Number((created.start + plays).toFixed(3)),
    duration: Number(plays.toFixed(3)),
    full: Number(src.full) || plays,
    ...(src.speed != null ? { speed: src.speed } : {}),
    file: src.file || '',
    ...(src.source ? { source: src.source } : {}),
    copyOf: sourceKey,
    notes: ['duplicated in the Editor'],
  });
  after.generatedAt = new Date().toISOString();
  writeFileSync(metaPath, JSON.stringify(after, null, 2));
  return { ...created, source: src };
}

/**
 * Speak one line again and put the new clip into `voice/voice.json` where the old one sat.
 * The desk entry for the line (text, speed, take) is what the clip is made from, so call this
 * after that entry is saved. Lines that follow keep their place here; the next voice step
 * re-fits everything, and the Editor projects the cut either way.
 * Custom upload/mic takes short-circuit ElevenLabs when that take already has a file on disk.
 */
export async function regenerateLine(video, key) {
  const metaPath = voiceMetaPath(video);
  if (!existsSync(metaPath)) throw new Error('Build the voice first (Mix) before regenerating a line');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const clip = (meta.clips || []).find((c) => c.key === key);
  if (!clip) throw new Error(`No voice line "${key}" in this mix`);
  const edit = voiceEditsOf(video).get(key) || {};
  const take = edit.take || clip.take || 1;
  const narration = await loadNarration(video);
  const written = narrationLineFor(narration, clip) || (edit.text || clip.text ? { text: edit.text || clip.text, speed: 1 } : null);
  if (!written && !hasCustomTake(video, key, take)) {
    throw new Error(clip.kind === 'adlib' ? 'Add text and Regenerate, or upload / record a take' : `"${key}" is no longer in narration.mjs`);
  }

  let base;
  let mode = audioMode();
  let synthesized = false;
  if (hasCustomTake(video, key, take)) {
    const paths = customTakePaths(video, key, take);
    const custom = ensureCustomWav(video, paths);
    base = { wav: custom.wav, duration: custom.duration, text: written?.text || clip.text || key, speed: 1 };
    mode = 'custom';
  } else {
    if (mode === 'missing-key') throw new Error('ELEVENLABS_API_KEY is not set (kit/.env)');
    const line = voiceLineSpec(written, edit);
    if (!String(line.text || '').trim()) throw new Error('Nothing to speak — write the line or upload audio');
    const stats = { synthesized: 0, reused: 0, chars: 0 };
    base = await baseClip(video, line, { force: false, stats });
    synthesized = stats.synthesized > 0;
    meta.spend = {
      ...(meta.spend || {}),
      synthesized: (meta.spend?.synthesized || 0) + stats.synthesized,
      chars: (meta.spend?.chars || 0) + stats.chars,
    };
  }
  const plays = voiceShape(base.duration, edit).duration;
  Object.assign(clip, {
    start: clip.start,
    end: Number((clip.start + plays).toFixed(3)),
    duration: Number(plays.toFixed(3)),
    full: Number(base.duration.toFixed(3)),
    speed: base.speed,
    take,
    file: base.wav,
    text: base.text,
    source: mode === 'custom' ? edit.takeSources?.[String(take)] || 'upload' : 'eleven',
    notes: (clip.notes || []).filter((n) => !/^fitted at/.test(n)),
  });
  meta.generatedAt = new Date().toISOString();
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return { clip, synthesized, mode };
}
