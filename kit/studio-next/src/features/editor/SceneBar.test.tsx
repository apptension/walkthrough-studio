import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desk } from '@/desk/store';
import { makeScene, makeVideo } from '@/test/factories';

import type * as PlateModule from './engine/plate';
import { askAiForCurrentScene, editCurrentPlate, openMotionForCurrentScene } from './engine/plate';
import { sceneBarView } from './engine/sceneView';
import { SceneBar } from './SceneBar';

vi.mock('./engine/plate', async (importOriginal) => ({
  ...(await importOriginal<typeof PlateModule>()),
  editCurrentPlate: vi.fn(() => Promise.resolve()),
  askAiForCurrentScene: vi.fn(() => Promise.resolve()),
  openMotionForCurrentScene: vi.fn(),
}));

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

const open = makeScene();
const live = makeScene({ index: 1, id: 'live-1', kind: 'live', title: 'Dashboard', type: 'live', start: 4, end: 12, dur: 8, editable: false, plateId: null });
const close = makeScene({ index: 2, id: 'close', title: 'Close', type: 'close', start: 12, end: 16, plateId: 'close' });

beforeEach(() => {
  desk.reset();
  vi.clearAllMocks();
});

describe('sceneBarView', () => {
  const base = { loaded: true, scenes: [open, live, close], cur: open, monitorMode: 'program' as const, activePlateId: null, liveSelectionId: null };

  it('says no scenes once a video without scenes loads', () => {
    const v = sceneBarView({ ...base, scenes: [], cur: null });
    expect(v).toMatchObject({ kind: '—', kindClass: 'scene-kind', title: 'No scenes yet', hint: 'Make a video once so scenes appear', editDisabled: true, askDisabled: true, motionDisabled: true });
  });

  it('describes a plate scene on Program', () => {
    expect(sceneBarView(base)).toEqual({
      kind: 'Plate',
      kindClass: 'scene-kind plate',
      title: 'Open',
      hint: '0:00–0:04 · Edit plate for copy, look and style · Ask AI for agent help',
      editDisabled: false,
      askDisabled: false,
      motionDisabled: false,
      editPrimary: true,
      editLabel: 'Edit plate',
    });
  });

  it('marks the plate under edit', () => {
    const v = sceneBarView({ ...base, monitorMode: 'plate', activePlateId: 'open' });
    expect(v.hint).toBe('0:00–0:04 · click text to edit · Replay / Save · timeline locked');
    expect(v.editPrimary).toBe(false);
    expect(v.editLabel).toBe('Editing…');
  });

  it('offers clip editing for live scenes', () => {
    const v = sceneBarView({ ...base, cur: live });
    expect(v).toMatchObject({ kind: 'Live', kindClass: 'scene-kind live', editLabel: 'Edit clip', askDisabled: true, motionDisabled: true, editDisabled: false });
    expect(v.hint).toBe('0:04–0:12 · Edit clip for speed, zoom and transitions');
  });
});

describe('SceneBar', () => {
  it('keeps the current scene title without the chip strip', () => {
    desk.set({ video: makeVideo(), scenes: [open, live, close], currentScene: close });
    render(<SceneBar />);
    expect($('sceneTitle')).toHaveTextContent('Close');
    expect($('sceneChips')).toHaveAttribute('hidden');
    expect($('sceneChips')).toBeEmptyDOMElement();
  });

  it('disables edit when no plates exist', () => {
    desk.set({ video: makeVideo(), scenes: [], currentScene: null });
    render(<SceneBar />);
    expect($('sceneTitle')).toHaveTextContent('No scenes yet');
    expect($('btnEditScene')).toBeDisabled();
  });

  it('wires the action buttons to the plate engine', () => {
    desk.set({ video: makeVideo(), scenes: [open], currentScene: open });
    render(<SceneBar />);
    fireEvent.click($('btnEditScene'));
    expect(editCurrentPlate).toHaveBeenCalledTimes(1);
    fireEvent.click($('btnAskAiScene'));
    expect(askAiForCurrentScene).toHaveBeenCalledTimes(1);
    fireEvent.click($('btnMotionScene'));
    expect(openMotionForCurrentScene).toHaveBeenCalledTimes(1);
  });

  it('follows the editing plate', () => {
    desk.set({ video: makeVideo(), scenes: [open], currentScene: open });
    render(<SceneBar />);
    expect($('btnEditScene')).toHaveClass('primary');
    act(() => desk.set({ monitorMode: 'plate', activePlateId: 'open' }));
    expect($('btnEditScene')).not.toHaveClass('primary');
    expect($('btnEditSceneLabel')).toHaveTextContent('Editing…');
  });
});
