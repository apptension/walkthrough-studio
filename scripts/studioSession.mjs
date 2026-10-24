/**
 * Runs the Studio server, which serves the desk. In --dev mode, also runs the
 * desk on Vite with hot reload and restarts the kit server when lib/cli change.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stdout as output } from 'node:process';
import { devWatchKind, watchPaths } from '../kit/lib/devServer.mjs';
import {
  deskUrl,
  formatLog,
  frameWidth,
  parseStudioBoot,
  parseViteBoot,
  readyCard,
  stripAnsi,
} from './studioDisplay.mjs';
import { ensurePortFree } from './studioPort.mjs';

export async function launchStudio(ctx) {
  const {
    port: requestedPort,
    uiPort: requestedUiPort = 4748,
    desk = 'next',
    studioNext = null,
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

  section('Launch');

  const port = await ensurePortFree({
    port: requestedPort,
    role: 'api',
    flag: '--port',
    label: 'port',
    theme,
    write,
    row,
    footerFail,
    portFree,
  });

  const useVite = Boolean(dev && desk === 'next' && studioNext);
  let uiPort = requestedUiPort;
  if (useVite) {
    uiPort = await ensurePortFree({
      port: requestedUiPort,
      role: 'desk',
      flag: '--ui-port',
      label: 'desk',
      theme,
      write,
      row,
      footerFail,
      portFree,
    });
  }

  let child = null;
  let uiChild = null;
  let uiReady = false;
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
  let uiLogBuf = '';

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

  const killProc = (proc) => {
    if (!proc || proc.killed || proc.exitCode != null) return;
    try {
      proc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  };

  const beginRestart = () => {
    if (phase !== 'up' || !queued.length || shuttingDown) return;
    const batch = [...new Set(queued)];
    queued.length = 0;
    phase = 'restarting';
    writeLog('restart', batch.map((file) => relative(kit, file)).join(', '));
    killProc(child);
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
    write(
      `${theme.soft}Stopped Studio${theme.reset}${
        signal === 'SIGINT' ? `  ${theme.soft}(Ctrl+C)${theme.reset}` : ''
      }`
    );
    write();
    killProc(uiChild);
    killProc(child);
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
    if (desk === 'legacy') list.push('--legacy');
    if (openSlug) list.push(openSlug);
    return list;
  };

  const readyRows = (info) => {
    const rows = [];
    const served = info.desk || desk;
    if (useVite) {
      rows.push({ label: 'Desk', value: `Vite · 127.0.0.1:${uiPort}`, tone: 'ok' });
      rows.push({ label: 'API', value: `127.0.0.1:${port}` });
    } else if (served === 'legacy') {
      rows.push({ label: 'Desk', value: 'classic · retiring', tone: 'warn' });
    }
    if (openSlug) rows.push({ label: 'Project', value: openSlug });
    rows.push({ label: 'Videos', value: String(info.videoCount ?? 0) });
    const audio = getAudioDetail();
    if (audio) rows.push(audio);
    rows.push(...agentRows(getAgentCheck()));
    rows.push({ label: 'Stop', value: 'Ctrl+C' });
    if (dev) {
      rows.push({ label: 'UI', value: useVite ? 'kit/studio-next hot reload' : 'kit/studio reloads on save' });
      rows.push({ label: 'Server', value: 'kit/lib and cli.mjs restart' });
      if (!useVite) rows.push({ label: 'Browser', value: 'errors and warnings' });
    } else {
      rows.push({ label: 'Dev', value: './studio --dev' });
      if (served === 'legacy') rows.push({ label: 'New desk', value: './studio --v2' });
    }
    return rows;
  };

  const viteBin = () => {
    if (!studioNext) return null;
    const candidates = [
      join(studioNext, 'node_modules', 'vite', 'bin', 'vite.js'),
      join(studioNext, 'node_modules', 'vite', 'bin', 'vite.mjs'),
    ];
    return candidates.find((path) => existsSync(path)) || null;
  };

  const startViteDesk = () =>
    new Promise((resolve, reject) => {
      if (uiReady && uiChild && uiChild.exitCode == null) {
        resolve(deskUrl(uiPort, openSlug));
        return;
      }

      const bin = viteBin();
      if (!bin) {
        reject(new Error('vite binary missing — run npm install in kit/studio-next'));
        return;
      }

      const origin = `http://127.0.0.1:${port}`;
      const proc = spawn(
        nodePath,
        [bin, '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'],
        {
          cwd: studioNext,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, STUDIO_ORIGIN: origin },
        }
      );
      uiChild = proc;
      let buffer = '';
      let settled = false;
      let timer = null;

      const finish = (err, url) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (err) {
          killProc(proc);
          uiChild = null;
          uiReady = false;
          reject(err);
          return;
        }
        uiReady = true;
        resolve(url);
      };

      const onUiChunk = (chunk) => {
        const text = chunk.toString();
        buffer += text;
        if (dev && uiReady) {
          uiLogBuf += text;
          const parts = uiLogBuf.split(/\r\n|\n|\r/);
          uiLogBuf = parts.pop() ?? '';
          for (const line of parts) {
            if (line.trim()) writeLog('vite', stripAnsi(line));
          }
        }
        if (settled) return;
        const boot = parseViteBoot(buffer);
        if (boot.complete) finish(null, deskUrl(uiPort, openSlug));
      };

      proc.stdout.on('data', onUiChunk);
      proc.stderr.on('data', onUiChunk);

      proc.on('exit', (code, signal) => {
        uiReady = false;
        uiChild = null;
        if (!settled) {
          finish(new Error(`desk exited before ready (${code ?? signal ?? '?'})`));
          return;
        }
        if (!shuttingDown && phase === 'up') {
          writeLog('vite', `exited ${code ?? signal ?? 0}`, 'warn');
        }
      });

      timer = setTimeout(() => {
        finish(new Error(`desk did not become ready on :${uiPort}`));
      }, 20000);
    });

  const showReady = async (info) => {
    let openUrl = useVite ? deskUrl(uiPort, openSlug) : info.url || deskUrl(port, openSlug);

    if (useVite) {
      startSpinner('desk');
      try {
        openUrl = await startViteDesk();
        stopSpinner('desk', 'ok', `127.0.0.1:${uiPort}`);
      } catch (err) {
        stopSpinner('desk', 'bad', err.message || 'failed');
        footerFail([
          String(err.message || err),
          `Manual desk:  ${theme.bold}cd kit/studio-next && STUDIO_ORIGIN=http://127.0.0.1:${port} npm run dev${theme.reset}`,
        ]);
        killProc(child);
        process.exit(1);
      }
    }

    printNotes();
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    write();
    write(
      readyCard({
        theme,
        width: frameWidth(output.columns),
        elapsed,
        url: openUrl,
        browserLine: noOpen ? 'browser left closed  ·  --no-open' : 'opening browser',
        rows: readyRows(info),
      })
    );
    write();
    if (dev) {
      writeLog(
        'dev',
        useVite
          ? 'watching kit/lib and kit/cli.mjs · desk hot reload via Vite'
          : 'watching kit/studio, kit/lib, and kit/cli.mjs'
      );
    }
    if (!noOpen && openUrl) openBrowser(openUrl);
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
        void showReady(info).finally(() => {
          suppressUntil = Date.now() + 600;
          clearTimeout(debounce);
          queued.length = 0;
        });
      } else {
        writeLog('dev', 'listening');
        suppressUntil = Date.now() + 600;
        clearTimeout(debounce);
        queued.length = 0;
      }
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
        killProc(uiChild);
        killProc(proc);
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
        killProc(uiChild);
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
      killProc(uiChild);
      process.exit(result.code || 1);
    }
    if (dev) {
      write();
      writeLog('server', `exited ${result.code}`);
    }
    killProc(uiChild);
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
