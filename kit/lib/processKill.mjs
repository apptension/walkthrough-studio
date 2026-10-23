/**
 * Terminate a subprocess, escalating to a kill signal if it does not actually exit.
 *
 * `ChildProcess#killed` only reports that a signal was *sent*, not that the process
 * died — Node sets it to `true` the instant `kill()` succeeds, whether the target
 * honors the signal or not. Using it to decide whether to escalate meant the escalation
 * almost never fired: a process that ignored SIGTERM, or (as with Playwright's own
 * SIGTERM handler) got stuck mid graceful-shutdown trying to close an already-wedged
 * browser, just kept running — Stop looked like it did nothing.
 *
 * `hasExited()` must report real process state (e.g. `child.exitCode !== null ||
 * child.signalCode !== null`), not whether a signal was sent.
 */

/**
 * @param {object} opts
 * @param {() => boolean} opts.hasExited
 * @param {(signal: string) => void} opts.kill
 * @param {string} [opts.signal]
 * @param {number} [opts.killMs]
 * @param {(fn: () => void, ms: number) => unknown} [opts.schedule]
 */
export function terminate({ hasExited, kill, signal = 'SIGTERM', killMs = 1600, schedule = setTimeout } = {}) {
  if (hasExited()) return;
  kill(signal);
  schedule(() => {
    if (!hasExited()) kill('SIGKILL');
  }, killMs);
}

/** True once a `child_process.ChildProcess` has actually exited (any reason). */
export function hasChildExited(child) {
  return Boolean(child) && (child.exitCode !== null || child.signalCode !== null);
}

/**
 * Signal an entire process group, not just the one pid — killing a wrapper process
 * (e.g. `node cli.mjs record`) left its own children (Playwright's Chromium, ffmpeg)
 * running as orphans, since terminating a process never terminates what it spawned.
 *
 * Spawning with `detached: true` makes the child its own process-group leader, with a
 * pgid equal to its pid; signaling `-pid` then reaches that process and everything it
 * spawned in one shot. Falls back to the plain pid if the target was never a group
 * leader (nothing to find at `-pid`), and swallows the error if the target is already
 * gone either way.
 */
export function killTree(pid, signal, { kill = (p, s) => process.kill(p, s) } = {}) {
  if (!pid) return;
  try {
    kill(-pid, signal);
  } catch {
    try {
      kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}
