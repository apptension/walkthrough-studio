import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backdropHtml, layoutSections, layoutStage, normalizeLayout, normalizeLayouts, sectionStageGraph } from './layout.mjs';

const OUT = { width: 1920, height: 1080 };
const TALL = { width: 1080, height: 1920 };
const desktop = { width: 1920, height: 1080, mobile: false };
const phone = { width: 390, height: 844, mobile: true };

test('normalizeLayout keeps only known placements and sizes and trims the copy', () => {
  assert.equal(normalizeLayout(null), null);
  assert.equal(normalizeLayout({ placement: 'diagonal' }), null);
  assert.deepEqual(normalizeLayout({ placement: 'left' }), { placement: 'left', size: 'medium', text: { on: false } });
  const full = normalizeLayout({ placement: 'right', size: 'small', text: { on: true, title: '  Hello  ', body: 'x'.repeat(400) } });
  assert.equal(full.size, 'small');
  assert.equal(full.text.title, 'Hello');
  assert.equal(full.text.body.length, 240);
  // Empty copy is dropped so the default (the chapter's words) shows through.
  assert.deepEqual(normalizeLayout({ placement: 'top', text: { on: true, title: '   ' } }).text, { on: true });
});

test('normalizeLayouts dedupes by key and skips rows without a key', () => {
  const rows = normalizeLayouts([
    { key: 'chapter:1.000:A', placement: 'left' },
    { key: 'chapter:1.000:A', placement: 'right' },
    { placement: 'fill' },
    { key: 'lead', placement: 'center', size: 'large' },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.key, r.placement]),
    [
      ['chapter:1.000:A', 'left'],
      ['lead', 'center'],
    ],
  );
});

test('fill is the automatic stage; the other placements keep the recording inside their region', () => {
  const fill = layoutStage(desktop, OUT, { placement: 'fill', size: 'medium', text: { on: false } });
  assert.deepEqual(fill.stage, { mode: 'fill', x: 0, y: 0, w: 1920, h: 1080, radius: 0 });
  assert.equal(fill.panel, null);

  const left = layoutStage(desktop, OUT, { placement: 'left', size: 'medium', text: { on: true } }, { corners: 'soft' });
  assert.equal(left.stage.mode, 'inset');
  assert.ok(left.stage.x >= 0 && left.stage.x + left.stage.w <= OUT.width * 0.62, 'window stays in the left part');
  assert.ok(left.panel.x > left.stage.x + left.stage.w, 'the text panel sits to the right of the window');
  assert.equal(left.panel.side, 'right');
  assert.equal(left.stage.radius, 22);
  assert.equal(left.stage.w % 2, 0);
  assert.equal(left.stage.h % 2, 0);

  const right = layoutStage(desktop, OUT, { placement: 'right', size: 'medium', text: { on: true } });
  assert.equal(right.stage.w, left.stage.w);
  assert.equal(right.stage.x, OUT.width - left.stage.x - left.stage.w);
  assert.equal(right.panel.side, 'left');

  const small = layoutStage(desktop, OUT, { placement: 'center', size: 'small', text: { on: false } });
  const large = layoutStage(desktop, OUT, { placement: 'center', size: 'large', text: { on: false } });
  assert.ok(small.stage.w < large.stage.w);
  assert.equal(Math.abs(small.stage.x + small.stage.w / 2 - OUT.width / 2) <= 2, true, 'centred');
});

test('a phone keeps its device radius; in a vertical video "bottom" leaves room above for the text', () => {
  const l = layoutStage(phone, TALL, { placement: 'bottom', size: 'medium', text: { on: true } });
  assert.equal(l.stage.mode, 'device');
  assert.ok(l.stage.radius > 40);
  assert.equal(l.panel.side, 'top');
  assert.ok(l.panel.y + l.panel.h <= l.stage.y, 'panel above the phone');
  assert.ok(l.stage.y + l.stage.h <= TALL.height);
});

