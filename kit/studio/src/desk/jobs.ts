import type { Job, VideoSummary } from '@/api/types';
import { confirmGuidedFits } from '@/logic/guidedFit';
import { asText } from '@/logic/text';
import {
  guidedBranchFor,
  guidedSteps,
  improveGoalForStep,
  pipelineFixNote,
  shouldRunStep,
  statusesForResume,
} from '@/logic/pipelineUi';
import { pipelineOverlay } from '@/logic/programBuild';
import { describeJob } from '@/logic/progress';
import { shouldEnqueue } from '@/logic/queueUx';
import { normalizeMonitorMode } from '@/logic/monitorMode';
import { rememberedTakeChoice } from '@/logic/takeChoice';

import { decideAction } from './action';
import { api, enc } from './api';
import { ask } from './ask';
import { bridges } from './bridge';
import { setFaviconMode } from './marks';
import { paintLivePreview, paintProgramBuild, paintSignInWait, publishProgramStep, setMonitorMode } from './monitor';
import { setRenderMode, showLeftTab, showRightTab } from './panels';
import { runtime } from './runtime';
import { requestJsonOrNull } from '@/api/client';
import {
  desk,
  setButtonBusy,
  clearRunStatus,
  setStatus,
  type QueueItem,
  type StepStatus,
  type Surface,
} from './store';
import { toast } from './toast';
import { loadVideo } from './video';

/**
 * The job queue and the make pipeline — `enqueueJob`, `drainQueue`,
 * `watchJob`, `stopAllWork` and `runMakePipeline` from `kit/studio/app.js`.
 * One kit/agent job runs at a time; everything else waits in `queue`.
 */

const RENDER_BUTTONS = ['btnMake', 'btnActionPrimary', 'btnActionSecondary', 'btnNoVideoPrimary', 'btnNoVideoSecondary'];

export function isCancelError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : asText(err || '');
  return /cancelled|canceled|aborted|stopped/i.test(m);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `OutputBusyError` from `kit/lib/outputLock.mjs`: another step still holds the output files
 * this one needs. The usual cause is a step we just cancelled — the kill signal landed, but the
 * process hasn't actually exited (and freed its lock) yet. The message names the step and pid so
 * a person could tell them apart from a real failure, but to the UI they all read the same way.
 */
function isOutputBusyError(err: unknown): boolean {
  return /already running for .* \(pid \d+/i.test(errorMessage(err));
}

/** In-flight job states — `waitForJobsToSettle` polls until none of `ids` are still in one. */
const PENDING_STATUS = new Set(['running', 'queued', 'cancelling', 'waiting']);

/**
 * After cancelling, wait for the server to confirm the kill actually landed before this video's
 * output locks can be considered free. `cancelJob` only *sends* SIGTERM (then SIGKILL after a
 * grace period) and returns — the lock isn't released until the child's `close` event fires and
 * `finalizeCancelled` runs. Starting the next step before that can lose the race and throw
 * `OutputBusyError` for a resource the stopped job hasn't let go of yet.
 */
async function waitForJobsToSettle(ids: string[], { timeoutMs = 4000, intervalMs = 150 } = {}): Promise<void> {
  if (!ids.length) return;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const jobs = await Promise.all(ids.map((id) => api<Job>(`/api/jobs/${id}`).catch(() => null)));
    if (jobs.every((j) => !j?.status || !PENDING_STATUS.has(j.status))) return;
    if (Date.now() >= deadline) return;
    await sleep(intervalMs);
  }
}

function beginWorkAbort(): AbortSignal {
  try {
    runtime.workAbort?.abort();
  } catch {
    /* ignore */
  }
  runtime.workAbort = new AbortController();
  return runtime.workAbort.signal;
}

export type EnqueueInput = Partial<Omit<QueueItem, 'qid' | 'label' | 'kind'>> & {
  label: string;
  kind: QueueItem['kind'];
};

