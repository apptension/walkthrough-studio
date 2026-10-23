/**
 * One "What to show, in order" line = one journey beat, written by the explore agent:
 *
 *   Title — why it matters to the viewer · how: click “People” in the left sidebar → hover a capacity bar
 *
 * Title becomes the chapter title. Why steers narration. How is the path the agent walked,
 * so the flow builder can script it. Code only splits the line; it never writes or orders beats.
 */

const HOW_SPLIT = /\s+[·•|]\s*how:\s*|\s+how:\s*/i;
const WHY_SPLIT = /\s+[—–]\s+|\s+-\s+/;

export function parseBeat(line) {
  const raw = String(line || '').replace(/\s+/g, ' ').trim();
  if (!raw) return { title: '', why: '', how: '', raw: '' };
  const [head, ...howParts] = raw.split(HOW_SPLIT);
  const how = howParts.join(' · ').trim();
  const at = head.search(WHY_SPLIT);
  if (at < 0) return { title: head.trim(), why: '', how, raw };
  const match = head.slice(at).match(WHY_SPLIT);
  return {
    title: head.slice(0, at).trim(),
    why: head.slice(at + match[0].length).trim(),
    how,
    raw,
  };
}

export function formatBeat({ title = '', why = '', how = '' } = {}) {
  const head = [String(title).trim(), String(why).trim()].filter(Boolean).join(' — ');
  const steps = String(how).trim();
  return steps ? `${head} · how: ${steps}` : head;
}

export function beatTitle(line) {
  return parseBeat(line).title;
}

/** Prompt block every agent that writes or reads the list shares. */
export const BEAT_GUIDE = `"What to show, in order" (brief.json → story.mustShow) is the journey the recorder follows. One beat per entry, in this exact shape:
  Title — why it matters to the viewer · how: click “Exact label” in the <where it sits> → <next move> → <what to hover, type or drag to reveal the payoff>
- Title: ≤5 words, the on-screen chapter title (flow.mjs chapter()/say() uses it verbatim; narration keys match it).
- Why: one clause of viewer value, not a feature name.
- How: the concrete path from the previous beat, as you would walk it — exact visible labels in quotes, where they sit, then the move that shows the payoff. Real data names you saw (people, projects) make it concrete. Mark anything you could not walk yourself "(verify)".
- Order for impact: open on the screen that proves the promise fastest, then the actions that build on it, then supporting detail. You decide what earns a place; utility screens rarely do.
- 4–7 beats. Each beat must be reachable from the one before it without signing out or destroying data.`;
