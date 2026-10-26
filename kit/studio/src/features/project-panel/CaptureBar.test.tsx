import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bridges, type WorkflowBridge } from '@/desk/bridge';
import { desk } from '@/desk/store';
import { makeFreshness, makeVideo } from '@/test/factories';
import { server } from '@/test/msw/server';

import { CaptureBar } from './CaptureBar';

vi.mock('@/desk/video', () => ({ loadVideo: vi.fn(() => Promise.resolve()) }));

const $ = (id: string) => document.getElementById(id);

beforeEach(() => desk.reset());
afterEach(() => {
  bridges.workflow = null;
});

describe('CaptureBar', () => {
  it('stays hidden until a summary says where capture opens', () => {
    render(<CaptureBar />);
    expect($('captureBar')).toHaveClass('capture-bar');
    expect($('captureBar')?.hidden).toBe(true);
    expect($('recordTargetSummary')).toHaveTextContent('No start URL yet');
    act(() => desk.set({ video: makeVideo({ freshness: makeFreshness({ startUrl: '', liveAt: null }) }) }));
    expect($('captureBar')?.hidden).toBe(true);
  });

  it('fills the line from the summary and leaves a focused field alone', () => {
    render(<CaptureBar />);
    act(() => desk.set({ video: makeVideo({ freshness: makeFreshness({ startUrl: 'https://app.test/home/', loginRequired: true }) }) }));
    expect($('captureBar')?.hidden).toBe(false);
    expect($('recordTargetSummary')).toHaveTextContent('app.test/home · signs in');
    expect(($('recordStartUrl') as HTMLInputElement).value).toBe('https://app.test/home/');
    expect(($('recordLoginRequired') as HTMLInputElement).checked).toBe(true);
    const input = $('recordStartUrl') as HTMLInputElement;
    input.focus();
    input.value = 'https://typing';
    act(() => desk.set({ video: makeVideo({ freshness: makeFreshness({ startUrl: 'https://other.test' }) }) }));
    expect(input.value).toBe('https://typing');
    expect($('recordTargetSummary')).toHaveTextContent('app.test/home · signs in');
  });

  it('saves on change and on submit, and shows the outcome', async () => {
    const puts: unknown[] = [];
    server.use(
      http.put('/api/video/:slug/record-target', async ({ request }) => {
        puts.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    render(<CaptureBar />);
    act(() => desk.set({ slug: 'demo', video: makeVideo() }));
    const input = $('recordStartUrl') as HTMLInputElement;
    input.value = 'nope';
    fireEvent.change(input);
    await waitFor(() => expect($('recordTargetStatus')).toHaveTextContent('Use a full http(s) URL.'));
    expect($('recordTargetStatus')?.hidden).toBe(false);
    input.value = 'https://new.test';
    fireEvent.submit($('recordTargetForm') as HTMLFormElement);
    await waitFor(() => expect($('recordTargetStatus')).toHaveTextContent('Saved.'));
    expect(puts).toEqual([{ startUrl: 'https://new.test', loginRequired: false }]);
    input.value = 'https://example.test/app';
    fireEvent.change(input);
    await waitFor(() => expect($('recordTargetStatus')?.hidden).toBe(true));
  });

  it('opens project settings from the cog', () => {
    const openProjectSettings = vi.fn();
    bridges.workflow = { openProjectSettings } as unknown as WorkflowBridge;
    render(<CaptureBar />);
    const cog = $('btnCaptureSettings') as HTMLElement;
    expect(cog).toHaveAttribute('aria-label', 'Project settings');
    fireEvent.click(cog);
    expect(openProjectSettings).toHaveBeenCalledTimes(1);
  });
});
