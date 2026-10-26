import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { allowLiveRendering } from '@/test/liveRendering';
import { server } from '@/test/msw/server';

import { hideGuide, resetBayCards, showGuide } from './bayCards';
import { GuideCard } from './GuideCard';
import type { GuideStatus } from './guideModel';

const card = () => document.getElementById('bayGuide') as HTMLElement;
let status: GuideStatus = {};
let posts: Array<{ path: string; body: unknown }> = [];

// The card polls the session and ticks its recording clock while it is up.
allowLiveRendering();

beforeEach(() => {
  status = { state: 'capturing', steps: 3, marks: 1, last: 'Clicked Save', recording: true, recSec: 65 };
  posts = [];
  server.use(
    http.get('/api/video/:slug/guide', () => HttpResponse.json({ captureMode: 'guided', tour: { status } })),
    http.post('/api/video/:slug/guide/control', async ({ request }) => {
      posts.push({ path: 'control', body: await request.json() });
      return HttpResponse.json({ ok: true });
    }),
    http.post('/api/video/:slug/guide/finish', () => {
      posts.push({ path: 'finish', body: null });
      return HttpResponse.json({ ok: true });
    }),
  );
});
afterEach(() => resetBayCards());

describe('GuideCard', () => {
  it('is a hidden host until a session starts', () => {
    render(<GuideCard />);
    expect(card()).toHaveClass('guide-card', 'guide-card--bay');
    expect(card()).toHaveAttribute('aria-live', 'polite');
    expect(card().hidden).toBe(true);
    expect(card()).toBeEmptyDOMElement();
  });

  it('opens connecting, then paints the session status', async () => {
    render(<GuideCard />);
    act(() => showGuide('demo'));
    expect(card().hidden).toBe(false);
    expect(card()).toHaveAttribute('data-state', 'connecting');
    expect(card().querySelector('.guide-card-titles strong')).toHaveTextContent('Opening the browser…');
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'capturing'));
    expect(card().querySelector('.guide-card-titles strong')).toHaveTextContent('Recording');
    expect(card().querySelector('[data-guide-timer]')).toHaveTextContent(/^1:0\d$/);
    expect(card().querySelector('.guide-card-live')).toHaveTextContent('3 steps · 1 chapter Last: Clicked Save');
    expect(card().querySelector('li[aria-current="step"]')).toHaveAttribute('data-step', 'show');
    expect([...card().querySelectorAll('[data-guide-action]')].map((b) => b.textContent)).toEqual(['Mark chapter', 'Pause', 'Finish recording']);
    expect(card().querySelector('.guide-card-foot')).toHaveTextContent('The same controls are in the Recorder window beside the browser.');
  });

  it('sends controls and marks a chapter', async () => {
    render(<GuideCard />);
    act(() => showGuide('demo'));
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'capturing'));
    fireEvent.click(screen.getByRole('button', { name: 'Mark chapter' }));
    const input = screen.getByLabelText('Chapter title');
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: ' Plan the week ' } });
    fireEvent.submit(card().querySelector('[data-guide-mark]') as HTMLFormElement);
    expect(card().querySelector('[data-guide-mark]')).toBeNull();
    await waitFor(() => expect(posts).toEqual([{ path: 'control', body: { action: 'mark', title: 'Plan the week' } }]));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
  });

  it('reads as finishing as soon as Finish is pressed', async () => {
    render(<GuideCard />);
    act(() => showGuide('demo'));
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'capturing'));
    fireEvent.click(screen.getByRole('button', { name: 'Finish recording' }));
    expect(card()).toHaveAttribute('data-state', 'finishing');
    expect(card().querySelector('.guide-card-live')).toBeNull();
    await waitFor(() => expect(posts).toEqual([{ path: 'finish', body: null }]));
  });

  it('shows the sign-in state and keeps the last state after hide', async () => {
    status = { state: 'ready', needsSignIn: true };
    render(<GuideCard />);
    act(() => showGuide('demo'));
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'signin'));
    expect(card().querySelector('li')).toHaveAttribute('data-step', 'signin');
    expect([...card().querySelectorAll('[data-guide-action]')].map((b) => b.textContent)).toEqual(['Start recording', 'Cancel']);
    act(() => hideGuide());
    expect(card().hidden).toBe(true);
    expect(card()).toHaveAttribute('data-state', 'signin');
  });
});
