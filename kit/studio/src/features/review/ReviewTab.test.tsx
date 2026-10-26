import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Critic, Story } from '@/api/types';
import { desk } from '@/desk/store';
import { startImprove } from '@/features/feedback/improve';
import { makeVideo } from '@/test/factories';
import { server } from '@/test/msw/server';

import { plateForTarget, runCriticFromStudio } from './critic';
import { ReviewTab } from './ReviewTab';

vi.mock('@/features/feedback/improve', () => ({ startImprove: vi.fn() }));

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

const lastToast = () => desk.get().toasts.at(-1);

const story = (over: Partial<Story> = {}): Story => ({
  purpose: 'launch',
  explicit: false,
  label: 'Launch',
  framework: 'Problem · Promise · Proof',
  hint: 'Launch-day trailer',
  beats: [
    { id: 'hook', where: 'open', job: 'Grab attention', covered: true, plates: ['open'] },
    { id: 'proof', where: 'live', job: 'Show it works', covered: false, plates: ['stats', 'quote', 'logos', 'extra'] },
    { id: 'ask', where: 'close', job: 'Ask', covered: null },
  ],
  options: [
    { id: 'launch', label: 'Product launch', short: 'Launch', framework: 'PPP', hint: 'Trailer' },
    { id: 'onboard', label: 'Onboarding', short: '', framework: 'Steps', hint: 'First run' },
  ],
  ...over,
});

const critic = (over: Partial<Critic> = {}): Critic => ({
  findings: [
    { severity: 'low', message: '', target: 'intro.copy', persona: 'buyer', issue: 'Wordy', suggestion: 'Trim' },
    { severity: 'high', message: '', target: 'narration:2', persona: 'skeptic', issue: 'Vague claim', suggestion: 'Name a number' },
  ],
  generatedAt: '2026-10-20T09:00:00.000Z',
  purpose: 'launch',
  high: 1,
  stale: false,
  ...over,
});

beforeEach(() => {
  desk.reset();
  vi.clearAllMocks();
});

describe('ReviewTab markup', () => {
  it('matches the legacy empty Review body', () => {
    render(<ReviewTab />);
    expect($('rightReview')).toHaveAttribute('hidden');
    expect($('storyBadge')).toHaveAttribute('hidden');
    expect($('storyBadge')).toHaveTextContent('guessed');
    expect($('storyPurpose')).toBeEmptyDOMElement();
    expect($('criticBadge')).toHaveTextContent('—');
    expect($('criticBadge').className).toBe('badge');
    expect($('criticFindings').querySelector('.zen')).toHaveAttribute('data-zen', 'loupe');
    expect($('btnCriticRun')).toHaveTextContent('Run critic');
    expect($('btnCriticApply')).toHaveAttribute('hidden');
    expect($('criticReportLink')).toHaveAttribute('hidden');
    expect($('qcBadge')).toHaveTextContent('—');
    expect($('qcBox').querySelector('.zen')).toHaveAttribute('data-zen', 'checklist');
    expect(document.getElementById('chapterStrip')).toBeNull();
  });
});

describe('story', () => {
  it('renders the purpose picker, framework and spine', () => {
    desk.set({ video: makeVideo({ story: story() }) });
    render(<ReviewTab />);
    const labels = [...$('storyPurpose').querySelectorAll('label')];
    expect(labels.map((l) => l.title)).toEqual(['PPP — Trailer', 'Steps — First run']);
    expect(labels.map((l) => l.textContent)).toEqual(['Launch', 'Onboarding']);
    expect(labels[0]?.querySelector('input')).toBeChecked();
    expect($('storyBadge')).not.toHaveAttribute('hidden');
    expect($('storyBadge')).toHaveAttribute('title', 'Guessed from the audience line — confirm it so every agent pass follows one spine.');
    expect($('storyFramework').innerHTML).toBe('<strong>Launch</strong> · Problem · Promise · Proof');
    const beats = [...$('storySpine').querySelectorAll('li')];
    expect(beats.map((li) => li.className)).toEqual(['is-covered', 'is-gap', '']);
    expect(beats[0]).toHaveAttribute('title', 'Grab attention');
    expect(beats[0]?.querySelector('i')).toHaveTextContent('plate in place');
    expect(beats[1]?.querySelector('i')).toHaveTextContent('needs stats / quote / logos');
    expect(beats[2]?.querySelector('i')).toBeNull();
  });

  it('saves a new purpose', async () => {
    const next = story({ purpose: 'onboard', explicit: true, framework: 'Steps' });
    let body: unknown;
    server.use(
      http.post('/api/video/:slug/story', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ story: next });
      }),
    );
    desk.set({ slug: 'demo', video: makeVideo({ story: story() }) });
    render(<ReviewTab />);
    fireEvent.click($('storyPurpose').querySelectorAll('input')[1]!);
    await waitFor(() => expect(lastToast()?.title).toBe('Story spine set'));
    expect(body).toEqual({ purpose: 'onboard' });
    expect(lastToast()?.detail).toBe('Steps');
    expect($('storyBadge')).toHaveAttribute('hidden');
  });
});

