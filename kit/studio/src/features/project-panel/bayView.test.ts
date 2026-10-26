import { describe, expect, it } from 'vitest';

import { decideAction } from '@/desk/action';
import { makeFreshness, makeVideo } from '@/test/factories';

import { briefView } from './bayView';

const idle = { jobBusy: false, bay: null };

describe('briefView', () => {
  it('keeps the markup defaults before a sequence loads', () => {
    const v = briefView(null, idle);
    expect(v.pillClass).toBe('render-pill warn');
    expect(v.pillText).toBe('Needs attention');
    expect(v.headline).toBe('Select a sequence');
    expect(v.reason).toBe('Choose a video, then render or queue jobs from here.');
    expect(v.reasonTitle).toBeUndefined();
    expect(v.primary).toEqual({ hidden: false, mode: undefined, label: 'Render' });
    expect(v.secondary.hidden).toBe(true);
  });

  it('offers Render again when Program matches the sources', () => {
    const v = briefView(decideAction(makeVideo()), idle);
    expect(v.pillClass).toBe('render-pill ok');
    expect(v.pillText).toBe('Up to date');
    expect(v.headline).toBe('Program matches your sources');
    expect(v.reason).toBe('Watch it, give feedback, or approve the cut from the stage bar.');
    expect(v.reasonTitle).toBe('');
    expect(v.primary).toEqual({ hidden: false, mode: 'quick', label: 'Render again' });
    expect(v.secondary.hidden).toBe(true);
  });

  it('paints a stale sequence with both CTAs and the detail as the reason title', () => {
    const v = briefView(decideAction(makeVideo({ freshness: makeFreshness({ stale: true, reason: 'narration changed' }) })), idle);
    expect(v.pillClass).toBe('render-pill warn');
    expect(v.pillText).toBe('Out of date');
    expect(v.headline).toBe('Render to see your changes');
    expect(v.reasonTitle).toBe('narration changed');
    expect(v.primary).toEqual({ hidden: false, mode: 'quick', label: 'Render' });
    expect(v.secondary).toEqual({ hidden: false, mode: 'full', label: 'Re-record first' });
  });

  it('keeps the pipeline headline while a job runs', () => {
    const bay = { pillClass: 'render-pill run', pillText: 'Rendering', headline: 'Rendering sequence', reason: 'Live log…' };
    const v = briefView(decideAction(makeVideo()), { jobBusy: true, bay });
    expect(v.pillClass).toBe('render-pill run');
    expect(v.pillText).toBe('Rendering');
    expect(v.headline).toBe('Rendering sequence');
    expect(v.reason).toBe('Live log…');
  });

  it('says Rendering when busy without a bay override', () => {
    const v = briefView(decideAction(makeVideo()), { jobBusy: true, bay: null });
    expect(v.pillClass).toBe('render-pill run');
    expect(v.pillText).toBe('Rendering');
    expect(v.headline).toBe('Program matches your sources');
  });
});
