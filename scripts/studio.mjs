#!/usr/bin/env node
/**
 * One-command Walkthrough Studio: check toolchain → install if needed → launch → open browser.
 *
 *   ./studio
 *   ./studio walkthrough-studio
 *   ./studio --port 4750
 *   ./studio --no-open
 *   ./studio --dev
 *   ./studio --dev --ui-port 4758
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stdout as output } from 'node:process';
import { VERSION } from '../kit/lib/version.mjs';
import { buildDesk, buildFresh, depsFresh, installDesk, parseStudioArgs } from './studioDesk.mjs';
import { launchStudio } from './studioSession.mjs';
import {
  createTheme,
  formatCheckRow,
  studioBanner,
  visibleWidth,
  wrapAnsi,
} from './studioDisplay.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = join(ROOT, 'kit');
const DESK_DIR = join(KIT, 'studio');
const MIN_NODE = [20, 0, 0];
const MIN_NPM = [11, 17, 0];

const { help, noOpen, dev, legacy, port, uiPort, openSlug } = parseStudioArgs(process.argv.slice(2));

const tty = Boolean(output.isTTY);
const c = createTheme(
  tty && !process.env.NO_COLOR && process.env.TERM !== 'dumb' && process.env.FORCE_COLOR !== '0'
);

const startedAt = Date.now();
const notes = [];
let agentCheck = null;
let audioDetail = null;
let spinnerTimer = null;
let spinnerFrame = 0;
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function write(msg = '') {
  output.write(msg + (msg.endsWith('\n') ? '' : '\n'));
}

function writeErr(msg = '') {
  process.stderr.write(msg + (msg.endsWith('\n') ? '' : '\n'));
}

function section(title) {
  write();
  write(`${c.soft}${c.bold}${title}${c.reset}`);
}

function row(label, status, detail = '') {
  write(
    formatCheckRow({
      theme: c,
      columns: output.columns || 100,
      label,
      status,
      detail,
    })
  );
}

function tip(msg) {
  const cols = output.columns || 100;
  const head = '     ';
  const lines = wrapAnsi(`${c.soft}${msg}${c.reset}`, Math.max(16, cols - head.length));
  lines.forEach((line, index) => {
    write(index === 0 ? head + line : `${' '.repeat(head.length)}${line}`);
  });
}

function note(msg, fix) {
  notes.push({ msg, fix });
}

function banner() {
  const tags = [];
  if (dev) tags.push('dev');
  write();
  write(
    studioBanner({
      theme: c,
      version: VERSION,
      tags,
      columns: output.columns || 80,
      withMark: true,
    })
  );
  if (openSlug) write(`${c.soft}project${c.reset}  ${openSlug}`);
  write();
}

function footerFail(fixes) {
  write();
  write(`${c.bad}${c.bold}Couldn't start Studio${c.reset}`);
  write(`${c.soft}Fix the items below, then run ${c.reset}${c.bold}./studio${c.reset}${c.soft} again.${c.reset}`);
  write();
  const cols = output.columns || 100;
  fixes.forEach((fix, index) => {
    const head = `  ${c.accent}${String(index + 1).padStart(2, ' ')}.${c.reset}  `;
    const lines = wrapAnsi(fix, Math.max(16, cols - visibleWidth(head)));
    const indent = ' '.repeat(visibleWidth(head));
    lines.forEach((line, lineIndex) => write(lineIndex === 0 ? head + line : indent + line));
  });
  write();
}

function printNotes() {
  if (!notes.length) return;
  section('Notes');
  const cols = output.columns || 100;
  for (const item of notes) {
    const head = `  ${c.warn}!${c.reset}  `;
    const lines = wrapAnsi(item.msg, Math.max(16, cols - visibleWidth(head)));
    const indent = ' '.repeat(visibleWidth(head));
    lines.forEach((line, index) => write(index === 0 ? head + line : indent + line));
    if (item.fix) tip(item.fix);
  }
}

function startSpinner(label) {
  spinnerFrame = 0;
  if (!tty) return; // final row is printed by stopSpinner only
  const tick = () => {
    const frame = SPINNER[spinnerFrame++ % SPINNER.length];
    output.write(`\r\x1b[2K  ${c.accent}${frame}${c.reset}  ${label.padEnd(14, ' ')}${c.soft}working${c.reset}`);
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

/**
 * Install and build the desk when its lockfile or sources changed.
 * Returns false when the desk cannot be prepared. There is no second desk to open.
 */
