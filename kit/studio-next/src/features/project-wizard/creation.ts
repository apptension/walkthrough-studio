import { create } from 'zustand';

import type { Job } from '@/api/types';

import type { Script } from '@/features/script/types';

/**
 * The new-video creation view (`kit/studio/creation.js`): replaces the wizard
 * form while a project is prepared, so the wait always shows what is
 * happening, what exists already and what comes next. It reads only the job
 * payloads the wizard already polls.
 */

export const CREATE_ORDER = ['project', 'brand', 'analyze', 'draft', 'ready'] as const;
export type CreateStage = (typeof CREATE_ORDER)[number];

/** Typical seconds per stage; used for the progress curve and the "usually" hint, never as a deadline. */
const EXPECTED: Record<CreateStage, number> = { project: 2, brand: 45, analyze: 120, draft: 200, ready: 2 };
const WEIGHT: Record<CreateStage, number> = { project: 0.04, brand: 0.26, analyze: 0.12, draft: 0.54, ready: 0.04 };
const WRITE_TOOLS = /^(write|edit|multi ?edit|str ?replace|delete|notebook ?edit)$/i;

export const STAGE_DEFAULTS: Record<CreateStage, { title: string; note: string }> = {
  project: { title: 'Project brief', note: 'Pin story, audience and access' },
  brand: { title: 'Brand foundation', note: 'Capture the official lockup, palette and type' },
  analyze: { title: 'Product map', note: 'Sign in, explore routes, adapt the journey to what exists' },
  draft: { title: 'First script', note: 'The agent writes config, flow, narration and plates' },
  ready: { title: 'Approve & render', note: 'You approve the script; Studio records, cuts, voices and exports' },
};

export const clock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const about = (sec: number) => (sec < 60 ? `~${Math.round(sec / 5) * 5 || 5} s` : `~${Math.round(sec / 60)} min`);
export const fileName = (p: string | null | undefined) =>
  (p || '')
    .split(/[\\/]/)
    .filter(Boolean)
    .slice(-2)
    .join('/');

export interface StageRow {
  done: boolean;
  active: boolean;
  failed: boolean;
  title: string;
  note: string;
  time: string;
}

export interface Artifact {
  name: string;
  note: string;
  kind: string;
  fresh: boolean;
}

export interface ScriptCard {
  meta: string;
  scenes: Array<{ kind: string; mark: string; title: string; line: string }>;
  lint: { hidden: boolean; error: boolean; text: string };
}

interface CreationState {
  /** `#wizardCreation[hidden]`. */
  hidden: boolean;
  /** `#wizardCreation.is-ready`. */
  viewReady: boolean;
  /** `#projectDialog` classes this view owns. */
  dialogCreating: boolean;
  dialogReady: boolean;
  dialogFailed: boolean;
  title: string;
  detail: string;
  elapsed: string;
  eta: string;
  bar: string;
  stages: Record<CreateStage, StageRow>;
  artifacts: Artifact[];
  brandCardHidden: boolean;
  preview: { src: string; hidden: boolean };
  swatches: string[];
  font: { text: string; hidden: boolean };
  /** `#wizardScript` — null while hidden. */
  script: ScriptCard | null;
}

const freshStages = (): Record<CreateStage, StageRow> =>
  Object.fromEntries(
    CREATE_ORDER.map((id) => [id, { done: false, active: false, failed: false, title: STAGE_DEFAULTS[id].title, note: STAGE_DEFAULTS[id].note, time: '' }]),
  ) as Record<CreateStage, StageRow>;

export const useCreation = create<CreationState>()(() => ({
  hidden: true,
  viewReady: false,
  dialogCreating: false,
  dialogReady: false,
  dialogFailed: false,
  title: 'Preparing your video',
  detail: 'Pinning the brief…',
  elapsed: '0:00',
  eta: 'usually 2–5 min',
  bar: '',
  stages: freshStages(),
  artifacts: [],
  brandCardHidden: true,
  preview: { src: '', hidden: true },
  swatches: [],
  font: { text: '', hidden: true },
  script: null,
}));

const view = useCreation;

let timer: ReturnType<typeof setInterval> | 0 = 0;
let startedAt = 0;
let stage: CreateStage | null = null;
let failed = false;
const stageStart: Partial<Record<CreateStage, number>> = {};
const stageEnd: Partial<Record<CreateStage, number>> = {};
const artifacts = new Map<string, Artifact>();
const swatches = new Set<string>();
const selfPaced = new Set<CreateStage>();

function patchStages(fn: (id: CreateStage, row: StageRow) => Partial<StageRow> | null): void {
  view.setState((s) => {
    const stages = { ...s.stages };
    for (const id of CREATE_ORDER) {
      const patch = fn(id, stages[id]);
      if (patch) stages[id] = { ...stages[id], ...patch };
    }
    return { stages };
  });
}

