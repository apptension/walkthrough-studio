/** A job question stays on screen until the author answers it. Passwords never enter the log. */

const FIELD_PROMPT = {
  email: 'What email should this video use?',
  password: 'What password should this video use?',
  confirm: 'Confirm to continue?',
};

/** Detect an email, password, or confirm question in an agent or CLI line. */
export function parseJobQuestion(line) {
  const text = String(line || '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .trim();
  const tagged = text.match(/^(?:[✦·⚙]\s+)?(?:\?\s*)?ask\s+(email|password|confirm)\b[:\s-]*(.*)$/i);
  if (tagged) {
    const field = tagged[1].toLowerCase();
    return { field, prompt: tagged[2].trim() || FIELD_PROMPT[field], secret: field === 'password' };
  }
  const natural = text.match(/^(?:[✦·]\s+)?(.{8,220}\?)$/);
  if (natural && /\b(e-?mail|password)\b/i.test(natural[1]) && /\b(what|which|enter|type|provide|need)\b/i.test(natural[1])) {
    const field = /password/i.test(natural[1]) ? 'password' : 'email';
    return { field, prompt: natural[1].replace(/^[✦·]\s+/, ''), secret: field === 'password' };
  }
  return null;
}

export function applyJobAnswer({ field, value, store } = {}) {
  if (value == null || value === '') return { continue: false, log: 'Question cancelled' };
  if (field === 'password') {
    store?.({ DEMO_PASSWORD: String(value) });
    return { continue: true, log: 'Stored the password in kit/.env' };
  }
  return { continue: true, log: `Answered ${field || 'question'}`, value: String(value) };
}
