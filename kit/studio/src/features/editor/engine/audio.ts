import { api } from '@/desk/api';
import { toast } from '@/desk/toast';
import { neonButtonLabel } from '@/ui/neonFx';

import type { PreviewAudio } from './audioPreview';
import { postDeck, refresh, snapshotDeck, validateSelection } from './data';
import { renderInspector } from './inspector';
import { previewRange } from './look';
import { paintStatus } from './edits';
import { buildSeq } from './seq';
import { renderFrame } from './stage';
import { flashHint, renderTimeline } from './timeline';
import { audioDesk, ed, preview, slug, type Hear } from './state';
import type { AudioDesk, Deck, MusicDesk, VoiceClip, VoiceDesk } from './types';
import { $, bufferToBase64, errMessage, errName } from './util';

/** The voice, music and mix half of `kit/studio/editor.js` (previewState … toggleMicRecord). */

export function previewState(): PreviewAudio | null {
  const audio = ed.deck?.audio;
  if (!audio) return null;
  const mix: AudioDesk = structuredClone(audioDesk());
  const levels = { ...(audio.levels || {}) };
  const hear: Hear | null = ed.hear;
  if (hear?.music) Object.assign(mix.music, hear.music);
  if (hear?.master) {
    Object.assign(mix.master, hear.master);
    Object.assign(levels, hear.master);
  }
  const clips = (audio.voiceClips || []).map((c) => {
    const over = hear?.voice?.key === c.key ? hear.voice : null;
    return over ? ({ ...c, ...over }) : c;
  });
  return { ...audio, desk: mix, levels, voiceClips: clips, total: ed.total };
}

export function postAudio(next: AudioDesk, hint?: string): Promise<Deck | null> {
  return postDeck({ audio: next }, { hint });
}

export function withMusic(patch: Partial<MusicDesk>, hint?: string): Promise<Deck | null> {
  return postAudio({ ...audioDesk(), music: { ...audioDesk().music, ...patch } }, hint);
}

export function withMaster(patch: Record<string, number | string | null | undefined>, hint?: string): Promise<Deck | null> {
  const master = { ...audioDesk().master };
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') delete master[key];
    else master[key] = value;
  }
  return postAudio({ ...audioDesk(), master }, hint);
}

/** Save one line's desk entry; keys at their default drop out so an untouched line stores nothing. */
export function withVoice(key: string, patch: Partial<VoiceDesk>, hint?: string): Promise<Deck | null> {
  const prev = audioDesk().voice.find((v) => v.key === key) || { key };
  const merged: VoiceDesk = { ...prev, ...patch, key: patch.key ?? prev.key ?? key };
  const bag = merged as Record<string, unknown>;
  if (!merged.mute) delete bag['mute'];
  for (const k of ['nudge', 'gainDb', 'trimStart', 'trimEnd', 'fadeIn', 'fadeOut']) if (!bag[k]) delete bag[k];
  if (merged.at == null) delete bag['at'];
  if (!merged.text) delete bag['text'];
  if (!merged.speed || Math.abs(merged.speed - 1) < 0.005) delete bag['speed'];
  if (!((merged.take ?? 0) > 1)) delete bag['take'];
  if (!((merged.takes ?? 0) > 1)) delete bag['takes'];
  const voice = audioDesk().voice.filter((v) => v.key !== key);
  if (Object.keys(merged).length > 1) voice.push(merged);
  return postAudio({ ...audioDesk(), voice }, hint);
}

export const voiceClip = (key: string | null | undefined): VoiceClip | undefined =>
  (ed.deck?.audio?.voiceClips || []).find((c) => c.key === key);

/** Pick the narrator for this video (or go back to the brand's). Mix speaks the lines again. */
export async function setNarrator(body: Record<string, unknown>, hint: string): Promise<Deck | null> {
  try {
    const r = await api<Deck>(`/api/video/${encodeURIComponent(slug() || '')}/narrator`, { method: 'POST', body });
    ed.deck = r;
    ed.narratorPick = null;
    buildSeq();
    renderTimeline();
    renderInspector();
    paintStatus();
    flashHint(hint);
    return r;
  } catch (err) {
    toast('Narrator not changed', errMessage(err), 'err');
    return null;
  }
}

/** Hear one line from its start, with the sound on. */
export function listenLine(clip: VoiceClip | null | undefined): void {
  if (!clip) return;
  if (!ed.sound) {
    ed.sound = true;
    preview.setEnabled(true);
    $('edSound')?.classList.toggle('is-on', true);
  }
  previewRange(clip.start, clip.start + clip.dur);
}

/**
 * Speak a line again on the server (new take, rewrite, speed, or an earlier take from the cache)
 * and play it as soon as it lands.
 */
