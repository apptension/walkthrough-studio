import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import {
  contextUsesSession,
  pageNeedsPerson,
  sessionFile,
  shouldKeepWaiting,
  shouldRelaunchHeaded,
  signInWaitCopy,
} from './signInPause.mjs';

test('a login or consent page pauses and names what to do next', () => {
  assert.equal(pageNeedsPerson({ text: 'Sign in to continue', url: 'https://app.test/login' }), true);
  assert.equal(pageNeedsPerson({ text: 'Accept cookies', url: 'https://app.test/' }), true);
  assert.equal(pageNeedsPerson({ hasPassword: true, text: 'Welcome' }), true);
  assert.equal(pageNeedsPerson({ text: 'Dashboard ready', url: 'https://app.test/home' }), false);
  assert.equal(shouldKeepWaiting({ needed: true, resumeExists: false, elapsed: 10 }), true);
  assert.equal(shouldKeepWaiting({ needed: true, resumeExists: true, elapsed: 10 }), false);
  assert.equal(shouldKeepWaiting({ needed: true, resumeExists: false, elapsed: 50, timeoutMs: 40 }), 'timeout');
  const copy = signInWaitCopy();
  assert.match(copy.next, /continue/i);
  assert.match(copy.next, /draft/i);
  assert.match(copy.next, /Enter/);
  assert.equal(shouldRelaunchHeaded({ headed: false, needsPerson: true }), true);
  assert.equal(shouldRelaunchHeaded({ headed: true, needsPerson: true }), false);
  assert.equal(shouldRelaunchHeaded({ headed: false, needsPerson: false }), false);
  assert.equal(shouldKeepWaiting({ needed: true, resumeExists: true, elapsed: 10 }), false);
});

test('pause, resume, and a second record already signed in', async () => {
  const browser = await chromium.launch({ headless: true });
  const first = await browser.newContext();
  const page = await first.newPage();
  await page.setContent('<h1>Sign in</h1><input type="password" />');
  assert.equal(pageNeedsPerson({ text: await page.locator('body').innerText(), hasPassword: true }), true);
  await first.addCookies([{ name: 'session', value: 'signed-in', url: 'http://localhost' }]);
  const dir = mkdtempSync(join(tmpdir(), 'ws-session-'));
  const video = { dir };
  const saved = sessionFile(video);
  await first.storageState({ path: saved });
  const raw = readFileSync(saved, 'utf8');
  assert.equal(raw.includes('password'), false);
  assert.equal(contextUsesSession(video), true);
  const second = await browser.newContext({ storageState: saved });
  const cookies = await second.cookies('http://localhost');
  assert.equal(cookies.some((cookie) => cookie.name === 'session' && cookie.value === 'signed-in'), true);
  const config = JSON.stringify({ record: { startUrl: 'http://localhost' } });
  assert.equal(config.includes('signed-in'), false);
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
});