function tick(): void {
  const now = Date.now();
  let progress = 0;
  const times: Partial<Record<CreateStage, string>> = {};
  for (const s of CREATE_ORDER) {
    const started = stageStart[s];
    const ended = stageEnd[s];
    if (ended) progress += WEIGHT[s];
    else if (s === stage && started) {
      const t = (now - started) / 1000;
      progress += WEIGHT[s] * (1 - Math.exp(-t / EXPECTED[s])) * 0.95;
    }
    if (started) times[s] = clock(((ended || now) - started) / 1000);
  }
  const patch: Partial<CreationState> = {
    elapsed: clock((now - startedAt) / 1000),
    bar: `${Math.min(100, progress * 100).toFixed(1)}%`,
  };
  if (stage && !failed && stage !== 'ready') {
    const spent = (now - (stageStart[stage] || now)) / 1000;
    const typical = EXPECTED[stage];
    patch.eta = selfPaced.has(stage)
      ? 'at your pace'
      : spent > typical * 1.6
        ? 'taking longer than usual — still working'
        : `this step usually takes ${about(typical)}`;
  }
  view.setState(patch);
  patchStages((id) => (times[id] != null ? { time: times[id] } : null));
}

function paintArtifacts(): void {
  view.setState({ artifacts: [...artifacts.values()].map((a) => ({ ...a })) });
  for (const a of artifacts.values()) a.fresh = false;
}

function addArtifact(key: string, { name, note = '', kind = 'file' }: { name: string; note?: string; kind?: string }): boolean {
  const prev = artifacts.get(key);
  if (prev && prev.note === note) return false;
  artifacts.set(key, { name, note, kind, fresh: !prev });
  return true;
}

function paintSwatches(): void {
  view.setState({ swatches: [...swatches].slice(0, 6), brandCardHidden: false });
}

function stopTimer(): void {
  if (timer) clearInterval(timer);
  timer = 0;
}

