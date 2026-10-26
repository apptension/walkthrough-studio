/** Save a restorable source revision, then update the brief. Credential values never land in the copy. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scrubSecrets } from './shared/briefRevise.js';
import { upsertDotEnv } from './project.mjs';

const KEEP = ['brief.json', 'video.config.json', 'flow.mjs', 'narration.mjs'];

export function revisionDir(video, id) {
  return join(video.dir, 'revisions', id);
}

export function saveSourceRevision(video, { id, secrets = [] } = {}) {
  const stamp = id || new Date().toISOString().replace(/[:.]/g, '-');
  const dir = revisionDir(video, stamp);
  mkdirSync(dir, { recursive: true });
  for (const name of KEEP) {
    const from = join(video.dir, name);
    if (!existsSync(from)) continue;
    const raw = readFileSync(from, 'utf8');
    writeFileSync(join(dir, name), scrubSecrets(raw, secrets));
  }
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ at: new Date().toISOString(), id: stamp }, null, 2) + '\n');
  return { id: stamp, dir };
}

export function applyBriefRevision(video, brief, { secrets = [] } = {}) {
  const safe = JSON.parse(scrubSecrets(JSON.stringify(brief), secrets));
  if (safe.app) delete safe.app.password;
  writeFileSync(join(video.dir, 'brief.json'), JSON.stringify(safe, null, 2) + '\n');
  const cfgPath = join(video.dir, 'video.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.title = safe.title || cfg.title;
  cfg.audience = safe.audience || cfg.audience;
  cfg.purpose = safe.purpose || cfg.purpose;
  cfg.language = safe.language || 'en';
  if (safe.brand?.id) cfg.brand = safe.brand.id;
  cfg.record = { ...(cfg.record || {}), startUrl: safe.app?.startUrl || cfg.record?.startUrl };
  if (safe.app && 'loginRequired' in safe.app) cfg.record.loginRequired = Boolean(safe.app.loginRequired);
  const written = scrubSecrets(JSON.stringify(cfg, null, 2) + '\n', secrets);
  writeFileSync(cfgPath, written);
  return safe;
}

export function storeCredential(video, { email, password } = {}) {
  const prefix = video.slug.replace(/-/g, '_').toUpperCase().replace(/^(\d)/, 'V_$1');
  const pairs = {};
  if (email) pairs[`${prefix}_EMAIL`] = email;
  if (password) pairs[`${prefix}_PASSWORD`] = password;
  if (Object.keys(pairs).length) upsertDotEnv(pairs);
  return Object.keys(pairs);
}
