import { describe, expect, it } from 'vitest';

import { decideAction } from '@/desk/action';
import type { PipelineStep } from '@/desk/store';
import { makeVideo } from '@/test/factories';

import { baseChipView, chipView, clearsToUpToDate, IDLE_VIEW, REVIEW_LABEL, type ChipInput } from './renderStatus';

const NOW = 1_760_010_000_000;
const minutesAgo = (m: number) => NOW - m * 60_000;

const staleVideo = makeVideo({
  hasDelivery: true,
  freshness: {
    stale: true,
    deliveryAt: minutesAgo(120),
    sources: [
      { key: 'narration', mtime: minutesAgo(4), newerThanDelivery: true, newerThanLive: true },
      { key: 'flow', mtime: minutesAgo(300), newerThanDelivery: false, newerThanLive: false },
      { key: 'config', mtime: minutesAgo(30), newerThanDelivery: true, newerThanLive: true },
    ],
  },
});

function input(video = staleVideo, extra: Partial<ChipInput> = {}): ChipInput {
  return {
    video,
    action: decideAction(video),
    busy: false,
    activity: '',
    pipeline: null,
    catching: false,
    proposalOpen: false,
    notice: null,
    ...extra,
  };
}

describe('chipView · render state', () => {
  it('folds away when the cut is current', () => {
    expect(chipView(input(makeVideo()), NOW)).toEqual(IDLE_VIEW);
  });

  it('says Out of date and lists what changed after the last render, newest first', () => {
    const view = chipView(input(), NOW);
    expect(view).toMatchObject({ kind: 'render', tone: 'warn', label: 'Out of date', attention: true, click: 'render' });
    expect(view.tip?.lead).toContain('These changed after it was made');
    expect(view.tip?.changes.map((c) => [c.label, c.when])).toEqual([
      ['Narration', '4 min ago'],
      ['Project settings', '30 min ago'],
    ]);
    expect(view.tip).toMatchObject({ lastRender: '2 h ago', next: 'Click Render to catch up', detail: '' });
  });

  it('still explains itself when the server names no source', () => {
    const view = chipView(input(makeVideo({ hasDelivery: true, freshness: { stale: true, sources: [] } })), NOW);
    expect(view.tip?.lead).toBe('Program still plays the last render. Sources changed after it was made.');
  });

  it('covers every warn the Render bay decides', () => {
    const rerecord = makeVideo({
      freshness: {
        needsRecord: true,
        reason: 'flow.mjs changed after the take',
        sources: [{ key: 'flow', mtime: minutesAgo(2), newerThanDelivery: true, newerThanLive: true }],
      },
    });
    expect(chipView(input(rerecord), NOW)).toMatchObject({ label: 'Needs re-record', tone: 'warn' });
    expect(chipView(input(rerecord), NOW).tip?.changes.map((c) => c.label)).toEqual(['Recording flow']);
    expect(chipView(input(rerecord), NOW).tip?.next).toBe('Click Re-record & Render');

    const plates = makeVideo({ freshness: { plateHealth: { bad: true, issues: ['open: drift'], byId: {} }, reason: 'Plate render QC: open: drift' } });
    const plateView = chipView(input(plates), NOW);
    expect(plateView).toMatchObject({ label: 'Plate check failed', tone: 'warn' });
    expect(plateView.tip?.detail).toBe('Plate render QC: open: drift');

    const fresh = makeVideo({ hasDelivery: false, freshness: { liveAt: null, deliveryAt: null } });
    expect(chipView(input(fresh), NOW)).toMatchObject({ label: 'Not rendered', tone: 'accent', attention: false });
  });
});

describe('chipView · review, busy and notices', () => {
  it('asks for a review while agent edits wait, above the render state', () => {
    const view = chipView(input(staleVideo, { proposalOpen: true }), NOW);
    expect(view).toMatchObject({ kind: 'review', tone: 'review', label: REVIEW_LABEL, click: 'feedback', attention: true });
    expect(view.tip?.changes).toHaveLength(2);
  });

  it('shows the running pipeline step while busy, and catches up with the change list', () => {
    const pipeline: PipelineStep[] = [
      { id: 'plates', label: 'Render brand plates', status: 'done' },
      { id: 'produce', label: 'Produce master video', status: 'run' },
      { id: 'audio', label: 'Add voice & music', status: 'todo' },
      { id: 'preview', label: 'Show in player', status: 'todo' },
    ];
    const view = chipView(input(staleVideo, { busy: true, activity: 'Rendering…', pipeline, catching: true }), NOW);
    expect(view).toMatchObject({ kind: 'busy', tone: 'run', label: 'Produce master video', click: null });
    expect(view.tip?.title).toBe('Catching up');
    expect(view.tip?.steps.map((s) => s.id)).toEqual(['plates', 'produce', 'audio']);
    expect(view.tip?.changes).toHaveLength(2);
  });

  it('falls back to the activity line when no pipeline runs', () => {
    const view = chipView(input(makeVideo(), { busy: true, activity: 'Agent working on feedback…' }), NOW);
    expect(view.label).toBe('Agent working on feedback…');
    expect(view.tip?.changes).toEqual([]);
  });

  it('lets a passing notice through, but never over a running job', () => {
    const notice = { tone: 'ok' as const, text: 'Poster @ 0:12' };
    expect(chipView(input(staleVideo, { notice }), NOW)).toMatchObject({ kind: 'notice', tone: 'ok', label: 'Poster @ 0:12', tip: null });
    expect(chipView(input(staleVideo, { notice, busy: true }), NOW).kind).toBe('busy');
    expect(baseChipView(input(staleVideo, { notice }), NOW).kind).toBe('render');
  });
});

describe('clearsToUpToDate', () => {
  it('only celebrates a real catch-up', () => {
    const render = chipView(input(), NOW);
    const busy = chipView(input(makeVideo(), { busy: true }), NOW);
    expect(clearsToUpToDate(render, false)).toBe(true);
    expect(clearsToUpToDate(busy, true)).toBe(true);
    expect(clearsToUpToDate(busy, false)).toBe(false);
    expect(clearsToUpToDate(IDLE_VIEW, false)).toBe(false);
  });
});
