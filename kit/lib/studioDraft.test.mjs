import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { discardDraft, draftChanges, snapshotSources } from './studio.mjs';

test('smart-scope drafts detect every edited domain and fully restore sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'walkthrough-draft-'));
  const dir = join(root, 'video');
  const out = join(root, 'out');
  const brandDir = join(root, 'brand');
  mkdirSync(dir);
  mkdirSync(out);
  mkdirSync(brandDir);

  const configPath = join(dir, 'video.config.json');
  const narrationPath = join(dir, 'narration.mjs');
  const flowPath = join(dir, 'flow.mjs');
  const brandPath = join(brandDir, 'brand.json');
  const original = {
    config: JSON.stringify({ title: 'Demo', direction: {}, audio: {}, interstitials: [] }, null, 2),
    narration: "export default { intro: 'Hello' };\n",
    flow: "export default async function flow() {}\n",
    brand: JSON.stringify({ name: 'Demo brand' }, null, 2),
  };
  writeFileSync(configPath, original.config);
  writeFileSync(narrationPath, original.narration);
  writeFileSync(flowPath, original.flow);
  writeFileSync(brandPath, original.brand);

  const video = { slug: 'demo', dir, out, configPath, brand: { dir: brandDir } };
  snapshotSources(video);
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        title: 'Demo',
        direction: { motion: { energy: 'calm' } },
        audio: { voice: { settings: { speed: 0.96 } } },
        interstitials: [{ id: 'proof', type: 'stats' }],
      },
      null,
      2
    )
  );
  writeFileSync(narrationPath, "export default { intro: { text: 'Welcome', speed: 0.96 } };\n");
  writeFileSync(flowPath, "export default async function flow({ say }) { await say('Welcome'); }\n");

  const changes = draftChanges(video);
  assert.deepEqual(changes.files.sort(), ['config', 'flow', 'narration']);
  for (const domain of ['script', 'voice', 'timing', 'journey', 'plates', 'brand', 'motion', 'audio']) {
    assert.ok(changes.domains.includes(domain), `expected ${domain}`);
  }

  discardDraft(video);
  assert.equal(readFileSync(configPath, 'utf8'), original.config);
  assert.equal(readFileSync(narrationPath, 'utf8'), original.narration);
  assert.equal(readFileSync(flowPath, 'utf8'), original.flow);
  assert.equal(readFileSync(brandPath, 'utf8'), original.brand);
  rmSync(root, { recursive: true, force: true });
});