export function enqueueJob(item: EnqueueInput, { silent = false } = {}): QueueItem | null {
  const s = desk.get();
  const entry: QueueItem = {
    qid: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    // Bind the sequence at enqueue time — switching projects mid-queue must not retarget the job.
    slug: item.slug || s.slug || null,
    label: item.label,
    kind: item.kind,
    mode: item.mode,
    step: item.step,
    force: item.force,
    goal: item.goal,
    note: item.note,
    plateId: item.plateId,
    motion: item.motion,
    presets: item.presets,
    fromStep: item.fromStep || null,
    resumePipeline: item.resumePipeline || null,
  };
  if (!entry.slug) {
    toast('No sequence open', 'Pick a project before queuing work', 'warn');
    return null;
  }
  if (!shouldEnqueue(s.queue, entry)) {
    toast('Already waiting', entry.label, 'warn');
    return null;
  }
  desk.set({ queue: [...s.queue, entry] });
  if (!silent) {
    const when = s.jobBusy ? 'after current job' : 'starting…';
    toast(s.jobBusy ? 'Queued' : 'Starting', `${entry.label} · ${when}`);
  }
  if (entry.kind === 'improve') showRightTab('feedback');
  else showLeftTab('render');
  void drainQueue();
  return entry;
}

export function removeQueued(qid: string): void {
  desk.set((s) => ({ queue: s.queue.filter((q) => q.qid !== qid) }));
}

export function clearQueue(): void {
  desk.set({ queue: [] });
}

/**
 * Stop the running job (agent/kit), clear the queue, abort local watchers.
 */
export async function stopAllWork({ reason = 'Stopped', silent = false } = {}): Promise<void> {
  desk.set({ stopRequested: true, queue: [], running: null });
  try {
    runtime.workAbort?.abort();
  } catch {
    /* ignore */
  }
  // The watcher bails out on abort and never paints the take as finished, so the
  // Live tab would keep the last frame. Drop it before waiting for the process to die.
  clearLiveCapture();
  const id = desk.get().jobId;
  let settling: string[] = [];
  try {
    if (id) {
      const r = await api<{ job?: Job }>(`/api/jobs/${id}/cancel`, { method: 'POST', body: {} });
      settling = [r?.job?.id || id];
    } else {
      const r = await api<{ jobs?: Job[] }>('/api/jobs/cancel-all', { method: 'POST', body: {} });
      settling = (r?.jobs || []).map((j) => j.id).filter(Boolean);
    }
  } catch {
    /* ignore — process may already be gone */
  }
  // Don't let the queue (or a quick re-click) claim this video's output locks until the
  // kill actually landed — see `waitForJobsToSettle`.
  await waitForJobsToSettle(settling);
  desk.set({ jobBusy: false, activeSurface: null, pipelineStartedAt: null });
  // A stopped run has nothing left to show; a failed one stays for Retry / Fix.
  if (!desk.get().pipelineFailure) {
    desk.set({ pipeline: null });
    paintProgramBuild(pipelineOverlay({ running: false }));
  }
  hideActivityDock();
  for (const b of ['btnExport', 'btnImprove', ...RENDER_BUTTONS]) setButtonBusy(b, false);
  setRenderMode(false);
  setStatus('warn', reason);
  setRenderIdle();
  bridges.feedback?.sessionStopped?.(reason);
  if (!silent) toast(reason, 'Running job stopped · queue cleared', 'warn');
}

