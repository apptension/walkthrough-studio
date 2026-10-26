/** A job question stays on screen until the author answers it. Passwords never enter the log. */

import { asText } from './text';

export type JobQuestionField = 'email' | 'password' | 'confirm';

export interface JobQuestion {
  field: JobQuestionField;
  prompt: string;
  secret: boolean;
}

const FIELD_PROMPT: Record<JobQuestionField, string> = {
  email: 'What email should this video use?',
  password: 'What password should this video use?',
  confirm: 'Confirm to continue?',
};

/** Detect an email, password, or confirm question in an agent or CLI line. */
export function parseJobQuestion(line: unknown): JobQuestion | null {
  const text = asText(line || '')
    // eslint-disable-next-line no-control-regex -- strips ANSI colour escapes from CLI output, as legacy does
    .replace(/\x1b\[[0-9;]*m/g, '')
    .trim();
  const tagged = text.match(/^(?:[✦·⚙]\s+)?(?:\?\s*)?ask\s+(email|password|confirm)\b[:\s-]*(.*)$/i);
  if (tagged) {
    const field = (tagged[1] ?? '').toLowerCase() as JobQuestionField;
    return { field, prompt: (tagged[2] ?? '').trim() || FIELD_PROMPT[field], secret: field === 'password' };
  }
  const natural = text.match(/^(?:[✦·]\s+)?(.{8,220}\?)$/);
  const question = natural?.[1];
  if (question && /\b(e-?mail|password)\b/i.test(question) && /\b(what|which|enter|type|provide|need)\b/i.test(question)) {
    const field = /password/i.test(question) ? 'password' : 'email';
    return { field, prompt: question.replace(/^[✦·]\s+/, ''), secret: field === 'password' };
  }
  return null;
}

export interface JobAnswerInput {
  field?: string;
  value?: unknown;
  store?: (pairs: Record<string, string>) => unknown;
}

export interface JobAnswerResult {
  continue: boolean;
  log: string;
  value?: string;
}

export function applyJobAnswer({ field, value, store }: JobAnswerInput = {}): JobAnswerResult {
  if (value == null || value === '') return { continue: false, log: 'Question cancelled' };
  if (field === 'password') {
    store?.({ DEMO_PASSWORD: asText(value) });
    return { continue: true, log: 'Stored the password in kit/.env' };
  }
  return { continue: true, log: `Answered ${field || 'question'}`, value: asText(value) };
}
