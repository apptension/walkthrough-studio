import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  analysisToMarkdown,
  buildRecommendations,
  enrichFormsWithFills,
  inferFieldPurpose,
  suggestFieldFill,
} from './analyzeFlow.mjs';

describe('suggestFieldFill', () => {
  it('infers purposes and builds unique emails', () => {
    assert.equal(inferFieldPurpose({ type: 'email', label: 'Work email' }), 'email');
    const fill = suggestFieldFill({ type: 'email', label: 'Email', required: true }, { runId: 'abc123' });
    assert.equal(fill.value, 'walkthrough+abc123@example.com');
    assert.equal(fill.strategy, 'fill');
  });

  it('keeps login credentials as env refs', () => {
    const email = suggestFieldFill(
      { type: 'email', label: 'Email', purpose: 'email', formKind: 'login' },
      { slug: 'walkthrough-studio' }
    );
    assert.equal(email.strategy, 'env');
    assert.match(email.value, /\$WALKTHROUGH_STUDIO_EMAIL/);
    const password = suggestFieldFill(
      { type: 'password', label: 'Password', purpose: 'password', formKind: 'login' },
      { slug: 'walkthrough-studio' }
    );
    assert.equal(password.strategy, 'env');
  });

  it('respects min/max/step on numbers', () => {
    const fill = suggestFieldFill({ type: 'number', label: 'Qty', purpose: 'quantity', min: '5', max: '20', step: '5' });
    assert.equal(fill.value, '10');
  });

  it('picks a select option and skips file inputs', () => {
    const sel = suggestFieldFill({
      tag: 'select',
      type: 'select-one',
      options: [
        { value: '', label: 'Choose', placeholder: true },
        { value: 'm', label: 'Medium' },
      ],
    });
    assert.equal(sel.strategy, 'selectOption');
    assert.equal(sel.value, 'm');
    const file = suggestFieldFill({ type: 'file', label: 'Upload' });
    assert.equal(file.skip, true);
  });

  it('tries to satisfy pattern constraints', () => {
    const fill = suggestFieldFill({
      type: 'text',
      label: 'Code',
      pattern: '[A-Z]{2}\\d{2}',
      maxLength: 4,
    });
    assert.ok(fill.value);
    assert.ok(/^[A-Z]{2}\d{2}$/.test(fill.value) || /verify fill/i.test(fill.notes || ''));
  });

  it('enriches forms with purpose + fill', () => {
    const forms = enrichFormsWithFills(
      [
        {
          kind: 'signup',
          fields: [
            { type: 'email', label: 'Email', required: true, name: 'email' },
            { type: 'password', label: 'Password', required: true, name: 'password' },
          ],
        },
      ],
      { runId: 'x1', slug: 'demo' }
    );
    assert.equal(forms[0].fields[0].purpose, 'email');
    assert.equal(forms[0].fields[0].fill.strategy, 'fill');
    assert.equal(forms[0].fields[1].fill.strategy, 'fill');
  });
});

describe('buildRecommendations', () => {
  it('flags WebGL capture settings and canvas drag recipes', () => {
    const report = {
      canvases: [
        {
          index: 0,
          label: '#viewer',
          visible: true,
          box: { x: 0, y: 0, w: 800, h: 600 },
          contexts: ['webgl'],
          frameworks: ['three'],
          cursor: 'grab',
          interactions: {
            reactsToDrag: true,
            reactsToWheel: true,
            reactsToClick: false,
            listenerTypes: ['pointerdown', 'wheel'],
            confidence: 'high',
          },
        },
      ],
      dom: {
        controls: [{ name: 'Start designing', role: 'button', playwright: "page.getByRole('button', { name: /start/i })" }],
      },
      hints: {},
    };
    const tips = buildRecommendations(report);
    assert.ok(tips.some((t) => t.kind === 'capture' && /deviceScaleFactor:\s*1/.test(t.text)));
    assert.ok(tips.some((t) => t.kind === 'flow' && /actions\.hide/.test(t.text)));
    assert.ok(tips.some((t) => t.kind === 'flow' && /wheel/.test(t.text)));
    assert.ok(tips.some((t) => t.kind === 'selectors' && /getByRole/.test(t.text)));
  });

  it('warns when the page has neither controls nor canvases', () => {
    const tips = buildRecommendations({ canvases: [], dom: { controls: [] }, hints: {} });
    assert.equal(tips[0].kind, 'warn');
  });

  it('notes login when hinted', () => {
    const tips = buildRecommendations({
      canvases: [],
      dom: { controls: [{ name: 'Email', role: 'textbox', playwright: 'page.getByLabel(/email/i)' }] },
      hints: { needsLogin: true },
    });
    assert.ok(tips.some((t) => t.kind === 'auth'));
  });

  it('lists form fill tips for required fields', () => {
    const tips = buildRecommendations({
      canvases: [],
      dom: {
        controls: [],
        forms: [
          {
            kind: 'signup',
            fields: [
              {
                label: 'Email',
                required: true,
                fill: { strategy: 'fill', value: 'walkthrough+x@example.com', notes: 'unique', constraints: { required: true } },
              },
            ],
          },
        ],
      },
      hints: {},
    });
    assert.ok(tips.some((t) => t.kind === 'forms'));
    assert.ok(tips.some((t) => t.kind === 'fill' && /Email/.test(t.text)));
  });
});

describe('analysisToMarkdown', () => {
  it('renders canvas recipes and control table', () => {
    const md = analysisToMarkdown({
      slug: 'demo',
      analyzedAt: '2026-01-01T00:00:00.000Z',
      url: 'https://example.com',
      title: 'Demo',
      recommendations: [{ kind: 'capture', text: 'Set record.deviceScaleFactor: 1' }],
      canvases: [
        {
          label: '#gl',
          contexts: ['webgl'],
          frameworks: ['three'],
          interactions: { reactsToDrag: true, reactsToWheel: false, listenerTypes: ['pointerdown'] },
          box: { w: 640, h: 480 },
          flowSnippet: 'await page.mouse.down();',
        },
      ],
      dom: {
        controls: [{ role: 'button', name: 'Save', playwright: "page.getByRole('button', { name: /save/i })" }],
        headings: [{ level: 1, text: 'Welcome' }],
      },
    });
    assert.match(md, /# Flow analysis — demo/);
    assert.match(md, /deviceScaleFactor/);
    assert.match(md, /#gl/);
    assert.match(md, /page\.mouse\.down/);
    assert.match(md, /getByRole\('button'/);
    assert.match(md, /h1: Welcome/);
  });

  it('renders form fill tables', () => {
    const md = analysisToMarkdown({
      slug: 'demo',
      analyzedAt: '2026-01-01T00:00:00.000Z',
      url: 'https://example.com',
      dom: {
        forms: [
          {
            label: 'Sign up',
            kind: 'signup',
            fields: [
              {
                label: 'Email',
                required: true,
                type: 'email',
                playwright: 'page.getByLabel(/email/i)',
                fill: { strategy: 'fill', value: 'walkthrough+a@example.com', notes: 'Unique per run' },
              },
            ],
            submit: { name: 'Create account', playwright: "page.getByRole('button', { name: /create/i })" },
          },
        ],
      },
    });
    assert.match(md, /Forms & fill recipes/);
    assert.match(md, /walkthrough\+a@example\.com/);
    assert.match(md, /Create account/);
  });
});