export async function drainQueue(): Promise<void> {
  const s = desk.get();
  if (s.jobBusy) return;
  if (s.stopRequested) {
    desk.set({ stopRequested: false });
    return;
  }
  const [next, ...rest] = s.queue;
  desk.set({ queue: rest });
  if (!next) return;
  desk.set({ jobBusy: true, running: next, stopRequested: false });
  const signal = beginWorkAbort();
  const isRender = next.kind === 'make' || next.kind === 'step';
  if (isRender) {
    const fav =
      next.kind === 'make' && (next.mode === 'full' || next.mode === 'guided')
        ? 'record'
        : next.kind === 'step' && next.step === 'deliver'
          ? 'export'
          : next.kind === 'step' && next.step === 'record'
            ? 'record'
            : 'render';
    setRenderMode(true, fav);
  } else if (next.kind === 'improve') {
    setFaviconMode('draft');
  }
  try {
    if (next.kind === 'make') {
      await runMakePipeline(next.mode, { signal, slug: next.slug, fromStep: next.fromStep || null });
    } else if (next.kind === 'step') {
      setStatus('run', `${next.label}…`);
      setButtonBusy('btnExport', next.step === 'deliver');
      updateRenderLive({
        id: '',
        status: 'running',
        kind: 'kit' as Job['kind'],
        step: next.step ?? '',
        slug: next.slug || desk.get().slug || '',
        activity: '',
        startedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        log: [],
      });
      await runJobPromise(next.step ?? '', next.force, { signal, presets: next.presets, slug: next.slug });
      if (signal.aborted || desk.get().stopRequested) throw new Error('cancelled');
      const stillHere = !next.slug || next.slug === desk.get().slug;
      const slug = desk.get().slug;
      if (next.step === 'export') {
        if (stillHere && slug) await loadVideo(slug);
        setFaviconMode('ok');
        toast('Formats ready', `${desk.get().video?.exports?.length || 0} file(s) in Deliver · run Export to add them to the zip`, 'ok');
      } else if (next.step === 'deliver') {
        if (stillHere && slug) await loadVideo(slug);
        setFaviconMode('ok');
        toast(
          'Export ready',
          desk.get().video?.handoffZipUrl ? 'Pack + zip ready — Download on the Deliver tab' : 'deliverables/ folder updated',
        );
      } else {
        setFaviconMode('ok');
        toast('Done', next.label);
        if (stillHere && slug) {
          await loadVideo(slug);
          if (next.step === 'audio' || next.step === 'music' || next.step === 'mix') await bridges.editor?.refresh();
        }
      }
    } else if (next.kind === 'improve') {
      if (!bridges.feedback) throw new Error('Feedback rail is not mounted');
      await bridges.feedback.runImproveJob(next, { signal });
      setFaviconMode('ok');
    }
  } catch (err) {
    if (isCancelError(err) || desk.get().stopRequested) {
      setStatus('warn', 'Stopped');
      if (!desk.get().stopRequested) toast('Stopped', next.label, 'warn');
      setFaviconMode('idle');
    } else {
      toast(next.label, errorMessage(err), 'err');
      setStatus('warn', 'Job failed');
      setFaviconMode('err');
    }
  } finally {
    desk.set({ jobBusy: false, running: null, activeSurface: null });
    setButtonBusy('btnExport', false);
    setButtonBusy('btnMake', false);
    setButtonBusy('btnImprove', false);
    if (!desk.get().queue.length) setRenderMode(false);
    const v = desk.get().video;
    if (v) desk.set({ action: decideAction(v) });
    clearRunStatus();
    if (desk.get().stopRequested) {
      desk.set({ stopRequested: false, queue: [] });
    } else {
      void drainQueue();
    }
  }
}

interface WatchOpts {
  onUpdate?: (job: Job) => void;
  surface?: Surface;
  signal?: AbortSignal | undefined;
  quiet?: boolean | undefined;
}

/** Poll one server job without stealing another waiter's timer. */
export function watchJob(jobId: string, opts: WatchOpts = {}): Promise<Job> {
  const surface = opts.surface || 'render';
  const signal = opts.signal || runtime.workAbort?.signal;
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const finish = <A>(fn: (arg: A) => void, arg: A) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn(arg);
    };
    const onAbort = () => {
      finish(reject, new Error('cancelled'));
      if (jobId) api(`/api/jobs/${jobId}/cancel`, { method: 'POST', body: {} }).catch(() => {});
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort);
    const tick = async () => {
      try {
        if (signal?.aborted || desk.get().stopRequested) {
          finish(reject, new Error('cancelled'));
          return;
        }
        const job = await api<Job>(`/api/jobs/${jobId}`);
        if (signal?.aborted || desk.get().stopRequested) {
          finish(reject, new Error('cancelled'));
          return;
        }
        if (opts.quiet) {
          if (job.status === 'done') finish(resolve, job);
          else if (job.status === 'failed' || job.status === 'needs-agent' || job.status === 'cancelled') {
            finish(reject, new Error(job.message || job.status));
          }
          return;
        }
        desk.set({ job, jobId });
        const question = job.question;
        if (question && runtime.jobAsk !== question.id) {
          runtime.jobAsk = question.id;
          const answer = await ask({
            kind: question.field === 'confirm' ? 'confirm' : 'prompt',
            job: true,
            secret: question.field === 'password',
            title: question.prompt,
            label: question.field === 'password' ? 'Password' : 'Email',
            ok: 'Continue',
          });
          await api(`/api/jobs/${jobId}/answer`, {
            method: 'POST',
            body: { cancel: answer == null, value: answer },
          }).catch(() => {});
        }
        // Stop can land while a sign-in question is open. The job object above is
        // still "running", and painting it would put the frozen Live pane back.
        if (settled || signal?.aborted || desk.get().stopRequested) return;
        if (opts.onUpdate) opts.onUpdate(job);
        else showActivityDock(job, { surface });
        paintCapture(job, jobId);
        if (
          job.status === 'done' ||
          job.status === 'failed' ||
          job.status === 'needs-agent' ||
          job.status === 'cancelled' ||
          job.status === 'waiting'
        ) {
          if (job.status === 'done') finish(resolve, job);
          else if (job.status !== 'waiting') finish(reject, new Error(job.message || job.status));
        }
      } catch (err) {
        finish(reject, err);
      }
    };
    // Each read waits for the previous one to land. On a fixed interval a job whose read takes
    // longer than the gap — or one parked on a sign-in question — queued another request every
    // 700ms behind the one still in flight, so the slowest jobs hammered the server hardest.
    const pump = async () => {
      await tick();
      if (!settled) timer = setTimeout(() => void pump(), 700);
    };
    void pump();
  });
}

