import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildPrompt, enrichAfterDraft } from './agentRunner.mjs';

const fakeVideo = (dir, config = {}) => ({
  slug: 'variety-demo',
  dir,
  out: join(dir, 'out'),
  config: { purpose: 'launch', ...config },
  brand: { dir, motionBrief: 'motion-brief.md', logo: 'logo.html', motion: { energy: 'clear' } },
});

test('draft and plates prompts carry the layout catalog and the rhythm', () => {
  const video = fakeVideo('/tmp/walkthrough-variety-prompt');
  for (const goal of ['draft', 'plates']) {
    const prompt = buildPrompt(video, goal);
    assert.match(prompt, /open\.layout — classic/, goal);
    assert.match(prompt, /features interstitial\.layout — grid/, goal);
    assert.match(prompt, /Never repeat a layout/, goal);
    assert.match(prompt, /one camera accent every ~\d+ s/, goal);
    assert.match(prompt, /ctx\.magnify/, goal);
  }
});

test('enrichAfterDraft fills open choices once, writes the report and never fails the job', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-variety-'));
  try {
    const config = {
      title: 'Acme launch',
      purpose: 'launch',
      open: { title: ['Ship *faster*', 'with Acme'], layout: 'kinetic' },
      close: { title: ['Ready?'], steps: [{ label: 'One' }, { label: 'Two' }] },
      interstitials: [
        { id: 'proof', type: 'features', before: 'A', items: [] },
        { id: 'nums', type: 'stats', before: 'B', stats: [] },
      ],
    };
    writeFileSync(join(dir, 'video.config.json'), JSON.stringify(config, null, 2));
    writeFileSync(join(dir, 'flow.mjs'), "await chapter('A');\nawait wait(60000);\n");
    const job = { log: [] };
    assert.equal(enrichAfterDraft(fakeVideo(dir, config), job), '');
    const next = JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8'));
    assert.equal(next.open.layout, 'kinetic', 'the agent pick stays');
    assert.ok(next.close.layout);
    assert.ok(next.interstitials.every((i) => i.layout));
    assert.ok(next.direction.camera.zoom);
    assert.match(readFileSync(join(dir, 'out', 'draft-rhythm.md'), 'utf8'), /accent/);
    const line = (j, prefix) => j.log.find((l) => l.line.startsWith(prefix))?.line || '';
    assert.match(line(job, '✓ variety'), /^✓ variety · \d+ open choice\(s\) filled · \d+ rhythm note/);
    assert.match(line(job, '✓ sound'), /^✓ sound · energetic, confident, bright · narrator \w+ · .+ at \d+ BPM/);
    assert.ok(next.tone.words.length, 'the tone is written onto the video');
    assert.ok(next.audio.voice.voiceId && next.audio.music.styles.length);
    assert.match(readFileSync(join(dir, 'out', 'draft-sound.md'), 'utf8'), /Narrator: /);

    const again = { log: [] };
    enrichAfterDraft(fakeVideo(dir, next), again);
    assert.match(line(again, '✓ variety'), /nothing left open/);

    writeFileSync(join(dir, 'video.config.json'), '{ broken');
    const broken = { log: [] };
    assert.equal(enrichAfterDraft(fakeVideo(dir), broken), '');
    assert.match(broken.log.at(-1).line, /^⚠ variety · skipped/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
