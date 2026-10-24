/**
 * Local agent runner for studio improve actions.
 * Supports Cursor CLI (`agent -p`) and Claude Code (`claude -p`).
 * `WALKTHROUGH_AGENT=cursor|claude` pins the runner; unset prefers a signed-in Cursor CLI,
 * then Claude Code when Cursor is missing or not authenticated.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createStream, ingestAgentEvent, streamLine, streamPayload, tail } from './agentStream.mjs';
import { formatStallNote, readStallReport } from './captureStall.mjs';
import { releaseLocksForPid } from './outputLock.mjs';
import { hasChildExited, killTree, terminate } from './processKill.mjs';
import { readOverlayReport } from './overlayRetry.mjs';
import { readSelectorReport, usesStallRepair } from './selectorRetry.mjs';
import { checkFlow, flowContractBlock, flowGateDecision, flowRepairLimit, flowRepairPrompt, formatIssue, recordingBaseline } from './flowCheck.mjs';
import { captureRepairDecision, captureRepairLimit } from './captureRepairLoop.mjs';
import { applyJobAnswer, parseJobQuestion } from '../studio/jobQuestion.js';
import { promptLanguageLine } from './languages.mjs';
import { captureProfile, describeCapture } from './capturePresets.mjs';
import { outputFrame } from './format.mjs';
import { resolvePurpose, storyBrief } from './narrative.mjs';
import { KIT, OUT_ROOT, SKILL, brandReadiness, listBrands, loadVideo, upsertDotEnv } from './project.mjs';
import { readBrowseMap, stopBrowseSession } from './browseSession.mjs';
import { briefDraftPrompt, normalizeBriefDraft, parseBriefDraft } from './briefDraft.mjs';
import { PLATE_TYPE_LIST, plateTypeGuide } from './plateTypes.mjs';
import { BEAT_GUIDE } from './journeyBeats.mjs';
import { COPY_STYLE_GUIDE } from './copyCase.mjs';
import { draftCraftGuide, enrichDraft } from './draftRhythm.mjs';
import { VOICE_CATALOG, enrichSound, soundGuide, toneBlock, toneProfile } from './soundCraft.mjs';
import { describeJob } from '../studio/progress.js';
import { DEFAULT_BRAND_AUDIO, harvestBrandFromUrls, slugifyBrand } from './discoverBrand.mjs';
import { agentModel, agentModels, listAgentModels, modelArgs, setAgentModel } from './agentModels.mjs';

const JOBS = new Map();

const AUTH_RE =
  /authentication required|please run ['`]?agent login|please run.?\/login|not logged in|unauthorized|invalid api key|cursor_api_key|anthropic_api_key/i;

function findAgentBin() {
  const which = spawnSync('which', ['agent'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  const home = process.env.HOME || '';
  for (const p of [
    join(home, '.local', 'bin', 'agent'),
    join(home, '.cursor', 'bin', 'agent'),
    '/usr/local/bin/agent',
  ]) {
    if (existsSync(p)) return p;
  }
  return null;
}

function findClaudeBin() {
  const which = spawnSync('which', ['claude'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  const home = process.env.HOME || '';
  for (const p of [join(home, '.local', 'bin', 'claude'), join(home, '.claude', 'local', 'claude'), '/usr/local/bin/claude']) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** `WALKTHROUGH_AGENT=cursor|claude` pins the runner; unset prefers a signed-in Cursor CLI. */
export function agentPreference() {
  const v = String(process.env.WALKTHROUGH_AGENT || '').trim().toLowerCase();
  return v === 'claude' || v === 'cursor' ? v : 'auto';
}

const RUNNERS = {
  cursor: (bin) => ({
    provider: 'cursor',
    label: 'Cursor agent',
    bin,
    args: (prompt, workspace, opts) => {
      const a = ['-p', prompt, '--trust', '--workspace', workspace, '--output-format', 'stream-json', '--stream-partial-output', ...modelArgs('cursor')];
      if (opts.force) a.push('--force');
      return a;
    },
  }),
  claude: (bin) => ({
    provider: 'claude',
    label: 'Claude Code',
    bin,
    args: (prompt, workspace, opts) => [
      ...modelArgs('claude'),
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--add-dir',
      workspace,
      '--permission-mode',
      opts.force ? 'bypassPermissions' : 'acceptEdits',
      '--allowedTools',
      'Read Edit Write Glob Grep Bash(node:*) Bash(ffprobe:*) Bash(curl:*) Bash(mkdir:*)',
    ],
  }),
};

function runnerReady(runner) {
  if (!runner?.available || !runner.bin) return false;
  if (runner.provider === 'cursor') return Boolean(runner.authenticated || process.env.CURSOR_API_KEY);
  return Boolean(runner.authenticated);
}

function pickProvider(status) {
  const pref = status.preference || agentPreference();
  const cursor = status.runners.cursor;
  const claude = status.runners.claude;
  if (pref === 'claude' && claude.available) return 'claude';
  if (pref === 'cursor' && cursor.available) return 'cursor';
  if (runnerReady(cursor)) return 'cursor';
  if (claude.available) return 'claude';
  if (cursor.available) return 'cursor';
  return null;
}

function pickRunner(status) {
  const provider = pickProvider(status);
  if (provider === 'claude') return RUNNERS.claude(status.runners.claude.bin);
  if (provider === 'cursor') return RUNNERS.cursor(status.runners.cursor.bin);
  return null;
}

function tooltipForStatus(status) {
  const lines = [];
  for (const key of ['cursor', 'claude']) {
    const r = status.runners[key];
    if (!r.available) {
      lines.push(`${r.label}: not installed`);
      continue;
    }
    const state = !r.authenticated ? 'needs sign-in' : r.soft ? 'signed in (unverified)' : `ready${r.via ? ` · ${r.via}` : ''}`;
    const active = status.provider === r.provider ? ' · active' : '';
    lines.push(`${r.label}: ${state}${active}`);
  }
  if (status.preference !== 'auto') lines.push(`Preference: ${status.preference} (kit/.env)`);
  return lines.join('\n');
}

function summarizeActive(status) {
  const active = status.active;
  if (!active?.available) {
    return {
      available: false,
      authenticated: false,
      soft: false,
      via: null,
      bin: null,
      message: 'No agent CLI found — install Cursor CLI (`agent`) or Claude Code (`claude`).',
    };
  }
  return {
    available: true,
    authenticated: Boolean(active.authenticated),
    soft: Boolean(active.soft),
    via: active.via,
    bin: active.bin,
    message: active.message,
  };
}

/** Persist runner choice to kit/.env and the live process. */
export function setAgentPreference(provider) {
  const v = String(provider || '').trim().toLowerCase();
  if (v !== 'cursor' && v !== 'claude') throw new Error('Agent preference must be "cursor" or "claude"');
  upsertDotEnv({ WALKTHROUGH_AGENT: v });
  return agentAuthStatus();
}

/** Persist a runner's model (and, with `use`, make that runner the active one). */
export function chooseAgentModel(provider, model, { use = false } = {}) {
  setAgentModel(provider, model);
  return use ? setAgentPreference(provider) : agentAuthStatus();
}

/** Models for one runner; the Cursor list comes from its own CLI. */
export function agentModelList(provider, { refresh = false } = {}) {
  const bin = provider === 'cursor' ? findAgentBin() : findClaudeBin();
  return listAgentModels(provider, { bin, refresh });
}

/** What the Studio API sends for a job: no process handle, stream flattened for the wire. */
export function jobView(job) {
  if (!job) return null;
  const { child, stream, _loggedEntry, ...rest } = job;
  return { ...rest, stream: streamPayload(stream) };
}

