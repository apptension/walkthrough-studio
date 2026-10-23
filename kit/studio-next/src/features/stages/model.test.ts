import { describe, expect, it } from 'vitest';

import { makeVideo } from '@/test/factories';

import {
  currentStage,
  OUT_OF_DATE,
  STAGE_ORDER,
  stageHint,
  stageMetaText,
  stages,
  stageWhen,
} from './model';

const NOW = Date.parse('2026-10-23T12:00:00.000Z');
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

describe('stageWhen', () => {
  it('reads as "just now" inside the first minute', () => {
    expect(stageWhen(minutesAgo(0), NOW)).toBe('just now');
    expect(stageWhen(minutesAgo(0.4), NOW)).toBe('just now');
  });

  it('counts minutes, then hours', () => {
    expect(stageWhen(minutesAgo(5), NOW)).toBe('5 min ago');
    expect(stageWhen(minutesAgo(59), NOW)).toBe('59 min ago');
    expect(stageWhen(minutesAgo(90), NOW)).toBe('2 h ago');
    expect(stageWhen(minutesAgo(23 * 60), NOW)).toBe('23 h ago');
  });

  it('falls back to a calendar date past a day', () => {
    expect(stageWhen(minutesAgo(48 * 60), NOW)).toMatch(/Oct/);
  });

  it('is empty for a missing timestamp', () => {
    expect(stageWhen(null, NOW)).toBe('');
    expect(stageWhen(undefined, NOW)).toBe('');
  });
});

