import type { RenderAction } from '@/desk/action';
import type { BayOverride } from '@/desk/store';

/**
 * What the Render bay's brief shows — the painting half of `renderActionCard`
 * in `kit/studio/app.js`, as a pure view.
 */

export interface CtaView {
  hidden: boolean;
  /** `data-mode`; undefined until the first summary paints it. */
  mode: string | undefined;
  label: string;
}

export interface BriefView {
  pillClass: string;
  pillText: string;
  headline: string;
  reason: string;
  /** `#renderReason[title]`; undefined until a summary paints it. */
  reasonTitle: string | undefined;
  primary: CtaView;
  secondary: CtaView;
}

const IDLE: BriefView = {
  pillClass: 'render-pill warn',
  pillText: 'Needs attention',
  headline: 'Select a sequence',
  reason: 'Choose a video, then render or queue jobs from here.',
  reasonTitle: undefined,
  primary: { hidden: false, mode: undefined, label: 'Render' },
  secondary: { hidden: true, mode: undefined, label: 'Other' },
};

function idleView(action: RenderAction): BriefView {
  if (!action.title) {
    return {
      pillClass: 'render-pill ok',
      pillText: 'Up to date',
      headline: 'Program matches your sources',
      reason: 'Watch it, give feedback, or approve the cut from the stage bar.',
      reasonTitle: '',
      primary: { hidden: false, mode: 'quick', label: 'Render again' },
      secondary: { ...IDLE.secondary, hidden: true },
    };
  }
  return {
    pillClass: `render-pill ${action.kind === 'ok' ? 'ok' : 'warn'}`,
    pillText: action.status,
    headline: action.title,
    reason: action.reason || '',
    reasonTitle: action.detail || '',
    primary: action.primary ? { hidden: false, mode: action.primary.mode, label: action.primary.label } : IDLE.primary,
    secondary: action.secondary
      ? { hidden: false, mode: action.secondary.mode, label: action.secondary.label }
      : { ...IDLE.secondary, hidden: true },
  };
}

/**
 * While a job runs the bay keeps the pipeline's own headline (`bay`, written by
 * `runMakePipeline` / `updateRenderLive`); only the pill says Rendering.
 */
export function briefView(action: RenderAction | null, { jobBusy, bay }: { jobBusy: boolean; bay: BayOverride | null }): BriefView {
  const base = action ? idleView(action) : IDLE;
  if (!jobBusy) return base;
  return {
    ...base,
    pillClass: bay?.pillClass || 'render-pill run',
    pillText: bay?.pillText || 'Rendering',
    headline: bay?.headline || base.headline,
    reason: bay ? bay.reason : base.reason,
  };
}
