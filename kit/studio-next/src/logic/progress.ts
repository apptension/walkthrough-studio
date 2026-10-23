/**
 * Turn a kit/agent job into something a person can follow: a title, the sentence
 * of what is happening right now, and a checklist that advances as the log does.
 * Stage lines printed by the kit look like `» captions · 34 caption cues`.
 */

import { asText } from './text';

/** `[id, label, detail, matcher, weight]` — weight is how long the stage usually takes. */
type StageSpec = readonly [id: string, label: string, detail: string, matcher?: RegExp | null, weight?: number];

interface StepSpec {
  title: string;
  done: string;
  failed?: string;
  summary: string;
  stages: readonly StageSpec[];
}

export type StageState = 'todo' | 'run' | 'done' | 'fail';

export interface JobStage {
  id: string;
  label: string;
  detail: string;
  state: StageState;
}

interface PlateRow extends JobStage {
  frame?: number;
  frames?: number;
  cached?: boolean;
}

export interface ProgressJob {
  status?: string;
  kind?: string;
  step?: string;
  goal?: string;
  phase?: string;
  slug?: string;
  activity?: string;
  message?: string;
  repair?: { attempts?: number; max?: number } | null;
  log?: (string | { line?: string } | null | undefined)[] | null;
}

export interface JobView {
  title: string;
  summary: string;
  statusLabel: string;
  badge: string;
  now: string;
  progress: number;
  stages: JobStage[];
}

