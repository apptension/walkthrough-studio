import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CaptureStallError } from './captureStall.mjs';
import { runOptional } from './optionalStep.mjs';

function fakePage() {
  const timeouts = [];
  return { timeouts, setDefaultTimeout: (ms) => timeouts.push(ms) };
}

describe('runOptional', () => {
  it('runs the step with a short action timeout, then restores the default', async () => {
    const page = fakePage();
    const ok = await runOptional({ page, label: 'cookie banner', fn: async () => {}, timeoutMs: 5000, log: () => {} });
    assert.equal(ok, true);
    assert.deepEqual(page.timeouts, [5000, 30000]);
  });

  it('returns the step value when it has one', async () => {
    assert.equal(await runOptional({ page: fakePage(), fn: async () => 'opened', log: () => {} }), 'opened');
  });

  it('logs a warning, marks the timeline and continues when the step fails', async () => {
    const page = fakePage();
    const logs = [];
    const marks = [];
    const err = Object.assign(new Error('Timeout 5000ms exceeded.\n  waiting for getByRole(…)'), { name: 'TimeoutError' });
    const ok = await runOptional({
      page,
      label: 'Dismiss tip',
      fn: async () => {
        throw err;
      },
      log: (l) => logs.push(l),
      mark: (...a) => marks.push(a),
    });
    assert.equal(ok, false);
    assert.deepEqual(logs, ['⚠ optional · Dismiss tip skipped: Timeout 5000ms exceeded.']);
    assert.equal(marks[0][0], 'optional-skip');
    assert.equal(page.timeouts.at(-1), 30000);
  });

  it('gives up on a step that never settles', async () => {
    const ok = await runOptional({ page: fakePage(), label: 'hang', fn: () => new Promise(() => {}), timeoutMs: 10, log: () => {} });
    assert.equal(ok, false);
  });

  it('never swallows a capture stall', async () => {
    const stall = new CaptureStallError({ summary: 'stalled' });
    await assert.rejects(
      runOptional({
        page: fakePage(),
        fn: async () => {
          throw stall;
        },
        log: () => {},
      }),
      (e) => e === stall
    );
  });
});
