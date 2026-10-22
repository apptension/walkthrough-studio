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

test('patchOverlays + resolveOverlays: backdrop colour and opacity', () => {
  const next = patchOverlays({}, {
    chapter: { backdrop: 'surface', backdropOpacity: 60 },
    caption: { backdrop: '#ABC', backdropOpacity: 100 },
  });
  assert.equal(next.chapter.backdrop, 'surface');
  assert.equal(next.chapter.backdropOpacity, 60);
  assert.equal(next.caption.backdrop, '#aabbcc');
  assert.equal('backdropOpacity' in next.caption, false, '100% is the default and is dropped');
  assert.throws(() => patchOverlays({}, { caption: { backdrop: 'red' } }), /backdrop must be/);
  assert.throws(() => patchOverlays({}, { caption: { backdrop: '#12345' } }), /backdrop must be/);
  const cleared = patchOverlays(next, { chapter: { backdrop: 'auto', backdropOpacity: null } });
  assert.equal('backdrop' in cleared.chapter, false);
  assert.equal('backdropOpacity' in cleared.chapter, false);
  const clamped = patchOverlays({}, { chapter: { backdrop: 'none', backdropOpacity: 180 } });
  assert.equal(clamped.chapter.backdrop, 'none');
  assert.equal('backdropOpacity' in clamped.chapter, false);

  const look = resolveOverlays(brand, { overlays: next });
  assert.equal(look.chapter.backdrop, 'surface');
  assert.equal(look.chapter.backdropOpacity, 60);
  assert.equal(look.caption.backdrop, '#aabbcc');
  assert.equal(look.caption.backdropOpacity, 100);
  const plain = resolveOverlays(brand, { overlays: { chapter: { backdrop: 'bogus' } } });
  assert.equal(plain.chapter.backdrop, 'auto');
  assert.equal(plain.caption.backdropOpacity, 100);
  assert.ok(look.catalog.backdrops.some((b) => b.id === 'none'));
});

