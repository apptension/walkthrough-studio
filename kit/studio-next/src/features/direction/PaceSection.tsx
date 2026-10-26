import { useDesk } from '@/desk/store';
import { pacePreview } from '@/ui/look/previews';
import { LookTile, PaneNote, PaneSection, TileGrid } from '@/ui/pane';

import { setPace } from './actions';
import { paceNote } from './model';
import { useDirectionView } from './view';

const PACE_HELP =
  "How fast the recorded tour moves: one tempo over every authored hold, pointer glide and caption minimum — the voice is never sped up. Narration sets a floor: a step still waits for its line to finish. When the take spends ≥20% of its time waiting on voice, Record and QC say so — trim those lines or raise voice speed instead of pushing the pace further. Flows can shift pace mid-tour with ctx.pace('brisk') and ctx.pace() to return.";

export function PaceSection() {
  const direction = useDirectionView((s) => s.direction);
  const live = useDesk((s) => s.video?.livePace ?? null);
  const pace = direction?.pace ?? null;
  const note = pace ? paceNote(pace, live) : null;
  const paces = Object.entries(direction?.paces || {});
  return (
    <PaneSection
      icon="pace"
      title="Live pace"
      help={PACE_HELP}
      id="paceSection"
      extra={
        <span id="paceMeta" className="dir-val">
          {pace ? `${pace.tempo}×` : ''}
        </span>
      }
    >
      <TileGrid label="Live pace" id="paceSeg" cols={paces.length + (pace?.custom ? 1 : 0) >= 4 ? 4 : 3}>
        {direction && pace ? (
          <>
            {paces.map(([id, p]) => {
              const on = !pace.custom && id === pace.id;
              return (
                <LookTile
                  key={id}
                  preview={pacePreview(p.tempo)}
                  label={p.label}
                  detail={`${p.tempo}×`}
                  hint={`${p.label} — ${p.hint} · ${p.tempo}×`}
                  on={on}
                  data={{ 'data-pace': id }}
                  onSelect={() => {
                    if (!on) void setPace(id).catch(() => {});
                  }}
                />
              );
            })}
            {pace.custom ? (
              <LookTile
                preview={pacePreview(pace.tempo)}
                label="Custom"
                detail={`${pace.tempo}×`}
                hint={`Set from the CLI (direction --pace ${pace.tempo})`}
                on
                data={{ 'data-pace': String(pace.tempo) }}
              />
            ) : null}
          </>
        ) : null}
      </TileGrid>
      <PaneNote tone="subtle" id="paceHint">
        {pace ? `${pace.hint}${pace.id === 'steady' ? '' : ' · re-record to apply'}` : 'Loads with the video.'}
      </PaneNote>
      <p className="ins-note dir-note" id="paceNote" hidden={!note} data-tone={pace && note ? note.tone : undefined}>
        {note?.text}
      </p>
    </PaneSection>
  );
}
