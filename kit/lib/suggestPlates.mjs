/**
 * Propose interstitial plates from industry walkthrough rules + brand motion brief.
 * Rules distilled from SaaS demo research (problem→proof spine, social proof before close,
 * journey before deep UI, ≤5 inserts, variety over title-only cards).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PURPOSES, resolvePurpose } from './narrative.mjs';

const RULES = [
  {
    id: 'capabilities',
    type: 'features',
    when: (ctx) => !ctx.types.has('features') && ctx.wants('features'),
    beforeHint: 'first live chapter after marketing',
    title: 'Everything in one place',
    eyebrow: 'What you get',
    reason: 'Capability grid before the live tour — viewers need the map before the UI.',
    scaffold: (ctx) => ({
      id: 'capabilities',
      type: 'features',
      before: ctx.chapters[0] || 'Open the product',
      title: 'Everything in one place',
      eyebrow: 'What you get',
      items: [
        { label: 'Plan', note: 'See the work ahead', icon: 'calendar' },
        { label: 'Track', note: 'Know what landed', icon: 'clock' },
        { label: 'Prove', note: 'Reports when you need them', icon: 'chart' },
      ],
    }),
  },
  {
    id: 'ecosystem',
    type: 'logos',
    when: (ctx) => !ctx.types.has('logos') && ctx.hasAssets && ctx.wants('logos'),
    beforeHint: 'dashboard / home chapter',
    title: 'Fits the tools you already use',
    eyebrow: 'Clients & integrations',
    reason: 'Logo wall after login builds trust before deeper product proof.',
    scaffold: (ctx) => ({
      id: 'ecosystem',
      type: 'logos',
      before: ctx.chapters[1] || ctx.chapters[0] || 'Your dashboard',
      title: 'Fits the tools you already use',
      eyebrow: 'Clients & integrations',
      sub: 'Teams and tools already in the stack.',
      logos: ctx.assets.slice(0, 6).map((a) => ({ asset: a, label: a.replace(/\.[^.]+$/, '').replace(/^integ-|^client-/, '') })),
    }),
  },
  {
    id: 'first-week',
    type: 'journey',
    when: (ctx) => !ctx.types.has('journey') && ctx.chapters.length >= 3 && (ctx.wants('journey') || ctx.purpose === 'overview'),
    beforeHint: 'before the main workflow chapter',
    title: 'Your first week',
    eyebrow: 'The tour ahead',
    reason: 'Journey map answers “what will I learn?” for onboarders before deep live clicks.',
    scaffold: (ctx) => ({
      id: 'first-week',
      type: 'journey',
      before: ctx.chapters[Math.min(2, ctx.chapters.length - 1)] || 'Walkthrough',
      title: 'Your first week',
      eyebrow: 'The tour ahead',
      steps: ctx.chapters.slice(0, 5).map((label, i) => ({
        label: label.split(/[:—–-]/)[0].trim().slice(0, 28),
        note: 'On the tour',
        icon: ['dashboard', 'calendar', 'filter', 'chart', 'settings'][i] || 'spark',
      })),
    }),
  },
  {
    id: 'voices',
    type: 'testimonials',
    when: (ctx) => !ctx.types.has('testimonials') && !ctx.types.has('stats') && !ctx.types.has('quote') && ctx.wants('testimonials'),
    beforeHint: 'before settings or wrap',
    title: 'Why teams stick with it',
    eyebrow: 'From the field',
    reason: 'Social proof mid-to-late holds skeptical buyers after they’ve seen the product.',
    scaffold: (ctx) => ({
      id: 'voices',
      type: 'testimonials',
      before: ctx.chapters[ctx.chapters.length - 2] || ctx.chapters.at(-1) || 'Wrap up',
      title: 'Why teams stick with it',
      eyebrow: 'From the field',
      quotes: [
        { quote: 'Replace with a real customer quote from the motion brief or site.', author: 'Customer', role: 'Role' },
        { quote: 'Second real quote — keep under ~140 characters for card fit.', author: 'Customer', role: 'Company' },
        { quote: 'Third quote for the flood layout.', author: 'Team', role: 'Context' },
      ],
    }),
  },
  {
    id: 'proof',
    type: 'stats',
    when: (ctx) => !ctx.types.has('stats') && !ctx.types.has('metric') && ctx.wants('stats'),
    beforeHint: 'before close / wrap chapter',
    title: 'Trusted by planning teams',
    eyebrow: 'Social proof',
    reason: 'Ratings / hard numbers freeze the before→after just before the CTA close.',
    scaffold: (ctx) => ({
      id: 'proof',
      type: 'stats',
      before: ctx.chapters.at(-1) || 'Wrap up',
      title: 'Trusted by teams like yours',
      eyebrow: 'Social proof',
      stats: [
        { value: '—', label: 'Rating', note: 'from brief' },
        { value: '—', label: 'Teams', note: 'from brief' },
        { value: '—', label: 'Outcome', note: 'from brief' },
      ],
    }),
  },
  {
    id: 'thesis',
    type: 'callout',
    when: (ctx) => !ctx.types.has('callout') && ctx.chapters.length >= 4 && (ctx.wants('callout') || ctx.types.size < 2),
    beforeHint: 'before a hard live turn',
    title: 'One job, done well',
    eyebrow: 'Why it matters',
    reason: 'Callout plate when the edit is thin — one thesis + bullets before a dense live section.',
    scaffold: (ctx) => ({
      id: 'thesis',
      type: 'callout',
      before: ctx.chapters[1] || ctx.chapters[0] || 'Live product',
      title: 'One job, done well',
      body: 'State the outcome the viewer came for — not a feature list.',
      bullets: ['See the pain stop', 'Repeat it tomorrow', 'Prove it to the team'],
    }),
  },
  {
    id: 'shift',
    type: 'compare',
    when: (ctx) => !ctx.types.has('compare') && ctx.wants('compare') && (ctx.purpose !== 'overview' || !ctx.types.has('callout')),
    beforeHint: 'before the main workflow chapter',
    title: 'From scattered to settled',
    eyebrow: 'Before and after',
    reason: 'A before/after column pair states the shift the product makes before the live tour proves it.',
    scaffold: (ctx) => ({
      id: 'shift',
      type: 'compare',
      before: ctx.chapters[1] || ctx.chapters[0] || 'The workflow',
      title: 'From scattered to settled',
      eyebrow: 'Before and after',
      left: { label: 'Before', items: ['Replace with the old pain', 'A second friction point', 'What slips through'] },
      right: { label: 'After', items: ['What the product settles', 'The second win', 'What the team sees now'] },
    }),
  },
  {
    id: 'headline-number',
    type: 'metric',
    when: (ctx) => !ctx.types.has('metric') && !ctx.types.has('stats') && ctx.wants('metric'),
    beforeHint: 'before close / wrap chapter',
    title: 'The outcome in one number',
    eyebrow: 'Measured',
    reason: 'A single hero metric lands harder than a row of stats when there is one number worth remembering.',
    scaffold: (ctx) => ({
      id: 'headline-number',
      type: 'metric',
      before: ctx.chapters.at(-1) || 'Wrap up',
      title: 'Replace with the headline outcome',
      eyebrow: 'Measured',
      value: '—',
      unit: 'from brief',
      note: 'Use a verbatim number from the motion brief or site; the ring fills to progress (0–1).',
      progress: 0.76,
    }),
  },
];

function brandAssets(brand) {
  const dir = join(brand.dir, 'assets');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.(png|jpe?g|webp|svg)$/i.test(f));
}

function context(video) {
  const cfg = video.config;
  const inter = cfg.interstitials || [];
  const types = new Set(inter.map((i) => i.type));
  const audience = String(cfg.audience || '').toLowerCase();
  const title = String(cfg.title || video.slug).toLowerCase();
  const isOverview =
    /overview|first.?user|walkthrough|tour|onboard|getting started/.test(`${audience} ${title} ${video.slug}`) ||
    inter.length === 0;
  const chapters = Object.values(cfg.chapterLabels || {});
  const briefPath = join(video.dir, 'brief.json');
  const brief = existsSync(briefPath) ? JSON.parse(readFileSync(briefPath, 'utf8')) : null;
  const purpose = resolvePurpose(cfg, brief);
  // Plate types the purpose's spine asks for, in beat order.
  const spineTypes = [...new Set(PURPOSES[purpose].beats.flatMap((b) => b.plates || []))];
  return {
    types,
    inter,
    isOverview,
    purpose,
    spineTypes,
    /** True when the spine names this plate type (overview keeps its classic set as well). */
    wants: (type) => spineTypes.includes(type) || (purpose === 'overview' && isOverview && ['features', 'logos', 'testimonials', 'stats'].includes(type)),
    chapters: chapters.length ? chapters : ['Open the product', 'Your dashboard', 'The workflow', 'Wrap up'],
    hasAssets: brandAssets(video.brand).length >= 3,
    assets: brandAssets(video.brand),
    count: inter.length,
  };
}

