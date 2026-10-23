import { create } from 'zustand';

import type { Job } from '@/api/types';
import { fmt, elapsedSec } from '@/desk/format';
import { showRightTab } from '@/desk/panels';
import { runtime } from '@/desk/runtime';
import { desk } from '@/desk/store';
import { describeJob, type JobStage } from '@/logic/progress';

/**
 * The Feedback session rail (`#sessionRail`) as state: what `paintWork('session', job)`,
 * `showActivityDock`, `setSessionIdle`, `setThinkStep`, `showProposal` and `hideProposal`
 * in `kit/studio/app.js` wrote into the DOM. Writes are sticky the way the DOM was —
 * `setSessionIdle` leaves the bar and the stage list exactly as the last paint left them.
 */

export const THINK_ORDER = ['think', 'edit', 'html', 'preview', 'approve'] as const;
export type ThinkStep = (typeof THINK_ORDER)[number];

export const IDLE_TITLE = 'Agent’s off the clock 💤';
export const IDLE_META = 'Apply a note and its progress shows here.';

export interface ProposalStep {
  label: string;
  status: string;
}

export interface ProposalOpts {
  title?: string;
  reason?: string;
  steps?: ProposalStep[];
  review?: string;
  reviewLabel?: string;
  reviewDetail?: string | undefined;
}

export interface SessionView {
  /* —— #sessionRail —— */
  running: boolean;
  done: boolean;
  failed: boolean;
  decisionMode: boolean;
  showWork: boolean;

  /* —— #sessionProgress —— */
  idle: boolean;
  spinner: boolean;
  art: boolean;
  title: string;
  meta: string;
  phase: { text: string; className: string; hidden: boolean };
  now: { text: string; hidden: boolean };
  elapsed: { text: string; hidden: boolean };
  logButton: boolean;
  log: { text: string; hidden: boolean };
  /** `null` until the first paint: the bar has no width / aria-valuenow yet. */
  bar: { hidden: boolean; pct: number | null };
  stages: { hidden: boolean; list: JobStage[] };
  pipeHidden: boolean;
  streamJob: Job | null;

  /* —— #sessionPipe li —— */
  thinkStep: ThinkStep | null;
  thinkAllDone: boolean;

  /* —— #sessionDecide —— */
  decideOpen: boolean;
  decideAssertive: boolean;
  proposalTitle: string;
  proposalReason: string;
  proposalSteps: ProposalStep[];
  review: string | null;
  reviewLabel: string;
  reviewDetail: string;
  approvePlate: boolean;
  /** Bumps on every `showProposal` so the rail scrolls up and focuses the decision. */
  proposalSeq: number;
}

export function initialSessionView(): SessionView {
  return {
    running: false,
    done: false,
    failed: false,
    decisionMode: false,
    showWork: false,
    idle: true,
    spinner: false,
    art: true,
    title: IDLE_TITLE,
    meta: IDLE_META,
    phase: { text: '—', className: 'badge', hidden: true },
    now: { text: '', hidden: true },
    elapsed: { text: '0:00', hidden: true },
    logButton: false,
    log: { text: '', hidden: true },
    bar: { hidden: true, pct: null },
    stages: { hidden: true, list: [] },
    pipeHidden: false,
    streamJob: null,
    thinkStep: null,
    thinkAllDone: false,
    decideOpen: false,
    decideAssertive: false,
    proposalTitle: 'Ready to decide',
    proposalReason: 'Review the live plate in Program, then choose one path.',
    proposalSteps: [],
    review: null,
    reviewLabel: 'Review preview',
    reviewDetail: 'Bring the proposed plate into focus',
    approvePlate: false,
    proposalSeq: 0,
  };
}

export const useSession = create<SessionView>()(() => initialSessionView());

export const session = {
  get: useSession.getState,
  set: (patch: Partial<SessionView> | ((s: SessionView) => Partial<SessionView>)) => useSession.setState(patch),
  reset: () => useSession.setState(initialSessionView(), true),
};

/** `#sessionPipe li` classes for a step: `done` before the active one, `run` on it. */
export function thinkClass(step: ThinkStep, active: ThinkStep | null, allDone: boolean): string | undefined {
  const idx = active ? THINK_ORDER.indexOf(active) : -1;
  const i = THINK_ORDER.indexOf(step);
  const cls: string[] = [];
  if (idx >= 0) {
    if (i < idx) cls.push('done');
    else if (i === idx) cls.push('run');
  }
  if (allDone && !cls.includes('done')) cls.push('done');
  return cls.length ? cls.join(' ') : undefined;
}

export function setThinkStep(active: string | null): void {
  const step = (THINK_ORDER as readonly string[]).includes(active ?? '') ? (active as ThinkStep) : null;
  session.set({ thinkStep: step, thinkAllDone: false });
}

/** `#thinkSteps li, #sessionPipe li` all `done` — the Approve & render path. */
export function markThinkStepsDone(): void {
  session.set({ thinkAllDone: true });
}

