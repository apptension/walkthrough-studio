/**
 * Walkthrough Studio — first-user tour of the Studio itself.
 * Assumes `node cli.mjs studio` is already serving http://localhost:4747.
 * No login. Guesses are marked TODO(verify selector) and guarded.
 */

async function typeFast(locator, text, delay = 28) {
  if (!(await locator.isVisible().catch(() => false))) return false;
  await locator.click({ clickCount: 3 }).catch(() => locator.click());
  await locator.fill('').catch(() => {});
  await locator.pressSequentially(text, { delay });
  return true;
}

async function closeTopDialog(page, wait) {
  const dlg = page.locator('dialog[open]').first();
  if (!(await dlg.isVisible().catch(() => false))) return;
  const close = dlg.getByRole('button', { name: /^close$/i }).first();
  if (await close.isVisible().catch(() => false)) {
    await close.click();
    await wait(350);
    return;
  }
  await page.keyboard.press('Escape').catch(() => {});
  await wait(250);
}

async function pickSequence(page, wait, settle) {
  const sel = page.getByLabel(/select sequence/i);
  await sel.waitFor({ state: 'visible', timeout: 20000 });
  const options = await sel.locator('option').all();
  let value = null;
  for (const opt of options) {
    const v = await opt.getAttribute('value');
    if (v && /walkthrough-studio/i.test(v)) {
      value = v;
      break;
    }
  }
  if (value) {
    await sel.selectOption(value);
    await wait(700);
    if (settle) await settle(null, 400);
  }
  return value;
}

