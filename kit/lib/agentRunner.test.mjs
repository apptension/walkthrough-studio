import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { agentAuthStatus, agentPreference, buildPrompt, setAgentPreference } from './agentRunner.mjs';
import { KIT } from './project.mjs';

function restoreAgentPreference(prev) {
  if (prev === 'cursor' || prev === 'claude') {
    setAgentPreference(prev);
    return;
  }
  delete process.env.WALKTHROUGH_AGENT;
  const file = join(KIT, '.env');
  if (!existsSync(file)) return;
  const next = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*WALKTHROUGH_AGENT\s*=/.test(l))
    .join('\n')
    .replace(/\n*$/, '\n');
  writeFileSync(file, next);
}

test('draft and voice prompts write in the video language, and a missing language stays English', () => {
  const video = {
    slug: 'demo',
    dir: '/tmp/walkthrough-language-prompt',
    out: '/tmp/walkthrough-language-prompt',
    config: { language: 'pl', purpose: 'feature' },
    brand: { dir: '/tmp/walkthrough-language-brand', motionBrief: 'motion-brief.md', logo: 'logo.html' },
  };
  const draft = buildPrompt(video, 'draft');
  assert.match(draft, /^Video language: Polish \(pl\)/);
  assert.match(draft, /in Polish/);
  assert.match(buildPrompt(video, 'voice'), /Video language: Polish \(pl\)/);
  assert.match(buildPrompt({ ...video, config: { purpose: 'overview' } }, 'script'), /^Video language: English \(en\)/);
});

test('agentPreference reads WALKTHROUGH_AGENT', () => {
  const prev = process.env.WALKTHROUGH_AGENT;
  try {
    delete process.env.WALKTHROUGH_AGENT;
    assert.equal(agentPreference(), 'auto');
    process.env.WALKTHROUGH_AGENT = 'claude';
    assert.equal(agentPreference(), 'claude');
    process.env.WALKTHROUGH_AGENT = 'cursor';
    assert.equal(agentPreference(), 'cursor');
    process.env.WALKTHROUGH_AGENT = 'nope';
    assert.equal(agentPreference(), 'auto');
  } finally {
    if (prev === undefined) delete process.env.WALKTHROUGH_AGENT;
    else process.env.WALKTHROUGH_AGENT = prev;
  }
});

test('agentAuthStatus reports both runners and an active provider', () => {
  const status = agentAuthStatus();
  assert.ok(status.runners?.cursor);
  assert.ok(status.runners?.claude);
  assert.equal(typeof status.switchable, 'boolean');
  assert.equal(typeof status.tooltip, 'string');
  assert.ok(status.tooltip.length > 0);
  if (status.runners.cursor.available || status.runners.claude.available) {
    assert.ok(status.provider === 'cursor' || status.provider === 'claude');
    assert.ok(status.active?.provider === status.provider);
  }
});

test('setAgentPreference pins WALKTHROUGH_AGENT and updates active provider when both exist', () => {
  const prev = process.env.WALKTHROUGH_AGENT;
  const before = agentAuthStatus();
  if (!before.switchable) {
    assert.ok(true, 'skip — both agents not installed in this environment');
    return;
  }
  try {
    const next = before.provider === 'cursor' ? 'claude' : 'cursor';
    const status = setAgentPreference(next);
    assert.equal(process.env.WALKTHROUGH_AGENT, next);
    assert.equal(status.preference, next);
    assert.equal(status.provider, next);
  } finally {
    restoreAgentPreference(prev);
  }
});
