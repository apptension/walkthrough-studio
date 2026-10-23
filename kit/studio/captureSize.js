/**
 * Recording size picker: what the product is recorded at (capture) and the shape of the video
 * (output). Pure helpers, so the copy and the stage preview are testable without a browser.
 */

/** `screen=WxH&avail=WxH&dpr=N` for GET /capture — the reviewer's screen drives "My screen". */
export function screenQuery(screen = globalThis.screen, dpr = globalThis.devicePixelRatio) {
  if (!screen?.width || !screen?.height) return '';
  const q = new URLSearchParams({
    screen: `${Math.round(screen.width)}x${Math.round(screen.height)}`,
    avail: `${Math.round(screen.availWidth || screen.width)}x${Math.round(screen.availHeight || screen.height)}`,
    dpr: String(Math.round((dpr || 1) * 100) / 100),
  });
  return q.toString();
}

/** "1920×1080 · @2x" or "390×844 · @3x · touch". */
export function sizeLine(o) {
  const parts = [`${o.width}×${o.height}`, `@${o.dpr}x`];
  if (o.touch) parts.push('touch');
  else if (o.mobile) parts.push('mobile');
  return parts.join(' · ');
}

/** The option list for the picker: the current choice first among equals, the suggestion flagged. */
export function pickerOptions(settings) {
  const current = settings?.current || {};
  const suggested = settings?.suggested?.id;
  const seen = new Set();
  const rows = [];
  for (const o of settings?.options || []) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    const selected = o.id === current.id && o.width === current.width && o.height === current.height;
    const shown = selected ? { ...o, dpr: current.dpr, mobile: current.mobile, touch: current.touch } : o;
    rows.push({
      ...shown,
      title: o.label.split(' · ')[0],
      line: sizeLine(shown),
      selected,
      suggested: o.id === suggested,
    });
  }
  if (!rows.some((r) => r.selected) && current.width) {
    rows.push({
      ...current,
      title: current.id === 'screen' ? 'My screen' : 'Custom',
      line: sizeLine(current),
      selected: true,
      suggested: false,
      reason: 'Set for this video',
    });
  }
  const order = { desktop: 0, laptop: 1, tablet: 2, phone: 3 };
  return rows.sort((a, b) => (order[a.group] ?? 4) - (order[b.group] ?? 4) || b.width - a.width);
}

/** How the recording sits in the video frame — the copy under the preview. */
export function stageText(space) {
  const st = space?.plannedStage;
  const out = space?.output;
  if (!st || !out) return '';
  const shape = out.format === 'portrait' ? 'vertical video' : 'video';
  if (st.mode === 'fill') return `Fills the ${out.width}×${out.height} ${shape} edge to edge.`;
  if (st.mode === 'device') return `Shown as a phone on the ${out.width}×${out.height} ${shape}.`;
  const cap = space.capture;
  if (cap && Math.abs(cap.width / cap.height - out.width / out.height) < 0.02) return `Framed as a window on the ${out.width}×${out.height} ${shape}.`;
  return `Centred as a window on the ${out.width}×${out.height} ${shape} — other aspect ratios leave a margin.`;
}

/** The preview box: stage rect as percentages of the output frame. */
export function stageBox(space) {
  const st = space?.plannedStage;
  const out = space?.output;
  if (!st || !out) return null;
  const pct = (v, of) => `${Math.round((v / of) * 1000) / 10}%`;
  return {
    aspect: `${out.width} / ${out.height}`,
    left: pct(st.x, out.width),
    top: pct(st.y, out.height),
    width: pct(st.w, out.width),
    height: pct(st.h, out.height),
    radius: `${Math.round((st.radius / out.width) * 1000) / 10}cqw`,
    mode: st.mode,
  };
}

/** A warning when the last take was recorded at another size, or ''. */
export function takeNote(space) {
  if (space?.take && space.takeMatches && space.upscale > 1.1) {
    return `The last take was captured for a smaller frame and is shown ${Math.round(space.upscale * 100)}% — re-record for full sharpness.`;
  }
  if (!space?.take || space.takeMatches) return '';
  const was = `${space.take.width}×${space.take.height}${space.take.mobile ? ' (mobile)' : ''}`;
  const now = `${space.capture.width}×${space.capture.height}${space.capture.mobile ? ' (mobile)' : ''}`;
  return `The last take was recorded at ${was}. Re-record to use ${now} — produce keeps the old take until then.`;
}

/** A nudge when the shape does not suit the recording (phone in a landscape video, etc.), or null. */
export function shapeHint(settings) {
  const cap = settings?.current;
  const fmt = settings?.output?.format;
  if (!cap || !fmt) return null;
  const tall = cap.height > cap.width;
  if (tall && fmt === 'landscape') return { output: 'portrait', text: 'Tall recordings read best in a vertical 9:16 video.' };
  if (!tall && fmt === 'portrait') return { output: 'landscape', text: 'A wide recording leaves most of a vertical video empty.' };
  return null;
}

/**
 * A pre-flight warning before a guided (self-recording) session: the current recording size
 * would shrink to fit this screen, plus up to 3 sizes that fit at full scale, smaller-first. null
 * when there is nothing to warn about (no screen known, or the current size already fits).
 */
export function guidedFitWarning(settings) {
  if (!settings?.guidedFit || settings.guidedFit.fits) return null;
  const current = settings.current || {};
  const fits = (settings.options || [])
    .filter((o) => o.fits && (o.width !== current.width || o.height !== current.height))
    .sort((a, b) => a.width * a.height - b.width * b.height);
  return { scale: settings.guidedFit.scale, current, suggestions: fits.slice(0, 3) };
}

/** Custom size form → POST body, or an error message. Mirrors the server's limits. */
export function customBody({ width, height, dpr = 2, mobile = false, touch = false } = {}) {
  const w = Number(width);
  const h = Number(height);
  for (const [k, v] of [['Width', w], ['Height', h]]) {
    if (!Number.isInteger(v) || v < 320 || v > 3840) return { error: `${k} must be a whole number between 320 and 3840.` };
    if (v % 2) return { error: `${k} must be even.` };
  }
  return { body: { preset: 'custom', width: w, height: h, dpr: Number(dpr) || 2, mobile: Boolean(mobile), touch: Boolean(touch) } };
}
