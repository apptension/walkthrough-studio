/**
 * Local agent runner for studio improve actions.
 * Supports Cursor CLI (`agent -p`) and Claude Code (`claude -p`).
 * `WALKTHROUGH_AGENT=cursor|claude` pins the runner; unset prefers a signed-in Cursor CLI,
 * then Claude Code when Cursor is missing or not authenticated.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createStream, ingestAgentEvent, streamLine, streamPayload, tail } from './agentStream.mjs';
import { formatStallNote, readStallReport } from './captureStall.mjs';
import { readOverlayReport } from './overlayRetry.mjs';
import { readSelectorReport, usesStallRepair } from './selectorRetry.mjs';
import { captureRepairDecision, captureRepairLimit } from './captureRepairLoop.mjs';
import { applyJobAnswer, parseJobQuestion } from '../studio/jobQuestion.js';
import { resolvePurpose, storyBrief } from './narrative.mjs';
import { SKILL, upsertDotEnv } from './project.mjs';
import { PLATE_TYPE_LIST, plateTypeGuide } from './plateTypes.mjs';
import { describeJob } from '../studio/progress.js';

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
      const a = ['-p', prompt, '--trust', '--workspace', workspace, '--output-format', 'stream-json', '--stream-partial-output'];
      if (opts.force) a.push('--force');
      return a;
    },
  }),
  claude: (bin) => ({
    provider: 'claude',
    label: 'Claude Code',
    bin,
    args: (prompt, workspace, opts) => [
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
      'Read Edit Write Glob Grep Bash(node:*) Bash(ffprobe:*)',
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
    ready: Boolean(active && runnerReady(active) && !active.soft),
    tooltip: '',
    ...summarizeActive({ active, runners, preference, provider }),
  };
  status.tooltip = tooltipForStatus(status);
  return status;
}

function buildPrompt(video, goal, extra = '', opts = {}) {
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

  const goals = {
    narration: `Improve narration.mjs for "${video.slug}" so VO narrates why (not clicks), ≤28 words/line, leads the pointer, and matches chapter/caption titles. Read ${critic} if present. Edit only ${narration}. Follow ${skillPath}/authoring.md §Narration.`,
    plates: `Improve interstitial plates for "${video.slug}". Read ${config}, ${brief}, and ${critic} if present. Rewrite plate copy/structure in video.config.json (open, close.steps, interstitials[]). Do NOT edit kit/templates HTML directly — templates are filled from config. Keep ≤5 interstitials, real logos/assets only. Studio will rebuild plate HTML for live preview after you finish. Follow ${skillPath}/authoring.md plate table. Plate types you can swap to or add (type — when: shape):
${plateTypeGuide()}
${singlePlate}`,
    scene: `You are editing ONE scene (brand plate) in the walkthrough "${video.slug}". ${singlePlate}
Read ${config}, ${brief}, and ${critic} if present.

If the plate is "open" / Introduction / Opening and the note is about logo size or position, edit ${config} → direction.motion:
- openLogoWidth (px, default 820) — smaller number = smaller logo
- openLogoTop (percent, default 52) — smaller number = higher on the plate
- openLiftScale (default ~0.58) — settled size after the lift animation
- openLiftY (percent, default -210) — more negative = rests higher after lift

For copy changes on open/close/interstitials, edit ${config}. For energy-only notes, set motion.energy to calm|clear|punchy.

Do NOT edit kit/templates HTML files — Studio fills templates from config + brand motion and rebuilds live HTML for preview.
Keep assets real; no invented quotes/logos.`,
    motion: `Tune the VIDEO-LOCAL brand direction for "${video.slug}". Never mutate the shared pack at ${brand}. Edit ${config} → direction:
- colors (only captured/brand-derived roles), logo (only a real captured lockup), camera, cursor, keys
- motion: energy calm|clear|punchy, enterMs, staggerMs, pushScale
- For open/Introduction logo layout: openLogoWidth (px), openLogoTop (%), openLiftScale, openLiftY (%)
- WebGL atmosphere behind every plate (brand colours drive it): atmosphere none|schedule|aurora|mesh|particles|grid|waves, atmosphereOpacity (0–1), atmosphereSpeed (0.3–2)
- Effects: titleReveal rise|cascade|wipe, depth flat|soft|deep (3D card landing), sheen true|false (highlight sweep). Per-plate overrides go in interstitials[].motion with the same keys.
Read ${brief}. Do not invent logos. Studio rebuilds plate HTML for live preview after you finish.${
      plateId ? ` Director is currently reviewing plate "${plateId}" — keep motion coherent with that plate.` : ''
    }`,
    script: `Revise the SCRIPT of the walkthrough "${video.slug}" from the reviewer's notes below. The script is the story the viewer sees and hears, in order: open plate → chapters (flow.mjs chapter(title, body)) and steps (say(title, body)) with interstitial plates (video.config.json interstitials[], placed by "before": <chapter title>) → close plate. Spoken lines live in ${narration} (lines keyed by the exact chapter/say title, plates keyed by plate id, intro/outro).
Read ${skillPath}/authoring.md, ${config}, ${narration}, ${flow}, and ${brief}.
Rules: narration says why, not clicks; ≤28 words per line; on-screen titles ≤5 words, bodies ≤12 words; 4–7 chapters; keep narration keys and plate "before" values in sync with any renamed chapter/say titles. In flow.mjs change ONLY the string arguments of chapter()/say() and the order/presence of steps — keep selectors, waits and navigation working unless the note asks for a different journey. Plate copy goes in ${config}; never invent quotes, logos or stats.`,
    voice: `Improve voice and spoken delivery for "${video.slug}" without changing the shared brand pack.
Read ${narration}, ${config}, ${brief}, and ${skillPath}/authoring.md.
Edit only:
- ${narration}: wording, per-line { text, speed } delivery, intro/outro and matching keys; ≤28 words per line.
- ${config} → audio.voice: video-local voiceId/model/settings/speed only when the director asks for voice character or delivery.
- ${config} → audio.mix: video-local voice/music balance only when the director asks about loudness or mix.
Do not change plates, flow selectors, captured brand assets, or shared ${brand}.`,
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
      "mustShow": ["3–5 concrete UI beats from the live product"],
      "keyMessages": ["1–3 messages"],
      "mustSay": [],
      "lengthSec": 90,
      "plates": ["features"]
    }
  ]
}
Rules: 5–8 ideas. Prefer real chapters / must-show beats / interstitial topics already in this project — not invented product areas. purpose is usually "feature" (sometimes "onboarding"). lengthSec 60|90|120. plates from ${PLATE_TYPE_LIST}. Do not edit other files. Do not record or render.`,
    branch: `Rewrite the BRANCHED walkthrough "${video.slug}" into a focused feature video. It was copied from an overview — the brief at ${join(video.dir, 'brief.json')} names the angle under branch.angle / story.mustShow.
Read ${skillPath}/SKILL.md, ${skillPath}/authoring.md, ${join(video.dir, 'brief.json')}, ${config}, ${flow}, ${narration}, and ${flowAnalysis} if present.
Keep brand, record.startUrl, env "$VAR" refs, and working Playwright patterns from the copied ${flow}. Drop off-angle chapters. Rewrite:
1. ${config} — title, purpose feature, open/close, 1–3 interstitials for THIS feature (before: matching chapter titles).
2. ${flow} — a shorter journey (3–5 chapter/say beats) that only covers the branch mustShow list. Reuse selectors from the copy and flow-analysis; mark guesses // TODO(verify selector).
3. ${narration} — intro/outro + keys matching the new chapter/say titles and plate ids; why-not-clicks, ≤28 words.
Do not re-introduce the full overview. Do not record or render.`,
    draft: `Create the FIRST DRAFT of the walkthrough "${video.slug}" from the project brief at ${join(video.dir, 'brief.json')}. Read ${skillPath}/SKILL.md and ${skillPath}/authoring.md first, then the completed brand foundation: ${brand}, ${brief}, ${brandReport}, and ${brandLogo}.
If ${flowAnalysis} exists, read it before writing flow.mjs — it is the live product map (DOM controls, form fields with validation + suggested fill values, and WebGL/canvas pointer recipes). Prefer its Playwright hints, fill recipes (unique emails per run, env refs for login, pattern-safe values) and canvas drag/wheel snippets over guesses. Fill fields with ctx.typeInto(locator, value) or ctx.fillField(patterns, value) — never getByPlaceholder→click→fill (placeholders often clear on focus and hang capture). Prefer name= selectors from the analysis. Fill every required field the analysis lists before clicking submit; never invent login secrets or place real orders. When it flags WebGL, set record.deviceScaleFactor: 1, use frame() not focus() on large canvases, and drive the model with page.mouse + actions.hide()/show() rather than getByRole on missing DOM children.
The brand discovery gate has completed. Treat its official lockup, palette, font, product promise and motion language as required inputs for the opening, interstitials, close and narration. Do not substitute generic colors, another product's visual language, an invented logo, or a homemade wordmark.
Write, in this order:
1. ${config} — title, audience, open (eyebrow, 2-line title with one *accent*, sub), close (title, 3 steps), 2–4 interstitials[] (pick the type that carries the fact — ${PLATE_TYPE_LIST}; see authoring.md for each shape and the type guide below) placed with "before": <chapter title>, record.startUrl, env (credentials as "$ENV_VAR" references only — never literal secrets). Apply capture tips from the flow analysis (e.g. deviceScaleFactor: 1 for WebGL).
2. ${flow} — the live journey: 4–7 chapter() cards and say() captions that follow the brief's "what to show" list. Author every wait()/hold at steady pace — the video's direction.pace scales them, so never pad waits to slow the tour or trim them to speed it; wrap one routine stretch in pace('brisk') … pace() if it needs to move faster than the rest. Use robust Playwright selectors from the flow analysis (getByRole/getByLabel/getByText). For pointer-reactive canvases, use the analysis recipes (mouse drag/wheel on the canvas box). If the app source is in this workspace, read it to confirm labels and routes; otherwise mark guessed selectors with // TODO(verify selector) and keep each step guarded (isVisible().catch(() => false)).
3. ${narration} — intro, outro, one line per chapter/say title and per plate id; why-not-clicks, ≤28 words.
Plate type guide (type — when: shape); vary the set, one proof plate at most per fact, never two of the same type back to back:
${plateTypeGuide()}
Build the script on the story spine below: every beat lands in the place it names, in order. Only use proof (stats, quotes, logos) that the brief provides. Keep the brief's tone and must-say/avoid lists. Do not record or render — the reviewer approves the script in Studio first.`,
    critic: `Read ${critic} (or run critic findings). Apply high-confidence narration and plate improvements to ${narration} and ${config} for "${video.slug}". Do not re-record. Follow the product-walkthrough-video skill hard rules.`,
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
- Journey/recording: ${flow} navigation/selectors only when the requested story changes what the viewer must see.

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

  const storyGoals = new Set(['draft', 'branch', 'script', 'narration', 'plates', 'critic', 'full']);
  const spine = storyGoals.has(goal) ? storyBrief(resolvePurpose(video.config, readBrief(video))) : '';
  return [goals[goal] || goals.full, spine, extra].filter(Boolean).join('\n\n').trim();
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
    `#!/usr/bin/env bash\nset -euo pipefail\ncd ${JSON.stringify(workspace)}\nexec agent -p --trust --workspace ${JSON.stringify(workspace)} --output-format text "$(cat ${JSON.stringify(promptFile)})"\n`
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
        : `Authentication required. Run \`agent login\` in a terminal (or set CURSOR_API_KEY in kit/.env), then retry Improve — or open ${job.promptFile} in Cursor chat / run ${job.runScript}.`
    );
    return job;
  }

  job.status = 'running';
  job.startedAt = new Date().toISOString();
  job.agent = runner.bin;
  job.provider = runner.provider;
  job.phase = 'starting';
  append(job, `Launching ${runner.label}…`, { activity: `Launching ${runner.label}…`, kind: 'system' });

  const args = runner.args(prompt, workspace, opts);
  const child = spawn(runner.bin, args, {
    cwd: workspace,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  job.child = child;
  job.pid = child.pid;
  attachLineParser(job, child.stdout, { jsonl: true });
  attachLineParser(job, child.stderr, { jsonl: false });
  child.on('close', (code, signal) => {
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    if (job.cancelRequested || signal === 'SIGTERM' || signal === 'SIGKILL') {
      finalizeCancelled(job, outDir);
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
    const ok = code === 0 && job.result?.ok !== false;
    job.status = ok ? 'done' : 'failed';
    job.phase = ok ? 'done' : 'failed';
    job.activity = ok ? 'Finished' : job.result?.text ? tail(job.result.text) : `Failed (exit ${code})`;
    append(job, ok ? '✓ agent finished' : `✗ agent exit ${code}`, { activity: job.activity, kind: 'system' });
    writeFileSync(join(outDir, `${job.id}.json`), JSON.stringify(jobView({ ...job, log: job.log.slice(-80) }), null, 2));
  });
  return job;
}

/** First line the Studio shows, before the step has printed anything of its own. */
const STEP_OPENING = {
  plates: 'Checking which plates need a fresh render',
  record: 'Opening the app and starting the screen recording',
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
    const child = job.child;
    if (!child) {
      const t = setInterval(() => {
        if (job.status !== 'running' && job.status !== 'queued') {
          clearInterval(t);
          resolve(job);
        }
      }, 200);
      return;
    }
    child.once('close', () => resolve(job));
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

/**
 * Run a kit CLI step as a background job (plates, produce, audio, validate, critic, …).
 * `record` auto-repairs once on capture stall when an agent is available.
 */
export function startKitJob(video, step, extraArgs = []) {
  if (step === 'record') return startRecordWithRepair(video, extraArgs);

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
  if (child && !child.killed) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        if (!child.killed) child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, 1600);
  } else if (job.pid) {
    try {
      process.kill(job.pid, 'SIGTERM');
    } catch {
      /* ignore */
    }
  } else {
    finalizeCancelled(job);
  }
  return job;
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
