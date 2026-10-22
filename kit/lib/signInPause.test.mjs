import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import {
  collectPersonSignals,
  contextUsesSession,
  pageNeedsPerson,
  sessionFile,
  shouldKeepWaiting,
  shouldRelaunchHeaded,
  shouldReturnHeadless,
  signInWaitCopy,
  startsHeaded,
} from './signInPause.mjs';

test('a take starts visible only on request or for the first sign-in take', () => {
  assert.equal(startsHeaded({}), false);
  assert.equal(startsHeaded({ flagHeaded: true }), true);
  assert.equal(startsHeaded({ loginRequired: true, hasSession: false }), true);
  assert.equal(startsHeaded({ loginRequired: true, hasSession: true }), false);
  assert.equal(startsHeaded({ loginRequired: true, hasSession: false, flagHeadless: true }), false);
});

test('a login or consent page pauses and names what to do next', () => {
  assert.equal(pageNeedsPerson({ text: 'Sign in to continue', url: 'https://app.test/login' }), true);
  assert.equal(pageNeedsPerson({ text: 'Accept cookies', url: 'https://app.test/' }), true);
  assert.equal(pageNeedsPerson({ hasPassword: true, text: 'Welcome' }), true);
  assert.equal(pageNeedsPerson({ hasPassword: true, text: 'Change your password', url: 'https://app.test/settings/security' }), false);
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

test('a sign-in word alone is not a gate; a credential form or a login URL is', () => {
  // Marketing nav with a "Log in" link, no form to fill.
  assert.equal(pageNeedsPerson({ text: 'Pricing Docs Log in Start free', url: 'https://example.com/' }), false);
  // Words that merely contain the letters.
  assert.equal(pageNeedsPerson({ text: 'Designing a catalog in minutes', url: 'https://example.com/' }), false);
  // Two-step login: email first, no password yet.
  assert.equal(pageNeedsPerson({ text: 'Sign in Email Continue', url: 'https://app.test/', hasCredentialForm: true }), true);
  // Hosted identity providers are recognised by URL even before the form paints.
  assert.equal(pageNeedsPerson({ text: '', url: 'https://accounts.google.com/v3/signin/identifier' }), true);
  assert.equal(pageNeedsPerson({ text: '', url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize' }), true);
  assert.equal(pageNeedsPerson({ text: 'Allow access?', url: 'https://idp.test/consent' }), true);
  // Login page copy that mentions "account" still pauses.
  assert.equal(
    pageNeedsPerson({ text: "Sign in. Don't have an account? Sign up", url: 'https://app.test/', hasPassword: true }),
    true
  );
});

test('the visible browser is for the human step only, then capture goes back to the background', () => {
  assert.equal(shouldReturnHeadless({ handoff: true, round: 0 }), true);
  assert.equal(shouldReturnHeadless({ handoff: true, round: 1 }), false);
  assert.equal(shouldReturnHeadless({ handoff: false, round: 0 }), false);
  assert.match(signInWaitCopy().next, /background/i);
  assert.doesNotMatch(signInWaitCopy({ returnsHeadless: false }).next, /window closes/i);
  assert.match(signInWaitCopy().next, /10 minutes/);
});

test('hidden password fields and newsletter forms do not pause a take', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  // Studio's own New video form: a password field inside a hidden login box.
  await page.setContent(`
    <label><input type="checkbox" /> Sign-in required</label>
    <div hidden><input type="email" name="email" /><input type="password" name="password" /></div>
    <button>Record</button>`);
  let signals = await collectPersonSignals(page);
  assert.equal(signals.hasPassword, false);
  assert.equal(signals.hasCredentialForm, false);
  assert.equal(pageNeedsPerson(signals), false);

  // Marketing page: "Log in" in the nav, newsletter form in the footer.
  await page.setContent(`
    <nav><a href="/login">Log in</a></nav>
    <form><input type="email" name="email" placeholder="you@work.com" /><button>Subscribe</button></form>`);
  signals = await collectPersonSignals(page);
  assert.equal(signals.hasCredentialForm, false);
  assert.equal(pageNeedsPerson(signals), false);

  // Real sign-in pages still pause.
  await page.setContent('<h1>Sign in</h1><form><input type="email" name="email" /><button>Continue</button></form>');
  signals = await collectPersonSignals(page);
  assert.equal(signals.hasCredentialForm, true);
  assert.equal(pageNeedsPerson(signals), true);

  await page.setContent('<h1>Welcome back</h1><input type="password" /><button>Log in</button>');
  signals = await collectPersonSignals(page);
  assert.equal(signals.hasPassword, true);
  assert.equal(pageNeedsPerson(signals), true);
  await browser.close();
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