test('renderLiveCardHtml: backdrop drives data-backdrop and --wt-backdrop', () => {
  const auto = renderLiveCardHtml(brand, 'chapter', { title: 'A', ms: 2400 });
  assert.match(auto, /data-backdrop="auto"/);
  assert.match(auto, /--wt-backdrop: transparent;/);

  const none = renderLiveCardHtml({ ...brand, direction: { overlays: { caption: { backdrop: 'none' } } } }, 'caption', { title: 'A', ms: 2000 });
  assert.match(none, /data-backdrop="none"/);

  const role = renderLiveCardHtml(
    { ...brand, direction: { overlays: { chapter: { backdrop: 'surface', backdropOpacity: 60 } } } },
    'chapter',
    { title: 'A', ms: 2400 }
  );
  assert.match(role, /data-backdrop="color"/);
  assert.match(role, /--wt-backdrop: rgba\(18, 20, 18, 0\.6\);/, 'brand surface #121412 at 60%');

  const custom = renderLiveCardHtml(
    { ...brand, direction: { overlays: { caption: { backdrop: '#ff8800' } } } },
    'caption',
    { title: 'A', ms: 2000 }
  );
  assert.match(custom, /data-backdrop="color"/);
  assert.match(custom, /--wt-backdrop: rgba\(255, 136, 0, 1\);/);
  // The CSS that paints it ships inline with the card, so the bake renders it too.
  assert.match(custom, /\.wt-cap\[data-backdrop='color'\] \.card \{[^}]*background: var\(--wt-backdrop\)/);
  assert.match(role, /\.wt-ch\[data-backdrop='color'\] \.dim \{[^}]*background: var\(--wt-backdrop\)/);
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

test('patchOverlays: a chapter keeps its own background and backdrop; the rest of the video is untouched', () => {
  const video = patchOverlays({}, { chapter: { atmosphere: 'waves', backdrop: '#050505' }, caption: { backdrop: 'ink' } });
  const next = patchOverlays(video, { chapterNo: 2, chapter: { atmosphere: 'mesh', backdrop: 'auto' }, caption: { backdrop: 'none', backdropOpacity: 40 } });
  assert.deepEqual(next.chapter, { atmosphere: 'waves', backdrop: '#050505' }, 'video look unchanged');
  assert.deepEqual(next.chapters, {
    2: { chapter: { atmosphere: 'mesh', backdrop: 'auto' }, caption: { backdrop: 'none', backdropOpacity: 40 } },
  });
  // Only the background trio is per chapter; everything else stays a video-wide setting.
  assert.throws(() => patchOverlays(next, { chapterNo: 2, chapter: { ghost: false } }), /per chapter/);
  assert.throws(() => patchOverlays(next, { chapterNo: 0, chapter: { atmosphere: 'mesh' } }), /chapterNo/);
  assert.throws(() => patchOverlays(next, { chapterNo: 2, chapter: { atmosphere: 'lava' } }), /atmosphere must be/);
  // null hands a key back to the video; an empty entry disappears.
  const back = patchOverlays(next, { chapterNo: 2, chapter: { atmosphere: null, backdrop: null }, caption: { backdrop: null, backdropOpacity: null } });
  assert.equal(back.chapters, undefined);
  assert.deepEqual(back.chapter, { atmosphere: 'waves', backdrop: '#050505' });
});

test('patchOverlays: reset drops a chapter’s own look; applyToAll promotes it to the whole video', () => {
  let o = patchOverlays({}, { chapter: { atmosphere: 'waves', backdrop: '#050505' } });
  o = patchOverlays(o, { chapterNo: 1, chapter: { backdrop: 'none' } });
  o = patchOverlays(o, { chapterNo: 3, chapter: { atmosphere: 'mesh', backdrop: 'gold', backdropOpacity: 50 }, caption: { atmosphere: 'mesh' } });
  const reset = patchOverlays(o, { chapterNo: 1, slot: 'chapter', reset: true });
  assert.equal(reset.chapters[1], undefined);
  assert.ok(reset.chapters[3]);

  const all = patchOverlays(o, { applyToAll: true, chapterNo: 3, slot: 'chapter' });
  assert.deepEqual(all.chapter, { atmosphere: 'mesh', backdrop: 'gold', backdropOpacity: 50 }, 'chapter 3 became the video look');
  assert.equal(all.chapters[1], undefined, 'other chapters follow the video again');
  assert.deepEqual(all.chapters[3], { caption: { atmosphere: 'mesh' } }, 'the caption slot was not part of the apply');

  const both = patchOverlays(o, { applyToAll: true, chapterNo: 3 });
  assert.equal(both.chapters, undefined);
  assert.equal(both.caption.atmosphere, 'mesh');
  // Applying a chapter whose backdrop is `auto` clears the video's colour.
  const autoAll = patchOverlays(patchOverlays(o, { chapterNo: 2, chapter: { backdrop: 'auto' } }), { applyToAll: true, chapterNo: 2, slot: 'chapter' });
  assert.equal('backdrop' in autoAll.chapter, false);
  assert.equal(autoAll.chapter.atmosphere, 'waves');
});

test('resolveOverlays + renderLiveCardHtml: a chapter’s own background wins for its chapter and caption cards', () => {
  const overlays = patchOverlays(
    { chapter: { atmosphere: 'waves', backdrop: '#050505' } },
    { chapterNo: 2, chapter: { atmosphere: 'none', backdrop: 'auto' }, caption: { backdrop: 'surface', backdropOpacity: 60 } }
  );
  const all = resolveOverlays(brand, { overlays });
  assert.equal(all.chapter.backdrop, '#050505');
  assert.deepEqual(all.chapters[2].chapter, { atmosphere: 'none', backdrop: 'auto' });
  assert.equal(all.chapters[2].caption.backdropOpacity, 60);
  const bogus = resolveOverlays(brand, { overlays: { chapters: { x: { chapter: { atmosphere: 'lava' } }, 2: { chapter: { backdrop: 'red' } } } } });
  assert.equal(bogus.chapters, undefined, 'invalid per-chapter rows are dropped');

  const two = resolveOverlays(brand, { overlays }, { chapterNo: 2 });
  assert.equal(two.chapterNo, 2);
  assert.equal(two.chapter.atmosphere, 'none');
  assert.equal(two.chapter.backdrop, 'auto');
  assert.deepEqual(two.scope, { chapter: ['atmosphere', 'backdrop'], caption: ['backdrop', 'backdropOpacity'] });
  const one = resolveOverlays(brand, { overlays }, { chapterNo: 1 });
  assert.equal(one.chapter.backdrop, '#050505');
  assert.deepEqual(one.scope, { chapter: [], caption: [] });

  const b = { ...brand, direction: { overlays } };
  const ch1 = renderLiveCardHtml(b, 'chapter', { chapterNo: 1, title: 'A', ms: 2400 });
  const ch2 = renderLiveCardHtml(b, 'chapter', { chapterNo: 2, title: 'B', ms: 2400 });
  assert.match(ch1, /data-backdrop="color"/);
  assert.match(ch1, /--wt-backdrop: rgba\(5, 5, 5, 1\);/);
  assert.match(ch2, /data-backdrop="auto"/);
  assert.match(ch2, /class="wt wt-ch atm-none /);
  assert.match(ch1, /class="wt wt-ch atm-waves /);
  const cap2 = renderLiveCardHtml(b, 'caption', { chapterNo: 2, chapterTitle: 'B', title: 'C', ms: 2000 });
  assert.match(cap2, /--wt-backdrop: rgba\(18, 20, 18, 0\.6\);/, 'captions inside chapter 2 take its caption backdrop');
  const cap1 = renderLiveCardHtml(b, 'caption', { chapterNo: 1, chapterTitle: 'A', title: 'C', ms: 2000 });
  assert.match(cap1, /data-backdrop="auto"/);
});

test('cardId / parseCardId round-trip', () => {
  assert.equal(cardId('chapter', 3), 'overlay:chapter:3');
  assert.deepEqual(parseCardId('overlay:caption:7'), { kind: 'caption', flowIndex: 7 });
  assert.equal(parseCardId('open'), null);
});
