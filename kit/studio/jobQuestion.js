/** A job question stays on screen until the author answers it. Passwords never enter the log. */

export function applyJobAnswer({ field, value, store } = {}) {
  if (value == null || value === '') return { continue: false, log: 'Question cancelled' };
  if (field === 'password') {
    store?.({ DEMO_PASSWORD: String(value) });
    return { continue: true, log: 'Stored the password in kit/.env' };
  }
  return { continue: true, log: `Answered ${field || 'question'}`, value: String(value) };
}
