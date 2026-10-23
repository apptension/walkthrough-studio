import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { compileGuidedFlow, describeStep, locatorFor, normalizeGuideEvents, runGuidedTour, targetFor, tourToMarkdown, viewportFit, viewportMatched } from './guidedTour.mjs';
import { duration } from './produce.mjs';
import { near, pickNearest, spot } from './replayTarget.mjs';

const btn = (name) => ({ tag: 'button', role: 'button', name, css: `#${name}` });

test('normalize merges one intention into one step and honours undo / pause', () => {
  const field = { tag: 'input', role: 'textbox', name: 'Search', css: '#q' };
  const raw = [
    { type: 'click', target: btn('Sign'), at: 10, seq: 1 },
    { type: 'start', url: 'https://app.test/home', at: 100, seq: 2 },
    { type: 'nav', url: 'https://app.test/home?x', at: 300, seq: 3 },
    { type: 'click', target: btn('People'), at: 1000, seq: 4, detail: 1 },
    { type: 'nav', url: 'https://app.test/people', at: 1600, seq: 5 },
    { type: 'title', url: 'https://app.test/people', title: 'People · App', at: 1700, seq: 6 },
    { type: 'focus', target: field, at: 9000, seq: 7 },
    { type: 'fill', target: field, value: 'Fro', at: 9200, seq: 8 },
    { type: 'fill', target: field, value: 'Frontend', at: 9900, seq: 9 },
    { type: 'press', key: 'Enter', at: 10000, seq: 10 },
    { type: 'click', target: btn('Row'), at: 11000, seq: 11, detail: 1 },
    { type: 'click', target: btn('Row'), at: 11200, seq: 12, detail: 2 },
    { type: 'pause', at: 12000, seq: 13 },
    { type: 'click', target: btn('Settings'), at: 12500, seq: 14 },
    { type: 'resume', at: 13000, seq: 15 },
    { type: 'click', target: btn('Oops'), at: 14000, seq: 16 },
    { type: 'undo', at: 14500, seq: 17 },
    { type: 'scroll', target: { page: true }, fromY: 0, toY: 300, fracY: 0.3, at: 15000, seq: 18 },
    { type: 'scroll', target: { page: true }, fromY: 300, toY: 900, fracY: 0.9, at: 15400, seq: 19 },
    { type: 'mark', title: 'Find talent', at: 16000, seq: 20 },
    { type: 'press', key: 'ArrowDown', at: 16500, seq: 21 },
    { type: 'press', key: 'ArrowDown', at: 16700, seq: 22 },
    { type: 'goto', at: 0, seq: 0 },
  ].slice(0, -1);
  const { steps, removed, stats } = normalizeGuideEvents(raw, { shots: [{ seq: 5, file: 'shots/001.jpg' }] });
  assert.deepEqual(
    steps.map((s) => s.type),
    ['start', 'click', 'fill', 'press', 'dblclick', 'scroll', 'mark', 'press']
  );
  assert.equal(steps[0].url, 'https://app.test/home?x', 'a redirect right after start moves the start');
  assert.equal(steps[1].navigates, 'https://app.test/people');
  assert.equal(steps[1].lands, 'People · App');
  assert.equal(steps[1].shot, 'shots/001.jpg');
  assert.equal(steps[2].value, 'Frontend');
  assert.equal(steps[5].toY, 900);
  assert.equal(steps.at(-1).count, 2);
  assert.ok(!steps.some((s) => s.target?.name === 'Settings'), 'paused clicks are dropped');
  assert.equal(removed[0].target.name, 'Oops');
  assert.ok(stats.idleSec > 5, 'the 7 s pause before typing counts as idle');
  assert.ok(stats.activeSec < stats.wallSec);
});

