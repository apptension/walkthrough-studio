import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeVideo } from '@/test/factories';

vi.mock('./api', () => ({ api: vi.fn(), enc: encodeURIComponent }));
vi.mock('./video', () => ({ loadVideo: vi.fn(() => Promise.resolve()) }));
vi.mock('./marks', () => ({ setFaviconMode: vi.fn() }));

const { api } = await import('./api');
const { loadVideo } = await import('./video');
const { desk } = await import('./store');
const { bridges } = await import('./bridge');
const jobs = await import('./jobs');

const mockedApi = vi.mocked(api);

function lastToast() {
  return desk.get().toasts.at(-1);
}

beforeEach(() => {
  desk.reset();
  mockedApi.mockReset();
  bridges.feedback = null;
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