function workspaceRoot() {
  let dir = SKILL;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

function probeCursorAuth() {
  const bin = findAgentBin();
  const base = { provider: 'cursor', label: 'Cursor agent', bin };
  if (!bin) {
    return {
      ...base,
      available: false,
      authenticated: false,
      via: null,
      soft: false,
      message: 'Cursor CLI `agent` not found — install from cursor.com/docs/cli, then `agent login`.',
    };
  }
  if (process.env.CURSOR_API_KEY) {
    return {
      ...base,
      available: true,
      authenticated: true,
      via: 'CURSOR_API_KEY',
      soft: false,
      message: 'Authenticated via CURSOR_API_KEY',
    };
  }
  try {
    const r = spawnSync(bin, ['status', '--format', 'json'], {
      encoding: 'utf8',
      timeout: 8000,
      env: { ...process.env },
    });
    const raw = (r.stdout || '').trim();
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    const text = `${r.stdout || ''}\n${r.stderr || ''}`;
    if (parsed?.isAuthenticated || parsed?.status === 'authenticated') {
      return {
        ...base,
        available: true,
        authenticated: true,
        via: 'agent-login',
        message: parsed.message || 'Logged in via agent login',
        // status can report authenticated while print mode still rejects — Studio reclassifies on failure
        soft: /unable to fetch user details/i.test(parsed.message || text),
      };
    }
    if (AUTH_RE.test(text) || r.status !== 0) {
      return {
        ...base,
        available: true,
        authenticated: false,
        via: null,
        soft: false,
        message: 'Cursor CLI found but not authenticated — run `agent login` or set CURSOR_API_KEY in kit/.env',
      };
    }
  } catch (err) {
    return {
      ...base,
      available: true,
      authenticated: false,
      via: null,
      soft: false,
      message: `Could not check Cursor auth: ${err.message}`,
    };
  }
  return {
    ...base,
    available: true,
    authenticated: false,
    via: null,
    soft: false,
    message: 'Cursor CLI found — run `agent login` or set CURSOR_API_KEY before Improve jobs',
  };
}

/** Non-network Claude login hints: API key, credentials file, or macOS keychain item. */
function claudeLoginHint() {
  if (process.env.ANTHROPIC_API_KEY) return 'ANTHROPIC_API_KEY';
  const home = process.env.HOME || '';
  if (existsSync(join(home, '.claude', '.credentials.json'))) return 'claude-login';
  if (process.platform === 'darwin') {
    const r = spawnSync('security', ['find-generic-password', '-s', 'Claude Code-credentials'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    if (r.status === 0) return 'claude-login';
  }
  return null;
}

function probeClaudeAuth() {
  const bin = findClaudeBin();
  const base = { provider: 'claude', label: 'Claude Code', bin };
  if (!bin) {
    return {
      ...base,
      available: false,
      authenticated: false,
      via: null,
      soft: false,
      message: 'Claude Code `claude` not found — install from claude.ai/code, then run `claude` and /login.',
    };
  }
  const via = claudeLoginHint();
  if (via) {
    return {
      ...base,
      available: true,
      authenticated: true,
      via,
      soft: false,
      message: via === 'ANTHROPIC_API_KEY' ? 'Authenticated via ANTHROPIC_API_KEY' : 'Logged in via Claude Code',
    };
  }
  return {
    ...base,
    available: true,
    authenticated: false,
    via: null,
    soft: false,
    message: 'Claude Code found — run `claude` then /login, or set ANTHROPIC_API_KEY in kit/.env',
  };
}

/**
 * Probe Cursor CLI + Claude Code. Aggregate fields stay backward-compatible for the Studio badge;
 * `runners` / `active` / `provider` / `switchable` drive the header switch and tooltips.
 */
export function agentAuthStatus() {
  const runners = {
    cursor: probeCursorAuth(),
    claude: probeClaudeAuth(),
  };
  const preference = agentPreference();
  const draft = { preference, runners };
  const provider = pickProvider(draft);
  const active = provider ? runners[provider] : null;
  const status = {
    preference,
    provider,
    runners,
    active,
    switchable: runners.cursor.available && runners.claude.available,
    models: agentModels(),
    ready: Boolean(active && runnerReady(active) && !active.soft),
    tooltip: '',
    ...summarizeActive({ active, runners, preference, provider }),
  };
  status.tooltip = tooltipForStatus(status);
  return status;
}

export function buildPrompt(video, goal, extra = '', opts = {}) {
  const skillPath = SKILL;
  const config = join(video.dir, 'video.config.json');
  const narration = join(video.dir, 'narration.mjs');
  const flow = join(video.dir, 'flow.mjs');
  const critic = join(video.out, 'critic-report.md');
  const brand = join(video.brand.dir, 'brand.json');
  const brief = join(video.brand.dir, video.brand.motionBrief || 'motion-brief.md');
  const brandReport = join(video.brand.dir, 'discover-report.json');
  const brandLogo = join(video.brand.dir, video.brand.logo || 'logo.html');
  const flowAnalysis = join(video.dir, 'flow-analysis.md');
  const plateId = opts.plateId || null;

  const singlePlate = plateId
    ? `Focus ONLY on the plate id "${plateId}"${
        plateId === 'open'
          ? ' (video.config.json → open: eyebrow, title, sub).'
          : plateId === 'close'
            ? ' (video.config.json → close: title, steps, tagline).'
            : ` (video.config.json → interstitials[] entry with id "${plateId}": title, copy, items/stats/quotes/logos/steps as fits its type).`
      } Do not change other plates or narration unless the director note explicitly requires it.`
    : '';

  const browse = `node ${join(KIT, 'cli.mjs')} browse ${video.slug}`;
  const briefPath = join(video.dir, 'brief.json');
  const tone = videoTone(video);
  const sound = soundGuide(tone, { brand: video.brand, slug: video.slug });
  const journeyMd = join(video.dir, 'explore-journey.md');
  const guidedMd = join(video.dir, 'guided-tour.md');
  const guidedJson = join(video.dir, 'guided-tour.json');
  const guidedFlow = join(video.dir, 'guided-flow.mjs');
  const guidedShots = join(video.out, 'guide', 'shots');
  const timeline = join(video.out, 'timeline.json');
  const liveMeta = join(video.out, 'live-meta.json');
  const guided = existsSync(guidedJson);
  const guidedSource = `The reviewer SHOWED this tour in a real browser — that is the journey. Sources:
- ${guidedMd}: every step in order with wall-clock time, idle gaps, ◆ moments the reviewer marked (their chapter intent) and the screenshot after each step (in ${guidedShots}; open the ones you need to see what each screen looked like).
- ${guidedJson}: the same steps with full target descriptors (role, accessible name, label, placeholder, testid, id, css path, box and click point in CSS px at the recording viewport, the point as fractions of the box, region, dialog, duplicate count) — use these to write selectors.
- ${guidedFlow}: a mechanical replay of every step at steady pace. It runs, but it is not a script yet.`;
  const guidedCraft = `Turn the shown tour into the script — these decisions are yours:
- Keep the reviewer's journey, order and data values (what they typed, chose, dragged, filtered). Their marked moments are the chapter boundaries and titles unless a title is unclear; name unnamed moments from what the screen shows.
- Optimise the replay: drop detours, mis-clicks, abandoned attempts, back-and-forth and duplicate navigations, hovers and scrolls that reveal nothing, and anything after the story's payoff; merge repeated tries into one clean action. Never add screens the reviewer did not visit.
- Keep the interactions that are the demo (drags, typing, filters, view switches, reveals). Idle time is already gone; write holds at steady pace for the viewer, not the reviewer's timing.
- Start from the screen the reviewer started on: the first steps (even ones made before capture was ready) open what the rest acts on — a popover, panel or dialog seen in the first screenshot must be opened by the script.
- Harden every selector with the descriptors and ${flowAnalysis}: getByRole/getByLabel/getByTestId first, scoped to the region/dialog it sat in. When a locator can match more than one element, take the one the reviewer used with \`await ctx.near(locator, { x, y, step })\` (the captured point; it waits for a visible match and fails loudly) — never .first() on duplicates. The tour was shown at the recording viewport, so boxes, points and drag paths are 1:1 CSS px: on canvases, calendars and boards act at \`ctx.spot(box, capturedBox, rel)\` and keep drag deltas unscaled (multiply by its k).
- A target with no lasting handle (no testid, id, label or named role — tooltips, popovers, generated markup, a bare css path in the descriptor) is reached by its pixels, not by a prettier selector. ${guidedFlow} already passes \`fallback: { box, point }\` to ctx.near for those steps: copy that call across as generated. Never shorten, widen or re-guess a css path, and never drop the fallback, x/y or step name — that is what turns a drifted tooltip into a failed take.
- Every step the reviewer performed is required: call it directly — no isVisible() guards, no .catch(() => {}) around clicks, typing or drags, no "skip if missing" branches; a step that cannot run must fail the take so it is fixed, not quietly dropped. Guard only UI the reviewer never touched (cookie banners, tips) with isVisible().catch(() => false). Sign-in stays off camera — never type credentials in flow().
- Add say() captions on the moments that carry meaning, and chapter() at each beat.`;

  const goals = {
    explore: `You are the product scout for the walkthrough "${video.slug}". Explore the LIVE product yourself and decide what this video should show, in what order, and how to reach each moment. Nobody has pre-chosen screens for you: the brief below says who watches and what they must be able to do afterwards — that is your goal. Read ${briefPath} first.

Your browser (signed in when credentials exist; one session kept between commands):
  ${browse} look${opts.url ? ` --url ${opts.url}` : ''}                      read the current screen (the first call opens the browser at the start URL): numbered controls [ref] and where they sit, headings, open dialog, visible text, a screenshot path
  ${browse} click <ref> | hover <ref> | type <ref> "text" [--enter] | select <ref> "option" | drag <ref> <dx> <dy>
  ${browse} press Escape | scroll down | scroll up | back | goto </path or url>
  ${browse} note "what this screen offers the goal, and how strong it looks"
  ${browse} map                       every screen seen, how it was reached, what you tried, your notes
  ${browse} stop                      close the browser when you are done (always run it)
Every move prints the screen it lands on. Open the screenshot (Read the .jpg) whenever layout, data density or visual impact matters — labels alone do not tell you what looks impressive on camera. Icon-only controls are listed as "icon: <name>" or "unlabeled … at x,y"; use the screenshot to tell what they are.

How to explore — breadth first, led by the goal:
1. look at the start screen and list its primary destinations (main nav, sidebar, tabs, top-bar icons, view switches).
2. Level 1: visit EVERY primary destination once — click it, look, note in one line what it offers this audience and how strong it is on screen, then move on (nav or back). Do not go deep yet.
3. Level 2: choose the 2–4 destinations that best serve the goal and go one or two levels deeper — open a detail, a create/edit dialog (then Escape), filters, view switches, hovers on data, drags on timelines or canvases. You are hunting payoff moments: where the product visibly does what this viewer cares about.
4. Look for anything the reviewer named in the brief that you have not met yet (menus, settings, secondary tabs). If it truly is not in the product, say so in your report.
5. Stop when the goal is covered and the strongest moments are found, or after about 70 moves. Run map, then stop.
Safety: this is a real account. Never delete, sign out, pay, send invites or emails, or save a form that changes real data unless the brief's access notes say the data is a disposable demo. Opening a dialog and pressing Escape is fine. The tool refuses irreversible labels without --confirm; do not pass --confirm.
If the session reports sign-in was not completed, explore what is reachable and say exactly what credentials or access the reviewer must add.

Then decide and write — these decisions are yours:
A. ${briefPath} → story.mustShow: the journey, ordered for impact. Keep the reviewer's intent and every beat they asked for that exists (re-order or re-word it if that tells the story better); replace what does not exist with the closest real moment; add moments you found that serve the goal better. Every how-path is the route you actually walked, with the labels the tool showed you (for icon-only controls, name the icon's purpose and position, e.g. the Reports icon in the top bar).
${BEAT_GUIDE}
B. ${briefPath} — fill other story fields only where they are empty or vague and you saw real material: outcome, keyMessages (what the product demonstrably does), app.notes (demo data worth using, pop-ups to dismiss, slow screens, things to avoid). Never overwrite specific reviewer wording, mustSay, avoid, stats, quotes or credentials. Never invent facts you did not see.
C. ${journeyMd} — your scouting report: every destination with one line on what it offers and how strong it is, why this order, what you rejected and why, and per beat the exact walk (labels, where they sit, the payoff move, real data names to use).
Edit only ${briefPath} and ${journeyMd}. Do not edit flow.mjs, narration.mjs or video.config.json, and do not record or render — the planner writes the script from your journey next.`,
    narration: `Improve narration.mjs for "${video.slug}" so VO narrates why (not clicks), ≤28 words/line, leads the pointer, and matches chapter/caption titles. Read ${critic} if present. Edit only ${narration}. Follow ${skillPath}/authoring.md §Narration.`,
    plates: `Improve interstitial plates for "${video.slug}". Read ${config}, ${brief}, and ${critic} if present. Rewrite plate copy/structure in video.config.json (open, close.steps, interstitials[]). Do NOT edit kit/templates HTML directly — templates are filled from config. Keep ≤5 interstitials, real logos/assets only. Studio will rebuild plate HTML for live preview after you finish. Follow ${skillPath}/authoring.md plate table.
${COPY_STYLE_GUIDE}
Plate types you can swap to or add (type — when: shape):
${plateTypeGuide()}
${draftCraftGuide()}
${singlePlate}`,
    scene: `You are editing ONE scene (brand plate) in the walkthrough "${video.slug}". ${singlePlate}
Read ${config}, ${brief}, and ${critic} if present.

If the note is about logo size, position or visibility:
- open / Introduction: prefer open.style (\`--open-logo\`, \`--open-logo-top\`, \`--open-logo-width\`, \`--open-lift-scale\`, \`--open-lift-y\`); direction.motion openLogo* / openLift* still work as brand defaults
- close: close.style \`--close-logo\`, \`--close-logo-top\`, \`--close-logo-width\`, \`--close-lift-scale\`, \`--close-lift-y\`
- features / quote / statement: that interstitial's style \`--mark-logo\`, \`--mark-logo-size\`, \`--mark-logo-width\`, \`--mark-logo-x\`, \`--mark-logo-y\`
- orbit: style \`--orbit-logo\`, \`--orbit-logo-size\`, \`--orbit-center-scale\`

For copy changes on open/close/interstitials, edit ${config}. For energy-only notes, set motion.energy to calm|clear|punchy.
${COPY_STYLE_GUIDE}

Do NOT edit kit/templates HTML files — Studio fills templates from config + brand motion and rebuilds live HTML for preview.
Keep assets real; no invented quotes/logos.`,
    motion: `Tune the VIDEO-LOCAL brand direction for "${video.slug}". Never mutate the shared pack at ${brand}. Edit ${config} → direction:
- colors (only captured/brand-derived roles), logo (only a real captured lockup), camera, cursor, keys
- motion: energy calm|clear|punchy, enterMs, staggerMs, pushScale
- For open/Introduction logo layout: openLogoWidth (px), openLogoTop (%), openLiftScale, openLiftY (%)
- WebGL atmosphere behind every plate (brand colours drive it): atmosphere none|schedule|aurora|mesh|particles|grid|waves, atmosphereOpacity (0–1), atmosphereSpeed (0.3–2)
- Effects: titleReveal rise|cascade|wipe|focus|veil|ink|slit|iris|embers (ink, slit, iris and embers are WebGL masks), depth flat|soft|deep (3D card landing), sheen true|false (highlight sweep). Per-plate overrides go in interstitials[].motion with the same keys.
Read ${brief}. Do not invent logos. Studio rebuilds plate HTML for live preview after you finish.${
      plateId ? ` Director is currently reviewing plate "${plateId}" — keep motion coherent with that plate.` : ''
    }`,
    script: `Revise the SCRIPT of the walkthrough "${video.slug}" from the reviewer's notes below. The script is the story the viewer sees and hears, in order: open plate → chapters (flow.mjs chapter(title, body)) and steps (say(title, body)) with interstitial plates (video.config.json interstitials[], placed by "before": <chapter title>) → close plate. Spoken lines live in ${narration} (lines keyed by the exact chapter/say title, plates keyed by plate id, intro/outro).
Read ${skillPath}/authoring.md, ${config}, ${narration}, ${flow}, and ${brief}.
Rules: narration says why, not clicks; ≤28 words per line; on-screen titles ≤5 words, bodies ≤12 words; 4–7 chapters; keep narration keys and plate "before" values in sync with any renamed chapter/say titles. In flow.mjs change ONLY the string arguments of chapter()/say() and the order/presence of steps — keep selectors, waits and navigation working unless the note asks for a different journey. Plate copy goes in ${config}; never invent quotes, logos or stats.
${COPY_STYLE_GUIDE}`,
    voice: `Improve voice and spoken delivery for "${video.slug}" without changing the shared brand pack.
Read ${narration}, ${config}, ${brief}, and ${skillPath}/authoring.md.
Edit only:
- ${narration}: wording, per-line { text, speed } delivery, intro/outro and matching keys; ≤28 words per line.
- ${config} → audio.voice: video-local voiceId/name/direction/settings only when the director asks for voice character or delivery.
- ${config} → audio.music: video-local styles/negativeStyles/intro/bed/outro only when the director asks about the music.
- ${config} → audio.mix: video-local voice/music balance only when the director asks about loudness or mix.
- ${config} → tone: when the note changes the voice's personality, update tone.words/persona/do/avoid so captions and plates follow.
Do not change plates, flow selectors, captured brand assets, or shared ${brand}.
${sound}`,
    'branch-ideas': `Propose BRANCH ideas for the walkthrough "${video.slug}" — focused feature videos spun from this overview.
Read ${skillPath}/authoring.md, ${join(video.dir, 'brief.json')}, ${config}, ${flow}, ${narration}, and ${flowAnalysis} if present.
Write ONLY ${join(video.dir, 'branch-ideas.json')} as JSON with this shape:
{
  "generatedAt": "<ISO date>",
  "source": "${video.slug}",
  "ideas": [
    {
      "id": "kebab-id",
      "title": "Short feature title",
      "purpose": "feature",
      "angle": "One sentence: what this cut explores deeper",
      "outcome": "After watching, the viewer can…",
      "mustShow": ["3–5 beats: Title — why it matters · how: click “Label” in the <region> → <move>"],
      "keyMessages": ["1–3 messages"],
      "mustSay": [],
      "lengthSec": 90,
      "plates": ["features"]
    }
  ]
}
Rules: 5–8 ideas. Prefer real chapters / must-show beats / interstitial topics already in this project — not invented product areas. purpose is usually "feature" (sometimes "onboarding"). lengthSec is seconds, usually 60–180. plates from ${PLATE_TYPE_LIST}. Do not edit other files. Do not record or render.`,
    branch: `Rewrite the BRANCHED walkthrough "${video.slug}" into a focused feature video. It was copied from an overview — the brief at ${join(video.dir, 'brief.json')} names the angle under branch.angle / story.mustShow.
Read ${skillPath}/SKILL.md, ${skillPath}/authoring.md, ${join(video.dir, 'brief.json')}, ${config}, ${flow}, ${narration}, and ${flowAnalysis} if present.
Keep brand, record.startUrl, env "$VAR" refs, and working Playwright patterns from the copied ${flow}. Drop off-angle chapters. Rewrite:
1. ${config} — title, purpose feature, open/close, 1–3 interstitials for THIS feature (before: matching chapter titles).
2. ${flow} — a shorter journey (3–5 chapter/say beats) that only covers the branch mustShow list, in order: chapter titles are the beat titles (before " — "), and each beat's "how:" path is the click/move sequence to script. Reuse selectors from the copy and flow-analysis; mark guesses // TODO(verify selector).
3. ${narration} — intro/outro + keys matching the new chapter/say titles and plate ids; why-not-clicks, ≤28 words.
${COPY_STYLE_GUIDE}
Do not re-introduce the full overview. Do not record or render.`,
    draft: `Create the FIRST DRAFT of the walkthrough "${video.slug}" from the project brief at ${join(video.dir, 'brief.json')}. Read ${skillPath}/SKILL.md and ${skillPath}/authoring.md first, then the completed brand foundation: ${brand}, ${brief}, ${brandReport}, and ${brandLogo}.
If ${flowAnalysis} exists, read it before writing flow.mjs — it is the live product map (explored routes when present, DOM controls, form fields with validation + suggested fill values, and WebGL/canvas pointer recipes). Prefer its Playwright hints, fill recipes (unique emails per run, env refs for login, pattern-safe values) and canvas drag/wheel snippets over guesses. When the analysis includes Explored routes / Must-show coverage / Recrafted journey, treat that as authoritative: write chapters only for beats the crawl reached (or the recrafted list). Do not invent screens the map did not find — adapt the story to the product that exists. Fill fields with ctx.typeInto(locator, value) or ctx.fillField(patterns, value) — never getByPlaceholder→click→fill (placeholders often clear on focus and hang capture). Prefer name= selectors from the analysis. Fill every required field the analysis lists before clicking submit; never invent login secrets or place real orders. When it flags WebGL, set record.deviceScaleFactor: 1, use frame() not focus() on large canvases, and drive the model with page.mouse + actions.hide()/show() rather than getByRole on missing DOM children.
The brand discovery gate has completed. Treat its official lockup, palette, font, product promise and motion language as required inputs for the opening, interstitials, close and narration. Do not substitute generic colors, another product's visual language, an invented logo, or a homemade wordmark.
Write, in this order:
${guided ? `${guidedSource}\n${guidedCraft}\n` : ''}0. The journey. ${guided ? `From the shown tour: write ${briefPath} → story.mustShow as one beat per chapter you script, in that order (title, why it matters to this audience, how: the exact clicks the reviewer made, with real labels and data). The reviewer's mustShow lines are intent to honour where the tour covers them. ` : ''}If ${journeyMd} exists, the explore agent walked the live product and wrote ${briefPath} → story.mustShow from what it saw: treat that order, those titles and how-paths as authoritative, and read the report for the exact walk and real data names. Touch story.mustShow only when the script genuinely needs a beat merged or split. If there is no explore report, decide the journey yourself from ${flowAnalysis} and the app source, as a director would, and write it to story.mustShow (leave every other brief field untouched):
${BEAT_GUIDE}
1. ${config} — title, audience, open (eyebrow, 2-line title with one *accent*, sub), close (title, 3 steps), 2–4 interstitials[] (pick the type that carries the fact — ${PLATE_TYPE_LIST}; see authoring.md for each shape and the type guide below) placed with "before": <chapter title>, record.startUrl, env (credentials as "$ENV_VAR" references only — never literal secrets). Apply capture tips from the flow analysis (e.g. deviceScaleFactor: 1 for WebGL).
2. ${flow} — the live journey: 4–7 chapter() cards and say() captions that follow the "what to show" list from step 0 in order — chapter titles are the beat titles verbatim (the part before " — "), and each beat's how-path is the click/hover/type/drag sequence to script. Author every wait()/hold at steady pace — the video's direction.pace scales them, so never pad waits to slow the tour or trim them to speed it; wrap one routine stretch in pace('brisk') … pace() if it needs to move faster than the rest. Use robust Playwright selectors from the flow analysis (getByRole/getByLabel/getByText), preferring the hop/route that matches each chapter. For pointer-reactive canvases, use the analysis recipes (mouse drag/wheel on the canvas box). If the app source is in this workspace, read it to confirm labels and routes; otherwise mark guessed selectors with // TODO(verify selector) and keep each guessed step guarded (isVisible().catch(() => false))${guided ? ' — never steps the reviewer showed, which are required' : ''}. Never fill login email/password inside flow() — the kit signs in off camera (session + saved credentials) before the screencast starts; on-camera credential typing pollutes the take.
3. ${narration} — intro, outro, one line per chapter/say title and per plate id; why-not-clicks, ≤28 words, in the voice and tone below.
4. ${config} → tone, audio.voice and audio.music — the sound of THIS video, chosen to match the brand and the story:
   - tone: { "words": [3–4 adjectives], "persona": "who is speaking", "do": [...], "avoid": [...] } — the one voice the captions, plates and narration share.
   - audio.voice: { "name", "voiceId", "direction": "[short performance cue]", "settings": { stability, similarity_boost, style, use_speaker_boost, speed } } — a narrator from the catalog below whose character fits the tone and audience (keep the brand's own voice when the pack chose one).
   - audio.music: { "styles", "negativeStyles", "intro", "bed", "outro" } — a composed bed in the brand's spirit: genre, 2–3 instruments, pulse, mood, one "<n> BPM", "instrumental"; the bed never competes with the voice.
   Leave a field out and Studio fills it from the tone; never edit the shared ${brand}.
${sound}
Plate type guide (type — when: shape); vary the set, one proof plate at most per fact, never two of the same type back to back:
${plateTypeGuide()}
${draftCraftGuide()}
Build the script on the story spine below: every beat lands in the place it names, in order. Only use proof (stats, quotes, logos) that the brief provides. Keep the brief's tone and must-say/avoid lists.
${COPY_STYLE_GUIDE}
Do not record or render — the reviewer approves the script in Studio first.`,
    'guided-script': `The reviewer just showed a NEW tour of "${video.slug}" in a real browser. Rebuild the script around it, so the next bot recording follows their journey.
${guidedSource}
Also read ${skillPath}/authoring.md, ${briefPath}, ${config}, ${flow} (the current script — reuse its working selectors, waits and helpers where the tour visits the same screens) and ${narration}.
${guidedCraft}
Write:
1. ${flow} — the optimised journey as chapter()/say() beats with hardened selectors.
2. ${briefPath} → story.mustShow — one beat per chapter, in order:
${BEAT_GUIDE}
3. ${narration} — intro, outro and one line per chapter/say title (why, not clicks; ≤28 words), keys matching the new titles exactly; keep lines for plates.
4. ${config} — only what the new journey forces: interstitials[].before must name a chapter title that still exists (move or drop plates whose chapter is gone), and record.startUrl if the tour started elsewhere. Leave plate copy, brand and direction alone.
Do not record or render — Studio records with the bot next.`,
    'take-recraft': `The bot just recorded the tour for "${video.slug}". Recraft the scenario around what actually happened on camera — the take is final, so this is about words, not the journey.
Read ${timeline} (when every chapter/say landed and how long each beat ran), ${liveMeta}, ${narration}, ${flow}, ${briefPath}${guided ? `, and ${guidedMd} (the reviewer's original walk)` : ''}.
Decide and edit:
1. ${narration} — fit every chapter/say line to the time its beat is on screen in the take (about 2.6 spoken words per second, leave a breath before the next beat; never longer than the beat). Describe what the viewer actually sees in the take — the data, the result of each action — and why it matters. Keys stay exactly as they are.
2. ${briefPath} → story.mustShow — make each beat's how-path match the route the bot really took (labels, order, data), so the brief documents the recorded journey.
Edit only ${narration} and ${briefPath}. Never edit ${flow}, chapter/say titles or ${config}: that would invalidate the take.`,
    'own-take': `The reviewer recorded the tour of "${video.slug}" themselves and chose to keep THEIR recording as the take. It is final — this is about words and plates, not the journey.
Read ${timeline} (chapter marks: label is the chapter title, t when its card starts, dur how long the card shows; click/type marks show what happened when), ${liveMeta} (capture.cuts are paused stretches already cut out), ${guidedMd} (the reviewer's walk: every step, the screens and data they showed), ${narration}, ${briefPath} and ${config}.
Decide and edit:
1. ${narration} — intro, outro and one line per chapter, keyed EXACTLY by the chapter labels in ${timeline} (verbatim, same capitalisation). Fit each line to its beat: from that chapter's t to the next chapter's t (about 2.6 spoken words per second, leave a breath; never longer than the beat). Describe what the viewer sees — the data, the result of each action — and why it matters, never the clicks. Drop lines whose key is no longer a chapter or plate; keep plate lines.
2. ${briefPath} → story.mustShow — one beat per chapter, in order, with the how-path the reviewer actually took:
${BEAT_GUIDE}
3. ${config} — interstitials[].before must name a chapter label that exists in ${timeline}: move or drop plates whose chapter is gone. Leave plate copy, brand and direction alone unless a plate no longer fits the story.
Never edit ${flow}, ${timeline}, ${liveMeta} or any video file: the take is final.`,
    critic: `Read ${critic} (or run critic findings). Apply high-confidence narration and plate improvements to ${narration} and ${config} for "${video.slug}". Do not re-record. Follow the product-walkthrough-video skill hard rules.`,
    'critic-review': `You are the story critic for the walkthrough "${video.slug}". Watch what this video actually does and write an honest, specific review of how to make it land better. You REVIEW — you never edit the video's sources.

Read ${skillPath}/SKILL.md (the hard rules and the "Critic once" step) and ${skillPath}/authoring.md, then:
- ${briefPath} (audience, outcome, must-say, avoid) and ${config} (title, audience, purpose, open, interstitials, close, direction)
- ${narration} (every spoken line) and ${flow} (what the camera does, chapter()/say() beats, in order)
- ${timeline} and ${liveMeta} if present (when each beat lands and how long it holds; pace)
- ${join(video.out, 'qc-report.json')} if present (dead air, WPM, drift)
- ${join(video.out, 'critic-report.json')} — the automatic rule pass that just ran. Treat it as a seed: confirm, sharpen or drop its findings; do not just copy them.
- The frame stills under ${join(video.out, 'critic-frames')} and ${join(video.out, 'validate', 'contact-sheet.jpg')} if present: open them to see what is on screen when each line is spoken. You may sample more stills from ${join(video.out, 'live.mp4')} or ${join(video.out, `${video.slug}.mp4`)} with ffmpeg into ${join(video.out, 'critic-frames')}.

Review as four viewers: the skeptic (muted, first 20 s — is the pain and the payoff obvious?), the implementer (can I repeat the click path; does the voice lead the pointer?), the buyer (is there real proof before the close?), the onboarder (is there a map; is the pace calm?). Judge the story spine, the hook, narration vs what is on screen, pacing and dead air, plate choice and placement, the close and its one CTA.

Write two files and nothing else:
1. ${join(video.out, 'critic-agent.json')} — strict JSON:
{"summary": "2–4 sentences: what works, the biggest problem, the one change that matters most",
 "score": 0-100,
 "strengths": ["…"],
 "findings": [{"severity": "high"|"medium"|"low", "persona": "skeptic"|"implementer"|"buyer"|"onboarder", "target": "narration:<key>" | "<plateId>.<field>" | "flow:<chapter title>" | "pacing" | "story", "issue": "what is wrong, in the viewer's words", "suggestion": "the concrete fix — a rewritten line, a plate change, a cut", "evidence": "what you saw or heard: timestamp, frame, line", "at": <seconds or null>}]}
   5–12 findings, highest impact first. Every finding names a real target and a concrete fix. No generic advice.
2. ${join(video.out, 'critic-agent.md')} — the same review as a readable report for a human director.

Never edit ${config}, ${narration}, ${flow}, ${briefPath}, brand files or any media. Do not record, render or run kit steps.`,
    'capture-repair': `CAPTURE STALLED for "${video.slug}". The recorder aborted because the flow stopped making progress. Your job is a surgical fix so the next record can pass — then stop (Studio will re-record once).

Read first:
1. ${join(video.out, 'capture-stall.json')} — last step, action, URL, hints
2. ${join(video.out, 'error.png')} and ${join(video.out, 'error.txt')} if present
3. ${flow} (the file to edit), ${flowAnalysis} if present, ${skillPath}/authoring.md form-field rules

Hard rules:
- Edit ONLY ${flow} unless a say()/chapter() title must change (then sync that key in ${narration}).
- Prefer ctx.typeInto(locator, value) / ctx.fillField(patterns, value) and name=/id= selectors. Never getByPlaceholder→click→fill (placeholders often clear on focus and hang capture).
- Guard optional UI with isVisible().catch(() => false). Use noWaitAfter / waitUntil: 'domcontentloaded' for navigations that never reach load (recaptcha/analytics).
- Mark guessed selectors // TODO(verify selector). Do not invent credentials or submit real forms.
- Do NOT record, produce, or render. Do not broaden into a full script rewrite.

Apply the smallest change that unblocks the stuck step described in the stall report.`,
    full: `You are the senior director improving the complete walkthrough "${video.slug}" from one plain-language director note. Read ${skillPath}/SKILL.md, ${skillPath}/authoring.md, ${brief}, ${config}, ${narration}, ${flow}, and ${critic} if present.

FIRST infer the smallest sufficient scope from the note, then make a coherent change across only the domains it genuinely requires:
- Story/script: ${flow} chapter()/say() strings and order, synchronized with ${narration} keys.
- Narration/voice: ${narration} wording and per-line speed; ${config} → audio.voice/audio.mix for VIDEO-LOCAL voice character, speed or balance.
- Plates: ${config} open, close and interstitials copy/structure/placement.
- Brand direction: ${config} → direction colors/logo/camera/cursor/keys/motion. Use only captured lockups and brand-derived colors.
- Timing/pacing: narration line speed, chapter/step holds, plate motion timing, and transition duration in the appropriate VIDEO-LOCAL source.
- Journey/recording: ${flow} navigation/selectors only when the requested story changes what the viewer must see. When the journey changes, rewrite ${join(video.dir, 'brief.json')} → story.mustShow to match (beat shape: Title — why it matters · how: click “Label” in the <region> → <move>; strongest screen first).

Scope rules:
1. A broad note ("make it tighter", "improve the whole story", "warmer voice and calmer pacing") may coordinate several domains.
2. A note naming an exact plate, scene, narration key, timestamp or setting is surgical: change that target and only directly required synchronized references.
3. Do not broaden a surgical request for opportunistic cleanup.
4. Never mutate shared brand files (${brand}, ${brief}, ${brandLogo}); captured brand is source material, while per-video direction belongs in ${config}.
5. Plate HTML is generated from config + kit/templates — never edit raw templates.
6. Keep proof factual; never invent quotes, logos, stats, credentials or product claims.

If the note is about the logo on Introduction / Opening / open plate: edit ${config} → direction.motion openLogoWidth (smaller = smaller), openLogoTop (smaller % = higher), openLiftScale, openLiftY (more negative = rests higher).
${singlePlate}

Studio will inspect exactly which sources changed, present the relevant review surface, and wait for human approval before rendering.`,
  };

  const storyGoals = new Set(['explore', 'draft', 'branch', 'script', 'narration', 'plates', 'critic', 'critic-review', 'full', 'guided-script', 'take-recraft', 'own-take']);
  const spine = storyGoals.has(goal) ? storyBrief(resolvePurpose(video.config, readBrief(video))) : '';
  const device = DEVICE_GOALS.has(goal) ? deviceLine(video.config) : '';
  const contract = FLOW_CONTRACT_GOALS.has(goal) ? flowContractBlock({ kitDir: KIT, slug: video.slug }) : '';
  const voiceAndTone = TONE_GOALS.has(goal) || !goals[goal] ? toneBlock(tone) : '';
  return [promptLanguageLine(video.config?.language), goals[goal] || goals.full, contract, device, spine, voiceAndTone, extra].filter(Boolean).join('\n\n').trim();
}

/** Goals that write words the viewer reads or hears get the video's voice and tone. */
const TONE_GOALS = new Set(['draft', 'branch', 'script', 'narration', 'plates', 'scene', 'voice', 'critic', 'critic-review', 'full', 'guided-script', 'take-recraft', 'own-take']);

/** The video's tone profile (video tone → brief tone → brand tone → purpose). */
export function videoTone(video) {
  const brief = readBrief(video);
  return toneProfile({ config: video.config || {}, brief, brand: video.brand || {}, purpose: resolvePurpose(video.config, brief) });
}

/** Goals that write flow.mjs get the generated ctx contract; the gated ones are checked before done. */
const FLOW_CONTRACT_GOALS = new Set(['draft', 'branch', 'guided-script', 'capture-repair']);
const FLOW_GATE_GOALS = new Set(['draft', 'branch', 'guided-script', 'script']);

const DEVICE_GOALS = new Set(['explore', 'draft', 'branch', 'script', 'guided-script', 'take-recraft', 'own-take', 'capture-repair', 'full', 'plates', 'scene']);

/** What the take records, so flows, selectors and plate copy fit that layout and frame. */
export function deviceLine(config = {}) {
  const p = captureProfile(config);
  const out = outputFrame(config);
  const shape = out.format === 'portrait' ? `a vertical ${out.width}×${out.height} video` : `a ${out.width}×${out.height} video`;
  const lines = [`Recording device: ${describeCapture(p)}, delivered as ${shape}. Set in video.config.json → record.viewport / record.device and output.format — do not change the size, device or shape; the reviewer picks them in Studio (a density tip from the flow analysis may still set record.deviceScaleFactor).`];
  if (p.mobile || p.touch) {
    lines.push(
      'This is the MOBILE layout: navigation often sits behind a menu button, tables become cards, hover does not exist. Explore and write the flow for what this layout shows — open menus explicitly, prefer taps (click) over hovers, keep scrolls short, and never assume a desktop sidebar.',
    );
  }
  if (out.format === 'portrait') {
    lines.push('Plates and captions render in a tall frame: keep plate titles short (≤5 words per line), lists to ≤4 items, and captions to one short line.');
  }
  return lines.join('\n');
}

function readBrief(video) {
  const file = join(video.dir, 'brief.json');
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  } catch {
    return null;
  }
}

function newJob(partial) {
  const id = `job-${Date.now().toString(36)}`;
  const job = {
    id,
    status: 'queued',
    createdAt: new Date().toISOString(),
    log: [],
    stream: createStream(),
    ...partial,
  };
  JOBS.set(id, job);
  return job;
}

/**
 * Record one output line: always in the raw log, and in the shared stream unless `kind` is false.
 * `activity` is the one-line headline; the stream keeps the whole text.
 */
function append(job, line, { activity, kind } = {}) {
  const text = String(line).replace(/\s+$/, '');
  if (!text) return;
  job.log.push({ t: Date.now(), line: text.slice(0, 4000) });
  if (job.log.length > 500) job.log.shift();
  if (job.stream && kind !== false) streamLine(job.stream, text, kind || 'line');
  if (activity) {
    job.activity = tail(activity);
    job.activityAt = new Date().toISOString();
  } else {
    const clean = text.replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (clean && clean.length < 400) {
      job.activity = tail(clean);
      job.activityAt = new Date().toISOString();
    }
  }
}

function jobLogText(job) {
  return (job.log || []).map((l) => l.line).join('\n');
}

/** Parse one stdout line from Cursor CLI or Claude Code (stream-json) into the shared stream. */
function ingestStreamLine(job, line) {
  const raw = line.trim();
  if (!raw) return;
  let o = null;
  if (raw.startsWith('{')) {
    try {
      o = JSON.parse(raw);
    } catch {
      o = null;
    }
  }
  if (!o) {
    append(job, raw);
    return;
  }
  const hint = ingestAgentEvent(job.stream, o);
  if (!hint) return;
  if (hint.model) job.model = hint.model;
  if (hint.phase) job.phase = hint.phase;
  if (hint.result) job.result = hint.result;
  if (hint.activity) {
    job.activity = tail(hint.activity);
    job.activityAt = new Date().toISOString();
  }
  const entry = job.stream.entries.at(-1);
  if (entry && entry.done && entry.id !== job._loggedEntry) {
    job._loggedEntry = entry.id;
    const mark = { think: '💭', say: '✦', tool: '⚙', error: '✗', system: '·' }[entry.kind] || '·';
    append(job, `${mark} ${entry.title ? `${entry.title} · ` : ''}${entry.text}`, { kind: false, activity: job.activity });
  }
}

function attachLineParser(job, stream, { jsonl = false } = {}) {
  let buf = '';
  let chain = Promise.resolve();
  const take = async (line) => {
    if (jsonl) ingestStreamLine(job, line);
    else append(job, line);
    if (job.question || job.status === 'waiting') return;
    const asked = parseJobQuestion(job.log.at(-1)?.line || line);
    if (!asked) return;
    const pending = raiseJobQuestion(job, asked);
    if (process.stdin.isTTY && !process.env.WALKTHROUGH_STUDIO) {
      const value = await readCliAnswer(asked);
      answerJob(job.id, { value, cancel: value == null || value === '' });
    }
    await pending;
  };
  stream.on('data', (chunk) => {
    buf += chunk.toString();
    const parts = buf.split(/\r?\n/);
    buf = parts.pop() || '';
    if (!parts.length) return;
    stream.pause();
    chain = chain
      .then(async () => {
        for (const line of parts) await take(line);
      })
      .finally(() => stream.resume());
  });
  stream.on('end', () => {
    if (!buf.trim()) return;
    const rest = buf;
    buf = '';
    stream.pause();
    chain = chain
      .then(() => take(rest))
      .finally(() => stream.resume());
  });
}

/** CLI answer. A password is not echoed and is never printed. */
function readCliAnswer({ prompt, secret }) {
  return new Promise((resolve) => {
    if (secret) {
      process.stdout.write(`${prompt}\n> `);
      let buf = '';
      const onData = (chunk) => {
        const s = chunk.toString();
        if (s === '\u0003') {
          cleanup();
          resolve(null);
          return;
        }
        if (s.includes('\r') || s.includes('\n')) {
          cleanup();
          process.stdout.write('\n');
          resolve(buf);
          return;
        }
        if (s === '\u007f' || s === '\b') {
          buf = buf.slice(0, -1);
          return;
        }
        buf += s;
      };
      const cleanup = () => {
        process.stdin.off('data', onData);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
      };
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', onData);
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${prompt}\n> `, (value) => {
      rl.close();
      resolve(value);
    });
  });
}

function writePromptArtifacts(job, outDir, workspace) {
  const promptFile = join(outDir, `${job.id}.prompt.md`);
  const runSh = join(outDir, `${job.id}.run.sh`);
  writeFileSync(
    promptFile,
    `# Studio improve — ${job.goal} — ${job.slug}\n\n${job.prompt}\n\n---\n## Auth\n\nIf you see "Authentication required":\n\n\`\`\`bash\nagent login\n# or: export CURSOR_API_KEY=…  (also ok in kit/.env)\n\`\`\`\n\nThen re-run:\n\n\`\`\`bash\nbash ${runSh}\n\`\`\`\n\nOr paste this prompt into a Cursor Agent chat in the repo workspace.\n`
  );
  writeFileSync(
    runSh,
    `#!/usr/bin/env bash\nset -euo pipefail\ncd ${JSON.stringify(workspace)}\nexec agent -p --trust --workspace ${JSON.stringify(workspace)}${agentModel('cursor') ? ` --model ${JSON.stringify(agentModel('cursor'))}` : ''} --output-format text "$(cat ${JSON.stringify(promptFile)})"\n`
  );
  try {
    chmodSync(runSh, 0o755);
  } catch {
    /* ignore */
  }
  job.promptFile = promptFile;
  job.runScript = runSh;
  return { promptFile, runSh };
}

function markNeedsAgent(job, outDir, message) {
  job.status = 'needs-agent';
  job.message = message;
  job.finishedAt = new Date().toISOString();
  append(job, message, { kind: 'error' });
  writeFileSync(join(outDir, `${job.id}.json`), JSON.stringify(jobView({ ...job, log: job.log.slice(-80) }), null, 2));
}

export function getJob(id) {
  return JOBS.get(id) || null;
}

const jobAnswers = new Map();

/** Pause a job until Studio submits or cancels the question. */
export function raiseJobQuestion(job, { field = 'email', prompt } = {}) {
  job.question = { id: `${job.id}:${field}`, field, prompt: prompt || 'What email should this video use?' };
  job.status = 'waiting';
  job.phase = 'waiting';
  append(job, `? ${job.question.prompt}`, { activity: job.question.prompt, kind: 'system' });
  return new Promise((resolve) => {
    jobAnswers.set(job.id, { resolve, field });
  });
}

export function answerJob(id, { value, cancel } = {}) {
  const job = getJob(id);
  const waiter = jobAnswers.get(id);
  if (!job || !waiter) return null;
  jobAnswers.delete(id);
  const result = applyJobAnswer({
    field: waiter.field,
    value: cancel ? null : value,
    store: (pairs) => upsertDotEnv(pairs),
  });
  job.question = null;
  if (!result.continue) {
    job.status = 'cancelled';
    job.phase = 'cancelled';
    append(job, result.log, { activity: 'Stopped', kind: 'system' });
  } else {
    job.status = 'running';
    job.phase = 'running';
    append(job, result.log, { activity: result.log, kind: 'system' });
  }
  waiter.resolve(result);
  return { continue: result.continue };
}

export function listJobs() {
  return [...JOBS.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 30);
}

/**
 * Start an improve job. Returns immediately with job id.
 * @param {object} video
 * @param {'narration'|'plates'|'motion'|'critic'|'full'} goal
 * @param {{ note?: string, force?: boolean }} [opts]
 */
export function startImprove(video, goal, opts = {}) {
  const resolvedGoal = opts.plateId && (goal === 'full' || goal === 'plates') ? 'scene' : goal;
  const prompt = buildPrompt(video, resolvedGoal, opts.note || '', { plateId: opts.plateId });
  const job = newJob({
    kind: 'improve',
    goal: resolvedGoal,
    plateId: opts.plateId || null,
    slug: video.slug,
    prompt,
  });
  const outDir = join(video.out, 'studio-jobs');
  const verify = FLOW_GATE_GOALS.has(resolvedGoal) && opts.verify !== false ? flowGate(video, job) : null;
  const onDone = resolvedGoal === 'draft' ? (j) => enrichAfterDraft(video, j) : null;
  return launchAgent(job, { prompt, outDir, force: opts.force, retryLabel: 'Improve', verify, onDone });
}

/**
 * After a first draft: fill the layout / look / join choices the agent left open with this video's
 * deterministic variety pick and write draft-rhythm.md. Never fails the job.
 */
export function enrichAfterDraft(video, job) {
  try {
    const cfgPath = join(video.dir, 'video.config.json');
    if (!existsSync(cfgPath)) return '';
    const flowPath = join(video.dir, 'flow.mjs');
    const r = enrichDraft(JSON.parse(readFileSync(cfgPath, 'utf8')), {
      slug: video.slug,
      brand: video.brand || {},
      flowSource: existsSync(flowPath) ? readFileSync(flowPath, 'utf8') : '',
    });
    if (r.applied.length) writeFileSync(cfgPath, JSON.stringify(r.config, null, 2) + '\n');
    mkdirSync(video.out, { recursive: true });
    writeFileSync(join(video.out, 'draft-rhythm.md'), r.report);
    const warns = r.rhythm.findings.filter((f) => f.severity === 'warn').length;
    append(job, `✓ variety · ${r.applied.length ? `${r.applied.length} open choice(s) filled` : 'nothing left open'}${warns ? ` · ${warns} rhythm note(s) in draft-rhythm.md` : ''}`, { kind: 'system' });
    enrichSoundAfterDraft(video, job, { config: r.config, energy: r.pick?.mood });
  } catch (err) {
    append(job, `⚠ variety · skipped: ${err.message || err}`, { kind: 'system' });
  }
  return '';
}

/** After a first draft: tone, narrator and music bed for this video, plus draft-sound.md. Never fails the job. */
export function enrichSoundAfterDraft(video, job, { config = null, energy = null } = {}) {
  try {
    const cfgPath = join(video.dir, 'video.config.json');
    const current = config || JSON.parse(readFileSync(cfgPath, 'utf8'));
    const brief = readBrief(video);
    const narrationPath = join(video.dir, 'narration.mjs');
    const s = enrichSound(current, {
      slug: video.slug,
      brand: video.brand || {},
      brief,
      purpose: resolvePurpose(current, brief),
      energy,
      narrationSource: existsSync(narrationPath) ? readFileSync(narrationPath, 'utf8') : '',
    });
    if (s.applied.length) writeFileSync(cfgPath, JSON.stringify(s.config, null, 2) + '\n');
    mkdirSync(video.out, { recursive: true });
    writeFileSync(join(video.out, 'draft-sound.md'), s.report);
    const voice = s.voice?.name || VOICE_CATALOG.find((v) => v.voiceId === s.voice?.voiceId)?.name || video.brand?.audio?.voice?.name || 'brand voice';
    const tempo = (s.music?.styles || []).find((x) => /bpm/i.test(x));
    const notes = s.audit.findings.filter((f) => f.severity === 'warn').length;
    append(
      job,
      `✓ sound · ${s.profile.words.join(', ')} · narrator ${voice} · ${s.music?.styles?.[0] || 'brand bed'}${tempo ? ` at ${tempo}` : ''}${notes ? ` · ${notes} tone note(s) in draft-sound.md` : ''}`,
      { kind: 'system' },
    );
    return s;
  } catch (err) {
    append(job, `⚠ sound · skipped: ${err.message || err}`, { kind: 'system' });
    return null;
  }
}

/**
 * Post-agent gate for goals that write the script: check flow/narration/config, and on errors
 * send the agent back with them (bounded by WALKTHROUGH_DRAFT_REPAIRS, default 2).
 */
function flowGate(video, job) {
  const baseline = recordingBaseline(video.config);
  const max = flowRepairLimit();
  let round = 0;
  return async () => {
    const result = await checkFlow(video, { baseline });
    job.flowCheck = { ok: result.ok, errors: result.errors.length, warnings: result.warnings.length, round };
    for (const issue of [...result.errors, ...result.warnings.slice(0, 6)]) {
      append(job, `${issue.level === 'error' ? '✗' : '⚠'} check · ${formatIssue(issue).slice(2)}`, { kind: issue.level === 'error' ? 'error' : 'system' });
    }
    const decision = flowGateDecision({ ok: result.ok, round, max });
    if (decision.action === 'done') {
      append(job, `✓ check · flow.mjs, narration.mjs and video.config.json pass${result.warnings.length ? ` (${result.warnings.length} warning(s))` : ''}`, { kind: 'system' });
      return null;
    }
    if (decision.action === 'fail') {
      return { failure: `The draft still fails the record check after ${max} repair(s): ${result.errors[0].message.split('\n')[0]}` };
    }
    round = decision.round;
    job.activity = `Repairing the draft ${round}/${max}: ${result.errors.length} problem(s)`;
    append(job, `» repair ${round}/${max} · ${result.errors.length} problem(s) would break the first take — asking the agent to fix them`, { activity: job.activity, kind: 'system' });
    return { prompt: flowRepairPrompt({ video, result, round, max, skillPath: SKILL, kitDir: KIT }) };
  };
}

const CRITIC_REVIEW_TIMEOUT_MS = Number(process.env.WALKTHROUGH_CRITIC_TIMEOUT_MS) || 10 * 60 * 1000;

/**
 * The critic agent watches the cut (sources, timeline, frame stills, the rule pass) and writes
 * critic-agent.json/.md. `onReport(review)` merges it into critic-report.json on a clean exit.
 */
export function startCriticReview(video, { note = '', onReport = null } = {}) {
  const prompt = buildPrompt(video, 'critic-review', note);
  const job = newJob({ kind: 'improve', goal: 'critic-review', slug: video.slug, prompt });
  const outDir = join(video.out, 'studio-jobs');
  const reportPath = join(video.out, 'critic-agent.json');
  const startedAt = Date.now();
  return launchAgent(job, {
    prompt,
    outDir,
    // Shell lets the critic sample extra frames with ffmpeg; the prompt forbids source edits.
    force: true,
    retryLabel: 'Run critic',
    timeoutMs: CRITIC_REVIEW_TIMEOUT_MS,
    onDone: () => {
      if (!existsSync(reportPath) || statSync(reportPath).mtimeMs < startedAt - 1000) {
        return 'The critic finished without writing critic-agent.json.';
      }
      let review;
      try {
        review = JSON.parse(readFileSync(reportPath, 'utf8'));
      } catch (err) {
        return `critic-agent.json is not valid JSON: ${err.message}`;
      }
      if (!Array.isArray(review?.findings)) return 'critic-agent.json has no findings list.';
      onReport?.(review);
      job.critic = { findings: review.findings.length, score: review.score ?? null };
      return '';
    },
  });
}

/** Exploring is interactive (many look → decide → move rounds), so it gets a long leash. */
const EXPLORE_TIMEOUT_MS = Number(process.env.WALKTHROUGH_EXPLORE_TIMEOUT_MS) || 20 * 60 * 1000;

/**
 * The explore agent walks the live product through the browse session and writes the journey
 * (brief.json → story.mustShow) plus explore-journey.md. Shell access is required (force).
 */
export function startExplore(video, { note = '', url = null } = {}) {
  const prompt = buildPrompt(video, 'explore', note, { url });
  const job = newJob({ kind: 'improve', goal: 'explore', slug: video.slug, prompt });
  const outDir = join(video.out, 'studio-jobs');
  const before = readBrief(video)?.story?.mustShow || [];
  const startedAt = Date.now();
  stopBrowseSession(video);
  return launchAgent(job, {
    prompt,
    outDir,
    force: true,
    retryLabel: 'Explore',
    timeoutMs: EXPLORE_TIMEOUT_MS,
    onClose: () => stopBrowseSession(video),
    onDone: () => {
      const map = readBrowseMap(video);
      if (!map?.screens?.length || Date.parse(map.startedAt) < startedAt - 1000) {
        return 'The agent finished without exploring the product (no browse session was used).';
      }
      const after = readBrief(video)?.story?.mustShow || [];
      if (!after.length) return 'The agent explored but left “What to show, in order” empty.';
      job.explored = { screens: map.screens.length, moves: map.moves.length, changed: JSON.stringify(after) !== JSON.stringify(before) };
      return '';
    },
  });
}

/**
 * Spawn the preferred agent CLI on `prompt`, stream its output into `job`, and settle the job on
 * exit. `onDone(job, { code })` runs after a clean exit and may flip the job to failed by
 * returning a message. Shared by improve/draft jobs and the brief draft.
 */
function launchAgent(job, { prompt, outDir, force = false, retryLabel = 'the job', timeoutMs = 0, onDone = null, onClose = null, verify = null } = {}) {
  mkdirSync(outDir, { recursive: true });
  const workspace = workspaceRoot();
  writePromptArtifacts(job, outDir, workspace);

  const auth = agentAuthStatus();
  job.agentStatus = auth;
  const runner = pickRunner(auth);

  if (!runner?.bin) {
    markNeedsAgent(
      job,
      outDir,
      'No agent CLI found. Install Cursor CLI (https://cursor.com/docs/cli/overview) or Claude Code (https://claude.ai/code), sign in, then retry. Prompt saved — paste into a chat or run the .run.sh after install.'
    );
    return job;
  }

  const selected = auth.runners[runner.provider];
  if (!runnerReady(selected)) {
    markNeedsAgent(
      job,
      outDir,
      runner.provider === 'claude'
        ? `Claude Code is not signed in. Run \`claude\` then /login (or set ANTHROPIC_API_KEY in kit/.env), then retry — or paste ${job.promptFile} into a chat.`
        : `Authentication required. Run \`agent login\` in a terminal (or set CURSOR_API_KEY in kit/.env), then retry ${retryLabel} — or open ${job.promptFile} in Cursor chat / run ${job.runScript}.`
    );
    return job;
  }

  job.status = 'running';
  job.startedAt = new Date().toISOString();
  job.agent = runner.bin;
  job.provider = runner.provider;
  job.requestedModel = agentModel(runner.provider);
  job.phase = 'starting';
  const launching = `Launching ${runner.label}${job.requestedModel ? ` · ${job.requestedModel}` : ''}…`;
  append(job, launching, { activity: launching, kind: 'system' });

  const args = runner.args(prompt, workspace, { force });
  const child = spawn(runner.bin, args, {
    cwd: workspace,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // See runCliStep: group-leader so a cancel reaches everything this agent spawns too.
    detached: true,
  });
  job.child = child;
  job.pid = child.pid;
  attachLineParser(job, child.stdout, { jsonl: true });
  attachLineParser(job, child.stderr, { jsonl: false });
  let timer = null;
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      if (job.status !== 'running') return;
      job.timedOut = true;
      append(job, `Taking too long — stopping after ${Math.round(timeoutMs / 1000)} s`, { kind: 'error' });
      cancelJob(job.id);
    }, timeoutMs);
  }
  child.on('close', (code, signal) => {
    if (timer) clearTimeout(timer);
    try {
      onClose?.(job);
    } catch {
      /* cleanup must not mask the job result */
    }
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    if (job.cancelRequested || signal === 'SIGTERM' || signal === 'SIGKILL') {
      if (job.timedOut) {
        job.status = 'failed';
        job.phase = 'failed';
        job.activity = `The agent took longer than ${Math.round(timeoutMs / 1000)} s`;
        job.message = job.activity;
        append(job, `✗ ${job.activity}`, { activity: job.activity, kind: 'error' });
      } else finalizeCancelled(job, outDir);
      return;
    }
    const text = jobLogText(job);
    if (code !== 0 && AUTH_RE.test(text)) {
      markNeedsAgent(
        job,
        outDir,
        runner.provider === 'claude'
          ? `Claude Code is not signed in. Run \`claude\` then /login (or set ANTHROPIC_API_KEY in kit/.env), then retry — or paste ${job.promptFile} into a chat.`
          : `Authentication required. Run \`agent login\` (or set CURSOR_API_KEY in kit/.env), then: bash ${job.runScript} — or paste ${job.promptFile} into Cursor Agent chat.`
      );
      return;
    }
    let ok = code === 0 && job.result?.ok !== false;
    let failure = '';
    if (ok && onDone) {
      try {
        failure = onDone(job, { code }) || '';
      } catch (err) {
        failure = err.message || String(err);
      }
      if (failure) ok = false;
    }
    const settle = (ok, failure) => {
      job.status = ok ? 'done' : 'failed';
      job.phase = ok ? 'done' : 'failed';
      job.finishedAt = new Date().toISOString();
      job.activity = ok ? 'Finished' : failure || (job.result?.text ? tail(job.result.text) : `Failed (exit ${code})`);
      if (!ok) job.message = job.activity;
      append(job, ok ? '✓ agent finished' : `✗ ${failure || `agent exit ${code}`}`, { activity: job.activity, kind: ok ? 'system' : 'error' });
      writeFileSync(join(outDir, `${job.id}.json`), JSON.stringify(jobView({ ...job, log: job.log.slice(-80) }), null, 2));
    };
    if (!ok || !verify) return settle(ok, failure);
    // Stays 'running' while the gate checks the files, so pollers and waitForJob keep waiting.
    job.phase = 'verifying';
    job.activity = 'Checking the draft will record…';
    append(job, `» check · ${job.activity}`, { activity: job.activity, kind: 'system' });
    Promise.resolve()
      .then(() => verify(job))
      .then(
        (next) => {
          if (job.cancelRequested) return finalizeCancelled(job, outDir);
          if (next?.prompt) {
            job.result = null;
            job.finishedAt = null;
            return launchAgent(job, { prompt: next.prompt, outDir, force, retryLabel, timeoutMs, onDone, onClose, verify });
          }
          settle(!next?.failure, next?.failure || '');
        },
        (err) => settle(false, `Draft check crashed: ${err.message || err}`)
      );
  });
  return job;
}

