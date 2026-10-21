/**
 * Capture stall watchdog: if the flow stops making progress (no timeline marks / actions),
 * cancel the take with a structured report so Studio can repair flow.mjs and re-record once.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** No chapter/caption progress for this long → stall. */
export const STALL_IDLE_MS = 45_000;
/** A single Playwright action (click/fill/…) must finish within this, or we abort. */
export const STALL_ACTION_MS = 35_000;

export class CaptureStallError extends Error {
  /** @param {object} report */
  constructor(report) {
    super(report.summary || 'capture stalled');
    this.name = 'CaptureStallError';
    this.report = report;
  }
}

/**
 * @param {{ lastLabel?: string, lastAction?: string, idleMs?: number, url?: string, timeline?: object[] }} info
 */
export function classifyStall(info = {}) {
  const action = String(info.lastAction || '');
  const label = String(info.lastLabel || 'unknown step');
  const hints = [];
  let kind = 'idle';

  if (/fill|pressSequentially|type/i.test(action)) {
    kind = 'fill';
    hints.push(
      'A fill/type action stopped progressing. Prefer ctx.typeInto(locator, value) or name=/id= selectors — getByPlaceholder often clears on focus and hangs the next fill.'
    );
  } else if (/click|dblclick|tap/i.test(action)) {
    kind = 'click';
    hints.push(
      'A click did not finish. Check the selector, use { noWaitAfter: true } / waitUntil: "domcontentloaded" for nav that never reaches load (analytics/recaptcha), and force-click animated CTAs if needed.'
    );
  } else if (label && label !== 'live start') {
    kind = 'after-step';
    hints.push(
      `No progress after “${label}”. The next Playwright wait/selector is likely wrong or the page never reached the expected state.`
    );
  } else {
    hints.push('The flow made no timeline progress. Check startUrl, beforeCapture, and the first chapter selectors.');
  }

  hints.push('Edit only flow.mjs (and narration keys if you rename a say/chapter title). Do not record or render.');

  const summary = `Capture stalled after “${label}”${action ? ` during ${action}` : ''} (${Math.round((info.idleMs || 0) / 1000)}s idle)`;
  return {
    kind,
    summary,
    hints,
    lastLabel: label,
    lastAction: action || null,
    idleMs: info.idleMs || 0,
    url: info.url || null,
  };
}

/**
 * @param {object} info
 * @param {{ slug?: string, out?: string }} [meta]
 */
export function buildStallReport(info, meta = {}) {
  const base = classifyStall(info);
  const marks = Array.isArray(info.timeline)
    ? info.timeline.filter((m) => m.kind === 'chapter' || m.kind === 'caption').slice(-6)
    : [];
  return {
    ...base,
    slug: meta.slug || null,
    createdAt: new Date().toISOString(),
    recentMarks: marks.map((m) => ({ kind: m.kind, label: m.label, t: m.t })),
  };
}

export function stallReportPath(video) {
  return join(video.out, 'capture-stall.json');
}

export function writeStallReport(video, report) {
  const path = stallReportPath(video);
  writeFileSync(path, JSON.stringify(report, null, 2));
  return path;
}

export function readStallReport(video) {
  const path = stallReportPath(video);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function clearStallReport(video) {
  rmSync(stallReportPath(video), { force: true });
}

/** Format stall report as the Improve note for capture-repair. */
export function formatStallNote(report) {
  if (!report) return '';
  const lines = [
    report.summary,
    report.url ? `URL: ${report.url}` : null,
    report.lastAction ? `Last action: ${report.lastAction}` : null,
    report.recentMarks?.length
      ? `Recent steps: ${report.recentMarks.map((m) => m.label).join(' → ')}`
      : null,
    '',
    'Hints:',
    ...(report.hints || []).map((h) => `- ${h}`),
    '',
    'Read capture-stall.json and error.png in the video out folder. Fix the stuck step so a re-record can pass.',
  ];
  return lines.filter((x) => x != null).join('\n');
}

/**
 * Two clocks: (1) story idle — no chapter/caption for idleMs; (2) action — one click/fill
 * longer than actionMs. Actions do not reset the story clock (so a fillField retry loop still stalls).
 *
 * @param {{ idleMs?: number, actionMs?: number, onStall: (snap: object) => void }} opts
 */
export function createStallWatchdog({ idleMs = STALL_IDLE_MS, actionMs = STALL_ACTION_MS, onStall } = {}) {
  let lastAt = Date.now();
  let lastLabel = 'live start';
  let lastAction = null;
  let idleTimer = null;
  let actionTimer = null;
  let stopped = false;
  let stalled = false;

  const snapshot = () => ({
    lastLabel,
    lastAction,
    idleMs: Date.now() - lastAt,
  });

  const fire = (extra = {}) => {
    if (stopped || stalled) return;
    stalled = true;
    clearTimeout(idleTimer);
    clearTimeout(actionTimer);
    onStall?.({ ...snapshot(), ...extra });
  };

  const armIdle = () => {
    if (stopped || stalled) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => fire({ reason: 'idle' }), idleMs);
  };

  return {
    /** Story progress (chapter / caption / pace). Resets the idle clock. */
    touchMark(label) {
      if (stopped || stalled) return;
      lastAt = Date.now();
      if (label) lastLabel = label;
      armIdle();
    },
    /** Start of a patched locator action — arms the per-action deadline. */
    beginAction(name) {
      if (stopped || stalled) return;
      lastAction = name || lastAction;
      clearTimeout(actionTimer);
      actionTimer = setTimeout(() => fire({ reason: 'action', lastAction: name }), actionMs);
    },
    /** End of a patched locator action (success or failure). */
    endAction() {
      clearTimeout(actionTimer);
      actionTimer = null;
    },
    snapshot,
    stop() {
      stopped = true;
      clearTimeout(idleTimer);
      clearTimeout(actionTimer);
    },
    start() {
      stopped = false;
      stalled = false;
      lastAt = Date.now();
      armIdle();
    },
  };
}
