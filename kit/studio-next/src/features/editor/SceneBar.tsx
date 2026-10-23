import { bridges } from '@/desk/bridge';
import { useDesk } from '@/desk/store';
import { Icon } from '@/ui/icons';

import { askAiForCurrentScene, editCurrentPlate, openMotionForCurrentScene } from './engine/plate';
import { sceneBarView } from './engine/sceneView';

export function SceneBar() {
  const loaded = useDesk((s) => s.video != null);
  const scenes = useDesk((s) => s.scenes);
  const cur = useDesk((s) => s.currentScene);
  const monitorMode = useDesk((s) => s.monitorMode);
  const activePlateId = useDesk((s) => s.activePlateId);
  const selection = bridges.editor?.selection;
  const liveSelectionId = selection?.kind === 'live' ? (selection.scene?.id ?? null) : null;
  const view = sceneBarView({ loaded, scenes, cur, monitorMode, activePlateId, liveSelectionId });

  return (
    <div id="sceneBar" className="scene-bar">
      <div className="scene-now">
        <span className={view.kindClass} id="sceneKind">
          {view.kind}
        </span>
        <div className="scene-copy">
          <strong id="sceneTitle">{view.title}</strong>{' '}
          <span id="sceneHint" className="meta">
            {view.hint}
          </span>
        </div>
      </div>
      <div className="scene-actions">
        <button
          type="button"
          id="btnEditScene"
          className={view.editPrimary ? 'btn primary compact icon-text' : 'btn compact icon-text'}
          disabled={view.editDisabled}
          title="Open plate editor — click text to change copy"
          onClick={() => void editCurrentPlate()}
        >
          <Icon name="ui-pencil" size={12} /> <span id="btnEditSceneLabel">{view.editLabel}</span>
        </button>{' '}
        <button
          type="button"
          id="btnAskAiScene"
          className="btn compact icon-text"
          disabled={view.askDisabled}
          title="Write feedback for this plate, then Apply AI"
          onClick={() => void askAiForCurrentScene()}
        >
          <Icon name="ui-bulb" size={12} /> Ask AI
        </button>{' '}
        <button
          type="button"
          id="btnMotionScene"
          className="btn compact icon-text"
          disabled={view.motionDisabled}
          title="Open Motion templates (does not run AI yet)"
          onClick={openMotionForCurrentScene}
        >
          <Icon name="ui-walk" size={12} /> Motion
        </button>
      </div>
      {/* Plate chips removed — timeline + Edit plate cover jumps. Host kept for `#sceneChips` lookups. */}
      <div id="sceneChips" className="scene-chips" aria-label="Plate scenes" hidden />
    </div>
  );
}
