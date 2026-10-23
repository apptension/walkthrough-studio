/**
 * ./studio flags, and keeping the desk build current.
 *
 * The desk is the React app in kit/studio-next. ./studio installs its packages
 * when package-lock.json changes and rebuilds dist/ when its sources change, so
 * a `git pull` never leaves anyone on a stale desk. Both are stamped with a
 * content hash, so a checkout that touches files without changing them does not
 * reinstall or rebuild.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** What goes into the build. Tests and tooling config are left out. */
const BUILD_INPUTS = ['src', 'public', 'index.html', 'vite.config.ts', 'package.json', 'package-lock.json'];
const DEPS_STAMP = '.walkthrough-lock';
const BUILD_STAMP = '.walkthrough-build';

export function parseStudioArgs(argv) {
  const has = (flag) => argv.includes(flag);
  const valueOf = (flag) => {
    const at = argv.indexOf(flag);
    return at >= 0 ? at + 1 : -1;
  };
  const portAt = valueOf('--port');
  const uiPortAt = valueOf('--ui-port');
  const values = new Set([portAt, uiPortAt].filter((i) => i >= 0));
  return {
    help: has('-h') || has('--help'),
    noOpen: has('--no-open'),
    dev: has('--dev'),
    legacy: has('--legacy'),
    // The new desk was opt-in as --v2 before it became the default.
    v2: has('--v2'),
    port: Number(portAt >= 0 ? argv[portAt] : 4747) || 4747,
    uiPort: Number(uiPortAt >= 0 ? argv[uiPortAt] : 4748) || 4748,
    openSlug: argv.find((a, i) => !String(a).startsWith('-') && !values.has(i)) || null,
  };
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile() && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** Content hash of everything the build reads. */
export function buildFingerprint(appDir) {
  const files = [];
  for (const input of BUILD_INPUTS) {
    const path = join(appDir, input);
    if (!existsSync(path)) continue;
    if (statSync(path).isDirectory()) walk(path, files);
    else files.push(path);
  }
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    const rel = relative(appDir, file).split(sep).join('/');
    if (rel.startsWith('src/test/')) continue;
    hash.update(rel);
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function lockFingerprint(appDir) {
  const lock = join(appDir, 'package-lock.json');
  if (!existsSync(lock)) return null;
  return createHash('sha256').update(readFileSync(lock)).digest('hex');
}

function readStamp(path) {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
}

export function depsFresh(appDir) {
  const modules = join(appDir, 'node_modules');
  if (!existsSync(join(modules, 'vite')) || !existsSync(join(modules, 'react'))) return false;
  const lockHash = lockFingerprint(appDir);
  if (readStamp(join(modules, DEPS_STAMP)) === lockHash) return true;
  // An install from before the stamp existed: npm's hidden lockfile, written after the
  // lockfile last changed, means it is current. Adopt it instead of reinstalling.
  const hidden = join(modules, '.package-lock.json');
  const lock = join(appDir, 'package-lock.json');
  if (!lockHash || readStamp(join(modules, DEPS_STAMP)) !== null || !existsSync(hidden)) return false;
  if (statSync(hidden).mtimeMs < statSync(lock).mtimeMs) return false;
  writeFileSync(join(modules, DEPS_STAMP), `${lockHash}\n`);
  return true;
}

export function buildFresh(appDir) {
  const dist = join(appDir, 'dist');
  if (!existsSync(join(dist, 'index.html'))) return false;
  return readStamp(join(dist, BUILD_STAMP)) === buildFingerprint(appDir);
}

function viteBin(appDir) {
  return (
    ['vite.js', 'vite.mjs']
      .map((name) => join(appDir, 'node_modules', 'vite', 'bin', name))
      .find((path) => existsSync(path)) || null
  );
}

function failure(step, r) {
  const detail = `${r.stderr || ''}${r.stdout || ''}`.trim().split('\n').slice(-12).join('\n');
  return { ok: false, step, detail: detail || r.error?.message || `exit ${r.status}` };
}

/**
 * A fresh checkout gets `npm ci`. An existing node_modules gets an in-place
 * `npm install --no-save`: `npm ci` would delete the folder, and with it the
 * cache of a Vite dev server that may be running from it. Neither writes the lockfile.
 */
export function installDesk(appDir, { run = spawnSync, env = process.env } = {}) {
  const lockHash = lockFingerprint(appDir);
  const clean = Boolean(lockHash) && !existsSync(join(appDir, 'node_modules'));
  const r = run('npm', [...(clean ? ['ci'] : ['install', '--no-save']), '--no-audit', '--no-fund'], {
    cwd: appDir,
    encoding: 'utf8',
    env,
  });
  if (r.status !== 0) return failure('install', r);
  if (lockHash) writeFileSync(join(appDir, 'node_modules', DEPS_STAMP), `${lockHash}\n`);
  return { ok: true };
}

/** `vite build` into dist/. The typecheck is a contributor gate (npm run verify), not a launch step. */
export function buildDesk(appDir, { run = spawnSync, nodePath = process.execPath, env = process.env } = {}) {
  const bin = viteBin(appDir);
  if (!bin) return { ok: false, step: 'build', detail: 'vite is not installed in kit/studio-next' };
  const fingerprint = buildFingerprint(appDir);
  const r = run(nodePath, [bin, 'build', '--logLevel', 'warn'], { cwd: appDir, encoding: 'utf8', env });
  if (r.status !== 0) return failure('build', r);
  writeFileSync(join(appDir, 'dist', BUILD_STAMP), `${fingerprint}\n`);
  return { ok: true };
}
