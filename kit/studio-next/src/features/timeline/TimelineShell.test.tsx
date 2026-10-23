import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bridges, type PlateBridge } from '@/desk/bridge';
import { toggleTl } from '@/desk/layout';
import { seekTo } from '@/desk/monitor';
import { runtime } from '@/desk/runtime';
import { desk } from '@/desk/store';
import { makeScene, makeVideo } from '@/test/factories';

import type * as LayoutModule from '@/desk/layout';
import type * as MonitorModule from '@/desk/monitor';

import { ChapterStrip } from '@/features/review/ChapterStrip';
import { TimelineShell } from './TimelineShell';

vi.mock('@/desk/monitor', async (importOriginal) => ({
  ...(await importOriginal<typeof MonitorModule>()),
  seekTo: vi.fn(),
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

const lastToast = () => desk.get().toasts.at(-1);

/** jsdom has no PointerEvent; a MouseEvent of the pointer type carries `clientX`. */
function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup', target: EventTarget, clientX = 0) {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX }));
  });
}

const plate = makeScene({ id: 'open', kind: 'plate', title: 'Intro', start: 0, end: 5, dur: 5, editable: true, plateId: 'open' });
const live = makeScene({ id: 'live-0', kind: 'live', title: 'Tour', start: 5, end: 20, dur: 15, editable: false, plateId: null });

function loaded(over: Partial<ReturnType<typeof desk.get>> = {}) {
  desk.set({
    video: makeVideo(),
    duration: 20,
    scenes: [plate, live],
    chapters: [
      { title: 'Intro', start: 0 },
      { title: 'Tour', start: 10 },
    ],
    cues: [{ start: 2, end: 4, text: 'Hello' }],
    ...over,
  });
}

function stubTrackRect() {
  vi.spyOn($('timelineTrack'), 'getBoundingClientRect').mockReturnValue({ left: 100, width: 200, top: 0, height: 10, right: 300, bottom: 10, x: 100, y: 0, toJSON: () => ({}) });
  vi.spyOn($('timeline'), 'getBoundingClientRect').mockReturnValue({ left: 60, width: 300, top: 0, height: 80, right: 360, bottom: 80, x: 60, y: 0, toJSON: () => ({}) });
}

beforeEach(() => {
  desk.reset();
  vi.clearAllMocks();
  bridges.plate = null;
});

describe('TimelineShell markup', () => {
  it('renders the legacy toolbar and empty lanes before a sequence loads', () => {
    render(<TimelineShell />);
    expect(document.querySelector('footer.timeline-shell')).toHaveAttribute('aria-label', 'Timeline');
    expect($('tlLabel')).toHaveAttribute('aria-expanded', 'true');
    expect($('tlLabel')).toHaveAttribute('aria-controls', 'timeline');
    expect($('tlLabel')).toHaveAttribute('title', 'Collapse the timeline');
    expect($('tlLabel').querySelector('span')).toHaveTextContent('Timeline');
    expect($('tlDuration')).toHaveTextContent('—');
    expect($('timeline')).toHaveAttribute('role', 'slider');
    expect($('timeline')).toHaveAttribute('tabindex', '0');
    expect($('scrubTip')).toHaveAttribute('hidden');
    for (const id of ['timelineRuler', 'timelineRegions', 'timelineMarks', 'timelineChapters', 'timelineCues']) expect($(id)).toBeEmptyDOMElement();
    expect($('clock').textContent).toBe('0:00 / 0:00');
  });

  it('folds through toggleTl and reflects tlCollapsed', async () => {
    render(<TimelineShell />);
    await userEvent.click($('tlLabel'));
    expect(toggleTl).toHaveBeenCalled();
    act(() => desk.set({ tlCollapsed: true }));
    expect($('tlLabel')).toHaveAttribute('aria-expanded', 'false');
    expect($('tlLabel')).toHaveAttribute('title', 'Expand the timeline');
  });

  it('locks in the Editor', () => {
    render(<TimelineShell />);
    act(() => desk.set({ monitorMode: 'plate' }));
    expect(document.querySelector('footer')).toHaveClass('timeline-shell', 'is-plate-locked');
    expect($('tlLabel').querySelector('span')).toHaveTextContent('Editor');
    expect($('timeline')).toHaveAttribute('aria-disabled', 'true');
    expect($('timeline')).toHaveAttribute('tabindex', '-1');
  });
});

