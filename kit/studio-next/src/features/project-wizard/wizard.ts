import { flushSync } from 'react-dom';
import { create as createStore } from 'zustand';

import type { Job, VideoSummary } from '@/api/types';
import { api } from '@/desk/api';
import { ask } from '@/desk/ask';
import { requestMake, watchJob } from '@/desk/jobs';
import { desk, openDialog } from '@/desk/store';
import { toast } from '@/desk/toast';
import { openVideo } from '@/desk/video';
import { hasStoredCredentials, maskCredentials, revisePlan, stagesForReplan, type Brief as ReviseBrief, type ReplanStage } from '@/logic/briefRevise';
import { screenQuery } from '@/logic/captureSize';
import { confirmGuidedFits, type GuidedFitApi } from '@/logic/guidedFit';
import { resolveVideoLanguage } from '@/logic/languages';
import { clampLengthSec } from '@/logic/length';
import { draftFromDescription, type ShortBriefDraft } from '@/logic/shortBrief';
import { openScript } from '@/features/script/sheet';
import type { ScriptPayload } from '@/features/script/types';

import {
  captureChoice,
  failureMessage,
  httpOk,
  lastStepLabel,
  payload,
  pendingFromViews,
  REPLAN_ORDER,
  REPLAN_STAGE,
  STEPS,
  STOPPED_MESSAGE,
  summaryGroups,
  validate,
  type AgentBrief,
  type FormReader,
  type SummaryGroup,
  type WizardCaptureOption,
  type WizardPayload,
} from './brief';
import { brandStudio } from './brandStudio';
import { captureBrief } from './briefSignals';
import { creation, useCreation, type CreateStage } from './creation';
import { creationFeed } from './creationFeed';
import { hideWizardGuide, showWizardGuide } from './guideSession';

/**
 * The new-video wizard and project settings (`kit/studio/projects.js`):
 * brief → POST /api/projects → brand discovery → product map → first draft →
 * script review. Nothing is recorded until the script is approved.
 *
 * Field values live in the DOM, as the legacy form kept them; this module
 * reads and writes them through `form.elements` and keeps everything the
 * legacy code painted (mode, step, buttons, error, summary…) in a store.
 */

export type WizardMode = 'short' | 'steps' | 'settings';

export interface BrandOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** A brand pack as the New video tiles show it. */
export interface BrandPack {
  id: string;
  name: string;
  accent: string | null;
  colors: Partial<Record<'ink' | 'surface' | 'gold' | 'amber' | 'text', string | null>>;
  font: string | null;
  placeholder: boolean;
}

interface WizardState {
  mode: WizardMode;
  step: number;
  stepsHidden: boolean;
  dialogTitle: string;
  settings: boolean;
  running: boolean;
  error: { text: string; hidden: boolean };
  nextLabel: string;
  nextDisabled: boolean;
  nextBusy: boolean;
  backDisabled: boolean;
  backLabel: string;
  stepMeta: string;
  progress: string;
  drafting: boolean;
  shortDraftTitle: string;
  shortDraftLine: string;
  /** The job `#shortDraftStream` paints; null resets it. */
  shortJob: Job | null;
  /** The job `#wizardStream` paints; null resets it. */
  streamJob: Job | null;
  brands: BrandOption[] | null;
  brandPacks: BrandPack[];
  captureOptions: WizardCaptureOption[];
  captureHint: string;
  language: string;
  /** Target length in seconds. The Basics control is controlled from this. */
  lengthSec: number;
  languageFilter: string;
  slugDisabled: boolean;
  /** `syncConditional()` inputs. */
  brandNew: boolean;
  login: boolean;
  guided: boolean;
  credOnFile: boolean;
  /** Brand whose plate stills the Proof tiles show ('' = none). */
  stillBrand: string;
  summary: SummaryGroup[];
  retryLabel: string;
  stopLabel: string;
  stopDisabled: boolean;
  renderBusy: boolean;
  renderDisabled: boolean;
  reviewDisabled: boolean;
  /** Bumped by `form.reset()` so controlled fields re-sync. */
  formRev: number;
}

export const useWizard = createStore<WizardState>()(() => ({
  mode: 'steps',
  step: 0,
  stepsHidden: false,
  dialogTitle: 'New video',
  settings: false,
  running: false,
  error: { text: '', hidden: true },
  nextLabel: 'Next',
  nextDisabled: false,
  nextBusy: false,
  backDisabled: true,
  backLabel: 'Back',
  stepMeta: 'Step 1 of 5',
  progress: '',
  drafting: false,
  shortDraftTitle: 'Reading your description…',
  shortDraftLine: 'The agent finds the product, the audience, the beats to show, and the brand.',
  shortJob: null,
  streamJob: null,
  brands: null,
  brandPacks: [],
  captureOptions: [],
  captureHint: 'Suggested from your screen and brief.',
  language: 'en',
  lengthSec: 120,
  languageFilter: '',
  slugDisabled: false,
  brandNew: false,
  login: false,
  guided: false,
  credOnFile: false,
  stillBrand: '',
  summary: [],
  retryLabel: 'Retry preparation',
  stopLabel: 'Stop',
  stopDisabled: false,
  renderBusy: false,
  renderDisabled: false,
  reviewDisabled: false,
  formRev: 0,
}));

const wiz = useWizard;
const set = (patch: Partial<WizardState>) => wiz.setState(patch);
const commit = (patch: Partial<WizardState>) => flushSync(() => wiz.setState(patch));

let settingsBrief: ReviseBrief | null = null;
let created: (ProjectCreated & { needsDiscovery?: boolean }) | null = null;
let creationStage: CreateStage | null = null;
let creating = false;
let currentJobId: string | null = null;
let stopRequested = false;
/** One-description draft: the agent job that fills the brief, and what it returned. */
let briefJobId: string | null = null;
let briefCancelled = false;
let agentBrief: AgentBrief | null = null;
/** Slug whose first script waits in the Ready view for Approve & render. */
let readySlug: string | null = null;
/** Project settings replan that stopped or failed: `{ slug, stages }` still to run, so Retry resumes. */
let replanRun: { slug: string; stages: ReplanStage[] } | null = null;

