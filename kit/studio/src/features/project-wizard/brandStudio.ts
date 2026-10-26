import { create } from 'zustand';

import type { Job, JobStreamEntry } from '@/api/types';
import { api, enc } from '@/desk/api';

/**
 * The brand creator shown while discovery runs: the harvest's own progress lines plus a
 * polled snapshot of the brand pack on disk (`GET /brand-draft`). Nothing here is
 * estimated — a stage is done when its file or field exists. The reviewer's logo pick and
 * palette tweaks are saved as they happen and folded in once the agent has authored the pack.
 */

export const BRAND_ROLES = ['ink', 'surface', 'gold', 'amber', 'teal'] as const;
export type BrandRole = (typeof BRAND_ROLES)[number];

export const ROLE_META: Record<BrandRole, { label: string; hint: string }> = {
  ink: { label: 'Ink', hint: 'Plate background' },
  surface: { label: 'Surface', hint: 'Cards and panels' },
  gold: { label: 'Accent', hint: 'Primary brand colour' },
  amber: { label: 'Accent 2', hint: 'Gradient partner' },
  teal: { label: 'Support', hint: 'Cool third tone' },
};

export interface BrandCandidate {
  file: string;
  kind: string;
  alt: string;
  w: number;
  h: number;
  href: string;
}

export interface BrandDraft {
  brand: string;
  name: string;
  platform: string;
  status: string;
  placeholder: boolean;
  ready: boolean;
  issues: string[];
  harvested: boolean;
  site: { url: string; headline: string; sub: string } | null;
  candidates: BrandCandidate[];
  hints: string[];
  colors: Partial<Record<BrandRole, string>>;
  font: { family: string; css: string } | null;
  lockup: { rev: number; svg: boolean } | null;
  logoSource: string | null;
  motionBrief: { title: string; excerpt: string } | null;
  choices: { colors: Partial<Record<BrandRole, string>>; logo: string | null };
}

export interface HarvestSignals {
  opening: string;
  siteRead: boolean;
  headline: string;
  appRead: boolean;
  collected: number | null;
  saved: number;
  stubWritten: boolean;
  handedOff: boolean;
  packReady: boolean;
  error: string;
}

export const DISCOVERY_ORDER = ['site', 'candidates', 'lockup', 'palette', 'type', 'motion', 'validate'] as const;
export type DiscoveryStageId = (typeof DISCOVERY_ORDER)[number];
export type StageState = 'pending' | 'active' | 'done' | 'failed';
export type BrandPhase = 'idle' | 'discovering' | 'failed' | 'ready';

export interface DiscoveryStage {
  id: DiscoveryStageId;
  title: string;
  note: string;
  state: StageState;
}

const TITLES: Record<DiscoveryStageId, string> = {
  site: 'Harvesting the site',
  candidates: 'Candidate logos',
  lockup: 'Official lockup',
  palette: 'Five-colour palette',
  type: 'Typeface',
  motion: 'Motion brief',
  validate: 'Validation',
};

const AGENT_STAGES: DiscoveryStageId[] = ['lockup', 'palette', 'type', 'motion'];
const HEX = /^#[0-9a-f]{6}$/i;