/**
 * @returns {{ proposals: object[], keep: object[], report: string }}
 */
export function suggestPlates(video) {
  const ctx = context(video);
  const proposals = [];
  const rank = (type) => {
    const i = ctx.spineTypes.indexOf(type);
    return i < 0 ? 99 : i;
  };
  const ordered = [...RULES].sort((a, b) => rank(a.type) - rank(b.type));
  for (const rule of ordered) {
    if (ctx.count + proposals.length >= 5) break;
    if (rule.when(ctx)) {
      const plate = rule.scaffold(ctx);
      proposals.push({ ...plate, _reason: rule.reason, _beforeHint: rule.beforeHint });
    }
  }
  const lines = [
    `# Plate suggestions — ${video.slug}`,
    '',
    `Current interstitials: ${ctx.inter.map((i) => i.type).join(', ') || '(none)'}`,
    `Purpose: ${PURPOSES[ctx.purpose].label} — ${PURPOSES[ctx.purpose].framework}`,
    '',
    proposals.length
      ? proposals.map((p, i) => `${i + 1}. **${p.type}** \`${p.id}\` — ${p._reason}\n   Insert before chapter: “${p.before}” (${p._beforeHint})`).join('\n')
      : 'No additional plates recommended — current set covers the spine.',
    '',
    `Spine: ${PURPOSES[ctx.purpose].beats.map((b) => b.id).join(' → ')}; plates carry ${ctx.spineTypes.join(', ') || 'no beat directly'}.`,
    'Cap at 5 interstitials. Prefer real quotes/assets from the motion brief — replace scaffold placeholders.',
  ];
  return { proposals, keep: ctx.inter, report: lines.join('\n') };
}

/** Merge proposals into video.config.json (idempotent by id). */
export function applyPlateSuggestions(video, proposals) {
  const cfgPath = video.configPath;
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const existing = new Set((cfg.interstitials || []).map((i) => i.id));
  const added = [];
  cfg.interstitials = cfg.interstitials || [];
  for (const p of proposals) {
    if (existing.has(p.id)) continue;
    const { _reason, _beforeHint, ...plate } = p;
    cfg.interstitials.push(plate);
    added.push(plate.id);
  }
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  return added;
}
