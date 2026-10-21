/**
 * Quality floor for every render. One lossy generation: the delivery master.
 * The take and the cleaned reel are lossless (`-qp 0`, ultrafast — faster than a lossy
 * preset, so capture FPS stays up). Plates stay near-lossless (CRF 4, no `-tune animation`).
 * The master cannot go softer than CRF 12 at preset medium or slower.
 *
 * Every ffmpeg spawn that writes picture calls assertX264Args first. Raising a CRF, dropping
 * `-qp 0`, or re-encoding the picture while muxing audio throws and the render stops.
 */

/** Bump when the floor changes, so an older master fails validate until it is produced again. */
export const QUALITY_ID = 'wt-q2';

export const QUALITY = {
  id: QUALITY_ID,
  recorder: { preset: 'ultrafast', qp: 0 },
  clean: { preset: 'ultrafast', qp: 0 },
  plate: { preset: 'veryfast', crf: 4, jpegQ: 95 },
  /** medium matches slow at this CRF and takes about half the time. Slower presets stay legal. */
  delivery: { preset: 'medium', crf: 12, x264: 'aq-mode=3:aq-strength=0.9:deblock=-1,-1' },
  /** Social and light exports, one generation from the master. */
  variant: { crf: 16 },
};

const DELIVERY_PRESETS = ['medium', 'slow', 'slower', 'veryslow'];

/**
 * Last occurrence wins. ffmpeg applies a codec before `-i` to the input and the one after it
 * to the output, so a JPEG pipe (`-c:v mjpeg -i pipe:0 … -c:v libx264`) is still an x264 encode.
 */
const flag = (args, name) => {
  let value;
  for (let i = 0; i < args.length - 1; i++) if (args[i] === name) value = args[i + 1];
  return value;
};

export function losslessX264(preset) {
  return ['-c:v', 'libx264', '-preset', preset, '-qp', '0'];
}

export function lossyX264({ preset, crf, x264 }) {
  const args = ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf)];
  if (x264) args.push('-x264-params', x264);
  return args;
}

/**
 * Colour: every picture leaves as BT.709 limited range, converted and tagged. Chromium JPEGs are
 * BT.601 full range; a plain `format=yuv420p` keeps the 601 matrix while players decode HD as 709,
 * which pulls saturated UI colours green (up to 20 levels per channel). `-colorspace` alone is a
 * label, not a conversion. The input matrix stays `auto`, so it is read from each frame's tags.
 */
export const BT709_SCALE_OPTS = 'flags=lanczos+accurate_rnd+full_chroma_int:out_color_matrix=bt709:out_range=limited';
export const BT709_PARAMS = 'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv';
export const BT709_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

/** Scale to the frame size and convert to tagged BT.709 4:2:0. */
export function toBt709(width, height) {
  return `scale=${width}:${height}:${BT709_SCALE_OPTS},setsar=1,format=yuv420p,${BT709_PARAMS}`;
}

/** Full-range 4:4:4 JPEG q1. A second 4:2:0 pass softens colored UI text. */
export const STILL_JPEG_ARGS = [
  '-vf', 'scale=out_color_matrix=bt601:out_range=pc:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv444p',
  '-color_range', 'pc', '-qmin', '1', '-q:v', '1', '-frames:v', '1', '-update', '1',
];

export function plateJpegQ(raw = process.env.WALKTHROUGH_PLATE_JPEG_Q) {
  const requested = Number(raw);
  const q = Number.isFinite(requested) ? Math.min(100, requested) : QUALITY.plate.jpegQ;
  if (q < QUALITY.plate.jpegQ) {
    throw new Error(
      `Plate JPEG quality ${q} is below the floor (${QUALITY.plate.jpegQ}). ` +
        'Lowering it blocks the plate grain before x264 sees the frame.'
    );
  }
  return q;
}

/**
 * Refuse an encode that would ship the soft master: lossy intermediates, CRF above the floor,
 * `-tune animation` on plates, or a delivery preset faster than medium.
 */
export function assertX264Args(role, args) {
  if (flag(args, '-c:v') !== 'libx264') {
    throw new Error(`encode ${role}: picture must be libx264`);
  }
  if (flag(args, '-colorspace') !== 'bt709' || flag(args, '-color_range') !== 'tv') {
    throw new Error(`encode ${role}: tag the picture BT.709 limited range (BT709_TAGS) — untagged video decodes green`);
  }
  const qp = flag(args, '-qp');
  const crf = Number(flag(args, '-crf'));
  const preset = flag(args, '-preset');
  if (role === 'recorder' || role === 'clean') {
    if (qp !== '0') {
      throw new Error(`encode ${role}: the intermediate must be lossless (-qp 0), not crf ${flag(args, '-crf') ?? '?'}`);
    }
    if (preset !== 'ultrafast') {
      throw new Error(`encode ${role}: use ultrafast with -qp 0 — a slower preset only costs capture time`);
    }
    return;
  }
  if (role === 'plate') {
    if (!(crf <= QUALITY.plate.crf)) {
      throw new Error(`encode plate: CRF ${flag(args, '-crf')} is softer than the floor (CRF ${QUALITY.plate.crf})`);
    }
    if (flag(args, '-tune') === 'animation') {
      throw new Error('encode plate: -tune animation smears plate grain');
    }
    return;
  }
  if (role === 'variant') {
    if (!(crf <= QUALITY.variant.crf)) {
      throw new Error(`encode variant: CRF ${flag(args, '-crf')} is softer than the export floor (CRF ${QUALITY.variant.crf})`);
    }
    if (!DELIVERY_PRESETS.includes(preset)) {
      throw new Error(`encode variant: preset ${preset} is below the floor (${QUALITY.delivery.preset})`);
    }
    if (flag(args, '-c:a') && flag(args, '-c:a') !== 'copy') {
      throw new Error('encode variant: copy the mixed audio (-c:a copy), do not encode it again');
    }
    return;
  }
  if (role === 'delivery') {
    if (!(crf <= QUALITY.delivery.crf)) {
      throw new Error(`encode delivery: CRF ${flag(args, '-crf')} is softer than the floor (CRF ${QUALITY.delivery.crf})`);
    }
    if (!DELIVERY_PRESETS.includes(preset)) {
      throw new Error(`encode delivery: preset ${preset} is below the floor (${QUALITY.delivery.preset})`);
    }
    return;
  }
  throw new Error(`encode: unknown role ${role}`);
}

/** Audio mux must copy the picture. Re-encoding here is a second lossy generation. */
export function assertVideoCopied(args) {
  if (flag(args, '-c:v') !== 'copy') {
    throw new Error('encode mux: the delivery picture must be copied (-c:v copy), not encoded again');
  }
}

export function qualityMeta() {
  return {
    id: QUALITY_ID,
    delivery: `x264 ${QUALITY.delivery.preset} crf ${QUALITY.delivery.crf}`,
    intermediates: 'lossless qp 0',
    plates: `x264 crf ${QUALITY.plate.crf} jpeg q${QUALITY.plate.jpegQ}`,
  };
}

export function encodeSummary(style) {
  const q = qualityMeta();
  return `${q.delivery} aq-mode 3 (${q.intermediates} intermediates, ${q.plates}), xfade joins (${style})`;
}

/** Old masters (no quality id, or an earlier one) fail QC until produce runs again. */
export function masterQualityError(meta) {
  if (meta?.quality?.id === QUALITY_ID) return null;
  return 'This master predates the current quality floor (soft intermediates or shifted colours). Produce the video again.';
}
