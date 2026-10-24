import type {
  Brand,
  BranchIdea,
  Direction,
  Freshness,
  Health,
  Job,
  Motion,
  ReviewLeg,
  ReviewSummary,
  Scene,
  VideoIndex,
  VideoSummary,
  Version,
} from '@/api/types';
import type { ScriptPayload, ScriptScene } from '@/features/script/types';
import type { BrandDraft } from '@/features/project-wizard/brandStudio';

/**
 * Test data builders.
 *
 * Each factory returns a complete, valid object and takes a deep-ish override so
 * a test can say what it is actually about: `makeVideo({ freshness: { stale:
 * true } })` reads as "a stale project", not as forty lines of fixture.
 */

/**
 * A deep partial, so `makeVideo({ review: { cut: { effective: 'changed' } } })`
 * only has to name the one field under test. Arrays are replaced wholesale.
 */
type Overrides<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object | null
      ? Overrides<NonNullable<T[K]>> | null
      : T[K];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function merge<T extends object>(base: T, overrides?: Overrides<T>): T {
  if (!overrides) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    const current = out[key];
    out[key] =
      isPlainObject(value) && isPlainObject(current) ? merge(current, value as never) : value;
  }
  return out as T;
}

export function makeReviewLeg(overrides?: Partial<ReviewLeg>): ReviewLeg {
  return {
    status: 'approved',
    effective: 'approved',
    history: [],
    note: '',
    approvedAt: '2026-10-20T09:00:00.000Z',
    ...overrides,
  };
}

export function makeReview(overrides?: Overrides<ReviewSummary>): ReviewSummary {
  return merge({ script: makeReviewLeg(), cut: makeReviewLeg() }, overrides);
}

export function makeFreshness(overrides?: Overrides<Freshness>): Freshness {
  return merge<Freshness>(
    {
      fresh: true,
      stale: false,
      needsRecord: false,
      startUrl: 'https://example.test/app',
      loginRequired: false,
      plateHealth: { bad: false, issues: [], byId: {} },
      reason: 'Delivery matches current sources',
      sourceAt: 1_760_000_000_000,
      deliveryAt: 1_760_000_900_000,
      liveAt: 1_760_000_500_000,
      newestSource: 'config',
      sources: [],
    },
    overrides,
  );
}

export function makeMotion(overrides?: Partial<Motion>): Motion {
  return {
    energy: 'clear',
    atmosphere: 'aurora',
    atmosphereOpacity: 0.6,
    atmosphereSpeed: 1,
    titleReveal: 'rise',
    depth: 'soft',
    sheen: true,
    enterMs: 520,
    staggerMs: 90,
    pushScale: 1.04,
    ...overrides,
  };
}

export function makeDirection(overrides?: Overrides<Direction>): Direction {
  return merge<Direction>(
    {
      palette: 'signature',
      scale: 'signature',
      focus: 'guided',
      logo: 'logo.html',
      look: 'studio',
      looks: {},
      lockups: [{ file: 'logo.svg', label: 'Primary' }],
      scales: [],
      roles: [],
      camera: {
        zoom: 'medium',
        frame: 'browser',
        background: 'brand',
        padding: 'comfortable',
        corners: 'round',
        shadow: 'soft',
        curve: 'ease',
        motion: 'glide',
      },
      cursor: { style: 'ring', size: 'medium', glide: true, hideIdle: true, hand: false, loop: false },
      keys: true,
      pace: { id: 'steady', tempo: 1, label: 'Steady', hint: 'Default tempo' },
      paces: {},
      motion: makeMotion(),
      overlays: { preset: 'studio', chapter: {}, caption: {}, chapters: {} },
      approvedAt: null,
      colors: { gold: '#42f272' },
      swatches: ['#42f272'],
    },
    overrides,
  );
}

export function makeScene(overrides?: Partial<Scene>): Scene {
  return {
    index: 0,
    id: 'open',
    kind: 'plate',
    title: 'Open',
    type: 'open',
    start: 0,
    end: 4,
    dur: 4,
    transitionIn: null,
    join: null,
    cleanFrom: null,
    cleanTo: null,
    editable: true,
    plateId: 'open',
    renderOnly: null,
    htmlUrl: '/media/demo/plates/open.html',
    mp4Url: '/media/demo/plates/open.mp4',
    ...overrides,
  };
}

export function makeVersion(overrides?: Partial<Version>): Version {
  return {
    id: '20261020-090000',
    number: 12,
    name: 'Rendered sequence',
    title: 'Rendered sequence',
    label: 'v12',
    kind: 'render',
    trigger: 'render',
    note: '',
    createdAt: '2026-10-20T09:00:00.000Z',
    durationSec: 92,
    sizeMB: 18.4,
    chapters: 4,
    hasAudio: true,
    hasCritic: false,
    hasCaptions: true,
    hasDeliver: true,
    qcStatus: 'pass',
    displayName: 'v12 · Rendered sequence',
    ...overrides,
  };
}