export const creation = {
  get active(): boolean {
    return Boolean(timer);
  },

  start({ resume = false } = {}): void {
    failed = false;
    if (!resume || !startedAt) {
      startedAt = Date.now();
      for (const k of CREATE_ORDER) {
        delete stageStart[k];
        delete stageEnd[k];
      }
      artifacts.clear();
      swatches.clear();
      paintArtifacts();
      view.setState((s) => ({
        swatches: [],
        brandCardHidden: true,
        preview: { ...s.preview, hidden: true },
        font: { ...s.font, hidden: true },
      }));
      patchStages(() => ({ time: '' }));
      for (const id of [...selfPaced]) creation.renameStage(id);
    }
    view.setState({ dialogCreating: true, dialogReady: false, dialogFailed: false, viewReady: false, script: null, hidden: false });
    stopTimer();
    timer = setInterval(tick, 500);
    tick();
  },

  stage(next: CreateStage, detail?: string): void {
    if (stage && stage !== next && stageStart[stage] && !stageEnd[stage]) stageEnd[stage] = Date.now();
    stage = next;
    stageStart[next] ||= Date.now();
    if (next === 'ready') stageEnd.ready = Date.now();
    failed = false;
    view.setState({ title: next === 'ready' ? 'Ready for review' : 'Preparing your video', ...(detail ? { detail } : {}), viewReady: next === 'ready' });
    const at = CREATE_ORDER.indexOf(next);
    patchStages((id) => {
      const i = CREATE_ORDER.indexOf(id);
      return { done: i < at || (next === 'ready' && i <= at), active: i === at && next !== 'ready', failed: false };
    });
    tick();
  },

  /** Relabel a stage row (the guided tour replaces the explore agent's product map). */
  renameStage(id: CreateStage, title?: string, note?: string): void {
    patchStages((sid) => (sid === id ? { title: title || STAGE_DEFAULTS[id].title, note: note || STAGE_DEFAULTS[id].note } : null));
    if (title) selfPaced.add(id);
    else selfPaced.delete(id);
  },

  /** Live sub-line under the active stage — the newest thing the job reported. */
  note(text: string): void {
    if (!stage || !text) return;
    const at = stage;
    patchStages((id) => (id === at ? { note: text } : null));
  },

  artifact(key: string, info: { name: string; note?: string; kind?: string }): void {
    if (addArtifact(key, info)) paintArtifacts();
  },

  /** Pull the live line, files and brand findings out of a polled job. */
  fromJob(job: Pick<Job, 'stream'> | null | undefined): void {
    const entries = job?.stream?.entries || [];
    let changed = false;
    let latest = '';
    for (const e of entries) {
      const text = String(e.text || '').trim();
      if (e.kind === 'tool' && WRITE_TOOLS.test(e.title || '') && text) {
        const name = fileName(text.split('\n')[0]);
        changed = addArtifact(`f:${name}`, { name, note: /delete/i.test(e.title || '') ? 'removed' : e.done ? 'written' : 'writing…' }) || changed;
      }
      if (e.kind === 'line' || e.kind === 'system') {
        for (const line of text.split('\n')) {
          const msg = line.replace(/^›\s*/, '').trim();
          if (!msg) continue;
          const saved = msg.match(/^(?:Saved|Wrote) (.+?)(?: \((\w+)\))?$/);
          if (saved) {
            for (const part of (saved[1] || '')
              .split(/,| and /)
              .map((s) => s.trim())
              .filter(Boolean)) {
              changed =
                addArtifact(`f:${part}`, { name: part, note: saved[2] ? `logo ${saved[2]}` : 'brand pack', kind: /logo/.test(part) ? 'logo' : 'file' }) || changed;
            }
          }
          if (/^Palette:/.test(msg)) {
            for (const hex of msg.match(/#[0-9a-f]{6}\b/gi) || []) swatches.add(hex);
            paintSwatches();
          }
          const font = msg.match(/^Typeface:\s*(.+)$/);
          if (font) view.setState({ font: { text: font[1] || '', hidden: false }, brandCardHidden: false });
        }
      }
      if (text && e.kind !== 'think') {
        latest = (e.kind === 'tool' ? `${e.title} ${fileName(text.split('\n')[0])}` : text.split('\n').filter(Boolean).at(-1) || '').replace(/^›\s*/, '');
      }
    }
    if (latest) creation.note(latest.length > 140 ? `${latest.slice(0, 137)}…` : latest);
    if (changed) paintArtifacts();
  },

  brand(slug: string, foundation: { colors?: Record<string, string | undefined>; logo?: string; font?: { family?: string } } | null | undefined): void {
    const colors = foundation?.colors || {};
    swatches.clear();
    [colors.ink, colors.surface, colors.gold, colors.amber, colors.teal].filter((c): c is string => Boolean(c)).forEach((c) => swatches.add(c));
    paintSwatches();
    if (foundation?.logo) {
      view.setState({
        preview: { src: `/api/video/${encodeURIComponent(slug)}/brand-file/${encodeURIComponent(foundation.logo)}?t=${Date.now()}`, hidden: false },
      });
    }
    if (foundation?.font?.family) view.setState({ font: { text: foundation.font.family, hidden: false } });
  },

  /** The finished first script, summarised in place of the progress grid. */
  script(script: Pick<Script, 'scenes' | 'totals'> | null, { brandName = '' } = {}): void {
    const scenes = script?.scenes || [];
    const totals: Partial<Script['totals']> = script?.totals || {};
    const minutes = totals.estSec ? `${Math.max(1, Math.round((totals.estSec / 60) * 10) / 10)} min` : '';
    const meta = [
      brandName,
      `${totals.chapters || 0} chapters`,
      `${totals.plates || 0} plates`,
      totals.words ? `${totals.words} words of narration` : '',
      minutes ? `~${minutes}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    let n = 0;
    const rows = scenes
      .filter((s) => ['open', 'chapter', 'plate', 'close'].includes(s.kind))
      .map((s) => ({
        kind: s.kind,
        mark: s.kind === 'open' ? 'Open' : s.kind === 'close' ? 'Close' : s.kind === 'plate' ? 'Plate' : String(++n),
        title: s.title || s.plateId || '',
        line: (s.narration || s.onScreen || '').toString().trim(),
      }));
    const errors = totals.errors || 0;
    const warnings = totals.warnings || 0;
    view.setState({
      script: {
        meta,
        scenes: rows,
        lint: {
          hidden: !errors && !warnings,
          error: errors > 0,
          text: errors
            ? `${errors} blocking issue${errors === 1 ? '' : 's'} — Review script first to see and fix ${errors === 1 ? 'it' : 'them'}.`
            : `${warnings} note${warnings === 1 ? '' : 's'} from the script check — safe to render; review when you like.`,
        },
      },
      title: 'Your first script is ready',
      eta: 'done',
      dialogReady: true,
      viewReady: true,
    });
    stopTimer();
    tick();
  },

  /** Stopped or failed: the footer offers Retry preparation / Edit brief until the next start() or exit(). */
  fail(message: string): void {
    failed = true;
    view.setState({
      dialogFailed: true,
      dialogReady: false,
      viewReady: false,
      title: 'Preparation needs attention',
      detail: message || 'Something stopped preparation.',
      eta: 'stopped',
    });
    const at = stage;
    patchStages((id) => (id === at ? { failed: true, active: false } : { failed: false }));
    stopTimer();
    tick();
  },

  /** Stages that never reached `.done` — used to rebuild a resume list after a cancel. */
  unfinished(): CreateStage[] {
    const { stages } = view.getState();
    return CREATE_ORDER.filter((id) => id !== 'project' && id !== 'ready' && !stages[id].done);
  },

  /** Leave creating mode (back to the form, e.g. to fix the brief after a failure). */
  exit(): void {
    stopTimer();
    view.setState({ dialogCreating: false, dialogReady: false, dialogFailed: false, hidden: true });
  },

  reset(): void {
    creation.exit();
    stage = null;
    startedAt = 0;
    view.setState({ viewReady: false, script: null });
  },
};