interface ProjectCreated {
  slug: string;
  brand?: string;
  envVars?: string[];
  needsDiscovery?: boolean;
}

/* ---------- the form ---------- */

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function form(): HTMLFormElement | null {
  return document.getElementById('projectForm') as HTMLFormElement | null;
}

function control(name: string): Control | null {
  const el = form()?.elements.namedItem(name);
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el : null;
}

const reader: FormReader = {
  val: (name) => control(name)?.value?.trim() || '',
  raw: (name) => control(name)?.value || '',
  checked: (name) => {
    const el = control(name);
    return el instanceof HTMLInputElement && el.checked;
  },
  radio: (name) => form()?.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value || '',
  checkedValues: (name) => [...(form()?.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`) || [])].map((i) => i.value),
};

const val = (name: string) => reader.val(name);
const checked = (name: string) => reader.checked(name);
const radio = (name: string) => reader.radio(name);

function setField(name: string, value: string | null | undefined): void {
  const el = control(name);
  if (el && value != null) el.value = value;
}

/**
 * The selection a select falls back to when its options are replaced wholesale (`innerHTML`);
 * a lone disabled placeholder stays shown, as its `selected` attribute did.
 */
function resetSelection(name: string): void {
  const el = control(name);
  if (!(el instanceof HTMLSelectElement)) return;
  const options = [...el.options];
  const chosen = options.find((o) => !o.disabled);
  el.selectedIndex = chosen ? options.indexOf(chosen) : 0;
}

function pick(name: string, value: string): void {
  if (name === 'lengthSec') {
    setLengthSec(value);
    return;
  }
  const el = form()?.querySelector<HTMLInputElement>(`input[name="${name}"][value="${CSS.escape(value)}"]`);
  if (el) el.checked = true;
}

/** Any duration, committed before the next form read so the preview and the payload agree. */
export function setLengthSec(value: unknown): void {
  commit({ lengthSec: clampLengthSec(value) });
}

function setLogin(on: boolean): void {
  const login = form()?.querySelector<HTMLInputElement>('input[name="loginRequired"]');
  if (login) login.checked = on;
}

function setPlates(plates: string[]): void {
  form()
    ?.querySelectorAll<HTMLInputElement>('input[name="plates"]')
    .forEach((input) => {
      input.checked = plates.includes(input.value);
    });
}

function wizardPayload(): WizardPayload {
  const newProject = !wiz.getState().settings;
  return payload(reader, { newProject, capture: captureChoice(wiz.getState().captureOptions, val('capturePreset')) });
}

/* ---------- options ---------- */

let captureLoaded = false;

/** `fillCaptureOptions()` — fetched once, on mount. */
export async function fillCaptureOptions(): Promise<void> {
  if (captureLoaded) return;
  captureLoaded = true;
  let options: WizardCaptureOption[] = [];
  try {
    const q = screenQuery();
    const r = await api<{ options?: WizardCaptureOption[] }>(`/api/capture/options${q ? `?${q}` : ''}`);
    options = r.options || [];
  } catch {
    options = [];
  }
  commit({ captureOptions: options });
  syncCaptureHint();
}

/** The option the Recording size select starts on. */
export function captureFallback(options: WizardCaptureOption[]): WizardCaptureOption | undefined {
  return options.find((o) => o.id === 'desktop-fhd') || options[0];
}

export function syncCaptureHint(): void {
  const options = wiz.getState().captureOptions;
  const o = options.find((x) => x.id === control('capturePreset')?.value);
  const why = o?.reason && o.reason !== o.label ? o.reason : '';
  set({ captureHint: !o ? '' : why ? `${o === options[0] ? 'Suggested' : 'Note'} — ${why}.` : 'You can change it later under Direction.' });
  const shape = control('outputFormat');
  if (o && shape && !shape.dataset.touched) shape.value = o.height > o.width ? 'portrait' : 'landscape';
}

export function setLanguage(code: string): void {
  set({ language: code });
}

export function setLanguageFilter(text: string): void {
  set({ languageFilter: text });
}

/* ---------- error ---------- */

function clearError(): void {
  set({ error: { ...wiz.getState().error, hidden: true } });
  form()
    ?.querySelectorAll('[aria-invalid="true"]')
    .forEach((el) => el.removeAttribute('aria-invalid'));
}

function showError(message: string, field?: string): void {
  commit({ error: { text: message, hidden: false } });
  const el = field ? control(field) : null;
  if (el) {
    el.setAttribute('aria-invalid', 'true');
    el.focus();
  }
  form()?.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Typing into a flagged field clears the flag and the message. */
export function onFormInput(target: EventTarget | null): void {
  if (target instanceof Element && target.getAttribute('aria-invalid') === 'true') {
    target.removeAttribute('aria-invalid');
    set({ error: { ...wiz.getState().error, hidden: true } });
  }
}

/* ---------- steps ---------- */

function stillBrand(): string {
  return radio('brandMode') === 'existing' ? val('brandId') : '';
}

function brandLabel(): string {
  const sel = control('brandId');
  const opt = sel instanceof HTMLSelectElement ? sel.selectedOptions[0] : undefined;
  if (!opt) return '';
  const attr = (opt.getAttribute('label') || '').trim();
  if (attr) return attr;
  return (opt.textContent || '').replace(/\s+/g, ' ').trim();
}

function renderSummary(): void {
  const p = wizardPayload();
  set({
    summary: summaryGroups(p, {
      brandLabel: brandLabel(),
      purposeLabel: form()?.querySelector<HTMLInputElement>('input[name="purpose"]:checked')?.dataset.label || '',
      captureOptions: wiz.getState().captureOptions,
      agentBrief,
      settings: wiz.getState().mode === 'settings',
      settingsBrief,
    }),
  });
}

export function showStep(n: number, { focus = true } = {}): void {
  const s = wiz.getState();
  const mode: WizardMode = s.mode === 'settings' ? 'settings' : 'steps';
  const step = Math.max(0, Math.min(STEPS - 1, n));
  const settings = mode === 'settings';
  const last = lastStepLabel({ settings, replanPending: Boolean(replanRun?.stages?.length), created: Boolean(created), runDraft: checked('runDraft') });
  commit({
    mode,
    stepsHidden: false,
    step,
    // On Basics of a new video, Back returns to the one-description form.
    backDisabled: step === 0 && settings,
    backLabel: step === 0 && !settings ? 'Description' : 'Back',
    nextLabel: step === STEPS - 1 ? last : 'Continue',
    stepMeta: `Step ${step + 1} of ${STEPS}`,
    progress: `${((step + 1) / STEPS) * 100}%`,
    ...(step === 3 ? { stillBrand: stillBrand() } : {}),
  });
  clearError();
  captureBrief();
  const f = form();
  if (f) f.scrollTop = 0;
  if (step === STEPS - 1) flushSync(renderSummary);
  if (focus && step !== 3) {
    f?.querySelector<HTMLElement>(
      `fieldset[data-step="${step}"] input:not([type=radio]):not([type=checkbox]), fieldset[data-step="${step}"] textarea`,
    )?.focus({ preventScroll: true });
  }
}

function setDrafting(on: boolean): void {
  commit({
    drafting: on,
    nextBusy: on,
    nextDisabled: on,
    ...(on
      ? {
          backDisabled: false,
          backLabel: 'Cancel',
          stepMeta: 'Drafting the brief…',
          shortDraftTitle: 'Reading your description…',
          shortDraftLine: 'The agent finds the product, the audience, the beats to show, and the brand.',
          shortJob: null,
        }
      : {}),
  });
  if (on) requestAnimationFrame(() => document.getElementById('shortDraft')?.scrollIntoView({ block: 'end', behavior: 'smooth' }));
}

export function showShort(): void {
  commit({
    mode: 'short',
    stepsHidden: true,
    backDisabled: true,
    backLabel: 'Back',
    nextLabel: 'Draft the video',
    stepMeta: 'One description',
    progress: '8%',
  });
  setDrafting(false);
  clearError();
}

/** Validate every step before `target`; stops on the first failing one. */
export function goTo(target: number): void {
  for (let i = Math.min(wiz.getState().step, target); i < target; i++) {
    const err = validate(i, reader);
    if (err) {
      showStep(i, { focus: false });
      showError(...err);
      return;
    }
  }
  showStep(target);
}

/* ---------- conditionals ---------- */

/** Settings: never echo saved email/password — show on-file status and replace-only fields. */
function paintCredentialFields(): void {
  const onFile = Boolean(settingsBrief?.app?.credentialsOnFile) || hasStoredCredentials(settingsBrief);
  set({ credOnFile: onFile });
  const email = control('email');
  if (email && onFile && wiz.getState().mode === 'settings') email.value = '';
  const password = control('password');
  if (password) password.value = '';
}

/** `syncConditional()` — runs on every form `change`. */
export function syncConditional(): void {
  commit({ brandNew: radio('brandMode') === 'new', login: checked('loginRequired'), guided: radio('captureMode') === 'guided' });
  paintCredentialFields();
  const { step } = wiz.getState();
  if (step === 3) set({ stillBrand: stillBrand() });
  if (step === STEPS - 1) showStep(step, { focus: false });
  captureBrief();
}

/* ---------- brief draft ---------- */

/** Rough fallback when no agent can read the description: a few regex guesses, then the form. */
function applyDraft(draft: ShortBriefDraft): void {
  setField('title', draft.title);
  if (draft.audience) setField('audience', draft.audience);
  setField('startUrl', draft.startUrl);
  setField('mustShow', draft.chapters.join('\n'));
  pick('purpose', draft.purpose);
  pick('lengthSec', String(draft.lengthSec));
}

/** The agent's brief fills every field of the five steps; the reviewer only checks. */
function applyAgentBrief(brief: AgentBrief): void {
  setField('title', brief.title);
  setField('slug', brief.slug || '');
  setField('product', brief.product || '');
  setField('audience', brief.audience || '');
  setField('outcome', brief.outcome || '');
  setField('tone', brief.story?.tone || '');
  pick('purpose', brief.purpose || 'overview');
  pick('lengthSec', String(brief.story?.lengthSec || 120));
  const brand = brief.brand || {};
  if (brand.mode === 'existing' && brand.id && control('brandId')) {
    pick('brandMode', 'existing');
    setField('brandId', brand.id);
  } else {
    pick('brandMode', 'new');
    setField('brandName', brand.name || brief.product || '');
    setField('brandUrl', brand.url || brief.app?.marketingUrl || '');
  }
  const app = brief.app || {};
  setField('startUrl', app.startUrl || val('shortStartUrl'));
  setField('appUrl', app.appUrl || '');
  setField('marketingUrl', app.marketingUrl || '');
  setLogin(Boolean(app.loginRequired));
  setField('email', app.loginRequired ? app.email || '' : '');
  const password = control('password');
  if (password) password.value = '';
  setField('sourcePath', app.sourcePath || '');
  setField('notes', app.notes || '');
  const story = brief.story || {};
  setField('mustShow', (story.mustShow || []).join('\n'));
  setField('keyMessages', (story.keyMessages || []).join('\n'));
  setField('mustSay', (story.mustSay || []).join('\n'));
  setField('avoid', (story.avoid || []).join('\n'));
  const proof = brief.proof || {};
  setPlates(proof.plates || []);
  setField('stats', (proof.stats || []).join('\n'));
  setField('quotes', (proof.quotes || []).join('\n'));
  setField('logos', (proof.logos || []).join('\n'));
  syncConditional();
}

/** No agent, or it failed: a rough regex draft so the reviewer is never left with empty fields. */
function fallbackDraft(reason: string): void {
  try {
    applyDraft(draftFromDescription({ description: val('description'), startUrl: val('shortStartUrl') }));
  } catch {
    /* the description was already validated; keep whatever is in the form */
  }
  showStep(0);
  showError(`${reason} The fields below were prefilled roughly from your description — check each step.`);
}

/** Draft the video: the agent deconstructs the description and fills every brief field. */
export async function draftBrief(): Promise<void> {
  const description = val('description');
  const startUrl = val('shortStartUrl');
  if (!description) return showError('Describe what to show, for whom, and about how long', 'description');
  if (!httpOk(startUrl)) return showError('Start URL must be a full http(s) URL.', 'shortStartUrl');
  clearError();
  briefCancelled = false;
  agentBrief = null;
  setDrafting(true);
  try {
    const r = await api<{ job: Job }>('/api/brief/draft', { method: 'POST', body: { description, startUrl, language: val('language') || 'en' } });
    const job = r.job;
    if (job.status === 'needs-agent') {
      fallbackDraft(job.message || 'No agent is signed in.');
      return;
    }
    briefJobId = job.id;
    set({ shortJob: job });
    const done = (await watchJob(job.id, {
      onUpdate: (j) => {
        const patch: Partial<WizardState> = { shortJob: j };
        if (j.activity) patch.shortDraftLine = j.activity;
        if (j.phase === 'tool') patch.shortDraftTitle = 'Discovering the product and brand…';
        else if (j.phase === 'writing' || j.phase === 'finishing') patch.shortDraftTitle = 'Writing the brief…';
        set(patch);
      },
    })) as Job & { brief?: AgentBrief };
    if (briefCancelled) return;
    if (!done?.brief) throw new Error('The agent finished without a brief.');
    agentBrief = done.brief;
    applyAgentBrief(done.brief);
    setDrafting(false);
    toast('Brief drafted', `${done.brief.title} · check the fields, then create the video`, 'ok');
    set({ step: 0 });
    goTo(STEPS - 1);
  } catch (err) {
    if (briefCancelled) {
      showShort();
      return;
    }
    fallbackDraft((err instanceof Error ? err.message : '') || 'The agent could not draft the brief.');
  } finally {
    briefJobId = null;
    if (wiz.getState().drafting) setDrafting(false);
  }
}

export async function cancelBriefDraft(): Promise<void> {
  briefCancelled = true;
  set({ shortDraftTitle: 'Stopping…' });
  if (briefJobId) await api(`/api/jobs/${briefJobId}/cancel`, { method: 'POST' }).catch(() => {});
}

/* ---------- creation ---------- */

function paintCreation(stage: CreateStage, detail: string): void {
  creationStage = stage;
  creation.stage(stage, detail);
}

/** Watch one job inside the creation view; the stream, live line and artifacts all follow it. */
async function follow(jobId: string, onUpdate?: (job: Job) => void): Promise<Job> {
  currentJobId = jobId;
  try {
    return await watchJob(jobId, {
      onUpdate: (job) => {
        onUpdate?.(job);
        creation.fromJob(job);
        set({ streamJob: job });
      },
    });
  } finally {
    currentJobId = null;
  }
}

const ensureNotStopped = () => {
  if (stopRequested) throw new Error(STOPPED_MESSAGE);
};

const isOpen = () => Boolean(desk.get().dialogs.project);
const guidedApi: GuidedFitApi = (path, init) => api(path, init ?? {});

interface DraftJob {
  job: Job & { kind?: string };
}

interface GuideTour {
  tour?: { steps?: number; marks?: number; activeSec?: number; idleSec?: number } | null;
}

async function create(): Promise<void> {
  commit({ nextDisabled: true, backDisabled: true, error: { ...wiz.getState().error, hidden: true }, running: true });
  creating = true;
  stopRequested = false;
  const resuming = Boolean(created);
  creation.start({ resume: resuming });
  let brandName = '';
  try {
    const p = wizardPayload();
    creation.subject(p.title || p.product || '');
    paintCreation(creationStage && creationStage !== 'ready' ? creationStage : 'project', created ? 'Resuming preparation…' : 'Pinning the brief and secure app references…');
    const r = created || (await api<ProjectCreated>('/api/projects', { method: 'POST', body: p }));
    if (!created) {
      creation.artifact(`f:${r.slug}/brief.json`, { name: `${r.slug}/brief.json`, note: 'story, audience, proof' });
      creation.artifact(`f:${r.slug}/video.config.json`, { name: `${r.slug}/video.config.json`, note: `brand ${r.brand}` });
      if (r.envVars?.length) creation.artifact('env', { name: 'kit/.env', note: `${r.envVars.length} credential refs`, kind: 'lock' });
    }
    created = r;
    creationFeed.bind(r.slug, r.brand || '');
    ensureNotStopped();
    const draft = checked('runDraft');
    const brandRef = p.brand as { id?: string; url?: string };
    if (r.needsDiscovery) {
      const host = (u: string | undefined) => {
        try {
          return new URL(u ?? '').host;
        } catch {
          return u;
        }
      };
      const site = host(brandRef.url);
      const app = host(p.app.appUrl || p.app.startUrl);
      const where = app && app !== site ? `${site} and the app at ${app}` : site;
      paintCreation('brand', `Opening ${where} in a browser to capture the lockup, palette and type…`);
      brandStudio.start(r.slug);
      const d = await api<Partial<DraftJob>>(`/api/video/${r.slug}/draft-project`, { method: 'POST', body: { step: 'discover' } });
      if (d.job?.status === 'needs-agent') throw new Error(d.job.message || 'Agent sign-in is required to discover the brand');
      const discoverJob = await follow(d.job?.id || '', (job) => {
        creation.stage('brand', job.activity || `Reading ${where}…`);
        brandStudio.fromJob(job);
      });
      ensureNotStopped();
      if (discoverJob?.status === 'needs-agent') throw new Error(discoverJob.message || 'Agent sign-in is required to discover the brand');
      if (discoverJob?.status === 'failed' || discoverJob?.status === 'cancelled') {
        throw new Error(discoverJob.message || discoverJob.activity || 'Brand discovery failed');
      }
      await brandStudio.finish();
    } else {
      brandStudio.keepFor(r.slug);
      creation.stage('brand', `Reusing the ${String(brandRef.id)} brand pack — no discovery needed`);
    }
    const prepared = await api<Pick<VideoSummary, 'brandFoundation'>>(`/api/video/${r.slug}`);
    if (!prepared.brandFoundation?.ready) {
      throw new Error(`Brand capture is incomplete: ${(prepared.brandFoundation?.issues || ['unknown brand issue']).join('; ')}`);
    }
    created.needsDiscovery = false;
    brandName = prepared.brandFoundation.name;
    creation.brand(r.slug, prepared.brandFoundation);
    creation.note(`${brandName} lockup, palette and type verified`);
    await openVideo(r.slug);
    if (draft && p.capture.mode === 'guided') {
      creation.renameStage('analyze', 'Your guided tour', 'You click through the product; every interaction is captured, idle time is not');
      const prior =
        resuming && !creation.unfinished().includes('analyze') ? await api<GuideTour>(`/api/video/${r.slug}/guide`).catch(() => null) : null;
      if (!prior?.tour?.steps) {
        if (!(await confirmGuidedFits(guidedApi, r.slug))) throw new Error('cancelled');
        paintCreation('analyze', 'A browser and a Recorder window are opening — press Start recording, show the tour, then Finish recording.');
        const a = await api<DraftJob>(`/api/video/${r.slug}/draft-project`, { method: 'POST', body: { step: 'analyze' } });
        showWizardGuide(r.slug);
        let shown: Job;
        try {
          shown = await follow(a.job.id, (job) => creation.stage('analyze', job.activity || 'Capturing your tour…'));
        } finally {
          hideWizardGuide();
        }
        ensureNotStopped();
        if (shown?.status !== 'done') {
          throw new Error(
            shown?.status === 'cancelled'
              ? STOPPED_MESSAGE
              : `${shown?.message || shown?.activity || 'The guided tour was not captured'} — Retry preparation opens the browser again.`,
          );
        }
      }
      const g = await api<GuideTour>(`/api/video/${r.slug}/guide`).catch(() => null);
      if (g?.tour && !g.tour.steps) {
        throw new Error('No clicks or typing were captured, so there is nothing to write the script from — Retry preparation and click through the product.');
      }
      creation.artifact(`f:${r.slug}/guided-tour.md`, {
        name: `${r.slug}/guided-tour.md`,
        note: g?.tour ? `${g.tour.steps} steps · ${g.tour.marks} moments · ${g.tour.activeSec}s of action` : 'your walk, step by step',
      });
      creation.artifact(`f:${r.slug}/guided-flow.mjs`, { name: `${r.slug}/guided-flow.mjs`, note: 'Replay draft of every step' });
      creation.note(g?.tour?.idleSec ? `Tour captured — ${g.tour.idleSec}s of idle time dropped` : 'Tour captured');
      ensureNotStopped();
      paintCreation('draft', `${brandName} · the agent is turning your tour into the script — detours out, selectors hardened…`);
      const j = await api<DraftJob>(`/api/video/${r.slug}/draft-project`, { method: 'POST', body: {} });
      if (j.job.status === 'needs-agent') throw new Error(j.job.message || 'Agent sign-in is required to draft');
      set({ streamJob: j.job });
      await follow(j.job.id);
      ensureNotStopped();
    } else if (draft) {
      creation.renameStage('analyze');
      paintCreation('analyze', 'The explore agent is opening the product and walking it against your goal…');
      try {
        const a = await api<DraftJob>(`/api/video/${r.slug}/draft-project`, { method: 'POST', body: { step: 'analyze' } });
        const explored = await follow(a.job.id, (job) =>
          creation.stage('analyze', job.activity || 'Exploring the product — every section first, then the strongest moments…'),
        );
        if (explored?.status === 'failed') throw new Error(explored.message || explored.activity || 'Exploration failed');
        creation.artifact(`f:${r.slug}/flow-analysis.md`, { name: `${r.slug}/flow-analysis.md`, note: 'Screens walked + DOM/canvas map' });
        if (a.job?.kind === 'improve') {
          creation.artifact(`f:${r.slug}/explore-journey.md`, { name: `${r.slug}/explore-journey.md`, note: 'Scouting report · why this order' });
        }
        creation.note('Journey decided from the live product — what to show, in order, and how to reach it');
      } catch (err) {
        // Analysis is best-effort — draft can still proceed with TODO(verify selector) guards.
        creation.note(`Product map skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
      ensureNotStopped();
      paintCreation('draft', `${brandName} mapped · the agent is writing the first script…`);
      const j = await api<DraftJob>(`/api/video/${r.slug}/draft-project`, { method: 'POST', body: {} });
      if (j.job.status === 'needs-agent') throw new Error(j.job.message || 'Agent sign-in is required to draft');
      set({ streamJob: j.job });
      await follow(j.job.id);
      ensureNotStopped();
    }
    await openVideo(r.slug);
    if (!draft) {
      // Project only, no script yet: the desk's stage bar takes over.
      toast('Project created', `${brandName} · draft the script when you are ready`, 'ok');
      finishCreation();
      return;
    }
    paintCreation('ready', `${brandName} · approve the script to record and render.`);
    let script: ScriptPayload['script'] | null = null;
    try {
      script = (await api<ScriptPayload>(`/api/video/${r.slug}/script`)).script;
    } catch {
      /* the summary card is a convenience; approval still works without it */
    }
    readySlug = r.slug;
    creationFeed.acceptScript(script);
    creation.script(script, { brandName });
    if (!isOpen()) {
      // Prepared in the background: the desk shows the video; the Script stage asks for approval.
      toast('First script ready', `${brandName} · open Script, approve it, and Studio records and renders`, 'ok');
      finishCreation();
    }
  } catch (raw) {
    const msg = failureMessage(raw, stopRequested);
    creation.fail(msg);
    brandStudio.fail(msg);
    set({ retryLabel: created ? 'Retry preparation' : 'Try again' });
    if (!isOpen()) {
      toast('New video needs attention', msg, 'ok');
      openDialog('project', true);
    }
  } finally {
    creating = false;
    set({ running: false, nextDisabled: false, nextBusy: false, backDisabled: false });
  }
}

