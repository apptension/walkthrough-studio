import type { CSSProperties, MouseEvent } from 'react';

import type { CameraSettings, CursorSettings, Direction } from '@/api/types';
import { HelpTip } from '@/ui/HelpTip';
import { CURVES, MOTION_SPEEDS, type CurveId, type MotionId } from '@/logic/easing';
import {
  cursorPreview,
  curvePreview,
  framePreview,
  groundPreview,
  motionLengthPreview,
  zoomPreview,
} from '@/ui/look/previews';
import {
  LookTile,
  PaneNote,
  PaneSection,
  PaneSub,
  SegButtons,
  SwitchRow,
  TileGrid,
  type SegChoice,
} from '@/ui/pane';

import { CURSOR_TOGGLES, pickCamera, pickLook, toggleCursor, toggleKeys } from './actions';
import { directionView, useDirectionView, type CursorToggles } from './view';

const quietly = (p: Promise<unknown>) => void p.catch(() => {});

const DEFAULT_CAMERA: Partial<CameraSettings> = {
  zoom: 'off',
  frame: 'full',
  background: 'brand',
  padding: 'balanced',
  corners: 'soft',
  shadow: 'soft',
};
const DEFAULT_CURSOR: Partial<CursorSettings> = {
  style: 'classic',
  size: 'm',
  glide: false,
  hideIdle: false,
  loop: false,
};

const LOOK_HELP =
  'A look sets the camera, frame and cursor in one pick. Tune any of it below; render settings are non-destructive.';
const ZOOM_HELP =
  'Pushes in on each click and follows the pointer between clicks, then eases back out. Chapter cards, captions and lenses always stay full frame.';
const CURVE_HELP =
  "The easing every camera move follows: the push-in, the pan between clicks and the magnifier's open and close. The Editor stage previews the same curve the render uses.";
const LENGTH_HELP =
  'How long camera moves and the magnifier take to land. Unhurried is about a third longer, Swift a quarter shorter.';
const FRAME_HELP =
  'Inset shows the app as a rounded window with a soft shadow on a background built from the color scale.';
const CURSOR_HELP =
  "Classic keeps Playwright's pointer. Arrow and Dot are drawn for video, glide between targets and pulse on click.";
const KEYS_HELP =
  'Shows shortcuts the flow presses (⌘K, Enter, Esc) as keycaps at the bottom of the frame. Plain typing is not shown.';

const ZOOMS = [
  { value: 'off', label: 'Off', hint: 'The recording stays full frame' },
  { value: 'subtle', label: 'Subtle', hint: 'A gentle push toward each click' },
  { value: 'bold', label: 'Bold', hint: 'A close push that fills the frame with the action' },
];
const FRAMES = [
  { value: 'full', label: 'Full bleed', hint: 'The recording fills the video' },
  { value: 'inset', label: 'Inset', hint: 'A rounded window on a brand background' },
];
const GROUNDS = [
  { value: 'brand', label: 'Brand', hint: 'Surface to ink with an accent glow' },
  { value: 'ink', label: 'Ink', hint: 'Flat ink' },
  { value: 'accent', label: 'Accent', hint: 'Accent to secondary' },
];
const DETAILS: Array<{
  key: 'padding' | 'corners' | 'shadow';
  label: string;
  aria: string;
  choices: SegChoice[];
}> = [
  {
    key: 'padding',
    label: 'Padding',
    aria: 'Frame padding',
    choices: [
      { value: 'tight', label: 'Tight' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'roomy', label: 'Roomy' },
    ],
  },
  {
    key: 'corners',
    label: 'Corners',
    aria: 'Frame corners',
    choices: [
      { value: 'square', label: 'Square' },
      { value: 'soft', label: 'Soft' },
      { value: 'round', label: 'Round' },
    ],
  },
  {
    key: 'shadow',
    label: 'Shadow',
    aria: 'Frame shadow',
    choices: [
      { value: 'off', label: 'Off' },
      { value: 'soft', label: 'Soft' },
      { value: 'deep', label: 'Deep' },
    ],
  },
];
const CURSORS = [
  { value: 'classic', label: 'Classic', hint: "Playwright's own pointer" },
  { value: 'arrow', label: 'Arrow', hint: 'Drawn for video — glides and pulses on click' },
  { value: 'dot', label: 'Dot', hint: 'A soft dot that pulses on click' },
];
const SIZES: SegChoice[] = [
  { value: 's', label: 'S', title: 'Small' },
  { value: 'm', label: 'M', title: 'Medium' },
  { value: 'l', label: 'L', title: 'Large' },
];

