import type { MouseEvent as ReactMouseEvent } from 'react';

import { desk } from '@/desk/store';

import { showPlateHtml } from './engine/plate';

function onPickerClick(e: ReactMouseEvent<HTMLDivElement>): void {
  const btn = (e.target as Element).closest<HTMLElement>('button[data-plate-id]');
  if (!btn || btn.dataset['kind'] === 'live') return;
  const plate = desk.get().htmlPlates.find((p) => p.id === btn.dataset['plateId']);
  if (plate) void showPlateHtml(plate);
}

/** `#platePicker` — `renderHtmlPlatePicker` fills `#platePickerList` (it stays empty while the editor exists). */
export function PlatePicker() {
  return (
    <div id="platePicker" className="plate-picker" hidden>
      <div className="plate-picker-label">
        Plates
      </div>
      <div id="platePickerList" className="plate-picker-list" onClick={onPickerClick} />
    </div>
  );
}
