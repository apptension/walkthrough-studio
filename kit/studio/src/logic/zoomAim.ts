/**
 * Zoom aim shared by the stage preview and the encode crop.
 * The centre may move until the crop meets the frame edge, and no further —
 * pixels outside the frame stay hidden. `width`/`height` are the frame the aim lives in (the
 * take's CSS px in the editor, reel px in the encode).
 */

export interface ZoomFrame {
  zoom?: number;
  width?: number;
  height?: number;
}

export interface ZoomCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ZoomAim {
  cx: number;
  cy: number;
  crop: ZoomCrop;
}

export interface ZoomPreviewStyle {
  transformOrigin: string;
  transform: string;
  crop: ZoomCrop;
}

export function clampZoomCenter(x: unknown, y: unknown, { zoom = 1, width, height }: ZoomFrame = {}): ZoomAim {
  if (!(width !== undefined && height !== undefined && width > 0 && height > 0)) {
    throw new Error('clampZoomCenter needs the frame width and height');
  }
  const z = Math.max(1.001, Number(zoom) || 1);
  const halfW = width / (2 * z);
  const halfH = height / (2 * z);
  const cx = Math.round(Math.min(width - halfW, Math.max(halfW, Number(x) || 0)));
  const cy = Math.round(Math.min(height - halfH, Math.max(halfH, Number(y) || 0)));
  const w = width / z;
  const h = height / z;
  return {
    cx,
    cy,
    crop: {
      x: Math.min(Math.max(0, cx - w / 2), Math.max(0, width - w)),
      y: Math.min(Math.max(0, cy - h / 2), Math.max(0, height - h)),
      w,
      h,
    },
  };
}

/**
 * CSS that shows the same window as the ffmpeg crop.
 * `transform-origin` at the aim point scales around a layout point that is not
 * the viewport centre, so an edge aim never reached the frame edge.
 */
export function zoomPreviewStyle(cx: unknown, cy: unknown, opts: ZoomFrame = {}): ZoomPreviewStyle {
  const aim = clampZoomCenter(cx, cy, opts);
  // clampZoomCenter has already thrown unless both are positive numbers.
  const { width = 0, height = 0, zoom = 1 } = opts;
  const z = Math.max(1.001, Number(zoom) || 1);
  const tx = `${Number(((-aim.crop.x / width) * 100).toFixed(4))}%`;
  const ty = `${Number(((-aim.crop.y / height) * 100).toFixed(4))}%`;
  return {
    transformOrigin: '0 0',
    transform: `scale(${Number(z.toFixed(4))}) translate(${tx}, ${ty})`,
    crop: aim.crop,
  };
}
