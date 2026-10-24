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
import { assertPlayable, extendPictureTail } from '../media.mjs';
import { duration, finalPath, run } from '../produce.mjs';
import { snapshotVersion } from '../versions.mjs';
import { compactAudio, musicGainExpr, normalizeAudio, resolveMix, resolveVoice } from './desk.mjs';
import { musicBarSec, OUTRO_LEAD_SEC, planOutroAtSec } from './music.mjs';
import { deliveryMuxFlags, mixEndSec } from '../../studio/voiceHold.js';

const RAMP = 1.0; // seconds for the music to move between plate level and bed level
const TRIM_XFADE = 2.0; // crossfade for a music edit that shortens the track to a new take
const REPEAT_XFADE = 4.0; // longer crossfade where a passage has to play twice
const MAX_AUTO_HOLD_SEC = 6; // beyond this, a frozen tail would hide a real scripting problem
const SHORT_TOLERANCE = 0.35;

const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * How the bed is cut to the picture: bed time `anchorAt` (the outro of a composed bed, the end
 * of an upload) lands on picture time `anchorTo`. All edits share one point `cut` mid-demo, where
 * the bed sits ducked: each join plays up to `cut`, then continues from `from` with an equal-power
 * crossfade — forward for a trim, back for a repeat. Repeats keep whole bars when `barSec` is known.
 * A repeat beyond one passage needs `loop`; otherwise the tail stays silent and is reported.
 */
export function musicFit({ musicDur, total, anchorAt = musicDur, anchorTo = total, bedStart = 0, bedLen = 0, loop = false, barSec = 0 }) {
  const base = { kind: 'fit', musicSec: r3(musicDur), pictureSec: r3(total), joins: 0, cut: null, from: null, xfade: 0, repeatedSec: 0, shortfallSec: 0, warning: null };
  const finish = (f) => {
    const outLen = musicDur + f.joins * (f.cut - f.from - f.xfade);
    const shortfallSec = r3(Math.max(0, total - outLen));
    let warning = null;
    if (f.kind === 'extend') {
      warning = `⚠ music is ${(-shift).toFixed(1)}s short of the picture — ${(f.cut - f.from).toFixed(1)}s of the demo bed plays twice (${f.xfade}s equal-power crossfade at ${f.cut.toFixed(1)}s)`;
    } else if (f.kind === 'loop') {
      warning = `⚠ music looped — a ${(f.cut - f.from).toFixed(1)}s passage repeats ${f.joins}× to cover ${(-shift).toFixed(1)}s (${f.xfade}s equal-power crossfades at ${f.cut.toFixed(1)}s)`;
    } else if (shortfallSec > SHORT_TOLERANCE) {
      warning = `⚠ music ends ${shortfallSec.toFixed(1)}s before the picture — the tail is silent`;
    }
    return { ...f, cut: f.cut == null ? null : r3(f.cut), from: f.from == null ? null : r3(f.from), shortfallSec, warning };
  };
  const shift = anchorAt - anchorTo;
  if (!(musicDur >= 0.05)) return finish({ ...base, kind: 'short' });
  const hi = Math.max(1, Math.min(anchorAt, anchorTo) - 2);
  const cut = Math.min(hi, Math.max(1, bedStart + bedLen * 0.45));
  const floor = bedStart < cut - REPEAT_XFADE - 1 ? bedStart : cut * 0.4;
  // Snap toward covering: trims skip whole bars rounded down, repeats replay whole bars rounded up.
  const bars = (j, round) => (barSec > 0.5 ? round(j / barSec) * barSec : j);

  if (shift >= TRIM_XFADE + 0.05) {
    let skip = bars(shift - TRIM_XFADE, Math.floor);
    if (skip < 0.05) skip = shift - TRIM_XFADE;
    const from = Math.min(musicDur - 1, cut + skip);
    return finish({ ...base, kind: 'trim', cut, from, joins: 1, xfade: TRIM_XFADE });
  }
  if (shift >= -0.05) return finish(base);

  const extra = -shift;
  const maxJump = cut - floor;
  if (maxJump < REPEAT_XFADE + 1) return finish({ ...base, kind: 'short' });
  const joins = Math.ceil(extra / (maxJump - REPEAT_XFADE));
  if (joins > 1 && !loop) return finish({ ...base, kind: 'short' });
  const need = REPEAT_XFADE + extra / joins;
  let jump = bars(need, Math.ceil);
  if (jump > maxJump) jump = need;
  return finish({ ...base, kind: joins > 1 ? 'loop' : 'extend', cut, from: cut - jump, joins, xfade: REPEAT_XFADE, repeatedSec: r3(joins * jump) });
}

