import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Keys the shell set to a real value before this process read kit/.env. Those keep winning. */
const frozenShell = new Set(
  Object.entries(process.env)
    .filter(([, value]) => value)
    .map(([key]) => key)
);

function envFile(file) {
  return file || process.env.WALKTHROUGH_ENV_FILE || join(KIT, '.env');
}

function parseEnvFile(file) {
  if (!existsSync(file)) return {};
  const loaded = {};
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    loaded[key] = value;
  }
  return loaded;
}

/** First read at process start. Does not replace a key the shell already set. */
export function loadDotEnv(file) {
  const loaded = parseEnvFile(envFile(file));
  for (const [key, value] of Object.entries(loaded)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return loaded;
}

/**
 * Re-read kit/.env before Speak or music compose.
 * A key that was empty can arrive from the file without a restart.
 * A key the shell already set stays as the shell left it.
 */
export function refreshDotEnv(file, { frozen = frozenShell } = {}) {
  const loaded = parseEnvFile(envFile(file));
  for (const [key, value] of Object.entries(loaded)) {
    if (frozen.has(key)) continue;
    if (value) process.env[key] = value;
  }
  return loaded;
}
