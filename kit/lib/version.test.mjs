import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { VERSION } from './version.mjs';

test('VERSION is the kit package version', () => {
  const pkg = createRequire(import.meta.url)('../package.json');
  assert.equal(VERSION, pkg.version);
  assert.match(VERSION, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
});
