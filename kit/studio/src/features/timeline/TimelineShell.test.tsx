import { act, render, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toggleTl } from '@/desk/layout';
import { seekTo, setMonitorMode } from '@/desk/monitor';
import { desk } from '@/desk/store';
import { ed, resetEdForTests } from '@/features/editor/engine/state';
import type { Deck } from '@/features/editor/engine/types';
import { makeScene, makeVideo } from '@/test/factories';
import { server } from '@/test/msw/server';

import type * as LayoutModule from '@/desk/layout';
import type * as MonitorModule from '@/desk/monitor';

import { TimelineShell } from './TimelineShell';

vi.mock('@/desk/monitor', async (importOriginal) => ({
  ...(await importOriginal<typeof MonitorModule>()),
  seekTo: vi.fn(),
  setMonitorMode: vi.fn(),
}));

vi.mock('@/desk/layout', async (importOriginal) => ({
  ...(await importOriginal<typeof LayoutModule>()),
  toggleTl: vi.fn(),
}));

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

/** jsdom has no PointerEvent; a MouseEvent of the pointer type carries `clientX`. */
function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup', target: EventTarget, clientX = 0) {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX }));
  });
}

const deck = (): Deck => ({
  slug: 'demo',
  deck: { speed: [], zooms: [], zoomSkips: [], lenses: [], lensOff: [], transitions: {}, audio: null, cards: [], layouts: [], order: [], omit: [], repeats: [], trims: [], cuts: [] },
  live: { exists: true, durationSec: 40, pieces: [] },
  space: { cssW: 440, cssH: 950 },
  naturalIds: ['open', 'live-0'],
  scenes: [
    { id: 'open', kind: 'plate', title: 'Opening', plateId: 'open', type: 'open', dur: 4 },
    { id: 'live-0', kind: 'live', title: 'Feed', recFrom: 0, recTo: 40, dur: 40 },
  ],
  joins: [],
  marks: [{ kind: 'chapter', t: 10, label: 'Tour', key: 'ch:10' }],
  zoomShots: [],
  lenses: [],
});

async function openProgram() {
  server.use(http.get('/api/video/:slug/edit', () => HttpResponse.json(deck())));
  desk.set({
    slug: 'demo',
    video: makeVideo(),
    duration: 44,
    monitorMode: 'program',
    scenes: [
      makeScene({ id: 'open', kind: 'plate', start: 0, end: 4, dur: 4 }),
      makeScene({ id: 'live-0', kind: 'live', start: 4, end: 44, dur: 40 }),
    ],
    chapters: [{ title: 'Tour', start: 14 }],
  });
  render(<TimelineShell />);
  await waitFor(() => expect(document.querySelectorAll('#etlClips .etl-clip')).toHaveLength(2));
}

beforeEach(() => {
  desk.reset();
  resetEdForTests();
  vi.clearAllMocks();
});

describe('TimelineShell', () => {
  it('holds the one timeline', () => {
    render(<TimelineShell />);
    const shell = document.querySelector('footer.timeline-shell');
    expect(shell).toHaveAttribute('aria-label', 'Timeline');
    expect(shell?.querySelector('#edTimeline')).not.toBeNull();
    expect(document.getElementById('timeline')).toBeNull();
    expect($('etlOpen')).toHaveTextContent('Edit');
  });

  it('folds from the bar toggle', () => {
    render(<TimelineShell />);
    act(() => $('etlToggle').click());
    expect(toggleTl).toHaveBeenCalledTimes(1);
  });
});

