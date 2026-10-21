/**
 * The mix: narration clips placed on the timeline, the music bed ducked under them, two-pass
 * loudness normalisation to the web target, muxed onto the delivery master (video stream copied).
 *
 *   voice (normalised per clip) ──┬─ sidechain key ─┐
 *                                 └────────────────── amix ── loudnorm (2-pass) ── AAC
 *   music (plate level, dips to bed level under the demo) ─ duck ─┘
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertVideoCopied } from '../encode.mjs';
import { duration, finalPath, run } from '../produce.mjs';
import { snapshotVersion } from '../versions.mjs';
import { compactAudio, musicGainExpr, normalizeAudio, resolveMix, resolveVoice } from './desk.mjs';
import { deliveryMuxFlags, mixEndSec } from '../../studio/voiceHold.js';

const RAMP = 1.0; // seconds for the music to move between plate level and bed level
const EDIT_XFADE = 2.0; // crossfade for a music edit that fits the track to a new take

/** How many extra plays of a bed are needed to cover `totalSec` (0 when the bed is long enough). */
export function musicLoopRepeats(musicDurSec, totalSec) {
  const dur = Number(musicDurSec) || 0;
  const total = Math.max(0, Number(totalSec) || 0);
  if (dur < 0.05 || total <= dur + 0.35) return 0;
  return Math.max(1, Math.ceil(total / dur) - 1);
}

function parseLoudnormJson(text) {
  const start = text.lastIndexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('loudnorm printed no measurement');
  return JSON.parse(text.slice(start, end + 1));
}

