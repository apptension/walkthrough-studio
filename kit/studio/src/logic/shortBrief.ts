/** One description becomes an editable draft. Nothing here records. */

import { lengthFromText } from './length';
import { asText } from './text';

/** An error that names the form field it belongs to. */
export type FieldError = Error & { field?: string };

export interface ShortBriefDraft {
  title: string;
  audience: string;
  purpose: string;
  lengthSec: number;
  chapters: string[];
  proof: string[];
  startUrl: string;
  records: false;
}

export interface DraftableConfig {
  title?: string;
  audience?: string;
  purpose?: string;
  record?: Record<string, unknown> & { startUrl?: string };
  story?: Record<string, unknown>;
  [key: string]: unknown;
}

function httpUrl(value: unknown): string {
  const raw = asText(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) {
    const error: FieldError = new Error('Start URL must be a full http(s) URL.');
    error.field = 'shortStartUrl';
    throw error;
  }
  return raw;
}

export function draftFromDescription({ description, startUrl }: { description?: unknown; startUrl?: unknown } = {}): ShortBriefDraft {
  const text = asText(description || '').trim();
  if (!text) {
    const error: FieldError = new Error('Describe what to show, for whom, and about how long');
    error.field = 'description';
    throw error;
  }
  const chapters = text
    .split(/\n+|\s+then\s+|\s*;\s*/i)
    .map((part) => part.replace(/[,\s]+$/g, '').trim())
    .filter(Boolean)
    .slice(0, 6);
  // `text` is non-empty and trimmed, so the split always yields a first chapter.
  const firstChapter = chapters[0] as string;
  const forWhom = /(?:for|aimed at) ([^.]+)/i.exec(text);
  const showWhom = /show (?:a |an |the )?(.+?) how to/i.exec(text);
  const audience = (forWhom?.[1] || showWhom?.[1] || firstChapter.split(/\s+/).slice(0, 8).join(' ')).trim();
  let purpose = 'overview';
  if (/onboard|how to|admin/i.test(text)) purpose = 'onboarding';
  else if (/launch|release/i.test(text)) purpose = 'launch';
  else if (/sales|buyer/i.test(text)) purpose = 'sales';
  else if (/feature/i.test(text)) purpose = 'feature';
  const lengthSec = lengthFromText(text) ?? 120;
  const proof = /stat|percent|%/i.test(text) ? ['stats'] : /quote|customer said/i.test(text) ? ['quote'] : ['features'];
  return {
    title: firstChapter.split(/\s+/).slice(0, 8).join(' '),
    audience,
    purpose,
    lengthSec,
    chapters,
    proof,
    startUrl: httpUrl(startUrl),
    records: false,
  };
}

/** Write a draft onto a scaffolded config. Does not record. */
export interface DraftedConfig {
  title: string;
  audience: string | undefined;
  purpose: string;
  record: Record<string, unknown> & { startUrl: string };
  story: Record<string, unknown> & { mustShow: string[]; lengthSec: number; proof: string[] };
}

export function applyDraftToConfig<C extends DraftableConfig>(
  config: C,
  draft: ShortBriefDraft,
): Omit<C, keyof DraftedConfig> & DraftedConfig {
  return {
    ...config,
    title: draft.title,
    audience: draft.audience || config.audience,
    purpose: draft.purpose,
    record: { ...(config.record || {}), startUrl: draft.startUrl },
    story: {
      ...(config.story || {}),
      mustShow: draft.chapters,
      lengthSec: draft.lengthSec,
      proof: draft.proof,
    },
  };
}
