// Real processes, real signals — the fakes in processKill.test.mjs prove the escalation
// logic, this proves killTree + detached:true actually reach a whole process tree on
// this OS, and that terminate() really revives a wedged process via SIGKILL.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';

import { killTree, terminate } from './processKill.mjs';

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(fn, { timeoutMs = 2000, stepMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return fn();
}

describe('processKill (real processes)', () => {
  it('killTree kills a spawned grandchild, not just the direct child', async () => {
    // A detached shell that backgrounds a sleep — the grandchild inherits the shell's
    // new process group because it was never itself spawned with detached:true,
    // mirroring Playwright's Chromium / ffmpeg being spawned from inside cli.mjs.
    const parent = spawn('sh', ['-c', 'sleep 60 & echo $! && wait'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: true,
    });

    const grandchildPid = await new Promise((resolve, reject) => {
      let buf = '';
      parent.stdout.on('data', (d) => {
        buf += d;
        const n = Number(buf.trim());
        if (Number.isInteger(n)) resolve(n);
      });
      parent.on('error', reject);
    });

    assert.ok(alive(parent.pid), 'parent should be running');
    assert.ok(alive(grandchildPid), 'grandchild sleep should be running');

    killTree(parent.pid, 'SIGKILL');

    const parentGone = await waitUntil(() => !alive(parent.pid));
    const grandchildGone = await waitUntil(() => !alive(grandchildPid));
    assert.ok(parentGone, 'parent should have exited');
    assert.ok(grandchildGone, 'grandchild should have exited too — this is the bug being fixed');
  });

  it('terminate escalates to SIGKILL for a real process that ignores SIGTERM', async () => {
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], {
      stdio: 'ignore',
      detached: true,
    });
    await waitUntil(() => alive(child.pid));

    terminate({
      hasExited: () => !alive(child.pid),
      kill: (signal) => killTree(child.pid, signal),
      killMs: 200,
    });

    const gone = await waitUntil(() => !alive(child.pid), { timeoutMs: 3000 });
    assert.ok(gone, 'a SIGTERM-ignoring process must still die once SIGKILL escalates');
  });
});