test('locators prefer test ids, then role + name, and disambiguate duplicates', () => {
  assert.equal(locatorFor({ testid: 'save', role: 'button', name: 'Save' }), 'page.getByTestId("save").first()');
  assert.equal(locatorFor({ role: 'tab', name: 'Reports', matches: 1 }), 'page.getByRole("tab", { name: "Reports", exact: true }).first()');
  assert.equal(locatorFor({ role: 'button', name: 'Edit', matches: 3, nth: 2 }), 'page.getByRole("button", { name: "Edit", exact: true }).nth(2)');
  assert.equal(locatorFor({ tag: 'canvas', role: 'canvas', canvas: 1 }), "page.locator('canvas').nth(1)");
  assert.equal(locatorFor({ tag: 'input', role: 'password', label: 'Password' }), 'page.getByLabel("Password", { exact: true }).first()');
  assert.equal(locatorFor({ tag: 'div', role: 'generic', name: 'icon: td:dashboard', css: 'nav > div:nth-of-type(2)' }), 'page.locator("nav > div:nth-of-type(2)").first()');
  assert.match(describeStep({ type: 'fill', secret: true, target: { role: 'password', tag: 'input', label: 'Password' } }), /not stored/);
});

test('replay targets the captured duplicate by point and keeps pixel offsets at the same size', () => {
  const edit = { role: 'button', name: 'Edit', matches: 3, nth: 2, point: { x: 610, y: 40 } };
  assert.equal(targetFor(edit, { matched: true, step: 's4' }), 'await near(page.getByRole("button", { name: "Edit", exact: true }), { x: 610, y: 40, nth: 2, step: "s4" })');
  assert.equal(targetFor(edit, { step: 's4' }), 'await near(page.getByRole("button", { name: "Edit", exact: true }), { nth: 2, step: "s4" })', 'a different window: the index, not the point');
  assert.equal(targetFor({ tag: 'canvas', canvas: 0, point: { x: 5, y: 5 } }, { matched: true }), `await near(page.locator('canvas').nth(0), { x: 5, y: 5, step: "" })`);

  const boxes = [{ x: 0, y: 0, width: 80, height: 30 }, null, { x: 600, y: 30, width: 80, height: 30 }, { x: 590, y: 20, width: 300, height: 200 }];
  assert.equal(pickNearest(boxes, 610, 40), 2, 'inside two boxes: the smaller, more specific one');
  assert.equal(pickNearest(boxes, 10, 300), 0);
  assert.equal(pickNearest([null, { x: 0, y: 0, width: 0, height: 0 }], 1, 1), -1);

  const calendar = { w: 1469, h: 737 };
  const same = spot({ width: 1469, height: 737 }, calendar, { fx: 0.42, fy: 0.5 });
  assert.equal(Math.round(same.x), 617);
  assert.equal(same.k, 1, 'same size: drag deltas are not rescaled');
  const wider = spot({ width: 1880, height: 900 }, calendar, { fx: 0.42, fy: 0.5 });
  assert.equal(Math.round(wider.x), 790);
  assert.ok(Math.abs(wider.k - 1880 / 1469) < 1e-9);

  assert.equal(viewportFit({ width: 1920, height: 1080 }, { sw: 3000, sh: 2000, cw: 0, ch: 80 }), 1);
  const s = viewportFit({ width: 1920, height: 1080 }, { sw: 1728, sh: 1079, cw: 0, ch: 87 });
  assert.ok(s < 0.9 && 1080 * s + 87 <= 1079 - 40 && 1920 * s <= 1728 - 40, `fit ${s}`);
  assert.ok(viewportMatched({ window: { w: 1920, h: 1080, scale: 0.8 }, recordViewport: { width: 1920, height: 1080 } }));
  assert.ok(!viewportMatched({ window: { w: 1511, h: 873 }, recordViewport: { width: 1920, height: 1080 } }));
});

test('near() waits for a visible match and refuses to skip a step silently', { timeout: 30000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
    await page.setContent(`<button style="display:none">Edit</button><button style="margin-left:20px">Edit</button><button style="margin-left:400px">Edit</button>
      <script>setTimeout(() => { const b = document.createElement('button'); b.textContent = 'Later'; document.body.append(b); }, 400)</script>`);
    const edit = page.getByRole('button', { name: 'Edit' });
    const far = await edit.nth(1).boundingBox();
    const picked = await near(edit, { x: far.x + 5, y: far.y + 5 });
    assert.equal(await picked.evaluate((el) => el.style.marginLeft), '400px');
    assert.equal(await (await near(edit, {})).evaluate((el) => el.style.marginLeft), '20px', 'no point: the first visible, not a hidden one');
    await near(page.getByRole('button', { name: 'Later' }), { timeout: 3000 });
    await assert.rejects(near(page.getByRole('button', { name: 'Missing' }), { timeout: 600, step: 's9' }), /Guided step s9: no visible match/);
  } finally {
    await browser.close();
  }
});

