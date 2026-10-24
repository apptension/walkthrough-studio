import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeRhythm, enrichDraft, rhythmGuide, rhythmReport, scanFlow } from './draftRhythm.mjs';

const ids = (r) => r.findings.map((f) => f.id);

test('scanFlow estimates beat times from explicit and default durations', () => {
  const { beats, liveSec } = scanFlow(`
    await chapter('Start', 'Intro', 3000);
    await wait(1200);
    await page.getByRole('button').click();
    // await ctx.zoom(ignored);
    await ctx.zoom(page.locator('.kpi'), { holdMs: 2000 });
    await say('Done', 'body');
  `);
  assert.deepEqual(beats.map((b) => b.kind), ['chapter', 'wait', 'action', 'zoom', 'say']);
  assert.deepEqual(beats.map((b) => b.t), [0, 3, 4.2, 5.1, 7.1]);
  assert.equal(beats[0].title, 'Start');
  assert.equal(liveSec, 9.5);
});

test('if/else alternatives add no time and do not crowd accents', () => {
  const { beats, liveSec } = scanFlow(`
    if (ok) { await ctx.magnify(a, { holdMs: 2000 }); } else { await ctx.magnify(b, { holdMs: 2000 }); }
  `);
  assert.equal(beats.length, 2);
  assert.equal(beats[1].alt, true);
  assert.equal(liveSec, 2);
  const r = analyzeRhythm({ flowSource: `await wait(8000);\nif (x) { await ctx.magnify(a); } else { await ctx.magnify(b); }\nawait wait(8000);` });
  assert.ok(!ids(r).includes('accent-crowded'));
});

test('a long accent-free stretch is flagged with a line to fix', () => {
  const flow = `await chapter('A');\n${Array.from({ length: 12 }, () => 'await wait(3000);').join('\n')}\nawait say('x');`;
  const r = analyzeRhythm({ flowSource: flow });
  const gap = r.findings.find((f) => f.id === 'accent-gap');
  assert.ok(gap, ids(r).join(','));
  assert.equal(gap.severity, 'warn');
  assert.ok(ids(r).includes('no-zoom'));
  assert.ok(ids(r).includes('no-lens'));
});

test('accents closer than the energy floor are crowded; a single repeated move is monotone', () => {
  const flow = ['await ctx.zoom(a, { holdMs: 1000 });', 'await wait(1000);', 'await ctx.zoom(b, { holdMs: 1000 });', 'await wait(9000);', 'await ctx.zoom(c, { holdMs: 1000 });'].join('\n');
  const r = analyzeRhythm({ flowSource: flow, config: { direction: { motion: { energy: 'calm' } } } });
  assert.equal(r.energy, 'calm');
  assert.ok(ids(r).includes('accent-crowded'));
  assert.ok(ids(r).includes('accent-monotone'));
});

test('a well-paced draft is clean apart from config-side notes', () => {
  const flow = [
    "await chapter('One');",
    "await say('a');",
    'await wait(4000);',
    'await ctx.zoom(a, { holdMs: 2000 });',
    'await wait(8000);',
    "await say('b');",
    'await ctx.magnify(b, { holdMs: 2000 });',
    'await wait(8000);',
    'await ctx.follow([c, d]);',
    'await wait(6000);',
  ].join('\n');
  const r = analyzeRhythm({ flowSource: flow, config: { direction: { camera: { zoom: 'subtle' } } } });
  assert.deepEqual(ids(r).filter((id) => r.findings.find((f) => f.id === id).severity === 'warn'), []);
  assert.equal(r.stats.zooms, 1);
  assert.equal(r.stats.lenses, 2);
});

test('layout repeats and monotone joins are reported from the config', () => {
  const config = {
    open: { layout: 'kinetic' },
    interstitials: [
      { id: 'a', type: 'statement', layout: 'kinetic' },
      { id: 'b', type: 'features', layout: 'stack' },
    ],
  };
  const r = analyzeRhythm({ flowSource: 'await wait(1000);', config });
  assert.ok(ids(r).includes('layout-repeat'));
  assert.ok(ids(r).includes('transition-monotone'));
});

test('enrichDraft applies variety + auto zoom and stays idempotent', () => {
  const config = { title: 'Acme', purpose: 'launch', interstitials: [{ id: 'a', type: 'features' }, { id: 'b', type: 'stats' }] };
  const first = enrichDraft(config, { slug: 'acme', flowSource: 'await wait(1000);' });
  assert.ok(['subtle', 'bold'].includes(first.config.direction.camera.zoom));
  assert.ok(first.config.open.layout && first.config.close.layout);
  assert.ok(first.applied.some((a) => a.startsWith('camera.zoom=')));
  assert.ok(!ids(first.rhythm).includes('transition-monotone'));
  assert.match(first.report, /^# Draft rhythm — acme/);
  const second = enrichDraft(first.config, { slug: 'acme', flowSource: 'await wait(1000);' });
  assert.deepEqual(second.applied, []);
  assert.deepEqual(second.config, first.config);
});

test('report and guide render', () => {
  const r = analyzeRhythm({ flowSource: '' });
  assert.deepEqual(ids(r), ['no-flow']);
  assert.match(rhythmReport(r, { slug: 's' }), /Findings:/);
  assert.match(rhythmGuide(), /ctx\.magnify/);
});
