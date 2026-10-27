#!/usr/bin/env node
/**
 * Round corners on README marketing stills (PNG with transparency).
 * Usage: node scripts/polish-readme-assets.mjs [file…]
 * With no args, polishes all desk/plate/feature/composite stills in docs/assets/.
 */
import { chromium } from '../kit/node_modules/playwright/index.mjs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { roundInPlace } from './lib/readme-round.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/assets');

const AUTO =
  /^(desk-|plate-|brief|hero|agent-ready|languages|video-kinds|ways-in|social-preview|feature-|studio-hero).*\.(png|jpe?g)$/i;

const files =
  process.argv.length > 2
    ? process.argv.slice(2).map((f) => path.resolve(f))
    : readdirSync(OUT)
        .filter((n) => AUTO.test(n))
        .map((n) => path.join(OUT, n));

if (!files.length) {
  console.log('nothing to polish');
  process.exit(0);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('about:blank');

for (const file of files) {
  const out = await roundInPlace(page, file);
  console.log('rounded', path.basename(out));
}

await browser.close();
console.log('DONE', files.length, 'files');
