import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as JobsModule from '@/desk/jobs';
import { enqueueJob, stopAllWork } from '@/desk/jobs';
import { desk, type QueueItem } from '@/desk/store';
import { toast } from '@/desk/toast';
import { queueMenuGroups } from '@/logic/queueUx';

import { QueueSection } from './QueueSection';

vi.mock('@/desk/toast', () => ({ toast: vi.fn() }));
vi.mock('@/desk/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof JobsModule>()),
  enqueueJob: vi.fn(),
  stopAllWork: vi.fn(() => Promise.resolve()),
}));

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const item = (over: Partial<QueueItem> & Pick<QueueItem, 'qid' | 'kind' | 'label'>): QueueItem => ({
  slug: 'demo',
  fromStep: null,
  resumePipeline: null,
  ...over,
});
const items: QueueItem[] = [
  item({ qid: 'q1', kind: 'step', step: 'plates', label: 'Render brand plates' }),
  item({ qid: 'q2', kind: 'step', step: 'audio', label: 'Add voice & music' }),
];

beforeEach(() => {
  vi.clearAllMocks();
  desk.reset();
});

describe('QueueSection', () => {
  it('shows the empty state with nothing queued', () => {
    render(<QueueSection />);
    expect($('queueSection')).toHaveClass('render-section', 'queue-section');
    expect($('jobQueue').hidden).toBe(true);
    expect($('queueEmpty').hidden).toBe(false);
    expect($('queueEmpty')).toHaveTextContent('Nothing waiting');
    expect($('queueEmpty')).toHaveTextContent('Add a step, or use Render above for the full pass.');
    expect($('btnStopWork').hidden).toBe(true);
    expect($('btnClearQueue').hidden).toBe(true);
    expect($('btnQueueAdd')).toHaveAttribute('aria-expanded', 'false');
    expect($('queueMenu').hidden).toBe(true);
  });

  it('lists the running job and waiting steps', () => {
    render(<QueueSection />);
    act(() => desk.set({ running: item({ qid: 'r', kind: 'make', mode: 'quick', label: 'Render sequence' }), queue: items, jobBusy: true }));
    const rows = $('jobQueue').querySelectorAll('li');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveClass('is-now');
    expect(rows[0]).toHaveTextContent('Render sequence Running now');
    expect(rows[1]).toHaveClass('q-wait');
    expect(rows[1]).toHaveAttribute('data-qid', 'q1');
    expect(rows[2]).toHaveTextContent('Add voice & music Waiting · 2');
    expect($('queueEmpty').hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Render brand plates' }));
    expect(desk.get().queue.map((q) => q.qid)).toEqual(['q2']);
    fireEvent.click($('btnStopWork'));
    expect(stopAllWork).toHaveBeenCalledWith({ reason: 'Stopped' });
  });

  it('clears waiting steps', () => {
    render(<QueueSection />);
    act(() => desk.set({ queue: items }));
    fireEvent.click($('btnClearQueue'));
    expect(desk.get().queue).toEqual([]);
    expect(toast).toHaveBeenCalledWith('Queue cleared', 'Running job (if any) keeps going — use Stop to kill it');
  });
});

describe('QueueMenu', () => {
  it('opens in a body portal with the legacy groups', () => {
    const { container } = render(<QueueSection />);
    fireEvent.click($('btnQueueAdd'));
    const menu = $('queueMenu');
    expect($('btnQueueAdd')).toHaveAttribute('aria-expanded', 'true');
    expect(menu.hidden).toBe(false);
    expect(container.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    expect(menu).toHaveAttribute('role', 'menu');
    expect(menu).toHaveAttribute('data-ready', '1');
    expect(menu.dataset['openUp']).toMatch(/^[01]$/);
    const groups = queueMenuGroups();
    expect([...menu.querySelectorAll('.queue-menu-label')].map((n) => n.textContent)).toEqual(groups.map((g) => g.group));
    expect(menu.querySelectorAll('[data-enqueue]')).toHaveLength(groups.reduce((n, g) => n + g.items.length, 0));
  });

  it('queues the picked step and closes', () => {
    render(<QueueSection />);
    fireEvent.click($('btnQueueAdd'));
    fireEvent.click($('queueMenu').querySelector('[data-enqueue="plates"]') as HTMLElement);
    expect(enqueueJob).toHaveBeenCalledWith({ kind: 'step', step: 'plates', force: true, label: 'Render brand plates' });
    expect($('queueMenu').hidden).toBe(true);
    expect($('btnQueueAdd')).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on an outside click and on Escape', () => {
    render(<QueueSection />);
    fireEvent.click($('btnQueueAdd'));
    fireEvent.click(document.body);
    expect($('queueMenu').hidden).toBe(true);
    fireEvent.click($('btnQueueAdd'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect($('queueMenu').hidden).toBe(true);
    expect(document.activeElement).toBe($('btnQueueAdd'));
  });

  it('toggles from the Add button', () => {
    render(<QueueSection />);
    fireEvent.click($('btnQueueAdd'));
    fireEvent.click($('btnQueueAdd'));
    expect($('queueMenu').hidden).toBe(true);
  });
});
