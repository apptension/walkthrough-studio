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
  load: (id: string, opts?: { force?: boolean }) => loadPlateFrame(id, opts),
  ready: (): string | null => frameReady(),
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
