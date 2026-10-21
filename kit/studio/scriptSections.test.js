import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCENARIO_EDITABLE_NOTE, defaultSectionCollapsed, sceneVisible } from './scriptSections.js';

test('a new scenario opens with Opening, Story, and Closing collapsed', () => {
  const collapsed = defaultSectionCollapsed();
  assert.equal(collapsed.opening, true);
  assert.equal(collapsed.story, true);
  assert.equal(collapsed.closing, true);
  assert.equal(sceneVisible('open', collapsed), false);
  assert.equal(sceneVisible('chapter', collapsed), false);
  assert.equal(sceneVisible('close', collapsed), false);
});

test('expanding a section shows the same beats', () => {
  const collapsed = { ...defaultSectionCollapsed(), story: false };
  assert.equal(sceneVisible('chapter', collapsed), true);
  assert.equal(sceneVisible('step', collapsed), true);
  assert.equal(sceneVisible('plate', collapsed), true);
  assert.equal(sceneVisible('open', collapsed), false);
});

test('the header keeps the editable-draft line', () => {
  assert.match(SCENARIO_EDITABLE_NOTE, /stays editable/i);
});
