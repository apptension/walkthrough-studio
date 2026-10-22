import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  captureSummary,
  placeQueueMenuRect,
  queueIconId,
  queueIconSvg,
  queueMenuGroups,
  shouldEnqueue,
} from './queueUx.js';

test('the capture line is one host, and sign-in is a suffix', () => {
  assert.equal(captureSummary('http://localhost:4747', false), 'localhost:4747');
  assert.equal(captureSummary('https://app.example.com/team/', true), 'app.example.com/team · signs in');
  assert.equal(captureSummary('', false), 'No start URL yet');
});

test('the same step is not queued twice, and an improve note can repeat', () => {
  const waiting = [{ slug: 'demo', kind: 'step', step: 'plates', mode: '', goal: '' }];
  assert.equal(shouldEnqueue(waiting, { slug: 'demo', kind: 'step', step: 'plates' }), false);
  assert.equal(shouldEnqueue(waiting, { slug: 'demo', kind: 'step', step: 'audio' }), true);
  assert.equal(shouldEnqueue(waiting, { slug: 'other', kind: 'step', step: 'plates' }), true);
  assert.equal(shouldEnqueue(waiting, { slug: 'demo', kind: 'improve', goal: 'full' }), true);
});

test('a resume-from-step make is distinct from a full make in the queue', () => {
  const waiting = [{ slug: 'demo', kind: 'make', mode: 'quick', fromStep: 'audio' }];
  assert.equal(shouldEnqueue(waiting, { slug: 'demo', kind: 'make', mode: 'quick', fromStep: 'audio' }), false);
  assert.equal(shouldEnqueue(waiting, { slug: 'demo', kind: 'make', mode: 'quick' }), true);
  assert.equal(shouldEnqueue(waiting, { slug: 'demo', kind: 'make', mode: 'quick', fromStep: 'produce' }), true);
});

test('Add step menu anchors under the button and opens upward near the floor', () => {
  const roomy = { top: 80, bottom: 108, left: 800, right: 900 };
  const down = placeQueueMenuRect(roomy, { vw: 1200, vh: 900, menuHeight: 200 });
  assert.equal(down.openUp, false);
  assert.equal(down.left, roomy.right - down.width);
  assert.ok(down.top >= roomy.bottom);

  const btn = { top: 600, bottom: 628, left: 160, right: 240 };
  const up = placeQueueMenuRect(btn, { vw: 1200, vh: 900, menuHeight: 360 });
  assert.equal(up.openUp, true);
  assert.ok(up.top + Math.min(360, up.maxHeight) <= btn.top + 1);
  assert.equal(up.left, btn.left);
});

test('Add step menu catalogs full passes and single steps with icons', () => {
  const groups = queueMenuGroups();
  assert.equal(groups.length, 2);
  assert.equal(groups[0].group, 'Full pass');
  assert.ok(groups[0].items.some((i) => i.id === 'make-quick'));
  assert.ok(groups[0].items.some((i) => i.id === 'make-full'));
  const singles = groups[1].items.map((i) => i.id);
  assert.deepEqual(singles, ['record', 'plates', 'produce', 'audio', 'deliver']);
  assert.match(queueIconSvg('plates'), /svg/);
  assert.equal(queueIconId({ kind: 'make', mode: 'full' }), 'record');
  assert.equal(queueIconId({ kind: 'step', step: 'audio' }), 'audio');
});

test('the rail keeps capture closed and the queue behind one Add step', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  assert.match(html, /id="captureBar"/);
  assert.match(html, /<details id="recordTarget"/);
  assert.match(html, /id="btnCaptureSettings"/);
  assert.match(html, /class="capture-chevron"/);
  assert.equal(html.includes('>Save target<'), false);
  assert.match(html, /id="btnQueueAdd"/);
  assert.match(html, /id="queueMenu"/);
  assert.match(html, /id="queueAddWrap"/);
  assert.match(html, /class="queue-add-wrap"/);
  assert.match(html, /queue-add-caret/);
  assert.match(html, /class="queue-empty"/);
  assert.match(css, /\.queue-menu-item/);
  assert.match(css, /\.queue-add-btn/);
  assert.equal(html.includes('id="cleanupDisclosure"'), false);
  assert.match(html, /id="versionsManage"/);
  assert.match(html, /id="btnDeleteVersions"/);
  assert.match(html, /id="btnCleanIntermediates"/);
  const captureAt = html.indexOf('id="captureBar"');
  const renderAt = html.indexOf('id="btnActionPrimary"');
  assert.ok(captureAt > 0 && captureAt < renderAt, 'capture bar sits above the Render button');
});
