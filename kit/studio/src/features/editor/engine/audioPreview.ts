import { requestArrayBuffer } from '@/api/client';
import { musicLinearAt, voiceLinear, type MixLevels } from '@/logic/mixMath';

import type { AudioDesk, DeckAudio, VoiceClip } from './types';

/**
 * Live mix preview — port of `kit/studio/audioPreview.js`. Plays the composed music bed and the
 * fitted narration clips in time with the Editor clock, using the same bed curve, rides and voice
 * dip as the render (mixMath). The screencast stays muted — this is the only sound in the Editor.
 */

/** What `previewState()` hands the preview: the deck's audio with the desk being heard. */
export interface PreviewAudio extends DeckAudio {
  desk: AudioDesk;
  voiceClips: VoiceClip[];
  total: number;
}

export interface AudioPreview {
  load(audio: PreviewAudio | null): Promise<void>;
  play(audio: PreviewAudio | null, t: number): void;
  pause(): void;
  audition(audio: PreviewAudio | null, t: number): void;
  sync(audio: PreviewAudio | null, t: number, playing: boolean): void;
  setEnabled(on: boolean): void;
  forget(key: string): void;
  readonly enabled: boolean;
}

type UrlBuffer = AudioBuffer & { url?: string };

export function createAudioPreview(): AudioPreview {
  const AC: typeof AudioContext | null =
    typeof window !== 'undefined'
      ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext || null
      : null;
  let ctx: AudioContext | null = null;
  let musicGain: GainNode | null = null;
  let master: GainNode | null = null;
  let token = 0;
  let musicBuffer: AudioBuffer | null = null;
  let musicUrl = '';
  const voiceBuffers = new Map<string, UrlBuffer>();
  let musicSource: AudioBufferSourceNode | null = null;
  let voiceSources: AudioBufferSourceNode[] = [];
  let enabled = true;
  let anchor: { ctxTime: number; edTime: number } | null = null;

  function context(): AudioContext | null {
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      musicGain = ctx.createGain();
      musicGain.connect(master);
      master.connect(ctx.destination);
    }
    return ctx;
  }

  async function decode(url: string): Promise<AudioBuffer | null> {
    const c = context();
    if (!c || !url) return null;
    const buf = await requestArrayBuffer(url);
    if (!buf) return null;
    return c.decodeAudioData(buf);
  }

  /** Load (or keep) the buffers for the current deck. Safe to call on every refresh. */
  async function load(audio: PreviewAudio | null): Promise<void> {
    const mine = ++token;
    const c = context();
    if (!c || !audio) return;
    const nextMusic = audio.music?.url || '';
    if (nextMusic !== musicUrl) {
      musicUrl = nextMusic;
      musicBuffer = null;
      if (nextMusic) {
        try {
          const buf = await decode(nextMusic);
          if (mine === token) musicBuffer = buf;
        } catch {
          /* a clip that will not decode just stays silent */
        }
      }
    }
    const wanted = new Set<string>();
    await Promise.all(
      (audio.voiceClips || []).map(async (clip) => {
        wanted.add(clip.key);
        if (!clip.url) return;
        const have = voiceBuffers.get(clip.key);
        if (have && have.url === clip.url) return;
        try {
          const buf: UrlBuffer | null = await decode(clip.url);
          if (mine === token && buf) {
            buf.url = clip.url;
            voiceBuffers.set(clip.key, buf);
          }
        } catch {
          /* skip */
        }
      }),
    );
    if (mine === token) for (const key of [...voiceBuffers.keys()]) if (!wanted.has(key)) voiceBuffers.delete(key);
  }

  function stopSources(): void {
    for (const src of [musicSource, ...voiceSources]) {
      try {
        src?.stop();
      } catch {
        /* already ended */
      }
    }
    musicSource = null;
    voiceSources = [];
    anchor = null;
  }

  function levelOf(audio: PreviewAudio): MixLevels {
    const levels: MixLevels = { ...(audio.levels || {}) };
    const ratio = audio.desk?.master?.['duckRatio'];
    if (ratio != null) levels.duckRatio = Number(ratio);
    return levels;
  }

  function voiceOn(audio: PreviewAudio, t: number): boolean {
    return (audio.voiceClips || []).some((c) => !c.mute && t >= c.start && t < c.start + c.dur);
  }

  /** Buffers are keyed by line; a regenerated line arrives under a new url, so drop the old one. */
  function forget(key: string): void {
    voiceBuffers.delete(key);
  }

  function apply(audio: PreviewAudio | null, t: number): void {
    const c = context();
    if (!c || !musicGain || !audio) return;
    const music = audio.desk?.music;
    const lin = musicLinearAt(t, {
      music,
      windows: audio.windows ?? null,
      levels: levelOf(audio),
      voiceActive: voiceOn(audio, t),
      total: audio.total || 0,
    });
    musicGain.gain.setTargetAtTime(lin, c.currentTime, 0.04);
  }

  function play(audio: PreviewAudio | null, t: number): void {
    const c = context();
    if (!enabled || !c || !audio) return;
    if (c.state === 'suspended') void c.resume();
    stopSources();
    const when = c.currentTime + 0.03;
    const music = audio.desk?.music;
    if (musicBuffer && !music?.mute && musicGain) {
      const fileTime = t - (music?.offset || 0);
      const src = c.createBufferSource();
      src.buffer = musicBuffer;
      src.connect(musicGain);
      if (music?.loop && musicBuffer.duration > 0.05) {
        src.loop = true;
        if (fileTime >= 0) src.start(when, fileTime % musicBuffer.duration);
        else if (-fileTime < 30) src.start(when + -fileTime, 0);
      } else if (fileTime >= 0 && fileTime < musicBuffer.duration - 0.05) {
        src.start(when, fileTime);
      } else if (fileTime < 0 && -fileTime < 30) {
        src.start(when + -fileTime, 0);
      }
      musicSource = src;
    }
    const voiceLufs = audio.levels?.voiceLufs ?? -16;
    for (const clip of audio.voiceClips || []) {
      if (clip.mute) continue;
      const buf = voiceBuffers.get(clip.key);
      if (!buf || !master) continue;
      // The desk's shape: skip the trimmed head, stop before the trimmed tail, fade the rest.
      const head = clip.trimStart || 0;
      const plays = Math.max(0, Math.min(clip.dur ?? buf.duration, buf.duration - head - (clip.trimEnd || 0)));
      const rel = clip.start - t;
      if (rel >= plays || plays <= 0.02) continue;
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      const level = voiceLinear(clip.gainDb, voiceLufs);
      src.connect(g);
      g.connect(master);
      const into = rel >= -0.02 ? 0 : -rel; // how far into the (trimmed) line the clock already is
      if (into >= plays - 0.05) continue;
      const at = when + Math.max(0, rel);
      src.start(at, head + into, plays - into);
      const fadeIn = clip.fadeIn || 0;
      const fadeOut = clip.fadeOut || 0;
      g.gain.setValueAtTime(fadeIn > into ? (level * into) / fadeIn : level, at);
      if (fadeIn > into) g.gain.linearRampToValueAtTime(level, at + (fadeIn - into));
      if (fadeOut > 0.005) {
        const outAt = at + Math.max(0, plays - into - fadeOut);
        g.gain.setValueAtTime(level, Math.max(at, outAt));
        g.gain.linearRampToValueAtTime(0.0001, at + (plays - into));
      }
      voiceSources.push(src);
    }
    anchor = { ctxTime: when, edTime: t };
    apply(audio, t);
  }

  function pause(): void {
    stopSources();
  }

  /** Keep a running preview on the new levels; start one if the listener is adjusting a slider. */
  function audition(audio: PreviewAudio | null, t: number): void {
    if (!enabled || !audio) return;
    if (!anchor) play(audio, t);
    else apply(audio, t);
  }

  /** Re-place the mix when the clock has drifted, and keep the music gain on the curve. */
  function sync(audio: PreviewAudio | null, t: number, playing: boolean): void {
    if (!enabled || !playing || !audio) return;
    const c = context();
    if (!c || !anchor) return play(audio, t);
    const expected = anchor.edTime + (c.currentTime - anchor.ctxTime);
    if (Math.abs(expected - t) > 0.18) return play(audio, t);
    apply(audio, t);
  }

  function setEnabled(on: boolean): void {
    enabled = Boolean(on);
    if (!enabled) pause();
  }

  return {
    load,
    play,
    pause,
    audition,
    sync,
    setEnabled,
    forget,
    get enabled() {
      return enabled;
    },
  };
}
