/**
 * Spoken narration, keyed by the caption and chapter titles in flow.mjs (the first argument of
 * ctx.say / ctx.chapter). Video leads: each line is fitted into the time its step is on screen.
 * About 2.4 words per second — a 4-second step takes nine words. A caption without a line is
 * covered by the line before it. Run `node cli.mjs voice <slug>` and read the warnings.
 *
 * Style: short sentences, present tense, second person. Ellipses (...) are pauses; Eleven v4 also
 * takes audio tags like [warm] or [slightly faster] inline. A line can be an object to override
 * speed: { text: '...', speed: 1.05 }.
 */
export default {
  intro: 'One sentence over the opening plate: what this video shows.',
  outro: 'One sentence over the closing plate.',
  lines: {
    'Chapter title from flow.mjs': 'What the viewer is about to see, in one breath.',
    'Caption title from flow.mjs': 'Why this step matters.',
  },
};
