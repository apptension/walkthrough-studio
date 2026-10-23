import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test } from 'vitest';

import { planAsk } from './ask';
import { applyJobAnswer, parseJobQuestion } from './jobQuestion';

test('a job email prompt stays up across a later toast', () => {
  const pending = { job: true, kind: 'prompt' };
  const toast = planAsk({ pending, incoming: { toast: true } });
  assert.equal(toast.dismiss, false);
  assert.equal(toast.show, false);
  const other = planAsk({ pending, incoming: { job: false } });
  assert.equal(other.dismiss, false);
  const first = planAsk({ pending: null, incoming: { job: true } });
  assert.equal(first.show, true);
  assert.equal(first.dismiss, false);
});

test('an agent question is detected and a password stays out of the parsed prompt log', () => {
  const email = parseJobQuestion('ask email: Which address should receive the invite?')!;
  assert.equal(email.field, 'email');
  assert.match(email.prompt, /invite/);
  const password = parseJobQuestion('What password should I enter?')!;
  assert.equal(password.field, 'password');
  assert.equal(password.secret, true);
  assert.equal(parseJobQuestion('The dashboard is ready.'), null);
  assert.equal(password.prompt.includes('s3cret'), false);
});

test('cancel stops the job and submit continues it', () => {
  assert.equal(applyJobAnswer({ field: 'email', value: null }).continue, false);
  const submitted = applyJobAnswer({ field: 'email', value: 'ada@example.com' });
  assert.equal(submitted.continue, true);
  assert.equal(submitted.value, 'ada@example.com');
});

test('a password is stored via the env writer and stays out of the log', () => {
  const stored: Record<string, string> = {};
  const result = applyJobAnswer({
    field: 'password',
    value: 's3cret-value',
    store: (pairs) => Object.assign(stored, pairs),
  });
  assert.equal(stored.DEMO_PASSWORD, 's3cret-value');
  assert.equal(result.log.includes('s3cret-value'), false);
  assert.match(result.log, /kit\/\.env/);
});

test('cancel and submit targets are at least 44px', () => {
  const css = readFileSync(join(import.meta.dirname, '../../../studio', 'styles.css'), 'utf8');
  assert.match(css, /\.sheet-dialog\.ask #askCancel,\s*\.sheet-dialog\.ask #askOk\s*\{[^}]*min-width:\s*44px/);
  assert.match(css, /\.sheet-dialog\.ask #askCancel,\s*\.sheet-dialog\.ask #askOk\s*\{[^}]*min-height:\s*44px/);
});