export const emptySignals = (): HarvestSignals => ({
  opening: '',
  siteRead: false,
  headline: '',
  appRead: false,
  collected: null,
  saved: 0,
  stubWritten: false,
  handedOff: false,
  packReady: false,
  error: '',
});

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What the harvest has said so far (`discoverBrand.mjs` progress lines, `agentRunner` hand-off). */
export function harvestSignals(entries: readonly JobStreamEntry[] | null | undefined): HarvestSignals {
  const s = emptySignals();
  for (const e of entries || []) {
    if (e.kind !== 'line' && e.kind !== 'system' && e.kind !== 'error') continue;
    for (const raw of String(e.text || '').split('\n')) {
      const msg = raw.replace(/^›\s*/, '').trim();
      if (!msg) continue;
      const opening = msg.match(/^Opening (?:the app at )?(\S+)/);
      if (opening && !s.siteRead) s.opening = opening[1] || '';
      const read = msg.match(/^Read the website(?: — headline “(.+?)”)?/);
      if (read) {
        s.siteRead = true;
        s.headline = read[1] || s.headline;
      }
      if (/^Read the app\b/.test(msg)) s.appRead = true;
      const collected = msg.match(/^Collected (\d+) unique media candidate/);
      if (collected) s.collected = Number(collected[1]);
      if (/^Saved candidates\//.test(msg)) s.saved += 1;
      if (/^Wrote harvest stub/.test(msg)) s.stubWritten = true;
      if (/^Handing off to agent/.test(msg)) s.handedOff = true;
      if (/^✓ brand pack ready/.test(msg)) s.packReady = true;
      const failed = msg.match(/^✗\s*(.+)$/);
      if (failed) s.error = failed[1] || '';
    }
  }
  return s;
}

export const paletteCount = (draft: BrandDraft | null) => BRAND_ROLES.filter((r) => HEX.test(draft?.colors[r] || '')).length;

function doneMap(signals: HarvestSignals, draft: BrandDraft | null, phase: BrandPhase): Record<DiscoveryStageId, boolean> {
  const harvested = Boolean(draft?.harvested) || signals.stubWritten;
  const font = Boolean(draft?.font?.family && draft.font.css);
  const agent = { lockup: Boolean(draft?.lockup), palette: paletteCount(draft) === 5, type: font, motion: Boolean(draft?.motionBrief) };
  return {
    site: signals.siteRead || harvested,
    candidates: harvested,
    ...agent,
    validate: Boolean(draft?.ready) && (signals.packReady || phase === 'ready'),
  };
}

function stageNote(id: DiscoveryStageId, done: boolean, signals: HarvestSignals, draft: BrandDraft | null, logoPick: string | null): string {
  switch (id) {
    case 'site': {
      const headline = draft?.site?.headline || signals.headline;
      if (done) return headline ? `“${headline.slice(0, 80)}”` : 'Website read';
      return signals.opening ? `Reading ${host(signals.opening)}` : 'Launching a headless browser';
    }
    case 'candidates': {
      const n = draft?.candidates.length ?? signals.saved;
      if (done) return n ? `${plural(n, 'candidate')} saved — pick one below` : 'No usable logo files — the agent works from the page';
      if (signals.collected != null) return `Saved ${signals.saved} of up to ${signals.collected} media hints`;
      return signals.siteRead ? 'Collecting header, nav and icon marks' : 'Waiting for the page';
    }
    case 'lockup': {
      if (logoPick?.startsWith('candidates/')) return `Your pick: ${logoPick.slice('candidates/'.length)}`;
      if (done) return draft?.logoSource ? `Sourced from ${host(draft.logoSource)}` : 'Lockup authored';
      return 'The agent is choosing the official mark';
    }
    case 'palette': {
      const n = paletteCount(draft);
      if (done) return 'Ink, surface, two accents and a support tone';
      return n ? `${n} of 5 roles set` : 'Mapping site colours to plate roles';
    }
    case 'type':
      return done && draft?.font ? draft.font.family : 'Matching the site typeface to a web font';
    case 'motion':
      return done && draft?.motionBrief ? draft.motionBrief.title : 'Voice, visual system and motion language';
    case 'validate':
      if (done) return 'Logo, palette, type and brief verified';
      return draft?.issues.length && draft.harvested ? `Waiting on: ${draft.issues[0]}` : 'Every token is checked before plates use it';
  }
}

/** One row per discovery stage, from real signals only. */
export function discoveryStages(
  signals: HarvestSignals,
  draft: BrandDraft | null,
  phase: BrandPhase,
  { message = '', logoPick = null }: { message?: string; logoPick?: string | null } = {},
): DiscoveryStage[] {
  const done = doneMap(signals, draft, phase);
  let current: DiscoveryStageId | null = null;
  if (!done.site) current = 'site';
  else if (!done.candidates) current = 'candidates';
  else current = AGENT_STAGES.find((id) => !done[id]) ?? (done.validate ? null : 'validate');
  return DISCOVERY_ORDER.map((id) => {
    let state: StageState = done[id] ? 'done' : 'pending';
    if (!done[id] && id === current && phase === 'discovering') state = 'active';
    if (!done[id] && id === current && phase === 'failed') state = 'failed';
    const note = state === 'failed' && (message || signals.error) ? message || signals.error : stageNote(id, done[id], signals, draft, logoPick);
    return { id, title: TITLES[id], note, state };
  });
}

export const discoveryProgress = (stages: readonly DiscoveryStage[]) =>
  stages.length ? stages.filter((s) => s.state === 'done').length / stages.length : 0;

export interface PaletteSwatch {
  role: BrandRole;
  hex: string | null;
  source: 'edit' | 'agent' | 'none';
}

export function paletteView(draft: BrandDraft | null, edits: Partial<Record<BrandRole, string>>): PaletteSwatch[] {
  return BRAND_ROLES.map((role) => {
    const edit = edits[role] || draft?.choices.colors[role];
    if (edit) return { role, hex: edit, source: 'edit' };
    const hex = draft?.colors[role];
    return hex ? { role, hex, source: 'agent' } : { role, hex: null, source: 'none' };
  });
}

/** Black or white, whichever reads better on `hex` (WCAG relative luminance). */
export function readableOn(hex: string): '#000000' | '#ffffff' {
  const m = HEX.test(hex) ? hex.slice(1) : '000000';
  const lin = [0, 2, 4].map((i) => {
    const c = parseInt(m.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * (lin[0] ?? 0) + 0.7152 * (lin[1] ?? 0) + 0.0722 * (lin[2] ?? 0);
  return lum > 0.179 ? '#000000' : '#ffffff';
}

export const agentCandidate = (draft: BrandDraft | null) =>
  (draft?.logoSource && draft.candidates.find((c) => c.href === draft.logoSource)?.file) || null;

/** `logo.html` (the authored lockup) or `candidates/<file>` — what the preview shows. */
export function effectiveLogo(draft: BrandDraft | null, pick: string | null): string | null {
  if (pick) return pick;
  if (draft?.choices.logo) return draft.choices.logo;
  if (draft?.lockup) return 'logo.html';
  const agent = agentCandidate(draft);
  return agent ? `candidates/${agent}` : null;
}

export function logoUrl(slug: string, logo: string | null, draft: BrandDraft | null): string {
  if (!slug || !logo) return '';
  if (logo === 'logo.html') return draft?.lockup ? `/api/video/${enc(slug)}/brand-lockup?v=${draft.lockup.rev}` : '';
  return `/api/video/${enc(slug)}/brand-candidate/${enc(logo.replace(/^candidates\//, ''))}`;
}

/* ---------- store + controller ---------- */

interface BrandStudioState {
  slug: string;
  phase: BrandPhase;
  signals: HarvestSignals;
  draft: BrandDraft | null;
  edits: Partial<Record<BrandRole, string>>;
  logoPick: string | null;
  focusRole: BrandRole;
  message: string;
  saveError: string;
  saving: boolean;
  expanded: boolean;
}

const initial = (): BrandStudioState => ({
  slug: '',
  phase: 'idle',
  signals: emptySignals(),
  draft: null,
  edits: {},
  logoPick: null,
  focusRole: 'gold',
  message: '',
  saveError: '',
  saving: false,
  expanded: false,
});

export const useBrandStudio = create<BrandStudioState>()(initial);

const store = useBrandStudio;
const POLL_MS = 2000;
const SAVE_DELAY_MS = 350;

let poll: ReturnType<typeof setInterval> | 0 = 0;
let saveTimer: ReturnType<typeof setTimeout> | 0 = 0;
let inflight: Promise<void> | null = null;
let draftSig = '';
let signalSig = '';

const draftPath = (slug: string) => `/api/video/${enc(slug)}/brand-draft`;

function stopPolling(): void {
  if (poll) clearInterval(poll);
  poll = 0;
}

function acceptDraft(slug: string, draft: BrandDraft): void {
  if (store.getState().slug !== slug) return;
  const sig = JSON.stringify(draft);
  if (sig === draftSig) return;
  draftSig = sig;
  store.setState({ draft });
}

async function post(body: { colors?: Partial<Record<BrandRole, string | null>>; logo?: string | null }): Promise<boolean> {
  const { slug } = store.getState();
  if (!slug) return false;
  store.setState({ saving: true, saveError: '' });
  try {
    const r = await api<{ state: BrandDraft }>(draftPath(slug), { method: 'POST', body });
    acceptDraft(slug, r.state);
    return true;
  } catch (err) {
    store.setState({ saveError: err instanceof Error ? err.message : String(err) });
    return false;
  } finally {
    store.setState({ saving: false });
  }
}

async function flushColors(): Promise<void> {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = 0;
  await post({ colors: store.getState().edits });
}

export const brandStudio = {
  get polling(): boolean {
    return Boolean(poll);
  },

  start(slug: string): void {
    brandStudio.reset();
    store.setState({ slug, phase: 'discovering' });
    poll = setInterval(() => void brandStudio.refresh(), POLL_MS);
    void brandStudio.refresh();
  },

  /** Keep the session for this project (a resumed run); anything else starts clean. */
  keepFor(slug: string): void {
    if (store.getState().slug !== slug) brandStudio.reset();
  },

  fromJob(job: Pick<Job, 'stream'> | null | undefined): void {
    if (!store.getState().slug) return;
    const signals = harvestSignals(job?.stream?.entries);
    const sig = JSON.stringify(signals);
    if (sig === signalSig) return;
    signalSig = sig;
    store.setState({ signals });
  },

  refresh(): Promise<void> {
    const { slug } = store.getState();
    if (!slug) return Promise.resolve();
    inflight ||= api<BrandDraft>(draftPath(slug))
      .then((draft) => acceptDraft(slug, draft))
      .catch(() => {})
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },

  pickLogo(logo: string): void {
    const prev = store.getState().logoPick;
    store.setState({ logoPick: logo });
    void post({ logo: logo.replace(/^candidates\//, '') }).then((ok) => {
      if (!ok) store.setState({ logoPick: prev });
    });
  },

  setColor(role: BrandRole, hex: string): void {
    if (!HEX.test(hex)) return;
    store.setState((s) => ({ edits: { ...s.edits, [role]: hex.toLowerCase() }, focusRole: role }));
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = 0;
      void post({ colors: store.getState().edits });
    }, SAVE_DELAY_MS);
  },

  resetColor(role: BrandRole): void {
    store.setState((s) => {
      const edits = { ...s.edits };
      delete edits[role];
      return { edits };
    });
    void post({ colors: { [role]: null } });
  },

  focus(role: BrandRole): void {
    store.setState({ focusRole: role });
  },

  toggleExpanded(): void {
    store.setState((s) => ({ expanded: !s.expanded }));
  },

  /** Discovery finished: save pending edits, fold every pick into the pack, show the ready state. */
  async finish(): Promise<void> {
    if (!store.getState().slug) return;
    stopPolling();
    await flushColors();
    const { draft, edits, logoPick } = store.getState();
    const picked = logoPick || draft?.choices.logo || Object.keys(edits).length || Object.keys(draft?.choices.colors || {}).length;
    if (picked) await post({});
    await brandStudio.refresh();
    store.setState({ phase: 'ready', message: '' });
  },

  fail(message: string): void {
    if (store.getState().phase !== 'discovering') return;
    stopPolling();
    store.setState({ phase: 'failed', message });
    void brandStudio.refresh();
  },

  reset(): void {
    stopPolling();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = 0;
    draftSig = '';
    signalSig = '';
    store.setState(initial());
  },
};