describe('renderTimeline', () => {
  it('draws the ruler, regions, marks and lanes once the sequence loads', () => {
    loaded();
    render(<TimelineShell />);
    expect($('tlDuration')).toHaveTextContent('0:20');
    expect($('timelineRuler').querySelectorAll('.tl-tick')).toHaveLength(5);
    expect($('timelineRegions')).toHaveClass('tl-regions', 'is-edit');
    const regions = $('timelineRegions').querySelectorAll('.tl-region');
    expect(regions).toHaveLength(2);
    expect(regions[0]).toHaveClass('tl-region', 'plate', 'is-clickable');
    expect(regions[0]).toHaveAttribute('data-plate-id', 'open');
    expect(regions[0]).toHaveAttribute('data-scene-id', 'open');
    expect(regions[0]).toHaveStyle({ left: '0%', width: '25%' });
    expect(regions[1]).not.toHaveAttribute('data-plate-id');
    expect($('timelineMarks').querySelectorAll('.tl-mark')[1]).toHaveAttribute('title', 'Tour');
    expect($('timelineChapters').querySelectorAll('.tl-ch-clip')[1]).toHaveTextContent('Tour');
    expect($('timelineCues').querySelector('.tl-cue-clip')).toHaveAttribute('title', 'Hello');
  });

  it('highlights the plate being edited', () => {
    loaded({ monitorMode: 'plate', activePlateId: 'open' });
    render(<TimelineShell />);
    expect($('timelineRegions').querySelector('[data-plate-id="open"]')).toHaveClass('is-active');
  });

  it('moves the playhead, fill, buffer and clock with the transport', () => {
    loaded();
    render(<TimelineShell />);
    act(() => desk.set({ transport: { t: 18, d: 20, playing: true, buffered: 10 } }));
    expect($('timelinePlayhead')).toHaveStyle({ left: '90%' });
    expect($('timelinePlayhead')).toHaveClass('tl-head', 'is-flip');
    expect($('timelineFill')).toHaveStyle({ width: '90%' });
    expect($('timelineBuf')).toHaveStyle({ width: '50%' });
    expect($('clock').textContent).toBe('0:18 / 0:20');
  });

  it('opens the editor from a plate region; live regions wait for the Editor', async () => {
    const editCurrentPlate = vi.fn();
    bridges.plate = { editCurrentPlate } as unknown as PlateBridge;
    loaded();
    render(<TimelineShell />);
    const [plateEl, liveEl] = $('timelineRegions').querySelectorAll('.tl-region');
    await userEvent.click(liveEl as Element);
    expect(editCurrentPlate).not.toHaveBeenCalled();
    await userEvent.click(plateEl as Element);
    expect(editCurrentPlate).toHaveBeenCalledWith(plate);
    act(() => desk.set({ monitorMode: 'plate' }));
    await userEvent.click(liveEl as Element);
    expect(editCurrentPlate).toHaveBeenLastCalledWith(live);
  });
});

