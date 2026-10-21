/**
 * Shared mix math for the render (ffmpeg volume expression) and the Editor's live preview.
 * Plate music sits at full level; inside each live window it eases down to the bed and back.
 * Rides are extra gain regions on that curve. Fades and the voice dip are applied by the caller.
 */

export const BED_RAMP = 1;
export const RIDE_RAMP = 0.35;

export const dbToLin = (db) => 10 ** (db / 20);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Piecewise gain: `high` outside the windows, `low` inside, linear ramps of `ramp` seconds. */
function windowFactor(t, windows, low, ramp) {
  let factor = 1;
  for (const w of windows || []) {
    const a = w.start ?? w.from;
    const b = w.end ?? w.to;
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    const a2 = a + ramp;
    const b1 = Math.max(a2, b - ramp);
    let here = 1;
    if (t >= a && t < a2) here = 1 - ((t - a) / ramp) * (1 - low);
    else if (t >= a2 && t < b1) here = low;
    else if (t >= b1 && t < b) here = low + ((t - b1) / Math.max(0.001, b - b1)) * (1 - low);
    if (here !== 1) factor = here;
  }
  return factor;
}

function windowExpr(windows, low, ramp) {
  const g = Number(low).toFixed(4);
  const r = Number(ramp).toFixed(3);
  if (!windows?.length) return '1';
  let expr = '1';
  for (let i = windows.length - 1; i >= 0; i--) {
    const a = windows[i].start ?? windows[i].from;
    const b = windows[i].end ?? windows[i].to;
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    const A = a.toFixed(3);
    const A2 = (a + ramp).toFixed(3);
    const B1 = Math.max(a + ramp, b - ramp).toFixed(3);
    const B = b.toFixed(3);
    expr = `if(lt(t,${A}),${expr},if(lt(t,${A2}),1-(t-${A})*(1-${g})/${r},if(lt(t,${B1}),${g},if(lt(t,${B}),${g}+(t-${B1})*(1-${g})/${r},${expr}))))`;
  }
  return expr;
}

/**
 * Linear music gain at `t` (delivery seconds), relative to a raw music file.
 * `levels.plateLufs` / `bedLufs` move it the same way the mix's loudnorm targets do;
 * the raw file is trimmed by 12 dB so a full-level plate is listenable in preview.
 */
export function musicLinearAt(t, { music, windows, levels = {}, voiceActive = false, total = 0 } = {}) {
  if (!music || music.mute) return 0;
  const plate = levels.plateLufs ?? -20;
  const bed = levels.bedLufs ?? -31;
  let lin = dbToLin(-12 + (music.gainDb || 0) + (plate - -20));
  lin *= windowFactor(t, windows, dbToLin(bed - plate), BED_RAMP);
  for (const ride of music.rides || []) {
    if (t >= ride.from && t < ride.to) {
      lin *= windowFactor(t, [ride], dbToLin(ride.gainDb), RIDE_RAMP);
      break;
    }
  }
  const fadeIn = music.fadeIn ?? 1.2;
  const fadeOut = music.fadeOut ?? 2.6;
  const start = Math.max(0, music.offset || 0);
  if (fadeIn > 0.001) lin *= clamp((t - start) / fadeIn, 0, 1);
  if (fadeOut > 0.001 && total > fadeOut) lin *= clamp((total - t) / fadeOut, 0, 1);
  if (voiceActive) {
    const ratio = levels.duckRatio ?? levels.duck?.ratio ?? 3;
    lin *= dbToLin(-((ratio - 1) * 3));
  }
  return lin;
}

/** ffmpeg `volume=` expression: bed envelope × rides × a constant linear gain. */
export function musicVolumeExpr({ bedGain, windows, rides, gainLin = 1 }) {
  const bed = windowExpr(windows, bedGain, BED_RAMP);
  const shaped = (rides || []).filter((r) => r.to > r.from && r.gainDb);
  let rideExpr = '1';
  if (shaped.length) {
    rideExpr = shaped.reduce((expr, r) => {
      const one = windowExpr([{ start: r.from, end: r.to }], dbToLin(r.gainDb), RIDE_RAMP);
      return expr === '1' ? one : `(${expr})*(${one})`;
    }, '1');
  }
  const g = Number(gainLin).toFixed(4);
  if (bed === '1' && rideExpr === '1') return g;
  return `(${bed})*(${rideExpr})*${g}`;
}

export function voiceLinear(gainDb = 0, voiceLufs = -16) {
  return dbToLin((gainDb || 0) + (voiceLufs - -16));
}
