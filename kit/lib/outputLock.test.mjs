import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { OutputBusyError, acquireOutputLock, heldOutputLocks, stepResources } from './outputLock.mjs';

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

test('read-only steps need no lock', () => {
  assert.deepEqual(stepResources('list'), []);
  assert.deepEqual(stepResources('studio'), []);
  assert.deepEqual(stepResources('produce'), ['master', 'plates', 'take']);
});
