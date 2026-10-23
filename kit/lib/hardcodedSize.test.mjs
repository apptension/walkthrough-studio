import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const KIT = fileURLToPath(new URL('..', import.meta.url));

/** Files that define sizes, or use the numbers for something other than the frame. */
const ALLOWED = new Map([
  ['lib/format.mjs', 'defines the output frames'],
  ['lib/capturePresets.mjs', 'defines the capture presets'],
  ['lib/exports.mjs', 'social export sizes (square, vertical)'],
  ['lib/mail.mjs', 'Mailcatcher port 1080'],
  ['templates/pricing.html', 'a 1080px max-width layout rule'],
]);
const SKIP_DIRS = new Set(['node_modules', 'tmp', 'icons-v2', '.git']);
const EXT = /\.(mjs|js|html|css)$/;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('tmp-')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (EXT.test(name) && !/\.test\.(mjs|js)$/.test(name)) yield p;
  }
}

/** Code without comments, so prose may still say "1080p". */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

test('no 1920 / 1080 frame literals outside the size definitions', () => {
  const hits = [];
  for (const file of files(KIT)) {
    const rel = relative(KIT, file);
    if (ALLOWED.has(rel)) continue;
    code(readFileSync(file, 'utf8'))
      .split('\n')
      .forEach((line, i) => {
        // CSS custom properties that define the landscape frame are the one place CSS names it.
        if (/--wt-frame-[wh]\s*:/.test(line)) return;
        if (/(?<![\d.])(1920|1080)(?![\d])/.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
  }
  assert.deepEqual(hits, [], `Use outputFrame(config), captureProfile(config) or the take's space instead:\n${hits.join('\n')}`);
});
