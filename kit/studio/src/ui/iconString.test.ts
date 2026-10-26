import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

// @ts-expect-error legacy JS module has no types
import * as legacyIcons from '../../../lib/shared/icons.js';

import { ICON_ALIAS, ICON_BODY } from './icons.gen';
import { icon, resolveIconId, type IconStringOptions } from './iconString';

const legacy = legacyIcons as {
  icon: (name: string, opts?: IconStringOptions) => string;
  resolveIconId: (name: string | null | undefined) => string | null;
  ALIAS: Record<string, string>;
};

describe('iconString', () => {
  test('alias table matches the legacy ALIAS', () => {
    assert.deepEqual(ICON_ALIAS, legacy.ALIAS);
  });

  test('every icon id and alias renders byte-identical to legacy icon()', () => {
    const names = [...Object.keys(ICON_BODY), ...Object.keys(ICON_ALIAS), 'settings', 'nope', ''];
    for (const name of names) {
      assert.equal(resolveIconId(name), legacy.resolveIconId(name), name);
      assert.equal(icon(name), legacy.icon(name), name);
    }
  });

  test('options render identically', () => {
    const cases: [string, IconStringOptions][] = [
      ['play', { size: 16 }],
      ['sec-pipeline', { class: 'sec-ico', size: 14 }],
      ['zen-sleep', { className: 'zen-art', width: 96, height: 64 }],
      ['warn', { label: 'Careful "here" & <now>' }],
      ['queue-render', { size: 12, className: 'a b' }],
    ];
    for (const [name, opts] of cases) assert.equal(icon(name, opts), legacy.icon(name, opts), name);
  });

  test('unknown names render nothing', () => {
    assert.equal(icon('definitely-not-an-icon'), '');
    assert.equal(resolveIconId(null), null);
  });
});
