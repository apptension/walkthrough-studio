import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  applyScriptStructure,
  commitFlowSource,
  approveScript,
  buildScript,
  insertFlowCallAfter,
  moveFlowCall,
  moveFlowCallTo,
  parseFlowCalls,
  refreshScriptApproval,
  removeFlowCallAt,
  replaceFlowCallAt,
  scaffoldPlate,
  scriptStatus,
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
    assert.doesNotMatch(next, /await\s+await/);
  });

  it('removing a caption that sits above ordinary code does not glue await onto the next statement', () => {
    // This is the record-time "Unexpected token 'const'" failure: the caption line
    // was deleted, but `await` stayed behind and swallowed the following statement.
    const source = `export default async function flow(ctx) {
  const { say } = ctx;
  await say('Stay on HN', 'Open via N comments.', 2000);
  await say('Builder pitch', 'The Show HN post and thread stay on HN.', 2000);
  const showItem = page.locator('.fatitem').first();
  if (await showItem.isVisible().catch(() => false)) {
    await frame(showItem, { holdMs: 1400 });
  }
}
`;
    const index = parseFlowCalls(source).findIndex((c) => c.title === 'Builder pitch');
    const next = removeFlowCallAt(source, index);
    assert.doesNotMatch(next, /Builder pitch/);
    assert.match(next, /^ {2}const showItem = page\.locator\('\.fatitem'\)\.first\(\);$/m);
    assert.doesNotMatch(next, /await\s+const/);
    assert.doesNotMatch(next, /await\s+await/);
    assert.match(next, /await say\('Stay on HN'/);
  });

  it('inserting before the first call keeps that call attached to its await', () => {
    const next = insertFlowCallAfter(SAMPLE, -1, { kind: 'chapter', title: 'Cold open', body: 'Start here' });
    assert.match(next, /await chapter\('Cold open'/);
    assert.match(next, /await chapter\('Meet Studio'/);
    assert.doesNotMatch(next, /await\s+await/);
    assert.doesNotMatch(next, /await\s+chapter\('Cold open'[\s\S]*\n\s*chapter\('Meet Studio'/);
  });
});

describe('commitFlowSource', () => {
  it('leaves the file untouched when the edit would not parse', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-flow-'));
    const file = join(dir, 'flow.mjs');
    const before = 'export default async function flow() {}\n';
    writeFileSync(file, before);
    try {
      assert.throws(
        () => commitFlowSource(file, 'export default async function flow() {\n  await   const showItem = 1;\n}\n'),
        /would break flow\.mjs/
      );
      assert.equal(readFileSync(file, 'utf8'), before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes the file when the edit parses', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-flow-'));
    const file = join(dir, 'flow.mjs');
    writeFileSync(file, 'export default async function flow() {}\n');
    const next = 'export default async function flow() {\n  const showItem = 1;\n}\n';
    try {
      commitFlowSource(file, next);
      assert.equal(readFileSync(file, 'utf8'), next);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
    assert.equal(script.plateTypes.length, 18);
    const plate = script.scenes.find((s) => s.kind === 'plate');
    assert.equal(plate.plate.rows.length, 2);
    assert.equal(plate.editable.remove, true);

    await applyScriptStructure(video, { op: 'plate-remove', plateId: id });
    cfg = JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8'));
    assert.equal(cfg.interstitials.length, 0);
  });
});

describe('script approval hash', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-approve-'));
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
          close: { title: ['Bye'], steps: [] },
          interstitials: [],
          edit: { audio: { voice: [] } },
        },
        null,
        2
      ) + '\n'
    );
    writeFileSync(join(dir, 'flow.mjs'), SAMPLE);
    writeFileSync(
      join(dir, 'narration.mjs'),
      `export default { intro: 'Hello', outro: 'Bye', plates: {}, lines: { 'Meet Studio': 'Welcome.' } };\n`
    );
  }

  it('keeps approval when only the edit desk changes; refreshes after narration', async () => {
    seed();
    const video = { dir, slug: 'demo', config: JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8')) };
    approveScript(video, { note: 'ok' });
    assert.equal(scriptStatus(video).effective, 'approved');

    const cfg = JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8'));
    cfg.edit = { audio: { voice: [{ key: 'Meet Studio', text: 'Welcome — rewrite for voice', take: 2 }] } };
    cfg.direction = { pace: 'brisk' };
    writeFileSync(join(dir, 'video.config.json'), JSON.stringify(cfg, null, 2) + '\n');
    assert.equal(scriptStatus(video).effective, 'approved', 'voice desk / direction must not void approval');

    await setNarrationLine(video, { kind: 'line', key: 'Meet Studio', text: 'Welcome aboard.' });
    assert.equal(scriptStatus(video).effective, 'changed', 'narration change is a real script change');
    refreshScriptApproval(video, { reason: 'narration' });
    assert.equal(scriptStatus(video).effective, 'approved', 'quiet narration edit auto-keeps approval');
  });
});
