import { icon } from '@/ui/iconString';
import type { PipelineStep } from '@/desk/store';
import { stepRowHtml } from '@/logic/pipelineUi';

/** `PIPE_ICONS` from `kit/studio/app.js`; steps without one borrow `produce`. */
const PIPE_ICONS: Record<string, string> = {
  guide: icon('walk', { size: 12 }),
  retake: icon('pencil', { size: 12 }),
  record: icon('step-record', { size: 12 }),
  recraft: icon('story', { size: 12 }),
  plates: icon('step-plates', { size: 12 }),
  produce: icon('step-produce', { size: 12 }),
  audio: icon('step-audio', { size: 12 }),
  deliver: icon('step-deliver', { size: 12 }),
  preview: icon('step-preview', { size: 12 }),
};

export interface PipelineRow {
  key: string;
  html: string;
}

/** The rows `renderSteps` paints: busy runs disable the Retry / Fix buttons. */
export function pipelineRows(steps: readonly PipelineStep[], { busy, failure }: { busy: boolean; failure: boolean }): PipelineRow[] {
  return steps.map((s) => {
    const ico = PIPE_ICONS[s.id] || PIPE_ICONS['produce'] || '';
    const row = stepRowHtml(s, { icon: ico, actions: failure });
    return { key: s.id, html: busy ? row.replace(/<button\b/g, '<button disabled') : row };
  });
}

/**
 * Replace only the rows whose markup changed. Rewriting the whole list restarts every running
 * spinner and replays every settle animation, so a list repainted on each poll looks like it blinks.
 */
export function patchRows(ol: HTMLElement, rows: readonly PipelineRow[]): void {
  const existing = new Map<string | undefined, Element>([...ol.children].map((li) => [(li as HTMLElement).dataset['rowKey'], li]));
  let at = 0;
  for (const { key, html } of rows) {
    let li = existing.get(key) as HTMLElement | undefined;
    if (!li || li.dataset['rowHtml'] !== html) {
      const tpl = document.createElement('template');
      tpl.innerHTML = html.trim();
      const next = tpl.content.firstElementChild as HTMLElement | null;
      if (!next) continue;
      next.dataset['rowKey'] = key;
      next.dataset['rowHtml'] = html;
      if (li) li.replaceWith(next);
      li = next;
    }
    existing.delete(key);
    if (ol.children[at] !== li) ol.insertBefore(li, ol.children[at] || null);
    at += 1;
  }
  for (const stale of existing.values()) stale.remove();
}
