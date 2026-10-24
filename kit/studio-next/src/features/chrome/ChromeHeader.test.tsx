import { act, fireEvent, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chooseAgent, switchSequence } from '@/desk/boot';
import { bridges, type WorkflowBridge } from '@/desk/bridge';
import { decideAction } from '@/desk/action';
import { exportPack, requestMake } from '@/desk/jobs';
import { desk, type QueueItem } from '@/desk/store';
import { snapshotVersion } from '@/features/project-panel/versionActions';
import { mountMark } from '@/logic/mark';
import { makeHealth, makeIndex, makeVideo } from '@/test/factories';

import { ChromeHeader } from './ChromeHeader';

vi.mock('@/desk/boot', () => ({
  switchSequence: vi.fn(() => Promise.resolve(true)),
  chooseAgent: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/desk/jobs', () => ({ requestMake: vi.fn(), exportPack: vi.fn() }));
vi.mock('@/features/project-panel/versionActions', () => ({ snapshotVersion: vi.fn(() => Promise.resolve()) }));
vi.mock('@/logic/mark', () => ({ mountMark: vi.fn(), getMarkMode: () => 'idle' }));

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

const queued = (n: number): QueueItem[] =>
  Array.from({ length: n }, (_, i) => ({ qid: `q${i}`, slug: 'demo', label: 'Render', kind: 'make', fromStep: null, resumePipeline: null }));

beforeEach(() => {
  desk.reset();
  vi.clearAllMocks();
  bridges.workflow = null;
});

describe('ChromeHeader markup', () => {
  it('renders the legacy header before boot', () => {
    render(<ChromeHeader />);
    expect(document.querySelector('header.chrome .chrome-brand')).toHaveAttribute('title', 'Walkthrough Studio');
    expect(document.querySelector('header.chrome .chrome-main .chrome-nav')).not.toBeNull();
    const sequence = document.querySelector('header.chrome .chrome-sequence');
    expect(sequence).toHaveAttribute('aria-label', 'Current sequence');
    expect(sequence?.contains($('slugSelect'))).toBe(true);
    expect(sequence?.contains($('btnProjectSettings'))).toBe(true);
    expect(sequence?.contains($('btnBranch'))).toBe(true);
    expect(sequence?.contains($('btnNewVideo'))).toBe(false);
    expect($('brandMark')).toHaveAttribute('width', '48');
    expect($('slugSelect')).toBeEmptyDOMElement();
    expect($('btnProjectSettings')).toHaveAttribute('hidden');
    expect($('btnNewVideo').querySelector('.btn-label')).toHaveTextContent('New video');
    expect($('btnBranch').querySelector('.btn-label')).toHaveTextContent('Branch');
    expect(document.getElementById('statusLine')).toBeNull();
    expect($('renderCluster')).toHaveAttribute('data-kind', 'idle');
    expect($('btnMakeLabel')).toHaveTextContent('Render');
    expect($('btnMakeLabel')).toHaveClass('btn-label');
    expect($('queueBadge')).toHaveAttribute('hidden');
    expect($('btnCommand')).toHaveAttribute('aria-label', 'Open command menu');
    expect($('btnHelp')).toHaveTextContent('?');
    expect(document.querySelectorAll('#agentChrome [data-agent]')).toHaveLength(2);
    expect($('agentTip')).toHaveAttribute('hidden');
  });

  it('mounts the brand mark when boot has not claimed it, and names the build', async () => {
    render(<ChromeHeader />);
    await waitFor(() => expect(mountMark).toHaveBeenCalledWith($('brandMark'), expect.objectContaining({ size: 22 })));
    act(() => desk.set({ version: '0.42.0' }));
    expect(document.querySelector('.chrome-brand')).toHaveAttribute('title', 'Walkthrough Studio 0.42.0');
  });

  it('leaves a mark that boot already mounted alone', async () => {
    render(<ChromeHeader />);
    Object.assign($('brandMark'), { __mark: {} });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(mountMark).not.toHaveBeenCalled();
  });
});

describe('#slugSelect', () => {
  it('fills from the index and follows the open sequence', () => {
    const a = makeVideo({ slug: 'a', title: 'Alpha' });
    const b = makeVideo({ slug: 'b', title: 'Beta', lineage: { role: 'branch' } });
    desk.set({ index: makeIndex({ videos: [a, b], folders: [{ id: 'f', title: 'Folder', slugs: ['a', 'b'], videos: [a, b] }], loose: [] }), slug: 'b' });
    render(<ChromeHeader />);
    const sel = $('slugSelect') as HTMLSelectElement;
    expect(sel.querySelector('optgroup')).toHaveAttribute('label', 'Folder');
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Alpha', '  ↳ Beta']);
    expect(sel.value).toBe('b');
  });

  it('marks branch and needs-setup rows for the picker without changing their text', () => {
    const a = makeVideo({ slug: 'a', title: 'Alpha' });
    const b = makeVideo({ slug: 'b', title: 'Beta', lineage: { role: 'branch' } });
    const broken = { slug: 'c', error: 'no brand' } as unknown as typeof a;
    desk.set({ index: makeIndex({ videos: [a, b, broken], folders: [], loose: [a, b, broken] }), slug: 'a' });
    render(<ChromeHeader />);
    const sel = $('slugSelect') as HTMLSelectElement;
    const [alpha, beta, setup] = [...sel.options] as [HTMLOptionElement, HTMLOptionElement, HTMLOptionElement];
    expect(sel.options).toHaveLength(3);
    expect(alpha.className).toBe('');
    expect(beta).toHaveClass('is-branch');
    expect(beta.querySelector('.sel-tree')).toHaveAttribute('aria-hidden', 'true');
    expect(beta.querySelector('.sel-label')).toHaveTextContent('Beta');
    expect(setup).toHaveClass('is-setup');
    expect(setup.querySelector('.sel-note')).toHaveAttribute('data-note', 'Setup');
    expect(setup.textContent).toBe('c (needs setup)');
  });

  it('says "No videos" for an empty project list', () => {
    desk.set({ index: makeIndex({ videos: [], folders: [], loose: [] }) });
    render(<ChromeHeader />);
    expect($('slugSelect')).toHaveTextContent('No videos');
  });

  it('switches through switchSequence and reverts a refused switch', async () => {
    const a = makeVideo({ slug: 'a', title: 'Alpha' });
    const b = makeVideo({ slug: 'b', title: 'Beta' });
    desk.set({ index: makeIndex({ videos: [a, b], folders: [], loose: [] }), slug: 'a' });
    let refuse!: (ok: boolean) => void;
    vi.mocked(switchSequence).mockImplementationOnce(() => new Promise((r) => (refuse = r)));
    render(<ChromeHeader />);
    const sel = $('slugSelect') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'b' } });
    expect(switchSequence).toHaveBeenCalledWith('b');
    expect(sel.value).toBe('b');
    await act(async () => {
      refuse(false);
      await Promise.resolve();
    });
    expect(sel.value).toBe('a');
  });
});