const TOGGLE_COPY: Record<string, { label: string; hint: string; help: string; aria: string }> = {
  glideToggle: {
    label: 'Smooth glide',
    hint: 'Curved paths between targets',
    help: 'Moves between action targets on a smooth curved path.',
    aria: 'Smooth cursor glide',
  },
  handToggle: {
    label: 'Hand on click',
    hint: 'A pointing hand presses each click',
    help: 'Just before a click the arrow turns into a pointing hand that pushes down on the press, so viewers see the click happen.',
    aria: 'Pointing hand on clicks',
  },
  idleToggle: {
    label: 'Hide when idle',
    hint: 'Fades after 1.5 s still',
    help: 'Fades the presentation cursor after 1.5 seconds without movement.',
    aria: 'Hide cursor when idle',
  },
  loopToggle: {
    label: 'Loop cursor',
    hint: 'Ends where it started',
    help: 'Returns the pointer to its opening seat before capture ends, useful for looping clips.',
    aria: 'Loop cursor position',
  },
};

interface CameraView {
  camera: Partial<CameraSettings>;
  cursor: Partial<CursorSettings>;
  colors: Record<string, string>;
  chips: Record<string, string | undefined>;
}

function cameraView(direction: Direction): CameraView {
  const c = direction.colors || {};
  return {
    camera: { ...DEFAULT_CAMERA, ...direction.camera },
    cursor: { ...DEFAULT_CURSOR, ...direction.cursor },
    colors: c,
    chips: {
      brand: `radial-gradient(circle at 80% 15%, ${c.gold}66, transparent 55%), linear-gradient(135deg, ${c.surface}, ${c.ink})`,
      ink: c.ink,
      accent: `linear-gradient(135deg, ${c.gold}, ${c.amber})`,
    },
  };
}

function LookPreview({
  direction,
  view,
}: {
  direction: Direction | null;
  view: CameraView | null;
}) {
  const camera = view?.camera;
  const style =
    view && camera
      ? ({
          '--look-bg': view.chips[camera.background ?? ''] || view.chips.brand,
          '--look-accent': direction?.colors?.gold || '#42f272',
        } as CSSProperties)
      : undefined;
  return (
    <div
      className="look-preview dir-look-hero"
      id="lookPreview"
      aria-label="Frame style preview"
      data-frame={camera?.frame}
      data-cursor={view?.cursor.style}
      data-keys={direction ? (direction.keys ? 'on' : 'off') : undefined}
      data-padding={camera?.padding}
      data-corners={camera?.corners}
      data-shadow={camera?.shadow}
      style={style}
    >
      <div className="look-preview-window">
        <i />
        <i />
        <i />
        <span />
        <b />
      </div>
      <div className="look-preview-cursor" aria-hidden="true" />
      <div className="look-preview-keys" aria-hidden="true">
        <i>⌘</i>
        <i>K</i>
      </div>
    </div>
  );
}

const Helped = ({ label, help }: { label: string; help: string }) => (
  <>
    {label}
    <HelpTip text={help} label={label} />
  </>
);

function setToggle(key: keyof CursorToggles, on: boolean) {
  directionView.set((s) => ({ toggles: { ...s.toggles, [key]: on } }));
}

