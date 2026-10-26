/**
 * The audio desk: everything the Editor changes about the mix, stored on the edit deck
 * (`video.config.json → edit.audio`) and read back by `mixAudio`.
 *
 *   music   slip, level, mute, fades, loop-to-fill, and gain rides (delivery-clock regions)
 *   voice   per-line nudge, level, mute, head/tail trim, fades, and what the line is made of:
 *           a rewritten text, a delivery speed, the take in use (keyed by the narration line)
 *   master  the loudness targets the mix already uses (LUFS, true peak, duck ratio)
 *
 * Absent keys mean "the brand mix, untouched". `compactAudio` drops those so a video
 * that was never mastered stores nothing.
 */
import { dbToLin, musicVolumeExpr } from '../shared/mixMath.js';

const r3 = (v) => Math.round(v * 1000) / 1000;
const r1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const GAIN_RANGE = Object.freeze([-18, 12]);
export const NUDGE_RANGE = Object.freeze([-6, 6]);
export const OFFSET_RANGE = Object.freeze([-20, 20]);
export const FADE_RANGE = Object.freeze([0, 8]);
/** Per-line fades are short: a breath in, a soft landing out. */
export const VOICE_FADE_RANGE = Object.freeze([0, 2]);
/** A trimmed line keeps at least this much speech. */
export const VOICE_MIN_SEC = 0.3;
/** Delivery speed a line can be regenerated at (ElevenLabs `speed`). */
export const VOICE_SPEED_RANGE = Object.freeze([0.8, 1.3]);
export const VOICE_TEXT_MAX = 600;
export const MASTER_RANGES = Object.freeze({
  voiceLufs: [-24, -9],
  plateLufs: [-30, -12],
  bedLufs: [-42, -18],
  targetLufs: [-18, -9],
  truePeakDb: [-3, -0.5],
  duckRatio: [1, 8],
});
export const DEFAULT_FADE_IN = 1.2;
export const DEFAULT_FADE_OUT = 2.6;

const MASTER_KEYS = Object.keys(MASTER_RANGES);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeRides(list, duration) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const from = r3(Math.max(0, num(raw.from) ?? NaN));
    const to = r3(num(raw.to) ?? NaN);
    const gainDb = r1(clamp(num(raw.gainDb) ?? 0, GAIN_RANGE[0], GAIN_RANGE[1]));
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('a music ride needs from and to in seconds');
    if (to - from < 0.4) throw new Error('a music ride must last at least 0.4s');
    if (!gainDb) continue;
    const end = Math.min(to, Number.isFinite(duration) ? duration : to);
    if (end - from < 0.4) continue;
    out.push({ from, to: r3(end), gainDb });
  }
  out.sort((a, b) => a.from - b.from);
  for (let i = 1; i < out.length; i++) {
    if (out[i].from < out[i - 1].to - 0.001) {
      throw new Error(`music rides overlap (${out[i - 1].from}–${out[i - 1].to}s and ${out[i].from}–${out[i].to}s)`);
    }
  }
  return out;
}

function normalizeMusic(raw, duration) {
  const m = raw && typeof raw === 'object' ? raw : {};
  return {
    offset: r3(clamp(num(m.offset) ?? 0, OFFSET_RANGE[0], OFFSET_RANGE[1])),
    gainDb: r1(clamp(num(m.gainDb) ?? 0, GAIN_RANGE[0], GAIN_RANGE[1])),
    mute: Boolean(m.mute),
    /** When the bed is shorter than the cut, loop it under the delivery instead of silence. */
    loop: Boolean(m.loop),
    fadeIn: r3(clamp(num(m.fadeIn) ?? DEFAULT_FADE_IN, FADE_RANGE[0], FADE_RANGE[1])),
    fadeOut: r3(clamp(num(m.fadeOut) ?? DEFAULT_FADE_OUT, FADE_RANGE[0], FADE_RANGE[1])),
    rides: normalizeRides(m.rides, duration),
  };
}

