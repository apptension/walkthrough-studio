import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FinalizeTimeoutError, finalizeStep, withDeadline } from './finalizeDeadline.mjs';

function fakeClock() {
  let now = 0;
  const timers = [];
  return {
    now: () => now,
    schedule(fn, ms) {
      const at = now + ms;
      const entry = { fn, at, fired: false };
      timers.push(entry);
      return entry;
    },
    clear(entry) {
      entry.fired = true;
    },
    advance(ms) {
      now += ms;
      for (const entry of timers) {
        if (!entry.fired && entry.at <= now) {
          entry.fired = true;
          entry.fn();
        }
      }
    },
  };
}

describe('withDeadline', () => {
  it('resolves with the value when the promise settles before the deadline', async () => {
    const clock = fakeClock();
    const p = withDeadline(Promise.resolve('ok'), 1000, clock);
    const result = await p;
    assert.deepEqual(result, { timedOut: false, value: 'ok', elapsedMs: 0 });
  });

  it('carries a rejection as a result instead of throwing, so the race always settles', async () => {
    const clock = fakeClock();
    const boom = new Error('boom');
    const result = await withDeadline(Promise.reject(boom), 1000, clock);
    assert.equal(result.timedOut, false);
    assert.equal(result.error, boom);
  });

  it('times out when the promise never settles, without waiting for it', async () => {
    const clock = fakeClock();
    const never = new Promise(() => {});
    const pending = withDeadline(never, 1000, clock);
    clock.advance(1000);
    const result = await pending;
    assert.equal(result.timedOut, true);
    assert.equal(result.elapsedMs, 1000);
  });
});

describe('finalizeStep', () => {
  it('logs the step, returns the value, and does not warn on a normal finish', async () => {
    const clock = fakeClock();
    const logs = [];
    const value = await finalizeStep('save session', Promise.resolve(42), {
      ms: 1000,
      log: (m) => logs.push(m),
      clock,
    });
    assert.equal(value, 42);
    assert.ok(logs.some((l) => /save session/.test(l)));
    assert.ok(!logs.some((l) => /⚠/.test(l)));
  });

  it('rethrows a real failure instead of swallowing it', async () => {
    const clock = fakeClock();
    const boom = new Error('disk full');
    await assert.rejects(
      finalizeStep('save session', Promise.reject(boom), { ms: 1000, log: () => {}, clock }),
      /disk full/
    );
  });

  it('a non-critical step that times out logs a warning and continues with undefined', async () => {
    const clock = fakeClock();
    const logs = [];
    const never = new Promise(() => {});
    const pending = finalizeStep('hide cursor overlay', never, {
      ms: 500,
      log: (m) => logs.push(m),
      clock,
    });
    clock.advance(500);
    const value = await pending;
    assert.equal(value, undefined);
    assert.ok(logs.some((l) => /⚠.*hide cursor overlay.*500ms/.test(l)));
  });

  it('a critical step that times out throws FinalizeTimeoutError instead of hanging', async () => {
    const clock = fakeClock();
    const never = new Promise(() => {});
    const pending = finalizeStep('encode the take', never, {
      ms: 2000,
      critical: true,
      log: () => {},
      clock,
    });
    clock.advance(2000);
    await assert.rejects(pending, (err) => {
      assert.ok(err instanceof FinalizeTimeoutError);
      assert.equal(err.label, 'encode the take');
      assert.equal(err.ms, 2000);
      return true;
    });
  });
});
