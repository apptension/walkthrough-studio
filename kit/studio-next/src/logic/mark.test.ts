import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

// @ts-expect-error legacy JS module has no types
import * as legacyMark from '../../../studio/mark.js';

import { MODES, MarkRenderer, markSvg } from './mark';

interface LegacyRenderer {
  setMode(mode: string): void;
  step(dt: number): boolean;
  draw(g: unknown, size: number): void;
}
const legacy = legacyMark as {
  markSvg: () => string;
  MarkRenderer: new (opts?: Record<string, unknown>) => LegacyRenderer;
};

/** A 2D context that records every call and property write, gradients included. */
function recordingContext(log: unknown[]): CanvasRenderingContext2D {
  const gradient = (kind: string, args: unknown[]): unknown => {
    log.push([kind, ...args]);
    return { addColorStop: (...stop: unknown[]) => log.push(['stop', ...stop]) };
  };
  const target: Record<string, unknown> = {
    createLinearGradient: (...a: unknown[]) => gradient('linear', a),
    createRadialGradient: (...a: unknown[]) => gradient('radial', a),
    createConicGradient: (...a: unknown[]) => gradient('conic', a),
  };
  return new Proxy(target, {
    get(t, key: string) {
      if (key in t) return t[key];
      return (...args: unknown[]) => log.push([key, ...args]);
    },
    set(_t, key: string, value: unknown) {
      log.push(['set', key, typeof value === 'object' ? 'gradient' : value]);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

describe('mark', () => {
  test('MODES has every state', () => {
    assert.deepEqual(Object.keys(MODES), ['idle', 'loading', 'draft', 'render', 'record', 'export', 'ok', 'err']);
    assert.equal(MODES.record.glyph, 'rec');
  });

  test('markSvg returns the idle frame as SVG, byte-identical to the legacy engine', () => {
    const svg = markSvg();
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.ok(svg.endsWith('</svg>\n'));
    assert.equal(svg, legacy.markSvg());
  });

  test('MarkRenderer constructs, morphs modes and steps without throwing', () => {
    const r = new MarkRenderer({ mode: 'loading', enter: true });
    for (const mode of Object.keys(MODES)) {
      r.setMode(mode);
      for (let i = 0; i < 20; i++) r.step(1 / 60);
    }
    r.setMode('nope');
    assert.equal(r.mode, 'idle');
    assert.equal(typeof r.step(1 / 60), 'boolean');
  });

  test('drawing matches the legacy renderer call for call across modes and tiers', () => {
    for (const size of [16, 32, 64]) {
      const next = new MarkRenderer({ mode: 'idle', enter: true });
      const old = new legacy.MarkRenderer({ mode: 'idle', enter: true });
      const a: unknown[] = [];
      const b: unknown[] = [];
      const ga = recordingContext(a);
      const gb = recordingContext(b);
      for (const mode of ['loading', 'draft', 'render', 'record', 'export', 'ok', 'err', 'idle']) {
        next.setMode(mode);
        old.setMode(mode);
        for (let i = 0; i < 12; i++) {
          assert.equal(next.step(1 / 30), old.step(1 / 30));
          next.draw(ga, size);
          old.draw(gb, size);
        }
      }
      assert.deepEqual(a, b);
      assert.ok(a.length > 1000);
    }
  });
});