function normalizeVoice(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const key = String(raw?.key || '').trim();
    if (!key) throw new Error('a voice edit needs the line key');
    if (seen.has(key)) continue;
    seen.add(key);
    const nudge = r3(clamp(num(raw.nudge) ?? 0, NUDGE_RANGE[0], NUDGE_RANGE[1]));
    const gainDb = r1(clamp(num(raw.gainDb) ?? 0, GAIN_RANGE[0], GAIN_RANGE[1]));
    const mute = Boolean(raw.mute);
    const trimStart = r3(Math.max(0, num(raw.trimStart) ?? 0));
    const trimEnd = r3(Math.max(0, num(raw.trimEnd) ?? 0));
    const fadeIn = r3(clamp(num(raw.fadeIn) ?? 0, VOICE_FADE_RANGE[0], VOICE_FADE_RANGE[1]));
    const fadeOut = r3(clamp(num(raw.fadeOut) ?? 0, VOICE_FADE_RANGE[0], VOICE_FADE_RANGE[1]));
    const text = typeof raw.text === 'string' ? raw.text.replace(/\s+/g, ' ').trim().slice(0, VOICE_TEXT_MAX) : '';
    const speedRaw = num(raw.speed);
    const speed = speedRaw == null ? 1 : Math.round(clamp(speedRaw, VOICE_SPEED_RANGE[0], VOICE_SPEED_RANGE[1]) * 100) / 100;
    const take = Math.max(1, Math.round(num(raw.take) ?? 1));
    const takes = Math.max(take, Math.round(num(raw.takes) ?? 1));
    // `at` is an absolute delivery time: the line plays there instead of in its window.
    // 0 is a real position (the first frame), so only an absent value means "follow the window".
    const at = num(raw.at);
    const entry = { key };
    if (at != null && at >= 0) entry.at = r3(Math.min(at, 3600));
    if (nudge) entry.nudge = nudge;
    if (gainDb) entry.gainDb = gainDb;
    if (mute) entry.mute = true;
    if (trimStart) entry.trimStart = trimStart;
    if (trimEnd) entry.trimEnd = trimEnd;
    if (fadeIn) entry.fadeIn = fadeIn;
    if (fadeOut) entry.fadeOut = fadeOut;
    if (text) entry.text = text;
    if (speed !== 1) entry.speed = speed;
    if (take > 1) entry.take = take;
    if (takes > 1) entry.takes = takes;
    // Per-take origin: upload / mic / eleven — so the Editor can label chips and skip TTS.
    const takeSources = {};
    if (raw.takeSources && typeof raw.takeSources === 'object') {
      for (const [k, v] of Object.entries(raw.takeSources)) {
        const n = Math.max(1, Math.round(Number(k) || 0));
        if (!n || n > 40) continue;
        if (v === 'upload' || v === 'mic' || v === 'eleven') takeSources[String(n)] = v;
      }
    }
    if (Object.keys(takeSources).length) entry.takeSources = takeSources;
    if (Object.keys(entry).length === 1) continue;
    out.push(entry);
  }
  return out;
}

/**
 * How a line is cut and faded, given the clip's full length. Trims are clamped so at least
 * `VOICE_MIN_SEC` of speech remains (the head trim wins when both are too long), and fades are
 * clamped to the remaining duration.
 */
export function voiceShape(fullDuration, edit = {}) {
  const full = Math.max(0, num(fullDuration) ?? 0);
  const room = Math.max(0, full - VOICE_MIN_SEC);
  const trimStart = r3(clamp(num(edit.trimStart) ?? 0, 0, room));
  const trimEnd = r3(clamp(num(edit.trimEnd) ?? 0, 0, Math.max(0, room - trimStart)));
  const duration = r3(Math.max(0, full - trimStart - trimEnd));
  const fadeIn = r3(clamp(num(edit.fadeIn) ?? 0, 0, duration));
  const fadeOut = r3(clamp(num(edit.fadeOut) ?? 0, 0, Math.max(0, duration - fadeIn)));
  return { trimStart, trimEnd, fadeIn, fadeOut, duration, full: r3(full) };
}

/**
 * What the line is generated from: the desk's rewritten text and delivery speed win over the
 * narration file; `take` picks one of the generated takes.
 */
export function voiceLineSpec(line, edit = {}) {
  const spec = { ...line };
  if (edit.text) spec.text = edit.text;
  if (edit.speed && edit.speed !== 1) spec.speed = edit.speed;
  if (edit.take > 1) spec.take = edit.take;
  return spec;
}