const FIXTURE = `<!doctype html><html><head><title>Fixture App</title><style>
  body{margin:0;font:14px sans-serif} nav{display:flex;gap:8px;padding:8px;background:#eee}
  .has-menu{position:relative} #menu{display:none;position:absolute;top:100%;left:0} .has-menu:hover #menu{display:block}
  #list{height:120px;overflow:auto;border:1px solid #ccc} #list div{height:40px}
  canvas{display:block;margin:12px 0;border:1px solid #000}
  .spacer{height:1600px}
</style></head><body>
<nav><a href="/people" id="nav-people">People</a><a href="/projects">Projects</a>
  <span class="has-menu"><button id="more">More</button><div id="menu"><button id="export">Export</button></div></span></nav>
<main>
  <h1 id="h">Home</h1>
  <label>Search <input id="q" name="q" /></label>
  <select id="role" aria-label="Role"><option value="">Any</option><option value="fe">Frontend</option><option value="qa">QA</option></select>
  <label><input type="checkbox" id="avail" /> Available only</label>
  <button id="apply">Apply</button> <button id="hello">Hello</button>
  <span class="eds"><button class="ed" data-i="1">Edit</button> <button class="ed" data-i="2">Edit</button></span>
  <button id="pen" aria-label=""><md-icon aria-hidden="true">edit</md-icon></button>
  <p id="out"></p>
  <div id="list">${Array.from({ length: 20 }, (_, i) => `<div>Row ${i + 1}</div>`).join('')}</div>
  <canvas id="c" width="400" height="200"></canvas>
  <p id="drag"></p>
  <div class="spacer"></div>
</main>
<script>
  const out = document.getElementById('out');
  document.querySelectorAll('nav a').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault(); history.pushState({}, '', a.getAttribute('href')); document.getElementById('h').textContent = a.textContent;
  }));
  document.getElementById('export').onclick = () => (out.dataset.exported = '1');
  document.getElementById('hello').onclick = () => (out.dataset.hello = '1');
  document.getElementById('pen').onclick = () => (out.dataset.pen = '1');
  document.querySelectorAll('.ed').forEach((b) => (b.onclick = () => (out.dataset.edited = b.dataset.i)));
  document.getElementById('apply').onclick = () => {
    out.textContent = [document.getElementById('q').value, document.getElementById('role').value, document.getElementById('avail').checked].join('|');
  };
  const c = document.getElementById('c'); let s = null;
  c.addEventListener('pointerdown', (e) => (s = { x: e.offsetX, y: e.offsetY }));
  c.addEventListener('pointerup', (e) => { if (s) document.getElementById('drag').textContent = Math.round(e.offsetX - s.x) + ',' + Math.round(e.offsetY - s.y); s = null; });
</script></body></html>`;

