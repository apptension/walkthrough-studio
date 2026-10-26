import { useShallow } from 'zustand/react/shallow';

import type { LayoutOption } from '@/api/types';
import { useDesk } from '@/desk/store';
import { layoutWire } from '@/ui/look/previews';
import { LookTile, PaneSection, PaneSub, TileGrid } from '@/ui/pane';

import { pickPlateLayout } from './actions';

const LAYOUTS_HELP =
  'The composition of the opening and closing plates. Same copy, logo and colours — a different staging. Proof plates pick their own layout in the plate inspector.';

const EMPTY: LayoutOption[] = [];

function LayoutRow({ plateId, label, options, current }: { plateId: 'open' | 'close'; label: string; options: LayoutOption[]; current: string }) {
  return (
    <PaneSub label={label}>
      <TileGrid label={`${label} layout`} id={`${plateId}LayoutGrid`}>
        {options.map((o) => {
          const on = o.id === current;
          return (
            <LookTile
              key={o.id}
              preview={layoutWire(plateId, o.id)}
              label={o.label}
              hint={o.hint}
              on={on}
              data={{ 'data-plate-layout': o.id }}
              onSelect={() => {
                if (!on) void pickPlateLayout(plateId, o.id);
              }}
            />
          );
        })}
      </TileGrid>
    </PaneSub>
  );
}

/** Opener / closer composition pickers. */
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
    <PaneSection icon="plate" title="Plate layouts" help={LAYOUTS_HELP} className="layouts-field">
      {openOptions.length ? <LayoutRow plateId="open" label="Opener" options={openOptions} current={open} /> : null}
      {closeOptions.length ? <LayoutRow plateId="close" label="Closer" options={closeOptions} current={close} /> : null}
    </PaneSection>
  );
}
