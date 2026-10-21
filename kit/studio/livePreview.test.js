import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lensLoupe, lensZoomCeiling, planAfterSeeked, planLensPaint, planLiveSeek } from './livePreview.js';
import { lensGeometry } from '../lib/lens.mjs';

describe('planLiveSeek', () => {
  it('seeks when paused scrub lands away from the current frame', () => {
    assert.deepEqual(planLiveSeek({ currentTime: 1.2, wantRec: 4.5, seeking: false, readyState: 4 }), {
      action: 'seek',
      wantRec: 4.5,
    });
  });

  it('defers while a seek is already in flight so the latest target is kept', () => {
    assert.deepEqual(planLiveSeek({ currentTime: 1.2, wantRec: 8.1, seeking: true, readyState: 2 }), {
      action: 'defer',
      wantRec: 8.1,
    });
  });

  it('defers until metadata is available', () => {
    assert.deepEqual(planLiveSeek({ currentTime: 0, wantRec: 3, seeking: false, readyState: 0 }), {
      action: 'defer',
      wantRec: 3,
    });
  });

  it('no-ops when already on the target frame', () => {
    assert.deepEqual(planLiveSeek({ currentTime: 4.5, wantRec: 4.5 + 1 / 200, seeking: false, readyState: 4 }), {
      action: 'none',
    });
  });
});

describe('planAfterSeeked', () => {
  it('chases a newer scrub target that landed while seeking', () => {
    assert.deepEqual(planAfterSeeked({ currentTime: 2, wantRec: 9.5, playing: false }), {
      action: 'seek',
      wantRec: 9.5,
    });
  });

  it('paints once the element has caught the playhead', () => {
    assert.deepEqual(planAfterSeeked({ currentTime: 9.5, wantRec: 9.5, playing: false }), {
      action: 'paint',
    });
  });

  it('ignores seeked churn during playback', () => {
    assert.deepEqual(planAfterSeeked({ currentTime: 2, wantRec: 9.5, playing: true }), {
      action: 'none',
    });
  });
});

describe('planLensPaint', () => {
  it('clears when no lens is active', () => {
    assert.deepEqual(planLensPaint({ hasLens: false, viewportCssPx: 640, readyState: 4 }), { action: 'clear' });
  });

  it('keeps the last loupe while the decoder is catching up (scrub seek)', () => {
    assert.deepEqual(planLensPaint({ hasLens: true, viewportCssPx: 640, readyState: 1 }), { action: 'keep' });
  });

  it('draws when a frame is available', () => {
    assert.deepEqual(planLensPaint({ hasLens: true, viewportCssPx: 640, readyState: 2 }), { action: 'draw' });
  });
});

describe('lensLoupe', () => {
  const frame = { width: 1920, height: 1080 };
  const render = (w, h, zoom) => lensGeometry({ rect: { x: 100, y: 100, w, h }, zoom }, frame);

  it('matches the render geometry for a small target at any strength', () => {
    for (const zoom of [1.2, 1.8, 2.4, undefined]) {
      const r = render(30, 52, zoom);
      const l = lensLoupe(52, zoom);
      assert.equal(l.zoom, r.zoom, `zoom ${zoom}`);
      assert.equal(l.diameter, r.diameter, `diameter ${zoom}`);
      assert.equal(l.S, r.S, `S ${zoom}`);
    }
  });

  it('drops the strength the same way the render does once the area outgrows the loupe', () => {
    const r = render(400, 60, 2.4);
    const l = lensLoupe(400, 2.4);
    assert.equal(l.zoom, r.zoom);
    assert.equal(l.zoom, 1.2);
    assert.equal(l.diameter, 540);
    assert.equal(l.capped, true);
  });

  it('ceiling is the strength the loupe can still draw for that area', () => {
    assert.equal(lensZoomCeiling(400), 1.2);
    assert.ok(Math.abs(lensZoomCeiling(225) - 2) < 1e-9);
    assert.ok(lensZoomCeiling(52) > 2.4, 'a small target can take the full range');
    const size = 225;
    assert.equal(lensLoupe(size, lensZoomCeiling(size)).capped, false);
    assert.equal(lensLoupe(size, lensZoomCeiling(size) + 0.3).capped, true);
  });
});
