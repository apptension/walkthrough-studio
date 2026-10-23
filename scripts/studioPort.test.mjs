import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ensurePortFree,
  parsePortChoice,
  parsePortNumber,
  suggestNextPort,
} from './studioPort.mjs';
import { createTheme } from './studioDisplay.mjs';

test('suggestNextPort skips the common studio defaults', () => {
  assert.equal(suggestNextPort(4747), 4750);
  assert.equal(suggestNextPort(4750), 4751);
  assert.equal(suggestNextPort(4748, { role: 'desk' }), 4758);
  assert.equal(suggestNextPort(4758, { role: 'desk' }), 4759);
});

test('parsePortChoice accepts shortcuts and bare port numbers', () => {
  assert.deepEqual(parsePortChoice('k'), { kind: 'kill' });
  assert.deepEqual(parsePortChoice('KILL'), { kind: 'kill' });
  assert.deepEqual(parsePortChoice('o'), { kind: 'other' });
  assert.deepEqual(parsePortChoice('q'), { kind: 'quit' });
  assert.deepEqual(parsePortChoice('4750'), { kind: 'port', port: 4750 });
  assert.equal(parsePortChoice('').kind, 'empty');
  assert.equal(parsePortChoice('nope').kind, 'unknown');
});

test('parsePortNumber rejects junk', () => {
  assert.equal(parsePortNumber('4750'), 4750);
  assert.equal(parsePortNumber(''), null);
  assert.equal(parsePortNumber('0'), null);
  assert.equal(parsePortNumber('99999'), null);
});

test('ensurePortFree kills then rechecks, or switches port', async () => {
  const theme = createTheme(false);
  const busy = new Set([4747]);
  const killed = [];
  const answers = ['k', 'o', ''];
  let askIdx = 0;

  const port = await ensurePortFree({
    port: 4747,
    theme,
    write() {},
    row() {},
    interactive: true,
    waitMs: 0,
    portFree: (p) => !busy.has(p),
    listPids: (p) => (busy.has(p) ? [4242] : []),
    describe: () => 'node (4242)',
    killPids: (pids) => {
      killed.push(...pids);
      busy.delete(4747);
      return { killed: pids, failed: [] };
    },
    ask: async () => answers[askIdx++] ?? 'q',
  });
  assert.equal(port, 4747);
  assert.deepEqual(killed, [4242]);

  busy.add(4747);
  busy.add(4750);
  const answers2 = ['o', '4751'];
  let i = 0;
  const switched = await ensurePortFree({
    port: 4747,
    theme,
    write() {},
    row() {},
    interactive: true,
    waitMs: 0,
    portFree: (p) => !busy.has(p),
    listPids: (p) => (busy.has(p) ? [1] : []),
    describe: () => 'node (1)',
    killPids: () => ({ killed: [], failed: [] }),
    ask: async () => answers2[i++] ?? 'q',
  });
  assert.equal(switched, 4751);
});
