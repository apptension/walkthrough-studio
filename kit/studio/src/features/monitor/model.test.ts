import { describe, expect, it } from 'vitest';

import type { CaptionCue, RecordFailure } from '@/api/types';
import type { RenderAction } from '@/desk/action';
import { makeVideo } from '@/test/factories';

import { chapterAt, cueAt, noVideoAction, noVideoView, recordFailureDismissKey, recordFailureInfo, recordFailureKey } from './model';

const CUES: CaptionCue[] = [
  { start: 0, end: 2.5, text: 'First line' },
  { start: 2.5, end: 5, text: 'Second line' },
  { start: 8, end: 10, text: 'After a gap' },
];

const failure = (over: Partial<RecordFailure> = {}): RecordFailure => ({
  reason: 'net::ERR_CONNECTION_REFUSED at http://localhost:3000/app',
  url: '',
  next: '',
  technical: '',
  message: '',
  screenshot: '/media/demo/error.png',
  ...over,
});

const action = (over: Partial<RenderAction> = {}): RenderAction => ({
  kind: 'warn',
  status: 'Out of date',
  title: 'Render to see your changes',
  reason: 'Sources changed since the last render, so Program is behind.',
  primary: { label: 'Render', mode: 'quick' },
  secondary: { label: 'Re-record first', mode: 'full' },
  makeLabel: 'Render',
  ...over,
});

describe('cueAt', () => {
  it('finds the cue under the playhead, end exclusive', () => {
    expect(cueAt(CUES, 1)?.text).toBe('First line');
    expect(cueAt(CUES, 2.5)?.text).toBe('Second line');
    expect(cueAt(CUES, 6)).toBeNull();
  });
});

describe('chapterAt', () => {
  const chapters = [
    { title: 'Intro', start: 0 },
    { title: 'Tour', start: 10 },
  ];
  it('picks the last chapter that started, 50 ms early', () => {
    expect(chapterAt(chapters, 5)?.title).toBe('Intro');
    expect(chapterAt(chapters, 9.96)?.title).toBe('Tour');
    expect(chapterAt([], 3)).toBeNull();
  });
});

describe('record failure', () => {
  it('classifies a raw failure the way renderActionCard does', () => {
    const info = recordFailureInfo(makeVideo({ recordFailure: failure() }));
    expect(info?.reason).toBe('The browser could not open the start URL.');
    expect(info?.next).toBe('Start the app, confirm the URL, then re-record.');
    expect(info?.url).toBe('http://localhost:3000/app');
  });

  it('keeps a failure the server already classified', () => {
    const raw = failure({ reason: 'Custom', technical: 'trace' });
    expect(recordFailureInfo(makeVideo({ recordFailure: raw }))).toBe(raw);
    expect(recordFailureInfo(makeVideo({ recordFailure: null }))).toBeNull();
  });

  it('dismissing stores the key the panel compares against', () => {
    const raw = failure();
    const info = recordFailureInfo(makeVideo({ recordFailure: raw }));
    expect(recordFailureDismissKey('demo', raw)).toBe(recordFailureKey('demo', info));
    expect(recordFailureKey('demo', null)).toBeNull();
  });
});

describe('noVideoAction', () => {
  it('shows the busy view with the bay headline while a render runs', () => {
    const bay = { pillClass: 'render-pill run', pillText: 'Rendering', headline: 'Rendering sequence', reason: 'Live log here.' };
    expect(noVideoAction(action(), { busy: true, bay })).toEqual({
      busy: true,
      status: 'Rendering',
      title: 'Rendering sequence',
      reason: 'Live log here.',
    });
    expect(noVideoView(action(), { busy: true, bay }).kicker).toBe('Rendering');
  });

  it('offers Render again when Program is up to date', () => {
    const view = noVideoView(action({ kind: 'ok', status: 'Up to date', title: null, reason: null, primary: null, secondary: null }), {
      busy: false,
      bay: null,
    });
    expect(view.title).toBe('Nothing to play yet');
    expect(view.reason).toBe('Render a sequence to watch the cut here.');
    expect(view.primary).toEqual({ label: 'Render again', mode: 'quick' });
  });

  it('passes the action through otherwise', () => {
    const view = noVideoView(action(), { busy: false, bay: null });
    expect(view.tone).toBe('stale');
    expect(view.icon).toBe('empty-stale');
    expect(view.secondary).toEqual({ label: 'Re-record first', mode: 'full' });
  });
});
