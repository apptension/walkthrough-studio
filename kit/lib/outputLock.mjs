/**
 * Mutual exclusion for the files a video owns.
 *
 * Steps write straight into `video.out`, so two runs of the same step — a second
 * browser tab, a double-clicked button, a hand-run CLI next to Studio — used to
 * interleave their ffmpeg output and leave a corrupt master behind that every
 * later step happily copied. Locks are files so they also hold across processes.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

/** Which of a video's outputs each step writes: take, plates, master, guide. */
const RESOURCES = {
  record: ['take'],
  guide: ['guide'],
  // Keeps the reviewer's guided recording as the take.
  'adopt-take': ['guide', 'take'],
  plates: ['plates'],
  // Produce reads the take, refreshes plates and writes the master.
  produce: ['take', 'plates', 'master'],
  all: ['take', 'plates', 'master'],
  voice: ['master'],
  music: ['master'],
  audio: ['master'],
  mix: ['master'],
  captions: ['master'],
  validate: ['master'],
  qc: ['master'],
  deliver: ['master'],
  export: ['master'],
};

export class OutputBusyError extends Error {
  constructor(message, holder) {
    super(message);
    this.name = 'OutputBusyError';
    this.holder = holder;
  }
}

/** Resources a step must own before it may run, sorted so acquisition never deadlocks. */
export function stepResources(step) {
  return [...(RESOURCES[step] || [])].sort();
}

const lockDir = (video) => join(video.out, '.locks');
const lockPath = (video, resource) => join(lockDir(video), `${resource}.lock`);

function readLock(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

/** Locks currently held on a video's outputs, stale ones included. */
export function heldOutputLocks(video) {
  let names = [];
  try {
    names = readdirSync(lockDir(video)).filter((n) => n.endsWith('.lock'));
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const held = readLock(join(lockDir(video), name));
      return held ? { ...held, resource: name.replace(/\.lock$/, '') } : null;
    })
    .filter(Boolean);
}

function take(video, resource, token, pidAlive) {
  const file = lockPath(video, resource);
  try {
    writeFileSync(file, JSON.stringify(token), { flag: 'wx' });
    return;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  const held = readLock(file);
  if (held && held.pid && pidAlive(held.pid)) {
    const mins = Math.round((Date.now() - Date.parse(held.startedAt || 0)) / 60000);
    throw new OutputBusyError(
      `${held.step || 'another step'} is already running for ${video.slug || 'this video'} (pid ${held.pid}` +
        `${Number.isFinite(mins) ? `, ${mins}m` : ''}). Wait for it to finish or stop it first.`,
      held
    );
  }
  // The holder died without releasing — reclaim it.
  rmSync(file, { force: true });
  writeFileSync(file, JSON.stringify(token), { flag: 'wx' });
}

/**
 * Claim everything `step` writes for this video.
 * @returns {{release: () => void, resources: string[]}}
 */
export function acquireOutputLock(video, step, { pidAlive = alive } = {}) {
  const resources = stepResources(step);
  if (!resources.length) return { release: () => {}, resources: [] };
  mkdirSync(lockDir(video), { recursive: true });
  const token = { step, pid: process.pid, host: hostname(), startedAt: new Date().toISOString() };
  const mine = [];
  try {
    for (const resource of resources) {
      take(video, resource, token, pidAlive);
      mine.push(resource);
    }
  } catch (err) {
    for (const resource of mine) release(video, resource, token);
    throw err;
  }
  let released = false;
  return {
    resources: mine,
    release() {
      if (released) return;
      released = true;
      for (const resource of mine) release(video, resource, token);
    },
  };
}

function release(video, resource, token) {
  const file = lockPath(video, resource);
  const held = readLock(file);
  // Never drop a lock a later run took over.
  if (held && held.pid !== token.pid) return;
  rmSync(file, { force: true });
}

/**
 * Drop every lock this video holds for `pid`, without waiting for a future run to
 * notice the holder is dead. Cancelling a job kills its process, but a killed process
 * never runs the `finally { lock.release() }` that would normally clear this — the
 * stale-pid reclaim in `take()` covers the *next* run, this covers "stop" itself so
 * `heldOutputLocks()` reflects the cancellation immediately.
 */
export function releaseLocksForPid(video, pid) {
  for (const held of heldOutputLocks(video)) {
    if (held.pid === pid) rmSync(lockPath(video, held.resource), { force: true });
  }
}