function prepareDesk() {
  const fail = (detail, fix) => {
    row('desk', 'bad', detail);
    note('Studio needs the desk in kit/studio', fix);
    return false;
  };
  if (!existsSync(join(DESK_DIR, 'package.json'))) {
    return fail('kit/studio missing', 'Re-clone the repository');
  }
  if (!depsFresh(DESK_DIR)) {
    startSpinner('desk');
    const installed = installDesk(DESK_DIR);
    if (!installed.ok) {
      stopSpinner('desk', 'bad', 'npm ci failed');
      if (installed.detail) writeErr(`${c.soft}${installed.detail}${c.reset}`);
      return fail('packages missing', `From kit/studio/:  ${c.bold}npm ci${c.reset}  then run ./studio again`);
    }
    clearSpinner();
  }
  if (dev) {
    row('desk', 'ok', 'Vite dev server');
    return true;
  }
  if (buildFresh(DESK_DIR)) {
    row('desk', 'ok', 'ready');
    return true;
  }
  startSpinner('desk');
  const built = buildDesk(DESK_DIR);
  if (!built.ok) {
    stopSpinner('desk', 'bad', 'build failed');
    if (built.detail) writeErr(`${c.soft}${built.detail}${c.reset}`);
    return fail('build failed', `From kit/studio/:  ${c.bold}npm run build${c.reset}  to see the error`);
  }
  stopSpinner('desk', 'ok', 'built');
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
      audioDetail = { label: 'Audio', value: 'no .env', tone: 'warn' };
      return true;
    }
    copyFileSync(join(KIT, '.env.example'), join(KIT, '.env'));
    row('env', 'ok', 'created kit/.env');
    audioDetail = { label: 'Audio', value: 'no API key', tone: 'warn' };
    note('Add ELEVENLABS_API_KEY for voice, music, and Regenerate', 'edit kit/.env  ·  or set WALKTHROUGH_AUDIO_STUB=1');
    return true;
  }
  if (st.keyed) {
    row('env', 'ok', 'ElevenLabs key set');
    audioDetail = { label: 'Audio', value: 'ElevenLabs key', tone: 'ok' };
  } else if (st.stub) {
    row('env', 'ok', 'audio stub on');
    audioDetail = { label: 'Audio', value: 'stub on', tone: 'ok' };
  } else {
    row('env', 'warn', 'no API key');
    audioDetail = { label: 'Audio', value: 'no API key', tone: 'warn' };
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

function clearSpinner() {
  if (!spinnerTimer) return;
  clearInterval(spinnerTimer);
  spinnerTimer = null;
  if (tty) output.write('\r\x1b[2K');
}

async function launch() {
  await launchStudio({
    port,
    uiPort,
    studioDir: DESK_DIR,
    dev,
    noOpen,
    openSlug,
    theme: c,
    kit: KIT,
    nodePath: process.execPath,
    startedAt,
    getAgentCheck: () => agentCheck,
    getAudioDetail: () => audioDetail,
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
  });
}

async function main() {
  if (legacy) {
    write(`${c.bad}The classic desk was removed in 1.0.0-beta.7.${c.reset}`);
    write(`Run ${c.bold}./studio${c.reset}`);
    process.exit(1);
  }
  // Help
  if (help) {
    write(`
${studioBanner({ theme: c, version: VERSION, columns: output.columns || 80 })}

  ${c.bold}./studio${c.reset}                       check, install if needed, open Studio
  ${c.bold}./studio${c.reset} <slug>               open a project
  ${c.bold}./studio${c.reset} --port 4750          use another port
  ${c.bold}./studio${c.reset} --no-open            start without opening a browser
  ${c.bold}./studio${c.reset} --dev                live log, desk hot reload, server restart
  ${c.bold}./studio${c.reset} --dev --ui-port 4758 dev desk on another port
  ${c.bold}./studio${c.reset} --v2                 same as ./studio (kept so older notes still work)

${c.soft}Studio serves the desk on --port (default 4747). ./studio installs the desk's${c.reset}
${c.soft}packages and rebuilds it whenever kit/studio changes, so a git pull is enough.${c.reset}

${c.soft}Dev mode prints the server log and runs the desk on Vite (--ui-port, default 4748)${c.reset}
${c.soft}with hot reload. Saving kit/lib or kit/cli.mjs restarts the server.${c.reset}
${c.soft}Restart ./studio after changing scripts/studio.mjs.${c.reset}

${c.soft}Requires Node 20+, npm 11.17+, ffmpeg/ffprobe. Checks Cursor CLI and Claude Code for agent jobs.${c.reset}
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

  if (!prepareDesk()) {
    footerFail([`From kit/studio/:  ${c.bold}npm ci && npm run build${c.reset}`]);
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
