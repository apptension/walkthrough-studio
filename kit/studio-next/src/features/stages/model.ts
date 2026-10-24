import type { VideoSummary } from '@/api/types';

/**
 * Stage-bar state, ported from `kit/studio/workflow.js` (`stages`, `hintFor`).
 *
 * The server owns approval truth; this module only reads `review`, `freshness`,
 * `direction.approvedAt` and `deliver` and decides what the stripe says. It is
 * pure on purpose — the approval chain is the part of the desk most worth
 * pinning down with tests, and none of it needs a DOM.
 */

export const STAGE_ORDER = ['brief', 'script', 'direction', 'record', 'cut', 'deliver'] as const;

export type StageKey = (typeof STAGE_ORDER)[number];

export type StageTone = 'done' | 'active' | 'warn' | 'idle';

export interface StageState {
  tone: StageTone;
  /** The `<em>` under the stage name. */
  meta: string;
}

export type StageMap = Record<StageKey, StageState>;

export interface StageHint {
  text: string;
  tone: 'warn' | '';
  /** Optional status pill on the right (e.g. the Out of date badge). */
  badge?: string;
}

export const STAGE_LABEL: Record<StageKey, string> = {
  brief: 'Brief',
  script: 'Script',
  direction: 'Direction',
  record: 'Record',
  cut: 'Cut',
  deliver: 'Deliver',
};

/** `STATUS_LABEL` in `workflow.js` — the review pill, the Cut facts and the review history share it. */
export const STATUS_LABEL: Partial<Record<string, string>> = {
  draft: 'Needs approval',
  approved: 'Approved',
  changed: 'Changed since approval',
  'changes-requested': 'Changes requested',
  none: 'Not reviewed',
};

/** `pill(el, effective)`: the review pill's text and `data-tone`. */
export function reviewPill(effective: string): { text: string; tone: 'ok' | 'neutral' | 'warn' } {
  return {
    text: STATUS_LABEL[effective] || effective,
    tone: effective === 'approved' ? 'ok' : effective === 'draft' || effective === 'none' ? 'neutral' : 'warn',
  };
}

/** The stage bar's own relative time. Kept verbatim so the stripe reads the same. */
export function stageWhen(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const date = new Date(iso);
  const mins = Math.round((now - date.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** `Out of date` is shown on the right-hand hint, so Cut says `Needs render`. */
export const OUT_OF_DATE = 'Out of date';

export function stages(video: VideoSummary, now = Date.now()): StageMap {
  const f = video.freshness;
  const script = video.review.script;
  const cut = video.review.cut;
  const scriptOk = script.effective === 'approved';
  const directionOk = Boolean(video.direction.approvedAt);
  const when = (iso: string | null | undefined) => stageWhen(iso, now);

  const brief: StageState = video.brief
    ? { tone: 'done', meta: `Pinned ${when(video.brief.createdAt)}` }
    : { tone: 'done', meta: 'From config' };

  const scriptStage: StageState = {
    tone: scriptOk ? 'done' : script.effective === 'draft' ? 'active' : 'warn',
    meta: scriptOk
      ? `Approved ${when(script.approvedAt)}`
      : (STATUS_LABEL[script.effective] ?? 'Needs approval'),
  };

  const direction: StageState = directionOk
    ? { tone: 'done', meta: `${video.direction.palette} · ${video.transitions.style || 'directed'}` }
    : {
        tone: scriptOk ? 'active' : 'idle',
        meta: scriptOk ? 'Choose visual language' : 'After script',
      };

  let record: StageState;
  if (!f.liveAt) {
    record = {
      tone: scriptOk && directionOk ? 'active' : 'idle',
      meta:
        scriptOk && directionOk
          ? 'Ready to record'
          : directionOk
            ? 'After script'
            : 'After direction',
    };
  } else if (f.needsRecord) {
    record = { tone: 'warn', meta: 'Flow changed — re-record' };
  } else {
    record = { tone: 'done', meta: `Recorded ${when(new Date(f.liveAt).toISOString())}` };
  }

  let cutStage: StageState;
  if (!video.hasDelivery) cutStage = { tone: 'idle', meta: 'No render yet' };
  else if (f.stale) cutStage = { tone: 'warn', meta: OUT_OF_DATE };
  else if (cut.effective === 'approved') {
    cutStage = { tone: 'done', meta: `Approved ${cut.versionName ?? ''}`.trim() };
  } else if (cut.effective === 'changed') {
    cutStage = { tone: 'warn', meta: 'New render since approval' };
  } else if (cut.effective === 'changes-requested') {
    cutStage = { tone: 'warn', meta: 'Changes requested' };
  } else cutStage = { tone: 'active', meta: 'Awaiting review' };

  // A handoff pack built before the current master is not the current handoff
  // pack. 5s of slack covers the write ordering between the two files.
  const delivered = Boolean(
    video.deliver?.generatedAt &&
      f.deliveryAt &&
      Date.parse(video.deliver.generatedAt) >= f.deliveryAt - 5000,
  );
  const deliver: StageState = delivered
    ? { tone: 'done', meta: `Exported ${when(video.deliver?.generatedAt)}` }
    : {
        tone: cut.effective === 'approved' ? 'active' : 'idle',
        meta: cut.effective === 'approved' ? 'Ready to export' : 'After cut approval',
      };

  return { brief, script: scriptStage, direction, record, cut: cutStage, deliver };
}

/** The first stage still wanting attention — the one the stripe marks `current`. */
export function currentStage(map: StageMap): StageKey | null {
  return STAGE_ORDER.find((key) => map[key].tone === 'active' || map[key].tone === 'warn') ?? null;
}

/** What Cut prints under its name, once `Out of date` has moved to the hint. */
export function stageMetaText(key: StageKey, state: StageState): string {
  return key === 'cut' && state.meta === OUT_OF_DATE ? 'Needs render' : state.meta;
}

export function stageHint(map: StageMap): StageHint {
  if (map.cut.tone === 'warn' && map.cut.meta === OUT_OF_DATE) {
    return {
      text: 'Sources changed since the last render. Use Render to catch up.',
      tone: 'warn',
      badge: OUT_OF_DATE,
    };
  }
  if (map.script.tone !== 'done') {
    return {
      text: 'Review and approve the script before recording — narration and on-screen copy are cheap to change now.',
      tone: '',
    };
  }
  if (map.direction.tone !== 'done') {
    return {
      text: 'Choose the palette, guided focus and transition language before recording.',
      tone: '',
    };
  }
  // Re-record is explained by the Render bay, next to the button that fixes it.
  if (map.record.tone === 'warn') return { text: '', tone: '' };
  if (map.cut.tone === 'active') {
    return {
      text: 'Watch the cut, then approve it. Approval pins this exact file as a release version.',
      tone: '',
    };
  }
  if (map.cut.tone === 'warn') {
    return { text: 'The cut changed after approval. Review it again.', tone: 'warn' };
  }
  if (map.deliver.tone === 'active') {
    return {
      text: 'Approved. Export the handoff pack (MP4, captions, chapters, review notes).',
      tone: '',
    };
  }
  return { text: '', tone: '' };
}
