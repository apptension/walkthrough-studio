import type { FreshnessSource, VideoSummary } from '@/api/types';
import type { RenderAction } from '@/desk/action';
import type { PipelineStep } from '@/desk/store';
import { OUT_OF_DATE, stageWhen } from '@/features/stages/model';

/**
 * The one status surface in the header: the chip that folds out of Render.
 *
 * It decides from the same truth as the Render bay — `action` (from the server's freshness),
 * the open review, the running job and its pipeline — so nothing upstream writes "changed,
 * render when ready" copy of its own. Pure, so every state is pinned by tests.
 *
 * Priority: a running job, then a passing notice, then a review waiting on you, then the
 * render state (record failed / not rendered / re-record / plate QC / out of date).
 */

export type ChipKind = 'idle' | 'busy' | 'notice' | 'review' | 'render';
export type ChipTone = 'run' | 'ok' | 'warn' | 'danger' | 'accent' | 'review';
export type ChipClick = 'render' | 'feedback' | null;

export interface ChipNotice {
  tone: 'ok' | 'warn';
  text: string;
}

export interface ChipChange {
  key: FreshnessSource['key'];
  label: string;
  hint: string;
  when: string;
}

export interface ChipTip {
  title: string;
  lead: string;
  changes: ChipChange[];
  steps: PipelineStep[];
  detail: string;
  lastRender: string;
  next: string;
}

export interface ChipView {
  kind: ChipKind;
  tone: ChipTone;
  label: string;
  /** Halo + sweep: something is waiting on you. */
  attention: boolean;
  click: ChipClick;
  tip: ChipTip | null;
}

export interface ChipInput {
  video: VideoSummary | null;
  action: RenderAction | null;
  busy: boolean;
  /** `status.text` while `status.kind === 'run'`. */
  activity: string;
  pipeline: PipelineStep[] | null;
  /** The running job started while the cut was behind. */
  catching: boolean;
  proposalOpen: boolean;
  notice: ChipNotice | null;
}

/** How long a passing notice holds the chip before it morphs back. */
export const NOTICE_MS: Record<ChipNotice['tone'], number> = { ok: 2600, warn: 4200 };

export const UP_TO_DATE = 'Up to date';
export const REVIEW_LABEL = 'Review changes';

export const IDLE_VIEW: ChipView = { kind: 'idle', tone: 'ok', label: '', attention: false, click: null, tip: null };

const SOURCE_COPY: Record<FreshnessSource['key'], { label: string; hint: string }> = {
  config: { label: 'Project settings', hint: 'plates, timeline, transitions, captions or audio' },
  narration: { label: 'Narration', hint: 'voice-over lines' },
  flow: { label: 'Recording flow', hint: 'the scripted app tour' },
  brand: { label: 'Brand pack', hint: 'colours, type or logo' },
};

const TONE_BY_STATUS: Partial<Record<string, ChipTone>> = {
  'Record failed': 'danger',
  'Not rendered': 'accent',
};

function changesSince(video: VideoSummary | null, against: 'delivery' | 'live', now: number): ChipChange[] {
  const key = against === 'live' ? 'newerThanLive' : 'newerThanDelivery';
  return (video?.freshness?.sources ?? [])
    .filter((s) => s[key])
    .sort((a, b) => b.mtime - a.mtime)
    .map((s) => ({ key: s.key, ...SOURCE_COPY[s.key], when: stageWhen(new Date(s.mtime).toISOString(), now) }));
}

function lastRender(video: VideoSummary | null, now: number): string {
  const at = video?.freshness?.deliveryAt;
  return at ? stageWhen(new Date(at).toISOString(), now) : '';
}

function tip(partial: Partial<ChipTip> & Pick<ChipTip, 'title' | 'lead'>): ChipTip {
  return { changes: [], steps: [], detail: '', lastRender: '', next: '', ...partial };
}

function busyView(input: ChipInput, now: number): ChipView {
  const steps = (input.pipeline ?? []).filter((s) => s.id !== 'preview');
  const running = steps.find((s) => s.status === 'run');
  const label = running?.label || input.activity || 'Working…';
  return {
    kind: 'busy',
    tone: 'run',
    label,
    attention: false,
    click: null,
    tip: tip({
      title: input.catching ? 'Catching up' : input.activity || 'Working',
      lead: input.catching
        ? 'Rendering your latest changes. Program switches to the new cut when it finishes.'
        : 'Program updates when this finishes.',
      changes: input.catching ? changesSince(input.video, 'delivery', now) : [],
      steps,
    }),
  };
}

function reviewView(input: ChipInput, now: number): ChipView {
  return {
    kind: 'review',
    tone: 'review',
    label: REVIEW_LABEL,
    attention: true,
    click: 'feedback',
    tip: tip({
      title: 'Changes waiting for your review',
      lead: 'The edits are live in the preview but not approved. Approve & render keeps them; Discard rolls them back.',
      changes: changesSince(input.video, 'delivery', now),
      lastRender: lastRender(input.video, now),
      next: 'Click to open Feedback',
    }),
  };
}

function renderView(input: ChipInput, action: RenderAction, now: number): ChipView {
  const tone = TONE_BY_STATUS[action.status] ?? 'warn';
  const changes = changesSince(input.video, action.status === 'Needs re-record' ? 'live' : 'delivery', now);
  const stale = action.status === OUT_OF_DATE;
  return {
    kind: 'render',
    tone,
    label: action.status,
    attention: tone !== 'accent',
    click: 'render',
    tip: tip({
      title: stale ? OUT_OF_DATE : action.title || action.status,
      lead: stale
        ? changes.length
          ? 'Program still plays the last render. These changed after it was made:'
          : 'Program still plays the last render. Sources changed after it was made.'
        : action.reason || '',
      changes,
      // The server's one-line reason only repeats what the change list already shows.
      detail: changes.length || stale ? '' : action.detail || '',
      lastRender: lastRender(input.video, now),
      next: stale ? 'Click Render to catch up' : action.primary ? `Click ${action.primary.label}` : '',
    }),
  };
}

/** The view before any passing notice — what the cut itself needs. */
export function baseChipView(input: ChipInput, now = Date.now()): ChipView {
  if (input.busy) return busyView(input, now);
  if (input.proposalOpen) return reviewView(input, now);
  if (input.action?.kind === 'warn') return renderView(input, input.action, now);
  return IDLE_VIEW;
}

export function chipView(input: ChipInput, now = Date.now()): ChipView {
  if (!input.busy && input.notice) {
    return { kind: 'notice', tone: input.notice.tone, label: input.notice.text, attention: false, click: null, tip: null };
  }
  return baseChipView(input, now);
}

/** Whether a base view wants the "Up to date" flash once it clears. */
export function clearsToUpToDate(prev: ChipView, prevCatching: boolean): boolean {
  return prev.kind === 'render' || prev.kind === 'review' || (prev.kind === 'busy' && prevCatching);
}
