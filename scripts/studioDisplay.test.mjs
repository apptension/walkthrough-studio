import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  box,
  createTheme,
  deskUrl,
  formatCheckRow,
  formatLog,
  frameWidth,
  parseStudioBoot,
  parseViteBoot,
  readyCard,
  stripAnsi,
  studioBanner,
  studioMarkLines,
  visibleWidth,
  wrapAnsi,
} from './studioDisplay.mjs';

const plain = createTheme(false);
const color = createTheme(true);

function rowsOf(frame) {
  return frame.split('\n').map(stripAnsi);
}

function assertFrame(frame, width) {
  const rows = rowsOf(frame);
  assert.ok(rows.length >= 2);
  for (const row of rows) {
    assert.equal(visibleWidth(row), width, JSON.stringify(row));
  }
  assert.equal(rows[0][0], '┌');
  assert.equal(rows.at(-1)[0], '└');
}

test('wrap keeps color on the next line and ignores ansi in the width', () => {
  const wrapped = wrapAnsi('\x1b[32mhello world\x1b[0m', 5);
  assert.deepEqual(wrapped.map(stripAnsi), ['hello', 'world']);
  assert.match(wrapped[1], /^\x1b\[32mworld/);
  assert.ok(wrapped.every((line) => visibleWidth(line) <= 5));
});

test('boxes stay rectangular when a status line is long', () => {
  const frame = box(
    ['Walkthrough Studio', 'videos  1    agent   Cursor ready · Claude needs login'],
    { width: 40, theme: color }
  );
  assertFrame(frame, 40);
  const text = rowsOf(frame).join('\n');
  assert.match(text, /Claude needs login/);
});

test('the ready card gives each fact its own row inside the frame', () => {
  const width = 52;
  const frame = readyCard({
    theme: color,
    width,
    elapsed: '2.4',
    url: 'http://127.0.0.1:4747/',
    browserLine: 'opening browser',
    rows: [
      { label: 'Videos', value: '20' },
      { label: 'Cursor', value: 'ready · agent-login', tone: 'ok' },
      { label: 'Claude', value: 'needs sign-in', tone: 'warn' },
      { label: 'Stop', value: 'Ctrl+C' },
      { label: 'Dev', value: './studio --dev' },
    ],
  });
  assertFrame(frame, width);
  const text = rowsOf(frame).join('\n');
  assert.match(text, /Ready · 2\.4s/);
  assert.match(text, /Cursor\s+ready · agent-login/);
  assert.match(text, /Claude\s+needs sign-in/);
  assert.doesNotMatch(text, /agent\s+Cursor ready · Claude/);
});

test('check rows and logs wrap inside the terminal width', () => {
  const row = formatCheckRow({
    theme: plain,
    columns: 40,
    label: 'npm',
    status: 'warn',
    detail: '9.7.2 need 11.17.0+ for installs and the rest of the sentence',
  });
  for (const line of row.split('\n')) assert.ok(visibleWidth(line) <= 40, line);

  const log = formatLog({
    theme: color,
    columns: 48,
    time: '22:57:01',
    source: 'browser',
    text: 'error  Cannot read properties of undefined while reading the program monitor',
    tone: 'error',
  });
  for (const line of stripAnsi(log).split('\n')) assert.ok(line.length <= 48, line);
  assert.match(stripAnsi(log), /^ {2}22:57:01 {2}browser/);
});

test('frame width tracks the terminal and boot parsing counts videos', () => {
  assert.equal(frameWidth(80), 72);
  assert.equal(frameWidth(40), 40);
  const boot = parseStudioBoot(
    [
      '✓ Walkthrough Studio → http://127.0.0.1:4747/?slug=demo',
      '  agent CLI: ready · Cursor',
      '  videos: one, two · out: /tmp/videos',
    ].join('\n')
  );
  assert.equal(boot.complete, true);
  assert.equal(boot.videoCount, 2);
  assert.match(boot.url, /slug=demo/);
  assert.equal(boot.desk, null);
});

test('boot parsing reads which desk the server chose', () => {
  const lines = (desk) =>
    [
      '✓ Walkthrough Studio → http://127.0.0.1:4747/',
      '  agent CLI: ready · Cursor',
      `  desk: ${desk}`,
      '  videos: one · out: /tmp/videos',
    ].join('\n');
  assert.equal(parseStudioBoot(lines('studio')).desk, 'studio');
  assert.equal(parseStudioBoot(lines('new')).desk, 'studio');
  assert.equal(parseStudioBoot(lines('classic (retiring — the new desk is the default)')).desk, 'legacy');
  assert.equal(parseStudioBoot(lines('studio')).videoCount, 1);
});

test('vite boot parsing and desk URLs', () => {
  const boot = parseViteBoot('  ➜  Local:   http://127.0.0.1:4748/\n  ➜  Network: use --host');
  assert.equal(boot.complete, true);
  assert.equal(boot.url, 'http://127.0.0.1:4748/');
  assert.equal(parseViteBoot('still starting').complete, false);
  assert.equal(deskUrl(4748), 'http://127.0.0.1:4748/');
  assert.equal(deskUrl(4748, 'demo'), 'http://127.0.0.1:4748/?slug=demo');
});

test('block logo and banner stay readable', () => {
  const mark = studioMarkLines(color).map(stripAnsi);
  assert.equal(mark.length, 6);
  assert.match(mark[0], /^█   █ █▀█/);
  assert.match(mark[3], /^█▀▀ ▀█▀/);
  const wide = stripAnsi(
    studioBanner({ theme: color, version: '1.0.0', tags: ['classic'], columns: 80 })
  );
  assert.match(wide, /█▀▀ ▀█▀/);
  assert.match(wide, /classic desk · retiring/);
  assert.match(wide, /1\.0\.0/);
  const narrow = stripAnsi(
    studioBanner({ theme: plain, version: '1.0.0', tags: ['classic'], columns: 36 })
  );
  assert.match(narrow, /Walkthrough Studio/);
  assert.match(stripAnsi(studioBanner({ theme: plain, version: '1.0.0', columns: 80 })), /one-command setup/);
});