describe('buttons', () => {
  it('route to the workflow bridge', async () => {
    const workflow = {
      openProjectNew: vi.fn(),
      openProjectSettings: vi.fn(),
      openBranch: vi.fn(),
      openCommandMenu: vi.fn(),
      openHelp: vi.fn(),
    };
    bridges.workflow = workflow as unknown as WorkflowBridge;
    desk.set({ video: makeVideo() });
    render(<ChromeHeader />);
    expect($('btnProjectSettings')).not.toHaveAttribute('hidden');
    await userEvent.click($('btnNewVideo'));
    await userEvent.click($('btnProjectSettings'));
    await userEvent.click($('btnBranch'));
    await userEvent.click($('btnCommand'));
    await userEvent.click($('btnHelp'));
    for (const fn of Object.values(workflow)) expect(fn).toHaveBeenCalledTimes(1);
  });

  it('Render, Export and Save version call the engine', async () => {
    render(<ChromeHeader />);
    await userEvent.click($('btnMake'));
    expect(requestMake).toHaveBeenCalledWith();
    await userEvent.click($('btnExport'));
    expect(exportPack).toHaveBeenCalled();
    await userEvent.click($('btnSnapshot'));
    expect(snapshotVersion).toHaveBeenCalled();
  });

  it('paints status, the make label, the queue badge and busy states', () => {
    render(<ChromeHeader />);
    const video = makeVideo({ freshness: { needsRecord: true } });
    act(() =>
      desk.set({
        video,
        action: decideAction(video),
        queue: queued(2),
        busy: { btnMake: true, btnExport: true },
      }),
    );
    expect($('renderCluster')).toHaveAttribute('data-tone', 'warn');
    expect(document.querySelector('.render-fresh-label')).toHaveTextContent('Needs re-record');
    expect($('btnMakeLabel')).toHaveTextContent('Re-record');
    expect($('queueBadge')).not.toHaveAttribute('hidden');
    expect($('queueBadge')).toHaveTextContent('2');
    expect($('btnMake')).toHaveClass('busy');
    expect($('btnMake')).toBeDisabled();
    expect($('btnExport')).toBeDisabled();
    expect($('btnSnapshot')).not.toBeDisabled();
  });

  it('has one status surface — the Render cluster', () => {
    render(<ChromeHeader />);
    const stale = makeVideo({ hasDelivery: true, freshness: { stale: true } });
    act(() => desk.set({ video: stale, action: decideAction(stale) }));
    expect(document.querySelectorAll('.chrome-status')).toHaveLength(0);
    expect(document.querySelector('.render-fresh-label')).toHaveTextContent('Out of date');
  });
});