describe('stages', () => {
  it('covers every stage in the bar', () => {
    const map = stages(makeVideo(), NOW);
    expect(Object.keys(map).sort()).toEqual([...STAGE_ORDER].sort());
  });

  describe('brief', () => {
    it('is always done, and says when it was pinned', () => {
      const video = makeVideo({ brief: { createdAt: minutesAgo(5) } });
      expect(stages(video, NOW).brief).toEqual({ tone: 'done', meta: 'Pinned 5 min ago' });
    });

    it('falls back to the config when there is no brief file', () => {
      expect(stages(makeVideo({ brief: null }), NOW).brief).toEqual({
        tone: 'done',
        meta: 'From config',
      });
    });
  });

  describe('script', () => {
    it('is done once approved', () => {
      const video = makeVideo({
        review: { script: { effective: 'approved', approvedAt: minutesAgo(12) } },
      });
      expect(stages(video, NOW).script).toEqual({ tone: 'done', meta: 'Approved 12 min ago' });
    });

    it('is active while a draft waits for approval', () => {
      const video = makeVideo({ review: { script: { status: 'draft', effective: 'draft' } } });
      expect(stages(video, NOW).script).toEqual({ tone: 'active', meta: 'Needs approval' });
    });

    it('warns when the script drifted after approval', () => {
      const video = makeVideo({ review: { script: { status: 'approved', effective: 'changed' } } });
      expect(stages(video, NOW).script).toEqual({
        tone: 'warn',
        meta: 'Changed since approval',
      });
    });

    it('warns when changes were requested', () => {
      const video = makeVideo({ review: { script: { status: 'changes-requested', effective: 'changes-requested' } } });
      expect(stages(video, NOW).script.tone).toBe('warn');
    });
  });

  describe('direction', () => {
    it('shows the palette and transition once approved', () => {
      const video = makeVideo({ direction: { approvedAt: minutesAgo(30), palette: 'luminous' } });
      video.transitions.style = 'wipe';
      expect(stages(video, NOW).direction).toEqual({ tone: 'done', meta: 'luminous · wipe' });
    });

    it('names the default transition language when none is set', () => {
      const video = makeVideo({ direction: { approvedAt: minutesAgo(1) } });
      video.transitions.style = '';
      expect(stages(video, NOW).direction.meta).toBe('signature · directed');
    });

    it('waits for the script before inviting a choice', () => {
      const video = makeVideo({
        direction: { approvedAt: null },
        review: { script: { effective: 'draft' } },
      });
      expect(stages(video, NOW).direction).toEqual({ tone: 'idle', meta: 'After script' });
    });

    it('becomes active as soon as the script is approved', () => {
      const video = makeVideo({ direction: { approvedAt: null } });
      expect(stages(video, NOW).direction).toEqual({
        tone: 'active',
        meta: 'Choose visual language',
      });
    });
  });

  describe('record', () => {
    it('is ready once script and direction are both signed off', () => {
      const video = makeVideo({
        direction: { approvedAt: minutesAgo(10) },
        freshness: { liveAt: null },
      });
      expect(stages(video, NOW).record).toEqual({ tone: 'active', meta: 'Ready to record' });
    });

    it('waits on the script when only direction is approved', () => {
      const video = makeVideo({
        direction: { approvedAt: minutesAgo(10) },
        review: { script: { effective: 'draft' } },
        freshness: { liveAt: null },
      });
      expect(stages(video, NOW).record).toEqual({ tone: 'idle', meta: 'After script' });
    });

    it('waits on direction when it is still open', () => {
      const video = makeVideo({ direction: { approvedAt: null }, freshness: { liveAt: null } });
      expect(stages(video, NOW).record).toEqual({ tone: 'idle', meta: 'After direction' });
    });

    it('warns when the flow moved on since the take', () => {
      const video = makeVideo({ freshness: { liveAt: NOW - 60_000, needsRecord: true } });
      expect(stages(video, NOW).record).toEqual({
        tone: 'warn',
        meta: 'Flow changed — re-record',
      });
    });

    it('reports when the take was captured', () => {
      const video = makeVideo({ freshness: { liveAt: NOW - 20 * 60_000, needsRecord: false } });
      expect(stages(video, NOW).record).toEqual({ tone: 'done', meta: 'Recorded 20 min ago' });
    });
  });

  describe('cut', () => {
    it('is idle before the first render', () => {
      const video = makeVideo({ hasDelivery: false });
      expect(stages(video, NOW).cut).toEqual({ tone: 'idle', meta: 'No render yet' });
    });

    it('flags a stale master ahead of any review state', () => {
      const video = makeVideo({
        freshness: { stale: true },
        review: { cut: { effective: 'approved' } },
      });
      expect(stages(video, NOW).cut).toEqual({ tone: 'warn', meta: OUT_OF_DATE });
    });

    it('names the approved version', () => {
      const video = makeVideo({
        review: { cut: { effective: 'approved', versionName: 'v12 · Rendered sequence' } },
      });
      expect(stages(video, NOW).cut).toEqual({
        tone: 'done',
        meta: 'Approved v12 · Rendered sequence',
      });
    });

    it('does not leave a trailing space when the version is unnamed', () => {
      const video = makeVideo({ review: { cut: { effective: 'approved', versionName: null } } });
      expect(stages(video, NOW).cut.meta).toBe('Approved');
    });

    it('warns when a newer render landed after approval', () => {
      const video = makeVideo({ review: { cut: { effective: 'changed' } } });
      expect(stages(video, NOW).cut).toEqual({ tone: 'warn', meta: 'New render since approval' });
    });

    it('warns when changes were requested', () => {
      const video = makeVideo({ review: { cut: { effective: 'changes-requested' } } });
      expect(stages(video, NOW).cut).toEqual({ tone: 'warn', meta: 'Changes requested' });
    });

    it('awaits review for a fresh unreviewed render', () => {
      const video = makeVideo({ review: { cut: { effective: 'none' } } });
      expect(stages(video, NOW).cut).toEqual({ tone: 'active', meta: 'Awaiting review' });
    });
  });

  describe('deliver', () => {
    it('is done when the pack was built from the current master', () => {
      const deliveryAt = NOW - 10 * 60_000;
      const video = makeVideo({
        freshness: { deliveryAt },
        deliver: { generatedAt: new Date(deliveryAt + 1000).toISOString() },
      });
      expect(stages(video, NOW).deliver).toEqual({ tone: 'done', meta: 'Exported 10 min ago' });
    });

    it('is not done when the pack predates the master by more than the write window', () => {
      const deliveryAt = NOW - 10 * 60_000;
      const video = makeVideo({
        freshness: { deliveryAt },
        deliver: { generatedAt: new Date(deliveryAt - 60_000).toISOString() },
        review: { cut: { effective: 'approved' } },
      });
      expect(stages(video, NOW).deliver).toEqual({ tone: 'active', meta: 'Ready to export' });
    });

    it('tolerates the 5s slack between writing the master and the pack', () => {
      const deliveryAt = NOW - 10 * 60_000;
      const video = makeVideo({
        freshness: { deliveryAt },
        deliver: { generatedAt: new Date(deliveryAt - 4000).toISOString() },
      });
      expect(stages(video, NOW).deliver.tone).toBe('done');
    });

    it('waits for cut approval', () => {
      const video = makeVideo({ deliver: null, review: { cut: { effective: 'none' } } });
      expect(stages(video, NOW).deliver).toEqual({ tone: 'idle', meta: 'After cut approval' });
    });
  });
});

