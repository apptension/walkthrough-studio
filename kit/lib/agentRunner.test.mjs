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

test('writing prompts share the video’s tone, and the draft chooses the narrator and the bed', () => {
  const video = {
    slug: 'demo',
    dir: '/tmp/walkthrough-tone-prompt',
    out: '/tmp/walkthrough-tone-prompt',
    config: { purpose: 'onboarding', tone: { words: ['warm', 'patient'], persona: 'a patient coach', do: [], avoid: [] } },
    brand: { dir: '/tmp/walkthrough-tone-brand', motionBrief: 'motion-brief.md', logo: 'logo.html' },
  };
  const draft = buildPrompt(video, 'draft');
  assert.match(draft, /Voice and tone — warm, patient/);
  assert.match(draft, /Speak as a patient coach/);
  assert.match(draft, /audio\.voice: \{ "name", "voiceId"/);
  assert.match(draft, /Brian nPczCjzI2devNBz1zQrb/);
  assert.match(draft, /negativeStyles/);
  for (const goal of ['script', 'plates', 'narration', 'take-recraft']) assert.match(buildPrompt(video, goal), /Voice and tone — warm, patient/, goal);
  assert.match(buildPrompt(video, 'voice'), /Sound — narrator and music bed/);
  assert.doesNotMatch(buildPrompt(video, 'explore'), /Voice and tone/);
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

test('a shown tour drives the draft; guided-script and take-recraft name their sources and limits', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'wt-guided-prompt-'));
  try {
    const video = {
      slug: 'demo',
      dir,
      out: join(dir, 'out'),
      config: { purpose: 'overview' },
      brand: { dir: join(dir, 'brand'), motionBrief: 'motion-brief.md', logo: 'logo.html' },
    };
    assert.doesNotMatch(buildPrompt(video, 'draft'), /SHOWED this tour/);
    writeFileSync(join(dir, 'guided-tour.json'), '{}');
    const draft = buildPrompt(video, 'draft');
    assert.match(draft, /SHOWED this tour/);
    assert.match(draft, /guided-flow\.mjs/);
    assert.match(draft, /drop detours/);
    const script = buildPrompt(video, 'guided-script');
    assert.match(script, /guided-tour\.md/);
    assert.match(script, /interstitials\[\]\.before/);
    assert.match(script, /Do not record/);
    assert.match(script, /ctx\.near\(locator/, 'duplicates resolve to the element the reviewer used');
    assert.match(script, /Every step the reviewer performed is required/);
    assert.doesNotMatch(script, /Guard optional UI with isVisible/, 'no blanket guard that lets a shown step skip silently');
    assert.match(draft, /never steps the reviewer showed/);
    const recraft = buildPrompt(video, 'take-recraft');
    assert.match(recraft, /timeline\.json/);
    assert.match(recraft, /Never edit .*flow\.mjs/);
    const own = buildPrompt(video, 'own-take');
    assert.match(own, /keyed EXACTLY by the chapter labels/);
    assert.match(own, /capture\.cuts/);
    assert.match(own, /Never edit .*flow\.mjs.*timeline\.json/);
    assert.match(own, /Recording device:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('script-writing prompts carry the generated ctx contract and the self-check command', () => {
  const video = {
    slug: 'demo',
    dir: '/tmp/walkthrough-contract-prompt',
    out: '/tmp/walkthrough-contract-prompt',
    config: { purpose: 'overview' },
    brand: { dir: '/tmp/walkthrough-contract-brand', motionBrief: 'motion-brief.md', logo: 'logo.html' },
  };
  for (const goal of ['draft', 'branch', 'guided-script', 'capture-repair']) {
    const prompt = buildPrompt(video, goal);
    assert.match(prompt, /these are the ONLY ctx members/, goal);
    assert.match(prompt, /typeInto\(locator, value/, goal);
    assert.match(prompt, /optional\(label/, goal);
    assert.match(prompt, /cli\.mjs check-flow demo/, goal);
  }
  assert.doesNotMatch(buildPrompt(video, 'narration'), /ONLY ctx members/);
});

test('agent prompts name the recording device and the video shape', async () => {
  const { deviceLine } = await import('./agentRunner.mjs');
  const desk = deviceLine({});
  assert.match(desk, /Desktop · 1920×1080 CSS px/);
  assert.doesNotMatch(desk, /MOBILE layout/);
  const phone = deviceLine({ record: { viewport: { width: 390, height: 844 }, device: { preset: 'iphone-15' } }, output: { format: 'portrait' } });
  assert.match(phone, /iPhone · 390×844 CSS px @3x, mobile, touch/);
  assert.match(phone, /MOBILE layout/);
  assert.match(phone, /vertical 1080×1920 video/);
  assert.match(phone, /tall frame/);
});