export function setSessionIdle(): void {
  if (desk.get().proposalOpen) return;
  session.set({
    running: false,
    done: false,
    failed: false,
    spinner: false,
    title: IDLE_TITLE,
    meta: IDLE_META,
    art: true,
    idle: true,
    now: { text: '', hidden: true },
    elapsed: { ...session.get().elapsed, hidden: true },
    phase: { ...session.get().phase, hidden: true },
    logButton: false,
    streamJob: null,
    log: { text: '', hidden: true },
  });
}

export function resetThinkSteps(): void {
  session.set({ thinkStep: null, thinkAllDone: false });
  setSessionIdle();
}

/** `stopAllWork`: the rail says why it stopped. */
export function sessionStopped(reason: string): void {
  session.set({ title: reason, meta: 'Ready for new work', spinner: false });
}

/** `showActivityDock(job, { surface: 'session' })` → `paintWork('session', job)` and the rail's own extras. */
export function paintSession(job: Job): void {
  const s = desk.get();
  const view = describeJob(job);
  const status: string = job.status;
  const working = status === 'running' || status === 'queued' || status === 'cancelling' || status === 'waiting';
  const running = status === 'running' || status === 'queued';
  const failed = status === 'failed' || status === 'needs-agent';
  const done = status === 'done';
  const streamed = job.kind === 'improve' && (job.stream?.entries || []).length > 0;
  const nowHidden = !view.now || streamed || (view.stages.length > 0 && !failed);
  const pct = Math.round(view.progress * 100);
  const logText = (job.log || []).map((l) => l.line).join('\n').slice(-5000);
  const expanded = s.activityExpanded;
  const prev = session.get();

  session.set({
    running,
    done: done && !s.proposalOpen,
    failed,
    spinner: working,
    art: false,
    idle: false,
    title: view.title,
    meta: view.summary,
    phase: { text: view.statusLabel, className: `badge ${view.badge}`.trim(), hidden: false },
    now: { text: view.now, hidden: expanded ? true : nowHidden },
    bar: { hidden: !view.stages.length, pct },
    stages: { hidden: !view.stages.length, list: view.stages },
    pipeHidden: view.stages.length > 0,
    elapsed: { text: fmt(elapsedSec(job)), hidden: false },
    logButton: true,
    streamJob: job,
    log: { text: logText, hidden: expanded ? false : prev.log.hidden },
  });

  if (runtime.elapsedTimer) clearInterval(runtime.elapsedTimer);
  runtime.elapsedTimer = null;
  if (running) {
    runtime.elapsedTimer = setInterval(() => {
      const j = desk.get().job || job;
      session.set((v) => ({ elapsed: { ...v.elapsed, text: fmt(elapsedSec(j)) } }));
    }, 1000);
  }
}

/** The agent finished but plate HTML did not rebuild: keep the rail honest. */
export function markPlateHtmlFailed(msg: string): void {
  session.set({
    title: 'Plate HTML failed',
    meta: msg,
    now: { text: msg, hidden: false },
    phase: { text: 'FAILED', className: 'badge err', hidden: false },
    running: false,
    done: false,
    failed: true,
  });
}

export function showProposal(opts: ProposalOpts = {}): void {
  desk.set({ proposalOpen: true });
  const review = opts.review || 'preview';
  session.set((v) => ({
    decideOpen: true,
    decideAssertive: true,
    proposalTitle: opts.title || 'Ready to decide',
    proposalReason:
      opts.reason || 'Review live plate HTML in Program, then choose Discard, Approve plate, or Approve & render full.',
    proposalSteps: opts.steps || [],
    running: false,
    failed: false,
    done: true,
    decisionMode: true,
    showWork: false,
    review,
    reviewLabel: opts.reviewLabel || (review === 'script' ? 'Review script & voice' : 'Review preview'),
    reviewDetail:
      opts.reviewDetail || (review === 'script' ? 'Open the changed story and narration' : 'Bring the proposed plate into focus'),
    spinner: false,
    title: 'Preview ready',
    meta: 'Choose a path below',
    proposalSeq: v.proposalSeq + 1,
  }));
  showRightTab('feedback');
}

export function hideProposal(): void {
  desk.set({ proposalOpen: false });
  session.set({
    decideOpen: false,
    approvePlate: false,
    proposalSteps: [],
    decisionMode: false,
    showWork: false,
  });
  setSessionIdle();
}

export function setApprovePlateVisible(on: boolean): void {
  session.set({ approvePlate: on });
}

/** `#btnSessionLog`: show or fold the raw log under the rail. */
export function toggleSessionLog(): void {
  const expanded = !desk.get().activityExpanded;
  desk.set({ activityExpanded: expanded });
  session.set((v) => ({
    log: { ...v.log, hidden: !expanded },
    now: { ...v.now, hidden: expanded || !v.now.text },
  }));
}

/** `#btnProposalWork`: reveal the agent's work under the decision. Returns the new state. */
export function toggleProposalWork(): boolean {
  const expanded = !session.get().showWork;
  session.set({ showWork: expanded });
  return expanded;
}
