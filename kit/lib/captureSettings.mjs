import { CAPTURE_PRESETS, DEFAULT_CAPTURE, captureProfile, configPatch, describeCapture, suggestCaptures, validateCapture } from './capturePresets.mjs';
import { OUTPUT_FRAMES, outputFrame } from './format.mjs';
import { videoSpace } from './stage.mjs';

/** `?screen=1512x982&avail=1512x944&dpr=2` from the reviewer's browser → a screen for suggestions. */
export function parseScreen(params) {
  const size = (v) => {
    const m = /^(\d{3,5})x(\d{3,5})$/.exec(String(v || ''));
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  const s = size(params?.get?.('screen'));
  if (!s) return null;
  const a = size(params.get('avail')) || s;
  const dpr = Number(params.get('dpr'));
  return { width: s[0], height: s[1], availWidth: a[0], availHeight: a[1], dpr: Number.isFinite(dpr) && dpr > 0 ? dpr : 1 };
}

const clampDpr = (d) => Math.max(1, Math.min(3, Math.round(d || 2)));
const outputFor = (p) => (p.height > p.width ? 'portrait' : 'landscape');

/** Ranked sizes for a picker; "My screen" takes the reviewer's density. */
export function captureOptions({ screen = null, brief = {}, mode = 'agent', output = 'landscape' } = {}) {
  return suggestCaptures({ screen, brief, mode, output }).map(({ preset: p, reason }) => ({
    id: p.id,
    label: p.label,
    group: p.group,
    width: p.width,
    height: p.height,
    dpr: p.id === 'screen' && screen ? clampDpr(screen.dpr) : p.dpr,
    mobile: p.mobile,
    touch: p.touch,
    reason,
  }));
}

/** Everything the Recording size picker shows: current choice, the take, ranked suggestions, shapes. */
export function captureSettings(video, { screen = null, brief = {}, mode = 'agent' } = {}) {
  const current = captureProfile(video.config);
  const output = outputFrame(video.config);
  const options = captureOptions({ screen, brief, mode, output: output.format });
  const top = options[0] || CAPTURE_PRESETS[DEFAULT_CAPTURE];
  return {
    current: { ...current, description: describeCapture(current) },
    output: { format: output.format, width: output.width, height: output.height, label: output.label },
    space: videoSpace(video),
    suggested: { id: top.id, output: outputFor(top), reason: options[0]?.reason || '' },
    options,
    outputs: Object.values(OUTPUT_FRAMES).map((f) => ({ format: f.format, width: f.width, height: f.height, label: f.label })),
    screen,
    mode,
  };
}

/**
 * The config after a picker change. `body.preset` is a preset id, "screen" or "custom" (with
 * width/height/dpr/mobile/touch); `body.output` is "landscape" or "portrait". Throws on bad input.
 */
export function applyCaptureSettings(config, body = {}) {
  const next = { ...config, record: { ...(config.record || {}) } };
  if (body.preset != null) {
    let profile;
    if (CAPTURE_PRESETS[body.preset]) {
      const p = CAPTURE_PRESETS[body.preset];
      profile = { ...p, dpr: body.dpr != null ? Number(body.dpr) : p.dpr };
    } else if (body.preset === 'screen' || body.preset === 'custom') {
      profile = {
        id: body.preset,
        width: Number(body.width),
        height: Number(body.height),
        dpr: body.dpr != null ? Number(body.dpr) : 2,
        mobile: Boolean(body.mobile),
        touch: Boolean(body.touch),
      };
    } else {
      throw new Error(`Unknown recording size "${body.preset}".`);
    }
    const err = validateCapture(profile);
    if (err) throw new Error(err);
    const patch = configPatch(profile);
    next.record.viewport = patch.viewport;
    if (patch.device) next.record.device = patch.device;
    else delete next.record.device;
    // A density tip (e.g. 1× for WebGL) survives a size change; an explicit density replaces it.
    if (body.dpr != null) delete next.record.deviceScaleFactor;
  }
  if (body.output != null) {
    if (!OUTPUT_FRAMES[body.output]) throw new Error(`Video shape must be one of: ${Object.keys(OUTPUT_FRAMES).join(', ')}.`);
    next.output = { ...(config.output || {}), format: body.output };
    if (body.output === 'landscape') delete next.output.format;
    if (!Object.keys(next.output).length) delete next.output;
  }
  return next;
}
