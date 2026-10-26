import { desk } from '@/desk/store';

import {
  currentAccentState,
  discardPlateCopyEdits,
  fitFhdPreview,
  focusPlateField,
  frameReady,
  listPlateFields,
  loadPlateFrame,
  plateMotionMode,
  preloadPlateFrame,
  plateRestart,
  plateSeek,
  plateSelectionDetail,
  plateSetLiveComposite,
  plateTextMode,
  savePlateCopyEdits,
  setPlateFieldSource,
  toggleFieldAccent,
} from './plate';

/** `ctx.plate` — the plate controller `kit/studio/app.js#initStages` handed the editor. */
export const P = {
  load: (id: string, opts?: { force?: boolean; motionAt?: number }) => loadPlateFrame(id, opts),
  ready: (): string | null => frameReady(),
  /** Arm the next document off-stage so its cut is a swap, not a load. */
  preload: preloadPlateFrame,
  motion: plateMotionMode,
  seek: plateSeek,
  restart: plateRestart,
  text: plateTextMode,
  composite: plateSetLiveComposite,
  dirty: (): boolean => Boolean(desk.get().plateDirty),
  save: savePlateCopyEdits,
  discard: discardPlateCopyEdits,
  accent: toggleFieldAccent,
  accentState: currentAccentState,
  focus: focusPlateField,
  fields: listPlateFields,
  setField: setPlateFieldSource,
  selection: plateSelectionDetail,
  fit: () => fitFhdPreview(),
};
