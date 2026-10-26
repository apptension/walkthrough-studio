import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test } from 'vitest';

import { programEmptyBusyView, programEmptyView } from './programEmpty';

test('first render empty state points at a full Render CTA', () => {
  const view = programEmptyView({
    status: 'Not rendered',
    title: 'Render your first sequence',
    reason: 'Records the app, cuts it with the plates, adds voice and music, and exports, in one pass.',
    primary: { label: 'Render', mode: 'full' },
    secondary: null,
  });
  assert.equal(view.kicker, 'Ready to render');
  assert.equal(view.primary!.mode, 'full');
  assert.match(view.reason, /voice/i);
});

test('re-record empty state keeps the secondary escape hatch', () => {
  const view = programEmptyView({
    status: 'Needs re-record',
    title: 'Re-record the app',
    reason: 'The flow changed since the last recording.',
    primary: { label: 'Re-record & Render', mode: 'full' },
    secondary: { label: 'Render without re-record', mode: 'quick' },
  });
  assert.equal(view.kicker, 'Needs capture');
  assert.equal(view.secondary!.mode, 'quick');
});

test('out-of-date empty state uses the stale tone and icon', () => {
  const view = programEmptyView({
    status: 'Out of date',
    title: 'Render to see your changes',
    reason: 'Sources changed since the last render, so Program is behind.',
    primary: { label: 'Render', mode: 'quick' },
    secondary: { label: 'Re-record first', mode: 'full' },
  });
  assert.equal(view.kicker, 'Out of date');
  assert.equal(view.tone, 'stale');
  assert.equal(view.icon, 'empty-stale');
});

test('busy render flips the empty state off Out of date and hides CTAs', () => {
  const view = programEmptyView({
    busy: true,
    status: 'Rendering',
    title: 'Rendering sequence',
    reason: 'Live log and pipeline update here. Program refreshes when the last step finishes.',
  });
  assert.equal(view.kicker, 'Rendering');
  assert.equal(view.tone, 'run');
  assert.equal(view.primary, null);
  assert.equal(view.secondary, null);
  assert.match(view.title, /Rendering/i);
  assert.equal(programEmptyBusyView().kicker, 'Rendering');
});

test('Not rendered still means ready to render, not a busy pass', () => {
  const view = programEmptyView({
    status: 'Not rendered',
    title: 'Render your first sequence',
    reason: 'Records the app.',
    primary: { label: 'Render', mode: 'full' },
  });
  assert.equal(view.kicker, 'Ready to render');
  assert.equal(view.tone, 'ready');
  assert.equal(view.primary!.mode, 'full');
});

test('Program empty markup ships a primary render button in the monitor', () => {
  const html = readFileSync(join(import.meta.dirname, '../features/monitor/NoVideo.tsx'), 'utf8');
  assert.match(html, /id="noVideo"/);
  assert.match(html, /id="btnNoVideoPrimary"/);
  assert.match(html, /id="btnNoVideoSecondary"/);
  assert.match(html, /id="noVideoTitle"/);
  assert.match(html, /empty-stale/);
  const css = readFileSync(join(import.meta.dirname, '../styles/studio.css'), 'utf8');
  assert.match(css, /\.program-empty/);
  assert.match(css, /\.program-empty-actions/);
  assert.match(css, /overflow:\s*hidden/);
  assert.doesNotMatch(css, /\.program-empty-card[\s\S]{0,200}overflow:\s*auto/);
});