/** How long the one-description brief may take before Studio gives up and falls back. */
const BRIEF_DRAFT_TIMEOUT_MS = Number(process.env.WALKTHROUGH_BRIEF_TIMEOUT_MS) || 4 * 60 * 1000;
/** Brand authorship after harvest — enough time to read candidates and write the pack. */
const DISCOVER_BRAND_TIMEOUT_MS = Number(process.env.WALKTHROUGH_DISCOVER_TIMEOUT_MS) || 6 * 60 * 1000;

/**
 * Prompt for the agent that authors a brand pack from a harvest report + candidate files.
 * Code only collected evidence; the agent chooses the official lockup, palette, and type.
 */
export function discoverBrandPrompt({ brandDir, name, audience = '', reportPath, workspace }) {
  const rel = (p) => p.replace(workspace + '/', '').replace(workspace, '.');
  const brandJson = join(brandDir, 'brand.json');
  const logoHtml = join(brandDir, 'logo.html');
  const logoSource = join(brandDir, 'logo-source.svg');
  const motionBrief = join(brandDir, 'motion-brief.md');
  const candidates = join(brandDir, 'candidates');
  const exampleAudio = JSON.stringify(DEFAULT_BRAND_AUDIO, null, 2);
  return `You are authoring the official brand pack for "${name}" in Walkthrough Studio.

A headless harvest already ran. It did NOT choose the logo or palette — that is your job.

Read first:
1. ${rel(reportPath)} — pages (title, h1, sub), color samples, font hints, and every media candidate
2. Files under ${rel(candidates)}/ — downloaded SVGs/PNGs/ICOs (and inline SVGs) from the live site/app

Write ONLY into ${rel(brandDir)}/:
1. ${rel(logoSource)} — the official lockup bytes (prefer SVG). Copy from the best candidate file, or curl the official URL from the report if a better mark is linked but was not saved.
2. ${rel(logoHtml)} — plate-ready markup:
   - Prefer inline SVG with class="logo-svg" role="img" (add the class on the root <svg>) when the lockup is vector
   - Or <img class="logo-img" alt="${name}" src="data:…;base64,…"> for raster
   - First line comment: <!-- Sourced: <url or candidate path> -->
   - NEVER invent a homemade wordmark when a real mark exists in candidates/ or on the site
   - NEVER use partner/integration logos (Slack, Zapier, Podio, Sage, client walls, etc.) as the brand lockup
   - Prefer header/nav lockups and brand-named SVGs over favicons / apple-touch icons
   - For dark plates, a white/light lockup is ideal when the brand ships one
3. ${rel(brandJson)} — complete pack. Required shape:
{
  "name": "${name}",
  "platform": "<short product promise from h1 or site>",
  "font": { "family": "<primary UI/marketing face>", "css": "<google/bunny fonts URL or data:text/css,>" },
  "colors": {
    "ink": "#………", "surface": "#………", "gold": "#………", "amber": "#………", "teal": "#………",
    "text": "#f8fafc", "muted": "#………", "onAccent": "#………"
  },
  "logo": "logo.html",
  "motionBrief": "motion-brief.md",
  "placeholder": false,
  "discovery": {
    "status": "ready",
    "harvestedAt": "<from report>",
    "logoSource": "<https URL or candidates/… path you used>",
    "paletteSource": "<marketing URL>",
    "fontSource": "<css URL or note>"
  },
  "sources": { "marketing": "<url>", "app": "<url or null>", "logoSvg": "logo-source.svg", "logoNote": "<one line>" },
  "tone": { "words": ["<3–4 adjectives read from how the site writes: e.g. confident, warm, plain-spoken>"], "persona": "<who speaks for this brand, one line>", "avoid": ["<words or habits the brand never uses>"] },
  "audio": <the audio object below, with voice and music chosen for THIS brand's tone>,
  "motion": { "energy": "clear", "atmosphere": "<none|schedule|aurora|mesh|particles|grid|waves matching the product>" }
}
Audio template — keep its shape and the mix, but choose the sound:
${exampleAudio}
- voice: pick the narrator whose character matches tone.words (set name + voiceId; direction is a short bracketed cue like "[confident, calm product narration]"; add pronunciations for the brand and product names). Catalog (eleven_v4, every language):
${VOICE_CATALOG.map((v) => `  ${v.name} ${v.voiceId} — ${v.gender}, ${v.accent}, ${v.note}`).join('\n')}
- music: write the brand's sonic signature — genre, 2–3 instruments, pulse, mood, one "<n> BPM", "instrumental", room for the voice; negativeStyles keep vocals and lyrics out. A calm, premium brand wants space and felt piano; a bold, energetic one a brighter pulse.

Rules for colors: plates are dark. Pick ink/surface as dark neutrals tinted by the brand; gold = primary accent from CTAs/brand samples (not washed-out grey); amber = a related gradient end; teal may stay a cool support if the brand has no better third. onAccent = readable text on gold.
4. ${rel(motionBrief)} — living motion brief: audience${audience ? ` (hint: ${audience})` : ''}, product promise from the harvest, voice/tone (the same words as brand.json → tone, with two example lines in that voice), visual system table with the tokens you chose, plate palette guidance, motion language, audio bed, sources. Facts only — never invent metrics or client logos.

When you are done, brandReadiness must pass: placeholder false, logo.html present, all of ink/surface/gold/amber/teal as #RRGGBB, font.family + font.css set, discovery.status "ready", and motion-brief.md must exist.

Do not edit videos/, kit/templates, or other brand packs. Do not record or render.`;
}

