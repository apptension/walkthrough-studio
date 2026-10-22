import assert from 'node:assert/strict';
import { after, before, describe, it, test } from 'node:test';
import { chromium } from 'playwright';
import { clickChoreography, createCursor, handCursorSvg } from './cursor.mjs';
import { patchDirection, resolveCursor } from './direction.mjs';

const brand = { colors: { gold: '#ffd400' }, font: { family: 'Inter' } };
const viewport = { width: 1280, height: 720 };

function fakePage() {
  const calls = [];
  return {
    calls,
    on() {},
    mouse: { move: async () => {} },
    evaluate: async (fn, arg) => {
      calls.push({ src: String(fn), arg });
      return true;
    },
  };
}

test('clickChoreography: hand shows before the press and lingers after, scaled by pace', () => {
  const steady = clickChoreography(1);
  assert.ok(steady.armMs >= 120 && steady.armMs <= 220, `arm ${steady.armMs}`);
  assert.ok(steady.holdMs >= 240 && steady.holdMs <= 480, `hold ${steady.holdMs}`);
  const quick = clickChoreography(1.5);
  assert.ok(quick.armMs < steady.armMs && quick.holdMs < steady.holdMs);
  assert.ok(clickChoreography(10).armMs >= 80, 'never so short the morph cannot read');
});

test('handCursorSvg: a hand glyph whose fingertip sits on the hotspot', () => {
  const svg = handCursorSvg(1.3);
  assert.match(svg, /class="wt-h"/);
  assert.match(svg, /viewBox="0 0 28 32"/);
  // The fingertip is drawn at x≈10 in the viewBox; the glyph is pulled left so it lands on (0,0).
  assert.match(svg, /margin:\s*-1(\.\d+)?px 0 0 -13(\.\d+)?px/);
});

test('createCursor: arrow style arms a hand before a press and lets go after it', async () => {
  const page = fakePage();
  const waits = [];
  const cursor = await createCursor({
    context: { addInitScript: async () => {} },
    page,
    brand,
    viewport,
    wait: async (ms) => waits.push(ms),
    settings: { style: 'arrow', hand: true },
    tempo: () => 1,
  });
  assert.equal(cursor.hand, true);
  await cursor.arm();
  const handCalls = () => page.calls.filter((c) => /__wtCursor\?\.hand/.test(c.src));
  assert.equal(handCalls().length, 1);
  assert.equal(handCalls()[0].arg, true);
  assert.deepEqual(waits, [clickChoreography(1).armMs], 'the recorder holds so the morph is on screen before the press');
  cursor.release();
  await new Promise((r) => setTimeout(r, clickChoreography(1).holdMs + 60));
  assert.equal(handCalls().length, 2);
  assert.equal(handCalls()[1].arg, false);
});

test('createCursor: a second arm cancels a pending release so the hand stays up between quick clicks', async () => {
  const page = fakePage();
  const cursor = await createCursor({
    context: { addInitScript: async () => {} },
    page,
    brand,
    viewport,
    wait: async () => {},
    settings: { style: 'arrow' },
    tempo: () => 1,
  });
  await cursor.arm();
  cursor.release();
  await cursor.arm();
  await new Promise((r) => setTimeout(r, clickChoreography(1).holdMs + 60));
  const hand = page.calls.filter((c) => /__wtCursor\?\.hand/.test(c.src)).map((c) => c.arg);
  assert.deepEqual(hand, [true, true], 'no false slipped in between');
});

test('createCursor: classic and dot keep their own press look (no hand) unless asked', async () => {
  for (const [settings, expect] of [
    [{ style: 'classic' }, false],
    [{ style: 'dot' }, false],
    [{ style: 'dot', hand: true }, true],
    [{ style: 'arrow', hand: false }, false],
  ]) {
    const page = fakePage();
    const cursor = await createCursor({
      context: { addInitScript: async () => {} },
      page,
      brand,
      viewport,
      wait: async () => {},
      settings,
      tempo: () => 1,
    });
    assert.equal(cursor.hand, expect, JSON.stringify(settings));
    await cursor.arm();
    assert.equal(page.calls.some((c) => /__wtCursor\?\.hand/.test(c.src)), expect);
  }
});

test('direction: cursor.hand defaults on for the arrow and is a validated boolean', () => {
  assert.equal(resolveCursor({ style: 'arrow' }).hand, true);
  assert.equal(resolveCursor({ style: 'dot' }).hand, false);
  assert.equal(resolveCursor({ style: 'classic' }).hand, false);
  assert.equal(resolveCursor({ style: 'arrow', hand: false }).hand, false);
  const next = patchDirection({}, { cursor: { style: 'arrow', hand: false } });
  assert.equal(next.cursor.hand, false);
  assert.throws(() => patchDirection({}, { cursor: { hand: 'yes' } }), /hand/);
});

describe('presentation cursor in a page', () => {
  let browser;
  let context;
  let page;
  let cursor;
  const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));

  before(async () => {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport });
    page = await context.newPage();
    cursor = await createCursor({ context, page, brand, viewport, wait: waitMs, settings: { style: 'arrow' }, tempo: () => 1 });
    // A real navigation (not setContent, which rewrites the document under the init script).
    await page.goto(
      'data:text/html,' +
        encodeURIComponent('<button id="go" style="position:fixed;left:300px;top:200px;width:160px;height:48px">Go</button>')
    );
  });

  after(async () => {
    await browser?.close();
  });

  it('morphs arrow → hand on arm, pushes down on mousedown, and returns to the arrow after release', async () => {
    await cursor.moveTo(380, 224);
    const cls = () => page.evaluate(() => document.getElementById('wt-cursor').className);
    assert.doesNotMatch(await cls(), /\bhand\b/);
    await cursor.arm();
    assert.match(await cls(), /\bhand\b/);
    const handVisible = await page.evaluate(() => getComputedStyle(document.querySelector('#wt-cursor .wt-h')).opacity);
    assert.equal(Number(handVisible) > 0.5, true, 'hand glyph is shown while armed');
    await page.mouse.down();
    assert.match(await cls(), /\bpush\b/, 'mousedown plays the push-down');
    await page.mouse.up();
    cursor.release();
    await waitMs(clickChoreography(1).holdMs + 400);
    assert.doesNotMatch(await cls(), /\bhand\b/);
  });
});
