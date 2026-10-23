/**
 * Headless smoke for Walkthrough Studio. Read-only apart from one narration line that is edited
 * and restored. Screenshots land in --shots (default /tmp/studio-smoke).
 *   node studio/smoke.mjs [--port 4747] [--slug walkthrough-studio] [--shots dir]
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { lineTakeFiles } from '../lib/audio/voice.mjs';
import { loadVideo, VIDEOS } from '../lib/project.mjs';
import { ATMOSPHERE_IDS } from '../lib/plateMotion.mjs';

const arg = (name, fallback) => process.argv.find((a, i, arr) => arr[i - 1] === name) || fallback;
const port = Number(arg('--port', 4747));
const slug = arg('--slug', 'walkthrough-studio');
const shots = arg('--shots', '/tmp/studio-smoke');
const base = `http://127.0.0.1:${port}`;
mkdirSync(shots, { recursive: true });

const fails = [];
const ok = (name) => console.log(`  ✓ ${name}`);
const bad = (name, detail) => {
  fails.push(`${name}: ${detail}`);
  console.error(`  ✗ ${name}: ${detail}`);
};
const check = (cond, name, detail = '') => (cond ? ok(name) : bad(name, detail || 'failed'));
/** Dialogs and steps animate in; let them settle before a screenshot. */
const settle = () => new Promise((r) => setTimeout(r, 380));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

