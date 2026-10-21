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
    next: 'Finish sign-in or consent in the browser window. Capture continues on its own when this page moves on. You can also press Continue, or Enter in the terminal. The draft stays as it is.',
  };
}

/** A headless take cannot accept sign-in. Open a visible browser and pause there. */
export function shouldRelaunchHeaded({ headed = false, needsPerson = false } = {}) {
  return !headed && Boolean(needsPerson);
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
