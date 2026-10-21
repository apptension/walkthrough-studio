#!/usr/bin/env node
/**
 * Walkthrough video kit.
 *
 *   node cli.mjs list                      videos and their outputs
 *   node cli.mjs discover-brand --name X --url https://… [--app-url https://…] [--force]
 *                                          harvest official logo + draft brand pack + motion-brief.md
 *   node cli.mjs brief <slug> [--audience "…"] [--outcome "…"] [--purpose …] [--url https://…]
 *                                          show the brief, or save a revision and print what must rerun
 *   node cli.mjs new <slug> [--title "…"] [--purpose overview|feature|onboarding|launch|sales]
 *                                          [--description "…"] [--url https://…]
 *                                          scaffold videos/<slug>/. A description and URL draft
 *                                          the brief only — nothing is recorded until you approve it.
 *   node cli.mjs branch <slug> [--discover] [--title "…"] [--angle "…"] [--slug kebab]
 *                                          suggest feature deep-dives from an overview, or copy one into a new project
 *   node cli.mjs plates <slug> [--force]   render brand open/close (+ review.html)
 *   node cli.mjs analyze <slug> [--headed] [--url https://…]
 *                                          map DOM controls + WebGL/canvas pointer recipes → flow-analysis.md
 *   node cli.mjs smoke <slug>              10s overlay + capture check on record.startUrl
 *   node cli.mjs record <slug> [--headed] [--pace calm|steady|brisk|quick|<0.6–2>] [--repair]
 *                                          run flow.mjs → live.mp4 + timeline.json (--pace: this take only;
 *                                          --repair: on capture stall, agent-fix flow.mjs once and re-record)
 *   node cli.mjs produce <slug> [--force]  plates + live → <slug>.mp4 (single encode, chapters)
 *   node cli.mjs voice <slug> [--force]    narration.mjs → ElevenLabs clips fitted to the take (voice/voice.json)
 *   node cli.mjs music <slug> [--force] [--prompt "warm piano, sparse"]
 *                                          music bed composed to the video's length (music/music.mp3)
 *   node cli.mjs mix <slug>                duck music under narration, loudnorm, mux onto <slug>.mp4
 *   node cli.mjs audio <slug> [--force]    voice → music → mix
 *   node cli.mjs validate <slug>           QC frames, contact sheet, review.html
 *   node cli.mjs captions <slug>           SRT + WebVTT + transcript from fitted voice.json
 *   node cli.mjs qc <slug>                pacing / tutorial soft-QC → qc-report.json
 *   node cli.mjs deliver <slug>           handoff package: poster, captions, chapters, QC, deliverables/
 *   node cli.mjs export <slug> [--presets square,vertical,lite,gif]
 *                                          social / light / GIF cuts from the master → exports/
 *   node cli.mjs direction <slug> [--look studio] [--zoom subtle] [--frame inset] [--cursor arrow] [--pace brisk] …
 *                                          show or set scale, logo, focus, frame detail, cursor, keys and live pace
 *   node cli.mjs motion <slug> [--energy clear] [--atmosphere aurora] [--presence 0.6] [--speed 1]
 *                                [--reveal rise|cascade|wipe] [--depth flat|soft|deep] [--sheen on|off]
 *                                [--plate <id|open|close>] [--reset]
 *                                          show or set the video's plate motion; --plate writes a one-plate accent
 *   node cli.mjs story <slug> [--purpose overview|feature|onboarding|launch|sales] [--check]
 *                                          show or set the story spine; --check runs the story critique now
 *   node cli.mjs edit <slug> [--speed from-to@rate]… [--zoom t+dur@zoom:x,y]… [--keep-whole from-to]…
 *                            [--lens t+dur:x,y[:wxh][@zoom]]… [--lens-off t]…
 *                            [--join prev>next=style[:dur]]… [--style <plate> --set --gold=#hex …]
 *                            [--music-gain dB] [--music-offset s] [--music-mute] [--ride from-to@dB]…
 *                            [--voice-gain key=dB] [--voice-nudge key=s] [--voice-mute key]…
 *                            [--master voice=-18,plate=-22,bed=-28,target=-16,peak=-1,duck=5]
 *                            [--clear speed|zooms|keep-whole|lenses|joins|style:<plate>|audio|all]
 *                                          show or change the edit deck (what the Studio Editor writes):
 *                                          speed ramps, manual zooms, zoom-free windows, pinned joins, plate CSS vars
 *   node cli.mjs critic <slug> [--force] [--apply] [--apply-plates]
 *                                          one-shot persona review of narration + plates + pacing
 *   node cli.mjs suggest-plates <slug> [--apply]
 *                                          propose missing interstitials from walkthrough rules
 *   node cli.mjs all <slug>                record → produce → audio (when narration.mjs exists) → validate
 *                                          add --critic to run the persona critic once after validate
 *                                          add --deliver to build captions + poster + handoff after validate
 *   node cli.mjs manual                    manuals/<set>.html from every video with a `manual` block
 *   node cli.mjs publish                   copy delivered lessons into the webapp Help Center (public/help + content json)
 *   node cli.mjs studio [slug] [--port N]  local web panel: player, timeline, captions, QC, versions, critic, agent
 *   node cli.mjs snapshot <slug> [--label] save a version (delivery + settings) under tmp/videos/<slug>/versions/
 *
 * Env: WALKTHROUGH_OUT (default <repo>/tmp/videos), WALKTHROUGH_VIDEOS, WALKTHROUGH_BRANDS.
 *      ELEVENLABS_API_KEY (or kit/.env) for voice and music; WALKTHROUGH_AUDIO_STUB=1 for a
 *      no-credit plumbing check (macOS `say` + synthesized pad).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIT, OUT_ROOT, TEMPLATES, VIDEOS, listVideos, loadVideo } from './lib/project.mjs';

const [cmd, slug, ...rest] = process.argv.slice(2);
// discover-brand has no positional slug; allow the documented `discover-brand --name …` form.
const args = cmd === 'discover-brand' && slug?.startsWith('--') ? [slug, ...rest] : rest;
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function preflight() {
  for (const bin of ['ffmpeg', 'ffprobe']) {
    if (spawnSync(bin, ['-version']).status !== 0) throw new Error(`${bin} not found — brew install ffmpeg`);
  }
  if (!existsSync(join(KIT, 'node_modules', 'playwright'))) {
    throw new Error(`Playwright missing — run: (cd ${KIT} && npm install && npx playwright install chromium)`);
  }
}

/** voice → music → mix; the voice and music steps are cached by content, so re-runs only redo what changed. */
async function audioPass(video, { force }) {
  const { buildVoice } = await import('./lib/audio/voice.mjs');
  const { buildMusic } = await import('./lib/audio/music.mjs');
  const { mixAudio } = await import('./lib/audio/mix.mjs');
  const voice = await buildVoice(video, { force });
  const music = await buildMusic(video, { force });
  if (!voice && !music) return;
  mixAudio(video);
  if (voice?.warnings?.length) {
    console.log('⚠ narration warnings:');
    for (const w of voice.warnings) console.log('  - ' + w);
  }
}

