import { Fragment, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { HelpTip } from '@/ui/HelpTip';
import { Scrubber } from '@/ui/Scrubber';

import { pickTransition, saveTransitions } from './actions';
import { radioAria } from './model';
import { useNativeChange } from './useNativeChange';
import { directionView, useDirectionView } from './view';

const TRANSITIONS_HELP =
  'Directed chooses a restrained effect for each hand-off. Pick one effect only when the story needs a consistent motif. Chapter-card joins always remain calm.';

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
    <label className="transition-duration">
      <span>Length</span>{' '}
      <Scrubber
        ref={ref}
        id="transitionDuration"
        min="0.2"
        max="1.2"
        step="0.1"
        value={duration}
        aria-label="Transition length in seconds"
        onChange={(e) => directionView.set({ duration: e.target.value, durationOut: `${Number(e.target.value).toFixed(1)}s` })}
      />{' '}
      <output id="transitionDurationOut" htmlFor="transitionDuration">
        {out}
      </output>
    </label>
  );
}

export function TransitionsField() {
  const { style, marked } = useDirectionView(useShallow((s) => ({ style: s.transition, marked: s.transitionMarked })));
  return (
    <div className="field transitions-field">
      <span data-help={TRANSITIONS_HELP} className="has-help">
        Scene transitions
        <HelpTip text={TRANSITIONS_HELP} label="Scene transitions" />
      </span>
      <div className="transition-presets" id="transitionGrid" role="radiogroup" aria-label="Scene transitions">
        {TRANSITIONS.map((t, i) => {
          const on = t.id === style;
          return (
            <Fragment key={t.id}>
              {i > 0 ? ' ' : null}
              <button
                type="button"
                className={on ? 'transition-option active' : 'transition-option'}
                data-transition={t.id}
                role="radio"
                aria-checked={marked ? radioAria(on, true) : undefined}
                onClick={() => pickTransition(t.id)}
              >
                <strong>{t.name}</strong>
                <em>{t.em}</em>
              </button>
            </Fragment>
          );
        })}
      </div>
      <TransitionLength />
    </div>
  );
}
