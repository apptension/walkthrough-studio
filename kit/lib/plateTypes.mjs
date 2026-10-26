/**
 * The one list of interstitial plate types. Everything that enumerates plates — the builder
 * (`plates.mjs`), the Studio script sheet and "Add plate" (`script.mjs`), the New-video wizard
 * (`newProject.mjs`), branching (`branch.mjs`), the agent prompts (`agentRunner.mjs`) and the
 * plate suggester — reads from here, so adding a type is: template + builder + one catalog row.
 *
 * `list` names the config array the Studio row editor edits; `fields` are the row columns.
 * `shape` is the agent-facing config shape (also rendered in the prompts).
 */
/** Types whose markup lives with the video rather than in kit/templates. */
export const CUSTOM_PLATE_TYPE = 'custom';

export const PLATE_CATALOG = Object.freeze([
  { type: 'features', label: 'Features', hint: 'Capability grid with icons', list: 'items', fields: ['label', 'note', 'icon'], shape: 'items:[{label,note,icon?}] (3–6)' },
  { type: 'journey', label: 'Journey', hint: 'Ordered path through the tour', list: 'steps', fields: ['label', 'note', 'icon'], shape: 'steps:[{label,note,icon?}] (3–6)' },
  { type: 'process', label: 'Process', hint: 'How it works — numbered steps', list: 'steps', fields: ['label', 'note'], shape: 'sub?, steps:[{label,note}] (3–5)' },
  { type: 'timeline', label: 'Timeline', hint: 'Milestones or roadmap on a dated rail', list: 'steps', fields: ['label', 'date', 'note'], shape: 'steps:[{label,date?,note?}] (3–6)' },
  { type: 'checklist', label: 'Checklist', hint: 'Outcomes ticked off one by one', list: 'items', fields: ['label', 'note'], shape: 'items:[{label,note?}] (3–6)' },
  { type: 'logos', label: 'Logos', hint: 'Integration or client wall', list: 'logos', fields: ['label', 'asset'], shape: 'sub?, logos:[{asset,label?,bg?}] (3–10)' },
  { type: 'orbit', label: 'Orbit', hint: 'Logos circling the product', list: 'logos', fields: ['label', 'asset'], shape: 'sub?, logos:[{asset,label?,bg?}] (3–8)' },
  { type: 'testimonials', label: 'Testimonials', hint: 'Quote flood from the field', list: 'quotes', fields: ['quote', 'author', 'role'], shape: 'quotes:[{quote,author,role}] (3–8; carousel 6–16)' },
  { type: 'quote', label: 'Quote', hint: 'Single hero quote', list: null, fields: [], shape: 'quote, author, role?, company?, stars?, logo?' },
  { type: 'stats', label: 'Stats', hint: 'Two to four hard numbers', list: 'stats', fields: ['value', 'label', 'note'], shape: 'stats:[{value,label,note?,logo?}] (2–4)' },
  { type: 'kpi', label: 'KPI board', hint: 'Dashboard tiles with trends', list: 'stats', fields: ['value', 'label', 'delta', 'note'], shape: 'stats:[{value,label,delta?,note?}] (3–6)' },
  { type: 'metric', label: 'Metric', hint: 'One headline number', list: null, fields: [], shape: 'value, unit?, note?, progress?:0–1, pills?:[] (≤4)' },
  { type: 'callout', label: 'Callout', hint: 'One thesis and bullets', list: 'bullets', fields: ['text'], shape: 'body, bullets:[] (2–4)' },
  { type: 'statement', label: 'Statement', hint: 'Kinetic type — one line that lands', list: null, fields: [], shape: 'title (1–3 lines, one *accent*), sub?' },
  { type: 'compare', label: 'Compare', hint: 'Before / after columns', list: null, fields: [], shape: 'left:{label?,title?,items:[]}, right:{label?,title?,items:[]} (2–5 each)' },
  { type: 'faq', label: 'FAQ', hint: 'Questions answered before they are asked', list: 'items', fields: ['label', 'note'], shape: 'items:[{label:question,note:answer}] (2–4)' },
  { type: 'pricing', label: 'Pricing', hint: 'Plans side by side, one featured', list: 'tiers', fields: ['label', 'value', 'period', 'note', 'lines'], shape: 'tiers:[{label,value,period?,note?,items?:[],featured?,badge?}] (2–3)' },
  { type: 'team', label: 'People', hint: 'Roles or personas with avatars', list: 'items', fields: ['label', 'note', 'asset'], shape: 'items:[{label,note?,asset?}] (3–6)' },
  { type: 'showcase', label: 'Showcase', hint: 'An interface shot in a device, zooming to the detail with callout pins', list: 'callouts', fields: ['label', 'x', 'y'], shape: 'shot?:asset, sub?, caption?, focus?:center|top|bottom|left|right, callouts?:[{label,x:0–100,y:0–100}] (≤4)' },
  { type: 'bento', label: 'Bento', hint: 'Editorial board — the interface, one number, one voice, the stack', list: 'logos', fields: ['label', 'asset'], shape: 'shot?:asset, value, label, quote?, author?, caption?, logos?:[{asset,label?}] (≤4)' },
  {
    type: 'custom',
    label: 'Custom',
    hint: 'A layout authored for this video, in videos/<slug>/templates/<template>.html',
    list: 'items',
    fields: ['label', 'note', 'value', 'icon', 'asset'],
    shape: 'template:"<file stem under videos/<slug>/templates>", sub?, body?, items?:[{label,note?,value?,icon?,asset?}]',
  },
]);

/** Type ids in catalog order. */
export const PLATE_TYPE_IDS = Object.freeze(PLATE_CATALOG.map((p) => p.type));

export const PLATE_TYPE_SET = new Set(PLATE_TYPE_IDS);

/**
 * Types that render the same in every project, so one still per brand stands for all of them.
 * `custom` is excluded: its markup belongs to a single video, and there is nothing to sample.
 */
export const SAMPLED_PLATE_TYPE_IDS = Object.freeze(PLATE_TYPE_IDS.filter((t) => t !== CUSTOM_PLATE_TYPE));

/** `features|journey|…` for prompts and error messages. */
export const PLATE_TYPE_LIST = PLATE_TYPE_IDS.join('|');

/**
 * How to author a layout no built-in type covers. Every prompt that lists the types gets this,
 * because "make a slide that looks like X" has no good answer among them and the wrong answer —
 * editing a shared template in kit/templates — changes every other video that uses that type.
 */
export const CUSTOM_PLATE_GUIDE = `Custom layouts — when the moment needs a composition no type above gives you:
1. Copy kit/templates/custom.html to videos/<slug>/templates/<name>.html and write the layout and its animation there. It belongs to this video alone; kit/templates stays untouched.
2. Add the plate as { "type": "custom", "template": "<name>", ... } with the fields the template paints (title, eyebrow, sub, body, items[], shot).
3. Build on the brand: its colours (--gold, --amber, --teal, --surface, --ink, --muted, --text) and easings (--expo, --exit, --pop) are already in scope, and plates.css carries the shared stage, grain and fade-out. Never hard-code a hex.
4. Keep every data-edit attribute and the .stage / .grain / .black / data-duration scaffolding from the starter, or the slide stops being editable in Studio and stops timing correctly in the render.
Only do this when no type above fits — a built-in plate is better edited than replaced.`;

/** One line per type for agent prompts — type, when to use it, config shape. */
export function plateTypeGuide() {
  return `${PLATE_CATALOG.map((p) => `${p.type} — ${p.hint}: ${p.shape}`).join('\n')}\n\n${CUSTOM_PLATE_GUIDE}`;
}
