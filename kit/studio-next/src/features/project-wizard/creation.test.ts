import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeJob, makeScriptScene } from '@/test/factories';

import { clock, creation, fileName, useCreation } from './creation';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-10-23T12:00:00.000Z'));
});
afterEach(() => {
  creation.reset();
});

describe('creation view', () => {
  it('formats clocks and file names', () => {
    expect(clock(65)).toBe('1:05');
    expect(clock(-3)).toBe('0:00');
    expect(fileName('kit/videos/demo/flow.mjs')).toBe('demo/flow.mjs');
  });

  it('starts, walks the stages and ticks the clock', () => {
    creation.start();
    expect(useCreation.getState()).toMatchObject({ hidden: false, dialogCreating: true, dialogReady: false, dialogFailed: false });
    creation.stage('project', 'Pinning the brief…');
    creation.stage('brand', 'Reading the brand…');
    const before = useCreation.getState();
    expect(before.detail).toBe('Reading the brand…');
    expect(before.stages.project).toMatchObject({ done: true, active: false });
    expect(before.stages.brand).toMatchObject({ done: false, active: true });
    vi.advanceTimersByTime(5_000);
    const { stages } = useCreation.getState();
    expect(useCreation.getState().elapsed).toBe('0:05');
    expect(stages.brand.time).toBe('0:05');
    expect(useCreation.getState().eta).toBe('this step usually takes ~45 s');
  });

  it('collects files, palette and type from a job stream', () => {
    creation.start();
    creation.stage('brand');
    creation.fromJob(
      makeJob({
        stream: {
          entries: [
            { id: 1, kind: 'tool', title: 'Write', text: 'kit/videos/demo/brand.json', done: true },
            { id: 2, kind: 'line', text: '› Palette: #112233 #aabbcc\n› Typeface: Inter' },
            { id: 3, kind: 'line', text: 'Saved logo.svg (svg)' },
          ],
        },
      }),
    );
    const s = useCreation.getState();
    expect(s.artifacts.map((a) => [a.name, a.note, a.kind])).toEqual([
      ['demo/brand.json', 'written', 'file'],
      ['logo.svg', 'logo svg', 'logo'],
    ]);
    expect(s.swatches).toEqual(['#112233', '#aabbcc']);
    expect(s.font).toEqual({ text: 'Inter', hidden: false });
    expect(s.brandCardHidden).toBe(false);
    expect(s.stages.brand.note).toBe('Saved logo.svg (svg)');
  });

  it('summarises the first script when ready', () => {
    creation.start();
    creation.stage('ready', 'Acme · approve the script to record and render.');
    creation.script(
      {
        scenes: [makeScriptScene({ kind: 'open', title: 'Hi' }), makeScriptScene({ title: 'One', narration: 'Line one' }), makeScriptScene({ kind: 'close', title: 'Bye', narration: '', onScreen: '' })],
        totals: { scenes: 3, chapters: 1, plates: 0, narrated: 1, words: 30, estSec: 90, errors: 1, warnings: 0 },
      },
      { brandName: 'Acme' },
    );
    const s = useCreation.getState();
    expect(s).toMatchObject({ title: 'Your first script is ready', eta: 'done', dialogReady: true, viewReady: true });
    expect(s.script?.meta).toBe('Acme · 1 chapters · 0 plates · 30 words of narration · ~1.5 min');
    expect(s.script?.scenes.map((r) => r.mark)).toEqual(['Open', '1', 'Close']);
    expect(s.script?.lint).toEqual({ hidden: false, error: true, text: '1 blocking issue — Review script first to see and fix it.' });
  });

  it('fails in place and lists what never finished', () => {
    creation.start();
    creation.stage('analyze');
    creation.fail('The app did not load');
    const s = useCreation.getState();
    expect(s).toMatchObject({ dialogFailed: true, title: 'Preparation needs attention', detail: 'The app did not load', eta: 'stopped' });
    expect(s.stages.analyze).toMatchObject({ failed: true, active: false });
    expect(creation.unfinished()).toEqual(['analyze', 'draft']);
    creation.exit();
    expect(useCreation.getState()).toMatchObject({ hidden: true, dialogCreating: false, dialogFailed: false });
  });
});
