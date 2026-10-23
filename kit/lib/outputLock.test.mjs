import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { OutputBusyError, acquireOutputLock, heldOutputLocks, releaseLocksForPid, stepResources } from './outputLock.mjs';

function scratch() {
  const out = mkdtempSync(join(tmpdir(), 'lock-'));
  return { out, cleanup: () => rmSync(out, { recursive: true, force: true }) };
}

test('two produce runs on the same video cannot overlap', () => {
  const { out, cleanup } = scratch();
  try {
    const first = acquireOutputLock({ out, slug: 'demo' }, 'produce');
    assert.throws(() => acquireOutputLock({ out, slug: 'demo' }, 'produce'), OutputBusyError);
    first.release();
    acquireOutputLock({ out, slug: 'demo' }, 'produce').release();
  } finally {
    cleanup();
  }
});

test('mix waits for produce because both own the master', () => {
  const { out, cleanup } = scratch();
  try {
    const produce = acquireOutputLock({ out, slug: 'demo' }, 'produce');
    assert.throws(() => acquireOutputLock({ out, slug: 'demo' }, 'mix'), (err) => {
      assert.ok(err instanceof OutputBusyError);
      assert.match(err.message, /produce is already running for demo/);
      return true;
    });
    produce.release();
  } finally {
    cleanup();
  }
});

test('record and plates still run side by side', () => {
  const { out, cleanup } = scratch();
  try {
    const record = acquireOutputLock({ out, slug: 'demo' }, 'record');
    const plates = acquireOutputLock({ out, slug: 'demo' }, 'plates');
    assert.deepEqual(heldOutputLocks({ out }).map((l) => l.resource).sort(), ['plates', 'take']);
    plates.release();
    record.release();
    assert.deepEqual(heldOutputLocks({ out }), []);
  } finally {
    cleanup();
  }
});

test('a lock left behind by a dead process is taken over', () => {
  const { out, cleanup } = scratch();
  try {
    mkdirSync(join(out, '.locks'), { recursive: true });
    writeFileSync(
      join(out, '.locks', 'master.lock'),
      JSON.stringify({ step: 'produce', pid: 999999, startedAt: new Date().toISOString() })
    );
    const lock = acquireOutputLock({ out, slug: 'demo' }, 'produce', { pidAlive: () => false });
    lock.release();
  } finally {
    cleanup();
  }
});

test('a partly acquired lock set is rolled back', () => {
  const { out, cleanup } = scratch();
  try {
    const plates = acquireOutputLock({ out, slug: 'demo' }, 'plates');
    assert.throws(() => acquireOutputLock({ out, slug: 'demo' }, 'produce'), OutputBusyError);
    assert.deepEqual(heldOutputLocks({ out }).map((l) => l.resource), ['plates']);
    plates.release();
  } finally {
    cleanup();
  }
});

test('cancelling a job drops its locks immediately, without waiting for a future run to reclaim them', () => {
  const { out, cleanup } = scratch();
  try {
    acquireOutputLock({ out, slug: 'demo' }, 'record');
    acquireOutputLock({ out, slug: 'demo' }, 'plates');
    const otherPid = process.pid + 1;
    mkdirSync(join(out, '.locks'), { recursive: true });
    writeFileSync(
      join(out, '.locks', 'guide.lock'),
      JSON.stringify({ step: 'guide', pid: otherPid, startedAt: new Date().toISOString() })
    );

    releaseLocksForPid({ out, slug: 'demo' }, process.pid);

    // Everything this process held is gone — a stopped job's slot is free at once,
    // not only once a later run notices the pid is dead.
    assert.deepEqual(heldOutputLocks({ out }).map((l) => l.resource), ['guide']);
    acquireOutputLock({ out, slug: 'demo' }, 'record').release();
    // A lock held by some other, still-live pid must not be touched.
    assert.deepEqual(heldOutputLocks({ out }).map((l) => l.resource), ['guide']);
  } finally {
    cleanup();
  }
});

test('read-only steps need no lock', () => {
  assert.deepEqual(stepResources('list'), []);
  assert.deepEqual(stepResources('studio'), []);
  assert.deepEqual(stepResources('produce'), ['master', 'plates', 'take']);
});
