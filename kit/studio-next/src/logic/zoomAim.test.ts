import assert from 'node:assert/strict';

import { test } from 'vitest';

import { clampZoomCenter, zoomPreviewStyle } from './zoomAim';

const frame = { width: 1920, height: 1080 };

test('a zoom greater than 1 can centre on the left edge and the right edge', () => {
  const zoom = 1.8;
  const left = clampZoomCenter(0, 540, { zoom, ...frame });
  const right = clampZoomCenter(frame.width, 400, { zoom, ...frame });
  const halfW = frame.width / (2 * zoom);
  assert.equal(left.cx, Math.round(halfW));
  assert.equal(right.cx, Math.round(frame.width - halfW));
  assert.equal(left.crop.x, 0);
  assert.equal(Math.round(right.crop.x + right.crop.w), frame.width);
  assert.ok(left.crop.y >= 0 && left.crop.y + left.crop.h <= frame.height);
  assert.ok(right.crop.x >= 0);
});

test('the preview shows the frame edge and no pixels outside it', () => {
  const zoom = 2;
  const left = clampZoomCenter(0, 0, { zoom, ...frame });
  const style = zoomPreviewStyle(left.cx, left.cy, { zoom, ...frame });
  assert.equal(style.transformOrigin, '0 0');
  assert.match(style.transform, /^scale\(2(?:\.0+)?\) translate\(0%?,/);
  const inset = clampZoomCenter(10, 10, { zoom, ...frame });
  assert.equal(inset.crop.x, 0);
  assert.equal(inset.crop.y, 0);
});
