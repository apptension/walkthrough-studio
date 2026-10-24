/**
 * Which model each agent runner uses. The choice lives in kit/.env
 * (`WALKTHROUGH_AGENT_MODEL_CURSOR` / `WALKTHROUGH_AGENT_MODEL_CLAUDE`) so every job, session and
 * machine-local Studio restart keeps it. An empty value means "the CLI's own default".
 * Cursor lists its models via `agent --list-models`; Claude Code has no listing command, so it
 * gets its documented aliases (each resolves to the latest model of that tier).
 */
import { spawn } from 'node:child_process';
import { upsertDotEnv } from './project.mjs';

export const MODEL_ENV = {
  cursor: 'WALKTHROUGH_AGENT_MODEL_CURSOR',
  claude: 'WALKTHROUGH_AGENT_MODEL_CLAUDE',
};

const DEFAULT_IDS = new Set(['', 'auto', 'default']);
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@\-[\]=,]{0,159}$/;
const LIST_TTL_MS = 10 * 60 * 1000;
const LIST_TIMEOUT_MS = 20_000;

export const CLAUDE_MODELS = [
  { id: '', label: 'Default', family: 'default', note: 'Claude Code’s account default' },
  { id: 'opus', label: 'Opus', family: 'claude', note: 'Latest Opus · deepest reasoning' },
  { id: 'sonnet', label: 'Sonnet', family: 'claude', note: 'Latest Sonnet · balanced' },
  { id: 'haiku', label: 'Haiku', family: 'claude', note: 'Latest Haiku · fastest' },
  { id: 'opusplan', label: 'Opus plan · Sonnet build', family: 'claude', note: 'Opus while planning, Sonnet while editing' },
];

const CURSOR_DEFAULT = { id: '', label: 'Auto', family: 'default', note: 'Cursor picks per request' };

function checkProvider(provider) {
  if (!MODEL_ENV[provider]) throw new Error('Agent provider must be "cursor" or "claude"');
  return provider;
}

/** Normalised model id for a runner, or null when the CLI default applies. */
export function agentModel(provider) {
  const key = MODEL_ENV[provider];
  if (!key) return null;
  const v = String(process.env[key] || '').trim();
  return DEFAULT_IDS.has(v.toLowerCase()) || !MODEL_ID_RE.test(v) ? null : v;
}

export function agentModels() {
  return { cursor: agentModel('cursor'), claude: agentModel('claude') };
}

/** Persist a runner's model to kit/.env and the live process; '' / 'auto' / 'default' clear it. */
export function setAgentModel(provider, model) {
  checkProvider(provider);
  const v = String(model ?? '').trim();
  const cleared = DEFAULT_IDS.has(v.toLowerCase());
  if (!cleared && !MODEL_ID_RE.test(v)) throw new Error(`Not a model id: ${v.slice(0, 60)}`);
  upsertDotEnv({ [MODEL_ENV[provider]]: cleared ? '' : v });
  return agentModel(provider);
}

/** `--model <id>` for the runner's CLI, or nothing for its default. */
export function modelArgs(provider) {
  const m = agentModel(provider);
  return m ? ['--model', m] : [];
}

export function modelFamily(id) {
  const s = String(id || '').toLowerCase();
  if (!s || s === 'auto') return 'default';
  if (s.includes('claude') || /^(opus|sonnet|haiku)/.test(s)) return 'claude';
  if (s.startsWith('gpt') || /^o\d/.test(s)) return 'gpt';
  if (s.includes('gemini')) return 'gemini';
  if (s.includes('grok')) return 'grok';
  if (s.includes('composer')) return 'composer';
  return 'other';
}

/** Parse `agent --list-models` ("id - Label" per line). Zero-width noise and "(current)" tags are dropped. */
export function parseCursorModels(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text || '').split('\n')) {
    // eslint-disable-next-line no-control-regex
    const line = raw.replace(/\u001b\[[0-9;]*m/g, '').replace(/[\u200b-\u200d\ufeff]/g, '').trim();
    const m = /^([A-Za-z0-9][\w.:\-[\]=,]*)\s+-\s+(.+)$/.exec(line);
    if (!m) continue;
    const id = m[1];
    const isDefault = /\bdefault\b/i.test(m[2]);
    const label = m[2]
      .replace(/\((?:current|default|current,\s*default)\)/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const key = id.toLowerCase() === 'auto' ? '' : id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key ? { id, label, family: modelFamily(id), ...(isDefault ? { isDefault: true } : {}) } : { ...CURSOR_DEFAULT });
  }
  if (!seen.has('')) out.unshift({ ...CURSOR_DEFAULT });
  return out;
}

const cache = new Map();

function runList(bin, args) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    let child;
    try {
      child = spawn(bin, args, { env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ code: -1, stdout, stderr: err.message });
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      done({ code: -1, stdout, stderr: 'Timed out listing models' });
    }, LIST_TIMEOUT_MS);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => done({ code: -1, stdout, stderr: err.message }));
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

function withCurrent(models, current) {
  if (!current || models.some((m) => m.id === current)) return models;
  return [...models, { id: current, label: current, family: modelFamily(current), custom: true }];
}

/**
 * Models a runner can use, with the saved choice. Cursor's list is cached for ten minutes and
 * concurrent callers share one CLI call; `refresh` busts the cache.
 */
export async function listAgentModels(provider, { bin = null, refresh = false, run = runList } = {}) {
  checkProvider(provider);
  const current = agentModel(provider);
  if (provider === 'claude') {
    return { provider, current, models: withCurrent(CLAUDE_MODELS, current), source: 'aliases', fetchedAt: null };
  }
  if (!bin) {
    return { provider, current, models: withCurrent([{ ...CURSOR_DEFAULT }], current), source: 'fallback', fetchedAt: null, error: 'Cursor CLI not installed' };
  }
  const hit = cache.get(bin);
  const fresh = hit && (hit.pending || Date.now() - hit.at < LIST_TTL_MS);
  if (!fresh || refresh) {
    const pending = run(bin, ['--list-models']).then((r) => {
      const models = parseCursorModels(r.stdout);
      const ok = models.length > 1;
      const entry = ok
        ? { at: Date.now(), models, error: null }
        : { at: 0, models: hit?.models?.length ? hit.models : models, error: (r.stderr || r.stdout || 'Could not list models').trim().split('\n').pop().slice(0, 200) };
      cache.set(bin, entry);
      return entry;
    });
    cache.set(bin, { ...(hit || { at: 0, models: [] }), pending });
  }
  const entry = await (cache.get(bin).pending || cache.get(bin));
  return {
    provider,
    current,
    models: withCurrent(entry.models, current),
    source: entry.error ? 'fallback' : 'cli',
    fetchedAt: entry.at ? new Date(entry.at).toISOString() : null,
    ...(entry.error ? { error: entry.error } : {}),
  };
}

export function clearModelCache() {
  cache.clear();
}
