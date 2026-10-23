import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { deskFile, resolveDesk } from './deskAssets.mjs';

const root = mkdtempSync(join(tmpdir(), 'desk-assets-'));
const nextDist = join(root, 'dist');
const legacyDir = join(root, 'studio');
const emptyDist = join(root, 'missing');
mkdirSync(join(nextDist, 'assets'), { recursive: true });
mkdirSync(legacyDir, { recursive: true });
writeFileSync(join(nextDist, 'index.html'), 'next');
writeFileSync(join(nextDist, 'assets', 'index-abc.js'), 'js');
writeFileSync(join(legacyDir, 'index.html'), 'legacy');
writeFileSync(join(legacyDir, 'logo.svg'), 'svg');
writeFileSync(join(legacyDir, 'app.js'), 'app');
const dirs = { nextDist, legacyDir };

after(() => rmSync(root, { recursive: true, force: true }));

test('resolveDesk prefers the built desk and honours --legacy', () => {
  assert.equal(resolveDesk(undefined, { nextDist }), 'next');
  assert.equal(resolveDesk('next', { nextDist }), 'next');
  assert.equal(resolveDesk('legacy', { nextDist }), 'legacy');
  assert.equal(resolveDesk('LEGACY', { nextDist }), 'legacy');
});

test('resolveDesk falls back to the classic desk when nothing is built', () => {
  assert.equal(resolveDesk(undefined, { nextDist: emptyDist }), 'legacy');
  assert.equal(resolveDesk('next', { nextDist: emptyDist }), 'legacy');
});

test('the new desk serves its build, with fingerprinted assets marked immutable', () => {
  assert.deepEqual(deskFile('/', 'next', dirs), { file: join(nextDist, 'index.html'), immutable: false });
  assert.deepEqual(deskFile('/assets/index-abc.js', 'next', dirs), {
    file: join(nextDist, 'assets', 'index-abc.js'),
    immutable: true,
  });
});

test('the new desk falls through to the classic folder for shared files', () => {
  assert.equal(deskFile('/logo.svg', 'next', dirs).file, join(legacyDir, 'logo.svg'));
  assert.equal(deskFile('/nope.js', 'next', dirs).file, null);
});

test('the new desk never answers / with the classic page', () => {
  const noBuild = { nextDist: emptyDist, legacyDir };
  assert.equal(deskFile('/', 'next', noBuild).file, null);
});

test('the classic desk serves kit/studio only', () => {
  assert.equal(deskFile('/', 'legacy', dirs).file, join(legacyDir, 'index.html'));
  assert.equal(deskFile('/app.js', 'legacy', dirs).file, join(legacyDir, 'app.js'));
  assert.equal(deskFile('/assets/index-abc.js', 'legacy', dirs).file, null);
});

test('paths that try to leave the desk folders are refused', () => {
  assert.deepEqual(deskFile('/../secret', 'next', dirs), { bad: true });
  assert.deepEqual(deskFile('/%2e%2e/secret', 'legacy', dirs), { bad: true });
  assert.deepEqual(deskFile('/%E0%A4%A', 'next', dirs), { bad: true });
});
