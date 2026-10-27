import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { contentPathForEditPath, editPathForContentPath } from './plateFieldPaths';

const statsSchema = { lists: [{ key: 'stats' }] };
const featuresSchema = { lists: [{ key: 'items' }] };
const compareSchema = {
  lists: [
    { key: 'left.items' },
    { key: 'right.items' },
  ],
};

describe('plateFieldPaths', () => {
  test('maps stats content paths to generic items edit paths', () => {
    assert.equal(editPathForContentPath('stats.0.value', statsSchema), 'items.0.value');
    assert.equal(contentPathForEditPath('items.0.value', statsSchema), 'stats.0.value');
    assert.equal(contentPathForEditPath('items.1.label', statsSchema), 'stats.1.label');
  });

  test('leaves items and compare list paths unchanged', () => {
    assert.equal(editPathForContentPath('items.2.label', featuresSchema), 'items.2.label');
    assert.equal(contentPathForEditPath('items.2.label', featuresSchema), 'items.2.label');
    assert.equal(editPathForContentPath('left.items.1', compareSchema), 'left.items.1');
    assert.equal(contentPathForEditPath('left.items.1', compareSchema), 'left.items.1');
  });

  test('scalar and dotted field paths pass through', () => {
    assert.equal(editPathForContentPath('url', statsSchema), 'url');
    assert.equal(editPathForContentPath('left.label', compareSchema), 'left.label');
    assert.equal(contentPathForEditPath('caption', statsSchema), 'caption');
  });
});
