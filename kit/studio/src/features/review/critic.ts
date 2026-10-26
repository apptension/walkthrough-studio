import type { CriticFinding, Job, Story } from '@/api/types';
import { api, enc } from '@/desk/api';
import { watchJob } from '@/desk/jobs';
import { showRightTab } from '@/desk/panels';
import { desk, IMPROVE_DEFAULT, setButtonBusy } from '@/desk/store';
import { toast } from '@/desk/toast';
import { loadVideo } from '@/desk/video';
import { noteField, startImprove } from '@/features/feedback/improve';
import { directorNoteForCritic, directorNoteForFinding } from '@/logic/criticFindings';

/** `runCriticFromStudio`, `btnCriticApply`, `fixFindingWithAi` and the story purpose picker from `kit/studio/app.js`. */

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Run the rule pass, then (when an agent is signed in) the critic agent, which watches the cut
 * and writes the review Story review shows. `agent: false` keeps it to the instant rule pass.
 */
export async function runCriticFromStudio({ force = true, agent = true }: { force?: boolean; agent?: boolean } = {}): Promise<void> {
  const slug = desk.get().slug ?? '';
  setButtonBusy('btnCriticRun', true);
  try {
    const r = await api<{ job?: Job | null }>(`/api/video/${enc(slug)}/critic`, { method: 'POST', body: { force, agent } });
    await loadVideo(slug);
    showRightTab('review');
    if (!r.job) {
      const n = desk.get().video?.critic?.findings?.length ?? 0;
      toast('Critic done', agent ? `${n} finding(s) from the rule pass — sign in an agent for a full review` : `${n} finding(s)`);
      return;
    }
    desk.set({ criticJob: r.job });
    const job = await watchJob(r.job.id, { onUpdate: (j) => desk.set({ criticJob: j }) });
    if (desk.get().slug !== slug) return;
    await loadVideo(slug);
    const critic = desk.get().video?.critic;
    toast('Critic review ready', `${job.critic?.findings ?? critic?.findings?.length ?? 0} finding(s)${critic?.agent?.score != null ? ` · ${critic.agent.score}/100` : ''}`);
  } catch (err) {
    if (errMessage(err) !== 'cancelled') toast('Critic failed', errMessage(err), 'err');
  } finally {
    desk.set({ criticJob: null });
    setButtonBusy('btnCriticRun', false);
  }
}

export async function cancelCriticReview(): Promise<void> {
  const id = desk.get().criticJob?.id;
  if (id) await api(`/api/jobs/${id}/cancel`, { method: 'POST', body: {} }).catch(() => {});
}

export async function applyCriticFixes(): Promise<void> {
  const slug = desk.get().slug ?? '';
  setButtonBusy('btnCriticApply', true);
  try {
    await api(`/api/video/${enc(slug)}/critic`, { method: 'POST', body: { force: true, apply: true } });
    await loadVideo(slug);
    toast('Safe fixes applied', 'High-confidence narration rewrites written to narration.mjs');
  } catch (err) {
    toast('Apply failed', errMessage(err), 'err');
  } finally {
    setButtonBusy('btnCriticApply', false);
  }
}

/** The plate a finding's target names (`intro.title`, `open.logo`, …), if any. */
export function plateForTarget(target: string): string | null {
  return (
    /^([a-z0-9-]+)\.(title|copy|items|steps)/.exec(target)?.[1] ||
    (/^(open|close)\./.test(target) ? (target.split('.')[0] ?? null) : null)
  );
}

/** Hand a critic finding to the agent as a director note. */
export function fixFindingWithAi(f: CriticFinding): void {
  const target = f.target ?? '';
  const note = directorNoteForFinding({
    target,
    issue: f.issue ?? '',
    persona: f.persona ?? '',
    suggestion: f.suggestion ?? '',
    frame: f.frame ?? null,
  });
  const plate = plateForTarget(target);
  desk.set((s) => ({
    improve: { ...s.improve, note, ...(plate ? { plateId: plate, goal: 'plates' } : {}) },
  }));
  showRightTab('feedback');
  startImprove(/^narration/.test(target) ? 'narration' : plate ? 'plates' : 'full');
}

/** Paste the critic report into the Feedback note so the user can edit, then Apply. */
export function fillNoteFromCritic(): boolean {
  const critic = desk.get().video?.critic;
  const note = directorNoteForCritic(critic);
  if (!note) {
    toast('No critic findings yet', 'Run the critic in Review, then bring the findings here', 'warn');
    return false;
  }
  const n = critic?.findings?.length ?? 0;
  desk.set((s) => ({
    improve: {
      ...s.improve,
      ...IMPROVE_DEFAULT,
      note,
      label: n <= 1 ? 'Apply critic finding' : `Apply ${n} critic findings`,
    },
    qcPending: [],
  }));
  showRightTab('feedback');
  queueMicrotask(() => {
    const el = noteField.el;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });
  toast('Critic findings loaded', 'Edit the note if you want, then Apply');
  return true;
}

/** `#storyPurpose` change: confirm the video's purpose so every agent pass follows one spine. */
export async function setStoryPurpose(purpose: string): Promise<Story | null> {
  if (!purpose) return null;
  try {
    const r = await api<{ story: Story }>(`/api/video/${enc(desk.get().slug ?? '')}/story`, {
      method: 'POST',
      body: { purpose },
    });
    desk.set((s) => (s.video ? { video: { ...s.video, story: r.story } } : {}));
    toast('Story spine set', r.story.framework);
    return r.story;
  } catch (err) {
    toast('Could not set purpose', errMessage(err), 'err');
    return null;
  }
}