describe('currentStage', () => {
  it('marks the earliest stage that still wants attention', () => {
    const video = makeVideo({
      review: { script: { effective: 'draft' }, cut: { effective: 'changed' } },
    });
    expect(currentStage(stages(video, NOW))).toBe('script');
  });

  it('skips past finished stages', () => {
    const video = makeVideo({
      direction: { approvedAt: minutesAgo(10) },
      review: { cut: { effective: 'none' } },
    });
    expect(currentStage(stages(video, NOW))).toBe('cut');
  });

  it('is null when the production is fully signed off', () => {
    const deliveryAt = NOW - 60_000;
    const video = makeVideo({
      direction: { approvedAt: minutesAgo(10) },
      freshness: { deliveryAt, liveAt: NOW - 120_000 },
      review: { cut: { effective: 'approved' } },
      deliver: { generatedAt: new Date(deliveryAt).toISOString() },
    });
    expect(currentStage(stages(video, NOW))).toBeNull();
  });
});

describe('stageMetaText', () => {
  it('rewrites the Cut stale label to an instruction', () => {
    expect(stageMetaText('cut', { tone: 'warn', meta: OUT_OF_DATE })).toBe('Needs render');
  });

  it('leaves every other stage and label alone', () => {
    expect(stageMetaText('record', { tone: 'warn', meta: OUT_OF_DATE })).toBe(OUT_OF_DATE);
    expect(stageMetaText('cut', { tone: 'done', meta: 'Approved v12' })).toBe('Approved v12');
  });
});

describe('stageHint', () => {
  it('leads with the stale-master explanation', () => {
    const video = makeVideo({
      freshness: { stale: true },
      review: { script: { effective: 'draft' } },
    });
    const hint = stageHint(stages(video, NOW));
    expect(hint.tone).toBe('warn');
    expect(hint.text).toContain('sources changed since the last render');
  });

  it('asks for script approval first', () => {
    const video = makeVideo({ review: { script: { effective: 'draft' } } });
    expect(stageHint(stages(video, NOW)).text).toContain('approve the script before recording');
  });

  it('then asks for the visual language', () => {
    const video = makeVideo({ direction: { approvedAt: null } });
    expect(stageHint(stages(video, NOW)).text).toContain('palette, guided focus');
  });

  it('says nothing about re-recording — the Render bay already does', () => {
    const video = makeVideo({
      direction: { approvedAt: minutesAgo(5) },
      freshness: { liveAt: NOW - 60_000, needsRecord: true },
    });
    expect(stageHint(stages(video, NOW))).toEqual({ text: '', tone: '' });
  });

  it('invites a cut review', () => {
    const video = makeVideo({
      direction: { approvedAt: minutesAgo(5) },
      review: { cut: { effective: 'none' } },
    });
    expect(stageHint(stages(video, NOW)).text).toContain('approve it');
  });

  it('invites the handoff export once the cut is approved', () => {
    const video = makeVideo({
      direction: { approvedAt: minutesAgo(5) },
      review: { cut: { effective: 'approved' } },
      deliver: null,
    });
    expect(stageHint(stages(video, NOW)).text).toContain('Export the handoff pack');
  });

  it('stays quiet when nothing needs saying', () => {
    const deliveryAt = NOW - 60_000;
    const video = makeVideo({
      direction: { approvedAt: minutesAgo(5) },
      freshness: { deliveryAt, liveAt: NOW - 120_000 },
      review: { cut: { effective: 'approved' } },
      deliver: { generatedAt: new Date(deliveryAt).toISOString() },
    });
    expect(stageHint(stages(video, NOW))).toEqual({ text: '', tone: '' });
  });
});
