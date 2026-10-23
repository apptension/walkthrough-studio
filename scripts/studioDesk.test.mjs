import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  buildDesk,
  buildFingerprint,
  buildFresh,
  depsFresh,
  installDesk,
  parseStudioArgs,
} from './studioDesk.mjs';

const roots = [];
after(() => roots.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function app() {
  const dir = mkdtempSync(join(tmpdir(), 'studio-desk-'));
  roots.push(dir);
  mkdirSync(join(dir, 'src', 'test'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<div id="root"></div>');
  writeFileSync(join(dir, 'package.json'), '{}');
  writeFileSync(join(dir, 'package-lock.json'), '{"lockfileVersion":3}');
  writeFileSync(join(dir, 'src', 'main.tsx'), 'render()');
  return dir;
}

function installVite(dir) {
  mkdirSync(join(dir, 'node_modules', 'vite', 'bin'), { recursive: true });
  mkdirSync(join(dir, 'node_modules', 'react'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'vite', 'bin', 'vite.js'), '');
}

test('parseStudioArgs reads flags, ports and the slug', () => {
  assert.deepEqual(parseStudioArgs([]), {
    help: false,
    noOpen: false,
    dev: false,
    legacy: false,
    v2: false,
    port: 4747,
    uiPort: 4748,
    openSlug: null,
  });
  const parsed = parseStudioArgs(['--port', '4750', 'demo', '--ui-port', '4760', '--legacy', '--no-open']);
  assert.equal(parsed.port, 4750);
  assert.equal(parsed.uiPort, 4760);
  assert.equal(parsed.openSlug, 'demo');
  assert.equal(parsed.legacy, true);
  assert.equal(parsed.noOpen, true);
  assert.equal(parseStudioArgs(['--v2', '--dev']).v2, true);
  assert.equal(parseStudioArgs(['--port', 'x']).port, 4747);
});

test('the build fingerprint follows sources, not tests', () => {
  const dir = app();
  const before = buildFingerprint(dir);
  writeFileSync(join(dir, 'src', 'main.test.tsx'), 'it()');
  writeFileSync(join(dir, 'src', 'test', 'setup.ts'), 'setup()');
  assert.equal(buildFingerprint(dir), before);
  writeFileSync(join(dir, 'src', 'main.tsx'), 'render(<App />)');
  assert.notEqual(buildFingerprint(dir), before);
});

test('a fresh checkout installs clean with npm ci', () => {
  const dir = app();
  assert.equal(depsFresh(dir), false);
  const calls = [];
  const result = installDesk(dir, {
    run: (...args) => {
      calls.push(args);
      installVite(dir);
      return { status: 0 };
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls[0].slice(0, 2), ['npm', ['ci', '--no-audit', '--no-fund']]);
  assert.equal(depsFresh(dir), true);
});

test('an existing install updates in place and goes stale with the lockfile', () => {
  const dir = app();
  installVite(dir);
  writeFileSync(join(dir, 'node_modules', '.walkthrough-lock'), 'old\n');
  assert.equal(depsFresh(dir), false);
  const calls = [];
  installDesk(dir, { run: (...args) => (calls.push(args), { status: 0 }) });
  assert.deepEqual(calls[0][1], ['install', '--no-save', '--no-audit', '--no-fund']);
  assert.equal(depsFresh(dir), true);
  writeFileSync(join(dir, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}');
  assert.equal(depsFresh(dir), false);
});

test('an unstamped install newer than the lockfile is adopted without reinstalling', () => {
  const dir = app();
  installVite(dir);
  const hidden = join(dir, 'node_modules', '.package-lock.json');
  writeFileSync(hidden, '{}');
  const lock = join(dir, 'package-lock.json');
  utimesSync(lock, new Date(1000), new Date(1000));
  assert.equal(depsFresh(dir), true);
  assert.equal(depsFresh(dir), true);
});

test('an unstamped install older than the lockfile is reinstalled', () => {
  const dir = app();
  installVite(dir);
  const hidden = join(dir, 'node_modules', '.package-lock.json');
  writeFileSync(hidden, '{}');
  utimesSync(hidden, new Date(1000), new Date(1000));
  assert.equal(depsFresh(dir), false);
});

test('a failed install reports its output and leaves deps stale', () => {
  const dir = app();
  installVite(dir);
  const result = installDesk(dir, { run: () => ({ status: 1, stderr: 'ERESOLVE could not resolve' }) });
  assert.equal(result.ok, false);
  assert.equal(result.step, 'install');
  assert.match(result.detail, /ERESOLVE/);
  assert.equal(depsFresh(dir), false);
});

test('the build is stamped and goes stale when a source changes', () => {
  const dir = app();
  installVite(dir);
  assert.equal(buildFresh(dir), false);
  const result = buildDesk(dir, {
    nodePath: 'node',
    run: (cmd, args, opts) => {
      assert.equal(cmd, 'node');
      assert.match(args[0], /vite\.js$/);
      assert.equal(args[1], 'build');
      mkdirSync(join(opts.cwd, 'dist'), { recursive: true });
      writeFileSync(join(opts.cwd, 'dist', 'index.html'), 'built');
      return { status: 0 };
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(buildFresh(dir), true);
  writeFileSync(join(dir, 'src', 'main.tsx'), 'render(<Changed />)');
  assert.equal(buildFresh(dir), false);
});

test('building without vite says so instead of spawning', () => {
  const dir = app();
  const result = buildDesk(dir, { run: () => assert.fail('should not spawn') });
  assert.equal(result.ok, false);
  assert.match(result.detail, /vite is not installed/);
});
