/** Pause a take when the page is waiting on a person, then reuse that browser session. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SIGN_IN_WORDS = /\bsign[\s-]?in\b|\blog[\s-]?in\b|\blogin\b/i;
const GATE_URL = /sign[\s-]?in|log[\s-]?in|\blogin\b|\/auth\b|\/sso\b|oauth|consent/i;
const SIGN_IN_TIMEOUT_MS = 600000;

/**
 * Is the page a gate only a person can pass? A sign-in word on its own is not enough — marketing
 * navs say "Log in" and Studio's own form says "Sign-in required". The word must come with a
 * visible credential form, or the URL itself must be a sign-in / consent screen.
 */
export function pageNeedsPerson({ text = '', url = '', hasPassword = false, hasCredentialForm = false } = {}) {
  if (/consent|accept cookies/i.test(text)) return true;
  let where = url;
  try {
    const parsed = new URL(url);
    where = `${parsed.host}${parsed.pathname}`;
  } catch {
    /* not a URL — match the raw string */
  }
  if (GATE_URL.test(where)) return true;
  if (SIGN_IN_WORDS.test(text) && (hasPassword || hasCredentialForm)) return true;
  if (/\b(settings|security|account|profile)\b/i.test(`${where} ${text}`)) return false;
  return Boolean(hasPassword);
}

/**
 * Read the gate signals off a live Playwright page. Only visible fields count: a hidden login box
 * (Studio's New video form, a collapsed drawer) is not a wall the author has to climb.
 */
export async function collectPersonSignals(page) {
  const text = await page.locator('body').innerText({ timeout: 1500 }).catch(() => '');
  const signals = await page
    .evaluate(() => {
      const visible = (el) => {
        if (!el || !el.isConnected) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const inputs = [...document.querySelectorAll('input')].filter(visible);
      const hasPassword = inputs.some((i) => i.type === 'password');
      const credential = (i) =>
        i.type === 'password' || i.type === 'email' || /user|email|login/i.test(`${i.name} ${i.id} ${i.autocomplete}`);
      // "Continue" / "Next" cover two-step logins; "Subscribe" / "Search" do not qualify.
      const action = /\bsign[\s-]?in\b|\blog[\s-]?in\b|\blogin\b|\bcontinue\b|\bnext\b|\bsubmit\b/i;
      const hasCredentialForm = inputs.filter(credential).some((input) => {
        const scope = input.closest('form') || document.body;
        return [...scope.querySelectorAll('button, input[type="submit"], [role="button"]')]
          .filter(visible)
          .some((b) => action.test(b.textContent || b.value || b.getAttribute('aria-label') || ''));
      });
      return { hasPassword, hasCredentialForm };
    })
    .catch(() => ({ hasPassword: false, hasCredentialForm: false }));
  return { text, url: page.url(), ...signals };
}

export function signInWaitCopy({ returnsHeadless = true } = {}) {
  const after = returnsHeadless
    ? 'the window closes and the take continues in the background'
    : 'the take continues in this window, so keep the mouse out of it';
  return {
    title: 'This page is waiting for you',
    next: `Finish sign-in or consent in the browser window that just opened. When this page moves on, ${after}. You can also press Continue, or Enter in the terminal. The draft stays as it is. After ${SIGN_IN_TIMEOUT_MS / 60000} minutes with no change the take stops.`,
  };
}

/**
 * Does a take start with a visible browser? Only on request, or for the first take of a
 * sign-in video (no saved session yet). After that the take starts headless and reuses the
 * session; if it has expired, the page is detected as a gate and a window opens for that step.
 */
export function startsHeaded({ flagHeaded = false, flagHeadless = false, loginRequired = false, hasSession = false } = {}) {
  if (flagHeaded) return true;
  if (flagHeadless) return false;
  return Boolean(loginRequired) && !hasSession;
}

/** A headless take cannot accept sign-in. Open a visible browser and pause there. */
export function shouldRelaunchHeaded({ headed = false, needsPerson = false } = {}) {
  return !headed && Boolean(needsPerson);
}

/**
 * The visible browser exists for the person, not for the take. Once they are through, the session
 * is saved and capture restarts headless with it — once. If the page still asks for a person after
 * that (a session the site keeps in memory), the take stays visible rather than bouncing again.
 */
export function shouldReturnHeadless({ handoff = false, round = 0, maxRounds = 1 } = {}) {
  return Boolean(handoff) && round < maxRounds;
}

export function shouldKeepWaiting({ needed, resumeExists, elapsed, timeoutMs = SIGN_IN_TIMEOUT_MS } = {}) {
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
