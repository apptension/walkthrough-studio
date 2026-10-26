import { create as createStore } from 'zustand';

import { clampLengthSec, lengthFromText } from '@/logic/length';

/* ---------- the one-description launchpad ---------- */

export interface DescriptionSignals {
  /** Who watches, as written ("new admins"); '' when the text names no one. */
  audience: string;
  /** The text says what to show or teach. */
  goal: boolean;
  lengthSec: number | null;
  /** Rough count of the moments to show ("…, then …, then …"). */
  beats: number;
  words: number;
  /** 0–4: audience, goal, length, two or more beats. */
  score: number;
}

const AUDIENCE =
  /\b((?:new|first-time|existing|busy|enterprise|non-technical|technical|potential|prospective|internal|our|small[- ]business)\s+)?(admins?|administrators?|users?|customers?|managers?|developers?|engineers?|buyers?|prospects?|teams?|owners?|recruiters?|designers?|marketers?|stakeholders?|visitors?|members?|hires?|investors?|leads?|founders?|operators?|clients?|students?|agents?|teammates?|readers?|viewers?|executives?|planners?)\b/i;
const GOAL = /\b(how to|how (?:a|an|the|they|you)\b|shows?|showing|walks? through|explains?|demos?|introduces?|invites?|sets? ?up|creates?|launch(?:es)?|tour|spotlights?|opens?|onboard|teach(?:es)?|highlights?|compares?|finds?|browse|plans?)\b/i;
/** What the agent can already read from a description — the launchpad's live checklist. */
export function descriptionSignals(text: string): DescriptionSignals {
  const flat = text.replace(/\s+/g, ' ').trim();
  const words = flat ? flat.split(' ').length : 0;
  const who = flat.match(AUDIENCE);
  const audience = who ? `${who[1] || ''}${who[2] || ''}`.trim().toLowerCase() : '';
  const goal = words >= 3 && GOAL.test(flat);
  const lengthSec = lengthFromText(flat);
  const joins = (text.match(/\bthen\b|\bafter that\b|\bfinally\b|;|\n\s*(?:[-•*]|\d+[.)])/gi) || []).length;
  const beats = words < 4 ? 0 : Math.min(9, 1 + joins);
  const score = [Boolean(audience), goal, lengthSec != null, beats >= 2].filter(Boolean).length;
  return { audience, goal, lengthSec, beats, words, score };
}

export function lengthLabel(sec: number | null | undefined): string {
  if (!sec) return '';
  if (sec < 60) return `${sec}s`;
  const min = sec / 60;
  return `${Number.isInteger(min) ? min : min.toFixed(1)} min`;
}

/** `https://app.acme.com/x` → `app.acme.com`; '' unless it is a full http(s) URL. */
export function hostOf(url: string): string {
  try {
    const u = new URL(url.trim());
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.host : '';
  } catch {
    return '';
  }
}

export interface BriefExample {
  id: string;
  icon: string;
  label: string;
  text: string;
}

export const BRIEF_EXAMPLES: readonly BriefExample[] = [
  {
    id: 'onboarding',
    icon: 'ui-walk',
    label: 'Onboarding how-to',
    text: 'Show new admins how to invite a teammate in about a minute, then where they set who can edit projects, and finish on the teammate landing in the workspace.',
  },
  {
    id: 'feature',
    icon: 'ui-sparkle',
    label: 'Feature spotlight',
    text: 'A 90 second spotlight for existing customers on the new reporting dashboard: open it from the sidebar, filter by team, then export the chart to share with stakeholders.',
  },
  {
    id: 'sales',
    icon: 'ui-target',
    label: 'Sales demo',
    text: 'A two minute demo for prospects evaluating us: the problem with spreadsheets, then planning a project in the scheduler, then the utilisation report that proves it saves time.',
  },
];

/* ---------- purposes ---------- */

export interface PurposeInfo {
  value: string;
  label: string;
  name: string;
  icon: string;
  spine: readonly string[];
  blurb: string;
}

export const PURPOSES: readonly PurposeInfo[] = [
  { value: 'overview', label: 'Product overview', name: 'Overview', icon: 'ui-film', spine: ['Problem', 'Promise', 'Proof', 'Path', 'Payoff'], blurb: 'The whole product in one story' },
  { value: 'feature', label: 'Feature spotlight', name: 'Feature', icon: 'ui-sparkle', spine: ['Before', 'After', 'Bridge'], blurb: 'One capability, before and after' },
  { value: 'onboarding', label: 'Onboarding / how-to', name: 'Onboarding', icon: 'ui-walk', spine: ['Goal', 'Map', 'Steps', 'First win'], blurb: 'Step by step to a first win' },
  { value: 'launch', label: 'Release / launch', name: 'Launch', icon: 'ui-bulb', spine: ['Shift', "What's new", 'Why now', 'Try it'], blurb: 'What changed and why it matters' },
  { value: 'sales', label: 'Sales demo', name: 'Sales demo', icon: 'ui-target', spine: ['Problem', 'Agitate', 'Solve', 'Prove', 'Ask'], blurb: 'Pain, solution, proof, ask' },
];

