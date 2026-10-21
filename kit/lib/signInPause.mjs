/** Pause a take when the page is waiting on a person, then reuse that browser session. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function pageNeedsPerson({ text = '', url = '', hasPassword = false } = {}) {
  if (hasPassword) return true;
  return /sign in|log in|login|consent|accept cookies/i.test(`${url} ${text}`);
}

export function signInWaitCopy() {
  return {
    title: 'This page is waiting for you',
    next: 'Finish sign-in or consent in the browser, then continue. The draft stays as it is.',
  };
}

export function shouldKeepWaiting({ needed, resumeExists, elapsed, timeoutMs = 600000 } = {}) {
  if (!needed || resumeExists) return false;
  if (elapsed > timeoutMs) return 'timeout';
  return true;
}

export function sessionFile(video) {
  return join(video.dir, 'auth-session.json');
}

export function contextUsesSession(video) {
  return existsSync(sessionFile(video));
}

export function waitFiles(dir) {
  return {
    wait: join(dir, 'sign-in-wait.json'),
    resume: join(dir, 'sign-in-continue'),
  };
}