const curveIds = Object.keys(CURVES) as CurveId[];
const motionIds = Object.keys(MOTION_SPEEDS) as MotionId[];

/** A camera or cursor row as tiles; the pane's click delegate saves the pick. */
function ChoiceTiles({
  group,
  label,
  current,
  choices,
  preview,
  id,
  cols,
}: {
  group: { camera?: keyof CameraSettings; cursor?: 'style' };
  label: string;
  current: string | undefined;
  choices: Array<{ value: string; label: string; hint: string }>;
  preview: (value: string) => string;
  id?: string;
  cols?: 2 | 3 | 4;
}) {
  return (
    <TileGrid
      label={label}
      data={{ 'data-camera': group.camera, 'data-cursor': group.cursor }}
      {...(id ? { id } : {})}
      {...(cols ? { cols } : {})}
    >
      {choices.map((c) => (
        <LookTile
          key={c.value}
          preview={preview(c.value)}
          label={c.label}
          hint={`${c.label} — ${c.hint}`}
          on={c.value === current}
          data={{ 'data-value': c.value }}
        />
      ))}
    </TileGrid>
  );
}

/** Camera tab: the look, camera moves, the frame and the cursor. */
export function CameraPane() {
  const direction = useDirectionView((s) => s.direction);
  const toggles = useDirectionView((s) => s.toggles);
  const view = direction ? cameraView(direction) : null;
  const camera = view?.camera;
  const cursor = view?.cursor;
  const inset = camera ? camera.frame === 'inset' : true;
  const classic = cursor ? cursor.style === 'classic' : undefined;
  const colors = view?.colors ?? {};

  const onClick = (e: MouseEvent<HTMLElement>) => {
    const target = e.target as Element;
    const look = target.closest<HTMLElement>('[data-look]');
    if (look) {
      if (look.getAttribute('aria-checked') !== 'true') quietly(pickLook(look.dataset.look ?? ''));
      return;
    }
    const btn = target.closest<HTMLElement>('[data-value]');
    const group = btn?.closest<HTMLElement>('[data-camera],[data-cursor]');
    if (!btn || !group || btn.getAttribute('aria-checked') === 'true') return;
    const which = group.dataset.camera
      ? { camera: group.dataset.camera }
      : { cursor: group.dataset.cursor ?? '' };
    quietly(pickCamera(which, btn.dataset.value ?? ''));
  };

  const looks = Object.entries(direction?.looks || {});
  return (
    <div id="cameraSection" className="dir-camera" onClick={onClick}>
      <PaneSection
        icon="camera"
        title="Look"
        help={LOOK_HELP}
        extra={
          direction ? (
            <span className="dir-val">{direction.looks?.[direction.look]?.label ?? 'Custom'}</span>
          ) : null
        }
      >
        <LookPreview direction={direction} view={view} />
        <TileGrid label="Look presets" id="lookPresets">
          {looks.map(([id, look]) => (
            <LookTile
              key={id}
              preview={framePreview({ ...DEFAULT_CAMERA, ...look.camera }, colors)}
              label={look.label}
              hint={look.hint ? `${look.label} — ${look.hint}` : look.label}
              on={direction?.look === id}
              data={{ 'data-look': id }}
            />
          ))}
        </TileGrid>
        {direction && looks.length > 0 && !direction.looks?.[direction.look] ? (
          <PaneNote>Tuned by hand. Picking a look replaces the settings below.</PaneNote>
        ) : null}
      </PaneSection>

      <PaneSection icon="zoom" title="Camera moves">
        <PaneSub label={<Helped label="Auto zoom" help={ZOOM_HELP} />}>
          <ChoiceTiles
            group={{ camera: 'zoom' }}
            label="Auto zoom"
            current={camera?.zoom}
            choices={ZOOMS}
            preview={zoomPreview}
          />
        </PaneSub>
        <PaneSub label={<Helped label="Motion curve" help={CURVE_HELP} />}>
          <ChoiceTiles
            group={{ camera: 'curve' }}
            label="Motion curve"
            current={camera ? camera.curve || 'glide' : undefined}
            choices={curveIds.map((id) => ({
              value: id,
              label: CURVES[id].label,
              hint: CURVES[id].hint,
            }))}
            preview={(id) => curvePreview(CURVES[id as CurveId]?.css)}
            cols={4}
          />
        </PaneSub>
        <PaneSub label={<Helped label="Move length" help={LENGTH_HELP} />}>
          <ChoiceTiles
            group={{ camera: 'motion' }}
            label="Move length"
            current={camera ? camera.motion || 'natural' : undefined}
            choices={motionIds.map((id) => ({
              value: id,
              label: MOTION_SPEEDS[id].label,
              hint: MOTION_SPEEDS[id].hint,
            }))}
            preview={(id) => motionLengthPreview(MOTION_SPEEDS[id as MotionId]?.scale ?? 1)}
          />
        </PaneSub>
      </PaneSection>

      <PaneSection icon="fit" title="Frame" help={FRAME_HELP}>
        <ChoiceTiles
          group={{ camera: 'frame' }}
          label="Frame"
          current={camera?.frame}
          choices={FRAMES}
          preview={(v) => framePreview({ ...camera, frame: v }, colors)}
          cols={2}
        />
        <PaneSub label="Background" id="backgroundRow" hidden={!inset}>
          <ChoiceTiles
            group={{ camera: 'background' }}
            label="Frame background"
            current={camera?.background}
            choices={GROUNDS}
            preview={(v) => groundPreview(v, colors)}
          />
        </PaneSub>
        {DETAILS.map((d) => (
          <div key={d.key} className="ins-quick frameDetailRow" hidden={!inset}>
            <span>{d.label}</span>
            <SegButtons
              label={d.aria}
              choices={d.choices}
              current={camera?.[d.key]}
              data={{ 'data-camera': d.key }}
            />
          </div>
        ))}
      </PaneSection>

      <PaneSection icon="cursor" title="Cursor" help={CURSOR_HELP}>
        <PaneSub
          label="Style"
          aside={
            <span id="cursorSizeRow" hidden={classic}>
              <SegButtons
                label="Cursor size"
                choices={SIZES}
                current={cursor?.size}
                data={{ 'data-cursor': 'size' }}
              />
            </span>
          }
        >
          <ChoiceTiles
            group={{ cursor: 'style' }}
            label="Cursor style"
            current={cursor?.style}
            choices={CURSORS}
            preview={(v) => cursorPreview(v, cursor?.size || 'm')}
          />
        </PaneSub>
        <div className="pane-switches">
          {CURSOR_TOGGLES.map((t) => {
            const copy = TOGGLE_COPY[t.id];
            if (!copy) return null;
            return (
              <SwitchRow
                key={t.id}
                id={t.id}
                label={copy.label}
                hint={copy.hint}
                help={copy.help}
                aria={copy.aria}
                checked={toggles[t.toggle]}
                className="cursorDetailRow"
                hidden={classic}
                onToggle={(on) => {
                  setToggle(t.toggle, on);
                  quietly(toggleCursor(t.key, t.label, on));
                }}
              />
            );
          })}
          <SwitchRow
            id="keysToggle"
            label="Keystrokes"
            hint="Shortcuts as keycaps"
            help={KEYS_HELP}
            aria="Show keystrokes"
            checked={toggles.keys}
            onToggle={(on) => {
              setToggle('keys', on);
              quietly(toggleKeys(on));
            }}
          />
        </div>
        {classic ? (
          <PaneNote tone="subtle">
            Classic keeps the browser pointer — pick Arrow or Dot for glide, size and click effects.
          </PaneNote>
        ) : null}
      </PaneSection>
    </div>
  );
}