export function makeVideo(overrides?: Overrides<VideoSummary>): VideoSummary {
  return merge<VideoSummary>(
    {
      slug: 'demo',
      title: 'Demo walkthrough',
      audience: 'New users',
      language: { code: 'en', name: 'English' },
      brand: 'walkthrough-studio',
      brandFoundation: {
        name: 'Walkthrough Studio',
        platform: 'web',
        font: 'Plus Jakarta Sans',
        accent: '#42f272',
        logo: 'logo.html',
        colors: { gold: '#42f272' },
        ready: true,
        placeholder: false,
        issues: [],
        discovery: null,
        lockups: [{ file: 'logo.svg', label: 'Primary' }],
      },
      direction: makeDirection(),
      directionOptions: {
        palettes: { signature: { label: 'Signature', hint: 'House scale' } },
        focus: { guided: { label: 'Guided', hint: 'Follow the cursor' } },
        transitions: { dissolve: { label: 'Dissolve', hint: 'Soft blend', xfade: 'fade' } },
        camera: {
          zoom: ['tight', 'medium', 'wide'],
          frame: ['browser', 'none'],
          background: ['brand', 'void'],
          padding: ['tight', 'comfortable'],
          corners: ['square', 'round'],
          shadow: ['none', 'soft'],
          curve: ['linear', 'ease'],
          motion: ['glide', 'snap'],
        },
        cursor: { style: ['ring', 'dot'], size: ['small', 'medium'] },
      },
      motion: makeMotion(),
      motionOptions: {
        energies: ['calm', 'clear', 'punchy'],
        atmospheres: ['none', 'aurora'],
        atmosphereLabels: { none: 'None', aurora: 'Aurora' },
        titleReveals: ['rise', 'cascade', 'wipe'],
        titleRevealLabels: {
          rise: 'Rise · masked lift',
          cascade: 'Cascade · character flip',
          wipe: 'Wipe · line unmask',
        },
        depths: ['flat', 'soft', 'deep'],
        lookVars: {},
      },
      story: {
        purpose: 'overview',
        explicit: true,
        label: 'Overview',
        framework: 'Problem · Promise · Proof',
        hint: 'Launch-day trailer',
        beats: [],
        options: [],
      },
      critic: null,
      livePace: null,
      transitions: { style: 'dissolve', duration: 0.4, xfade: 'fade' },
      review: makeReview(),
      hasFlow: true,
      captureMode: 'agent',
      output: { format: 'landscape', width: 1920, height: 1080, label: 'Wide 16:9' },
      guidedTour: null,
      brief: null,
      lineage: null,
      interstitials: [],
      plateAccents: {},
      plateStyles: {},
      editSummary: 'No edits',
      hasDelivery: true,
      deliveryUrl: '/media/demo/demo.mp4',
      freshness: makeFreshness(),
      recordFailure: null,
      previewUrl: null,
      liveUrl: '/media/demo/live.mp4',
      captureMarks: [],
      signInWait: null,
      durationSec: 92,
      sizeMB: 18.4,
      chapters: [
        { title: 'Open', start: 0 },
        { title: 'The feature', start: 18 },
      ],
      hasCritic: false,
      criticUrl: null,
      contactSheet: null,
      reviewUrl: null,
      posterUrl: '/media/demo/poster.jpg',
      posterMeta: { atSec: 3, source: 'auto', setAt: '2026-10-20T09:00:00.000Z' },
      handoffZipUrl: null,
      captions: {
        srtUrl: '/media/demo/captions/demo.srt',
        vttUrl: '/media/demo/captions/demo.vtt',
        cueCount: 24,
        hash: 'abc123',
        language: 'en',
        languageName: 'English',
      },
      qc: null,
      deliver: null,
      exports: [],
      exportPresets: {
        square: { label: 'Square 1:1', hint: 'LinkedIn, X', width: 1080, height: 1080, kind: 'mp4' },
      },
      youtubeChaptersUrl: null,
      versions: [makeVersion()],
      assets: [],
      htmlPlates: [],
      overlays: { preset: 'studio', chapter: {}, caption: {}, chapters: {} },
      scenes: [makeScene(), makeScene({ index: 1, id: 'live', kind: 'live', title: 'The feature', start: 4, end: 92, dur: 88, plateId: null })],
      hasDraft: false,
      source: { config: true, narration: true, flow: true },
    },
    overrides,
  );
}

export function makeIndex(overrides?: Overrides<VideoIndex>): VideoIndex {
  return merge<VideoIndex>(
    {
      videos: [makeVideo()],
      folders: [],
      loose: [makeVideo()],
      agent: true,
      agentAuth: makeHealth().agentAuth,
    },
    overrides,
  );
}

