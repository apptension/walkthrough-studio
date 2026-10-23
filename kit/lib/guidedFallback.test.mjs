import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { compileGuidedFlow, isAnchored, targetFor, tourFallbacks } from './guidedTour.mjs';
import { makeNear, near } from './replayTarget.mjs';

/** The Teamdeck shape: a hover tooltip with no stable handle, reached by a CSS path. */
const loose = {
  tag: 'div',
  role: 'generic',
  name: 'HL Vacation',
  text: 'HL delete edit Vacation',
  css: 'block-tooltip-header > div',
  box: { x: 292, y: 659, w: 250, h: 73 },
  point: { x: 295, y: 666 },
  rel: { fx: 0.012, fy: 0.096 },
  matches: 0,
  nth: 0,
};

const anchored = {
  tag: 'button',
  role: 'button',
  name: 'Add booking',
  testid: 'add-booking',
  box: { x: 10, y: 10, w: 120, h: 40 },
  point: { x: 40, y: 20 },
  rel: { fx: 0.25, fy: 0.25 },
  matches: 1,
  nth: 0,
};

test('a target with no stable handle is not anchored', () => {
  assert.equal(isAnchored(loose), false);
  assert.equal(isAnchored(anchored), true);
  assert.equal(isAnchored({ tag: 'div', role: 'generic', name: 'Week 42', id: 'week-42' }), true);
  assert.equal(isAnchored({ tag: 'canvas', canvas: 0 }), true);
});

test('a loose pointer target carries the captured geometry as a fallback', () => {
  const code = targetFor(loose, { matched: true, step: 'HL Vacation' });
  assert.match(code, /fallback:/);
  assert.match(code, /x: 295/);
  assert.match(code, /"width":\s*250/);
  assert.match(code, /"point":|point: \{"x":295/);
});

test('an anchored target is replayed by its handle alone', () => {
  assert.doesNotMatch(targetFor(anchored, { matched: true, step: 'Add booking' }), /fallback:/);
});

test('without a 1:1 viewport the captured pixels are not trusted', () => {
  assert.doesNotMatch(targetFor(loose, { matched: false, step: 'HL Vacation' }), /fallback:/);
});

test('steps that put a value in only run on a handle they found', () => {
  assert.doesNotMatch(targetFor(loose, { matched: true, step: 'x', value: true }), /fallback:/);
});

test('a guided tour compiles the fallback into the flow', () => {
  const flow = compileGuidedFlow({
    slug: 'teamdeck',
    stats: { steps: 1 },
    window: { w: 1440, h: 900 },
    recordViewport: { width: 1440, height: 900 },
    steps: [
      { id: 'start', type: 'start', url: 'http://localhost/app' },
      { id: 'HL Vacation', type: 'click', target: loose, gap: 0 },
    ],
  });
  assert.match(flow, /fallback:/);
});

test('replay clicks the captured pixel when the tour selector is gone', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
  try {
    await page.setContent(`
      <style>body{margin:0}#cell{position:absolute;left:100px;top:120px;width:200px;height:60px;background:#ccc}</style>
      <div id="cell"></div>
      <script>
        window.hits = [];
        document.getElementById('cell').addEventListener('click', (e) => window.hits.push([e.clientX, e.clientY]));
      </script>
    `);
    const handle = await near(page.locator('block-tooltip-header > div'), {
      x: 110,
      y: 130,
      step: 'HL Vacation',
      timeout: 500,
      fallback: { box: { x: 100, y: 120, width: 200, height: 60 }, point: { x: 110, y: 130 } },
    });
    await handle.click();
    assert.deepEqual(await page.evaluate(() => window.hits), [[110, 130]]);

    // spot() math has to keep working on the fallback, the same as on a real locator.
    const box = await handle.boundingBox();
    assert.deepEqual(box, { x: 100, y: 120, width: 200, height: 60 });
    await handle.click({ position: { x: 50, y: 30 } });
    assert.deepEqual((await page.evaluate(() => window.hits)).at(-1), [150, 150]);
  } finally {
    await browser.close();
  }
});

test('the tour supplies the fallback for flows that never asked for one', async () => {
  const tour = {
    window: { w: 1440, h: 900 },
    recordViewport: { width: 1440, height: 900 },
    steps: [
      { id: 'HL Vacation', type: 'click', target: loose },
      { id: 'Add booking', type: 'click', target: anchored },
      { id: 'Type name', type: 'fill', target: { ...loose, point: { x: 10, y: 20 } } },
    ],
  };
  const fallbacks = tourFallbacks(tour);
  assert.deepEqual(fallbacks.get('HL Vacation'), {
    box: { x: 292, y: 659, width: 250, height: 73 },
    point: { x: 295, y: 666 },
  });
  assert.equal(fallbacks.has('Add booking'), false, 'anchored targets are found by their handle');
  assert.equal(fallbacks.has('Type name'), false, 'typing never goes to a guessed position');
  // The planner renames steps, so the captured point has to be enough on its own.
  assert.deepEqual(fallbacks.find({ step: 'Vacation tooltip', x: 296, y: 667 }), fallbacks.get('HL Vacation'));
  assert.equal(fallbacks.find({ step: 'Vacation tooltip', x: 900, y: 200 }), null);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.setContent(`
      <style>body{margin:0}#cell{position:absolute;left:292px;top:659px;width:250px;height:73px;background:#ccc}</style>
      <div id="cell"></div>
      <script>window.hits=[];document.getElementById('cell').addEventListener('click',(e)=>window.hits.push([e.clientX,e.clientY]));</script>
    `);
    // Exactly what the existing Teamdeck flow.mjs calls: no fallback, shortened selector.
    const near = makeNear(fallbacks);
    const handle = await near(page.locator('block-tooltip-header'), { x: 295, y: 666, step: 'HL Vacation', timeout: 400 });
    await handle.click();
    assert.deepEqual(await page.evaluate(() => window.hits), [[295, 666]]);
  } finally {
    await browser.close();
  }
});

test('a tour shown at the wrong size offers no pixels', () => {
  const tour = {
    window: { w: 1200, h: 800 },
    recordViewport: { width: 1440, height: 900 },
    steps: [{ id: 'HL Vacation', type: 'click', target: loose }],
  };
  assert.equal(tourFallbacks(tour).size, 0);
});

test('a missing target with no fallback still stops the record', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.setContent('<div>nothing to see</div>');
    await assert.rejects(
      near(page.locator('block-tooltip-header'), { step: 'HL Vacation', timeout: 400 }),
      /no visible match/
    );
  } finally {
    await browser.close();
  }
});
