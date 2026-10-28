import type { HtmlPlate, Job } from '@/api/types';
import { api, enc } from '@/desk/api';
import { bridges } from '@/desk/bridge';
import { ask } from '@/desk/ask';
import { continuePipelineAfterFix, enqueueJob, isCancelError, showActivityDock, watchJob } from '@/desk/jobs';
import { showRightTab } from '@/desk/panels';
import { runtime } from '@/desk/runtime';
import { desk, IMPROVE_DEFAULT, setButtonBusy, setStatus, type QueueItem } from '@/desk/store';
import { toast } from '@/desk/toast';
import { loadVideo } from '@/desk/video';

import { discardDraft } from './proposal';
import {
  hideProposal,
  markPlateHtmlFailed,
  resetThinkSteps,
  setApprovePlateVisible,
  setSessionIdle,
  setThinkStep,
  showProposal,
} from './session';

/**
 * The director note → agent pass: `startImprove`, `resetImproveTarget`,
 * `inferPlateIdFromFeedback` and `runImproveJob` from `kit/studio/app.js`.
 */

/** `#improveNote`, registered by the Feedback tab so an empty Apply can focus it. */
export const noteField: { el: HTMLTextAreaElement | null } = { el: null };

/** Return a plate only when the note itself names one; ambient UI selection never narrows smart scope. */
export function inferPlateIdFromFeedback(note: string): string | null {
  const n = String(note || '').toLowerCase();
  const scenes = desk.get().scenes.filter((s) => s.editable);

  for (const s of scenes) {
    const needles = [s.plateId, s.id, s.title, s.type].filter(Boolean).map((x) => String(x).toLowerCase());
    if (needles.some((k) => k.length >= 3 && n.includes(k))) return s.plateId;
  }

  if (/\b(intro(?:duction)?|opening|open plate|brand open)\b/.test(n)) return 'open';
  if (/\b(close|outro|ending|end plate|summary plate)\b/.test(n)) return 'close';

  // Logo size/position without a named plate → open (Introduction)
  if (/\b(logo|lockup)\b/.test(n) && /\b(small(?:er)?|big(?:ger)?|large(?:r)?|high(?:er)?|low(?:er)?|up|down|size|position)\b/.test(n)) {
    return 'open';
  }

  return null;
}

/** Drop a plate pinned by Ask AI, so the next note is not silently scoped to it. */
export function resetImproveTarget(): void {
  desk.set((s) => ({ improve: { ...s.improve, ...IMPROVE_DEFAULT } }));
}

/** Labels set by “Use critic findings” — revert when the note is edited. */
export function isCriticFillLabel(label: string): boolean {
  return /^Apply( \d+)? critic findings?$/.test(label.trim());
}

export function startImprove(goal = 'full'): void {
  const target = desk.get().improve;
  const note = (target.note || '').trim();
  if (!note) {
    toast('Add a director note', 'Describe what to change before Apply', 'warn');
    noteField.el?.focus();
    return;
  }
  // A plate is pinned only by the explicit “Ask AI” action. Merely viewing a plate must not
  // silently turn a broad director note into a one-plate edit.
  const pinnedPlate = target.plateId || null;
  const pinnedGoal = target.goal;
  const resolvedGoal = goal === 'full' && pinnedGoal && (pinnedGoal === 'scene' || pinnedGoal === 'motion') ? pinnedGoal : goal;
  const plateAware = ['full', 'plates', 'scene', 'motion'].includes(resolvedGoal);
  const plateId = plateAware ? pinnedPlate || inferPlateIdFromFeedback(note) : null;
  if (plateId) desk.set({ editingPlateId: plateId });
  const focus = (plateId && desk.get().scenes.find((s) => s.plateId === plateId)?.title) || plateId || resolvedGoal;
  enqueueJob({
    kind: 'improve',
    goal: resolvedGoal,
    note,
    plateId: plateId || null,
    motion: resolvedGoal === 'motion',
    label: `AI · ${focus}`,
  });
  resetImproveTarget();
}

interface DraftChanges {
  files?: string[];
  domains?: string[];
  labels?: string[];
}

