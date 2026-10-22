/**
 * Off-camera sign-in for record + explore.
 * Prefer a saved Playwright storageState; if the page still needs a person and demo
 * credentials exist, fill them before screencast so password pixels never enter live.mp4.
 */
import { existsSync } from 'node:fs';
import {
  collectPersonSignals,
  pageNeedsPerson,
  sessionFile,
} from './signInPause.mjs';

/**
 * Fill demo email/password on a visible login form. Never call this after screencast starts.
 * @returns {{ ok: boolean, reason?: string }}
 */
export async function tryCredentialSignIn(page, video, say = () => {}) {
  const email = video.config.env?.email;
  const password = video.config.env?.password;
  if (!email || !password) {
    say('No demo credentials in env — cannot auto sign-in');
    return { ok: false, reason: 'no-credentials' };
  }
  const pwd = page.locator('input[type="password"]').first();
  if (!(await pwd.isVisible({ timeout: 3500 }).catch(() => false))) {
    return { ok: false, reason: 'no-login-form' };
  }
  say('Signing in with saved demo credentials (off camera)');
  const emailLoc = page
    .locator(
      'input[type="email"], input[name*="email" i], input[autocomplete="username"], input[autocomplete="email"], input[type="text"]'
    )
    .first();
  if (await emailLoc.isVisible({ timeout: 2000 }).catch(() => false)) {
    await emailLoc.fill(String(email));
  }
  await pwd.fill(String(password));
  const submit = page
    .getByRole('button', { name: /log\s*in|sign\s*in|continue|submit|zaloguj|anmelden/i })
    .first();
  if (await submit.isVisible({ timeout: 2000 }).catch(() => false)) {
    await submit.click({ timeout: 10000 }).catch(() => pwd.press('Enter'));
  } else {
    await pwd.press('Enter');
  }
  await page.waitForTimeout(2800);
  // Soft dismiss common cookie walls that appear after login.
  const cookie = page.getByRole('button', { name: /allow all|accept all|agree|akceptuj|zgadzam|zustimmen/i }).first();
  if (await cookie.isVisible({ timeout: 1500 }).catch(() => false)) {
    await cookie.click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
  }
  const stillPwd = await pwd.isVisible({ timeout: 800 }).catch(() => false);
  if (stillPwd) {
    say('Saved credentials did not clear the login form');
    return { ok: false, reason: 'still-on-login' };
  }
  return { ok: true };
}

export async function pageStillNeedsPerson(page) {
  const signals = await collectPersonSignals(page);
  return pageNeedsPerson(signals);
}

/**
 * After goto: if a gate is up, try credentials (when present), then persist storageState.
 * Returns whether the page still needs a human (SSO / MFA / missing secrets).
 */
export async function ensureSignedInOffCamera(page, context, video, { say = console.log } = {}) {
  const loginWanted = Boolean(
    video.config.record?.loginRequired || video.config.env?.email || video.config.env?.password
  );
  if (!loginWanted && !(await pageStillNeedsPerson(page))) {
    return { signedIn: !!(existsSync(sessionFile(video))), needsPerson: false, via: 'none' };
  }

  let needsPerson = await pageStillNeedsPerson(page);
  if (!needsPerson) {
    await context.storageState({ path: sessionFile(video) }).catch(() => {});
    return { signedIn: true, needsPerson: false, via: 'session-or-open' };
  }

  const attempt = await tryCredentialSignIn(page, video, say);
  if (attempt.ok) {
    await page.waitForTimeout(800);
    needsPerson = await pageStillNeedsPerson(page);
    await context.storageState({ path: sessionFile(video) }).catch(() => {});
    if (!needsPerson) {
      say('Signed in off camera — session saved for this project');
      return { signedIn: true, needsPerson: false, via: 'credentials' };
    }
  }

  // Gate remains (SSO, MFA, bad password, or no credentials).
  return {
    signedIn: false,
    needsPerson: true,
    via: attempt.reason || 'gate',
  };
}