export default async function flow(ctx) {
  const { page, env, chapter, say, wait, focus, frame, magnify, follow, settle } = ctx;

  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await settle?.(page.getByLabel(/select sequence/i), 600);
  await pickSequence(page, wait, settle);

  // —— Overview ——
  await chapter('Meet Studio', 'One desk from brief to a client-ready master', 2400);

  await say('Production stages', 'Brief, Script, Record, Cut, Deliver — gated in order.', 2000);
  const stageBar = page.getByRole('navigation', { name: /production stages/i });
  if (await stageBar.isVisible().catch(() => false)) {
    await frame(stageBar, { holdMs: 200 });
    await magnify(stageBar, { holdMs: 1600, zoom: 1.7, label: 'stages' });
  } else {
    // TODO(verify selector)
    const fallback = page.locator('#stageBar').first();
    if (await fallback.isVisible().catch(() => false)) {
      await focus(fallback, 900);
    }
  }

  await say('Sequence picker', 'Every video is a sequence you open and drive.', 1600);
  const seq = page.getByLabel(/select sequence/i);
  if (await seq.isVisible().catch(() => false)) {
    await focus(seq, 800);
  }

  await say('Program monitor', 'Watch the master, plates, or a saved compare.', 1800);
  const program = page.getByRole('button', { name: /^program$/i });
  if (await program.isVisible().catch(() => false)) {
    await focus(program, 600);
    await program.click().catch(() => {});
    await wait(400);
  }
  const monitor = page.locator('#program, .monitor, [data-monitor]').first();
  if (await monitor.isVisible().catch(() => false)) {
    await frame(monitor, { holdMs: 500 });
  }

  // —— Brief / New video ——
  await chapter('Start from a brief', 'Audience, outcome, and what to show — then the agent drafts', 2200);

  await say('Open New video', 'A five-step brief steers every line the agent writes.', 1800);
  const newVideo = page.getByRole('button', { name: /new video/i });
  await newVideo.waitFor({ state: 'visible', timeout: 15000 });
  await focus(newVideo, 500);
  await newVideo.click();
  await wait(500);

  const wizard = page.getByRole('dialog', { name: /new video/i });
  if (await wizard.isVisible().catch(() => false)) {
    await say('Basics first', 'Who watches and what they can do after.', 1600);
    const titleField = wizard.locator('input[name="title"]');
    await typeFast(titleField, 'Product tour for first-time editors', 24);
    await wait(180);
    const audience = wizard.locator('input[name="audience"]');
    await typeFast(audience, 'PMs who ship client walkthroughs', 22);
    await wait(160);
    const outcome = wizard.locator('input[name="outcome"]');
    await typeFast(outcome, 'Brief a video and export a handoff pack', 22);
    await wait(200);
    const basics = wizard.getByRole('heading', { name: /what is this video/i });
    if (await basics.isVisible().catch(() => false)) {
      await magnify(wizard.locator('fieldset[data-step="0"]').first(), {
        holdMs: 1400,
        zoom: 1.55,
        label: 'brief-basics',
      });
    }

    const next = wizard.getByRole('button', { name: /^next$/i });
    if (await next.isVisible().catch(() => false)) {
      await say('App access', 'Start URL and optional demo login — secrets stay in .env.', 1800);
      await next.click();
      await wait(400);
      const startUrl = wizard.locator('input[name="startUrl"]');
      await typeFast(startUrl, 'https://app.example.com/dashboard', 20);
      await wait(200);
    }
    if (await next.isVisible().catch(() => false)) {
      await say('Story beats', 'Each must-show line becomes a chapter, in order.', 1600);
      await next.click();
      await wait(400);
      const mustShow = wizard.locator('textarea[name="mustShow"]');
      await typeFast(
        mustShow,
        'Stage bar — Brief through Deliver\nNew video brief\nScript approval\nExport handoff',
        18
      );
      await wait(280);
      await magnify(mustShow, { holdMs: 1200, zoom: 1.65, label: 'must-show' });
    }
    await closeTopDialog(page, wait);
  }

  // —— Script ——
  await chapter('Approve the script', 'Cheap to rewrite now — expensive after a take', 2200);

  await say('Open Script', 'Plates, chapters, captions, and narration in one sheet.', 1800);
  const scriptStage = page.locator('#stageBar .pstage[data-stage="script"]');
  // TODO(verify selector) — accessible name is "Script" plus meta line
  if (await scriptStage.isVisible().catch(() => false)) {
    await focus(scriptStage, 500);
    await scriptStage.click();
    await wait(600);
  } else {
    const byRole = page.getByRole('button', { name: /script/i }).first();
    if (await byRole.isVisible().catch(() => false)) {
      await byRole.click();
      await wait(600);
    }
  }

  const scriptDlg = page.getByRole('dialog', { name: /^script$/i });
  if (await scriptDlg.isVisible().catch(() => false)) {
    await say('Review every beat', 'Approve only when titles, plates, and VO line up.', 2000);
    const approve = scriptDlg.getByRole('button', { name: /approve script/i });
    if (await approve.isVisible().catch(() => false)) {
      await magnify(approve, { holdMs: 1500, zoom: 1.9, label: 'approve-script' });
    } else {
      await wait(700);
    }
    await closeTopDialog(page, wait);
  }

  // —— Render pipeline ——
  await chapter('Run the pipeline', 'Plates, live capture, voice, and mix from one bay', 2200);

  const renderTab = page.getByRole('tab', { name: /^render$/i });
  if (await renderTab.isVisible().catch(() => false)) {
    await renderTab.click();
    await wait(350);
  }

  await say('Render bay', 'Start or queue the jobs that build the master.', 1700);
  const renderBay = page.locator('#leftRender, .render-bay').first();
  if (await renderBay.isVisible().catch(() => false)) {
    await frame(renderBay, { holdMs: 200 });
    await magnify(renderBay, { holdMs: 1300, zoom: 1.5, label: 'render-bay' });
  }

  await say('Queue chips', 'Plates, Audio, Export — add work without leaving the desk.', 1800);
  const queue = page.locator('.queue-add');
  const platesChip = queue.getByRole('button', { name: /^plates$/i });
  const audioChip = queue.getByRole('button', { name: /^audio$/i });
  const exportChip = queue.getByRole('button', { name: /^export$/i });
  const queueTargets = [];
  for (const locator of [platesChip, audioChip, exportChip]) {
    if (await locator.isVisible().catch(() => false)) queueTargets.push({ locator, holdMs: 480 });
  }
  if (queueTargets.length > 1 && typeof follow === 'function') {
    await follow(queueTargets, { travelMs: 380, zoom: 2, label: 'queue pipeline' });
  } else {
    for (const { locator } of queueTargets) await focus(locator, 620);
  }

  await say('One Render pass', 'Record, produce, and mix when the script is pinned.', 1800);
  const makeBtn = page.locator('#btnMake');
  if (await makeBtn.isVisible().catch(() => false)) {
    await magnify(makeBtn, { holdMs: 1400, zoom: 2.0, label: 'render' });
  }

  // —— Feedback ——
  await chapter('Direct with feedback', 'Notes become source edits — then you decide', 2200);

  await say('Open Feedback', 'Write what is wrong; the agent applies it.', 1600);
  const feedbackTab = page.getByRole('tab', { name: /^feedback$/i });
  if (await feedbackTab.isVisible().catch(() => false)) {
    await feedbackTab.click();
    await wait(400);
  }

  const note = page.getByLabel(/director note/i).or(page.locator('#improveNote'));
  if (await note.isVisible().catch(() => false)) {
    await say('Director note', 'Name the plate or beat — keep the ask concrete.', 1700);
    await focus(note, 500);
    await typeFast(note, 'Open plate: center the Studio mark; keep the lift above the title.', 20);
    await wait(250);
    await magnify(note, { holdMs: 1200, zoom: 1.7, label: 'director-note' });
  }

  await say('Apply with AI', 'Sources change first; you approve before a full render.', 1800);
  const apply = page.getByRole('button', { name: /apply feedback/i });
  if (await apply.isVisible().catch(() => false)) await focus(apply, 900);

  const motionTab = page.getByRole('tab', { name: /^motion$/i });
  if (await motionTab.isVisible().catch(() => false)) {
    await say('Motion templates', 'Calm, Clear, or Punchy — one energy for every plate.', 1800);
    await motionTab.click();
    await wait(400);
    const punchy = page.getByRole('radio', { name: /punchy/i });
    if (await punchy.isVisible().catch(() => false)) {
      await focus(punchy, 700);
      await punchy.click().catch(() => {});
      await wait(300);
    } else {
      const clear = page.getByRole('radio', { name: /clear/i });
      if (await clear.isVisible().catch(() => false)) await focus(clear, 800);
    }
  }

  // —— Deliver ——
  await chapter('Export the pack', 'Master, captions, chapters, and poster in one folder', 2200);

  await say('Open Deliver', 'Handoff facts appear after Export builds the pack.', 1600);
  const deliverTab = page.getByRole('tab', { name: /^deliver$/i });
  if (await deliverTab.isVisible().catch(() => false)) {
    await deliverTab.click();
    await wait(400);
  } else {
    const deliverStage = page.locator('#stageBar .pstage[data-stage="deliver"]');
    if (await deliverStage.isVisible().catch(() => false)) {
      await deliverStage.click();
      await wait(400);
    }
  }

  await say('Export handoff', 'Zip the master with captions and YouTube chapters.', 1800);
  const exportBtn = page.getByRole('button', { name: /^export$/i }).first();
  if (await exportBtn.isVisible().catch(() => false)) {
    await magnify(exportBtn, { holdMs: 1500, zoom: 1.9, label: 'export' });
  } else {
    const mediaExport = page.getByRole('button', { name: /export pack/i });
    if (await mediaExport.isVisible().catch(() => false)) {
      await magnify(mediaExport, { holdMs: 1400, zoom: 1.8, label: 'export-pack' });
    }
  }

  await say('Ready to ship', 'Approve the cut, then hand the pack to the client.', 1800);
  await wait(900);

  return { url: page.url(), appUrl: env.appUrl };
}
