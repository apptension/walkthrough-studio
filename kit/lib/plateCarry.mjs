/**
 * Background continuity between plates.
 *
 * Two plates in a row that paint the same backdrop (atmosphere field, its tuning and the five
 * background colours) join as one continuous background: the outgoing plate's copy exits, the
 * field keeps moving, the next plate's copy builds over it. No dip, no restart of the field.
 *
 * How it stays exact in the render: every plate in such a run is drawn on two clocks. Its copy
 * follows the plate's own clock (trim, speed, hold, the pad before the next join), while the
 * backdrop follows the run's clock (seconds since the run's first frame). Both plates therefore
 * carry identical backdrop pixels through the overlap, and a dissolve over identical pixels only
 * changes the copy. The edit plan's timing is untouched; only what the frames contain changes.
 *
 * The page side (`installPlateCarry`) ships inside every plate's HTML, so the encoder and the
 * Studio drive the same code: `__plateCarry.set({ in, out, layer })` then `seek(contentMs, bgMs)`.
 */
import { createHash } from 'node:crypto';
import { resolveAtmosphere } from './atmosphere.mjs';

export { installPlateCarry, plateCarryRuntimeSource } from './plateCarryRuntime.mjs';

/** The transition a continuous join plays under (identical backdrops → only the copy dissolves). */
export const CARRY_STYLE = 'continue';
/** Styles a continuous join may stand in for: the soft ones. A dip or a wipe stays what it is. */
const CARRY_STANDS_IN = new Set(['directed', 'dissolve', CARRY_STYLE]);

const BACKDROP_VARS = ['--ink', '--surface', '--gold', '--amber', '--teal'];
const r3 = (n) => Math.round(Number(n) * 1000) / 1000;

/**
 * The backdrop a plate paints, from the brand it renders with (motion overlay and plate colours
 * already applied) and its style variables (which win the cascade). `key` is equal for two plates
 * exactly when their backdrop pixels are equal at the same clock.
 */
export function plateBackdrop(plateBrand, style = null) {
  const atmo = resolveAtmosphere(plateBrand);
  const c = plateBrand?.colors || {};
  const ink = c.ink || '#080a0f';
  const base = { '--ink': ink, '--surface': c.surface || ink, '--gold': c.gold, '--amber': c.amber, '--teal': c.teal || c.gold };
  const colors = {};
  for (const name of BACKDROP_VARS) {
    const own = style && typeof style === 'object' ? style[name] : null;
    colors[name] = String(own || base[name] || '').trim().toLowerCase();
  }
  const atmosphere = { id: atmo.id, opacity: r3(atmo.opacity), speed: r3(atmo.speed), drift: r3(atmo.drift) };
  const key = createHash('sha1').update(JSON.stringify({ atmosphere, colors })).digest('hex').slice(0, 12);
  return { key, atmosphere, colors };
}

/** Whether a clip carries a camera move or a magnifier — those reframe the backdrop with the copy. */
export function plateHasFx(deck, clipId) {
  if (!clipId) return false;
  return (deck?.zooms || []).some((z) => z.clip === clipId) || (deck?.lenses || []).some((l) => l.clip === clipId);
}

/**
 * Why a join can or cannot carry its background. `prev`/`next` are plan segments (or Editor
 * scenes); `backdrops` maps plate id → plateBackdrop(); `style` is the join's chosen style
 * (pinned or the video's). Returns { ok, why } — `why` reads as a sentence fragment for the UI.
 */
export function carryCheck(prev, next, { backdrops = {}, deck = null, style = 'directed' } = {}) {
  if (prev?.kind !== 'plate' || next?.kind !== 'plate') return { ok: false, why: 'only between two slides' };
  if (next.hardCut) return { ok: false, why: 'hard cut' };
  const idOf = (s) => s.plateId || s.repeatOf || s.id;
  const a = backdrops[idOf(prev)];
  const b = backdrops[idOf(next)];
  if (!a || !b) return { ok: false, why: 'background unknown' };
  if (a.key !== b.key) {
    if (a.atmosphere.id !== b.atmosphere.id) return { ok: false, why: 'different atmospheres' };
    const sameColors = BACKDROP_VARS.every((v) => a.colors[v] === b.colors[v]);
    return { ok: false, why: sameColors ? 'different atmosphere tuning' : 'different background colours' };
  }
  if (!CARRY_STANDS_IN.has(style)) return { ok: false, why: `set to ${style}` };
  const fx = (s) => plateHasFx(deck, s.repeatOf || s.plateId || s.id);
  if (fx(prev) || fx(next)) return { ok: false, why: 'a zoom or magnifier moves the background' };
  return { ok: true, why: 'same background' };
}

/**
 * Mark continuous runs on a planned sequence (each segment has `at`, `dur`, `transitionIn`).
 * A plate inside a run gets `carry: { in, out, bgAt, run }` — `bgAt` is where its frames sit on
 * the run's backdrop clock. Plates outside every run are left alone.
 */
export function markCarryRuns(segments) {
  let runAt = null;
  let run = -1;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const into = seg.transitionIn?.type === CARRY_STYLE;
    const onward = segments[i + 1]?.transitionIn?.type === CARRY_STYLE;
    if (!into) {
      runAt = seg.at;
      if (onward) run += 1;
    }
    if (into || onward) seg.carry = { in: into, out: onward, bgAt: r3(seg.at - runAt), run };
    else delete seg.carry;
  }
  return segments;
}

/**
 * Output-time frame clocks for a carried plate: `[contentMs, bgMs]` per frame. The content clock
 * replays the plate's own playback (trim, speed, hold; the pad holds its clear tail), the backdrop
 * clock runs straight through from `bgAt`.
 */
export function carryFrameClock({ dur, bgAt = 0, fps, playback = null, baseDur }) {
  const frames = Math.max(1, Math.round(dur * fps));
  const base = Number(baseDur) || dur;
  const out = new Array(frames);
  for (let f = 0; f < frames; f++) {
    const u = f / fps;
    const src = playback ? playback.toSource(Math.min(u, playback.dur)) : Math.min(u, base);
    out[f] = [Math.round(Math.min(src, base) * 1000 * 1000) / 1000, Math.round((bgAt + u) * 1000 * 1000) / 1000];
  }
  return out;
}