async function main() {
  switch (cmd) {
    case 'list': {
      for (const s of listVideos()) {
        const final = join(OUT_ROOT, s, `${s}.mp4`);
        console.log(`${s.padEnd(28)} ${existsSync(final) ? final : '(not produced)'}`);
      }
      return;
    }
    case 'discover-brand': {
      preflight();
      const name = opt('--name') || slug;
      const url = opt('--url');
      const appUrl = opt('--app-url');
      if (!name || !url) throw new Error('Usage: discover-brand --name <Brand> --url https://… [--app-url https://…] [--force]');
      const { discoverBrandFromUrls } = await import('./lib/discoverBrand.mjs');
      const res = await discoverBrandFromUrls({
        name,
        url,
        appUrl,
        audience: opt('--audience') || '',
        force: flag('--force'),
        onProgress: (msg) => console.log(`› ${msg}`),
      });
      console.log(`✓ brand pack → ${res.dir}`);
      console.log(`  logo candidates: ${res.report.logos.length} · saved ${res.saved.length} asset(s)`);
      console.log(`  review logo.html + motion-brief.md before plates`);
      if (res.report.warning) console.log(`  ⚠ ${res.report.warning}`);
      return;
    }
    case 'brief': {
      if (!slug) throw new Error('Usage: brief <slug> [--audience "…"] [--outcome "…"] [--purpose …] [--url https://…]');
      const video = loadVideo(slug);
      const { readFileSync: readText, existsSync: exists } = await import('node:fs');
      const briefPath = join(video.dir, 'brief.json');
      const current = exists(briefPath) ? JSON.parse(readText(briefPath, 'utf8')) : {};
      const patch = {};
      if (opt('--audience')) patch.audience = opt('--audience');
      if (opt('--outcome')) patch.outcome = opt('--outcome');
      if (opt('--purpose')) patch.purpose = opt('--purpose');
      if (opt('--url')) patch.app = { ...(current.app || {}), startUrl: opt('--url') };
      if (!Object.keys(patch).length) {
        console.log(JSON.stringify({ title: current.title, audience: current.audience, purpose: current.purpose, startUrl: current.app?.startUrl }, null, 2));
        return;
      }
      const { revisePlan, nextBrief } = await import('./studio/briefRevise.js');
      const { applyBriefRevision, saveSourceRevision } = await import('./lib/briefRevise.mjs');
      const plan = revisePlan(current, { ...current, ...patch, app: patch.app || current.app, story: current.story });
      if (!plan.changed.length) {
        console.log('No brief changes.');
        return;
      }
      const revision = saveSourceRevision(video);
      applyBriefRevision(video, nextBrief(current, { ...current, ...patch, app: patch.app || current.app, story: current.story, brand: current.brand, proof: current.proof }));
      console.log(`✓ revision ${revision.id}`);
      console.log(`  changed: ${plan.changed.map((item) => item.label).join(', ')}`);
      console.log(`  rerun: ${plan.stages.join(', ') || 'none'}`);
      if (plan.needsRecord) console.log('  footage: re-record before the next render');
      if (plan.stages.includes('planner')) console.log(`  next: node cli.mjs studio ${slug}  (or re-draft from Project settings)`);
      if (plan.stages.includes('analyze')) console.log(`  next: node cli.mjs analyze ${slug}`);
      return;
    }
    case 'new': {
      if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
        throw new Error('Usage: new <kebab-slug> [--title "…"] [--purpose …] [--description "…"] [--url https://…]');
      }
      const { scaffoldVideo } = await import('./lib/project.mjs');
      const { PURPOSE_IDS } = await import('./lib/narrative.mjs');
      const description = opt('--description');
      const startUrl = opt('--url');
      if (description && !startUrl) throw new Error('A description needs --url https://… — nothing was recorded.');
      const purpose = opt('--purpose');
      if (purpose && !PURPOSE_IDS.includes(purpose)) throw new Error(`--purpose must be one of ${PURPOSE_IDS.join(', ')}`);
      let drafted = null;
      let title = opt('--title');
      if (description) {
        const { draftFromDescription } = await import('./studio/shortBrief.js');
        drafted = draftFromDescription({ description, startUrl });
        if (drafted.records) throw new Error('A description draft must not record.');
        title = title || drafted.title;
      }
      const dir = scaffoldVideo(slug, { title });
      const cfgPath = join(dir, 'video.config.json');
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
      if (drafted) {
        const { applyDraftToConfig } = await import('./studio/shortBrief.js');
        const next = applyDraftToConfig(cfg, drafted);
        if (purpose) next.purpose = purpose;
        writeFileSync(cfgPath, JSON.stringify(next, null, 2) + '\n');
        console.log(`✓ ${dir}`);
        console.log('  Drafted from your description. Nothing was recorded.');
        console.log(`  Title: ${next.title}`);
        console.log(`  Audience: ${next.audience}`);
        console.log(`  Purpose: ${next.purpose} · ${drafted.lengthSec}s`);
        console.log(`  Start: ${next.record.startUrl}`);
        for (const chapter of drafted.chapters) console.log(`  · ${chapter}`);
        console.log(`  Edit the brief, then approve it before: node cli.mjs record ${slug}`);
        return;
      }
      if (purpose || startUrl) {
        if (purpose) cfg.purpose = purpose;
        if (startUrl) cfg.record = { ...(cfg.record || {}), startUrl };
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
      }
      console.log(`✓ ${dir}\n  1. edit video.config.json (copy, steps, env)\n  2. write flow.mjs\n  3. node cli.mjs plates ${slug} → review the brand plates\n  4. node cli.mjs all ${slug}`);
      return;
    }
    case 'branch': {
      if (!slug) throw new Error('Usage: branch <slug> [--discover] | branch <slug> --title "…" [--angle "…"] [--slug kebab]');
      const video = loadVideo(slug);
      const {
        createBranch,
        mergeBranchIdeas,
        readBranchIdeas,
        suggestBranchIdeas,
        writeBranchIdeas,
      } = await import('./lib/branch.mjs');
      if (flag('--discover') || (!opt('--title') && !opt('--slug'))) {
        const heuristic = suggestBranchIdeas(video);
        const merged = mergeBranchIdeas(heuristic, readBranchIdeas(video));
        writeBranchIdeas(video, merged);
        console.log(`${merged.ideas.length} branch idea(s) from ${slug}${merged.agent ? ' (incl. agent)' : ''}:`);
        for (const idea of merged.ideas) {
          console.log(`  · ${idea.id.padEnd(22)} ${idea.title}`);
          if (idea.angle) console.log(`      ${idea.angle}`);
        }
        console.log(`\nCreate one: node cli.mjs branch ${slug} --title "…"\nOr in Studio: Branch → pick a card.`);
        return;
      }
      const created = createBranch(slug, {
        title: opt('--title'),
        slug: opt('--slug'),
        angle: opt('--angle'),
        outcome: opt('--outcome'),
        purpose: opt('--purpose') || 'feature',
      });
      console.log(`✓ branched ${slug} → ${created.slug} (folder ${created.folderId})`);
      console.log(`  brief + flow/narration copied — rewrite in Studio or run the branch draft agent`);
      console.log(`  next: node cli.mjs studio ${created.slug}`);
      return;
    }
    case 'plates': {
      preflight();
      const video = loadVideo(slug);
      const { renderPlates } = await import('./lib/plates.mjs');
      const { writeReview } = await import('./lib/validate.mjs');
      // --only open|close|plate:<id>  (or bare interstitial id)
      let only = opt('--only') || undefined;
      if (only && !['open', 'close', 'interstitials'].includes(only) && !only.startsWith('plate:')) {
        only = `plate:${only}`;
      }
      await renderPlates(video, { force: flag('--force'), only });
      console.log(`✓ review page → ${writeReview(video, null)}`);
      return;
    }
    case 'analyze': {
      preflight();
      if (!slug) throw new Error('Usage: analyze <slug> [--headed] [--url https://…]');
      const video = loadVideo(slug);
      const { analyzeFlow } = await import('./lib/analyzeFlow.mjs');
      const report = await analyzeFlow(video, {
        headed: flag('--headed'),
        url: opt('--url'),
      });
      console.log(`✓ flow analysis → ${join(video.dir, 'flow-analysis.md')}`);
      console.log(
        `  ${report.dom.controls.length} controls · ${report.hints.formCount || 0} forms · ${report.hints.fillableFieldCount || 0} fills · ${report.canvases.length} canvases · ${report.hints.interactiveCanvasCount} pointer-reactive`
      );
      if (report.hints.hasWebGL) console.log('  tip: WebGL detected — prefer record.deviceScaleFactor: 1 and mouse drags on the canvas');
      return;
    }
    case 'smoke': {
      preflight();
      const video = loadVideo(slug);
      const { recordLive } = await import('./lib/record.mjs');
      const { duration } = await import('./lib/produce.mjs');
      const outFile = join(video.out, 'smoke.mp4');
      const res = await recordLive(video, {
        outFile,
        writeMeta: false,
        flow: async ({ chapter, say, wait }) => {
          await chapter('Smoke test', 'Chapter card, caption and capture timing');
          await say('Caption check', 'Font, colors and exit animation should look final.', 2400);
          await wait(2600);
        },
      });
      const fileSec = duration(outFile);
      const drift = Math.abs(fileSec - res.wallSec);
      console.log(`  file ${fileSec.toFixed(2)}s vs wall ${res.wallSec.toFixed(2)}s (drift ${drift.toFixed(2)}s)`);
      if (drift > 0.5) throw new Error('Capture timing drift > 0.5s — frame placement is broken');
      console.log('✓ smoke ok');
      return;
    }
    case 'record': {
      preflight();
      const video = loadVideo(slug);
      const loginRequired = Boolean(video.config?.record?.loginRequired);
      const headed = flag('--headed') || (loginRequired && !flag('--headless'));
      if (headed && loginRequired && !flag('--headed')) {
        console.log('» record · Sign-in is on, so the browser stays visible.');
      }
      const live = join(video.out, 'live.mp4');
      const metaPath = join(video.out, 'live-meta.json');
      let recordedUrl = '';
      let recordedLogin = null;
      if (existsSync(metaPath)) {
        try {
          const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
          recordedUrl = meta.startUrl || '';
          if ('loginRequired' in meta) recordedLogin = meta.loginRequired;
        } catch {
          /* an unreadable meta file still allows the take */
        }
      }
      const startUrl = video.config?.record?.startUrl || '';
      const flowPath = join(video.dir, 'flow.mjs');
      const hasLive = existsSync(live);
      const { recordTakeNote } = await import('./lib/recordFreshness.mjs');
      const note = recordTakeNote({
        hasLive,
        flowNewer: hasLive && existsSync(flowPath) && statSync(flowPath).mtimeMs > statSync(live).mtimeMs,
        urlChanged: Boolean(recordedUrl && startUrl && recordedUrl !== startUrl),
        loginChanged: recordedLogin != null && Boolean(recordedLogin) !== loginRequired,
      });
      if (note) console.log(`» ${note}`);
      const recOpts = { headed, pace: opt('--pace') };
      const { recordLive } = await import('./lib/record.mjs');
      const { formatStallNote, readStallReport } = await import('./lib/captureStall.mjs');
      const { readOverlayReport } = await import('./lib/overlayRetry.mjs');
      const { readSelectorReport, usesStallRepair } = await import('./lib/selectorRetry.mjs');
      const { captureRepairDecision, captureRepairLimit } = await import('./lib/captureRepairLoop.mjs');
      const maxRepairs = captureRepairLimit();
      let captureAttempt = 1;
      while (true) {
        try {
          await recordLive(video, recOpts);
          break;
        } catch (err) {
          const stall = readStallReport(video) || err?.report;
          const overlay = readOverlayReport(video);
          const selector = readSelectorReport(video);
          const repairable = usesStallRepair({
            stall,
            overlay: Boolean(overlay),
            selector,
            selectorRetry: false,
          });
          const decision = captureRepairDecision({ captureAttempt, maxRepairs, repairable });
          if (!flag('--repair') || decision.action === 'fail') throw err;

          console.log(`» repair ${decision.repairAttempt}/${maxRepairs} · Running capture-repair agent`);
          const { startImprove, waitForJob } = await import('./lib/agentRunner.mjs');
          const repairNote = stall
            ? formatStallNote(stall)
            : selector?.detail || overlay?.detail || overlay?.summary || String(err?.message || err);
          const job = startImprove(video, 'capture-repair', { note: repairNote, force: true });
          await waitForJob(job);
          if (job.status !== 'done') {
            console.error(`✗ repair ${decision.repairAttempt}/${maxRepairs} failed — ${job.activity || job.status}`);
            throw err;
          }
          captureAttempt = decision.nextCaptureAttempt;
          console.log(`» record · Capturing again after repair ${decision.repairAttempt}/${maxRepairs}`);
        }
      }
      return;
    }
    case 'produce': {
      preflight();
      const { produce } = await import('./lib/produce.mjs');
      await produce(loadVideo(slug), { forcePlates: flag('--force') });
      return;
    }
    case 'voice': {
      preflight();
      const { buildVoice } = await import('./lib/audio/voice.mjs');
      await buildVoice(loadVideo(slug), { force: flag('--force') });
      return;
    }
    case 'music': {
      preflight();
      const { buildMusic, normalizeMusicPrompt } = await import('./lib/audio/music.mjs');
      const promptOpt = opt('--prompt');
      const video = loadVideo(slug);
      if (promptOpt != null) {
        const prompt = normalizeMusicPrompt(promptOpt);
        const pathCfg = video.configPath;
        const current = JSON.parse(readFileSync(pathCfg, 'utf8'));
        current.audio = current.audio && typeof current.audio === 'object' ? current.audio : {};
        current.audio.music = current.audio.music && typeof current.audio.music === 'object' ? current.audio.music : {};
        if (prompt) current.audio.music.prompt = prompt;
        else delete current.audio.music.prompt;
        if (!Object.keys(current.audio.music).length) delete current.audio.music;
        if (!Object.keys(current.audio).length) delete current.audio;
        writeFileSync(pathCfg, JSON.stringify(current, null, 2) + '\n');
      }
      await buildMusic(loadVideo(slug), { force: flag('--force'), prompt: promptOpt != null ? normalizeMusicPrompt(promptOpt) : null });
      return;
    }
    case 'mix': {
      preflight();
      const { mixAudio } = await import('./lib/audio/mix.mjs');
      mixAudio(loadVideo(slug));
      return;
    }
    case 'audio': {
      preflight();
      await audioPass(loadVideo(slug), { force: flag('--force') });
      return;
    }
    case 'validate': {
      const { validate } = await import('./lib/validate.mjs');
      validate(loadVideo(slug));
      return;
    }
    case 'captions': {
      if (!slug) throw new Error('Usage: captions <slug>');
      const { writeCaptions } = await import('./lib/captions.mjs');
      writeCaptions(loadVideo(slug));
      return;
    }
    case 'qc': {
      if (!slug) throw new Error('Usage: qc <slug>');
      const { runPacingQc } = await import('./lib/pacing.mjs');
      const report = runPacingQc(loadVideo(slug));
      if (report.status === 'fail') process.exitCode = 1;
      return;
    }
    case 'deliver': {
      if (!slug) throw new Error('Usage: deliver <slug>');
      preflight();
      const { deliverPackage } = await import('./lib/deliver.mjs');
      const { qc } = deliverPackage(loadVideo(slug));
      if (qc.status === 'fail') process.exitCode = 1;
      return;
    }
    case 'export': {
      if (!slug) throw new Error('Usage: export <slug> [--presets square,vertical,lite,gif]');
      preflight();
      const { buildExports, EXPORT_PRESETS } = await import('./lib/exports.mjs');
      const ids = (opt('--presets') || Object.keys(EXPORT_PRESETS).join(',')).split(',').map((s) => s.trim()).filter(Boolean);
      await buildExports(loadVideo(slug), ids);
      return;
    }
    case 'direction': {
      if (!slug) {
        throw new Error(
          'Usage: direction <slug> [--scale official|logo|site|harmony] [--logo <file>] [--focus guided|spotlight|ring]\n' +
            '       [--look studio|cinematic|social|minimal] [--zoom off|subtle|bold] [--frame full|inset]\n' +
            '       [--background brand|ink|accent] [--padding tight|balanced|roomy] [--corners square|soft|round]\n' +
            '       [--shadow off|soft|deep] [--cursor classic|arrow|dot] [--cursor-size s|m|l]\n' +
            '       [--glide on|off] [--hide-idle on|off] [--loop on|off] [--keys on|off]\n' +
            '       [--pace calm|steady|brisk|quick|<0.6–2>] [--approve]'
        );
      }
      const { patchDirection } = await import('./lib/direction.mjs');
      const video = loadVideo(slug);
      const onOff = (name) => {
        const value = opt(name);
        if (value === undefined) return undefined;
        if (!['on', 'off'].includes(value)) throw new Error(`${name} must be on or off`);
        return value === 'on';
      };
      const camera = Object.fromEntries(
        [
          ['zoom', opt('--zoom')],
          ['frame', opt('--frame')],
          ['background', opt('--background')],
          ['padding', opt('--padding')],
          ['corners', opt('--corners')],
          ['shadow', opt('--shadow')],
        ].filter(([, v]) => v)
      );
      const cursor = Object.fromEntries(
        [
          ['style', opt('--cursor')],
          ['size', opt('--cursor-size')],
          ['glide', onOff('--glide')],
          ['hideIdle', onOff('--hide-idle')],
          ['loop', onOff('--loop')],
        ].filter(([, v]) => v !== undefined)
      );
      const body = {
        ...(opt('--look') && { look: opt('--look') }),
        ...(opt('--scale') && { scale: opt('--scale') }),
        ...(opt('--logo') && { logo: opt('--logo') }),
        ...(opt('--focus') && { focus: opt('--focus') }),
        ...(Object.keys(camera).length && { camera }),
        ...(Object.keys(cursor).length && { cursor }),
        ...(onOff('--keys') !== undefined && { keys: onOff('--keys') }),
        ...(opt('--pace') !== undefined && { pace: opt('--pace') }),
        ...(flag('--approve') && { approve: true }),
      };
      const pathCfg = join(video.dir, 'video.config.json');
      if (Object.keys(body).length) {
        const current = JSON.parse(readFileSync(pathCfg, 'utf8'));
        const direction = patchDirection(current.direction || {}, body, video.brand);
        writeFileSync(pathCfg, JSON.stringify({ ...current, direction }, null, 2) + '\n');
      }
      const d = loadVideo(slug).brand.direction;
      console.log(`${slug} direction${d.approvedAt ? ' (approved)' : ''}`);
      console.log(`  scale     ${d.scale}  ${d.swatches.join(' ')}`);
      console.log(`  logo      ${d.logo || '—'}   (choices: ${d.lockups.map((l) => l.file).join(', ') || 'none'})`);
      console.log(`  focus     ${d.focus}`);
      console.log(`  look      ${d.look || 'custom'}`);
      console.log(
        `  camera    zoom ${d.camera.zoom} · frame ${d.camera.frame}${
          d.camera.frame === 'inset'
            ? ` on ${d.camera.background} · ${d.camera.padding} · ${d.camera.corners} corners · ${d.camera.shadow} shadow`
            : ''
        }`
      );
      console.log(
        `  cursor    ${d.cursor.style} · size ${d.cursor.size} · glide ${d.cursor.glide ? 'on' : 'off'} · idle ${
          d.cursor.hideIdle ? 'hide' : 'show'
        } · loop ${d.cursor.loop ? 'on' : 'off'} · keys ${d.keys ? 'on' : 'off'}`
      );
      console.log(
        `  pace      ${d.pace.id}${d.pace.custom ? '' : ` (${d.pace.tempo}×)`} — ${d.pace.hint}` +
          (d.pace.id === 'steady' ? '   (calm 0.85× · brisk 1.25× · quick 1.5× · or a multiplier)' : '')
      );
      console.log('  scales    ' + d.scales.map((s) => s.id).join(', '));
      return;
    }
    case 'motion': {
      const { ATMOSPHERE_IDS, ATMOSPHERE_LABELS, motionOverrides, patchMotion, resolveMotion } = await import('./lib/plateMotion.mjs');
      if (!slug) {
        throw new Error(
          `Usage: motion <slug> [--energy calm|clear|punchy] [--atmosphere ${ATMOSPHERE_IDS.join('|')}]\n` +
            '       [--presence 0–1] [--speed 0.3–3] [--reveal rise|cascade|wipe] [--depth flat|soft|deep] [--sheen on|off]\n' +
            '       [--plate <id|open|close>] [--reset]   (per-plate accent; --reset drops the override)'
        );
      }
      const video = loadVideo(slug);
      const patch = {
        ...(opt('--energy') && { energy: opt('--energy') }),
        ...(opt('--atmosphere') && { atmosphere: opt('--atmosphere') }),
        ...(opt('--presence') && { atmosphereOpacity: opt('--presence') }),
        ...(opt('--speed') && { atmosphereSpeed: opt('--speed') }),
        ...(opt('--reveal') && { titleReveal: opt('--reveal') }),
        ...(opt('--depth') && { depth: opt('--depth') }),
        ...(opt('--sheen') && { sheen: opt('--sheen') }),
      };
      const plateId = opt('--plate');
      const cfgPath = join(video.dir, 'video.config.json');
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
      if (plateId) {
        const target =
          plateId === 'open' || plateId === 'close'
            ? (cfg[plateId] = cfg[plateId] || {})
            : (cfg.interstitials || []).find((i) => i.id === plateId);
        if (!target) throw new Error(`No plate "${plateId}" in ${cfgPath}`);
        if (flag('--reset')) delete target.motion;
        else if (Object.keys(patch).length) {
          const next = patchMotion(target.motion || {}, patch);
          if (Object.keys(next).length) target.motion = next;
          else delete target.motion;
        }
        if (flag('--reset') || Object.keys(patch).length) writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
        const ov = motionOverrides(target.motion);
        console.log(`${slug} · plate ${plateId}${ov.length ? ` overrides ${ov.map((k) => `${k}=${target.motion[k]}`).join(' ')}` : ' follows the video'}`);
        return;
      }
      if (Object.keys(patch).length || flag('--reset')) {
        cfg.direction = cfg.direction || {};
        cfg.direction.motion = flag('--reset') ? {} : patchMotion(cfg.direction.motion || {}, patch);
        delete cfg.direction.approvedAt;
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
      }
      const m = resolveMotion(loadVideo(slug).brand);
      console.log(`${slug} motion`);
      console.log(`  energy      ${m.energy} · enter ${m.enterMs}ms · stagger ${m.staggerMs}ms · push ${m.pushScale}`);
      console.log(`  atmosphere  ${ATMOSPHERE_LABELS[m.atmosphere] || m.atmosphere}${m.atmosphereOpacity != null ? ` · presence ${m.atmosphereOpacity}` : ''}${m.atmosphereSpeed != null ? ` · speed ${m.atmosphereSpeed}×` : ''}`);
      console.log(`  effects     title ${m.titleReveal} · depth ${m.depth} · sheen ${m.sheen ? 'on' : 'off'}`);
      const accents = (cfg.interstitials || []).filter((i) => motionOverrides(i.motion).length);
      for (const id of ['open', 'close']) if (motionOverrides(cfg[id]?.motion).length) accents.push({ id, motion: cfg[id].motion });
      if (accents.length) console.log(`  accents     ${accents.map((i) => `${i.id} (${motionOverrides(i.motion).join(', ')})`).join(' · ')}`);
      if (Object.keys(patch).length) console.log(`  plates rebuild on the next \`plates\` / \`produce\` run`);
      return;
    }
    case 'edit': {
      if (!slug) {
        throw new Error(
          'Usage: edit <slug> [--speed from-to@rate]… [--zoom t+dur@zoom:x,y]… [--keep-whole from-to]…\n' +
            '       [--lens t+dur:x,y[:wxh][@zoom]]… [--lens-off t]…\n' +
            '       [--join prev>next=style[:dur]]… [--style <plate> --set --var=value …]\n' +
            '       [--music-gain dB] [--music-offset s] [--music-mute] [--ride from-to@dB]…\n' +
            '       [--voice-gain key=dB] [--voice-nudge key=s] [--voice-mute key]…\n' +
            '       [--master voice=-18,bed=-28,target=-16,duck=4] [--clear …|audio|all]\n' +
            '  Times are seconds in the recording (live.mp4). Run with no flags to print the deck.'
        );
      }
      const { STYLE_GROUPS, compactEdit, describeDeck, liveTimeMap, patchEdit, patchStyle, plateTarget, rampConflicts } =
        await import('./lib/editDeck.mjs');
      const { compactAudio } = await import('./lib/audio/desk.mjs');
      const { TRANSITION_STYLES, loadRawTimeline, resolveEdit } = await import('./lib/edit.mjs');
      const { duration } = await import('./lib/media.mjs');
      const video = loadVideo(slug);
      const cfgPath = join(video.dir, 'video.config.json');
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
      const LIVE = join(video.out, 'live.mp4');
      const liveDur = existsSync(LIVE) ? duration(LIVE) : Infinity;
      const viewport = cfg.record?.viewport || {};
      const opts = { liveDur, width: viewport.width || 1920, height: viewport.height || 1080, styles: TRANSITION_STYLES };
      const all = (name) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
      const num = (v, what) => {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new Error(`${what}: "${v}" is not a number`);
        return n;
      };
      let deck = resolveEdit(video, { liveDur });
      let changed = false;
      const clear = opt('--clear');
      if (clear) {
        if (clear === 'all') deck = patchEdit(deck, { reset: true }, opts);
        else if (clear === 'speed') deck = patchEdit(deck, { speed: [] }, opts);
        else if (clear === 'zooms') deck = patchEdit(deck, { zooms: [] }, opts);
        else if (clear === 'keep-whole') deck = patchEdit(deck, { zoomSkips: [] }, opts);
        else if (clear === 'lenses') deck = patchEdit(deck, { lenses: [], lensOff: [] }, opts);
        else if (clear === 'audio') deck = patchEdit(deck, { audio: null }, opts);
        else if (clear === 'joins') deck = patchEdit(deck, { transitions: {} }, opts);
        else if (clear.startsWith('style:')) {
          const target = plateTarget(cfg, clear.slice(6));
          if (!target) throw new Error(`No plate "${clear.slice(6)}"`);
          delete target.style;
        } else throw new Error('--clear expects speed|zooms|keep-whole|lenses|audio|joins|style:<plate>|all');
        changed = true;
      }
      const speed = [...deck.speed];
      for (const spec of all('--speed')) {
        const m = spec.match(/^([\d.]+)-([\d.]+)@([\d.]+)$/);
        if (!m) throw new Error(`--speed expects from-to@rate (got ${spec})`);
        const from = num(m[1], '--speed from');
        const to = num(m[2], '--speed to');
        speed.splice(0, speed.length, ...speed.filter((r) => r.to <= from || r.from >= to), { from, to, rate: num(m[3], '--speed rate') });
        changed = true;
      }
      const zooms = [...deck.zooms];
      for (const spec of all('--zoom')) {
        const m = spec.match(/^([\d.]+)\+([\d.]+)@([\d.]+)(?::([\d.]+),([\d.]+))?$/);
        if (!m) throw new Error(`--zoom expects t+dur@zoom[:x,y] (got ${spec})`);
        zooms.push({ t: num(m[1], 'zoom t'), dur: num(m[2], 'zoom dur'), zoom: num(m[3], 'zoom level'), ...(m[4] ? { x: num(m[4], 'x'), y: num(m[5], 'y') } : {}) });
        changed = true;
      }
      const zoomSkips = [...deck.zoomSkips];
      for (const spec of all('--keep-whole')) {
        const m = spec.match(/^([\d.]+)-([\d.]+)$/);
        if (!m) throw new Error(`--keep-whole expects from-to (got ${spec})`);
        zoomSkips.push({ from: num(m[1], 'from'), to: num(m[2], 'to') });
        changed = true;
      }
      const lenses = [...deck.lenses];
      for (const spec of all('--lens')) {
        const m = spec.match(/^([\d.]+)\+([\d.]+):(\d+),(\d+)(?::(\d+)x(\d+))?(?:@([\d.]+))?$/);
        if (!m) throw new Error(`--lens expects t+dur:x,y[:wxh][@zoom] (got ${spec}); x,y is the target centre`);
        lenses.push({
          t: num(m[1], 'lens t'),
          dur: num(m[2], 'lens dur'),
          x: num(m[3], 'x'),
          y: num(m[4], 'y'),
          ...(m[5] ? { w: num(m[5], 'w'), h: num(m[6], 'h') } : {}),
          ...(m[7] ? { zoom: num(m[7], 'lens zoom') } : {}),
        });
        changed = true;
      }
      const lensOff = [...deck.lensOff];
      for (const spec of all('--lens-off')) {
        lensOff.push(num(spec, '--lens-off'));
        changed = true;
      }
      const transitions = { ...deck.transitions };
      for (const spec of all('--join')) {
        const m = spec.match(/^([a-z0-9-]+>[a-z0-9-]+)=([a-z]+)(?::([\d.]+))?$/);
        if (!m) throw new Error(`--join expects prev>next=style[:dur] (got ${spec}); live slices are just "live"`);
        transitions[m[1]] = { style: m[2], ...(m[3] ? { duration: num(m[3], 'join dur') } : {}) };
        changed = true;
      }
      let audio = deck.audio;
      const touchAudio = (patch) => {
        audio = { ...audio, ...patch, music: { ...audio.music, ...(patch.music || {}) }, master: { ...audio.master, ...(patch.master || {}) } };
        if (patch.voice) audio.voice = patch.voice;
        changed = true;
      };
      if (opt('--music-gain')) touchAudio({ music: { gainDb: num(opt('--music-gain'), '--music-gain') } });
      if (opt('--music-offset')) touchAudio({ music: { offset: num(opt('--music-offset'), '--music-offset') } });
      if (flag('--music-mute')) touchAudio({ music: { mute: true } });
      for (const spec of all('--ride')) {
        const m = spec.match(/^([\d.]+)-([\d.]+)@(-?[\d.]+)$/);
        if (!m) throw new Error(`--ride expects from-to@dB (got ${spec})`);
        audio = { ...audio, music: { ...audio.music, rides: [...(audio.music?.rides || []), { from: num(m[1], 'from'), to: num(m[2], 'to'), gainDb: num(m[3], 'dB') }] } };
        changed = true;
      }
      for (const spec of all('--voice-gain')) {
        const m = spec.match(/^(.+)=(-?[\d.]+)$/);
        if (!m) throw new Error(`--voice-gain expects key=dB (got ${spec})`);
        audio = { ...audio, voice: [...(audio.voice || []).filter((v) => v.key !== m[1]), { ...(audio.voice || []).find((v) => v.key === m[1]), key: m[1], gainDb: num(m[2], 'dB') }] };
        changed = true;
      }
      for (const spec of all('--voice-nudge')) {
        const m = spec.match(/^(.+)=(-?[\d.]+)$/);
        if (!m) throw new Error(`--voice-nudge expects key=seconds (got ${spec})`);
        audio = { ...audio, voice: [...(audio.voice || []).filter((v) => v.key !== m[1]), { ...(audio.voice || []).find((v) => v.key === m[1]), key: m[1], nudge: num(m[2], 'nudge') }] };
        changed = true;
      }
      for (const spec of all('--voice-mute')) {
        audio = { ...audio, voice: [...(audio.voice || []).filter((v) => v.key !== spec), { ...(audio.voice || []).find((v) => v.key === spec), key: spec, mute: true }] };
        changed = true;
      }
      const masterSpec = opt('--master');
      if (masterSpec) {
        const master = {};
        for (const part of masterSpec.split(',')) {
          const [k, v] = part.split('=');
          const map = { voice: 'voiceLufs', plate: 'plateLufs', bed: 'bedLufs', target: 'targetLufs', peak: 'truePeakDb', duck: 'duckRatio' };
          if (!map[k]) throw new Error(`--master key "${k}" — use voice, plate, bed, target, peak, duck`);
          master[map[k]] = num(v, k);
        }
        touchAudio({ master });
      }
      if (changed) deck = patchEdit(deck, { speed, zooms, zoomSkips, lenses, lensOff, transitions, audio }, opts);
      const stylePlate = opt('--style');
      if (stylePlate) {
        const target = plateTarget(cfg, stylePlate, { create: true });
        if (!target) throw new Error(`No plate "${stylePlate}" in ${cfgPath}`);
        const sets = args.slice(args.indexOf('--set') + 1).filter((a) => a.startsWith('--') && a.includes('='));
        if (!args.includes('--set') || !sets.length) throw new Error('--style needs --set --var=value [--var=value …]');
        const patch = Object.fromEntries(sets.map((a) => a.split(/=(.*)/s).slice(0, 2)));
        const next = patchStyle(target.style || {}, patch, stylePlate);
        if (next) target.style = next;
        else delete target.style;
        changed = true;
      }
      if (changed) {
        const compact = compactEdit(deck);
        if (compact) cfg.edit = compact;
        else delete cfg.edit;
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
        console.log(`✓ ${cfgPath}`);
      }
      // Report
      console.log(`» deck · ${describeDeck(deck)}`);
      if (Number.isFinite(liveDur)) {
        const map = liveTimeMap(deck.speed, liveDur);
        if (!map.identity) console.log(`· live ${liveDur.toFixed(1)}s → ${map.cleanDur.toFixed(1)}s after speed ramps`);
        for (const r of deck.speed) console.log(`· speed ${r.from}s–${r.to}s at ${r.rate}×`);
        for (const c of rampConflicts(deck, loadRawTimeline(video))) {
          console.log(`  ! ramp ${c.from}–${c.to}s covers ${c.marks.map((m) => `${m.kind} "${m.label}"`).join(', ')}`);
        }
      }
      for (const z of deck.zooms) console.log(`· zoom ${z.id} at ${z.t}s for ${z.dur}s · ${z.zoom}× on ${z.x},${z.y}`);
      for (const s of deck.zoomSkips) console.log(`· keep whole ${s.from}s–${s.to}s`);
      for (const l of deck.lenses) console.log(`· magnifier ${l.id} at ${l.t}s for ${l.dur}s · ${l.w}×${l.h} on ${l.x},${l.y}${l.zoom ? ` · ${l.zoom}×` : ''}`);
      const heard = compactAudio(deck.audio);
      if (heard?.music) console.log(`· music ${heard.music.mute ? 'off' : `${heard.music.gainDb || 0} dB`}${heard.music.offset ? ` · slip ${heard.music.offset}s` : ''}${(heard.music.rides || []).map((r) => ` · ride ${r.from}–${r.to}s ${r.gainDb}dB`).join('')}`);
      for (const v of heard?.voice || []) console.log(`· voice ${v.key}${v.mute ? ' muted' : ''}${v.gainDb ? ` ${v.gainDb}dB` : ''}${v.nudge ? ` nudge ${v.nudge}s` : ''}`);
      if (heard?.master) console.log(`· master ${Object.entries(heard.master).map(([k, v]) => `${k}=${v}`).join(' ')}`);
      for (const t of deck.lensOff) console.log(`· recorded magnifier at ${t}s off`);
      for (const [k, v] of Object.entries(deck.transitions)) console.log(`· join ${k} → ${v.style || 'video style'}${v.duration ? ` ${v.duration}s` : ''}`);
      for (const id of ['open', 'close', ...(cfg.interstitials || []).map((i) => i.id)]) {
        const style = plateTarget(cfg, id)?.style;
        if (style) console.log(`· style ${id}: ${Object.entries(style).map(([k, v]) => `${k}=${v}`).join(' ')}`);
      }
      if (!changed && !deck.speed.length && !deck.zooms.length) {
        console.log(`· variables: ${STYLE_GROUPS.map((g) => `${g.label} (${g.vars.map((v) => v.name).join(', ')})`).join('; ')}`);
      }
      break;
    }
    case 'story': {
      if (!slug) throw new Error('Usage: story <slug> [--purpose overview|feature|onboarding|launch|sales] [--check]');
      const { PURPOSES, PURPOSE_IDS, critiqueStory, resolvePurpose, storyBrief } = await import('./lib/narrative.mjs');
      const video = loadVideo(slug);
      const cfgPath = join(video.dir, 'video.config.json');
      const purposeArg = opt('--purpose');
      if (purposeArg) {
        if (!PURPOSE_IDS.includes(purposeArg)) throw new Error(`--purpose must be one of ${PURPOSE_IDS.join(', ')}`);
        const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
        cfg.purpose = purposeArg;
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
        const briefPath = join(video.dir, 'brief.json');
        if (existsSync(briefPath)) {
          const brief = JSON.parse(readFileSync(briefPath, 'utf8'));
          writeFileSync(briefPath, JSON.stringify({ ...brief, purpose: purposeArg }, null, 2) + '\n');
        }
      }
      const fresh = loadVideo(slug);
      const briefPath = join(fresh.dir, 'brief.json');
      const brief = existsSync(briefPath) ? JSON.parse(readFileSync(briefPath, 'utf8')) : null;
      const purpose = resolvePurpose(fresh.config, brief);
      const explicit = PURPOSE_IDS.includes(fresh.config.purpose) || PURPOSE_IDS.includes(brief?.purpose);
      console.log(`${slug} · ${PURPOSES[purpose].label}${explicit ? '' : ' (guessed from the audience — set it with --purpose)'}`);
      console.log(storyBrief(purpose));
      if (flag('--check')) {
        const { loadNarrationLines } = await import('./lib/critic.mjs');
        const lines = await loadNarrationLines(fresh);
        const { findings } = critiqueStory(fresh.config, lines, { brief });
        console.log('');
        console.log(findings.length ? `${findings.length} story finding(s):` : 'Story check clean.');
        for (const f of findings) console.log(`  [${f.severity}] ${f.target} — ${f.issue}\n      → ${f.suggestion}`);
      }
      return;
    }
    case 'critic': {
      if (!slug) throw new Error('Usage: critic <slug> [--force] [--apply] [--apply-plates]');
      const { runCritic } = await import('./lib/critic.mjs');
      await runCritic(loadVideo(slug), {
        force: flag('--force'),
        apply: flag('--apply'),
        applyPlates: flag('--apply-plates'),
      });
      return;
    }
    case 'suggest-plates': {
      if (!slug) throw new Error('Usage: suggest-plates <slug> [--apply]');
      const video = loadVideo(slug);
      const { suggestPlates, applyPlateSuggestions } = await import('./lib/suggestPlates.mjs');
      const { proposals, report } = suggestPlates(video);
      console.log(report);
      const out = join(video.out, 'plate-suggestions.md');
      writeFileSync(out, report);
      console.log(`✓ ${out}`);
      if (flag('--apply') && proposals.length) {
        const added = applyPlateSuggestions(video, proposals);
        console.log(`✓ applied plates: ${added.join(', ') || '(none new)'}`);
      }
      return;
    }
    case 'all': {
      preflight();
      const video = loadVideo(slug);
      const { recordLive } = await import('./lib/record.mjs');
      const { produce } = await import('./lib/produce.mjs');
      const { validate } = await import('./lib/validate.mjs');
      const loginRequired = Boolean(video.config?.record?.loginRequired);
      const headed = flag('--headed') || (loginRequired && !flag('--headless'));
      await recordLive(video, { headed, pace: opt('--pace') });
      await produce(video, { forcePlates: flag('--force') });
      if (existsSync(join(video.dir, 'narration.mjs'))) {
        const { audioMode } = await import('./lib/audio/elevenlabs.mjs');
        if (audioMode() === 'missing-key') {
          console.log('· narration.mjs present but ELEVENLABS_API_KEY is not set — delivered without audio. Add the key to kit/.env and run: node cli.mjs audio ' + slug);
        } else {
          await audioPass(video, { force: false });
        }
      }
      validate(video);
      if (flag('--critic')) {
        const { runCritic } = await import('./lib/critic.mjs');
        await runCritic(video, { force: flag('--force-critic') });
      }
      if (flag('--deliver')) {
        const { deliverPackage } = await import('./lib/deliver.mjs');
        deliverPackage(video);
      }
      return;
    }
    case 'manual': {
      const { buildManuals } = await import('./lib/manual.mjs');
      if (!buildManuals().length) console.log('· no video has a "manual" block in video.config.json');
      return;
    }
    case 'publish': {
      const { publishHelpCenter } = await import('./lib/publish.mjs');
      publishHelpCenter();
      return;
    }
    case 'snapshot': {
      if (!slug) throw new Error('Usage: snapshot <slug> [--label "…"]');
      const { snapshotVersion } = await import('./lib/versions.mjs');
      snapshotVersion(loadVideo(slug), {
        title: opt('--label') || opt('--title') || '',
        label: opt('--label') || '',
        trigger: 'cli',
        kind: 'release',
        note: 'cli',
      });
      return;
    }
    case 'studio': {
      const { startStudio } = await import('./lib/studio.mjs');
      // Flags may sit in `slug` when invoked as `studio --port 4747`
      const studioArgs = [slug, ...rest].filter(Boolean);
      const portFlag = studioArgs.indexOf('--port');
      const port = Number(portFlag >= 0 ? studioArgs[portFlag + 1] : 4747) || 4747;
      const openSlug = studioArgs.find((a, i) => !String(a).startsWith('-') && i !== portFlag + 1) || null;
      await startStudio({ port, openSlug });
      // keep process alive
      await new Promise(() => {});
      return;
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n/, ''));
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exitCode = 1;
});