export const REGEN_TIMEOUT_MS = 120_000;
export async function regenerateLine(key: string, body: Record<string, unknown>, hint?: string): Promise<Deck | null> {
  if (ed.regenerating) return null;
  // Busy state in place: the inspector keeps the textarea as typed, the pill on the timeline speaks.
  const root = $('inspectorRoot');
  root?.querySelectorAll<HTMLButtonElement>('[data-act="voice-regen"], [data-act="voice-revert"], [data-take]').forEach((b) => (b.disabled = true));
  const regen = root?.querySelector('[data-act="voice-regen"]');
  regen?.classList.add('is-busy');
  const regenLabel = neonButtonLabel(regen);
  if (regenLabel) regenLabel.textContent = 'Speaking…';
  ed.regenerating = key;
  renderTimeline();
  const before = snapshotDeck();
  let r: Deck;
  try {
    r = await api<Deck>(`/api/video/${encodeURIComponent(slug() || '')}/voice/line`, {
      method: 'POST',
      body: { key, ...body },
      signal: AbortSignal.timeout(REGEN_TIMEOUT_MS),
    });
  } catch (err) {
    // The flag goes first: every render below reads it, and a render that sees it stays busy.
    ed.regenerating = null;
    const timedOut = errName(err) === 'TimeoutError' || errName(err) === 'AbortError';
    toast('Line not regenerated', timedOut ? `The narrator did not answer within ${REGEN_TIMEOUT_MS / 1000}s. The line is as it was.` : errMessage(err), 'err');
    await refresh();
    const ta = $('inspectorRoot')?.querySelector<HTMLTextAreaElement>('[data-voice-text]');
    if (ta && typeof body['text'] === 'string' && body['text']) ta.value = body['text'];
    return null;
  }
  ed.regenerating = null;
  ed.undo.push(before);
  ed.redo = [];
  preview.forget(key);
  ed.deck = r;
  ed.hear = null;
  buildSeq();
  await preview.load(previewState());
  validateSelection();
  renderTimeline();
  renderFrame();
  renderInspector();
  paintStatus();
  flashHint(hint || (r.line?.synthesized ? 'New take ready' : 'Take loaded'));
  listenLine(voiceClip(key));
  return r;
}

/** Apply a deck response from voice add/upload and select the line. */
export async function applyVoiceDeck(r: Deck, key: string | null | undefined, hint?: string): Promise<Deck> {
  const before = snapshotDeck();
  ed.undo.push(before);
  ed.redo = [];
  if (key) preview.forget(key);
  ed.deck = r;
  ed.hear = null;
  buildSeq();
  await preview.load(previewState());
  if (key) ed.sel = { type: 'voice', key };
  validateSelection();
  renderTimeline();
  renderFrame();
  renderInspector();
  paintStatus();
  if (hint) flashHint(hint);
  if (key) listenLine(voiceClip(key));
  return r;
}

/** Add a free-standing voice line at the playhead (ad-lib). Optional ElevenLabs speak. */
export async function addVoiceLine({ text = '', via = null, at = null }: { text?: string; via?: string | null; at?: number | null } = {}): Promise<Deck | null> {
  const t = at != null ? at : ed.t;
  const body: Record<string, unknown> = { at: Math.max(0, Number(t) || 0), text: String(text || '').trim() };
  if (via === 'eleven') body['via'] = 'eleven';
  try {
    const r = await api<Deck>(`/api/video/${encodeURIComponent(slug() || '')}/voice/line/add`, {
      method: 'POST',
      body,
      ...(via === 'eleven' ? { signal: AbortSignal.timeout(REGEN_TIMEOUT_MS) } : {}),
    });
    return applyVoiceDeck(r, r.key, via === 'eleven' ? 'Line spoken' : 'Voice line added');
  } catch (err) {
    toast('Voice line not added', errMessage(err), 'err');
    return null;
  }
}

type AudioInput = string | ArrayBuffer | Uint8Array | Blob;

async function toBase64(buffer: AudioInput): Promise<string | null> {
  if (typeof buffer === 'string') return buffer.replace(/^data:[^;]+;base64,/, '');
  if (buffer instanceof ArrayBuffer || buffer instanceof Uint8Array) return bufferToBase64(buffer);
  if (typeof (buffer).arrayBuffer === 'function') return bufferToBase64(await (buffer).arrayBuffer());
  return null;
}

