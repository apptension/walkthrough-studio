/**
 * Pre-flight check before any guided (self-recording) session opens — new-project discovery
 * ("I'll show it") or a re-record ("Record yourself"). Both open the same interactive browser +
 * Recorder window and need the reviewer's actual hands on the wheel, so if the configured
 * recording size would need to shrink to fit this screen, ask first instead of letting the
 * window open cramped and undriveable.
 */
import { ask } from './ask.js';
import { guidedFitWarning, screenQuery, sizeLine } from './captureSize.js';

/**
 * @param {(path: string, init?: object) => Promise<any>} api
 * @param {string} slug
 * @returns {Promise<boolean>} false to cancel the session; never throws (advisory only).
 */
export async function confirmGuidedFits(api, slug) {
  if (!slug) return true;
  let settings;
  try {
    const q = screenQuery();
    settings = await api(`/api/video/${encodeURIComponent(slug)}/capture${q ? `?${q}` : ''}`);
  } catch {
    return true; // a failed check never blocks the recording
  }
  const warn = guidedFitWarning(settings);
  if (!warn) return true;
  const pct = Math.round(warn.scale * 100);
  const options = [
    ...warn.suggestions.map((o) => ({ value: o.id, label: o.label, hint: `${sizeLine(o)} — fits your screen` })),
    {
      value: '__keep__',
      label: `Continue at ${sizeLine(warn.current)}`,
      hint: `The recording window will show at ${pct}% to fit your screen.`,
    },
  ];
  const picked = await ask({
    kind: 'choice',
    title: "This recording size won't fit your screen",
    detail: `At ${sizeLine(warn.current)}, the recording window — plus the Recorder panel beside it — only fits this screen at ${pct}%. Pick a size that fits, or continue anyway; small text may be harder to read while you record.`,
    options,
    ok: 'Use this size',
    cancel: 'Cancel',
    tone: 'warn',
  });
  if (picked == null) return false;
  if (picked === '__keep__') return true;
  try {
    await api(`/api/video/${encodeURIComponent(slug)}/capture`, { method: 'POST', body: { preset: picked, screen: settings.screen || null } });
  } catch {
    /* couldn't persist the new size — proceed anyway rather than block the session */
  }
  return true;
}
