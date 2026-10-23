/** Delivery canvas. Every plate, card and the master target the video's output frame. */
export const DELIVERY = Object.freeze({ format: 'landscape', width: 1920, height: 1080, label: '1080p' });

export const OUTPUT_FRAMES = Object.freeze({
  landscape: DELIVERY,
  portrait: Object.freeze({ format: 'portrait', width: 1080, height: 1920, label: '1080×1920 vertical' }),
});

/** The master frame a video delivers: `output.format` "landscape" (default) or "portrait". */
export function outputFrame(config = {}) {
  return OUTPUT_FRAMES[config?.output?.format] || DELIVERY;
}