function resetForm(): void {
  // Remount the form (its `key` is formRev) rather than form.reset(): a native reset
  // leaves React's field tracker behind, and the next render puts the old values back.
  commit({ language: 'en', languageFilter: '', lengthSec: 120, formRev: wiz.getState().formRev + 1 });
  captureBrief();
}

/** A dismissed brief is not resumed. The next New video opens on an empty launchpad. */
function freshLaunchpad(): void {
  agentBrief = null;
  settingsBrief = null;
  resetForm();
  showShort();
  commit({ step: 0, settings: false, slugDisabled: false, dialogTitle: 'New video' });
  syncConditional();
}

export function finishCreation(): void {
  readySlug = null;
  if (isOpen()) openDialog('project', false);
  resetForm();
  created = null;
  creationStage = null;
  agentBrief = null;
  creation.reset();
  creationFeed.reset();
  brandStudio.reset();
  set({ streamJob: null });
  showStep(0);
}

/** Approve the first script and start the first render: record → plates → produce → voice → deliver. */
export async function approveAndRender(): Promise<void> {
  const slug = readySlug;
  if (!slug) return;
  set({ renderBusy: true, renderDisabled: true, reviewDisabled: true });
  const note = 'Approved from the new-video flow';
  try {
    try {
      await api(`/api/video/${encodeURIComponent(slug)}/script/approve`, { method: 'POST', body: { note } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/blocking/i.test(message)) throw err;
      const force = await ask({
        title: 'Approve with blocking issues?',
        detail: `${message}\n\nThe recorder may stop at the affected step. Review script first to fix them, or approve anyway.`,
        ok: 'Approve anyway',
        tone: 'warn',
      });
      if (!force) return;
      await api(`/api/video/${encodeURIComponent(slug)}/script/approve`, { method: 'POST', body: { note, force: true } });
    }
    await openVideo(slug);
    finishCreation();
    toast('Script approved', 'Recording the app, then cutting, voicing and exporting. Watch the Render tab.', 'ok');
    requestMake('full');
  } catch (err) {
    toast('Could not approve the script', err instanceof Error ? err.message : String(err), 'err');
  } finally {
    set({ renderBusy: false, renderDisabled: false, reviewDisabled: false });
  }
}

export async function reviewScriptFirst(): Promise<void> {
  const slug = readySlug;
  finishCreation();
  if (slug) await openVideo(slug);
  void openScript();
}

/**
 * Closing the Ready view with X leaves the video open on the desk; the Script stage asks for approval.
 * Closing anything else that is not still running discards the brief, so the next open starts fresh.
 * A draft or a preparation that is still running stays, and reopening shows it.
 */
export function onDialogClosed(): void {
  // The close event fires inside the dialog's layout effect. Defer so the reset is not a flushSync mid-render.
  queueMicrotask(() => {
    if (readySlug && !creating) {
      finishCreation();
      return;
    }
    if (wiz.getState().drafting || creating || useCreation.getState().dialogCreating) return;
    freshLaunchpad();
  });
}

/* ---------- settings replan ---------- */

function rememberReplan(slug: string, stages: ReplanStage[]): { slug: string; stages: ReplanStage[] } {
  const list = [...new Set(stages.filter((s) => REPLAN_ORDER.includes(s)))];
  replanRun = { slug, stages: list.length ? list : ['planner'] };
  return replanRun;
}

const pendingFromCreationView = () => pendingFromViews(creation.unfinished());

export async function saveSettings(): Promise<void> {
  const slug = control('slug')?.value || '';
  const resuming = Boolean(replanRun?.slug === slug && replanRun.stages?.length) || useCreation.getState().dialogFailed;
  creating = true;
  stopRequested = false;
  set({ backDisabled: true });
  try {
    const p = wizardPayload();
    const plan = revisePlan(settingsBrief ?? undefined, p as unknown as ReviseBrief);
    let pending: ReplanStage[] = replanRun?.slug === slug ? [...replanRun.stages] : [];
    if (!pending.length && resuming) pending = pendingFromCreationView();
    if (plan.changed.length) {
      const saved = await api<{ plan?: { stages?: ReplanStage[] } }>(`/api/video/${encodeURIComponent(slug)}/brief`, { method: 'POST', body: p });
      settingsBrief = maskCredentials(p as unknown as ReviseBrief);
      for (const s of saved.plan?.stages || []) if (!pending.includes(s)) pending.push(s);
      // Diff may be empty of stages (e.g. only a note) — still force explore + planner.
      if (!pending.length) pending = stagesForReplan(plan);
      toast('Brief saved', `${plan.changed.map((item) => item.label).join(', ')}. Next: ${pending.join(', ')}.`, 'ok');
    } else if (!pending.length) {
      // No edits: still re-explore and redraft so the author can verify a recrafted flow.
      pending = stagesForReplan(plan);
      toast('Replanning', `No brief edits — running ${pending.join(' → ')} from the current brief.`, 'ok');
    }
    const run = rememberReplan(slug, pending);
    if (run.stages.length) {
      set({ running: true });
      creation.start({ resume: resuming });
      creationFeed.bind(slug);
      for (const stage of REPLAN_ORDER) {
        if (!run.stages.includes(stage)) continue;
        ensureNotStopped();
        const { view, detail, body } = REPLAN_STAGE[stage];
        const guided = stage === 'analyze' && p.capture.mode === 'guided';
        if (stage === 'analyze') {
          if (guided) creation.renameStage('analyze', 'Your guided tour', 'Show the journey again in the browser window');
          else creation.renameStage('analyze');
        }
        if (guided && !(await confirmGuidedFits(guidedApi, slug))) throw new Error('cancelled');
        paintCreation(view, guided ? 'A browser and a Recorder window are opening — press Start recording, show the tour again, then Finish recording.' : detail);
        const job = await api<Partial<DraftJob>>(`/api/video/${encodeURIComponent(slug)}/draft-project`, { method: 'POST', body });
        if (job.job?.status === 'needs-agent') throw new Error(job.job.message || 'Agent sign-in is required to redraft');
        if (job.job?.id) {
          if (guided) showWizardGuide(slug);
          const finished = await follow(job.job.id).finally(() => {
            if (guided) hideWizardGuide();
          });
          if (finished?.status === 'needs-agent') throw new Error(finished.message || 'Agent sign-in is required to redraft');
          if (finished?.status === 'failed' || finished?.status === 'cancelled') {
            throw new Error(finished.message || finished.activity || 'Preparation stopped');
          }
        }
        ensureNotStopped();
        run.stages = run.stages.filter((s) => s !== stage);
      }
    }
    replanRun = null;
    creation.reset();
    creationFeed.reset();
    set({ streamJob: null });
    if (isOpen()) openDialog('project', false);
    commit({ slugDisabled: false, dialogTitle: 'New video', settings: false });
    await openVideo(slug);
    void openScript();
  } catch (raw) {
    const msg = failureMessage(raw, stopRequested);
    const c = useCreation.getState();
    if (c.dialogCreating || c.dialogFailed) {
      if (!replanRun?.stages?.length) rememberReplan(slug, pendingFromCreationView());
      creation.fail(msg);
      set({ retryLabel: 'Retry preparation' });
      if (!isOpen()) {
        toast('Replan needs attention', msg, 'ok');
        openDialog('project', true);
      }
    } else toast('Could not save the brief', msg, 'err');
  } finally {
    creating = false;
    set({ running: false, nextBusy: false, nextDisabled: false, backDisabled: false });
  }
}

/* ---------- opening ---------- */

type BrandRow = { id: string; name: string; placeholder?: boolean; accent?: string | null; colors?: BrandPack['colors']; font?: string | null };

const packsOf = (rows: BrandRow[]): BrandPack[] =>
  rows.map((b) => ({ id: b.id, name: b.name, accent: b.accent || null, colors: b.colors || {}, font: b.font || null, placeholder: Boolean(b.placeholder) }));

function fillFromBrief(brief: ReviseBrief, slug: string, freshness: VideoSummary['freshness'] | null = null): void {
  const fresh = freshness as unknown as Parameters<typeof maskCredentials>[1];
  const masked = maskCredentials(brief || {}, fresh);
  settingsBrief = masked;
  setField('title', masked.title || '');
  commit({ language: resolveVideoLanguage(masked.language).code, languageFilter: '', slugDisabled: true });
  setField('product', masked.product || '');
  setField('audience', masked.audience || '');
  setField('outcome', masked.outcome || '');
  setField('tone', masked.tone || '');
  setField('slug', slug);
  pick('purpose', masked.purpose || 'overview');
  pick('lengthSec', String(masked.lengthSec || 120));
  setField('startUrl', masked.app?.startUrl || '');
  setField('appUrl', masked.app?.appUrl || '');
  setField('marketingUrl', masked.app?.marketingUrl || '');
  setField('sourcePath', masked.app?.sourcePath || '');
  setField('notes', masked.app?.notes || '');
  const email = control('email');
  if (email) email.value = '';
  const password = control('password');
  if (password) password.value = '';
  setLogin(Boolean(masked.app?.loginRequired) || hasStoredCredentials(masked, fresh));
  const lines = (v: unknown) => (Array.isArray(v) ? v.join('\n') : '');
  setField('mustShow', lines(masked.story?.mustShow));
  pick('captureMode', masked.capture?.mode === 'guided' ? 'guided' : 'agent');
  setField('keyMessages', lines(masked.story?.keyMessages));
  setField('mustSay', lines(masked.story?.mustSay));
  setField('avoid', lines(masked.story?.avoid));
  setField('stats', lines(masked.proof?.stats));
  setField('quotes', lines(masked.proof?.quotes));
  setField('logos', lines(masked.proof?.logos));
  setPlates(masked.proof?.plates || []);
  if (masked.brand?.id && control('brandId')) setField('brandId', masked.brand.id);
  pick('brandMode', 'existing');
  syncConditional();
}

function resetCreationIfStale(): void {
  created = null;
  creationStage = null;
  replanRun = null;
  creation.reset();
  creationFeed.reset();
  brandStudio.reset();
  set({ streamJob: null });
}

export async function openProjectSettings(video: VideoSummary | null | undefined = desk.get().video): Promise<void> {
  if (!video?.slug) return;
  if (creating || wiz.getState().drafting) {
    openDialog('project', true);
    return;
  }
  if (useCreation.getState().dialogCreating) {
    // A stopped preparation is still on screen. For this video it stays: Retry picks it up.
    if (created?.slug === video.slug || replanRun?.slug === video.slug) {
      openDialog('project', true);
      return;
    }
    resetCreationIfStale();
  }
  try {
    const { brands } = await api<{ brands: BrandRow[] }>('/api/brands');
    commit({
      brands: brands.length ? brands.map((b) => ({ value: b.id, label: b.name })) : [{ value: '', label: 'No brand packs yet', disabled: true }],
      brandPacks: packsOf(brands),
    });
    resetSelection('brandId');
  } catch {
    /* keep the current options */
  }
  commit({ mode: 'settings', dialogTitle: 'Project settings', settings: true });
  // Refetch so a just-saved loginRequired / envVars is not missing from a stale desk payload.
  let brief: VideoSummary['brief'] = video.brief;
  let freshness: VideoSummary['freshness'] | null = video.freshness;
  try {
    const fresh = await api<Partial<VideoSummary>>(`/api/video/${encodeURIComponent(video.slug)}`);
    if (fresh?.brief) brief = fresh.brief;
    if (fresh?.freshness) freshness = fresh.freshness;
  } catch {
    /* use the desk copy */
  }
  fillFromBrief(
    (brief as unknown as ReviseBrief) || { title: video.title, audience: video.audience, app: { startUrl: freshness?.startUrl || '' } },
    video.slug,
    freshness,
  );
  showStep(0);
  openDialog('project', true);
}

export async function openProjectNew(): Promise<void> {
  if (creating || wiz.getState().drafting || useCreation.getState().dialogCreating) {
    openDialog('project', true);
    return;
  }
  // A brief that finished while this dialog was closed is resumed below. Anything else starts blank.
  const resume = agentBrief;
  if (!resume) freshLaunchpad();
  else commit({ slugDisabled: false, dialogTitle: 'New video', settings: false });
  try {
    const { brands } = await api<{ brands: BrandRow[] }>('/api/brands');
    commit({
      brands: brands.length
        ? brands.map((b) => ({ value: b.id, label: `${b.name}${b.placeholder ? ' (placeholder)' : ''}` }))
        : [{ value: '', label: 'No brand packs yet — discover one', disabled: true }],
      brandPacks: packsOf(brands),
    });
  } catch {
    commit({ brands: [{ value: '', label: 'Could not load brand packs', disabled: true }], brandPacks: [] });
  }
  resetSelection('brandId');
  // A brief the agent finished while the dialog was closed is still in the form: resume at Review.
  if (resume) {
    if (resume.brand?.mode === 'existing' && resume.brand.id && control('brandId')) setField('brandId', resume.brand.id);
    set({ step: 0 });
    goTo(STEPS - 1);
  } else showShort();
  syncConditional();
  resetCreationIfStale();
  openDialog('project', true);
}

/* ---------- footer ---------- */

export function next(): void {
  const { mode, step, drafting } = wiz.getState();
  if (mode === 'short') {
    if (!drafting) void draftBrief();
    return;
  }
  const err = validate(step, reader);
  if (err) return showError(...err);
  if (step === STEPS - 1) {
    set({ nextBusy: true });
    if (mode === 'settings') void saveSettings();
    else void create();
  } else showStep(step + 1);
}

export function back(): void {
  const { drafting, step, mode } = wiz.getState();
  if (drafting) {
    void cancelBriefDraft();
    return;
  }
  if (useCreation.getState().dialogCreating) {
    creation.exit();
    showStep(STEPS - 1);
    return;
  }
  if (step === 0 && mode !== 'settings') {
    showShort();
    return;
  }
  showStep(step - 1);
}

/** After a stop or failure: run the same preparation again, resuming where it got to. */
export function retry(): void {
  if (creating) return;
  set({ error: { ...wiz.getState().error, hidden: true }, nextBusy: true });
  if (wiz.getState().mode === 'settings') {
    const slug = control('slug')?.value;
    if (slug && !replanRun?.stages?.length) rememberReplan(slug, pendingFromCreationView());
    void saveSettings();
  } else void create();
}

/** Back to the Review step with the brief intact — change it, then Save / Create runs again. */
export function editBrief(): void {
  if (creating) return;
  creation.exit();
  showStep(STEPS - 1);
}

export async function stop(): Promise<void> {
  // After a failure the Stop control is hidden; if it is still used, keep the resume list and go edit.
  if (!creating) {
    const slug = control('slug')?.value;
    if (wiz.getState().mode === 'settings' && slug && !replanRun?.stages?.length) rememberReplan(slug, pendingFromCreationView());
    creation.exit();
    showStep(STEPS - 1);
    return;
  }
  stopRequested = true;
  set({ stopDisabled: true, stopLabel: 'Stopping…' });
  try {
    if (currentJobId) await api(`/api/jobs/${currentJobId}/cancel`, { method: 'POST' });
  } catch {
    /* the job may have just finished */
  } finally {
    set({ stopDisabled: false, stopLabel: 'Stop' });
  }
}

/** A click inside the form: `[data-goto]` summary edits and "Fill each field instead". */
export function onFormClick(target: Element): void {
  const go = target.closest<HTMLElement>('[data-goto]');
  if (go) {
    if (go.dataset.goto === 'short') showShort();
    else showStep(Number(go.dataset.goto));
  }
  if (target.closest('[data-full-brief]') && !wiz.getState().drafting) showStep(0);
}

/** Enter in a single-line field advances, as the legacy form did. */
export function onFormKeyDown(e: KeyboardEvent): void {
  const t = e.target;
  if (
    e.key === 'Enter' &&
    t instanceof HTMLInputElement &&
    t.matches('input:not([type=checkbox]):not([type=radio])') &&
    !t.classList.contains('sel-search') &&
    !t.classList.contains('lang-filter')
  ) {
    e.preventDefault();
    next();
  }
}