export function makeHealth(overrides?: Overrides<Health>): Health {
  const cursor = {
    provider: 'cursor' as const,
    label: 'Cursor agent',
    bin: '/usr/local/bin/agent',
    available: true,
    authenticated: true,
    via: 'agent-login',
    soft: false,
    message: 'Logged in via agent login',
  };
  return merge<Health>(
    {
      ok: true,
      version: '1.0.0-beta.1',
      agent: true,
      agentAuth: {
        preference: 'cursor',
        provider: 'cursor',
        runners: {
          cursor,
          claude: {
            provider: 'claude',
            label: 'Claude Code',
            bin: '/usr/local/bin/claude',
            available: true,
            authenticated: false,
            via: null,
            soft: false,
            message: 'Run `claude` then /login',
          },
        },
        active: cursor,
        available: true,
      },
    },
    overrides,
  );
}

export function makeBrand(overrides?: Partial<Brand>): Brand {
  return {
    id: 'walkthrough-studio',
    name: 'Walkthrough Studio',
    accent: '#42f272',
    url: 'https://example.com',
    placeholder: false,
    ready: true,
    issues: [],
    ...overrides,
  };
}

export function makeBranchIdea(overrides?: Partial<BranchIdea>): BranchIdea {
  return {
    id: 'desk-home',
    title: 'Desk home',
    purpose: 'feature',
    angle: 'Stay on the desk until the viewer can do it alone',
    outcome: 'Confidently open a project',
    mustShow: ['Desk home — open New video'],
    keyMessages: [],
    mustSay: [],
    lengthSec: 90,
    plates: ['features', 'callout'],
    source: 'brief',
    ...overrides,
  };
}

export function makeScriptScene(overrides?: Partial<ScriptScene>): ScriptScene {
  return {
    kind: 'chapter',
    key: 'chapter-1',
    title: 'The feature',
    titleLines: ['The feature'],
    eyebrow: 'Chapter 1',
    onScreen: 'The feature',
    sub: '',
    narrationKind: 'say',
    narrationKey: 'chapter-1',
    voiced: true,
    holdSec: 3.2,
    holdDefault: 3,
    timingKind: 'auto',
    editable: { title: true, narration: true },
    narration: 'Here is the part everyone asks about.',
    narrationWords: 8,
    narrationSpeed: null,
    narrationSec: 3.2,
    issues: [],
    ...overrides,
  };
}

export function makeScript(overrides?: Overrides<ScriptPayload>): ScriptPayload {
  return merge<ScriptPayload>(
    {
      script: {
        scenes: [makeScriptScene()],
        chapters: ['The feature'],
        plateTypes: [],
        lint: [],
        orphans: [],
        scaffold: false,
        hash: 'script-hash',
        totals: {
          scenes: 1,
          chapters: 1,
          plates: 0,
          narrated: 1,
          words: 8,
          estSec: 3.2,
          errors: 0,
          warnings: 0,
        },
      },
      review: makeReview(),
    },
    overrides,
  );
}

export function makeJob(overrides?: Partial<Job>): Job {
  return {
    id: 'job-1',
    status: 'running',
    kind: 'make',
    slug: 'demo',
    step: 'produce',
    label: 'Render',
    activity: 'Encoding chapter 2',
    createdAt: '2026-10-20T09:00:00.000Z',
    startedAt: '2026-10-20T09:00:01.000Z',
    log: [{ t: 1_760_000_000_000, line: 'produce → chapter 2' }],
    stream: { entries: [] },
    question: null,
    ...overrides,
  };
}

/** `GET /api/video/:slug/brand-draft` mid-discovery: harvested, nothing authored yet. */
export function makeBrandDraft(overrides?: Partial<BrandDraft>): BrandDraft {
  return {
    brand: 'acme',
    name: 'Acme',
    platform: 'Ship faster',
    status: 'harvested',
    placeholder: true,
    ready: false,
    issues: ['brand discovery has not produced a verified logo and palette'],
    harvested: true,
    site: { url: 'https://acme.test/', headline: 'Ship faster', sub: '' },
    candidates: [
      { file: '00-img.svg', kind: 'img', alt: 'Acme', w: 120, h: 30, href: 'https://acme.test/logo.svg' },
      { file: '01-icon.png', kind: 'icon', alt: '', w: 0, h: 0, href: 'https://acme.test/favicon.png' },
    ],
    hints: ['#ff5500', '#2244aa'],
    colors: {},
    font: null,
    lockup: null,
    logoSource: null,
    motionBrief: null,
    choices: { colors: {}, logo: null },
    ...overrides,
  };
}

/** The same pack once the agent has authored and verified it. */
export const READY_BRAND_DRAFT: Partial<BrandDraft> = {
  status: 'ready',
  placeholder: false,
  ready: true,
  issues: [],
  colors: { ink: '#0a0a0a', surface: '#141414', gold: '#ff5500', amber: '#ffaa00', teal: '#2244aa' },
  font: { family: 'Inter', css: 'https://fonts.googleapis.com/css2?family=Inter' },
  lockup: { rev: 7, svg: true },
  logoSource: 'https://acme.test/logo.svg',
  motionBrief: { title: 'Motion brief — Acme', excerpt: 'Calm and precise.' },
};
