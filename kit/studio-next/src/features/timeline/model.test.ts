import { describe, expect, it } from 'vitest';

import { makeScene } from '@/test/factories';

import { chapterClips, chapterMarks, cueClips, fmtScrub, keySeek, playheadPct, regionViews, rulerTicks, scrubPoint, trackRatio } from './model';

const ctx = { plateMode: false, activePlateId: null, liveSelectionId: null };

describe('rulerTicks', () => {
  it('ticks every 5 s on a short cut, labelling the majors', () => {
    const ticks = rulerTicks(20);
    expect(ticks.map((t) => t.left)).toEqual(['0%', '25%', '50%', '75%', '100%']);
    expect(ticks.map((t) => t.className)).toEqual(['tl-tick major', 'tl-tick', 'tl-tick major', 'tl-tick', 'tl-tick major']);
    expect(ticks.map((t) => t.label)).toEqual(['0:00', null, '0:10', null, '0:20']);
  });

  it('labels every tick once the step reaches 30 s', () => {
    const ticks = rulerTicks(200);
    expect(ticks).toHaveLength(7);
    expect(ticks.every((t) => t.label != null)).toBe(true);
    expect(ticks[1]?.className).toBe('tl-tick');
    expect(rulerTicks(100)[1]?.left).toBe('10%');
  });
});

describe('regionViews', () => {
  const plate = makeScene({ id: 'open', kind: 'plate', title: 'Intro', start: 0, end: 5, dur: 5, editable: true, plateId: 'open' });
  const live = makeScene({
    id: 'live-0',
    kind: 'live',
    title: 'Tour',
    start: 5,
    end: 10,
    dur: 5,
    editable: false,
    plateId: null,
    transitionIn: { type: 'dissolve', dur: 0.5 },
  });

  it('draws a clickable block per scene and its join', () => {
    const { edit, regions } = regionViews([plate, live, makeScene({ id: 'zero', dur: 0 })], [], 10, ctx);
    expect(edit).toBe(true);
    expect(regions).toEqual([
      {
        key: 'r-open',
        kind: 'region',
        className: 'tl-region plate is-clickable',
        left: '0%',
        width: '50%',
        title: 'Intro · 0:00–0:05 · click to edit this plate',
        sceneId: 'open',
        plateId: 'open',
      },
      {
        key: 'r-live-0',
        kind: 'region',
        className: 'tl-region live is-clickable',
        left: '50%',
        width: '50%',
        title: 'Tour · 0:05–0:10 · click to edit speed, zoom and transitions',
        sceneId: 'live-0',
      },
      { key: 'x-live-0', kind: 'xfade', className: 'tl-xfade', left: '50%', width: '5%', title: 'dissolve 0.50s → Tour' },
    ]);
  });

  it('highlights the plate under edit and the selected live clip in the Editor', () => {
    const active = regionViews([plate, live], [], 10, { plateMode: true, activePlateId: 'open', liveSelectionId: 'live-0' });
    expect(active.regions[0]?.className).toBe('tl-region plate is-active is-clickable');
    expect(active.regions[1]?.className).toBe('tl-region live is-active is-clickable');
    const program = regionViews([plate], [], 10, { ...ctx, activePlateId: 'open' });
    expect(program.regions[0]?.className).toBe('tl-region plate is-clickable');
  });

  it('stripes chapters when there are no scenes', () => {
    const { edit, regions } = regionViews([], [{ title: 'B', start: 4 }, { title: 'A', start: 0 }], 10, ctx);
    expect(edit).toBe(false);
    expect(regions.map((r) => [r.className, r.width, r.left])).toEqual([
      ['tl-region live', '40%', undefined],
      ['tl-region plate', '60%', undefined],
    ]);
  });
});

describe('lanes', () => {
  it('places chapter marks and clips, stringifying multi-line titles', () => {
    const chapters = [
      { title: 'Intro', start: 0 },
      { title: ['It records your', '*real product*'], start: 5 },
    ];
    expect(chapterMarks(chapters, 10)).toEqual([
      { key: '0-0', left: '0%', title: 'Intro' },
      { key: '1-5', left: '50%', title: 'It records your,*real product*' },
    ]);
    expect(chapterClips(chapters, 10).map((c) => [c.left, c.width, c.label])).toEqual([
      ['0%', '50%', 'Intro'],
      ['50%', '50%', 'It records your,*real product*'],
    ]);
  });

  it('keeps tiny chapter and cue clips visible', () => {
    expect(chapterClips([{ title: 'A', start: 0 }, { title: 'B', start: 0.01 }], 100)[0]?.width).toBe('0.8%');
    expect(cueClips([{ start: 1, end: 1.1, text: 'Hi' }], 100)).toEqual([{ key: '0-1', left: '1%', width: '0.4%', title: 'Hi' }]);
  });
});

describe('geometry', () => {
  it('maps the playhead and the pointer', () => {
    expect(playheadPct(5, 20)).toBe(25);
    expect(playheadPct(5, 0)).toBe(0);
    expect(trackRatio(150, { left: 100, width: 200 })).toBe(0.25);
    expect(trackRatio(50, { left: 100, width: 200 })).toBe(0);
    expect(trackRatio(400, { left: 100, width: 200 })).toBe(1);
  });
});

describe('scrubPoint', () => {
  const rect = { left: 100, width: 200 };
  const chapters = [{ title: 'Intro', start: 0 }, { title: 'Tour', start: 10 }];

  it('snaps within 6 px of a chapter start and names it', () => {
    expect(scrubPoint(205, rect, 20, chapters)).toEqual({ ratio: 0.5, sec: 10, chapter: 'Tour' });
    expect(scrubPoint(207, rect, 20, chapters).chapter).toBeNull();
  });

  it('stays free when asked or when there is nothing to snap to', () => {
    expect(scrubPoint(204, rect, 20, chapters, { free: true })).toEqual({ ratio: 0.52, sec: 10.4, chapter: null });
    expect(scrubPoint(204, rect, 0, chapters).chapter).toBeNull();
  });
});

describe('fmtScrub', () => {
  it('reads m:ss.t', () => {
    expect(fmtScrub(0)).toBe('0:00.0');
    expect(fmtScrub(75.46)).toBe('1:15.4');
    expect(fmtScrub(Number.NaN)).toBe('0:00.0');
  });
});

describe('keySeek', () => {
  const chapters = [{ title: 'Intro', start: 0 }, { title: 'Tour', start: 10 }];
  it('steps, jumps chapters and clamps to the cut', () => {
    expect(keySeek('ArrowRight', 12, 20, chapters)).toBe(13);
    expect(keySeek('ArrowLeft', 12, 20, chapters, { big: true })).toBe(7);
    expect(keySeek('ArrowLeft', 0.5, 20, chapters)).toBe(0);
    expect(keySeek('PageUp', 12, 20, chapters)).toBe(10);
    expect(keySeek('PageUp', 10, 20, chapters)).toBe(0);
    expect(keySeek('PageDown', 2, 20, chapters)).toBe(10);
    expect(keySeek('PageDown', 12, 20, chapters)).toBe(20);
    expect(keySeek('Home', 12, 20, chapters)).toBe(0);
    expect(keySeek('End', 12, 20, chapters)).toBe(20);
    expect(keySeek('a', 12, 20, chapters)).toBeNull();
  });
});
