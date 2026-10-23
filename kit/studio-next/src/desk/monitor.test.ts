import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Scene } from '@/api/types';
import { makeVideo } from '@/test/factories';

import { bridges, type EditorBridge } from './bridge';
import * as monitor from './monitor';
import { runtime } from './runtime';
import { desk } from './store';

function fakeVideo(): HTMLVideoElement {
  const el = document.createElement('video');
  el.pause = vi.fn();
  el.load = vi.fn();
  el.play = vi.fn(() => Promise.resolve());
  Object.defineProperty(el, 'duration', { value: 100, configurable: true });
  return el;
}

const scene = (id: string, start: number, end: number, plateId?: string) => ({ id, start, end, plateId }) as unknown as Scene;

beforeEach(() => {
  desk.reset();
  runtime.player = fakeVideo();
  runtime.playerA = fakeVideo();
  runtime.playerB = fakeVideo();
  bridges.editor = null;
  bridges.plate = null;
});
afterEach(() => {
  runtime.player = runtime.playerA = runtime.playerB = null;
  vi.useRealTimers();
});

describe('setMonitorMode', () => {
  it('normalizes legacy modes and labels each pane like app.js', () => {
    monitor.setMonitorMode('live');
    expect(desk.get().monitorLabel).toEqual({ text: 'Live', hint: 'Page capture — Program returns to the master' });
    expect(runtime.player?.pause).toHaveBeenCalled();
    monitor.setMonitorMode('compare');
    expect(desk.get()).toMatchObject({ monitorMode: 'compare', compare: true });
    expect(desk.get().monitorLabel.text).toBe('Compare');
  });

  it('enters and leaves the editor through its bridge', () => {
    const editor = { onEnter: vi.fn(), onLeave: vi.fn(), onPlateDirty: vi.fn() } as unknown as EditorBridge;
    bridges.editor = editor;
    runtime.player!.currentTime = 12;
    monitor.setMonitorMode('plate');
    expect(editor.onEnter).toHaveBeenCalledWith({ programT: 12 });
    expect(desk.get().monitorLabel).toEqual({ text: 'Editor', hint: 'Changes save as you go · Render to bake them into the video' });
    monitor.setMonitorMode('program');
    expect(editor.onLeave).toHaveBeenCalled();
  });

  it('warns about unsaved plate edits once per session', () => {
    desk.set({ plateDirty: true });
    monitor.setMonitorMode('program');
    monitor.setMonitorMode('program');
    expect(desk.get().toasts.filter((t) => t.title === 'Unsaved plate edits')).toHaveLength(1);
  });
});

describe('setCompare', () => {
  it('needs a saved version first', () => {
    desk.set({ video: makeVideo({ versions: [] }) });
    monitor.setCompare(true);
    expect(desk.get().compare).toBe(false);
    expect(desk.get().toasts.at(-1)).toMatchObject({ title: 'Save a snapshot first', detail: 'Then use Compare' });
  });

  it('points A at the master and B at the version', () => {
    const v = makeVideo({ slug: 'demo', deliveryUrl: '/media/demo/demo.mp4' });
    desk.set({ slug: 'demo', video: { ...v, versions: [{ id: 'v1' } as never] }, compareId: 'v1' });
    monitor.setCompare(true);
    expect(desk.get().monitorMode).toBe('compare');
    expect(runtime.playerA?.getAttribute('src')).toMatch(/^\/media\/demo\/demo\.mp4\?t=/);
    expect(runtime.playerB?.getAttribute('src')).toBe('/version-media/demo/v1/demo.mp4');
  });
});

describe('transport', () => {
  it('clamps a seek into the clip and reports the time', () => {
    monitor.seekTo(250);
    expect(runtime.player?.currentTime).toBe(100);
    monitor.seekTo(-3);
    expect(runtime.player?.currentTime).toBe(0);
    expect(desk.get().transport).toMatchObject({ t: 0, d: 100, playing: false });
  });

  it('flashes the chapter toast for 1.4 s when a new chapter starts', () => {
    vi.useFakeTimers();
    desk.set({ chapters: [{ start: 0, title: 'Intro' }, { start: 10, title: 'Invite' }] });
    runtime.player!.currentTime = 11;
    monitor.updateTransport();
    expect(desk.get().chapterToast).toEqual({ title: 'Invite', on: true });
    expect(desk.get().lastChapter).toBe(10);
    vi.advanceTimersByTime(1400);
    expect(desk.get().chapterToast.on).toBe(false);
  });

  it('names the scene under the playhead, pinned to the plate being edited', () => {
    const scenes = [scene('a', 0, 5, 'p1'), scene('b', 5, 10, 'p2')];
    desk.set({ scenes });
    monitor.updateSceneFromTime(6);
    expect(desk.get().currentScene?.id).toBe('b');
    desk.set({ monitorMode: 'plate', activePlateId: 'p1' });
    monitor.updateSceneFromTime(6);
    expect(desk.get().currentScene?.id).toBe('a');
  });
});

describe('paintLivePreview', () => {
  it('does not replace a frame that is already showing — a new src aborts the load and the picture freezes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    desk.set({ monitorMode: 'live' });
    const video = makeVideo({ previewUrl: '/media/demo/live-preview.jpg' });
    monitor.paintLivePreview(video, { recording: true });
    expect(desk.get().live.src).toMatch(/live-preview\.jpg\?t=/);

    desk.set((s) => ({ live: { ...s.live, src: 'blob:kept' } }));
    vi.setSystemTime(5_000);
    monitor.paintLivePreview(video, { recording: true });
    expect(desk.get().live.src).toBe('blob:kept');
    expect(desk.get().live.url).toBe('/media/demo/live-preview.jpg');
  });
});

describe('playPlatePreview', () => {
  it('plays a plate MP4 on Program as a stand-in and says so', () => {
    monitor.playPlatePreview('/media/demo/plates/p1.mp4', 'Intro card');
    expect(desk.get().previewingPlate).toBe('/media/demo/plates/p1.mp4');
    expect(runtime.player?.getAttribute('src')).toMatch(/^\/media\/demo\/plates\/p1\.mp4\?t=\d+$/);
    expect(desk.get().monitorLabel).toEqual({
      text: 'Preview · Intro card',
      hint: 'Plate encode — Program tab or Play restores the master',
    });
  });
});
