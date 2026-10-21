import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  OVERLAY_PRESET_IDS,
  cardId,
  chapterChrome,
  parseCardId,
  patchOverlays,
  renderLiveCardHtml,
  resolveOverlays,
  saveLiveCardCopy,
} from './liveCards.mjs';

const brand = {
  colors: { ink: '#0a0a0a', surface: '#121412', gold: '#FFFE25', amber: '#42F272', muted: '#94a3b8', text: '#f8fafc', onAccent: '#111' },
  font: { family: 'Inter', css: 'https://fonts.example/inter.css' },
  motion: { energy: 'punchy', atmosphere: 'waves', sheen: true },
  direction: {},
};

test('resolveOverlays: plateMatch inherits plate motion atmosphere/energy', () => {
  const look = resolveOverlays(brand, { overlays: { preset: 'plateMatch' } });
  assert.equal(look.preset, 'plateMatch');
  assert.equal(look.chapter.atmosphere, 'waves');
  assert.equal(look.chapter.energy, 'punchy');
  assert.equal(look.caption.seat, 'bottom-center');
  assert.ok(OVERLAY_PRESET_IDS.includes('editorial'));
});

test('resolveOverlays: plateMatch keeps a promoted plate atmosphere', () => {
  const look = resolveOverlays(
    { ...brand, motion: { ...brand.motion, atmosphere: 'aurora' } },
    { overlays: { preset: 'plateMatch' } }
  );
  assert.equal(look.chapter.atmosphere, 'aurora');
  assert.equal(look.caption.atmosphere, 'aurora');
  const ch = renderLiveCardHtml(
    { ...brand, motion: { ...brand.motion, atmosphere: 'aurora' } },
    'chapter',
    { chapterNo: 1, title: 'Open', ms: 2400 }
  );
  assert.match(ch, /data-field="aurora"/);
  assert.match(ch, /data-field-root/);
  assert.match(ch, /__plateRuntime/);
  const blobs = renderLiveCardHtml(
    { ...brand, direction: { overlays: { chapter: { atmosphere: 'blobs' } } } },
    'chapter',
    { chapterNo: 1, title: 'Open', ms: 2400 }
  );
  assert.doesNotMatch(blobs, /<canvas class="plate-field"/);
});

test('resolveOverlays: caption seat and width clamps', () => {
  const look = resolveOverlays(brand, {
    overlays: { preset: 'minimal', caption: { seat: 'bottom-left', maxWidth: 9999, bottom: 2 } },
  });
  assert.equal(look.caption.seat, 'bottom-left');
  assert.equal(look.caption.maxWidth, 800);
  assert.equal(look.caption.bottom, 16);
  assert.equal(look.chapter.atmosphere, 'none');
});

test('patchOverlays: validates enums and merges slots', () => {
  const next = patchOverlays({ preset: 'plateMatch' }, {
    preset: 'spotlight',
    caption: { seat: 'bottom-center', align: 'center', maxWidth: 640 },
    chapter: { atmosphere: 'mesh', ghost: false },
  });
  assert.equal(next.preset, 'spotlight');
  assert.equal(next.caption.align, 'center');
  assert.equal(next.chapter.atmosphere, 'mesh');
  assert.equal(next.chapter.ghost, false);
  assert.throws(() => patchOverlays({}, { caption: { seat: 'top' } }), /seat must be/);
  assert.throws(() => patchOverlays({}, { preset: 'neon' }), /preset must be/);
  const aurora = patchOverlays({}, { chapter: { atmosphere: 'aurora' }, caption: { atmosphere: 'aurora' } });
  assert.equal(aurora.chapter.atmosphere, 'aurora');
  assert.equal(aurora.caption.atmosphere, 'aurora');
  assert.throws(() => patchOverlays({}, { chapter: { atmosphere: 'lava' } }), /atmosphere must be/);
});

test('renderLiveCardHtml: chapter and caption fill templates with data-edit', () => {
  const ch = renderLiveCardHtml(brand, 'chapter', { chapterNo: 2, title: 'Our services', body: 'What we offer', ms: 2400 });
  assert.match(ch, /wt-ch/);
  assert.match(ch, /data-edit="title"/);
  assert.match(ch, /data-edit="chapter"/);
  assert.match(ch, /data-edit="number"/);
  assert.match(ch, /data-edit-raw="Chapter 02"/);
  assert.match(ch, />02</);
  assert.match(ch, /Our services/);
  assert.match(ch, /atm-waves/);
  assert.match(ch, /wave-field/);

  const cap = renderLiveCardHtml(
    { ...brand, direction: { overlays: { preset: 'editorial', caption: { seat: 'bottom-center' } } } },
    'caption',
    { chapterNo: 2, chapterTitle: 'Our services', title: 'Scan the map', body: 'Five ways in', ms: 2000 }
  );
  assert.match(cap, /wt-cap/);
  assert.match(cap, /data-seat="bottom-center"/);
  assert.match(cap, /data-edit="title"/);
  assert.match(cap, /Scan the map/);
  assert.match(cap, /Our services/);
});

test('renderLiveCardHtml: hold ms drives caption exit CSS', () => {
  const short = renderLiveCardHtml(brand, 'caption', { title: 'A', ms: 2000 });
  const long = renderLiveCardHtml(brand, 'caption', { title: 'A', ms: 5000 });
  const x = (html) => Number(/--x-out:\s*([0-9.]+)s/.exec(html)?.[1]);
  assert.ok(x(long) > x(short));
});

test('chapterChrome: defaults, then saved eyebrow and ghost number', () => {
  assert.deepEqual(chapterChrome(1), { num: '01', kicker: 'Chapter 01', fallback: '01' });
  assert.deepEqual(chapterChrome(2, { num: 'IV', kicker: 'Part 02' }), {
    num: 'IV',
    kicker: 'Part 02',
    fallback: '02',
  });
  const html = renderLiveCardHtml(brand, 'chapter', { chapterNo: 1, title: 'Meet', num: 'IV', kicker: 'Part 01' });
  assert.match(html, /data-edit-raw="IV"/);
  assert.match(html, /data-edit-raw="Part 01"/);
});

test('saveLiveCardCopy: chapter label and ghost number round-trip, defaults are dropped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-cardcopy-'));
  try {
    writeFileSync(join(dir, 'flow.mjs'), "export default async function flow({ chapter }) {\n  await chapter('Meet', 'Body', 2400);\n}\n");
    const configPath = join(dir, 'video.config.json');
    writeFileSync(configPath, '{ "title": "Meet" }\n');
    const video = { dir, configPath, config: {} };
    await saveLiveCardCopy(video, 'overlay:chapter:0', { chapter: 'Part 01', number: 'IV' });
    assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')).liveCardCopy, { 0: { kicker: 'Part 01', num: 'IV' } });
    await saveLiveCardCopy(video, 'overlay:chapter:0', { chapter: 'Chapter 01', number: '01' });
    assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).liveCardCopy, undefined);
    assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).title, 'Meet');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cardId / parseCardId round-trip', () => {
  assert.equal(cardId('chapter', 3), 'overlay:chapter:3');
  assert.deepEqual(parseCardId('overlay:caption:7'), { kind: 'caption', flowIndex: 7 });
  assert.equal(parseCardId('open'), null);
});
