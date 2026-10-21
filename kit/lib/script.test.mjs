import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  applyScriptStructure,
  buildScript,
  insertFlowCallAfter,
  moveFlowCall,
  moveFlowCallTo,
  parseFlowCalls,
  removeFlowCallAt,
  replaceFlowCallAt,
  scaffoldPlate,
  setNarrationLine,
} from './script.mjs';

const SAMPLE = `export default async function flow(ctx) {
  const { chapter, say } = ctx;
  await chapter('Meet Studio', 'See who is free', 2400);
  await say('Key capabilities', 'Scheduling and reports.', 2200);
  await chapter('Your dashboard', 'Hours and leave', 2200);
}
`;

describe('flow call surgery', () => {
  it('parses chapter and say calls with indices', () => {
    const calls = parseFlowCalls(SAMPLE);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].kind, 'chapter');
    assert.equal(calls[0].title, 'Meet Studio');
    assert.equal(calls[1].kind, 'step');
    assert.equal(calls[2].index, 2);
  });

  it('replaces title and body in place', () => {
    const next = replaceFlowCallAt(SAMPLE, 0, { title: 'Hello Studio', body: 'Plan with confidence' });
    const calls = parseFlowCalls(next);
    assert.equal(calls[0].title, 'Hello Studio');
    assert.equal(calls[0].body, 'Plan with confidence');
    assert.equal(calls[0].holdMs, 2400);
    assert.match(next, /await chapter\('Hello Studio', 'Plan with confidence', 2400\)/);
  });

  it('inserts a chapter after an index', () => {
    const next = insertFlowCallAfter(SAMPLE, 0, { kind: 'chapter', title: 'Live tour', body: 'Open the app' });
    const calls = parseFlowCalls(next);
    assert.equal(calls.length, 4);
    assert.equal(calls[1].title, 'Live tour');
    assert.equal(calls[0].title, 'Meet Studio');
    assert.equal(calls[2].title, 'Key capabilities');
  });

  it('removes a say call cleanly', () => {
    const next = removeFlowCallAt(SAMPLE, 1);
    const calls = parseFlowCalls(next);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].title, 'Meet Studio');
    assert.equal(calls[1].title, 'Your dashboard');
    assert.doesNotMatch(next, /Key capabilities/);
  });
});

