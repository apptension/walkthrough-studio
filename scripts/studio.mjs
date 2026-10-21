#!/usr/bin/env node
/**
 * One-command Walkthrough Studio: check toolchain → install if needed → launch → open browser.
 *
 *   ./studio
 *   ./studio walkthrough-studio
 *   ./studio --port 4750
 *   ./studio --no-open
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stdout as output } from 'node:process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = join(ROOT, 'kit');
const MIN_NODE = [20, 0, 0];
const MIN_NPM = [11, 17, 0];
const LABEL_W = 14;

const args = process.argv.slice(2);
const noOpen = args.includes('--no-open');
const portFlag = args.indexOf('--port');
const port = Number(portFlag >= 0 ? args[portFlag + 1] : 4747) || 4747;
const openSlug =
  args.find((a, i) => !String(a).startsWith('-') && i !== portFlag + 1) || null;

const tty = Boolean(output.isTTY);
const useColor =
  tty &&
  !process.env.NO_COLOR &&
  process.env.TERM !== 'dumb' &&
  process.env.FORCE_COLOR !== '0';

const ansi = (code) => (useColor ? `\x1b[${code}m` : '');
const c = {
  reset: ansi(0),
  bold: ansi(1),
  dim: ansi(2),
  italic: ansi(3),
  under: ansi(4),
  red: ansi(31),
  green: ansi(32),
  amber: ansi(33),
  soft: ansi(90),
  ink: ansi(37),
  // warm film accent — not purple
  accent: useColor ? '\x1b[38;5;216m' : '',
  line: useColor ? '\x1b[38;5;240m' : '',
  ok: useColor ? '\x1b[38;5;114m' : '',
  warn: useColor ? '\x1b[38;5;178m' : '',
  bad: useColor ? '\x1b[38;5;203m' : '',
};

const startedAt = Date.now();
const notes = []; // soft warnings collected during checks
let agentCheck = null; // result of checkAgents() for the Ready card
let spinnerTimer = null;
let spinnerFrame = 0;
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}

function padLabel(label) {
  const plain = stripAnsi(label);
  return label + ' '.repeat(Math.max(0, LABEL_W - plain.length));
}

function write(msg = '') {
  output.write(msg + (msg.endsWith('\n') ? '' : '\n'));
}

function writeErr(msg = '') {
  process.stderr.write(msg + (msg.endsWith('\n') ? '' : '\n'));
}

function hr(width = 44) {
  return `${c.line}${'─'.repeat(width)}${c.reset}`;
}

function box(lines, { width = 48 } = {}) {
  const inner = width - 4;
  const top = `${c.line}┌${'─'.repeat(width - 2)}┐${c.reset}`;
  const bot = `${c.line}└${'─'.repeat(width - 2)}┘${c.reset}`;
  const body = lines.map((line) => {
    const plain = stripAnsi(line);
    const pad = Math.max(0, inner - plain.length);
    return `${c.line}│${c.reset} ${line}${' '.repeat(pad)} ${c.line}│${c.reset}`;
  });
  return [top, ...body, bot].join('\n');
}

function section(title) {
  write();
  write(`${c.soft}${c.bold}${title}${c.reset}`);
}

function row(label, status, detail = '') {
  const glyph =
    status === 'ok'
      ? `${c.ok}●${c.reset}`
      : status === 'warn'
        ? `${c.warn}●${c.reset}`
        : status === 'bad'
          ? `${c.bad}●${c.reset}`
          : status === 'skip'
            ? `${c.soft}○${c.reset}`
            : `${c.soft}·${c.reset}`;
  const detailPart = detail ? `  ${c.soft}${detail}${c.reset}` : '';
  write(`  ${glyph}  ${padLabel(label)}${detailPart}`);
}

function tip(msg) {
  write(`     ${c.soft}${msg}${c.reset}`);
}

function note(msg, fix) {
  notes.push({ msg, fix });
}

function banner() {
  write();
  write(
    box(
      [
        `${c.bold}${c.accent}Walkthrough Studio${c.reset}`,
        `${c.soft}check → setup → launch${c.reset}${openSlug ? `  ${c.soft}·${c.reset}  ${c.ink}${openSlug}${c.reset}` : ''}`,
      ],
      { width: 48 }
    )
  );
}

function footerFail(fixes) {
  write();
  write(hr());
  write(`${c.bad}${c.bold}Couldn't start Studio${c.reset}`);
  write(`${c.soft}Fix the items below, then run ${c.reset}${c.bold}./studio${c.reset}${c.soft} again.${c.reset}`);
  write();
  fixes.forEach((f, i) => {
    write(`  ${c.accent}${i + 1}.${c.reset}  ${f}`);
  });
  write();
}

function printNotes() {
  if (!notes.length) return;
  section('Notes');
  for (const n of notes) {
    write(`  ${c.warn}!${c.reset}  ${n.msg}`);
    if (n.fix) tip(n.fix);
  }
}

function startSpinner(label) {
  spinnerFrame = 0;
  if (!tty) return; // final row is printed by stopSpinner only
  const tick = () => {
    const frame = SPINNER[spinnerFrame++ % SPINNER.length];
    output.write(`\r  ${c.accent}${frame}${c.reset}  ${padLabel(label)}${c.soft}working${c.reset}   `);
  };
  tick();
  spinnerTimer = setInterval(tick, 80);
}

function stopSpinner(label, status, detail) {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
  }
  if (tty) output.write('\r\x1b[2K');
  row(label, status, detail);
}

function parseVersion(raw) {
  const m = String(raw).trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function gte(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

function fmt(v) {
  return v.join('.');
}

function run(cmd, cmdArgs, { silent = false } = {}) {
  return spawnSync(cmd, cmdArgs, {
    cwd: KIT,
    stdio: silent ? 'pipe' : 'inherit',
    encoding: 'utf8',
    env: process.env,
  });
}

function depsInstalled() {
  return existsSync(join(KIT, 'node_modules', 'playwright'));
}

function chromiumReady() {
  try {
    const require = createRequire(join(KIT, 'package.json'));
    const { chromium } = require('playwright');
    const exe = chromium.executablePath();
    return exe && existsSync(exe);
  } catch {
    return false;
  }
}

function envStatus() {
  const envPath = join(KIT, '.env');
  const example = join(KIT, '.env.example');
  if (!existsSync(envPath)) {
    return { state: 'missing', example: existsSync(example) };
  }
  let keyed = false;
  let stub = false;
  try {
    const body = readFileSync(envPath, 'utf8');
    keyed = /^\s*ELEVENLABS_API_KEY\s*=\s*\S+/m.test(body);
    stub = /^\s*WALKTHROUGH_AUDIO_STUB\s*=\s*1\b/m.test(body);
  } catch {
    /* ignore */
  }
  if (process.env.ELEVENLABS_API_KEY) keyed = true;
  return { state: 'present', keyed, stub };
}

