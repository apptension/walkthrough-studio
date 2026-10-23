import type { Scene } from '@/api/types';
import { fmtShort } from '@/desk/format';
import type { MonitorMode } from '@/desk/store';

export interface SceneBarView {
  kind: string;
  kindClass: string;
  title: string;
  hint: string;
  editDisabled: boolean;
  askDisabled: boolean;
  motionDisabled: boolean;
  editPrimary: boolean;
  editLabel: string;
}

const PAGE_LOAD: SceneBarView = {
  kind: '—',
  kindClass: 'scene-kind',
  title: 'No scene',
  hint: 'Play or scrub the timeline',
  editDisabled: true,
  askDisabled: true,
  motionDisabled: true,
  editPrimary: true,
  editLabel: 'Edit plate',
};

const NO_SCENES: SceneBarView = { ...PAGE_LOAD, title: 'No scenes yet', hint: 'Make a video once so scenes appear' };

/** The scene bar as `updateSceneFromTime` painted it. */
export function sceneBarView({
  loaded,
  scenes,
  cur,
  monitorMode,
  activePlateId,
  liveSelectionId,
}: {
  loaded: boolean;
  scenes: Scene[];
  cur: Scene | null;
  monitorMode: MonitorMode;
  activePlateId: string | null;
  liveSelectionId: string | null;
}): SceneBarView {
  if (!loaded) return PAGE_LOAD;
  if (!scenes.length || !cur) return NO_SCENES;
  const plate = monitorMode === 'plate';
  const span = `${fmtShort(cur.start)}–${fmtShort(cur.end)}`;
  const hint = cur.editable
    ? plate
      ? `${span} · click text to edit · Replay / Save · timeline locked`
      : `${span} · Edit plate for copy, look and style · Ask AI for agent help`
    : `${span} · Edit clip for speed, zoom and transitions`;
  const editingPlate = plate && cur.editable && cur.plateId === activePlateId;
  const editingLive = plate && !cur.editable && liveSelectionId === cur.id;
  const editing = editingPlate || editingLive;
  return {
    kind: cur.kind === 'plate' ? 'Plate' : 'Live',
    kindClass: `scene-kind ${cur.kind}`,
    title: String(cur.title),
    hint,
    editDisabled: false,
    askDisabled: !cur.editable,
    motionDisabled: !cur.editable,
    editPrimary: !editing,
    editLabel: editing ? 'Editing…' : cur.editable ? 'Edit plate' : 'Edit clip',
  };
}