test('a shown tour is captured end to end and the compiled flow replays it', { timeout: 90000 }, async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(FIXTURE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const root = mkdtempSync(join(tmpdir(), 'wt-guide-'));
  const video = { slug: 'guide-fixture', dir: root, out: join(root, 'out'), config: { record: { startUrl: `${base}/`, viewport: { width: 1280, height: 720 } }, env: {} } };
  const logs = [];
  try {
    let pausedAt = 0;
    let resumedAt = 0;
    const panelSeen = {};
    const tour = await runGuidedTour(video, {
      headless: true,
      countdownMs: 0,
      say: (m) => logs.push(m),
      onOpen: async ({ page, state }) => {
        assert.equal(state.mode, 'connecting');
        await page.locator('#hello').click();
        await page.waitForTimeout(400);
      },
      onReady: async ({ page, controls, state }) => {
        const settle = (ms = 650) => page.waitForTimeout(ms);
        const until = async (mode) => {
          for (let i = 0; i < 200 && state.mode !== mode; i++) await page.waitForTimeout(50);
          assert.equal(state.mode, mode);
        };
        const press = (name) => controls.getByRole('button', { name, exact: true }).click();
        await until('ready');
        panelSeen.ready = await controls.locator('h1').textContent();
        // Looking around before Start recording is never part of the tour.
        await page.locator('#hello').click();
        await settle();
        await press('Start recording');
        await until('capturing');
        panelSeen.recording = await controls.locator('h1').textContent();
        await page.getByRole('link', { name: 'People' }).click();
        await settle();
        await page.locator('#q').click();
        await page.keyboard.type('Frontend dev', { delay: 15 });
        await settle(1700);
        // A person's choice is trusted input; selectOption() dispatches synthetic events.
        await page.locator('#role').focus();
        await page.keyboard.type('F');
        await settle();
        await page.locator('#avail').check();
        await settle();
        await page.locator('#more').hover();
        await settle(1300);
        await page.locator('#export').click();
        await settle();
        await page.locator('.ed').nth(1).click();
        await settle();
        await page.locator('#pen').click();
        await settle();
        // A detour the reviewer takes back.
        await page.locator('#h').click();
        await settle();
        await press('Undo last step');
        await settle();
        pausedAt = Date.now();
        await press('Pause');
        await until('paused');
        panelSeen.paused = await controls.locator('h1').textContent();
        await page.locator('#apply').click(); // paused: must not be captured
        await settle(1400);
        resumedAt = Date.now();
        await press('Resume recording');
        await until('capturing');
        await settle();
        await press('Mark chapter');
        await controls.getByPlaceholder(/Plan the week/).fill('Shape the plan');
        await controls.getByRole('button', { name: 'Add chapter' }).click();
        await settle();
        panelSeen.hold = await controls.locator('#hold').isVisible();
        await page.locator('#list').hover();
        await page.mouse.wheel(0, 200);
        await settle(900);
        const box = await page.locator('#c').boundingBox();
        await page.mouse.move(box.x + 50, box.y + 50);
        await page.mouse.down();
        for (let i = 1; i <= 12; i++) {
          await page.mouse.move(box.x + 50 + i * 10, box.y + 50 + (i * 40) / 12);
          await page.waitForTimeout(25);
        }
        await page.mouse.up();
        await settle();
        await page.locator('#apply').click();
        await settle();
        await page.keyboard.press('Escape');
        await settle(900);
        await press('Finish recording');
      },
    });

    assert.deepEqual(panelSeen, { ready: 'Get ready', recording: 'Recording', paused: 'Paused — not recording', hold: true });
    const types = tour.steps.map((s) => s.type);
    assert.deepEqual(types, ['start', 'click', 'fill', 'select', 'check', 'hover', 'click', 'click', 'click', 'mark', 'scroll', 'drag', 'click', 'press'], `${types.join(',')}\n${JSON.stringify(tour.steps.map((s) => [s.type, s.at, s.target?.tag, s.target?.point, s.detail]))}`);
    const [, nav, fill, select, check, hover, exp, edit, pen, mark, scroll, drag] = tour.steps;
    assert.equal(pen.target.name, 'icon: edit', 'an aria-hidden icon ligature is a hint, not an accessible name');
    assert.ok(!tour.steps.some((s) => s.target?.name === 'Hello'), 'clicks before Start recording are not part of the tour');
    assert.ok(viewportMatched(tour), 'the tour is laid out at the recording viewport');
    assert.equal(edit.target.matches, 2);
    assert.equal(edit.target.nth, 1);
    assert.equal(nav.target.name, 'People');
    assert.match(nav.navigates, /\/people$/);
    assert.equal(fill.value, 'Frontend dev');
    assert.equal(fill.target.label, 'Search');
    assert.equal(select.label, 'Frontend');
    assert.equal(check.checked, true);
    assert.equal(hover.target.name, 'More');
    assert.equal(hover.revealed, true);
    assert.equal(exp.target.name, 'Export');
    assert.equal(mark.title, 'Shape the plan');
    assert.equal(scroll.target.css, '#list');
    assert.ok(scroll.toY > 100);
    assert.equal(drag.target.canvas, 0);
    assert.ok(drag.path.length > 3);
    assert.equal(tour.removed.length, 1, 'the undone detour is kept aside');
    assert.ok(!tour.steps.some((s) => s.type === 'click' && s.target?.css === '#apply' && s.at < mark.at), 'paused click dropped');
    assert.ok(tour.steps.some((s) => s.shot), 'screenshots are attached to steps');

    const md = readFileSync(join(root, 'guided-tour.md'), 'utf8');
    assert.match(md, /### ◆ Shape the plan/);
    assert.match(md, /Undone by the reviewer/);
    assert.equal(md, tourToMarkdown(tour));

    // The reviewer's own take: filmed from Start recording, the pause cut out, chapters and clicks on its clock.
    const take = JSON.parse(readFileSync(join(video.out, 'guide', 'take.json'), 'utf8'));
    const fileSec = duration(join(video.out, 'guide', 'take.mp4'));
    assert.ok(Math.abs(fileSec - take.seconds) < 0.15, `file ${fileSec}s vs take ${take.seconds}s`);
    assert.equal(take.cuts.length, 1);
    const cutSec = (resumedAt - pausedAt) / 1000;
    assert.ok(Math.abs(take.cuts[0].dur - cutSec) < 0.4, `cut ${take.cuts[0].dur}s vs paused ${cutSec}s`);
    assert.deepEqual(tour.take, { seconds: take.seconds, cuts: 1, cutSec: Number(take.cuts[0].dur.toFixed(1)), chapters: 2, file: 'guide/take.mp4' });
    assert.deepEqual(take.viewport, { width: 1280, height: 720 });
    assert.equal(take.tourFinishedAt, tour.finishedAt);
    const chaptersOnTake = take.timeline.filter((m) => m.kind === 'chapter');
    assert.deepEqual(chaptersOnTake.map((m) => m.label), ['Fixture App', 'Shape the plan']);
    assert.ok(chaptersOnTake[1].t > take.cuts[0].at, 'the chapter after the pause sits after the cut');
    assert.ok(chaptersOnTake[1].t < take.seconds, 'and inside the take');
    const clicks = take.timeline.filter((m) => m.kind === 'click');
    assert.ok(clicks.length >= 5 && clicks.every((m) => m.rect && m.t >= 0 && m.t <= take.seconds));
    const status = JSON.parse(readFileSync(join(video.out, 'guide', 'status.json'), 'utf8'));
    assert.equal(status.state, 'done');
    assert.equal(status.take.seconds, take.seconds);

    // Replay the compiled flow on a fresh page and check the app ends up where the reviewer left it.
    const src = compileGuidedFlow(tour, { startUrl: `${base}/` });
    writeFileSync(join(root, 'replay.mjs'), src);
    const { default: flow } = await import(pathToFileURL(join(root, 'replay.mjs')).href);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto(`${base}/`);
      const chapters = [];
      await flow({
        page,
        wait: (ms) => page.waitForTimeout(Math.min(ms, 150)),
        settle: async () => page.waitForTimeout(100),
        chapter: async (title) => chapters.push(title),
        actions: { hide: async () => {}, show: async () => {} },
        near,
        spot,
        typeInto: async (loc, value) => {
          await loc.click();
          await loc.fill(value);
        },
      });
      assert.deepEqual(chapters, ['Fixture App', 'Shape the plan']);
      assert.match(page.url(), /\/people$/);
      assert.equal(await page.locator('#out').textContent(), 'Frontend dev|fe|true');
      assert.equal(await page.locator('#out').getAttribute('data-exported'), '1');
      assert.equal(await page.locator('#out').getAttribute('data-hello'), null);
      assert.equal(await page.locator('#out').getAttribute('data-edited'), '2', 'the second Edit, as shown');
      assert.equal(await page.locator('#out').getAttribute('data-pen'), '1');
      assert.ok((await page.locator('#list').evaluate((el) => el.scrollTop)) > 100);
      const [dx, dy] = (await page.locator('#drag').textContent()).split(',').map(Number);
      assert.ok(Math.abs(dx - 120) <= 6 && Math.abs(dy - 40) <= 6, `drag replayed ${dx},${dy}`);
    } finally {
      await browser.close();
    }
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a phone profile tours the mobile layout and records taps', { timeout: 60000 }, async () => {
  const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phone App</title></head><body>
<button id="menu">Menu</button><input id="q" aria-label="Search"><p id="out"></p>
<script>
  const out = document.getElementById('out');
  out.dataset.width = innerWidth;
  out.dataset.coarse = matchMedia('(pointer: coarse)').matches;
  out.dataset.ua = /iPhone/.test(navigator.userAgent);
  document.getElementById('menu').addEventListener('touchend', () => (out.dataset.touched = '1'));
</script></body></html>`;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const root = mkdtempSync(join(tmpdir(), 'wt-guide-phone-'));
  const video = { slug: 'guide-phone', dir: root, out: join(root, 'out'), config: { record: { startUrl: `${base}/`, viewport: { width: 390, height: 844 }, device: { preset: 'iphone-15' } }, env: {} } };
  try {
    let seen = null;
    const tour = await runGuidedTour(video, {
      headless: true,
      countdownMs: 0,
      say: () => {},
      onReady: async ({ page, control, state }) => {
        await control('start');
        assert.equal(state.mode, 'capturing');
        await page.locator('#menu').tap();
        await page.waitForTimeout(650);
        await page.locator('#q').tap();
        await page.keyboard.type('shoes', { delay: 15 });
        await page.waitForTimeout(1700);
        seen = await page.locator('#out').evaluate((el) => ({ ...el.dataset }));
        await control('finish');
      },
    });
    assert.deepEqual(seen, { width: '390', coarse: 'true', ua: 'true', touched: '1' }, 'mobile layout, coarse pointer, iPhone UA, touch events from a tap');
    assert.deepEqual(tour.recordViewport, { width: 390, height: 844 });
    assert.equal(tour.capture.id, 'iphone-15');
    assert.equal(tour.capture.touch, true);
    const types = tour.steps.map((s) => s.type);
    assert.deepEqual(types, ['start', 'click', 'fill'], JSON.stringify(tour.steps.map((s) => [s.type, s.target?.name])));
    assert.equal(tour.steps[1].target.name, 'Menu');
    assert.equal(tour.steps[2].value, 'shoes');
    assert.match(readFileSync(join(root, 'guided-tour.md'), 'utf8'), /Device: iPhone · 390×844 \(mobile layout, touch/);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a take with no clicks is kept for the reviewer, and a cancelled session keeps the last take', { timeout: 60000 }, async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>Still App</title><h1>Overview</h1>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const root = mkdtempSync(join(tmpdir(), 'wt-guide-still-'));
  const video = { slug: 'guide-still', dir: root, out: join(root, 'out'), config: { record: { startUrl: `http://127.0.0.1:${server.address().port}/`, viewport: { width: 800, height: 500 } }, env: {} } };
  writeFileSync(join(root, 'guided-flow.mjs'), '// an older replay\n');
  try {
    const shown = await runGuidedTour(video, {
      headless: true,
      countdownMs: 0,
      say: () => {},
      onReady: async ({ page, control }) => {
        await control('start');
        await control('mark', { title: 'Overview' });
        await page.waitForTimeout(1600);
        await control('finish');
      },
    });
    assert.equal(shown.stats.steps, 0);
    assert.ok(shown.take?.seconds >= 1, 'the footage is kept even without clicks');
    assert.ok(existsSync(join(root, 'out', 'guide', 'take.mp4')));
    assert.equal(JSON.parse(readFileSync(join(root, 'guided-tour.json'), 'utf8')).finishedAt, shown.finishedAt);
    assert.ok(!existsSync(join(root, 'guided-flow.mjs')), 'an older replay must not pair with this take');

    const cancelled = await runGuidedTour(video, { headless: true, countdownMs: 0, say: () => {}, onReady: ({ control }) => control('cancel') });
    assert.equal(cancelled.finishReason, 'cancelled');
    assert.ok(existsSync(join(root, 'out', 'guide', 'take.mp4')), 'the last take survives a cancelled session');
    assert.equal(JSON.parse(readFileSync(join(root, 'out', 'guide', 'take.json'), 'utf8')).tourFinishedAt, shown.finishedAt);
    assert.ok(!existsSync(join(root, 'out', 'guide.prev')));
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