function openBrowser(url) {
  let cmd;
  let cmdArgs;
  if (process.platform === 'darwin') {
    cmd = 'open';
    cmdArgs = [url];
  } else if (process.platform === 'win32') {
    cmd = 'cmd';
    cmdArgs = ['/c', 'start', '', url];
  } else {
    cmd = 'xdg-open';
    cmdArgs = [url];
  }
  const child = spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true });
  child.unref();
}

function portFree(p) {
  const r = spawnSync(
    process.execPath,
    [
      '-e',
      `const n=require('net');const s=n.createServer();s.once('error',()=>process.exit(1));s.listen(${p},'127.0.0.1',()=>s.close(()=>process.exit(0)));`,
    ],
    { encoding: 'utf8' }
  );
  return r.status === 0;
}

function checkNode() {
  const v = parseVersion(process.versions.node);
  if (!v || !gte(v, MIN_NODE)) {
    row('Node.js', 'bad', `v${process.versions.node}  need ${fmt(MIN_NODE)}+`);
    return {
      ok: false,
      fix: 'Install Node 20+:  brew install node@20   or   nvm install 20 && nvm use 20',
    };
  }
  row('Node.js', 'ok', `v${process.versions.node}`);
  return { ok: true };
}

function checkNpm({ needInstall }) {
  const r = spawnSync('npm', ['-v'], { encoding: 'utf8' });
  if (r.status !== 0) {
    row('npm', 'bad', 'not found');
    return { ok: false, fix: 'Reinstall Node 20+, then:  npm install -g npm@latest' };
  }
  const v = parseVersion(r.stdout || '');
  if (!v) {
    row('npm', 'bad', 'unknown version');
    return { ok: false, fix: 'npm install -g npm@latest' };
  }
  if (!gte(v, MIN_NPM)) {
    if (needInstall) {
      row('npm', 'bad', `${fmt(v)}  need ${fmt(MIN_NPM)}+`);
      return {
        ok: false,
        fix: `Upgrade npm (kit requires ${fmt(MIN_NPM)}+):  npm install -g npm@latest`,
      };
    }
    row('npm', 'warn', `${fmt(v)}  need ${fmt(MIN_NPM)}+ for installs`);
    note(`npm ${fmt(v)} is below ${fmt(MIN_NPM)} — fine while deps exist`, 'npm install -g npm@latest');
    return { ok: true };
  }
  row('npm', 'ok', fmt(v));
  return { ok: true };
}