describe('scrubbing', () => {
  it('seeks on press, shows the tip while dragging, and stops on release', () => {
    loaded();
    render(<TimelineShell />);
    stubTrackRect();
    pointer('pointerdown', $('timeline'), 150);
    expect(seekTo).toHaveBeenLastCalledWith(5);
    expect(desk.get().scrubbing).toBe(true);
    expect($('timeline')).toHaveClass('timeline', 'is-scrubbing');
    pointer('pointermove', window, 200);
    expect(seekTo).toHaveBeenLastCalledWith(10);
    expect($('scrubTip')).not.toHaveAttribute('hidden');
    expect($('scrubTip')).toHaveTextContent('0:10');
    expect($('scrubTip')).toHaveStyle({ left: '140px' });
    pointer('pointerup', window);
    expect(desk.get().scrubbing).toBe(false);
    expect($('scrubTip')).toHaveAttribute('hidden');
    pointer('pointermove', window, 250);
    expect(seekTo).toHaveBeenCalledTimes(2);
  });

  it('uses the active player duration when it has one', () => {
    loaded();
    render(<TimelineShell />);
    stubTrackRect();
    const player = document.createElement('video');
    Object.defineProperty(player, 'duration', { value: 40 });
    runtime.player = player;
    pointer('pointerdown', $('timeline'), 150);
    expect(seekTo).toHaveBeenLastCalledWith(10);
    runtime.player = null;
    pointer('pointerup', window);
  });

  it('snaps onto a chapter start while dragging, and scrubs freely with ⌥', () => {
    loaded();
    render(<TimelineShell />);
    stubTrackRect();
    pointer('pointerdown', $('timeline'), 150);
    pointer('pointermove', window, 204);
    expect(seekTo).toHaveBeenLastCalledWith(10);
    expect($('scrubTip')).toHaveClass('is-scrub', 'is-snap');
    expect($('scrubTip')).toHaveTextContent('0:10.0Tour');
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 204, altKey: true }));
    });
    expect(seekTo).toHaveBeenLastCalledWith(10.4);
    expect($('scrubTip')).not.toHaveClass('is-snap');
    pointer('pointerup', window);
  });

  it('previews the landing time on hover without seeking', () => {
    loaded();
    render(<TimelineShell />);
    stubTrackRect();
    pointer('pointermove', $('timeline'), 250);
    expect(seekTo).not.toHaveBeenCalled();
    expect($('scrubTip')).toHaveClass('is-hover');
    expect($('scrubTip')).toHaveTextContent('0:15');
    expect(document.querySelector('.tl-ghost')).not.toHaveAttribute('hidden');
    expect($('timeline')).toHaveClass('is-hovering');
    act(() => {
      $('timeline').dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
    });
    expect($('scrubTip')).toHaveAttribute('hidden');
  });

  it('seeks from the keyboard and reports its value', async () => {
    loaded({ transport: { t: 12, d: 20, playing: false, buffered: 0 } });
    render(<TimelineShell />);
    const slider = $('timeline');
    expect(slider).toHaveAttribute('aria-valuenow', '12');
    expect(slider).toHaveAttribute('aria-valuemax', '20');
    expect(slider).toHaveAttribute('aria-valuetext', '0:12 of 0:20');
    slider.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(seekTo).toHaveBeenLastCalledWith(13);
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(seekTo).toHaveBeenLastCalledWith(7);
    await userEvent.keyboard('{PageUp}');
    expect(seekTo).toHaveBeenLastCalledWith(10);
    await userEvent.keyboard('{End}');
    expect(seekTo).toHaveBeenLastCalledWith(20);
  });

  it('refuses to scrub in the Editor except on a plate tip', () => {
    loaded({ monitorMode: 'plate' });
    render(<TimelineShell />);
    pointer('pointerdown', $('timelineRuler'), 150);
    expect(seekTo).not.toHaveBeenCalled();
    expect(lastToast()).toMatchObject({ title: 'Timeline locked', detail: 'Exit Plate HTML (Program) to scrub · or click another plate tip', kind: 'warn' });
    const before = desk.get().toasts.length;
    pointer('pointerdown', $('timelineRegions').querySelector('.tl-region') as Element, 150);
    expect(desk.get().toasts).toHaveLength(before);
  });
});

describe('ChapterStrip', () => {
  it('lists chapters, marks the current one and jumps on click', async () => {
    loaded();
    const player = document.createElement('video');
    const play = vi.spyOn(player, 'play').mockResolvedValue(undefined);
    runtime.player = player;
    render(<ChapterStrip />);
    const buttons = $('chapterStrip').querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[1]).toHaveAttribute('data-start', '10');
    expect(buttons[1]?.querySelector('.t')).toHaveTextContent('0:10');
    expect(buttons[1]?.querySelector('.ch-title')).toHaveTextContent('Tour');
    act(() => desk.set({ transport: { t: 12, d: 20, playing: false, buffered: 0 } }));
    expect(buttons[1]).toHaveClass('active');
    expect(buttons[0]).not.toHaveClass('active');
    await userEvent.click(buttons[0] as Element);
    expect(seekTo).toHaveBeenCalledWith(0);
    expect(play).toHaveBeenCalled();
    runtime.player = null;
  });

  it('refuses to jump in the Editor', async () => {
    loaded({ monitorMode: 'plate' });
    render(<ChapterStrip />);
    await userEvent.click($('chapterStrip').querySelector('button') as Element);
    expect(seekTo).not.toHaveBeenCalled();
    expect(lastToast()).toMatchObject({ title: 'Timeline locked', detail: 'Exit to Program to jump chapters' });
  });
});
