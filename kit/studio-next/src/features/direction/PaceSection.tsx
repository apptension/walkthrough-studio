import type { Direction } from '@/api/types';
import { useDesk } from '@/desk/store';
import { renderKey } from '@/features/tools-panel/renderKey';
import { HelpTip } from '@/ui/HelpTip';
import { SecIcon } from '@/ui/icons';

import { setPace } from './actions';
import { paceNote } from './model';
import { useDirectionView } from './view';

const PACE_HELP =
  "Narration sets a floor: a step still waits for its line to finish. When the take spends ≥20% of its time waiting on voice, Record and QC say so — trim those lines or raise voice speed instead of pushing the pace further. Flows can shift pace mid-tour with ctx.pace('brisk') and ctx.pace() to return.";

function PaceSeg({ direction }: { direction: Direction | null }) {
  const pace = direction?.pace;
  const key = direction ? renderKey(direction) : 0;
  return (
    <div
      className="seg pace-seg"
      id="paceSeg"
      role="radiogroup"
      aria-label="Live pace"
      onChange={(e) => void setPace((e.target as HTMLInputElement).value).catch(() => {})}
    >
      {direction && pace ? (
        <>
          {Object.entries(direction.paces || {}).map(([id, p]) => (
            <label key={`${key}:${id}`} title={`${p.hint} · ${p.tempo}×`}>
              <input type="radio" name="pace" value={id} defaultChecked={id === pace.id} />
              <span>{p.label}</span>
            </label>
          ))}
          {pace.custom ? (
            <label key={`${key}:custom`} title={`Set from the CLI (direction --pace ${pace.tempo})`}>
              <input type="radio" name="pace" value={pace.tempo} defaultChecked />
              <span>{pace.tempo}×</span>
            </label>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function PaceSection() {
  const direction = useDirectionView((s) => s.direction);
  const live = useDesk((s) => s.video?.livePace ?? null);
  const pace = direction?.pace ?? null;
  const note = pace ? paceNote(pace, live) : null;
  return (
    <section className="direction-section" id="paceSection">
      <div className="direction-section-head">
        <div>
          <strong data-ico="pace">
            <SecIcon name="pace" />
            Live pace
          </strong>
          <span>
            How fast the recorded tour moves. One tempo over every authored hold, pointer glide and caption minimum — the voice
            is never sped up.
          </span>
        </div>
        <span id="paceMeta" data-help={PACE_HELP} className="meta has-help">
          {pace ? `${pace.tempo}×` : <HelpTip text={PACE_HELP} label="" />}
        </span>
      </div>
      <PaceSeg direction={direction} />
      <p className="meta pace-hint" id="paceHint">
        {pace ? `${pace.hint}${pace.id === 'steady' ? '' : ' · re-record to apply'}` : null}
      </p>
      <p className="meta pace-note" id="paceNote" hidden={!note} data-tone={pace && note ? note.tone : undefined}>
        {note?.text}
      </p>
    </section>
  );
}