function checkBin(name, installHint) {
  const r = spawnSync(name, ['-version'], { encoding: 'utf8' });
  if (r.error?.code === 'ENOENT' || r.status !== 0) {
    row(name, 'bad', 'not found');
    return { ok: false, fix: installHint };
  }
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const ver = out.match(/version\s+(\S+)/i)?.[1] || 'ok';
  row(name, 'ok', ver);
  return { ok: true };
}

function ensureDeps() {
  if (depsInstalled()) {
    row('packages', 'ok', 'ready');
    return true;
  }
  startSpinner('packages');
  const r = run('npm', ['install'], { silent: !tty });
  if (r.status !== 0) {
    stopSpinner('packages', 'bad', 'npm install failed');
    if (r.stdout) writeErr(r.stdout);
    if (r.stderr) writeErr(r.stderr);
    return false;
  }
  stopSpinner('packages', 'ok', 'installed');
  return true;
}

function ensureChromium() {
  if (chromiumReady()) {
    row('Chromium', 'ok', 'ready');
    return true;
  }
  startSpinner('Chromium');
  const r = run('npx', ['playwright', 'install', 'chromium'], { silent: true });
  if (r.status !== 0 || !chromiumReady()) {
    stopSpinner('Chromium', 'bad', 'install failed');
    if (r.stderr) writeErr(String(r.stderr).trim());
    return false;
  }
  stopSpinner('Chromium', 'ok', 'installed');
  return true;
}

function ensureEnv() {
  const st = envStatus();
  if (st.state === 'missing') {
    if (!st.example) {
      row('env', 'warn', 'no .env.example');
      return true;
    }
    copyFileSync(join(KIT, '.env.example'), join(KIT, '.env'));
    row('env', 'ok', 'created kit/.env');
    note('Add ELEVENLABS_API_KEY for voice, music, and Regenerate', 'edit kit/.env  ·  or set WALKTHROUGH_AUDIO_STUB=1');
    return true;
  }
  if (st.keyed) {
    row('env', 'ok', 'ElevenLabs key set');
  } else if (st.stub) {
    row('env', 'ok', 'audio stub on');
  } else {
    row('env', 'warn', 'no API key');
    note('Studio UI works without a key; voice / music / Regenerate need one', 'ELEVENLABS_API_KEY in kit/.env  ·  or WALKTHROUGH_AUDIO_STUB=1');
  }
  return true;
}

function runnerCheckDetail(runner) {
  if (!runner?.available) return { status: 'warn', detail: 'not installed' };
  if (!runner.authenticated) return { status: 'warn', detail: 'needs sign-in' };
  if (runner.soft) return { status: 'warn', detail: 'signed in (unverified)' };
  const via = runner.via ? ` · ${runner.via}` : '';
  return { status: 'ok', detail: `ready${via}` };
}

/** Same Cursor + Claude probe as Studio’s header (soft — missing agent is not fatal). */
async function checkAgents() {
  // Import after ensureEnv so kit/.env exists and loadDotEnv can pick up keys.
  const { agentAuthStatus } = await import(pathToFileURL(join(KIT, 'lib/agentRunner.mjs')).href);
  const status = agentAuthStatus();
  const cursor = status.runners.cursor;
  const claude = status.runners.claude;

  const cDetail = runnerCheckDetail(cursor);
  const lDetail = runnerCheckDetail(claude);
  row('Cursor', cDetail.status, cDetail.detail);
  row('Claude Code', lDetail.status, lDetail.detail);

  if (status.ready) {
    const active = status.active?.label || status.provider;
    if (status.switchable) {
      note(
        `Agent Ready · active ${active}`,
        'Switch in the Studio header, or set WALKTHROUGH_AGENT=cursor|claude in kit/.env'
      );
    }
  } else if (!cursor.available && !claude.available) {
    note(
      'Improve / Create & draft need an agent CLI',
      'Install Cursor CLI (`agent login`) or Claude Code (`claude` → /login)'
    );
  } else {
    const hints = [];
    if (cursor.available && !cursor.authenticated) hints.push('`agent login` or CURSOR_API_KEY');
    if (claude.available && !claude.authenticated) hints.push('`claude` → /login or ANTHROPIC_API_KEY');
    note(
      'Agent CLI found but not signed in — Improve saves prompts until then',
      hints.join('  ·  ') || 'Sign in, then re-run ./studio'
    );
  }

  return status;
}