// loudnorm prints its measurement to stderr; `run` keeps only stdout.
function runBoth(args) {
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr || '').slice(-1500)}`);
  return `${r.stdout}\n${r.stderr}`;
}

/** Two-pass loudnorm with a linear gain (dynamics preserved) → WAV at `sampleRate`. */
export function normalizeTo(inFile, outFile, { lufs, tp = -1, lra = 11, sampleRate = 48000 }) {
  const m = parseLoudnormJson(runBoth(['-hide_banner', '-nostats', '-i', inFile, '-af', `loudnorm=I=${lufs}:TP=${tp}:LRA=${lra}:print_format=json`, '-f', 'null', '-']));
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', inFile];
  if (parseFloat(m.input_i) < -60) {
    // Near-silent input: do not amplify the noise floor
    args.push('-af', `aresample=${sampleRate}`);
  } else {
    args.push(
      '-af',
      `loudnorm=I=${lufs}:TP=${tp}:LRA=${lra}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=${sampleRate}`
    );
  }
  args.push('-ar', String(sampleRate), outFile);
  runBoth(args);
  return m;
}

const db2lin = (db) => 10 ** (db / 20);

/** volume= expression: plate level by default, bed level inside each live window, with linear ramps. */
function bedEnvelope(gain, windows) {
  const g = gain.toFixed(4);
  if (!windows.length) return '1';
  // Nested if: for each window [a,b], ramp down at a, hold g, ramp up at b.
  let expr = '1';
  for (let i = windows.length - 1; i >= 0; i--) {
    const { start: a, end: b } = windows[i];
    const A = a.toFixed(3);
    const A2 = (a + RAMP).toFixed(3);
    const B1 = Math.max(a + RAMP, b - RAMP).toFixed(3);
    const B = b.toFixed(3);
    expr = `if(lt(t,${A}),${expr},if(lt(t,${A2}),1-(t-${A})*(1-${g})/${RAMP},if(lt(t,${B1}),${g},if(lt(t,${B}),${g}+(t-${B1})*(1-${g})/${RAMP},${expr}))))`;
  }
  return expr;
}

function liveWindowsFromMeta(meta, video) {
  const editPath = join(video.out, 'edit-plan.json');
  if (existsSync(editPath)) {
    const edit = JSON.parse(readFileSync(editPath, 'utf8'));
    const windows = [];
    let t = 0;
    for (const seg of edit.segments || []) {
      const start = seg.at ?? t;
      if (seg.kind === 'live') windows.push({ start, end: start + seg.dur });
      t = start + seg.dur;
    }
    if (windows.length) return windows;
  }
  const liveStart = meta.segments.openSec;
  const liveEnd = meta.segments.openSec + meta.segments.liveSec;
  return [{ start: liveStart, end: liveEnd }];
}

export function mixAudio(video, { out } = {}) {
  const desk = normalizeAudio(video.config?.edit?.audio || {});
  const mix = resolveMix(video.audio.mix, desk);
  const FINAL = out || finalPath(video);
  const SILENT = FINAL.replace(/\.mp4$/, '.silent.mp4');
  const source = existsSync(SILENT) ? SILENT : FINAL;
  if (!existsSync(source)) throw new Error(`Produce first: node cli.mjs produce ${video.slug}`);
  const metaPath = join(video.out, 'produce-meta.json');
  if (!existsSync(metaPath)) throw new Error('produce-meta.json missing — run produce');
  const produceMeta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const { segments } = produceMeta;
  const total = duration(source);
  const duckWindows = liveWindowsFromMeta(produceMeta, video);

  const voicePath = join(video.out, 'voice', 'voice.json');
  const voice = existsSync(voicePath) ? JSON.parse(readFileSync(voicePath, 'utf8')) : null;
  const clips = resolveVoice(voice?.clips || [], desk.voice).filter((c) => existsSync(c.file));
  const musicMp3 = join(video.out, 'music', 'music.mp3');
  const hasMusic = existsSync(musicMp3);
  if (!clips.length && !(hasMusic && !desk.music.mute)) throw new Error('Nothing to mix: run voice and/or music first');

  const inputs = [];
  const filters = [];
  const sr = mix.sampleRate || 48000;
  const fmt = `aresample=${sr},aformat=sample_fmts=fltp:sample_rates=${sr}:channel_layouts=stereo`;

  // Narration
  let voiceLabel = null;
  if (clips.length) {
    const labels = clips.map((clip, i) => {
      inputs.push('-i', clip.file);
      const ms = Math.round(Math.max(0, clip.start) * 1000);
      // Desk shape: cut the head and tail, then fade what remains.
      const cut =
        clip.trimStart || clip.trimEnd
          ? `atrim=start=${(clip.trimStart || 0).toFixed(3)}:end=${((clip.full ?? clip.duration + (clip.trimStart || 0)) - (clip.trimEnd || 0)).toFixed(3)},asetpts=PTS-STARTPTS,`
          : '';
      const fadeIn = clip.fadeIn > 0.005 ? `afade=t=in:st=0:d=${clip.fadeIn.toFixed(3)},` : '';
      const fadeOut = clip.fadeOut > 0.005 ? `afade=t=out:st=${Math.max(0, clip.duration - clip.fadeOut).toFixed(3)}:d=${clip.fadeOut.toFixed(3)},` : '';
      const trim = clip.start < 0 ? `atrim=start=${(-clip.start).toFixed(3)},asetpts=PTS-STARTPTS,` : '';
      const vol = clip.gainDb ? `volume=${db2lin(clip.gainDb).toFixed(4)},` : '';
      filters.push(`[${inputs.length / 2 - 1}:a]${fmt},${cut}${fadeIn}${fadeOut}${trim}${vol}highpass=f=70,adelay=${ms}|${ms}[v${i}]`);
      return `[v${i}]`;
    });
    const voiceEnd = mixEndSec(total, clips);
    filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,apad,atrim=0:${voiceEnd.toFixed(3)}[vo]`);
    voiceLabel = '[vo]';
  }

  // Music: normalise to plate level once, then shape
  let musicLabel = null;
  if (hasMusic && !desk.music.mute) {
    const musicWav = musicMp3.replace(/\.mp3$/, `.norm${mix.plateLufs}.wav`);
    if (!existsSync(musicWav) || statSync(musicWav).mtimeMs < statSync(musicMp3).mtimeMs) {
      normalizeTo(musicMp3, musicWav, { lufs: mix.plateLufs, tp: -3, sampleRate: sr });
    }
    inputs.push('-i', musicWav);
    const gain = db2lin(mix.bedLufs - mix.plateLufs);
    const fadeIn = desk.music.fadeIn;
    const fadeOutAt = Math.max(0, total - desk.music.fadeOut);
    const idx = inputs.length / 2 - 1;
    const slip = desk.music.offset || 0;
    let src = `[${idx}:a]${fmt},`;
    // Fit bed to delivery duration (open + live + interstitials + close). Never compare open+live alone —
    // that used to chop interstitial length off the bed and leave the outro silent.
    const musicDur = duration(musicWav);
    const shortfall = total - musicDur;
    if (shortfall > 0.35 && desk.music.loop) {
      const repeats = musicLoopRepeats(musicDur, total);
      const size = Math.max(1, Math.round(musicDur * sr));
      filters.push(
        `[${idx}:a]${fmt},aloop=loop=${repeats}:size=${size},atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS[mloop]`
      );
      src = '[mloop]';
      console.log(`· music looped ×${repeats + 1} to cover the delivery (${musicDur.toFixed(1)}s → ${total.toFixed(1)}s)`);
    } else if (shortfall > 0.35) {
      console.log(
        `⚠ music is ${shortfall.toFixed(1)}s short of the delivery (${musicDur.toFixed(1)}s vs ${total.toFixed(1)}s) — in the Editor: Loop to fill, or Compose to fit (node cli.mjs music ${video.slug} --force)`
      );
    } else if (shortfall < -0.05) {
      // Track longer than the video: skip the excess mid-bed so intro/outro stay locked to plates.
      const planPath = join(video.out, 'music', 'plan.json');
      const composed = existsSync(planPath) ? JSON.parse(readFileSync(planPath, 'utf8')).segments : null;
      const bedStart = (composed?.openSec || segments.openSec || 6) + (composed?.interstitialSec || segments.interstitialSec || 0);
      const bedLen = Math.max(8, composed?.liveSec || segments.liveSec || 60);
      const cut = bedStart + bedLen * 0.45;
      const skip = -shortfall;
      const s2 = cut + skip;
      filters.push(
        `[${idx}:a]${fmt},asplit=2[me1][me2]`,
        `[me1]atrim=0:${cut.toFixed(3)},asetpts=PTS-STARTPTS[mc1]`,
        `[me2]atrim=start=${s2.toFixed(3)},asetpts=PTS-STARTPTS[mc2]`,
        `[mc1][mc2]acrossfade=d=${EDIT_XFADE}:c1=qsin:c2=qsin[medit]`
      );
      src = '[medit]';
      console.log(`· music trimmed ${skip.toFixed(2)}s at ${cut.toFixed(1)}s to fit delivery (${total.toFixed(1)}s)`);
    }
    const slipped = slip > 0.02 ? `adelay=${Math.round(slip * 1000)}|${Math.round(slip * 1000)},` : slip < -0.02 ? `atrim=start=${(-slip).toFixed(3)},asetpts=PTS-STARTPTS,` : '';
    const fadeInAt = Math.max(0, slip);
    filters.push(
      `${src}${slipped}atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,apad,atrim=0:${total.toFixed(3)},` +
        (fadeIn > 0.02 ? `afade=t=in:st=${fadeInAt.toFixed(3)}:d=${fadeIn.toFixed(3)},` : '') +
        (desk.music.fadeOut > 0.02 ? `afade=t=out:st=${fadeOutAt.toFixed(3)}:d=${desk.music.fadeOut.toFixed(3)},` : '') +
        `volume='${musicGainExpr({ bedGain: gain, windows: duckWindows, rides: desk.music.rides, gainDb: desk.music.gainDb })}':eval=frame[mus]`
    );
    musicLabel = '[mus]';
  }

  let outLabel;
  if (voiceLabel && musicLabel) {
    const d = mix.duck || {};
    filters.push(`${voiceLabel}asplit=2[vo1][key]`);
    filters.push(
      `${musicLabel}[key]sidechaincompress=threshold=${d.threshold ?? 0.02}:ratio=${d.ratio ?? 3}:attack=${d.attackMs ?? 20}:release=${d.releaseMs ?? 350}:detection=rms:link=maximum[duck]`
    );
    filters.push(`[vo1][duck]amix=inputs=2:duration=longest:normalize=0[mix]`);
    outLabel = '[mix]';
  } else {
    outLabel = voiceLabel || musicLabel;
  }

  const premaster = join(video.out, 'audio-premaster.wav');
  console.log(`» mix · Levelling to ${mix.targetLufs} LUFS`);
  runBoth(['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filters.join(';'), '-map', outLabel, '-ar', String(sr), premaster]);

  const master = join(video.out, 'audio-master.wav');
  const measured = normalizeTo(premaster, master, { lufs: mix.targetLufs, tp: mix.truePeakDb, sampleRate: sr });

  if (source === FINAL) renameSync(FINAL, SILENT);
  const tmp = FINAL.replace(/\.mp4$/, '.mixing.mp4');
  const muxArgs = [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', SILENT, '-i', master,
    '-map', '0:v', '-map', '1:a', '-map_metadata', '0', '-map_chapters', '0',
    ...deliveryMuxFlags({ bitrate: mix.bitrate || '192k', sampleRate: sr }),
    tmp,
  ];
  assertVideoCopied(muxArgs);
  run('ffmpeg', muxArgs, 'mux audio onto the delivery master (video copied)');
  renameSync(tmp, FINAL);
  unlinkSync(premaster);

  const result = {
    final: FINAL,
    silent: SILENT,
    voiceClips: clips.length,
    music: Boolean(musicLabel),
    mode: voice?.mode || null,
    loudness: { input: measured, target: { lufs: mix.targetLufs, truePeakDb: mix.truePeakDb } },
    levels: { voiceLufs: mix.voiceLufs, plateLufs: mix.plateLufs, bedLufs: mix.bedLufs, duck: mix.duck },
    desk: compactAudio(desk) || null,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(join(video.out, 'audio-meta.json'), JSON.stringify(result, null, 2));
  console.log(`» mix · Mixed · ${clips.length} narration lines${hasMusic ? ' · music bed' : ''}`);
  console.log(`✓ ${FINAL}\n  ${clips.length} narration clip(s)${hasMusic ? ' + music bed' : ''} · master ${mix.targetLufs} LUFS / ${mix.truePeakDb} dBTP (pre-master measured ${parseFloat(measured.input_i).toFixed(1)} LUFS)`);
  if (!out) {
    try {
      snapshotVersion(video, {
        trigger: 'audio',
        kind: 'checkpoint',
        title: 'Audio mix',
        note: 'auto after mix',
      });
    } catch (err) {
      console.log(`· version snapshot skipped: ${err.message}`);
    }
  }
  return result;
}