/**
 * Harvest the live site/app, then run the agent to author the brand pack.
 * Returns a Studio job (kind discover-brand). Used by Studio draft-project and the CLI.
 */
export function startDiscoverBrand(video, opts = {}) {
  const name = String(opts.name || video?.config?.brand || '').trim();
  const url = String(opts.url || '').trim();
  const appUrl = opts.appUrl ? String(opts.appUrl).trim() : '';
  const audience = opts.audience ? String(opts.audience).trim() : '';
  const force = Boolean(opts.force);
  if (!name || !url) throw new Error('discover-brand requires name and url');

  const slug = video?.slug || slugifyBrand(name);
  const job = newJob({
    kind: 'discover-brand',
    goal: 'discover-brand',
    step: 'discover-brand',
    slug,
    brandSlug: slugifyBrand(name),
  });
  const outDir = video?.out ? join(video.out, 'studio-jobs') : join(OUT_ROOT, 'discover-brand', job.id);
  mkdirSync(outDir, { recursive: true });

  job.status = 'running';
  job.startedAt = new Date().toISOString();
  job.phase = 'harvest';
  job.activity = 'Harvesting brand signals from the live site…';
  append(job, job.activity, { activity: job.activity, kind: 'system' });

  void (async () => {
    try {
      const harvest = await harvestBrandFromUrls({
        name,
        url,
        appUrl: appUrl || undefined,
        audience,
        force,
        onProgress: (msg) => {
          if (job.cancelRequested) return;
          append(job, `› ${msg}`, { activity: msg, kind: 'line' });
        },
      });
      if (job.cancelRequested) {
        finalizeCancelled(job, outDir);
        return;
      }

      const workspace = workspaceRoot();
      const prompt = discoverBrandPrompt({
        brandDir: harvest.dir,
        name,
        audience,
        reportPath: join(harvest.dir, 'discover-report.json'),
        workspace,
      });
      job.prompt = prompt;
      job.phase = 'author';
      append(job, 'Handing off to agent to author the brand pack…', {
        activity: 'Agent authoring logo, palette and motion brief…',
        kind: 'system',
      });

      launchAgent(job, {
        prompt,
        outDir,
        force: true,
        retryLabel: 'Discover brand',
        timeoutMs: DISCOVER_BRAND_TIMEOUT_MS,
        onDone: () => {
          const ready = brandReadiness(harvest.slug);
          if (!ready.ready) {
            return `Brand pack incomplete: ${ready.issues.join('; ')}. Fix logo.html / brand.json / motion-brief.md in ${harvest.dir}`;
          }
          if (!existsSync(join(harvest.dir, 'motion-brief.md'))) {
            return `motion-brief.md is missing in ${harvest.dir}`;
          }
          append(job, `✓ brand pack ready · ${ready.name}`, { activity: `Brand pack ready · ${ready.name}`, kind: 'system' });
          return '';
        },
      });
    } catch (err) {
      job.status = 'failed';
      job.phase = 'failed';
      job.finishedAt = new Date().toISOString();
      job.activity = err.message || String(err);
      job.message = job.activity;
      append(job, `✗ ${job.activity}`, { activity: job.activity, kind: 'error' });
      try {
        writeFileSync(join(outDir, `${job.id}.json`), JSON.stringify(jobView({ ...job, log: job.log.slice(-80) }), null, 2));
      } catch {
        /* ignore */
      }
    }
  })();

  return job;
}

