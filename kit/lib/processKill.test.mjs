import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { killTree, terminate } from './processKill.mjs';

function fakeClock() {
  const timers = [];
  return {
    schedule(fn, ms) {
      const entry = { fn, ms, fired: false };
      timers.push(entry);
      return entry;
    },
    fireAll() {
      for (const entry of timers) {
        if (!entry.fired) {
          entry.fired = true;
          entry.fn();
        }
      }
    },
  };
}

describe('terminate', () => {
  it('does nothing when the target has already exited', () => {
    const kills = [];
    terminate({
      hasExited: () => true,
      kill: (sig) => kills.push(sig),
      schedule: fakeClock().schedule,
    });
    assert.deepEqual(kills, []);
  });

  it('sends the terminate signal, then escalates to SIGKILL once the grace period passes without an exit', () => {
    const kills = [];
    const clock = fakeClock();
    terminate({
      hasExited: () => false,
      kill: (sig) => kills.push(sig),
      schedule: clock.schedule,
      killMs: 1600,
    });
    assert.deepEqual(kills, ['SIGTERM']);
    clock.fireAll();
    assert.deepEqual(kills, ['SIGTERM', 'SIGKILL']);
  });

  it('does not escalate once the target has actually exited by the time the grace period elapses', () => {
    // This is the exact bug being fixed: checking `child.killed` (true the instant a
    // signal is *sent*, regardless of whether the process dies) instead of real exit
    // state meant SIGKILL almost never fired — a process that ignored or was stuck
    // handling SIGTERM (e.g. Playwright wedged mid browser.close()) just kept running.
    const kills = [];
    let exited = false;
    const clock = fakeClock();
    terminate({
      hasExited: () => exited,
      kill: (sig) => {
        kills.push(sig);
        if (sig === 'SIGTERM') exited = true; // the process honored SIGTERM this time
      },
      schedule: clock.schedule,
      killMs: 1600,
    });
    assert.deepEqual(kills, ['SIGTERM']);
    clock.fireAll();
    assert.deepEqual(kills, ['SIGTERM'], 'no SIGKILL once the process is confirmed gone');
  });

  it('uses a custom signal in place of SIGTERM when asked', () => {
    const kills = [];
    const clock = fakeClock();
    terminate({
      signal: 'SIGINT',
      hasExited: () => false,
      kill: (sig) => kills.push(sig),
      schedule: clock.schedule,
    });
    assert.deepEqual(kills, ['SIGINT']);
  });
});

describe('killTree', () => {
  it('signals the whole process group (negative pid) so spawned children die too', () => {
    const calls = [];
    killTree(123, 'SIGTERM', { kill: (pid, sig) => calls.push([pid, sig]) });
    assert.deepEqual(calls, [[-123, 'SIGTERM']]);
  });

  it('falls back to the plain pid when the target was never its own group leader', () => {
    const calls = [];
    killTree(123, 'SIGKILL', {
      kill: (pid, sig) => {
        calls.push([pid, sig]);
        if (pid < 0) throw new Error('ESRCH');
      },
    });
    assert.deepEqual(calls, [[-123, 'SIGKILL'], [123, 'SIGKILL']]);
  });

  it('swallows the error when even the plain-pid kill fails (process already gone)', () => {
    assert.doesNotThrow(() => {
      killTree(123, 'SIGTERM', {
        kill: () => {
          throw new Error('ESRCH');
        },
      });
    });
  });

  it('does nothing when there is no pid', () => {
    const calls = [];
    killTree(undefined, 'SIGTERM', { kill: (pid, sig) => calls.push([pid, sig]) });
    killTree(0, 'SIGTERM', { kill: (pid, sig) => calls.push([pid, sig]) });
    assert.deepEqual(calls, []);
  });
});
