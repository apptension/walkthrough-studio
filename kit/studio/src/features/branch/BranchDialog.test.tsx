import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { desk, openDialog } from '@/desk/store';
import { makeBranchIdea, makeVideo } from '@/test/factories';
import { server } from '@/test/msw/server';

const toastMod = vi.hoisted(() => ({ toast: vi.fn() }));
const video = vi.hoisted(() => ({ openVideo: vi.fn(() => Promise.resolve()) }));
vi.mock('@/desk/toast', () => toastMod);
vi.mock('@/desk/video', () => video);

import { openBranch, useBranchSheet } from './branch';
import { BranchDialog } from './BranchDialog';
import { EMPTY_BRANCH } from './model';

const dialog = () => document.getElementById('branchDialog') as HTMLDialogElement;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ideas = [makeBranchIdea(), makeBranchIdea({ id: 'calendar', title: 'Calendar drag', angle: '', outcome: 'Book a slot', source: 'agent', lengthSec: 60 })];

beforeEach(() => {
  useBranchSheet.setState({ source: 'this overview', ideas: [], selectedId: null, draft: EMPTY_BRANCH, status: '', discovering: false, creating: false, focusTitle: 0 });
  desk.set({ slug: 'demo', video: makeVideo({ title: 'Demo overview' }) });
  server.use(http.get('/api/video/:slug/branch/ideas', () => HttpResponse.json({ agent: true, ideas })));
});
afterEach(() => {
  act(() => openDialog('branch', false));
});

describe('BranchDialog', () => {
  it('asks for a video before branching', () => {
    desk.set({ slug: null, video: null });
    render(<BranchDialog />);
    act(() => openBranch());
    expect(dialog().open).toBe(false);
    expect(toastMod.toast).toHaveBeenCalledWith('Open a video first', 'Branch copies the current project', 'warn');
  });

  it('loads ideas, preselects the first and fills the brief', async () => {
    render(<BranchDialog />);
    act(() => openBranch());
    expect(dialog().open).toBe(true);
    expect($('branchSource')).toHaveTextContent('Demo overview');
    await waitFor(() => expect(document.querySelectorAll('li.branch-idea')).toHaveLength(2));
    const first = document.querySelector('li.branch-idea[data-idea="desk-home"]');
    expect(first).toHaveClass('is-on');
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect($<HTMLInputElement>('branchTitle').value).toBe('Desk home');
    expect($('branchBrief')).toHaveAttribute('data-mode', 'idea');
    const second = document.querySelector('li.branch-idea[data-idea="calendar"]');
    expect(second).toHaveTextContent('Calendar drag Book a slot · ~60s feature · agent');
  });

  it('turns an edited idea into a custom brief', async () => {
    render(<BranchDialog />);
    act(() => openBranch());
    await waitFor(() => expect($<HTMLInputElement>('branchTitle').value).toBe('Desk home'));
    fireEvent.change($('branchTitle'), { target: { value: 'Desk home, deeper' } });
    expect($('branchBrief')).toHaveAttribute('data-mode', 'custom');
    expect($('btnBranchCustom')).toHaveClass('is-on');
    expect(document.querySelector('li.branch-idea.is-on')).toBeNull();
  });

  it('shows the empty line and refuses a nameless branch', async () => {
    server.use(http.get('/api/video/:slug/branch/ideas', () => HttpResponse.json({ agent: false, ideas: [] })));
    render(<BranchDialog />);
    act(() => openBranch());
    await waitFor(() => expect(document.querySelector('li.branch-empty')).toBeInTheDocument());
    fireEvent.click($('btnBranchCreate'));
    expect(toastMod.toast).toHaveBeenCalledWith('Name the video', 'Pick a suggestion or type a title below', 'warn');
    expect(document.activeElement).toBe($('branchTitle'));
  });

  it('creates the branch, closes and opens the copy', async () => {
    let body: unknown = null;
    server.use(
      http.post('/api/video/:slug/branch', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true, slug: 'demo-desk-home', title: 'Desk home', job: null });
      }),
    );
    render(<BranchDialog />);
    act(() => openBranch());
    await waitFor(() => expect($<HTMLInputElement>('branchTitle').value).toBe('Desk home'));
    fireEvent.click($('btnBranchCreate'));
    await waitFor(() => expect(video.openVideo).toHaveBeenCalledWith('demo-desk-home'));
    expect(desk.get().dialogs.branch).toBe(false);
    expect(body).toMatchObject({ title: 'Desk home' });
  });
});
