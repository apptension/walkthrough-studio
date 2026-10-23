import { revisePlan, stagesForReplan, type Brief as ReviseBrief, type ReplanStage } from '@/logic/briefRevise';
import { sizeLine, type CaptureOption } from '@/logic/captureSize';
import { resolveVideoLanguage, videoLanguage } from '@/logic/languages';

/**
 * The brief form's pure half (`validate`, `payload`, `renderSummary`,
 * `captureChoice` in `kit/studio/projects.js`). The fields stay in the DOM as
 * the legacy form kept them; a `FormReader` is the `val` / `checked` / `radio`
 * trio the legacy closure used.
 */

export const STEPS = 5;

export interface FormReader {
  /** Trimmed value of a named control, '' when missing. */
  val(name: string): string;
  /** Untrimmed value (the password is sent as typed). */
  raw(name: string): string;
  checked(name: string): boolean;
  radio(name: string): string;
  /** Values of the checked boxes sharing a name. */
  checkedValues(name: string): string[];
}

/** A `/api/capture/options` row. */
export interface WizardCaptureOption extends CaptureOption {
  dpr: number;
  reason?: string;
}

export function httpOk(s: string): boolean {
  try {
    return /^https?:$/.test(new URL(s).protocol);
  } catch {
    return false;
  }
}

/** Per-step validation; returns [message, fieldName] or null. */
export function validate(n: number, f: FormReader): [string, string] | null {
  const url = httpOk;
  if (n === 0) {
    if (!f.val('title')) return ['Give the video a title.', 'title'];
    if (f.val('slug') && !/^[a-z0-9-]+$/.test(f.val('slug'))) return ['Slug: lowercase letters, digits and dashes only.', 'slug'];
    if (!f.val('audience')) return ['Say who watches — the agent writes for them.', 'audience'];
    if (f.radio('brandMode') === 'new') {
      if (!f.val('brandName')) return ['Name the new brand.', 'brandName'];
      const site = f.val('brandUrl') || f.val('marketingUrl') || f.val('appUrl') || f.val('startUrl');
      if (f.val('brandUrl') && !url(f.val('brandUrl'))) return ['Brand website must be a full https:// URL.', 'brandUrl'];
      if (!url(site)) return ['Give a brand website, or a start URL in App access — discovery reads the brand from the live app.', 'brandUrl'];
    } else if (!f.val('brandId')) return ['Pick a brand pack, or discover a new one.', 'brandId'];
  }
  if (n === 0 && !videoLanguage(f.val('language'))) return ['Choose a video language.', 'language'];
  if (n === 1) {
    if (!url(f.val('startUrl'))) return ['Start URL must be a full https:// URL.', 'startUrl'];
    for (const k of ['appUrl', 'marketingUrl']) {
      if (f.val(k) && !url(f.val(k))) return [`${k === 'appUrl' ? 'App' : 'Marketing'} URL must be a full https:// URL.`, k];
    }
  }
  if (n === 2 && !f.val('mustShow') && f.radio('captureMode') !== 'guided') {
    return ['List what the tour should show — one item per line. Or pick “I’ll show it” and walk it yourself.', 'mustShow'];
  }
  return null;
}

export type CaptureChoice = { preset: 'screen'; width: number; height: number; dpr: number } | { preset: string };

export function captureChoice(options: WizardCaptureOption[], presetId: string): CaptureChoice | null {
  const o = options.find((x) => x.id === presetId);
  if (!o) return null;
  return o.id === 'screen' ? { preset: 'screen', width: o.width, height: o.height, dpr: o.dpr } : { preset: o.id };
}

export interface WizardPayload {
  title: string;
  language: string;
  slug: string | undefined;
  product: string;
  audience: string;
  outcome: string;
  purpose: string;
  brand: { mode: 'new'; name: string; url: string } | { mode: 'existing'; id: string };
  app: {
    startUrl: string;
    appUrl: string;
    marketingUrl: string;
    loginRequired: boolean;
    sourcePath: string;
    notes: string;
    email?: string;
    password?: string;
  };
  capture: { mode: 'guided' | 'agent'; size?: CaptureChoice };
  output?: { format: 'portrait' | 'landscape' };
  story: { lengthSec: number; tone: string; mustShow: string; keyMessages: string; mustSay: string; avoid: string };
  proof: { plates: string[]; stats: string; quotes: string; logos: string };
}

