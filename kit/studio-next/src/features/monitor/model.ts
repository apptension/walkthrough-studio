import type { CaptionCue, RecordFailure, VideoSummary } from '@/api/types';
import type { RenderAction } from '@/desk/action';
import type { BayOverride } from '@/desk/store';
import { programEmptyView, type ProgramEmptyAction, type ProgramEmptyViewModel } from '@/logic/programEmpty';
import { describeRecordFailure } from '@/logic/recordFailure';

/** `cueAt(t)` — the caption on screen at `t`. */
export function cueAt(cues: readonly CaptionCue[], t: number): CaptionCue | null {
  return cues.find((c) => t >= c.start && t < c.end) || null;
}

/** `chapterAt(t)` — the last chapter that has started, with the legacy 50 ms lead. */
export function chapterAt<T extends { start: number }>(chapters: readonly T[], t: number): T | null {
  let cur: T | null = null;
  for (const c of chapters) if (c.start <= t + 0.05) cur = c;
  return cur;
}

/** What `#recordFailure` shows, as `renderActionCard` reads `v.recordFailure`. */
export function recordFailureInfo(v: VideoSummary | null | undefined): RecordFailure | null {
  const raw = v?.recordFailure;
  if (!raw) return null;
  if (raw.technical) return raw;
  const parsed = describeRecordFailure(raw.reason);
  return { ...raw, reason: parsed.reason, technical: parsed.technical, next: parsed.next, url: parsed.url || raw.url };
}

/** The key `renderActionCard` compares with `state.recordFailureDismissed`. */
export function recordFailureKey(slug: string | null, info: RecordFailure | null): string | null {
  return info ? `${slug || ''}|${info.screenshot || ''}|${info.reason || ''}` : null;
}

/** The key the dismiss button stores (`#recordFailureDismiss` click). */
export function recordFailureDismissKey(slug: string | null, raw: RecordFailure): string {
  const parsed = raw.technical ? raw : describeRecordFailure(raw.reason);
  return `${slug || ''}|${raw.screenshot || ''}|${parsed.reason || raw.reason || ''}`;
}

/**
 * The action `renderActionCard` hands `paintNoVideo`: the busy view while a
 * render owns the bay, the "Render again" view when Program is up to date,
 * otherwise the action itself.
 */
export function noVideoAction(action: RenderAction, { busy, bay }: { busy: boolean; bay: BayOverride | null }): ProgramEmptyAction {
  if (busy) {
    // Legacy read `#renderHeadline` / `#renderReason`: the pipeline's override, else what the bay last painted.
    const headline = bay?.headline || action.title || 'Program matches your sources';
    const reason =
      bay?.reason || action.reason || (action.title ? '' : 'Watch it, give feedback, or approve the cut from the stage bar.');
    return {
      busy: true,
      status: 'Rendering',
      title: headline,
      ...(reason ? { reason } : {}),
    };
  }
  if (!action.title) {
    return {
      status: 'Up to date',
      title: 'Nothing to play yet',
      reason: 'Render a sequence to watch the cut here.',
      primary: { label: 'Render again', mode: 'quick' },
      secondary: null,
    };
  }
  return {
    status: action.status,
    title: action.title,
    ...(action.reason ? { reason: action.reason } : {}),
    primary: action.primary,
    secondary: action.secondary,
  };
}

export function noVideoView(action: RenderAction, ctx: { busy: boolean; bay: BayOverride | null }): ProgramEmptyViewModel {
  return programEmptyView(noVideoAction(action, ctx));
}