function agentReadyMeta(status, fallbackLine) {
  if (status) {
    const parts = [];
    for (const key of ['cursor', 'claude']) {
      const r = status.runners[key];
      if (!r.available) continue;
      const name = key === 'cursor' ? 'Cursor' : 'Claude';
      if (status.ready && status.provider === key) parts.push(`${name} ready`);
      else if (r.authenticated && !r.soft) parts.push(`${name} ready`);
      else parts.push(`${name} needs login`);
    }
    if (parts.length) {
      return {
        status: status.ready ? 'ok' : 'warn',
        text: parts.join(' · '),
      };
    }
  }
  return agentShort(fallbackLine);
}

function parseStudioBoot(text) {
  const url = text.match(/Walkthrough Studio → (http:\/\/127\.0\.0\.1:\d+\/\S*)/)?.[1] || null;
  const agentLine = text.match(/agent CLI:\s*(.+)/)?.[1]?.trim() || null;
  const videosMatch = text.match(/videos:\s*(.+?)\s*[·•]\s*out:/);
  const videosLine = videosMatch?.[1]?.trim() || null;
  let videoCount = 0;
  if (videosLine && videosLine !== '(none)') {
    videoCount = videosLine.split(',').map((s) => s.trim()).filter(Boolean).length;
  }
  // URL prints first; agent + videos follow on the next ticks — wait for a full banner.
  const complete = Boolean(url && agentLine && videosLine !== null);
  return { url, agentLine, videoCount, complete };
}

function agentShort(line) {
  if (!line) return null;
  if (line.startsWith('ready')) {
    // Keep "ready · Cursor agent …" compact for the Ready card.
    const short = line
      .replace(/^ready\s*·\s*/i, 'ready · ')
      .replace(/\s*\(.*?\)/g, '')
      .replace(/\s*·\s*.*also available.*$/i, '');
    return { status: 'ok', text: short.trim() || 'ready' };
  }
  if (line.includes('not found')) return { status: 'warn', text: 'not installed' };
  if (/claude/i.test(line) && /login|anthropic/i.test(line)) return { status: 'warn', text: 'Claude login needed' };
  return { status: 'warn', text: 'needs login' };
}

