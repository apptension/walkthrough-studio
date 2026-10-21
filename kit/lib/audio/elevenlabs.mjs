/**
 * ElevenLabs: narration (Text to Speech with timestamps) and music (Eleven Music composition plans).
 *
 * Key: ELEVENLABS_API_KEY (shell env or kit/.env). Without it, or with WALKTHROUGH_AUDIO_STUB=1,
 * `stub` providers stand in (macOS `say` + a synthesized pad) so the pipeline can be exercised
 * without spending credits. Stub output is for plumbing checks only, never for delivery.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshDotEnv } from '../dotenv.mjs';

const API = 'https://api.elevenlabs.io/v1';

export function apiKey() {
  return process.env.ELEVENLABS_API_KEY || '';
}

export function audioMode() {
  refreshDotEnv();
  if (process.env.WALKTHROUGH_AUDIO_STUB === '1') return 'stub';
  return apiKey() ? 'live' : 'missing-key';
}

// A stalled request fails here with a clear message, so callers (the Studio's Regenerate among
// them) can report it. Speech is quick; a music composition can run for minutes.
const SPEECH_TIMEOUT_MS = 90_000;
const MUSIC_TIMEOUT_MS = 300_000;

async function post(path, body, { binary = false, timeoutMs = SPEECH_TIMEOUT_MS } = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new Error(`ElevenLabs ${path} did not answer within ${Math.round(timeoutMs / 1000)}s`);
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return binary ? Buffer.from(await res.arrayBuffer()) : res.json();
}

/** Narrators the account can use, for the Studio picker. Cached for a few minutes; empty without a key. */
let voicesCache = { at: 0, list: [] };
export async function listVoices({ force = false } = {}) {
  if (audioMode() !== 'live') return [];
  if (!force && voicesCache.list.length && Date.now() - voicesCache.at < 10 * 60 * 1000) return voicesCache.list;
  const res = await fetch(`${API}/voices?show_legacy=false`, { headers: { 'xi-api-key': apiKey() }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`ElevenLabs /voices → ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const data = await res.json();
  const list = (data.voices || []).map((v) => ({
    voiceId: v.voice_id,
    name: v.name,
    category: v.category || '',
    labels: v.labels || {},
    description: v.description || '',
    previewUrl: v.preview_url || null,
  }));
  list.sort((a, b) => (a.category === 'cloned' ? -1 : 0) - (b.category === 'cloned' ? -1 : 0) || a.name.localeCompare(b.name));
  voicesCache = { at: Date.now(), list };
  return list;
}

/** Narration clip → mp3 file. Returns { alignment } (character timings) when the API provides them. */
export async function synthesize({ text, voice, outFile }) {
  if (audioMode() !== 'live') return stubSpeech({ text, outFile, speed: voice.settings?.speed });
  const format = voice.outputFormat || 'mp3_44100_128';
  const data = await post(`/text-to-speech/${voice.voiceId}/with-timestamps?output_format=${format}`, {
    text,
    model_id: voice.model || 'eleven_v4',
    voice_settings: voice.settings,
    apply_text_normalization: 'auto',
  });
  writeFileSync(outFile, Buffer.from(data.audio_base64, 'base64'));
  return { alignment: data.alignment || null };
}

/** Music from a composition plan (music_v2_5) → mp3 file. */
export async function composeMusic({ plan, model = 'music_v2_5', outFile, outputFormat = 'mp3_44100_128' }) {
  if (audioMode() !== 'live') return stubMusic({ plan, outFile });
  const audio = await post(`/music?output_format=${outputFormat}`, { composition_plan: plan, model_id: model }, { binary: true, timeoutMs: MUSIC_TIMEOUT_MS });
  writeFileSync(outFile, audio);
  return {};
}

// ——— Stubs ———

function sh(bin, args) {
  const r = spawnSync(bin, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${bin} failed: ${(r.stderr || '').slice(-400)}`);
  return r.stdout;
}

function stubSpeech({ text, outFile, speed = 1 }) {
  if (process.platform !== 'darwin') throw new Error('Audio stub needs macOS `say`; set ELEVENLABS_API_KEY instead');
  const plain = text.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
  const aiff = join(tmpdir(), `walkthrough-say-${process.pid}-${Date.now()}.aiff`);
  sh('say', ['-v', 'Samantha', '-r', String(Math.round(175 * speed)), '-o', aiff, plain]);
  sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', aiff, '-ar', '44100', '-ac', '1', '-b:a', '128k', outFile]);
  unlinkSync(aiff);
  return { alignment: null, stub: true };
}

function stubMusic({ plan, outFile }) {
  const totalSec = plan.chunks.reduce((s, c) => s + c.duration_ms, 0) / 1000;
  // Three soft detuned sines with slow tremolo: a placeholder pad, nothing more.
  const filter = [
    `sine=frequency=110:sample_rate=44100:duration=${totalSec}[a]`,
    `sine=frequency=164.8:sample_rate=44100:duration=${totalSec}[b]`,
    `sine=frequency=220.6:sample_rate=44100:duration=${totalSec}[c]`,
    `[a][b][c]amix=inputs=3:normalize=0,tremolo=f=0.18:d=0.35,lowpass=f=900,volume=0.25,afade=t=in:d=2,afade=t=out:st=${Math.max(0, totalSec - 3)}:d=3[m]`,
  ].join(';');
  sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-filter_complex', filter, '-map', '[m]', '-b:a', '128k', outFile]);
  return { stub: true };
}

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
