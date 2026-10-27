import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeVideo } from '@/test/factories';

vi.mock('./api', () => ({ api: vi.fn(), enc: encodeURIComponent }));
vi.mock('./video', () => ({ loadVideo: vi.fn(() => Promise.resolve()) }));
vi.mock('./marks', () => ({ setFaviconMode: vi.fn() }));

const { api } = await import('./api');
const { loadVideo } = await import('./video');
const { desk } = await import('./store');
const { bridges } = await import('./bridge');
const { runtime } = await import('./runtime');
const jobs = await import('./jobs');

const mockedApi = vi.mocked(api);

function lastToast() {
  return desk.get().toasts.at(-1);
}

beforeEach(() => {
  desk.reset();
  mockedApi.mockReset();
  bridges.feedback = null;
  runtime.workAbort = null;
});

describe('enqueueJob', () => {
  it('refuses work without a sequence', () => {
    expect(jobs.enqueueJob({ kind: 'step', step: 'audio', label: 'Narration' })).toBeNull();
    expect(lastToast()).toMatchObject({ title: 'No sequence open', kind: 'warn' });
  });

  it('binds the slug at enqueue time and refuses a duplicate render step', () => {
    desk.set({ slug: 'demo', jobBusy: true });
    const first = jobs.enqueueJob({ kind: 'step', step: 'audio', label: 'Narration' });
    expect(first?.slug).toBe('demo');
    expect(lastToast()).toMatchObject({ title: 'Queued', detail: 'Narration · after current job' });
    expect(jobs.enqueueJob({ kind: 'step', step: 'audio', label: 'Narration' })).toBeNull();
    expect(lastToast()).toMatchObject({ title: 'Already waiting' });
    expect(desk.get().queue).toHaveLength(1);
  });

  it('shows the tab the work lands on', () => {
    desk.set({ slug: 'demo', jobBusy: true, leftTab: 'versions', rightTab: 'review' });
    jobs.enqueueJob({ kind: 'improve', goal: 'full', label: 'Improve' });
    expect(desk.get().rightTab).toBe('feedback');
    jobs.enqueueJob({ kind: 'step', step: 'audio', label: 'Narration' });
    expect(desk.get().leftTab).toBe('render');
  });

  it('removes one queued item or clears them all', () => {
    desk.set({ slug: 'demo', jobBusy: true });
    const a = jobs.enqueueJob({ kind: 'step', step: 'audio', label: 'A' }, { silent: true });
    jobs.enqueueJob({ kind: 'step', step: 'music', label: 'B' }, { silent: true });
    jobs.removeQueued(a?.qid ?? '');
    expect(desk.get().queue.map((q) => q.label)).toEqual(['B']);
    jobs.clearQueue();
    expect(desk.get().queue).toEqual([]);
  });
});

describe('drainQueue', () => {
  it('runs a step job, reloads the sequence and reports done', async () => {
    desk.set({ slug: 'demo', video: makeVideo({ slug: 'demo' }) });
    mockedApi.mockImplementation((path: string) => {
      if (path === '/api/video/demo/run') return Promise.resolve({ job: { id: 'j1' } });
      if (path === '/api/jobs/j1') return Promise.resolve({ id: 'j1', status: 'done', log: [], createdAt: '' });
      return Promise.resolve({});
    });
    jobs.enqueueJob({ kind: 'step', step: 'audio', label: 'Narration' }, { silent: true });
    await vi.waitFor(() => expect(desk.get().jobBusy).toBe(false), { timeout: 3000 });
    expect(mockedApi).toHaveBeenCalledWith('/api/video/demo/run', {
      method: 'POST',
      body: { step: 'audio', force: false, presets: undefined },
    });
    expect(loadVideo).toHaveBeenCalledWith('demo');
    expect(desk.get().toasts.some((t) => t.title === 'Done' && t.detail === 'Narration')).toBe(true);
  });

  it('turns a failed job into an error toast and a warning status', async () => {
    desk.set({ slug: 'demo' });
    mockedApi.mockImplementation((path: string) => {
      if (path === '/api/video/demo/run') return Promise.resolve({ job: { id: 'j2' } });
      if (path === '/api/jobs/j2') return Promise.resolve({ id: 'j2', status: 'failed', message: 'ffmpeg exploded', log: [] });
      return Promise.resolve({});
    });
    jobs.enqueueJob({ kind: 'step', step: 'mix', label: 'Mix' }, { silent: true });
    await vi.waitFor(() => expect(desk.get().jobBusy).toBe(false), { timeout: 3000 });
    expect(desk.get().toasts.some((t) => t.title === 'Mix' && t.detail === 'ffmpeg exploded' && t.kind === 'err')).toBe(true);
    expect(desk.get().status.text).toBe('Job failed');
  });

  it('hands improve items to the feedback rail', async () => {
    desk.set({ slug: 'demo' });
    const runImproveJob = vi.fn<(item: unknown, opts: unknown) => Promise<void>>(() => Promise.resolve());
    bridges.feedback = { runImproveJob, hideProposal: vi.fn(), resetThinkSteps: vi.fn(), setSessionIdle: vi.fn() };
    jobs.enqueueJob({ kind: 'improve', goal: 'full', label: 'Improve' }, { silent: true });
    await vi.waitFor(() => expect(runImproveJob).toHaveBeenCalled());
    expect(runImproveJob.mock.calls[0]?.[0]).toMatchObject({ kind: 'improve', goal: 'full', slug: 'demo' });
  });
});

