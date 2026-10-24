import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { agentModel, clearModelCache, listAgentModels, MODEL_ENV, modelArgs, modelFamily, parseCursorModels } from './agentModels.mjs';

const LIST = `Available models

auto - Auto (current, default)
gpt-5.3-codex - Codex 5.3
claude-opus-5-5-high - Claude Opus 5.5 1M High
grok-4.7-low-fast - Grok 4.7  Low Fast\u200b\u200b
composer-2.5 - Composer 2.5
`;

test('parseCursorModels reads id/label pairs and maps auto to the default entry', () => {
  const models = parseCursorModels(LIST);
  assert.deepEqual(models.map((m) => m.id), ['', 'gpt-5.3-codex', 'claude-opus-5-5-high', 'grok-4.7-low-fast', 'composer-2.5']);
  assert.equal(models[0].label, 'Auto');
  assert.equal(models[3].label, 'Grok 4.7 Low Fast');
  assert.equal(models[2].family, 'claude');
  assert.equal(models[1].family, 'gpt');
});

test('parseCursorModels keeps a default entry when the CLI prints nothing usable', () => {
  assert.deepEqual(parseCursorModels('error: not logged in').map((m) => m.id), ['']);
});

test('agentModel treats empty, auto and default as the CLI default and rejects unsafe ids', () => {
  const key = MODEL_ENV.cursor;
  const prev = process.env[key];
  try {
    for (const v of ['', 'auto', 'Default']) {
      process.env[key] = v;
      assert.equal(agentModel('cursor'), null);
      assert.deepEqual(modelArgs('cursor'), []);
    }
    process.env[key] = 'claude-opus-4-8[effort=high]';
    assert.deepEqual(modelArgs('cursor'), ['--model', 'claude-opus-4-8[effort=high]']);
    process.env[key] = '$(rm -rf ~)';
    assert.equal(agentModel('cursor'), null);
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
});

test('listAgentModels caches the Cursor list, shares in-flight calls and appends a saved custom id', async () => {
  clearModelCache();
  const key = MODEL_ENV.cursor;
  const prev = process.env[key];
  process.env[key] = 'my-private-model';
  let calls = 0;
  const run = async () => {
    calls += 1;
    return { code: 0, stdout: LIST, stderr: '' };
  };
  try {
    const [a, b] = await Promise.all([
      listAgentModels('cursor', { bin: '/x/agent', run }),
      listAgentModels('cursor', { bin: '/x/agent', run }),
    ]);
    assert.equal(calls, 1);
    assert.equal(a.source, 'cli');
    assert.equal(a.current, 'my-private-model');
    assert.equal(a.models.at(-1).custom, true);
    assert.equal(b.models.length, a.models.length);
    await listAgentModels('cursor', { bin: '/x/agent', run });
    assert.equal(calls, 1);
    await listAgentModels('cursor', { bin: '/x/agent', run, refresh: true });
    assert.equal(calls, 2);
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
    clearModelCache();
  }
});

test('listAgentModels falls back and reports the CLI error', async () => {
  clearModelCache();
  const r = await listAgentModels('cursor', { bin: '/y/agent', run: async () => ({ code: 1, stdout: '', stderr: 'Authentication required' }) });
  assert.equal(r.source, 'fallback');
  assert.equal(r.error, 'Authentication required');
  assert.deepEqual(r.models.map((m) => m.id), ['']);
  clearModelCache();
});

test('Claude gets its aliases without spawning anything', async () => {
  const r = await listAgentModels('claude', { run: () => assert.fail('no spawn for claude') });
  assert.deepEqual(r.models.map((m) => m.id), ['', 'opus', 'sonnet', 'haiku', 'opusplan']);
});

test('modelFamily groups common ids', () => {
  assert.equal(modelFamily('gemini-3.7-flash-high'), 'gemini');
  assert.equal(modelFamily('cursor-grok-4.6-high'), 'grok');
  assert.equal(modelFamily('sonnet'), 'claude');
  assert.equal(modelFamily(''), 'default');
});

test('setAgentModel writes kit/.env through upsertDotEnv', async () => {
  const { upsertDotEnv } = await import('./project.mjs');
  const file = join(mkdtempSync(join(tmpdir(), 'wt-model-')), '.env');
  const prev = process.env[MODEL_ENV.claude];
  try {
    upsertDotEnv({ [MODEL_ENV.claude]: 'opus' }, file);
    assert.match(readFileSync(file, 'utf8'), /WALKTHROUGH_AGENT_MODEL_CLAUDE=opus/);
    assert.equal(agentModel('claude'), 'opus');
  } finally {
    if (prev === undefined) delete process.env[MODEL_ENV.claude];
    else process.env[MODEL_ENV.claude] = prev;
  }
});
