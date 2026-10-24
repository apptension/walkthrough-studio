import { Fragment } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { LayoutOption } from '@/api/types';
import { useDesk } from '@/desk/store';
import { HelpTip } from '@/ui/HelpTip';

import { pickPlateLayout } from './actions';
import { radioAria } from './model';

const LAYOUTS_HELP =
  'The composition of the opening and closing plates. Same copy, logo and colours — a different staging. Proof plates pick their own layout in the plate inspector.';

const EMPTY: LayoutOption[] = [];

function LayoutRow({ plateId, label, options, current }: { plateId: 'open' | 'close'; label: string; options: LayoutOption[]; current: string }) {
  return (
    <div className="layout-group">
      <span className="layout-label">{label}</span>
      <div className="energy-row templates" id={`${plateId}LayoutGrid`} role="radiogroup" aria-label={`${label} layout`}>
        {options.map((o, i) => {
          const on = o.id === current;
          return (
            <Fragment key={o.id}>
              {i > 0 ? ' ' : null}
              <button
                type="button"
                className={on ? 'energy active' : 'energy'}
                data-plate-layout={o.id}
                role="radio"
                aria-checked={radioAria(on, true)}
                title={o.hint}
                onClick={() => {
                  if (!on) void pickPlateLayout(plateId, o.id);
                }}
              >
                <strong>{o.label}</strong>
                <em>{o.hint}</em>
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/** Opener / closer composition pickers in Direction → Motion & transitions. */
export function PlateLayoutsField() {
  const { open, close, openOptions, closeOptions } = useDesk(
    useShallow((s) => ({
      open: s.video?.plateLayouts?.open || 'classic',
      close: s.video?.plateLayouts?.close || 'classic',
      openOptions: s.video?.motionOptions?.layouts?.open || EMPTY,
      closeOptions: s.video?.motionOptions?.layouts?.close || EMPTY,
    })),
  );
  if (!openOptions.length && !closeOptions.length) return null;
  return (
    <div className="field layouts-field">
      <span data-help={LAYOUTS_HELP} className="has-help">
        Plate layouts
        <HelpTip text={LAYOUTS_HELP} label="Plate layouts" />
      </span>
      {openOptions.length ? <LayoutRow plateId="open" label="Opener" options={openOptions} current={open} /> : null}
      {closeOptions.length ? <LayoutRow plateId="close" label="Closer" options={closeOptions} current={close} /> : null}
    </div>
  );
}
