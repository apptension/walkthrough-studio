import type { Scene } from '@/api/types';
import { bridges, type PlateBridge } from '@/desk/bridge';

import { editorApi } from './lifecycle';
import {
  approvePlateOnly,
  askAiForCurrentScene,
  discardPlateCopyEdits,
  editCurrentPlate,
  ensureFhdFitObserver,
  fitFhdPreview,
  inferPlateIdFromFeedback,
  loadPlateFrame,
  openMotionForCurrentScene,
  openPlateFromScene,
  previewPlateAfterEdit,
  rebuildPlateHtmlPreview,
  replayPlateInline,
  savePlateCopyEdits,
  showPlateHtml,
} from './plate';

/** `initStages()`: the editor and the plate preview register on the desk's bridges. */

export const plateBridge: PlateBridge = {
  rebuildPlateHtmlPreview: (opts) => rebuildPlateHtmlPreview(opts),
  openPlateFromScene: (scene: Scene) => openPlateFromScene(scene),
  fitFhdPreview: () => fitFhdPreview(),
  ensureFhdFitObserver,
  previewPlateAfterEdit: (plateId: string) => previewPlateAfterEdit(plateId),
  approvePlateOnly,
  savePlateCopyEdits,
  showPlateHtml: (plateId: string) => showPlateHtml(plateId),
  editCurrentPlate: (scene) => void editCurrentPlate(scene ?? undefined),
  loadPlateFrame: (plateId, opts) => loadPlateFrame(plateId, opts),
  askAiForCurrentScene: (opts) => askAiForCurrentScene(opts),
  openMotionForCurrentScene,
  inferPlateIdFromFeedback,
  discardPlateCopyEdits,
  replayPlateInline,
};

/** Register both bridges; the returned cleanup clears them if they are still ours. */
export function registerEditorBridges(): () => void {
  bridges.editor = editorApi;
  bridges.plate = plateBridge;
  return () => {
    if (bridges.editor === editorApi) bridges.editor = null;
    if (bridges.plate === plateBridge) bridges.plate = null;
  };
}
