import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  CTX_DOCS,
  FLOW_SKELETON,
  checkFlow,
  ctxApi,
  ctxApiFromSource,
  ctxContract,
  flowContractBlock,
  flowGateDecision,
  flowRepairLimit,
  flowRepairPrompt,
  flowSelectors,
  lintFlowSource,
  maskSource,
} from './flowCheck.mjs';

const rules = (issues, level) => issues.filter((i) => !level || i.level === level).map((i) => i.rule);

describe('ctx API', () => {
  it('is read from the real recorder and every key is documented (no drift)', () => {
    const keys = Object.keys(ctxApi().keys);
    for (const k of ['page', 'chapter', 'say', 'wait', 'settle', 'typeInto', 'fillField', 'zoom', 'magnify', 'near', 'optional']) {
      assert.ok(keys.includes(k), `ctx.${k} missing from record.mjs`);
    }
    assert.deepEqual(keys.filter((k) => !CTX_DOCS[k]), [], 'document new ctx keys in CTX_DOCS');
    assert.deepEqual(Object.keys(CTX_DOCS).filter((k) => !keys.includes(k)), [], 'CTX_DOCS names a key record.mjs no longer has');
  });

  it('parses nested objects, getters, shorthands and methods with default params', () => {
    const api = ctxApiFromSource(`
      const other = { nope: 1 };
      const ctx = {
        page,
        wait: hold, // comment with { brace
        label: "a } string",
        go: async (x, opts = {}) => { const y = { inner: 1 }; return y; },
        actions: { hide: () => 1, show() { return 2; } },
        pointer: { moveTo: (x, y) => 1, get position() { return {}; } },
      };`);
    assert.deepEqual(Object.keys(api.keys), ['page', 'wait', 'label', 'go', 'actions', 'pointer']);
    assert.deepEqual(Object.keys(api.keys.actions.keys), ['hide', 'show']);
    assert.equal(api.keys.pointer.keys.position.kind, 'getter');
  });

  it('builds a compact contract with every documented key', () => {
    const contract = ctxContract();
    assert.match(contract, /chapter\(title, body, ms = 2800\)/);
    assert.match(contract, /optional\(label/);
    assert.doesNotMatch(contract, /internal overlay controller/);
  });
});

describe('maskSource', () => {
  it('blanks comments and string contents but keeps positions', () => {
    const src = "const a = 'x // y'; // note 1920\nconst b = /re\\/g/i; /* 1080 */ const c = `t ${d} u`;";
    const masked = maskSource(src);
    assert.equal(masked.length, src.length);
    assert.doesNotMatch(masked, /1920|1080|note|x \/\/ y/);
    assert.match(masked, /\$\{d\}/);
    assert.match(maskSource(src, { strings: false }), /'x \/\/ y'/);
  });
});

describe('lintFlowSource', () => {
  it('passes the known-good skeleton', () => {
    assert.deepEqual(rules(lintFlowSource(FLOW_SKELETON), 'error'), []);
  });

  it('flags unknown ctx members from destructuring and member access, with a suggestion', () => {
    const issues = lintFlowSource(`export default async function flow(ctx) {
  const { page, caption } = ctx;
  await ctx.chapter('Overview', 'Why');
  await ctx.highlight(page.getByRole('button', { name: /save/i }));
}`);
    const errors = issues.filter((i) => i.rule === 'ctx-unknown');
    assert.equal(errors.length, 2);
    assert.match(errors[0].message, /caption.*use say/);
    assert.equal(errors[0].line, 2);
    assert.match(errors[1].message, /ctx\.highlight.*focus or magnify/);
  });

  it('checks destructured params and nested ctx objects', () => {
    const issues = lintFlowSource(`export default async function flow({ page, chapter, actions, pointer, scrollTo }) {
  await chapter('Overview', 'Why');
  await actions.hide();
  await actions.freeze();
  const at = pointer.position();
}`);
    assert.deepEqual(rules(issues, 'error').sort(), ['ctx-getter', 'ctx-unknown', 'ctx-unknown']);
    assert.ok(issues.some((i) => /actions\.freeze/.test(i.message)));
    assert.ok(issues.some((i) => /scrollTo/.test(i.message)));
  });

  it('flags getByPlaceholder → click → fill, inline and through a variable', () => {
    const inline = lintFlowSource(`export default async function flow({ page, chapter }) {
  await chapter('Sign up', 'Why');
  await page.getByPlaceholder('Email').click();
  await page.getByPlaceholder('Email').fill('a@b.co');
}`);
    assert.deepEqual(rules(inline, 'error'), ['placeholder-click-fill']);
    const viaVar = lintFlowSource(`export default async function flow({ page, chapter }) {
  await chapter('Sign up', 'Why');
  const email = page.getByPlaceholder(/email/i);
  await email.click();
  await email.fill('a@b.co');
}`);
    assert.ok(rules(viaVar, 'error').includes('placeholder-click-fill'));
  });

  it('warns on wait() right after chapter(), un-awaited cards and goto without waitUntil', () => {
    const issues = lintFlowSource(`export default async function flow({ page, chapter, say, wait }) {
  await chapter('Reports', 'Why');
  await wait(1500);
  say('Open it', 'Why');
  await page.goto('https://example.com/reports');
  await page.waitForTimeout(500);
}`);
    assert.deepEqual(rules(issues, 'warn').sort(), ['goto-wait', 'not-awaited', 'wait-after-chapter', 'wait-for-timeout']);
    assert.deepEqual(rules(issues, 'error'), []);
  });

  it('errors on resizing the page and credentials, warns on frame literals outside comments', () => {
    const issues = lintFlowSource(`// Recorded at 1920x1080
export default async function flow({ page, chapter, env, typeInto }) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await chapter('Overview', 'Why');
  await typeInto(page.locator('[name="password"]'), env.demoPassword);
  await page.mouse.move(1920 / 2, 300);
}`);
    assert.deepEqual(rules(issues, 'error').sort(), ['credentials', 'viewport']);
    assert.deepEqual(rules(issues, 'warn'), ['hardcoded-size']);
  });

  it('errors on a missing default export, no chapters and starter titles', () => {
    assert.ok(rules(lintFlowSource(`export async function flow() {}`), 'error').includes('default-export'));
    assert.ok(rules(lintFlowSource(`export default async function flow({ say }) { await say('Hi', 'x'); }`), 'error').includes('no-chapters'));
    assert.ok(rules(lintFlowSource(`export default async function flow({ chapter }) { await chapter('First chapter', 'x'); }`), 'error').includes('scaffold'));
  });

  it('warns on selectors the product map never saw, unless marked TODO', () => {
    const source = `export default async function flow({ page, chapter }) {
  await chapter('Reports', 'Why');
  await page.getByRole('link', { name: /reports|insights/i }).click();
  await page.getByRole('button', { name: 'Export to PDF' }).click();
  await page.getByLabel('Mystery knob').click(); // TODO(verify selector)
  await page.locator('input[name="query"]').fill('x');
}`;
    const issues = lintFlowSource(source, { corpus: 'nav: reports · button "share" · field name=query' });
    const unmapped = issues.filter((i) => i.rule === 'selector-unmapped');
    assert.equal(unmapped.length, 1);
    assert.match(unmapped[0].message, /Export to PDF/);
    assert.equal(unmapped[0].line, 4);
    assert.deepEqual(
      flowSelectors(maskSource(source, { strings: false })).map((s) => s.value),
      ['reports|insights', 'Export to PDF', 'Mystery knob', 'query']
    );
  });
});

describe('checkFlow', () => {
  const root = mkdtempSync(join(tmpdir(), 'flow-check-'));
  after(() => rmSync(root, { recursive: true, force: true }));
  let n = 0;
  const project = ({ flow, narration, config } = {}) => {
    const dir = join(root, `v${++n}`);
    mkdirSync(dir, { recursive: true });
    const cfg = config ?? {
      title: 'Demo',
      brand: 'walkthrough-studio',
      record: { startUrl: 'https://example.com', viewport: { width: 1440, height: 900 } },
      interstitials: [{ id: 'why', type: 'statement', before: 'Reports' }],
    };
    writeFileSync(join(dir, 'video.config.json'), typeof cfg === 'string' ? cfg : JSON.stringify(cfg));
    writeFileSync(
      join(dir, 'flow.mjs'),
      flow ??
        `export default async function flow({ page, chapter, say, settle }) {
  await chapter('Reports', 'See the numbers');
  await page.getByRole('link', { name: /reports/i }).click();
  await settle(page.getByRole('heading', { name: /reports/i }));
  await say('Filter', 'Narrow it down');
}`
    );
    if (narration !== null) {
      writeFileSync(
        join(dir, 'narration.mjs'),
        narration ?? `export default { intro: 'Hi.', outro: 'Bye.', plates: { why: 'Because.' }, lines: { Reports: 'The numbers.', Filter: 'Narrow it.' } };`
      );
    }
    return { slug: `v${n}`, dir };
  };

  it('passes a sound draft', async () => {
    const r = await checkFlow(project(), { corpus: '' });
    assert.deepEqual(r.errors, []);
    assert.equal(r.ok, true);
  });

  it('reports a flow syntax error with its line', async () => {
    const r = await checkFlow(project({ flow: `export default async function flow({ chapter }) {\n  await chapter('Reports', 'x');\n  if (\n}` }), { corpus: '' });
    assert.equal(r.ok, false);
    const syntax = r.errors.find((e) => e.rule === 'syntax');
    assert.ok(syntax);
    assert.equal(syntax.file, 'flow.mjs');
    assert.ok(syntax.line >= 3);
  });

  it('reports a flow without a default function and a broken narration', async () => {
    const r = await checkFlow(project({ flow: `export const flow = 1;\n// chapter('Reports')`, narration: `export default 'nope';` }), { corpus: '' });
    const found = r.errors.map((e) => `${e.file}:${e.rule}`);
    assert.ok(found.includes('flow.mjs:default-export'));
    assert.ok(found.includes('narration.mjs:default-export'));
  });

  it('reports config problems: bad JSON, missing startUrl, plate types, literal secrets', async () => {
    const bad = await checkFlow(project({ config: '{ "title": ' }), { corpus: '' });
    assert.ok(bad.errors.some((e) => e.file === 'video.config.json' && /not valid JSON/.test(e.message)));
    const r = await checkFlow(
      project({
        config: {
          title: 'Demo',
          brand: 'walkthrough-studio',
          record: {},
          env: { password: 'hunter2', email: '$DEMO_EMAIL' },
          interstitials: [{ id: 'why', type: 'banner', before: 'Reports' }],
        },
      }),
      { corpus: '' }
    );
    const found = rules(r.errors);
    for (const rule of ['start-url', 'env-secret', 'plate-type']) assert.ok(found.includes(rule), rule);
  });

  it('errors when a plate sits before a chapter the flow does not have, warns on unmatched narration', async () => {
    const r = await checkFlow(
      project({
        config: {
          title: 'Demo',
          brand: 'walkthrough-studio',
          record: { startUrl: 'https://example.com' },
          interstitials: [{ id: 'why', type: 'statement', before: 'Dashboards' }],
        },
        narration: `export default { intro: 'Hi.', outro: 'Bye.', plates: { why: 'Because.' }, lines: { Report: 'Typo key.', Filter: 'x' } };`,
      }),
      { corpus: '' }
    );
    assert.ok(r.errors.some((e) => /Dashboards/.test(e.message)));
    assert.ok(r.warnings.some((w) => w.file === 'narration.mjs' && /chapter:Reports/.test(w.message)));
    assert.ok(r.warnings.some((w) => w.file === 'narration.mjs' && /"Report"/.test(w.message)));
  });

  it('pins the recording size the reviewer chose', async () => {
    const r = await checkFlow(project(), { corpus: '', baseline: { viewport: { width: 1920, height: 1080 }, device: null, format: null } });
    assert.ok(r.errors.some((e) => e.rule === 'recording-size' && /record\.viewport/.test(e.message)));
  });
});

describe('gate loop', () => {
  it('repairs up to the limit, then fails', () => {
    assert.deepEqual(flowGateDecision({ ok: true, round: 1, max: 2 }), { action: 'done', round: 1 });
    assert.deepEqual(flowGateDecision({ ok: false, round: 0, max: 2 }), { action: 'repair', round: 1, remaining: 1 });
    assert.deepEqual(flowGateDecision({ ok: false, round: 1, max: 2 }), { action: 'repair', round: 2, remaining: 0 });
    assert.deepEqual(flowGateDecision({ ok: false, round: 2, max: 2 }), { action: 'fail', reason: 'exhausted', round: 2 });
    assert.equal(flowGateDecision({ ok: false, round: 0, max: 0 }).action, 'fail');
  });

  it('reads the limit from WALKTHROUGH_DRAFT_REPAIRS, clamped', () => {
    assert.equal(flowRepairLimit({}), 2);
    assert.equal(flowRepairLimit({ WALKTHROUGH_DRAFT_REPAIRS: '0' }), 0);
    assert.equal(flowRepairLimit({ WALKTHROUGH_DRAFT_REPAIRS: '99' }), 4);
  });

  it('repair prompt carries the concrete errors, the contract and the self-check command', () => {
    const prompt = flowRepairPrompt({
      video: { slug: 'demo', dir: '/tmp/demo-video' },
      result: { ok: false, errors: [{ level: 'error', file: 'flow.mjs', line: 7, message: 'ctx.caption is not part of ctx' }], warnings: [] },
      round: 1,
      max: 2,
      skillPath: '/skill',
      kitDir: '/skill/kit',
    });
    assert.match(prompt, /repair 1\/2/);
    assert.match(prompt, /✗ flow\.mjs:7 · ctx\.caption is not part of ctx/);
    assert.match(prompt, /node \/skill\/kit\/cli\.mjs check-flow demo/);
    assert.match(prompt, /settle\(/);
    assert.match(flowContractBlock({ kitDir: '/k', slug: 's' }), /optional\('label'/);
  });
});
