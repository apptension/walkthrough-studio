import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { contentPathForEditPath, editPathForContentPath } from './plateFieldPaths';

const statsSchema = { lists: [{ key: 'stats' }] };
const kpiSchema = { lists: [{ key: 'stats' }] };
const journeySchema = { lists: [{ key: 'steps' }] };
const quotesSchema = { lists: [{ key: 'quotes' }] };
const featuresSchema = { lists: [{ key: 'items' }] };
const compareSchema = {
  lists: [{ key: 'left.items' }, { key: 'right.items' }],
};

describe('plateFieldPaths', () => {
  test('stats plate maps stats ↔ generic items in HTML', () => {
    assert.equal(editPathForContentPath('stats.0.value', statsSchema, 'stats'), 'items.0.value');
    assert.equal(contentPathForEditPath('items.0.value', statsSchema, 'stats'), 'stats.0.value');
  });

  test('KPI keeps stats paths — HTML uses stats.N not items.N', () => {
    assert.equal(editPathForContentPath('stats.0.delta', kpiSchema, 'kpi'), 'stats.0.delta');
    assert.equal(contentPathForEditPath('stats.0.value', kpiSchema, 'kpi'), 'stats.0.value');
    assert.equal(contentPathForEditPath('items.0.value', kpiSchema, 'kpi'), 'items.0.value');
  });

  test('testimonials keep quotes paths in HTML', () => {
    assert.equal(editPathForContentPath('quotes.0.quote', quotesSchema, 'testimonials'), 'quotes.0.quote');
    assert.equal(contentPathForEditPath('quotes.1.author', quotesSchema, 'testimonials'), 'quotes.1.author');
  });

  test('journey maps steps ↔ items in HTML', () => {
    assert.equal(editPathForContentPath('steps.2.label', journeySchema, 'journey'), 'items.2.label');
    assert.equal(contentPathForEditPath('items.1.note', journeySchema, 'journey'), 'steps.1.note');
  });

  test('features and compare list paths pass through', () => {
    assert.equal(editPathForContentPath('items.2.label', featuresSchema, 'features'), 'items.2.label');
    assert.equal(editPathForContentPath('left.items.1', compareSchema, 'compare'), 'left.items.1');
    assert.equal(editPathForContentPath('url', statsSchema, 'stats'), 'url');
  });
});
