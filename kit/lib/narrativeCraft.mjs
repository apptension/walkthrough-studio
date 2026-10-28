/**
 * Screen–voice–slide alignment for draft, narration, script, and post-take recraft agents.
 * Complements narrative.mjs (story spine) and authoring.md §Narration.
 */

/** Measured Matilda @ ~1.05× on Eleven v4; matches script.mjs lint budgets. */
export const WORDS_PER_SEC = 2.4;
/** Slightly faster budget when fitting lines to a recorded take (take-recraft / own-take). */
export const WORDS_PER_SEC_TAKE = 2.6;

/** Spoken word budget for a beat that runs `sec` seconds on screen. */
export function wordBudgetForSeconds(sec, { rate = WORDS_PER_SEC } = {}) {
  const s = Math.max(0, Number(sec) || 0);
  if (s <= 0) return 0;
  return Math.min(28, Math.max(1, Math.round(s * rate)));
}

/**
 * Prompt block: analyze what is on screen, assign distinct jobs to title / body / voice,
 * keep cognitive load low, and stay in the video's tone.
 * @param {{ timing?: 'script' | 'recorded', includePlates?: boolean }} [opts]
 */
export function narrativeCraftGuide(opts = {}) {
  const timing = opts.timing === 'recorded' ? 'recorded' : 'script';
  const includePlates = opts.includePlates !== false;
  const wps = timing === 'recorded' ? WORDS_PER_SEC_TAKE : WORDS_PER_SEC;

  const lines = [
    '## Screen, voice, and slides (low cognitive load)',
    'The viewer reads titles and captions while listening. Give each layer a different job so nothing competes.',
    '',
    'Per beat — read flow.mjs and the on-screen copy together before you write a narration line:',
    '- **Chapter card** (title + body): the title names the section (≤5 words); the body is one short sentence (≤12 words). The voice opens the *next* action or names the control before the pointer reaches it, then adds **why** the section matters or what outcome to expect — not the section title again.',
    '- **Caption** (say): the title is the imperative or outcome on screen (≤5 words); the body confirms what just happened. The voice adds the consequence, the number that changed, or what to notice in the UI — never read the caption title aloud.',
    '- **Back-to-back caption → chapter**: they play seconds apart. One carries the step; the other carries why the next section exists. Never give both the same noun phrase.',
  ];

  if (includePlates) {
    lines.push(
      '- **Interstitial plate**: the plate shows the fact (stat, quote, logos, checklist). The voice interprets it in one line — what it proves for *this* viewer — without reading headline numbers or bullet labels verbatim.',
      '- **Open / close**: intro names the viewer’s job or outcome (not “Welcome to…”); outro echoes the open and one next step. Plate titles stay punchy; the voice carries warmth and direction from tone.persona and tone.do.',
    );
  }

  lines.push(
    '',
    'Ground every live line in what is **actually visible** in that beat: real labels, filters, names, counts, and results from the flow or take — not generic product speak. If flow-analysis.md or guided-tour screenshots exist, use them to see density and data worth naming.',
    '',
    `**Time on screen:** budget ≈ ${wps} spoken words per second of the beat (leave ~35% for music and breath). Example: a 4s chapter card ≈ ${wordBudgetForSeconds(4, { rate: wps })} words; never run past the beat — trim or split ideas, do not speed-read.`,
    timing === 'recorded'
      ? 'Use timeline.json chapter marks: from each chapter’s t to the next chapter’s t is the word budget for that line.'
      : 'Use chapter()/say() hold times and default card duration when holds are omitted (~2.8s chapter, ~2.2s say unless ms is set).',
    '',
    '**Tone:** match video.config.json → tone (words, persona, do, avoid) and audio.voice.direction in every line — same personality on plates, captions, and VO. Prefer concrete nouns from the UI over category adjectives; keep must-say lines from the brief verbatim.',
    '',
    'Before you finish: read narration.mjs top to bottom in spoken order. No line repeats another’s point; no phrase of three or more words comes back; no line reads its on-screen title or body aloud.',
  );

  return lines.join('\n');
}

/** One-line reminder for repair prompts after narration QC fails. */
export function alignmentRepairHint() {
  return 'When a line reads the screen aloud, rewrite it to add outcome or reason while the caption carries the label. When two lines share a phrase, keep the first landing and give the other a new job (next control, result on screen, or why it matters).';
}
