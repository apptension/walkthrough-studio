/** Compare a spoken line with the frame sampled for that beat.
 * Names come only from the line. An empty sample is not treated as a missing control.
 */
import { shortHoldWarning } from './voiceHold';
import { asText } from './text';

export interface SampledFrame {
  at: number | null;
  path: string | null;
  text?: string;
}

export interface CriticBeat {
  key: string;
  line: string;
  holdSec?: number;
  narrationSec?: number;
  frame?: Partial<SampledFrame> | null;
}

export interface CriticFinding {
  severity: string;
  persona: string;
  action: string;
  target: string;
  issue: string;
  suggestion: string;
  frame?: { at?: number | null; path?: string | null } | null;
  apply: unknown;
}

export interface FrameSample {
  key?: string;
  at?: number | null;
  t?: number | null;
  path?: string | null;
  text?: string;
}

export interface CriticScene {
  key: string;
  title?: string;
  narrationKey?: string;
  narration?: string;
  holdSec?: number;
  narrationSec?: number;
}

export interface CriticBeatFrame {
  at: number | null;
  path: string | null;
  text: string;
}

const CONTROL =
  /\b(?:the\s+)([A-Za-z][\w-]{1,32}(?:\s+[A-Za-z][\w-]{1,32}){0,3})\s+(button|tab|menu|link|page|field|toggle|switch|state|screen|dialog|modal|panel)\b/gi;
const QUOTED = /["“]([^"”]{2,60})["”]/g;

export function namedControls(line: unknown): string[] {
  const text = asText(line || '');
  const found: string[] = [];
  for (const match of text.matchAll(QUOTED)) found.push((match[1] ?? '').trim());
  for (const match of text.matchAll(CONTROL)) found.push((match[1] ?? '').trim());
  return [...new Set(found)];
}

function shows(frameText: unknown, name: string): boolean {
  return asText(frameText || '').toLowerCase().includes(asText(name).toLowerCase());
}

export function frameStillRel(key: unknown): string {
  const safe = asText(key || 'beat').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'beat';
  return `critic-frames/${safe}.jpg`;
}

export interface SpokenFrameFinding extends CriticFinding {
  frame: { at: number | null; path: string | null };
  apply: null;
}

export function critiqueSpokenFrames(beats: CriticBeat[] | null | undefined): SpokenFrameFinding[] {
  const findings: SpokenFrameFinding[] = [];
  for (const beat of beats || []) {
    const frame = {
      at: beat.frame?.at ?? null,
      path: beat.frame?.path || null,
    };
    const text = beat.frame?.text || '';
    if (text) {
      const missing = namedControls(beat.line).filter((name) => !shows(text, name));
      if (missing.length) {
        findings.push({
          severity: 'high',
          persona: 'implementer',
          action: 'change',
          target: `frame:${beat.key}`,
          issue: `The line names ${missing.join(', ')} but the sampled frame does not show it.`,
          suggestion: 'Show that control in this beat, or say only what is on screen.',
          frame,
          apply: null,
        });
      }
    }
    const short = shortHoldWarning(beat.holdSec, beat.narrationSec);
    if (short) {
      findings.push({
        severity: 'medium',
        persona: 'skeptic',
        action: 'change',
        target: `frame:${beat.key}`,
        issue: short,
        suggestion: 'Lengthen the hold or shorten the line so the last word lands on this frame.',
        frame,
        apply: null,
      });
    }
  }
  return findings;
}

export function directorNoteForFinding(f: Pick<CriticFinding, 'issue' | 'target' | 'persona' | 'suggestion' | 'frame'>): string {
  const where = f?.frame?.path
    ? ` Sampled frame ${f.frame.path}${f.frame.at != null ? ` at ${Number(f.frame.at).toFixed(1)}s` : ''}.`
    : '';
  return `${f.issue} (${f.target}, flagged by the ${f.persona}). ${f.suggestion}${where}`.trim();
}

export function formatSampleList(samples: (FrameSample | null | undefined)[] | null | undefined): string {
  return (samples || [])
    .filter((sample): sample is FrameSample => Boolean(sample?.path || sample?.at != null))
    .map((sample) => {
      const at = sample.at != null ? ` @ ${Number(sample.at).toFixed(1)}s` : '';
      return `- ${sample.key || 'beat'} — ${sample.path || '(time only)'}${at}`;
    })
    .join('\n');
}

/** Pair each voiced scene with the frame captured under that title. */
export function beatsForCritic(
  scenes: (CriticScene | null | undefined)[] | null | undefined,
  samples: (FrameSample | null | undefined)[] | null | undefined,
): { key: string; line: string; holdSec?: number; narrationSec?: number; frame: CriticBeatFrame }[] {
  const byKey = new Map<string | undefined, FrameSample>();
  for (const sample of samples || []) {
    if (sample?.key) byKey.set(sample.key, sample);
  }
  return (scenes || [])
    .filter((scene): scene is CriticScene & { narration: string } => Boolean(scene?.narration))
    .map((scene) => {
      const sample = byKey.get(scene.narrationKey) || byKey.get(scene.title) || byKey.get(scene.key) || null;
      return {
        key: scene.key,
        line: scene.narration,
        holdSec: scene.holdSec,
        narrationSec: scene.narrationSec,
        frame: {
          at: sample?.t ?? sample?.at ?? null,
          path: sample ? sample.path || frameStillRel(scene.key) : null,
          text: sample?.text || '',
        },
      };
    });
}
