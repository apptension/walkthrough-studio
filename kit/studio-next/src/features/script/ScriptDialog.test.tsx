import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { desk, openDialog } from '@/desk/store';
import { makeScript, makeScriptScene, makeVideo } from '@/test/factories';

const apiMod = vi.hoisted(() => ({ api: vi.fn(), enc: encodeURIComponent }));
const askMod = vi.hoisted(() => ({ ask: vi.fn(() => Promise.resolve(false)) }));
const jobs = vi.hoisted(() => ({ requestMake: vi.fn(), watchJob: vi.fn(), exportPack: vi.fn() }));
const toastMod = vi.hoisted(() => ({ toast: vi.fn() }));
const video = vi.hoisted(() => ({ refreshSummary: vi.fn(() => Promise.resolve()), openVideo: vi.fn() }));
vi.mock('@/desk/api', () => apiMod);
vi.mock('@/desk/ask', () => askMod);
vi.mock('@/desk/jobs', () => jobs);
vi.mock('@/desk/toast', () => toastMod);
vi.mock('@/desk/video', () => video);

import { defaultSectionCollapsed } from '@/logic/scriptSections';

import { ScriptDialog } from './ScriptDialog';
import { openScript, useScriptSheet } from './sheet';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const payload = makeScript({
  script: {
    scenes: [
      makeScriptScene({ kind: 'open', key: 'open', narrationKey: 'open', narrationKind: 'line', title: 'Hello' }),
      makeScriptScene({ key: 'c1', narrationKey: 'c1', narrationKind: 'line', title: 'One' }),
      makeScriptScene({ key: 'c2', narrationKey: 'c2', narrationKind: 'line', title: 'Two', issues: [{ level: 'warn', message: 'Long line', key: 'c2' }] }),
    ],
    totals: { chapters: 2, plates: 0, words: 16, estSec: 42, errors: 0, warnings: 1 },
  },
  review: { script: { effective: 'draft' } },
});

beforeEach(() => {
  useScriptSheet.setState({
    script: null,
    review: null,
    rev: 0,
    load: null,
    draftJob: null,
    draftTitle: '',
    onlyIssues: false,
    collapsed: { ...defaultSectionCollapsed(), opening: false, story: false, closing: false },
    activeJump: null,
    note: '',
    approvedProof: null,
  });
  desk.set({ slug: 'demo', video: makeVideo() });
  apiMod.api.mockImplementation((path: string) => {
    if (path === '/api/video/demo/script') return Promise.resolve(payload);
    return Promise.resolve({ ok: true });
  });
});
afterEach(() => {
  act(() => openDialog('script', false));
});

async function openSheet() {
  render(<ScriptDialog />);
  await act(() => openScript());
}

describe('ScriptDialog', () => {
  it('opens, loads the script and paints the storyboard', async () => {
    await openSheet();
    expect($<HTMLDialogElement>('scriptDialog').open).toBe(true);
    expect($('scriptTotals')).toHaveTextContent('2 chapters · 0 plates · 16 words · ~0:42');
    const rows = [...document.querySelectorAll<HTMLElement>('#scriptScenes .script-scene')];
    expect(rows.map((r) => r.dataset.key)).toEqual(['open', 'c1', 'c2']);
    expect(rows[2]).toHaveClass('has-warn');
  });

  it('shows the load error in the list', async () => {
    apiMod.api.mockRejectedValueOnce(new Error('No script yet'));
    await openSheet();
    expect($('scriptScenes')).toHaveTextContent('No script yet');
  });

  it('filters to scenes with issues', async () => {
    await openSheet();
    fireEvent.click($('scriptOnlyIssues'));
    const shown = [...document.querySelectorAll<HTMLElement>('#scriptScenes .script-scene')].filter((r) => !r.hidden);
    expect(shown.map((r) => r.dataset.key)).toEqual(['c2']);
  });

  it('saves an edited narration line on blur', async () => {
    await openSheet();
    const ta = document.querySelector<HTMLTextAreaElement>('.script-scene[data-key="c1"] textarea[data-nk]') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'A new line.' } });
    ta.value = 'A new line.';
    fireEvent.blur(ta);
    await waitFor(() =>
      expect(apiMod.api).toHaveBeenCalledWith('/api/video/demo/script/line', { method: 'PUT', body: { kind: 'line', key: 'c1', text: 'A new line.' } }),
    );
  });

  it('needs a note to request changes', async () => {
    await openSheet();
    fireEvent.click($('btnScriptRequest'));
    expect(toastMod.toast).toHaveBeenCalledWith('Add a note', 'Tell the agent what to change', 'warn');
    expect(apiMod.api).not.toHaveBeenCalledWith('/api/video/demo/script/request-changes', expect.anything());
  });

  it('approves with the note and offers the first render', async () => {
    desk.set({ video: makeVideo({ hasDelivery: false, freshness: { liveAt: null, deliveryAt: null } }) });
    askMod.ask.mockResolvedValueOnce(true);
    await openSheet();
    fireEvent.change($('scriptNote'), { target: { value: 'Ship it' } });
    fireEvent.click($('btnScriptApprove'));
    await waitFor(() => expect(jobs.requestMake).toHaveBeenCalledWith('full'));
    expect(apiMod.api).toHaveBeenCalledWith('/api/video/demo/script/approve', { method: 'POST', body: { note: 'Ship it' } });
    expect(toastMod.toast).toHaveBeenCalledWith('Script approved', expect.any(String), 'ok');
    expect(askMod.ask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Record and render now?' }));
  });
});
