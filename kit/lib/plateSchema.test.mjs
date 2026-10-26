import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPlateContent, coerceValue, fieldFor, plateContent, plateSchema, CONTENT_TYPES } from './plateSchema.mjs';
import { checkPlate } from './plates.mjs';
import { PLATE_TYPE_IDS } from './plateTypes.mjs';
import { scaffoldPlate } from './script.mjs';

const brand = {
  colors: { ink: '#0a1f0a', surface: '#0f2a0f', gold: '#0ca300', amber: '#7ac943', teal: '#2dd4bf', text: '#f8fafc' },
  font: { family: 'Inter', css: '' },
  logoHtml: '<svg viewBox="0 0 10 10"></svg>',
  motion: { energy: 'clear' },
};

test('plateSchema: every catalog type has a content schema; open/close have none', () => {
  for (const type of PLATE_TYPE_IDS) {
    const s = plateSchema(type);
    assert.ok(s, `${type} schema`);
    assert.ok(Array.isArray(s.fields) && Array.isArray(s.lists));
    for (const list of s.lists) {
      assert.ok(list.min <= list.max, `${type}.${list.key} limits`);
      assert.ok(list.fields.length, `${type}.${list.key} row fields`);
      assert.ok(list.starter !== undefined, `${type}.${list.key} starter`);
    }
  }
  assert.equal(plateSchema('open'), null);
  assert.ok(CONTENT_TYPES.includes('logos'));
});

test('plateSchema: list limits follow the builder — adding past max or removing below min is refused', () => {
  const row = { id: 'p', ...scaffoldPlate('stats', { before: 'Intro' }) };
  applyPlateContent(row, [{ op: 'add', list: 'stats' }]);
  assert.equal(row.stats.length, 4);
  assert.throws(() => applyPlateContent(row, [{ op: 'add', list: 'stats' }]), /at most 4/);
  applyPlateContent(row, [{ op: 'remove', list: 'stats', index: 3 }, { op: 'remove', list: 'stats', index: 2 }]);
  assert.equal(row.stats.length, 2);
  assert.throws(() => applyPlateContent(row, [{ op: 'remove', list: 'stats', index: 0 }]), /at least 2/);
  checkPlate(brand, row);
});

test('plateSchema: move, duplicate and set keep rows intact and the builder happy', () => {
  const row = { id: 'p', ...scaffoldPlate('features', { before: 'Intro' }) };
  const first = row.items[0].label;
  applyPlateContent(row, [
    { op: 'move', list: 'items', from: 0, to: 2 },
    { op: 'set', path: 'items.2.icon', value: 'bolt' },
    { op: 'duplicate', list: 'items', index: 2 },
    { op: 'set', path: 'items.3.label', value: '  Trimmed  ' },
  ]);
  assert.equal(row.items[2].label, first);
  assert.equal(row.items[2].icon, 'bolt');
  assert.equal(row.items[3].label, 'Trimmed');
  assert.equal(row.items.length, 4);
  checkPlate(brand, row);
});

test('plateSchema: a starter row for every list builds — the Inspector "+" never breaks a plate', () => {
  for (const type of PLATE_TYPE_IDS) {
    const row = { id: 'p', ...scaffoldPlate(type, { before: 'Intro' }) };
    const s = plateSchema(type, row);
    for (const list of s.lists) {
      const arr = list.key.split('.').reduce((o, k) => o?.[k], row) || [];
      if (arr.length < list.max) {
        applyPlateContent(row, [{ op: 'add', list: list.key }]);
        checkPlate(brand, row);
      }
    }
  }
});

test('plateSchema: typed values — numbers clamp, toggles parse, lines split, choices validate', () => {
  assert.equal(coerceValue({ kind: 'number', min: 0, max: 1 }, '1.7'), 1);
  assert.equal(coerceValue({ kind: 'number', min: 0, max: 5 }, 'x'), undefined);
  assert.equal(coerceValue({ kind: 'toggle' }, 'true'), true);
  assert.deepEqual(coerceValue({ kind: 'lines', max: 2 }, 'a\n\nb\nc'), ['a', 'b']);
  assert.equal(coerceValue({ kind: 'choice', options: ['auto', 'light', 'dark'] }, 'dark'), 'dark');
  assert.equal(coerceValue({ kind: 'choice', options: ['auto', 'light', 'dark'] }, 'auto'), undefined, 'auto clears the key');
});

test('plateSchema: field lookup resolves list rows and plain-string lists', () => {
  const s = plateSchema('callout');
  assert.equal(fieldFor(s, 'body').kind, 'long');
  assert.equal(fieldFor(s, 'bullets.1').kind, 'text');
  assert.equal(fieldFor(s, 'bullets.1.label'), null);
  const q = plateSchema('quote');
  assert.equal(fieldFor(q, 'stars').kind, 'number');
  assert.throws(() => applyPlateContent({ type: 'quote', quote: 'A fine quote of twelve chars', author: 'A' }, [{ op: 'set', path: 'nope', value: 1 }]), /Unknown content field/);
});

test('plateContent: values come back in schema shape, string lists flattened', () => {
  const c = plateContent({ type: 'compare', left: { items: ['a', 'b'] }, right: { label: 'After', items: ['c', { label: 'd' }] } });
  assert.deepEqual(c.lists['left.items'], ['a', 'b']);
  assert.deepEqual(c.lists['right.items'], ['c', 'd']);
  assert.equal(c.fields['right.label'], 'After');
  assert.equal(c.fields['left.label'], '');
});

test('plateSchema: a quote plate rejects a quote shorter than the builder minimum before it is saved', () => {
  const row = { id: 'q', ...scaffoldPlate('quote', { before: 'Intro' }) };
  assert.throws(() => applyPlateContent(row, [{ op: 'set', path: 'quote', value: 'short' }]), /at least 12/);
});
