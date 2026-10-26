/**
 * Camera moves and magnifiers on a plate.
 *
 * A recording gets these in `prepareLive`, where every mark sits on the recording clock and in
 * capture pixels. A plate has neither: it is a page rendered straight to the output frame, and
 * each one is its own file. So a plate's marks carry `clip` (the segment they belong to), a time
 * in that plate's *own* clock, and a position as a fraction of the frame.
 *
 * Working in the plate's source clock is what makes retiming compose: the zoom and the glass are
 * stitched on before `plateTimingFilter`, so a trimmed plate loses its tail move, a held plate
 * holds the move too, and a 1.5× plate plays it 1.5× — no second set of rules.
 */

import { planZooms, zoomGraph, zoomTiming } from './camera.mjs';
import { lensGeometry, lensPlaceChain, lensTiming } from './lens.mjs';
import { prepareLensBakes } from './lensBake.mjs';
import { BT709_PARAMS } from './encode.mjs';
import { FPS } from './motion.mjs';

/** Deck marks for one clip, as timeline marks in output pixels. */
export function plateMarks(deck, clipId, { width, height }) {
  const px = (n, span) => Math.round((Number(n) || 0) * span);
  const zooms = (deck?.zooms || [])
    .filter((z) => z.clip === clipId)
    .map((z) => ({ kind: 'zoom', id: z.id, t: z.t, dur: z.dur, zoom: z.zoom, x: px(z.nx, width), y: px(z.ny, height), source: 'edit' }));
  const lenses = (deck?.lenses || [])
    .filter((l) => l.clip === clipId)
    .map((l) => {
      const w = Math.max(16, px(l.nw, width));
      const h = Math.max(12, px(l.nh, height));
      return {
        kind: 'magnify',
        id: l.id,
        label: l.label || 'Magnifier',
        t: l.t,
        dur: l.dur,
        rect: { x: Math.round(px(l.nx, width) - w / 2), y: Math.round(px(l.ny, height) - h / 2), w, h },
        ...(l.zoom ? { zoom: l.zoom } : {}),
        source: 'edit',
      };
    });
  return { zooms, lenses };
}

/** True when any plate segment in the cut carries a camera move or a magnifier. */
export function hasPlateFx(deck, segments) {
  const clips = new Set([...(deck?.zooms || []), ...(deck?.lenses || [])].map((m) => m.clip).filter(Boolean));
  if (!clips.size) return false;
  return (segments || []).some((s) => s.kind === 'plate' && clips.has(s.repeatOf || s.id));
}

/**
 * Bake the glass for every magnifier on every plate, then hand back a per-segment chain builder.
 *
 * Returns `{ inputs, plan }`: `inputs` are extra ffmpeg `-i` pairs to append after the existing
 * ones, and `plan.get(segmentIndex)` yields `{ lines(src, out, inputAt) }` for that segment.
 */
export async function preparePlateFx(video, segments, deck, { width, height, camera, rimHex, force = false } = {}) {
  const inputs = [];
  const plan = new Map();
  const zTiming = zoomTiming(camera || {});
  const lTiming = lensTiming(camera || {});
  // A plate reused as a replay shares its source file, and so its marks: key off the original.
  for (const [i, seg] of (segments || []).entries()) {
    if (seg.kind !== 'plate' || !seg.file) continue;
    const clipId = seg.repeatOf || seg.id;
    const marks = plateMarks(deck, clipId, { width, height });
    if (!marks.zooms.length && !marks.lenses.length) continue;
    const dur = Number(seg.timing?.baseDur) || Number(seg.naturalDur) || Number(seg.dur) || 0;
    const frames = Math.max(1, Math.round(dur * FPS));

    const shots = planZooms([...marks.zooms].sort((a, b) => a.t - b.t), {
      width,
      height,
      // Plate moves are always hand-placed, so they run whatever the recording's auto level is.
      level: 'on',
      duration: dur,
      timing: zTiming,
    }).shots;

    const bake = await prepareLensBakes(
      video,
      seg.file,
      marks.lenses.map((m) => ({ mark: m, geo: lensGeometry(m, { width, height }) })),
      { rimHex, timing: lTiming, force, scope: clipId }
    );
    const first = inputs.length / 2;
    for (const file of bake.files) inputs.push('-i', file);

    plan.set(i, {
      lines(src, out, inputAt) {
        const lines = [];
        let cur = src;
        const zoom = zoomGraph(shots, { src: cur, out: `[pz${i}]`, width, height, fps: FPS, totalFrames: frames, timing: zTiming });
        if (zoom) {
          lines.push(...zoom.lines, `[pz${i}]format=yuv420p,${BT709_PARAMS}[pzc${i}]`);
          cur = `[pzc${i}]`;
        }
        marks.lenses.forEach((m, k) => {
          const geo = lensGeometry(m, { width, height });
          const idx = inputAt + first + k;
          lines.push(`[${idx}:v]format=rgba,${lensPlaceChain(m)}[plens${i}_${k}]`);
          lines.push(
            `${cur}[plens${i}_${k}]overlay=x='${geo.ox}':y='${geo.oy}':eval=frame:eof_action=pass:format=auto,` +
              `format=yuv420p,${BT709_PARAMS}[pl${i}_${k}]`
          );
          cur = `[pl${i}_${k}]`;
        });
        if (cur === src) return { lines: [], out: src };
        lines.push(`${cur}null${out}`);
        return { lines, out };
      },
    });
  }
  return { inputs, plan };
}