describe('stopAllWork', () => {
  it('cancels the running job, empties the queue and says so', async () => {
    mockedApi.mockResolvedValue({});
    desk.set({ slug: 'demo', jobBusy: true, jobId: 'j9', queue: [] });
    await jobs.stopAllWork({ reason: 'Stopped' });
    expect(mockedApi).toHaveBeenCalledWith('/api/jobs/j9/cancel', { method: 'POST', body: {} });
    expect(desk.get()).toMatchObject({ jobBusy: false, queue: [], pipeline: null });
    expect(lastToast()).toMatchObject({ title: 'Stopped', detail: 'Running job stopped · queue cleared' });
  });

  it('cancels everything when no job id is known', async () => {
    mockedApi.mockResolvedValue({});
    await jobs.stopAllWork({ silent: true });
    expect(mockedApi).toHaveBeenCalledWith('/api/jobs/cancel-all', { method: 'POST', body: {} });
    expect(desk.get().toasts).toEqual([]);
  });

  it('waits for the kill to actually land before freeing the video for new work', async () => {
    desk.set({ slug: 'demo', jobBusy: true, jobId: 'j9', queue: [] });
    let polls = 0;
    mockedApi.mockImplementation((path: string) => {
      if (path === '/api/jobs/j9/cancel') return Promise.resolve({ job: { id: 'j9', status: 'cancelling' } });
      if (path === '/api/jobs/j9') {
        polls += 1;
        // Still dying on the first couple of polls — only settles on the third.
        return Promise.resolve({ id: 'j9', status: polls < 3 ? 'cancelling' : 'cancelled' });
      }
      return Promise.resolve({});
    });
    await jobs.stopAllWork({ reason: 'Stopped' });
    expect(polls).toBe(3);
    expect(desk.get().jobBusy).toBe(false);
  });

  it('keeps jobBusy asserted while the kill settles so a re-Render cannot race the child', async () => {
    desk.set({ slug: 'demo', jobBusy: true, jobId: 'j9', stopRequested: false, queue: [] });
    let busyDuringSettle = false;
    mockedApi.mockImplementation((path: string) => {
      if (path === '/api/jobs/j9/cancel') return Promise.resolve({ job: { id: 'j9', status: 'cancelling' } });
      if (path === '/api/jobs/j9') {
        busyDuringSettle = desk.get().jobBusy === true;
        return Promise.resolve({ id: 'j9', status: 'cancelled' });
      }
      return Promise.resolve({});
    });
    await jobs.stopAllWork({ silent: true });
    expect(busyDuringSettle).toBe(true);
    expect(desk.get()).toMatchObject({ jobBusy: false, stopRequested: false });
  });

  it('leaves the Live pane when Stop cuts off a take', async () => {
    mockedApi.mockResolvedValue({});
    const video = makeVideo({ slug: 'demo', previewUrl: '/media/demo/live-preview.jpg' });
    desk.set({
      slug: 'demo',
      jobBusy: true,
      jobId: 'j9',
      video,
      monitorMode: 'live',
      liveWarmupKey: 'j9:1',
      liveWarmingUp: true,
      signInWait: { title: 'Sign in', next: 'Continue' },
      live: {
        ...desk.get().live,
        url: '/media/demo/live-preview.jpg',
        src: 'blob:frozen',
        recording: true,
        repairing: false,
        warming: true,
        badge: 'Live',
        tab: true,
        onAir: true,
        thumb: true,
      },
    });
    await jobs.stopAllWork({ reason: 'Stopped' });
    expect(desk.get().monitorMode).toBe('program');
    expect(desk.get().live).toMatchObject({
      recording: false,
      repairing: false,
      warming: false,
      tab: false,
      onAir: false,
      thumb: false,
    });
    expect(desk.get().liveWarmupKey).toBeNull();
    expect(desk.get().signInWait).toBeNull();
  });

  it('ignores a preview poll that lands after Stop', async () => {
    let releasePreview: (res: Response) => void = () => {};
    let releaseSignIn: (res: Response) => void = () => {};
    const previewHung = new Promise<Response>((resolve) => {
      releasePreview = resolve;
    });
    const signInHung = new Promise<Response>((resolve) => {
      releaseSignIn = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('live-preview.json')) return previewHung;
      if (url.includes('sign-in-wait.json')) return signInHung;
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    try {
      desk.set({
        slug: 'demo',
        jobId: 'j9',
        jobBusy: true,
        video: makeVideo({ slug: 'demo', previewUrl: '/media/demo/live-preview.jpg' }),
      });
      let seen = 0;
      mockedApi.mockImplementation((path: string) => {
        if (path === '/api/jobs/j9/cancel') return Promise.resolve({ job: { id: 'j9', status: 'cancelled' } });
        if (path === '/api/jobs/j9') {
          seen += 1;
          return Promise.resolve({
            id: 'j9',
            status: seen === 1 ? 'running' : 'cancelled',
            step: 'record',
            phase: 'recording',
            log: [],
            createdAt: '',
            startedAt: '2026-01-01T00:00:00.000Z',
          });
        }
        return Promise.resolve({});
      });
      runtime.workAbort = new AbortController();
      const watched = jobs.watchJob('j9').catch((err: unknown) => err);
      await vi.waitFor(() => expect(desk.get().live.recording).toBe(true));
      await jobs.stopAllWork({ reason: 'Stopped' });
      releasePreview(
        new Response(JSON.stringify({ at: Date.now() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      releaseSignIn(
        new Response(JSON.stringify({ title: 'Sign in', next: 'Continue' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await watched;
      await Promise.resolve();
      expect(desk.get().monitorMode).toBe('program');
      expect(desk.get().live.recording).toBe(false);
      expect(desk.get().live.tab).toBe(false);
      expect(desk.get().signInWait).toBeNull();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('gives up waiting after its timeout rather than hanging Stop forever', async () => {
    vi.useFakeTimers();
    try {
      desk.set({ slug: 'demo', jobBusy: true, jobId: 'j9', queue: [] });
      mockedApi.mockImplementation((path: string) => {
        if (path === '/api/jobs/j9/cancel') return Promise.resolve({ job: { id: 'j9', status: 'cancelling' } });
        if (path === '/api/jobs/j9') return Promise.resolve({ id: 'j9', status: 'cancelling' });
        return Promise.resolve({});
      });
      const done = jobs.stopAllWork({ reason: 'Stopped' });
      await vi.advanceTimersByTimeAsync(5000);
      await done;
      expect(desk.get().jobBusy).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('drainQueue and OutputBusyError', () => {
  it('retries a step that lost the race for an output lock a just-stopped job is still releasing', async () => {
    desk.set({ slug: 'demo', video: makeVideo({ slug: 'demo' }) });
    let runCalls = 0;
    mockedApi.mockImplementation((path: string) => {
      if (path === '/api/video/demo/run') {
        runCalls += 1;
        return Promise.resolve({ job: { id: `j${runCalls}` } });
      }
      if (path === '/api/jobs/j1') {
        return Promise.resolve({
          id: 'j1',
          status: 'failed',
          message: 'produce is already running for demo (pid 4242, 0m). Wait for it to finish or stop it first.',
          log: [],
        });
      }
      if (path === '/api/jobs/j2') return Promise.resolve({ id: 'j2', status: 'done', log: [] });
      return Promise.resolve({});
    });
    jobs.enqueueJob({ kind: 'step', step: 'produce', label: 'Render' }, { silent: true });
    await vi.waitFor(() => expect(desk.get().jobBusy).toBe(false), { timeout: 3000 });
    expect(runCalls).toBe(2);
    expect(desk.get().toasts.some((t) => t.title === 'Done' && t.detail === 'Render')).toBe(true);
    expect(desk.get().toasts.some((t) => t.kind === 'err')).toBe(false);
  });

  it('still fails a real error without retrying', async () => {
    desk.set({ slug: 'demo', video: makeVideo({ slug: 'demo' }) });
    let runCalls = 0;
    mockedApi.mockImplementation((path: string) => {
      if (path === '/api/video/demo/run') {
        runCalls += 1;
        return Promise.resolve({ job: { id: 'j1' } });
      }
      if (path === '/api/jobs/j1') return Promise.resolve({ id: 'j1', status: 'failed', message: 'ffmpeg exploded', log: [] });
      return Promise.resolve({});
    });
    jobs.enqueueJob({ kind: 'step', step: 'produce', label: 'Render' }, { silent: true });
    await vi.waitFor(() => expect(desk.get().jobBusy).toBe(false), { timeout: 3000 });
    expect(runCalls).toBe(1);
    expect(desk.get().toasts.some((t) => t.title === 'Render' && t.detail === 'ffmpeg exploded' && t.kind === 'err')).toBe(true);
  });
});

describe('requestMake', () => {
  it('labels the make job after its mode', () => {
    desk.set({ slug: 'demo', video: makeVideo({ slug: 'demo' }), jobBusy: true });
    jobs.requestMake('full');
    expect(desk.get().queue[0]).toMatchObject({ kind: 'make', mode: 'full', label: 'Re-record & render full' });
  });
});

describe('isCancelError', () => {
  it('recognises the cancel wording the server and aborts use', () => {
    expect(jobs.isCancelError(new Error('Job cancelled'))).toBe(true);
    expect(jobs.isCancelError('aborted')).toBe(true);
    expect(jobs.isCancelError(new Error('boom'))).toBe(false);
  });
});