/**
 * Leave Live. Stop aborts the job watcher before its next poll can paint the take
 * as finished, and a preview poll already in flight must not be able to put it back.
 */
function clearLiveCapture(): void {
  desk.set({ liveWarmupKey: null, liveWarmingUp: false });
  paintSignInWait(null);
  const video = desk.get().video;
  if (video) {
    paintLivePreview(video, { recording: false, repairing: false, warmingUp: false });
    return;
  }
  desk.set((s) => ({
    live: {
      ...s.live,
      recording: false,
      repairing: false,
      warming: false,
      badge: null,
      tab: false,
      onAir: false,
      thumb: false,
    },
  }));
  if (desk.get().monitorMode === 'live') setMonitorMode('program', { keepPreview: true });
}

/** The live capture frame, the warm-up blur and the sign-in wait while a record job runs. */
function paintCapture(job: Job, jobId: string): void {
  const s = desk.get();
  const v = s.video;
  if (!v?.slug) return;
  const recordJob = job.step === 'record' && (job.status === 'running' || job.status === 'waiting');
  const repairing = recordJob && job.phase === 'repairing';
  const recording = recordJob && !repairing;
  const video = { ...v, previewUrl: v.previewUrl || `/media/${v.slug}/live-preview.jpg` };
  desk.set({ video });
  if (recording) {
    // A new take (or a re-take after repair) reuses the same jpg path — reset to
    // "warming up" the moment this attempt begins so a stale frame never free-rides.
    const attemptKey = `${jobId}:${job.captureStartedAt || job.startedAt || ''}`;
    if (s.liveWarmupKey !== attemptKey) desk.set({ liveWarmupKey: attemptKey, liveWarmingUp: true });
    paintLivePreview(video, { recording, repairing, warmingUp: desk.get().liveWarmingUp });
    const baseline = Number(Date.parse(String(job.captureStartedAt || job.startedAt))) || 0;
    void requestJsonOrNull<{ at?: number }>(`/media/${video.slug}/live-preview.json?t=${Date.now()}`).then((meta) => {
      if (desk.get().liveWarmupKey !== attemptKey) return;
      desk.set({ liveWarmingUp: !((meta?.at ?? 0) > baseline) });
      paintLivePreview(desk.get().video, { recording, repairing, warmingUp: desk.get().liveWarmingUp });
    });
    void requestJsonOrNull<{ title?: string; next?: string }>(`/media/${video.slug}/sign-in-wait.json?t=${Date.now()}`).then(
      (wait) => {
        if (desk.get().liveWarmupKey !== attemptKey) return;
        paintSignInWait(wait);
      },
    );
  } else {
    desk.set({ liveWarmupKey: null });
    paintLivePreview(video, { recording, repairing, warmingUp: false });
    paintSignInWait(null);
  }
}

/* ------------------------------------------------------------- activity */

/** Fill the Render bay's Activity card from a job (`updateRenderLive`). */
export function updateRenderLive(job: Job | null): void {
  if (!job) return;
  desk.set({ renderJob: job });
  if (job.status === 'running' || job.status === 'queued') {
    const view = describeJob(job);
    desk.set({ bay: { pillClass: 'render-pill run', pillText: view.statusLabel, headline: view.title, reason: view.summary } });
  }
}

/** Reset the Render bay's Activity card to idle (`setRenderIdle`). */
export function setRenderIdle(): void {
  desk.set({ renderJob: null, renderLogExpanded: false });
}

export function hideActivityDock(): void {
  desk.set({ hasActivity: false });
  if (runtime.elapsedTimer) clearInterval(runtime.elapsedTimer);
  const s = desk.get();
  if (!s.jobBusy) setRenderIdle();
  if (!s.proposalOpen) bridges.feedback?.setSessionIdle();
}