const STEPS: Partial<Record<string, StepSpec>> = {
  deliver: {
    title: 'Exporting the handoff',
    done: 'Handoff is ready',
    summary: 'Video, poster, captions, chapters and notes — one folder.',
    stages: [
      ['captions', 'Captions', 'SRT, WebVTT and a plain transcript', /caption|srt|vtt|cue/i],
      ['qc', 'Quality check', 'Pacing, dead air and long stretches', /\bqc\b|pacing/i],
      ['poster', 'Poster', 'A still for the thumbnail', /poster/i],
      ['chapters', 'Chapters', 'YouTube paste and a markdown list', /chapter/i],
      ['pack', 'Package', 'Everything copied into the handoff folder', /handoff|deliverable|readme|pack/i],
    ],
  },
  produce: {
    title: 'Building the master',
    done: 'Master video is ready',
    failed: 'The master did not build',
    summary: 'Plates and the screen recording, joined into one file.',
    stages: [
      ['plates', 'Brand plates', 'Reuses every plate that has not changed', null, 3],
      ['live', 'Clean up the recording', 'Flash repair and magnifier lenses', null, 1.5],
      ['plan', 'Edit plan', 'Where each plate and recording sits', null, 0.2],
      ['encode', 'Encode', 'Writing the H.264 master', null, 3],
    ],
  },
  plates: {
    title: 'Rendering brand plates',
    done: 'Plates are rendered',
    summary: 'Each title card is drawn frame by frame, then checked.',
    stages: [['prepare', 'Preparing', 'Checking which plates need drawing', /^$/]],
  },
  record: {
    title: 'Recording the walkthrough',
    done: 'Recording captured',
    failed: 'Recording did not finish',
    summary: 'A real browser, driving the live app. A repairable stall cycles back through capture up to the retry limit.',
    stages: [
      ['open', 'Opening the app', 'Loading the start page', /open|navigat|start url|login/i],
      ['capture', 'Capturing', 'Chapter cards and captions play over the screen', /» capture|driving the walkthrough|chapter|caption/i],
      ['stall', 'Stall detected', 'No progress — writing the stall report', /✗ stall|capture stalled|stall ·/i],
      ['repair', 'Repairing the flow', 'Agent fixes selectors from the stall report', /» repair|repairing flow|capture-repair|Repair:/i],
      ['rerecord', 'Capturing again', 'Returns to capture after each repair', /» record · Capturing again|Capturing again after repair/i],
      ['save', 'Saving', 'Writing the take', /» save|finish|live\.mp4|wrote/i],
    ],
  },
  guide: {
    title: 'Your recording',
    done: 'Recording saved',
    failed: 'Nothing was recorded',
    summary: 'Press Start recording in the Recorder window, show the product in the browser, then Finish recording. Pauses are cut.',
    stages: [
      ['open', 'Opening the browser', 'A browser and a Recorder window open', /opening|start page/i],
      ['ready', 'Getting ready', 'Sign in if needed, go to the first screen, press Start recording', /ready —|sign in in the browser/i],
      ['capture', 'Recording', 'Mark chapters as you go; Pause to set up; Finish recording when done', /recording|click|fill|typed|select|check|scroll|drag|hover|press|chapter|undid|paused|goto|open/i],
      ['save', 'Saving', 'Your recording, steps and a replay draft', /saving \(|✓ guided tour/i],
    ],
  },
  'adopt-take': {
    title: 'Keeping your recording',
    done: 'Your recording is the take',
    failed: 'Your recording could not be kept',
    summary: 'Your recording becomes the take; your chapters become the timeline.',
    stages: [['keep', 'Keeping your recording', 'Checking the file, then setting it as the take', /./]],
  },
  audio: {
    title: 'Adding voice and music',
    done: 'Audio is mixed in',
    summary: 'Narration fitted to the cut, then music ducked underneath.',
    stages: [
      ['voice', 'Voice', 'Fitting each line to its scene', /voice|speech|line|elevenlabs|clip/i],
      ['music', 'Music', 'Trimming the bed to this cut', /music|bed/i],
      ['mix', 'Mix', 'Levelling to −14 LUFS and muxing onto the master', /mix|mux|lufs/i],
    ],
  },
  music: {
    title: 'Composing music',
    done: 'Music bed ready',
    summary: 'A new bed sized to this cut.',
    stages: [['music', 'Music', 'Composing sections to the delivery length', /music|compos|bed|section/i]],
  },
  mix: {
    title: 'Mixing audio',
    done: 'Mix written',
    summary: 'Music ducked under narration and muxed onto the master.',
    stages: [['mix', 'Mix', 'Levelling and muxing onto the master', /mix|mux|lufs|duck/i]],
  },
  validate: {
    title: 'Checking the picture',
    done: 'Picture check finished',
    summary: 'Looking for flashes, blank frames and bad joins.',
    stages: [
      ['frames', 'Sampling frames', 'Joins, chapter cards and plates', /frame|shot|contact/i],
      ['flashes', 'Flash scan', 'Blank or white frames in the master', /flash|blank|luma/i],
    ],
  },
  captions: {
    title: 'Writing captions',
    done: 'Captions written',
    summary: 'Timed from the fitted narration.',
    stages: [['captions', 'Captions', 'SRT, WebVTT and a plain transcript', /./]],
  },
  qc: {
    title: 'Checking the pacing',
    done: 'Pacing check finished',
    summary: 'Dead air, words per minute and stretches that run long.',
    stages: [['qc', 'Quality check', 'Reading the voice against the cut', /./]],
  },
  critic: {
    title: 'Reviewing as a viewer',
    done: 'Review written',
    summary: 'A one-pass read of narration, plates and pacing.',
    stages: [['read', 'Reading the cut', 'Notes land in the critic report', /./]],
  },
  smoke: {
    title: 'Checking capture timing',
    done: 'Timing check finished',
    summary: 'Overlays against the clock. Drift must stay under half a second.',
    stages: [['smoke', 'Timing', 'Recording a short probe', /./]],
  },
};

const IMPROVE_FULL: readonly [string, string] = ['Applying your feedback', 'Reading the note, then editing the sources.'];

const IMPROVE: Partial<Record<string, readonly [string, string]>> = {
  script: ['Revising the script', 'Editing narration and on-screen copy. Selectors stay put.'],
  draft: ['Drafting the first script', 'Writing the config, the flow and the narration from your brief.'],
  scene: ['Editing this plate', 'Applying your note to the plate copy and motion.'],
  motion: ['Reworking the motion', 'Applying the motion note, then rebuilding the plate.'],
  full: IMPROVE_FULL,
  narration: ['Rewriting narration', 'Shortening and refitting the spoken lines.'],
  'guided-script': ['Scripting your tour', 'Optimising the journey you showed: detours out, selectors hardened, chapters at your moments.'],
  'take-recraft': ['Recrafting around the take', 'Fitting narration and the brief to what the bot actually recorded.'],
  'own-take': ['Writing around your recording', 'Fitting narration, the brief and plates to the chapters you recorded.'],
  plates: ['Reworking the plates', 'Updating plate copy from your note.'],
  'discover-brand': [
    'Capturing the brand',
    'Harvesting the live site, then the agent authors the lockup, palette and motion brief.',
  ],
};

const STATUS: Partial<Record<string, readonly [string, string]>> = {
  running: ['Working', 'run'],
  queued: ['Queued', 'run'],
  done: ['Done', 'ok'],
  failed: ['Failed', 'bad'],
  'needs-agent': ['Needs sign-in', 'bad'],
  cancelled: ['Stopped', ''],
  cancelling: ['Stopping', 'run'],
};

const STAGE_LINE = /^»\s+([a-z0-9-]+)\s+·\s+(.+)$/i;

function logLines(job: ProgressJob | null | undefined): string[] {
  return (job?.log || [])
    .map((l) => (typeof l === 'string' ? l : (l as { line?: string }).line || ''))
    // eslint-disable-next-line no-control-regex -- strips ANSI colour escapes from kit output, as legacy does
    .map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim())
    .filter((l) => l && !/^· kit\//.test(l));
}

function humanize(line: unknown): string {
  return tidy(line);
}

/** Drop filesystem paths down to a file name so a log line can never blow out a card. */
function tidy(line: unknown): string {
  return asText(line || '')
    .replace(/^»\s+[a-z0-9-]+\s+·\s+/i, '')
    .replace(/^[·✦⚙✓✗■]\s*/, '')
    .split(/\s+/)
    .map((tok) => (tok.includes('/') || tok.includes('\\') ? tok.replace(/^.*[\\/]/, '') : tok))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PLATE_LINE = /^» plate · ([^·]+?) · (.+)$/i;

function sentenceCase(detail: unknown): string {
  const text = tidy(detail);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

interface PlateView {
  summary: string;
  count: string;
  stages: PlateRow[];
  progress: number;
  now: string;
}

/**
 * One row per plate, taken only from `» plate · Name · …` lines.
 * Returns null until the kit has printed one, so a raw path never becomes a row.
 */
function plateView(lines: string[], status: string): PlateView | null {
  const order: string[] = [];
  const rows = new Map<string, PlateRow>();
  let headline = '';
  for (const line of lines) {
    const head = line.match(/^» plates · (.+)$/i);
    if (head) headline = tidy(head[1]);
    const marked = line.match(PLATE_LINE);
    if (!marked) continue;
    const label = (marked[1] ?? '').trim();
    const detail = sentenceCase(marked[2]);
    if (!rows.has(label)) {
      order.push(label);
      rows.set(label, { id: label, label, detail, state: 'todo' });
    }
    const row = rows.get(label) as PlateRow;
    row.detail = detail;
    const frame = detail.match(/^frame (\d+) of (\d+)/i);
    if (frame) {
      row.frame = Number(frame[1]);
      row.frames = Number(frame[2]);
    }
    if (/^failed\b/i.test(detail)) row.state = 'fail';
    else if (/^waiting\b/i.test(detail)) row.state = 'todo';
    else if (/^already rendered\b/i.test(detail)) {
      row.state = 'done';
      row.cached = true;
    } else if (/^(ready|checked)\b/i.test(detail)) {
      row.state = 'done';
      row.frame = row.frames;
    } else row.state = 'run';
  }
  if (!order.length && !headline) return null;

  const finished = status === 'done';
  const failed = status === 'failed' || status === 'needs-agent';
  const stages = order.map((label) => {
    const row = rows.get(label) as PlateRow;
    if (finished && row.state !== 'fail') row.state = 'done';
    else if (failed && row.state !== 'done') {
      row.state = 'fail';
      if (/^waiting\b/i.test(row.detail)) row.detail = 'Did not start';
    }
    return row;
  });

  // Weighted by frames still to draw; a plate reused from cache costs nothing and counts as done.
  const drawn = stages.filter((row) => !row.cached);
  const known = drawn.filter((row) => (row.frames ?? NaN) > 0);
  const typical = known.length ? known.reduce((s, r) => s + (r.frames as number), 0) / known.length : 180;
  let total = 0;
  let done = 0;
  for (const row of drawn) {
    const frames = (row.frames ?? NaN) > 0 ? (row.frames as number) : typical;
    total += frames;
    if (row.state === 'done') done += frames;
    else if (row.state === 'run' || row.state === 'fail') done += Math.min(frames, row.frame || 0);
  }
  const progress = finished ? 1 : total > 0 ? Math.min(0.99, done / total) : headline ? 0.02 : 0;

  const running = stages.filter((row) => row.state === 'run' || row.state === 'fail');
  const finishedCount = stages.filter((row) => row.state === 'done').length;
  const cachedCount = stages.filter((row) => row.cached).length;
  const count = stages.length
    ? cachedCount === stages.length
      ? 'Every plate already matches'
      : `${finishedCount} of ${stages.length} plates ready${cachedCount ? ` · ${cachedCount} reused` : ''}`
    : '';
  const now = running.length
    ? running.map((row) => `${row.label} — ${row.detail}`).join(' · ')
    : headline;

  if (!failed) {
    for (const row of stages) if (row.state === 'todo' && /^waiting\b/i.test(row.detail)) row.detail = 'Waiting for a free slot';
  }

  return {
    summary: count || headline,
    count,
    stages,
    progress,
    now,
  };
}

/** The sentence a person should read when a job stops, taken from the log rather than the exit code. */
function failureReason(lines: string[]): string {
  for (const raw of [...lines].reverse()) {
    const line = tidy(raw);
    if (!line || /exit \d+$/i.test(line)) continue;
    if (/^\[/.test(asText(raw).trim()) || /moov atom|Invalid data found|Error opening input/i.test(line)) continue;
    if (/^✗/.test(asText(raw).trim()) || /did not finish|no recording yet|unreadable/i.test(line)) return line;
  }
  return 'Something went wrong — open the log.';
}

/** Fraction of the way through a stage, when its detail says so ("42% · …", "4 of 12 · …"). */
function stageFraction(detail: unknown): number | null {
  const pct = asText(detail || '').match(/^(\d{1,3})%/);
  if (pct) return Math.min(1, Number(pct[1]) / 100);
  const of = asText(detail || '').match(/^(\d+) of (\d+)\b/);
  if (of && Number(of[2]) > 0) return Math.min(1, Number(of[1]) / Number(of[2]));
  return null;
}

export function describeJob(job: ProgressJob | null | undefined): JobView {
  const status = job?.status || 'running';
  const [statusLabel, badge] = STATUS[status] || [status, ''];
  const lines = logLines(job);
  const spec = job?.step ? STEPS[job.step] : undefined;

  if (job?.kind === 'improve' || job?.kind === 'discover-brand' || (!spec && job?.goal)) {
    const [title, summary] = (job.goal ? IMPROVE[job.goal] : undefined) || IMPROVE_FULL;
    const now = humanize(job.activity || job.message || lines.at(-1) || '');
    return { title, summary, statusLabel, badge, now, progress: status === 'done' ? 1 : 0, stages: [] };
  }

  if (!spec) {
    return {
      title: humanize(job?.activity) || 'Working',
      summary: job?.slug || '',
      statusLabel,
      badge,
      now: '',
      progress: status === 'done' ? 1 : 0,
      stages: [],
    };
  }

  if (
    job?.step === 'record' &&
    job.status === 'running' &&
    (job.repair?.attempts ?? NaN) > 0 &&
    (job.phase === 'repairing' || job.phase === 're-recording')
  ) {
    const repair = job.repair as { attempts?: number; max?: number };
    const attempts = Number(repair.attempts);
    const maxRepairs = Number(repair.max) || 3;
    const repairing = job.phase === 'repairing';
    const stages = spec.stages.map(([id, label, detail]): JobStage => {
      let state: StageState = 'todo';
      if (['open', 'stall'].includes(id)) state = 'done';
      if (id === 'repair') state = repairing ? 'run' : 'done';
      if (id === 'capture') state = repairing ? 'done' : 'run';
      return { id, label, detail, state };
    });
    return {
      title: repairing
        ? `Repairing capture ${attempts}/${maxRepairs}`
        : `Capturing again ${attempts + 1}/${maxRepairs + 1}`,
      summary: `Capture and repair can repeat ${maxRepairs} times before the job stops with an error.`,
      statusLabel,
      badge,
      now: humanize(job.activity || ''),
      progress: Math.min(0.9, attempts / (maxRepairs + 1)),
      stages,
    };
  }

  if (job?.step === 'plates') {
    const plates = plateView(lines, status);
    if (plates) {
      const failed = status === 'failed' || status === 'needs-agent';
      return {
        title: status === 'done' ? spec.done : spec.title,
        summary: plates.summary || spec.summary,
        statusLabel,
        badge,
        now: failed ? humanize(failureReason(lines)) : plates.now,
        progress: plates.progress,
        stages: plates.stages,
      };
    }
  }

  const stageAt = (i: number): StageSpec => spec.stages[i] as StageSpec;
  const mentioned = new Map<string, string>();
  let current = -1;
  for (const line of lines) {
    const marked = line.match(STAGE_LINE);
    if (!marked) continue;
    const [, markedId = '', markedDetail = ''] = marked;
    let idx = spec.stages.findIndex(([id]) => id === markedId);
    if (idx < 0 && markedId === job?.step) idx = spec.stages.findIndex(([, , , re]) => re?.test(markedDetail));
    if (idx < 0) continue;
    current = Math.max(current, idx);
    const detail = tidy(markedDetail);
    if (detail && !detail.startsWith('http')) mentioned.set(stageAt(idx)[0], detail);
  }
  if (current < 0 && (status === 'running' || status === 'queued' || status === 'cancelling')) current = 0;
  const failedEarly = (status === 'failed' || status === 'needs-agent') && current < 0;
  const reason = failedEarly || status === 'failed' || status === 'needs-agent' ? failureReason(lines) : '';
  if (failedEarly) {
    const liveIdx = /record/i.test(reason) ? spec.stages.findIndex(([id]) => id === 'live') : 0;
    current = liveIdx >= 0 ? liveIdx : 0;
    mentioned.set(stageAt(current)[0], reason);
  }

  // Produce draws stale plates first: fold the per-plate lines into that one stage.
  const nested = spec.stages.some(([id]) => id === 'plates') ? plateView(lines, status) : null;
  if (nested && nested.stages.length) {
    const drawing = nested.stages.filter((r) => r.state === 'run');
    const allCached = nested.stages.every((r) => r.cached);
    const detail = allCached
      ? `All ${nested.stages.length} plates reused — nothing changed`
      : drawing.length
        ? `${Math.round(nested.progress * 100)}% · ${nested.count} · drawing ${drawing.map((r) => r.label).join(', ')}`
        : nested.count;
    mentioned.set('plates', detail);
  }

  const finished = status === 'done';
  const failed = status === 'failed' || status === 'needs-agent';
  const stages = spec.stages.map(([id, label, fallback], i): JobStage => {
    let state: StageState = 'todo';
    if (finished) state = 'done';
    else if (i < current && (mentioned.has(id) || !failed)) state = 'done';
    else if (i === current) state = failed ? 'fail' : 'run';
    return { id, label, detail: mentioned.get(id) || (state === 'todo' ? fallback : fallback), state };
  });
  // A finished stage keeps its measured detail; a pending one keeps the promise.
  for (const s of stages) {
    if (s.state === 'todo') s.detail = (spec.stages.find(([id]) => id === s.id) as StageSpec)[2];
  }

  // Each stage carries a weight (how long it usually takes); the running one counts the share
  // its own line reports, so the bar moves with the encode and never jumps by a whole stage.
  const weightOf = (id: string): number => spec.stages.find(([sid]) => sid === id)?.[4] ?? 1;
  let totalWeight = 0;
  let doneWeight = 0;
  for (const s of stages) {
    let w = weightOf(s.id);
    if (s.id === 'plates' && nested?.stages.every((r) => r.cached)) w = 0.1;
    totalWeight += w;
    if (s.state === 'done') doneWeight += w;
    else if (s.state === 'run') {
      const f = s.id === 'plates' && nested ? nested.progress : stageFraction(mentioned.get(s.id));
      doneWeight += w * (f ?? 0.15);
    }
  }
  const progress = finished ? 1 : totalWeight ? Math.min(0.99, doneWeight / totalWeight) : 0;

  const active = stages.find((s) => s.state === 'run' || s.state === 'fail');
  const lastMarked = [...mentioned.values()].at(-1);
  let now = '';
  if (finished) now = lastMarked || spec.summary;
  else if (failed) now = reason;
  else now = active ? `${active.label} — ${mentioned.get(active.id) || active.detail}` : spec.summary;

  return {
    title: finished ? spec.done : failed ? spec.failed || spec.title : spec.title,
    summary: failed ? reason : spec.summary,
    statusLabel,
    badge,
    now,
    progress,
    stages,
  };
}
