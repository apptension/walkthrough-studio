import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { audioMode } from './audio/elevenlabs.mjs';
import { refreshDotEnv } from './dotenv.mjs';
import { narratorKeyNote } from '../studio/narratorNote.js';

test('a key added to the env file is used without a restart, and the shell still wins', () => {
  const previous = process.env.ELEVENLABS_API_KEY;
  const stub = process.env.WALKTHROUGH_AUDIO_STUB;
  const envFile = process.env.WALKTHROUGH_ENV_FILE;
  const dir = mkdtempSync(join(tmpdir(), 'ws-env-'));
  const file = join(dir, '.env');
  writeFileSync(file, '');
  process.env.WALKTHROUGH_ENV_FILE = file;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.WALKTHROUGH_AUDIO_STUB;
  try {
    assert.equal(audioMode(), 'missing-key');
    assert.match(narratorKeyNote('missing-key'), /ELEVENLABS_API_KEY/);
    writeFileSync(file, 'ELEVENLABS_API_KEY=added-while-open\n');
    refreshDotEnv(file, { frozen: new Set() });
    assert.equal(audioMode(), 'live');
    assert.equal(narratorKeyNote('live'), '');

    process.env.ELEVENLABS_API_KEY = 'from-shell';
    writeFileSync(file, 'ELEVENLABS_API_KEY=from-file\n');
    refreshDotEnv(file, { frozen: new Set(['ELEVENLABS_API_KEY']) });
    assert.equal(process.env.ELEVENLABS_API_KEY, 'from-shell');
    assert.equal(audioMode(), 'live');
  } finally {
    if (previous === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previous;
    if (stub === undefined) delete process.env.WALKTHROUGH_AUDIO_STUB;
    else process.env.WALKTHROUGH_AUDIO_STUB = stub;
    if (envFile === undefined) delete process.env.WALKTHROUGH_ENV_FILE;
    else process.env.WALKTHROUGH_ENV_FILE = envFile;
  }
});