export function showActivityDock(job: Job, { surface }: { surface?: Surface } = {}): void {
  const s = desk.get();
  if (s.activityDismissed && job.status !== 'running' && job.status !== 'queued') return;
  if (job.status === 'running' || job.status === 'queued') desk.set({ activityDismissed: false });
  const running = job.status === 'running' || job.status === 'queued';
  const isImprove = job.kind === 'improve';
  const resolved = surface || s.activeSurface || (isImprove ? 'session' : 'render');

  // Never let agent progress overwrite the Render bay while a pipeline is active
  if (resolved === 'render' && !isImprove) {
    updateRenderLive(job);
    showLeftTab('render');
    setRenderMode(running || desk.get().jobBusy);
  }
  if (resolved === 'session' || isImprove) showRightTab('feedback');
  if (resolved !== 'session' && !isImprove) return;
  desk.set({ hasActivity: true, sessionJob: job });
}

/* -------------------------------------------------------------- running */

/** How many times a step retries after losing a race for an output lock it just freed itself. */
const OUTPUT_BUSY_RETRIES = 3;

export async function runJobPromise(
  step: string,
  force: boolean | undefined = false,
  { signal, presets, slug, quiet }: { signal?: AbortSignal | undefined; presets?: string[] | undefined; slug?: string | null | undefined; quiet?: boolean } = {},
): Promise<Job> {
  desk.set({ activeSurface: 'render' });
  if (signal?.aborted) throw new Error('cancelled');
  const target = slug || desk.get().slug;
  if (!target) throw new Error('No sequence selected');
  for (let attempt = 0; ; attempt++) {
    const r = await api<{ job: Job }>(`/api/video/${enc(target)}/run`, { method: 'POST', body: { step, force, presets } });
    try {
      return await watchJob(r.job.id, { surface: 'render', signal, quiet });
    } catch (err) {
      // The output lock this step needs was just freed by a job we cancelled a moment ago —
      // `stopAllWork` already waits for that, but a step started outside it (another tab, a
      // bare `kit` run) can still lose this race. Retry rather than surface a scary error for
      // what is really "almost ready".
      if (attempt >= OUTPUT_BUSY_RETRIES || !isOutputBusyError(err) || signal?.aborted || desk.get().stopRequested) throw err;
      await sleep(500 * (attempt + 1));
    }
  }
}

export function requestMake(mode?: string): void {
  const s = desk.get();
  const v = s.video;
  if (!v) return;
  const action = s.action || decideAction(v);
  const resolved = mode || action.primary?.mode || 'quick';
  const label =
    resolved === 'guided'
      ? 'Record it yourself'
      : resolved === 'full'
        ? 'Re-record & render full'
        : resolved === 'plates'
          ? 'Re-render brand plates'
          : 'Render sequence';
  enqueueJob({ kind: 'make', mode: resolved, label });
}

export function exportPack(): void {
  enqueueJob({ kind: 'step', step: 'deliver', force: false, label: 'Export handoff pack' });
  showLeftTab('deliver');
}

function jobLogText(job: Job | null): string {
  const log = job?.log;
  if (!log?.length) return '';
  return log
    .map((l) => (typeof l === 'string' ? l : l.line || ''))
    .filter(Boolean)
    .join('\n');
}

function setStep(id: string, status: StepStatus): void {
  desk.set((s) => (s.pipeline ? { pipeline: s.pipeline.map((p) => (p.id === id ? { ...p, status } : p)) } : {}));
}

function rememberPipelineFailure(f: { mode: string; slug: string | null; stepId: string; label: string; error: string; log: string }): void {
  desk.set({
    pipelineFailure: {
      mode: f.mode || 'quick',
      slug: f.slug || desk.get().slug,
      stepId: f.stepId,
      label: f.label || f.stepId,
      error: String(f.error || ''),
      log: f.log || '',
    },
  });
}

function clearPipelineFailure(): void {
  if (desk.get().pipelineFailure) desk.set({ pipelineFailure: null });
}

export function retryPipelineFrom(stepId?: string): void {
  const s = desk.get();
  const fail = s.pipelineFailure;
  if (!fail || s.jobBusy) {
    toast(s.jobBusy ? 'Busy' : 'Nothing to retry', s.jobBusy ? 'Wait for the current job' : 'Run a render first', 'warn');
    return;
  }
  const from = stepId || fail.stepId;
  enqueueJob({ kind: 'make', mode: fail.mode || 'quick', fromStep: from, slug: fail.slug || s.slug, label: `Retry · ${fail.label || from}` });
}