describe('applyScriptStructure', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-script-'));
  const dir = join(root, 'demo');
  after(() => rmSync(root, { recursive: true, force: true }));

  function seed() {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'video.config.json'),
      JSON.stringify(
        {
          title: 'Demo',
          brand: 'acme',
          open: { eyebrow: 'Product', title: ['See the team.'], sub: 'Plan with confidence' },
          close: {
            title: ['Ready.'],
            steps: [
              { label: 'Start', note: 'Dashboard' },
              { label: 'Plan', note: 'Calendar' },
            ],
          },
          interstitials: [{ id: 'features', type: 'features', title: 'Features', before: 'Meet Studio' }],
        },
        null,
        2
      ) + '\n'
    );
    writeFileSync(join(dir, 'flow.mjs'), SAMPLE);
    writeFileSync(
      join(dir, 'narration.mjs'),
      `export default {
  intro: 'Welcome.',
  outro: 'Thanks.',
  plates: { features: 'Here is what you get.' },
  lines: {
    'Meet Studio': 'Meet the product.',
    'Key capabilities': 'Scheduling.',
    'Your dashboard': 'Your week.',
  },
};
`
    );
  }

  it('renames a chapter and updates plate before + narration key', async () => {
    seed();
    const video = { dir, slug: 'demo', config: JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8')) };
    await applyScriptStructure(video, { op: 'call-update', index: 0, title: 'Meet the product' });
    const calls = parseFlowCalls(readFileSync(join(dir, 'flow.mjs'), 'utf8'));
    assert.equal(calls[0].title, 'Meet the product');
    const cfg = JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8'));
    assert.equal(cfg.interstitials[0].before, 'Meet the product');
    const narration = readFileSync(join(dir, 'narration.mjs'), 'utf8');
    assert.match(narration, /'Meet the product'/);
    assert.doesNotMatch(narration, /'Meet Studio'/);
  });

  it('moves a plate before another chapter', async () => {
    seed();
    const video = { dir, slug: 'demo', config: JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8')) };
    await applyScriptStructure(video, { op: 'plate-before', plateId: 'features', before: 'Your dashboard' });
    const cfg = JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8'));
    assert.equal(cfg.interstitials[0].before, 'Your dashboard');
    const script = await buildScript(video);
    const plate = script.scenes.find((s) => s.kind === 'plate');
    assert.equal(plate.before, 'Your dashboard');
  });

  it('adds and removes close steps', async () => {
    seed();
    const video = { dir, slug: 'demo', config: JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8')) };
    await applyScriptStructure(video, { op: 'close-steps', action: 'add', label: 'Share', note: 'Invite the team' });
    let cfg = JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8'));
    assert.equal(cfg.close.steps.length, 3);
    assert.equal(cfg.close.steps[2].label, 'Share');
    await applyScriptStructure(video, { op: 'close-steps', action: 'remove', index: 0 });
    cfg = JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8'));
    assert.equal(cfg.close.steps[0].label, 'Plan');
  });

  it('adds a caption after a chapter', async () => {
    seed();
    const video = { dir, slug: 'demo', config: JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8')) };
    await applyScriptStructure(video, {
      op: 'call-add',
      kind: 'step',
      afterIndex: 0,
      title: 'Scroll the hero',
      body: 'Show the value prop',
    });
    const calls = parseFlowCalls(readFileSync(join(dir, 'flow.mjs'), 'utf8'));
    assert.equal(calls[1].title, 'Scroll the hero');
    assert.equal(calls[1].kind, 'step');
  });

  it('allows clearing open title and serializes concurrent structure writes', async () => {
    seed();
    const video = { dir, slug: 'demo', config: JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8')) };
    await applyScriptStructure(video, { op: 'open', title: '' });
    let cfg = JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8'));
    assert.deepEqual(cfg.open.title, []);
    await Promise.all([
      applyScriptStructure(video, { op: 'open', eyebrow: 'A', title: 'One', sub: 'x' }),
      applyScriptStructure(video, { op: 'open', eyebrow: 'B', title: 'Two', sub: 'y' }),
      applyScriptStructure(video, { op: 'close-steps', action: 'add', label: 'Extra' }),
    ]);
    cfg = JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8'));
    assert.ok(cfg.open.eyebrow === 'A' || cfg.open.eyebrow === 'B');
    assert.ok(cfg.close.steps.some((s) => s.label === 'Extra'));
  });

  it('updates chapter hold and plate copy, and moves calls', async () => {
    seed();
    const video = { dir, slug: 'demo', config: JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8')) };
    await applyScriptStructure(video, { op: 'call-update', index: 0, holdMs: 3600 });
    let calls = parseFlowCalls(readFileSync(join(dir, 'flow.mjs'), 'utf8'));
    assert.equal(calls[0].holdMs, 3600);
    let script = await buildScript(video);
    const chapter = script.scenes.find((s) => s.kind === 'chapter' && s.title === 'Meet Studio');
    assert.equal(chapter.holdSec, 3.6);
    assert.equal(chapter.holdExplicit, true);

    await applyScriptStructure(video, {
      op: 'plate-update',
      plateId: 'features',
      title: 'What you get',
      eyebrow: 'Toolkit',
      sub: 'Plan the week',
    });
    const cfg = JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8'));
    assert.equal(cfg.interstitials[0].title, 'What you get');
    assert.equal(cfg.interstitials[0].eyebrow, 'Toolkit');

    await applyScriptStructure(video, { op: 'call-move', index: 1, delta: 1 });
    calls = parseFlowCalls(readFileSync(join(dir, 'flow.mjs'), 'utf8'));
    assert.equal(calls[1].title, 'Your dashboard');
    assert.equal(calls[2].title, 'Key capabilities');

    await setNarrationLine(video, { kind: 'line', key: 'Meet Studio', speed: 1.1 });
    script = await buildScript({ ...video, config: JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8')) });
    const voiced = script.scenes.find((s) => s.title === 'Meet Studio');
    assert.equal(voiced.narrationSpeed, 1.1);
  });
});

describe('moveFlowCall', () => {
  it('swaps adjacent calls', () => {
    const next = moveFlowCall(SAMPLE, 0, 1);
    const calls = parseFlowCalls(next);
    assert.equal(calls[0].title, 'Key capabilities');
    assert.equal(calls[1].title, 'Meet Studio');
    assert.equal(calls[1].holdMs, 2400);
  });
});

describe('moveFlowCallTo', () => {
  it('moves a call to an absolute index', () => {
    const next = moveFlowCallTo(SAMPLE, 0, 2);
    const calls = parseFlowCalls(next);
    assert.equal(calls[2].title, 'Meet Studio');
    assert.equal(calls[0].title, 'Key capabilities');
  });
});

describe('plate-move among', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-pmove-'));
  const dir = join(root, 'demo');
  after(() => rmSync(root, { recursive: true, force: true }));

  it('reorders plates before the same chapter', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'video.config.json'),
      JSON.stringify(
        {
          title: 'Demo',
          brand: 'acme',
          open: { title: ['Hi'] },
          close: { title: ['Bye'], steps: [] },
          interstitials: [
            { id: 'a', type: 'statement', title: 'A', before: 'Meet Studio' },
            { id: 'b', type: 'statement', title: 'B', before: 'Meet Studio' },
            { id: 'c', type: 'statement', title: 'C', before: 'Your dashboard' },
          ],
        },
        null,
        2
      ) + '\n'
    );
    writeFileSync(join(dir, 'flow.mjs'), SAMPLE);
    writeFileSync(join(dir, 'narration.mjs'), `export default { intro: '', outro: '', plates: {}, lines: {} };\n`);
    const video = { dir, slug: 'demo', config: JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8')) };
    await applyScriptStructure(video, { op: 'plate-move', plateId: 'b', before: 'Meet Studio', among: 0 });
    const cfg = JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8'));
    const meet = cfg.interstitials.filter((p) => p.before === 'Meet Studio').map((p) => p.id);
    assert.deepEqual(meet, ['b', 'a']);
  });
});

describe('plate CRUD', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-plate-'));
  const dir = join(root, 'demo');
  after(() => rmSync(root, { recursive: true, force: true }));

  function seed() {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'video.config.json'),
      JSON.stringify(
        {
          title: 'Demo',
          brand: 'acme',
          open: { title: ['Hi'] },
          close: { title: ['Bye'], steps: [{ label: 'A' }, { label: 'B' }] },
          interstitials: [],
        },
        null,
        2
      ) + '\n'
    );
    writeFileSync(join(dir, 'flow.mjs'), SAMPLE);
    writeFileSync(join(dir, 'narration.mjs'), `export default { intro: '', outro: '', plates: {}, lines: {} };\n`);
  }

  it('scaffolds, adds, edits rows, and removes a plate', async () => {
    seed();
    const video = { dir, slug: 'demo', config: JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8')) };
    const sc = scaffoldPlate('features', { before: 'Meet Studio' });
    assert.equal(sc.type, 'features');
    assert.ok(sc.items.length >= 2);

    await applyScriptStructure(video, { op: 'plate-add', type: 'features', before: 'Meet Studio' });
    let cfg = JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8'));
    assert.equal(cfg.interstitials.length, 1);
    assert.equal(cfg.interstitials[0].type, 'features');
    assert.equal(cfg.interstitials[0].before, 'Meet Studio');

    const id = cfg.interstitials[0].id;
    await applyScriptStructure(video, {
      op: 'plate-update',
      plateId: id,
      title: 'Toolkit',
      rows: [
        { label: 'Plan', note: 'Ahead', icon: 'calendar' },
        { label: 'Ship', note: 'Done', icon: 'spark' },
      ],
    });
    cfg = JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8'));
    assert.equal(cfg.interstitials[0].title, 'Toolkit');
    assert.equal(cfg.interstitials[0].items.length, 2);

    const script = await buildScript({ ...video, config: cfg });
    assert.equal(script.plateTypes.length, 10);
    const plate = script.scenes.find((s) => s.kind === 'plate');
    assert.equal(plate.plate.rows.length, 2);
    assert.equal(plate.editable.remove, true);

    await applyScriptStructure(video, { op: 'plate-remove', plateId: id });
    cfg = JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8'));
    assert.equal(cfg.interstitials.length, 0);
  });
});