function normalizeMaster(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of MASTER_KEYS) {
    if (m[key] == null || m[key] === '') continue;
    const n = num(m[key]);
    if (n == null) throw new Error(`${key} must be a number`);
    const [lo, hi] = MASTER_RANGES[key];
    out[key] = key === 'duckRatio' || key.endsWith('Lufs') ? r1(clamp(n, lo, hi)) : r1(clamp(n, lo, hi));
  }
  return out;
}

/** Full desk with defaults filled in, safe to read from the Editor. */
export function normalizeAudio(raw, { duration = Infinity } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    music: normalizeMusic(src.music, duration),
    voice: normalizeVoice(src.voice),
    master: normalizeMaster(src.master),
  };
}

/** Sparse desk as stored. `undefined` when nothing was touched. */
export function compactAudio(audio) {
  if (!audio) return undefined;
  const full = audio.music?.fadeIn == null ? normalizeAudio(audio) : audio;
  const music = {};
  const m = full.music || {};
  if (m.offset) music.offset = m.offset;
  if (m.gainDb) music.gainDb = m.gainDb;
  if (m.mute) music.mute = true;
  if (m.loop) music.loop = true;
  if (m.fadeIn != null && m.fadeIn !== DEFAULT_FADE_IN) music.fadeIn = m.fadeIn;
  if (m.fadeOut != null && m.fadeOut !== DEFAULT_FADE_OUT) music.fadeOut = m.fadeOut;
  if (m.rides?.length) music.rides = m.rides;
  const voice = full.voice || [];
  const master = full.master || {};
  const out = {};
  if (Object.keys(music).length) out.music = music;
  if (voice.length) out.voice = voice;
  if (Object.keys(master).length) out.master = master;
  return Object.keys(out).length ? out : undefined;
}

export function isEmptyAudio(audio) {
  return !compactAudio(audio);
}

/** Brand mix with the desk's mastering targets laid over it. */
export function resolveMix(mix = {}, audio) {
  const master = audio?.master || {};
  const { duckRatio, ...levels } = master;
  const next = { ...mix, ...levels };
  if (duckRatio != null) next.duck = { ...(mix.duck || {}), ratio: duckRatio };
  return next;
}

/**
 * Narration clips as the mix places them: nudged, levelled, trimmed and faded; muted lines
 * removed. `duration` is what plays (after the trims); `full` is the file's length.
 */
export function resolveVoice(clips = [], voiceEdits = []) {
  const byKey = new Map((voiceEdits || []).map((e) => [e.key, e]));
  const placed = [];
  for (const clip of clips) {
    const edit = byKey.get(clip.key) || {};
    if (edit.mute) continue;
    const nudge = edit.nudge || 0;
    const start = r3((edit.at != null ? edit.at : clip.start) + nudge);
    const shape = voiceShape(clip.full ?? clip.duration, edit);
    placed.push({
      ...clip,
      start,
      end: r3(start + shape.duration),
      duration: shape.duration,
      full: shape.full,
      trimStart: shape.trimStart,
      trimEnd: shape.trimEnd,
      fadeIn: shape.fadeIn,
      fadeOut: shape.fadeOut,
      gainDb: edit.gainDb || 0,
      nudge,
    });
  }
  return placed.sort((a, b) => a.start - b.start);
}

/**
 * The music `volume=` expression for one delivery.
 * `bedGain` is the linear dip from plate level to bed level (mix.mjs already computes it).
 */
export function musicGainExpr({ bedGain, windows, rides, gainDb = 0 }) {
  return musicVolumeExpr({ bedGain, windows, rides, gainLin: dbToLin(gainDb || 0) });
}

export function describeAudio(audio) {
  const c = compactAudio(audio);
  if (!c) return '';
  const bits = [];
  if (c.music) bits.push(c.music.mute ? 'music off' : c.music.loop ? 'music (looped)' : 'music');
  if (c.music?.rides?.length) bits.push(`${c.music.rides.length} music ride${c.music.rides.length === 1 ? '' : 's'}`);
  if (c.voice?.length) bits.push(`${c.voice.length} voice edit${c.voice.length === 1 ? '' : 's'}`);
  const regenerated = (c.voice || []).filter((v) => v.text || v.speed || v.take).length;
  if (regenerated) bits.push(`${regenerated} line${regenerated === 1 ? '' : 's'} regenerated`);
  if (c.master && Object.keys(c.master).length) bits.push('master');
  return bits.join(' · ');
}
