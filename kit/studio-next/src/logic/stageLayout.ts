/**
 * Where the take sits in the delivered frame, as the editor stage draws it. Mirrors
 * `stageFor` / `prepareLive` in kit/lib: the stage rect is in output px, and live cards ride on
 * the take only when the stage has the output's shape (otherwise they cover the whole output).
 */

export interface StageRect {
  mode: string;
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
}

export interface OutputSize {
  width: number;
  height: number;
}

export interface StageLayout {
  /** Output width / height — the shape of the editor's frame. */
  aspect: number;
  /** The take is a window on a backdrop (inset / device), not edge to edge. */
  placed: boolean;
  /** The take's rect and corner radii as percentages of the output frame. */
  viewport: { left: string; top: string; width: string; height: string; rx: string; ry: string };
  /** Cards are baked onto the take (they shrink with an inset window). */
  cardsOnStage: boolean;
}

const pct = (v: number, of: number): string => `${(v / of) * 100}%`;

export function stageLayout(space: { output?: OutputSize | null; stage?: StageRect | null } | null | undefined): StageLayout | null {
  const out = space?.output;
  const st = space?.stage;
  if (!out?.width || !out.height || !st?.w || !st.h) return null;
  const aspect = out.width / out.height;
  return {
    aspect,
    placed: st.mode !== 'fill',
    viewport: {
      left: pct(st.x, out.width),
      top: pct(st.y, out.height),
      width: pct(st.w, out.width),
      height: pct(st.h, out.height),
      rx: pct(st.radius, st.w),
      ry: pct(st.radius, st.h),
    },
    cardsOnStage: Math.abs(st.w / st.h - aspect) < 0.01 * aspect,
  };
}

/**
 * A full-frame card shrunk into the stage window. `scale` is the preview's output-frame scale;
 * dx/dy move the card's centre from the frame's centre (screen px); radius is in card px.
 */
export function cardOnStage(out: OutputSize, st: StageRect, scale: number): { dx: number; dy: number; scale: number; radius: number } {
  const k = st.w / out.width;
  return {
    dx: scale * (st.x + st.w / 2 - out.width / 2),
    dy: scale * (st.y + st.h / 2 - out.height / 2),
    scale: scale * k,
    radius: st.radius / k,
  };
}
