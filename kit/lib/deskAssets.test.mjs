import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { deskFile } from './deskAssets.mjs';

const root = mkdtempSync(join(tmpdir(), 'desk-assets-'));
const distDir = join(root, 'dist');
const publicDir = join(root, 'public');
const emptyDist = join(root, 'missing');
mkdirSync(join(distDir, 'assets'), { recursive: true });
mkdirSync(publicDir, { recursive: true });
writeFileSync(join(distDir, 'index.html'), 'desk');
writeFileSync(join(distDir, 'assets', 'index-abc.js'), 'js');
writeFileSync(join(publicDir, 'logo.svg'), 'svg');
writeFileSync(join(publicDir, 'icons.svg'), 'icons');
const dirs = { distDir, publicDir };

after(() => rmSync(root, { recursive: true, force: true }));

test('the desk serves its build, with fingerprinted assets marked immutable', () => {
  assert.deepEqual(deskFile('/', dirs), { file: join(distDir, 'index.html'), immutable: false });
  assert.deepEqual(deskFile('/assets/index-abc.js', dirs), {
    file: join(distDir, 'assets', 'index-abc.js'),
    immutable: true,
  });
});

test('shared files come from public when the build does not have them', () => {
  assert.equal(deskFile('/logo.svg', dirs).file, join(publicDir, 'logo.svg'));
  assert.equal(deskFile('/icons.svg', dirs).file, join(publicDir, 'icons.svg'));
  assert.equal(deskFile('/nope.js', dirs).file, null);
});

test('a missing build never answers / with a public file', () => {
  assert.equal(deskFile('/', { distDir: emptyDist, publicDir }).file, null);
  assert.equal(deskFile('/logo.svg', { distDir: emptyDist, publicDir }).file, join(publicDir, 'logo.svg'));
});

test('paths that try to leave the desk folders are refused', () => {
  assert.deepEqual(deskFile('/../secret', dirs), { bad: true });
  assert.deepEqual(deskFile('/%2e%2e/secret', dirs), { bad: true });
  assert.deepEqual(deskFile('/%E0%A4%A', dirs), { bad: true });
});