function isPlate(value: unknown): value is Pick<HtmlPlate, 'id' | 'label'> {
  return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runImproveJob(item: QueueItem, { signal }: { signal?: AbortSignal } = {}): Promise<void> {
  hideProposal();
  resetThinkSteps();
  setThinkStep('think');
  desk.set({ activeSurface: 'session' });
  showRightTab('feedback');
  setButtonBusy('btnImprove', true);

  const sig = signal || runtime.workAbort?.signal;
  if (sig?.aborted) throw new Error('cancelled');

  const target = item.slug || desk.get().slug;
  if (!target) throw new Error('No sequence selected');
  const goal = item.goal || 'full';
  const note = item.note || '';
  const plateId = item.plateId || null;
  if (plateId) desk.set({ editingPlateId: plateId });

  const focusLabel = plateId ? desk.get().scenes.find((s) => s.plateId === plateId)?.title || plateId : goal;

  let r: { job: Job };
  if (plateId && (goal === 'scene' || goal === 'motion' || item.motion)) {
    r = await api<{ job: Job }>(`/api/video/${enc(target)}/scenes/${enc(plateId)}/improve`, {
      method: 'POST',
      body: { note, goal: item.motion || goal === 'motion' ? 'motion' : 'scene' },
    });
  } else {
    r = await api<{ job: Job }>(`/api/video/${enc(target)}/improve`, {
      method: 'POST',
      body: { goal, note, snapshot: true, plateId: plateId || undefined },
    });
  }

  const job = r.job;
  if (job.status === 'needs-agent') {
    showActivityDock(job, { surface: 'session' });
    const claude = job.provider === 'claude' || /claude/i.test(job.message || '');
    toast(claude ? 'Sign in to Claude Code' : 'Sign in to Cursor CLI', claude ? 'claude → /login, then retry' : 'agent login, then retry', 'warn');
    resetThinkSteps();
    return;
  }

  toast('Studio is thinking…', focusLabel);
  setStatus('run', plateId ? `Editing ${focusLabel}…` : 'Agent working on feedback…');
  setThinkStep('edit');

  try {
    await watchJob(job.id, {
      surface: 'session',
      signal: sig,
      onUpdate: (j) => {
        showActivityDock(j, { surface: 'session' });
        if (j.phase === 'thinking') setThinkStep('think');
        else if (j.phase === 'tool' || j.phase === 'writing') setThinkStep('edit');
      },
    });
  } catch (err) {
    if (isCancelError(err)) {
      resetThinkSteps();
      throw err;
    }
    if (/needs-agent/i.test(errorMessage(err))) toast('Auth needed', 'agent login', 'warn');
    else toast('Feedback failed', errorMessage(err), 'err');
    resetThinkSteps();
    throw err;
  }

  try {
    const changes = await api<DraftChanges>(`/api/video/${enc(target)}/draft/changes`).catch(
      (): DraftChanges => ({ files: [], domains: [], labels: [] }),
    );
    const domains = new Set(changes.domains || []);
    const targetId = plateId || null;
    const needsPlatePreview = ['plates', 'brand', 'motion'].some((domain) => domains.has(domain));
    let plate: Pick<HtmlPlate, 'id' | 'label'> | null = null;
    const stillHere = target === desk.get().slug;
    if (stillHere) {
      if (needsPlatePreview || targetId) {
        const shown: unknown = await bridges.plate?.previewPlateAfterEdit(targetId ?? '');
        plate = isPlate(shown) ? shown : null;
      } else {
        const slug = desk.get().slug;
        if (slug) await loadVideo(slug);
      }
    }

    const labels = changes.labels?.length ? changes.labels : [focusLabel === 'full' ? 'Coordinated video pass' : focusLabel];
    setThinkStep('approve');
    desk.set({ motionApplied: domains.has('motion') || domains.has('brand'), platesPreviewed: Boolean(plate) });

    // Pipeline Fix: apply the draft and resume from the failed step without a second click.
    // Bound to the job's slug so switching projects mid-fix still continues the right sequence.
    if (item.resumePipeline?.fromStep) {
      await continuePipelineAfterFix(item.resumePipeline);
      return;
    }

    if (!stillHere) {
      toast('Done on another sequence', `${target} · switch back to review`, 'ok');
      return;
    }
    const scriptReview = ['script', 'voice', 'timing', 'journey'].some((domain) => domains.has(domain));
    const directionReview = !scriptReview && ['brand', 'motion'].some((domain) => domains.has(domain)) && !plate;

    showProposal({
      title:
        labels.length > 1 ? 'Review coordinated changes' : plate ? `Review “${plate.label || plate.id}”` : `Review ${labels[0]}`,
      reason: scriptReview
        ? `${labels.join(' · ')} changed. Review the script and narration; any updated plate is already live in Program.`
        : plate
          ? `${labels.join(' · ')} changed. The live plate is replaying in Program.`
          : `${labels.join(' · ')} changed. Review the focused settings before approving.`,
      review: scriptReview ? 'script' : directionReview ? 'direction' : 'preview',
      reviewLabel: scriptReview
        ? plate
          ? 'Review script + preview'
          : 'Review script & voice'
        : directionReview
          ? 'Review brand direction'
          : 'Review preview',
      reviewDetail: scriptReview
        ? plate
          ? 'Open the words; the live plate remains in Program'
          : 'Open the changed story and narration'
        : undefined,
      steps: [
        ...labels.map((label) => ({ label, status: 'done' })),
        ...(plate ? [{ label: 'Live preview rebuilt', status: 'done' }] : []),
        { label: 'Awaiting your decision', status: 'run' },
      ],
    });
    setApprovePlateVisible(Boolean(targetId && plate));
    toast('Changes ready to review', labels.join(' · '));
  } catch (err) {
    setThinkStep('html');
    const msg = errorMessage(err);
    markPlateHtmlFailed(msg);
    const choice = await ask({
      kind: 'choice',
      title: 'Plate HTML failed',
      detail: `${msg}\n\nYour script changes are saved. Choose how to continue.`,
      tone: 'warn',
      options: [
        { value: 'review', label: 'Review script anyway', hint: 'Open the changed story without a live plate preview' },
        { value: 'retry', label: 'Retry rebuild', hint: 'Try building plate HTML again' },
        { value: 'discard', label: 'Discard changes', hint: 'Restore the previous sources' },
      ],
      ok: 'Continue',
      cancel: 'Dismiss',
    });
    if (choice === 'discard') {
      await discardDraft();
      setSessionIdle();
      return;
    }
    if (choice === 'retry') {
      try {
        const shown = await bridges.plate?.previewPlateAfterEdit(plateId ?? '');
        const retried = isPlate(shown) ? shown : null;
        if (retried) {
          showProposal({
            title: `Review “${retried.label || retried.id}”`,
            reason: 'Plate HTML rebuilt after retry.',
            steps: [{ label: 'Live preview rebuilt', status: 'done' }, { label: 'Awaiting your decision', status: 'run' }],
          });
          setApprovePlateVisible(Boolean(plateId));
          toast('Preview ready', retried.label || retried.id);
          return;
        }
      } catch (retryErr) {
        toast('Retry failed', errorMessage(retryErr), 'err');
        markPlateHtmlFailed(errorMessage(retryErr));
      }
    }
    if (choice === 'review' || choice === 'retry') {
      const labels = (await api<DraftChanges>(`/api/video/${enc(target)}/draft/changes`).catch((): DraftChanges => ({}))).labels || [
        focusLabel === 'full' ? 'Coordinated video pass' : focusLabel,
      ];
      showProposal({
        title: 'Review script changes',
        reason: scriptReviewReason(labels, msg),
        review: 'script',
        reviewLabel: 'Review script & voice',
        reviewDetail: 'Plate HTML did not rebuild — fix layouts in config or retry from Feedback',
        steps: [
          ...labels.map((label) => ({ label, status: 'done' as const })),
          { label: 'Plate HTML needs attention', status: 'run' as const },
        ],
      });
      setApprovePlateVisible(false);
      toast('Review script', 'Approve only after the words read right');
      return;
    }
    toast('HTML rebuild failed', msg, 'err');
    setStatus('warn', 'Sources changed — rebuild failed');
    throw err;
  }
}

function scriptReviewReason(labels: string[], err: string): string {
  return `${labels.join(' · ')} changed, but plate HTML failed (${err}). Review the script; rebuild plates from Direction or retry here.`;
}