describe('Program overview', () => {
  it('draws the cut as one slider with an invitation to edit', async () => {
    await openProgram();
    const scroll = $('etlScroll');
    expect(scroll).toHaveAttribute('role', 'slider');
    expect(scroll).toHaveAttribute('tabindex', '0');
    expect($('etlContext')).toHaveTextContent('Click a clip, chapter or caption to edit it');
    expect(document.querySelector('#etlChapters .ec-card')).toHaveTextContent('Tour');
    // Native tooltips step aside for the scrub tip.
    expect(document.querySelector('#etlClips .etl-clip')).not.toHaveAttribute('title');
    expect(document.querySelector('#etlClips .etl-clip')).toHaveAttribute('aria-label');
  });

  it('says so when Program still plays an older render', async () => {
    server.use(http.get('/api/video/:slug/edit', () => HttpResponse.json({ ...deck(), stale: true })));
    desk.set({ slug: 'demo', video: makeVideo(), duration: 44 });
    render(<TimelineShell />);
    await waitFor(() => expect($('etlContext')).toHaveTextContent('Program still plays the last render'));
  });

  it('keeps the playhead on the Program clock', async () => {
    await openProgram();
    act(() => desk.set({ transport: { t: 10, d: 44, playing: false, buffered: 0 } }));
    expect(ed.t).toBeCloseTo(10);
    expect($('edClock')).toHaveTextContent('0:10 / 0:44');
    expect($('etlScroll')).toHaveAttribute('aria-valuetext', '0:10 of 0:44');
  });

  it('scrubs Program from anywhere off a block', async () => {
    await openProgram();
    // jsdom: the canvas sits at x 0 and the fit is 200px for 44s.
    pointer('pointerdown', $('etlRuler'), 100);
    expect(seekTo).toHaveBeenLastCalledWith(expect.closeTo(22, 1));
    expect(desk.get().scrubbing).toBe(true);
    pointer('pointermove', $('etlRuler'), 150);
    expect(seekTo).toHaveBeenLastCalledWith(expect.closeTo(33, 1));
    pointer('pointerup', $('etlRuler'), 150);
    expect(desk.get().scrubbing).toBe(false);
    expect(setMonitorMode).not.toHaveBeenCalled();
  });

  it('opens the Editor on a clicked clip', async () => {
    await openProgram();
    const clip = document.querySelector<HTMLElement>('#etlClips .etl-clip[data-id="live-0"]')!;
    pointer('pointerdown', clip, 100);
    pointer('pointerup', clip, 100);
    expect(setMonitorMode).toHaveBeenCalledWith('plate');
    expect(ed.focus?.sel).toEqual({ type: 'clip', id: 'live-0' });
    expect(ed.focus?.t).toBeCloseTo(22, 0);
    expect(seekTo).not.toHaveBeenCalled();
  });

  it('opens the Editor on a clicked chapter, selected', async () => {
    await openProgram();
    const card = document.querySelector<HTMLElement>('#etlChapters .ec-card')!;
    pointer('pointerdown', card, 70);
    pointer('pointerup', card, 70);
    expect(setMonitorMode).toHaveBeenCalledWith('plate');
    expect(ed.focus?.sel).toMatchObject({ type: 'card', key: 'ch:10', markT: 10, clipId: 'live-0' });
  });

  it('turns a drag that starts on a block into a scrub', async () => {
    await openProgram();
    const clip = document.querySelector<HTMLElement>('#etlClips .etl-clip[data-id="live-0"]')!;
    pointer('pointerdown', clip, 100);
    pointer('pointermove', clip, 120);
    pointer('pointerup', clip, 120);
    expect(seekTo).toHaveBeenCalled();
    expect(setMonitorMode).not.toHaveBeenCalled();
  });

  it('seeks from the keyboard and opens the Editor on Enter', async () => {
    await openProgram();
    act(() => desk.set({ transport: { t: 10, d: 44, playing: false, buffered: 0 } }));
    const scroll = $('etlScroll');
    act(() => {
      scroll.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(seekTo).toHaveBeenLastCalledWith(11);
    act(() => {
      scroll.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(setMonitorMode).toHaveBeenCalledWith('plate');
    expect(ed.focus).toBeNull();
  });

  it('opens the Editor where Program is from the Edit button', async () => {
    await openProgram();
    act(() => $('etlOpen').click());
    expect(setMonitorMode).toHaveBeenCalledWith('plate');
  });
});