/** `payload()`. Size and shape of an existing video change under Direction → Recording size, so only a new project sends them. */
export function payload(f: FormReader, { newProject, capture }: { newProject: boolean; capture: CaptureChoice | null }): WizardPayload {
  const isNew = f.radio('brandMode') === 'new';
  const login = f.checked('loginRequired');
  return {
    title: f.val('title'),
    language: f.val('language') || 'en',
    slug: f.val('slug') || undefined,
    product: f.val('product'),
    audience: f.val('audience'),
    outcome: f.val('outcome'),
    purpose: f.radio('purpose') || 'overview',
    brand: isNew
      ? { mode: 'new', name: f.val('brandName'), url: f.val('brandUrl') || f.val('marketingUrl') || f.val('appUrl') || f.val('startUrl') }
      : { mode: 'existing', id: f.val('brandId') },
    app: {
      startUrl: f.val('startUrl'),
      appUrl: f.val('appUrl'),
      marketingUrl: f.val('marketingUrl'),
      loginRequired: login,
      sourcePath: f.val('sourcePath'),
      notes: f.val('notes'),
      // Only send credentials when the reviewer typed a replacement — blank keeps kit/.env.
      ...(login && f.val('email') ? { email: f.val('email') } : {}),
      ...(login && f.raw('password') ? { password: f.raw('password') } : {}),
    },
    capture: { mode: f.radio('captureMode') === 'guided' ? 'guided' : 'agent', ...(newProject && capture ? { size: capture } : {}) },
    ...(newProject ? { output: { format: f.val('outputFormat') === 'portrait' ? 'portrait' : 'landscape' } } : {}),
    story: {
      lengthSec: Number(f.radio('lengthSec') || 120),
      tone: f.val('tone'),
      mustShow: f.val('mustShow'),
      keyMessages: f.val('keyMessages'),
      mustSay: f.val('mustSay'),
      avoid: f.val('avoid'),
    },
    proof: {
      plates: f.checkedValues('plates'),
      stats: f.val('stats'),
      quotes: f.val('quotes'),
      logos: f.val('logos'),
    },
  };
}

/** What the agent's `/api/brief/draft` job returns as `job.brief`. */
export interface AgentBrief {
  title: string;
  slug?: string;
  product?: string;
  audience?: string;
  outcome?: string;
  purpose?: string;
  language?: string;
  confidence?: string;
  assumptions?: string[];
  questions?: string[];
  brand?: { mode?: string; id?: string; name?: string; url?: string };
  app?: { startUrl?: string; appUrl?: string; marketingUrl?: string; loginRequired?: boolean; email?: string; sourcePath?: string; notes?: string };
  story?: { tone?: string; lengthSec?: number; mustShow?: string[]; keyMessages?: string[]; mustSay?: string[]; avoid?: string[] };
  proof?: { plates?: string[]; stats?: string[]; quotes?: string[]; logos?: string[] };
}

export type SummaryStep = number | 'short';

export interface SummaryGroup {
  title: string;
  step: SummaryStep;
  rows: Array<[string, string | null | undefined]>;
}

const CONFIDENCE: Record<string, string> = {
  high: 'High — the description covered most of it',
  medium: 'Medium — a few fields are inferred',
  low: 'Low — check every step',
};

/** `renderSummary()` — the Review step's groups. */
export function summaryGroups(
  p: WizardPayload,
  {
    brandLabel,
    purposeLabel,
    captureOptions,
    agentBrief,
    settings,
    settingsBrief,
  }: {
    brandLabel: string;
    purposeLabel: string;
    captureOptions: WizardCaptureOption[];
    agentBrief: AgentBrief | null;
    settings: boolean;
    settingsBrief: ReviseBrief | null;
  },
): SummaryGroup[] {
  const show = p.story.mustShow
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const brandName = p.brand.mode === 'new' ? p.brand.name : brandLabel || p.brand.id;
  const recordedAt = (() => {
    const preset = p.capture.size?.preset;
    const o = captureOptions.find((x) => x.id === preset);
    const shape = p.output?.format === 'portrait' ? 'vertical 9:16 video' : 'landscape 16:9 video';
    return o ? `${o.label.split(' · ')[0]} · ${sizeLine(o)} — ${shape}` : null;
  })();
  const groups: SummaryGroup[] = [
    {
      title: 'Video',
      step: 0,
      rows: [
        ['Title', p.title],
        ['Language', resolveVideoLanguage(p.language).name],
        ['Audience', p.audience],
        ['Outcome', p.outcome],
        ['Story', purposeLabel || p.purpose],
        ['Length · tone', `~${Math.round((p.story.lengthSec / 60) * 10) / 10} min${p.story.tone ? ` · ${p.story.tone}` : ''}`],
        ['Brand', p.brand.mode === 'new' ? `${brandName} — discovered from ${p.brand.url}` : brandName],
      ],
    },
    {
      title: 'App access',
      step: 1,
      rows: [
        ['Starts at', p.app.startUrl],
        ['Sign-in', p.app.loginRequired ? (p.app.email ? `Demo account · ${p.app.email}` : 'Yes — add credentials to kit/.env') : 'Not needed'],
        ['Source', p.app.sourcePath],
        ['Recorded at', recordedAt],
      ],
    },
    {
      title: 'Story',
      step: 2,
      rows: [
        [
          'Journey',
          p.capture.mode === 'guided' ? 'You show it — a browser opens after the brand, then a bot re-records your walk' : 'The explore agent walks the product',
        ],
        ['Chapters', show.length ? show.map((s, i) => `${i + 1}. ${s}`).join('\n') : p.capture.mode === 'guided' ? 'From the moments you mark' : ''],
        ['Key messages', p.story.keyMessages],
      ],
    },
    {
      title: 'Proof',
      step: 3,
      rows: [['Plates', p.proof.plates.map((x) => (x[0] ?? '').toUpperCase() + x.slice(1)).join(', ') || 'None — open and close only']],
    },
  ];
  if (agentBrief && !settings) {
    groups.push({
      title: 'Drafted from your description',
      step: 'short',
      rows: [
        ['Confidence', CONFIDENCE[agentBrief.confidence || ''] || CONFIDENCE.medium],
        ['Assumptions', (agentBrief.assumptions || []).map((s) => `• ${s}`).join('\n') || 'None noted'],
        ['Open questions', (agentBrief.questions || []).map((s) => `• ${s}`).join('\n') || 'None'],
      ],
    });
  }
  if (settings && settingsBrief) {
    const plan = revisePlan(settingsBrief, p as unknown as ReviseBrief);
    const rerun = stagesForReplan(plan);
    groups.push({
      title: 'This save',
      step: 4,
      rows: [
        ['Changed', plan.changed.map((item) => item.label).join(', ') || 'Nothing'],
        ['Rerun', plan.stages.length ? rerun.join(', ') : `${rerun.join(', ')} — forced (no edits; re-explore and redraft)`],
        ['Footage', plan.needsRecord ? 'Re-record before the next render' : 'Keep the current take'],
      ],
    });
  }
  return groups;
}

