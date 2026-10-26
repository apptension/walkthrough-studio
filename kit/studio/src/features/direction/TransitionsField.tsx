import { useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { transitionPreview } from '@/ui/look/previews';
import { LookTile, PaneNote, PaneSection, RangeRow, TileGrid } from '@/ui/pane';

import { pickTransition, saveTransitions } from './actions';
import { useNativeChange } from './useNativeChange';
import { directionView, useDirectionView } from './view';

const TRANSITIONS_HELP =
  'Directed chooses a restrained effect for each hand-off. Pick one effect only when the story needs a consistent motif. Chapter-card joins always remain calm. With Directed or Dissolve, back-to-back slides that share a background keep it moving — only the copy changes.';

const TRANSITIONS = [
  { id: 'directed', name: 'Directed', em: 'Chooses per scene' },
  { id: 'dissolve', name: 'Dissolve', em: 'Soft continuity' },
  { id: 'wipe', name: 'Brand wipe', em: 'Polished reveal' },
  { id: 'push', name: 'Push', em: 'Forward momentum' },
  { id: 'zoom', name: 'Focus zoom', em: 'Pull attention in' },
  { id: 'iris', name: 'Iris', em: 'Circular reveal' },
  { id: 'blur', name: 'Blur', em: 'Defocus + resolve' },
  { id: 'dip', name: 'Dip', em: 'Firm chapter break' },
  { id: 'radial', name: 'Radial', em: 'Clock-hand sweep' },
  { id: 'slice', name: 'Slice', em: 'Slats peel away' },
  { id: 'diagonal', name: 'Diagonal', em: 'Corner-to-corner' },
];

function TransitionLength() {
  const { duration, out } = useDirectionView(useShallow((s) => ({ duration: s.duration, out: s.durationOut })));
  const ref = useRef<HTMLInputElement>(null);
  useNativeChange(ref, (e) => saveTransitions({ duration: Number((e.target as HTMLInputElement).value) }));
  return (
    <RangeRow
      inputRef={ref}
      id="transitionDuration"
      label="Length"
      aria="Transition length in seconds"
      min="0.2"
      max="1.2"
      step="0.1"
      value={duration}
      out={out}
      onChange={(e) => directionView.set({ duration: e.target.value, durationOut: `${Number(e.target.value).toFixed(1)}s` })}
    />
  );
}

export function TransitionsSection() {
  const style = useDirectionView((s) => s.transition);
  const current = TRANSITIONS.find((t) => t.id === style);
  return (
    <PaneSection icon="transition" title="Scene transitions" help={TRANSITIONS_HELP} extra={current ? <span className="dir-val">{current.name}</span> : null}>
      <TileGrid label="Scene transitions" id="transitionGrid" cols={4} className="lk-trs">
        {TRANSITIONS.map((t) => {
          const on = t.id === style;
          return (
            <LookTile
              key={t.id}
              preview={transitionPreview(t.id)}
              label={t.name}
              hint={`${t.name} — ${t.em}`}
              on={on}
              data={{ 'data-transition': t.id }}
              onSelect={() => {
                if (!on) pickTransition(t.id);
              }}
            />
          );
        })}
      </TileGrid>
      <div className="pane-ranges">
        <TransitionLength />
      </div>
      {current ? <PaneNote tone="subtle">{`${current.name}: ${current.em.toLowerCase()}. Chapter-card joins always stay calm.`}</PaneNote> : null}
    </PaneSection>
  );
}