/** ffmpeg filters for a `musicFit` edit: [0, cut) · (joins−1) × [from, cut) · [from, end), crossfaded → `[label]`. */
export function musicEditFilters(fit, { input, fmt, label = 'medit' }) {
  if (!fit.joins) return [];
  const n = fit.joins;
  const cut = fit.cut.toFixed(3);
  const from = fit.from.toFixed(3);
  const filters = [`${input}${fmt},asplit=${n + 1}${Array.from({ length: n + 1 }, (_, i) => `[mp${i}]`).join('')}`];
  for (let i = 0; i <= n; i++) {
    const trim = i === 0 ? `atrim=0:${cut}` : i < n ? `atrim=${from}:${cut}` : `atrim=start=${from}`;
    filters.push(`[mp${i}]${trim},asetpts=PTS-STARTPTS[mq${i}]`);
  }
  let prev = '[mq0]';
  for (let i = 1; i <= n; i++) {
    const out = i === n ? `[${label}]` : `[mx${i}]`;
    filters.push(`${prev}[mq${i}]acrossfade=d=${fit.xfade}:c1=qsin:c2=qsin${out}`);
    prev = out;
  }
  return filters;
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
  // The video stream is copied, so a broken picture would pass straight through.
  let total = assertPlayable(source, { label: 'delivery master' });
  const plannedTotal = total;
  const duckWindows = liveWindowsFromMeta(produceMeta, video);

  const voicePath = join(video.out, 'voice', 'voice.json');
  const voice = existsSync(voicePath) ? JSON.parse(readFileSync(voicePath, 'utf8')) : null;
  const clips = resolveVoice(voice?.clips || [], desk.voice).filter((c) => existsSync(c.file));

  // Real narration can run past the hold `extendCloseForVoice` estimated at plan time — a
  // word-count heuristic, not the actual ElevenLabs read. Catch the picture up to it here
  // rather than let the mux choose between cutting the last word or leaving the container
  // longer than its last video frame (both break playback). A drift this large past the
  // plan is a scripting problem, not timing noise, so it still fails loudly instead of
  // silently freezing the master for several seconds.
  if (clips.length) {
    const voiceEnd = mixEndSec(total, clips);
    const overrun = voiceEnd - total;
    if (overrun > MAX_AUTO_HOLD_SEC) {
      throw new Error(
        `narration runs ${overrun.toFixed(1)}s past the picture — too long to freeze automatically. ` +
          'Shorten the line(s) noted "long by" in the voice warnings, or re-run produce so the hold matches the read.'
      );
    }
    if (overrun > 0.05) {
      const pad = overrun + 0.15;
      console.log(`· narration runs ${overrun.toFixed(1)}s past the picture — freezing the last frame to cover it`);
      extendPictureTail(source, pad, { label: 'delivery master' });
      total = assertPlayable(source, { label: 'delivery master (extended)' });
    }
  }

  const musicMp3 = join(video.out, 'music', 'music.mp3');
  const hasMusic = existsSync(musicMp3);
  if (!clips.length && !(hasMusic && !desk.music.mute)) throw new Error('Nothing to mix: run voice and/or music first');

  const inputs = [];
  const filters = [];
  const warnings = [];
  let musicFitResult = null;
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
    const planPath = join(video.out, 'music', 'plan.json');
    const composedPlan = existsSync(planPath) ? JSON.parse(readFileSync(planPath, 'utf8')) : null;
    const composed = composedPlan?.segments;
    const bedStart = (composed?.openSec || segments.openSec || 6) + (composed?.interstitialSec || segments.interstitialSec || 0);
    const bedLen = Math.max(8, composed?.liveSec || segments.liveSec || 60);
    // A composed bed keeps its outro on the close plate; an upload keeps its ending on the last frame.
    const closeNow = Number(segments.closeSec);
    const anchored = composedPlan?.plan?.chunks?.length > 1 && Number.isFinite(closeNow);
    const fit = musicFit({
      musicDur,
      total,
      anchorAt: anchored ? (composedPlan.outroAtSec ?? planOutroAtSec(composedPlan.plan)) : musicDur,
      anchorTo: anchored ? total - (closeNow + (total - plannedTotal)) - OUTRO_LEAD_SEC : total,
      bedStart,
      bedLen,
      loop: desk.music.loop,
      barSec: musicBarSec(video.audio.music || {}),
    });
    musicFitResult = fit;
    const edit = musicEditFilters(fit, { input: `[${idx}:a]`, fmt });
    if (edit.length) {
      filters.push(...edit);
      src = '[medit]';
    }
    if (fit.kind === 'trim') console.log(`· music trimmed ${(fit.from - fit.cut - fit.xfade).toFixed(2)}s at ${fit.cut.toFixed(1)}s to fit delivery (${total.toFixed(1)}s)`);
    if (fit.warning) {
      const hint = fit.kind === 'short' && !desk.music.loop ? ' — Loop to fill in the Editor, or' : ' —';
      warnings.push(`${fit.warning}${hint} Compose to fit: node cli.mjs music ${video.slug} --force`);
      console.log(warnings.at(-1));
    }
    // A bed that runs out early still ends on a fade, never a hard stop.
    const bedEnd = fit.musicSec + fit.joins * ((fit.cut ?? 0) - (fit.from ?? 0) - fit.xfade);
    const earlyFade = fit.shortfallSec > SHORT_TOLERANCE && bedEnd > 3 ? `afade=t=out:st=${(bedEnd - 2.5).toFixed(3)}:d=2.5,` : '';
    const slipped = slip > 0.02 ? `adelay=${Math.round(slip * 1000)}|${Math.round(slip * 1000)},` : slip < -0.02 ? `atrim=start=${(-slip).toFixed(3)},asetpts=PTS-STARTPTS,` : '';
    const fadeInAt = Math.max(0, slip);
    filters.push(
      `${src}${earlyFade}${slipped}atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,apad,atrim=0:${total.toFixed(3)},` +
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
  assertPlayable(tmp, { expectedSec: total, label: 'mixed master' });
  renameSync(tmp, FINAL);
  unlinkSync(premaster);

  const result = {
    final: FINAL,
    silent: SILENT,
    voiceClips: clips.length,
    music: Boolean(musicLabel),
    musicFit: musicFitResult,
    warnings,
    mode: voice?.mode || null,
    loudness: { input: measured, target: { lufs: mix.targetLufs, truePeakDb: mix.truePeakDb } },
    levels: { voiceLufs: mix.voiceLufs, plateLufs: mix.plateLufs, bedLufs: mix.bedLufs, duck: mix.duck },
    desk: compactAudio(desk) || null,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(join(video.out, 'audio-meta.json'), JSON.stringify(result, null, 2));
  const fitNote = { extend: ' · ⚠ music repeats a passage', loop: ' · ⚠ music looped', short: ' · ⚠ music short' }[musicFitResult?.kind] || (musicFitResult?.warning ? ' · ⚠ music short' : '');
  console.log(`» mix · Mixed · ${clips.length} narration lines${hasMusic ? ' · music bed' : ''}${fitNote}`);
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