export function fixPipelineStep(stepId?: string): void {
  const s = desk.get();
  const fail = s.pipelineFailure;
  if (!fail) {
    toast('Nothing to fix', 'No failed pipeline step', 'warn');
    return;
  }
  const from = stepId || fail.stepId;
  const note = pipelineFixNote({ ...fail, stepId: from });
  desk.set((st) => ({ improve: { ...st.improve, note } }));
  const goal = improveGoalForStep(from);
  showRightTab('feedback');
  enqueueJob({
    kind: 'improve',
    goal,
    note,
    slug: fail.slug || s.slug,
    label: `Fix · ${fail.label || from}`,
    resumePipeline: { mode: fail.mode || 'quick', fromStep: from, slug: fail.slug || s.slug, label: fail.label || from },
  });
  toast('Fixing with AI', `${fail.label || from} · then continue the pipeline`);
}

export async function continuePipelineAfterFix(resume: QueueItem['resumePipeline']): Promise<void> {
  if (!resume?.fromStep) return;
  const slug = resume.slug || desk.get().slug;
  if (slug) await api(`/api/video/${enc(slug)}/draft/approve`, { method: 'POST', body: {} }).catch(() => {});
  bridges.feedback?.hideProposal();
  bridges.feedback?.resetThinkSteps();
  desk.set({ editingPlateId: null });
  showLeftTab('render');
  enqueueJob({
    kind: 'make',
    mode: resume.mode || 'quick',
    fromStep: resume.fromStep,
    slug: resume.slug || desk.get().slug,
    label: `Continue · ${resume.label || resume.fromStep}`,
  });
  toast('Fixed', `Continuing from ${resume.label || resume.fromStep}`);
}

/** One agent pass inside a make pipeline: edit the sources, then accept the draft so the next step reads them. */
async function runPipelineAgentGoal(goal: string, slug: string, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) throw new Error('cancelled');
  const r = await api<{ job: Job }>(`/api/video/${enc(slug)}/improve`, { method: 'POST', body: { goal, snapshot: true } });
  if (r.job?.status === 'needs-agent') {
    throw new Error(r.job.message || 'Agent sign-in is required — sign in to the agent, then retry this step');
  }
  await watchJob(r.job.id, { surface: 'render', signal });
  await api(`/api/video/${enc(slug)}/draft/approve`, { method: 'POST', body: {} }).catch(() => {});
  if (slug === desk.get().slug) await loadVideo(slug).catch(() => {});
}

function setBay(pillText: string, headline: string, reason: string): void {
  desk.set({ bay: { pillClass: 'render-pill run', pillText, headline, reason } });
}