test('sections follow the chapter marks; a lead section exists only when the first chapter starts late', () => {
  const marks = [
    { kind: 'chapter', t: 4, label: 'Feed', key: 'chapter:4.000:Feed' },
    { kind: 'caption', t: 6, label: 'tip' },
    { kind: 'chapter', t: 20, label: 'Comments', key: 'chapter:20.000:Comments' },
  ];
  const cards = [{ markKey: 'chapter:20.000:Comments', body: 'Threads, ranked.' }];
  const s = layoutSections({ marks, liveDur: 40, layouts: [{ key: 'chapter:20.000:Comments', placement: 'left', size: 'medium', text: { on: true } }], cards, title: 'HN' });
  assert.deepEqual(
    s.map((x) => [x.key, x.from, x.to, x.no, x.custom]),
    [
      ['lead', 0, 4, 0, false],
      ['chapter:4.000:Feed', 4, 20, 1, false],
      ['chapter:20.000:Comments', 20, 40, 2, true],
    ],
  );
  assert.deepEqual(s[2].copy, { title: 'Comments', body: 'Threads, ranked.' });
  assert.deepEqual(s[1].copy, { title: 'Feed', body: '' });
  assert.equal(s[0].copy.title, 'HN');
  const early = layoutSections({ marks: [{ kind: 'chapter', t: 0.2, label: 'A' }], liveDur: 10, layouts: [] });
  assert.equal(early.length, 1);
  assert.equal(early[0].from, 0);
  assert.ok(early[0].key.startsWith('chapter:0.200'));
});

test('the panel copy can be overridden per section and the text can be switched off', () => {
  const marks = [{ kind: 'chapter', t: 0, label: 'Feed', key: 'k' }];
  const [sec] = layoutSections({ marks, liveDur: 10, layouts: [{ key: 'k', placement: 'left', size: 'medium', text: { on: true, title: 'Ranked', body: 'Points first.' } }] });
  assert.deepEqual(sec.copy, { title: 'Ranked', body: 'Points first.' });
  const [off] = layoutSections({ marks, liveDur: 10, layouts: [{ key: 'k', placement: 'left', size: 'medium', text: { on: false } }] });
  assert.equal(off.layout.text.on, false);
});

test('backdrop HTML carries the frame size, the window rect and the copy', () => {
  const brand = { colors: { ink: '#0b120d', surface: '#151715', gold: '#42f272', amber: '#f6aa1e', text: '#f8fafc', muted: '#9aa' }, font: { family: 'Inter', css: 'https://f/x.css' } };
  const geo = layoutStage(desktop, OUT, { placement: 'left', size: 'medium', text: { on: true } });
  const html = backdropHtml(brand, { output: OUT, stage: geo.stage, panel: geo.panel, copy: { title: 'Ranked <b>', body: 'Points' }, no: 2, textOn: true, camera: { background: 'brand', shadow: 'soft' } });
  assert.match(html, /width: 1920px/);
  assert.match(html, new RegExp(`left: ${geo.stage.x}px`));
  assert.match(html, /Ranked &lt;b&gt;/);
  assert.match(html, /Points/);
  assert.match(html, /02/);
  assert.match(html, /https:\/\/f\/x\.css/);
  const quiet = backdropHtml(brand, { output: OUT, stage: geo.stage, panel: geo.panel, copy: { title: 'X', body: '' }, no: 1, textOn: false, camera: {} });
  assert.doesNotMatch(quiet, /class="panel"/);
});

test('the section graph trims, places and concatenates every section on one clock', () => {
  const g = sectionStageGraph({
    src: '[lv]',
    out: '[lstage]',
    startInputIndex: 3,
    output: OUT,
    reel: { width: 1920, height: 1080 },
    fps: 30,
    sections: [
      { from: 0, to: 4, stage: { mode: 'fill', x: 0, y: 0, w: 1920, h: 1080, radius: 0 }, bg: null, mask: null },
      { from: 4, to: 10.5, stage: { mode: 'inset', x: 100, y: 60, w: 1000, h: 562, radius: 22 }, bg: '/tmp/bg.png', mask: '/tmp/mask.png' },
    ],
  });
  assert.equal(g.inputCount, 2);
  assert.deepEqual(g.inputs.filter((a) => a.endsWith('.png')), ['/tmp/bg.png', '/tmp/mask.png']);
  const f = g.filter.join(';');
  assert.match(f, /\[lv\]split=2\[ls0\]\[ls1\]/);
  assert.match(f, /trim=start_frame=0:end_frame=120/);
  assert.match(f, /trim=start_frame=120:end_frame=315/);
  assert.match(f, /\[3:v\]scale=1920:1080/);
  assert.match(f, /\[4:v\]format=gray/);
  assert.match(f, /overlay=x=100:y=60/);
  assert.match(f, /\[lst0\]\[lst1\]concat=n=2:v=1:a=0/);
  assert.match(f, /\[lstage\]$/);
});