/**
 * Deconstruct one free-form description into a complete wizard brief. The agent may read the
 * workspace and fetch the start URL; it writes one JSON file and nothing else. Resolves on the
 * job with `job.brief` (normalized payload) when done.
 */
export function startBriefDraft({ description, startUrl, language = 'en' } = {}) {
  const text = String(description || '').trim();
  if (!text) throw new Error('Describe what to show, for whom, and about how long');
  let url;
  try {
    url = new URL(String(startUrl || '').trim());
  } catch {
    url = null;
  }
  if (!url || !/^https?:$/.test(url.protocol)) throw new Error('Start URL must be a full http(s) URL.');

  const brands = listBrands();
  const outDir = join(OUT_ROOT, 'brief-drafts');
  const job = newJob({ kind: 'brief', goal: 'brief', slug: '', brief: null });
  const outFile = join(outDir, `${job.id}.brief.json`);
  const prompt = briefDraftPrompt({
    description: text,
    startUrl: url.href,
    language,
    brands,
    workspace: workspaceRoot(),
    outFile,
  });
  job.prompt = prompt;
  const lang = String(language || 'en');

  return launchAgent(job, {
    prompt,
    outDir,
    force: true,
    retryLabel: 'Draft the video',
    timeoutMs: BRIEF_DRAFT_TIMEOUT_MS,
    onDone: (j) => {
      let raw = null;
      if (existsSync(outFile)) {
        try {
          raw = JSON.parse(readFileSync(outFile, 'utf8'));
        } catch {
          raw = null;
        }
      }
      if (!raw) raw = parseBriefDraft(j.result?.text || '');
      if (!raw) {
        const said = (j.stream?.entries || []).filter((e) => e.kind === 'say').map((e) => e.text).join('\n');
        raw = parseBriefDraft(said);
      }
      if (!raw) return 'The agent finished without returning a brief. Fill the fields by hand or try again.';
      j.brief = normalizeBriefDraft(raw, { brands, startUrl: url.href, language: lang });
      if (!j.brief.title) return 'The agent returned a brief without a title. Try a fuller description.';
      if (!j.brief.story.mustShow.length) return 'The agent could not find anything to show. Name the screens or steps to record.';
      return '';
    },
  });
}