export async function runMakePipeline(
  mode: string | undefined,
  { signal, slug: boundSlug, fromStep = null }: { signal?: AbortSignal; slug?: string | null; fromStep?: string | null } = {},
): Promise<void> {
  const target = boundSlug || desk.get().slug;
  const current = desk.get().video;
  const v =
    current?.slug === target
      ? current
      : target
        ? await api<VideoSummary>(`/api/video/${enc(target)}`).catch(() => null)
        : null;
  if (!v && !target) return;
  if (!target) return;
  const resolved = mode || 'quick';
  const guided = resolved === 'guided';
  const record = resolved === 'full' || guided;
  const platesOnly = resolved === 'plates';
  const sig = signal || runtime.workAbort?.signal;
  const resuming = Boolean(fromStep);

  let steps: Array<{ id: string; label: string }> = platesOnly
    ? [
        { id: 'plates', label: 'Render brand plates' },
        { id: 'preview', label: 'Refresh Program' },
      ]
    : guided
      ? guidedSteps(guidedBranchFor(fromStep, rememberedTakeChoice(target)))
      : [
          ...(record ? [{ id: 'record', label: 'Record walkthrough' }] : []),
          { id: 'plates', label: 'Render brand plates' },
          { id: 'produce', label: 'Produce master video' },
          { id: 'audio', label: 'Add voice & music' },
          { id: 'deliver', label: 'Export handoff pack' },
          { id: 'preview', label: 'Show in player' },
        ];
  desk.set({
    pipeline: (resuming ? statusesForResume(steps, fromStep) : steps.map((s) => ({ ...s, status: 'todo' }))),
  });
  clearPipelineFailure();
  desk.set({ pipelineStartedAt: Date.now() });
  setRenderMode(true, record ? 'record' : 'render');
  showLeftTab('render');

  setBay(
    resuming ? 'Resuming' : 'Rendering',
    platesOnly
      ? 'Re-rendering brand plates'
      : resuming
        ? `Continuing from ${steps.find((s) => s.id === fromStep)?.label || fromStep}`
        : guided
          ? 'Record it yourself'
          : record
            ? 'Rendering with re-record'
            : 'Rendering sequence',
    platesOnly
      ? 'Motion-safe hold probe + frame QC run on every plate. Failed QC aborts the job.'
      : resuming
        ? 'Earlier steps stay done. Retry runs from the failed step through the rest of the pipeline.'
        : guided
          ? 'A browser and a Recorder window open. Press Start recording, show the journey, then Finish recording. Then choose: keep your recording, or let the bot re-record your steps. Narration is fitted to the take you keep.'
          : 'Live log and pipeline update here. Program refreshes when the last step finishes.',
  );
  setStatus('run', resuming ? 'Resuming…' : 'Rendering…');
  for (const b of RENDER_BUTTONS) setButtonBusy(b, true);

  let stepIds = steps.map((s) => s.id);
  let failedStepId: string | null = null;
  /** The take choice swaps what follows it; steps already done stay done. */
  const switchSteps = (next: Array<{ id: string; label: string }>, done: Set<string>) => {
    steps = next;
    stepIds = steps.map((s) => s.id);
    desk.set({ pipeline: steps.map((s) => ({ ...s, status: done.has(s.id) ? 'done' : 'todo' })) });
  };

  try {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (!s) continue;
      const produceFollows = steps.some((step) => step.id === 'produce');
      const records = steps.some((step) => step.id === 'record');
      if (s.id === 'preview') continue;
      // Plates do not read the take. On a re-record they run beside capture; on a
      // quick render, produce draws them beside the card bake.
      if (s.id === 'plates' && (records || produceFollows)) continue;
      if (!shouldRunStep(s.id, stepIds, fromStep)) continue;
      if (sig?.aborted || desk.get().stopRequested) throw new Error('cancelled');
      setStep(s.id, 'run');
      paintProgramBuild(pipelineOverlay({ running: true, label: s.label }));
      setFaviconMode(
        s.id === 'record' || s.id === 'guide' || s.id === 'adopt'
          ? 'record'
          : s.id === 'retake' || s.id === 'recraft' || s.id === 'own-script'
            ? 'draft'
            : s.id === 'deliver'
              ? 'export'
              : 'render',
      );
      try {
        if (s.id === 'guide') {
          if (!(await confirmGuidedFits(api, target))) throw new Error('cancelled');
          bridges.bay?.showGuide(target);
          try {
            await runJobPromise('guide', false, { signal: sig, slug: target });
          } finally {
            bridges.bay?.hideGuide();
          }
        } else if (s.id === 'decide') {
          setStatus('run', 'Choose your take');
          if (!bridges.bay) throw new Error('Render bay is not mounted');
          const choice = await bridges.bay.askTake(target, { signal: sig });
          if (choice === 'again') {
            setStep('decide', 'todo');
            setStep('guide', 'todo');
            i = stepIds.indexOf('guide') - 1;
            continue;
          }
          const done = new Set((desk.get().pipeline ?? []).filter((p) => p.status === 'done').map((p) => p.id));
          done.add('decide');
          switchSteps(guidedSteps(choice), done);
          setStatus('run', choice === 'own' ? 'Keeping your recording…' : 'The bot re-records your steps…');
          continue;
        } else if (s.id === 'adopt') {
          await runJobPromise('adopt-take', false, { signal: sig, slug: target });
        } else if (s.id === 'own-script') {
          try {
            await runPipelineAgentGoal('own-take', target, sig);
          } catch (err) {
            if (isCancelError(err) || desk.get().stopRequested) throw err;
            // Your take is final either way; the current lines still voice, so the cut ships.
            toast('Narration not fitted', `${errorMessage(err)} — voicing the current lines`, 'warn');
          }
        } else if (s.id === 'retake') {
          await runPipelineAgentGoal('guided-script', target, sig);
        } else if (s.id === 'recraft') {
          try {
            await runPipelineAgentGoal('take-recraft', target, sig);
          } catch (err) {
            if (isCancelError(err) || desk.get().stopRequested) throw err;
            // The take is final either way; unfitted narration still voices, so the cut ships.
            toast('Narration not recrafted', `${errorMessage(err)} — voicing the current lines`, 'warn');
          }
        } else if (s.id === 'record') {
          setStep('plates', 'run');
          const forcePlates = resuming;
          const settled = await Promise.allSettled([
            runJobPromise('record', false, { signal: sig, slug: target }),
            runJobPromise('plates', forcePlates, { signal: sig, slug: target, quiet: true }),
          ]);
          const [rec, plates] = settled;
          if (rec?.status === 'rejected') {
            failedStepId = 'record';
            // Plates may still have finished beside a failed capture.
            setStep('plates', plates?.status === 'fulfilled' ? 'done' : 'todo');
            throw rec.reason;
          }
          if (plates?.status === 'rejected') {
            failedStepId = 'plates';
            setStep('record', 'done');
            await publishProgramStep('record', target).catch(() => {});
            throw plates.reason;
          }
          setStep('plates', 'done');
          await publishProgramStep('plates', target).catch(() => {});
        } else {
          if (s.id === 'produce' && !records) setStep('plates', 'run');
          // Plates are content-hash cached; forcing on a fresh make would redraw twice.
          // On resume after a fail, force plates so a half-written encode is not reused.
          const force = resuming && s.id === 'plates';
          await runJobPromise(s.id, force, { signal: sig, slug: target });
          if (s.id === 'produce' && !records) {
            setStep('plates', 'done');
            await publishProgramStep('plates', target).catch(() => {});
          }
        }
      } catch (err) {
        if (!failedStepId) failedStepId = s.id;
        throw err;
      }
      setStep(s.id, 'done');
      await publishProgramStep(s.id, target).catch(() => {});
      paintProgramBuild(pipelineOverlay({ running: false }));
    }
    setStep('preview', 'run');
    try {
      await api(`/api/video/${enc(target)}/versions/snapshot`, {
        method: 'POST',
        body: {
          title: record ? 'Re-recorded sequence' : resuming ? 'Resumed sequence' : 'Rendered sequence',
          trigger: record ? 'make-full' : 'make',
          kind: 'release',
          note: resuming ? `studio resume from ${fromStep}` : 'studio make video',
        },
      });
    } catch {
      /* ignore */
    }
    // One Program handoff + one play — never loadVideo(play) twice (that resets and restarts).
    if (target === desk.get().slug) {
      desk.set({ previewingPlate: null });
      if (normalizeMonitorMode(desk.get().monitorMode) !== 'program') setMonitorMode('program', { keepPreview: true });
      desk.set({ bay: null });
      await loadVideo(target, { play: true });
    }
    setStep('preview', 'done');
    clearPipelineFailure();
    setStatus('ok', 'Ready — Program updated');
    setFaviconMode('ok');
    toast(resuming ? 'Pipeline continued' : 'Render complete', 'Program monitor updated');
    hideActivityDock();
  } catch (err) {
    if (isCancelError(err) || desk.get().stopRequested) {
      for (const p of (desk.get().pipeline ?? []).filter((x) => x.status === 'run')) setStep(p.id, 'todo');
      paintProgramBuild(pipelineOverlay({ running: false }));
      throw err;
    }
    const runningSteps = (desk.get().pipeline ?? []).filter((x) => x.status === 'run');
    const failId = failedStepId || runningSteps[0]?.id;
    for (const p of runningSteps) setStep(p.id, p.id === failId ? 'fail' : 'todo');
    if (failId && desk.get().pipeline?.find((x) => x.id === failId)?.status !== 'fail') setStep(failId, 'fail');
    const failed = desk.get().pipeline?.find((x) => x.id === failId);
    rememberPipelineFailure({
      mode: resolved,
      slug: target,
      stepId: failId || 'produce',
      label: failed?.label || 'Render',
      error: errorMessage(err),
      log: jobLogText(desk.get().job),
    });
    paintProgramBuild(
      pipelineOverlay({
        failed: true,
        label: failed?.label || 'Render',
        error: errorMessage(err),
        screenshot: desk.get().video?.recordFailure ? `/media/${enc(target)}/error.png` : '',
        log: 'activity',
      }),
    );
    setStatus('warn', 'Render failed');
    setFaviconMode('err');
    toast('Render failed', errorMessage(err), 'err');
    throw err;
  } finally {
    for (const b of RENDER_BUTTONS) setButtonBusy(b, false);
    desk.set({ pipelineStartedAt: null, bay: null });
  }
}