/** Upload or attach a mic take (base64) for an existing line. */
export async function uploadVoiceTake(
  key: string,
  { buffer, mime, source = 'upload', newTake = true }: { buffer?: AudioInput; mime?: string; source?: string; newTake?: boolean } = {},
): Promise<Deck | null> {
  if (!key || !buffer) return null;
  const b64 = await toBase64(buffer);
  if (b64 == null) return null;
  ed.regenerating = key;
  renderTimeline();
  renderInspector();
  try {
    const r = await api<Deck>(`/api/video/${encodeURIComponent(slug() || '')}/voice/line/upload`, {
      method: 'POST',
      body: { key, audio: b64, mime: mime || 'audio/mpeg', source, newTake },
      signal: AbortSignal.timeout(60_000),
    });
    ed.regenerating = null;
    return applyVoiceDeck(r, key, source === 'mic' ? 'Recording saved' : 'MP3 attached');
  } catch (err) {
    ed.regenerating = null;
    toast(source === 'mic' ? 'Recording not saved' : 'Upload failed', errMessage(err), 'err');
    renderTimeline();
    renderInspector();
    return null;
  }
}

const AUDIO_ACCEPT = 'audio/mpeg,audio/mp3,audio/wav,audio/webm,audio/ogg,audio/mp4,.mp3,.wav,.webm,.ogg,.m4a';

/** Pick an audio file and attach it as a new take (or the first take on an empty line). */
export function pickVoiceFile(key: string): void {
  const clip = voiceClip(key);
  const empty = clip && !(clip.full > 0) && !(clip.dur > 0);
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = AUDIO_ACCEPT;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    await uploadVoiceTake(key, { buffer: buf, mime: file.type || 'audio/mpeg', source: 'upload', newTake: !empty });
  };
  input.click();
}

/** Upload an MP3 (etc.) as the music bed for this cut. */
export async function uploadMusicBed({ buffer, mime }: { buffer?: AudioInput; mime?: string } = {}): Promise<Deck | null> {
  if (!buffer) return null;
  const b64 = await toBase64(buffer);
  if (b64 == null) return null;
  const want = slug();
  ed.regenerating = 'music';
  renderTimeline();
  renderInspector();
  try {
    const r = await api<Deck>(`/api/video/${encodeURIComponent(want || '')}/music/upload`, {
      method: 'POST',
      body: { audio: b64, mime: mime || 'audio/mpeg' },
      signal: AbortSignal.timeout(120_000),
    });
    ed.regenerating = null;
    if (slug() !== want) return r; // sequence changed mid-upload — discard UI apply
    const before = snapshotDeck();
    ed.undo.push(before);
    ed.redo = [];
    ed.deck = r;
    ed.hear = null;
    buildSeq();
    await preview.load(previewState());
    ed.sel = { type: 'music' };
    renderTimeline();
    renderFrame();
    renderInspector();
    paintStatus();
    const dur = r?.music?.durationSec;
    flashHint(dur ? `Music attached · ${Number(dur).toFixed(0)}s` : 'Music attached');
    toast('Music attached', dur ? `${Number(dur).toFixed(0)}s bed · Mix to bake it into the master` : 'Bed ready · Mix to bake it into the master');
    return r;
  } catch (err) {
    ed.regenerating = null;
    if (slug() === want) {
      toast('Upload failed', errMessage(err), 'err');
      renderTimeline();
      renderInspector();
    }
    return null;
  }
}

export function pickMusicFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = AUDIO_ACCEPT;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    await uploadMusicBed({ buffer: buf, mime: file.type || 'audio/mpeg' });
  };
  input.click();
}

/** Start or stop a mic recording for a line. */
export async function toggleMicRecord(key: string): Promise<void> {
  if (ed.micRecord?.key === key) {
    const rec = ed.micRecord;
    ed.micRecord = null;
    renderInspector();
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        rec.recorder.onstop = () => resolve(new Blob(rec.chunks, { type: rec.mime }));
        rec.recorder.onerror = () => reject(new Error('Recording failed'));
        try {
          rec.recorder.stop();
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
        rec.stream.getTracks().forEach((t) => t.stop());
      });
      const buf = await blob.arrayBuffer();
      const clip = voiceClip(key);
      const empty = clip && !(clip.full > 0) && !(clip.dur > 0);
      await uploadVoiceTake(key, { buffer: buf, mime: rec.mime, source: 'mic', newTake: !empty });
    } catch (err) {
      toast('Recording not saved', errMessage(err), 'err');
    }
    return;
  }
  if (ed.micRecord) {
    toast('Already recording', 'Stop the current recording first.', 'warn');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Mic unavailable', 'This browser cannot record audio.', 'err');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data?.size) chunks.push(e.data);
    };
    ed.micRecord = { key, recorder, stream, chunks, mime: recorder.mimeType || mime || 'audio/webm' };
    recorder.start();
    renderInspector();
    flashHint('Recording… click Stop when done');
  } catch (err) {
    toast('Mic blocked', (err instanceof Error && err.message) || 'Allow microphone access and try again.', 'err');
  }
}