/** First line the Studio shows, before the step has printed anything of its own. */
const STEP_OPENING = {
  plates: 'Checking which plates need a fresh render',
  record: 'Opening the app and starting the screen recording',
  guide: 'Opening a browser and the Recorder window — nothing is filmed until you press Start recording',
  produce: 'Planning the cut, then writing the master video',
  audio: 'Fitting the voice, then the music, then the mix',
  music: 'Composing a music bed to the length of this cut',
  mix: 'Duck the bed under the narration and mux onto the master',
  validate: 'Checking the delivered frames for flashes and joins',
  critic: 'Reading the cut the way a first-time viewer would',
  smoke: 'Checking capture timing against the overlays',
  analyze: 'Mapping controls and probing WebGL/canvas interactions',
  captions: 'Writing SRT, WebVTT and a plain transcript',
  qc: 'Checking pacing, dead air and long stretches',
  deliver: 'Building the handoff: captions, poster, chapters and the folder',
  export: 'Cutting the social, light and GIF versions from the master',
};

function agentIsReady() {
  const auth = agentAuthStatus();
  const claudeReady = Boolean(findClaudeBin()) && agentPreference() !== 'cursor';
  return Boolean((auth.bin && (auth.authenticated || process.env.CURSOR_API_KEY)) || claudeReady);
}