async function launch() {
  if (!portFree(port)) {
    section('Launch');
    row('port', 'bad', `${port} in use`);
    footerFail([
      `Stop the other Studio (Ctrl+C in that terminal), or`,
      `Use another port:  ${c.bold}./studio --port 4750${c.reset}`,
    ]);
    process.exit(1);
  }

  section('Launch');
  startSpinner('server');

  const studioArgs = ['cli.mjs', 'studio', '--port', String(port)];
  if (openSlug) studioArgs.push(openSlug);

  const child = spawn(process.execPath, studioArgs, {
    cwd: KIT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let buffer = '';
  let booted = false;
  let shuttingDown = false;
  let settleTimer = null;

  const presentReady = (info) => {
    if (booted) return;
    booted = true;
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    stopSpinner('server', 'ok', `127.0.0.1:${port}`);

    printNotes();

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    const agent = agentReadyMeta(agentCheck, info.agentLine);
    const openLine = noOpen
      ? `${c.soft}browser left closed  ·  --no-open${c.reset}`
      : `${c.soft}opening browser…${c.reset}`;
    const meta = [
      `${c.soft}videos${c.reset}  ${info.videoCount}`,
      agent
        ? `${c.soft}agent${c.reset}   ${agent.status === 'ok' ? c.ok : c.warn}${stripAnsi(agent.text)}${c.reset}`
        : null,
    ]
      .filter(Boolean)
      .join('    ');

    write();
    write(
      box(
        [
          `${c.bold}${c.accent}Ready${c.reset}  ${c.soft}${elapsed}s${c.reset}`,
          '',
          `${c.bold}${info.url}${c.reset}`,
          openLine,
          '',
          meta,
          `${c.soft}stop${c.reset}    Ctrl+C`,
        ],
        { width: 52 }
      )
    );
    write();

    if (!noOpen) openBrowser(info.url);
  };

  const onChunk = (chunk) => {
    buffer += chunk.toString();
    if (booted) return;
    const info = parseStudioBoot(buffer);
    if (!info.url) return;
    if (info.complete) {
      presentReady(info);
      return;
    }
    // URL arrived; give the rest of the banner a moment, then show what we have.
    if (!settleTimer) {
      settleTimer = setTimeout(() => presentReady(parseStudioBoot(buffer)), 250);
    }
  };

  child.stdout.on('data', onChunk);
  child.stderr.on('data', onChunk);

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
      if (tty) output.write('\r\x1b[2K');
    }
    write();
    write(`${c.soft}Stopped Studio${c.reset}${signal === 'SIGINT' ? `  ${c.soft}(Ctrl+C)${c.reset}` : ''}`);
    write();
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    // Force exit shortly if child hangs
    setTimeout(() => process.exit(signal === 'SIGINT' ? 130 : 143), 400).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Boot timeout
  const bootTimer = setTimeout(() => {
    if (!booted) {
      stopSpinner('server', 'bad', 'no ready signal');
      footerFail([
        'Studio process started but never printed its URL.',
        `Try manually:  ${c.bold}cd kit && node cli.mjs studio${c.reset}`,
      ]);
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      process.exit(1);
    }
  }, 15000);

  const code = await new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      clearTimeout(bootTimer);
      if (shuttingDown) resolve(signal === 'SIGINT' ? 130 : 0);
      else resolve(code ?? (signal ? 1 : 0));
    });
  });

  if (!shuttingDown && !booted) {
    stopSpinner('server', 'bad', 'exited early');
    const tail = buffer.trim().split('\n').slice(-8).join('\n');
    if (tail) {
      write();
      write(`${c.soft}${tail}${c.reset}`);
    }
    footerFail([`Run from kit/:  ${c.bold}node cli.mjs studio${c.reset}`]);
  }

  process.exit(code);
}

async function main() {
  // Help
  if (args.includes('-h') || args.includes('--help')) {
    write(`
${c.bold}${c.accent}Walkthrough Studio${c.reset}  ${c.soft}one-command setup + launch${c.reset}

  ${c.bold}./studio${c.reset}                      check, install if needed, open Studio
  ${c.bold}./studio${c.reset} <slug>               open a project
  ${c.bold}./studio${c.reset} --port 4750          use another port
  ${c.bold}./studio${c.reset} --no-open            start without opening a browser

${c.soft}Requires Node 20+, npm 11.17+, ffmpeg/ffprobe. Checks Cursor CLI and Claude Code for Improve jobs.${c.reset}
`);
    return;
  }

  banner();

  if (!existsSync(join(KIT, 'cli.mjs'))) {
    section('Check');
    row('project', 'bad', 'kit/cli.mjs missing');
    footerFail(['Run ./studio from the walkthrough-studio project root.']);
    process.exit(1);
  }

  section('Check');
  const fixes = [];
  const needInstall = !depsInstalled();

  const node = checkNode();
  if (!node.ok) fixes.push(node.fix);

  const npm = checkNpm({ needInstall });
  if (!npm.ok) fixes.push(npm.fix);

  for (const [bin, hint] of [
    ['ffmpeg', 'macOS:  brew install ffmpeg'],
    ['ffprobe', 'macOS:  brew install ffmpeg   (ffprobe ships with it)'],
  ]) {
    const r = checkBin(bin, hint);
    if (!r.ok) fixes.push(r.fix);
  }

  if (fixes.length) {
    footerFail(fixes);
    process.exit(1);
  }

  if (!ensureDeps()) {
    footerFail([
      needInstall
        ? `Upgrade npm first if needed:  ${c.bold}npm install -g npm@latest${c.reset}`
        : `From kit/:  ${c.bold}npm install${c.reset}`,
    ]);
    process.exit(1);
  }

  if (!ensureChromium()) {
    footerFail([`From kit/:  ${c.bold}npx playwright install chromium${c.reset}`]);
    process.exit(1);
  }

  ensureEnv();
  agentCheck = await checkAgents();

  await launch();
}

main().catch((err) => {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    if (tty) output.write('\r\x1b[2K');
  }
  write();
  write(`${c.bad}${c.bold}Unexpected error${c.reset}`);
  write(`  ${err.message || String(err)}`);
  write();
  process.exit(1);
});
