/**
 * Apply inline Studio plate-copy edits onto video.config.json.
 * Field paths are relative to the plate root (open / close / interstitial entry):
 *   eyebrow | title | sub | body | tagline | platform
 *   items.0.label | items.0.note | stats.0.value | quotes.1.quote | steps.0.label | bullets.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function parseTitle(value, previous) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim();
  if (Array.isArray(previous)) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.length ? lines : previous;
  }
  return text;
}

function setPath(obj, path, value) {
  const parts = String(path).split('.').filter(Boolean);
  if (!parts.length) throw new Error('Empty field path');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = parts[i + 1];
    const wantArray = /^\d+$/.test(next);
    if (cur[key] == null) cur[key] = wantArray ? [] : {};
    if (typeof cur[key] !== 'object') throw new Error(`Cannot set ${path} — ${parts.slice(0, i + 1).join('.')} is not an object`);
    cur = cur[key];
  }
  const leaf = parts[parts.length - 1];
  if (leaf === 'title') {
    cur[leaf] = parseTitle(value, cur[leaf]);
    return;
  }
  if (/^\d+$/.test(leaf) && Array.isArray(cur)) {
    // bullets.0 → string in array
    cur[Number(leaf)] = String(value ?? '').trim();
    return;
  }
  cur[leaf] = String(value ?? '').trim();
}

/** Resolve the mutable plate object inside a config (mutates config in place). */
export function plateRoot(config, plateId) {
  if (plateId === 'open') {
    if (!config.open) config.open = {};
    return config.open;
  }
  if (plateId === 'close') {
    if (!config.close) config.close = {};
    return config.close;
  }
  const list = config.interstitials || [];
  const it = list.find((x) => x.id === plateId);
  if (!it) throw new Error(`Unknown plate "${plateId}"`);
  return it;
}

/**
 * @param {object} config
 * @param {string} plateId
 * @param {Record<string, string>} fields
 */
export function applyPlateCopyFields(config, plateId, fields) {
  const root = plateRoot(config, plateId);
  const entries = Object.entries(fields || {}).filter(([k, v]) => k && v != null);
  if (!entries.length) return { changed: 0 };

  // Map generic items.* onto the plate's real list key when needed.
  const listKey =
    root.quotes ? 'quotes' : root.stats ? 'stats' : root.logos ? 'logos' : root.steps && plateId !== 'close' ? 'steps' : root.items ? 'items' : null;

  for (const [path, value] of entries) {
    let p = path;
    if (listKey && p.startsWith('items.') && !root.items) {
      p = `${listKey}.${p.slice('items.'.length)}`;
    }
    if (plateId === 'close' && p === 'platform') p = 'tagline';
    if (plateId === 'close' && p === 'tagline') {
      root.tagline = String(value ?? '').trim();
      continue;
    }
    setPath(root, p, value);
  }
  return { changed: entries.length };
}

export function savePlateCopy(video, plateId, fields) {
  const pathCfg = join(video.dir, 'video.config.json');
  const config = JSON.parse(readFileSync(pathCfg, 'utf8'));
  const result = applyPlateCopyFields(config, plateId, fields);
  if (result.changed) {
    writeFileSync(pathCfg, JSON.stringify(config, null, 2) + '\n');
  }
  return { ...result, config };
}
