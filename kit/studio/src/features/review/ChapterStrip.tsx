import type { MouseEvent } from 'react';

import { fmtShort } from '@/desk/format';
import { activePlayer, seekTo } from '@/desk/monitor';
import { desk, useDesk } from '@/desk/store';
import { toast } from '@/desk/toast';
import { chapterAt } from '@/features/monitor/model';
import { PanelSection } from '@/ui/PanelSection';

const CHAPTERS_HELP =
  'The video’s sections. Click one to jump there. They also become YouTube chapters in the handoff pack.';

function onStripClick(e: MouseEvent<HTMLDivElement>) {
  if (desk.get().monitorMode === 'plate') {
    toast('Timeline locked', 'Exit to Program to jump chapters', 'warn');
    return;
  }
  const btn = (e.target as Element).closest<HTMLElement>('button[data-start]');
  if (!btn) return;
  seekTo(Number(btn.dataset.start));
  activePlayer()
    ?.play?.()
    ?.catch(() => {});
}

/** `#chapterStrip`: one button per chapter; `updateTransport` marks the playing one. */
export function ChapterStrip() {
  const chapters = useDesk((s) => s.chapters);
  const activeStart = useDesk((s) => chapterAt(s.chapters, s.transport.t)?.start ?? null);
  return (
    <PanelSection id="chapters" icon="chapters" title="Chapters" help={CHAPTERS_HELP}>
      <div
        id="chapterStrip"
        className="chapter-list"
        onClick={onStripClick}
      >
        {chapters.map((c, i) => (
          <button
            key={i}
            type="button"
            data-start={c.start}
            title={c.title || ''}
            className={activeStart != null && c.start === activeStart ? 'active' : undefined}
          >
            <span className="t">{fmtShort(c.start)}</span>
            <span className="ch-title">{String(c.title || 'Chapter')}</span>
          </button>
        ))}
      </div>
    </PanelSection>
  );
}