/** Preparation stages a brief save asked for, in pipeline order; shrinks as each one finishes so Retry resumes. */
export const REPLAN_ORDER: readonly ReplanStage[] = ['discover', 'analyze', 'planner'];

export const REPLAN_STAGE: Record<ReplanStage, { view: 'brand' | 'analyze' | 'draft'; detail: string; body: Record<string, string> }> = {
  discover: { view: 'brand', detail: 'Re-reading the brand from the site and the app…', body: { step: 'discover' } },
  analyze: { view: 'analyze', detail: 'The explore agent is walking the product again and rewriting the journey…', body: { step: 'analyze' } },
  planner: { view: 'draft', detail: 'The agent is rewriting the script from your changes…', body: {} },
};

export const VIEW_TO_REPLAN: Partial<Record<string, ReplanStage>> = { brand: 'discover', analyze: 'analyze', draft: 'planner' };

/** Rebuild a resume list from the creation view's unfinished stages. */
export function pendingFromViews(unfinished: string[]): ReplanStage[] {
  const fromView = unfinished.map((v) => VIEW_TO_REPLAN[v]).filter((s): s is ReplanStage => Boolean(s));
  const ordered = REPLAN_ORDER.filter((s) => fromView.includes(s));
  return ordered.length ? ordered : ['planner'];
}

export const STOPPED_MESSAGE = 'Stopped. The brief is saved — retry when ready.';

/** The message a stopped or failed preparation shows. */
export function failureMessage(raw: unknown, stopRequested: boolean): string {
  if (stopRequested) return STOPPED_MESSAGE;
  const text = raw instanceof Error ? raw.message || raw.toString() : typeof raw === 'string' ? raw : '';
  if (/^(cancelled|canceled)$/i.test(text.trim())) return STOPPED_MESSAGE;
  return text;
}

/** The Review step's last button label. */
export function lastStepLabel({ settings, replanPending, created, runDraft }: { settings: boolean; replanPending: boolean; created: boolean; runDraft: boolean }): string {
  if (settings) return replanPending ? 'Save and resume' : 'Save and replan';
  if (created) return 'Retry preparation';
  return runDraft ? 'Create & draft' : 'Create project';
}

export const MUST_SHOW_PLACEHOLDER =
  'Team capacity — see who is free this week · how: click “People” in the left sidebar → hover a capacity bar\nPlan a project — book people in two clicks · how: click “Projects” in the left sidebar → drag across the timeline\nShare the view — keep clients in the loop · how: click “Share” in the top bar';

export const MUST_SHOW_GUIDED_PLACEHOLDER =
  'Optional — notes for your walk, e.g. “Lead with the capacity view; end on sharing”.\nYou will show the actual journey in the browser.';

export const PROJECT_DIALOG_SUB_NEW = 'The agent drafts the script from this brief. Nothing is recorded until you approve it.';
export const PROJECT_DIALOG_SUB_SETTINGS = 'Edit the brief, then save to replan the script from your changes.';

const CAPTURE_GROUPS: Record<string, string> = { desktop: 'Desktop & laptop', laptop: 'Desktop & laptop', tablet: 'Tablet', phone: 'Phone' };

/** `fillCaptureOptions()` — options grouped by device, widest first. */
export function captureGroups(options: readonly WizardCaptureOption[]): Array<[string, WizardCaptureOption[]]> {
  const byGroup = new Map<string, WizardCaptureOption[]>();
  for (const o of options) {
    const g = CAPTURE_GROUPS[o.group ?? ''] || 'Desktop & laptop';
    const list = byGroup.get(g) ?? [];
    list.push(o);
    byGroup.set(g, list);
  }
  return [...byGroup].map(([g, list]) => [g, [...list].sort((a, b) => b.width - a.width)]);
}