try {
  const health = await fetch(`${base}/api/health`)
    .then((r) => r.json())
    .catch((err) => {
      throw new Error(
        `Studio not reachable at ${base} — start it with \`node cli.mjs studio --port ${port}\` (${err.cause?.message || err.message})`
      );
    });
  check(health.ok, 'api/health', JSON.stringify(health));

  await page.goto(`${base}/?slug=${encodeURIComponent(slug)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#bootLoader', { state: 'detached' });
  await page.waitForSelector('#title', { state: 'attached' });
  await page.waitForFunction(() => document.querySelector('#stageBar .pstage[data-stage="script"]')?.dataset.tone);
  check((await page.locator('#title').textContent())?.trim(), 'title loaded');
  check((await page.locator('#btnBranch').count()) === 1, 'Branch button in chrome');
  const branchIdeas = await fetch(`${base}/api/video/${encodeURIComponent(slug)}/branch/ideas`).then((r) => r.json());
  check(Array.isArray(branchIdeas.ideas) && branchIdeas.ideas.length > 0, `branch ideas · ${branchIdeas.ideas?.length || 0}`);
  await page.screenshot({ path: join(shots, '01-studio.png') });

  const tones = await page.$$eval('#stageBar .pstage', (els) => els.map((e) => `${e.dataset.stage}:${e.dataset.tone}`));
  check(tones.length === 6 && tones.every((t) => !t.endsWith(':undefined')), `stage bar · ${tones.join(' ')}`);

  // Script sheet
  await page.click('#stageBar .pstage[data-stage="script"]');
  // Opening starts collapsed, so the first scene can be hidden — wait for the list, not for it.
  await page.waitForSelector('#scriptScenes .script-scene', { state: 'attached' });
  const scenes = await page.locator('#scriptScenes .script-scene').count();
  check(scenes > 3, `script sheet · ${scenes} scenes`);
  check((await page.locator('#scriptTotals').textContent())?.includes('chapters'), 'script totals');
  const grips = await page.locator('#scriptScenes [data-drag-handle]').count();
  check(grips >= 1, `script drag grips · ${grips}`);
  check(await page.locator('#scriptJump:not([hidden])').count(), 'script jump nav visible');
  const sectionBtns = await page.locator('#scriptScenes [data-section-toggle]').count();
  check(sectionBtns >= 2, `script section toggles · ${sectionBtns}`);
  // Every section starts folded: open Opening (the intro line below) and Story first.
  await page.click('#scriptScenes [data-section-toggle="opening"]');
  await page.click('#scriptScenes [data-section-toggle="story"]');
  const beforeCollapse = await page.locator('#scriptScenes .script-scene:not([hidden])').count();
  await page.click('#scriptScenes [data-section-toggle="story"]');
  const afterCollapse = await page.locator('#scriptScenes .script-scene:not([hidden])').count();
  check(afterCollapse < beforeCollapse, `story collapse hides beats · ${beforeCollapse}→${afterCollapse}`);
  await page.click('#scriptScenes [data-section-toggle="story"]');
  check(
    (await page.locator('#scriptScenes .script-scene:not([hidden])').count()) === beforeCollapse,
    'story expand restores beats'
  );
  check((await page.locator('#scriptScenes .ss-drag-spacer').count()) === 0, 'no empty drag spacers');
  await settle();
  await page.screenshot({ path: join(shots, '02-script.png') });

  // Narration round-trip on the intro line
  const intro = page.locator('#scriptScenes textarea[data-nk="intro"]');
  const original = await intro.inputValue();
  const narrationFile = join(VIDEOS, slug, 'narration.mjs');
  const { atime, mtime } = statSync(narrationFile);
  await intro.fill(`${original} (smoke)`);
  await intro.blur();
  await page.waitForFunction(
    (t) => document.querySelector('#scriptScenes textarea[data-nk="intro"]')?.value === t,
    `${original} (smoke)`
  );
  const saved = await fetch(`${base}/api/video/${slug}/script`).then((r) => r.json());
  check(saved.script.scenes[0].narration.endsWith('(smoke)'), 'narration saved to narration.mjs');
  await fetch(`${base}/api/video/${slug}/script/line`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'intro', key: 'intro', text: original }),
  });
  const restored = await fetch(`${base}/api/video/${slug}/script`).then((r) => r.json());
  check(restored.script.scenes[0].narration === original, 'narration restored');
  // Keep freshness untouched — a restored file must not mark the delivery stale.
  utimesSync(narrationFile, atime, mtime);

  await page.check('#scriptOnlyIssues');
  const visible = await page.locator('#scriptScenes .script-scene:not([hidden])').count();
  check(visible <= scenes, `issue filter · ${visible} shown`);
  await page.keyboard.press('Escape');

  // Cut sheet (only when a delivery exists)
  const summary = await fetch(`${base}/api/video/${slug}`).then((r) => r.json());
  if (summary.hasDelivery) {
    await page.click('#stageBar .pstage[data-stage="cut"]');
    await page.waitForSelector('#cutDialog[open]');
    check((await page.locator('#cutFacts div').count()) >= 5, 'cut review facts');
    await settle();
    await page.screenshot({ path: join(shots, '03-cut.png') });
    await page.keyboard.press('Escape');
  }

  // Transitions control
  await page.click('.tools-panel .ptab[data-right="motion"]');
  const active = await page.locator('#transitionGrid [data-transition].active').getAttribute('data-transition');
  check(active === summary.transitions?.style, `transition control · ${active}`);
  // A custom scale (hand-set colours) has no preset card to mark.
  const custom = summary.direction?.scale === 'custom';
  const palette = custom ? 'custom' : await page.locator('#paletteGrid [data-palette].active').getAttribute('data-palette');
  if (custom) check((await page.locator('#paletteGrid [data-palette].active').count()) === 0, 'direction scale · custom, no preset marked');
  const focus = await page.locator('#focusGrid [data-focus].active').getAttribute('data-focus');
  check(palette === summary.direction?.scale, `direction scale · ${palette}`);
  check(focus === summary.direction?.focus, `direction focus · ${focus}`);
  check((await page.locator('#paletteGrid .scale-swatches i').count()) >= 10, 'five-color scale suggestions');
  check((await page.locator('#scaleEditor input[type="color"]').count()) === 5, 'five settable colors');
  check((await page.locator('#logoGrid [data-logo]').count()) >= 1, 'captured logo choices');
  const zoom = await page.locator('[data-camera="zoom"] .active').getAttribute('data-value');
  const pointer = await page.locator('[data-cursor="style"] .active').getAttribute('data-value');
  check(zoom === summary.direction?.camera?.zoom, `auto zoom control · ${zoom}`);
  check(pointer === summary.direction?.cursor?.style, `cursor control · ${pointer}`);
  const paceChecked = await page.locator('#paceSeg input:checked').getAttribute('value');
  check((await page.locator('#paceSeg input').count()) >= 4 && paceChecked === summary.direction?.pace?.id, `live pace control · ${paceChecked}`);
  check((await page.locator('#paceMeta').textContent())?.includes('×'), 'live pace tempo readout');
  check((await page.locator('#lookPresets [data-look]').count()) >= 4, 'reusable look presets');
  check(await page.locator('#lookPreview').isVisible(), 'live look preview');
  check(
    (await page.locator('#backgroundRow').isHidden()) === (summary.direction?.camera?.frame !== 'inset'),
    'frame background shows only for inset'
  );
  const presetCount = await page.locator('#exportPresets input[type="checkbox"]').count();
  check(presetCount === Object.keys(summary.exportPresets || {}).length && presetCount >= 4, `export formats · ${presetCount}`);
  // Story spine + critic findings (Review)
  await page.click('.tools-panel .ptab[data-right="review"]');
  const purposeCount = await page.locator('#storyPurpose input[name="storyPurpose"]').count();
  const purposeChecked = await page.locator('#storyPurpose input:checked').getAttribute('value');
  check(purposeCount === 5 && purposeChecked === summary.story?.purpose, `story purpose · ${purposeChecked}`);
  check((await page.locator('#storySpine li').count()) === (summary.story?.beats || []).length, 'story spine beats');
  check((await page.locator('#storyFramework').textContent())?.includes('→'), 'story framework');
  const storyCheck = await fetch(`${base}/api/video/${slug}/story/check`).then((r) => r.json());
  check(storyCheck.purpose === summary.story?.purpose && Array.isArray(storyCheck.findings), `story check · ${storyCheck.findings?.length} finding(s)`);
  check(await page.locator('#btnCriticRun').isVisible(), 'critic run button');
  if (summary.critic) check((await page.locator('#criticFindings .critic-item, #criticFindings .empty-inline').count()) >= 1, 'critic findings rendered');
  await page.screenshot({ path: join(shots, '03c-review-story.png') });
  check(Array.isArray(summary.motionOptions?.atmospheres) && summary.motionOptions.atmospheres.length === ATMOSPHERE_IDS.length, 'motion options for plate accents');

  await page.click('.tools-panel .ptab[data-right="deliver"]');
  await page.check('#reelToggle');
  check(await page.locator('#safeAreaOverlay').isVisible(), 'vertical reel safe-area preview');
  await page.uncheck('#reelToggle');
  await page.click('.tools-panel .ptab[data-right="motion"]');
  await page.keyboard.press('Meta+K');
  check(await page.locator('#commandDialog').evaluate((d) => d.open), 'command menu opens with ⌘K');
  await page.fill('#commandInput', 'direction');
  check((await page.locator('#commandList [data-command]:visible').count()) === 1, 'command menu filters');
  await page.keyboard.press('Escape');
  await settle();
  await page.screenshot({ path: join(shots, '03b-direction.png') });

  // Timeline shows real edit regions + transition markers
  const xfades = await page.locator('#timelineRegions .tl-xfade').count();
  check(!summary.hasDelivery || xfades > 0, `timeline transitions · ${xfades}`);

  // Quiet states: every empty surface draws from the shared kit (art + big line + small line)
  check((await page.locator('#renderLiveCard.is-idle .zen-slot svg .z-weed').count()) === 1, 'idle activity shows the tumbleweed');
  check((await page.locator('#queueEmpty.zen.mini .zen-title').count()) === 1, 'empty queue is a quiet state');
  check((await page.locator('#sessionProgress.is-idle #sessionArt svg').count()) === 1, 'idle agent rail shows its art');
  check((await page.locator('.render-section-label .sec-ico, .media-label .sec-ico').count()) >= 6, 'section labels carry icons');
  await page.click('.tools-panel .ptab[data-right="inspector"]');
  check((await page.locator('#inspectorRoot .zen [data-open-editor]').count()) === 1, 'program inspector offers Open the Editor');
  await page.click('.tools-panel .ptab[data-right="feedback"]');

  // Editor: one stage, one transport, one timeline; plate inspector with live CSS variables
  const deck = await fetch(`${base}/api/video/${slug}/edit`).then((r) => r.json());
  check(deck.deck && Array.isArray(deck.scenes) && Array.isArray(deck.styleGroups) && deck.styleGroups.length >= 3, 'edit deck endpoint');
  check(deck.scenes.filter((x) => x.kind === 'live').every((x) => x.recTo > x.recFrom), 'live clips carry recording ranges');
  check((await page.locator('#modePlate').textContent())?.trim() === 'Editor', 'editor mode tab');
  await page.click('#modePlate');
  await page.waitForSelector('#etlClips .etl-clip');
  const clips = await page.$$eval('#etlClips .etl-clip', (els) => els.map((e) => (e.classList.contains('live') ? 'live' : 'plate')));
  check(clips.includes('plate') && (!deck.live?.exists || clips.includes('live')), `unified timeline · ${clips.length} clips`);
  check(
    await page.evaluate(() => ['timeline', 'sceneBar', 'platePicker'].every((id) => getComputedStyle(document.getElementById(id)).display === 'none')),
    'editor hides the program timeline, scene chips and clip strip'
  );
  check((await page.locator('#etlClips .etl-join').count()) === clips.length - 1, 'a transition marker on every join');
  await page.frameLocator('#plateFrame').locator('body[data-motion="1"]').waitFor();
  await page.click('#edPlay');
  await page.waitForTimeout(1200);
  const playedTo = await page.evaluate(() => parseFloat(document.getElementById('edClock').textContent.split(':')[1]));
  await page.click('#edPlay');
  check(playedTo >= 0.6, `editor plays the cut · ${playedTo}s`);
  await page.click('#edPlay');
  const clockSec = () => page.evaluate(() => parseFloat(document.getElementById('edClock').textContent.split(':')[1]));
  const again = await clockSec();
  // Headless playback can run slower than the wall clock; wait for the progress rather than for time.
  const resumed = await page
    .waitForFunction((from) => parseFloat(document.getElementById('edClock').textContent.split(':')[1]) > from + 0.3, again, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  const later = await clockSec();
  await page.click('#edPlay');
  check(resumed, `editor play starts again · ${again.toFixed(1)}s → ${later.toFixed(1)}s`);
  if (summary.hasDelivery) {
    await page.click('#modeProgram');
    await page.click('#btnPlay');
    await page.waitForFunction(() => document.getElementById('player').currentTime > 0.25, null, { timeout: 8000 });
    check((await page.locator('#btnPlay').getAttribute('class')).includes('is-playing'), 'program play shows pause');
    await page.click('#btnPlay');
    check(await page.evaluate(() => document.getElementById('player').paused), 'program pause stops the video');
    await page.click('#modePlate');
    await page.waitForSelector('#etlClips .etl-clip');
  }
  await page.click('#etlClips .etl-clip.plate');
  await page.click('.tools-panel .ptab[data-right="inspector"]');
  await page.waitForSelector('#inspectorRoot .var-row', { state: 'attached' });
  await page.waitForFunction(() => {
    const gold = document.querySelector('#inspectorRoot [data-var-color="--gold"]');
    return gold && gold.value !== '#000000';
  });
  const varRows = await page.locator('#inspectorRoot .var-row').count();
  check(varRows >= 12, `inspector reads live plate variables · ${varRows}`);
  check((await page.locator('#inspectorRoot .ins-join').count()) >= 1, 'inspector lists the plate joins');
  check(
    await page.evaluate(() => {
      const tabs = document.querySelector('.tools-panel .panel-tabs');
      return tabs.scrollWidth <= tabs.clientWidth + 1 && tabs.parentElement.scrollLeft === 0;
    }),
    'right panel tabs fit without shifting the panel'
  );
  // Canvas click-to-edit: motion stage → click a field → enter text mode focused on it.
  await page.frameLocator('#plateFrame').locator('body[data-motion="1"]').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('#inspectorRoot [data-field]').length >= 1);
  check((await page.locator('#inspectorRoot [data-field]').count()) >= 1, 'inspector lists editable fields as chips');
  check(await page.locator('#edTextBar.is-coach').isVisible(), 'coach bar invites clicking text on the plate');
  await page.frameLocator('#plateFrame').locator('[data-edit="title"]').click({ force: true });
  await page.waitForFunction(
    () => {
      const doc = document.getElementById('plateFrame')?.contentDocument;
      const title = doc?.querySelector('[data-edit="title"]');
      return (
        doc?.body?.classList.contains('studio-edit') &&
        title?.isContentEditable &&
        title.classList.contains('is-focused') &&
        doc.activeElement === title
      );
    },
    null,
    { timeout: 10000 }
  );
  check(await page.locator('#edTextBar.is-editing').isVisible(), 'canvas click enters text editing');
  check((await page.locator('#edEditText span').textContent()) === 'Done', 'transport shows Done after canvas click');
  check(
    await page.evaluate(() => {
      const doc = document.getElementById('plateFrame').contentDocument;
      const title = doc.querySelector('[data-edit="title"]');
      return title?.classList.contains('is-focused') && doc.activeElement === title;
    }),
    'canvas click focuses the title field'
  );
  await page.waitForSelector('#inspectorRoot [data-field="title"].on', { timeout: 5000 });
  check(await page.locator('#inspectorRoot [data-field="title"].on').count() === 1, 'inspector chip mirrors the focused field');
  check(await page.locator('#inspectorRoot [data-field-src]').isVisible(), 'inspector shows a live copy textarea');
  await page.click('#edTextBar [data-text="done"]');
  await page.frameLocator('#plateFrame').locator('body[data-motion="1"]').waitFor();
  check((await page.locator('#edEditText span').textContent()) === 'Edit text', 'Done after canvas edit restores Edit text');
  // Field chip also opens text mode on that path.
  await page.click('#inspectorRoot [data-field="title"]');
  await page.waitForFunction(
    () => {
      const title = document.getElementById('plateFrame')?.contentDocument?.querySelector('[data-edit="title"]');
      return title?.isContentEditable && title.classList.contains('is-focused');
    },
    null,
    { timeout: 10000 }
  );
  check(
    await page.evaluate(() => document.getElementById('plateFrame').contentDocument.querySelector('[data-edit="title"]')?.classList.contains('is-focused')),
    'field chip focuses the matching stage field'
  );
  await page.click('#edTextBar [data-text="done"]');
  await page.frameLocator('#plateFrame').locator('body[data-motion="1"]').waitFor();
  await page.click('#edEditText');
  await page.frameLocator('#plateFrame').locator('body.studio-edit [contenteditable]').first().waitFor();
  check(await page.locator('#edTextBar').isVisible(), 'text mode edits copy on the stage');
  check((await page.locator('#edEditText span').textContent()) === 'Done', 'transport shows Done while editing');
  check(((await page.locator('#inspectorRoot [data-act="text"]').textContent()) || '').includes('Done editing'), 'inspector shows Done editing');
  // Fields show the plate's own type while editing: accents keep their gradient, lines stay blocks.
  const editLook = await page.evaluate(() => {
    const doc = document.getElementById('plateFrame').contentDocument;
    const title = doc.querySelector('[data-edit="title"]');
    const accent = title?.querySelector('.accent');
    const cs = accent && getComputedStyle(accent);
    return {
      editable: title?.getAttribute('contenteditable'),
      gradient: cs ? cs.webkitBackgroundClip === 'text' && cs.backgroundImage.includes('gradient') : null,
      lines: title?.dataset.editKind !== 'lines' || [...title.children].every((c) => c.tagName === 'DIV'),
      plainAsterisks: /\*/.test(title?.textContent || ''),
    };
  });
  check(editLook.editable === 'plaintext-only' && editLook.lines && !editLook.plainAsterisks, 'title edits in place as lines, markers hidden');
  check(editLook.gradient !== false, `accent keeps its gradient while editing · ${editLook.gradient === null ? 'no accent on this title' : 'yes'}`);
  // Accent round-trip: select the first word, stage button marks it, ⌘B clears it again.
  const word = await page.evaluate(() => {
    const doc = document.getElementById('plateFrame').contentDocument;
    const title = doc.querySelector('[data-edit="title"]');
    const line = title.querySelector('div') || title;
    const node = [...line.childNodes].find((n) => n.nodeType === 3 && /\w/.test(n.nodeValue));
    const m = node.nodeValue.match(/\w+/);
    const r = doc.createRange();
    r.setStart(node, m.index);
    r.setEnd(node, m.index + m[0].length);
    title.focus();
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    doc.dispatchEvent(new Event('selectionchange'));
    return m[0];
  });
  await page.waitForFunction(() => document.querySelector('#edTextBar [data-text="accent"]')?.disabled === false);
  await page.click('#edTextBar [data-text="accent"]');
  const marked = await page.evaluate(
    (w) => {
      const doc = document.getElementById('plateFrame').contentDocument;
      const title = doc.querySelector('[data-edit="title"]');
      return {
        wrapped: [...title.querySelectorAll('.accent')].some((a) => a.textContent === w),
        selected: doc.getSelection().toString() === w,
        pressed: document.querySelector('#edTextBar [data-text="accent"]').getAttribute('aria-pressed'),
      };
    },
    word
  );
  check(marked.wrapped && marked.selected && marked.pressed === 'true', `Accent marks the selected word and stays selected · ${word}`);
  await page.frameLocator('#plateFrame').locator('[data-edit="title"]').press('Meta+b');
  const cleared = await page.evaluate((w) => ![...document.getElementById('plateFrame').contentDocument.querySelectorAll('[data-edit="title"] .accent')].some((a) => a.textContent === w), word);
  check(cleared, '⌘B takes the accent off again');
  check(await page.locator('#edTextBar.is-dirty').count() === 1, 'the bar offers Save and Discard');
  await settle();
  await page.screenshot({ path: join(shots, '03d-editor-plate.png') });
  // Discard reloads the plate and leaves text mode, like Done. A coach tip may stay on the stage.
  await page.click('#edTextBar [data-text="discard"]');
  await page.waitForFunction(() => {
    const bar = document.getElementById('edTextBar');
    return document.querySelector('#edEditText span')?.textContent === 'Edit text' && !bar?.classList.contains('is-editing');
  }, null, { timeout: 15000 });
  check((await page.locator('#edEditText span').textContent()) === 'Edit text', 'Discard restores Edit text');
  check(!((await page.locator('#inspectorRoot [data-act="text"]').textContent()) || '').includes('Editing text'), 'Discard clears the inspector');
  check(await page.locator('#edTextBar.is-editing').count() === 0, 'Discard leaves text editing');
  await page.click('#edEditText');
  await page.frameLocator('#plateFrame').locator('body.studio-edit [contenteditable]').first().waitFor();
  check(
    await page.evaluate(() => !document.getElementById('plateFrame').contentDocument.querySelector('[data-edit="title"] div .accent, [data-edit="title"] .accent')?.textContent.match(/^Team$/)),
    'discarded accent is gone after the reload'
  );
  await page.click('#edTextBar [data-text="done"]');
  check((await page.locator('#edEditText span').textContent()) === 'Edit text', 'Done restores Edit text');
  check(await page.locator('#edTextBar.is-editing').count() === 0, 'Done leaves text editing');
  // Look picks land on the stage in the same frame; the save and rebuild run behind them. Put the pick back afterwards.
  await page.frameLocator('#plateFrame').locator('body[data-motion="1"]').waitFor();
  const tilt = () => page.evaluate(() => getComputedStyle(document.getElementById('plateFrame').contentDocument.documentElement).getPropertyValue('--card-tilt').trim());
  const depthBefore = await page.locator('#inspectorRoot [data-look="depth"]').inputValue();
  const depthPick = depthBefore === 'deep' ? 'flat' : 'deep';
  const tiltSeen = await page.evaluate(
    ([pick]) =>
      new Promise((resolve) => {
        const sel = document.querySelector('#inspectorRoot [data-look="depth"]');
        sel.value = pick;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        resolve(getComputedStyle(document.getElementById('plateFrame').contentDocument.documentElement).getPropertyValue('--card-tilt').trim());
      }),
    [depthPick]
  );
  check(tiltSeen === (depthPick === 'deep' ? '17deg' : '0deg'), `look pick paints the stage at once · ${depthPick} → ${tiltSeen}`);
  // Put the optimistic pick back so the mid-plate change below actually fires a change event.
  await page.selectOption('#inspectorRoot [data-look="depth"]', depthBefore);
  await page.waitForFunction(
    (t) => getComputedStyle(document.getElementById('plateFrame').contentDocument.documentElement).getPropertyValue('--card-tilt').trim() !== t,
    tiltSeen
  );
  // Live look/style edits must keep the playhead — scrub mid-plate, change depth, stay there.
  await page.click('#edPlay');
  await page.waitForFunction(
    () => parseFloat(document.getElementById('edClock').textContent.split(':')[1]) > 1.4,
    null,
    { timeout: 8000 }
  );
  await page.click('#edPlay');
  const clockBeforeLook = await page.evaluate(() => parseFloat(document.getElementById('edClock').textContent.split(':')[1]));
  await page.selectOption('#inspectorRoot [data-look="depth"]', depthPick);
  await page.waitForTimeout(280);
  const afterLook = await page.evaluate(() => {
    const doc = document.getElementById('plateFrame')?.contentDocument;
    const anims = [...(doc?.getAnimations?.() || [])].map((a) => a.currentTime ?? 0);
    return {
      maxAnim: anims.length ? Math.max(...anims) : null,
      animCount: anims.length,
      clock: parseFloat(document.getElementById('edClock')?.textContent.split(':')[1] || '0'),
      motion: doc?.body?.dataset?.motion === '1',
    };
  });
  check(afterLook.motion, 'look pick keeps the plate in motion mode');
  check(Math.abs(afterLook.clock - clockBeforeLook) < 0.45, `look pick keeps the playhead · ${clockBeforeLook.toFixed(1)}s → ${afterLook.clock.toFixed(1)}s`);
  check(
    afterLook.animCount > 0 && afterLook.maxAnim > 600,
    `look pick keeps animations near the playhead · n=${afterLook.animCount} max=${afterLook.maxAnim}`
  );
  await page.waitForSelector('#inspectorRoot [data-act="look-reset"]');
  check(await page.locator('#inspectorRoot [data-look="depth"]').evaluate((el) => el.value) === depthPick, 'inspector keeps the pick after the save');
  await page.selectOption('#inspectorRoot [data-look="depth"]', depthBefore);
  await page.waitForFunction((t) => getComputedStyle(document.getElementById('plateFrame').contentDocument.documentElement).getPropertyValue('--card-tilt').trim() !== t, tiltSeen);
  check((await tilt()) !== tiltSeen, 'look put back');
  check(
    await page.evaluate((before) => {
      const clock = parseFloat(document.getElementById('edClock')?.textContent.split(':')[1] || '0');
      return Math.abs(clock - before) < 0.45;
    }, clockBeforeLook),
    'putting the look back also keeps the playhead'
  );
  // Edge: Look while editing text must not freeze a half-reveal after Done — and must not jump to 0.
  await page.click('#edEditText');
  await page.frameLocator('#plateFrame').locator('body.studio-edit [contenteditable]').first().waitFor();
  const depthDuringEdit = await page.locator('#inspectorRoot [data-look="depth"]').inputValue();
  const depthFlip = depthDuringEdit === 'deep' ? 'flat' : 'deep';
  const clockDuringEdit = await page.evaluate(() => parseFloat(document.getElementById('edClock').textContent.split(':')[1]));
  await page.selectOption('#inspectorRoot [data-look="depth"]', depthFlip);
  check(await page.locator('#edTextBar.is-editing').isVisible(), 'look pick while editing keeps text mode');
  await page.click('#edTextBar [data-text="done"]');
  await page.frameLocator('#plateFrame').locator('body[data-motion="1"]').waitFor();
  check(
    await page.evaluate((before) => {
      const doc = document.getElementById('plateFrame')?.contentDocument;
      const anims = [...(doc?.getAnimations?.() || [])].map((a) => a.currentTime ?? 0);
      const clock = parseFloat(document.getElementById('edClock')?.textContent.split(':')[1] || '0');
      return doc?.body?.dataset?.motion === '1' && anims.length > 0 && Math.abs(clock - before) < 0.45 && Math.max(...anims) > 400;
    }, clockDuringEdit),
    'Done after look-during-edit keeps motion at the playhead'
  );
  // Rapid Look picks must settle on the last value without shoving the playhead home.
  const clockRapid = await page.evaluate(() => parseFloat(document.getElementById('edClock').textContent.split(':')[1]));
  await page.selectOption('#inspectorRoot [data-look="depth"]', depthFlip);
  await page.selectOption('#inspectorRoot [data-look="depth"]', depthDuringEdit);
  await page.selectOption('#inspectorRoot [data-look="depth"]', depthFlip);
  await page.waitForFunction(
    (before) => {
      const doc = document.getElementById('plateFrame')?.contentDocument;
      const clock = parseFloat(document.getElementById('edClock')?.textContent.split(':')[1] || '0');
      return doc?.body?.dataset?.motion === '1' && Math.abs(clock - before) < 0.45;
    },
    clockRapid,
    { timeout: 8000 }
  );
  check(
    (await page.locator('#inspectorRoot [data-look="depth"]').inputValue()) === depthFlip,
    'rapid look picks settle on the last value'
  );
  await page.selectOption('#inspectorRoot [data-look="depth"]', depthDuringEdit);
  await page.waitForFunction((t) => getComputedStyle(document.getElementById('plateFrame').contentDocument.documentElement).getPropertyValue('--card-tilt').trim() === t, depthDuringEdit === 'deep' ? '17deg' : '0deg');
  // Background (atmosphere) must rebuild the plate and land on the stage; Direction effects too.
  // Direction first (video look, no plate override), then the inspector (per-plate override).
  const cfgLook = join(VIDEOS, slug, 'video.config.json');
  const keepLook = { buf: readFileSync(cfgLook), stat: statSync(cfgLook) };
  try {
    if (await page.locator('#inspectorRoot [data-act="look-reset"]').count()) {
      await page.locator('#inspectorRoot [data-act="look-reset"]').click({ force: true }).catch(() => {});
      await page.waitForTimeout(800);
    }
    const fieldOf = () => page.evaluate(() => document.getElementById('plateFrame')?.contentDocument?.defaultView?.__plateRuntime?.field ?? null);
    await page.click('.tools-panel .ptab[data-right="motion"]');
    await page.waitForSelector('#atmosphereGrid');
    const dirAtm = await page.locator('#atmosphereGrid .energy.active').getAttribute('data-atmosphere');
    const dirPick = dirAtm === 'waves' ? 'particles' : 'waves';
    await page.click(`#atmosphereGrid [data-atmosphere="${dirPick}"]`);
    await page.waitForFunction((want) => document.getElementById('plateFrame')?.contentDocument?.defaultView?.__plateRuntime?.field === want, dirPick, { timeout: 15000 });
    check((await fieldOf()) === dirPick, `direction background paints the editor · ${dirPick}`);
    const dirDepth = await page.locator('#cardDepth').inputValue();
    const depthLive = dirDepth === 'deep' ? 'flat' : 'deep';
    await page.selectOption('#cardDepth', depthLive);
    await page.waitForFunction(
      (want) => getComputedStyle(document.getElementById('plateFrame').contentDocument.documentElement).getPropertyValue('--card-tilt').trim() === want,
      depthLive === 'deep' ? '17deg' : '0deg',
      { timeout: 8000 }
    );
    check(true, `direction depth paints the editor · ${depthLive}`);
    await page.locator('#etlClips .etl-clip.plate').first().click();
    await page.waitForSelector('#inspectorRoot [data-look="atmosphere"]');
    const atmPick = dirPick === 'mesh' ? 'aurora' : 'mesh';
    await page.selectOption('#inspectorRoot [data-look="atmosphere"]', atmPick);
    await page.waitForFunction((want) => document.getElementById('plateFrame')?.contentDocument?.defaultView?.__plateRuntime?.field === want, atmPick, { timeout: 15000 });
    check((await fieldOf()) === atmPick, `inspector background paints the stage · ${atmPick}`);
    await settle();
    await page.screenshot({ path: join(shots, '03c2-editor-look.png') });
  } finally {
    writeFileSync(cfgLook, keepLook.buf);
    utimesSync(cfgLook, keepLook.stat.atime, keepLook.stat.mtime);
    await fetch(`${base}/api/video/${slug}/plates/rebuild-html`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#bootLoader', { state: 'detached' });
    await page.click('#modePlate');
    await page.waitForSelector('#etlClips .etl-clip');
  }
  if (clips.includes('live')) {
    await page.click('#etlClips .etl-clip.live');
    await page.waitForSelector('#liveStage:not([hidden])');
    // Direction frame / look presets must reshape the Editor inset chrome without a render.
    const cfgFrame = join(VIDEOS, slug, 'video.config.json');
    const keepFrame = { buf: readFileSync(cfgFrame), stat: statSync(cfgFrame) };
    try {
      await page.click('.tools-panel .ptab[data-right="motion"]');
      await page.waitForSelector('#lookPresets [data-look]');
      await page.evaluate(() => {
        document.querySelector('#lookPresets [data-look="cinematic"]')?.click();
      });
      await page.waitForFunction(() => document.getElementById('liveStage')?.classList.contains('is-inset'), null, { timeout: 10000 });
      check(await page.locator('#liveStage').evaluate((el) => el.classList.contains('is-inset')), 'direction inset frame paints the editor stage');
      const bgBefore = await page.evaluate(() => getComputedStyle(document.getElementById('liveStage')).getPropertyValue('--frame-c0').trim());
      await page.evaluate(() => document.querySelector('[data-camera="background"] [data-value="ink"]')?.click());
      await page.waitForFunction(
        (prev) => getComputedStyle(document.getElementById('liveStage')).getPropertyValue('--frame-c0').trim() !== prev,
        bgBefore,
        { timeout: 8000 }
      );
      check(true, 'direction frame background paints the editor stage');
      await page.evaluate(() => document.querySelector('[data-camera="frame"] [data-value="full"]')?.click());
      await page.waitForFunction(() => !document.getElementById('liveStage')?.classList.contains('is-inset'), null, { timeout: 8000 });
      check(!(await page.locator('#liveStage').evaluate((el) => el.classList.contains('is-inset'))), 'direction full-bleed clears the editor inset');
      // Joins: Direction transition style must land on the video the Editor reads.
      const joinPick = await page.evaluate(() => {
        const cur = document.querySelector('#transitionGrid [data-transition].active')?.dataset.transition;
        const next = cur === 'dissolve' ? 'wipe' : 'dissolve';
        document.querySelector(`#transitionGrid [data-transition="${next}"]`)?.click();
        return next;
      });
      await page.waitForTimeout(600);
      const summaryAfter = await fetch(`${base}/api/video/${slug}`).then((r) => r.json());
      check(summaryAfter.transitions?.style === joinPick, `direction transition live on video · ${joinPick}`);
      await page.screenshot({ path: join(shots, '03c3-editor-frame.png') });
    } finally {
      writeFileSync(cfgFrame, keepFrame.buf);
      utimesSync(cfgFrame, keepFrame.stat.atime, keepFrame.stat.mtime);
      await fetch(`${base}/api/video/${slug}/plates/rebuild-html`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#bootLoader', { state: 'detached' });
      await page.click('#modePlate');
      await page.waitForSelector('#etlClips .etl-clip');
      await page.click('#etlClips .etl-clip.live');
      await page.waitForSelector('#liveStage:not([hidden])');
    }
    await page.click('#edPlay');
    await page.waitForFunction(() => {
      const v = document.getElementById('livePlayer');
      return v && !v.paused && v.currentTime > 0.05;
    }, null, { timeout: 15000 });
    check(true, 'editor plays the recording');
    await page.click('#edPlay');
    check((await page.locator('#inspectorRoot .ins-sec').count()) >= 2, 'live inspector sections (speed, zoom)');
    check(
      !(await page.locator('#etlAddSpeed').isDisabled()) &&
        !(await page.locator('#etlAddZoom').isDisabled()) &&
        !(await page.locator('#etlAddLens').isDisabled()) &&
        !(await page.locator('#etlAddCut').isDisabled()),
      'speed, zoom, magnify and cut tools on a recording clip'
    );
    check((await page.locator('#etlCuts').count()) === 1, 'cut row on the timeline');
    check(Array.isArray(deck.lenses) && Array.isArray(deck.deck.lenses) && Array.isArray(deck.deck.lensOff), 'deck carries magnifiers');
    const lensPills = await page.locator('#etlZoom .fx.lens').count();
    check(lensPills === deck.lenses.length + (deck.recordedLenses || []).filter((l) => l.off).length, `magnifiers on the zoom row · ${lensPills}`);
    const voicePills = await page.locator('#etlVoice .fx.voice').count();
    check(voicePills === (deck.audio?.voiceClips || []).length, `voice lines on the timeline · ${voicePills}`);
    // The Editor re-places every line with the voice step's rules; on an unchanged cut that must land on the mix.
    const movedPills = await page.locator('#etlVoice .fx.voice.is-moved').count();
    check(movedPills === 0, `voice projection matches the mix on an unchanged cut · ${movedPills} moved`);
    check(!deck.audio?.music || (await page.locator('#etlMusic .music-bed').count()) === 1, 'music bed on the timeline');
    if (voicePills) {
      check((await page.locator('#etlVoice .fx.voice >> nth=0 >> .h').count()) === 2, 'voice pill carries trim handles');
      await page.click('#etlVoice .fx.voice >> nth=0');
      const line = deck.audio.voiceClips[0];
      check((await page.locator('#inspectorRoot [data-voice-text]').inputValue()) === (line.textOverride || line.text), 'voice inspector shows the line as a textarea');
      check((await page.locator('#inspectorRoot [data-act="voice-regen"]').count()) === 1 && (await page.locator('#inspectorRoot .take-chip').count()) >= 1, 'regenerate button and take chips');
      check((await page.locator('#inspectorRoot [data-voice-shape]').count()) === 4, 'trim head/tail and fade in/out sliders');
      check(typeof line.full === 'number' && typeof line.trimStart === 'number' && typeof line.fadeOut === 'number' && line.takes >= 1, 'deck lines carry shape and takes');
      check(deck.audio.narrator && typeof deck.audio.narrator.mode === 'string', `deck carries the narrator · ${deck.audio.narrator?.name} (${deck.audio.narrator?.mode})`);
      const sz = await page.locator('#inspectorRoot [data-voice-shape="trimEnd"]').getAttribute('max');
      check(Math.abs(Number(sz) - (line.full - deck.ranges.voiceMinSec)) < 0.01, 'trim sliders leave the minimum speech');
      await page.click('#etlMix');
      await page.waitForSelector('#inspectorRoot .ins-sec:has-text("Narrator")');
      if (deck.audio.narrator.mode === 'live') {
        await page.waitForSelector('#inspectorRoot [data-narrator]');
        check((await page.locator('#inspectorRoot [data-narrator] option').count()) >= 1, 'narrator picker lists the account voices');
        check(await page.locator('#inspectorRoot [data-act="narrator-use"]').isDisabled(), 'current narrator is not re-pickable');
        const voiceIds = await page.locator('#inspectorRoot [data-narrator] option').evaluateAll((os) => os.map((o) => o.value));
        const was = await page.locator('#inspectorRoot [data-narrator]').inputValue();
        const other = voiceIds.find((v) => v !== was);
        if (other) {
          await page.selectOption('#inspectorRoot [data-narrator]', other);
          await page.waitForTimeout(150);
          check((await page.locator('#inspectorRoot [data-narrator]').inputValue()) === other, 'narrator pick stays in the select');
          check(!(await page.locator('#inspectorRoot [data-act="narrator-use"]').isDisabled()), 'a new pick can be used');
          await page.selectOption('#inspectorRoot [data-narrator]', was);
        }
      } else {
        check((await page.locator('#inspectorRoot .ins-sec:has-text("Narrator") .ins-note').count()) >= 1, 'narrator section explains stub / missing key');
      }
      await page.click('#etlVoice .fx.voice >> nth=0');
      const plate = page.locator('#etlClips .etl-clip.plate').nth(1);
      await plate.click();
      check((await page.locator('#inspectorRoot [data-act="clip-earlier"], #inspectorRoot [data-act="clip-later"]').count()) === 2, 'clip can move earlier and later');
      const beforeOrder = await page.locator('#etlClips .etl-clip').evaluateAll((els) => els.map((e) => e.getAttribute('title')));
      try {
        await page.click('#inspectorRoot [data-act="clip-later"]');
        await page.waitForFunction((prev) => [...document.querySelectorAll('#etlClips .etl-clip')].map((e) => e.title).join('|') !== prev, beforeOrder.join('|'));
        check(true, 'moving a clip reorders the timeline');
        await page.click('#inspectorRoot [data-act="clip-earlier"]');
        await page.waitForFunction((prev) => [...document.querySelectorAll('#etlClips .etl-clip')].map((e) => e.title).join('|') === prev, beforeOrder.join('|'));
        // Drag a brick two slots to the right: the lifted one rides along, the two it passes slide left.
        const bricks = page.locator('#etlClips .etl-clip');
        const b2 = await bricks.nth(2).boundingBox();
        const b4 = await bricks.nth(4).boundingBox();
        await page.mouse.move(b2.x + 12, b2.y + 20);
        await page.mouse.down();
        await page.mouse.move(b2.x + 40, b2.y + 20, { steps: 3 });
        await page.mouse.move(b4.x + b4.width - 4, b2.y + 20, { steps: 10 });
        await page.waitForTimeout(80);
        const mid = await bricks.evaluateAll((els) => ({
          lifted: els.filter((e) => e.classList.contains('is-lift')).length,
          slid: els.filter((e) => !e.classList.contains('is-lift') && /translateX\(-/.test(e.style.transform)).length,
          reordering: els[0].parentElement.classList.contains('is-reordering'),
        }));
        check(mid.lifted === 1 && mid.reordering, 'dragging lifts the brick');
        check(mid.slid === 2, `bricks slide out of the way · ${mid.slid}`);
        await page.mouse.up();
        await page.waitForFunction((prev) => [...document.querySelectorAll('#etlClips .etl-clip')].map((e) => e.title).join('|') !== prev, beforeOrder.join('|'));
        check(true, 'dropping saves the new order');
        await page.waitForFunction(() => !document.getElementById('etlClips').classList.contains('is-settling'));
        const line = page.locator('#etlVoice .fx.voice').first();
        const lb = await line.boundingBox();
        await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
        await page.mouse.down();
        await page.mouse.move(lb.x + lb.width / 2 + 140, lb.y + lb.height / 2, { steps: 8 });
        await page.mouse.up();
        await page.waitForFunction(() => /Plays at/.test(document.querySelector('#inspectorRoot')?.innerText || ''));
        check(true, 'dragging a line places it');
        await page.click('#inspectorRoot [data-act="voice-reset"]');
      } finally {
        await fetch(`${base}/api/video/${slug}/edit`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ order: [] }),
        });
      }
      // Regenerate round trip, paid for by the cache: take 2 is seeded from take 1's clip, so the
      // narrator is never called. Desk for this line is neutralized for the round trip, then restored.
      const video = loadVideo(slug);
      const metaFile = join(video.out, 'voice', 'voice.json');
      const cfgFile = join(VIDEOS, slug, 'video.config.json');
      const keep = { meta: readFileSync(metaFile), cfg: readFileSync(cfgFile), metaStat: statSync(metaFile), cfgStat: statSync(cfgFile) };
      const neutralizeLine = (cfgBuf, key) => {
        const cfgObj = JSON.parse(cfgBuf.toString());
        const voices = cfgObj.edit?.audio?.voice;
        if (Array.isArray(voices)) {
          cfgObj.edit.audio.voice = voices
            .map((v) => {
              if (v.key !== key) return v;
              const next = { ...v };
              delete next.take;
              delete next.takes;
              delete next.text;
              delete next.speed;
              return Object.keys(next).length > 1 ? next : null;
            })
            .filter(Boolean);
          if (!cfgObj.edit?.audio?.voice?.length) {
            if (cfgObj.edit?.audio) delete cfgObj.edit.audio.voice;
            if (cfgObj.edit?.audio && !Object.keys(cfgObj.edit.audio).length) delete cfgObj.edit.audio;
            if (cfgObj.edit && !Object.keys(cfgObj.edit).length) delete cfgObj.edit;
          }
        }
        return `${JSON.stringify(cfgObj, null, 2)}\n`;
      };
      const neutralizeMeta = (metaBuf) => {
        const metaObj = JSON.parse(metaBuf.toString());
        for (const c of metaObj.clips || []) delete c.take;
        return `${JSON.stringify(metaObj, null, 2)}\n`;
      };
      // Start (and finally restore) from take 1 with no rewrite on this line — prior smokes must not leak.
      const baselineCfg = neutralizeLine(keep.cfg, line.key);
      const baselineMeta = neutralizeMeta(keep.meta);
      writeFileSync(metaFile, baselineMeta);
      writeFileSync(cfgFile, baselineCfg);
      utimesSync(cfgFile, keep.cfgStat.atime, keep.cfgStat.mtime);
      const t1 = await lineTakeFiles(video, line.key, 1);
      const t2 = await lineTakeFiles(video, line.key, 2);
      const seeded = t1.cached && !t2.cached;
      if (seeded) copyFileSync(t1.mp3, t2.mp3);
      try {
        if (t1.cached) {
          await page.click('#modeProgram');
          await page.click('#modePlate');
          await page.waitForSelector('#etlVoice .fx.voice');
          await page.click('#etlVoice .fx.voice >> nth=0');
          await page.waitForSelector('#inspectorRoot [data-act="voice-regen"]');
          await page.waitForFunction(
            () =>
              document.querySelectorAll('#inspectorRoot .take-chip').length === 1 &&
              !document.querySelector('#inspectorRoot [data-act="voice-revert"]'),
            null,
            { timeout: 8000 }
          ).catch(() => {});
          check((await page.locator('#inspectorRoot .take-chip').count()) === 1 && (await page.locator('#inspectorRoot [data-act="voice-revert"]').count()) === 0, 'one take, nothing to revert');
          await page.click('#inspectorRoot [data-act="voice-regen"]');
          const speaking = await page.waitForSelector('#etlVoice .fx.voice.is-speaking', { timeout: 4000 }).then(() => true).catch(() => false);
          check(speaking, 'timeline shows the line speaking');
          if (speaking) await page.screenshot({ path: join(shots, '03e-editor-speaking.png'), clip: { x: 0, y: 680, width: 1600, height: 280 } }).catch(() => {});
          await page.waitForFunction(
            () => !document.querySelector('#etlVoice .fx.voice.is-speaking') && !document.querySelector('#inspectorRoot [data-act="voice-regen"]:disabled'),
            null,
            { timeout: 30000 }
          );
          const label = (await page.locator('#inspectorRoot [data-act="voice-regen"] span').textContent()) || '';
          check(/^Regenerate/.test(label), `regenerate settles · "${label}"`);
          check((await page.locator('#etlVoice .fx.voice >> nth=0 >> .take').textContent()) === '2', 'pill carries the take badge');
          check((await page.locator('#inspectorRoot .take-chip').count()) === 2 && (await page.locator('#inspectorRoot .take-chip.is-on').textContent()) === '2', 'take chips, take 2 current');
          check((await page.locator('#inspectorRoot .take-chip.is-cached').count()) === 2, 'both takes marked as cached');
          check((await page.locator('#inspectorRoot [data-act="voice-revert"]').count()) === 1, 'revert offered on take 2');
          // A rewrite must also open a new take chip (not overwrite the current one).
          const spoken = (await page.locator('#inspectorRoot [data-voice-text]').inputValue()) || '';
          await page.fill('#inspectorRoot [data-voice-text]', `${spoken} again`);
          await page.click('#inspectorRoot [data-act="voice-regen"]');
          await page.waitForFunction(
            () => !document.querySelector('#etlVoice .fx.voice.is-speaking') && !document.querySelector('#inspectorRoot [data-act="voice-regen"]:disabled'),
            null,
            { timeout: 90000 }
          );
          check((await page.locator('#inspectorRoot .take-chip').count()) === 3 && (await page.locator('#inspectorRoot .take-chip.is-on').textContent()) === '3', 'rewrite opens take 3');
          check((await page.locator('#etlVoice .fx.voice >> nth=0 >> .take').textContent()) === '3', 'pill shows take 3 after rewrite');
          await settle();
          await page.screenshot({ path: join(shots, '03f-editor-takes.png') });
          await page.click('#inspectorRoot .take-chip[data-take="1"]');
          await page.waitForFunction(() => document.querySelector('#inspectorRoot .take-chip.is-on')?.textContent === '1' && !document.querySelector('#inspectorRoot [data-act="voice-regen"]:disabled'), null, { timeout: 30000 });
          check((await page.locator('#etlVoice .fx.voice >> nth=0 >> .take').count()) === 0, 'take 1 again, badge gone');
          await page.click('#inspectorRoot .take-chip[data-take="2"]');
          await page.waitForSelector('#inspectorRoot [data-act="voice-revert"]', { timeout: 30000 });
          await page.click('#inspectorRoot [data-act="voice-revert"]');
          await page.waitForFunction(() => document.querySelector('#inspectorRoot .take-chip.is-on')?.textContent === '1' && !document.querySelector('#inspectorRoot [data-act="voice-revert"]'), null, { timeout: 30000 });
          check(true, 'revert goes back to the written line');
          // Every take auto-plays with the sound on; leave the transport as the checks below expect it.
          if (await page.locator('#edPlay.is-playing').count()) await page.click('#edPlay');
          if (await page.locator('#edSound.is-on').count()) await page.click('#edSound');
          await page.waitForFunction(() => !document.getElementById('edPlay').classList.contains('is-playing'));
        } else {
          check(true, 'regenerate round trip skipped · take 1 is not in the cache');
        }
      } finally {
        // Neutral baseline for the line under test (keeps other desk edits from keep).
        writeFileSync(metaFile, baselineMeta);
        utimesSync(metaFile, keep.metaStat.atime, keep.metaStat.mtime);
        writeFileSync(cfgFile, baselineCfg);
        utimesSync(cfgFile, keep.cfgStat.atime, keep.cfgStat.mtime);
        if (seeded) rmSync(t2.mp3, { force: true });
        if (seeded) rmSync(t2.wav, { force: true });
      }
    }
    if (lensPills) {
      await page.click('#etlZoom .fx.lens >> nth=0');
      await page.waitForFunction(() => {
        const cv = document.getElementById('liveLens');
        const d = cv.width && cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        if (!d) return false;
        for (let i = 3; i < d.length; i += 64) if (d[i] > 200) return true;
        return false;
      });
      check(await page.locator('#inspectorRoot .ins-head.lens').isVisible(), 'magnifier inspector and stage loupe');
      await settle();
      await page.screenshot({ path: join(shots, '03f-editor-lens.png') });
    }
    // Zoom strength must push the stage in while the shot is still selected (not only after Escape).
    const zoomPills = await page.locator('#etlZoom .fx.shot').count();
    if (zoomPills) {
      const cfgFile = join(VIDEOS, slug, 'video.config.json');
      const keepCfg = { buf: readFileSync(cfgFile), stat: statSync(cfgFile) };
      try {
        await page.locator('#etlZoom .fx.shot').first().click({ force: true });
        await page.waitForSelector('#inspectorRoot .ins-head.zoom, #inspectorRoot [data-act="adopt"]');
        if (await page.locator('#inspectorRoot [data-act="adopt"]').count()) {
          await page.click('#inspectorRoot [data-act="adopt"]');
          await page.waitForSelector('#inspectorRoot [data-shot-zoom]');
        }
        if (await page.locator('#inspectorRoot [data-shot-zoom]').count()) {
          const before = await page.evaluate(() => document.getElementById('livePlayer')?.style.transform || '');
          // Pick a strength that differs from the current one (shots often already sit at max).
          await page.locator('#inspectorRoot [data-shot-zoom]').evaluate((el) => {
            const cur = Number(el.value);
            const max = Number(el.max);
            const min = Number(el.min);
            const mid = Math.round(((min + max) / 2) / 0.05) * 0.05;
            el.value = String(Math.abs(cur - max) < 0.02 ? (Math.abs(cur - mid) < 0.02 ? min : mid) : max);
            el.dispatchEvent(new Event('input', { bubbles: true }));
          });
          await page.waitForFunction(
            (prev) => {
              const t = document.getElementById('livePlayer')?.style.transform || '';
              return t !== prev && /scale\(/.test(t);
            },
            before,
            { timeout: 5000 }
          );
          const during = await page.evaluate(() => document.getElementById('livePlayer')?.style.transform || '');
          check(/scale\(/.test(during), `zoom strength paints the stage while selected · ${during}`);
          await page.locator('#inspectorRoot [data-shot-zoom]').evaluate((el) => el.dispatchEvent(new Event('change', { bubbles: true })));
          await page.waitForTimeout(500);
          const saved = await page.evaluate(() => document.getElementById('livePlayer')?.style.transform || '');
          check(/scale\(/.test(saved), `zoom strength stays on the stage after save · ${saved}`);
          await settle();
          await page.screenshot({ path: join(shots, '03g-editor-zoom.png') });
        } else {
          check(true, 'zoom strength live preview skipped · no strength slider');
        }
      } finally {
        writeFileSync(cfgFile, keepCfg.buf);
        utimesSync(cfgFile, keepCfg.stat.atime, keepCfg.stat.mtime);
        // The deck is in memory until the page reloads; the next checks leave the Editor anyway.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#bootLoader', { state: 'detached' });
        await page.click('#modePlate');
        await page.waitForSelector('#etlClips .etl-clip');
      }
    }
    await settle();
    await page.screenshot({ path: join(shots, '03e-editor-live.png') });
  }
  await page.click('.mode-tab[data-mode="program"]');
  await page.click('.tools-panel .ptab[data-right="motion"]');

  // Wizard: validation + navigation (does not create)
  await page.click('#btnNewVideo');
  await page.waitForSelector('#projectDialog[open]');
  await settle();
  await page.screenshot({ path: join(shots, '04a-wizard-basics.png') });
  await page.click('#btnWizardNext');
  check(await page.locator('#wizardError').isVisible(), 'wizard blocks empty basics');
  check((await page.locator('#projectForm [name=title]').getAttribute('aria-invalid')) === 'true', 'invalid field marked');
  await settle();
  await page.screenshot({ path: join(shots, '04b-wizard-error.png') });
  await page.fill('#projectForm [name=title]', 'Smoke test video');
  await page.fill('#projectForm [name=audience]', 'Smoke testers');
  await page.check('#projectForm [name=brandMode][value=new]');
  check(
    (await page.locator('#wizardDiscoverRow').textContent()).includes('required') &&
      (await page.locator('#projectForm [name=runDiscover]').count()) === 0,
    'new-brand capture is mandatory'
  );
  check((await page.locator('#wizardCreation [data-create-stage]').count()) === 5, 'creation readiness stages');
  check(
    (await page.locator('.feedback-capabilities, .smart-scope-note').count()) === 0 &&
      (await page.locator('#rightFeedback [data-help*="Smart scope"]').count()) === 1 &&
      (await page.locator('#btnImprove').textContent()).includes('smart scope'),
    'feedback smart scope lives in help, not capability chips'
  );
  check(
    (await page.locator('[data-improve="script"], [data-improve="voice"], [data-improve="plates"], [data-improve="motion"]').count()) === 4,
    'feedback supports explicit script, voice, plate and brand domains'
  );
  check(
    (await page.locator('#sessionStream, #renderLiveStream, #scriptDraftStream, #wizardStream').count()) === 4,
    'every agent surface hosts the shared stream'
  );
  check(
    await page.evaluate(() => {
      const rail = document.getElementById('sessionRail');
      return (
        rail.firstElementChild?.id === 'sessionDecide' &&
        Boolean(document.getElementById('btnReviewProposal')) &&
        Boolean(document.getElementById('btnProposalWork'))
      );
    }),
    'review and approval tray precedes agent work'
  );
  const streamed = await page.evaluate(async () => {
    const { paintAgentStream } = await import('/agentStream.js');
    const host = document.getElementById('wizardStream');
    document.getElementById('wizardCreation').hidden = false;
    const long = 'Reading the brand pack before drafting the opening plate. '.repeat(12).trim();
    const job = (rev, text, status = 'running') => ({
      id: 'smoke-stream',
      status,
      stream: { rev, entries: [{ id: 1, kind: 'tool', title: 'Read', text: 'brands/x/brand.json', done: true, ok: true }, { id: 2, kind: 'say', text, done: status !== 'running' }] },
    });
    paintAgentStream(host, job(1, long.slice(0, 40)));
    paintAgentStream(host, job(2, long));
    await new Promise((r) => setTimeout(r, 60));
    const mid = host.querySelector('.as-say .as-text').textContent.length;
    await new Promise((r) => setTimeout(r, 1500));
    paintAgentStream(host, job(3, long, 'done'));
    const body = host.querySelector('.as-say .as-text');
    const result = { mid, full: body.textContent.length, want: long.length, entries: host.querySelectorAll('.as-entry').length, ellipsis: getComputedStyle(body).textOverflow === 'ellipsis' };
    paintAgentStream(host, null);
    document.getElementById('wizardCreation').hidden = true;
    return result;
  });
  check(streamed.mid < streamed.want, 'stream text reveals progressively');
  check(streamed.full === streamed.want && !streamed.ellipsis, 'stream keeps the whole text, never cut');
  check(streamed.entries === 2, 'stream entries render once each');
  const creationView = await page.evaluate(async () => {
    const { createCreationView } = await import('/creation.js');
    const dialog = document.getElementById('projectDialog');
    const view = createCreationView({ dialog, escapeHtml: (s) => String(s) });
    view.start();
    view.stage('brand', 'Capturing…');
    view.fromJob({
      stream: {
        entries: [
          { id: 1, kind: 'line', text: '› Saved source-logo-0.svg (svg)' },
          { id: 2, kind: 'line', text: '› Palette: accent #f6aa1e · ink #111111 · surface #222222 · teal #0aa0a0' },
          { id: 3, kind: 'line', text: '› Typeface: Inter' },
          { id: 4, kind: 'tool', title: 'Write', text: 'videos/x/narration.mjs', done: true },
        ],
      },
    });
    const form = document.querySelector('#projectForm fieldset[data-step="0"]');
    const result = {
      formHidden: getComputedStyle(form).display === 'none' && getComputedStyle(document.getElementById('wizardSteps')).display === 'none',
      visible: !document.getElementById('wizardCreation').hidden,
      files: document.querySelectorAll('#wizardArtifacts li:not(.is-empty)').length,
      swatches: document.querySelectorAll('#wizardBrandSwatches i').length,
      font: document.getElementById('wizardBrandFont').textContent,
      note: document.querySelector('[data-create-stage="brand"] [data-stage-note]').textContent,
      active: document.querySelector('[data-create-stage="brand"]').classList.contains('active'),
      done: document.querySelector('[data-create-stage="project"]').classList.contains('done'),
    };
    view.reset();
    return result;
  });
  check(creationView.visible && creationView.formHidden, 'creation view replaces the form while preparing');
  check(creationView.active && creationView.done, 'creation timeline marks done and active stages');
  check(creationView.files === 2 && creationView.swatches === 4 && creationView.font === 'Inter', 'creation view lists files, palette and type as they appear');
  check(/narration\.mjs/.test(creationView.note), 'active stage shows the newest live line');
  await page.check('#projectForm [name=brandMode][value=existing]');
  await page.click('#wizardBrand');
  await page.waitForTimeout(250);
  await settle();
  await page.screenshot({ path: join(shots, '05-select-open.png') });
  await page.keyboard.press('Escape');
  check(await page.locator('#projectDialog').evaluate((d) => d.open), 'select escape keeps wizard open');
  await page.click('#btnWizardNext');
  check(await page.locator('fieldset[data-step="1"]').isVisible(), 'wizard → app access');
  await page.fill('#projectForm [name=startUrl]', 'https://example.com');
  await page.check('#projectForm [name=loginRequired]');
  check(await page.locator('#projectForm [name=email]').isVisible(), 'login fields reveal');
  await settle();
  await page.screenshot({ path: join(shots, '04c-wizard-access.png') });
  await page.click('#btnWizardNext');
  await page.fill('#projectForm [name=mustShow]', 'Home\nSettings');
  await page.click('#btnWizardNext');
  await settle();
  await page.screenshot({ path: join(shots, '04d-wizard-proof.png') });
  await page.click('#btnWizardNext');
  check((await page.locator('#wizardSummary div').count()) >= 6, 'wizard review summary');
  await settle();
  await page.screenshot({ path: join(shots, '04-wizard.png') });
  await page.keyboard.press('Escape');

  await page.click('#btnHelp');
  await page.waitForSelector('#helpDialog[open]');
  await settle();
  await page.screenshot({ path: join(shots, '06-help.png') });
  await page.keyboard.press('Escape');

  check(!errors.length, 'no page errors', errors.join(' | '));
} catch (err) {
  bad('smoke crashed', err.message || String(err));
  await page.screenshot({ path: join(shots, 'crash.png') }).catch(() => {});
} finally {
  await browser.close();
}

if (fails.length) {
  console.error(`\n✗ Studio smoke failed (${fails.length}) · shots in ${shots}`);
  process.exitCode = 1;
} else {
  console.log(`\n✓ Studio smoke passed · shots in ${shots}`);
}