/** Wait until an improve/kit job leaves running/queued (or was never started). */
export function waitForJob(job) {
  if (!job || (job.status !== 'running' && job.status !== 'queued')) return Promise.resolve(job);
  return new Promise((resolve) => {
    const busy = () => job.status === 'running' || job.status === 'queued';
    const poll = () => {
      const t = setInterval(() => {
        if (!busy()) {
          clearInterval(t);
          resolve(job);
        }
      }, 200);
    };
    const child = job.child;
    if (!child) return poll();
    // A gated job stays running after the agent exits (check, then maybe a repair round).
    child.once('close', () => setImmediate(() => (busy() ? poll() : resolve(job))));
  });
}

/** Spawn one CLI step, piping into an existing job’s log. Resolves with exit code. */
function runCliStep(job, step, slug, extraArgs = []) {
  return new Promise((resolve) => {
    if (job.cancelRequested) {
      resolve({ code: null, signal: 'SIGTERM' });
      return;
    }
    const cli = join(SKILL, 'kit', 'cli.mjs');
    const args = [cli, step, slug, ...extraArgs];
    const child = spawn(process.execPath, args, {
      cwd: join(SKILL, 'kit'),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own process-group leader, so cancelJob's killTree(-pid) reaches this
      // process *and* anything it spawns (Playwright's Chromium, ffmpeg), not just
      // this one node process.
      detached: true,
    });
    job.child = child;
    job.pid = child.pid;
    attachLineParser(job, child.stdout, { jsonl: false });
    attachLineParser(job, child.stderr, { jsonl: false });
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
}

/** Record with a fresh bounded capture → repair loop for every recording job. */
function startRecordWithRepair(video, extraArgs = []) {
  const maxRepairs = captureRepairLimit();
  const job = newJob({
    kind: 'kit',
    step: 'record',
    slug: video.slug,
    repair: { attempts: 0, max: maxRepairs, stalled: false, history: [] },
  });
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  job.phase = 'recording';
  job.activity = STEP_OPENING.record;
  append(job, job.activity, { activity: job.activity, kind: 'system' });

  void (async () => {
    const finish = (ok, activity) => {
      if (job.cancelRequested) {
        finalizeCancelled(job);
        return;
      }
      job.status = ok ? 'done' : 'failed';
      job.phase = ok ? 'done' : 'failed';
      job.finishedAt = new Date().toISOString();
      job.activity = activity;
      job.message = activity;
      append(job, ok ? '✓ record done' : `✗ ${activity}`, { activity, kind: ok ? 'system' : 'error' });
    };

    let captureAttempt = 1;
    while (true) {
      job.phase = captureAttempt === 1 ? 'recording' : 're-recording';
      // Marks when *this* attempt's browser starts — the UI blurs the stale
      // on-disk preview frame from a prior attempt/take until a frame lands after it.
      job.captureStartedAt = new Date().toISOString();
      job.activity =
        captureAttempt === 1
          ? STEP_OPENING.record
          : `Capturing again after repair ${captureAttempt - 1}/${maxRepairs}…`;
      if (captureAttempt > 1) {
        append(job, `» record · ${job.activity}`, { activity: job.activity, kind: 'system' });
      }

      const result = await runCliStep(job, 'record', video.slug, extraArgs);
      if (job.cancelRequested || result.signal === 'SIGTERM' || result.signal === 'SIGKILL') {
        finalizeCancelled(job);
        return;
      }
      job.exitCode = result.code;
      if (result.code === 0) {
        finish(
          true,
          captureAttempt === 1
            ? 'Recording captured'
            : `Recording captured after ${captureAttempt - 1} repair${captureAttempt === 2 ? '' : 's'}`
        );
        return;
      }

      const stall = readStallReport(video);
      const overlay = readOverlayReport(video);
      const selector = readSelectorReport(video);
      if (overlay) {
        append(job, `» revalidate · ${overlay.summary}`, { activity: overlay.summary, kind: 'system' });
      }
      if (selector) {
        append(job, `» revalidate · ${selector.summary} Screenshot: error.png`, {
          activity: selector.summary,
          kind: 'system',
        });
      }
      if (stall) {
        append(job, `✗ stall · ${stall.summary}`, { activity: stall.summary, kind: 'error' });
      }

      const repairable = usesStallRepair({
        stall,
        overlay: Boolean(overlay),
        selector,
        selectorRetry: false,
      });
      const decision = captureRepairDecision({ captureAttempt, maxRepairs, repairable });
      if (decision.action === 'fail') {
        finish(
          false,
          decision.reason === 'exhausted'
            ? `Recording failed after ${maxRepairs} repair attempts. ${stall?.summary || selector?.summary || overlay?.summary || `Exit ${result.code}`}`
            : `record failed (exit ${result.code})`
        );
        return;
      }

      job.repair.stalled ||= Boolean(stall);
      job.stall = stall;
      if (!agentIsReady()) {
        finish(false, 'Capture needs repair, but the agent is not signed in. Sign in, then record again.');
        return;
      }

      job.repair.attempts = decision.repairAttempt;
      job.phase = 'repairing';
      job.activity = `Repairing capture ${decision.repairAttempt}/${maxRepairs}…`;
      append(job, `» repair ${decision.repairAttempt}/${maxRepairs} · Asking the agent to fix flow.mjs`, {
        activity: job.activity,
        kind: 'system',
      });

      const note = stall
        ? formatStallNote(stall)
        : selector?.detail || overlay?.detail || overlay?.summary || 'A dialog covered the click target.';
      const improve = startImprove(video, 'capture-repair', { note, force: true });
      job.repairJobId = improve.id;
      const mirror = setInterval(() => {
        if (improve.activity && improve.activity !== job.activity) {
          job.activity = `Repair ${decision.repairAttempt}/${maxRepairs}: ${improve.activity}`;
        }
      }, 400);
      await waitForJob(improve);
      clearInterval(mirror);

      if (job.cancelRequested) {
        cancelJob(improve.id);
        finalizeCancelled(job);
        return;
      }
      if (improve.status !== 'done') {
        finish(false, improve.activity || `Capture repair ${decision.repairAttempt}/${maxRepairs} failed`);
        return;
      }
      job.repair.history.push({ attempt: decision.repairAttempt, jobId: improve.id, status: improve.status });
      captureAttempt = decision.nextCaptureAttempt;
    }
  })().catch((err) => {
    job.status = 'failed';
    job.phase = 'failed';
    job.finishedAt = new Date().toISOString();
    job.activity = err.message || 'Record repair pipeline failed';
    append(job, `✗ ${job.activity}`, { kind: 'error' });
  });

  return job;
}

/** The in-flight job for this video+step, if one is still running. */
export function runningKitJob(slug, step) {
  for (const job of JOBS.values()) {
    if (job.kind === 'kit' && job.slug === slug && job.step === step && job.status === 'running') return job;
  }
  return null;
}

/**
 * Run a kit CLI step as a background job (plates, produce, audio, validate, critic, …).
 * `record` auto-repairs once on capture stall when an agent is available.
 */
export function startKitJob(video, step, extraArgs = []) {
  if (step === 'record') return startRecordWithRepair(video, extraArgs);

  // Two runs of one step write the same files. Hand back the live job instead of
  // racing it; the client watches it and sees the same result.
  const running = runningKitJob(video.slug, step);
  if (running) return running;

  const job = newJob({ kind: 'kit', step, slug: video.slug });
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  job.phase = 'running';
  job.activity = STEP_OPENING[step] || 'Starting…';
  append(job, job.activity, { activity: job.activity, kind: 'system' });
  const cli = join(SKILL, 'kit', 'cli.mjs');
  const args = [cli, step, video.slug, ...extraArgs];
  const child = spawn(process.execPath, args, {
    cwd: join(SKILL, 'kit'),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // See runCliStep: group-leader so a cancel reaches everything this spawns too.
    detached: true,
  });
  job.child = child;
  job.pid = child.pid;
  attachLineParser(job, child.stdout, { jsonl: false });
  attachLineParser(job, child.stderr, { jsonl: false });
  child.on('close', (code, signal) => {
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    if (job.cancelRequested || signal === 'SIGTERM' || signal === 'SIGKILL') {
      finalizeCancelled(job);
      return;
    }
    job.status = code === 0 ? 'done' : 'failed';
    job.phase = code === 0 ? 'done' : 'failed';
    append(job, code === 0 ? `✓ ${step} done` : `✗ ${step} exit ${code}`, { kind: code === 0 ? 'system' : 'error' });
    const view = describeJob(job);
    job.activity = view.now || (code === 0 ? `${step} done` : `${step} failed`);
    job.message = job.activity;
  });
  return job;
}

function finalizeCancelled(job, outDir = null) {
  job.status = 'cancelled';
  job.phase = 'cancelled';
  job.activity = 'Stopped';
  job.finishedAt = job.finishedAt || new Date().toISOString();
  append(job, '■ stopped by user', { activity: 'Stopped', kind: 'system' });
  // Drop this job's output locks now that it's actually settled into "cancelled" — a
  // killed process never runs the `finally { lock.release() }` cli.mjs normally relies
  // on, so without this a lock can outlive the process it was guarding. By the time a
  // job reaches here every caller has either confirmed the child closed or never
  // spawned one, so the pid really is done with these files.
  if (job.slug) {
    try {
      releaseLocksForPid(loadVideo(job.slug), job.pid || 0);
    } catch {
      /* video may be gone, or this job kind never took output locks */
    }
  }
  if (outDir) {
    try {
      writeFileSync(join(outDir, `${job.id}.json`), JSON.stringify(jobView({ ...job, log: job.log.slice(-80) }), null, 2));
    } catch {
      /* ignore */
    }
  }
}

/** Kill a running job's child process and mark it cancelled. */
export function cancelJob(id) {
  const job = JOBS.get(id);
  if (!job) return null;
  if (job.status !== 'running' && job.status !== 'queued') return job;
  job.cancelRequested = true;
  job.activity = 'Stopping…';
  job.phase = 'cancelling';
  append(job, 'Stopping…', { activity: 'Stopping…', kind: 'system' });
  const child = job.child;
  const pid = child?.pid || job.pid;
  if (pid) {
    // Spawn sites run `detached: true`, so `pid` is also the process-group id — one
    // signal reaches the wrapper CLI process *and* whatever it spawned (Playwright's
    // Chromium, ffmpeg), not just the direct child.
    //
    // `hasExited` checks real process state, not `child.killed` (which only reports
    // that a signal was *sent*, not that anything actually died — see processKill.mjs).
    const hasExited = child ? () => hasChildExited(child) : () => !isPidAlive(pid);
    terminate({
      hasExited,
      kill: (signal) => killTree(pid, signal),
    });
  } else {
    finalizeCancelled(job);
  }
  return job;
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Stop every running/queued job (agent + kit). */
export function cancelAllJobs() {
  const out = [];
  for (const job of JOBS.values()) {
    if (job.status === 'running' || job.status === 'queued') {
      out.push(cancelJob(job.id));
    }
  }
  return out.filter(Boolean);
}

/** @deprecated prefer agentAuthStatus() */
export function agentAvailable() {
  return Boolean(findAgentBin() || findClaudeBin());
}
