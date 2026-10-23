import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { VideoSummary } from '@/api/types';
import { decideAction } from '@/desk/action';
import { clockShort, elapsedSec, fmt, fmtShort, formatBytes } from '@/desk/format';
import { describeRecordFailure, recordFailureAction } from '@/logic/recordFailure';
import { makeVideo } from '@/test/factories';

import { ICON_ALIAS, ICON_BODY, ICON_META } from '@/ui/icons.gen';
import { legacyFunction, legacyModule, legacyPath } from './legacySource';

describe('synced legacy assets (run scripts/sync-legacy.mjs when these fail)', () => {
  it('studio.css is the legacy stylesheet byte for byte', () => {
    const ours = readFileSync(resolve(process.cwd(), 'src/styles/studio.css'), 'utf8');
    expect(ours === readFileSync(legacyPath('styles.css'), 'utf8')).toBe(true);
  });

  it('the icon table matches icons.js', () => {
    type LegacyIcons = {
      ICON_BODY: Record<string, string>;
      ICON_META: Record<string, { viewBox: string; present?: Record<string, string> }>;
      ALIAS: Record<string, string>;
    };
    const gen = legacyModule<Omit<LegacyIcons, 'ALIAS'>>('icons.gen.js', ['ICON_BODY', 'ICON_META']);
    const legacy = legacyModule<LegacyIcons>('icons.js', ['ICON_BODY', 'ICON_META', 'ALIAS'], gen);
    expect(ICON_BODY).toEqual(legacy.ICON_BODY);
    expect(ICON_ALIAS).toEqual(legacy.ALIAS);
    for (const [id, meta] of Object.entries(legacy.ICON_META)) {
      expect(ICON_META[id], id).toEqual({ viewBox: meta.viewBox, present: meta.present ?? {} });
    }
  });
});

/**
 * The legacy function, run from `kit/studio/app.js` itself, against its port on
 * the same inputs. A drift here means the port no longer behaves 1:1.
 */

const NUMBERS = [NaN, Infinity, -5, 0, 0.4, 1, 59.9, 60, 61, 599, 3599, 3600, 3661, 86399];

describe('format helpers match app.js', () => {
  it.each([
    ['fmt', fmt],
    ['fmtShort', fmtShort],
    ['clockShort', clockShort],
  ] as const)('%s', (name, port) => {
    const legacy = legacyFunction<(n: number) => string>(name);
    for (const n of NUMBERS) expect(port(n), `${name}(${n})`).toBe(legacy(n));
  });

  it('formatBytes', () => {
    const legacy = legacyFunction<(n: unknown) => string>('formatBytes');
    for (const n of [undefined, null, 'x', -1, 0, 1023, 1024, 5000, 10 * 1024, 1024 ** 2, 5.5 * 1024 ** 2, 1024 ** 3, 3.3 * 1024 ** 3]) {
      expect(formatBytes(n), String(n)).toBe(legacy(n));
    }
  });

  it('elapsedSec', () => {
    const legacy = legacyFunction<(j: unknown) => number>('elapsedSec');
    const jobs = [
      null,
      {},
      { createdAt: '2026-10-01T10:00:00Z', finishedAt: '2026-10-01T10:01:05Z' },
      { startedAt: '2026-10-01T10:00:30Z', createdAt: '2026-10-01T10:00:00Z', finishedAt: '2026-10-01T10:01:05Z' },
    ];
    for (const j of jobs) expect(elapsedSec(j as never)).toBe(legacy(j));
  });
});

describe('decideAction matches app.js', () => {
  const legacy = legacyFunction<(v: unknown) => unknown>('decideAction', { recordFailureAction, describeRecordFailure });

  const cases: Array<[string, VideoSummary]> = [
    ['never rendered', makeVideo({ hasDelivery: false, recordFailure: null, freshness: { liveAt: null, deliveryAt: null } })],
    ['up to date', makeVideo({ hasDelivery: true, recordFailure: null, freshness: { liveAt: 1, deliveryAt: 2, stale: false, needsRecord: false } })],
    ['needs re-record', makeVideo({ hasDelivery: true, recordFailure: null, freshness: { liveAt: 1, needsRecord: true, reason: 'flow.json changed' } })],
    ['plate check failed', makeVideo({ hasDelivery: true, recordFailure: null, freshness: { liveAt: 1, needsRecord: false, plateHealth: { bad: true } } })],
    ['stale', makeVideo({ hasDelivery: true, recordFailure: null, freshness: { liveAt: 1, needsRecord: false, stale: true, reason: 'script changed' } })],
    ['live but no delivery', makeVideo({ hasDelivery: false, recordFailure: null, freshness: { liveAt: 1, deliveryAt: null, needsRecord: false, stale: false } })],
    [
      'record failed (raw reason)',
      makeVideo({
        recordFailure: { reason: 'locator.click: Timeout 30000ms exceeded waiting for getByRole("button", { name: "Save" })', url: 'https://app.example.com/settings' },
      }),
    ],
    [
      'record failed (already parsed)',
      makeVideo({
        recordFailure: { reason: 'Could not click Save', technical: 'Timeout 30000ms', next: 'Check the selector', url: 'https://x.test' },
      }),
    ],
  ];

  it.each(cases)('%s', (_name, v) => {
    expect(decideAction(v)).toEqual(legacy(v));
  });

  it('survives a summary without freshness, like legacy', () => {
    const v = { ...makeVideo(), freshness: undefined } as unknown as VideoSummary;
    expect(decideAction(v)).toEqual(legacy(v));
  });
});
