/**
 * Interactive port conflict handling for ./studio.
 */
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

/** PIDs listening on 127.0.0.1:port (or *:port). */
export function listPortPids(port) {
  const r = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
    encoding: 'utf8',
  });
  if (r.status !== 0 && !r.stdout) return [];
  return String(r.stdout || '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export function describePortHolders(pids) {
  if (!pids.length) return 'unknown process';
  const bits = pids.map((pid) => {
    const r = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' });
    const name = String(r.stdout || '')
      .trim()
      .split('/')
      .pop();
    return name ? `${name} (${pid})` : String(pid);
  });
  return bits.join(', ');
}

export function killPortPids(pids, { signal = 'SIGTERM' } = {}) {
  const killed = [];
  const failed = [];
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
      killed.push(pid);
    } catch {
      failed.push(pid);
    }
  }
  return { killed, failed };
}

export function suggestNextPort(port, { role = 'api' } = {}) {
  if (role === 'desk') return port === 4748 ? 4758 : port + 1;
  return port === 4747 ? 4750 : port + 1;
}

export function parsePortChoice(raw) {
  const text = String(raw || '')
    .trim()
    .toLowerCase();
  if (!text) return { kind: 'empty' };
  if (text === 'k' || text === 'kill') return { kind: 'kill' };
  if (text === 'o' || text === 'other' || text === 'n' || text === 'new') return { kind: 'other' };
  if (text === 'q' || text === 'quit' || text === 'exit') return { kind: 'quit' };
  const asNum = Number(text);
  if (Number.isInteger(asNum) && asNum >= 1 && asNum <= 65535) return { kind: 'port', port: asNum };
  return { kind: 'unknown', raw: text };
}

export function parsePortNumber(raw) {
  const text = String(raw || '').trim();
  const asNum = Number(text);
  if (!Number.isInteger(asNum) || asNum < 1 || asNum > 65535) return null;
  return asNum;
}

async function askLine(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });
}

/**
 * Loop until `port` is free or the user quits.
 * Returns the free port number. Exits the process on quit / non-TTY failure.
 */
export async function ensurePortFree({
  port,
  role = 'api',
  flag = '--port',
  label = 'port',
  theme,
  write,
  row,
  section,
  footerFail,
  portFree,
  interactive = Boolean(input.isTTY && output.isTTY),
  listPids = listPortPids,
  describe = describePortHolders,
  killPids = killPortPids,
  ask = null,
  waitMs = 250,
} = {}) {
  let current = port;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  while (!portFree(current)) {
    section?.('Launch');
    // Only print the Launch header once per resolve session.
    section = null;
    const pids = listPids(current);
    const who = describe(pids);
    row?.(label, 'bad', `${current} in use · ${who}`);

    if (!interactive) {
      const next = suggestNextPort(current, { role });
      footerFail?.([
        `Stop the process on ${current}, or`,
        `Use another port:  ${theme.bold}./studio ${flag} ${next}${theme.reset}`,
      ]);
      process.exit(1);
    }

    const rl =
      ask ||
      createInterface({
        input,
        output,
        terminal: true,
      });
    const ownedRl = !ask;

    try {
      write?.();
      write?.(
        `${theme.soft}Port ${theme.reset}${theme.bold}${current}${theme.reset}${theme.soft} is busy (${who}).${theme.reset}`
      );
      write?.(
        `  ${theme.accent}k${theme.reset}  kill it    ${theme.accent}o${theme.reset}  other port    ${theme.accent}q${theme.reset}  quit`
      );
      const answer = await (ask
        ? ask(`  ${theme.soft}Choice [k/o/q] or a port number:${theme.reset} `)
        : askLine(rl, `  ${theme.soft}Choice [k/o/q] or a port number:${theme.reset} `));
      const choice = parsePortChoice(answer);

      if (choice.kind === 'empty' || choice.kind === 'unknown') {
        write?.(`${theme.warn}  Type k, o, q, or a port number.${theme.reset}`);
        continue;
      }

      if (choice.kind === 'quit') {
        write?.();
        write?.(`${theme.soft}Cancelled.${theme.reset}`);
        write?.();
        process.exit(1);
      }

      if (choice.kind === 'kill') {
        if (!pids.length) {
          write?.(`${theme.warn}  Could not find a PID for :${current}. Try another port.${theme.reset}`);
          continue;
        }
        const { killed, failed } = killPids(pids);
        if (killed.length) {
          write?.(
            `${theme.ok}  Sent SIGTERM to ${killed.join(', ')}${theme.reset}${
              failed.length ? `${theme.warn}  (failed: ${failed.join(', ')})${theme.reset}` : ''
            }`
          );
        } else {
          write?.(`${theme.bad}  Could not kill ${pids.join(', ')}.${theme.reset}`);
        }
        await sleep(waitMs);
        if (portFree(current)) {
          row?.(label, 'ok', `${current} freed`);
          return current;
        }
        // Escalate once with SIGKILL if still busy.
        if (killed.length) {
          killPids(listPids(current), { signal: 'SIGKILL' });
          await sleep(waitMs);
        }
        if (portFree(current)) {
          row?.(label, 'ok', `${current} freed`);
          return current;
        }
        write?.(`${theme.warn}  Still busy. Pick another option.${theme.reset}`);
        continue;
      }

      let nextPort = choice.kind === 'port' ? choice.port : null;
      if (choice.kind === 'other') {
        const suggested = suggestNextPort(current, { role });
        const raw = await (ask
          ? ask(`  ${theme.soft}New port [${suggested}]:${theme.reset} `)
          : askLine(rl, `  ${theme.soft}New port [${suggested}]:${theme.reset} `));
        nextPort = parsePortNumber(raw) ?? (String(raw || '').trim() === '' ? suggested : null);
        if (nextPort == null) {
          write?.(`${theme.warn}  Enter a port between 1 and 65535.${theme.reset}`);
          continue;
        }
      }

      if (nextPort === current) {
        write?.(`${theme.warn}  ${nextPort} is the same busy port.${theme.reset}`);
        continue;
      }
      current = nextPort;
      if (portFree(current)) {
        row?.(label, 'ok', `${current}`);
        return current;
      }
      // Loop will re-announce the new busy port.
    } finally {
      if (ownedRl) rl.close();
    }
  }

  return current;
}
