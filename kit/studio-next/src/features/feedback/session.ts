import { create } from 'zustand';

import type { Job } from '@/api/types';
import { fmtShort, elapsedSec } from '@/desk/format';
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

export const IDLE_TITLE = 'Waiting for a note';
export const IDLE_META = 'Apply a note and its progress shows here.';
export const IDLE_PHASE = { text: 'Idle', className: 'badge', hidden: false } as const;

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
  /** Lines the header barrel rolls through: what is happening now first, then where the run is. */
  ticker: string[];
  /** Raw log — only shown when the job has no stream or stages to tell its story. */
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
    phase: { ...IDLE_PHASE },
    now: { text: '', hidden: true },
    elapsed: { text: '0:00', hidden: true },
    ticker: [],
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
    phase: { ...IDLE_PHASE },
    ticker: [],
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
  session.set((v) => ({
    // The label says "Stopped"; the title keeps naming the job that was stopped.
    title: v.idle ? reason : v.title,
    meta: 'Ready for new work',
    spinner: false,
    phase: { text: 'Stopped', className: 'badge', hidden: false },
    ticker: [reason === 'Stopped' ? 'Ready for new work' : reason],
  }));
}

const PIPE_NOW: Record<ThinkStep, string> = {
  think: 'Thinking it through',
  edit: 'Editing the sources',
  html: 'Rebuilding plate HTML',
  preview: 'Preparing the preview',
  approve: 'Waiting for your decision',
};

function clip(text: string, max = 96): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** What the agent is doing this second, from the newest stream entry. */
function streamNow(job: Job): string {
  const last = (job.stream?.entries || []).at(-1);
  if (!last) return '';
  const text = clip(last.text.replace(/[`*]/g, '').split('\n').find((l) => l.trim()) || '');
  if (last.kind === 'tool') return clip([last.title || 'Tool', text].filter(Boolean).join(' · '));
  if (last.kind === 'think') return text ? `Thinking · ${text}` : 'Thinking…';
  return text;
}

/** Header barrel: live activity, then progress through the run. */
function tickerLines(job: Job, view: ReturnType<typeof describeJob>, working: boolean, step: ThinkStep | null): string[] {
  if (!working) return [clip(job.status === 'done' ? view.summary : view.now || view.summary)].filter(Boolean);
  const runIdx = view.stages.findIndex((s) => s.state === 'run');
  const runStage = runIdx >= 0 ? view.stages[runIdx] : undefined;
  const activity =
    streamNow(job) ||
    (runStage ? clip([runStage.label, runStage.detail].filter(Boolean).join(' · ')) : '') ||
    clip(view.now) ||
    clip(view.summary);
  const where = runStage
    ? `Step ${runIdx + 1} of ${view.stages.length} · ${runStage.label}`
    : step
      ? PIPE_NOW[step]
      : clip(view.summary);
  return [...new Set([activity, where].filter(Boolean))];
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
  const streamed = (job.stream?.entries || []).length > 0;
  const nowHidden = !view.now || (job.kind === 'improve' && streamed) || (view.stages.length > 0 && !failed);
  const pct = Math.round(view.progress * 100);
  const logText = (job.log || []).map((l) => l.line).join('\n').slice(-5000);

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
    now: { text: view.now, hidden: nowHidden },
    bar: { hidden: !view.stages.length, pct },
    stages: { hidden: !view.stages.length, list: view.stages },
    pipeHidden: view.stages.length > 0,
    elapsed: { text: fmtShort(elapsedSec(job)), hidden: false },
    ticker: tickerLines(job, view, working, session.get().thinkStep),
    streamJob: job,
    log: { text: logText, hidden: !logText || streamed || view.stages.length > 0 },
  });

  if (runtime.elapsedTimer) clearInterval(runtime.elapsedTimer);
  runtime.elapsedTimer = null;
  if (running) {
    runtime.elapsedTimer = setInterval(() => {
      const j = desk.get().job || job;
      session.set((v) => ({ elapsed: { ...v.elapsed, text: fmtShort(elapsedSec(j)) } }));
    }, 1000);
  }
}

/** The agent finished but plate HTML did not rebuild: keep the rail honest. */
export function markPlateHtmlFailed(msg: string): void {
  session.set({
    title: 'Plate HTML failed',
    meta: msg,
    now: { text: msg, hidden: false },
    phase: { text: 'Failed', className: 'badge bad', hidden: false },
    ticker: [clip(msg)],
    spinner: false,
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
    idle: false,
    art: false,
    phase: { text: 'Done', className: 'badge ok', hidden: false },
    title: v.idle ? 'Preview ready' : v.title,
    meta: v.idle ? 'Choose a path below' : v.meta,
    ticker: ['Open the run to see every step'],
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

/** The header chevron while deciding: reveal the agent's run under the decision. Returns the new state. */
export function toggleProposalWork(): boolean {
  const expanded = !session.get().showWork;
  session.set({ showWork: expanded });
  return expanded;
}