export function purposeInfo(value: string): PurposeInfo {
  return PURPOSES.find((p) => p.value === value) || PURPOSES[0]!;
}

/* ---------- the live brief preview ---------- */

export interface BriefSnapshot {
  title: string;
  product: string;
  audience: string;
  outcome: string;
  purpose: string;
  lengthSec: number;
  tone: string;
  language: string;
  brandMode: 'existing' | 'new';
  brandId: string;
  brandName: string;
  brandUrl: string;
  startUrl: string;
  loginRequired: boolean;
  captureMode: 'agent' | 'guided';
  chapters: string[];
  keyMessages: string[];
  plates: string[];
}

export const EMPTY_BRIEF: BriefSnapshot = {
  title: '',
  product: '',
  audience: '',
  outcome: '',
  purpose: 'overview',
  lengthSec: 120,
  tone: '',
  language: 'en',
  brandMode: 'existing',
  brandId: '',
  brandName: '',
  brandUrl: '',
  startUrl: '',
  loginRequired: false,
  captureMode: 'agent',
  chapters: [],
  keyMessages: [],
  plates: [],
};

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** "Invite a teammate — why · how: click…" → "Invite a teammate". */
export function chapterTitle(line: string): string {
  return line.replace(/^[-•*\d.)\s]+/, '').split(/\s+[—–-]\s+|\s+·\s+|\bhow:/)[0]!.trim();
}

type Values = { get(name: string): string; checked(name: string, value?: string): boolean; all(name: string): string[] };

export function snapshotFrom(v: Values): BriefSnapshot {
  return {
    title: v.get('title'),
    product: v.get('product'),
    audience: v.get('audience'),
    outcome: v.get('outcome'),
    purpose: v.all('purpose')[0] || 'overview',
    lengthSec: clampLengthSec(v.all('lengthSec')[0] || v.get('lengthSec')),
    tone: v.get('tone'),
    language: v.get('language') || 'en',
    brandMode: v.all('brandMode')[0] === 'new' ? 'new' : 'existing',
    brandId: v.get('brandId'),
    brandName: v.get('brandName'),
    brandUrl: v.get('brandUrl'),
    startUrl: v.get('startUrl'),
    loginRequired: v.checked('loginRequired'),
    captureMode: v.all('captureMode')[0] === 'guided' ? 'guided' : 'agent',
    chapters: lines(v.get('mustShow')).map(chapterTitle).filter(Boolean),
    keyMessages: lines(v.get('keyMessages')),
    plates: v.all('plates'),
  };
}

export interface BriefCheck {
  id: string;
  label: string;
  done: boolean;
  step: number;
  field: string;
}

/** What makes a brief the agent can write well from, in step order. */
export function briefChecks(b: BriefSnapshot): BriefCheck[] {
  return [
    { id: 'title', label: 'Give it a title', done: Boolean(b.title), step: 0, field: 'title' },
    { id: 'audience', label: 'Say who watches', done: Boolean(b.audience), step: 0, field: 'audience' },
    { id: 'outcome', label: 'Name the outcome', done: Boolean(b.outcome), step: 0, field: 'outcome' },
    {
      id: 'brand',
      label: 'Pick a brand',
      done: b.brandMode === 'new' ? Boolean(b.brandName || b.brandUrl || b.startUrl) : Boolean(b.brandId),
      step: 0,
      field: b.brandMode === 'new' ? 'brandName' : 'brandId',
    },
    { id: 'start', label: 'Add the start URL', done: Boolean(hostOf(b.startUrl)), step: 1, field: 'startUrl' },
    { id: 'chapters', label: 'List what to show', done: b.captureMode === 'guided' || b.chapters.length > 0, step: 2, field: 'mustShow' },
    { id: 'messages', label: 'Add a key message', done: b.keyMessages.length > 0, step: 2, field: 'keyMessages' },
  ];
}

function formValues(form: HTMLFormElement): Values {
  return {
    get: (name) => {
      const el = form.elements.namedItem(name);
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el.value.trim() : '';
    },
    checked: (name) => Boolean(form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)),
    all: (name) => [...form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map((i) => i.value),
  };
}

export const useBriefLive = createStore<{ brief: BriefSnapshot }>()(() => ({ brief: EMPTY_BRIEF }));

let frame = 0;

/** Re-read `#projectForm` into the preview on the next frame (fields are uncontrolled). */
export function captureBrief(): void {
  if (frame) return;
  const run = () => {
    frame = 0;
    const form = document.getElementById('projectForm');
    if (form instanceof HTMLFormElement) useBriefLive.setState({ brief: snapshotFrom(formValues(form)) });
  };
  if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(run);
  else run();
}
