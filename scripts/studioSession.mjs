/**
 * Runs the Studio server and, in dev mode, the restart / log loop.
 */
import { spawn } from 'node:child_process';
import { relative } from 'node:path';
import { stdout as output } from 'node:process';
import { devWatchKind, watchPaths } from '../kit/lib/devServer.mjs';
import { formatLog, frameWidth, parseStudioBoot, readyCard, stripAnsi } from './studioDisplay.mjs';

export async function launchStudio(ctx) {
  const {
    port,
    dev,
    noOpen,
    openSlug,
    theme,
    kit,
    nodePath,
    startedAt,
    getAgentCheck,
    getAudioDetail,
    row,
    section,
    printNotes,
    startSpinner,
    stopSpinner,
    clearSpinner,
    footerFail,
    write,
    openBrowser,
    portFree,
  } = ctx;

  if (!portFree(port)) {
    section('Launch');
    row('port', 'bad', `${port} in use`);
    const next = port === 4747 ? 4750 : port + 1;
    footerFail([
      'Stop the other Studio (Ctrl+C in that terminal), or',
      `Use another port:  ${theme.bold}./studio --port ${next}${theme.reset}`,
    ]);
    process.exit(1);
  }

  section('Launch');

  let child = null;
  let shuttingDown = false;
  let bootedOnce = false;
  let announce = true;
  let phase = 'starting';
  const queued = [];
  let debounce = null;
  let suppressUntil = 0;
  let stopWatch = () => {};
  let bootTimer = null;
  let logBuf = '';

  const writeLog = (source, text, tone) => {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    write(
      formatLog({
        theme,
        columns: output.columns || 100,
        time,
        source,
        text,
        tone,
      })
    );
  };

  const beginRestart = () => {
    if (phase !== 'up' || !queued.length || shuttingDown) return;
    const batch = [...new Set(queued)];
    queued.length = 0;
    phase = 'restarting';
    writeLog('restart', batch.map((file) => relative(kit, file)).join(', '));
    try {
      child?.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  };

  const noteChange = (file) => {
    if (Date.now() < suppressUntil) return;
    if (devWatchKind(file, { kitDir: kit }) !== 'restart') return;
    queued.push(file);
    clearTimeout(debounce);
    debounce = setTimeout(beginRestart, 200);
  };

  if (dev) {
    const stops = [
      watchPaths(`${kit}/lib`, noteChange),
      watchPaths(`${kit}/cli.mjs`, () => noteChange(`${kit}/cli.mjs`)),
    ];
    stopWatch = () => {
      for (const stop of stops) stop();
    };
  }

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (bootTimer) clearTimeout(bootTimer);
    clearTimeout(debounce);
    clearSpinner?.();
    stopWatch();
    write();
    write(`${theme.soft}Stopped Studio${theme.reset}${signal === 'SIGINT' ? `  ${theme.soft}(Ctrl+C)${theme.reset}` : ''}`);
    write();
    try {
      child?.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    setTimeout(() => process.exit(signal === 'SIGINT' ? 130 : 143), 400).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  const onServerLine = (line) => {
    const marker = line.indexOf('__WTDEV__');
    if (marker >= 0) {
      const parts = line.slice(marker).split('\t');
      const kind = parts[1] || 'log';
      const where = parts[2] || '';
      const text = parts[3] || '';
      if (kind === 'css') {
        writeLog('css', text || where);
        return;
      }
      if (kind === 'reload') {
        writeLog('reload', text || where);
        return;
      }
      const tone = kind === 'error' ? 'error' : kind === 'warn' ? 'warn' : 'info';
      const detail = [kind, text].filter(Boolean).join('  ');
      writeLog('browser', where ? `${detail}  ${where}` : detail, tone);
      return;
    }
    writeLog('server', stripAnsi(line));
  };

  const emitText = (text) => {
    logBuf += text;
    const parts = logBuf.split(/\r\n|\n|\r/);
    logBuf = parts.pop() ?? '';
    for (const line of parts) {
      if (line.trim()) onServerLine(line);
    }
  };

  const childArgs = () => {
    const list = ['cli.mjs', 'studio', '--port', String(port)];
    if (dev) list.push('--dev');
    if (openSlug) list.push(openSlug);
    return list;
  };

  const readyRows = (info) => {
    const rows = [];
    if (openSlug) rows.push({ label: 'Project', value: openSlug });
    rows.push({ label: 'Videos', value: String(info.videoCount ?? 0) });
    const audio = getAudioDetail();
    if (audio) rows.push(audio);
    rows.push(...agentRows(getAgentCheck()));
    rows.push({ label: 'Stop', value: 'Ctrl+C' });
    if (dev) {
      rows.push({ label: 'UI', value: 'kit/studio reloads on save' });
      rows.push({ label: 'Server', value: 'kit/lib and cli.mjs restart' });
      rows.push({ label: 'Browser', value: 'errors and warnings' });
    } else {
      rows.push({ label: 'Dev', value: './studio --dev' });
    }
    return rows;
  };

  const runOnce = () => {
    logBuf = '';
    const proc = spawn(nodePath, childArgs(), {
      cwd: kit,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: dev ? { ...process.env, WALKTHROUGH_DEV: '1' } : process.env,
    });
    child = proc;
    let buffer = '';
    let booted = false;
    let settleTimer = null;
    const firstAnnounce = announce;

    if (firstAnnounce) startSpinner('server');

    const present = (info) => {
      if (booted) return;
      booted = true;
      announce = false;
      bootedOnce = true;
      phase = 'up';
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      if (bootTimer) {
        clearTimeout(bootTimer);
        bootTimer = null;
      }
      if (firstAnnounce) {
        stopSpinner('server', 'ok', `127.0.0.1:${port}`);
        printNotes();
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        write();
        write(
          readyCard({
            theme,
            width: frameWidth(output.columns),
            elapsed,
            url: info.url || `http://127.0.0.1:${port}/`,
            browserLine: noOpen ? 'browser left closed  ·  --no-open' : 'opening browser',
            rows: readyRows(info),
          })
        );
        write();
        if (dev) writeLog('dev', 'watching kit/studio, kit/lib, and kit/cli.mjs');
        if (!noOpen && info.url) openBrowser(info.url);
      } else {
        writeLog('dev', 'listening');
      }
      // A single save often emits a second watch event while the process is restarting.
      suppressUntil = Date.now() + 600;
      clearTimeout(debounce);
      queued.length = 0;
    };

    const onChunk = (chunk) => {
      const text = chunk.toString();
      if (!booted) {
        buffer += text;
        if (dev && bootedOnce) emitText(text);
        const info = parseStudioBoot(buffer);
        if (!info.url) return;
        if (info.complete) present(info);
        else if (!settleTimer) settleTimer = setTimeout(() => present(parseStudioBoot(buffer)), 250);
        return;
      }
      if (dev) emitText(text);
    };

    proc.stdout.on('data', onChunk);
    proc.stderr.on('data', onChunk);

    bootTimer = setTimeout(() => {
      if (!booted && !shuttingDown) {
        stopSpinner('server', 'bad', 'no ready signal');
        footerFail([
          'Studio process started but never printed its URL.',
          `Try manually:  ${theme.bold}cd kit && node cli.mjs studio${theme.reset}`,
        ]);
        try {
          proc.kill('SIGTERM');
        } catch {
          /* ignore */
        }
        process.exit(1);
      }
    }, 15000);

    return new Promise((resolve) => {
      proc.on('exit', (code, signal) => {
        if (settleTimer) clearTimeout(settleTimer);
        if (bootTimer) {
          clearTimeout(bootTimer);
          bootTimer = null;
        }
        resolve({
          code: code ?? (signal ? 1 : 0),
          booted,
          tail: buffer.trim().split('\n').slice(-8).join('\n'),
        });
      });
    });
  };

  while (!shuttingDown) {
    const result = await runOnce();
    if (shuttingDown) break;
    if (phase === 'restarting') {
      const free = await waitForPortFree(port, portFree);
      if (!free) {
        footerFail([`Port ${port} stayed busy after restart. Stop the other process, or pass --port.`]);
        process.exit(1);
      }
      phase = 'starting';
      continue;
    }
    if (!result.booted) {
      stopSpinner('server', 'bad', 'exited early');
      if (result.tail) {
        write();
        write(`${theme.soft}${result.tail}${theme.reset}`);
      }
      footerFail([`Run from kit/:  ${theme.bold}node cli.mjs studio${theme.reset}`]);
      process.exit(result.code || 1);
    }
    if (dev) {
      write();
      writeLog('server', `exited ${result.code}`);
    }
    process.exit(result.code ?? 0);
  }
}

function agentRows(status) {
  if (!status?.runners) return [{ label: 'Agent', value: 'unknown', tone: 'warn' }];
  return ['cursor', 'claude'].map((key) => {
    const runner = status.runners[key];
    const label = key === 'cursor' ? 'Cursor' : 'Claude';
    if (!runner?.available) return { label, value: 'not installed', tone: 'warn' };
    if (!runner.authenticated) return { label, value: 'needs sign-in', tone: 'warn' };
    const via = runner.via ? ` · ${runner.via}` : '';
    const soft = runner.soft ? ' · unverified' : '';
    return { label, value: `ready${via}${soft}`, tone: runner.soft ? 'warn' : 'ok' };
  });
}

async function waitForPortFree(candidate, portFree) {
  const start = Date.now();
  while (Date.now() - start < 4000) {
    if (portFree(candidate)) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return portFree(candidate);
}