describe('agent chrome', () => {
  it('paints the runners from agentAuth', () => {
    desk.set({ agentAuth: makeHealth().agentAuth });
    render(<ChromeHeader />);
    for (const btn of document.querySelectorAll<HTMLElement>('#agentChrome [data-agent]')) {
      expect(btn).toHaveAttribute('data-state');
      expect(btn).toHaveAttribute('data-tip');
      expect(btn).toHaveAttribute('aria-pressed');
      expect(btn).not.toHaveAttribute('title');
      expect(btn).not.toBeDisabled();
    }
  });

  it('shows the tip on hover and focus, hides it on leave', () => {
    render(<ChromeHeader />);
    const btn = document.querySelector('[data-agent="claude"]') as HTMLElement;
    fireEvent.pointerOver(btn);
    expect($('agentTip')).not.toHaveAttribute('hidden');
    expect($('agentTip').textContent).toBe(
      'Claude CodeNot installedInstall from claude.ai/code, then run: claude /login',
    );
    fireEvent.pointerOut(btn, { relatedTarget: document.body });
    expect($('agentTip')).toHaveAttribute('hidden');
    fireEvent.focus(btn);
    expect($('agentTip')).not.toHaveAttribute('hidden');
    fireEvent.blur(btn, { relatedTarget: null });
    expect($('agentTip')).toHaveAttribute('hidden');
  });

  it('switches to a ready runner, and ignores the active or missing one', async () => {
    const health = makeHealth().agentAuth;
    desk.set({
      agentAuth: {
        ...health,
        provider: 'cursor',
        preference: 'cursor',
        runners: { ...health.runners, claude: { ...health.runners.claude, available: true, authenticated: true, soft: false } },
      },
    });
    render(<ChromeHeader />);
    await userEvent.click(document.querySelector('[data-agent="cursor"]') as HTMLElement);
    expect(chooseAgent).not.toHaveBeenCalled();
    await userEvent.click(document.querySelector('[data-agent="claude"]') as HTMLElement);
    expect(chooseAgent).toHaveBeenCalledWith('claude');
    act(() => desk.set({ agentAuth: null }));
    await userEvent.click(document.querySelector('[data-agent="claude"]') as HTMLElement);
    expect(chooseAgent).toHaveBeenCalledTimes(1);
  });

  it('disables both logos while the switch is in flight', async () => {
    const health = makeHealth().agentAuth;
    desk.set({
      agentAuth: { ...health, provider: 'cursor', runners: { ...health.runners, claude: { ...health.runners.claude, available: true, authenticated: true } } },
    });
    let done!: () => void;
    vi.mocked(chooseAgent).mockImplementationOnce(() => new Promise<void>((r) => (done = r)));
    render(<ChromeHeader />);
    await userEvent.click(document.querySelector('[data-agent="claude"]') as HTMLElement);
    for (const btn of document.querySelectorAll('#agentChrome [data-agent]')) expect(btn).toHaveAttribute('aria-disabled', 'true');
    await act(async () => {
      done();
      await Promise.resolve();
    });
    expect(document.querySelector('[data-agent="claude"]')).toHaveAttribute('aria-disabled', 'false');
  });
});