describe('critic', () => {
  it('sorts findings, badges them and offers safe fixes', () => {
    desk.set({ video: makeVideo({ critic: critic(), criticUrl: '/media/demo/critic.html' }) });
    render(<ReviewTab />);
    expect($('criticBadge')).toHaveTextContent('1 high · 2');
    expect($('criticBadge').className).toBe('badge fail');
    const items = [...$('criticFindings').querySelectorAll('.critic-item')];
    expect(items.map((el) => el.className)).toEqual(['critic-item high', 'critic-item low']);
    expect($('btnCriticApply')).not.toHaveAttribute('hidden');
    expect($('criticReportLink')).not.toHaveAttribute('hidden');
    expect($('criticReportLink')).toHaveAttribute('href', '/media/demo/critic.html');
  });

  it('marks a stale report and a clean one', () => {
    desk.set({ video: makeVideo({ critic: critic({ stale: true }) }) });
    const { unmount } = render(<ReviewTab />);
    expect($('criticBadge')).toHaveTextContent('stale');
    expect($('criticBadge')).toHaveAttribute('title', 'Config or narration changed since this report — run again.');
    expect($('btnCriticRun')).toHaveTextContent('Run critic again');
    unmount();
    desk.set({ video: makeVideo({ critic: critic({ findings: [], high: 0 }) }) });
    render(<ReviewTab />);
    expect($('criticBadge').className).toBe('badge ok');
    expect($('criticFindings').innerHTML).toBe('<p class="empty-inline">Clean — narration and plates follow the launch spine.</p>');
  });

  it('hands a finding to the agent', () => {
    desk.set({ video: makeVideo({ critic: critic() }) });
    render(<ReviewTab />);
    const fixes = $('criticFindings').querySelectorAll<HTMLButtonElement>('[data-critic-fix]');
    fireEvent.click(fixes[1]!);
    expect(desk.get().improve).toMatchObject({ goal: 'plates', plateId: 'intro' });
    expect(desk.get().improve.note).toBe('Wordy (intro.copy, flagged by the buyer). Trim');
    expect(desk.get().rightTab).toBe('feedback');
    expect(startImprove).toHaveBeenCalledWith('plates');
    fireEvent.click(fixes[0]!);
    expect(startImprove).toHaveBeenLastCalledWith('narration');
  });

  it('runs the critic and lands on Review', async () => {
    let body: unknown;
    server.use(
      http.post('/api/video/:slug/critic', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true });
      }),
      http.get('/api/video/:slug', () => HttpResponse.json(makeVideo({ critic: critic() }))),
    );
    desk.set({ slug: 'demo', video: makeVideo() });
    await runCriticFromStudio({ force: true });
    expect(body).toEqual({ force: true, agent: true });
    expect(desk.get().rightTab).toBe('review');
    expect(lastToast()).toMatchObject({
      title: 'Critic done',
      detail: '2 finding(s) from the rule pass — sign in an agent for a full review',
    });
    expect(desk.get().busy.btnCriticRun).toBe(false);
  });

  it('waits for the critic agent and shows its review', async () => {
    const review = { summary: 'Hook lands late.', score: 64, strengths: ['Clear close'] };
    server.use(
      http.post('/api/video/:slug/critic', () =>
        HttpResponse.json({ ok: true, job: { id: 'job-c', status: 'running', createdAt: '', log: [] } }),
      ),
      http.get('/api/jobs/:id', () =>
        HttpResponse.json({ id: 'job-c', status: 'done', createdAt: '', log: [], critic: { findings: 7, score: 64 } }),
      ),
      http.get('/api/video/:slug', () => HttpResponse.json(makeVideo({ critic: { ...critic(), agent: review } }))),
    );
    desk.set({ slug: 'demo', video: makeVideo() });
    await runCriticFromStudio({ force: true });
    expect(lastToast()).toMatchObject({ title: 'Critic review ready', detail: '7 finding(s) · 64/100' });
    expect(desk.get().criticJob).toBeNull();
    render(<ReviewTab />);
    expect(screen.getByText('Hook lands late.')).toBeTruthy();
    expect(screen.getByText('Clear close')).toBeTruthy();
  });

  it('shows the critic agent at work', () => {
    desk.set({
      video: makeVideo({ critic: critic() }),
      criticJob: { id: 'job-c', status: 'running', createdAt: '', log: [], activity: 'Reading timeline.json' },
    });
    render(<ReviewTab />);
    expect(screen.getByText('Critic agent is watching the cut')).toBeTruthy();
    expect(screen.getByText('Reading timeline.json')).toBeTruthy();
    expect($('criticBadge').textContent).toBe('reviewing');
  });

  it('reads the plate a target names', () => {
    expect(plateForTarget('intro.title')).toBe('intro');
    expect(plateForTarget('open.logo')).toBe('open');
    expect(plateForTarget('narration:3')).toBeNull();
  });
});

describe('quality checks and chapters', () => {
  it('lists selectable findings with apply actions, or all clear', () => {
    const findings = Array.from({ length: 8 }, (_, i) => ({ severity: 'warn' as const, code: `c${i}`, message: `Issue ${i}` }));
    desk.set({ video: makeVideo({ qc: { status: 'warn', summary: { fail: 0, warn: 8, info: 0 }, findings, url: '' } }) });
    const { unmount } = render(<ReviewTab />);
    expect($('qcBadge').className).toBe('badge warn');
    const items = $('qcBox').querySelectorAll('.qc-item');
    expect(items).toHaveLength(8);
    expect(items[0]?.querySelector('.qc-msg')).toHaveTextContent('Issue 0');
    expect($('btnQcApplySelected')).toBeTruthy();
    expect($('btnQcApplyAll')).toBeTruthy();
    unmount();
    desk.set({ video: makeVideo({ qc: { status: 'ok', summary: { fail: 0, warn: 0, info: 0 }, findings: [], url: '' } }) });
    render(<ReviewTab />);
    expect($('qcBox').querySelector('.zen.mini .zen-title')).toHaveTextContent('All clear 🎉');
  });

});
